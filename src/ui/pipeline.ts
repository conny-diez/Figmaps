/**
 * iframe-side generation pipeline: PNG bytes in, rendered map PNGs out.
 *
 * Runs entirely in the iframe (PRD §6.3) — it must never call `figma.*`.
 *
 * The analysis itself lives in `src/engine/analyze.ts` and is shared with the
 * eval harness (A-1); this module only decodes, renders and packages.
 */
import { analyzeFrame } from '../engine/analyze'
import { scoreCandidates, type ClickCandidate } from '../engine/clickmap'
import { ENGINE_CONFIG } from '../engine/config'
import { HeuristicAttentionEngine } from '../engine/heuristic'
import { yieldToUi } from '../engine/imageops'
import { analysisSourceSize } from '../engine/ops-pure'
import type { ScalarMap } from '../engine/types'
import { deriveFindings } from '../findings/derive'
import { contrastFindingText, measureContrast } from '../contrast/measure'
import { measureNonTextContrast, nonTextFindingText, reportableNonText } from '../contrast/non-text'
import { renderContrastmap } from '../render/contrastmap'
import { CLICKMAP_IN_PANEL,
  type ContrastFinding,
} from '../messages'
import type {
  ClickRanking,
  FindingPayload,
  MainToUi,
  MapMeta,
  NodeSignal,
  RenderedMap,
  SegmentInfo,
  Settings,
} from '../messages'
import { elementCaption } from '../findings/label'
import { priorAssetIdFor, PRIOR_ASSET_LABELS, PRIOR_ATTRIBUTION_SHORT, shipsPriorAsset } from '../engine/priors'
import { PROFILE_LABELS } from '../engine/params'
import { canvasImageOps } from '../platform/imageops-canvas'
import { canvasToPngBytes, decodePng, fitWithin } from '../render/canvas'
import { renderClickmap } from '../render/clickmap'
import { renderFocusmap } from '../render/focusmap'
import { renderHeatmap } from '../render/heatmap'

export type FrameData = Extract<MainToUi, { type: 'FRAME_DATA' }>

export type PipelineResult = {
  maps: RenderedMap[]
  warnings: string[]
  /** Top candidates for the in-panel ranking list (FR-5). */
  ranking: ClickRanking[]
  /** Epic C. */
  findings: FindingPayload[]
  /** C4 — getrennt von `findings`, siehe `ContrastFinding` in `messages.ts`. */
  contrastFindings: ContrastFinding[]
  /** WCAG 1.4.11 — getrennt von 1.4.3, weil eine Einschätzung darin steckt. */
  nonTextFindings: ContrastFinding[]
  segments: SegmentInfo
  /** Absent when the frame was cancelled before anything was rendered. */
  mapMeta?: MapMeta
}

export type PipelineHooks = {
  /** Coarse progress within a single frame, `0..1`. */
  onStep?: (label: string, progress: number) => void
  /** Polled between steps; returning true aborts the frame. */
  isCancelled?: () => boolean
}

/**
 * The panel's ranking list, named the same way findings are: text content
 * first, layer name as fallback, position when three rows would otherwise read
 * identically. Three „Details ansehen" entries with three percentages are the
 * one place this matters most.
 */
function toRanking(
  candidates: readonly ClickCandidate[],
  signals: readonly NodeSignal[],
  frameHeight: number,
): ClickRanking[] {
  return candidates.slice(0, ENGINE_CONFIG.clickmap.rankingSize).map((candidate) => ({
    id: candidate.id,
    name: elementCaption(candidate, signals, frameHeight),
    score: candidate.score,
  }))
}

const EMPTY_SEGMENTS: SegmentInfo = { segmented: false, sectionCount: 1, viewportHeight: 0, folds: [] }

export async function generateMaps(
  data: FrameData,
  settings: Settings,
  hooks: PipelineHooks = {},
): Promise<PipelineResult> {
  const warnings: string[] = [...data.notices]
  const maps: RenderedMap[] = []
  const cancelled = (): boolean => hooks.isCancelled?.() === true
  const empty = (): PipelineResult => ({ maps, warnings, ranking: [], findings: [], contrastFindings: [], nonTextFindings: [], segments: EMPTY_SEGMENTS })

  hooks.onStep?.('Bild wird gelesen', 0.05)
  const bitmap = await decodePng(data.png)

  try {
    // Pixels for the analysis: bounded on width so a long scroll page keeps
    // enough resolution per section (Epic B).
    const sourceSize = analysisSourceSize(
      bitmap.width,
      bitmap.height,
      ENGINE_CONFIG.analysisSource.maxWidth,
      ENGINE_CONFIG.analysisSource.maxPixels,
    )
    const source = canvasImageOps.fromImageBitmap(bitmap, sourceSize.width, sourceSize.height)

    if (cancelled()) return empty()
    hooks.onStep?.('Aufmerksamkeit wird berechnet', 0.2)

    const engine = new HeuristicAttentionEngine({
      profile: settings.profile,
      // `auto` leaves the choice to the geometry rule inside the engine.
      ...(settings.uiType !== 'auto' ? { priorAsset: settings.uiType } : {}),
    })
    const analysis = await analyzeFrame(
      engine,
      canvasImageOps,
      {
        source,
        signals: data.signals,
        frameWidth: data.width,
        frameHeight: data.height,
        viewportOverride: settings.viewportHeight ?? undefined,
      },
      {
        isCancelled: hooks.isCancelled,
        // B-3 — sections run sequentially and must show progress.
        onSection: (current, total) => {
          const label = total > 1 ? `Abschnitt ${current} von ${total}` : 'Aufmerksamkeit wird berechnet'
          hooks.onStep?.(label, 0.2 + 0.25 * (current / total))
        },
      },
    )
    if (!analysis) return empty()

    const attention: ScalarMap = analysis.attention
    const segments: SegmentInfo = {
      segmented: analysis.plan.segmented,
      sectionCount: analysis.plan.sections.length,
      viewportHeight: analysis.plan.viewportHeight,
      folds: analysis.plan.folds,
    }

    // Output resolution is capped at Figma's image limit (verified: 4096 px).
    const output = fitWithin(bitmap.width, bitmap.height, ENGINE_CONFIG.render.maxImageEdge)
    const opacity = settings.overlayOpacity / 100
    const foldOptions = segments.segmented ? { folds: segments.folds, frameHeight: data.height } : {}

    // Two maps of the same screen can differ only in which reference population
    // and which viewing duration produced them, so both travel with the result
    // and are written next to the image (`figma/place.ts`).
    const resolvedPrior = settings.uiType === 'auto' ? priorAssetIdFor(data.width, data.height) : settings.uiType
    const mapMeta: MapMeta = {
      screenBehaviour: `${PRIOR_ASSET_LABELS[resolvedPrior]}${settings.uiType === 'auto' ? ' (automatisch)' : ''}`,
      duration: PROFILE_LABELS[settings.profile],
      ...(shipsPriorAsset() ? { attribution: PRIOR_ATTRIBUTION_SHORT } : {}),
    }

    let ranking: ClickRanking[] = []
    let candidates: ClickCandidate[] = []

    if (settings.maps.heat) {
      if (cancelled()) return { ...empty(), ranking, segments }
      hooks.onStep?.('Heatmap wird gezeichnet', 0.5)
      await yieldToUi()
      const canvas = renderHeatmap(bitmap, attention, output.width, output.height, { opacity, ...foldOptions })
      maps.push({ kind: 'heat', png: await canvasToPngBytes(canvas) })

      // B-2 — the first section on its own: the part practically every user sees.
      if (analysis.aboveFold) {
        if (cancelled()) return { ...empty(), ranking, segments }
        hooks.onStep?.('Above-the-fold-Map wird gezeichnet', 0.6)
        await yieldToUi()
        const foldShare = analysis.plan.sections[0].height / data.height
        const foldHeight = Math.max(1, Math.round(foldShare * output.height))
        const foldCanvas = renderHeatmap(bitmap, analysis.aboveFold, output.width, foldHeight, {
          opacity,
          // Crop the screenshot to the first section instead of squashing the
          // whole page into a shorter canvas.
          sourceRect: {
            x: 0,
            y: 0,
            width: bitmap.width,
            height: Math.max(1, Math.round(foldShare * bitmap.height)),
          },
        })
        maps.push({ kind: 'fold', png: await canvasToPngBytes(foldCanvas) })
      }
    }

    // Order of the pushes is the order the frames end up in on the canvas
    // (FR-8) — Heatmap, Focusmap, Contrastmap, Clickmap, mirroring the panel.
    if (settings.maps.focus) {
      if (cancelled()) return { ...empty(), ranking, segments }
      hooks.onStep?.('Focusmap wird gezeichnet', 0.7)
      await yieldToUi()
      const canvas = renderFocusmap(bitmap, attention, output.width, output.height, foldOptions)
      maps.push({ kind: 'focus', png: await canvasToPngBytes(canvas) })
    }

    // Contrastmap. Sie hängt an nichts, was die Vorhersage produziert: weder an
    // der Aufmerksamkeitskarte noch an Folds, Abschnitten oder Kandidaten. Sie
    // braucht die gerenderten Pixel und den Layer-Baum, und beide liegen hier
    // ohnehin schon vor.
    // Auf der **vollen** Auflösung, nicht auf `source`: das Analysebild ist auf
    // 1024 px Breite gedeckelt, und zwischen den Glyphen wäre danach kein
    // reiner Hintergrund mehr übrig. Siehe `ENGINE_CONFIG.contrastSource`.
    const contrastSize = fitWithin(
      bitmap.width,
      bitmap.height,
      Math.min(
        ENGINE_CONFIG.contrastSource.maxEdge,
        Math.floor(Math.sqrt((ENGINE_CONFIG.contrastSource.maxPixels * Math.max(bitmap.width, bitmap.height)) / Math.min(bitmap.width, bitmap.height))),
      ),
    )
    const contrastPixels = canvasImageOps.fromImageBitmap(bitmap, contrastSize.width, contrastSize.height)
    const contrast = measureContrast({
      image: { width: contrastPixels.width, height: contrastPixels.height, data: contrastPixels.data },
      signals: data.signals,
      frameWidth: data.width,
      frameHeight: data.height,
    })
    const contrastFindings: ContrastFinding[] = contrast.results.map((result) => ({
      nodeId: result.nodeId,
      status: result.status,
      text: contrastFindingText(result),
      ratio: result.ratio,
      required: result.required,
      approximate: result.approximate,
    }))
    if (contrast.skipped.length > 0) {
      // Nicht verschweigen: eine Messung, die Elemente auslässt, sagt „in
      // Ordnung", wo sie „ich weiß es nicht" meint.
      warnings.push(
        `Contrastmap: ${contrast.skipped.length} Textelement(e) nicht messbar ` +
          `(${[...new Set(contrast.skipped.map((entry) => entry.reason))].join('; ')}).`,
      )
    }

    // WCAG 1.4.11, auf denselben Pixeln. Getrennt gehalten, weil hier eine
    // Einschätzung drinsteckt („ist das eine Komponente?") und in 1.4.3 nicht.
    const nonText = measureNonTextContrast({
      image: { width: contrastPixels.width, height: contrastPixels.height, data: contrastPixels.data },
      signals: data.signals,
      frameWidth: data.width,
      frameHeight: data.height,
    })
    const nonTextFindings: ContrastFinding[] = reportableNonText(nonText.results).map((result) => ({
      nodeId: result.nodeId,
      status: result.status,
      text: nonTextFindingText(result),
      ratio: result.ratio,
      required: result.required,
      approximate: result.approximate,
    }))

    if (settings.maps.contrast) {
      if (cancelled()) return { ...empty(), ranking, segments }
      hooks.onStep?.('Contrastmap wird gezeichnet', 0.8)
      await yieldToUi()
      const canvas = renderContrastmap(bitmap, contrast.results, output.width, output.height, data.width, data.height)
      maps.push({ kind: 'contrast', png: await canvasToPngBytes(canvas) })
    }

    // Candidate detection runs unconditionally: `cta-rank` and `cta-below-fold`
    // are derived from it, so hiding the clickmap must not silently disable two
    // findings rules. Only the drawing is behind the flag.
    candidates = scoreCandidates(data.signals, attention, data.width, data.height)

    if (CLICKMAP_IN_PANEL && settings.maps.click) {
      if (cancelled()) return { ...empty(), ranking, segments }
      hooks.onStep?.('Clickmap wird gezeichnet', 0.85)
      await yieldToUi()
      if (candidates.length === 0) {
        warnings.push(
          'Keine interaktiven Elemente erkannt — benenne Buttons oder setze Prototype-Interaktionen. Clickmap übersprungen.',
        )
      } else {
        ranking = toRanking(candidates, data.signals, data.height)
        const canvas = renderClickmap(bitmap, candidates, output.width, output.height, {
          opacity,
          frameWidth: data.width,
          frameHeight: data.height,
          ...foldOptions,
        })
        maps.push({ kind: 'click', png: await canvasToPngBytes(canvas), meta: ranking })
      }
    }

    // Hinweis auf einen Frame ohne eigene Struktur.
    //
    // Steht bei den Warnungen und **nicht** bei den Befunden: ein Befund sagt
    // etwas über den Entwurf, dieser Satz sagt etwas über die Karte. Er ändert
    // an der Karte nichts — die Unterscheidung „inhaltsarm" ist pro Pixel
    // nachweislich unmöglich (siehe `eval/band-gate.ts`), pro Frame ist sie es
    // nicht. Damit steht der Satz genau dort, wo er hingehört: neben dem Bild,
    // nicht im Bild.
    if (Number.isFinite(analysis.contentLevel) && analysis.contentLevel < ENGINE_CONFIG.findings.lowContentLevel) {
      warnings.push(
        'Dieser Frame enthält kaum Inhalt — die Karte zeigt überwiegend die Positionsannahme. ' +
          'Die wiederkehrenden Bänder sind der Ortsprior je Abschnitt, keine Aussage über den Entwurf.',
      )
    }

    hooks.onStep?.('Befunde werden abgeleitet', 0.95)
    // Same function the end-to-end tests exercise — see `findings/derive.ts`.
    const findings = deriveFindings({
      analysis,
      signals: data.signals,
      frameWidth: data.width,
      frameHeight: data.height,
      candidates,
      priorCategory: resolvedPrior,
    })

    hooks.onStep?.('Fertig', 1)
    return { maps, warnings, ranking, findings, contrastFindings, nonTextFindings, segments, mapMeta }
  } finally {
    bitmap.close()
  }
}

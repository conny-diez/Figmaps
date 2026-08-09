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
import type { ClickRanking, FindingPayload, MainToUi, NodeSignal, RenderedMap, SegmentInfo, Settings } from '../messages'
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
  segments: SegmentInfo
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
  const empty = (): PipelineResult => ({ maps, warnings, ranking: [], findings: [], segments: EMPTY_SEGMENTS })

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

    // Two maps of the same screen can differ only in which prior was used, so
    // the choice belongs on the image, not just in the panel.
    const resolvedPrior = settings.uiType === 'auto' ? priorAssetIdFor(data.width, data.height) : settings.uiType
    const priorLabel = `Ortsprior: ${PRIOR_ASSET_LABELS[resolvedPrior]}${settings.uiType === 'auto' ? ' (automatisch)' : ''}`
    // The other half of what decides the result: the profile selects the
    // viewing duration the prior was estimated from (Epic D).
    const durationLabel = `Betrachtungsdauer: ${PROFILE_LABELS[settings.profile]}`
    const footerLabels = {
      priorLabel,
      durationLabel,
      ...(shipsPriorAsset() ? { attribution: PRIOR_ATTRIBUTION_SHORT } : {}),
    }

    let ranking: ClickRanking[] = []
    let candidates: ClickCandidate[] = []

    if (settings.maps.heat) {
      if (cancelled()) return { ...empty(), ranking, segments }
      hooks.onStep?.('Heatmap wird gezeichnet', 0.5)
      await yieldToUi()
      const canvas = renderHeatmap(bitmap, attention, output.width, output.height, { opacity, ...footerLabels, ...foldOptions })
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
          ...footerLabels,
          title: 'Above the Fold — vorhergesagte Aufmerksamkeit',
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
    // (FR-8) — Heatmap, Focusmap, Clickmap, mirroring the panel.
    if (settings.maps.focus) {
      if (cancelled()) return { ...empty(), ranking, segments }
      hooks.onStep?.('Focusmap wird gezeichnet', 0.7)
      await yieldToUi()
      const canvas = renderFocusmap(bitmap, attention, output.width, output.height, {
        threshold: settings.focusThreshold,
        ...footerLabels,
        ...foldOptions,
      })
      maps.push({ kind: 'focus', png: await canvasToPngBytes(canvas) })
    }

    if (settings.maps.click) {
      if (cancelled()) return { ...empty(), ranking, segments }
      hooks.onStep?.('Clickmap wird gezeichnet', 0.85)
      await yieldToUi()
      candidates = scoreCandidates(data.signals, attention, data.width, data.height)
      if (candidates.length === 0) {
        warnings.push(
          'Keine interaktiven Elemente erkannt — benenne Buttons oder setze Prototype-Interaktionen. Clickmap übersprungen.',
        )
      } else {
        ranking = toRanking(candidates, data.signals, data.height)
        const canvas = renderClickmap(bitmap, candidates, output.width, output.height, {
          opacity,
          ...footerLabels,
          frameWidth: data.width,
          frameHeight: data.height,
          ...foldOptions,
        })
        maps.push({ kind: 'click', png: await canvasToPngBytes(canvas), meta: ranking })
      }
    } else {
      // The findings rules need candidates even when the clickmap is off.
      candidates = scoreCandidates(data.signals, attention, data.width, data.height)
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
    return { maps, warnings, ranking, findings, segments }
  } finally {
    bitmap.close()
  }
}

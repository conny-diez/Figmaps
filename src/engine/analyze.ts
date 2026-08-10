/**
 * The single analysis entry point — used by the iframe pipeline *and* by the
 * eval harness (A-1). If these two ever diverge, the harness stops measuring
 * what the plugin ships, which is the one failure mode this iteration exists to
 * prevent.
 *
 * Pure except for the injected `ImageOps`: no canvas, no `figma.*`, no DOM.
 */
import { ENGINE_CONFIG } from './config'
import type { Bitmap, ImageOps } from './ops'
import { analysisSourceSize, cropBitmap, fitWithin } from './ops-pure'
import { composeSections, planSections, sectionSalience, type SegmentPlan, type Section } from './segments'
import type { AttentionEngine, ScalarMap } from './types'
import type { NodeSignal } from '../messages'

export type AnalyzeInput = {
  /** Pixels of the whole frame; any resolution, it is rescaled as needed. */
  source: Bitmap
  signals: readonly NodeSignal[]
  /** Frame size in frame pixels — the coordinate system of `signals`. */
  frameWidth: number
  frameHeight: number
  /** Overrides the derived viewport height (B-1, exposed in the UI). */
  viewportOverride?: number
  /** Set to false to force a single-section analysis (used by the harness). */
  segment?: boolean
}

export type AnalyzeResult = {
  /**
   * Attention over the whole frame, composed from the sections.
   *
   * This is the **only** place the scroll-depth attenuation acts. The section
   * maps below stay untouched, so the hierarchy inside one viewport reads the
   * same however deep it sits.
   */
  attention: ScalarMap
  /**
   * The individual section maps, each normalised in itself and **not**
   * attenuated. `sections[0]` is the above-the-fold map.
   */
  sections: ScalarMap[]
  /** B-2 — the first section on its own. `null` when the frame is not segmented. */
  aboveFold: ScalarMap | null
  plan: SegmentPlan
  /**
   * How concentrated each section's attention is (see `sectionSalience`).
   * Comparable across sections, unlike the peak, which is 1 everywhere.
   */
  sectionSalience: number[]
  /**
   * Per section, the image-analysis term alone — what *this screen* makes
   * salient, before the location prior is added (`AttentionParts.imageTerm`).
   *
   * Empty when the engine does not expose its parts. `findings/rules.ts` →
   * `flat` needs it: on the finished map, which is prior-dominated, an empty
   * frame scores as more "hierarchical" than one with a clear eye-catcher.
   */
  imageTerms: ScalarMap[]
  /**
   * Wie viel **eigene Struktur** dieser Frame hat, als eine Zahl: der
   * flächengewichtete Mittelwert des Bildanalyse-Anteils über alle Abschnitte.
   *
   * Beantwortet die einzige Frage, die der Bildanteil *pro Frame* zuverlässig
   * beantwortet — pro Pixel kann er es nicht (siehe `eval/band-gate.ts`):
   * **hat dieser Frame überhaupt Inhalt?** Auf einer konstanten Fläche ist der
   * Bildanteil exakt null, weil die Perzentil-Normierung dort keinen
   * Wertebereich findet.
   *
   * Sie geht **nicht** in die Vorhersage ein und ändert keine einzige Karte.
   * Sie ist die Grundlage für einen Hinweis im Panel — siehe
   * `ENGINE_CONFIG.findings.lowContentLevel`.
   *
   * `NaN`, wenn die Engine ihre Teile nicht ausweist.
   */
  contentLevel: number
}

export type AnalyzeHooks = {
  /** Called before each section, 1-based — drives "Abschnitt 3 von 7" (B-3). */
  onSection?: (current: number, total: number) => void
  /** Polled between sections; returning true aborts. */
  isCancelled?: () => boolean
}

/** Signals intersecting a section, rebased onto the section's own origin. */
export function signalsForSection(signals: readonly NodeSignal[], section: Section): NodeSignal[] {
  const top = section.y
  const bottom = section.y + section.height
  const out: NodeSignal[] = []
  for (const signal of signals) {
    if (signal.y + signal.height <= top || signal.y >= bottom) continue
    out.push({ ...signal, y: signal.y - top })
  }
  return out
}

/**
 * Prepares the bitmap the sections are cropped out of: bounded on width so a
 * long scroll page keeps enough horizontal resolution (see `analysisSource`).
 */
export function prepareSource(ops: ImageOps, source: Bitmap): Bitmap {
  const cfg = ENGINE_CONFIG.analysisSource
  const size = analysisSourceSize(source.width, source.height, cfg.maxWidth, cfg.maxPixels)
  if (size.width === source.width && size.height === source.height) return source
  return ops.resize(source, size.width, size.height)
}

/**
 * Dimensions of the map an unsegmented frame of this size produces.
 *
 * The eval harness must bring the ground truth onto exactly this grid — the two
 * steps (bound the source width, then fit the analysis edge) do not compose
 * into a single `fitWithin`, and guessing produces an off-by-one that would
 * make CC and KL compare mismatched shapes.
 */
export function analysisGridFor(width: number, height: number): { width: number; height: number } {
  const cfg = ENGINE_CONFIG.analysisSource
  const source = analysisSourceSize(width, height, cfg.maxWidth, cfg.maxPixels)
  return fitWithin(source.width, source.height, ENGINE_CONFIG.analysisEdge)
}

export async function analyzeFrame(
  engine: AttentionEngine,
  ops: ImageOps,
  input: AnalyzeInput,
  hooks: AnalyzeHooks = {},
): Promise<AnalyzeResult | null> {
  const source = prepareSource(ops, input.source)
  const plan =
    input.segment === false
      ? { viewportHeight: input.frameHeight, segmented: false, sections: [{ index: 0, y: 0, height: input.frameHeight }], folds: [] }
      : planSections(input.frameWidth, input.frameHeight, input.viewportOverride)

  const sourceScale = source.height / input.frameHeight
  const parts: Array<{ section: Section; map: ScalarMap; imageTerm: ScalarMap | null }> = []

  // B-3 — strictly sequential. Sections are cheap individually; running them in
  // parallel would blow the iframe's memory on a 6.000 px frame.
  for (const section of plan.sections) {
    if (hooks.isCancelled?.() === true) return null
    hooks.onSection?.(section.index + 1, plan.sections.length)

    const crop =
      plan.sections.length === 1
        ? source
        : cropBitmap(source, {
            x: 0,
            y: section.y * sourceScale,
            width: source.width,
            height: section.height * sourceScale,
          })

    const grid = fitWithin(crop.width, crop.height, ENGINE_CONFIG.analysisEdge)
    const pixels = ops.resize(crop, grid.width, grid.height)

    // `frameHeight` is the *section* height, not the frame's. Consequence: the
    // position prior is rebuilt for every section, so each one gets its own
    // top-heavy bell rather than a slice of one bell spanning the whole frame.
    //
    // That follows Epic B's premise — saliency is relative to the visible
    // cut-out — and it matches how the data prior was estimated, from
    // single-viewport screenshots. It is, however, **inherited from 1.0 rather
    // than chosen**, and it is not covered by any measurement: the whole
    // evaluation runs with `segment: false`, and UEyes contains no scrolled
    // pages to validate it against.
    //
    // It has a visible cost. On content-free areas the composed map shows a
    // band at the top of every section, one section step apart; see
    // `__tests__/analyze.test.ts` → "prior repeats per section". hybrid-v1
    // amplifies this because there the prior is the base of the prediction,
    // whereas in heuristic-v1 it was one weighted term among seven.
    const request = {
      pixels,
      signals: signalsForSection(input.signals, section),
      frameWidth: input.frameWidth,
      frameHeight: section.height,
    }
    // One call, not two: `predictParts` recomputes nothing the prediction does
    // not already compute, and calling both would double the cost per section.
    const result = engine.predictParts
      ? await engine.predictParts(request)
      : { attention: await engine.predict(request), imageTerm: null }

    parts.push({
      section,
      map: { width: pixels.width, height: pixels.height, values: result.attention },
      imageTerm: result.imageTerm
        ? { width: pixels.width, height: pixels.height, values: result.imageTerm }
        : null,
    })
  }

  return {
    // Attenuation lives here and nowhere else.
    attention: composeSections(parts, input.frameHeight),
    sections: parts.map((part) => part.map),
    aboveFold: plan.segmented ? parts[0].map : null,
    plan,
    sectionSalience: parts.map((part) => sectionSalience(part.map)),
    imageTerms: parts.every((part) => part.imageTerm !== null)
      ? parts.map((part) => part.imageTerm as ScalarMap)
      : [],
    // Flächengewichtet, damit ein kurzer letzter Abschnitt nicht so viel zählt
    // wie ein voller. Ein Mittelwert von Mittelwerten — die Komposition wird
    // dafür nicht gebraucht, und sie wäre auf jedem Lauf des Plugins teuer.
    contentLevel: meanOfImageTerms(parts),
  }
}

/** Flächengewichteter Mittelwert der Abschnitts-Bildanteile. */
function meanOfImageTerms(parts: ReadonlyArray<{ imageTerm: ScalarMap | null }>): number {
  let sum = 0
  let count = 0
  for (const part of parts) {
    if (!part.imageTerm) return Number.NaN
    for (const value of part.imageTerm.values) sum += value
    count += part.imageTerm.values.length
  }
  return count > 0 ? sum / count : Number.NaN
}

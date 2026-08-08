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
import { composeSections, peakOfSection, planSections, type SegmentPlan, type Section } from './segments'
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
  /** Attention over the whole frame; composed from the sections when segmented. */
  attention: ScalarMap
  /** B-2 — the first section on its own. `null` when the frame is not segmented. */
  aboveFold: ScalarMap | null
  plan: SegmentPlan
  /** Peak intensity per section, in section order. */
  sectionPeaks: number[]
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
  const parts: Array<{ section: Section; map: ScalarMap }> = []

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

    const values = await engine.predict({
      pixels,
      signals: signalsForSection(input.signals, section),
      frameWidth: input.frameWidth,
      frameHeight: section.height,
    })

    parts.push({ section, map: { width: pixels.width, height: pixels.height, values } })
  }

  return {
    attention: composeSections(parts, input.frameHeight),
    aboveFold: plan.segmented ? parts[0].map : null,
    plan,
    sectionPeaks: parts.map((part) => peakOfSection(part.map)),
  }
}

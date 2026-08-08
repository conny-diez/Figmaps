/**
 * Epic B — viewport-aware analysis.
 *
 * A single map over a 3.000 px tall frame averages a state no user ever sees.
 * Saliency is relative to the visible cut-out, so anything taller than
 * `segmentThreshold` viewports is analysed section by section and only then
 * reassembled.
 *
 * Pure geometry and array arithmetic — no canvas, no `figma.*`.
 */
import { ENGINE_CONFIG } from './config'
import type { ScalarMap } from './types'

export type Section = {
  index: number
  /** Top edge in frame pixels. */
  y: number
  /** Height in frame pixels — one viewport, except for an unsegmented frame. */
  height: number
}

export type SegmentPlan = {
  /** Derived visible height in frame pixels. */
  viewportHeight: number
  /** False when the frame is short enough to be treated as a whole. */
  segmented: boolean
  sections: Section[]
  /** Fold boundaries in frame pixels, ascending, without 0 and the bottom edge. */
  folds: number[]
}

type ViewportConfig = typeof ENGINE_CONFIG.viewport

/**
 * B-1 — desktop frames get a fixed 900 px viewport, narrower frames are treated
 * as mobile and get `width x 2` (roughly a 19.5:9 phone in portrait).
 */
export function viewportHeightFor(frameWidth: number, cfg: ViewportConfig = ENGINE_CONFIG.viewport): number {
  const height = frameWidth >= cfg.desktopMinWidth ? cfg.desktopHeight : frameWidth * cfg.mobileHeightFactor
  return Math.max(1, Math.round(height))
}

/**
 * B-1 — cuts the frame into one-viewport sections with `overlap` overlap, so an
 * element sitting on a cut line is fully contained in at least one section.
 *
 * The last section is shifted up to end exactly at the frame bottom rather than
 * being truncated: every section is a real viewport, which is the whole point.
 */
export function planSections(
  frameWidth: number,
  frameHeight: number,
  viewportOverride?: number,
  cfg: ViewportConfig = ENGINE_CONFIG.viewport,
): SegmentPlan {
  const viewportHeight = Math.max(1, Math.round(viewportOverride ?? viewportHeightFor(frameWidth, cfg)))

  if (frameHeight <= viewportHeight * cfg.segmentThreshold) {
    return {
      viewportHeight,
      segmented: false,
      sections: [{ index: 0, y: 0, height: frameHeight }],
      folds: [],
    }
  }

  const step = Math.max(1, viewportHeight * (1 - cfg.overlap))
  const lastTop = frameHeight - viewportHeight
  const sections: Section[] = []

  for (let y = 0; y < lastTop && sections.length < cfg.maxSections - 1; y += step) {
    sections.push({ index: sections.length, y, height: viewportHeight })
  }
  sections.push({ index: sections.length, y: lastTop, height: viewportHeight })

  const folds: number[] = []
  for (let fold = viewportHeight; fold < frameHeight; fold += viewportHeight) folds.push(fold)

  return { viewportHeight, segmented: true, sections, folds }
}

/**
 * B-2 — reassembles the section maps into one map over the whole frame,
 * cross-fading linearly across each overlap so no seam is visible.
 *
 * Each section is normalised on its own (that is the point of Epic B), so the
 * composite is a stack of locally scaled maps — not a global ranking.
 */
export function composeSections(
  parts: ReadonlyArray<{ section: Section; map: ScalarMap }>,
  frameHeight: number,
): ScalarMap {
  if (parts.length === 0) throw new Error('composeSections: keine Abschnitte')
  if (parts.length === 1) return parts[0].map

  const width = parts[0].map.width
  const scale = parts[0].map.height / parts[0].section.height
  const height = Math.max(1, Math.round(frameHeight * scale))

  const acc = new Float64Array(width * height)
  const weightSum = new Float64Array(height)

  for (let i = 0; i < parts.length; i++) {
    const { section, map } = parts[i]
    const top = Math.round(section.y * scale)

    // Fade lengths follow the *actual* overlap with the neighbours — the last
    // section is shifted up and therefore usually overlaps more than 20 %.
    const prev = parts[i - 1]
    const next = parts[i + 1]
    const fadeIn = prev ? Math.max(1, (prev.section.y + prev.section.height - section.y) * scale) : 0
    const fadeOut = next ? Math.max(1, (section.y + section.height - next.section.y) * scale) : 0

    for (let row = 0; row < map.height; row++) {
      const target = top + row
      if (target < 0 || target >= height) continue

      let weight = 1
      if (fadeIn > 0) weight = Math.min(weight, (row + 0.5) / fadeIn)
      if (fadeOut > 0) weight = Math.min(weight, (map.height - row - 0.5) / fadeOut)
      if (weight <= 0) weight = 1e-6

      const from = row * width
      const to = target * width
      for (let x = 0; x < width; x++) acc[to + x] += map.values[from + x] * weight
      weightSum[target] += weight
    }
  }

  const values = new Float32Array(width * height)
  for (let y = 0; y < height; y++) {
    const w = weightSum[y]
    if (w <= 0) continue
    const row = y * width
    for (let x = 0; x < width; x++) values[row + x] = acc[row + x] / w
  }

  return { width, height, values }
}

/** Mean value of one image row band — used by the `cold-fold` finding. */
export function peakOfSection(map: ScalarMap): number {
  let peak = 0
  for (let i = 0; i < map.values.length; i++) if (map.values[i] > peak) peak = map.values[i]
  return peak
}

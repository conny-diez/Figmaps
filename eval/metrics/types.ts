/**
 * A-3 — shared shapes of the metric layer.
 *
 * Every metric works on the *analysis grid*: prediction and ground truth are
 * resampled to identical dimensions before a metric ever sees them.
 *
 * The two ground-truth channels are kept strictly apart, because mixing them
 * changes the numbers without changing anything visible:
 *
 *   AUC-Judd, NSS  ->  `fixations`, discrete points from the fixation map
 *   CC, KL         ->  `salience`,  the continuous heatmap
 *
 * Deriving "fixations" by thresholding the heatmap is a fallback for data sets
 * that ship no fixation maps. It is not equivalent, so `fixationSource` records
 * which of the two happened and the report says so out loud.
 */
import type { Bitmap } from '../../src/engine/ops'
import type { ScalarMap } from '../../src/engine/types'

export type FixationSource = 'measured' | 'derived-from-heatmap'

export type GroundTruth = {
  /** Continuous ground-truth saliency map, values in `[0,1]`. For CC and KL. */
  salience: ScalarMap
  /** Row-major indices of discrete fixation locations. For AUC-Judd and NSS. */
  fixations: number[]
  fixationSource: FixationSource
}

export type MetricId = 'aucJudd' | 'cc' | 'nss' | 'kl'

export const METRIC_IDS: readonly MetricId[] = ['aucJudd', 'cc', 'nss', 'kl']

export const METRIC_LABELS: Record<MetricId, string> = {
  aucJudd: 'AUC-Judd',
  cc: 'CC',
  nss: 'NSS',
  kl: 'KL',
}

/** Which ground-truth channel each metric is scored against. */
export const METRIC_TRUTH: Record<MetricId, 'fixations' | 'salience'> = {
  aucJudd: 'fixations',
  cc: 'salience',
  nss: 'fixations',
  kl: 'salience',
}

/** `+1` = higher is better, `-1` = lower is better. */
export const METRIC_DIRECTION: Record<MetricId, 1 | -1> = {
  aucJudd: 1,
  cc: 1,
  nss: 1,
  kl: -1,
}

export type MetricScores = Record<MetricId, number>

export function assertSameShape(a: ScalarMap, b: ScalarMap): void {
  if (a.width !== b.width || a.height !== b.height) {
    throw new Error(`Maps haben unterschiedliche Größen: ${a.width}x${a.height} vs ${b.width}x${b.height}`)
  }
}

/**
 * Maps a binary fixation map onto the analysis grid.
 *
 * Max pooling, never averaging: a fixation map is a set of locations, not an
 * intensity field. Area-averaging it would produce grey values that then need a
 * threshold, and that threshold would silently decide how many fixations the
 * metrics see. Here a grid cell counts as fixated exactly when any source pixel
 * inside it was.
 */
export function fixationsFromMask(mask: Bitmap, gridWidth: number, gridHeight: number, threshold = 127): number[] {
  const cells = new Set<number>()
  for (let y = 0; y < mask.height; y++) {
    const gy = Math.min(gridHeight - 1, Math.floor((y * gridHeight) / mask.height))
    const row = y * mask.width * 4
    for (let x = 0; x < mask.width; x++) {
      if (mask.data[row + x * 4] <= threshold) continue
      const gx = Math.min(gridWidth - 1, Math.floor((x * gridWidth) / mask.width))
      cells.add(gy * gridWidth + gx)
    }
  }
  return [...cells].sort((a, b) => a - b)
}

/**
 * Fallback for data sets without fixation maps: the `count` strongest pixels of
 * the continuous map, ties resolved by index so the result is stable.
 *
 * Produces `fixationSource: 'derived-from-heatmap'` — AUC and NSS computed this
 * way measure agreement with a thresholded version of the same map that CC
 * already scores, and are not comparable to published numbers.
 */
export function fixationsFromMap(map: ScalarMap, count: number): number[] {
  const indices = Array.from({ length: map.values.length }, (_, i) => i)
  indices.sort((a, b) => map.values[b] - map.values[a] || a - b)
  return indices.slice(0, Math.max(1, Math.min(count, indices.length))).sort((a, b) => a - b)
}

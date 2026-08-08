/**
 * A-3 — shared shapes of the metric layer.
 *
 * Every metric works on the *analysis grid*: prediction and ground truth are
 * resampled to identical dimensions before a metric ever sees them.
 */
import type { ScalarMap } from '../../src/engine/types'

export type GroundTruth = {
  /** Continuous ground-truth saliency map, values in `[0,1]`. */
  salience: ScalarMap
  /** Row-major indices of discrete fixation locations. */
  fixations: number[]
}

export type MetricId = 'aucJudd' | 'cc' | 'nss' | 'kl'

export const METRIC_IDS: readonly MetricId[] = ['aucJudd', 'cc', 'nss', 'kl']

export const METRIC_LABELS: Record<MetricId, string> = {
  aucJudd: 'AUC-Judd',
  cc: 'CC',
  nss: 'NSS',
  kl: 'KL',
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
 * Derives discrete fixation points from a continuous ground-truth map: the
 * `count` strongest pixels, ties resolved by index so the result is stable.
 *
 * Used when a dataset only ships blurred saliency maps and no raw fixations.
 */
export function fixationsFromMap(map: ScalarMap, count: number): number[] {
  const indices = Array.from({ length: map.values.length }, (_, i) => i)
  indices.sort((a, b) => map.values[b] - map.values[a] || a - b)
  return indices.slice(0, Math.max(1, Math.min(count, indices.length))).sort((a, b) => a - b)
}

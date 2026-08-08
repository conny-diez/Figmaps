/**
 * A-3 — NSS: the mean of the z-normalised prediction at the fixation points.
 *
 * 0 means the fixations land on average-salience pixels (chance), positive
 * values mean the prediction is elevated where people looked. Unlike CC it uses
 * discrete fixations, so it is sensitive to *where* rather than to the overall
 * shape.
 */
import type { ScalarMap } from '../../src/engine/types'

export function normalizedScanpathSaliency(prediction: ScalarMap, fixations: readonly number[]): number {
  if (fixations.length === 0) return Number.NaN
  const values = prediction.values
  const n = values.length

  let mean = 0
  for (let i = 0; i < n; i++) mean += values[i]
  mean /= n

  let variance = 0
  for (let i = 0; i < n; i++) {
    const d = values[i] - mean
    variance += d * d
  }
  // Population standard deviation — the saliency literature does not apply
  // Bessel's correction here.
  const sd = Math.sqrt(variance / n)
  if (!(sd > 1e-12)) return 0

  let sum = 0
  for (const index of fixations) sum += (values[index] - mean) / sd
  return sum / fixations.length
}

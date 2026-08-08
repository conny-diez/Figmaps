/**
 * A-3 — CC, the Pearson correlation between the predicted and the measured
 * saliency map. Invariant to linear rescaling, so it compares *shape* rather
 * than absolute intensity. Range `[-1, 1]`, higher is better.
 */
import type { ScalarMap } from '../../src/engine/types'
import { assertSameShape } from './types'

export function correlationCoefficient(prediction: ScalarMap, truth: ScalarMap): number {
  assertSameShape(prediction, truth)
  const n = prediction.values.length
  if (n === 0) return Number.NaN

  let meanA = 0
  let meanB = 0
  for (let i = 0; i < n; i++) {
    meanA += prediction.values[i]
    meanB += truth.values[i]
  }
  meanA /= n
  meanB /= n

  let covariance = 0
  let varianceA = 0
  let varianceB = 0
  for (let i = 0; i < n; i++) {
    const da = prediction.values[i] - meanA
    const db = truth.values[i] - meanB
    covariance += da * db
    varianceA += da * da
    varianceB += db * db
  }

  const denominator = Math.sqrt(varianceA * varianceB)
  // A constant map has no variance and therefore no correlation to report.
  if (!(denominator > 1e-12)) return 0
  return covariance / denominator
}

/**
 * A-3 — AUC-Judd.
 *
 * Discrimination between fixated and non-fixated pixels: the saliency values at
 * the fixation points are used as successive thresholds; each yields one point
 * on a ROC curve whose area is the score. 0.5 is chance, 1.0 is perfect.
 *
 * Follows Judd et al. / the MIT saliency benchmark implementation, including
 * its handling of ties (a tie between a fixated and a non-fixated pixel costs
 * score, which is intended — a map that cannot separate them has not).
 */
import { normalize01 } from '../../src/engine/imageops'
import type { ScalarMap } from '../../src/engine/types'

/** Trapezoidal area under the curve given by the point sequence. */
function trapezoid(x: readonly number[], y: readonly number[]): number {
  let area = 0
  for (let i = 1; i < x.length; i++) area += ((x[i] - x[i - 1]) * (y[i] + y[i - 1])) / 2
  return area
}

export function aucJudd(prediction: ScalarMap, fixations: readonly number[]): number {
  if (fixations.length === 0) return Number.NaN

  const values = normalize01(prediction.values)
  const pixels = values.length
  const fixationCount = fixations.length
  if (pixels <= fixationCount) return Number.NaN

  // A constant map cannot discriminate — that is exactly chance, and saying so
  // explicitly keeps the `uniform` baseline from producing a nonsense number.
  let constant = true
  for (let i = 1; i < pixels; i++) {
    if (values[i] !== values[0]) {
      constant = false
      break
    }
  }
  if (constant) return 0.5

  const atFixations = fixations.map((index) => values[index]).sort((a, b) => b - a)
  const sortedDesc = Float32Array.from(values).sort()
  sortedDesc.reverse()

  const tp: number[] = [0]
  const fp: number[] = [0]

  // One sweep through the descending pixel list instead of a full scan per
  // threshold — O(n log n) rather than O(n * fixations).
  let above = 0
  for (let i = 0; i < atFixations.length; i++) {
    const threshold = atFixations[i]
    while (above < pixels && sortedDesc[above] >= threshold) above++
    tp.push((i + 1) / fixationCount)
    fp.push((above - (i + 1)) / (pixels - fixationCount))
  }
  tp.push(1)
  fp.push(1)

  return trapezoid(fp, tp)
}

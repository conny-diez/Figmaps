/**
 * A-3 — KL divergence between the measured and the predicted distribution,
 * `KL(truth || prediction)`. Both maps are turned into probability
 * distributions first. Lower is better; 0 means identical distributions.
 *
 * KL punishes a prediction that assigns near-zero mass where the ground truth
 * has mass, which is why it is reported next to CC rather than instead of it.
 */
import type { ScalarMap } from '../../src/engine/types'
import { assertSameShape } from './types'

const EPS = 2.2204e-16

function toDistribution(values: Float32Array): Float64Array {
  const out = new Float64Array(values.length)
  let sum = 0
  for (let i = 0; i < values.length; i++) {
    const v = values[i] > 0 ? values[i] : 0
    out[i] = v
    sum += v
  }
  if (!(sum > 0)) {
    out.fill(1 / values.length)
    return out
  }
  for (let i = 0; i < out.length; i++) out[i] /= sum
  return out
}

export function klDivergence(prediction: ScalarMap, truth: ScalarMap): number {
  assertSameShape(prediction, truth)
  const p = toDistribution(prediction.values)
  const q = toDistribution(truth.values)

  let sum = 0
  for (let i = 0; i < q.length; i++) {
    if (q[i] <= 0) continue
    sum += q[i] * Math.log(EPS + q[i] / (EPS + p[i]))
  }
  return sum
}

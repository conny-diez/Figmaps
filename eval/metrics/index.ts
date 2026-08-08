/**
 * A-3 — the four metrics of the harness, applied together.
 */
import type { ScalarMap } from '../../src/engine/types'
import { aucJudd } from './auc'
import { correlationCoefficient } from './cc'
import { klDivergence } from './kl'
import { normalizedScanpathSaliency } from './nss'
import type { GroundTruth, MetricScores } from './types'

export function scoreAll(prediction: ScalarMap, truth: GroundTruth): MetricScores {
  return {
    aucJudd: aucJudd(prediction, truth.fixations),
    cc: correlationCoefficient(prediction, truth.salience),
    nss: normalizedScanpathSaliency(prediction, truth.fixations),
    kl: klDivergence(prediction, truth.salience),
  }
}

/** Element-wise mean over a list of score sets, ignoring `NaN`. */
export function meanScores(all: readonly MetricScores[]): MetricScores {
  const keys = ['aucJudd', 'cc', 'nss', 'kl'] as const
  const out = {} as MetricScores
  for (const key of keys) {
    let sum = 0
    let count = 0
    for (const scores of all) {
      if (Number.isFinite(scores[key])) {
        sum += scores[key]
        count++
      }
    }
    out[key] = count === 0 ? Number.NaN : sum / count
  }
  return out
}

export { aucJudd } from './auc'
export { correlationCoefficient } from './cc'
export { klDivergence } from './kl'
export { normalizedScanpathSaliency } from './nss'
export * from './types'

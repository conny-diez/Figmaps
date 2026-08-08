/**
 * A-5 — running every predictor over every sample and collecting the scores.
 */
import type { ImageOps } from '../src/engine/ops'
import type { ScalarMap } from '../src/engine/types'
import { nodeImageOps } from '../src/platform/imageops-node'
import type { EvalSample } from './dataset'
import { meanScores, scoreAll } from './metrics'
import type { MetricScores } from './metrics/types'
import type { Predictor } from './predictors'

export type SampleResult = {
  sampleId: string
  scores: MetricScores
}

export type PredictorResult = {
  predictor: Predictor
  mean: MetricScores
  perSample: SampleResult[]
}

export type RunResult = {
  results: PredictorResult[]
  samples: EvalSample[]
  /** Predictions of the primary (non-baseline) engine, kept for the contact sheet. */
  primaryPredictions: Map<string, ScalarMap>
}

export type RunOptions = {
  ops?: ImageOps
  onProgress?: (done: number, total: number, label: string) => void
  /** Keep predictions of this predictor id in memory for the contact sheet. */
  keepPredictionsFor?: string
}

export async function runEvaluation(
  samples: readonly EvalSample[],
  predictors: readonly Predictor[],
  options: RunOptions = {},
): Promise<RunResult> {
  const ops = options.ops ?? nodeImageOps
  const results: PredictorResult[] = []
  const primaryPredictions = new Map<string, ScalarMap>()

  const total = samples.length * predictors.length
  let done = 0

  for (const predictor of predictors) {
    const perSample: SampleResult[] = []
    for (const sample of samples) {
      const prediction = await predictor.predict(sample, ops)
      perSample.push({ sampleId: sample.id, scores: scoreAll(prediction, sample.truth) })
      if (options.keepPredictionsFor === predictor.id) primaryPredictions.set(sample.id, prediction)
      done++
      options.onProgress?.(done, total, `${predictor.id} · ${sample.id}`)
    }
    results.push({ predictor, mean: meanScores(perSample.map((entry) => entry.scores)), perSample })
  }

  return { results, samples: [...samples], primaryPredictions }
}

/** The `count` samples the given predictor did worst on, by CC (A-5). */
export function worstCases(result: PredictorResult, count: number): SampleResult[] {
  return [...result.perSample]
    .filter((entry) => Number.isFinite(entry.scores.cc))
    .sort((a, b) => a.scores.cc - b.scores.cc || (a.sampleId < b.sampleId ? -1 : 1))
    .slice(0, count)
}

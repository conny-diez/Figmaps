/**
 * A-5 — running every predictor over every sample and collecting the scores.
 */
import type { ImageOps } from '../src/engine/ops'
import type { ScalarMap } from '../src/engine/types'
import { nodeImageOps } from '../src/platform/imageops-node'
import type { EvalSample } from './dataset'
import { meanScores, scoreAll } from './metrics'
import { METRIC_DIRECTION, METRIC_IDS, type MetricScores } from './metrics/types'
import { centerBiasMap, type Predictor } from './predictors'

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

/**
 * Where a map puts its mass, in normalised coordinates with (0,0) top-left.
 *
 * UEyes' central finding is that location bias differs between UI types, so the
 * report states it per set instead of leaving it to be inferred from CC.
 */
export type SpatialProfile = {
  /** Centre of mass. */
  centerX: number
  centerY: number
  /** Standard deviation of the mass around the centre — how spread out it is. */
  spreadX: number
  spreadY: number
  /** Share of the total mass in the top third of the image. */
  topThird: number
}

export function spatialProfile(map: ScalarMap): SpatialProfile {
  let total = 0
  let sumX = 0
  let sumY = 0
  let top = 0

  for (let y = 0; y < map.height; y++) {
    const ny = (y + 0.5) / map.height
    for (let x = 0; x < map.width; x++) {
      const value = map.values[y * map.width + x]
      if (!(value > 0)) continue
      total += value
      sumX += value * ((x + 0.5) / map.width)
      sumY += value * ny
      if (ny < 1 / 3) top += value
    }
  }
  if (!(total > 0)) return { centerX: 0.5, centerY: 0.5, spreadX: 0, spreadY: 0, topThird: 0 }

  const centerX = sumX / total
  const centerY = sumY / total

  let varX = 0
  let varY = 0
  for (let y = 0; y < map.height; y++) {
    const ny = (y + 0.5) / map.height
    for (let x = 0; x < map.width; x++) {
      const value = map.values[y * map.width + x]
      if (!(value > 0)) continue
      const dx = (x + 0.5) / map.width - centerX
      const dy = ny - centerY
      varX += value * dx * dx
      varY += value * dy * dy
    }
  }

  return {
    centerX,
    centerY,
    spreadX: Math.sqrt(varX / total),
    spreadY: Math.sqrt(varY / total),
    topThird: top / total,
  }
}

export function meanProfile(profiles: readonly SpatialProfile[]): SpatialProfile {
  if (profiles.length === 0) return { centerX: 0.5, centerY: 0.5, spreadX: 0, spreadY: 0, topThird: 0 }
  const keys: Array<keyof SpatialProfile> = ['centerX', 'centerY', 'spreadX', 'spreadY', 'topThird']
  const out = {} as SpatialProfile
  for (const key of keys) {
    out[key] = profiles.reduce((sum, profile) => sum + profile[key], 0) / profiles.length
  }
  return out
}

export type SigmaSweepEntry = { sigma: number; mean: MetricScores }

/**
 * Scores the center-bias baseline at several widths, so the S-2 verdict can be
 * stated against the strongest form of the baseline rather than a convenient
 * one. Cheap: the baseline does no image analysis.
 */
export function sweepCenterBias(samples: readonly EvalSample[], sigmas: readonly number[]): SigmaSweepEntry[] {
  return sigmas.map((sigma) => ({
    sigma,
    mean: meanScores(samples.map((sample) => scoreAll(centerBiasMap(sample.grid.width, sample.grid.height, sigma), sample.truth))),
  }))
}

/** Best value per metric across the sweep — the hardest baseline to beat. */
export function bestOfSweep(sweep: readonly SigmaSweepEntry[]): MetricScores {
  const out = {} as MetricScores
  for (const id of METRIC_IDS) {
    let best = Number.NaN
    for (const entry of sweep) {
      const value = entry.mean[id]
      if (!Number.isFinite(value)) continue
      if (!Number.isFinite(best) || (value - best) * METRIC_DIRECTION[id] > 0) best = value
    }
    out[id] = best
  }
  return out
}

/** The `count` samples the given predictor did worst on, by CC (A-5). */
export function worstCases(result: PredictorResult, count: number): SampleResult[] {
  return [...result.perSample]
    .filter((entry) => Number.isFinite(entry.scores.cc))
    .sort((a, b) => a.scores.cc - b.scores.cc || (a.sampleId < b.sampleId ? -1 : 1))
    .slice(0, count)
}

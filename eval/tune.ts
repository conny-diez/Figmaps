/**
 * A-6 — random search over the engine weights.
 *
 * Optimises on the **tuning** split and never touches the test split; the
 * report is produced separately by `npm run eval -- --set test`. The outcome is
 * written to `src/engine/tuned.ts` as an additional named configuration — the
 * shipped one stays untouched. There is no auto-deploy: a human looks at the
 * contact sheet and then flips `ENGINE_CONFIG.activeConfigId` by hand (A-6).
 *
 * The search is cheap because the seven feature maps do not depend on the
 * weights: they are computed once per sample and only the weighted sum and the
 * post-processing are repeated per candidate.
 */
import { correlationCoefficient } from './metrics/cc'
import { combineFeatures, HeuristicAttentionEngine } from '../src/engine/heuristic'
import { positionPrior } from '../src/engine/features/prior'
import { fitWithin } from '../src/engine/ops-pure'
import { ENGINE_CONFIG } from '../src/engine/config'
import {
  cloneParams,
  DEFAULT_PROFILE,
  PROFILE_IDS,
  resolveParams,
  type EngineParams,
  type FeatureWeights,
  type ProfileId,
} from '../src/engine/params'
import type { FeatureMaps, ScalarMap } from '../src/engine/types'
import { nodeImageOps } from '../src/platform/imageops-node'
import type { EvalSample } from './dataset'

const WEIGHT_KEYS: Array<keyof FeatureWeights> = [
  'luminanceContrast',
  'colorOpponency',
  'edgeDensity',
  'textSalience',
  'interactiveSalience',
  'imageSalience',
  'positionPrior',
]

/** Deterministic PRNG — the search must be reproducible from the seed alone. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

type Prepared = {
  sample: EvalSample
  features: FeatureMaps
  width: number
  height: number
}

/** Runs the feature stage once per sample; the search reuses the result. */
export async function prepareSamples(samples: readonly EvalSample[], profile: ProfileId): Promise<Prepared[]> {
  const engine = new HeuristicAttentionEngine({ profile })
  const prepared: Prepared[] = []

  for (const sample of samples) {
    const grid = fitWithin(sample.image.width, sample.image.height, ENGINE_CONFIG.analysisEdge)
    const pixels = nodeImageOps.resize(sample.image, grid.width, grid.height)
    const features = await engine.computeFeatures({
      pixels,
      signals: sample.signals,
      frameWidth: sample.frameWidth,
      frameHeight: sample.frameHeight,
    })
    prepared.push({ sample, features, width: grid.width, height: grid.height })
  }
  return prepared
}

function scoreParams(prepared: readonly Prepared[], params: EngineParams, tunePrior: boolean): number {
  let sum = 0
  let count = 0

  for (const entry of prepared) {
    const features = tunePrior
      ? { ...entry.features, positionPrior: positionPrior(entry.width, entry.height, params.prior) }
      : entry.features
    const values = combineFeatures(features, entry.width, entry.height, params)
    const prediction: ScalarMap = { width: entry.width, height: entry.height, values }
    const cc = correlationCoefficient(prediction, entry.sample.truth.salience)
    if (Number.isFinite(cc)) {
      sum += cc
      count++
    }
  }
  return count === 0 ? Number.NEGATIVE_INFINITY : sum / count
}

/** Random weight vector on the simplex, plus optional prior/post jitter. */
function sampleCandidate(base: EngineParams, random: () => number, tunePrior: boolean): EngineParams {
  const raw = WEIGHT_KEYS.map(() => random())
  const total = raw.reduce((sum, value) => sum + value, 0) || 1

  const weights = {} as FeatureWeights
  WEIGHT_KEYS.forEach((key, index) => {
    weights[key] = raw[index] / total
  })

  const candidate = cloneParams(base)
  candidate.weights = weights

  if (tunePrior) {
    const jitter = (value: number, spread: number, min: number, max: number): number =>
      Math.min(max, Math.max(min, value + (random() * 2 - 1) * spread))
    candidate.prior = {
      ...base.prior,
      centerX: jitter(base.prior.centerX, 0.15, 0.15, 0.85),
      centerY: jitter(base.prior.centerY, 0.15, 0.1, 0.7),
      sigmaLeft: jitter(base.prior.sigmaLeft, 0.2, 0.1, 0.9),
      sigmaRight: jitter(base.prior.sigmaRight, 0.2, 0.1, 0.9),
      sigmaUp: jitter(base.prior.sigmaUp, 0.2, 0.1, 0.9),
      sigmaDown: jitter(base.prior.sigmaDown, 0.2, 0.1, 0.9),
    }
    candidate.post = { ...base.post, gamma: jitter(base.post.gamma, 0.4, 0.4, 1.6) }
  }

  return candidate
}

export type TuneOptions = {
  iterations?: number
  seed?: number
  /** Also search over the position prior and gamma, not just the weights. */
  tunePrior?: boolean
  onProgress?: (iteration: number, total: number, best: number) => void
}

export type TuneOutcome = {
  profile: ProfileId
  baselineCc: number
  bestCc: number
  params: EngineParams
  iterations: number
  seed: number
}

export async function tuneProfile(
  samples: readonly EvalSample[],
  profile: ProfileId = DEFAULT_PROFILE,
  options: TuneOptions = {},
): Promise<TuneOutcome> {
  const iterations = options.iterations ?? 300
  const seed = options.seed ?? 20260808
  const tunePrior = options.tunePrior ?? false

  const prepared = await prepareSamples(samples, profile)
  const base = resolveParams(undefined, profile)

  let best = cloneParams(base)
  let bestScore = scoreParams(prepared, base, tunePrior)
  const baselineCc = bestScore

  const random = mulberry32(seed)
  for (let i = 0; i < iterations; i++) {
    const candidate = sampleCandidate(base, random, tunePrior)
    const score = scoreParams(prepared, candidate, tunePrior)
    if (score > bestScore) {
      bestScore = score
      best = candidate
    }
    options.onProgress?.(i + 1, iterations, bestScore)
  }

  return { profile, baselineCc, bestCc: bestScore, params: best, iterations, seed }
}

/** Renders `src/engine/tuned.ts` for the given per-profile outcomes. */
export function renderTunedModule(
  configId: string,
  label: string,
  outcomes: Record<ProfileId, TuneOutcome>,
  shipped: Record<ProfileId, boolean>,
): string {
  const profiles = PROFILE_IDS.map((profile) => {
    const body = JSON.stringify(outcomes[profile].params, null, 2)
      .split('\n')
      .map((line, index) => (index === 0 ? line : `      ${line}`))
      .join('\n')
    return `      ${profile}: ${body},`
  }).join('\n')

  const summary = PROFILE_IDS.map(
    (profile) =>
      ` *   ${profile}: CC ${outcomes[profile].baselineCc.toFixed(4)} -> ${outcomes[profile].bestCc.toFixed(4)}` +
      ` (${outcomes[profile].iterations} Iterationen, Seed ${outcomes[profile].seed})` +
      `${shipped[profile] ? '' : ' — noch nicht gegen Center-Bias belegt, wird nicht ausgeliefert'}`,
  ).join('\n')

  return `/**
 * Generated file — do not edit by hand.
 *
 * Written by \`npm run tune\` (A-6). Optimised on the **tuning** split only.
 *
${summary}
 *
 * Nothing is deployed automatically: to ship this configuration, set
 * \`ENGINE_CONFIG.activeConfigId\` to '${configId}' by hand — after a human has
 * looked at the contact sheet.
 */
import type { EngineConfigEntry } from './params'

export const TUNED_CONFIGS: EngineConfigEntry[] = [
  {
    id: '${configId}',
    label: '${label}',
    profiles: {
${profiles}
    },
    shipped: ${JSON.stringify(shipped)},
  },
]
`
}

/** Restores the empty stub — used when a tuning run is discarded. */
export function emptyTunedModule(): string {
  return `/**
 * Generated file — do not edit by hand.
 *
 * \`npm run tune\` (A-6) writes the outcome of a random search over the engine
 * weights here as an additional named configuration. Nothing is deployed
 * automatically: switching the plugin over means changing
 * \`ENGINE_CONFIG.activeConfigId\` in \`config.ts\` by hand, after a human has
 * looked at the contact sheet.
 *
 * Empty until the harness has been run against a reference set.
 */
import type { EngineConfigEntry } from './params'

export const TUNED_CONFIGS: EngineConfigEntry[] = []
`
}

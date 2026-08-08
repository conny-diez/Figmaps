/**
 * A-4 — the engines and baselines that run side by side in every report.
 *
 * The center-bias baseline is the important one. Center bias scores
 * surprisingly well on saliency benchmarks; if seven hand-weighted feature maps
 * cannot beat a single Gaussian blob, they are decoration and that is the most
 * valuable finding this iteration can produce.
 */
import { analyzeFrame } from '../src/engine/analyze'
import { HeuristicAttentionEngine } from '../src/engine/heuristic'
import type { ImageOps } from '../src/engine/ops'
import { ENGINE_CONFIGS, PROFILE_IDS, type EngineParams, type ProfileId } from '../src/engine/params'
import type { ScalarMap } from '../src/engine/types'
import type { EvalSample } from './dataset'

export type Predictor = {
  id: string
  label: string
  /** True for the frozen 1.0 reference and the two trivial baselines. */
  baseline: boolean
  predict(sample: EvalSample, ops: ImageOps): Promise<ScalarMap>
}

/** Baseline 1 — an isotropic Gaussian at the image centre. No image analysis. */
export const CENTER_BIAS_SIGMA = 0.28

export function centerBiasMap(width: number, height: number, sigma = CENTER_BIAS_SIGMA): ScalarMap {
  const values = new Float32Array(width * height)
  for (let y = 0; y < height; y++) {
    const ny = (y + 0.5) / height - 0.5
    for (let x = 0; x < width; x++) {
      const nx = (x + 0.5) / width - 0.5
      values[y * width + x] = Math.exp(-(nx * nx + ny * ny) / (2 * sigma * sigma))
    }
  }
  return { width, height, values }
}

export const centerBias: Predictor = {
  id: 'center-bias',
  label: 'Center-Bias (nur Gaußglocke, keine Bildanalyse)',
  baseline: true,
  predict(sample) {
    return Promise.resolve(centerBiasMap(sample.grid.width, sample.grid.height))
  },
}

/** Baseline 2 — a constant map. Lower bound and sanity check of the metrics. */
export const uniform: Predictor = {
  id: 'uniform',
  label: 'Uniform (konstante Map)',
  baseline: true,
  predict(sample) {
    return Promise.resolve({
      width: sample.grid.width,
      height: sample.grid.height,
      values: new Float32Array(sample.grid.width * sample.grid.height).fill(0.5),
    })
  },
}

/** Runs a named engine configuration through the shipped analysis path. */
export function heuristicPredictor(
  configId: string,
  profile: ProfileId,
  options: { label?: string; baseline?: boolean; params?: EngineParams } = {},
): Predictor {
  const engine = new HeuristicAttentionEngine(
    options.params ? { params: options.params, configId, profile } : { configId, profile },
  )

  return {
    id: `${configId}:${profile}`,
    label: options.label ?? `${configId} · ${profile}`,
    baseline: options.baseline ?? false,
    async predict(sample, ops) {
      const result = await analyzeFrame(engine, ops, {
        source: sample.image,
        signals: sample.signals,
        frameWidth: sample.frameWidth,
        frameHeight: sample.frameHeight,
        // Reference screenshots are single viewports by construction; slicing
        // them would compare a composite against a whole-image ground truth.
        segment: false,
      })
      if (!result) throw new Error('Analyse abgebrochen')
      return result.attention
    },
  }
}

/** The three trivial/frozen references that accompany every run (A-4). */
export function baselinePredictors(): Predictor[] {
  return [
    centerBias,
    uniform,
    heuristicPredictor('heuristic-v1', 'scan', {
      label: 'FigMaps 1.0 (eingefrorene Referenz)',
      baseline: true,
    }),
  ]
}

/** Every named configuration x every profile — what `--engine all` evaluates. */
export function allPredictors(): Predictor[] {
  const out = baselinePredictors()
  for (const entry of Object.values(ENGINE_CONFIGS)) {
    for (const profile of PROFILE_IDS) {
      const id = `${entry.id}:${profile}`
      if (out.some((predictor) => predictor.id === id)) continue
      out.push(heuristicPredictor(entry.id, profile))
    }
  }
  return out
}

export function resolvePredictors(engine: string): Predictor[] {
  if (engine === 'all') return allPredictors()

  const [configId, profile] = engine.includes(':') ? engine.split(':') : [engine, 'scan']
  const resolvedConfig = configId === 'heuristic' ? 'heuristic-v1' : configId
  if (!ENGINE_CONFIGS[resolvedConfig]) {
    throw new Error(
      `Unbekannte Engine "${engine}". Verfügbar: ${Object.keys(ENGINE_CONFIGS).join(', ')} (jeweils :glance|:scan|:read)`,
    )
  }
  if (!PROFILE_IDS.includes(profile as ProfileId)) {
    throw new Error(`Unbekanntes Profil "${profile}". Verfügbar: ${PROFILE_IDS.join(', ')}`)
  }

  const predictors = baselinePredictors()
  const id = `${resolvedConfig}:${profile}`
  if (!predictors.some((predictor) => predictor.id === id)) {
    predictors.push(heuristicPredictor(resolvedConfig, profile as ProfileId))
  }
  return predictors
}

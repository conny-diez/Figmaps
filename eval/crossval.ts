/**
 * 5-fache Kreuzvalidierung über **alle** Bilder einer Kategorie.
 *
 * Motivation: der Test-Split des Datensatzes hat 27 Bilder. Ein Mittelwert
 * darüber schwankt so stark, dass ein Unterschied von 0,02 CC nicht von Rauschen
 * zu unterscheiden ist. Kreuzvalidierung über Tuning + Test (495 Bilder) liefert
 * für jedes Bild eine **out-of-sample**-Bewertung — 495 statt 27.
 *
 * Pro Fold werden **beide** datenabhängigen Größen ausschließlich aus den
 * übrigen vier Folds geschätzt:
 *
 *   - die Mean-Map-Baseline
 *   - der Ortsprior von `hybrid-v1` (inklusive 8-Bit-Quantisierung, also
 *     genau die Form, die auch ausgeliefert wird)
 *
 * `heuristic-v1`, Center-Bias und Uniform hängen von keinen Daten ab und
 * laufen unverändert mit.
 *
 * Effizienz: die Fold-Summen der Ground Truth werden in einem Durchgang über
 * die Heatmaps gebildet; die Trainingssumme eines Folds ist dann
 * `Gesamtsumme − Foldsumme`. Danach genügt **ein** Durchgang über die Bilder,
 * weil jedes Bild nur in seinem eigenen Fold bewertet wird.
 */
import { existsSync } from 'node:fs'
import { ENGINE_CONFIG } from '../src/engine/config'
import { positionPrior } from '../src/engine/features/prior'
import { combineFeatures, HeuristicAttentionEngine } from '../src/engine/heuristic'
import { fitWithin } from '../src/engine/ops-pure'
import { resolveParams } from '../src/engine/params'
import { resamplePrior } from '../src/engine/priors'
import type { ScalarMap } from '../src/engine/types'
import { nodeImageOps } from '../src/platform/imageops-node'
import {
  heatmapPath,
  iterateSamples,
  listSplit,
  readPng,
  resizeScalarMap,
  toScalarMap,
  type EvalSample,
} from './dataset'
import { scoreAll } from './metrics'
import { METRIC_DIRECTION, METRIC_IDS, type MetricId, type MetricScores } from './metrics/types'
import { MEAN_MAP_GRID } from './mean-map'
import { centerBiasMap } from './predictors'

export const FOLDS = 5

/** Grid the shipped prior asset uses — the cross-validation must match it. */
export const PRIOR_GRID = 32

export type EngineId = 'hybrid-v1' | 'mean-map' | 'heuristic-v1' | 'center-bias' | 'uniform'

export const ENGINE_LABELS: Record<EngineId, string> = {
  'hybrid-v1': 'hybrid-v1',
  'mean-map': 'Mean Map',
  'heuristic-v1': 'Figmaps 1.0',
  'center-bias': 'Center-Bias',
  uniform: 'Uniform',
}

export type PerImageScores = { id: string; fold: number; scores: Record<EngineId, MetricScores> }

export type Summary = {
  mean: number
  /** Standard deviation across the individual images. */
  sd: number
  /** Standard error of the mean, `sd / sqrt(n)`. */
  se: number
  n: number
}

export type PairedComparison = {
  metric: MetricId
  /** Mean of the per-image differences, direction-adjusted (+ = better). */
  mean: number
  sd: number
  se: number
  /** `mean / se` — how many standard errors the difference sits from zero. */
  tStatistic: number
  ci95: [number, number]
  /** Share of images where the first engine was better. */
  winRate: number
  n: number
  /** The same difference computed per fold — five independent estimates. */
  perFold: number[]
}

export type CrossvalResult = {
  setName: string
  duration: number
  folds: number
  imageCount: number
  foldSizes: number[]
  perImage: PerImageScores[]
  /** engine -> metric -> summary over all images. */
  summaries: Record<EngineId, Record<MetricId, Summary>>
  /** engine -> metric -> the five fold means. */
  foldMeans: Record<EngineId, Record<MetricId, number[]>>
  /** hybrid-v1 against the mean map, paired per image. */
  hybridVsMeanMap: PairedComparison[]
  /** hybrid-v1 against the shipped 1.0, paired per image. */
  hybridVsHeuristic: PairedComparison[]
}

function mean(values: readonly number[]): number {
  return values.length === 0 ? Number.NaN : values.reduce((sum, value) => sum + value, 0) / values.length
}

/** Sample standard deviation (n-1). */
function standardDeviation(values: readonly number[]): number {
  if (values.length < 2) return Number.NaN
  const m = mean(values)
  const sumSquares = values.reduce((sum, value) => sum + (value - m) * (value - m), 0)
  return Math.sqrt(sumSquares / (values.length - 1))
}

function summarise(values: readonly number[]): Summary {
  const usable = values.filter((value) => Number.isFinite(value))
  const sd = standardDeviation(usable)
  return { mean: mean(usable), sd, se: sd / Math.sqrt(usable.length), n: usable.length }
}

/**
 * Fold assignment: ids sorted, then round-robin.
 *
 * Deterministic and reproducible. The ids are content hashes, so their order
 * carries no relation to what the images show — this is a random split in
 * everything but the name, without needing a seed.
 */
export function assignFolds(ids: readonly string[], folds = FOLDS): Map<string, number> {
  const sorted = [...ids].sort()
  const assignment = new Map<string, number>()
  sorted.forEach((id, index) => assignment.set(id, index % folds))
  return assignment
}

/** Quantises a mean field to 8 bit on the prior grid, exactly like the asset. */
function quantisePrior(meanField: Float32Array, sourceSize: number, targetSize: number): Uint8Array {
  const map: ScalarMap = { width: sourceSize, height: sourceSize, values: meanField }
  const reduced = targetSize === sourceSize ? map : resizeScalarMap(map, targetSize, targetSize)
  const bytes = new Uint8Array(targetSize * targetSize)
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = Math.round(Math.max(0, Math.min(1, reduced.values[i])) * 255)
  }
  return bytes
}

export type CrossvalOptions = {
  setName: string
  duration: number
  folds?: number
  onProgress?: (done: number, total: number) => void
}

export async function crossValidate(options: CrossvalOptions): Promise<CrossvalResult> {
  const folds = options.folds ?? FOLDS
  const setName = options.setName
  const duration = options.duration

  // Every image of the category, regardless of the dataset's own split.
  const ids = [...new Set([...listSplit(setName, 'tuning'), ...listSplit(setName, 'test')])]
  const foldOf = assignFolds(ids, folds)

  // --- pass 1: fold sums of the ground truth -------------------------------
  const size = MEAN_MAP_GRID
  const total = new Float64Array(size * size)
  const foldSums = Array.from({ length: folds }, () => new Float64Array(size * size))
  const foldCounts = new Array<number>(folds).fill(0)

  for (const id of ids) {
    const path = heatmapPath(setName, id, duration)
    if (!existsSync(path)) continue
    const fold = foldOf.get(id)
    if (fold === undefined) continue
    const normalised = resizeScalarMap(toScalarMap(readPng(path)), size, size)
    for (let i = 0; i < total.length; i++) {
      total[i] += normalised.values[i]
      foldSums[fold][i] += normalised.values[i]
    }
    foldCounts[fold]++
  }

  const totalCount = foldCounts.reduce((sum, value) => sum + value, 0)
  if (totalCount === 0) throw new Error(`Kreuzvalidierung: keine Ground Truth in "${setName}".`)

  /** Training mean for a fold: everything except that fold, normalised. */
  const trainingMean = (fold: number): Float32Array => {
    const count = totalCount - foldCounts[fold]
    if (count < 1) throw new Error(`Fold ${fold} lässt keine Trainingsbilder übrig.`)
    const values = new Float32Array(total.length)
    let max = 0
    for (let i = 0; i < values.length; i++) {
      const value = (total[i] - foldSums[fold][i]) / count
      values[i] = value > 0 ? value : 0
      if (values[i] > max) max = values[i]
    }
    if (max > 0) for (let i = 0; i < values.length; i++) values[i] /= max
    return values
  }

  const foldMeanField = Array.from({ length: folds }, (_, fold) => trainingMean(fold))
  const foldPriorBytes = foldMeanField.map((field) => quantisePrior(field, size, PRIOR_GRID))

  // --- pass 2: one evaluation per image, in its own held-out fold ----------
  const hybridParams = resolveParams('hybrid-v1')
  const v1Params = resolveParams('heuristic-v1')
  const perImage: PerImageScores[] = []
  let done = 0

  for (const split of ['tuning', 'test'] as const) {
    for (const sample of iterateSamples(setName, split, { duration })) {
      const fold = foldOf.get(sample.id)
      if (fold === undefined) continue
      // `tuning` and `test` are disjoint, but guard against a double yield.
      if (perImage.some((entry) => entry.id === sample.id)) continue

      const shape = { width: sample.grid.width, height: sample.grid.height }
      const priorForFold = resamplePrior(foldPriorBytes[fold], PRIOR_GRID, PRIOR_GRID, shape.width, shape.height)

      const engine = new HeuristicAttentionEngine({
        configId: 'hybrid-v1',
        priorProvider: () => priorForFold,
      })
      const features = await engine.computeFeatures({
        pixels: nodeImageOps.resize(sample.image, ...gridOf(sample)),
        signals: sample.signals,
        frameWidth: sample.frameWidth,
        frameHeight: sample.frameHeight,
      })

      const toMap = (values: Float32Array): ScalarMap => ({ ...shape, values })
      const meanMapForFold = resizeScalarMap(
        { width: size, height: size, values: foldMeanField[fold] },
        shape.width,
        shape.height,
      )

      const scores: Record<EngineId, MetricScores> = {
        'hybrid-v1': scoreAll(toMap(combineFeatures(features, shape.width, shape.height, hybridParams)), sample.truth),
        'mean-map': scoreAll(meanMapForFold, sample.truth),
        // 1.0 gets its own analytical prior back: the feature set above was
        // computed with the data prior, and reusing it would credit 1.0 with
        // the very thing that distinguishes the hybrid from it.
        'heuristic-v1': scoreAll(
          toMap(
            combineFeatures(
              { ...features, positionPrior: positionPrior(shape.width, shape.height, v1Params.prior) },
              shape.width,
              shape.height,
              v1Params,
            ),
          ),
          sample.truth,
        ),
        'center-bias': scoreAll(centerBiasMap(shape.width, shape.height), sample.truth),
        uniform: scoreAll({ ...shape, values: new Float32Array(shape.width * shape.height).fill(0.5) }, sample.truth),
      }

      perImage.push({ id: sample.id, fold, scores })
      done++
      options.onProgress?.(done, ids.length)
    }
  }

  return summariseResult(setName, duration, folds, foldCounts, perImage)
}

/** Analysis grid the engine would use for this sample. */
function gridOf(sample: EvalSample): [number, number] {
  const grid = fitWithin(sample.image.width, sample.image.height, ENGINE_CONFIG.analysisEdge)
  return [grid.width, grid.height]
}

function summariseResult(
  setName: string,
  duration: number,
  folds: number,
  foldCounts: number[],
  perImage: PerImageScores[],
): CrossvalResult {
  const engines = Object.keys(ENGINE_LABELS) as EngineId[]

  const summaries = {} as CrossvalResult['summaries']
  const foldMeans = {} as CrossvalResult['foldMeans']
  for (const engine of engines) {
    summaries[engine] = {} as Record<MetricId, Summary>
    foldMeans[engine] = {} as Record<MetricId, number[]>
    for (const metric of METRIC_IDS) {
      summaries[engine][metric] = summarise(perImage.map((entry) => entry.scores[engine][metric]))
      foldMeans[engine][metric] = Array.from({ length: folds }, (_, fold) =>
        mean(perImage.filter((entry) => entry.fold === fold).map((entry) => entry.scores[engine][metric])),
      )
    }
  }

  const paired = (a: EngineId, b: EngineId): PairedComparison[] =>
    METRIC_IDS.map((metric) => {
      const direction = METRIC_DIRECTION[metric]
      const differences = perImage
        .map((entry) => (entry.scores[a][metric] - entry.scores[b][metric]) * direction)
        .filter((value) => Number.isFinite(value))
      const summary = summarise(differences)
      const margin = 1.96 * summary.se
      return {
        metric,
        mean: summary.mean,
        sd: summary.sd,
        se: summary.se,
        tStatistic: summary.mean / summary.se,
        ci95: [summary.mean - margin, summary.mean + margin] as [number, number],
        winRate: differences.filter((value) => value > 0).length / differences.length,
        n: differences.length,
        perFold: Array.from({ length: folds }, (_, fold) =>
          mean(
            perImage
              .filter((entry) => entry.fold === fold)
              .map((entry) => (entry.scores[a][metric] - entry.scores[b][metric]) * direction),
          ),
        ),
      }
    })

  return {
    setName,
    duration,
    folds,
    imageCount: perImage.length,
    foldSizes: foldCounts,
    perImage,
    summaries,
    foldMeans,
    hybridVsMeanMap: paired('hybrid-v1', 'mean-map'),
    hybridVsHeuristic: paired('hybrid-v1', 'heuristic-v1'),
  }
}

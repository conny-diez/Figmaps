/**
 * Epic D, endlich gemessen.
 *
 * Hypothese: Betrachtungsdauer ist überwiegend ein **Prior-Effekt**, kein
 * Gewichtungs-Effekt. Nach einer Sekunde liegt der Blick woanders als nach
 * sieben — aber das ist eine Aussage über *Orte*, nicht darüber, wie stark
 * Kanten gegenüber Text zählen.
 *
 * Versuchsaufbau, dieselbe Kreuzvalidierung wie zuletzt:
 *
 *   Für jede Ground-Truth-Dauer d ∈ {1, 3, 7}:
 *     Für jeden Prior p ∈ {1s, 3s, 7s}:
 *       hybrid-v1 mit Prior p, bewertet gegen Ground Truth d.
 *
 * Alle Prioren werden pro Fold aus den übrigen vier Folds geschätzt,
 * inklusive 8-Bit-Quantisierung — also genau in der Form, die ausgeliefert
 * würde. Jede Bewertung ist out-of-sample.
 *
 * Die Entscheidung:
 *   - Schlägt `prior_d` den `prior_3s` auf Ground Truth d **messbar**, gibt es
 *     einen Dauer-Effekt und drei Profile sind gerechtfertigt.
 *   - Sonst wird Epic D gestrichen. Drei Schalter anzubieten, die dasselbe
 *     tun, ist schlechter als einer.
 */
import { existsSync } from 'node:fs'
import { ENGINE_CONFIG } from '../src/engine/config'
import { combineFeatures, HeuristicAttentionEngine } from '../src/engine/heuristic'
import { correlation } from '../src/engine/deviation'
import { fitWithin } from '../src/engine/ops-pure'
import { resolveParams } from '../src/engine/params'
import { resamplePrior } from '../src/engine/priors'
import type { ScalarMap } from '../src/engine/types'
import { nodeImageOps } from '../src/platform/imageops-node'
import {
  heatmapPath,
  listSplit,
  readPng,
  resizeScalarMap,
  toScalarMap,
  FIXTURES_ROOT,
} from './dataset'
import { analysisGridFor } from '../src/engine/analyze'
import { fixationsFromMask, type GroundTruth } from './metrics/types'
import { scoreAll } from './metrics'
import { METRIC_DIRECTION, METRIC_IDS, type MetricId, type MetricScores } from './metrics/types'
import { MEAN_MAP_GRID } from './mean-map'
import { assignFolds, FOLDS, PRIOR_GRID } from './crossval'
import { join } from 'node:path'

export const DURATIONS = [1, 3, 7] as const
export type Duration = (typeof DURATIONS)[number]

/** The duration whose prior ships today — the reference every other is judged against. */
export const REFERENCE_DURATION: Duration = 3

export type DurationPair = { truth: Duration; prior: Duration; mean: MetricScores }

export type PriorComparison = {
  truth: Duration
  prior: Duration
  metric: MetricId
  /** Paired per-image difference against the reference prior, + = better. */
  mean: number
  se: number
  ci95: [number, number]
  tStatistic: number
  winRate: number
}

export type EpicDResult = {
  setName: string
  imageCount: number
  folds: number
  /** Pairwise CC between the three priors themselves. */
  priorSimilarity: Array<{ a: Duration; b: Duration; cc: number }>
  cells: DurationPair[]
  comparisons: PriorComparison[]
  /** True when a duration-specific prior beats the 3 s prior on its own truth. */
  durationMatters: boolean
}

function mean(values: readonly number[]): number {
  return values.length === 0 ? Number.NaN : values.reduce((sum, value) => sum + value, 0) / values.length
}

function sd(values: readonly number[]): number {
  if (values.length < 2) return Number.NaN
  const m = mean(values)
  return Math.sqrt(values.reduce((sum, value) => sum + (value - m) * (value - m), 0) / (values.length - 1))
}

function fixmapPath(setName: string, id: string, duration: number, root = FIXTURES_ROOT): string {
  return join(root, setName, 'fixmaps', `${duration}s`, `${id}.png`)
}

export type EpicDOptions = {
  setName: string
  folds?: number
  onProgress?: (done: number, total: number) => void
}

export async function measureEpicD(options: EpicDOptions): Promise<EpicDResult> {
  const folds = options.folds ?? FOLDS
  const setName = options.setName
  const ids = [...new Set([...listSplit(setName, 'tuning'), ...listSplit(setName, 'test')])]
  const foldOf = assignFolds(ids, folds)
  const size = MEAN_MAP_GRID

  // --- pass 1: fold sums per duration --------------------------------------
  const totals = new Map<Duration, Float64Array>()
  const foldSums = new Map<Duration, Float64Array[]>()
  const foldCounts = new Map<Duration, number[]>()

  for (const duration of DURATIONS) {
    totals.set(duration, new Float64Array(size * size))
    foldSums.set(duration, Array.from({ length: folds }, () => new Float64Array(size * size)))
    foldCounts.set(duration, new Array<number>(folds).fill(0))
  }

  for (const id of ids) {
    const fold = foldOf.get(id)
    if (fold === undefined) continue
    for (const duration of DURATIONS) {
      const path = heatmapPath(setName, id, duration)
      if (!existsSync(path)) continue
      const normalised = resizeScalarMap(toScalarMap(readPng(path)), size, size)
      const total = totals.get(duration)!
      const sums = foldSums.get(duration)![fold]
      for (let i = 0; i < total.length; i++) {
        total[i] += normalised.values[i]
        sums[i] += normalised.values[i]
      }
      foldCounts.get(duration)![fold]++
    }
  }

  /** Training prior for (duration, fold), quantised exactly like the asset. */
  const priorBytes = new Map<string, Uint8Array>()
  const priorField = new Map<Duration, Float32Array>()

  for (const duration of DURATIONS) {
    const total = totals.get(duration)!
    const counts = foldCounts.get(duration)!
    const totalCount = counts.reduce((sum, value) => sum + value, 0)
    if (totalCount === 0) throw new Error(`Epic D: keine Ground Truth für ${duration}s in "${setName}".`)

    // Full-data prior, only for the similarity comparison between durations.
    const full = new Float32Array(total.length)
    let fullMax = 0
    for (let i = 0; i < full.length; i++) {
      full[i] = total[i] / totalCount
      if (full[i] > fullMax) fullMax = full[i]
    }
    if (fullMax > 0) for (let i = 0; i < full.length; i++) full[i] /= fullMax
    priorField.set(duration, full)

    for (let fold = 0; fold < folds; fold++) {
      const count = totalCount - counts[fold]
      const values = new Float32Array(total.length)
      let max = 0
      for (let i = 0; i < values.length; i++) {
        const value = (total[i] - foldSums.get(duration)![fold][i]) / count
        values[i] = value > 0 ? value : 0
        if (values[i] > max) max = values[i]
      }
      if (max > 0) for (let i = 0; i < values.length; i++) values[i] /= max

      const reduced = resizeScalarMap({ width: size, height: size, values }, PRIOR_GRID, PRIOR_GRID)
      const bytes = new Uint8Array(PRIOR_GRID * PRIOR_GRID)
      for (let i = 0; i < bytes.length; i++) {
        bytes[i] = Math.round(Math.max(0, Math.min(1, reduced.values[i])) * 255)
      }
      priorBytes.set(`${duration}:${fold}`, bytes)
    }
  }

  // --- pass 2: one feature computation per image, nine scorings ------------
  const params = resolveParams('hybrid-v1')
  const engine = new HeuristicAttentionEngine({ configId: 'hybrid-v1' })
  const perImage: Array<{ id: string; scores: Map<string, MetricScores> }> = []
  let done = 0

  for (const id of ids) {
    const fold = foldOf.get(id)
    if (fold === undefined) continue

    const imagePath = join(FIXTURES_ROOT, setName, 'images', `${id}.png`)
    if (!existsSync(imagePath)) continue
    const image = readPng(imagePath)
    const grid = analysisGridFor(image.width, image.height)

    // Ground truth for all three durations of this image.
    const truths = new Map<Duration, GroundTruth>()
    for (const duration of DURATIONS) {
      const heat = heatmapPath(setName, id, duration)
      const fix = fixmapPath(setName, id, duration)
      if (!existsSync(heat) || !existsSync(fix)) continue
      const salience = resizeScalarMap(toScalarMap(readPng(heat)), grid.width, grid.height)
      const fixations = fixationsFromMask(readPng(fix), grid.width, grid.height)
      if (fixations.length === 0 || fixations.length >= grid.width * grid.height) continue
      truths.set(duration, { salience, fixations, fixationSource: 'measured' })
    }
    if (truths.size < DURATIONS.length) continue

    const analysisGrid = fitWithin(image.width, image.height, ENGINE_CONFIG.analysisEdge)
    const pixels = nodeImageOps.resize(image, analysisGrid.width, analysisGrid.height)
    const features = await engine.computeFeatures({
      pixels,
      signals: [],
      frameWidth: image.width,
      frameHeight: image.height,
    })

    const scores = new Map<string, MetricScores>()
    for (const priorDuration of DURATIONS) {
      const prior = resamplePrior(priorBytes.get(`${priorDuration}:${fold}`)!, PRIOR_GRID, PRIOR_GRID, grid.width, grid.height)
      const values = combineFeatures({ ...features, positionPrior: prior }, grid.width, grid.height, params)
      const prediction: ScalarMap = { width: grid.width, height: grid.height, values }
      for (const truthDuration of DURATIONS) {
        scores.set(`${truthDuration}|${priorDuration}`, scoreAll(prediction, truths.get(truthDuration)!))
      }
    }

    perImage.push({ id, scores })
    done++
    options.onProgress?.(done, ids.length)
  }

  // --- summarise -----------------------------------------------------------
  const cells: DurationPair[] = []
  for (const truth of DURATIONS) {
    for (const prior of DURATIONS) {
      const key = `${truth}|${prior}`
      const scoresFor = (metric: MetricId): number[] =>
        perImage.map((entry) => entry.scores.get(key)![metric]).filter((value) => Number.isFinite(value))
      const meanScores = {} as MetricScores
      for (const metric of METRIC_IDS) meanScores[metric] = mean(scoresFor(metric))
      cells.push({ truth, prior, mean: meanScores })
    }
  }

  const comparisons: PriorComparison[] = []
  for (const truth of DURATIONS) {
    for (const prior of DURATIONS) {
      if (prior === REFERENCE_DURATION) continue
      for (const metric of METRIC_IDS) {
        const direction = METRIC_DIRECTION[metric]
        const differences = perImage
          .map(
            (entry) =>
              (entry.scores.get(`${truth}|${prior}`)![metric] - entry.scores.get(`${truth}|${REFERENCE_DURATION}`)![metric]) *
              direction,
          )
          .filter((value) => Number.isFinite(value))
        const m = mean(differences)
        const s = sd(differences)
        const se = s / Math.sqrt(differences.length)
        comparisons.push({
          truth,
          prior,
          metric,
          mean: m,
          se,
          ci95: [m - 1.96 * se, m + 1.96 * se],
          tStatistic: m / se,
          winRate: differences.filter((value) => value > 0).length / differences.length,
        })
      }
    }
  }

  // A duration effect exists if, on its own ground truth, the matching prior
  // beats the 3 s prior with an interval that excludes zero.
  const durationMatters = comparisons.some(
    (entry) => entry.truth === entry.prior && entry.metric === 'cc' && entry.ci95[0] > 0,
  )

  const priorSimilarity: EpicDResult['priorSimilarity'] = []
  for (let i = 0; i < DURATIONS.length; i++) {
    for (let j = i + 1; j < DURATIONS.length; j++) {
      priorSimilarity.push({
        a: DURATIONS[i],
        b: DURATIONS[j],
        cc: correlation(priorField.get(DURATIONS[i])!, priorField.get(DURATIONS[j])!),
      })
    }
  }

  return { setName, imageCount: perImage.length, folds, priorSimilarity, cells, comparisons, durationMatters }
}

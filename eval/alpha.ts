/**
 * 1.2 A — die Alpha-Kurve.
 *
 * `blendAlpha` steht auf 0,3, und der Wert wurde an einem einzigen Kriterium
 * abgelesen: bei 0,5 verlor KL gegen die Mean Map (siehe `params.ts`). Der
 * offene Verdacht ist, dass unsere Karten dadurch systematisch **zu weich**
 * sind — sie folgen dem Ortsprior statt dem Inhalt.
 *
 * Dieses Modul misst beides in einem Durchgang:
 *
 *   A1  Konzentration (Masse in den stärksten 5 % der Pixel) der
 *       Ground Truth gegen die Konzentration der Vorhersage. Eine Verteilung,
 *       kein Mittelwert — der Verdacht ist eine Aussage über die Form.
 *   A2  Alpha-Sweep über mehrere Werte, je Punkt AUC, CC, NSS, KL **und** die
 *       Konzentration.
 *
 * Zwei Dinge, die diese Messung von einem naiven Sweep unterscheiden:
 *
 *   1. **Kreuzvalidiert, out-of-sample.** Ortsprior *und* Mean-Map-Baseline
 *      werden je Fold ausschließlich aus den übrigen Folds geschätzt — genau
 *      wie in `crossval.ts`, inklusive der 8-Bit-Quantisierung des Priors, also
 *      in der Form, die auch ausgeliefert wird.
 *   2. **Nur der Tuning-Split.** `crossval.ts` läuft über Tuning + Test
 *      zusammen; für eine *Entscheidung* über einen Parameter ist das der
 *      falsche Zuschnitt. Kalibriert wird auf dem Tuning-Split, der Test-Split
 *      wird genau einmal angefasst — dafür gibt es `confirmOnTest`.
 *
 * Der Sweep selbst ist billig: der Bildanalyse-Anteil und der Ortsprior hängen
 * **nicht** von alpha ab. Beide werden einmal je Bild berechnet, danach kostet
 * ein weiterer Alpha-Punkt nur noch die Mischung und die Metriken. Dass die
 * Mischung dieselbe ist wie die ausgelieferte, prüft
 * `__tests__/alpha.test.ts` gegen `combineFeatures` — die Abkürzung darf nicht
 * still von der Engine wegdriften.
 */
import { existsSync } from 'node:fs'
import { ENGINE_CONFIG } from '../src/engine/config'
import { combineFeatureParts, HeuristicAttentionEngine } from '../src/engine/heuristic'
import { normalize01 } from '../src/engine/imageops'
import { fitWithin } from '../src/engine/ops-pure'
import { resolveParams, type EngineParams } from '../src/engine/params'
import { resamplePrior } from '../src/engine/priors'
import { sectionSalience } from '../src/engine/segments'
import type { ScalarMap } from '../src/engine/types'
import { nodeImageOps } from '../src/platform/imageops-node'
import { assignFolds, PRIOR_GRID, type Summary } from './crossval'
import {
  heatmapPath,
  iterateSamples,
  listSplit,
  readPng,
  resizeScalarMap,
  toScalarMap,
  type EvalSample,
  type SplitName,
} from './dataset'
import { MEAN_MAP_GRID } from './mean-map'
import { scoreAll } from './metrics'
import { METRIC_IDS, type MetricId, type MetricScores } from './metrics/types'

/**
 * Die vier Punkte aus der Aufgabe. Steigt die Kurve am oberen Ende noch, wird
 * verlängert — `--alphas` überschreibt die Liste, `extendedAlphas` schlägt die
 * Verlängerung vor.
 */
export const DEFAULT_ALPHAS: readonly number[] = [0.3, 0.5, 0.8, 1.2]

/**
 * `alpha = 0` läuft als Anker mit: das ist die Vorhersage *ohne jede
 * Bildanalyse*, also der reine (fold-eigene) Ortsprior. Ohne diesen Punkt sagt
 * eine Kurve nicht, ob die Bildanalyse überhaupt etwas beiträgt.
 */
export const PRIOR_ONLY_ALPHA = 0

/** Anteil der stärksten Pixel, auf dem die Konzentration gemessen wird (A1). */
export const CONCENTRATION_TOP_SHARE = 0.05

export type AlphaPoint = {
  alpha: number
  /** Metrik -> Verteilung über die Einzelbilder. */
  metrics: Record<MetricId, Summary>
  /** Konzentration der Vorhersage, Verteilung über die Einzelbilder. */
  concentration: Summary
  concentrationQuantiles: number[]
  /** Konzentration je Bild — für Histogramm und gepaarte Vergleiche. */
  concentrationSamples: number[]
  /** Metrik -> die `folds` Fold-Mittelwerte. */
  foldMeans: Record<MetricId, number[]>
}

export type PairedDelta = {
  metric: MetricId
  /** Mittel der bildweisen Differenzen, richtungskorrigiert (+ = besser). */
  mean: number
  se: number
  tStatistic: number
  ci95: [number, number]
  winRate: number
  n: number
}

export type AlphaSweepResult = {
  setName: string
  split: SplitName
  duration: number
  folds: number
  imageCount: number
  alphas: number[]
  /** Der Wert, gegen den verglichen wird — der ausgelieferte. */
  referenceAlpha: number
  points: AlphaPoint[]
  /** A1 — Konzentration der Ground Truth, dieselbe Größe, dieselbe Normierung. */
  truthConcentration: Summary
  truthConcentrationQuantiles: number[]
  truthConcentrationSamples: number[]
  /** Die Mean Map je Fold, als Bezugspunkt für KL (dort entstand die 0,3). */
  meanMap: { metrics: Record<MetricId, Summary>; concentration: Summary }
  /** Je Alpha: gepaarte Differenz gegen `referenceAlpha`. */
  versusReference: Map<number, PairedDelta[]>
  /** Je Alpha: gepaarte Differenz gegen die Mean Map. */
  versusMeanMap: Map<number, PairedDelta[]>
}

function mean(values: readonly number[]): number {
  return values.length === 0 ? Number.NaN : values.reduce((sum, value) => sum + value, 0) / values.length
}

function standardDeviation(values: readonly number[]): number {
  if (values.length < 2) return Number.NaN
  const m = mean(values)
  return Math.sqrt(values.reduce((sum, value) => sum + (value - m) * (value - m), 0) / (values.length - 1))
}

export function summarise(values: readonly number[]): Summary {
  const usable = values.filter((value) => Number.isFinite(value))
  const sd = standardDeviation(usable)
  return { mean: mean(usable), sd, se: sd / Math.sqrt(usable.length), n: usable.length }
}

export function quantilesOf(samples: readonly number[], points = [0.05, 0.25, 0.5, 0.75, 0.95]): number[] {
  if (samples.length === 0) return points.map(() => Number.NaN)
  const sorted = [...samples].sort((a, b) => a - b)
  return points.map((q) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))])
}

/**
 * Konzentration einer Karte: Anteil der Gesamtmasse, der auf die stärksten 5 %
 * der Pixel entfällt (`sectionSalience`, dieselbe Funktion wie in der Engine).
 *
 * **Beide Seiten werden vorher identisch normiert** (`normalize01`). Die Größe
 * ist invariant gegen Skalierung, aber nicht gegen einen Sockel: die
 * Ground-Truth-Maps kommen auf ihr Maximum normiert an, die Vorhersage auf
 * Minimum *und* Maximum. Ohne die gemeinsame Normierung verglichen man zwei
 * verschieden verschobene Verteilungen.
 */
export function concentrationOf(map: ScalarMap): number {
  return sectionSalience({ ...map, values: normalize01(map.values) }, CONCENTRATION_TOP_SHARE)
}

/** Analyseraster, das die Engine für dieses Bild verwenden würde. */
function gridOf(sample: EvalSample): [number, number] {
  const grid = fitWithin(sample.image.width, sample.image.height, ENGINE_CONFIG.analysisEdge)
  return [grid.width, grid.height]
}

/**
 * Die Mischung von `combineFeatureParts` für einen weiteren Alpha-Wert, ohne
 * die Bildanalyse noch einmal zu rechnen.
 *
 * `imageTerm` ist bereits nachbearbeitet (Blur, Perzentil-Clip, Gamma) und
 * hängt nicht von alpha ab; `prior` ist der normierte Ortsprior. Die
 * ausgelieferte Formel ist `normalize01(prior + alpha * image)` — bewusst ohne
 * zweites Gamma, siehe `heuristic.ts`.
 */
export function blendAt(prior: Float32Array, imageTerm: Float32Array, alpha: number): Float32Array {
  const blended = new Float32Array(prior.length)
  for (let i = 0; i < blended.length; i++) blended[i] = prior[i] + alpha * imageTerm[i]
  return normalize01(blended)
}

/** 8-Bit-Quantisierung eines Mittelwertfelds auf das Prior-Raster. */
function quantisePrior(meanField: Float32Array, sourceSize: number, targetSize: number): Uint8Array {
  const map: ScalarMap = { width: sourceSize, height: sourceSize, values: meanField }
  const reduced = targetSize === sourceSize ? map : resizeScalarMap(map, targetSize, targetSize)
  const bytes = new Uint8Array(targetSize * targetSize)
  for (let i = 0; i < bytes.length; i++) bytes[i] = Math.round(Math.max(0, Math.min(1, reduced.values[i])) * 255)
  return bytes
}

export type AlphaSweepOptions = {
  setName: string
  duration: number
  alphas?: readonly number[]
  folds?: number
  /** Ausschließlich der Tuning-Split — siehe Modulkopf. */
  split?: SplitName
  limit?: number
  onProgress?: (done: number, total: number) => void
}

type FoldModel = {
  /** Ortsprior des Folds, in der ausgelieferten 8-Bit-Form. */
  priorBytes: Uint8Array
  /** Mean-Map-Baseline des Folds, auf dem 128er-Raster. */
  meanField: Float32Array
}

/**
 * Fold-Modelle: je Fold Ortsprior und Mean Map aus **allen anderen** Folds.
 *
 * Ein Durchgang über die Ground-Truth-Maps bildet die Fold-Summen; die
 * Trainingssumme eines Folds ist dann `Gesamtsumme − Foldsumme`. Identisch zu
 * `crossval.ts`, nur auf einem wählbaren Split.
 */
function fitFolds(
  setName: string,
  split: SplitName,
  duration: number,
  ids: readonly string[],
  foldOf: Map<string, number>,
  folds: number,
): { models: FoldModel[]; foldCounts: number[] } {
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
  if (totalCount === 0) throw new Error(`Alpha-Sweep: keine Ground Truth in "${setName}" / "${split}".`)

  const models = Array.from({ length: folds }, (_, fold) => {
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
    return { priorBytes: quantisePrior(values, size, PRIOR_GRID), meanField: values }
  })

  return { models, foldCounts }
}

/** Richtungskorrigierte, gepaarte Differenz zweier Score-Reihen. */
function pairedDelta(
  a: ReadonlyMap<string, MetricScores>,
  b: ReadonlyMap<string, MetricScores>,
  ids: readonly string[],
): PairedDelta[] {
  return METRIC_IDS.map((metric) => {
    const direction = metric === 'kl' ? -1 : 1
    const differences = ids
      .map((id) => {
        const left = a.get(id)?.[metric]
        const right = b.get(id)?.[metric]
        return left === undefined || right === undefined ? Number.NaN : (left - right) * direction
      })
      .filter((value) => Number.isFinite(value))
    const summary = summarise(differences)
    const margin = 1.96 * summary.se
    return {
      metric,
      mean: summary.mean,
      se: summary.se,
      tStatistic: summary.mean / summary.se,
      ci95: [summary.mean - margin, summary.mean + margin] as [number, number],
      winRate: differences.filter((value) => value > 0).length / differences.length,
      n: differences.length,
    }
  })
}

export async function alphaSweep(options: AlphaSweepOptions): Promise<AlphaSweepResult> {
  const { setName, duration } = options
  const split = options.split ?? 'tuning'
  const folds = options.folds ?? 5
  const requested = options.alphas ?? DEFAULT_ALPHAS
  // Der Ankerpunkt und der ausgelieferte Wert gehören immer dazu.
  const alphas = [...new Set([PRIOR_ONLY_ALPHA, ...requested])].sort((a, b) => a - b)
  const referenceAlpha = ENGINE_CONFIG.activeConfigId === 'hybrid-v1' ? (resolveParams('hybrid-v1').blendAlpha ?? 0.3) : 0.3

  const allIds = listSplit(setName, split)
  const ids = options.limit ? allIds.slice(0, options.limit) : allIds
  const foldOf = assignFolds(ids, folds)
  const { models } = fitFolds(setName, split, duration, ids, foldOf, folds)

  const wanted = new Set(ids)
  const baseParams = resolveParams('hybrid-v1')

  const scoresPerAlpha = new Map<number, Map<string, MetricScores>>(alphas.map((alpha) => [alpha, new Map()]))
  const concentrationPerAlpha = new Map<number, Map<string, number>>(alphas.map((alpha) => [alpha, new Map()]))
  const meanMapScores = new Map<string, MetricScores>()
  const meanMapConcentration: number[] = []
  const truthConcentration: number[] = []
  const foldPerImage = new Map<string, number>()
  const seen: string[] = []

  for (const sample of iterateSamples(setName, split, { duration })) {
    if (!wanted.has(sample.id)) continue
    const fold = foldOf.get(sample.id)
    if (fold === undefined) continue

    const shape = { width: sample.grid.width, height: sample.grid.height }
    const priorForFold = resamplePrior(models[fold].priorBytes, PRIOR_GRID, PRIOR_GRID, shape.width, shape.height)

    const engine = new HeuristicAttentionEngine({ configId: 'hybrid-v1', priorProvider: () => priorForFold })
    const features = await engine.computeFeatures({
      pixels: nodeImageOps.resize(sample.image, ...gridOf(sample)),
      signals: sample.signals,
      frameWidth: sample.frameWidth,
      frameHeight: sample.frameHeight,
    })

    // Einmal durch die ausgelieferte Kombination, um den nachbearbeiteten
    // Bildanteil zu bekommen. Er hängt nicht von alpha ab.
    const parts = combineFeatureParts(features, shape.width, shape.height, baseParams)
    const imageTerm = parts.imageTerm
    if (!imageTerm) throw new Error('Engine liefert keinen Bildanteil — der Sweep braucht ihn.')
    const prior = normalize01(features.positionPrior)

    for (const alpha of alphas) {
      const map: ScalarMap = { ...shape, values: blendAt(prior, imageTerm, alpha) }
      scoresPerAlpha.get(alpha)!.set(sample.id, scoreAll(map, sample.truth))
      concentrationPerAlpha.get(alpha)!.set(sample.id, concentrationOf(map))
    }

    const meanMapForFold = resizeScalarMap(
      { width: MEAN_MAP_GRID, height: MEAN_MAP_GRID, values: models[fold].meanField },
      shape.width,
      shape.height,
    )
    meanMapScores.set(sample.id, scoreAll(meanMapForFold, sample.truth))
    meanMapConcentration.push(concentrationOf(meanMapForFold))
    truthConcentration.push(concentrationOf(sample.truth.salience))

    foldPerImage.set(sample.id, fold)
    seen.push(sample.id)
    options.onProgress?.(seen.length, ids.length)
  }

  const points: AlphaPoint[] = alphas.map((alpha) => {
    const scores = scoresPerAlpha.get(alpha)!
    const concentration = concentrationPerAlpha.get(alpha)!
    const metrics = {} as Record<MetricId, Summary>
    const foldMeans = {} as Record<MetricId, number[]>
    for (const metric of METRIC_IDS) {
      metrics[metric] = summarise(seen.map((id) => scores.get(id)![metric]))
      foldMeans[metric] = Array.from({ length: folds }, (_, fold) =>
        mean(seen.filter((id) => foldPerImage.get(id) === fold).map((id) => scores.get(id)![metric])),
      )
    }
    const concentrationSamples = seen.map((id) => concentration.get(id)!)
    return {
      alpha,
      metrics,
      concentration: summarise(concentrationSamples),
      concentrationQuantiles: quantilesOf(concentrationSamples),
      concentrationSamples,
      foldMeans,
    }
  })

  const meanMapMetrics = {} as Record<MetricId, Summary>
  for (const metric of METRIC_IDS) {
    meanMapMetrics[metric] = summarise(seen.map((id) => meanMapScores.get(id)![metric]))
  }

  const reference = scoresPerAlpha.get(referenceAlpha)
  const versusReference = new Map<number, PairedDelta[]>()
  const versusMeanMap = new Map<number, PairedDelta[]>()
  for (const alpha of alphas) {
    if (reference) versusReference.set(alpha, pairedDelta(scoresPerAlpha.get(alpha)!, reference, seen))
    versusMeanMap.set(alpha, pairedDelta(scoresPerAlpha.get(alpha)!, meanMapScores, seen))
  }

  return {
    setName,
    split,
    duration,
    folds,
    imageCount: seen.length,
    alphas,
    referenceAlpha,
    points,
    truthConcentration: summarise(truthConcentration),
    truthConcentrationQuantiles: quantilesOf(truthConcentration),
    truthConcentrationSamples: truthConcentration,
    meanMap: { metrics: meanMapMetrics, concentration: summarise(meanMapConcentration) },
    versusReference,
    versusMeanMap,
  }
}

/**
 * Steigt die Kurve am oberen Ende noch?
 *
 * A2 verlangt eine Verlängerung, falls das der Fall ist. „Steigt" heißt hier:
 * der letzte Punkt ist in AUC, CC oder NSS besser als der vorletzte, und zwar
 * um mehr als die Standardfehler der Differenz — sonst verlängert man eine
 * Kurve entlang von Rauschen.
 */
export function stillRising(result: AlphaSweepResult): MetricId[] {
  const points = result.points.filter((point) => point.alpha > 0)
  if (points.length < 2) return []
  const last = points[points.length - 1]
  const previous = points[points.length - 2]
  return (['aucJudd', 'cc', 'nss'] as MetricId[]).filter((metric) => {
    const delta = last.metrics[metric].mean - previous.metrics[metric].mean
    const noise = Math.hypot(last.metrics[metric].se, previous.metrics[metric].se)
    return delta > noise
  })
}

/** Nächste Punkte, wenn verlängert werden muss: jeweils Faktor ~1,5. */
export function extendedAlphas(alphas: readonly number[], steps = 2): number[] {
  const highest = Math.max(...alphas)
  return Array.from({ length: steps }, (_, i) => Math.round(highest * Math.pow(1.5, i + 1) * 10) / 10)
}

/**
 * Der eine erlaubte Blick auf den Test-Split: der ausgelieferte gegen den
 * gewählten Alpha-Wert, mit dem **ausgelieferten** Ortsprior (nicht mit einem
 * Fold-Prior — auf dem Test-Split läuft, was das Plugin tut).
 */
export type TestConfirmation = {
  setName: string
  duration: number
  imageCount: number
  alphas: number[]
  metrics: Map<number, Record<MetricId, Summary>>
  concentration: Map<number, Summary>
  truthConcentration: Summary
  paired: Map<number, PairedDelta[]>
  referenceAlpha: number
}

export async function confirmOnTest(options: {
  setName: string
  duration: number
  alphas: readonly number[]
  priorAsset: 'web' | 'mobile' | 'desktop' | 'poster'
  referenceAlpha: number
  onProgress?: (done: number) => void
}): Promise<TestConfirmation> {
  const alphas = [...new Set([options.referenceAlpha, ...options.alphas])].sort((a, b) => a - b)
  const baseParams: EngineParams = resolveParams('hybrid-v1')
  const scores = new Map<number, Map<string, MetricScores>>(alphas.map((alpha) => [alpha, new Map()]))
  const concentration = new Map<number, number[]>(alphas.map((alpha) => [alpha, []]))
  const truthConcentration: number[] = []
  const ids: string[] = []

  const engine = new HeuristicAttentionEngine({ configId: 'hybrid-v1', priorAsset: options.priorAsset })
  for (const sample of iterateSamples(options.setName, 'test', { duration: options.duration })) {
    const shape = { width: sample.grid.width, height: sample.grid.height }
    const features = await engine.computeFeatures({
      pixels: nodeImageOps.resize(sample.image, ...gridOf(sample)),
      signals: sample.signals,
      frameWidth: sample.frameWidth,
      frameHeight: sample.frameHeight,
    })
    const parts = combineFeatureParts(features, shape.width, shape.height, baseParams)
    if (!parts.imageTerm) throw new Error('Engine liefert keinen Bildanteil.')
    const prior = normalize01(features.positionPrior)

    for (const alpha of alphas) {
      const map: ScalarMap = { ...shape, values: blendAt(prior, parts.imageTerm, alpha) }
      scores.get(alpha)!.set(sample.id, scoreAll(map, sample.truth))
      concentration.get(alpha)!.push(concentrationOf(map))
    }
    truthConcentration.push(concentrationOf(sample.truth.salience))
    ids.push(sample.id)
    options.onProgress?.(ids.length)
  }

  const metrics = new Map<number, Record<MetricId, Summary>>()
  for (const alpha of alphas) {
    const perMetric = {} as Record<MetricId, Summary>
    for (const metric of METRIC_IDS) {
      perMetric[metric] = summarise(ids.map((id) => scores.get(alpha)!.get(id)![metric]))
    }
    metrics.set(alpha, perMetric)
  }

  const paired = new Map<number, PairedDelta[]>()
  const reference = scores.get(options.referenceAlpha)!
  for (const alpha of alphas) paired.set(alpha, pairedDelta(scores.get(alpha)!, reference, ids))

  return {
    setName: options.setName,
    duration: options.duration,
    imageCount: ids.length,
    alphas,
    metrics,
    concentration: new Map([...concentration].map(([alpha, values]) => [alpha, summarise(values)])),
    truthConcentration: summarise(truthConcentration),
    paired,
    referenceAlpha: options.referenceAlpha,
  }
}

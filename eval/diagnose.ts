/**
 * Diagnose — zwei Versuche zur Frage, woher die Vorhersagekraft von FigMaps 1.0
 * eigentlich kommt.
 *
 * **Kein Tuning.** Es wird nichts gespeichert, nichts ausgeliefert und keine
 * Konfiguration erzeugt; `src/engine/tuned.ts` bleibt unberührt. Läuft
 * ausschließlich auf dem **Tuning-Split**, der Test-Split wird nicht angefasst.
 *
 * Versuch 1 — Wie viel erklärt allein die Prior-Gewichtung?
 *   Der Positions-Prior wird von 0,1 auf 0,9 hochgezogen, die übrigen Features
 *   anteilig heruntergefahren. Schließt sich die Lücke zur Mean Map fast
 *   vollständig, sobald der Prior dominiert, tragen die Pixel-Features nichts.
 *
 * Versuch 2 — Trägt die Bildanalyse screen-spezifisches Signal?
 *   Mean Map als Basis, Bildanalyse additiv mit kleinem Gewicht obendrauf.
 *   Wird der Hybrid besser als die Mean Map allein, gibt es verwertbares
 *   Signal — und wir wissen, wie viel.
 *
 * Die Mean Map wird dabei **leave-one-out** gebildet: das jeweils bewertete
 * Bild fließt nicht in seine eigene Baseline ein. Sonst wäre der Vergleich auf
 * demselben Split, auf dem die Baseline entsteht, zu ihren Gunsten verzerrt.
 */
import { combineFeatures, HeuristicAttentionEngine } from '../src/engine/heuristic'
import { fitWithin } from '../src/engine/ops-pure'
import { ENGINE_CONFIG } from '../src/engine/config'
import { deviationScore } from '../src/engine/deviation'
import { cloneParams, HYBRID_BLEND_ALPHA, resolveParams, type EngineParams, type FeatureWeights } from '../src/engine/params'
import type { FeatureMaps, ScalarMap } from '../src/engine/types'
import { nodeImageOps } from '../src/platform/imageops-node'
import { iterateSamples, resizeScalarMap } from './dataset'
import { scoreAll } from './metrics'
import { METRIC_DIRECTION, METRIC_IDS, type MetricScores } from './metrics/types'
import { computeMeanMapAccumulator, leaveOneOutMean } from './mean-map'
import { spatialProfile, type SpatialProfile } from './runner'

/** Prior weights swept in experiment 1. */
export const PRIOR_WEIGHTS = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9]

/**
 * Additive weights swept in experiment 2.
 *
 * 0,05–0,3 is the range asked for. The larger values are there because the
 * curve turned out to be still rising at 0,3 — without them we would report
 * "the image analysis helps" without knowing whether that is a small effect or
 * the beginning of a big one. Everything beyond 0,3 is marked as such in the
 * report; none of it is a proposal for the shipped configuration.
 */
export const HYBRID_ALPHAS = [0.05, 0.1, 0.15, 0.2, 0.25, 0.3, 0.4, 0.5, 0.75, 1.0, 1.5]

/** Where the requested range ends — everything beyond is exploratory. */
export const REQUESTED_ALPHA_MAX = 0.3

/** Grid sizes the prior asset is tested at, to pick one on evidence. */
export const PRIOR_SIZES = [16, 32, 64, 128]

const PIXEL_KEYS: Array<keyof FeatureWeights> = ['luminanceContrast', 'colorOpponency', 'edgeDensity']

/**
 * Params with the position prior at `weight`, everything else scaled down
 * proportionally so the weights still sum to 1.
 */
export function paramsWithPriorWeight(base: EngineParams, weight: number): EngineParams {
  const params = cloneParams(base)
  const others = (Object.keys(base.weights) as Array<keyof FeatureWeights>).filter((key) => key !== 'positionPrior')
  const othersSum = others.reduce((sum, key) => sum + base.weights[key], 0)
  const scale = othersSum > 0 ? (1 - weight) / othersSum : 0

  for (const key of others) params.weights[key] = base.weights[key] * scale
  params.weights.positionPrior = weight
  return params
}

/** Params using only the image-derived features — no prior, no structure. */
export function pixelOnlyParams(base: EngineParams): EngineParams {
  const params = cloneParams(base)
  const sum = PIXEL_KEYS.reduce((total, key) => total + base.weights[key], 0)
  for (const key of Object.keys(params.weights) as Array<keyof FeatureWeights>) {
    params.weights[key] = PIXEL_KEYS.includes(key) && sum > 0 ? base.weights[key] / sum : 0
  }
  return params
}

/** `base + alpha * addition`, both normalised to `[0,1]` beforehand. */
function blend(base: ScalarMap, addition: ScalarMap, alpha: number): ScalarMap {
  const values = new Float32Array(base.values.length)
  for (let i = 0; i < values.length; i++) values[i] = base.values[i] + alpha * addition.values[i]
  return { width: base.width, height: base.height, values }
}

function normalise01(map: ScalarMap): ScalarMap {
  let min = Infinity
  let max = -Infinity
  for (const value of map.values) {
    if (value < min) min = value
    if (value > max) max = value
  }
  const range = max - min
  const values = new Float32Array(map.values.length)
  if (range > 1e-9) for (let i = 0; i < values.length; i++) values[i] = (map.values[i] - min) / range
  return { width: map.width, height: map.height, values }
}

/** Running mean over score sets, so nothing has to be kept in memory. */
class ScoreAccumulator {
  private readonly sums = new Map<string, MetricScores>()
  private readonly counts = new Map<string, number>()

  add(key: string, scores: MetricScores): void {
    const sum = this.sums.get(key) ?? { aucJudd: 0, cc: 0, nss: 0, kl: 0 }
    let count = this.counts.get(key) ?? 0
    let usable = true
    for (const id of METRIC_IDS) if (!Number.isFinite(scores[id])) usable = false
    if (!usable) return
    for (const id of METRIC_IDS) sum[id] += scores[id]
    count++
    this.sums.set(key, sum)
    this.counts.set(key, count)
  }

  mean(key: string): MetricScores {
    const sum = this.sums.get(key)
    const count = this.counts.get(key) ?? 0
    if (!sum || count === 0) return { aucJudd: Number.NaN, cc: Number.NaN, nss: Number.NaN, kl: Number.NaN }
    return { aucJudd: sum.aucJudd / count, cc: sum.cc / count, nss: sum.nss / count, kl: sum.kl / count }
  }
}

export type WinnerCase = {
  id: string
  /** CC of the engine minus CC of the leave-one-out mean map. */
  margin: number
  engineCc: number
  meanCc: number
  truthProfile: SpatialProfile
  aspect: number
  /** Share of ground-truth mass inside the strongest 5 % of pixels. */
  concentration: number
}

/** One sample's deviation score next to what the hybrid actually gained. */
export type DeviationCase = {
  id: string
  /** `1 - CC(image analysis, prior)`, mapped onto `[0,1]`. No ground truth. */
  deviation: number
  /** CC(hybrid) - CC(prior alone). Positive = the image analysis helped. */
  gain: number
  /** True when the hybrid beat the prior on its own. */
  helped: boolean
}

export type DeviationBucket = {
  label: string
  from: number
  to: number
  count: number
  helpedShare: number
  meanGain: number
}

export type DiagnoseResult = {
  setName: string
  split: string
  duration: number
  sampleCount: number
  /** Experiment 3: prior grid size -> mean scores of the prior alone. */
  priorSizes: Array<{ size: number; mean: MetricScores }>
  /** Part 2: does the deviation score predict where the image analysis helps? */
  deviation: {
    cases: DeviationCase[]
    /** Pearson correlation between deviation score and gain. */
    correlationWithGain: number
    /** Correlation between deviation score and "did it help at all". */
    correlationWithHelped: number
    buckets: DeviationBucket[]
    helpedShare: number
  }
  /** Experiment 1: prior weight -> mean scores. */
  priorSweep: Array<{ weight: number; mean: MetricScores }>
  /** Experiment 2: alpha -> mean scores, per additive term. */
  hybridPixel: Array<{ alpha: number; mean: MetricScores }>
  hybridEngine: Array<{ alpha: number; mean: MetricScores }>
  /** References scored on exactly the same samples. */
  meanMapAlone: MetricScores
  engineV1: MetricScores
  /** Per-image outcome against the leave-one-out mean map. */
  winners: WinnerCase[]
  losers: WinnerCase[]
  winCount: number
  /** Descriptive stats, winners vs the rest. */
  winnerProfile: SpatialProfile
  loserProfile: SpatialProfile
  winnerConcentration: number
  loserConcentration: number
  winnerAspect: number
  loserAspect: number
}

/** Share of total mass held by the strongest 5 % of pixels. */
function concentration(map: ScalarMap): number {
  const sorted = Float32Array.from(map.values).sort()
  const cut = Math.floor(sorted.length * 0.95)
  let top = 0
  let all = 0
  for (let i = 0; i < sorted.length; i++) {
    all += sorted[i]
    if (i >= cut) top += sorted[i]
  }
  return all > 0 ? top / all : 0
}

function meanOf(values: readonly number[]): number {
  return values.length === 0 ? Number.NaN : values.reduce((sum, value) => sum + value, 0) / values.length
}

/** Pearson correlation over two equally long series. */
function pearson(a: readonly number[], b: readonly number[]): number {
  const n = Math.min(a.length, b.length)
  if (n < 2) return Number.NaN
  const meanA = meanOf(a.slice(0, n))
  const meanB = meanOf(b.slice(0, n))
  let covariance = 0
  let varianceA = 0
  let varianceB = 0
  for (let i = 0; i < n; i++) {
    const da = a[i] - meanA
    const db = b[i] - meanB
    covariance += da * db
    varianceA += da * da
    varianceB += db * db
  }
  const denominator = Math.sqrt(varianceA * varianceB)
  return denominator > 1e-12 ? covariance / denominator : Number.NaN
}

function meanProfileOf(cases: readonly WinnerCase[]): SpatialProfile {
  if (cases.length === 0) return { centerX: 0.5, centerY: 0.5, spreadX: 0, spreadY: 0, topThird: 0 }
  const keys: Array<keyof SpatialProfile> = ['centerX', 'centerY', 'spreadX', 'spreadY', 'topThird']
  const out = {} as SpatialProfile
  for (const key of keys) out[key] = meanOf(cases.map((entry) => entry.truthProfile[key]))
  return out
}

export type DiagnoseOptions = {
  setName: string
  duration: number
  limit?: number
  onProgress?: (done: number, total: number, id: string) => void
}

export async function diagnose(options: DiagnoseOptions): Promise<DiagnoseResult> {
  const split = 'tuning' as const
  const base = resolveParams()
  const pixelParams = pixelOnlyParams(base)

  const accumulator = computeMeanMapAccumulator(options.setName, split, options.duration)
  const engine = new HeuristicAttentionEngine()
  const scores = new ScoreAccumulator()
  const cases: WinnerCase[] = []
  const deviationCases: DeviationCase[] = []

  const priorParams = PRIOR_WEIGHTS.map((weight) => ({ weight, params: paramsWithPriorWeight(base, weight) }))

  let done = 0
  for (const sample of iterateSamples(options.setName, split, { duration: options.duration, ...(options.limit ? { limit: options.limit } : {}) })) {
    // Features depend only on the image, not on the weights — computed once and
    // reused by all 1 + 9 + 12 configurations below.
    const grid = fitWithin(sample.image.width, sample.image.height, ENGINE_CONFIG.analysisEdge)
    const pixels = nodeImageOps.resize(sample.image, grid.width, grid.height)
    const features: FeatureMaps = await engine.computeFeatures({
      pixels,
      signals: sample.signals,
      frameWidth: sample.frameWidth,
      frameHeight: sample.frameHeight,
    })

    const shape = { width: sample.grid.width, height: sample.grid.height }
    const toMap = (values: Float32Array): ScalarMap => ({ ...shape, values })

    // --- references -------------------------------------------------------
    const meanMap = resizeScalarMap(leaveOneOutMean(accumulator, sample.truth.salience), shape.width, shape.height)
    const meanScoresHere = scoreAll(meanMap, sample.truth)
    scores.add('mean-map', meanScoresHere)

    const engineMap = toMap(combineFeatures(features, shape.width, shape.height, base))
    const engineScores = scoreAll(engineMap, sample.truth)
    scores.add('engine-v1', engineScores)

    // --- experiment 1: prior weight sweep ---------------------------------
    for (const entry of priorParams) {
      scores.add(`prior:${entry.weight}`, scoreAll(toMap(combineFeatures(features, shape.width, shape.height, entry.params)), sample.truth))
    }

    // --- experiment 2: mean map + image analysis --------------------------
    const pixelMap = normalise01(toMap(combineFeatures(features, shape.width, shape.height, pixelParams)))
    const engineNorm = normalise01(engineMap)
    const meanNorm = normalise01(meanMap)
    for (const alpha of HYBRID_ALPHAS) {
      scores.add(`hybrid-pixel:${alpha}`, scoreAll(blend(meanNorm, pixelMap, alpha), sample.truth))
      scores.add(`hybrid-engine:${alpha}`, scoreAll(blend(meanNorm, engineNorm, alpha), sample.truth))
    }

    // --- experiment 3: how coarse may the shipped prior be? ---------------
    // Same map, reduced to a grid and blown back up — the loss from shipping a
    // small asset, measured instead of assumed.
    for (const size of PRIOR_SIZES) {
      const coarse = resizeScalarMap(resizeScalarMap(meanNorm, size, size), shape.width, shape.height)
      scores.add(`prior-size:${size}`, scoreAll(coarse, sample.truth))
    }

    // --- part 2: deviation score ------------------------------------------
    // Both inputs are available at runtime without any ground truth.
    const deviation = deviationScore(pixelMap.values, meanNorm.values)
    const hybridScores = scoreAll(blend(meanNorm, pixelMap, HYBRID_BLEND_ALPHA), sample.truth)
    deviationCases.push({
      id: sample.id,
      deviation,
      gain: hybridScores.cc - meanScoresHere.cc,
      helped: hybridScores.cc > meanScoresHere.cc,
    })

    // --- per-image outcome ------------------------------------------------
    cases.push({
      id: sample.id,
      margin: engineScores.cc - meanScoresHere.cc,
      engineCc: engineScores.cc,
      meanCc: meanScoresHere.cc,
      truthProfile: spatialProfile(sample.truth.salience),
      aspect: sample.image.width / sample.image.height,
      concentration: concentration(sample.truth.salience),
    })

    done++
    options.onProgress?.(done, 0, sample.id)
  }

  cases.sort((a, b) => b.margin - a.margin)
  const winners = cases.filter((entry) => entry.margin > 0)
  const losers = cases.filter((entry) => entry.margin <= 0)

  // Quintiles rather than fixed cut points: the score's distribution is not
  // known in advance, and fixed bounds would pile four fifths of the screens
  // into one bucket and hide any relationship there might be.
  const ordered = [...deviationCases].sort((a, b) => a.deviation - b.deviation)
  const buckets: DeviationBucket[] = []
  const BUCKETS = 5
  for (let i = 0; i < BUCKETS; i++) {
    const from = Math.floor((i * ordered.length) / BUCKETS)
    const to = Math.floor(((i + 1) * ordered.length) / BUCKETS)
    const inBucket = ordered.slice(from, to)
    if (inBucket.length === 0) continue
    buckets.push({
      label: `${inBucket[0].deviation.toFixed(2)}–${inBucket[inBucket.length - 1].deviation.toFixed(2)}`,
      from: inBucket[0].deviation,
      to: inBucket[inBucket.length - 1].deviation,
      count: inBucket.length,
      helpedShare: inBucket.filter((entry) => entry.helped).length / inBucket.length,
      meanGain: meanOf(inBucket.map((entry) => entry.gain)),
    })
  }

  const deviations = deviationCases.map((entry) => entry.deviation)
  const gains = deviationCases.map((entry) => entry.gain)
  const helped: number[] = deviationCases.map((entry) => (entry.helped ? 1 : 0))

  return {
    setName: options.setName,
    split,
    duration: options.duration,
    sampleCount: cases.length,
    priorSizes: PRIOR_SIZES.map((size) => ({ size, mean: scores.mean(`prior-size:${size}`) })),
    deviation: {
      cases: deviationCases,
      correlationWithGain: pearson(deviations, gains),
      correlationWithHelped: pearson(deviations, helped),
      buckets,
      helpedShare: deviationCases.length === 0 ? Number.NaN : helped.reduce((sum, v) => sum + v, 0) / helped.length,
    },
    priorSweep: PRIOR_WEIGHTS.map((weight) => ({ weight, mean: scores.mean(`prior:${weight}`) })),
    hybridPixel: HYBRID_ALPHAS.map((alpha) => ({ alpha, mean: scores.mean(`hybrid-pixel:${alpha}`) })),
    hybridEngine: HYBRID_ALPHAS.map((alpha) => ({ alpha, mean: scores.mean(`hybrid-engine:${alpha}`) })),
    meanMapAlone: scores.mean('mean-map'),
    engineV1: scores.mean('engine-v1'),
    winners,
    losers,
    winCount: winners.length,
    winnerProfile: meanProfileOf(winners),
    loserProfile: meanProfileOf(losers),
    winnerConcentration: meanOf(winners.map((entry) => entry.concentration)),
    loserConcentration: meanOf(losers.map((entry) => entry.concentration)),
    winnerAspect: meanOf(winners.map((entry) => entry.aspect)),
    loserAspect: meanOf(losers.map((entry) => entry.aspect)),
  }
}

/** The direction-aware improvement of `value` over `reference`. */
export function improvement(value: number, reference: number, metric: keyof MetricScores): number {
  return (value - reference) * METRIC_DIRECTION[metric]
}

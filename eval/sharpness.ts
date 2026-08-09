/**
 * 1.2 A6 — Schärfe.
 *
 * A1 hat den Befund geliefert und `blendAlpha` als Hebel ausgeschlossen: die
 * Ground Truth hält 48,2 % ihrer Masse in den stärksten 5 % der Pixel, unsere
 * Karte 14,1 %, und ein höheres α macht das **schlechter**. Was die Form der
 * Verteilung tatsächlich formt, sind die drei Nachbearbeitungsschritte des
 * Bildanteils plus ein vierter, der 1.1 ausgebaut wurde:
 *
 *   `post.blurSigmaRatio`   Weichzeichnung, als Anteil der langen Analysekante
 *   `post.gamma`            Tonkurve **innerhalb** des Bildanteils
 *   `post.clip{Low,High}Percentile`  wo unten abgeschnitten und oben gesättigt wird
 *   `blendGamma`            Tonkurve über der **fertigen** Karte
 *
 * Der vierte ist der eigentliche Anlass: er wurde beim Einbau von `hybrid-v1`
 * entfernt, **weil er KL verschlechterte** (1,115 statt 1,078). Das ist genau
 * das Kriterium, das nach A3 hier nicht entscheiden darf — KL bestraft
 * Zuspitzung, und Zuspitzung ist die gesuchte Eigenschaft. Der Hebel kommt
 * deshalb als Parameter zurück und wird an AUC, CC und NSS gemessen.
 *
 * Aufbau in zwei Stufen, bewusst kein volles Gitter:
 *
 *   1. **Ein Hebel nach dem anderen**, jeweils um den ausgelieferten Wert
 *      herum. Das liefert vier lesbare Kurven statt einer Punktwolke und sagt,
 *      welcher Hebel überhaupt trägt.
 *   2. **Kombinationen** aus dem, was Stufe 1 ergeben hat. Vier Hebel, die
 *      alle an derselben Verteilung ziehen, sind nicht unabhängig; wer nur
 *      Stufe 1 addiert, misst eine Konfiguration, die er nie ausgewertet hat.
 *
 * Gemessen wird wie bei `alpha.ts`: 5-fache Kreuzvalidierung, **nur auf dem
 * Tuning-Split**, Ortsprior je Fold aus den übrigen Folds und in der
 * ausgelieferten 8-Bit-Form. Der teure Teil — `computeFeatures` — läuft einmal
 * je Bild; die Varianten unterscheiden sich erst danach.
 */
import { existsSync } from 'node:fs'
import { ENGINE_CONFIG } from '../src/engine/config'
import { combineFeatureParts, HeuristicAttentionEngine } from '../src/engine/heuristic'
import { fitWithin } from '../src/engine/ops-pure'
import { cloneParams, resolveParams, type EngineParams } from '../src/engine/params'
import { resamplePrior } from '../src/engine/priors'
import type { ScalarMap } from '../src/engine/types'
import { nodeImageOps } from '../src/platform/imageops-node'
import { concentrationOf, quantilesOf, summarise } from './alpha'
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

/** Welcher der vier Hebel eine Variante bewegt. `basis` ist der Ist-Zustand. */
export type LeverId = 'basis' | 'blur' | 'gamma' | 'clip' | 'blendGamma' | 'kombination'

export const LEVER_LABELS: Record<LeverId, string> = {
  basis: 'ausgeliefert (Referenz)',
  blur: 'post.blurSigmaRatio — Weichzeichnung des Bildanteils',
  gamma: 'post.gamma — Tonkurve im Bildanteil',
  clip: 'post.clip{Low,High}Percentile — Sockel und Sättigung',
  blendGamma: 'blendGamma — Tonkurve über der fertigen Karte',
  kombination: 'Kombinationen aus Stufe 1',
}

export type Variant = {
  id: string
  lever: LeverId
  /** Kurzform für die Tabelle, z. B. „0,015" oder „p10/p99". */
  label: string
  params: EngineParams
}

/** Der ausgelieferte Stand — jede Variante ist eine Abweichung davon. */
export function baseParams(): EngineParams {
  return cloneParams(resolveParams('hybrid-v1'))
}

/**
 * Die Nachbearbeitung, wie sie **vor** 1.2 A6 aussah: Blur 0,025 und kein
 * Gamma über der fertigen Karte.
 *
 * Existiert als benannte Variante, damit „vorher gegen nachher" — im
 * Prüfbogen wie in der Nebenwirkungsmessung — denselben Parametersatz meint
 * und nicht einen, der ihm ähnlich sieht. Der Rest, `blendAlpha` 0,5
 * eingeschlossen, bleibt der heutige: verglichen wird **eine** Änderung.
 */
export function beforeSharpnessVariant(): Variant {
  const params = baseParams()
  params.post = { ...params.post, blurSigmaRatio: 0.025 }
  delete params.blendGamma
  return { id: 'vor-a6', lever: 'basis', label: 'vor 1.2 A6 (Blur 0,025, kein blendGamma)', params }
}

function withPost(patch: Partial<EngineParams['post']>, extra: Partial<EngineParams> = {}): EngineParams {
  const params = baseParams()
  params.post = { ...params.post, ...patch }
  return { ...params, ...extra }
}

/** Kommazahl in deutscher Schreibweise, für die Tabellen. */
function de(value: number): string {
  return String(value).replace('.', ',')
}

/**
 * Stufe 1 — ein Hebel nach dem anderen.
 *
 * Die Gitter sind um den ausgelieferten Wert gelegt und reichen in beide
 * Richtungen weit genug, um ein Optimum *innerhalb* der Kurve zu sehen. Eine
 * Kurve, deren bester Punkt am Rand liegt, ist keine Kurve, sondern ein Pfeil.
 */
export function stageOneVariants(): Variant[] {
  const out: Variant[] = [{ id: 'basis', lever: 'basis', label: 'Ist-Zustand', params: baseParams() }]

  // Weichzeichnung: 0,025 auf der 512er-Kante sind σ ≈ 12,8 px. Nach unten bis
  // σ ≈ 3 px, nach oben ein Punkt zur Kontrolle der Richtung.
  for (const ratio of [0.006, 0.01, 0.015, 0.02, 0.035]) {
    out.push({ id: `blur-${ratio}`, lever: 'blur', label: de(ratio), params: withPost({ blurSigmaRatio: ratio }) })
  }

  // Gamma im Bildanteil. Unter 1 hebt schwache Werte an (glättet), über 1
  // drückt sie herunter (spitzt zu). Ausgeliefert ist 0,8 — also glättend.
  for (const gamma of [0.6, 1.0, 1.4, 2.0, 2.8, 4.0]) {
    out.push({ id: `gamma-${gamma}`, lever: 'gamma', label: de(gamma), params: withPost({ gamma }) })
  }

  // Clip. Der untere Wert schneidet den Sockel ab und ist der wirksamere:
  // alles unter p_low wird exakt 0 und trägt keine Masse mehr.
  for (const [low, high] of [
    [5, 99],
    [10, 99],
    [20, 99],
    [40, 99],
    [60, 99],
    [1, 95],
    [1, 99.9],
    [20, 99.9],
  ] as Array<[number, number]>) {
    out.push({
      id: `clip-${low}-${high}`,
      lever: 'clip',
      label: `p${de(low)}/p${de(high)}`,
      params: withPost({ clipLowPercentile: low, clipHighPercentile: high }),
    })
  }

  // Gamma über der fertigen Karte — der 1.1 wegen KL ausgebaute Hebel.
  for (const blendGamma of [1.3, 1.6, 2.0, 2.5, 3.5]) {
    out.push({
      id: `blendgamma-${blendGamma}`,
      lever: 'blendGamma',
      label: de(blendGamma),
      params: { ...baseParams(), blendGamma },
    })
  }

  return out
}

export type SharpnessPoint = {
  variant: Variant
  metrics: Record<MetricId, Summary>
  concentration: Summary
  concentrationQuantiles: number[]
  /** Gepaarte Differenz gegen den Ist-Zustand, richtungskorrigiert (+ = besser). */
  versusBasis: Record<MetricId, { mean: number; se: number; ci95: [number, number]; winRate: number }>
}

export type SharpnessResult = {
  setName: string
  split: SplitName
  duration: number
  folds: number
  imageCount: number
  points: SharpnessPoint[]
  truthConcentration: Summary
  truthConcentrationQuantiles: number[]
}

export type SharpnessOptions = {
  setName: string
  duration: number
  variants: readonly Variant[]
  folds?: number
  split?: SplitName
  limit?: number
  onProgress?: (done: number, total: number) => void
}

/** Analyseraster, das die Engine für dieses Bild verwenden würde. */
export function gridOf(sample: EvalSample): [number, number] {
  const grid = fitWithin(sample.image.width, sample.image.height, ENGINE_CONFIG.analysisEdge)
  return [grid.width, grid.height]
}

function quantisePrior(meanField: Float32Array, sourceSize: number, targetSize: number): Uint8Array {
  const map: ScalarMap = { width: sourceSize, height: sourceSize, values: meanField }
  const reduced = targetSize === sourceSize ? map : resizeScalarMap(map, targetSize, targetSize)
  const bytes = new Uint8Array(targetSize * targetSize)
  for (let i = 0; i < bytes.length; i++) bytes[i] = Math.round(Math.max(0, Math.min(1, reduced.values[i])) * 255)
  return bytes
}

/** Ortsprior je Fold, ausschließlich aus den übrigen Folds — wie `crossval.ts`. */
export function fitFoldPriors(
  setName: string,
  duration: number,
  ids: readonly string[],
  foldOf: Map<string, number>,
  folds: number,
): Uint8Array[] {
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
  if (totalCount === 0) throw new Error(`Schärfe-Sweep: keine Ground Truth in "${setName}".`)

  return Array.from({ length: folds }, (_, fold) => {
    const count = totalCount - foldCounts[fold]
    const values = new Float32Array(total.length)
    let max = 0
    for (let i = 0; i < values.length; i++) {
      const value = (total[i] - foldSums[fold][i]) / count
      values[i] = value > 0 ? value : 0
      if (values[i] > max) max = values[i]
    }
    if (max > 0) for (let i = 0; i < values.length; i++) values[i] /= max
    return quantisePrior(values, size, PRIOR_GRID)
  })
}

export async function sharpnessSweep(options: SharpnessOptions): Promise<SharpnessResult> {
  const { setName, duration, variants } = options
  const split = options.split ?? 'tuning'
  const folds = options.folds ?? 5

  const allIds = listSplit(setName, split)
  const ids = options.limit ? allIds.slice(0, options.limit) : allIds
  const foldOf = assignFolds(ids, folds)
  const foldPriors = fitFoldPriors(setName, duration, ids, foldOf, folds)
  const wanted = new Set(ids)

  const scores = new Map<string, Map<string, MetricScores>>(variants.map((variant) => [variant.id, new Map()]))
  const concentration = new Map<string, number[]>(variants.map((variant) => [variant.id, []]))
  const truthConcentration: number[] = []
  const seen: string[] = []

  for (const sample of iterateSamples(setName, split, { duration })) {
    if (!wanted.has(sample.id)) continue
    const fold = foldOf.get(sample.id)
    if (fold === undefined) continue

    const shape = { width: sample.grid.width, height: sample.grid.height }
    const priorForFold = resamplePrior(foldPriors[fold], PRIOR_GRID, PRIOR_GRID, shape.width, shape.height)
    const engine = new HeuristicAttentionEngine({ configId: 'hybrid-v1', priorProvider: () => priorForFold })

    // Der teure Schritt, einmal je Bild. Alles, was die Varianten unterscheidet,
    // passiert danach — in derselben Funktion, die auch das Plugin ruft.
    const features = await engine.computeFeatures({
      pixels: nodeImageOps.resize(sample.image, ...gridOf(sample)),
      signals: sample.signals,
      frameWidth: sample.frameWidth,
      frameHeight: sample.frameHeight,
    })

    for (const variant of variants) {
      const parts = combineFeatureParts(features, shape.width, shape.height, variant.params)
      const map: ScalarMap = { ...shape, values: parts.attention }
      scores.get(variant.id)!.set(sample.id, scoreAll(map, sample.truth))
      concentration.get(variant.id)!.push(concentrationOf(map))
    }

    truthConcentration.push(concentrationOf(sample.truth.salience))
    seen.push(sample.id)
    options.onProgress?.(seen.length, ids.length)
  }

  const basisScores = scores.get('basis')
  const points: SharpnessPoint[] = variants.map((variant) => {
    const own = scores.get(variant.id)!
    const metrics = {} as Record<MetricId, Summary>
    const versusBasis = {} as SharpnessPoint['versusBasis']
    for (const metric of METRIC_IDS) {
      metrics[metric] = summarise(seen.map((id) => own.get(id)![metric]))
      const direction = metric === 'kl' ? -1 : 1
      const differences = basisScores
        ? seen
            .map((id) => (own.get(id)![metric] - basisScores.get(id)![metric]) * direction)
            .filter((value) => Number.isFinite(value))
        : []
      const summary = summarise(differences)
      const margin = 1.96 * summary.se
      versusBasis[metric] = {
        mean: summary.mean,
        se: summary.se,
        ci95: [summary.mean - margin, summary.mean + margin],
        winRate: differences.length > 0 ? differences.filter((value) => value > 0).length / differences.length : Number.NaN,
      }
    }
    const samples = concentration.get(variant.id)!
    return {
      variant,
      metrics,
      concentration: summarise(samples),
      concentrationQuantiles: quantilesOf(samples),
      versusBasis,
    }
  })

  return {
    setName,
    split,
    duration,
    folds,
    imageCount: seen.length,
    points,
    truthConcentration: summarise(truthConcentration),
    truthConcentrationQuantiles: quantilesOf(truthConcentration),
  }
}

/**
 * Stufe 2 — Kombinationen aus dem, was Stufe 1 ergeben hat.
 *
 * „Bester Punkt je Hebel" heißt drei Dinge gleichzeitig:
 *
 *   1. nicht schlechter als der Ist-Zustand in AUC, CC und NSS (das
 *      95-%-Intervall der gepaarten Differenz liegt nicht ganz unter Null),
 *   2. **schärfer** als der Ist-Zustand — sonst trägt der Hebel nichts zur
 *      Frage bei, auch wenn er die Metriken hebt,
 *   3. und unter den Übrigbleibenden der mit der höchsten Konzentration.
 *
 * Bedingung (2) steht hier, weil sie ohne sie fehlte: `post.blurSigmaRatio`
 * 0,035 hält die Metriken (sogar besser) und *senkt* die Konzentration von
 * 0,133 auf 0,131. Als einziger überlebender Wert seines Hebels wäre er
 * gewählt worden — und hätte eine Kombination in die falsche Richtung gezogen.
 *
 * Beides muss in **jeder** Kategorie gelten. Ein Gewinn, der nur auf Webseiten
 * trägt, ist kein Gewinn für das Plugin.
 */
export function stageTwoVariants(stageOne: readonly SharpnessResult[]): Variant[] {
  const levers: LeverId[] = ['blur', 'gamma', 'clip', 'blendGamma']
  const winners = new Map<LeverId, Variant>()

  for (const lever of levers) {
    let best: { point: SharpnessPoint; concentration: number } | null = null
    // Ein Kandidat muss die Bedingung in **jeder** Kategorie erfüllen; ein
    // Gewinn, der nur auf Webseiten trägt, ist kein Gewinn für das Plugin.
    const candidates = stageOne[0].points.filter((point) => point.variant.lever === lever)
    for (const candidate of candidates) {
      const holdsEverywhere = stageOne.every((result) => {
        const point = result.points.find((entry) => entry.variant.id === candidate.variant.id)
        if (!point) return false
        return (['aucJudd', 'cc', 'nss'] as MetricId[]).every((metric) => point.versusBasis[metric].ci95[1] >= 0)
      })
      if (!holdsEverywhere) continue
      // (2) — schärfer als der Ist-Zustand, in jeder Kategorie.
      const sharperEverywhere = stageOne.every((result) => {
        const point = result.points.find((entry) => entry.variant.id === candidate.variant.id)
        const basis = result.points.find((entry) => entry.variant.id === 'basis')
        return point !== undefined && basis !== undefined && point.concentration.mean > basis.concentration.mean
      })
      if (!sharperEverywhere) continue
      const meanConcentration =
        stageOne.reduce(
          (sum, result) => sum + (result.points.find((entry) => entry.variant.id === candidate.variant.id)?.concentration.mean ?? 0),
          0,
        ) / stageOne.length
      if (!best || meanConcentration > best.concentration) best = { point: candidate, concentration: meanConcentration }
    }
    if (best) winners.set(lever, best.point.variant)
  }

  const out: Variant[] = [{ id: 'basis', lever: 'basis', label: 'Ist-Zustand', params: baseParams() }]
  const chosen = [...winners.entries()]
  if (chosen.length === 0) return out

  // Alle nichtleeren Teilmengen wären 2^4; das ist mehr, als eine Tabelle
  // lesbar macht. Genommen werden die Paare und die Gesamtkombination — das
  // beantwortet „ziehen zwei Hebel am selben Effekt?" und „hält es zusammen?".
  for (let a = 0; a < chosen.length; a++) {
    for (let b = a + 1; b < chosen.length; b++) {
      out.push(merge([chosen[a][1], chosen[b][1]]))
    }
  }
  if (chosen.length > 2) out.push(merge(chosen.map(([, variant]) => variant)))
  return out
}

/** Verschmilzt mehrere Ein-Hebel-Varianten zu einer. */
function merge(variants: readonly Variant[]): Variant {
  const params = baseParams()
  const basis = baseParams()
  for (const variant of variants) {
    for (const key of ['blurSigmaRatio', 'clipLowPercentile', 'clipHighPercentile', 'gamma'] as const) {
      if (variant.params.post[key] !== basis.post[key]) params.post[key] = variant.params.post[key]
    }
    if (variant.params.blendGamma !== undefined) params.blendGamma = variant.params.blendGamma
  }
  const label = variants.map((variant) => `${variant.lever} ${variant.label}`).join(' + ')
  return { id: `kombi-${variants.map((variant) => variant.id).join('_')}`, lever: 'kombination', label, params }
}

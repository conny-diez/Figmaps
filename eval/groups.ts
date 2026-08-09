/**
 * 1.2 A7 — wirkt `blendGamma` auf beide Hälften des Datensatzes gleich?
 *
 * DIE FRAGE. Der Schärfe-Sweep hat über *alle* Bilder gemittelt und ein
 * eindeutiges Ergebnis geliefert. Ein Mittelwert kann aber zwei gegenläufige
 * Effekte verdecken, und hier gibt es einen konkreten Verdacht dafür: die
 * Mean-Map-Diagnose teilt den Datensatz in zwei Gruppen — Screens, auf denen
 * unsere Vorhersage die Mean Map schlägt, und solche, auf denen sie es nicht
 * tut. Die erste Gruppe ist die hero-dominierte Minderheit; die zweite ist die
 * konventionelle Mehrheit, auf der ein Ortsprior allein schon reicht.
 *
 * **Die Minderheit ist der Fall, für den das Plugin existiert.** Ein Screen,
 * dessen Aufmerksamkeit man aus der Position allein vorhersagen kann, braucht
 * keine Bildanalyse. Ein Parameter, der den Mittelwert hebt, indem er die
 * Mehrheit verbessert und die Minderheit verschlechtert, verbessert die Zahl
 * und verschlechtert das Produkt.
 *
 * DIE GRUPPEN SIND FEST, NICHT MITWANDERND. Sie werden **einmal** bestimmt, auf
 * der Konfiguration *vor* der Schärfe-Änderung (α 0,5, Blur 0,025, kein
 * `blendGamma`), und für jeden gemessenen `blendGamma`-Wert unverändert
 * verwendet. Würde die Zugehörigkeit mit dem Parameter neu berechnet, verglichen
 * man zwei verschiedene Populationen und bekäme garantiert ein Ergebnis — nur
 * keins über den Parameter.
 *
 * Die Mean Map je Fold ist dieselbe wie überall: aus den übrigen Folds
 * geschätzt, nie aus dem Bild, gegen das sie antritt.
 */
import { existsSync } from 'node:fs'
import { combineFeatureParts, HeuristicAttentionEngine } from '../src/engine/heuristic'
import { cloneParams, type EngineParams } from '../src/engine/params'
import { resamplePrior } from '../src/engine/priors'
import type { ScalarMap } from '../src/engine/types'
import { nodeImageOps } from '../src/platform/imageops-node'
import { concentrationOf, quantilesOf, summarise } from './alpha'
import { assignFolds, PRIOR_GRID, type Summary } from './crossval'
import { heatmapPath, iterateSamples, listSplit, readPng, resizeScalarMap, toScalarMap, type SplitName } from './dataset'
import { MEAN_MAP_GRID } from './mean-map'
import { scoreAll } from './metrics'
import { METRIC_IDS, type MetricId, type MetricScores } from './metrics/types'
import { baseParams, beforeSharpnessVariant, fitFoldPriors, gridOf } from './sharpness'

export type GroupId = 'gewinner' | 'verlierer'

export const GROUP_LABELS: Record<GroupId, string> = {
  gewinner: 'Gewinner — Vorhersage schlägt die Mean Map (hero-dominiert)',
  verlierer: 'Verlierer — die Mean Map ist mindestens so gut (konventionell)',
}

export type GroupPoint = {
  blendGamma: number
  metrics: Record<MetricId, Summary>
  concentration: Summary
  /** Gepaarte Differenz gegen `blendGamma` = 1, richtungskorrigiert. */
  versusNoGamma: Record<MetricId, { mean: number; se: number; ci95: [number, number]; winRate: number }>
}

export type GroupResult = {
  group: GroupId
  imageCount: number
  /** Konzentration der **Ground Truth** in dieser Gruppe — prüft „hero-dominiert". */
  truthConcentration: Summary
  truthConcentrationQuantiles: number[]
  /** Wie weit die Vorhersage die Mean Map schlägt, im Referenzzustand. */
  referenceMargin: Summary
  points: GroupPoint[]
}

export type GroupSweepResult = {
  setName: string
  duration: number
  folds: number
  imageCount: number
  blendGammas: number[]
  groups: GroupResult[]
}

export type GroupSweepOptions = {
  setName: string
  duration: number
  blendGammas: readonly number[]
  folds?: number
  split?: SplitName
  limit?: number
  onProgress?: (done: number, total: number) => void
}

/** Die Mean-Map-Schätzung eines Folds, auf dem 128er-Raster. */
function foldMeanFields(
  setName: string,
  duration: number,
  ids: readonly string[],
  foldOf: Map<string, number>,
  folds: number,
): Float32Array[] {
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
  if (totalCount === 0) throw new Error(`Gruppen-Sweep: keine Ground Truth in "${setName}".`)

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
    return values
  })
}

function withGamma(blendGamma: number): EngineParams {
  const params = baseParams()
  params.blendGamma = blendGamma
  return params
}

export async function groupSweep(options: GroupSweepOptions): Promise<GroupSweepResult> {
  const { setName, duration } = options
  const split = options.split ?? 'tuning'
  const folds = options.folds ?? 5
  const blendGammas = [...new Set([1, ...options.blendGammas])].sort((a, b) => a - b)

  const allIds = listSplit(setName, split)
  const ids = options.limit ? allIds.slice(0, options.limit) : allIds
  const foldOf = assignFolds(ids, folds)
  const priors = fitFoldPriors(setName, duration, ids, foldOf, folds)
  const meanFields = foldMeanFields(setName, duration, ids, foldOf, folds)
  const wanted = new Set(ids)

  // Der Referenzzustand, in dem die Gruppen bestimmt werden — einmal, fest.
  const referenceParams = cloneParams(beforeSharpnessVariant().params)

  const groupOf = new Map<string, GroupId>()
  const margins = new Map<string, number>()
  const truthConcentration = new Map<string, number>()
  const scores = new Map<number, Map<string, MetricScores>>(blendGammas.map((gamma) => [gamma, new Map()]))
  const concentration = new Map<number, Map<string, number>>(blendGammas.map((gamma) => [gamma, new Map()]))
  const seen: string[] = []

  for (const sample of iterateSamples(setName, split, { duration })) {
    if (!wanted.has(sample.id)) continue
    const fold = foldOf.get(sample.id)
    if (fold === undefined) continue

    const shape = { width: sample.grid.width, height: sample.grid.height }
    const priorForFold = resamplePrior(priors[fold], PRIOR_GRID, PRIOR_GRID, shape.width, shape.height)
    const engine = new HeuristicAttentionEngine({ configId: 'hybrid-v1', priorProvider: () => priorForFold })
    const features = await engine.computeFeatures({
      pixels: nodeImageOps.resize(sample.image, ...gridOf(sample)),
      signals: sample.signals,
      frameWidth: sample.frameWidth,
      frameHeight: sample.frameHeight,
    })

    // --- Gruppenzuordnung, im Referenzzustand -------------------------------
    const reference: ScalarMap = {
      ...shape,
      values: combineFeatureParts(features, shape.width, shape.height, referenceParams).attention,
    }
    const meanMapForFold = resizeScalarMap(
      { width: MEAN_MAP_GRID, height: MEAN_MAP_GRID, values: meanFields[fold] },
      shape.width,
      shape.height,
    )
    const margin = scoreAll(reference, sample.truth).cc - scoreAll(meanMapForFold, sample.truth).cc
    groupOf.set(sample.id, margin > 0 ? 'gewinner' : 'verlierer')
    margins.set(sample.id, margin)
    truthConcentration.set(sample.id, concentrationOf(sample.truth.salience))

    // --- die eigentliche Messung -------------------------------------------
    for (const gamma of blendGammas) {
      const map: ScalarMap = {
        ...shape,
        values: combineFeatureParts(features, shape.width, shape.height, withGamma(gamma)).attention,
      }
      scores.get(gamma)!.set(sample.id, scoreAll(map, sample.truth))
      concentration.get(gamma)!.set(sample.id, concentrationOf(map))
    }

    seen.push(sample.id)
    options.onProgress?.(seen.length, ids.length)
  }

  const groups: GroupResult[] = (['gewinner', 'verlierer'] as GroupId[]).map((group) => {
    const members = seen.filter((id) => groupOf.get(id) === group)
    const truthSamples = members.map((id) => truthConcentration.get(id)!)
    const points: GroupPoint[] = blendGammas.map((gamma) => {
      const own = scores.get(gamma)!
      const reference = scores.get(1)!
      const metrics = {} as Record<MetricId, Summary>
      const versusNoGamma = {} as GroupPoint['versusNoGamma']
      for (const metric of METRIC_IDS) {
        metrics[metric] = summarise(members.map((id) => own.get(id)![metric]))
        const direction = metric === 'kl' ? -1 : 1
        const differences = members
          .map((id) => (own.get(id)![metric] - reference.get(id)![metric]) * direction)
          .filter((value) => Number.isFinite(value))
        const summary = summarise(differences)
        const margin = 1.96 * summary.se
        versusNoGamma[metric] = {
          mean: summary.mean,
          se: summary.se,
          ci95: [summary.mean - margin, summary.mean + margin],
          winRate: differences.filter((value) => value > 0).length / differences.length,
        }
      }
      return {
        blendGamma: gamma,
        metrics,
        concentration: summarise(members.map((id) => concentration.get(gamma)!.get(id)!)),
        versusNoGamma,
      }
    })

    return {
      group,
      imageCount: members.length,
      truthConcentration: summarise(truthSamples),
      truthConcentrationQuantiles: quantilesOf(truthSamples),
      referenceMargin: summarise(members.map((id) => margins.get(id)!)),
      points,
    }
  })

  return { setName, duration, folds, imageCount: seen.length, blendGammas, groups }
}

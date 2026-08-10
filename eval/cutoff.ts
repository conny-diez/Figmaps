/**
 * 1.2 A8 — die Transparenzschwelle des Renderers auf die neue Verteilung
 * nachziehen.
 *
 * DAS PROBLEM. `ENGINE_CONFIG.render.transparencyCutoff` (0,08) und
 * `transparencyRamp` (0,12) sind **Werte**, keine Anteile: alles unter 0,08
 * wird gar nicht gezeichnet, zwischen 0,08 und 0,20 blendet das Overlay ein.
 * Beide Zahlen wurden an einer Karte gewählt, deren Masse breiter lag. Die
 * zugespitzte Karte aus 1.2 A6 schiebt Fläche unter dieselbe Schwelle — das
 * Bild wirkt leerer, ohne dass die Vorhersage dort etwas anderes sagt.
 *
 * Auf dem A4-Prüffall ist genau das zu sehen: der gelbe CTA fällt von 0,370 auf
 * 0,133. Ein Teil davon ist die Engine (die Karte ist wirklich selektiver
 * geworden), ein Teil ist der Renderer (dieselbe Schwelle auf einer anderen
 * Verteilung). Dieses Modul trennt die beiden.
 *
 * DIE REGEL, NACH DER NACHGEZOGEN WIRD. Die Schwelle soll **denselben Anteil
 * der Karte ausblenden wie bisher**. Nicht denselben Wert behalten — der Wert
 * ist beliebig, sobald sich die Verteilung ändert; und nicht „nach Augenmaß
 * schöner", weil das genau die Sorte Kalibrierung wäre, die dieses Projekt
 * loswerden will. Gemessen wird also:
 *
 *   1. auf der **alten** Karte: welcher Anteil der Pixel liegt unter 0,08?
 *      Und welcher unter 0,20 (dem Ende der Rampe)?
 *   2. auf der **neuen** Karte: bei welchem Wert liegen dieselben Anteile?
 *
 * Das Ergebnis ist eine Zahl mit einer Herkunft statt eines Geschmacksurteils.
 * Was es ausdrücklich **nicht** ist: eine Aussage darüber, ob die alte Schwelle
 * gut war. Sie wird übernommen, nicht geprüft — die Frage „wie viel Karte soll
 * ein Overlay verdecken" hat keine Ground Truth und gehört an einen Menschen.
 */
import { combineFeatureParts, HeuristicAttentionEngine } from '../src/engine/heuristic'
import { ENGINE_CONFIG } from '../src/engine/config'
import { resamplePrior } from '../src/engine/priors'
import { nodeImageOps } from '../src/platform/imageops-node'
import { summarise } from './alpha'
import { assignFolds, PRIOR_GRID, type Summary } from './crossval'
import { iterateSamples, listSplit, type SplitName } from './dataset'
import { baseParams, beforeSharpnessVariant, fitFoldPriors, gridOf } from './sharpness'

export type CutoffResult = {
  setName: string
  imageCount: number
  /** Die Schwellen, von denen ausgegangen wurde. */
  oldCutoff: number
  oldRampEnd: number
  /** Anteil der Pixel unter den alten Schwellen, auf der **alten** Karte. */
  hiddenShare: Summary
  rampedShare: Summary
  /** Werte, an denen dieselben Anteile auf der **neuen** Karte liegen. */
  newCutoff: Summary
  newRampEnd: Summary
  /** Anteil, den die alte Schwelle auf der **neuen** Karte ausblenden würde. */
  hiddenShareUnchanged: Summary
}

export type CutoffOptions = {
  setName: string
  duration: number
  folds?: number
  split?: SplitName
  limit?: number
  onProgress?: (done: number, total: number) => void
}

/** Anteil der Werte unter `threshold`. */
function shareBelow(values: Float32Array, threshold: number): number {
  let below = 0
  for (let i = 0; i < values.length; i++) if (values[i] < threshold) below++
  return below / values.length
}

/** Der Wert, unter dem `share` der Pixel liegen. */
function valueAtShare(values: Float32Array, share: number): number {
  const sorted = Float32Array.from(values).sort()
  const index = Math.min(sorted.length - 1, Math.max(0, Math.floor(share * sorted.length)))
  return sorted[index]
}

export async function measureCutoff(options: CutoffOptions): Promise<CutoffResult> {
  const { setName, duration } = options
  const split = options.split ?? 'tuning'
  const folds = options.folds ?? 5
  const oldCutoff = ENGINE_CONFIG.render.transparencyCutoff
  const oldRampEnd = oldCutoff + ENGINE_CONFIG.render.transparencyRamp

  const allIds = listSplit(setName, split)
  const ids = options.limit ? allIds.slice(0, options.limit) : allIds
  const foldOf = assignFolds(ids, folds)
  const priors = fitFoldPriors(setName, duration, ids, foldOf, folds)
  const wanted = new Set(ids)

  const before = beforeSharpnessVariant().params
  const after = baseParams()

  const hidden: number[] = []
  const ramped: number[] = []
  const newCutoff: number[] = []
  const newRampEnd: number[] = []
  const hiddenUnchanged: number[] = []
  let count = 0

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

    const oldMap = combineFeatureParts(features, shape.width, shape.height, before).attention
    const newMap = combineFeatureParts(features, shape.width, shape.height, after).attention

    const hiddenHere = shareBelow(oldMap, oldCutoff)
    const rampedHere = shareBelow(oldMap, oldRampEnd)
    hidden.push(hiddenHere)
    ramped.push(rampedHere)
    newCutoff.push(valueAtShare(newMap, hiddenHere))
    newRampEnd.push(valueAtShare(newMap, rampedHere))
    hiddenUnchanged.push(shareBelow(newMap, oldCutoff))

    count++
    options.onProgress?.(count, ids.length)
  }

  return {
    setName,
    imageCount: count,
    oldCutoff,
    oldRampEnd,
    hiddenShare: summarise(hidden),
    rampedShare: summarise(ramped),
    newCutoff: summarise(newCutoff),
    newRampEnd: summarise(newRampEnd),
    hiddenShareUnchanged: summarise(hiddenUnchanged),
  }
}

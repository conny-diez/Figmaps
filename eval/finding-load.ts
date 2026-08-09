/**
 * 1.2 B — wie viele Befunde bekommt ein Screen?
 *
 * WARUM DIE FRAGE SO GESTELLT WIRD. „Feuert diese Regel zu oft?" ist pro Regel
 * nicht zu beantworten. Die Regeln konkurrieren um denselben Platz: `maxShown`
 * ist 6, sortiert wird nach Schweregrad, und wer einen Screen ansieht, liest
 * die Liste als Ganzes. Eine Regel mit 40 % ist harmlos, wenn sie die einzige
 * ist, und lästig, wenn drei andere danebenstehen. Was zählt, ist die
 * **Verteilung der Befundzahl pro Screen** — und die ist eine Eigenschaft des
 * Regelsatzes, nicht einer Regel.
 *
 * Getrennt nach Ein-Viewport und segmentiert, weil das die beiden Fälle sind,
 * in denen das Plugin tatsächlich läuft: ein Handy-Screen ist meist nicht
 * segmentiert (852 ÷ 786 = 1,08 Viewport-Höhen), eine Scrollseite immer.
 *
 * Gezählt wird, was die Nutzerin sieht: **nur ausgelieferte Regeln**, durch
 * denselben `deriveFindings`-Pfad wie im Panel, und nach `maxShown` gekappt.
 * Ein Zähler über `ALL_RULES` beantwortete eine Frage, die niemand hat.
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { analyzeFrame } from '../src/engine/analyze'
import { ENGINE_CONFIG } from '../src/engine/config'
import { HeuristicAttentionEngine } from '../src/engine/heuristic'
import type { NodeSignal } from '../src/messages'
import type { PriorAssetId } from '../src/engine/priors'
import { nodeImageOps } from '../src/platform/imageops-node'
import { deriveFindings, findingsInputFor } from '../src/findings/derive'
import { RULES } from '../src/findings/rules'
import { blockedReason } from './findings-audit'
import { FIXTURES_ROOT, listSplit, readPng } from './dataset'
import { buildFrame, SHAPES } from './constructed'

export type LoadPopulation = {
  id: string
  label: string
  setName?: string
  priorAsset: PriorAssetId
  /** Erzwungene Viewport-Höhe. Fehlt sie, läuft der Frame als ein Viewport. */
  viewport?: number
  /** Konstruierte Frames statt eines Sets — die einzige Quelle mit Kandidaten. */
  constructedShape?: string
}

export const LOAD_POPULATIONS: readonly LoadPopulation[] = [
  { id: 'web-segmentiert', label: 'UEyes Webseiten, segmentiert', setName: 'ueyes-web', priorAsset: 'web', viewport: 500 },
  { id: 'mobile-1vp', label: 'UEyes Telefon, ein Viewport', setName: 'ueyes-mobile', priorAsset: 'mobile' },
  { id: 'mobile-segmentiert', label: 'UEyes Telefon, segmentiert', setName: 'ueyes-mobile', priorAsset: 'mobile', viewport: 400 },
]

export type LoadResult = {
  population: LoadPopulation
  imageCount: number
  /** Wie viele Screens 0, 1, 2, … Befunde bekommen. */
  histogram: number[]
  mean: number
  /** Anteil der Screens ohne einen einzigen Befund. */
  emptyShare: number
  /** Je Regel: auf wie vielen Screens sie in der gezeigten Liste steht. */
  perRule: Record<string, number>
  /** Je Regel: auf wie vielen Screens sie strukturell blockiert war. */
  blockedPerRule: Record<string, number>
}

export type LoadOptions = {
  populations?: readonly LoadPopulation[]
  limit?: number
  onProgress?: (message: string) => void
}

type LoadCase = {
  image: Awaited<ReturnType<typeof readPng>>
  signals: NodeSignal[]
  frameWidth: number
  frameHeight: number
}

function* casesOf(population: LoadPopulation, limit?: number): Generator<LoadCase> {
  if (population.constructedShape) {
    const shape = SHAPES.find((entry) => entry.id === population.constructedShape)
    if (!shape) throw new Error(`Unbekannte Frame-Form "${population.constructedShape}"`)
    for (let variant = 0; variant < (limit ?? 24); variant++) {
      const frame = buildFrame(shape, variant)
      yield { image: frame.image, signals: frame.signals, frameWidth: shape.frameWidth, frameHeight: shape.frameHeight }
    }
    return
  }

  const setName = population.setName!
  const ids = [...new Set([...listSplit(setName, 'tuning'), ...listSplit(setName, 'test')])]
  for (const id of limit ? ids.slice(0, limit) : ids) {
    const imagePath = join(FIXTURES_ROOT, setName, 'images', `${id}.png`)
    if (!existsSync(imagePath)) continue
    const signalsPath = join(FIXTURES_ROOT, setName, 'signals', `${id}.json`)
    const image = readPng(imagePath)
    yield {
      image,
      signals: existsSync(signalsPath) ? (JSON.parse(readFileSync(signalsPath, 'utf8')) as NodeSignal[]) : [],
      frameWidth: image.width,
      frameHeight: image.height,
    }
  }
}

export async function measureFindingLoad(options: LoadOptions = {}): Promise<LoadResult[]> {
  const out: LoadResult[] = []

  for (const population of options.populations ?? LOAD_POPULATIONS) {
    options.onProgress?.(population.label)
    const engine = new HeuristicAttentionEngine({ priorAsset: population.priorAsset })
    const histogram: number[] = []
    const perRule: Record<string, number> = {}
    const blockedPerRule: Record<string, number> = {}
    let imageCount = 0
    let total = 0

    for (const item of casesOf(population, options.limit)) {
      const analysis = await analyzeFrame(engine, nodeImageOps, {
        source: item.image,
        signals: item.signals,
        frameWidth: item.frameWidth,
        frameHeight: item.frameHeight,
        ...(population.viewport ? { viewportOverride: population.viewport } : { segment: false }),
      })
      if (!analysis) continue

      const derived = deriveFindings({
        analysis,
        signals: item.signals,
        frameWidth: item.frameWidth,
        frameHeight: item.frameHeight,
        priorCategory: population.priorAsset,
      })
      // `collectFindings` kappt bereits auf `maxShown`; die Zeile hält fest,
      // dass gezählt wird, was **sichtbar** ist, falls sich das je ändert.
      const shown = derived.slice(0, ENGINE_CONFIG.findings.maxShown)

      histogram[shown.length] = (histogram[shown.length] ?? 0) + 1
      total += shown.length
      for (const finding of shown) perRule[finding.id] = (perRule[finding.id] ?? 0) + 1

      const input = findingsInputFor({
        analysis,
        signals: item.signals,
        frameWidth: item.frameWidth,
        frameHeight: item.frameHeight,
        priorCategory: population.priorAsset,
      })
      for (const rule of RULES) {
        if (blockedReason(rule.id, input)) blockedPerRule[rule.id] = (blockedPerRule[rule.id] ?? 0) + 1
      }

      imageCount++
    }

    for (let i = 0; i < histogram.length; i++) if (histogram[i] === undefined) histogram[i] = 0
    out.push({
      population,
      imageCount,
      histogram,
      mean: imageCount > 0 ? total / imageCount : Number.NaN,
      emptyShare: imageCount > 0 ? (histogram[0] ?? 0) / imageCount : Number.NaN,
      perRule,
      blockedPerRule,
    })
  }

  return out
}

/**
 * Warum feuert `cta-rank` auf zwei Dritteln der Screens?
 *
 * Die Regel ist die einzige ohne bekannten Defekt und mit Abstand die
 * häufigste — 66,7 % in jeder der drei konstruierten Frame-Formen. Bevor
 * irgendwer eine Schwelle anfasst (die Regel hat gar keine: „nicht auf Rang 1"
 * ist eine Definition), muss die Ursache auf dem Tisch liegen.
 *
 * Der Verdacht ist der Generator selbst. `constructed.ts` → `layoutFor` setzt
 * `ctaAtBottom = variant % 3 !== 2`, stellt den primären CTA also in **genau
 * zwei Dritteln** der Varianten nach unten. Steht er unten, verliert er den
 * ersten Rang an den Kopfbereich, und die Regel feuert — korrekt.
 *
 * Diese Funktion prüft den Verdacht, statt ihn zu behaupten: sie stellt
 * „CTA steht unten" und „Regel feuert" gegenüber. Stimmen die beiden
 * überein, ist die Quote die des Aufbaus und sagt über echte Screens nichts.
 */
export type CtaRankAnalysis = {
  shapeId: string
  shapeLabel: string
  variants: number
  /** Kreuztabelle: [CTA unten][feuert] */
  matrix: { bottomFired: number; bottomSilent: number; topFired: number; topSilent: number }
  /** Anteil der Varianten, in denen Aufbau und Urteil übereinstimmen. */
  agreement: number
  rate: number
}

export async function analyseCtaRank(variants = 24): Promise<CtaRankAnalysis[]> {
  const out: CtaRankAnalysis[] = []

  for (const shape of SHAPES) {
    const engine = new HeuristicAttentionEngine({ priorAsset: shape.prior })
    const matrix = { bottomFired: 0, bottomSilent: 0, topFired: 0, topSilent: 0 }

    for (let variant = 0; variant < variants; variant++) {
      const frame = buildFrame(shape, variant)
      // Dieselbe Bedingung wie in `constructed.ts` → `layoutFor`. Sie steht
      // hier ein zweites Mal, damit die Analyse nicht von einer internen
      // Funktion abhängt, die sich ändern kann, ohne dass es auffällt.
      const ctaAtBottom = variant % 3 !== 2

      const analysis = await analyzeFrame(engine, nodeImageOps, {
        source: frame.image,
        signals: frame.signals,
        frameWidth: shape.frameWidth,
        frameHeight: shape.frameHeight,
      })
      if (!analysis) continue
      const fired = deriveFindings({
        analysis,
        signals: frame.signals,
        frameWidth: shape.frameWidth,
        frameHeight: shape.frameHeight,
        priorCategory: shape.category,
      }).some((finding) => finding.id === 'cta-rank')

      if (ctaAtBottom && fired) matrix.bottomFired++
      else if (ctaAtBottom) matrix.bottomSilent++
      else if (fired) matrix.topFired++
      else matrix.topSilent++
    }

    const total = matrix.bottomFired + matrix.bottomSilent + matrix.topFired + matrix.topSilent
    out.push({
      shapeId: shape.id,
      shapeLabel: shape.label,
      variants: total,
      matrix,
      agreement: total > 0 ? (matrix.bottomFired + matrix.topSilent) / total : Number.NaN,
      rate: total > 0 ? (matrix.bottomFired + matrix.topFired) / total : Number.NaN,
    })
  }

  return out
}

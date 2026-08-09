/**
 * 1.2 B1 — `competition` nach der Umstellung des Abstandsmaßes neu kalibrieren.
 *
 * Der Mindestabstand der beiden Spitzen war ein Anteil der Karten**breite** und
 * bedeutete je nach Frame-Form 3,9 % bis 48,0 % der Höhe. Er ist jetzt ein
 * Anteil der **Diagonale**. Damit sind **alle** bisherigen Quoten dieser Regel
 * ungültig — sie wurden mit dem alten Maß gemessen, und die alten Zahlen dürfen
 * nicht als Anker dienen, auch nicht als Plausibilitätsprüfung. Das steht so
 * seit 1.1 in `rules.ts`, und hier wird es eingelöst.
 *
 * ZWEI KONSTANTEN, EINE MESSUNG. Der Abstand entscheidet, **welcher** Pixel das
 * zweite Maximum wird; das Talverhältnis entscheidet, ob die beiden als getrennt
 * gelten. Die zweite Größe hängt also von der ersten ab — sie getrennt zu
 * kalibrieren wäre falsch. Dieser Sweep variiert deshalb den Abstand und
 * berichtet je Punkt die vollständige Verteilung des Talverhältnisses **und**
 * die Feuerrate.
 *
 * WORAN KALIBRIERT WIRD. Es gibt keine Ground Truth für „dieser Screen hat zwei
 * konkurrierende Blickfänge". Das Kriterium ist deshalb dasselbe wie überall in
 * diesem Projekt, wo es keine gibt: **die Regel darf nicht entarten**. Weder
 * 0 % noch 100 %, und die Schwelle muss innerhalb der beobachteten Verteilung
 * liegen — eine Schwelle außerhalb bedeutet, dass die Regel nur immer oder nie
 * feuern kann, und genau daran sind `flat` und `dead-cta` gescheitert.
 */
import { ENGINE_CONFIG } from '../src/engine/config'
import type { PriorAssetId } from '../src/engine/priors'
import type { ScalarMap } from '../src/engine/types'
import { analyzeFrame } from '../src/engine/analyze'
import { HeuristicAttentionEngine } from '../src/engine/heuristic'
import { nodeImageOps } from '../src/platform/imageops-node'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { FIXTURES_ROOT, listSplit, readPng } from './dataset'
import { buildFrame, SHAPES } from './constructed'

export type CompetitionPopulation = {
  id: string
  label: string
  setName?: string
  shapeId?: string
  priorAsset: PriorAssetId
  viewport?: number
}

export const COMPETITION_POPULATIONS: readonly CompetitionPopulation[] = [
  { id: 'web-1vp', label: 'UEyes Webseiten, ein Viewport', setName: 'ueyes-web', priorAsset: 'web' },
  { id: 'web-segmentiert', label: 'UEyes Webseiten, segmentiert', setName: 'ueyes-web', priorAsset: 'web', viewport: 500 },
  { id: 'mobile-1vp', label: 'UEyes Telefon, ein Viewport', setName: 'ueyes-mobile', priorAsset: 'mobile' },
  { id: 'mobile-segmentiert', label: 'UEyes Telefon, segmentiert', setName: 'ueyes-mobile', priorAsset: 'mobile', viewport: 400 },
  { id: 'konstruiert-desktop', label: 'Desktop, scrollend (konstruiert)', shapeId: 'desktop-lang', priorAsset: 'web' },
  { id: 'konstruiert-mobil-1vp', label: 'Telefon, ein Viewport (konstruiert)', shapeId: 'mobile-1vp', priorAsset: 'mobile' },
  { id: 'konstruiert-mobil-lang', label: 'Telefon, scrollend (konstruiert)', shapeId: 'mobile-lang', priorAsset: 'mobile' },
]

export type CompetitionPoint = {
  /** Anteil der Diagonale. */
  distance: number
  /** Auf wie vielen Karten überhaupt ein zweites Maximum gefunden wurde. */
  withSecondPeak: number
  /** Verteilung des zweiten Maximums — es muss über `competitionIntensity`. */
  secondPeakQuantiles: number[]
  /** Verteilung von Tal ÷ zweites Maximum — die bindende Größe. */
  valleyQuantiles: number[]
  /** Wo `competitionValleyRatio` in dieser Verteilung sitzt. */
  valleyThresholdQuantile: number
  /** Feuerrate mit den ausgelieferten Schwellen. */
  rate: number
}

export type CompetitionResult = {
  population: CompetitionPopulation
  frameCount: number
  points: CompetitionPoint[]
}

function quantiles(values: readonly number[], points = [0.05, 0.25, 0.5, 0.75, 0.95]): number[] {
  if (values.length === 0) return points.map(() => Number.NaN)
  const sorted = [...values].sort((a, b) => a - b)
  return points.map((q) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))])
}

function quantileRank(values: readonly number[], value: number): number {
  if (values.length === 0) return Number.NaN
  return values.filter((entry) => entry < value).length / values.length
}

/**
 * Die Größen, an denen die Regel entscheidet — für einen gegebenen Abstand.
 *
 * Bewusst eine eigene, lesbare Implementierung statt eines Aufrufs der Regel:
 * die Regel liefert ja/nein, hier wird die Verteilung dahinter gebraucht. Dass
 * beide dasselbe rechnen, hält der Vergleich der Feuerrate mit `findings-audit`
 * fest.
 */
function peaksFor(map: ScalarMap, distanceShare: number): { second: number; valleyRatio: number } | null {
  let peak = -1
  for (let i = 0; i < map.values.length; i++) if (peak < 0 || map.values[i] > map.values[peak]) peak = i
  const x1 = peak % map.width
  const y1 = Math.floor(peak / map.width)
  const minDistance = distanceShare * Math.hypot(map.width, map.height)

  let second = -1
  for (let i = 0; i < map.values.length; i++) {
    const dx = (i % map.width) - x1
    const dy = Math.floor(i / map.width) - y1
    if (Math.sqrt(dx * dx + dy * dy) <= minDistance) continue
    if (second < 0 || map.values[i] > map.values[second]) second = i
  }
  if (second < 0) return null

  const x2 = second % map.width
  const y2 = Math.floor(second / map.width)
  const steps = Math.max(Math.abs(x2 - x1), Math.abs(y2 - y1))
  let valley = Infinity
  for (let step = 1; step < steps; step++) {
    const t = step / steps
    const x = Math.round(x1 + (x2 - x1) * t)
    const y = Math.round(y1 + (y2 - y1) * t)
    valley = Math.min(valley, map.values[y * map.width + x])
  }
  const secondValue = map.values[second]
  if (!Number.isFinite(valley) || !(secondValue > 0)) return null
  return { second: secondValue, valleyRatio: valley / secondValue }
}

export type CompetitionOptions = {
  distances: readonly number[]
  populations?: readonly CompetitionPopulation[]
  variants?: number
  limit?: number
  onProgress?: (message: string) => void
}

export async function sweepCompetition(options: CompetitionOptions): Promise<CompetitionResult[]> {
  const cfg = ENGINE_CONFIG.findings
  const out: CompetitionResult[] = []

  for (const population of options.populations ?? COMPETITION_POPULATIONS) {
    options.onProgress?.(population.label)
    const engine = new HeuristicAttentionEngine({ priorAsset: population.priorAsset })
    const maps: ScalarMap[] = []

    if (population.shapeId) {
      const shape = SHAPES.find((entry) => entry.id === population.shapeId)!
      for (let variant = 0; variant < (options.variants ?? 24); variant++) {
        const frame = buildFrame(shape, variant)
        const analysis = await analyzeFrame(engine, nodeImageOps, {
          source: frame.image,
          signals: frame.signals,
          frameWidth: shape.frameWidth,
          frameHeight: shape.frameHeight,
        })
        if (analysis) maps.push(analysis.attention)
      }
    } else {
      const setName = population.setName!
      const ids = [...new Set([...listSplit(setName, 'tuning'), ...listSplit(setName, 'test')])]
      for (const id of options.limit ? ids.slice(0, options.limit) : ids) {
        const path = join(FIXTURES_ROOT, setName, 'images', `${id}.png`)
        if (!existsSync(path)) continue
        const image = readPng(path)
        const analysis = await analyzeFrame(engine, nodeImageOps, {
          source: image,
          signals: [],
          frameWidth: image.width,
          frameHeight: image.height,
          ...(population.viewport ? { viewportOverride: population.viewport } : { segment: false }),
        })
        if (analysis) maps.push(analysis.attention)
      }
    }

    const points: CompetitionPoint[] = options.distances.map((distance) => {
      const seconds: number[] = []
      const valleys: number[] = []
      let fired = 0
      for (const map of maps) {
        // Erste Bedingung der Regel: das globale Maximum muss selbst über der
        // Intensitätsschwelle liegen.
        let peak = 0
        for (const value of map.values) if (value > peak) peak = value
        if (peak < cfg.competitionIntensity) continue

        const result = peaksFor(map, distance)
        if (!result) continue
        seconds.push(result.second)
        valleys.push(result.valleyRatio)
        if (result.second >= cfg.competitionIntensity && result.valleyRatio < cfg.competitionValleyRatio) fired++
      }
      return {
        distance,
        withSecondPeak: seconds.length,
        secondPeakQuantiles: quantiles(seconds),
        valleyQuantiles: quantiles(valleys),
        valleyThresholdQuantile: quantileRank(valleys, cfg.competitionValleyRatio),
        rate: maps.length > 0 ? fired / maps.length : Number.NaN,
      }
    })

    out.push({ population, frameCount: maps.length, points })
  }

  return out
}

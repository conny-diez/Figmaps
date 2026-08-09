/**
 * 1.2 B — `coldFoldMargin` je UI-Typ.
 *
 * DER BEFUND, DER DAZU FÜHRT. `cold-fold` hat eine einzige Konstante, 0,08, und
 * die stammt aus der Webseiten-Verteilung. Auf Telefon-Screens liegt sie
 * **unter** dem Median der Entscheidungsgröße: die Regel sagt dort häufiger ja
 * als nein (61,6 % gegen 40,0 %). Das ist dieselbe Fehlerklasse wie bei `flat`
 * — eine Schwelle, in einer Population geschätzt und in einer anderen
 * angewandt —, nur wandert sie diesmal zwischen **UI-Typen** statt zwischen
 * Konfigurationen. `flat` hat die Schwelle je UI-Typ längst
 * (`flatConcentrationThreshold`); `cold-fold` bekommt dieselbe Form.
 *
 * WORAN KALIBRIERT WIRD, UND WORAN NICHT. Es gibt keine Ground Truth dafür, ob
 * ein Screen diesen Befund verdient — niemand hat gelabelt, wo Aufmerksamkeit
 * „zu weit unten" bündelt. Kalibriert wird deshalb nicht gegen eine Wahrheit,
 * sondern auf **Vergleichbarkeit**: die Schwelle liegt in jedem UI-Typ am
 * selben Perzentil seiner eigenen Verteilung, damit „der stärkste Abschnitt
 * liegt nicht oben" in beiden Typen dasselbe heißt. Genau die Begründung, mit
 * der `flat` seine vier Schwellen bekommen hat.
 *
 * **Welches Perzentil, ist damit nicht beantwortet.** Der Wert wird aus dem
 * ausgelieferten Zustand übernommen: 0,08 liegt in der Webseiten-Verteilung an
 * einer bestimmten Stelle, und diese Stelle gilt fortan für alle Typen. Ob sie
 * die richtige ist — ob ein Befund auf 40 % der Screens erscheinen soll —, ist
 * eine Produktfrage und wird hier **nicht** entschieden. Was hier entschieden
 * wird, ist nur, dass die Regel in beiden Typen dieselbe Frage stellt.
 */
import { ENGINE_CONFIG } from '../src/engine/config'
import type { PriorAssetId } from '../src/engine/priors'
import { auditFindings } from './findings-audit'

export type ColdFoldPopulation = {
  id: string
  setName: string
  priorAsset: PriorAssetId
  /** Erzwungene Viewport-Höhe — ohne Segmentierung ist die Regel blockiert. */
  viewport: number
}

/**
 * Die beiden echten Populationen, in denen `cold-fold` überhaupt gefragt werden
 * kann. Konstruierte Frames sind hier bewusst nicht dabei: ihre Quote ist die
 * ihres Aufbaus (der Hero steht absichtlich weiter unten), und eine Schwelle
 * daran zu hängen hieße, unseren Generator zu kalibrieren.
 */
export const COLD_FOLD_POPULATIONS: readonly ColdFoldPopulation[] = [
  { id: 'web', setName: 'ueyes-web', priorAsset: 'web', viewport: 500 },
  { id: 'mobile', setName: 'ueyes-mobile', priorAsset: 'mobile', viewport: 400 },
]

export type ColdFoldMeasurement = {
  population: ColdFoldPopulation
  evaluated: number
  blocked: number
  samples: number[]
  /** Dezile der Entscheidungsgröße. */
  deciles: number[]
  /** Wo die heute ausgelieferte Schwelle in dieser Verteilung sitzt, als Anteil. */
  currentThresholdQuantile: number
  currentRate: number
}

export type ColdFoldResult = {
  measurements: ColdFoldMeasurement[]
  /** Das Perzentil, an dem die ausgelieferte Schwelle in `web` sitzt. */
  anchorQuantile: number
  /** Vorgeschlagene Schwelle je UI-Typ, am selben Perzentil. */
  proposed: Record<string, number>
  /** Feuerrate, die sich damit ergibt. */
  proposedRate: Record<string, number>
}

function quantileOf(sorted: readonly number[], q: number): number {
  if (sorted.length === 0) return Number.NaN
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(q * sorted.length)))]
}

/** Anteil der Werte unter `value` — die Umkehrung von `quantileOf`. */
function quantileRankOf(sorted: readonly number[], value: number): number {
  let below = 0
  for (const entry of sorted) {
    if (entry < value) below++
    else break
  }
  return sorted.length === 0 ? Number.NaN : below / sorted.length
}

export async function measureColdFold(options: { onProgress?: (message: string) => void } = {}): Promise<ColdFoldResult> {
  const measurements: ColdFoldMeasurement[] = []

  for (const population of COLD_FOLD_POPULATIONS) {
    options.onProgress?.(`${population.id}: ${population.setName}, Viewport ${population.viewport} px erzwungen`)
    const audit = await auditFindings({
      setName: population.setName,
      priorAsset: population.priorAsset,
      viewportOverride: population.viewport,
    })
    const rule = audit.rules.find((entry) => entry.id === 'cold-fold')
    if (!rule) throw new Error('cold-fold fehlt im Audit')

    const sorted = [...rule.samples].sort((a, b) => a - b)
    const evaluated = rule.fired + rule.silent
    measurements.push({
      population,
      evaluated,
      blocked: rule.blocked,
      samples: sorted,
      deciles: Array.from({ length: 9 }, (_, i) => quantileOf(sorted, (i + 1) / 10)),
      // Gegen den web-Wert gelesen: er ist der einzige, der je an Daten
      // geschätzt wurde, und die Frage ist, wo er in der jeweiligen Verteilung
      // landet.
      currentThresholdQuantile: quantileRankOf(sorted, ENGINE_CONFIG.findings.coldFoldMargin.web),
      currentRate: evaluated > 0 ? rule.fired / evaluated : Number.NaN,
    })
  }

  // Der Anker ist die Stelle, an der die ausgelieferte Schwelle in der
  // Webseiten-Verteilung sitzt — dort ist sie geschätzt worden.
  const web = measurements.find((entry) => entry.population.id === 'web')
  if (!web) throw new Error('Webseiten-Population fehlt')
  const anchorQuantile = web.currentThresholdQuantile

  const proposed: Record<string, number> = {}
  const proposedRate: Record<string, number> = {}
  for (const measurement of measurements) {
    const threshold = quantileOf(measurement.samples, anchorQuantile)
    proposed[measurement.population.id] = Math.round(threshold * 1000) / 1000
    // Die Regel feuert, wenn die Größe die Schwelle **überschreitet**.
    proposedRate[measurement.population.id] =
      measurement.samples.filter((value) => value >= proposed[measurement.population.id]).length / measurement.samples.length
  }

  return { measurements, anchorQuantile, proposed, proposedRate }
}

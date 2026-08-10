/**
 * 1.2 B2 — „Kopfbereich stärker als Inhalt", Schritt 1: taugt die Größe?
 *
 * DIE REGEL-IDEE. Auf manchen Screens bleibt die Aufmerksamkeit im oberen Band
 * hängen, statt zum Inhalt zu wandern. Das ist eine Aussage über den Entwurf und
 * wäre die zweite Vorhersage-Regel, die auf einem Ein-Viewport-Screen etwas
 * sagen kann.
 *
 * DIE GRÖSSE. Bandaufteilung plus Verhältnismaß: mittlerer Wert im oberen
 * Viertel geteilt durch den mittleren Wert im Rest. Über 1 heißt „oben stärker".
 *
 * **Gemessen auf dem Bildanalyse-Anteil, nicht auf der fertigen Karte, und
 * ausdrücklich nicht auf `sectionSalience`.** Beide Verbote haben denselben
 * Grund, und beide sind teuer gelernt:
 *
 *   - Die fertige Karte ist prior-dominiert, und der Ortsprior ist von sich aus
 *     oben-lastig. Ein Verhältnis darauf misst den Prior, nicht den Entwurf —
 *     es wäre auf jedem Screen über 1.
 *   - `sectionSalience` ist nachweislich nicht monoton in der Hierarchie und
 *     reagiert auf die Menge an Inhalt. Das ist die Falle, an der `flat`
 *     gescheitert ist, fünf Anläufe lang.
 *
 * DIESE MESSUNG ENTSCHEIDET, OB ES WEITERGEHT. Sie prüft die Größe an Fällen
 * mit **bekannter Antwort** — vor jeder Kalibrierung, vor jeder Schwelle.
 * Bringt sie die Fälle nicht in die richtige Ordnung, ist die Größe falsch und
 * die Regel wird nicht gebaut. Kein zweiter Anlauf: `flat` hat fünf gekostet,
 * und vier davon haben nichts gefunden, was der erste nicht schon gezeigt hätte.
 */
import { analyzeFrame } from '../src/engine/analyze'
import { HeuristicAttentionEngine } from '../src/engine/heuristic'
import type { Bitmap } from '../src/engine/ops'
import type { ScalarMap } from '../src/engine/types'
import { nodeImageOps } from '../src/platform/imageops-node'

/** Anteil der Höhe, der als „Kopfbereich" gilt. */
export const HEADER_BAND = 0.25

type Rgb = [number, number, number]

const FRAME_WIDTH = 390
const FRAME_HEIGHT = 844
const SOURCE_WIDTH = 390
const SOURCE_HEIGHT = 844

function canvas(colour: Rgb = [246, 247, 249]): Bitmap {
  const data = new Uint8ClampedArray(SOURCE_WIDTH * SOURCE_HEIGHT * 4)
  for (let p = 0; p < data.length; p += 4) {
    data[p] = colour[0]
    data[p + 1] = colour[1]
    data[p + 2] = colour[2]
    data[p + 3] = 255
  }
  return { width: SOURCE_WIDTH, height: SOURCE_HEIGHT, data }
}

function box(image: Bitmap, x: number, y: number, w: number, h: number, colour: Rgb): void {
  for (let py = Math.max(0, y); py < Math.min(image.height, y + h); py++) {
    for (let px = Math.max(0, x); px < Math.min(image.width, x + w); px++) {
      const p = (py * image.width + px) * 4
      image.data[p] = colour[0]
      image.data[p + 1] = colour[1]
      image.data[p + 2] = colour[2]
    }
  }
}

const INK: Rgb = [12, 14, 18]

/**
 * Die Fälle mit bekannter Antwort.
 *
 * `expect` sagt, was die Größe tun muss, damit sie brauchbar ist:
 *
 *   'hoch'      der Kopfbereich trägt den Screen — die Regel soll feuern können
 *   'niedrig'   der Inhalt trägt ihn — die Regel muss schweigen
 *   'neutral'   nichts dominiert; die Größe soll nahe 1 liegen und sich vor
 *               allem **nicht** mit der Menge an Inhalt bewegen
 *   'undefiniert' es gibt nichts zu vergleichen
 */
export type KnownCase = {
  id: string
  label: string
  expect: 'hoch' | 'niedrig' | 'neutral' | 'undefiniert'
  build: () => Bitmap
}

export const KNOWN_CASES: readonly KnownCase[] = [
  {
    id: 'leer',
    label: 'leer',
    expect: 'undefiniert',
    build: () => canvas(),
  },
  {
    id: 'kopf-stark',
    label: 'kräftiger Kopfbereich, ruhiger Inhalt',
    expect: 'hoch',
    build: () => {
      const image = canvas()
      box(image, 0, 0, SOURCE_WIDTH, 150, [18, 22, 30])
      for (let y = 300; y < 800; y += 60) box(image, 24, y, 200, 10, [190, 193, 198])
      return image
    },
  },
  {
    id: 'blickfang-inhalt',
    label: 'ein kleiner Blickfang in der Mitte',
    expect: 'niedrig',
    build: () => {
      const image = canvas()
      box(image, 140, 400, 110, 90, INK)
      return image
    },
  },
  {
    id: 'grosser-blickfang-inhalt',
    label: 'ein großer Blickfang in der Mitte',
    expect: 'niedrig',
    build: () => {
      const image = canvas()
      box(image, 40, 330, 310, 260, INK)
      return image
    },
  },
  {
    id: 'blickfang-kopf',
    label: 'ein kleiner Blickfang im Kopfbereich',
    expect: 'hoch',
    build: () => {
      const image = canvas()
      box(image, 140, 60, 110, 90, INK)
      return image
    },
  },
  ...[3, 6, 12].map((count) => ({
    id: `bloecke-${count}`,
    label: `${count} gleich starke Blöcke`,
    expect: 'neutral' as const,
    build: () => {
      const image = canvas()
      const step = (SOURCE_HEIGHT - 80) / count
      const height = Math.max(12, Math.round(step * 0.55))
      for (let i = 0; i < count; i++) {
        box(image, 40, Math.round(40 + i * step), 310, height, INK)
      }
      return image
    },
  })),
]

/**
 * Mittelwert im oberen Band geteilt durch den Mittelwert im Rest.
 *
 * `null`, wenn eine der beiden Hälften keine Masse trägt — auf einem leeren
 * Frame ist der Bildanteil überall null, und ein Verhältnis 0/0 ist keine
 * kleine Zahl, sondern keine Zahl.
 */
export function headerWeight(map: ScalarMap, band = HEADER_BAND): number | null {
  const cut = Math.max(1, Math.round(map.height * band))
  let top = 0
  let rest = 0
  for (let y = 0; y < map.height; y++) {
    const row = y * map.width
    for (let x = 0; x < map.width; x++) {
      if (y < cut) top += map.values[row + x]
      else rest += map.values[row + x]
    }
  }
  const topMean = top / (cut * map.width)
  const restMean = rest / Math.max(1, (map.height - cut) * map.width)
  if (!(topMean > 0) || !(restMean > 0)) return null
  return topMean / restMean
}

export type HeaderWeightMeasurement = {
  case: KnownCase
  /** Auf dem Bildanteil — die Größe, um die es geht. */
  onImageTerm: number | null
  /** Auf der fertigen Karte — zum Vergleich, warum sie nicht taugt. */
  onAttention: number | null
}

export async function measureKnownCases(): Promise<HeaderWeightMeasurement[]> {
  const engine = new HeuristicAttentionEngine({ priorAsset: 'mobile' })
  const out: HeaderWeightMeasurement[] = []

  for (const known of KNOWN_CASES) {
    const analysis = await analyzeFrame(engine, nodeImageOps, {
      source: known.build(),
      signals: [],
      frameWidth: FRAME_WIDTH,
      frameHeight: FRAME_HEIGHT,
    })
    if (!analysis) throw new Error(`Analyse abgebrochen: ${known.id}`)
    out.push({
      case: known,
      onImageTerm: analysis.imageTerms.length > 0 ? headerWeight(analysis.imageTerms[0]) : null,
      onAttention: headerWeight(analysis.attention),
    })
  }

  return out
}

/**
 * Stimmt die Ordnung?
 *
 * Die Bedingungen sind vorab festgelegt und nicht an den Zahlen ausgerichtet —
 * sonst prüfte man, ob man sich eine Regel ausdenken kann, die zu den Zahlen
 * passt:
 *
 *   1. Jeder 'hoch'-Fall liegt über jedem 'niedrig'-Fall. **Ohne diese
 *      Trennung gibt es keine Schwelle**, die die Regel je richtig schneidet.
 *   2. Die 'neutral'-Fälle liegen zwischen den beiden Gruppen.
 *   3. Die drei Blockzahlen bewegen die Größe um weniger als der Abstand
 *      zwischen 'hoch' und 'niedrig' beträgt. Das ist die `flat`-Falle: eine
 *      Größe, die stärker auf die *Menge* an Inhalt reagiert als auf das, was
 *      sie messen soll, ist unbrauchbar, auch wenn die Ordnung stimmt.
 */
export type OrderVerdict = {
  separated: boolean
  neutralBetween: boolean
  contentDrift: number
  classGap: number
  driftSmallerThanGap: boolean
  usable: boolean
}

export function judgeOrder(measurements: readonly HeaderWeightMeasurement[]): OrderVerdict {
  const valuesOf = (expect: KnownCase['expect']): number[] =>
    measurements
      .filter((entry) => entry.case.expect === expect && entry.onImageTerm !== null)
      .map((entry) => entry.onImageTerm as number)

  const high = valuesOf('hoch')
  const low = valuesOf('niedrig')
  const neutral = valuesOf('neutral')

  const separated = high.length > 0 && low.length > 0 && Math.min(...high) > Math.max(...low)
  const neutralBetween =
    neutral.length === 0 || (Math.max(...neutral) <= Math.min(...high) && Math.min(...neutral) >= Math.max(...low))
  const contentDrift = neutral.length > 1 ? Math.max(...neutral) - Math.min(...neutral) : 0
  const classGap = separated ? Math.min(...high) - Math.max(...low) : 0
  const driftSmallerThanGap = classGap > contentDrift

  return {
    separated,
    neutralBetween,
    contentDrift,
    classGap,
    driftSmallerThanGap,
    usable: separated && neutralBetween && driftSmallerThanGap,
  }
}

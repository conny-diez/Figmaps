/**
 * Wie viele Elemente macht die Plausibilitätsprüfung „nicht messbar"?
 *
 * WOZU. Jede Schwelle in `contrast/measurable.ts` tauscht **falsche Zahlen
 * gegen fehlende Aussagen**. Der Tausch ist nur günstig, solange er selten
 * greift: eine Prüfung, die die Hälfte der Textelemente verwirft, hat die
 * Contrastmap nicht genauer gemacht, sondern abgeschafft. Diese Messung ist
 * deshalb die Voraussetzung der Entscheidung und nicht ihre Bestätigung — sie
 * lief, bevor die Schwellen in `MEASURABLE_LIMITS` eingetragen wurden.
 *
 * WORAUF GEMESSEN WIRD, UND WORAUF NICHT.
 *
 *   - **Onboarding-Screen und die konstruierten Frames.** Das ist alles, was
 *     dieses Repo an Frames **mit Layer-Baum** hat, und einen Layer-Baum
 *     braucht die Kontrastmessung: ohne `NodeSignal` gibt es keinen
 *     Textknoten, keine Textfarbe und keine Schriftgröße.
 *   - **Die Gate-Bilder nicht.** `eval/fixtures/gate-web` und `gate-mobile`
 *     sind UEyes-Screenshots; der Import legt ausdrücklich kein `signals/` an,
 *     weil ein Screenshot keine Ebenen hat (siehe `eval/fixtures/README.md`).
 *     Die Contrastmap misst auf ihnen **null** Elemente — nicht „null
 *     Probleme". Die Zahl, die dieses Kommando für sie ausgibt, ist deshalb
 *     eine Null mit Grund und kein Ergebnis.
 *
 * WAS DAS ÜBER DIE MESSUNG SAGT. Sie beantwortet **eine** der beiden Fragen,
 * die eine neue Prüfung aufwirft:
 *
 *   ✔ „Verwirft sie Elemente, die messbar sind?" — hier zählbar, denn die
 *     Generatoren zeichnen nichts Gedrehtes und nichts Verdecktes. Jeder
 *     Treffer auf diesem Set ist eine Fehlmeldung.
 *   ✘ „Findet sie, was sie finden soll?" — hier **nicht** zählbar, aus dem
 *     gleichen Grund. Das steht in den Unit-Tests, die die beiden Fälle
 *     absichtlich bauen, und im dritten Prüffall von `npm run contrast-check`.
 *
 * Die Häufigkeit in echten Dateien beantwortet keines von beidem. Dafür fehlt
 * weiterhin das Set mit echten Layer-Bäumen (PRD Set 2) — dieselbe Lücke, an
 * der `dead-cta` und `cta-below-fold` hängen.
 */
import { measureContrast } from '../src/contrast/measure'
import {
  MEASURABLE_LIMITS,
  NO_LIMITS,
  occludedShare,
  rotationOf,
  SKIP_LABELS,
  type MeasurableLimits,
  type SkipReason,
} from '../src/contrast/measurable'
import { ENGINE_CONFIG } from '../src/engine/config'
import { fitWithin, resizeBitmap } from '../src/engine/ops-pure'
import type { Bitmap } from '../src/engine/ops'
import type { NodeSignal } from '../src/messages'
import { buildFrame, SHAPES } from './constructed'
import { buildOnboardingFrame } from './onboarding'
import { buildOverlapFrame } from './overlap'

export type AuditFrame = {
  label: string
  image: Bitmap
  signals: NodeSignal[]
  frameWidth: number
  frameHeight: number
}

/**
 * Das Prüfkorpus: jeder Frame dieses Repos, der einen Layer-Baum hat.
 *
 * `variants` fährt die konstruierten Formen durch — die Varianten verschieben
 * Kartenzahl, Hero und CTA-Position und damit die Geometrie der Textrahmen, was
 * die geprüfte Größe ist. Der Onboarding-Screen kommt einmal vor, er hat keine
 * Varianten.
 *
 * Der Verdeckungs-Frame ist **absichtlich** dabei, obwohl er das Bild verzerrt:
 * ohne ihn steht in jeder Spalte für Drehung und Verdeckung eine Null, und eine
 * Null ohne Gegenprobe sieht wie „funktioniert nicht" aus. Er wird eigens
 * ausgewiesen und nie in dieselbe Quote gemischt.
 */
export function auditCorpus(variants = 6): { normal: AuditFrame[]; positiveControl: AuditFrame[] } {
  const onboarding = buildOnboardingFrame()
  const normal: AuditFrame[] = [
    {
      label: 'Onboarding-Screen 393 x 852',
      image: onboarding.image,
      signals: onboarding.signals,
      frameWidth: onboarding.frameWidth,
      frameHeight: onboarding.frameHeight,
    },
  ]
  for (const shape of SHAPES) {
    for (let variant = 0; variant < variants; variant++) {
      const built = buildFrame(shape, variant)
      normal.push({
        label: built.label,
        image: built.image,
        signals: built.signals,
        frameWidth: shape.frameWidth,
        frameHeight: shape.frameHeight,
      })
    }
  }

  const overlap = buildOverlapFrame()
  return {
    normal,
    positiveControl: [
      {
        label: overlap.label,
        image: overlap.image,
        signals: overlap.signals,
        frameWidth: overlap.frameWidth,
        frameHeight: overlap.frameHeight,
      },
    ],
  }
}

/** Dieselbe Auflösungsregel wie im Plugin — die Messung darf nicht verkleinert laufen. */
function contrastPixels(image: Bitmap): Bitmap {
  const size = fitWithin(image.width, image.height, ENGINE_CONFIG.contrastSource.maxEdge)
  return size.width === image.width ? image : resizeBitmap(image, size.width, size.height)
}

export type FrameTally = {
  label: string
  textNodes: number
  measured: number
  skipped: Record<SkipReason, number>
  /** Die drei Plausibilitätsgrößen aller **gemessenen** Elemente. */
  backgroundShares: number[]
  textCoreShares: number[]
  occludedShares: number[]
  /** Drehung aller Textknoten, aus dem Baum — unabhängig von jeder Schwelle. */
  rotations: number[]
}

function emptyTally(label: string): FrameTally {
  const skipped = {} as Record<SkipReason, number>
  for (const reason of Object.keys(SKIP_LABELS) as SkipReason[]) skipped[reason] = 0
  return { label, textNodes: 0, measured: 0, skipped, backgroundShares: [], textCoreShares: [], occludedShares: [], rotations: [] }
}

export function tallyFrame(frame: AuditFrame, limits: MeasurableLimits): FrameTally {
  const tally = emptyTally(frame.label)
  const pixels = contrastPixels(frame.image)
  const { results, skipped } = measureContrast({
    image: pixels,
    signals: frame.signals,
    frameWidth: frame.frameWidth,
    frameHeight: frame.frameHeight,
    limits,
  })

  tally.textNodes = frame.signals.filter((signal) => signal.isText).length
  tally.measured = results.length
  for (const entry of skipped) tally.skipped[entry.reason]++
  for (const result of results) {
    tally.backgroundShares.push(result.backgroundShare)
    tally.textCoreShares.push(result.textCoreShare)
    tally.occludedShares.push(result.occludedShare)
  }

  // Drehung und Verdeckung auch für die übersprungenen Elemente, denn genau die
  // Verteilung entscheidet über die Schwelle — und wer erst nach dem Verwerfen
  // messen kann, sieht nur, was er ohnehin behalten hat.
  const byId = new Map(frame.signals.map((signal) => [signal.id, signal]))
  for (const signal of frame.signals) {
    if (!signal.isText) continue
    tally.rotations.push(rotationOf(signal, byId))
    if (!results.some((result) => result.nodeId === signal.id)) {
      tally.occludedShares.push(occludedShare(signal, frame.signals))
    }
  }

  return tally
}

export function mergeTallies(tallies: readonly FrameTally[], label: string): FrameTally {
  const out = emptyTally(label)
  for (const tally of tallies) {
    out.textNodes += tally.textNodes
    out.measured += tally.measured
    for (const reason of Object.keys(out.skipped) as SkipReason[]) out.skipped[reason] += tally.skipped[reason]
    out.backgroundShares.push(...tally.backgroundShares)
    out.textCoreShares.push(...tally.textCoreShares)
    out.occludedShares.push(...tally.occludedShares)
    out.rotations.push(...tally.rotations)
  }
  return out
}

/**
 * Eine Schwelle einzeln, alle anderen aus.
 *
 * Einzeln, weil die Prüfungen einander verdecken: verwirft die Drehung ein
 * Element zuerst, taucht es in der Zählung der Hintergrundfläche nicht mehr
 * auf, und die Wirkung der zweiten Schwelle sähe kleiner aus, als sie ist. Für
 * die Entscheidung „ist diese Schwelle zu streng" muss jede für sich stehen.
 */
export type SweepRow = { limit: string; value: number; lost: number; share: number }

export function sweep(frames: readonly AuditFrame[], baseline: number): SweepRow[] {
  const rows: SweepRow[] = []
  const run = (limit: keyof MeasurableLimits, value: number | null): number => {
    const limits: MeasurableLimits = { ...NO_LIMITS, [limit]: value }
    return mergeTallies(
      frames.map((frame) => tallyFrame(frame, limits)),
      'sweep',
    ).measured
  }

  for (const value of [0.05, 0.1, 0.2, 0.3, 0.5]) {
    const measured = run('occludedShare', value)
    rows.push({ limit: 'occludedShare', value, lost: baseline - measured, share: (baseline - measured) / baseline })
  }
  // `backgroundShare` wird ausgeliefert als `null` — die Reihe steht trotzdem
  // hier, denn sie ist der Beleg dafür. Beim kleinsten Wert 0,016 verliert sie
  // nichts (also greift sie nie), bei 0,1 verlöre sie den Verlauf.
  for (const value of [2 / 128, 0.05, 0.1, 0.2, 0.5]) {
    const measured = run('backgroundShare', value)
    rows.push({ limit: 'backgroundShare', value, lost: baseline - measured, share: (baseline - measured) / baseline })
  }
  for (const value of [0.005, 0.01, 0.02, 0.05, 0.1]) {
    const measured = run('textCoreShare', value)
    rows.push({ limit: 'textCoreShare', value, lost: baseline - measured, share: (baseline - measured) / baseline })
  }
  for (const value of [0.1, 0.5, 1, 5]) {
    const measured = run('rotationDegrees', value)
    rows.push({ limit: 'rotationDegrees', value, lost: baseline - measured, share: (baseline - measured) / baseline })
  }
  return rows
}

export type MeasurableAudit = {
  variants: number
  frameCount: number
  /** Ohne jede Prüfung — der Zustand von 1.2. */
  before: FrameTally
  /** Mit den ausgelieferten Schwellen. */
  after: FrameTally
  /** Je Schwelle einzeln, gegen `before.measured`. */
  sweep: SweepRow[]
  /** Der Frame mit gewollter Drehung und Verdeckung, getrennt ausgewiesen. */
  control: FrameTally
  controlBefore: FrameTally
  /** Frames ohne Layer-Baum, die deshalb nichts beitragen können. */
  withoutLayerTree: string[]
}

export function auditMeasurable(variants = 6): MeasurableAudit {
  const { normal, positiveControl } = auditCorpus(variants)
  const before = mergeTallies(normal.map((frame) => tallyFrame(frame, NO_LIMITS)), 'ohne Prüfung')
  const after = mergeTallies(normal.map((frame) => tallyFrame(frame, MEASURABLE_LIMITS)), 'mit Prüfung')

  return {
    variants,
    frameCount: normal.length,
    before,
    after,
    sweep: sweep(normal, before.measured),
    control: mergeTallies(positiveControl.map((frame) => tallyFrame(frame, MEASURABLE_LIMITS)), 'Gegenprobe, mit Prüfung'),
    controlBefore: mergeTallies(positiveControl.map((frame) => tallyFrame(frame, NO_LIMITS)), 'Gegenprobe, ohne Prüfung'),
    withoutLayerTree: ['gate-web (20 Bilder)', 'gate-mobile (20 Bilder)'],
  }
}

/** Perzentile einer Verteilung, für die Begründung einer Schwelle. */
export function percentiles(samples: readonly number[], points = [0, 0.05, 0.5, 0.95, 1]): number[] {
  if (samples.length === 0) return points.map(() => Number.NaN)
  const sorted = [...samples].sort((a, b) => a - b)
  return points.map((p) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.round(p * (sorted.length - 1))))])
}

/**
 * Die Gegenprobe Knoten für Knoten: Prüfgrößen **und** die Antwort, die das
 * ausgelieferte Regelwerk gibt.
 *
 * Zwei Läufe, weil die Prüfgrößen nur für Elemente im Ergebnis stehen: ohne
 * Schwellen, um die Zahlen zu bekommen, und mit, um die Antwort zu bekommen.
 * Genau diese Gegenüberstellung fehlte 1.2 — dort war nach dem Verwerfen nicht
 * mehr zu sehen, wie knapp es war.
 */
export function controlDetail(): Array<{
  nodeId: string
  backgroundShare: string
  textCoreShare: string
  occludedShare: string
  answer: string
}> {
  const frame = auditCorpus(1).positiveControl[0]
  const pixels = contrastPixels(frame.image)
  const options = {
    image: pixels,
    signals: frame.signals,
    frameWidth: frame.frameWidth,
    frameHeight: frame.frameHeight,
  }
  const open = measureContrast({ ...options, limits: NO_LIMITS })
  const shipped = measureContrast({ ...options, limits: MEASURABLE_LIMITS })

  return frame.signals
    .filter((signal) => signal.isText)
    .map((signal) => {
      const raw = open.results.find((result) => result.nodeId === signal.id)
      const kept = shipped.results.find((result) => result.nodeId === signal.id)
      const dropped = shipped.skipped.find((entry) => entry.nodeId === signal.id)
      return {
        nodeId: signal.id,
        backgroundShare: raw ? raw.backgroundShare.toFixed(4) : '—',
        textCoreShare: raw ? raw.textCoreShare.toFixed(4) : '—',
        occludedShare: raw ? raw.occludedShare.toFixed(4) : occludedShare(signal, frame.signals).toFixed(4),
        answer: kept ? `gemessen (${kept.ratio.toFixed(2)}:1)` : dropped ? SKIP_LABELS[dropped.reason] : 'nicht im Ergebnis',
      }
    })
}

/** Die schlechtesten gemessenen Elemente je Plausibilitätsgröße — für die Sichtprüfung. */
export function worstBy(
  frames: readonly AuditFrame[],
  key: 'backgroundShare' | 'textCoreShare',
  count = 5,
): Array<{ frame: string; value: number; text: string }> {
  const out: Array<{ frame: string; value: number; text: string }> = []
  for (const frame of frames) {
    const { results } = measureContrast({
      image: contrastPixels(frame.image),
      signals: frame.signals,
      frameWidth: frame.frameWidth,
      frameHeight: frame.frameHeight,
      limits: NO_LIMITS,
    })
    for (const result of results) {
      out.push({ frame: frame.label, value: result[key], text: result.text })
    }
  }
  return out.sort((a, b) => a.value - b.value).slice(0, count)
}

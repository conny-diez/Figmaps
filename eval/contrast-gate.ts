/**
 * Das **zweite** Regressions-Gate: die Contrastmap auf Frames mit Layer-Baum.
 *
 * WARUM ES EIN ZWEITES BRAUCHT. Das Gate aus A-7 bewertet 40 UEyes-Bilder und
 * schützt damit genau eine Ausgabe: die Vorhersage. Die Contrastmap kommt darin
 * überhaupt nicht vor, und zwar aus einem Grund, der sich nicht beheben lässt —
 * ein Screenshot hat keine Ebenen, also keinen Textknoten, keine Textfarbe und
 * keine Schriftgröße. Auf dem Gate-Set misst die Contrastmap **null** Elemente.
 *
 * Die belastbarste Ausgabe des Plugins — die einzige, die als überprüfbare
 * Tatsache auftritt — hatte damit **keinen** Regressionsschutz. Und das ist
 * nicht theoretisch: alle drei Messfehler von 1.2 saßen nicht in der Rechnung,
 * sondern in der Pipeline auf echten Frames.
 *
 *   Textfarbe fehlte     → **jeder** Knoten wurde übersprungen
 *   Kantenglättung       → **jeder** Wert war falsch, alle auf 3–4:1 gestaucht
 *   Auflösung            → auf dem Analysebild war zwischen den Glyphen kein
 *                          reiner Hintergrund mehr übrig
 *
 * Alle drei Male waren die Unit-Tests grün. Sie prüfen die Rechnung; was fehlte,
 * war eine Zahl über den ganzen Weg.
 *
 * WAS BEWACHT WIRD, je Frame drei Zahlen:
 *
 *   `measured`        wie viele Textelemente gemessen wurden
 *   `failed`          wie viele davon durchgefallen sind
 *   `notMeasurable`   wie viele nicht messbar waren
 *
 * Bewegt sich eine davon, wird das Gate rot. **Keine Toleranz**, anders als
 * beim ersten Gate: dort steht ein CC-Mittelwert über 20 Bilder und ein
 * Rauschband von 0,02 ist sinnvoll, hier stehen abzählbare Elemente. „Ein
 * Element mehr durchgefallen" ist entweder eine Verbesserung oder ein Fehler,
 * aber nie Rauschen.
 *
 * WARUM DIE ERWARTUNG IM REPO LIEGT UND NICHT AUS `main` GERECHNET WIRD.
 * Derselbe Grund, aus dem das Referenz-Set des ersten Gates im Repo liegt statt
 * in einem Actions-Cache: eine Prüfung, deren Vergleichswert woanders liegt,
 * kann still ausfallen. Dazu kommt hier ein zweiter, stärkerer Grund — der
 * Korpus ist **Code** (die Generatoren), nicht Daten. Eine eingecheckte
 * Erwartung macht jede Bewegung der Zahlen zu einer **Zeile im Diff**, die ein
 * Mensch im PR sieht. Ein Vergleich, der nur im CI stattfindet, zeigt sie im
 * Log und niemandem sonst.
 *
 * Die Erwartung zu aktualisieren ist erlaubt und manchmal richtig. Sie *still*
 * zu aktualisieren ist es nicht, und deshalb weist der CI-Schritt eigens aus,
 * wenn die Datei im PR verändert wurde.
 */
import { measureContrast } from '../src/contrast/measure'
import { MEASURABLE_LIMITS, NO_LIMITS, SKIP_LABELS, summariseSkipped, type MeasurableLimits } from '../src/contrast/measurable'
import { ENGINE_CONFIG } from '../src/engine/config'
import type { Bitmap } from '../src/engine/ops'
import { fitWithin, resizeBitmap } from '../src/engine/ops-pure'
import { auditCorpus, type AuditFrame } from './measurable-audit'

/** Wo die eingecheckte Erwartung liegt. */
export const CONTRAST_BASELINE_PATH = 'eval/contrast-baseline.json'

/**
 * Wie viele Varianten je konstruierter Form in den Korpus gehen.
 *
 * Steht als Konstante und nicht als Parameter: die Zahl bestimmt, welche Frames
 * die Erwartung beschreibt. Wäre sie einstellbar, könnte ein Lauf mit anderer
 * Zahl gegen dieselbe Datei vergleichen und wäre grün, weil er andere Frames
 * gemessen hat.
 */
export const CONTRAST_GATE_VARIANTS = 6

export type ContrastGateFrame = {
  label: string
  measured: number
  failed: number
  notMeasurable: number
}

export type ContrastGateReport = {
  /** Damit eine Erwartung nicht gegen einen anderen Korpus verglichen wird. */
  variants: number
  frames: ContrastGateFrame[]
  totals: { measured: number; failed: number; notMeasurable: number }
}

export type ContrastGateOptions = {
  /** Für den Selbsttest: Prüfungen aus. Muss das Gate rot machen. */
  limits?: MeasurableLimits
  /**
   * Für den Selbsttest: die Messung auf einem verkleinerten Bild.
   *
   * Das ist der historische Fehler Nr. 3 in Reinform — auf dem Analysebild
   * (1024 px gedeckelt) war zwischen den Glyphen kein reiner Hintergrund mehr
   * übrig. Ein Gate, das das nicht sieht, sieht nichts.
   */
  maxEdge?: number
}

/** Dieselbe Auflösungsregel wie im Plugin, sofern nicht ausdrücklich gedrückt. */
function pixelsFor(image: Bitmap, maxEdge: number): Bitmap {
  const size = fitWithin(image.width, image.height, maxEdge)
  return size.width === image.width && size.height === image.height ? image : resizeBitmap(image, size.width, size.height)
}

function tally(frame: AuditFrame, options: ContrastGateOptions): ContrastGateFrame & { detail: string } {
  const { results, skipped } = measureContrast({
    image: pixelsFor(frame.image, options.maxEdge ?? ENGINE_CONFIG.contrastSource.maxEdge),
    signals: frame.signals,
    frameWidth: frame.frameWidth,
    frameHeight: frame.frameHeight,
    limits: options.limits ?? MEASURABLE_LIMITS,
  })
  return {
    label: frame.label,
    measured: results.length,
    failed: results.filter((result) => result.status === 'durchgefallen').length,
    notMeasurable: skipped.length,
    // Nur für die Fehlermeldung: wird eine Zahl rot, will man wissen, welcher
    // Grund sich bewegt hat. Nicht Teil der Erwartung — sonst wäre die Datei
    // eine Beschreibung der Implementierung statt ihres Ergebnisses.
    detail: skipped.length > 0 ? summariseSkipped(skipped) : '—',
  }
}

/**
 * Der Korpus des Gates: die 19 normalen Frames **und** die Gegenprobe.
 *
 * Die Gegenprobe gehört dazu, obwohl sie in keine Quote gehört: sie ist der
 * einzige Frame mit Drehung und Verdeckung, und ohne sie wäre die Spalte
 * `notMeasurable` überall bis auf die Statusleiste null — das Gate könnte dann
 * nicht merken, wenn die Erkennung aus 1a stillschweigend aufhört zu greifen.
 * Ausgewiesen wird sie getrennt, gezählt wird sie mit.
 */
export function contrastGateCorpus(): AuditFrame[] {
  const { normal, positiveControl } = auditCorpus(CONTRAST_GATE_VARIANTS)
  return [...normal, ...positiveControl]
}

export function runContrastGate(options: ContrastGateOptions = {}): ContrastGateReport & {
  details: Map<string, string>
} {
  const frames: ContrastGateFrame[] = []
  const details = new Map<string, string>()
  for (const frame of contrastGateCorpus()) {
    const { detail, ...counts } = tally(frame, options)
    frames.push(counts)
    details.set(counts.label, detail)
  }
  return {
    variants: CONTRAST_GATE_VARIANTS,
    frames,
    totals: {
      measured: frames.reduce((sum, frame) => sum + frame.measured, 0),
      failed: frames.reduce((sum, frame) => sum + frame.failed, 0),
      notMeasurable: frames.reduce((sum, frame) => sum + frame.notMeasurable, 0),
    },
    details,
  }
}

/**
 * Jede Abweichung als eigene Zeile — auch ein verschwundener oder neuer Frame.
 *
 * Ein Frame, der aus dem Korpus fällt, ist die gefährlichste Abweichung
 * überhaupt: die Summen sinken, und ohne diesen Vergleich sähe das aus wie
 * „weniger Befunde". Genau diese Verwechslung hat das erste Gate zweimal grün
 * gehalten, ohne zu messen.
 */
export function compareContrastGate(
  reference: ContrastGateReport,
  current: ContrastGateReport & { details?: Map<string, string> },
): string[] {
  const differences: string[] = []

  if (reference.variants !== current.variants) {
    differences.push(
      `Der Korpus ist ein anderer: die Erwartung beschreibt ${reference.variants} Varianten je Form, ` +
        `gemessen wurden ${current.variants}. Ein Vergleich wäre bedeutungslos.`,
    )
    return differences
  }

  const byLabel = new Map(reference.frames.map((frame) => [frame.label, frame]))
  const seen = new Set<string>()

  for (const frame of current.frames) {
    seen.add(frame.label)
    const before = byLabel.get(frame.label)
    if (!before) {
      differences.push(`NEU im Korpus: ${frame.label} (${frame.measured} gemessen, ${frame.failed} durchgefallen)`)
      continue
    }
    for (const key of ['measured', 'failed', 'notMeasurable'] as const) {
      if (before[key] === frame[key]) continue
      const detail = current.details?.get(frame.label)
      differences.push(
        `${frame.label}: ${key} ${before[key]} → ${frame[key]}` +
          (key === 'notMeasurable' && detail ? ` (${detail})` : ''),
      )
    }
  }

  for (const frame of reference.frames) {
    if (!seen.has(frame.label)) {
      differences.push(`FEHLT im Korpus: ${frame.label} — die Summen sinken, ohne dass etwas besser geworden ist`)
    }
  }

  return differences
}

/** Die Erwartung ohne die Diagnose-Details, wie sie in die Datei geht. */
export function serialiseContrastGate(report: ContrastGateReport): string {
  const clean: ContrastGateReport = {
    variants: report.variants,
    frames: report.frames.map((frame) => ({
      label: frame.label,
      measured: frame.measured,
      failed: frame.failed,
      notMeasurable: frame.notMeasurable,
    })),
    totals: report.totals,
  }
  return `${JSON.stringify(clean, null, 2)}\n`
}

/** Alle Skip-Gründe, für den Kopf der Ausgabe. */
export const CONTRAST_GATE_REASONS = Object.values(SKIP_LABELS)

/** Der Schalter, mit dem der Selbsttest die Prüfungen abschaltet. */
export { NO_LIMITS }

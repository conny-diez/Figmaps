/**
 * WCAG 2.1, Erfolgskriterium 1.4.11 — Non-text Contrast, Level AA.
 *
 * WAS DIE NORM VERLANGT, UND WAS SIE NICHT VERLANGT. 1.4.11 fordert 3:1 für
 * „visuelle Information, die nötig ist, um Komponenten der Benutzerschnittstelle
 * und ihre **Zustände** zu identifizieren". Das ist ausdrücklich **nicht** „jede
 * Fläche gegen irgendetwas": gemessen wird die **Begrenzung gegen die
 * unmittelbar angrenzende Farbe** — die Kante, an der man erkennt, dass hier
 * eine Komponente anfängt.
 *
 * DIE AUSNAHME, DIE DIE MEISTEN FEHLMELDUNGEN VERHINDERT. Ist eine Komponente
 * durch ihren **eigenen sichtbaren Text** identifizierbar, ist ihre Begrenzung
 * nicht erforderlich — dann trägt die Beschriftung die Information, und für die
 * gilt ohnehin schon 1.4.3.
 *
 * Konkret an unserem Prüfscreen: der gelbe Knopf „Los geht's" hat gegen den
 * cremefarbenen Grund rund 1,2:1. Ohne diese Ausnahme wäre er ein Durchfaller —
 * nach der Norm ist er keiner, weil die Beschriftung ihn identifiziert. Genau
 * diese Fehlmeldung produzieren rasterbasierte Werkzeuge, die nur Pixel sehen.
 * **Wir können es besser, weil wir wissen, was ein Element ist.** Icon-Knöpfe
 * ohne Text bleiben drin, denn dort trägt nur die Form die Information.
 *
 * DIE AUSNAHMEN DER NORM, vollständig und ohne Auslegung: inaktive Komponenten,
 * browserbestimmte Darstellung, und Grafiken, bei denen eine bestimmte
 * Darstellung wesentlich ist. **Fotos stehen nicht darunter.** Sie werden hier
 * trotzdem ausgeschlossen, aber aus einem **Messgrund**, nicht aus einem
 * Normgrund: über einem Foto gibt es keinen definierbaren Vordergrund gegen
 * Hintergrund, gegen den sich eine Begrenzung berechnen ließe. Der Unterschied
 * ist wichtig — eine falsche Normbehauptung im Werkzeug kostet die ganze
 * Sektion ihre Glaubwürdigkeit.
 *
 * ZWEI GRENZEN, DIE BLEIBEN, UND ZWAR PRINZIPIELL:
 *
 *   1. **Zustände sind in einem statischen Frame nicht prüfbar.** Man sieht
 *      einen Zustand. 1.4.11 verlangt Kontrast auch für die *Unterscheidung*
 *      der Zustände untereinander — ob der aktive Reiter sich vom inaktiven
 *      abhebt, ist aus einem Frame nicht zu beantworten.
 *   2. **Inaktive Komponenten sind ausgenommen, und „inaktiv" ist aus dem
 *      Layer-Baum nicht zuverlässig zu erkennen.** Ein ausgegrauter Knopf sieht
 *      aus wie ein Knopf mit wenig Kontrast. Wir melden ihn; die Entscheidung,
 *      ob er ausgenommen ist, bleibt beim Menschen.
 *
 * Beide stehen im UI, nicht nur hier.
 */
import type { Bitmap } from '../engine/ops'
import type { NodeSignal } from '../messages'
import { estimateBackground, pixelLuminance } from './measure'
import { contrastRatio, formatRatio, statusOf, type ContrastStatus } from './wcag'

/** WCAG 1.4.11 fordert 3:1 — dieselbe Zahl wie für großen Text. */
export const NON_TEXT_REQUIRED = 3

/**
 * Warum ein Element in den Prüfumfang kommt.
 *
 * Sortiert nach **„wie sicher verlangt die Norm hier 3:1"**, nicht nach „wie
 * sicher ist es ein UI-Element". Das ist nicht dasselbe: eine Trennlinie ist
 * sicher ein UI-Element und trotzdem meistens Dekoration.
 */
export type NonTextReason = 'reaktion' | 'stichwort' | 'wiederholung' | 'trennlinie'

export const REASON_LABELS: Record<NonTextReason, string> = {
  reaktion: 'Prototype-Interaktion',
  stichwort: 'Name deutet auf ein Bedienelement',
  wiederholung: 'wiederholtes Element (Karte, Zeile)',
  trennlinie: 'Trennlinie',
}

/**
 * Welche Gründe ausgeliefert werden.
 *
 * `reaktion` und `stichwort` sind Komponenten im Sinne der Norm: das eine ist
 * per Definition bedienbar, das andere von einem Menschen so benannt worden.
 *
 * `wiederholung` und `trennlinie` sind der klassische **Dekorationsfall** — eine
 * Trennlinie zwischen ohnehin unterscheidbaren Karten ist zum Verständnis nicht
 * nötig, und 1.4.11 verlangt für sie nichts. Sie werden gemessen, aber nicht
 * ausgeliefert, bis geklärt ist, wie oft sie bestreitbare Befunde erzeugen.
 * Dieselbe Konstruktion wie `shipped: false` bei den Vorhersageregeln: der Code
 * und der Grund bleiben beieinander.
 */
export const SHIPPED_REASONS: readonly NonTextReason[] = ['reaktion', 'stichwort']

/** Ab so vielen gleichartigen Geschwistern gilt ein Element als wiederholt. */
const REPETITION_MIN_SIBLINGS = 3

/** Bis zu diesem Anteil der kürzeren Kante gilt ein Element als Linie. */
const SEPARATOR_MAX_THICKNESS = 4

/** Elemente über diesem Flächenanteil sind Hintergründe, keine Komponenten. */
const MAX_AREA_RATIO = 0.5

export type NonTextResult = {
  nodeId: string
  name: string
  reason: NonTextReason
  shipped: boolean
  rect: { x: number; y: number; width: number; height: number }
  /** Kontrast der Begrenzung gegen die unmittelbar angrenzende Farbe. */
  ratio: number
  required: number
  status: ContrastStatus
  /**
   * Die Komponente trägt eigenen sichtbaren Text — dann ist ihre Begrenzung
   * nach 1.4.11 nicht erforderlich, und der Befund entfällt.
   */
  identifiableByText: boolean
  approximate: boolean
}

/** Alle Nachfahren eines Knotens, über die Elternkette. */
function descendantsOf(id: string, byParent: Map<string, NodeSignal[]>): NodeSignal[] {
  const out: NodeSignal[] = []
  const queue = [...(byParent.get(id) ?? [])]
  while (queue.length > 0) {
    const node = queue.shift() as NodeSignal
    out.push(node)
    queue.push(...(byParent.get(node.id) ?? []))
  }
  return out
}

/**
 * Trägt dieses Element eigenen sichtbaren Text?
 *
 * Ein Textknoten unterhalb, der Zeichen hat und innerhalb der Fläche liegt.
 * „Innerhalb" wird geprüft und nicht angenommen: ein Textknoten kann in der
 * Ebenenstruktur zu einem Element gehören und trotzdem woanders liegen.
 */
function hasOwnLabel(element: NodeSignal, byParent: Map<string, NodeSignal[]>): boolean {
  return descendantsOf(element.id, byParent).some(
    (node) =>
      node.isText &&
      (node.charCount ?? 0) > 0 &&
      node.x >= element.x - 1 &&
      node.y >= element.y - 1 &&
      node.x + node.width <= element.x + element.width + 1 &&
      node.y + node.height <= element.y + element.height + 1,
  )
}

/** Warum — oder ob überhaupt — ein Knoten geprüft wird. */
export function reasonFor(
  signal: NodeSignal,
  siblings: readonly NodeSignal[],
  frameWidth: number,
  frameHeight: number,
): NonTextReason | null {
  if (signal.isText) return null
  // Ein Foto hat keinen definierbaren Vordergrund gegen Hintergrund — das ist
  // ein Messgrund, kein Normgrund (siehe Modulkopf).
  if (signal.isImage) return null
  if (!signal.hasFill) return null
  if (signal.width <= 0 || signal.height <= 0) return null
  if ((signal.width * signal.height) / (frameWidth * frameHeight) > MAX_AREA_RATIO) return null

  if (signal.hasReactions) return 'reaktion'
  if (signal.nameHints.length > 0) return 'stichwort'

  const thickness = Math.min(signal.width, signal.height)
  const length = Math.max(signal.width, signal.height)
  if (thickness <= SEPARATOR_MAX_THICKNESS && length > thickness * 8) return 'trennlinie'

  const alike = siblings.filter(
    (other) =>
      other.id !== signal.id &&
      other.type === signal.type &&
      Math.abs(other.width - signal.width) <= signal.width * 0.05 &&
      Math.abs(other.height - signal.height) <= signal.height * 0.05,
  )
  if (alike.length + 1 >= REPETITION_MIN_SIBLINGS) return 'wiederholung'

  return null
}

/**
 * Die Farbe **innen an der Kante** und die **unmittelbar angrenzende** außen.
 *
 * Je ein schmales Band beiderseits der Kante, mit einem Pixel Abstand zur Kante
 * selbst: dort sitzt die Kantenglättung, und die hat dieses Projekt schon
 * einmal eine Messung gekostet.
 */
function edgeSamples(
  image: Bitmap,
  rect: { x: number; y: number; width: number; height: number },
  scaleX: number,
  scaleY: number,
): { inner: number[]; outer: number[] } {
  const band = Math.max(1, Math.round(Math.min(rect.width * scaleX, rect.height * scaleY) * 0.08))
  const gap = 1
  const inner: number[] = []
  const outer: number[] = []

  const x0 = Math.round(rect.x * scaleX)
  const y0 = Math.round(rect.y * scaleY)
  const x1 = Math.round((rect.x + rect.width) * scaleX)
  const y1 = Math.round((rect.y + rect.height) * scaleY)

  const at = (x: number, y: number): number | null => {
    if (x < 0 || y < 0 || x >= image.width || y >= image.height) return null
    const p = (y * image.width + x) * 4
    return pixelLuminance(image.data[p], image.data[p + 1], image.data[p + 2])
  }
  const push = (target: number[], x: number, y: number): void => {
    const value = at(x, y)
    if (value !== null) target.push(value)
  }

  for (let x = x0; x < x1; x++) {
    for (let d = 0; d < band; d++) {
      push(inner, x, y0 + gap + d)
      push(inner, x, y1 - 1 - gap - d)
      push(outer, x, y0 - 1 - gap - d)
      push(outer, x, y1 + gap + d)
    }
  }
  for (let y = y0; y < y1; y++) {
    for (let d = 0; d < band; d++) {
      push(inner, x0 + gap + d, y)
      push(inner, x1 - 1 - gap - d, y)
      push(outer, x0 - 1 - gap - d, y)
      push(outer, x1 + gap + d, y)
    }
  }

  return { inner, outer }
}

export type NonTextOptions = {
  image: Bitmap
  signals: readonly NodeSignal[]
  frameWidth: number
  frameHeight: number
}

export function measureNonTextContrast(options: NonTextOptions): {
  results: NonTextResult[]
  skipped: Array<{ nodeId: string; reason: string }>
} {
  const { image, signals, frameWidth, frameHeight } = options
  const scaleX = image.width / frameWidth
  const scaleY = image.height / frameHeight

  const byParent = new Map<string, NodeSignal[]>()
  for (const signal of signals) {
    const key = signal.parentId ?? '__root__'
    const list = byParent.get(key) ?? []
    list.push(signal)
    byParent.set(key, list)
  }

  const results: NonTextResult[] = []
  const skipped: Array<{ nodeId: string; reason: string }> = []

  for (const signal of signals) {
    const siblings = byParent.get(signal.parentId ?? '__root__') ?? []
    const reason = reasonFor(signal, siblings, frameWidth, frameHeight)
    if (!reason) continue

    const { inner, outer } = edgeSamples(image, signal, scaleX, scaleY)
    // Die Begrenzung braucht beide Seiten. Fehlt eine — das Element liegt am
    // Frame-Rand —, gibt es keine angrenzende Farbe und nichts zu vergleichen.
    const innerEstimate = estimateBackground(inner, null)
    const outerEstimate = estimateBackground(outer, null)
    if (!innerEstimate || !outerEstimate) {
      skipped.push({ nodeId: signal.id, reason: 'keine angrenzende Fläche — Element liegt am Frame-Rand' })
      continue
    }

    const ratio = contrastRatio(innerEstimate.luminance, outerEstimate.luminance)
    results.push({
      nodeId: signal.id,
      name: signal.name,
      reason,
      shipped: SHIPPED_REASONS.includes(reason),
      rect: { x: signal.x, y: signal.y, width: signal.width, height: signal.height },
      ratio,
      required: NON_TEXT_REQUIRED,
      status: statusOf(ratio, NON_TEXT_REQUIRED),
      identifiableByText: hasOwnLabel(signal, byParent),
      approximate: innerEstimate.varies || outerEstimate.varies,
    })
  }

  results.sort((a, b) => a.ratio - b.ratio)
  return { results, skipped }
}

/**
 * Der Befundsatz. Nur für Elemente, die **kein** eigenes Label tragen — mit
 * Label verlangt die Norm die Begrenzung nicht, und ein Befund darüber wäre
 * eine Fehlmeldung.
 */
export function nonTextFindingText(result: NonTextResult): string {
  const label = result.name.trim().length > 0 ? `„${result.name.trim()}"` : 'Ein Element'
  return (
    `${label} hebt sich mit ${formatRatio(result.ratio)} von seiner Umgebung ab — ` +
    `WCAG AA verlangt ${formatRatio(result.required)} für Elemente, die man erkennen können muss ` +
    `(${REASON_LABELS[result.reason]}).`
  )
}

/** Was tatsächlich gemeldet wird: ausgeliefert, durchgefallen, ohne eigenes Label. */
export function reportableNonText(results: readonly NonTextResult[]): NonTextResult[] {
  return results.filter((result) => result.shipped && !result.identifiableByText && result.status === 'durchgefallen')
}

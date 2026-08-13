/**
 * Der Frame, den die README seit 1.2 als fehlend führt: **mit gewollter
 * Verdeckung und Drehung.**
 *
 * WOZU. Die drei offenen Risiken der Kontrastmessung — Verdeckung, Rotation,
 * Subpixel — haben eines gemeinsam: die Bounding-Box ist nicht, was man sieht.
 * Kein Generator dieses Repos erzeugt sie, und deshalb konnte kein Lauf zeigen,
 * dass die Messung daran scheitert (README, „Was die Generatoren nicht
 * erzeugen"). Ein Set, das eine Eigenschaft nicht enthält, bestätigt jede
 * Methode, die an ihr scheitert — zweimal ist das diesem Projekt passiert.
 *
 * DIESER FRAME IST EINE GEGENPROBE, KEINE STICHPROBE. Er sagt „die Erkennung
 * greift", nicht „so oft kommt das vor". Seine Zahlen dürfen niemals in eine
 * Quote über die Prüfschärfe eingerechnet werden — die steht in
 * `measurable-audit.ts` und läuft auf den normalen Frames. Deshalb liegt er in
 * einer eigenen Datei und wird getrennt ausgewiesen.
 *
 * VIER FÄLLE, JE EINER PRO GRUND, plus eine Kontrolle, die messbar bleiben muss.
 * Die Kontrolle ist der wichtigere Teil: eine Prüfung, die alles verwirft, ist
 * kein Fortschritt gegenüber einer, die alles meldet.
 */
import { pixelLuminance } from '../src/contrast/measure'
import type { Bitmap } from '../src/engine/ops'
import type { NodeSignal } from '../src/messages'

export const OVERLAP_WIDTH = 420
export const OVERLAP_HEIGHT = 420

/** 2x, wie ein Retina-Export — Kantenglättung braucht Auflösung. */
const SCALE = 2

type Rect = { x: number; y: number; width: number; height: number }
type Rgb = [number, number, number]

const BACKGROUND: Rgb = [247, 247, 249]
const INK: Rgb = [18, 20, 24]
const WHITE: Rgb = [255, 255, 255]
const BADGE: Rgb = [206, 46, 46]

export type OverlapFrame = {
  label: string
  image: Bitmap
  signals: NodeSignal[]
  frameWidth: number
  frameHeight: number
  /** Was der Frame über jeden Knoten behauptet — die erwartete Antwort. */
  expected: Array<{ nodeId: string; reason: string }>
}

export function buildOverlapFrame(): OverlapFrame {
  const canvasWidth = OVERLAP_WIDTH * SCALE
  const canvasHeight = OVERLAP_HEIGHT * SCALE
  const data = new Uint8ClampedArray(canvasWidth * canvasHeight * 4).fill(255)

  const put = (x: number, y: number, rgb: Rgb, mix = 1): void => {
    if (x < 0 || y < 0 || x >= canvasWidth || y >= canvasHeight) return
    const p = (y * canvasWidth + x) * 4
    for (let c = 0; c < 3; c++) data[p + c] = Math.round(data[p + c] * (1 - mix) + rgb[c] * mix)
    data[p + 3] = 255
  }

  const fill = (rect: Rect, rgb: Rgb): void => {
    for (let y = Math.round(rect.y * SCALE); y < Math.round((rect.y + rect.height) * SCALE); y++) {
      for (let x = Math.round(rect.x * SCALE); x < Math.round((rect.x + rect.width) * SCALE); x++) put(x, y, rgb)
    }
  }

  /**
   * Glyphenbalken **mit Kantenglättung** — je ein halb gemischtes Randpixel.
   *
   * Genau die Eigenschaft, deren Fehlen 1.2 zwei Messungen gekostet hat. Ein
   * Prüffall für die Kontrastmessung, der sie nicht hat, prüft die
   * Kontrastmessung nicht.
   */
  const glyphs = (rect: Rect, ink: Rgb): void => {
    const y0 = Math.round((rect.y + rect.height * 0.2) * SCALE)
    const y1 = Math.round((rect.y + rect.height * 0.8) * SCALE)
    const step = Math.max(6, Math.round(rect.height * 0.9 * SCALE))
    const bar = Math.max(3, Math.round(step * 0.55))
    for (let gx = Math.round(rect.x * SCALE); gx + bar < Math.round((rect.x + rect.width) * SCALE); gx += step) {
      for (let y = y0; y < y1; y++) {
        for (let d = 0; d < bar; d++) put(gx + d, y, ink, d === 0 || d === bar - 1 ? 0.5 : 1)
      }
    }
  }

  /** Ein Verlauf von schwarz nach weiß — ein Hintergrund, der keiner ist. */
  const gradient = (rect: Rect): void => {
    const x0 = Math.round(rect.x * SCALE)
    const x1 = Math.round((rect.x + rect.width) * SCALE)
    for (let x = x0; x < x1; x++) {
      const level = Math.round(((x - x0) / Math.max(1, x1 - x0 - 1)) * 255)
      for (let y = Math.round(rect.y * SCALE); y < Math.round((rect.y + rect.height) * SCALE); y++) {
        put(x, y, [level, level, level])
      }
    }
  }

  let z = 0
  const signals: NodeSignal[] = []
  const signal = (partial: Partial<NodeSignal> & Rect & { name: string; id: string }): NodeSignal => {
    const node: NodeSignal = {
      parentId: null,
      type: 'FRAME',
      zIndex: z++,
      opacity: 1,
      isText: false,
      isImage: false,
      hasFill: false,
      hasReactions: false,
      nameHints: [],
      ...partial,
    }
    signals.push(node)
    return node
  }

  fill({ x: 0, y: 0, width: OVERLAP_WIDTH, height: OVERLAP_HEIGHT }, BACKGROUND)

  // --- (1) Kontrolle: messbar, und das muss so bleiben ----------------------
  const controlRect = { x: 24, y: 24, width: 300, height: 22 }
  glyphs(controlRect, INK)
  signal({
    id: 'kontrolle',
    name: 'Kontrolle',
    ...controlRect,
    isText: true,
    fontSize: 18,
    charCount: 20,
    text: 'Diese Zeile ist messbar',
    fillLuminance: pixelLuminance(...INK),
  })

  // --- (2) Verdeckt: eine Plakette liegt später auf dem Textbereich ---------
  //
  // Der Fall, der die Messung still verfälscht: die Plakette ist rot und deckt
  // ein Drittel des Rahmens. Das Histogramm findet sie und nennt sie Grund.
  const coveredRect = { x: 24, y: 90, width: 300, height: 22 }
  glyphs(coveredRect, INK)
  signal({
    id: 'verdeckt',
    name: 'Verdeckte Zeile',
    ...coveredRect,
    isText: true,
    fontSize: 18,
    charCount: 20,
    text: 'Diese Zeile ist verdeckt',
    fillLuminance: pixelLuminance(...INK),
  })
  const badgeRect = { x: 180, y: 86, width: 150, height: 30 }
  fill(badgeRect, BADGE)
  glyphs({ x: badgeRect.x + 8, y: badgeRect.y + 6, width: 60, height: 16 }, WHITE)
  signal({ id: 'plakette', name: 'Plakette', ...badgeRect, hasFill: true })

  // --- (3) Gedreht: die achsenparallele Box ist voller Fremdgrund -----------
  //
  // Gezeichnet als schräg laufende Balken, damit das Bild nicht behauptet, was
  // der Baum bestreitet. Innerhalb der Box liegt überwiegend Hintergrund.
  const rotatedRect = { x: 24, y: 150, width: 220, height: 90 }
  for (let i = 0; i < 10; i++) {
    fill({ x: rotatedRect.x + i * 20, y: rotatedRect.y + 72 - i * 7, width: 12, height: 14 }, INK)
  }
  signal({
    id: 'gedreht',
    name: 'Gedrehte Zeile',
    ...rotatedRect,
    isText: true,
    fontSize: 18,
    charCount: 18,
    text: 'Schräg gestellt',
    fillLuminance: pixelLuminance(...INK),
    // 18° — was in der Datei steht. Die Box darüber ist Figmas achsenparallele
    // Hülle und damit größer als der Text.
    rotation: -18,
  })

  // --- (4) Textkern fehlt: der Rahmen zeigt diesen Text nicht ---------------
  //
  // Bewusst **nichts gezeichnet**. So sieht ein Textknoten aus, den eine Maske
  // oder ein `clipsContent` des Elternrahmens abschneidet: er steht im Baum mit
  // Farbe und Größe, und an seiner Stelle ist der leere Grund. Bis 1.3 hat die
  // Messung dafür den Kontrast des Hintergrunds gegen sich selbst gemeldet.
  const clippedRect = { x: 24, y: 260, width: 300, height: 22 }
  signal({
    id: 'abgeschnitten',
    name: 'Abgeschnittene Zeile',
    ...clippedRect,
    isText: true,
    fontSize: 18,
    charCount: 20,
    text: 'Von einer Maske entfernt',
    fillLuminance: pixelLuminance(...INK),
  })

  // --- (5) Zweite Kontrolle: Text über einem Verlauf MUSS messbar bleiben ---
  //
  // Der Grenzfall, an dem sich die Schwelle für `backgroundShare` entschieden
  // hat. 1.2 C5 erklärt diesen Fall ausdrücklich für messbar: gemeldet wird der
  // schlechteste Wert, und der Befund sagt, dass der Grund wechselt. Weiß über
  // einem Verlauf, der bis Weiß läuft, ist am hellen Ende unlesbar — und genau
  // das gibt die Messung aus.
  //
  // Gemessen kommt dieses Element auf einen Flächenanteil von 0,034. Die
  // naheliegende Schwelle 0,1 hätte es verworfen und damit eine richtige Aussage
  // gegen keine getauscht; deshalb steht dort jetzt 2/128. Dieser Knoten ist der
  // Wächter dieser Entscheidung.
  const gradientRect = { x: 24, y: 320, width: 300, height: 40 }
  gradient(gradientRect)
  const overGradient = { x: 34, y: 330, width: 280, height: 20 }
  glyphs(overGradient, WHITE)
  signal({ id: 'verlauf', name: 'Verlauf', ...gradientRect, hasFill: true })
  signal({
    id: 'auf-verlauf',
    name: 'Zeile auf Verlauf',
    ...overGradient,
    isText: true,
    fontSize: 16,
    charCount: 18,
    text: 'Weiß über Verlauf',
    fillLuminance: pixelLuminance(...WHITE),
  })

  // --- (6) Der Extremfall für „kein tragender Hintergrund": reine Textur ----
  //
  // Kein Prüffall, sondern ein **Beleg**: dieser Knoten beantwortet die Frage,
  // ob die zweite Hälfte von 1b überhaupt eine Schwelle haben kann. Wenn schon
  // gleichverteiltes Rauschen — das Äußerste, was ein Bild an Strukturlosigkeit
  // hergibt — noch eine stärkste Fläche von messbarer Größe erzeugt, dann liegt
  // *kein* Wert zwischen ihm und dem Verlauf, und die Prüfung hat keinen
  // Arbeitsbereich. Die Zahl steht im Audit; die Folgerung in
  // `MeasurableLimits.backgroundShare`.
  //
  // Deterministisch erzeugt, ohne `Math.random`: ein Testbild, das sich zwischen
  // zwei Läufen ändert, kann keine Schwelle belegen. `Math.imul` statt `*`, weil
  // ein 32-Bit-Produkt in einem `number` seine unteren Bits verliert und der
  // Hash dann nicht mehr gleichverteilt ist.
  const noiseRect = { x: 24, y: 372, width: 300, height: 36 }
  const nx0 = Math.round(noiseRect.x * SCALE)
  const ny0 = Math.round(noiseRect.y * SCALE)
  for (let y = ny0; y < Math.round((noiseRect.y + noiseRect.height) * SCALE); y++) {
    for (let x = nx0; x < Math.round((noiseRect.x + noiseRect.width) * SCALE); x++) {
      let hash = Math.imul(x + 1, 0x9e3779b1) ^ Math.imul(y + 1, 0x85ebca6b)
      hash = Math.imul(hash ^ (hash >>> 15), 0xc2b2ae35)
      const level = (hash >>> 17) & 0xff
      put(x, y, [level, level, level])
    }
  }
  const overNoise = { x: 34, y: 380, width: 280, height: 20 }
  glyphs(overNoise, WHITE)
  signal({ id: 'textur', name: 'Textur', ...noiseRect, hasFill: true, isImage: true })
  signal({
    id: 'auf-textur',
    name: 'Zeile auf Textur',
    ...overNoise,
    isText: true,
    fontSize: 16,
    charCount: 18,
    text: 'Weiß über Textur',
    fillLuminance: pixelLuminance(...WHITE),
  })

  return {
    label: 'Verdeckung und Drehung 420 x 420 (Gegenprobe)',
    image: { width: canvasWidth, height: canvasHeight, data },
    signals,
    frameWidth: OVERLAP_WIDTH,
    frameHeight: OVERLAP_HEIGHT,
    expected: [
      { nodeId: 'kontrolle', reason: 'gemessen' },
      { nodeId: 'verdeckt', reason: 'verdeckt' },
      { nodeId: 'gedreht', reason: 'gedreht' },
      { nodeId: 'abgeschnitten', reason: 'textkern-fehlt' },
      { nodeId: 'auf-verlauf', reason: 'gemessen' },
      { nodeId: 'auf-textur', reason: 'gemessen — siehe MeasurableLimits.backgroundShare' },
    ],
  }
}

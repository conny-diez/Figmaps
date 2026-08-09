/**
 * Der Prüffall aus 1.2 A4 — ein Onboarding-Screen, 393 × 852.
 *
 * Zwei Fragen, die keine Metrik beantwortet und die deshalb am Bild entschieden
 * werden müssen:
 *
 *   1. Wird der **gelbe CTA unten** heiß?
 *   2. Wird die **dunkle Kachel „Nachrichten"** warm? Sie ist mit Abstand das
 *      kontrastreichste Element des Screens — nahezu schwarz auf hellem Grund —
 *      und liegt in der ausgelieferten Karte im Blauen.
 *
 * Der Screen ist **konstruiert**, und das ist hier kein Mangel, sondern der
 * Zweck: die beiden Fragen sind Fragen über bekannte Antworten. Ein Screen, bei
 * dem man vorher weiß, welches Element das kontrastreichste ist, ist genau das,
 * was ein Sanity-Check braucht. Er ersetzt keine Messung an echten Daten — die
 * steht in `alpha.ts` — und keine Zahl von hier gehört in eine Feuerrate.
 *
 * Die Geometrie folgt dem Aufbau, an dem die Kandidatenerkennung geprüft wurde
 * (README, „Was jetzt gefunden wird"): 393 × 852, zwei Knöpfe, vier
 * Kategorie-Kacheln je 165 × 150 px mit Bild und Beschriftung in einer
 * Auto-Layout-Zwischenebene. Beschriftungen und Farben sind gattungstypisch
 * gewählt, nicht einem bestimmten Produkt entnommen.
 */
import type { Bitmap } from '../src/engine/ops'
import type { NodeSignal } from '../src/messages'
import { pixelLuminance } from '../src/contrast/measure'

/**
 * Relative Luminanz einer gezeichneten Farbe — dasselbe, was `collectSignals`
 * in Figma aus dem Fill des Textknotens liest.
 *
 * Ohne dieses Feld kann die Contrastmap einen Textknoten nicht messen, und ein
 * konstruierter Frame ohne es prüft die Kontrastmessung überhaupt nicht. Bis
 * 1.2 C fehlte es hier, und die erste Messung übersprang folgerichtig **alle**
 * Elemente.
 */
function inkLuminance(colour: Rgb): number {
  return pixelLuminance(colour[0], colour[1], colour[2])
}

export const ONBOARDING_WIDTH = 393
export const ONBOARDING_HEIGHT = 852

/** Zeichenauflösung — 2x, wie ein Retina-Export aus Figma. */
const SCALE = 2

type Rect = { x: number; y: number; width: number; height: number }
type Rgb = [number, number, number]

/** Ein Element, dessen Aufmerksamkeit im Prüffall ausgewiesen wird. */
export type Region = {
  id: string
  label: string
  rect: Rect
  /** Was der Prüffall über dieses Element wissen will. */
  question: string
}

export type OnboardingFrame = {
  image: Bitmap
  signals: NodeSignal[]
  frameWidth: number
  frameHeight: number
  regions: Region[]
}

const BACKGROUND: Rgb = [247, 247, 249]
/** Kräftiges Gelb: das hellste Element des Screens — und zugleich ein Knopf. */
const CTA_YELLOW: Rgb = [255, 200, 0]
const INK: Rgb = [18, 20, 24]
/** Fast schwarz auf hellem Grund: das kontrastreichste Element des Screens. */
const DARK_CARD: Rgb = [20, 22, 26]

/**
 * Die vier Kacheln. „Nachrichten" ist die dunkle — sie trägt die zweite Frage
 * des Prüffalls.
 *
 * Die Kategorien sind bewusst allgemein gehalten. Der Prüffall soll ein
 * *gattungstypisches* Onboarding zeigen, keinen Nachbau eines bestimmten
 * Produkts: was hier geprüft wird, ist die Reaktion der Karte auf Helligkeit
 * und Kontrast, und dafür ist die Beschriftung austauschbar.
 */
const TILES: ReadonlyArray<{ name: string; fill: Rgb; ink: Rgb; imageFill: Rgb }> = [
  { name: 'Wetter', fill: [255, 255, 255], ink: INK, imageFill: [198, 224, 205] },
  { name: 'Termine', fill: [255, 255, 255], ink: INK, imageFill: [201, 216, 236] },
  { name: 'Sport', fill: [255, 255, 255], ink: INK, imageFill: [226, 224, 219] },
  { name: 'Nachrichten', fill: DARK_CARD, ink: [255, 255, 255], imageFill: [56, 60, 68] },
]

function makePainter(pixels: Uint8ClampedArray, canvasWidth: number, canvasHeight: number) {
  const fill = (rect: Rect, rgb: Rgb): void => {
    const x0 = Math.max(0, Math.round(rect.x * SCALE))
    const y0 = Math.max(0, Math.round(rect.y * SCALE))
    const x1 = Math.min(canvasWidth, Math.round((rect.x + rect.width) * SCALE))
    const y1 = Math.min(canvasHeight, Math.round((rect.y + rect.height) * SCALE))
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const p = (y * canvasWidth + x) * 4
        pixels[p] = rgb[0]
        pixels[p + 1] = rgb[1]
        pixels[p + 2] = rgb[2]
        pixels[p + 3] = 255
      }
    }
  }

  /** Text als Folge glyphengroßer Balken — genug Textur für Kanten und Kontrast. */
  const text = (rect: Rect, rgb: Rgb): void => {
    const glyph = Math.max(2, rect.height * 0.55)
    for (let x = rect.x; x < rect.x + rect.width; x += glyph * 1.4) {
      fill({ x, y: rect.y + rect.height * 0.2, width: glyph, height: rect.height * 0.6 }, rgb)
    }
  }

  return { fill, text }
}

export function buildOnboardingFrame(): OnboardingFrame {
  const canvasWidth = ONBOARDING_WIDTH * SCALE
  const canvasHeight = ONBOARDING_HEIGHT * SCALE
  const pixels = new Uint8ClampedArray(canvasWidth * canvasHeight * 4).fill(255)
  const { fill, text } = makePainter(pixels, canvasWidth, canvasHeight)

  let nextId = 0
  const signals: NodeSignal[] = []
  const signal = (partial: Partial<NodeSignal> & Rect & { name: string }): NodeSignal => {
    const node: NodeSignal = {
      id: `o${nextId++}`,
      parentId: null,
      type: 'FRAME',
      zIndex: nextId,
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

  fill({ x: 0, y: 0, width: ONBOARDING_WIDTH, height: ONBOARDING_HEIGHT }, BACKGROUND)

  // --- Statusleiste --------------------------------------------------------
  fill({ x: 0, y: 0, width: ONBOARDING_WIDTH, height: 47 }, [255, 255, 255])
  text({ x: 24, y: 16, width: 38, height: 13 }, INK)
  text({ x: ONBOARDING_WIDTH - 84, y: 16, width: 60, height: 13 }, INK)
  signal({ name: 'Statusleiste', x: 0, y: 0, width: ONBOARDING_WIDTH, height: 47, hasFill: true })

  // --- Kopfbereich ---------------------------------------------------------
  const headline = 'Willkommen zurück'
  text({ x: 24, y: 84, width: 260, height: 30 }, INK)
  signal({
    name: 'Überschrift',
    x: 24,
    y: 84,
    width: 260,
    height: 30,
    isText: true,
    charCount: headline.length,
    fontSize: 28,
    fontWeight: 700,
    text: headline,
    fillLuminance: inkLuminance(INK),
  })
  const subline = 'Wählen Sie, was Sie interessiert.'
  text({ x: 24, y: 126, width: 250, height: 16 }, [110, 114, 122])
  signal({
    name: 'Unterzeile',
    x: 24,
    y: 126,
    width: 250,
    height: 16,
    isText: true,
    charCount: subline.length,
    fontSize: 15,
    // Absichtlich helles Grau: der Fall, den die Contrastmap finden soll.
    fillLuminance: inkLuminance([110, 114, 122]),
    text: subline,
  })

  // --- Vier Kategorie-Kacheln, 165 x 150, mit Zwischenebene ----------------
  const tileWidth = 165
  const tileHeight = 150
  const gapX = ONBOARDING_WIDTH - 24 * 2 - tileWidth * 2
  const regions: Region[] = []

  TILES.forEach((tile, index) => {
    const column = index % 2
    const row = Math.floor(index / 2)
    const x = 24 + column * (tileWidth + gapX)
    const y = 186 + row * (tileHeight + 16)
    const rect = { x, y, width: tileWidth, height: tileHeight }

    fill(rect, tile.fill)
    const imageRect = { x: x + 14, y: y + 16, width: tileWidth - 28, height: 74 }
    fill(imageRect, tile.imageFill)
    text({ x: x + 14, y: y + 106, width: tileWidth - 60, height: 17 }, tile.ink)

    const card = signal({ name: `Kategorie-Kachel ${tile.name}`, ...rect, hasFill: true, hasReactions: true })
    const inner = signal({ name: 'Inhalt', parentId: card.id, ...rect })
    signal({ name: `Bild ${tile.name}`, parentId: inner.id, ...imageRect, isImage: true, hasFill: true })
    signal({
      name: tile.name,
      parentId: inner.id,
      x: x + 14,
      y: y + 106,
      width: tileWidth - 60,
      height: 17,
      isText: true,
      charCount: tile.name.length,
      fontSize: 16,
      fontWeight: 600,
      text: tile.name,
      fillLuminance: inkLuminance(tile.ink),
    })

    if (tile.name === 'Nachrichten') {
      regions.push({
        id: 'kachel-nachrichten',
        label: 'Kachel „Nachrichten" (dunkel)',
        rect,
        question: 'Das kontrastreichste Element des Screens — wird es warm?',
      })
    }
  })

  // --- Fußbereich: gelber primärer CTA plus sekundärer Knopf ---------------
  const ctaRect = { x: 24, y: 700, width: ONBOARDING_WIDTH - 48, height: 56 }
  fill(ctaRect, CTA_YELLOW)
  text({ x: ctaRect.x + 108, y: ctaRect.y + 20, width: 130, height: 17 }, INK)
  const cta = signal({
    name: 'Jetzt loslegen Button',
    ...ctaRect,
    hasFill: true,
    hasReactions: true,
    nameHints: ['button', 'jetzt'],
  })
  // Die Beschriftung als eigener Textknoten — so steht sie auch in einer echten
  // Datei, und nur so kann die Contrastmap sie messen.
  signal({
    name: 'Jetzt loslegen',
    parentId: cta.id,
    x: ctaRect.x + 108,
    y: ctaRect.y + 20,
    width: 130,
    height: 17,
    isText: true,
    charCount: 14,
    fontSize: 17,
    fontWeight: 600,
    text: 'Jetzt loslegen',
    fillLuminance: inkLuminance(INK),
  })
  regions.push({
    id: 'cta-gelb',
    label: 'Gelber CTA „Jetzt loslegen"',
    rect: ctaRect,
    question: 'Der primäre Knopf am unteren Rand — wird er heiß?',
  })

  const secondaryRect = { x: 24, y: 772, width: ONBOARDING_WIDTH - 48, height: 44 }
  fill(secondaryRect, [255, 255, 255])
  text({ x: secondaryRect.x + 128, y: secondaryRect.y + 15, width: 90, height: 14 }, [110, 114, 122])
  const secondary = signal({ name: 'Später auswählen Button', ...secondaryRect, hasFill: true, nameHints: ['button'] })
  signal({
    name: 'Später auswählen',
    parentId: secondary.id,
    x: secondaryRect.x + 128,
    y: secondaryRect.y + 15,
    width: 90,
    height: 14,
    isText: true,
    charCount: 16,
    fontSize: 14,
    text: 'Später auswählen',
    fillLuminance: inkLuminance([110, 114, 122]),
  })

  return {
    image: { width: canvasWidth, height: canvasHeight, data: pixels },
    signals,
    frameWidth: ONBOARDING_WIDTH,
    frameHeight: ONBOARDING_HEIGHT,
    regions,
  }
}

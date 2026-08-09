/**
 * 1.2 C1 — Kontrastmessung, hybrid: Geometrie aus dem Layer-Baum,
 * Hintergrundfarbe aus den gerenderten Pixeln.
 *
 * WARUM HYBRID. Die Textfarbe steht im Layer-Baum und ist dort exakt. Der
 * *Hintergrund* steht dort nicht: er entsteht aus gestapelten Fills, Verläufen,
 * Fotos, Deckkraft, Effekten und Masken. Ihn aus dem Baum zu rekonstruieren
 * hieße, den Renderer nachzubauen — und jede Abweichung wäre ein falscher
 * Befund über eine Sache, die man einfach ansehen kann. Die gerenderten Pixel
 * lösen das ohne eine einzige Annahme.
 *
 * Umgekehrt wäre „alles aus den Pixeln" auch falsch: aus einem Screenshot ist
 * nicht zu erkennen, was ein Textknoten ist, wie groß seine Schrift wirklich
 * ist und ob sie fett ist — und genau davon hängt die WCAG-Schwelle ab.
 *
 * WAS DAS VON HEATMAP UND FOCUSMAP UNTERSCHEIDET. Diese Messung ist keine
 * Vorhersage. Sie hat keine Schwelle, die veralten kann, keinen Datensatz und
 * keine Kalibrierung — sie kann nicht in dem Sinne falsch sein, in dem eine
 * Heatmap falsch sein kann. Sie kann nur ungenau sein, und wo sie das ist,
 * sagt sie es (`approximate`).
 */
import type { Bitmap } from '../engine/ops'
import type { NodeSignal } from '../messages'
import { contrastRatio, formatRatio, isLargeText, requiredRatio, statusOf, type ContrastStatus } from './wcag'

/**
 * sRGB-Kanal → linear, wie in WCAG 2.1 definiert.
 *
 * Dieselbe Kurve wie `figma/traverse.ts` → `relativeLuminance`; sie steht hier
 * ein zweites Mal, weil dieses Modul auf `Bitmap`-Bytes arbeitet und jenes auf
 * Figmas `RGB` in `[0,1]`. Die Werte müssen übereinstimmen — dafür gibt es
 * einen Test.
 */
function channel(value: number): number {
  const c = value / 255
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
}

/** Relative Luminanz eines Pixels nach WCAG. */
export function pixelLuminance(r: number, g: number, b: number): number {
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
}

/**
 * Wie nah ein Pixel an der Textfarbe liegen darf und trotzdem noch als
 * Hintergrund zählt.
 *
 * Innerhalb des Textrahmens liegen Glyphen *und* Hintergrund. Die Glyphen
 * tragen die Textfarbe, also werden Pixel in ihrer Nähe verworfen — sonst
 * misste man den Text gegen sich selbst und bekäme ein Verhältnis nahe 1 auf
 * jedem Screen der Welt.
 *
 * Der Abstand ist bewusst großzügig: ein Antialiasing-Saum liegt irgendwo
 * zwischen Text und Grund, und ein halb gemischtes Pixel ist für diese Frage
 * keine Auskunft über den Hintergrund.
 */
const GLYPH_LUMINANCE_DISTANCE = 0.12

/**
 * So viele Hintergrundpixel müssen im Rahmen übrig bleiben, damit die Messung
 * darauf beruht. Darunter wird auf einen Ring **außerhalb** des Rahmens
 * ausgewichen — bei einem randlos gesetzten Text ist innen fast nur Glyphe.
 */
const MIN_BACKGROUND_PIXELS = 24

/**
 * Ab dieser Spanne der Hintergrundluminanz gilt das Ergebnis als Näherung.
 *
 * Über einem Foto oder einem Verlauf wechselt der Hintergrund je Pixel; es gibt
 * dann kein „das" Kontrastverhältnis, sondern eine Verteilung. Gemeldet wird
 * der **schlechteste** Wert im Textbereich — das ist die Aussage, die nicht zu
 * gut aussieht — und das Ergebnis wird als Näherung gekennzeichnet (C5).
 */
const APPROXIMATE_SPREAD = 0.1

export type ContrastResult = {
  nodeId: string
  /** Was dort steht, für den Befundtext. */
  text: string
  fontSize: number
  fontWeight: number
  /** Rechteck in Frame-Pixeln. */
  rect: { x: number; y: number; width: number; height: number }
  isLarge: boolean
  /** Der von WCAG geforderte Mindestwert — 4,5 oder 3. */
  required: number
  /** Der **schlechteste** Wert im Textbereich. */
  ratio: number
  /** Der beste Wert im Textbereich — die Spanne zeigt, wie uneinheitlich es ist. */
  bestRatio: number
  status: ContrastStatus
  /**
   * `true`, wenn der Hintergrund im Textbereich wechselt (Foto, Verlauf,
   * halbtransparente Fläche). Dann ist `ratio` eine Näherung nach unten, kein
   * Messwert.
   */
  approximate: boolean
  /** Wie viele Hintergrundpixel die Messung tragen. */
  sampleCount: number
  /** Wurde außerhalb des Rahmens abgetastet, weil innen zu wenig Grund war? */
  sampledOutside: boolean
}

export type MeasureOptions = {
  /** Gerendertes Bild des Frames, beliebige Auflösung. */
  image: Bitmap
  signals: readonly NodeSignal[]
  frameWidth: number
  frameHeight: number
}

/** Alle Hintergrundluminanzen in einem Rechteck, ohne die Glyphen. */
function sampleBackground(
  image: Bitmap,
  rect: { x: number; y: number; width: number; height: number },
  scaleX: number,
  scaleY: number,
  textLuminance: number,
  exclude?: { x: number; y: number; width: number; height: number },
): number[] {
  const x0 = Math.max(0, Math.floor(rect.x * scaleX))
  const y0 = Math.max(0, Math.floor(rect.y * scaleY))
  const x1 = Math.min(image.width, Math.ceil((rect.x + rect.width) * scaleX))
  const y1 = Math.min(image.height, Math.ceil((rect.y + rect.height) * scaleY))

  const ex0 = exclude ? Math.floor(exclude.x * scaleX) : 0
  const ey0 = exclude ? Math.floor(exclude.y * scaleY) : 0
  const ex1 = exclude ? Math.ceil((exclude.x + exclude.width) * scaleX) : 0
  const ey1 = exclude ? Math.ceil((exclude.y + exclude.height) * scaleY) : 0

  const out: number[] = []
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      if (exclude && x >= ex0 && x < ex1 && y >= ey0 && y < ey1) continue
      const p = (y * image.width + x) * 4
      const luminance = pixelLuminance(image.data[p], image.data[p + 1], image.data[p + 2])
      if (Math.abs(luminance - textLuminance) < GLYPH_LUMINANCE_DISTANCE) continue
      out.push(luminance)
    }
  }
  return out
}

/**
 * Misst den Kontrast jedes Textknotens gegen seinen tatsächlichen Hintergrund.
 *
 * Übersprungen wird ein Knoten nur, wenn er keine Textfarbe mitbringt
 * (`fillLuminance` fehlt, z. B. bei mehrfarbigem Text) oder wenn im
 * Textbereich **kein** Hintergrundpixel zu finden ist. Beides wird gezählt und
 * gehört in die Darstellung — eine Messung, die still Elemente auslässt, sagt
 * „alles in Ordnung", wo sie „ich weiß es nicht" meint.
 */
export function measureContrast(options: MeasureOptions): { results: ContrastResult[]; skipped: Array<{ nodeId: string; reason: string }> } {
  const { image, signals, frameWidth, frameHeight } = options
  const scaleX = image.width / frameWidth
  const scaleY = image.height / frameHeight

  const results: ContrastResult[] = []
  const skipped: Array<{ nodeId: string; reason: string }> = []

  for (const signal of signals) {
    if (!signal.isText) continue
    if (signal.fillLuminance === undefined) {
      skipped.push({ nodeId: signal.id, reason: 'keine einfarbige Textfarbe (Verlauf, Bild oder mehrere Fills)' })
      continue
    }
    const fontSize = signal.fontSize ?? 0
    if (fontSize <= 0) {
      skipped.push({ nodeId: signal.id, reason: 'keine Schriftgröße — ohne sie ist die WCAG-Schwelle nicht bestimmt' })
      continue
    }

    const rect = { x: signal.x, y: signal.y, width: signal.width, height: signal.height }
    const textLuminance = signal.fillLuminance
    let background = sampleBackground(image, rect, scaleX, scaleY, textLuminance)
    let sampledOutside = false

    if (background.length < MIN_BACKGROUND_PIXELS) {
      // Randlos gesetzter Text: innen ist fast alles Glyphe. Dann ein Ring
      // außerhalb, eine halbe Zeilenhöhe breit — nah genug, dass es noch
      // derselbe Hintergrund ist.
      const pad = Math.max(2, fontSize * 0.5)
      const outer = { x: rect.x - pad, y: rect.y - pad, width: rect.width + pad * 2, height: rect.height + pad * 2 }
      background = sampleBackground(image, outer, scaleX, scaleY, textLuminance, rect)
      sampledOutside = true
    }

    if (background.length === 0) {
      skipped.push({ nodeId: signal.id, reason: 'kein Hintergrundpixel gefunden — Text füllt seinen Rahmen vollständig' })
      continue
    }

    let worst = Infinity
    let best = 0
    let min = Infinity
    let max = -Infinity
    for (const luminance of background) {
      const ratio = contrastRatio(textLuminance, luminance)
      if (ratio < worst) worst = ratio
      if (ratio > best) best = ratio
      if (luminance < min) min = luminance
      if (luminance > max) max = luminance
    }

    const fontWeight = signal.fontWeight ?? 400
    const required = requiredRatio(fontSize, fontWeight)
    results.push({
      nodeId: signal.id,
      text: signal.text ?? signal.name,
      fontSize,
      fontWeight,
      rect,
      isLarge: isLargeText(fontSize, fontWeight),
      required,
      ratio: worst,
      bestRatio: best,
      status: statusOf(worst, required),
      approximate: max - min > APPROXIMATE_SPREAD,
      sampleCount: background.length,
      sampledOutside,
    })
  }

  // Schlechtester zuerst: was durchfällt, steht oben.
  results.sort((a, b) => a.ratio / a.required - b.ratio / b.required)
  return { results, skipped }
}

/**
 * Der Befundsatz zu einem Ergebnis (C4).
 *
 * **Kein Vorhersage-Modus.** „Hat 3,1:1" ist eine überprüfbare Tatsache über
 * die Datei, keine Aussage darüber, was jemand tun wird. Der Disclaimer, der
 * unter jeder Heatmap steht, gilt hier ausdrücklich **nicht** — und deshalb
 * darf dieser Satz auch nicht klingen wie einer von dort.
 *
 * Die übrigen Sprachregeln aus C-2 gelten weiter: eine Nachkommastelle, kein
 * Ausrufezeichen, keine Handlungsanweisung.
 */
export function contrastFindingText(result: ContrastResult): string {
  const label = result.text.trim().length > 0 ? `„${result.text.trim()}"` : 'Ein Textelement'
  const size = result.isLarge ? 'großer Text' : 'normaler Text'
  const requirement = `WCAG AA verlangt ${formatRatio(result.required)} (${size})`

  if (result.status === 'durchgefallen') {
    return result.approximate
      ? `${label} erreicht im ungünstigsten Bereich ${formatRatio(result.ratio)} gegen seinen Hintergrund — ${requirement}. Der Hintergrund wechselt unter dem Text, der Wert ist eine Näherung nach unten.`
      : `${label} hat ${formatRatio(result.ratio)} gegen seinen Hintergrund — ${requirement}.`
  }
  if (result.status === 'grenzwertig') {
    return `${label} hat ${formatRatio(result.ratio)} gegen seinen Hintergrund und liegt damit knapp über der Anforderung — ${requirement}.`
  }
  return `${label} hat ${formatRatio(result.ratio)} gegen seinen Hintergrund — ${requirement}.`
}

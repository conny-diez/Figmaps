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
import {
  MEASURABLE_LIMITS,
  occludedShare,
  rotationOf,
  type MeasurableLimits,
  type Skipped,
} from './measurable'
import { isSystemChrome } from './system-chrome'
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
 * Auflösung des Luminanz-Histogramms, mit dem der Hintergrund gefunden wird.
 *
 * Das Histogramm **wählt** nur die Fläche aus; der zurückgegebene Wert ist der
 * Mittelwert der tatsächlichen Pixel darin. Sonst käme die Binbreite als Fehler
 * ins Verhältnis, und bei einer Ausgabe, die auf 0,05 genau sein soll, ist das
 * zu viel: 128 Bins wären allein schon ±0,08 im Verhältnis.
 */
export const HISTOGRAM_BINS = 128

/**
 * Fenster um die Textfarbe, das bei der Suche nach dem Hintergrund
 * ausgeblendet wird — in Bins.
 *
 * Bewusst schmal (±1 Bin ≈ ±0,008 Luminanz): es soll den Textkern entfernen und
 * nicht mehr. Läge ein Hintergrund knapp neben der Textfarbe, wäre das ein
 * echter Kontrast nahe 1:1, und den soll die Messung finden, nicht wegblenden.
 */
const TEXT_BIN_WINDOW = 1

/**
 * Anteil, den die stärkste Fläche unter den Nicht-Text-Pixeln haben muss, damit
 * der Hintergrund als **einheitlich** gilt.
 *
 * Darunter wechselt er wirklich — Foto, Verlauf, halbtransparente Fläche — und
 * das Ergebnis wird als Näherung gekennzeichnet.
 */
const DOMINANT_SHARE = 0.5

/**
 * Mindestanteil, den eine Fläche haben muss, um als „schlechtester Hintergrund"
 * gemeldet zu werden.
 *
 * **Das ist die Lehre aus dem Fehler, den diese Datei hatte.** Vorher wurde das
 * Minimum über *alle* Pixel gebildet, und der schlechteste Pixel im Textbereich
 * ist immer ein kantengeglätteter Randpixel — eine Mischung aus Text und Grund.
 * Damit lief jedes Verhältnis gegen 1 und alle Werte stauchten sich auf 3–4:1,
 * unabhängig vom tatsächlichen Aussehen. Ein Saum von wenigen Prozent darf das
 * Ergebnis nicht bestimmen; eine dunkle Stelle in einem Foto, die ein Zehntel
 * der Fläche einnimmt, sehr wohl.
 */
const MEANINGFUL_SHARE = 0.1

/**
 * So viele Nicht-Text-Pixel müssen im Rahmen liegen, damit die Messung darauf
 * beruht. Darunter wird auf einen Ring **außerhalb** ausgewichen.
 */
const MIN_BACKGROUND_PIXELS = 24

export type BackgroundEstimate = {
  /** Die vorherrschende Hintergrundluminanz. */
  luminance: number
  /** Die Hintergrundfläche mit dem **schlechtesten** Kontrast, ab MEANINGFUL_SHARE. */
  worstLuminance: number
  /** Die mit dem besten — die Spanne zeigt, wie uneinheitlich es ist. */
  bestLuminance: number
  /** Wechselt der Hintergrund wirklich? */
  varies: boolean
  sampleCount: number
  /**
   * Wie viele Pixel die vorherrschende Fläche trägt — der Zähler von `varies`,
   * hier eigens ausgewiesen.
   *
   * `varies` teilt ihn durch die **Nicht-Text**-Pixel und beantwortet damit
   * „wechselt der Hintergrund?". Die Plausibilitätsprüfung von 1.3 teilt ihn
   * durch **alle** abgetasteten Pixel und beantwortet die andere Frage: „ist
   * überhaupt genug Hintergrund da, um von einem zu sprechen?". Beide Nenner
   * sind richtig, für verschiedene Fragen — deshalb rechnet keiner den anderen
   * mit.
   */
  dominantCount: number
}

/**
 * Findet den Hintergrund hinter einem Text — als **Fläche**, nicht als Extremum.
 *
 * Vorgehen: Luminanzen im Rechteck sammeln, den Textkern ausblenden, den Rest
 * in ein Histogramm werfen und die stärkste Fläche nehmen. Kantengeglättete
 * Randpixel verteilen sich über viele Bins und bilden nie eine Fläche; ein
 * echter Hintergrund ist ein scharfer Gipfel.
 */
export function estimateBackground(
  luminances: readonly number[],
  /**
   * Die Farbe, deren Kern ausgeblendet wird — die Textfarbe.
   *
   * `null`, wenn es keine gibt: dann wird einfach die stärkste Fläche gesucht.
   * Das braucht die Non-Text-Messung, die zwei Flächen gegeneinander stellt und
   * keine davon ausblenden darf.
   */
  textLuminance: number | null,
): BackgroundEstimate | null {
  if (luminances.length === 0) return null

  const bins: number[][] = Array.from({ length: HISTOGRAM_BINS }, () => [])
  const binOf = (value: number): number =>
    Math.min(HISTOGRAM_BINS - 1, Math.max(0, Math.floor(value * HISTOGRAM_BINS)))
  for (const value of luminances) bins[binOf(value)].push(value)

  const textBin = textLuminance === null ? null : binOf(textLuminance)
  const candidates = bins
    .map((values, index) => ({ index, values }))
    .filter((entry) => entry.values.length > 0 && (textBin === null || Math.abs(entry.index - textBin) > TEXT_BIN_WINDOW))

  const total = candidates.reduce((sum, entry) => sum + entry.values.length, 0)
  if (total === 0) return null

  const mean = (values: readonly number[]): number => values.reduce((sum, value) => sum + value, 0) / values.length

  const dominant = candidates.reduce((best, entry) => (entry.values.length > best.values.length ? entry : best))
  const share = dominant.values.length / total
  const varies = share < DOMINANT_SHARE

  // „Schlechtester Hintergrund" heißt: die dunkelste bzw. hellste Fläche, die
  // zusammen mindestens `MEANINGFUL_SHARE` der Fläche einnimmt — aufsummiert
  // über Bins, nicht ein einzelner Bin.
  //
  // Aufsummiert, weil ein echter Verlauf seine Masse über viele Bins verteilt
  // und dann **kein** einzelner die Schwelle erreicht. Die erste Fassung fiel
  // dort auf die vorherrschende Fläche zurück und meldete für ein Foto
  // denselben Wert wie für eine einfarbige Fläche.
  // Ohne Textfarbe gibt es kein „schlechtester Kontrast gegen sie" — dann wird
  // nach Luminanz sortiert, und `worst`/`best` heißen dunkelste und hellste
  // Fläche. Die Non-Text-Messung benutzt ohnehin nur `luminance`.
  const byContrast = candidates
    .map((entry) => ({ luminance: mean(entry.values), count: entry.values.length }))
    .sort((a, b) =>
      textLuminance === null
        ? a.luminance - b.luminance
        : contrastRatio(textLuminance, a.luminance) - contrastRatio(textLuminance, b.luminance),
    )

  const groupMean = (entries: typeof byContrast): number => {
    let sum = 0
    let count = 0
    for (const entry of entries) {
      sum += entry.luminance * entry.count
      count += entry.count
    }
    return count > 0 ? sum / count : 0
  }

  const takeUntilShare = (entries: typeof byContrast): typeof byContrast => {
    const out: typeof byContrast = []
    let count = 0
    for (const entry of entries) {
      out.push(entry)
      count += entry.count
      if (count >= total * MEANINGFUL_SHARE) break
    }
    return out
  }

  const dominantMean = mean(dominant.values)
  return {
    luminance: dominantMean,
    worstLuminance: varies ? groupMean(takeUntilShare(byContrast)) : dominantMean,
    bestLuminance: varies ? groupMean(takeUntilShare([...byContrast].reverse())) : dominantMean,
    varies,
    sampleCount: total,
    dominantCount: dominant.values.length,
  }
}

/**
 * Welcher Anteil dieser Pixel die **Textfarbe** zeigt.
 *
 * Dasselbe Fenster, das `estimateBackground` bei der Hintergrundsuche
 * ausblendet — und das ist der Punkt: gezählt wird genau das, was dort
 * weggeworfen wird. Wäre das Fenster hier ein anderes, könnte ein Element beide
 * Prüfungen bestehen und die Messung liefe trotzdem über Pixel, die sie für
 * Text hält.
 *
 * Eine Anwesenheitsprüfung, keine Kontrastprüfung — siehe
 * `MeasurableLimits.textCoreShare`.
 */
export function textCoreShare(luminances: readonly number[], textLuminance: number): number {
  if (luminances.length === 0) return 0
  const binOf = (value: number): number =>
    Math.min(HISTOGRAM_BINS - 1, Math.max(0, Math.floor(value * HISTOGRAM_BINS)))
  const textBin = binOf(textLuminance)
  let hits = 0
  for (const value of luminances) {
    if (Math.abs(binOf(value) - textBin) <= TEXT_BIN_WINDOW) hits++
  }
  return hits / luminances.length
}

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
  /**
   * Die **gemessene** Hintergrundluminanz — die Zahl, gegen die gerechnet wurde.
   *
   * Steht im Ergebnis, damit ein Verdacht überprüfbar wird statt Verdacht zu
   * bleiben: wer einen Wert für falsch hält, kann diese Luminanz gegen den Fill
   * in der Datei halten. Ohne sie ist „das kann nicht stimmen" nicht
   * entscheidbar — und genau dieser Fall ist einmal aufgetreten
   * (weiß auf dunkler Kachel, gemeldet 15,9:1, entspricht #222222).
   */
  backgroundLuminance: number
  /** Wie viele Hintergrundpixel die Messung tragen. */
  sampleCount: number
  /** Wurde außerhalb des Rahmens abgetastet, weil innen zu wenig Grund war? */
  sampledOutside: boolean
  /**
   * Anteil des abgetasteten Bereichs, den die tragende Hintergrundfläche
   * einnimmt — die Größe, an der `hintergrund-zu-klein` entschieden wurde.
   *
   * Steht im Ergebnis aus demselben Grund wie `backgroundLuminance`: eine
   * Schwelle, deren Messwert man nicht sieht, ist nicht überprüfbar. Wer
   * bestreitet, dass ein Element hätte verworfen werden sollen, kann hier
   * nachsehen, wie knapp es war.
   */
  backgroundShare: number
  /** Anteil des Rahmens, der die Textfarbe zeigt — die Größe von `textkern-fehlt`. */
  textCoreShare: number
  /** Anteil des Rahmens, den später gezeichnete Elemente bedecken. */
  occludedShare: number
}

export type MeasureOptions = {
  /** Gerendertes Bild des Frames, beliebige Auflösung. */
  image: Bitmap
  signals: readonly NodeSignal[]
  frameWidth: number
  frameHeight: number
  /**
   * Ab wann ein Element als nicht messbar gilt. Voreinstellung ist das, was
   * ausgeliefert wird; gesetzt wird es nur von `npm run measurable`, das die
   * Schwellen durchfährt, und von den Tests, die den Zustand ohne Prüfung als
   * Vergleichspunkt brauchen.
   */
  limits?: MeasurableLimits
}

/** Alle Luminanzen in einem Rechteck, optional ohne einen inneren Bereich. */
function luminancesIn(
  image: Bitmap,
  rect: { x: number; y: number; width: number; height: number },
  scaleX: number,
  scaleY: number,
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
      out.push(pixelLuminance(image.data[p], image.data[p + 1], image.data[p + 2]))
    }
  }
  return out
}

/**
 * Misst den Kontrast jedes Textknotens gegen seinen tatsächlichen Hintergrund.
 *
 * Übersprungen wird ein Knoten nie still: jeder Grund ist ein Code aus
 * `measurable.ts`, wird gezählt und gehört in die Darstellung — eine Messung,
 * die Elemente auslässt, sagt „alles in Ordnung", wo sie „ich weiß es nicht"
 * meint.
 *
 * Die Prüfungen laufen in drei Stufen, und die Reihenfolge ist Absicht:
 *
 *   1. **Was der Knoten nicht mitbringt** — Chrome, Textfarbe, Schriftgröße.
 *   2. **Was im Baum steht** — Drehung, Verdeckung. Ablesbar, also abgelesen und
 *      nicht geschätzt (1.3, 1a).
 *   3. **Was nur am Ergebnis zu sehen ist** — zeigt der Rahmen diesen Text, und
 *      trägt die gefundene Fläche genug von ihm (1.3, 1b).
 */
export function measureContrast(options: MeasureOptions): { results: ContrastResult[]; skipped: Skipped[] } {
  const { image, signals, frameWidth, frameHeight } = options
  const limits = options.limits ?? MEASURABLE_LIMITS
  const scaleX = image.width / frameWidth
  const scaleY = image.height / frameHeight

  const results: ContrastResult[] = []
  const skipped: Skipped[] = []
  const byId = new Map(signals.map((signal) => [signal.id, signal]))

  for (const signal of signals) {
    if (!signal.isText) continue
    // Statusleiste und Home-Indicator gehören dem Betriebssystem; ein Befund
    // darüber ist für niemanden behebbar. Gezählt statt still ausgelassen.
    if (isSystemChrome(signal, byId)) {
      skipped.push({ nodeId: signal.id, reason: 'chrome' })
      continue
    }
    if (signal.fillLuminance === undefined) {
      skipped.push({ nodeId: signal.id, reason: 'keine-textfarbe' })
      continue
    }
    const fontSize = signal.fontSize ?? 0
    if (fontSize <= 0) {
      skipped.push({ nodeId: signal.id, reason: 'keine-schriftgroesse' })
      continue
    }

    // 1.3, 1a — die beiden Fälle, die im Baum **stehen**. Sie werden vor jeder
    // Pixelarbeit entschieden: eine Plausibilitätsheuristik über eine Tatsache
    // laufen zu lassen, die man ablesen kann, ist der Fehler, den 1.3 hier
    // ausdrücklich nicht macht (siehe `measurable.ts`).
    if (rotationOf(signal, byId) > limits.rotationDegrees) {
      skipped.push({ nodeId: signal.id, reason: 'gedreht' })
      continue
    }
    const occluded = occludedShare(signal, signals)
    if (occluded > limits.occludedShare) {
      skipped.push({ nodeId: signal.id, reason: 'verdeckt' })
      continue
    }

    const rect = { x: signal.x, y: signal.y, width: signal.width, height: signal.height }
    const textLuminance = signal.fillLuminance

    const inside = luminancesIn(image, rect, scaleX, scaleY)
    let background = estimateBackground(inside, textLuminance)
    // Der Nenner der Plausibilitätsprüfung ist der Bereich, aus dem der
    // Hintergrund **tatsächlich** kommt — bei einem Text, der seinen Rahmen
    // ausfüllt, ist das der Ring außen und nicht der Rahmen.
    let region = inside.length
    let sampledOutside = false

    if (!background || background.sampleCount < MIN_BACKGROUND_PIXELS) {
      // Der Text füllt seinen Rahmen praktisch aus — dann liegt der einzige
      // Hintergrund außerhalb. Eine halbe Zeilenhöhe breiter Ring, nah genug,
      // dass es noch derselbe Grund ist.
      const pad = Math.max(2, fontSize * 0.5)
      const outer = { x: rect.x - pad, y: rect.y - pad, width: rect.width + pad * 2, height: rect.height + pad * 2 }
      const ring = luminancesIn(image, outer, scaleX, scaleY, rect)
      background = estimateBackground(ring, textLuminance)
      region = ring.length
      sampledOutside = true
    }

    if (!background) {
      skipped.push({ nodeId: signal.id, reason: 'kein-hintergrund' })
      continue
    }

    // 1.3, 1b — das Netz für alles, was im Baum **nicht** steht: Masken,
    // Clipping, Effekte, Subpixelkanten. Geprüft wird nicht die Ursache,
    // sondern ob das Ergebnis wie der Hintergrund dieses Elements aussieht.
    //
    // Reihenfolge: erst „zeigt der Rahmen diesen Text überhaupt", dann „trägt
    // die Fläche genug". Die erste Frage ist die schärfere Auskunft — wo die
    // Textfarbe fehlt, sagt „kein tragender Hintergrund" das Falsche.
    const core = textCoreShare(inside, textLuminance)
    if (inside.length > 0 && core < limits.textCoreShare) {
      skipped.push({ nodeId: signal.id, reason: 'textkern-fehlt' })
      continue
    }
    // `backgroundShare` wird berechnet und ausgewiesen, verwirft aber nichts:
    // die Messung hat gezeigt, dass es keine Schwelle gibt, die den Fall ohne
    // Fläche trifft und den Verlauf verschont (siehe
    // `MeasurableLimits.backgroundShare`). `null` heißt „gemessen, nicht
    // ausgeliefert" — der Wert steht im Ergebnis, damit die Entscheidung ohne
    // neue Messung wieder aufzumachen ist.
    const backgroundShare = region > 0 ? background.dominantCount / region : 0
    if (limits.backgroundShare !== null && backgroundShare < limits.backgroundShare) {
      skipped.push({ nodeId: signal.id, reason: 'hintergrund-zu-klein' })
      continue
    }

    const worst = contrastRatio(textLuminance, background.worstLuminance)
    const best = contrastRatio(textLuminance, background.bestLuminance)

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
      backgroundLuminance: background.worstLuminance,
      // Nur wenn der Hintergrund **wirklich** wechselt. Vorher stand hier eine
      // Spanne über alle Pixel, und die war durch die Kantenglättung immer
      // groß — jede Messung trug das „~", und damit sagte es nichts.
      approximate: background.varies,
      sampleCount: background.sampleCount,
      sampledOutside,
      backgroundShare,
      textCoreShare: core,
      occludedShare: occluded,
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

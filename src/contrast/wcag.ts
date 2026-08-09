/**
 * 1.2 C2 — WCAG 2.1, Erfolgskriterium 1.4.3 (Kontrast, Minimum).
 *
 * **Diese Zahlen sind Norm, nicht Kalibrierung.** Sie werden zitiert, nicht
 * gemessen, und sie veralten nicht mit unserer Engine. Das unterscheidet die
 * Contrastmap grundsätzlich von Heatmap und Focusmap: dort sagt jede Konstante
 * eine Vorhersage voraus und muss an Daten hängen, hier steht sie in einem
 * Standard.
 *
 * Quelle: W3C, Web Content Accessibility Guidelines (WCAG) 2.1,
 * Success Criterion 1.4.3 Contrast (Minimum), Level AA.
 * https://www.w3.org/TR/WCAG21/#contrast-minimum
 *
 * Was daraus übernommen ist, wörtlich und ohne Auslegung:
 *
 *   - normaler Text                       mindestens 4,5:1
 *   - großer Text                         mindestens 3:1
 *   - „groß" heißt ab 18 pt / 24 px, oder ab 14 pt / 18,66 px bei fett
 *
 * Was **nicht** übernommen ist, weil es ohne Auslegung nicht geht: die
 * Ausnahmen des Kriteriums für rein dekorativen Text, für Logotypen und für
 * inaktive Bedienelemente. Ein Layer-Baum sagt nicht, ob ein Text dekorativ
 * ist. Die Contrastmap misst deshalb **alle** Textknoten und überlässt die
 * Ausnahme dem Menschen — ein falsch gemeldeter Logotyp ist ein Ärgernis, ein
 * verschwiegener Fließtext ein Fehler.
 */

/** Ab dieser Schriftgröße (px) gilt Text als „groß" — 18 pt. */
export const LARGE_TEXT_PX = 24

/** Ab dieser Schriftgröße (px) gilt **fetter** Text als „groß" — 14 pt. */
export const LARGE_BOLD_TEXT_PX = 18.66

/** Ab diesem Schriftschnitt gilt Text als fett, nach der CSS-Definition. */
export const BOLD_WEIGHT = 700

export const CONTRAST_NORMAL = 4.5
export const CONTRAST_LARGE = 3

/**
 * Grenzwert, ab dem ein Ergebnis als „grenzwertig" statt „bestanden" gilt.
 *
 * **Keine Norm** — WCAG kennt nur bestanden und durchgefallen. Diese Stufe
 * existiert, weil ein Wert von 4,52:1 dieselbe Aussage trägt wie 4,48:1 und die
 * Grenze sonst eine Schärfe vortäuscht, die die Messung nicht hat: der
 * Hintergrund wird aus gerenderten Pixeln abgetastet, und ein Antialiasing-Saum
 * verschiebt den Wert in der zweiten Nachkommastelle. Der Zuschlag ist
 * ausdrücklich als *unser* Zusatz gekennzeichnet, damit ihn niemand für die
 * Norm hält.
 */
export const BORDERLINE_MARGIN = 1.1

export type ContrastStatus = 'bestanden' | 'grenzwertig' | 'durchgefallen'

/**
 * Kontrastverhältnis zweier relativer Luminanzen nach WCAG.
 *
 * `(heller + 0,05) / (dunkler + 0,05)`, Ergebnis zwischen 1 und 21. Die
 * relative Luminanz selbst kommt aus `figma/traverse.ts` → `relativeLuminance`
 * (sRGB-Linearisierung, Rec.-709-Gewichte) — dieselbe Funktion für beide
 * Seiten, sonst vergleicht man zwei verschiedene Größen.
 */
export function contrastRatio(a: number, b: number): number {
  const lighter = Math.max(a, b)
  const darker = Math.min(a, b)
  return (lighter + 0.05) / (darker + 0.05)
}

/** Gilt dieser Text nach WCAG als „groß"? */
export function isLargeText(fontSize: number, fontWeight = 400): boolean {
  return fontWeight >= BOLD_WEIGHT ? fontSize >= LARGE_BOLD_TEXT_PX : fontSize >= LARGE_TEXT_PX
}

/** Der geforderte Mindestkontrast für diesen Text. */
export function requiredRatio(fontSize: number, fontWeight = 400): number {
  return isLargeText(fontSize, fontWeight) ? CONTRAST_LARGE : CONTRAST_NORMAL
}

/**
 * Einstufung eines gemessenen Verhältnisses gegen die Anforderung.
 *
 * „grenzwertig" liegt **oberhalb** der Norm — ein Text, der sie knapp erfüllt,
 * ist bestanden im Sinne von WCAG und wird hier trotzdem markiert. Umgekehrt
 * wäre es eine stillschweigende Aufweichung des Standards.
 */
export function statusOf(ratio: number, required: number): ContrastStatus {
  if (ratio < required) return 'durchgefallen'
  return ratio < required * BORDERLINE_MARGIN ? 'grenzwertig' : 'bestanden'
}

/**
 * Kontrastverhältnis auf eine Nachkommastelle, wie es in einem Befund steht.
 *
 * Eine Stelle, weil die Messung nicht mehr hergibt (siehe `BORDERLINE_MARGIN`)
 * — und weil C-2 für Befundtexte ohnehin höchstens eine Dezimalstelle erlaubt.
 *
 * **Abgerundet, nicht kaufmännisch gerundet, und das ist kein Detail.**
 *
 * Gerundet stand in der ersten Fassung „4,50:1" neben „WCAG AA verlangt 4,5:1"
 * und darunter das Urteil „durchgefallen". Der Rohwert war 4,499204, das Urteil
 * also richtig — aber die angezeigte Zahl widersprach ihm. Bei einer Ausgabe,
 * die als überprüfbare Tatsache auftritt, ist das schlimmer als ein falscher
 * Wert: es sieht aus wie ein Fehler in der Regel, und wer nachrechnet, findet
 * keinen.
 *
 * Abrunden löst das **beweisbar**, nicht nur meistens. Die angezeigte Zahl ist
 * damit immer eine untere Schranke des gemessenen Werts, und weil beide
 * Schwellen (4,5 und 3,0) bei einer Nachkommastelle exakt darstellbar sind,
 * gilt:
 *
 *   Verhältnis <  Schwelle  ⇒  Anzeige ≤ Verhältnis <  Schwelle
 *   Verhältnis ≥  Schwelle  ⇒  Anzeige ≥ Schwelle
 *
 * Die Anzeige kann dem Urteil also nicht widersprechen. `wcag.test.ts` prüft
 * das über den ganzen Wertebereich, nicht an Beispielen.
 *
 * Abrunden ist zusätzlich die sichere Richtung: wir behaupten nie mehr Kontrast,
 * als gemessen wurde.
 */
export function formatRatio(ratio: number): string {
  return `${(Math.floor(ratio * 10) / 10).toFixed(1).replace('.', ',')}:1`
}

/**
 * Die angezeigte Zahl als Zahl — für Tests und für alles, was prüfen muss, ob
 * Anzeige und Urteil zueinander passen.
 */
export function displayedRatio(ratio: number): number {
  return Math.floor(ratio * 10) / 10
}

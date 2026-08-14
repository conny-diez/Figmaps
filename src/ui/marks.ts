/**
 * Die Geometrie der Figmaps-Mark — dieselben sechzehn Kreise, die in
 * `logos/figmaps-mark-dark.svg` und `logos/figmaps-mark-light.svg` stehen.
 *
 * **Warum die Daten hier liegen und nicht die SVG-Datei geladen wird.** Der
 * iframe darf nichts nachladen (`networkAccess: none`), und ein zweites Asset im
 * Bundle wäre eine zweite Wahrheit. Die Mark wird deshalb inline gezeichnet
 * (`ui/logo.tsx`).
 *
 * **Und warum das trotzdem nicht abgewandelt ist.** Jeder Kreis nennt hier den
 * Palettentoken seiner Stufe statt einer Farbe, und `__tests__/marks.test.ts`
 * liest die beiden gelieferten SVG-Dateien und prüft Kreis für Kreis, dass
 * Reihenfolge, `cx`, `cy`, `r` und die aufgelöste Farbe genau übereinstimmen.
 * Weicht das Panel je von der Datei ab — in der einen oder der anderen Richtung
 * —, fällt der Test. Das ist der Unterschied zwischen „sieht gleich aus" und
 * „ist gleich".
 *
 * Die Stufen sind die Daten-Rampe aus `DESIGN.md` §1: Punktgröße ist Intensität,
 * der Fokus sitzt oben links, volles Gelb nur im heißesten Punkt.
 */
import type { Palette } from './theme'

/** Ein Punkt der Mark. `tone` ist der Token, der ihn färbt. */
export type MarkDot = {
  cx: number
  cy: number
  r: number
  tone: Extract<keyof Palette, 'cta' | 'tone-600' | 'tone-700' | 'tone-cold'>
}

/**
 * Die sechzehn Punkte in der Reihenfolge der Dateien: zeilenweise von oben
 * links. Radien und Farbstufen folgen den Formeln aus §5
 * (`r = max(1.6, 5.4 − d · 1.35)`, Farbe nach `d`); sie stehen hier als Werte,
 * weil die gelieferten Dateien Werte sind und der Test gegen sie vergleicht.
 */
export const MARK_DOTS: readonly MarkDot[] = [
  { cx: 12, cy: 12, r: 3.59, tone: 'tone-600' },
  { cx: 25.5, cy: 12, r: 4.55, tone: 'cta' },
  { cx: 39, cy: 12, r: 4.05, tone: 'tone-600' },
  { cx: 52.5, cy: 12, r: 2.84, tone: 'tone-600' },
  { cx: 12, cy: 25.5, r: 3.69, tone: 'tone-600' },
  { cx: 25.5, cy: 25.5, r: 4.8, tone: 'cta' },
  { cx: 39, cy: 25.5, r: 4.19, tone: 'cta' },
  { cx: 52.5, cy: 25.5, r: 2.91, tone: 'tone-600' },
  { cx: 12, cy: 39, r: 2.91, tone: 'tone-600' },
  { cx: 25.5, cy: 39, r: 3.49, tone: 'tone-600' },
  { cx: 39, cy: 39, r: 3.22, tone: 'tone-600' },
  { cx: 52.5, cy: 39, r: 2.32, tone: 'tone-700' },
  { cx: 12, cy: 52.5, r: 1.78, tone: 'tone-700' },
  { cx: 25.5, cy: 52.5, r: 2.15, tone: 'tone-700' },
  { cx: 39, cy: 52.5, r: 1.98, tone: 'tone-700' },
  { cx: 52.5, cy: 52.5, r: 1.6, tone: 'tone-cold' },
]

/** `viewBox` der gelieferten Dateien. */
export const MARK_VIEWBOX = '0 0 64 64'

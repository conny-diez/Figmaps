/**
 * Figmaps-Mark — Inline-SVG, damit das Panel kein Netz und kein zweites Asset im
 * Bundle braucht. Quelle der Wahrheit sind die Dateien in `logos/`
 * (`figmaps-mark-dark|light|mono.svg`, `figmaps-icon-16.svg`); die Geometrie hier
 * ist dieselbe Formel, aus der sie entstanden sind (`DESIGN.md` §5).
 *
 * **Das Heat-Raster, nicht der Rahmen.** Die Mark ist ein 4 × 4-Punktgitter:
 * Punktgröße ist Intensität, der Fokus sitzt oben links, die Farbe folgt der
 * Daten-Rampe. Sie zeigt damit, was das Plugin tut, statt ein Bilderrahmen zu
 * sein.
 *
 * **Farben aus den Tokens, nicht aus der Datei.** Die SVGs in `logos/` tragen
 * feste Werte je Theme; hier stehen `var(--cta)` und die Rampe, sodass der
 * Theme-Wechsel die Mark mitzieht, ohne dass ein zweites Asset geladen wird. Das
 * Logo ist neben dem CTA die einzige Stelle mit Gelb — `DESIGN.md` §1 erlaubt
 * „ein Akzentelement im Logo" ausdrücklich.
 */

/** Schrittweite und Startpunkt des Rasters, `DESIGN.md` §5. */
const STEP = 13.5
const ORIGIN = 12

/**
 * Ab welcher Kantenlänge das volle Raster gezeichnet wird. Darunter greift die
 * vereinfachte Variante aus §5 — sechzehn Punkte auf 24 px wären Grieß.
 */
const SMALL_MAX = 24

type Dot = { cx: number; cy: number; r: number; fill: string }

/** Farbe nach Abstand vom Fokus — die vier Stufen der Rampe. */
function toneFor(distance: number): string {
  if (distance < 0.9) return 'var(--cta)'
  if (distance < 1.9) return 'var(--tone-600)'
  if (distance < 2.8) return 'var(--tone-700)'
  return 'var(--tone-cold)'
}

/** Das 4 × 4-Raster: `r = max(1.6, 5.4 − d · 1.35)`, `d = hypot(row−0.6, col−1.2)`. */
function grid(): Dot[] {
  const dots: Dot[] = []
  for (let row = 0; row < 4; row++) {
    for (let col = 0; col < 4; col++) {
      const distance = Math.hypot(row - 0.6, col - 1.2)
      dots.push({
        cx: ORIGIN + col * STEP,
        cy: ORIGIN + row * STEP,
        r: Math.max(1.6, 5.4 - distance * 1.35),
        fill: toneFor(distance),
      })
    }
  }
  return dots
}

/** Kleingröße, §5: vier Kreise, derselbe Verlauf, `viewBox="2 2 52 52"`. */
const SMALL: Dot[] = [
  { cx: 18, cy: 18, r: 12, fill: 'var(--cta)' },
  { cx: 42, cy: 22, r: 7, fill: 'var(--tone-600)' },
  { cx: 20, cy: 42, r: 6, fill: 'var(--tone-700)' },
  { cx: 44, cy: 46, r: 3.5, fill: 'var(--tone-cold)' },
]

export function Logo({ size = 16 }: { size?: number }): preact.JSX.Element {
  const small = size <= SMALL_MAX
  const dots = small ? SMALL : grid()

  return (
    <svg
      class="app__logo"
      width={size}
      height={size}
      viewBox={small ? '2 2 52 52' : '0 0 64 64'}
      role="img"
      aria-label="Figmaps"
    >
      {dots.map((dot) => (
        <circle key={`${dot.cx}-${dot.cy}`} cx={dot.cx} cy={dot.cy} r={dot.r} fill={dot.fill} />
      ))}
    </svg>
  )
}

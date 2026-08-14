/**
 * Figmaps-Mark — Inline-SVG, damit das Panel kein Netz und kein zweites Asset im
 * Bundle braucht. Gezeichnet wird **die gelieferte Datei**, nicht eine Fassung
 * davon: dieselben sechzehn Kreise, dieselbe Reihenfolge, dieselben Farben, je
 * Theme `logos/figmaps-mark-dark.svg` bzw. `figmaps-mark-light.svg`. Die Daten
 * liegen in `ui/marks.ts`, und `ui/__tests__/marks.test.ts` vergleicht sie Kreis
 * für Kreis mit den Dateien.
 *
 * **Das Heat-Raster, nicht der Rahmen.** Punktgröße ist Intensität, der Fokus
 * sitzt oben links, die Farbe folgt der Daten-Rampe. Die Mark zeigt damit, was
 * das Plugin tut, statt ein Bilderrahmen zu sein.
 *
 * **Warum auch im 24-px-Tile das vollständige Raster steht.** `DESIGN.md` §5
 * sieht für ≤ 24 px eine vereinfachte Variante aus vier Kreisen vor
 * (`logos/figmaps-icon-16.svg` liegt als Asset dafür bereit). Im Panel-Header
 * steht trotzdem das volle Raster — ausdrücklich so gewünscht, weil dort die
 * Marke selbst erkennbar sein soll und nicht ihre Kurzform.
 *
 * Die Farben kommen als Tokens (`var(--cta)`, `var(--tone-…)`), deren Werte in
 * `ui/theme.ts` genau die der Dateien sind. Dadurch zieht der Theme-Wechsel die
 * Mark mit, ohne dass ein zweites Asset geladen wird.
 */
import { MARK_DOTS, MARK_VIEWBOX } from './marks'

export function Logo({ size = 18 }: { size?: number }): preact.JSX.Element {
  return (
    <svg class="app__logo" width={size} height={size} viewBox={MARK_VIEWBOX} role="img" aria-label="Figmaps">
      {MARK_DOTS.map((dot) => (
        <circle key={`${dot.cx}-${dot.cy}`} cx={dot.cx} cy={dot.cy} r={dot.r} fill={`var(--${dot.tone})`} />
      ))}
    </svg>
  )
}

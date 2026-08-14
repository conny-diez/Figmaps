/**
 * Die Zusagen der beiden Paletten — Kontrast, und die Regeln aus `DESIGN.md` §6.
 *
 * Dieser Test existiert, weil der Fehler, den er verhindert, schon zweimal
 * passiert ist: die Fußzeile war mit 3,93:1 und 2,41:1 ausgeliefert, wurde
 * behoben, und die nächste Design-Übergabe brachte dieselben Werte zurück. Eine
 * Palette, die nur angesehen wird, driftet.
 *
 * Seit dem Design-System kommt eine zweite Klasse von Zusagen dazu, und die ist
 * nicht über Farbwerte prüfbar, sondern nur über die CSS-Datei: **Gelb ist
 * ausschließlich die primäre Aktion.** Ein Token kann korrekt sein und trotzdem
 * an der falschen Stelle stehen — deshalb liest der letzte Block hier
 * `styles.css`.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  CONTRAST_PAIRS,
  contrastRatio,
  MIN_CONTRAST,
  MIN_CONTRAST_NON_TEXT,
  NON_TEXT_PAIRS,
  THEMES,
  type Palette,
  type ThemeName,
} from '../theme'

const THEME_NAMES: ThemeName[] = ['dark', 'light']

const CSS = readFileSync('src/ui/styles.css', 'utf8')

/**
 * Kommentare weg, bevor die CSS-Datei nach Farben abgesucht wird — die
 * Kommentare dieser Datei nennen die Werte aus `DESIGN.md` beim Namen, und eine
 * Prüfung, die Aussagen ÜBER einen Wert für den Wert hält, ist genau die Sorte
 * Fehler, die dieses Repo an anderer Stelle schon einmal teuer bezahlt hat
 * (siehe `withoutComments` in `scripts/build.mjs`).
 */
function withoutComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '')
}

const STRIPPED = withoutComments(CSS)
const ROOT_START = STRIPPED.indexOf(':root {')
const ROOT_END = STRIPPED.indexOf('}', ROOT_START)

describe('theme contrast', () => {
  for (const name of THEME_NAMES) {
    describe(name, () => {
      for (const pair of CONTRAST_PAIRS) {
        it(`${pair.fg} auf ${pair.bg} (${pair.where}) hält ${MIN_CONTRAST}:1`, () => {
          const palette = THEMES[name]
          const ratio = contrastRatio(palette[pair.fg], palette[pair.bg])
          expect(
            Number(ratio.toFixed(2)),
            `${name}: ${pair.fg} ${palette[pair.fg]} auf ${pair.bg} ${palette[pair.bg]} = ${ratio.toFixed(2)}:1`,
          ).toBeGreaterThanOrEqual(MIN_CONTRAST)
        })
      }

      for (const pair of NON_TEXT_PAIRS) {
        it(`${pair.fg} auf ${pair.bg} (${pair.where}) hält ${MIN_CONTRAST_NON_TEXT}:1`, () => {
          const palette = THEMES[name]
          const ratio = contrastRatio(palette[pair.fg], palette[pair.bg])
          expect(
            Number(ratio.toFixed(2)),
            `${name}: ${pair.fg} ${palette[pair.fg]} auf ${pair.bg} ${palette[pair.bg]} = ${ratio.toFixed(2)}:1`,
          ).toBeGreaterThanOrEqual(MIN_CONTRAST_NON_TEXT)
        })
      }
    })
  }

  it('nimmt das Gelb nie als Schriftfarbe', () => {
    // #FFD60A auf Weiß sind 1,63:1. Das Gelb ist Flächenfarbe der primären
    // Aktion — es gibt deshalb gar keinen „accent-text"-Token mehr, den man
    // versehentlich für Schrift nehmen könnte.
    expect(contrastRatio(THEMES.light.cta, THEMES.light['panel-bg'])).toBeLessThan(MIN_CONTRAST)
    expect(CONTRAST_PAIRS.some((pair) => pair.fg === 'cta')).toBe(false)
    for (const name of THEME_NAMES) {
      const palette = THEMES[name]
      for (const token of ['text-hi', 'text-mid', 'text-low', 'text-disabled'] as const) {
        expect(palette[token]).not.toBe(palette.cta)
      }
    }
  })

  it('löst Auswahl über Helligkeit, nicht über Farbe', () => {
    // DESIGN.md §6.2 und §6.7: aktives Segment und eingeschalteter Toggle sind
    // Fläche bzw. Tinte. Wäre einer von beiden das Gelb, gäbe es zwei „primäre"
    // Elemente im Panel.
    for (const name of THEME_NAMES) {
      const palette = THEMES[name]
      expect(palette['bg-selected']).not.toBe(palette.cta)
      expect(palette['toggle-on']).not.toBe(palette.cta)
      expect(palette['bar-fill']).not.toBe(palette.cta)
    }
  })

  it('hält zwei Textstufen, nicht drei, und beide sind lesbar', () => {
    // Drei Abstufungen können nicht alle über der Grenze liegen und dabei
    // unterscheidbar bleiben; die dritte Stufe wäre nur eine Gelegenheit, die
    // unlesbare zu wählen. `text-low` ist deshalb keine Schriftfarbe (siehe
    // `theme.ts`) — dieser Test hält fest, dass sie es auch nicht wird.
    for (const name of THEME_NAMES) {
      const palette = THEMES[name]
      expect(contrastRatio(palette['text-hi'], palette['panel-bg'])).toBeGreaterThanOrEqual(MIN_CONTRAST)
      expect(contrastRatio(palette['text-mid'], palette['panel-bg'])).toBeGreaterThanOrEqual(MIN_CONTRAST)
      expect(contrastRatio(palette['text-hi'], palette['text-mid'])).toBeGreaterThan(1.1)
    }
  })

  it('behält das Gelb über beide Themes unverändert', () => {
    expect(THEMES.light.cta).toBe(THEMES.dark.cta)
    expect(THEMES.light['cta-on']).toBe(THEMES.dark['cta-on'])
  })

  it('definiert in beiden Themes genau dieselben Tokens', () => {
    expect(Object.keys(THEMES.dark).sort()).toEqual(Object.keys(THEMES.light).sort())
  })
})

/**
 * Die Fallback-Werte in `:root` sind das Dark-Theme — sie malen den einen Frame,
 * bevor `ui.tsx` die Palette aufträgt. Eine zweite Kopie einer Palette ist eine
 * Einladung zur Drift, also wird sie verglichen statt geglaubt.
 */
describe('styles.css', () => {
  const rootBlock = STRIPPED.slice(ROOT_START, ROOT_END)

  it('trägt als Fallback exakt das Dark-Theme', () => {
    const declared = new Map<string, string>()
    for (const line of rootBlock.split('\n')) {
      const match = /^\s*--([a-z0-9-]+):\s*(.+);\s*$/.exec(line)
      if (match) declared.set(match[1], match[2].trim())
    }
    for (const [token, value] of Object.entries(THEMES.dark) as [keyof Palette, string][]) {
      expect(declared.get(token), `--${token} fehlt in :root oder weicht ab`).toBe(value)
    }
  })

  it('setzt das Gelb genau an der primären Aktion ein', () => {
    // Regel 1 aus DESIGN.md: „Gelb erscheint nur auf der primären Aktion — ein
    // gelber Button pro Panel, sonst nirgends." Als Farbwert ist das nicht
    // prüfbar, nur als Ort: welche Regeln `var(--cta)` überhaupt lesen.
    //
    // Die zweite erlaubte Stelle ist die Ausnahme, die §1 selbst nennt: in der
    // Visualisierung erscheint volles Gelb im heißesten Punkt. Das ist die
    // Vorschau der Heatmap — und dort ist es kein Akzent, sondern der Wert.
    const allowed = new Set(['.preview__layer--heat', '.button--primary'])
    const users: string[] = []
    for (const chunk of STRIPPED.split('}')) {
      if (!chunk.includes('var(--cta)')) continue
      users.push(chunk.slice(0, chunk.indexOf('{')).trim())
    }
    expect(users.length, 'niemand nutzt var(--cta) — der CTA hätte keine Farbe').toBeGreaterThan(0)
    for (const selector of users) {
      expect(allowed.has(selector), `var(--cta) steht in „${selector}" statt nur an der primären Aktion`).toBe(true)
    }
  })

  it('nennt keine Farbe im Klartext, außer im Fallback', () => {
    // Jede Farbe kommt aus der Palette. Ein Literal in einer Regel wäre der
    // Wert, den kein Theme-Wechsel mitnimmt und kein Kontrasttest sieht.
    const body = STRIPPED.slice(ROOT_END)
    const literals = body.match(/#[0-9a-fA-F]{3,8}\b|\brgba?\(/g) ?? []
    expect(literals, `Farbliterale außerhalb von :root: ${[...new Set(literals)].join(', ')}`).toEqual([])
  })
})

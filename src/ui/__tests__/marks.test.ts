/**
 * Die Mark im Panel ist die gelieferte Datei — nachgeprüft, nicht behauptet.
 *
 * Das Panel zeichnet die Mark inline (`ui/logo.tsx`), weil der iframe nichts
 * nachladen darf. Damit gibt es zwei Orte, an denen dieselbe Zeichnung steht:
 * `logos/figmaps-mark-*.svg` und `ui/marks.ts` plus die Palette. Zwei Orte
 * driften, sobald einer angefasst wird — also vergleicht dieser Test sie Kreis
 * für Kreis: Reihenfolge, `cx`, `cy`, `r` und die **aufgelöste** Farbe.
 *
 * `figmaps-mark-mono.svg` steht mit in der Prüfung, weil es dieselbe Geometrie
 * trägt; seine Farbe ist `currentColor` und damit nichts, was hier zu vergleichen
 * wäre.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { MARK_DOTS, MARK_VIEWBOX } from '../marks'
import { THEMES, type ThemeName } from '../theme'

type Circle = { cx: number; cy: number; r: number; fill: string }

/** Liest die Kreise einer Mark-Datei in Dokumentreihenfolge. */
function circlesOf(file: string): Circle[] {
  const svg = readFileSync(`logos/${file}`, 'utf8')
  return [...svg.matchAll(/<circle\s+([^>]*?)\/?>/g)].map((match) => {
    const attributes = new Map(
      [...match[1].matchAll(/([a-z-]+)="([^"]*)"/g)].map((pair) => [pair[1], pair[2]] as const),
    )
    return {
      cx: Number(attributes.get('cx')),
      cy: Number(attributes.get('cy')),
      r: Number(attributes.get('r')),
      fill: attributes.get('fill') ?? '',
    }
  })
}

/** `rgba(26,26,30,0.22)` in der Datei, `rgba(26, 26, 30, 0.22)` in der Palette. */
function normalise(colour: string): string {
  return colour.replace(/\s+/g, '').toUpperCase()
}

const FILES: Record<ThemeName, string> = {
  dark: 'figmaps-mark-dark.svg',
  light: 'figmaps-mark-light.svg',
}

describe('Figmaps-Mark', () => {
  for (const [theme, file] of Object.entries(FILES) as [ThemeName, string][]) {
    describe(file, () => {
      const circles = circlesOf(file)

      it('hat sechzehn Kreise, wie das 4 × 4-Raster aus DESIGN.md §5', () => {
        expect(circles).toHaveLength(16)
        expect(MARK_DOTS).toHaveLength(16)
      })

      it('stimmt Kreis für Kreis mit dem überein, was das Panel zeichnet', () => {
        const palette = THEMES[theme]
        expect(circles.map((circle) => [circle.cx, circle.cy, circle.r])).toEqual(
          MARK_DOTS.map((dot) => [dot.cx, dot.cy, dot.r]),
        )
        expect(circles.map((circle) => normalise(circle.fill))).toEqual(
          MARK_DOTS.map((dot) => normalise(palette[dot.tone])),
        )
      })
    })
  }

  it('zeichnet in dem viewBox, den die Dateien tragen', () => {
    for (const file of [...Object.values(FILES), 'figmaps-mark-mono.svg']) {
      const svg = readFileSync(`logos/${file}`, 'utf8')
      expect(svg, file).toContain(`viewBox="${MARK_VIEWBOX}"`)
    }
  })

  it('teilt die Geometrie mit der Mono-Fassung', () => {
    const mono = circlesOf('figmaps-mark-mono.svg')
    expect(mono.map((circle) => [circle.cx, circle.cy, circle.r])).toEqual(
      MARK_DOTS.map((dot) => [dot.cx, dot.cy, dot.r]),
    )
    // Einfarbig heißt einfarbig: keine Stufe, die als Deckkraft zurückkommt.
    expect(new Set(mono.map((circle) => circle.fill))).toEqual(new Set(['currentColor']))
    expect(readFileSync('logos/figmaps-mark-mono.svg', 'utf8')).not.toContain('opacity')
  })
})

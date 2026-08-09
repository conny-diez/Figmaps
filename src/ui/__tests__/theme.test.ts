/**
 * The contrast contract of both palettes.
 *
 * This test exists because the failure it guards against already happened
 * twice: the footer shipped with 3,93:1 and 2,41:1 text, was fixed, and the
 * next design hand-off brought the same values back. A palette that is only
 * looked at is a palette that drifts.
 */
import { describe, expect, it } from 'vitest'
import { CONTRAST_PAIRS, contrastRatio, MIN_CONTRAST, THEMES, type ThemeName } from '../theme'

const THEME_NAMES: ThemeName[] = ['dark', 'light']

describe('theme contrast', () => {
  for (const name of THEME_NAMES) {
    describe(name, () => {
      for (const pair of CONTRAST_PAIRS) {
        it(`${pair.fg} on ${pair.bg} (${pair.where}) clears ${MIN_CONTRAST}:1`, () => {
          const palette = THEMES[name]
          const ratio = contrastRatio(palette[pair.fg], palette[pair.bg])
          expect(
            Number(ratio.toFixed(2)),
            `${name}: ${pair.fg} ${palette[pair.fg]} auf ${pair.bg} ${palette[pair.bg]} = ${ratio.toFixed(2)}:1`,
          ).toBeGreaterThanOrEqual(MIN_CONTRAST)
        })
      }
    })
  }

  it('never puts the accent yellow on a light surface as text', () => {
    // #F5C518 on white is 1,63:1. In the light theme the yellow is a surface
    // colour only; `accent-text` is what text uses.
    expect(contrastRatio(THEMES.light.accent, THEMES.light.bg)).toBeLessThan(MIN_CONTRAST)
    expect(THEMES.light['accent-text']).not.toBe(THEMES.light.accent)
    expect(contrastRatio(THEMES.light['accent-text'], THEMES.light.bg)).toBeGreaterThanOrEqual(MIN_CONTRAST)
  })

  it('keeps two muted levels, not three, and both are readable', () => {
    // Three graded levels cannot all clear the floor and still be distinct —
    // the third step only offers a way to pick the unreadable one.
    for (const name of THEME_NAMES) {
      const palette = THEMES[name]
      expect(contrastRatio(palette['text-dim'], palette.bg)).toBeGreaterThanOrEqual(MIN_CONTRAST)
      expect(contrastRatio(palette['text-quiet'], palette.bg)).toBeGreaterThanOrEqual(MIN_CONTRAST)
      // Distinct enough to be worth two tokens.
      expect(contrastRatio(palette['text-dim'], palette['text-quiet'])).toBeGreaterThan(1.1)
    }
  })

  it('both themes define exactly the same tokens', () => {
    expect(Object.keys(THEMES.dark).sort()).toEqual(Object.keys(THEMES.light).sort())
  })
})

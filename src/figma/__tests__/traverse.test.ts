/**
 * Only the pure helpers of the traversal are covered here — the scene-graph
 * walk itself needs a real Figma document and is verified manually per
 * milestone (PRD §8).
 */
import { describe, expect, it } from 'vitest'
import { extractNameHints, fontWeightFromStyle, relativeLuminance } from '../traverse'

describe('fontWeightFromStyle', () => {
  it('maps the common Figma style names', () => {
    expect(fontWeightFromStyle('Regular')).toBe(400)
    expect(fontWeightFromStyle('Medium')).toBe(500)
    expect(fontWeightFromStyle('Bold')).toBe(700)
    expect(fontWeightFromStyle('Black')).toBe(900)
    expect(fontWeightFromStyle('Thin')).toBe(100)
  })

  it('resolves "Semi Bold" before "Bold"', () => {
    expect(fontWeightFromStyle('Semi Bold')).toBe(600)
    expect(fontWeightFromStyle('SemiBold')).toBe(600)
    expect(fontWeightFromStyle('Extra Bold')).toBe(800)
  })

  it('ignores casing and italics, and falls back to 400', () => {
    expect(fontWeightFromStyle('bold italic')).toBe(700)
    expect(fontWeightFromStyle('Condensed')).toBe(400)
    expect(fontWeightFromStyle(undefined)).toBe(400)
  })
})

describe('extractNameHints', () => {
  it('matches whole tokens', () => {
    expect(extractNameHints('Primary Button')).toEqual(['button'])
    expect(extractNameHints('cta / large')).toEqual(['cta'])
  })

  it('matches inside compound names', () => {
    expect(extractNameHints('btnPrimary')).toEqual(['btn'])
    expect(extractNameHints('SearchInputField')).toEqual(['field', 'input'])
  })

  it('returns an empty list for neutral names', () => {
    expect(extractNameHints('Hero Illustration')).toEqual([])
    expect(extractNameHints('')).toEqual([])
  })

  it('matches German layer names — a library can be named entirely in German', () => {
    expect(extractNameHints('Anmelden')).toEqual(['melden'])
    expect(extractNameHints('Kategorie-Kachel')).toEqual(['kachel', 'kategorie'])
    expect(extractNameHints('Weiter zur Auswahl')).toEqual(['auswahl', 'weiter'])
  })

  it('keeps umlauts inside a token', () => {
    // Splitting on `[^a-z0-9]` tore „Schaltfläche" into „schaltfl" + „che", so
    // no keyword with an umlaut could ever match.
    expect(extractNameHints('Schaltfläche / Primär')).toEqual(['schaltfläche'])
    expect(extractNameHints('Menü')).toEqual(['menü'])
    expect(extractNameHints('Kontrollkästchen')).toEqual(['kästchen'])
  })

  it('deduplicates and sorts deterministically', () => {
    expect(extractNameHints('button button BUTTON')).toEqual(['button'])
    expect(extractNameHints('menu tab chip')).toEqual(['chip', 'menu', 'tab'])
  })
})

describe('relativeLuminance', () => {
  it('spans white to black', () => {
    expect(relativeLuminance({ r: 1, g: 1, b: 1 })).toBeCloseTo(1, 5)
    expect(relativeLuminance({ r: 0, g: 0, b: 0 })).toBeCloseTo(0, 5)
  })

  it('weights green highest', () => {
    const green = relativeLuminance({ r: 0, g: 1, b: 0 })
    const red = relativeLuminance({ r: 1, g: 0, b: 0 })
    const blue = relativeLuminance({ r: 0, g: 0, b: 1 })
    expect(green).toBeGreaterThan(red)
    expect(red).toBeGreaterThan(blue)
  })
})

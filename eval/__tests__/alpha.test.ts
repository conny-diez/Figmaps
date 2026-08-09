/**
 * Die Abkürzung im Alpha-Sweep darf nicht von der Engine wegdriften.
 *
 * `alphaSweep` berechnet den Bildanteil **einmal** je Bild und mischt ihn
 * danach für jeden Alpha-Wert neu, statt die Engine sechsmal laufen zu lassen.
 * Das ist nur zulässig, solange die Mischung Zeichen für Zeichen dieselbe ist
 * wie in `combineFeatureParts`. Ändert dort jemand etwas — ein zweites Gamma,
 * eine andere Normierung —, misst der Sweep sonst still eine andere Engine als
 * die, über die er entscheidet. Das ist genau die Fehlerklasse aus A-1.
 */
import { describe, expect, it } from 'vitest'
import { blendAt, concentrationOf } from '../alpha'
import { combineFeatureParts, combineFeatures } from '../../src/engine/heuristic'
import { normalize01 } from '../../src/engine/imageops'
import { cloneParams, resolveParams } from '../../src/engine/params'
import type { FeatureMaps } from '../../src/engine/types'

const WIDTH = 24
const HEIGHT = 32

/** Deterministische, nicht triviale Feature-Maps — kein `Math.random`. */
function featuresFor(): FeatureMaps {
  const size = WIDTH * HEIGHT
  const make = (fn: (x: number, y: number) => number): Float32Array => {
    const values = new Float32Array(size)
    for (let y = 0; y < HEIGHT; y++) {
      for (let x = 0; x < WIDTH; x++) values[y * WIDTH + x] = fn(x / WIDTH, y / HEIGHT)
    }
    return values
  }
  return {
    luminanceContrast: make((x, y) => Math.abs(Math.sin(x * 7) * Math.cos(y * 5))),
    colorOpponency: make((x, y) => (x + y) / 2),
    edgeDensity: make((x, y) => (x > 0.4 && x < 0.6 ? 1 : 0.1 + y * 0.2)),
    textSalience: make((_x, y) => (y < 0.2 ? 0.9 : 0.05)),
    interactiveSalience: make((x, y) => (y > 0.8 && x > 0.2 && x < 0.8 ? 1 : 0)),
    imageSalience: make((_x, y) => (y > 0.3 && y < 0.6 ? 0.6 : 0)),
    positionPrior: make((x, y) => Math.exp(-((x - 0.35) ** 2 + (y - 0.28) ** 2) * 4)),
  }
}

describe('blendAt', () => {
  const features = featuresFor()
  const base = resolveParams('hybrid-v1')

  for (const alpha of [0, 0.3, 0.5, 1.2, 3]) {
    it(`reproduces the shipped combination at α = ${alpha}`, () => {
      const params = cloneParams(base)
      params.blendAlpha = alpha
      const expected = combineFeatures(features, WIDTH, HEIGHT, params)

      const actual = blendAt(normalize01(features.positionPrior), imageTermOf(features), alpha)
      expect(actual.length).toBe(expected.length)
      for (let i = 0; i < expected.length; i++) expect(actual[i]).toBeCloseTo(expected[i], 6)
    })
  }
})

/**
 * Der nachbearbeitete Bildanteil, so wie ihn der Sweep aus der Engine zieht:
 * einmal je Bild, mit einem beliebigen Alpha — er hängt nicht davon ab.
 */
function imageTermOf(features: FeatureMaps): Float32Array {
  const params = cloneParams(resolveParams('hybrid-v1'))
  params.blendAlpha = 1
  const parts = combineFeatureParts(features, WIDTH, HEIGHT, params)
  if (!parts.imageTerm) throw new Error('kein Bildanteil')
  return parts.imageTerm
}

describe('concentrationOf', () => {
  it('is 0 for a constant map — there is nothing to concentrate', () => {
    // Der entartete Fall, und er gehört ausgeschrieben: `normalize01` bildet
    // eine konstante Karte auf lauter Nullen ab, und ohne Masse gibt es keinen
    // Massenanteil. Ein leerer Frame kommt so heraus, nicht als „gleichmäßig".
    const values = new Float32Array(100 * 100).fill(0.4)
    expect(concentrationOf({ width: 100, height: 100, values })).toBe(0)
  })

  it('sorts a sharp peak above an even ramp', () => {
    const size = 100
    const ramp = new Float32Array(size * size)
    for (let i = 0; i < ramp.length; i++) ramp[i] = (i % size) / size
    const peak = new Float32Array(size * size)
    for (let y = 40; y < 60; y++) for (let x = 40; x < 60; x++) peak[y * size + x] = 1
    expect(concentrationOf({ width: size, height: size, values: peak })).toBeGreaterThan(
      concentrationOf({ width: size, height: size, values: ramp }),
    )
  })

  it('approaches 1 when all mass sits in a few pixels', () => {
    const values = new Float32Array(100 * 100)
    for (let i = 0; i < 200; i++) values[i] = 1
    expect(concentrationOf({ width: 100, height: 100, values })).toBeGreaterThan(0.9)
  })

  it('is invariant to a linear rescale of the map', () => {
    const values = new Float32Array(64 * 64)
    for (let i = 0; i < values.length; i++) values[i] = (i % 64) / 64
    const scaled = Float32Array.from(values, (value) => value * 3.7)
    expect(concentrationOf({ width: 64, height: 64, values: scaled })).toBeCloseTo(
      concentrationOf({ width: 64, height: 64, values }),
      6,
    )
  })
})

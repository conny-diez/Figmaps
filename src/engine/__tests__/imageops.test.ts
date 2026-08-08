import { describe, expect, it } from 'vitest'
import {
  applyGamma,
  gaussianBlur,
  luminanceChannel,
  meanInRect,
  normalize01,
  opponentChannels,
  percentile,
  percentileClipNormalize,
  rasterizeRects,
  sampleBilinear,
  sobelMagnitude,
  weightedSum,
} from '../imageops'
import { solidImage } from './helpers'

describe('luminanceChannel', () => {
  it('maps white to 1 and black to 0', () => {
    expect(luminanceChannel(solidImage(2, 2, [255, 255, 255]))[0]).toBeCloseTo(1, 5)
    expect(luminanceChannel(solidImage(2, 2, [0, 0, 0]))[0]).toBeCloseTo(0, 5)
  })
})

describe('opponentChannels', () => {
  it('is zero for achromatic input', () => {
    const { redGreen, blueYellow } = opponentChannels(solidImage(3, 3, [128, 128, 128]))
    expect([...redGreen].every((v) => v === 0)).toBe(true)
    expect([...blueYellow].every((v) => v === 0)).toBe(true)
  })

  it('separates red from green', () => {
    const { redGreen } = opponentChannels(solidImage(1, 1, [255, 0, 0]))
    expect(redGreen[0]).toBeCloseTo(1, 5)
  })
})

describe('gaussianBlur', () => {
  it('leaves a constant field untouched (clamped borders)', () => {
    const src = new Float32Array(64).fill(0.42)
    const out = gaussianBlur(src, 8, 8, 3)
    for (const value of out) expect(value).toBeCloseTo(0.42, 5)
  })

  it('spreads an impulse symmetrically and conserves mass', () => {
    const width = 33
    const height = 33
    const src = new Float32Array(width * height)
    const center = 16 * width + 16
    src[center] = 1

    const out = gaussianBlur(src, width, height, 2)
    const total = out.reduce((sum, value) => sum + value, 0)
    expect(total).toBeCloseTo(1, 3)
    expect(out[center]).toBeGreaterThan(out[center + 1])
    expect(out[center - 1]).toBeCloseTo(out[center + 1], 6)
    expect(out[center - width]).toBeCloseTo(out[center + width], 6)
  })

  it('is a no-op for sigma <= 0', () => {
    const src = Float32Array.from([1, 2, 3, 4])
    expect([...gaussianBlur(src, 2, 2, 0)]).toEqual([1, 2, 3, 4])
  })

  it('is deterministic', () => {
    const src = Float32Array.from({ length: 100 }, (_, i) => (i % 7) / 7)
    expect([...gaussianBlur(src, 10, 10, 1.7)]).toEqual([...gaussianBlur(src, 10, 10, 1.7)])
  })
})

describe('sobelMagnitude', () => {
  it('is zero on a constant field', () => {
    const out = sobelMagnitude(new Float32Array(25).fill(0.5), 5, 5)
    expect([...out].every((v) => v === 0)).toBe(true)
  })

  it('responds on a vertical step edge', () => {
    const width = 8
    const height = 8
    const src = new Float32Array(width * height)
    for (let y = 0; y < height; y++) {
      for (let x = 4; x < width; x++) src[y * width + x] = 1
    }
    const out = sobelMagnitude(src, width, height)
    expect(out[3 * width + 4]).toBeGreaterThan(0)
    expect(out[3 * width + 1]).toBe(0)
  })
})

describe('normalize01', () => {
  it('turns a constant field into an all-zero map', () => {
    expect([...normalize01(new Float32Array(9).fill(3))]).toEqual(new Array(9).fill(0))
  })

  it('stretches to the full range', () => {
    const out = normalize01(Float32Array.from([2, 4, 6]))
    expect([...out]).toEqual([0, 0.5, 1])
  })
})

describe('percentileClipNormalize', () => {
  it('clips outliers instead of letting them compress the scale', () => {
    // A clean 0..1 ramp plus a handful of extreme outliers (< 1% of samples).
    const src = new Float32Array(1000)
    for (let i = 0; i < 995; i++) src[i] = i / 994
    for (let i = 995; i < 1000; i++) src[i] = 1000

    const out = percentileClipNormalize(src, 1, 99)
    expect(out[999]).toBe(1)
    // Plain min-max would squash the ramp below 0.001; clipping keeps it usable.
    expect(out[800]).toBeGreaterThan(0.5)
    expect(normalize01(src)[800]).toBeLessThan(0.01)
    expect(Math.max(...out)).toBeLessThanOrEqual(1)
    expect(Math.min(...out)).toBeGreaterThanOrEqual(0)
  })

  it('returns zeros for a flat input', () => {
    expect([...percentileClipNormalize(new Float32Array(10).fill(0.7), 1, 99)]).toEqual(new Array(10).fill(0))
  })
})

describe('percentile', () => {
  it('interpolates between samples', () => {
    const src = Float32Array.from([0, 1, 2, 3, 4, 5, 6, 7, 8, 9])
    expect(percentile(src, 0)).toBe(0)
    expect(percentile(src, 100)).toBe(9)
    expect(percentile(src, 50)).toBeCloseTo(4.5, 5)
  })
})

describe('applyGamma', () => {
  it('lifts mid tones for gamma < 1', () => {
    const out = applyGamma(Float32Array.from([0, 0.25, 1]), 0.8)
    expect(out[0]).toBe(0)
    expect(out[2]).toBeCloseTo(1, 5)
    expect(out[1]).toBeGreaterThan(0.25)
  })
})

describe('weightedSum', () => {
  it('combines maps by weight', () => {
    const out = weightedSum(
      [
        { map: Float32Array.from([1, 0]), weight: 0.25 },
        { map: Float32Array.from([0, 1]), weight: 0.75 },
      ],
      2,
    )
    expect(out[0]).toBeCloseTo(0.25, 6)
    expect(out[1]).toBeCloseTo(0.75, 6)
  })
})

describe('rasterizeRects', () => {
  it('keeps the maximum where rectangles overlap', () => {
    const out = rasterizeRects(4, 4, [
      { rect: { x: 0, y: 0, width: 2, height: 2 }, intensity: 0.4 },
      { rect: { x: 1, y: 1, width: 2, height: 2 }, intensity: 0.9 },
    ])
    expect(out[0]).toBeCloseTo(0.4, 6)
    expect(out[5]).toBeCloseTo(0.9, 6)
    expect(out[15]).toBe(0)
  })

  it('clips rectangles to the grid', () => {
    const out = rasterizeRects(3, 3, [{ rect: { x: -5, y: -5, width: 20, height: 20 }, intensity: 1 }])
    expect([...out].every((v) => v === 1)).toBe(true)
  })
})

describe('meanInRect', () => {
  it('averages only inside the rectangle', () => {
    const values = Float32Array.from([0, 0, 0, 0, 1, 1, 0, 1, 1])
    expect(meanInRect(values, 3, 3, { x: 1, y: 1, width: 2, height: 2 })).toBe(1)
    expect(meanInRect(values, 3, 3, { x: 10, y: 10, width: 2, height: 2 })).toBe(0)
  })
})

describe('sampleBilinear', () => {
  it('interpolates between neighbours', () => {
    const values = Float32Array.from([0, 1, 0, 1])
    expect(sampleBilinear(values, 2, 2, 0.5, 0)).toBeCloseTo(0.5, 6)
    expect(sampleBilinear(values, 2, 2, -3, 0)).toBe(0)
  })
})

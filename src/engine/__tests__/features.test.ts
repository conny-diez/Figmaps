import { describe, expect, it } from 'vitest'
import { colorOpponency } from '../features/color'
import { edgeDensity } from '../features/edges'
import { luminanceContrast } from '../features/luminance'
import { positionPrior } from '../features/prior'
import { imageSalience, interactiveSalience, textSalience } from '../features/structure'
import { ENGINE_CONFIG } from '../config'
import { argmax, coordsOf, fillRect, makeSignal, meanOfRect, solidImage } from './helpers'

const WHITE: [number, number, number] = [255, 255, 255]
const BLACK: [number, number, number] = [0, 0, 0]
const GREY: [number, number, number] = [128, 128, 128]

const SQUARE = { x: 32, y: 40, width: 32, height: 32 }

describe('luminanceContrast', () => {
  it('is flat for a uniform image', () => {
    const map = luminanceContrast(solidImage(64, 64, WHITE))
    expect([...map].every((v) => v === 0)).toBe(true)
  })

  it('peaks on a black square', () => {
    const image = fillRect(solidImage(128, 128, WHITE), SQUARE, BLACK)
    const map = luminanceContrast(image)
    const { x, y } = coordsOf(argmax(map), 128)
    // The DoG response sits on the square's edge band.
    const margin = ENGINE_CONFIG.luminance.surroundSigma
    expect(x).toBeGreaterThanOrEqual(SQUARE.x - margin)
    expect(x).toBeLessThanOrEqual(SQUARE.x + SQUARE.width + margin)
    expect(y).toBeGreaterThanOrEqual(SQUARE.y - margin)
    expect(y).toBeLessThanOrEqual(SQUARE.y + SQUARE.height + margin)
  })
})

describe('colorOpponency', () => {
  it('is flat for achromatic input', () => {
    const map = colorOpponency(solidImage(64, 64, GREY))
    expect([...map].every((v) => v === 0)).toBe(true)
  })

  it('reacts to a red patch on grey', () => {
    const image = fillRect(solidImage(128, 128, GREY), SQUARE, [255, 0, 0])
    const map = colorOpponency(image)
    const inside = meanOfRect(map, 128, SQUARE)
    const far = meanOfRect(map, 128, { x: 96, y: 96, width: 24, height: 24 })
    expect(inside).toBeGreaterThan(far)
  })
})

describe('edgeDensity', () => {
  it('is flat for a uniform image', () => {
    const map = edgeDensity(solidImage(64, 64, WHITE))
    expect([...map].every((v) => v === 0)).toBe(true)
  })

  it('is highest around the square, not in the empty corner', () => {
    const image = fillRect(solidImage(128, 128, WHITE), SQUARE, BLACK)
    const map = edgeDensity(image)
    const around = meanOfRect(map, 128, SQUARE)
    const corner = meanOfRect(map, 128, { x: 100, y: 100, width: 20, height: 20 })
    expect(around).toBeGreaterThan(corner)
    expect(corner).toBeCloseTo(0, 3)
  })
})

describe('positionPrior', () => {
  it('peaks near the configured F-pattern anchor', () => {
    const width = 200
    const height = 400
    const map = positionPrior(width, height)
    const { x, y } = coordsOf(argmax(map), width)
    expect(x / width).toBeCloseTo(ENGINE_CONFIG.prior.centerX, 1)
    expect(y / height).toBeCloseTo(ENGINE_CONFIG.prior.centerY, 1)
  })

  it('decays more slowly downwards than upwards', () => {
    const width = 100
    const height = 100
    const map = positionPrior(width, height)
    const cx = Math.round(ENGINE_CONFIG.prior.centerX * width)
    const cy = Math.round(ENGINE_CONFIG.prior.centerY * height)
    const below = map[Math.min(height - 1, cy + 20) * width + cx]
    const above = map[Math.max(0, cy - 20) * width + cx]
    expect(below).toBeGreaterThan(above)
  })

  it('stays within [0,1] and never reaches zero', () => {
    const map = positionPrior(40, 40)
    for (const value of map) {
      expect(value).toBeGreaterThanOrEqual(ENGINE_CONFIG.prior.floor)
      expect(value).toBeLessThanOrEqual(1)
    }
  })

  it('mirrors for RTL when configured', () => {
    const width = 100
    const map = positionPrior(width, 100, { ...ENGINE_CONFIG.prior, mirrorHorizontally: true })
    const { x } = coordsOf(argmax(map), width)
    expect(x / width).toBeCloseTo(1 - ENGINE_CONFIG.prior.centerX, 1)
  })
})

describe('textSalience', () => {
  it('is empty without text nodes', () => {
    const map = textSalience([makeSignal()], 400, 400, 100, 100)
    expect([...map].every((v) => v === 0)).toBe(true)
  })

  it('places the peak at the text rectangle', () => {
    const signal = makeSignal({ isText: true, fontSize: 48, fontWeight: 700, charCount: 12, x: 200, y: 100, width: 100, height: 40 })
    const map = textSalience([signal], 400, 400, 100, 100)
    const { x, y } = coordsOf(argmax(map), 100)
    expect(x).toBeGreaterThanOrEqual(48)
    expect(x).toBeLessThanOrEqual(78)
    expect(y).toBeGreaterThanOrEqual(23)
    expect(y).toBeLessThanOrEqual(38)
  })

  it('ranks a large bold headline above small body copy', () => {
    const headline = makeSignal({ isText: true, fontSize: 48, fontWeight: 700, charCount: 20, x: 0, y: 0, width: 200, height: 60 })
    const body = makeSignal({ isText: true, fontSize: 12, fontWeight: 400, charCount: 20, x: 0, y: 300, width: 200, height: 60 })
    const map = textSalience([headline, body], 400, 400, 100, 100)
    const top = meanOfRect(map, 100, { x: 5, y: 3, width: 40, height: 10 })
    const bottom = meanOfRect(map, 100, { x: 5, y: 78, width: 40, height: 10 })
    expect(top).toBeGreaterThan(bottom)
  })

  it('ignores font sizes below the minimum', () => {
    const tiny = makeSignal({ isText: true, fontSize: ENGINE_CONFIG.text.minFontSize - 1, charCount: 3 })
    expect([...textSalience([tiny], 400, 400, 100, 100)].every((v) => v === 0)).toBe(true)
  })
})

describe('interactiveSalience', () => {
  it('ranks a prototype hotspot above a mere name match', () => {
    const hotspot = makeSignal({ hasReactions: true, x: 0, y: 0, width: 100, height: 40 })
    const named = makeSignal({ nameHints: ['button'], x: 0, y: 200, width: 100, height: 40 })
    const map = interactiveSalience([hotspot, named], 400, 400, 100, 100)
    const hotspotMean = meanOfRect(map, 100, { x: 2, y: 2, width: 20, height: 6 })
    const namedMean = meanOfRect(map, 100, { x: 2, y: 52, width: 20, height: 6 })
    expect(hotspotMean).toBeGreaterThan(namedMean)
  })

  it('is empty when nothing looks interactive', () => {
    const map = interactiveSalience([makeSignal()], 400, 400, 100, 100)
    expect([...map].every((v) => v === 0)).toBe(true)
  })
})

describe('imageSalience', () => {
  it('marks image rectangles only', () => {
    const image = makeSignal({ isImage: true, x: 0, y: 0, width: 200, height: 200 })
    const other = makeSignal({ x: 200, y: 200, width: 200, height: 200 })
    const map = imageSalience([image, other], 400, 400, 100, 100)
    expect(meanOfRect(map, 100, { x: 5, y: 5, width: 30, height: 30 })).toBeGreaterThan(0.5)
    expect(meanOfRect(map, 100, { x: 70, y: 70, width: 20, height: 20 })).toBeCloseTo(0, 2)
  })
})

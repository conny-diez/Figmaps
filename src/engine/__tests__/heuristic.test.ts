import { describe, expect, it } from 'vitest'
import { ENGINE_VERSION } from '../config'
import { HeuristicAttentionEngine } from '../heuristic'
import { argmax, coordsOf, fillRect, makeSignal, meanOfRect, solidImage } from './helpers'

const engine = new HeuristicAttentionEngine()
const WHITE: [number, number, number] = [255, 255, 255]
const BLACK: [number, number, number] = [0, 0, 0]

const SIZE = 96
const SQUARE = { x: 56, y: 56, width: 24, height: 24 }

async function predict(pixels: Parameters<typeof engine.predict>[0]['pixels'], signals = [] as ReturnType<typeof makeSignal>[]) {
  return engine.predict({ pixels, signals, frameWidth: SIZE, frameHeight: SIZE })
}

describe('HeuristicAttentionEngine', () => {
  it('reports its version', () => {
    expect(engine.version).toBe(ENGINE_VERSION)
  })

  it('returns one value per pixel, all within [0,1]', async () => {
    const map = await predict(solidImage(SIZE, SIZE, WHITE))
    expect(map.length).toBe(SIZE * SIZE)
    for (const value of map) {
      expect(value).toBeGreaterThanOrEqual(0)
      expect(value).toBeLessThanOrEqual(1)
    }
  })

  it('falls back to the reading-order prior on a featureless screen', async () => {
    const map = await predict(solidImage(SIZE, SIZE, WHITE))
    const { x, y } = coordsOf(argmax(map), SIZE)
    // Upper-left-of-centre, i.e. the F-pattern anchor — nothing else to go on.
    expect(x / SIZE).toBeLessThan(0.6)
    expect(y / SIZE).toBeLessThan(0.6)
  })

  it('raises attention where a high-contrast element appears', async () => {
    const blank = await predict(solidImage(SIZE, SIZE, WHITE))
    const withSquare = await predict(fillRect(solidImage(SIZE, SIZE, WHITE), SQUARE, BLACK))

    const before = meanOfRect(blank, SIZE, SQUARE)
    const after = meanOfRect(withSquare, SIZE, SQUARE)
    expect(after).toBeGreaterThan(before)
  })

  it('lets a headline outrank the background it sits on', async () => {
    const headline = makeSignal({
      isText: true,
      fontSize: 48,
      fontWeight: 700,
      charCount: 24,
      x: 8,
      y: 60,
      width: 80,
      height: 20,
    })
    const map = await predict(solidImage(SIZE, SIZE, WHITE), [headline])
    const onHeadline = meanOfRect(map, SIZE, { x: 8, y: 60, width: 80, height: 20 })
    const elsewhere = meanOfRect(map, SIZE, { x: 8, y: 88, width: 80, height: 6 })
    expect(onHeadline).toBeGreaterThan(elsewhere)
  })

  it('is deterministic — same input, identical output (NFR-6)', async () => {
    const image = fillRect(solidImage(SIZE, SIZE, WHITE), SQUARE, BLACK)
    const signals = [makeSignal({ hasReactions: true, x: 10, y: 10, width: 40, height: 20 })]
    const a = await predict(image, signals)
    const b = await predict(image, signals)
    expect([...a]).toEqual([...b])
  })

  it('exposes the individual feature maps for tuning', async () => {
    const features = await engine.computeFeatures({
      pixels: solidImage(32, 32, WHITE),
      signals: [],
      frameWidth: 32,
      frameHeight: 32,
    })
    expect(Object.keys(features).sort()).toEqual([
      'colorOpponency',
      'edgeDensity',
      'imageSalience',
      'interactiveSalience',
      'luminanceContrast',
      'positionPrior',
      'textSalience',
    ])
    for (const map of Object.values(features)) expect(map.length).toBe(32 * 32)
  })
})

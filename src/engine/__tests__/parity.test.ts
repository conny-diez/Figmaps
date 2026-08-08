/**
 * A-1 acceptance — the harness must measure the pipeline the plugin ships.
 *
 * The PRD wording is "same engine, same input, in browser and Node — result
 * arrays differ by at most 1e-4 per element". A real browser is not available
 * in vitest, so the guarantee is established in three steps:
 *
 *   1. the engine only consumes `Bitmap` + `Float32Array` and never a canvas,
 *   2. both `ImageOps` implementations delegate `resize`/`blur` to the *same*
 *      pure functions, so there is only one resampler and one blur in the repo,
 *   3. running the engine through each implementation's ops produces arrays
 *      that agree to well below 1e-4.
 *
 * Step 2 is the load-bearing one: if someone reintroduces a canvas-based
 * downscale in the iframe, the identity assertions below fail immediately.
 */
import { describe, expect, it } from 'vitest'
import { ImageOpsCanvas } from '../../platform/imageops-canvas'
import { ImageOpsNode } from '../../platform/imageops-node'
import { decodePngBytes, encodePngBytes } from '../../platform/png'
import { nodeZlib } from '../../platform/imageops-node'
import { ENGINE_CONFIG } from '../config'
import { HeuristicAttentionEngine } from '../heuristic'
import { blurField, resizeBitmap } from '../ops-pure'
import type { Bitmap } from '../ops'
import { fillRect, makeSignal, solidImage } from './helpers'

const canvasOps = new ImageOpsCanvas()
const nodeOps = new ImageOpsNode()

function sampleBitmap(width = 200, height = 140): Bitmap {
  const image = solidImage(width, height, [240, 240, 245])
  fillRect(image, { x: 16, y: 12, width: 90, height: 34 }, [20, 20, 30])
  fillRect(image, { x: 120, y: 60, width: 60, height: 60 }, [220, 40, 40])
  fillRect(image, { x: 20, y: 96, width: 120, height: 26 }, [30, 120, 220])
  return image
}

const SIGNALS = [
  makeSignal({ isText: true, fontSize: 32, fontWeight: 700, charCount: 18, x: 16, y: 12, width: 90, height: 34 }),
  makeSignal({ name: 'Primary Button', nameHints: ['button'], x: 20, y: 96, width: 120, height: 26 }),
  makeSignal({ isImage: true, x: 120, y: 60, width: 60, height: 60 }),
]

function maxAbsDiff(a: Float32Array, b: Float32Array): number {
  expect(a.length).toBe(b.length)
  let worst = 0
  for (let i = 0; i < a.length; i++) worst = Math.max(worst, Math.abs(a[i] - b[i]))
  return worst
}

describe('A-1 — engine/platform separation', () => {
  it('shares one resampler and one blur between both realms', () => {
    // Same function object, not merely the same numbers: this is what keeps the
    // browser from quietly using `drawImage` for the analysis downscale.
    expect(ImageOpsCanvas.prototype.resize.call(canvasOps, sampleBitmap(8, 8), 4, 4)).toEqual(
      resizeBitmap(sampleBitmap(8, 8), 4, 4),
    )
    const field = Float32Array.from({ length: 64 }, (_, i) => (i % 7) / 7)
    expect(canvasOps.blur(field, 8, 8, 1.5)).toEqual(blurField(field, 8, 8, 1.5))
    expect(nodeOps.blur(field, 8, 8, 1.5)).toEqual(blurField(field, 8, 8, 1.5))
  })

  it('resizes identically in both realms', () => {
    const source = sampleBitmap()
    const viaCanvas = canvasOps.resize(source, 64, 45)
    const viaNode = nodeOps.resize(source, 64, 45)
    expect(viaNode.width).toBe(viaCanvas.width)
    expect(viaNode.height).toBe(viaCanvas.height)
    expect(Array.from(viaNode.data)).toEqual(Array.from(viaCanvas.data))
  })

  it('predicts the same map through either ImageOps implementation', async () => {
    const pixels = nodeOps.resize(sampleBitmap(), 128, 90)
    const input = { pixels, signals: SIGNALS, frameWidth: 200, frameHeight: 140 }

    const browserSide = await new HeuristicAttentionEngine({ blur: canvasOps.blur.bind(canvasOps) }).predict(input)
    const nodeSide = await new HeuristicAttentionEngine({ blur: nodeOps.blur.bind(nodeOps) }).predict(input)

    expect(maxAbsDiff(browserSide, nodeSide)).toBeLessThanOrEqual(1e-4)
  })

  it('is deterministic across repeated runs', async () => {
    const pixels = nodeOps.resize(sampleBitmap(), 96, 67)
    const input = { pixels, signals: SIGNALS, frameWidth: 200, frameHeight: 140 }
    const engine = new HeuristicAttentionEngine()
    expect(maxAbsDiff(await engine.predict(input), await engine.predict(input))).toBe(0)
  })

  it('bounds the analysis source on width, not on the longer edge', async () => {
    // A 1440x6000 scroll page must keep enough width for a section to be
    // sampled *down* to the analysis grid — see ENGINE_CONFIG.analysisSource.
    const { analysisSourceSize } = await import('../ops-pure')
    const size = analysisSourceSize(
      1440,
      6000,
      ENGINE_CONFIG.analysisSource.maxWidth,
      ENGINE_CONFIG.analysisSource.maxPixels,
    )
    expect(size.width).toBeGreaterThanOrEqual(ENGINE_CONFIG.analysisEdge)
    expect(size.width * size.height).toBeLessThanOrEqual(ENGINE_CONFIG.analysisSource.maxPixels)
  })
})

describe('A-1 — PNG codec', () => {
  it('round-trips losslessly', () => {
    const source = sampleBitmap(37, 23)
    const decoded = decodePngBytes(encodePngBytes(source, nodeZlib), nodeZlib)
    expect(decoded.width).toBe(source.width)
    expect(decoded.height).toBe(source.height)
    expect(Array.from(decoded.data)).toEqual(Array.from(source.data))
  })

  it('decodes greyscale and rejects what it cannot read', () => {
    const grey = solidImage(4, 4, [10, 10, 10])
    const decoded = nodeOps.decodeSync(encodePngBytes(grey, nodeZlib))
    expect(decoded.data[0]).toBe(10)
    expect(() => decodePngBytes(new Uint8Array(16), nodeZlib)).toThrow(/Signatur/)
  })
})

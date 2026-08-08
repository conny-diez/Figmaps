/**
 * hybrid-v1 — data-estimated location prior plus additive image analysis.
 */
import { describe, expect, it } from 'vitest'
import { combineFeatures, HeuristicAttentionEngine } from '../heuristic'
import { deviationOf, deviationScore, correlation } from '../deviation'
import { ENGINE_CONFIGS, HYBRID_BLEND_ALPHA, resolveParams } from '../params'
import { decodeBase64, hasPriorAsset, priorAssetIdFor, priorMap, shipsPriorAsset, PRIOR_ASSETS } from '../priors'
import { ENGINE_CONFIG } from '../config'
import type { FeatureMaps } from '../types'

const W = 24
const H = 16

function ramp(from: number, to: number): Float32Array {
  const values = new Float32Array(W * H)
  for (let i = 0; i < values.length; i++) values[i] = from + ((to - from) * i) / (values.length - 1)
  return values
}

function constant(value: number): Float32Array {
  return new Float32Array(W * H).fill(value)
}

function features(overrides: Partial<FeatureMaps> = {}): FeatureMaps {
  return {
    luminanceContrast: constant(0),
    colorOpponency: constant(0),
    edgeDensity: constant(0),
    textSalience: constant(0),
    interactiveSalience: constant(0),
    imageSalience: constant(0),
    positionPrior: constant(0),
    ...overrides,
  }
}

describe('base64 decoder', () => {
  it('round-trips bytes without atob or Buffer', () => {
    const bytes = Uint8Array.from({ length: 200 }, (_, i) => (i * 7) % 256)
    const encoded = Buffer.from(bytes).toString('base64')
    expect(Array.from(decodeBase64(encoded))).toEqual(Array.from(bytes))
  })

  it('handles lengths that are not a multiple of three', () => {
    for (const length of [1, 2, 3, 4, 5]) {
      const bytes = Uint8Array.from({ length }, (_, i) => i + 1)
      expect(Array.from(decodeBase64(Buffer.from(bytes).toString('base64')))).toEqual(Array.from(bytes))
    }
  })

  it('ignores whitespace and line breaks', () => {
    const bytes = Uint8Array.from([1, 2, 3, 4, 5, 6])
    const encoded = Buffer.from(bytes).toString('base64')
    expect(Array.from(decodeBase64(`${encoded.slice(0, 4)}\n  ${encoded.slice(4)}`))).toEqual(Array.from(bytes))
  })
})

describe('prior assets', () => {
  it('ships a prior for both UI categories', () => {
    expect(shipsPriorAsset()).toBe(true)
    expect(hasPriorAsset('web')).toBe(true)
    expect(hasPriorAsset('mobile')).toBe(true)
  })

  it('stays inside the 50 kB per-map budget', () => {
    for (const asset of Object.values(PRIOR_ASSETS)) {
      expect(asset.data.length).toBeLessThan(50 * 1024)
    }
  })

  it('decodes to exactly width x height samples', () => {
    for (const asset of Object.values(PRIOR_ASSETS)) {
      expect(decodeBase64(asset.data).length).toBe(asset.width * asset.height)
    }
  })

  it('resamples onto any grid, normalised to [0,1]', () => {
    const map = priorMap('web', W, H)
    expect(map).not.toBeNull()
    expect(map!.length).toBe(W * H)
    let max = 0
    for (const value of map!) {
      expect(value).toBeGreaterThanOrEqual(0)
      expect(value).toBeLessThanOrEqual(1)
      if (value > max) max = value
    }
    expect(max).toBeCloseTo(1, 6)
  })

  it('puts more mass in the upper half than in the lower — that is the point', () => {
    for (const id of ['web', 'mobile'] as const) {
      const map = priorMap(id, 32, 32)!
      let top = 0
      let bottom = 0
      for (let y = 0; y < 32; y++) {
        for (let x = 0; x < 32; x++) {
          if (y < 16) top += map[y * 32 + x]
          else bottom += map[y * 32 + x]
        }
      }
      expect(top).toBeGreaterThan(bottom)
    }
  })

  it('picks the category from the frame width, matching the viewport rule', () => {
    const threshold = ENGINE_CONFIG.viewport.desktopMinWidth
    expect(priorAssetIdFor(1440, 900)).toBe('web')
    // A long desktop scroll page stays desktop however tall it is.
    expect(priorAssetIdFor(1440, 6000)).toBe('web')
    expect(priorAssetIdFor(threshold, 4000)).toBe('web')
    expect(priorAssetIdFor(390, 844)).toBe('mobile')
    expect(priorAssetIdFor(threshold - 1, 500)).toBe('mobile')
  })
})

describe('hybrid-v1 configuration', () => {
  const hybrid = resolveParams('hybrid-v1')

  it('exists next to heuristic-v1 rather than replacing it', () => {
    expect(ENGINE_CONFIGS['heuristic-v1']).toBeDefined()
    expect(ENGINE_CONFIGS['hybrid-v1']).toBeDefined()
    expect(resolveParams('heuristic-v1').priorSource).toBeUndefined()
  })

  it('uses the data prior and the additive blend', () => {
    expect(hybrid.priorSource).toBe('data')
    expect(hybrid.blendAlpha).toBe(HYBRID_BLEND_ALPHA)
  })

  it('drops the prior out of the weighted sum and renormalises the rest', () => {
    expect(hybrid.weights.positionPrior).toBe(0)
    const total = Object.values(hybrid.weights).reduce((sum, value) => sum + value, 0)
    expect(total).toBeCloseTo(1, 10)
  })

  it('keeps the ratios of the 1.0 image features', () => {
    const v1 = resolveParams('heuristic-v1').weights
    expect(hybrid.weights.luminanceContrast / hybrid.weights.textSalience).toBeCloseTo(
      v1.luminanceContrast / v1.textSalience,
      10,
    )
  })
})

describe('combineFeatures — blend path', () => {
  const hybrid = resolveParams('hybrid-v1')

  it('returns the prior alone when the image analysis is flat', () => {
    const prior = ramp(0, 1)
    const out = combineFeatures(features({ positionPrior: prior }), W, H, hybrid)
    // A constant image term shifts everything equally; after normalisation the
    // prior's shape must survive unchanged.
    expect(correlation(out, prior)).toBeCloseTo(1, 5)
  })

  it('moves the result towards the image analysis when the two disagree', () => {
    const prior = ramp(0, 1)
    const image = ramp(1, 0)
    const out = combineFeatures(features({ positionPrior: prior, luminanceContrast: image }), W, H, hybrid)
    expect(correlation(out, prior)).toBeLessThan(1)
    // ...but the prior still dominates at alpha 0.3.
    expect(correlation(out, prior)).toBeGreaterThan(0)
  })

  it('stays inside [0,1]', () => {
    const out = combineFeatures(
      features({ positionPrior: ramp(0, 1), edgeDensity: ramp(1, 0), colorOpponency: ramp(0, 1) }),
      W,
      H,
      hybrid,
    )
    for (const value of out) {
      expect(value).toBeGreaterThanOrEqual(0)
      expect(value).toBeLessThanOrEqual(1)
    }
  })

  it('leaves heuristic-v1 on the weighted-sum path', () => {
    const v1 = resolveParams('heuristic-v1')
    const maps = features({ positionPrior: ramp(0, 1), luminanceContrast: ramp(1, 0) })
    expect(combineFeatures(maps, W, H, v1)).not.toEqual(combineFeatures(maps, W, H, hybrid))
  })
})

describe('engine wiring', () => {
  it('lets the harness state the prior category instead of inferring it', async () => {
    const pixels = { width: 8, height: 8, data: new Uint8ClampedArray(8 * 8 * 4).fill(200) }
    const input = { pixels, signals: [], frameWidth: 1080, frameHeight: 1920 }

    // 1080 px wide is a phone capture at device resolution — inference would
    // call it desktop, which is why the override exists.
    const inferred = await new HeuristicAttentionEngine({ configId: 'hybrid-v1' }).computeFeatures(input)
    const stated = await new HeuristicAttentionEngine({ configId: 'hybrid-v1', priorAsset: 'mobile' }).computeFeatures(input)
    expect(Array.from(inferred.positionPrior)).not.toEqual(Array.from(stated.positionPrior))
  })
})

describe('deviation score', () => {
  it('is 0 when image analysis and prior agree', () => {
    const map = ramp(0, 1)
    expect(deviationScore(map, map)).toBeCloseTo(0, 6)
  })

  it('is 1 when they are exactly opposed', () => {
    expect(deviationScore(ramp(0, 1), ramp(1, 0))).toBeCloseTo(1, 6)
  })

  it('is 0.5 when they are uncorrelated', () => {
    expect(deviationScore(ramp(0, 1), constant(0.5))).toBeCloseTo(0.5, 6)
  })

  it('is invariant to scaling — it measures disagreement, not contrast', () => {
    const prior = ramp(0, 1)
    const weak = Float32Array.from(ramp(1, 0), (value) => value * 0.01)
    expect(deviationScore(weak, prior)).toBeCloseTo(deviationScore(ramp(1, 0), prior), 6)
  })

  it('stays within [0,1] and reports a level', () => {
    const { score, level } = deviationOf(ramp(0, 1), ramp(1, 0))
    expect(score).toBeGreaterThanOrEqual(0)
    expect(score).toBeLessThanOrEqual(1)
    expect(['low', 'medium', 'high']).toContain(level)
  })
})

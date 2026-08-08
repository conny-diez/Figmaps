/**
 * Die Parameter-Konstruktion der beiden Diagnose-Versuche.
 *
 * Beide Versuche stehen und fallen damit, dass die Gewichte korrekt umgebaut
 * werden: ein Sweep, der die übrigen Features nicht sauber herunterskaliert,
 * würde eine Aussage über die Prior-Gewichtung liefern, die keine ist.
 */
import { describe, expect, it } from 'vitest'
import { resolveParams, type FeatureWeights } from '../../src/engine/params'
import { paramsWithPriorWeight, pixelOnlyParams, PRIOR_WEIGHTS, HYBRID_ALPHAS, REQUESTED_ALPHA_MAX } from '../diagnose'

const base = resolveParams()

function sum(weights: FeatureWeights): number {
  return Object.values(weights).reduce((total, value) => total + value, 0)
}

describe('paramsWithPriorWeight', () => {
  it('sets the prior to exactly the requested weight', () => {
    for (const weight of PRIOR_WEIGHTS) {
      expect(paramsWithPriorWeight(base, weight).weights.positionPrior).toBeCloseTo(weight, 10)
    }
  })

  it('keeps the weights summing to 1', () => {
    for (const weight of PRIOR_WEIGHTS) {
      expect(sum(paramsWithPriorWeight(base, weight).weights)).toBeCloseTo(1, 10)
    }
  })

  it('scales the other features proportionally, preserving their ratios', () => {
    const scaled = paramsWithPriorWeight(base, 0.5).weights
    // luminance:colour was 0.20:0.15 in v1 and must stay 4:3.
    expect(scaled.luminanceContrast / scaled.colorOpponency).toBeCloseTo(
      base.weights.luminanceContrast / base.weights.colorOpponency,
      10,
    )
  })

  it('reproduces the shipped configuration at its own prior weight', () => {
    const same = paramsWithPriorWeight(base, base.weights.positionPrior)
    for (const key of Object.keys(base.weights) as Array<keyof FeatureWeights>) {
      expect(same.weights[key]).toBeCloseTo(base.weights[key], 10)
    }
  })

  it('leaves everything but the prior at zero when the prior takes all', () => {
    const all = paramsWithPriorWeight(base, 1).weights
    expect(all.positionPrior).toBe(1)
    expect(all.luminanceContrast).toBeCloseTo(0, 10)
  })

  it('does not mutate the base parameters', () => {
    const before = base.weights.positionPrior
    paramsWithPriorWeight(base, 0.9)
    expect(base.weights.positionPrior).toBe(before)
  })
})

describe('pixelOnlyParams', () => {
  const pixel = pixelOnlyParams(base).weights

  it('keeps only the three image-derived features', () => {
    expect(pixel.positionPrior).toBe(0)
    expect(pixel.textSalience).toBe(0)
    expect(pixel.interactiveSalience).toBe(0)
    expect(pixel.imageSalience).toBe(0)
    expect(pixel.luminanceContrast).toBeGreaterThan(0)
    expect(pixel.colorOpponency).toBeGreaterThan(0)
    expect(pixel.edgeDensity).toBeGreaterThan(0)
  })

  it('renormalises them to 1', () => {
    expect(sum(pixel)).toBeCloseTo(1, 10)
  })

  it('preserves their relative weighting', () => {
    expect(pixel.luminanceContrast / pixel.edgeDensity).toBeCloseTo(
      base.weights.luminanceContrast / base.weights.edgeDensity,
      10,
    )
  })
})

describe('sweep ranges', () => {
  it('covers the requested prior range end to end', () => {
    expect(PRIOR_WEIGHTS[0]).toBe(0.1)
    expect(PRIOR_WEIGHTS[PRIOR_WEIGHTS.length - 1]).toBe(0.9)
  })

  it('contains the requested alphas and marks the exploratory ones', () => {
    for (const alpha of [0.05, 0.1, 0.15, 0.2, 0.25, 0.3]) expect(HYBRID_ALPHAS).toContain(alpha)
    expect(HYBRID_ALPHAS.some((alpha) => alpha > REQUESTED_ALPHA_MAX)).toBe(true)
  })
})

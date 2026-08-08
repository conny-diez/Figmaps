/**
 * A-6 / Epic D — named configurations and viewing-duration profiles.
 */
import { describe, expect, it } from 'vitest'
import { ENGINE_CONFIG, ENGINE_VERSION } from '../config'
import {
  ACTIVE_CONFIG_ID,
  DEFAULT_PROFILE,
  engineConfigEntry,
  engineLabel,
  ENGINE_CONFIGS,
  HEURISTIC_V1,
  PROFILE_IDS,
  resolveParams,
  shippedProfiles,
  type FeatureWeights,
} from '../params'

function sum(weights: FeatureWeights): number {
  return Object.values(weights).reduce((total, value) => total + value, 0)
}

describe('named configurations', () => {
  it('ships the configuration the version string names', () => {
    expect(ACTIVE_CONFIG_ID).toBe(ENGINE_VERSION)
    expect(ENGINE_CONFIGS[ACTIVE_CONFIG_ID]).toBeDefined()
  })

  it('mirrors ENGINE_CONFIG in heuristic-v1 — the frozen 1.0 reference', () => {
    expect(HEURISTIC_V1.weights).toEqual({ ...ENGINE_CONFIG.weights })
    expect(HEURISTIC_V1.prior).toEqual({ ...ENGINE_CONFIG.prior })
    expect(HEURISTIC_V1.post.gamma).toBe(ENGINE_CONFIG.post.gamma)
  })

  it('falls back to the base configuration for an unknown id', () => {
    expect(engineConfigEntry('does-not-exist').id).toBe('heuristic-v1')
    expect(resolveParams('does-not-exist')).toEqual(resolveParams('heuristic-v1'))
  })
})

describe('Epic D — profiles', () => {
  it('defines all three profiles with normalised weights', () => {
    for (const profile of PROFILE_IDS) {
      const params = resolveParams(ACTIVE_CONFIG_ID, profile)
      expect(sum(params.weights)).toBeCloseTo(1, 6)
    }
  })

  it('keeps scan identical to what 1.0 shipped', () => {
    expect(resolveParams('heuristic-v1', 'scan').weights).toEqual(HEURISTIC_V1.weights)
    expect(DEFAULT_PROFILE).toBe('scan')
  })

  it('encodes the stated hypothesis: glance leans on position, read on text', () => {
    const glance = resolveParams('heuristic-v1', 'glance').weights
    const read = resolveParams('heuristic-v1', 'read').weights
    expect(glance.positionPrior).toBeGreaterThan(read.positionPrior)
    expect(read.textSalience).toBeGreaterThan(glance.textSalience)
    expect(read.interactiveSalience).toBeGreaterThan(glance.interactiveSalience)
  })

  it('only ships profiles the harness has proven', () => {
    // The gate of Epic D: an unproven profile is worse than no profile. Until
    // `npm run eval` shows glance/read beating center-bias, only scan ships.
    expect(shippedProfiles()).toContain(DEFAULT_PROFILE)
    expect(shippedProfiles().length).toBeGreaterThanOrEqual(1)
    expect(shippedProfiles().length).toBeLessThanOrEqual(PROFILE_IDS.length)
  })

  it('hides the profile from the engine label while only one ships', () => {
    const label = engineLabel()
    expect(label.startsWith(ACTIVE_CONFIG_ID)).toBe(true)
    if (shippedProfiles().length === 1) expect(label).toBe(ACTIVE_CONFIG_ID)
    else expect(label).toContain(DEFAULT_PROFILE)
  })
})

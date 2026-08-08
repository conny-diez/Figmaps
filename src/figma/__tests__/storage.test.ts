import { describe, expect, it } from 'vitest'
import { ENGINE_CONFIG } from '../../engine/config'
import { DEFAULT_PROFILE, PROFILE_IDS, shippedProfiles } from '../../engine/params'
import { DEFAULT_SETTINGS } from '../../messages'
import { normaliseSettings } from '../storage'

describe('normaliseSettings', () => {
  it('falls back to the defaults for junk input', () => {
    expect(normaliseSettings(undefined)).toEqual(DEFAULT_SETTINGS)
    expect(normaliseSettings('nope')).toEqual(DEFAULT_SETTINGS)
    expect(normaliseSettings({ overlayOpacity: 'x' })).toEqual(DEFAULT_SETTINGS)
  })

  it('clamps the sliders into their documented ranges', () => {
    expect(normaliseSettings({ overlayOpacity: 500 }).overlayOpacity).toBe(100)
    expect(normaliseSettings({ overlayOpacity: -20 }).overlayOpacity).toBe(0)
    expect(normaliseSettings({ focusThreshold: 10 }).focusThreshold).toBe(ENGINE_CONFIG.focus.minPercentile)
    expect(normaliseSettings({ focusThreshold: 99 }).focusThreshold).toBe(ENGINE_CONFIG.focus.maxPercentile)
  })

  it('only accepts 1x and 2x export scales', () => {
    expect(normaliseSettings({ exportScale: 1 }).exportScale).toBe(1)
    expect(normaliseSettings({ exportScale: 4 as unknown as 2 }).exportScale).toBe(2)
  })

  it('keeps individually toggled maps', () => {
    expect(normaliseSettings({ maps: { heat: false } }).maps).toEqual({ heat: false, click: true, focus: true })
  })

  describe('Epic D — profile', () => {
    it('accepts a profile that is shipped', () => {
      for (const profile of shippedProfiles()) {
        expect(normaliseSettings({ profile }).profile).toBe(profile)
      }
    })

    it('falls back when a stored profile is no longer shipped', () => {
      // A user who once selected an unproven profile must not stay stuck on it
      // after the harness removed it.
      const unshipped = PROFILE_IDS.filter((id) => !shippedProfiles().includes(id))
      for (const profile of unshipped) {
        expect(normaliseSettings({ profile }).profile).toBe(DEFAULT_PROFILE)
      }
      expect(normaliseSettings({ profile: 'nonsense' as never }).profile).toBe(DEFAULT_PROFILE)
    })
  })

  describe('Epic B — viewport override', () => {
    it('defaults to automatic', () => {
      expect(normaliseSettings({}).viewportHeight).toBeNull()
      expect(normaliseSettings({ viewportHeight: Number.NaN }).viewportHeight).toBeNull()
    })

    it('clamps an explicit height into a plausible range', () => {
      expect(normaliseSettings({ viewportHeight: 720 }).viewportHeight).toBe(720)
      expect(normaliseSettings({ viewportHeight: 10 }).viewportHeight).toBe(200)
      expect(normaliseSettings({ viewportHeight: 99_999 }).viewportHeight).toBe(4000)
    })
  })
})

import { describe, expect, it } from 'vitest'
import { ENGINE_CONFIG } from '../../engine/config'
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
})

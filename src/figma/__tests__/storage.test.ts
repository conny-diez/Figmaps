import { describe, expect, it } from 'vitest'
import { DEFAULT_PROFILE, PROFILE_IDS, shippedProfiles } from '../../engine/params'
import { DEFAULT_PANEL_SIZE, DEFAULT_SETTINGS, PANEL_SIZE } from '../../messages'
import { normalisePanelSize, normaliseSettings } from '../storage'

describe('normaliseSettings', () => {
  it('falls back to the defaults for junk input', () => {
    expect(normaliseSettings(undefined)).toEqual(DEFAULT_SETTINGS)
    expect(normaliseSettings('nope')).toEqual(DEFAULT_SETTINGS)
    expect(normaliseSettings({ overlayOpacity: 'x' })).toEqual(DEFAULT_SETTINGS)
  })

  it('clamps the sliders into their documented ranges', () => {
    expect(normaliseSettings({ overlayOpacity: 500 }).overlayOpacity).toBe(100)
    expect(normaliseSettings({ overlayOpacity: -20 }).overlayOpacity).toBe(0)
  })

  it('drops a stored export scale — the export is fixed at 2x', () => {
    expect(normaliseSettings({ exportScale: 1 })).toEqual(DEFAULT_SETTINGS)
  })

  it('drops a stored focus threshold — the focus area is fixed', () => {
    expect(normaliseSettings({ focusThreshold: 95 })).toEqual(DEFAULT_SETTINGS)
  })

  it('keeps individually toggled maps', () => {
    expect(normaliseSettings({ maps: { heat: false } }).maps).toEqual({
      heat: false,
      click: true,
      focus: true,
      contrast: true,
    })
  })

  it('schaltet eine neue Karte für alte Einstellungen ein, nicht aus', () => {
    // Eine gespeicherte Einstellung von vor 1.2 kennt `contrast` nicht. Sie
    // bekommt die Voreinstellung — eine neue Ausgabe, die still ausgeschaltet
    // ankommt, sieht für den Nutzer aus wie eine, die es nicht gibt.
    expect(normaliseSettings({ maps: { heat: true, focus: true, click: true } }).maps.contrast).toBe(true)
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

describe('normalisePanelSize', () => {
  it('falls back to the default panel for junk input', () => {
    expect(normalisePanelSize(undefined)).toEqual(DEFAULT_PANEL_SIZE)
    expect(normalisePanelSize('nope')).toEqual(DEFAULT_PANEL_SIZE)
    expect(normalisePanelSize({ width: Number.NaN, height: 'x' })).toEqual(DEFAULT_PANEL_SIZE)
  })

  it('keeps a size inside the limits', () => {
    expect(normalisePanelSize({ width: 480, height: 900 })).toEqual({ width: 480, height: 900 })
  })

  it('clamps to the limits — figma.ui.resize throws on nonsense', () => {
    expect(normalisePanelSize({ width: 10, height: 10 })).toEqual({
      width: PANEL_SIZE.minWidth,
      height: PANEL_SIZE.minHeight,
    })
    expect(normalisePanelSize({ width: -400, height: -1 })).toEqual({
      width: PANEL_SIZE.minWidth,
      height: PANEL_SIZE.minHeight,
    })
    expect(normalisePanelSize({ width: 99_999, height: 99_999 })).toEqual({
      width: PANEL_SIZE.maxWidth,
      height: PANEL_SIZE.maxHeight,
    })
  })

  it('rounds — a fractional size from a pointer event is not a valid window size', () => {
    expect(normalisePanelSize({ width: 480.6, height: 700.4 })).toEqual({ width: 481, height: 700 })
  })
})

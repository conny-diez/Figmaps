/**
 * Epic B acceptance — segmentation geometry and seamless composition.
 */
import { describe, expect, it } from 'vitest'
import { ENGINE_CONFIG } from '../config'
import { composeSections, planSections, sectionAttenuation, viewportHeightFor, type Section } from '../segments'
import type { ScalarMap } from '../types'

const cfg = ENGINE_CONFIG.viewport

describe('B-1 — viewport derivation', () => {
  it('uses a fixed height for desktop widths', () => {
    expect(viewportHeightFor(1440)).toBe(cfg.desktopHeight)
    expect(viewportHeightFor(cfg.desktopMinWidth)).toBe(cfg.desktopHeight)
  })

  it('approximates mobile viewports from the width', () => {
    expect(viewportHeightFor(390)).toBe(Math.round(390 * cfg.mobileHeightFactor))
    expect(viewportHeightFor(1023)).toBe(Math.round(1023 * cfg.mobileHeightFactor))
  })
})

describe('B-1 — section plan', () => {
  it('leaves short frames untouched', () => {
    const plan = planSections(1440, 1200)
    expect(plan.segmented).toBe(false)
    expect(plan.sections).toEqual([{ index: 0, y: 0, height: 1200 }])
    expect(plan.folds).toEqual([])
  })

  it('treats exactly 1.5 viewports as short', () => {
    const plan = planSections(1440, cfg.desktopHeight * cfg.segmentThreshold)
    expect(plan.segmented).toBe(false)
  })

  it('cuts taller frames into one-viewport sections with 20 % overlap', () => {
    const plan = planSections(1440, 4000)
    expect(plan.segmented).toBe(true)
    expect(plan.sections.every((section) => section.height === 900)).toBe(true)

    const step = 900 * (1 - cfg.overlap)
    expect(plan.sections[1].y - plan.sections[0].y).toBeCloseTo(step, 6)

    // Full coverage, no gaps.
    expect(plan.sections[0].y).toBe(0)
    const last = plan.sections[plan.sections.length - 1]
    expect(last.y + last.height).toBe(4000)
    for (let i = 1; i < plan.sections.length; i++) {
      expect(plan.sections[i].y).toBeLessThan(plan.sections[i - 1].y + plan.sections[i - 1].height)
    }
  })

  it('reports fold lines at viewport multiples', () => {
    expect(planSections(1440, 4000).folds).toEqual([900, 1800, 2700, 3600])
  })

  it('honours a viewport override and the section cap', () => {
    expect(planSections(1440, 4000, 500).viewportHeight).toBe(500)
    expect(planSections(1440, 100_000).sections.length).toBeLessThanOrEqual(cfg.maxSections)
  })
})

function constantMap(width: number, height: number, value: number): ScalarMap {
  return { width, height, values: new Float32Array(width * height).fill(value) }
}

describe('B-2 — composition', () => {
  const sections: Section[] = planSections(1000, 3000, 1000).sections
  /** Attenuation disabled: these tests are about the cross-fade, not the decay. */
  const noDecay = { ...cfg, sectionAttenuation: 1, sectionAttenuationFloor: 1 }

  it('returns the single section unchanged when the frame is short', () => {
    const map = constantMap(10, 10, 0.5)
    expect(composeSections([{ section: { index: 0, y: 0, height: 100 }, map }], 100)).toBe(map)
  })

  it('reproduces a constant field exactly — no seams, no dark bands', () => {
    const scale = 0.5
    const parts = sections.map((section) => ({
      section,
      map: constantMap(64, Math.round(section.height * scale), 0.42),
    }))
    const composed = composeSections(parts, 3000, noDecay)

    expect(composed.width).toBe(64)
    expect(composed.height).toBe(1500)
    for (let i = 0; i < composed.values.length; i++) {
      expect(composed.values[i]).toBeCloseTo(0.42, 5)
    }
  })

  it('blends linearly across the overlap instead of stepping', () => {
    const scale = 0.5
    const parts = sections.map((section, index) => ({
      section,
      map: constantMap(8, Math.round(section.height * scale), index % 2 === 0 ? 0 : 1),
    }))
    const composed = composeSections(parts, 3000, noDecay)

    // Every row must sit inside the range of its contributors and the sequence
    // across the first overlap must be monotonic — a hard cut would jump.
    const column: number[] = []
    for (let y = 0; y < composed.height; y++) column.push(composed.values[y * 8])
    expect(Math.min(...column)).toBeGreaterThanOrEqual(0)
    expect(Math.max(...column)).toBeLessThanOrEqual(1)

    const overlapStart = Math.round(sections[1].y * scale)
    const overlapEnd = Math.round((sections[0].y + sections[0].height) * scale)
    const ramp = column.slice(overlapStart + 1, overlapEnd - 1)
    for (let i = 1; i < ramp.length; i++) expect(ramp[i]).toBeGreaterThanOrEqual(ramp[i - 1] - 1e-6)
  })
})

describe('B-2 — scroll-depth attenuation', () => {
  const sections: Section[] = planSections(1000, 3000, 1000).sections

  it('is 1 for the first section and non-increasing after it', () => {
    expect(sectionAttenuation(0)).toBe(1)
    for (let i = 1; i < 10; i++) {
      expect(sectionAttenuation(i)).toBeLessThanOrEqual(sectionAttenuation(i - 1))
    }
  })

  it('halves per section until it reaches the floor', () => {
    expect(sectionAttenuation(1)).toBeCloseTo(cfg.sectionAttenuation, 10)
    expect(sectionAttenuation(2)).toBeCloseTo(cfg.sectionAttenuation ** 2, 10)
  })

  it('never falls below the floor, so a deep section fades rather than vanishes', () => {
    for (let i = 0; i < 30; i++) expect(sectionAttenuation(i)).toBeGreaterThanOrEqual(cfg.sectionAttenuationFloor)
    expect(sectionAttenuation(20)).toBe(cfg.sectionAttenuationFloor)
  })

  it('turns a constant field into a decaying staircase, not a flat field', () => {
    const scale = 0.5
    const parts = sections.map((section) => ({
      section,
      map: constantMap(8, Math.round(section.height * scale), 1),
    }))
    const composed = composeSections(parts, 3000)
    const top = composed.values[0]
    const bottom = composed.values[composed.values.length - 1]
    expect(bottom).toBeLessThan(top)
  })
})

import { describe, expect, it } from 'vitest'
import { turbo, turboCss, TURBO_STOPS } from '../colormap'

describe('turbo', () => {
  it('reproduces the stop values exactly', () => {
    for (const [t, r, g, b] of TURBO_STOPS) {
      expect(turbo(t)).toEqual([r, g, b])
    }
  })

  it('clamps out-of-range input to the end stops', () => {
    expect(turbo(-1)).toEqual(turbo(0))
    expect(turbo(2)).toEqual(turbo(1))
  })

  it('goes from cold blue-violet to hot red', () => {
    const [r0, g0, b0] = turbo(0)
    const [r1, , b1] = turbo(1)
    expect(b0).toBeGreaterThan(r0)
    expect(g0).toBeLessThan(b0)
    expect(r1).toBeGreaterThan(b1)
  })

  it('interpolates between stops', () => {
    const mid = turbo((TURBO_STOPS[0][0] + TURBO_STOPS[1][0]) / 2)
    for (let channel = 0; channel < 3; channel++) {
      const low = Math.min(TURBO_STOPS[0][channel + 1], TURBO_STOPS[1][channel + 1])
      const high = Math.max(TURBO_STOPS[0][channel + 1], TURBO_STOPS[1][channel + 1])
      expect(mid[channel]).toBeGreaterThanOrEqual(low)
      expect(mid[channel]).toBeLessThanOrEqual(high)
    }
  })

  it('has strictly increasing stop positions from 0 to 1', () => {
    expect(TURBO_STOPS[0][0]).toBe(0)
    expect(TURBO_STOPS[TURBO_STOPS.length - 1][0]).toBe(1)
    for (let i = 1; i < TURBO_STOPS.length; i++) {
      expect(TURBO_STOPS[i][0]).toBeGreaterThan(TURBO_STOPS[i - 1][0])
    }
  })

  it('formats CSS colours', () => {
    expect(turboCss(0)).toBe('rgb(48, 18, 59)')
  })
})

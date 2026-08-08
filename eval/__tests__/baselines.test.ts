/**
 * A-4 — the parts of the baseline machinery that decide a verdict.
 *
 * These are small functions, but `bestOfSweep` and `spatialProfile` feed the
 * S-2 statement directly: getting the direction of a metric wrong here would
 * flip a conclusion without breaking anything visible.
 */
import { describe, expect, it } from 'vitest'
import type { ScalarMap } from '../../src/engine/types'
import { centerBiasMap } from '../predictors'
import { bestOfSweep, meanProfile, spatialProfile, type SigmaSweepEntry } from '../runner'
import type { MetricScores } from '../metrics/types'

function scores(aucJudd: number, cc: number, nss: number, kl: number): MetricScores {
  return { aucJudd, cc, nss, kl }
}

describe('bestOfSweep', () => {
  const sweep: SigmaSweepEntry[] = [
    { sigma: 0.2, mean: scores(0.59, 0.075, 0.21, 1.94) },
    { sigma: 0.45, mean: scores(0.59, 0.114, 0.31, 1.62) },
    { sigma: 0.8, mean: scores(0.59, 0.119, 0.32, 1.65) },
  ]

  it('takes the highest value for the three "higher is better" metrics', () => {
    const best = bestOfSweep(sweep)
    expect(best.aucJudd).toBe(0.59)
    expect(best.cc).toBe(0.119)
    expect(best.nss).toBe(0.32)
  })

  it('takes the LOWEST value for KL, where lower is better', () => {
    // The whole point of the sweep: the verdict must face the strongest
    // baseline per metric, and for KL that is the smallest number.
    expect(bestOfSweep(sweep).kl).toBe(1.62)
  })

  it('ignores non-finite entries', () => {
    expect(bestOfSweep([{ sigma: 1, mean: scores(Number.NaN, 0.2, 0.3, 1) }]).cc).toBe(0.2)
  })
})

describe('spatialProfile', () => {
  const W = 40
  const H = 40

  function withMass(cells: Array<[number, number]>): ScalarMap {
    const values = new Float32Array(W * H)
    for (const [x, y] of cells) values[y * W + x] = 1
    return { width: W, height: H, values }
  }

  it('puts a symmetric map in the centre', () => {
    const profile = spatialProfile(centerBiasMap(W, H, 0.3))
    expect(profile.centerX).toBeCloseTo(0.5, 3)
    expect(profile.centerY).toBeCloseTo(0.5, 3)
  })

  it('reports the top-left corner as top-left', () => {
    // (0,0) must be top-left, not bottom-left — an inverted y would make the
    // whole position-bias section say the opposite of the truth.
    const profile = spatialProfile(withMass([[2, 2]]))
    expect(profile.centerX).toBeLessThan(0.2)
    expect(profile.centerY).toBeLessThan(0.2)
    expect(profile.topThird).toBe(1)
  })

  it('measures the share of mass in the top third', () => {
    // Two cells in the top third, two below it.
    const profile = spatialProfile(withMass([[5, 2], [10, 5], [5, 25], [10, 30]]))
    expect(profile.topThird).toBeCloseTo(0.5, 6)
  })

  it('reports a wider spread for scattered mass than for concentrated mass', () => {
    const tight = spatialProfile(withMass([[20, 20], [21, 20]]))
    const wide = spatialProfile(withMass([[2, 20], [38, 20]]))
    expect(wide.spreadX).toBeGreaterThan(tight.spreadX)
  })

  it('falls back to the centre for an empty map', () => {
    expect(spatialProfile(withMass([]))).toEqual({ centerX: 0.5, centerY: 0.5, spreadX: 0, spreadY: 0, topThird: 0 })
  })
})

describe('meanProfile', () => {
  it('averages each component', () => {
    const a = { centerX: 0.2, centerY: 0.4, spreadX: 0.1, spreadY: 0.2, topThird: 0.6 }
    const b = { centerX: 0.4, centerY: 0.6, spreadX: 0.3, spreadY: 0.4, topThird: 0.8 }
    const mean = meanProfile([a, b])
    expect(mean.centerX).toBeCloseTo(0.3, 10)
    expect(mean.centerY).toBeCloseTo(0.5, 10)
    expect(mean.spreadX).toBeCloseTo(0.2, 10)
    expect(mean.spreadY).toBeCloseTo(0.3, 10)
    expect(mean.topThird).toBeCloseTo(0.7, 10)
  })

  it('handles an empty list without dividing by zero', () => {
    expect(meanProfile([]).centerX).toBe(0.5)
  })
})

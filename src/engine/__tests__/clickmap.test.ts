import { describe, expect, it } from 'vitest'
import { ENGINE_CONFIG } from '../config'
import { findCandidates, scoreCandidates } from '../clickmap'
import type { ScalarMap } from '../types'
import { makeSignal } from './helpers'

const FRAME = { width: 400, height: 800 }

function flatAttention(value = 0.5): ScalarMap {
  const width = 40
  const height = 80
  return { width, height, values: new Float32Array(width * height).fill(value) }
}

describe('findCandidates', () => {
  it('accepts nodes with prototype reactions', () => {
    const node = makeSignal({ hasReactions: true, width: 120, height: 48 })
    expect(findCandidates([node], FRAME.width, FRAME.height).map((c) => c.id)).toEqual([node.id])
  })

  it('accepts nodes whose name matches an interactive keyword', () => {
    const node = makeSignal({ nameHints: ['button'], width: 120, height: 48 })
    expect(findCandidates([node], FRAME.width, FRAME.height)).toHaveLength(1)
  })

  it('accepts a short label inside a filled container', () => {
    const container = makeSignal({ hasFill: true, width: 140, height: 48, x: 10, y: 10 })
    const label = makeSignal({
      isText: true,
      charCount: 8,
      hasFill: false,
      parentId: container.id,
      x: 20,
      y: 20,
      width: 100,
      height: 24,
    })
    const found = findCandidates([container, label], FRAME.width, FRAME.height)
    // The container itself carries neither a reaction nor a keyword name, so
    // only the label qualifies — via the button heuristic.
    expect(found.map((c) => c.id)).toEqual([label.id])
  })

  it('rejects long text even inside a filled container', () => {
    const container = makeSignal({ hasFill: true, width: 300, height: 100 })
    const paragraph = makeSignal({
      isText: true,
      charCount: ENGINE_CONFIG.clickmap.maxTextCharsForButton + 5,
      parentId: container.id,
      width: 280,
      height: 80,
    })
    expect(findCandidates([container, paragraph], FRAME.width, FRAME.height)).toHaveLength(0)
  })

  it('rejects tiny nodes and full-bleed backdrops', () => {
    const tiny = makeSignal({ nameHints: ['btn'], width: 4, height: 4 })
    const backdrop = makeSignal({ nameHints: ['card'], width: FRAME.width, height: FRAME.height })
    expect(findCandidates([tiny, backdrop], FRAME.width, FRAME.height)).toHaveLength(0)
  })

  it('keeps the outer button and drops its nested keyword children', () => {
    const outer = makeSignal({ nameHints: ['button'], x: 0, y: 0, width: 200, height: 60 })
    const inner = makeSignal({ nameHints: ['button'], x: 10, y: 10, width: 100, height: 30 })
    const found = findCandidates([outer, inner], FRAME.width, FRAME.height)
    expect(found.map((c) => c.id)).toEqual([outer.id])
  })
})

describe('scoreCandidates', () => {
  it('returns nothing when no element looks interactive', () => {
    expect(scoreCandidates([makeSignal()], flatAttention(), FRAME.width, FRAME.height)).toEqual([])
  })

  it('normalises scores to sum 1', () => {
    const signals = [
      makeSignal({ hasReactions: true, width: 120, height: 48, x: 10, y: 10 }),
      makeSignal({ nameHints: ['link'], width: 120, height: 48, x: 10, y: 200 }),
      makeSignal({ nameHints: ['tab'], width: 120, height: 48, x: 10, y: 400 }),
    ]
    const scored = scoreCandidates(signals, flatAttention(), FRAME.width, FRAME.height)
    const total = scored.reduce((sum, candidate) => sum + candidate.score, 0)
    expect(total).toBeCloseTo(1, 6)
  })

  it('ranks a real prototype hotspot above an equally sized keyword match', () => {
    const hotspot = makeSignal({ name: 'Weiter', hasReactions: true, width: 120, height: 48, x: 10, y: 10 })
    const named = makeSignal({ name: 'Card', nameHints: ['card'], width: 120, height: 48, x: 10, y: 200 })
    const scored = scoreCandidates([hotspot, named], flatAttention(), FRAME.width, FRAME.height)
    expect(scored[0].id).toBe(hotspot.id)
    expect(scored[0].score).toBeGreaterThan(scored[1].score)
  })

  it('rewards elements sitting in a hot region', () => {
    const attention = flatAttention(0)
    // Heat only in the top-left quarter of the analysis grid.
    for (let y = 0; y < 20; y++) {
      for (let x = 0; x < 20; x++) attention.values[y * attention.width + x] = 1
    }
    const hot = makeSignal({ nameHints: ['button'], x: 10, y: 10, width: 120, height: 48 })
    const cold = makeSignal({ nameHints: ['button'], x: 10, y: 600, width: 120, height: 48 })
    const scored = scoreCandidates([hot, cold], attention, FRAME.width, FRAME.height)
    expect(scored[0].id).toBe(hot.id)
    expect(scored[0].parts.attention).toBeGreaterThan(scored[1].parts.attention)
  })

  it('caps the number of reported candidates', () => {
    const many = Array.from({ length: ENGINE_CONFIG.clickmap.maxCandidates + 6 }, (_, i) =>
      makeSignal({ nameHints: ['chip'], x: 0, y: i * 50, width: 80, height: 40 }),
    )
    const scored = scoreCandidates(many, flatAttention(), FRAME.width, FRAME.height)
    expect(scored).toHaveLength(ENGINE_CONFIG.clickmap.maxCandidates)
    expect(scored.reduce((sum, c) => sum + c.score, 0)).toBeCloseTo(1, 6)
  })

  it('is deterministic for identical input', () => {
    const signals = [
      makeSignal({ nameHints: ['button'], x: 0, y: 0, width: 100, height: 40 }),
      makeSignal({ nameHints: ['button'], x: 0, y: 100, width: 100, height: 40 }),
    ]
    const a = scoreCandidates(signals, flatAttention(), FRAME.width, FRAME.height)
    const b = scoreCandidates(signals, flatAttention(), FRAME.width, FRAME.height)
    expect(a.map((c) => c.id)).toEqual(b.map((c) => c.id))
  })
})

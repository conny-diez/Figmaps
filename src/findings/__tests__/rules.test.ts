/**
 * Epic C acceptance — every rule against constructed inputs (C-1), plus the
 * language rules of C-2 enforced mechanically over the produced texts.
 */
import { describe, expect, it } from 'vitest'
import type { ClickCandidate } from '../../engine/clickmap'
import { ENGINE_CONFIG } from '../../engine/config'
import { planSections, type SegmentPlan } from '../../engine/segments'
import type { ScalarMap } from '../../engine/types'
import { makeSignal } from '../../engine/__tests__/helpers'
import type { NodeSignal } from '../../messages'
import { collectFindings } from '../index'
import { evaluateRule, formatPercent } from '../rules'
import type { FindingsInput } from '../types'

const FRAME = { width: 1000, height: 800 }
const MAP_W = 100
const MAP_H = 80

function flatMap(value = 0.5): ScalarMap {
  return { width: MAP_W, height: MAP_H, values: new Float32Array(MAP_W * MAP_H).fill(value) }
}

/** A map with an explicit hotspot, so every threshold in the rules is reachable. */
function mapWithSpots(spots: Array<{ x: number; y: number; value: number; radius?: number }>): ScalarMap {
  const values = new Float32Array(MAP_W * MAP_H).fill(0.05)
  for (const spot of spots) {
    const radius = spot.radius ?? 4
    for (let y = spot.y - radius; y <= spot.y + radius; y++) {
      for (let x = spot.x - radius; x <= spot.x + radius; x++) {
        if (x < 0 || y < 0 || x >= MAP_W || y >= MAP_H) continue
        values[y * MAP_W + x] = spot.value
      }
    }
  }
  return { width: MAP_W, height: MAP_H, values }
}

function candidate(overrides: Partial<ClickCandidate> = {}): ClickCandidate {
  return {
    id: `c:${overrides.name ?? 'x'}`,
    name: 'Alle Angebote',
    kind: 'keyword',
    x: 100,
    y: 100,
    width: 200,
    height: 60,
    score: 0.3,
    parts: { attention: 0.3, reaction: 0.4, size: 0.5 },
    ...overrides,
  }
}

function input(overrides: Partial<FindingsInput> = {}): FindingsInput {
  const plan: SegmentPlan = planSections(FRAME.width, FRAME.height)
  return {
    attention: flatMap(),
    sectionSalience: [1],
    candidates: [],
    signals: [],
    plan,
    frameWidth: FRAME.width,
    frameHeight: FRAME.height,
    priorCategory: 'web',
    ...overrides,
  }
}

describe('cta-rank', () => {
  it('fires when the primary candidate is not ranked first', () => {
    const finding = evaluateRule(
      'cta-rank',
      input({
        candidates: [
          candidate({ id: 'a', name: 'Alle Angebote' }),
          candidate({ id: 'b', name: 'Mehr erfahren' }),
          candidate({ id: 'c', name: 'Jetzt anfragen CTA' }),
        ],
      }),
    )
    expect(finding).not.toBeNull()
    expect(finding?.text).toContain('Rang 3')
    expect(finding?.text).toContain('Alle Angebote')
    expect(finding?.nodeIds).toEqual(['c', 'a'])
  })

  it('stays silent when the primary candidate leads', () => {
    expect(
      evaluateRule('cta-rank', input({ candidates: [candidate({ name: 'Primary CTA' }), candidate()] })),
    ).toBeNull()
  })

  it('stays silent when no candidate looks primary', () => {
    expect(evaluateRule('cta-rank', input({ candidates: [candidate(), candidate({ name: 'Mehr' })] }))).toBeNull()
  })
})

describe('cta-below-fold', () => {
  const tall = planSections(1440, 4000)

  it('fires when the strongest candidate sits below fold 1', () => {
    const finding = evaluateRule(
      'cta-below-fold',
      input({ plan: tall, frameWidth: 1440, frameHeight: 4000, candidates: [candidate({ id: 'deep', y: 2400 })] }),
    )
    expect(finding?.id).toBe('cta-below-fold')
    expect(finding?.nodeIds).toEqual(['deep'])
  })

  it('stays silent above the fold and on unsegmented frames', () => {
    expect(
      evaluateRule('cta-below-fold', input({ plan: tall, frameHeight: 4000, candidates: [candidate({ y: 100 })] })),
    ).toBeNull()
    expect(evaluateRule('cta-below-fold', input({ candidates: [candidate({ y: 700 })] }))).toBeNull()
  })
})

describe('competition', () => {
  const signals: NodeSignal[] = [
    makeSignal({ id: 'headline', name: 'Headline', x: 100, y: 100, width: 200, height: 100 }),
    makeSignal({ id: 'hero', name: 'Hero-Bild', x: 700, y: 100, width: 200, height: 100 }),
  ]

  it('fires for two far-apart peaks and names them', () => {
    const finding = evaluateRule(
      'competition',
      input({ attention: mapWithSpots([{ x: 20, y: 15, value: 1 }, { x: 80, y: 15, value: 0.95 }]), signals }),
    )
    expect(finding?.id).toBe('competition')
    expect(finding?.text).toContain('Headline')
    expect(finding?.text).toContain('Hero-Bild')
    expect(finding?.nodeIds).toEqual(['headline', 'hero'])
  })

  it('stays silent when the peaks are close together', () => {
    expect(
      evaluateRule('competition', input({ attention: mapWithSpots([{ x: 40, y: 15, value: 1 }, { x: 48, y: 15, value: 0.95 }]) })),
    ).toBeNull()
  })

  it('stays silent when the second region is not intense enough', () => {
    expect(
      evaluateRule('competition', input({ attention: mapWithSpots([{ x: 20, y: 15, value: 1 }, { x: 80, y: 15, value: 0.4 }]) })),
    ).toBeNull()
  })
})

describe('cold-fold', () => {
  const tall = planSections(1440, 4000)

  it('fires when a later section concentrates attention more than the first', () => {
    const finding = evaluateRule('cold-fold', input({ plan: tall, sectionSalience: [0.16, 0.16, 0.19, 0.15] }))
    expect(finding?.text).toContain('Abschnitt 3')
  })

  it('stays silent when the first section is the strongest', () => {
    expect(evaluateRule('cold-fold', input({ plan: tall, sectionSalience: [0.19, 0.16, 0.15] }))).toBeNull()
  })

  it('stays silent inside the relative margin', () => {
    const margin = ENGINE_CONFIG.findings.coldFoldMargin
    expect(evaluateRule('cold-fold', input({ plan: tall, sectionSalience: [0.16, 0.16 * (1 + margin / 2)] }))).toBeNull()
  })

  it('fires just past the relative margin', () => {
    const margin = ENGINE_CONFIG.findings.coldFoldMargin
    expect(evaluateRule('cold-fold', input({ plan: tall, sectionSalience: [0.16, 0.16 * (1 + margin * 1.5)] }))).not.toBeNull()
  })

  it('works on the concentration range the engine actually produces', () => {
    // Measured on a synthetic 1440x4000 page: featureless sections land at
    // 0.163, a section with a strong eye-catcher at 0.182.
    expect(evaluateRule('cold-fold', input({ plan: tall, sectionSalience: [0.163, 0.163, 0.163, 0.153, 0.168, 0.182] })))
      .not.toBeNull()
    expect(evaluateRule('cold-fold', input({ plan: tall, sectionSalience: new Array(6).fill(0.163) as number[] })))
      .toBeNull()
  })
})

describe('flat', () => {
  it('fires on a constant map', () => {
    expect(evaluateRule('flat', input({ attention: flatMap(0.4) }))?.id).toBe('flat')
  })

  it('stays silent when there is a clear peak', () => {
    // `flat` measures concentration: the share of mass in the strongest 5 %.
    // A ramp^4 puts 0.226 there, comfortably above the web threshold of 0.086.
    const values = new Float32Array(MAP_W * MAP_H)
    for (let i = 0; i < values.length; i++) values[i] = (i / values.length) ** 4
    const spread = { width: MAP_W, height: MAP_H, values }
    expect(evaluateRule('flat', input({ attention: spread }))).toBeNull()
  })
})

describe('dead-cta', () => {
  it('fires for a candidate far quieter than its peers', () => {
    const attention = mapWithSpots([{ x: 80, y: 60, value: 1, radius: 15 }])
    const finding = evaluateRule(
      'dead-cta',
      input({
        attention,
        candidates: [
          // Sits on the hotspot.
          candidate({ id: 'hot', name: 'Jetzt starten', x: 750, y: 550, width: 150, height: 100 }),
          // Sits in the dark corner.
          candidate({ id: 'cold', name: 'Jetzt anfragen', x: 50, y: 50, width: 150, height: 100 }),
        ],
      }),
    )
    expect(finding?.text).toContain('Jetzt anfragen')
    // Both ends of the comparison are named in the sentence, so both are
    // revealable in the canvas — the finding is a statement about a *pair*.
    expect(finding?.nodeIds).toEqual(['cold', 'hot'])
    expect(finding?.text).toContain('stärksten Schaltfläche')
    expect(finding?.text).toContain('Bildschirmausschnitt')
  })

  it('stays silent when the candidates are comparably lively', () => {
    const attention = mapWithSpots([{ x: 50, y: 40, value: 1, radius: 30 }])
    expect(
      evaluateRule(
        'dead-cta',
        input({
          attention,
          candidates: [
            candidate({ id: 'a', x: 400, y: 300, width: 150, height: 100 }),
            candidate({ id: 'b', x: 550, y: 400, width: 150, height: 100 }),
          ],
        }),
      ),
    ).toBeNull()
  })

  it('stays silent with a single candidate — "quieter than the others" is empty', () => {
    const attention = mapWithSpots([{ x: 80, y: 60, value: 1, radius: 15 }])
    expect(evaluateRule('dead-cta', input({ attention, candidates: [candidate({ x: 50, y: 50 })] }))).toBeNull()
  })
})

describe('collectFindings', () => {
  it('sorts by severity and caps the list', () => {
    const tall = planSections(1440, 4000)
    const findings = collectFindings(
      input({
        plan: tall,
        frameWidth: 1440,
        frameHeight: 4000,
        attention: flatMap(0.5),
        sectionSalience: [0.4, 0.9, 0.5],
        signals: [makeSignal({ id: 'x', name: 'Headline' })],
        candidates: [
          candidate({ id: 'a', name: 'Alle Angebote', y: 2400 }),
          candidate({ id: 'b', name: 'Jetzt anfragen CTA', y: 2600 }),
        ],
      }),
    )

    expect(findings.length).toBeGreaterThan(0)
    expect(findings.length).toBeLessThanOrEqual(ENGINE_CONFIG.findings.maxShown)
    const order = findings.map((finding) => finding.severity)
    const rank = { problem: 2, attention: 1, info: 0 } as const
    for (let i = 1; i < order.length; i++) expect(rank[order[i]]).toBeLessThanOrEqual(rank[order[i - 1]])
  })

  it('returns nothing for an unremarkable screen', () => {
    // One clear focus, one candidate, not segmented: nothing to report.
    const values = new Float32Array(MAP_W * MAP_H)
    for (let i = 0; i < values.length; i++) values[i] = ((i % MAP_W) / MAP_W) ** 4
    const findings = collectFindings(
      input({
        attention: { width: MAP_W, height: MAP_H, values },
        candidates: [candidate({ name: 'Primary CTA', x: 850, y: 100, width: 120, height: 48 })],
      }),
    )
    expect(findings).toEqual([])
  })
})

describe('C-2 — language rules', () => {
  const tall = planSections(1440, 4000)
  const everything = collectFindings(
    input({
      plan: tall,
      frameWidth: 1440,
      frameHeight: 4000,
      attention: flatMap(0.5),
      sectionSalience: [0.3, 0.95],
      signals: [makeSignal({ id: 'x', name: 'Headline' })],
      candidates: [candidate({ id: 'a', name: 'Alle Angebote', y: 2400 }), candidate({ id: 'b', name: 'CTA', y: 2600 })],
    }),
  )

  it('produces findings to check', () => {
    expect(everything.length).toBeGreaterThanOrEqual(3)
  })

  it('uses no exclamation marks, emoji or overall scores', () => {
    for (const finding of everything) {
      expect(finding.text).not.toMatch(/!/)
      expect(finding.text).not.toMatch(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u)
      expect(finding.text).not.toMatch(/\bScore\b/i)
      expect(finding.text).not.toMatch(/\d+\s*\/\s*100/)
    }
  })

  it('never prescribes and never claims observation', () => {
    for (const finding of everything) {
      expect(finding.text).not.toMatch(/sollte|müsste|empfehl|besser wäre/i)
      expect(finding.text).not.toMatch(/Nutzer sehen|Nutzer schauen|Anwender sehen/i)
    }
  })

  it('keeps percentages at one decimal place at most', () => {
    expect(formatPercent(0.5)).toBe('50 %')
    expect(formatPercent(0.12345)).toBe('12,3 %')
    for (const finding of everything) {
      const percents = finding.text.match(/\d+[.,]\d+\s*%/g) ?? []
      for (const value of percents) expect(value).toMatch(/\d+[.,]\d\s*%/)
    }
  })

  it('is a single sentence per finding', () => {
    for (const finding of everything) {
      expect(finding.text.trim().endsWith('.')).toBe(true)
      expect(finding.text.split(/\.\s/).length).toBe(1)
    }
  })
})

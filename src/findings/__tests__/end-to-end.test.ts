/**
 * Epic C — end-to-end reachability of every rule.
 *
 * WHY THIS FILE EXISTS: `cold-fold` was inert from the day it was written and
 * every unit test in `rules.test.ts` was green. Those tests call the rule with
 * hand-built input; the pipeline fed it something structurally different (peaks
 * that are 1.0 by construction). The rule was correct and unreachable.
 *
 * So these tests do not call rules. They build a frame, run the **real**
 * analysis (`analyzeFrame` with real `ImageOps`), the **real** candidate
 * scoring, and the **real** `deriveFindings` — the same function the iframe
 * pipeline calls — and then check which findings came out.
 *
 * Every rule gets two: one frame where it must fire, one where it must not.
 * A rule that cannot be made to fire here is not shipped, it is decoration.
 *
 * Die Fälle selbst stehen seit 1.2 in `scenarios.ts`, weil
 * `robustness.test.ts` dieselben noch einmal unter verstellten
 * Engine-Parametern durchlaufen lässt. Zwei Kopien wären zwei Definitionen
 * dessen, was „der Fall" ist.
 */
import { describe, expect, it } from 'vitest'
import { ALL_RULES, RULES } from '../rules'
import { runScenario } from './run-scenario'
import { SCENARIOS } from './scenarios'

describe('end-to-end reachability of every rule', () => {
  it('every implemented rule is covered by both a firing and a silent case', () => {
    // Guards against a rule being added without a reachability test.
    expect(ALL_RULES.map((rule) => rule.id).sort()).toEqual(
      ['cold-fold', 'competition', 'cta-below-fold', 'cta-rank', 'dead-cta', 'flat'].sort(),
    )
    for (const rule of ALL_RULES) {
      const own = SCENARIOS.filter((scenario) => scenario.rule === rule.id)
      expect(own.map((scenario) => scenario.expect).sort()).toEqual(['fires', 'silent'])
    }
  })

  it('does not ship `flat` — its threshold sits below the whole realistic range', () => {
    // The decision quantity answers "how small is the strongest spot", not "how
    // clear is the hierarchy": a large eye-catcher scores 0,137, none at all
    // 0,123. The shipped threshold (web 0,086) is below the realistic range
    // 0,103–0,220 entirely, so the rule fires only on a near-empty screen. See
    // `rules.ts` for both sweeps.
    expect(RULES.map((rule) => rule.id)).not.toContain('flat')
  })

  it('does not ship `cta-below-fold` — it is structurally blocked', () => {
    // Top-heavy prior plus `sectionAttenuation^i`: a candidate below the fold
    // starts at half the attention of one above it, so `candidates[0]` is
    // almost never below the fold. 0 of 24 constructed frames. The attenuation
    // is deliberately *not* adjusted to make the rule fire.
    expect(RULES.map((rule) => rule.id)).not.toContain('cta-below-fold')
  })

  it('does not ship `dead-cta` — its threshold is not backed by a measurement', () => {
    // 24 of 24 in each of three constructed frame shapes, in the redefined
    // form too: the quantity is a minimum over N candidates and falls with N,
    // so no single constant is selective across frame shapes. See `rules.ts`.
    expect(RULES.map((rule) => rule.id)).not.toContain('dead-cta')
  })

  for (const scenario of SCENARIOS) {
    it(scenario.id, async () => {
      const ids = await runScenario(scenario.build())
      if (scenario.expect === 'fires') expect(ids).toContain(scenario.rule)
      else expect(ids).not.toContain(scenario.rule)
    })
  }
})

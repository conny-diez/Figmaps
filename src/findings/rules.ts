/**
 * Epic C — the rule set.
 *
 * Every rule is deterministic, reads its thresholds from
 * `ENGINE_CONFIG.findings` and returns at most one finding. The wording follows
 * C-2 without exception:
 *
 *   - describe what was measured, never prescribe what to do
 *     ("liegt auf Rang 3", not "sollte prominenter sein")
 *   - always in prediction mode ("vorhergesagt", "voraussichtlich"),
 *     never "Nutzer sehen"
 *   - at most one decimal place in any percentage
 *   - no exclamation marks, no warning emoji, no overall 0–100 score
 *
 * Changing a text here changes the product. Texts are signed off by a human.
 */
import type { ClickCandidate } from '../engine/clickmap'
import { ENGINE_CONFIG } from '../engine/config'
import { meanInRect } from '../engine/imageops'
import { sectionSalience } from '../engine/segments'
import { signalRect } from '../engine/features/structure'
import type { NodeSignal } from '../messages'
import type { Finding, FindingsInput, Rule } from './types'

const cfg = ENGINE_CONFIG.findings

/** German typographic quotes, as used throughout the panel. */
function quote(text: string): string {
  return `‚${text}‘`
}

/** Rounds to one decimal and drops a trailing ",0" — C-2 forbids false precision. */
export function formatPercent(share: number): string {
  const value = Math.round(share * 1000) / 10
  return `${Number.isInteger(value) ? value : value.toFixed(1).replace('.', ',')} %`
}

/** Frame pixels -> composed-map pixels. */
function mapScale(input: FindingsInput): number {
  return input.attention.width / input.frameWidth
}

function candidateRect(candidate: ClickCandidate, input: FindingsInput) {
  const scale = mapScale(input)
  return {
    x: candidate.x * scale,
    y: candidate.y * scale,
    width: Math.max(1, candidate.width * scale),
    height: Math.max(1, candidate.height * scale),
  }
}

/** True when a candidate reads as the primary call to action of the screen. */
export function isPrimaryCandidate(candidate: ClickCandidate): boolean {
  const name = candidate.name.toLowerCase()
  return cfg.primaryKeywords.some((keyword) => name.includes(keyword))
}

/** Name of the smallest node covering a point on the composed map, if any. */
function labelAt(input: FindingsInput, x: number, y: number): NodeSignal | null {
  let best: NodeSignal | null = null
  let bestArea = Infinity
  for (const signal of input.signals) {
    const rect = signalRect(signal, input.frameWidth, input.frameHeight, input.attention.width, input.attention.height)
    if (x < rect.x || x >= rect.x + rect.width || y < rect.y || y >= rect.y + rect.height) continue
    const area = rect.width * rect.height
    if (area < bestArea) {
      bestArea = area
      best = signal
    }
  }
  return best
}

/** Index of the strongest map pixel, ties resolved to the lowest index. */
function argmax(values: Float32Array, predicate?: (index: number) => boolean): number {
  let best = -1
  for (let i = 0; i < values.length; i++) {
    if (predicate && !predicate(i)) continue
    if (best < 0 || values[i] > values[best]) best = i
  }
  return best
}

/**
 * True when the straight path between two peaks drops clearly below the
 * hotspot threshold somewhere — i.e. they are two regions, not one band.
 */
function hasValleyBetween(
  map: { width: number; values: Float32Array },
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  secondPeak: number,
): boolean {
  const steps = Math.max(Math.abs(x2 - x1), Math.abs(y2 - y1))
  if (steps <= 0) return false
  // Relative to the weaker of the two peaks — see `competitionValleyRatio`.
  const valley = secondPeak * cfg.competitionValleyRatio

  for (let step = 1; step < steps; step++) {
    const t = step / steps
    const x = Math.round(x1 + (x2 - x1) * t)
    const y = Math.round(y1 + (y2 - y1) * t)
    if (map.values[y * map.width + x] < valley) return true
  }
  return false
}

// ---------------------------------------------------------------------------
// Rules
// ---------------------------------------------------------------------------

/** The primary call to action is not the strongest predicted click target. */
const ctaRank: Rule = {
  id: 'cta-rank',
  evaluate(input) {
    const primaryIndex = input.candidates.findIndex(isPrimaryCandidate)
    if (primaryIndex < 0) return null

    const rank = primaryIndex + 1
    if (rank <= cfg.ctaRankThreshold) return null

    const primary = input.candidates[primaryIndex]
    const leader = input.candidates[0]
    return {
      id: 'cta-rank',
      severity: 'problem',
      text: `${quote(primary.name)} liegt auf Rang ${rank} der vorhergesagten Klicks — Rang 1 hat ${quote(leader.name)}.`,
      nodeIds: [primary.id, leader.id],
    }
  },
}

/** The strongest predicted click target sits below the first fold. */
const ctaBelowFold: Rule = {
  id: 'cta-below-fold',
  evaluate(input) {
    if (input.plan.folds.length === 0) return null
    const leader = input.candidates[0]
    if (!leader) return null

    const firstFold = input.plan.folds[0]
    if (leader.y < firstFold) return null

    return {
      id: 'cta-below-fold',
      severity: 'problem',
      text: `Das interaktive Element mit der höchsten vorhergesagten Klickwahrscheinlichkeit, ${quote(leader.name)}, liegt unterhalb des ersten Folds.`,
      nodeIds: [leader.id],
    }
  },
}

/** Two far-apart regions both reach near-maximum predicted attention. */
const competition: Rule = {
  id: 'competition',
  evaluate(input) {
    const { attention } = input
    const first = argmax(attention.values)
    if (first < 0 || attention.values[first] < cfg.competitionIntensity) return null

    const x1 = first % attention.width
    const y1 = Math.floor(first / attention.width)
    const minDistance = cfg.competitionMinDistance * attention.width

    const second = argmax(attention.values, (index) => {
      const dx = (index % attention.width) - x1
      const dy = Math.floor(index / attention.width) - y1
      return Math.sqrt(dx * dx + dy * dy) > minDistance
    })
    if (second < 0 || attention.values[second] < cfg.competitionIntensity) return null

    const x2 = second % attention.width
    const y2 = Math.floor(second / attention.width)

    // Two peaks inside one continuous bright band are one region, not two
    // competitors — require the connecting path to dip.
    if (!hasValleyBetween(attention, x1, y1, x2, y2, attention.values[second])) return null

    const a = labelAt(input, x1, y1)
    const b = labelAt(input, x2, y2)

    const named = a && b && a.id !== b.id
    return {
      id: 'competition',
      severity: 'attention',
      text: named
        ? `${quote(a.name)} und ${quote(b.name)} erreichen beide die vorhergesagte Spitzenaufmerksamkeit und liegen weit auseinander.`
        : 'Zwei weit auseinanderliegende Bereiche erreichen beide die vorhergesagte Spitzenaufmerksamkeit.',
      nodeIds: named ? [a.id, b.id] : undefined,
    }
  },
}

/** A later section peaks higher than the section every user sees. */
const coldFold: Rule = {
  id: 'cold-fold',
  evaluate(input) {
    if (!input.plan.segmented || input.sectionSalience.length < 2) return null

    const aboveFold = input.sectionSalience[0]
    let bestIndex = 0
    for (let i = 1; i < input.sectionSalience.length; i++) {
      if (input.sectionSalience[i] > input.sectionSalience[bestIndex]) bestIndex = i
    }
    if (bestIndex === 0) return null
    // Relative: the concentration measure lives in a narrow band, so an
    // absolute margin would either never fire or fire always.
    if (!(aboveFold > 0)) return null
    if (input.sectionSalience[bestIndex] / aboveFold - 1 < cfg.coldFoldMargin) return null

    return {
      id: 'cold-fold',
      severity: 'problem',
      text: `Die Aufmerksamkeit bündelt sich in Abschnitt ${bestIndex + 1} deutlich stärker als im ersten sichtbaren Bereich.`,
    }
  },
}

/** Attention is spread evenly — the screen predicts no hierarchy. */
const flat: Rule = {
  id: 'flat',
  evaluate(input) {
    // Concentration, not the p90-p50 spread. The spread depends on the map's
    // overall contrast, which differs systematically between UI types: on the
    // same threshold it fired on 11 % of webpages and 90 % of mobile screens.
    // The share of mass in the strongest pixels is scale-free and transfers.
    const threshold = cfg.flatConcentrationThreshold[input.priorCategory] ?? cfg.flatConcentrationThreshold.web
    if (sectionSalience(input.attention) >= threshold) return null

    return {
      id: 'flat',
      severity: 'attention',
      text: 'Der Screen zeigt keine ausgeprägte visuelle Hierarchie — die vorhergesagte Aufmerksamkeit verteilt sich weitgehend gleichmäßig.',
    }
  },
}

/** An interactive element sits in the quietest quarter of the screen. */
const deadCta: Rule = {
  id: 'dead-cta',
  evaluate(input) {
    // At least two candidates: "quiet compared to the others" is meaningless
    // when there is only one.
    if (input.candidates.length < 2) return null

    const means = input.candidates.map((candidate) => ({
      candidate,
      mean: meanInRect(
        input.attention.values,
        input.attention.width,
        input.attention.height,
        candidateRect(candidate, input),
      ),
    }))
    const best = Math.max(...means.map((entry) => entry.mean))
    if (!(best > 0)) return null

    const cutoff = best * cfg.deadCtaRelativeToBest
    let worst: { candidate: ClickCandidate; mean: number } | null = null
    for (const entry of means) {
      if (entry.mean > cutoff) continue
      if (!worst || entry.mean < worst.mean) worst = entry
    }
    if (!worst) return null

    return {
      id: 'dead-cta',
      severity: 'attention',
      text: `${quote(worst.candidate.name)} liegt in einem visuell ruhigen Bereich — im untersten Viertel der vorhergesagten Aufmerksamkeit.`,
      nodeIds: [worst.candidate.id],
    }
  },
}

/** Evaluation order; ties in severity keep this order. */
export const RULES: readonly Rule[] = [ctaBelowFold, coldFold, ctaRank, deadCta, competition, flat]

export function evaluateRule(id: string, input: FindingsInput): Finding | null {
  const rule = RULES.find((entry) => entry.id === id)
  if (!rule) throw new Error(`Unbekannte Regel: ${id}`)
  return rule.evaluate(input)
}

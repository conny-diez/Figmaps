/**
 * Epic C — the data contract of the findings layer.
 *
 * Findings are deterministic statements about what was *measured* on the maps.
 * They are not advice, they carry no score, and they are written in plain
 * German (C-2). Both realms import this module, so it must stay free of
 * `figma.*` and of any DOM access.
 */
import type { ClickCandidate } from '../engine/clickmap'
import type { SegmentPlan } from '../engine/segments'
import type { ScalarMap } from '../engine/types'
import type { NodeSignal } from '../messages'

export type Severity = 'info' | 'attention' | 'problem'

export type Finding = {
  id: string
  severity: Severity
  /** One sentence, German, no jargon, no percentages beyond one decimal. */
  text: string
  /** Targets for "Im Canvas zeigen" (C-3). */
  nodeIds?: string[]
}

/** Higher sorts first. */
export const SEVERITY_ORDER: Record<Severity, number> = { problem: 2, attention: 1, info: 0 }

export const SEVERITY_LABELS: Record<Severity, string> = {
  problem: 'Auffällig',
  attention: 'Beachten',
  info: 'Hinweis',
}

export type FindingsInput = {
  /** Composed attention map over the whole frame. */
  attention: ScalarMap
  /** Per-section peak intensity, in section order (Epic B). */
  sectionPeaks: number[]
  /** Ranked click candidates, strongest first. */
  candidates: readonly ClickCandidate[]
  signals: readonly NodeSignal[]
  plan: SegmentPlan
  frameWidth: number
  frameHeight: number
}

/** A single rule. Returns at most one finding (C-1). */
export type Rule = {
  id: string
  evaluate(input: FindingsInput): Finding | null
}

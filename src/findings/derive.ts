/**
 * Epic C — the step from an analysis result to findings.
 *
 * This exists as its own function for one reason: `cold-fold` was inert from
 * the day it was written, and every unit test was green, because the tests
 * called the rule directly with hand-built input while the pipeline fed it
 * something else. A rule can only be trusted if the *wiring* is tested too, and
 * the wiring can only be tested if there is exactly one of it.
 *
 * The iframe pipeline and the end-to-end tests both go through here.
 */
import { scoreCandidates, type ClickCandidate } from '../engine/clickmap'
import type { AnalyzeResult } from '../engine/analyze'
import type { NodeSignal } from '../messages'
import { priorAssetIdFor } from '../engine/priors'
import { collectFindings } from './index'
import type { Finding, FindingsInput } from './types'

export type DeriveInput = {
  analysis: AnalyzeResult
  signals: readonly NodeSignal[]
  frameWidth: number
  frameHeight: number
  /** Which location prior was used; defaults to the geometric guess. */
  priorCategory?: string
  /** Reuses candidates already scored for the clickmap, to avoid doing it twice. */
  candidates?: readonly ClickCandidate[]
}

/** Assembles the rule input from an analysis result, exactly as shipped. */
export function findingsInputFor(input: DeriveInput): FindingsInput {
  const candidates =
    input.candidates ??
    scoreCandidates(input.signals, input.analysis.attention, input.frameWidth, input.frameHeight)

  return {
    attention: input.analysis.attention,
    sectionSalience: input.analysis.sectionSalience,
    candidates,
    signals: input.signals,
    plan: input.analysis.plan,
    frameWidth: input.frameWidth,
    frameHeight: input.frameHeight,
    priorCategory: input.priorCategory ?? priorAssetIdFor(input.frameWidth, input.frameHeight),
  }
}

export function deriveFindings(input: DeriveInput): Finding[] {
  return collectFindings(findingsInputFor(input))
}

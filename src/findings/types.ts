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
  /**
   * Per-section attention *concentration*, in section order (Epic B).
   * Not the peak — every section map is normalised on its own, so its peak is
   * always 1. See `engine/segments.ts` → `sectionSalience`.
   */
  sectionSalience: number[]
  /** Ranked click candidates, strongest first. */
  candidates: readonly ClickCandidate[]
  signals: readonly NodeSignal[]
  plan: SegmentPlan
  frameWidth: number
  frameHeight: number
  /**
   * Which location prior was used. `flat` needs it: attention concentration is
   * scale-free but not comparable across UI types.
   */
  priorCategory: string
  /**
   * The first section's own map — normalised in itself and **not** attenuated
   * (`AnalyzeResult.sections[0]`).
   *
   * `attention` is the composed map, whose contrast is partly manufactured:
   * `composeSections` damps every deeper section by `sectionAttenuation^i`, so
   * mass piles up in the first section and any concentration measured on it
   * says as much about the segmentation as about the design. A rule that asks
   * "does this screen have a hierarchy" must read a viewport, not a composite.
   *
   * Defaults to `attention` when absent — for an unsegmented frame the two are
   * the same object.
   */
  aboveFoldSection?: ScalarMap
  /**
   * All section maps, each normalised in itself and **not** attenuated
   * (`AnalyzeResult.sections`). Same reason as `aboveFoldSection`: a rule that
   * compares two elements must not compare them across the scroll-depth
   * damping, or it only re-states which of them sits further down.
   *
   * Absent means "one section" — then `attention` is that section.
   */
  sections?: readonly ScalarMap[]
  /**
   * The first section's **image-analysis term** — what this screen makes
   * salient, before the location prior is added (`AnalyzeResult.imageTerms[0]`).
   *
   * `flat` reads this and not the finished map. Measured on the finished map,
   * an empty frame comes out as concentrated as one with a clear eye-catcher
   * (0,164 against 0,167), because a prior-dominated map is mostly the prior.
   * On the image term the same two cases are 0,000 against 0,871.
   */
  aboveFoldImageTerm?: ScalarMap
}

/** A single rule. Returns at most one finding (C-1). */
export type Rule = {
  id: string
  /**
   * `false` keeps the rule in the code but out of the product — for a rule
   * whose threshold is not (or no longer) backed by a measurement. Deleting it
   * would throw away the implementation *and* the reason; a flag keeps both
   * next to each other. Defaults to shipped.
   */
  shipped?: boolean
  evaluate(input: FindingsInput): Finding | null
}

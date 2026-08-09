import type { NodeSignal } from '../messages'
import { ENGINE_CONFIG } from './config'
import { hasKeywordHit, signalRect } from './features/structure'
import { meanInRect } from './imageops'
import type { ScalarMap } from './types'

export type CandidateKind = 'reaction' | 'keyword' | 'label'

export type ClickCandidate = {
  id: string
  name: string
  kind: CandidateKind
  /** Geometry in frame pixels. */
  x: number
  y: number
  width: number
  height: number
  /** Normalised probability, all candidates of a frame sum to 1. */
  score: number
  /** Score components, kept for debugging and tuning. */
  parts: { attention: number; reaction: number }
}

/**
 * FR-5 step 1 — candidate detection.
 *
 * A node qualifies when it carries a prototype reaction, when its name matches
 * an interactive keyword, or when it is a short text label sitting inside a
 * filled container (the classic "button" shape).
 */
export function findCandidates(signals: readonly NodeSignal[], frameWidth: number, frameHeight: number): NodeSignal[] {
  const cfg = ENGINE_CONFIG.clickmap
  const byId = new Map<string, NodeSignal>()
  for (const signal of signals) byId.set(signal.id, signal)

  const frameArea = frameWidth * frameHeight
  const fits = (signal: NodeSignal): boolean => {
    const area = signal.width * signal.height
    if (area < cfg.minCandidateArea) return false
    return !(frameArea > 0 && area / frameArea > cfg.maxCandidateAreaRatio)
  }

  /**
   * The filled box a label sits in — searched up the **ancestor chain**, not
   * just at the direct parent.
   *
   * A component library wraps its label in an unfilled auto-layout row inside
   * the filled button; that is the normal shape, not an exception. Checking
   * only `parentId` therefore missed every button and every category tile of a
   * real onboarding screen while reporting the one element it did find at
   * „100 %".
   *
   * Bounded by `buttonContainerDepth`, and the box has to satisfy the size
   * limits itself — otherwise the search walks out of the button and returns
   * the section, the page background, the frame.
   */
  const filledContainer = (label: NodeSignal): NodeSignal | null => {
    let current = label.parentId ? byId.get(label.parentId) : undefined
    for (let depth = 0; current && depth < cfg.buttonContainerDepth; depth++) {
      if (current.hasFill && !current.isText && fits(current)) return current
      current = current.parentId ? byId.get(current.parentId) : undefined
    }
    return null
  }

  const candidates: NodeSignal[] = []
  const seen = new Set<string>()
  const add = (signal: NodeSignal): void => {
    if (seen.has(signal.id)) return
    seen.add(signal.id)
    candidates.push(signal)
  }

  for (const signal of signals) {
    if (signal.hasReactions || hasKeywordHit(signal)) {
      if (fits(signal)) add(signal)
      continue
    }

    if (signal.isText && (signal.charCount ?? Infinity) < cfg.maxTextCharsForButton) {
      // The tappable thing is the box, not the words in it — the same
      // preference `dropNestedCandidates` encodes. Several labels in one card
      // therefore collapse into one candidate instead of three.
      const container = filledContainer(signal)
      if (container) add(container)
    }
  }

  return dropNestedCandidates(candidates)
}

/**
 * Keeps the outermost candidate of a nest (the button, not its label), unless
 * the inner one is the stronger signal — a reaction beats a mere name match.
 */
function dropNestedCandidates(candidates: readonly NodeSignal[]): NodeSignal[] {
  const rank = (signal: NodeSignal): number => (signal.hasReactions ? 2 : hasKeywordHit(signal) ? 1 : 0)

  return candidates.filter((inner) =>
    !candidates.some((outer) => outer.id !== inner.id && contains(outer, inner) && rank(outer) >= rank(inner)),
  )
}

function contains(outer: NodeSignal, inner: NodeSignal): boolean {
  return (
    outer.x <= inner.x &&
    outer.y <= inner.y &&
    outer.x + outer.width >= inner.x + inner.width &&
    outer.y + outer.height >= inner.y + inner.height &&
    outer.width * outer.height > inner.width * inner.height
  )
}

function kindOf(signal: NodeSignal): CandidateKind {
  if (signal.hasReactions) return 'reaction'
  if (hasKeywordHit(signal)) return 'keyword'
  return 'label'
}

/**
 * FR-5 steps 3–4 — scoring and normalisation.
 *
 * `score = 0.625 * meanAttention + 0.375 * reactionBonus`, afterwards
 * normalised so all candidates sum to 1 (percentages).
 *
 * There used to be a third term, `0.2 * Fläche ÷ größte Fläche`. It is gone —
 * see `ENGINE_CONFIG.clickmap.weights` for why removing beat recalibrating.
 */
export function scoreCandidates(
  signals: readonly NodeSignal[],
  attention: ScalarMap,
  frameWidth: number,
  frameHeight: number,
): ClickCandidate[] {
  const cfg = ENGINE_CONFIG.clickmap
  const candidates = findCandidates(signals, frameWidth, frameHeight)
  if (candidates.length === 0) return []

  const scored = candidates.map((signal) => {
    const rect = signalRect(signal, frameWidth, frameHeight, attention.width, attention.height)
    const meanAttention = meanInRect(attention.values, attention.width, attention.height, rect)
    const kind = kindOf(signal)
    const reaction =
      kind === 'reaction'
        ? cfg.reactionBonus.reactions
        : kind === 'keyword'
          ? cfg.reactionBonus.keyword
          : cfg.reactionBonus.other
    const raw = cfg.weights.attention * meanAttention + cfg.weights.reaction * reaction

    return {
      id: signal.id,
      name: signal.name,
      kind,
      x: signal.x,
      y: signal.y,
      width: signal.width,
      height: signal.height,
      score: raw,
      parts: { attention: meanAttention, reaction },
    } satisfies ClickCandidate
  })

  // Deterministic ordering: score desc, then id — never depends on Array#sort
  // stability or on traversal order alone.
  scored.sort((a, b) => b.score - a.score || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  const kept = scored.slice(0, cfg.maxCandidates)

  const total = kept.reduce((sum, candidate) => sum + candidate.score, 0)
  if (total <= 0) {
    const even = 1 / kept.length
    return kept.map((candidate) => ({ ...candidate, score: even }))
  }
  return kept.map((candidate) => ({ ...candidate, score: candidate.score / total }))
}

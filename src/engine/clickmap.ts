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
  parts: { attention: number; reaction: number; size: number }
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
  const candidates: NodeSignal[] = []

  for (const signal of signals) {
    const area = signal.width * signal.height
    if (area < cfg.minCandidateArea) continue
    if (frameArea > 0 && area / frameArea > cfg.maxCandidateAreaRatio) continue

    if (signal.hasReactions || hasKeywordHit(signal)) {
      candidates.push(signal)
      continue
    }

    if (signal.isText && (signal.charCount ?? Infinity) < cfg.maxTextCharsForButton) {
      const parent = signal.parentId ? byId.get(signal.parentId) : undefined
      if (parent && parent.hasFill && !parent.isText) candidates.push(signal)
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
 * `score = 0.5 * meanAttention + 0.3 * reactionBonus + 0.2 * sizeRank`,
 * afterwards normalised so all candidates sum to 1 (percentages).
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

  let maxArea = 0
  for (const signal of candidates) maxArea = Math.max(maxArea, signal.width * signal.height)

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
    const sizeRank = maxArea > 0 ? (signal.width * signal.height) / maxArea : 0

    const raw =
      cfg.weights.attention * meanAttention + cfg.weights.reaction * reaction + cfg.weights.size * sizeRank

    return {
      id: signal.id,
      name: signal.name,
      kind,
      x: signal.x,
      y: signal.y,
      width: signal.width,
      height: signal.height,
      score: raw,
      parts: { attention: meanAttention, reaction, size: sizeRank },
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

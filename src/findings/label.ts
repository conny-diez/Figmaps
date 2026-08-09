/**
 * How an element is named in a finding and in the click ranking.
 *
 * Two rules, both learned from a review of the 1.1 output:
 *
 * 1. **Content before layer name.** A finding that says ‚JobsResultCard‘ is
 *    talking about the file; the reviewer is looking at a card that says
 *    „Fahrzeugeinkäufer im Außendienst". The layer name is the fallback, not
 *    the first choice.
 * 2. **Position when the name repeats.** Three cards with the same label make
 *    a finding unresolvable — „‚Details ansehen‘ liegt in einem ruhigen
 *    Bereich" points at nothing. Then, and only then, the description carries
 *    an ordinal and a vertical zone.
 *
 * Both realms import this: findings use it for their sentences, the iframe
 * pipeline for the ranking list. It therefore stays free of `figma.*` and DOM.
 */
import type { NodeSignal } from '../messages'

/** Anything that can be named: a click candidate or a raw node signal. */
export type Describable = {
  id: string
  name: string
  x: number
  y: number
  width: number
  height: number
}

/** German typographic quotes, as used throughout the panel. */
export function quote(text: string): string {
  return `‚${text}‘`
}

/**
 * Ranks text nodes for the "what does this element say" question: the biggest
 * type wins, then the largest box, then whatever sits highest. That picks the
 * headline of a card over its subline without needing a semantic model.
 */
function textRank(signal: NodeSignal): [number, number, number] {
  return [signal.fontSize ?? 0, signal.width * signal.height, -signal.y]
}

function better(a: NodeSignal, b: NodeSignal): boolean {
  const ra = textRank(a)
  const rb = textRank(b)
  for (let i = 0; i < ra.length; i++) {
    if (ra[i] !== rb[i]) return ra[i] > rb[i]
  }
  return false
}

/**
 * The text an element carries: its own, or the most prominent text below it.
 *
 * Returns `null` when the subtree holds no text at all — an icon button, an
 * image card — and the layer name has to do the work.
 */
export function elementText(target: Describable, signals: readonly NodeSignal[]): string | null {
  const self = signals.find((signal) => signal.id === target.id)
  if (self?.text) return self.text

  const children = new Map<string, NodeSignal[]>()
  for (const signal of signals) {
    if (!signal.parentId) continue
    const list = children.get(signal.parentId)
    if (list) list.push(signal)
    else children.set(signal.parentId, [signal])
  }

  let best: NodeSignal | null = null
  const queue = [...(children.get(target.id) ?? [])]
  const seen = new Set<string>([target.id])
  while (queue.length > 0) {
    const node = queue.shift()!
    if (seen.has(node.id)) continue
    seen.add(node.id)
    if (node.text && (!best || better(node, best))) best = node
    queue.push(...(children.get(node.id) ?? []))
  }

  return best?.text ?? null
}

/** The bare label — text content if there is any, layer name otherwise. */
export function elementLabel(target: Describable, signals: readonly NodeSignal[]): string {
  return elementText(target, signals) ?? target.name
}

/**
 * Elements that would be described with the *same words* as `target`.
 *
 * Same layer name **and** same resolved label: three „JobsResultCard"s holding
 * three different job titles are told apart by their text and need no ordinal,
 * three identical „Details ansehen" labels do.
 */
function peersOf(target: Describable, signals: readonly NodeSignal[], label: string): NodeSignal[] {
  return signals.filter((signal) => signal.name === target.name && elementLabel(signal, signals) === label)
}

/** oben / mittig / unten, by the element's centre. */
function zone(target: Describable, frameHeight: number): string {
  if (!(frameHeight > 0)) return ''
  const centre = (target.y + target.height / 2) / frameHeight
  if (centre < 1 / 3) return 'oben'
  if (centre > 2 / 3) return 'unten'
  return 'mittig'
}

/**
 * „(3. von 3, unten)" — or `null` when the label already identifies the
 * element on its own.
 */
export function positionHint(
  target: Describable,
  signals: readonly NodeSignal[],
  frameHeight: number,
  label = elementLabel(target, signals),
): string | null {
  const peers = peersOf(target, signals, label)
  if (peers.length < 2) return null

  const ordered = [...peers].sort((a, b) => a.y - b.y || a.x - b.x)
  const index = ordered.findIndex((signal) => signal.id === target.id)
  const place = zone(target, frameHeight)

  // The element is not in `signals` at all (hand-built input in a unit test):
  // then only the zone can be stated, and an invented ordinal would be a lie.
  if (index < 0) return place || null

  return `${index + 1}. von ${ordered.length}${place ? `, ${place}` : ''}`
}

/** Label plus position hint, unquoted — for lists, layer names and titles. */
export function elementCaption(
  target: Describable,
  signals: readonly NodeSignal[],
  frameHeight: number,
): string {
  const label = elementLabel(target, signals)
  const hint = positionHint(target, signals, frameHeight, label)
  return hint ? `${label} (${hint})` : label
}

/**
 * The string a finding puts in place of an element: quoted label, plus
 * „(3. von 3, unten)" when the label alone does not identify it.
 */
export function describeElement(
  target: Describable,
  signals: readonly NodeSignal[],
  frameHeight: number,
): string {
  const label = elementLabel(target, signals)
  const hint = positionHint(target, signals, frameHeight, label)
  return hint ? `${quote(label)} (${hint})` : quote(label)
}

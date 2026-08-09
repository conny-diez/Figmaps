/**
 * F2 — an element is named by what it says, and told apart by where it sits.
 */
import { describe, expect, it } from 'vitest'
import type { NodeSignal } from '../../messages'
import { describeElement, elementCaption, elementLabel, elementText, positionHint } from '../label'

let nextId = 0
function signal(overrides: Partial<NodeSignal>): NodeSignal {
  nextId++
  return {
    id: `n${nextId}`,
    parentId: null,
    name: `node-${nextId}`,
    type: 'FRAME',
    x: 0,
    y: 0,
    width: 100,
    height: 40,
    zIndex: nextId,
    opacity: 1,
    isText: false,
    isImage: false,
    hasFill: true,
    hasReactions: false,
    nameHints: [],
    ...overrides,
  }
}

/** Three result cards, each with a title, a company line and a label button. */
function jobsList(sameTitle = false): NodeSignal[] {
  const titles = ['Fahrzeugeinkäufer im Außendienst', 'Sachbearbeiter Buchhaltung', 'Pflegefachkraft Nachtdienst']
  const out: NodeSignal[] = []
  for (let i = 0; i < 3; i++) {
    const y = 200 + i * 200
    const card = signal({ name: 'JobsResultCard', x: 16, y, width: 358, height: 160 })
    out.push(
      card,
      signal({
        name: 'Stellentitel',
        parentId: card.id,
        x: 32,
        y: y + 16,
        width: 300,
        height: 22,
        isText: true,
        fontSize: 16,
        text: sameTitle ? titles[0] : titles[i],
      }),
      signal({
        name: 'Firmenname',
        parentId: card.id,
        x: 32,
        y: y + 48,
        width: 200,
        height: 16,
        isText: true,
        fontSize: 13,
        text: 'Autohaus Nord GmbH',
      }),
      signal({
        name: 'Aktion',
        parentId: card.id,
        x: 32,
        y: y + 110,
        width: 120,
        height: 32,
        isText: true,
        fontSize: 13,
        text: 'Details ansehen',
      }),
    )
  }
  return out
}

describe('elementText', () => {
  it('prefers the node’s own text', () => {
    const signals = jobsList()
    const title = signals.find((s) => s.name === 'Stellentitel')!
    expect(elementText(title, signals)).toBe('Fahrzeugeinkäufer im Außendienst')
  })

  it('takes the most prominent text of the subtree for a container', () => {
    const signals = jobsList()
    const card = signals.find((s) => s.name === 'JobsResultCard')!
    // Title (16 px) beats company line and button label (13 px).
    expect(elementText(card, signals)).toBe('Fahrzeugeinkäufer im Außendienst')
  })

  it('returns null when the subtree carries no text', () => {
    const icon = signal({ name: 'IconButton' })
    expect(elementText(icon, [icon])).toBeNull()
  })
})

describe('elementLabel', () => {
  it('never returns the layer name when there is text', () => {
    const signals = jobsList()
    const card = signals.find((s) => s.name === 'JobsResultCard')!
    expect(elementLabel(card, signals)).not.toBe('JobsResultCard')
  })

  it('falls back to the layer name', () => {
    const icon = signal({ name: 'Menü öffnen' })
    expect(elementLabel(icon, [icon])).toBe('Menü öffnen')
  })
})

describe('positionHint', () => {
  it('stays silent when the text already identifies the element', () => {
    const signals = jobsList()
    const cards = signals.filter((s) => s.name === 'JobsResultCard')
    expect(positionHint(cards[2], signals, 900)).toBeNull()
  })

  it('numbers the element and names its zone when several read alike', () => {
    const signals = jobsList()
    const buttons = signals.filter((s) => s.name === 'Aktion')
    expect(positionHint(buttons[2], signals, 900)).toBe('3. von 3, unten')
    expect(positionHint(buttons[0], signals, 900)).toBe('1. von 3, mittig')
  })

  it('also fires for identical cards with identical titles', () => {
    const signals = jobsList(true)
    const cards = signals.filter((s) => s.name === 'JobsResultCard')
    expect(positionHint(cards[1], signals, 900)).toBe('2. von 3, mittig')
  })

  it('states only the zone for an element that is not in the tree', () => {
    // Three text-free icon buttons: the label falls back to the layer name, so
    // an outside describable with that name resolves to the same words — but
    // has no place in the reading order, and inventing one would be a lie.
    const signals = [0, 1, 2].map((i) => signal({ name: 'IconButton', x: 40 * i, y: 100, width: 32, height: 32 }))
    const ghost = { id: 'not-in-tree', name: 'IconButton', x: 32, y: 700, width: 32, height: 32 }
    expect(positionHint(ghost, signals, 900)).toBe('unten')
  })
})

describe('describeElement / elementCaption', () => {
  it('quotes the text, not the layer name', () => {
    const signals = jobsList()
    const card = signals.find((s) => s.name === 'JobsResultCard')!
    expect(describeElement(card, signals, 900)).toBe('‚Fahrzeugeinkäufer im Außendienst‘')
  })

  it('appends the position for repeated labels', () => {
    const signals = jobsList()
    const buttons = signals.filter((s) => s.name === 'Aktion')
    expect(describeElement(buttons[2], signals, 900)).toBe('‚Details ansehen‘ (3. von 3, unten)')
    expect(elementCaption(buttons[2], signals, 900)).toBe('Details ansehen (3. von 3, unten)')
  })
})

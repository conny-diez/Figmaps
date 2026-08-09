/**
 * FR-8 — placing the result on the canvas.
 *
 * WHY A FIGMA STUB: `placeMaps` shipped broken twice, and both times the
 * failure was invisible locally because this module only runs inside Figma.
 *
 *   1. It set `layoutSizingHorizontal` before appending the node, and Figma
 *      rejects that with "node must be an auto-layout frame or a child of an
 *      auto-layout frame".
 *   2. The findings frame came out 520 × 90 px with the second finding cut in
 *      half: `resize()` on an auto-layout frame sets **both** sizing modes to
 *      FIXED, so the `primaryAxisSizingMode = 'AUTO'` set before it was undone
 *      and the height stayed at what was passed in.
 *
 * The stub therefore models the three rules of this API that are easy to
 * violate and impossible to notice locally: append-before-sizing, no text
 * before its font is loaded, and — new here — the sizing arithmetic itself,
 * including `resize()`'s side effect on the sizing modes and the fact that a
 * text node only wraps once `textAutoResize` is `'HEIGHT'`. It is not a Figma
 * emulator; it is a contract check.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { RULES } from '../../findings/rules'
import type { FindingPayload, MapMeta, RenderedMap, SegmentInfo } from '../../messages'

type StubNode = {
  type: string
  name: string
  parent: StubNode | null
  children: StubNode[]
  width: number
  height: number
  x: number
  y: number
  layoutMode?: string
  [key: string]: unknown
}

const loadedFonts = new Set<string>()
const notices: string[] = []

function fontKey(font: { family: string; style: string }): string {
  return `${font.family}/${font.style}`
}

/** Advance width ≈ 0.5 em per character — enough to decide how often it wraps. */
function textWidth(characters: string, fontSize: number): number {
  return characters.length * fontSize * 0.5
}

function isAuto(node: StubNode | null | undefined): boolean {
  return node?.layoutMode === 'HORIZONTAL' || node?.layoutMode === 'VERTICAL'
}

/**
 * Recomputes one node's own size from its children. Deliberately close to the
 * documented auto-layout rules and nothing more.
 */
function measure(node: StubNode): void {
  if (node.type === 'TEXT') {
    const size = (node.fontSize as number) ?? 12
    const lineHeightValue = node.lineHeight as { value?: number } | undefined
    const lineHeight = lineHeightValue?.value ?? size * 1.2
    const measured = textWidth(node.characters as string, size)
    if (node.textAutoResize === 'HEIGHT') {
      // Fixed width, wraps, grows downwards.
      node.height = Math.max(1, Math.ceil(measured / Math.max(1, node.width))) * lineHeight
    } else {
      // Created like this: one endless line that never wraps.
      node.width = measured
      node.height = lineHeight
    }
  }

  if (isAuto(node)) {
    const vertical = node.layoutMode === 'VERTICAL'
    const padL = (node.paddingLeft as number) ?? 0
    const padR = (node.paddingRight as number) ?? 0
    const padT = (node.paddingTop as number) ?? 0
    const padB = (node.paddingBottom as number) ?? 0
    const spacing = (node.itemSpacing as number) ?? 0

    // Children that fill take the parent's inner width first — their height
    // then follows from the wrap.
    for (const child of node.children) {
      if (child.fills_width === true && vertical) {
        child.width = node.width - padL - padR
        measure(child)
      }
    }

    const totalW = node.children.reduce((sum, child) => sum + child.width, 0)
    const totalH = node.children.reduce((sum, child) => sum + child.height, 0)
    const gaps = Math.max(0, node.children.length - 1) * spacing
    const maxW = node.children.reduce((max, child) => Math.max(max, child.width), 0)
    const maxH = node.children.reduce((max, child) => Math.max(max, child.height), 0)

    if (vertical) {
      if (node.primaryAxisSizingMode === 'AUTO') node.height = padT + padB + totalH + gaps
      if (node.counterAxisSizingMode === 'AUTO') node.width = padL + padR + maxW
    } else {
      if (node.primaryAxisSizingMode === 'AUTO') node.width = padL + padR + totalW + gaps
      if (node.counterAxisSizingMode === 'AUTO') node.height = padT + padB + maxH
    }

    // Positions, so a child sticking out of its frame is detectable.
    let cursor = vertical ? padT : padL
    for (const child of node.children) {
      child.x = vertical ? padL : cursor
      child.y = vertical ? cursor : padT
      cursor += (vertical ? child.height : child.width) + spacing
    }
  }
}

/** Sizes propagate upwards, exactly as an auto-layout tree does. */
function relayout(node: StubNode | null): void {
  for (let current = node; current; current = current.parent) measure(current)
}

function makeNode(type: string): StubNode {
  const node: StubNode = {
    type,
    name: '',
    parent: null,
    children: [],
    width: type === 'TEXT' ? 0 : 100,
    height: type === 'TEXT' ? 0 : 100,
    x: 0,
    y: 0,
    fills: [],
    appendChild(child: StubNode) {
      child.parent = node
      node.children.push(child)
      relayout(child)
    },
    resize(width: number, height: number) {
      node.width = width
      node.height = height
      // The trap: on an auto-layout frame this pins BOTH axes.
      if (isAuto(node)) {
        node.primaryAxisSizingMode = 'FIXED'
        node.counterAxisSizingMode = 'FIXED'
      }
      relayout(node)
    },
    remove() {
      const siblings = node.parent?.children
      if (siblings) siblings.splice(siblings.indexOf(node), 1)
      const parent = node.parent
      node.parent = null
      relayout(parent)
    },
  }

  let characters = ''
  let fontName: { family: string; style: string } | null = null

  Object.defineProperty(node, 'fontName', {
    get: () => fontName,
    set: (value: { family: string; style: string }) => {
      fontName = value
    },
  })

  Object.defineProperty(node, 'characters', {
    get: () => characters,
    set: (value: string) => {
      // Figma throws when text is written before its font is loaded.
      if (type === 'TEXT' && (!fontName || !loadedFonts.has(fontKey(fontName)))) {
        throw new Error('in set_characters: Cannot write to node with unloaded font')
      }
      characters = value
      relayout(node)
    },
  })

  Object.defineProperty(node, 'layoutSizingHorizontal', {
    get: () => (node.fills_width === true ? 'FILL' : 'FIXED'),
    set: (value: string) => {
      // The rule that broke the plugin the first time.
      if (!isAuto(node) && !isAuto(node.parent)) {
        throw new Error(
          'in set_layoutSizingHorizontal: node must be an auto-layout frame or a child of an auto-layout frame',
        )
      }
      node.fills_width = value === 'FILL'
      relayout(node.parent ?? node)
    },
  })

  return node
}

const page = makeNode('PAGE')

const figmaStub = {
  createFrame: () => makeNode('FRAME'),
  createText: () => makeNode('TEXT'),
  createRectangle: () => makeNode('RECTANGLE'),
  createImage: (bytes: Uint8Array) => ({ hash: `img:${bytes.length}` }),
  loadFontAsync: (font: { family: string; style: string }) => {
    // Only Inter exists here — like a machine without every font installed.
    if (font.family !== 'Inter') return Promise.reject(new Error('font not available'))
    loadedFonts.add(fontKey(font))
    return Promise.resolve()
  },
  notify: (message: string) => {
    notices.push(message)
  },
  currentPage: page,
}

// The module under test reads the `figma` global at call time, so the stub has
// to be in place before it is imported.
;(globalThis as unknown as Record<string, unknown>).figma = figmaStub

const { placeMaps, metaLine } = await import('../place')

type SourceNode = Parameters<typeof placeMaps>[0]

const sourceNode = {
  id: 'frame:1',
  name: 'Meine Jobs - beworben',
  width: 1440,
  height: 4000,
  absoluteBoundingBox: { x: 0, y: 0, width: 1440, height: 4000 },
} as unknown as SourceNode

const maps: RenderedMap[] = [
  { kind: 'heat', png: new Uint8Array([1, 2, 3]) },
  { kind: 'fold', png: new Uint8Array([4, 5, 6]) },
]

const findings: FindingPayload[] = [
  { id: 'cold-fold', severity: 'problem', text: 'Die Aufmerksamkeit bündelt sich weiter unten.' },
  { id: 'flat', severity: 'attention', text: 'Der Screen zeigt keine ausgeprägte Hierarchie.' },
]

const segments: SegmentInfo = { segmented: true, sectionCount: 6, viewportHeight: 900, folds: [900, 1800] }

const mapMeta: MapMeta = {
  screenBehaviour: 'Mobile App',
  duration: 'Blick (1 s)',
  attribution: 'UEyes (Jiang et al. 2023), CC BY 4.0',
}

function findNode(root: StubNode, predicate: (node: StubNode) => boolean): StubNode | null {
  if (predicate(root)) return root
  for (const child of root.children) {
    const hit = findNode(child, predicate)
    if (hit) return hit
  }
  return null
}

function walk(root: StubNode, visit: (node: StubNode) => void): void {
  visit(root)
  for (const child of root.children) walk(child, visit)
}

/** Every auto-layout frame is at least as tall as what it holds. */
function assertNothingClipped(root: StubNode): void {
  walk(root, (node) => {
    if (!isAuto(node)) return
    const padT = (node.paddingTop as number) ?? 0
    const padB = (node.paddingBottom as number) ?? 0
    const padL = (node.paddingLeft as number) ?? 0
    const padR = (node.paddingRight as number) ?? 0
    const spacing = (node.itemSpacing as number) ?? 0
    const gaps = Math.max(0, node.children.length - 1) * spacing

    if (node.layoutMode === 'VERTICAL') {
      const needed = node.children.reduce((sum, child) => sum + child.height, 0) + gaps + padT + padB
      expect(
        node.height,
        `${node.name || node.type}: Höhe ${node.height} < Inhalt ${needed}`,
      ).toBeGreaterThanOrEqual(needed - 0.001)
    }

    for (const child of node.children) {
      expect(child.x + child.width, `${child.name || child.type} ragt rechts aus ${node.name}`).toBeLessThanOrEqual(
        node.width - padR + 0.001,
      )
      expect(child.y + child.height, `${child.name || child.type} ragt unten aus ${node.name}`).toBeLessThanOrEqual(
        node.height - padB + 0.001,
      )
      expect(child.x).toBeGreaterThanOrEqual(padL - 0.001)
      expect(child.y).toBeGreaterThanOrEqual(padT - 0.001)
    }
  })
}

function mapColumns(wrapper: StubNode): StubNode[] {
  const row = wrapper.children.find((child) => child.name === 'Maps')!
  return row.children.filter((child) => !child.name.startsWith('Befunde'))
}

describe('placeMaps', () => {
  // `loadedFonts` is deliberately not cleared: `place.ts` caches the resolved
  // font across calls, as it should. The font rule is still enforced — any text
  // written before the first successful load throws in the stub.
  beforeEach(() => {
    notices.length = 0
    page.children.length = 0
  })

  it('places one column per map', async () => {
    const wrapper = (await placeMaps(sourceNode, maps)) as unknown as StubNode
    expect(mapColumns(wrapper)).toHaveLength(maps.length)
    expect(page.children).toContain(wrapper)
  })

  it('writes title and disclaimer next to every map, never onto it', async () => {
    const wrapper = (await placeMaps(sourceNode, maps, { mapMeta })) as unknown as StubNode
    for (const column of mapColumns(wrapper)) {
      const texts = column.children.filter((child) => child.type === 'TEXT').map((child) => child.characters as string)
      expect(texts).toHaveLength(2)
      expect(texts[1]).toBe(metaLine(mapMeta))
      expect(texts[1]).toContain('keine Messdaten')
      expect(texts[1]).toContain('Blickverhalten: Mobile App')
      expect(texts[1]).toContain('Betrachtungsdauer: Blick (1 s)')
      // The term the panel stopped using must not come back through here.
      expect(texts[1]).not.toContain('Ortsprior')
    }
  })

  it('names the source once per run, not once per map', async () => {
    const wrapper = (await placeMaps(sourceNode, maps, { mapMeta })) as unknown as StubNode
    const lines: string[] = []
    walk(wrapper, (node) => {
      if (node.type === 'TEXT' && (node.characters as string).includes('CC BY')) lines.push(node.characters as string)
    })
    expect(lines).toHaveLength(1)
    expect(lines[0]).toContain('Datengrundlage')
  })

  it('carries the viewing duration in the frame names', async () => {
    const wrapper = (await placeMaps(sourceNode, maps, { mapMeta })) as unknown as StubNode
    expect(wrapper.name).toContain('Blick (1 s)')
    for (const column of mapColumns(wrapper)) expect(column.name).toContain('Blick (1 s)')
  })

  it('writes the findings frame — the case that shipped broken', async () => {
    // Regression: layoutSizingHorizontal was set before appendChild, so Figma
    // rejected it and the whole placement failed with PLACE_FAILED.
    const wrapper = (await placeMaps(sourceNode, maps, { findings, segments })) as unknown as StubNode
    const findingsFrame = findNode(wrapper, (node) => node.name.startsWith('Befunde'))
    expect(findingsFrame).not.toBeNull()

    const texts = findingsFrame!.children.map((child) => child.characters as string)
    // Title, segmentation note, both findings, disclaimer.
    expect(texts).toHaveLength(3 + findings.length)
    expect(texts[0]).toContain('Befunde')
    expect(texts[1]).toContain('6 Abschnitte')
    expect(texts.some((text) => text.includes('bündelt'))).toBe(true)
    expect(texts[texts.length - 1]).toContain('keine Messdaten')
    expect(notices).toHaveLength(0)
  })

  it('omits the segmentation note for an unsegmented frame', async () => {
    const wrapper = (await placeMaps(sourceNode, maps, { findings })) as unknown as StubNode
    const findingsFrame = findNode(wrapper, (node) => node.name.startsWith('Befunde'))!
    expect(findingsFrame.children).toHaveLength(2 + findings.length)
  })

  it('grows the findings frame with its content instead of clipping it', async () => {
    // The reported bug: 520 x 90 px, second finding cut in half. The height has
    // to follow the text, and the text has to wrap.
    const wrapper = (await placeMaps(sourceNode, maps, { findings, segments, mapMeta })) as unknown as StubNode
    const findingsFrame = findNode(wrapper, (node) => node.name.startsWith('Befunde'))!

    expect(findingsFrame.primaryAxisSizingMode).toBe('AUTO')
    expect(findingsFrame.counterAxisSizingMode).toBe('FIXED')
    expect(findingsFrame.clipsContent).toBe(false)
    expect(findingsFrame.width).toBe(520)
    expect(findingsFrame.height).toBeGreaterThan(90)
    for (const child of findingsFrame.children) expect(child.textAutoResize).toBe('HEIGHT')
    assertNothingClipped(wrapper)
  })

  it('holds the worst case: every shipped rule fires with a long element name', async () => {
    // One finding per rule the plugin actually runs, each naming an element by
    // its text content — the longest strings the sentences can carry.
    const longName = '‚Fahrzeugeinkäufer im Außendienst (m/w/d) — Autohaus Nord GmbH‘'
    const worstCase: FindingPayload[] = RULES.map((rule, index) => ({
      id: rule.id,
      severity: index % 2 === 0 ? 'problem' : 'attention',
      text:
        `${longName} erreicht 12 % der vorhergesagten Aufmerksamkeit der stärksten Schaltfläche ` +
        `${longName}, jeweils im eigenen Bildschirmausschnitt gemessen.`,
    }))
    expect(worstCase.length).toBeGreaterThan(0)

    const wrapper = (await placeMaps(sourceNode, maps, {
      findings: worstCase,
      segments,
      mapMeta,
    })) as unknown as StubNode
    const findingsFrame = findNode(wrapper, (node) => node.name.startsWith('Befunde'))!

    // Every finding wrapped over several lines, and the frame is tall enough
    // for all of them plus padding.
    const bodies = findingsFrame.children.slice(2, 2 + worstCase.length)
    for (const body of bodies) expect(body.height).toBeGreaterThan(16 * 1.45 * 2)
    assertNothingClipped(wrapper)
  })

  it('keeps the maps when the findings frame fails', async () => {
    // The maps are the deliverable; an extra text frame must not cost them.
    const original = figmaStub.createText
    let calls = 0
    figmaStub.createText = () => {
      calls++
      // Two texts per map column come first; this kills the findings title.
      if (calls === maps.length * 2 + 1) throw new Error('kaputt')
      return original()
    }
    try {
      const wrapper = (await placeMaps(sourceNode, maps, { findings })) as unknown as StubNode
      // Maps intact, and no empty findings box left standing next to them.
      expect(mapColumns(wrapper)).toHaveLength(maps.length)
      expect(findNode(wrapper, (node) => node.name.startsWith('Befunde'))).toBeNull()
      expect(notices.some((message) => message.includes('Maps sind erstellt'))).toBe(true)
    } finally {
      figmaStub.createText = original
    }
  })
})

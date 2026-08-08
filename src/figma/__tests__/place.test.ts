/**
 * FR-8 — placing the result on the canvas.
 *
 * WHY A FIGMA STUB: `placeMaps` shipped broken. It set
 * `layoutSizingHorizontal` before appending the node, and Figma rejects that
 * with "node must be an auto-layout frame or a child of an auto-layout frame".
 * Nothing caught it, because this module only runs inside Figma and had no test
 * at all — the same shape of gap as the inert `cold-fold` rule.
 *
 * The stub below is deliberately *strict*: it enforces the two constraints of
 * this API that are easy to violate and impossible to notice locally — the
 * append-before-sizing order, and no text before its font is loaded. It is not
 * a Figma emulator; it is a contract check.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import type { FindingPayload, RenderedMap, SegmentInfo } from '../../messages'

type StubNode = {
  type: string
  name: string
  parent: StubNode | null
  children: StubNode[]
  layoutMode?: string
  [key: string]: unknown
}

const loadedFonts = new Set<string>()
const notices: string[] = []

function fontKey(font: { family: string; style: string }): string {
  return `${font.family}/${font.style}`
}

function makeNode(type: string): StubNode {
  const node: StubNode = {
    type,
    name: '',
    parent: null,
    children: [],
    fills: [],
    appendChild(child: StubNode) {
      child.parent = node
      node.children.push(child)
    },
    resize() {},
    remove() {
      const siblings = node.parent?.children
      if (siblings) siblings.splice(siblings.indexOf(node), 1)
      node.parent = null
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
    },
  })

  Object.defineProperty(node, 'layoutSizingHorizontal', {
    get: () => 'FIXED',
    set: () => {
      // The rule that broke the plugin.
      const isAuto = (candidate: StubNode | null | undefined): boolean =>
        candidate?.layoutMode === 'HORIZONTAL' || candidate?.layoutMode === 'VERTICAL'
      if (!isAuto(node) && !isAuto(node.parent)) {
        throw new Error(
          'in set_layoutSizingHorizontal: node must be an auto-layout frame or a child of an auto-layout frame',
        )
      }
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

const { placeMaps } = await import('../place')

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

function findNode(root: StubNode, predicate: (node: StubNode) => boolean): StubNode | null {
  if (predicate(root)) return root
  for (const child of root.children) {
    const hit = findNode(child, predicate)
    if (hit) return hit
  }
  return null
}

describe('placeMaps', () => {
  // `loadedFonts` is deliberately not cleared: `place.ts` caches the resolved
  // font across calls, as it should. The font rule is still enforced — any text
  // written before the first successful load throws in the stub.
  beforeEach(() => {
    notices.length = 0
    page.children.length = 0
  })

  it('places one child frame per map', async () => {
    const wrapper = (await placeMaps(sourceNode, maps)) as unknown as StubNode
    expect(wrapper.children).toHaveLength(maps.length)
    expect(page.children).toContain(wrapper)
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

  it('keeps the maps when the findings frame fails', async () => {
    // The maps are the deliverable; an extra text frame must not cost them.
    const original = figmaStub.createText
    let calls = 0
    figmaStub.createText = () => {
      calls++
      // Two map titles come first; this kills the findings frame's title.
      if (calls === maps.length + 1) throw new Error('kaputt')
      return original()
    }
    try {
      const wrapper = (await placeMaps(sourceNode, maps, { findings })) as unknown as StubNode
      // Maps intact, and no empty findings box left standing next to them.
      expect(wrapper.children).toHaveLength(maps.length)
      expect(findNode(wrapper, (node) => node.name.startsWith('Befunde'))).toBeNull()
      expect(notices.some((message) => message.includes('Maps sind erstellt'))).toBe(true)
    } finally {
      figmaStub.createText = original
    }
  })
})

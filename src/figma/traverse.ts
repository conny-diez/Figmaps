/**
 * FR-3 — layer tree extraction. Main thread only.
 *
 * Produces the structural signals the engine mixes into the pixel-based
 * feature maps. Everything here is synchronous Figma scene-graph access, which
 * is allowed under `documentAccess: "dynamic-page"` for nodes on the current
 * page; no styles, variables or main components are touched.
 */
import { ENGINE_CONFIG, INTERACTIVE_KEYWORDS } from '../engine/config'
import type { NodeSignal } from '../messages'
import type { AnalysableNode } from './selection'

export type TraverseResult = {
  signals: NodeSignal[]
  /** True when the tree exceeded the node cap and was skipped entirely. */
  truncated: boolean
  notices: string[]
}

/**
 * Maps a Figma font style name onto a numeric weight.
 * Order matters: "Semi Bold" must be tested before "Bold".
 */
const WEIGHT_TABLE: ReadonlyArray<readonly [string, number]> = [
  ['thin', 100],
  ['hairline', 100],
  ['extralight', 200],
  ['extra light', 200],
  ['ultralight', 200],
  ['ultra light', 200],
  ['semibold', 600],
  ['semi bold', 600],
  ['demibold', 600],
  ['demi bold', 600],
  ['extrabold', 800],
  ['extra bold', 800],
  ['ultrabold', 800],
  ['ultra bold', 800],
  ['light', 300],
  ['book', 400],
  ['regular', 400],
  ['normal', 400],
  ['medium', 500],
  ['black', 900],
  ['heavy', 900],
  ['bold', 700],
]

export function fontWeightFromStyle(style: string | undefined): number {
  if (!style) return 400
  const normalised = style.toLowerCase()
  for (const [needle, weight] of WEIGHT_TABLE) {
    if (normalised.includes(needle)) return weight
  }
  return 400
}

/**
 * Lowercased name tokens that match an interactive keyword.
 *
 * The token separator keeps `äöüß`: splitting on `[^a-z0-9]` alone tore
 * „Schaltfläche" into „schaltfl" and „che", so no German keyword carrying an
 * umlaut could ever match — including the three the list needs most
 * („Schaltfläche", „Menü", „Kontrollkästchen").
 */
export function extractNameHints(name: string): string[] {
  const tokens = name.toLowerCase().split(/[^a-z0-9äöüß]+/).filter(Boolean)
  const hits = new Set<string>()
  for (const token of tokens) {
    for (const keyword of INTERACTIVE_KEYWORDS) {
      if (token === keyword || (token.length > keyword.length && token.includes(keyword))) hits.add(keyword)
    }
  }
  return [...hits].sort()
}

/**
 * Collapses a text node's characters into a one-line label.
 *
 * Line breaks, tabs and runs of spaces all become a single space — a Figma text
 * node carries the layout of the design, and a finding that quotes it must read
 * as one sentence. Truncation is marked with an ellipsis so a cut is visible as
 * a cut.
 */
export function normaliseText(characters: string, maxLength = ENGINE_CONFIG.traversal.maxTextLength): string {
  const collapsed = characters.replace(/\s+/g, ' ').trim()
  if (collapsed.length <= maxLength) return collapsed
  return `${collapsed.slice(0, maxLength).trimEnd()}…`
}

/** Relative luminance (Rec. 709) of an sRGB colour, `[0,1]`. */
export function relativeLuminance(color: RGB): number {
  const channel = (c: number): number => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4))
  return 0.2126 * channel(color.r) + 0.7152 * channel(color.g) + 0.0722 * channel(color.b)
}

function visiblePaints(node: SceneNode): readonly Paint[] {
  if (!('fills' in node)) return []
  const fills = node.fills
  if (fills === figma.mixed) return []
  return fills.filter((paint) => paint.visible !== false && (paint.opacity ?? 1) > 0)
}

export function collectSignals(root: AnalysableNode): TraverseResult {
  const cfg = ENGINE_CONFIG.traversal
  const notices: string[] = []

  // Instances hide invisible children behind this flag; skipping them is both
  // faster and semantically what we want.
  figma.skipInvisibleInstanceChildren = true

  if (!('findAll' in root)) return { signals: [], truncated: false, notices }

  const descendants = root.findAll(() => true)
  if (descendants.length > cfg.maxNodes) {
    return {
      signals: [],
      truncated: true,
      notices: [
        `Der Frame enthält ${descendants.length} Ebenen (Limit ${cfg.maxNodes}) — die Analyse läuft ohne Struktur-Signale.`,
      ],
    }
  }

  const rootBox = root.absoluteBoundingBox
  if (!rootBox) return { signals: [], truncated: false, notices }

  const signals: NodeSignal[] = []
  for (let index = 0; index < descendants.length; index++) {
    const node = descendants[index]
    if (!node.visible) continue

    const opacity = 'opacity' in node ? node.opacity : 1
    if (opacity <= cfg.minOpacity) continue

    const box = node.absoluteBoundingBox
    if (!box || box.width <= 0 || box.height <= 0) continue

    const x = box.x - rootBox.x
    const y = box.y - rootBox.y
    // Everything fully outside the root frame is clipped away on screen.
    if (x + box.width <= 0 || y + box.height <= 0 || x >= rootBox.width || y >= rootBox.height) continue

    const paints = visiblePaints(node)
    const isText = node.type === 'TEXT'

    const signal: NodeSignal = {
      id: node.id,
      parentId: node.parent ? node.parent.id : null,
      name: node.name,
      type: node.type,
      x,
      y,
      width: box.width,
      height: box.height,
      zIndex: index,
      opacity,
      isText,
      isImage: paints.some((paint) => paint.type === 'IMAGE'),
      hasFill: paints.length > 0,
      hasReactions: 'reactions' in node && node.reactions.length > 0,
      nameHints: extractNameHints(node.name),
    }

    // Nur, wenn wirklich gedreht — sonst trägt jedes Signal ein Feld mit Null.
    //
    // `rotation` ist aus `relativeTransform` abgeleitet und kommt bei
    // Auto-Layout- und Instanzketten als Rechenrest daher (`-1.4e-14`). Die
    // Schwelle steht deshalb nicht hier, sondern bei der Messung
    // (`contrast/measurable.ts` → `MeasurableLimits.rotationDegrees`): dieses
    // Modul überträgt, was in der Datei steht, und urteilt nicht.
    if ('rotation' in node && node.rotation !== 0) signal.rotation = node.rotation

    if (node.type === 'TEXT') {
      if (node.fontSize !== figma.mixed) signal.fontSize = node.fontSize
      if (node.fontName !== figma.mixed) signal.fontWeight = fontWeightFromStyle(node.fontName.style)
      signal.charCount = node.characters.length
      const text = normaliseText(node.characters)
      if (text.length > 0) signal.text = text
    }

    // Nur, wenn die Farbe auch wirklich so auf dem Bildschirm landet.
    //
    // `fillLuminance` ist die Grundlage der Kontrastmessung, und die tritt als
    // überprüfbare Tatsache auf. Eine Deckkraft unter 1 — am Paint oder am
    // Knoten — mischt die Farbe mit dem, was dahinter liegt; der Wert aus dem
    // Layer-Baum wäre dann **besser** als das, was man sieht. Lieber gar kein
    // Wert und ein „nicht messbar" im Report als eine geschönte Zahl.
    //
    // Gefunden beim systematischen Abgleich, was die Testframes nicht erzeugen
    // (siehe README, „Was die Generatoren nicht erzeugen"): sie setzen Deckkraft
    // nie unter 1, also konnte kein Test das finden.
    const solid = paints.find((paint) => paint.type === 'SOLID')
    if (solid && (solid.opacity ?? 1) >= 1 && opacity >= 1) {
      signal.fillLuminance = relativeLuminance(solid.color)
    }

    signals.push(signal)
  }

  return { signals, truncated: false, notices }
}

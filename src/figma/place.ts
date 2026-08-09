/**
 * FR-8 — writing results back onto the canvas. Main thread only.
 */
import { ENGINE_CONFIG, ENGINE_VERSION } from '../engine/config'
import { MAP_LABELS, type FindingPayload, type RenderedMap, type SegmentInfo } from '../messages'
import type { AnalysableNode } from './selection'

/** Preferred title fonts, tried in order — the first that loads wins. */
const TITLE_FONTS: readonly FontName[] = [
  { family: 'Inter', style: 'Semi Bold' },
  { family: 'Inter', style: 'Bold' },
  { family: 'Inter', style: 'Medium' },
  { family: 'Inter', style: 'Regular' },
  { family: 'Roboto', style: 'Regular' },
]

/** Body font for the findings frame — tried after the title font. */
const BODY_FONTS: readonly FontName[] = [
  { family: 'Inter', style: 'Regular' },
  { family: 'Roboto', style: 'Regular' },
]

const SEVERITY_MARKERS: Record<FindingPayload['severity'], string> = {
  problem: 'Auffällig',
  attention: 'Beachten',
  info: 'Hinweis',
}

let cachedFont: FontName | null = null
let cachedBodyFont: FontName | null = null

function describe(error: unknown): string {
  return error instanceof Error && error.message ? error.message : String(error)
}

/**
 * Text nodes cannot be created before their font is loaded — skipping this is
 * the classic runtime error in Figma plugins (PRD §12).
 */
export async function loadTitleFont(): Promise<FontName> {
  if (cachedFont) return cachedFont
  for (const font of TITLE_FONTS) {
    try {
      await figma.loadFontAsync(font)
      cachedFont = font
      return font
    } catch {
      // try the next candidate
    }
  }
  throw new Error('Keine Schriftart zum Beschriften der Maps verfügbar.')
}

/** Falls back to the title font, which is already known to load. */
async function loadBodyFont(): Promise<FontName> {
  if (cachedBodyFont) return cachedBodyFont
  for (const font of BODY_FONTS) {
    try {
      await figma.loadFontAsync(font)
      cachedBodyFont = font
      return font
    } catch {
      // try the next candidate
    }
  }
  cachedBodyFont = await loadTitleFont()
  return cachedBodyFont
}

function timestamp(now: Date): string {
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`
}

/**
 * Creates one wrapper frame per run, holding one child frame per map.
 * Repeated runs never overwrite an earlier wrapper.
 */
export type PlaceExtras = {
  findings?: readonly FindingPayload[]
  segments?: SegmentInfo
}

export async function placeMaps(
  node: AnalysableNode,
  maps: readonly RenderedMap[],
  extras: PlaceExtras = {},
): Promise<FrameNode> {
  const cfg = ENGINE_CONFIG.placement
  const font = await loadTitleFont()

  const wrapper = figma.createFrame()
  wrapper.name = `[Figmaps] ${node.name} — ${timestamp(new Date())}`
  wrapper.layoutMode = 'HORIZONTAL'
  wrapper.primaryAxisSizingMode = 'AUTO'
  wrapper.counterAxisSizingMode = 'AUTO'
  wrapper.counterAxisAlignItems = 'MIN'
  wrapper.itemSpacing = cfg.gap
  wrapper.paddingLeft = cfg.padding
  wrapper.paddingRight = cfg.padding
  wrapper.paddingTop = cfg.padding
  wrapper.paddingBottom = cfg.padding
  wrapper.clipsContent = false
  wrapper.fills = [{ type: 'SOLID', color: { r: 0.96, g: 0.96, b: 0.97 } }]

  figma.currentPage.appendChild(wrapper)

  for (const map of maps) {
    const child = figma.createFrame()
    child.name = `${MAP_LABELS[map.kind]} · ${ENGINE_VERSION}`
    child.layoutMode = 'VERTICAL'
    child.primaryAxisSizingMode = 'AUTO'
    child.counterAxisSizingMode = 'AUTO'
    child.itemSpacing = Math.round(cfg.titleFontSize * 0.75)
    child.fills = []
    child.clipsContent = false
    wrapper.appendChild(child)

    const title = figma.createText()
    title.fontName = font
    title.fontSize = cfg.titleFontSize
    title.characters = `${MAP_LABELS[map.kind]} — vorhergesagt (${ENGINE_VERSION})`
    title.fills = [{ type: 'SOLID', color: { r: 0.1, g: 0.1, b: 0.12 } }]
    child.appendChild(title)

    const image = figma.createImage(map.png)
    const rect = figma.createRectangle()
    rect.name = `${MAP_LABELS[map.kind]} — ${node.name}`
    // B-2 — the above-the-fold map covers only the first section, so it must
    // not be stretched to the full frame height.
    const height =
      map.kind === 'fold' && extras.segments
        ? Math.min(node.height, extras.segments.viewportHeight)
        : node.height
    rect.resize(node.width, height)
    rect.fills = [{ type: 'IMAGE', scaleMode: 'FILL', imageHash: image.hash }]
    child.appendChild(rect)
  }

  // C-3 — the findings travel with the images, so they survive the trip into a
  // presentation.
  //
  // Deliberately non-fatal: the maps are the deliverable, the text frame is an
  // extra. Losing the whole placement because a text node misbehaved is the
  // wrong trade — that is exactly what happened when this shipped with the
  // `layoutSizingHorizontal` calls in the wrong order.
  if (extras.findings && extras.findings.length > 0) {
    try {
      await appendFindingsFrame(wrapper, extras.findings, extras.segments)
    } catch (error) {
      figma.notify(`Befunde konnten nicht als Textframe abgelegt werden (${describe(error)}). Maps sind erstellt.`)
    }
  }

  // Place to the right of the source frame, in absolute page coordinates.
  const box = node.absoluteBoundingBox
  if (box) {
    wrapper.x = box.x + box.width + cfg.gap
    wrapper.y = box.y
  }

  return wrapper
}

/** C-3 — the findings as a text frame next to the maps. */
async function appendFindingsFrame(
  wrapper: FrameNode,
  findings: readonly FindingPayload[],
  segments?: SegmentInfo,
): Promise<void> {
  const cfg = ENGINE_CONFIG.placement
  const titleFont = await loadTitleFont()
  const bodyFont = await loadBodyFont()

  const frame = figma.createFrame()
  frame.name = `Befunde · ${ENGINE_VERSION}`
  frame.layoutMode = 'VERTICAL'
  frame.primaryAxisSizingMode = 'AUTO'
  frame.counterAxisSizingMode = 'FIXED'
  frame.resize(cfg.findingsWidth, 1)
  frame.itemSpacing = Math.round(cfg.findingsFontSize * 0.9)
  frame.paddingLeft = frame.paddingRight = frame.paddingTop = frame.paddingBottom = cfg.findingsFontSize * 2
  frame.fills = [{ type: 'SOLID', color: { r: 1, g: 1, b: 1 } }]
  frame.cornerRadius = 12
  wrapper.appendChild(frame)

  /**
   * Appends a paragraph and lets it fill the frame's width.
   *
   * The order matters and is the whole reason this helper exists:
   * `layoutSizingHorizontal` may only be set once the node **is** a child of an
   * auto-layout frame. Setting it first throws
   * "node must be an auto-layout frame or a child of an auto-layout frame",
   * which is how this shipped broken.
   */
  const paragraph = (options: { font: FontName; size: number; text: string; colour: RGB }): void => {
    const node = figma.createText()
    node.fontName = options.font
    node.fontSize = options.size
    node.characters = options.text
    node.fills = [{ type: 'SOLID', color: options.colour }]
    frame.appendChild(node)
    node.layoutSizingHorizontal = 'FILL'
  }

  // If any paragraph fails, the half-built frame must not stay behind: an empty
  // white box next to the maps looks like a result, and is worse than nothing.
  try {
    paragraph({ font: titleFont, size: cfg.titleFontSize, text: 'Befunde — vorhergesagt', colour: { r: 0.1, g: 0.1, b: 0.12 } })

    if (segments?.segmented) {
      paragraph({
        font: bodyFont,
        size: cfg.findingsFontSize * 0.85,
        text: `Abschnittsweise analysiert: ${segments.sectionCount} Abschnitte à ${segments.viewportHeight} px`,
        colour: { r: 0.45, g: 0.45, b: 0.5 },
      })
    }

    for (const finding of findings) {
      paragraph({
        font: bodyFont,
        size: cfg.findingsFontSize,
        text: `${SEVERITY_MARKERS[finding.severity]} · ${finding.text}`,
        colour: { r: 0.16, g: 0.16, b: 0.2 },
      })
    }

    paragraph({
      font: bodyFont,
      size: cfg.findingsFontSize * 0.8,
      text: 'Algorithmische Vorhersage, keine Messdaten.',
      colour: { r: 0.55, g: 0.55, b: 0.6 },
    })
  } catch (error) {
    frame.remove()
    throw error
  }
}

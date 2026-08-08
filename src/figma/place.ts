/**
 * FR-8 — writing results back onto the canvas. Main thread only.
 */
import { ENGINE_CONFIG, ENGINE_VERSION } from '../engine/config'
import { MAP_LABELS, type RenderedMap } from '../messages'
import type { AnalysableNode } from './selection'

/** Preferred title fonts, tried in order — the first that loads wins. */
const TITLE_FONTS: readonly FontName[] = [
  { family: 'Inter', style: 'Semi Bold' },
  { family: 'Inter', style: 'Bold' },
  { family: 'Inter', style: 'Medium' },
  { family: 'Inter', style: 'Regular' },
  { family: 'Roboto', style: 'Regular' },
]

let cachedFont: FontName | null = null

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

function timestamp(now: Date): string {
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`
}

/**
 * Creates one wrapper frame per run, holding one child frame per map.
 * Repeated runs never overwrite an earlier wrapper.
 */
export async function placeMaps(node: AnalysableNode, maps: readonly RenderedMap[]): Promise<FrameNode> {
  const cfg = ENGINE_CONFIG.placement
  const font = await loadTitleFont()

  const wrapper = figma.createFrame()
  wrapper.name = `[FigMaps] ${node.name} — ${timestamp(new Date())}`
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
    rect.resize(node.width, node.height)
    rect.fills = [{ type: 'IMAGE', scaleMode: 'FILL', imageHash: image.hash }]
    child.appendChild(rect)
  }

  // Place to the right of the source frame, in absolute page coordinates.
  const box = node.absoluteBoundingBox
  if (box) {
    wrapper.x = box.x + box.width + cfg.gap
    wrapper.y = box.y
  }

  return wrapper
}

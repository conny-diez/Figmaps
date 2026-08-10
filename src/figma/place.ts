/**
 * FR-8 — writing results back onto the canvas. Main thread only.
 *
 * NOTHING IS PAINTED ONTO THE SCREENSHOTS. Title, disclaimer, the parameters
 * the prediction depends on and the CC BY notice used to be drawn into every
 * PNG; they are Figma text nodes in the white space around the images now. Two
 * reasons, and they pull in opposite directions:
 *
 *   - The frame name does not travel. Someone who exports a single map out of
 *     Figma gets the pixels and nothing else, so the disclaimer has to stay
 *     inside the *image area* — hence text nodes next to the picture rather
 *     than only a layer name.
 *   - The map is a screenshot of someone's design. Burning a black bar into it
 *     makes it useless as a screenshot.
 *
 * The CC BY notice sits once at the bottom of the wrapper, not on every map.
 */
import { ENGINE_CONFIG, ENGINE_VERSION } from '../engine/config'
import { MAP_LABELS, type FindingPayload, type MapMeta, type RenderedMap, type SegmentInfo,
  type MapKind,
} from '../messages'
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

/** The one sentence that must never be separable from a *predicted* map. */
const DISCLAIMER = 'Algorithmische Vorhersage, keine Messdaten'

/**
 * Die Contrastmap ist die eine Ausgabe, für die der Disclaimer **falsch** wäre.
 *
 * Sie sagt keine Aufmerksamkeit vorher, sie rechnet ein Kontrastverhältnis aus.
 * Wer den Vorhersage-Satz darunter setzt, entwertet die einzige Messung im
 * Plugin — und zwar gegen die eigene Faktenlage.
 *
 * Aus demselben Grund fehlen hier Blickverhalten, Betrachtungsdauer und
 * Engine-Version: keiner dieser Werte geht in ein Kontrastverhältnis ein, der
 * Ortsprior wird nicht benutzt. Eine Zeile, die sie trotzdem nennt, behauptet
 * eine Abhängigkeit, die es nicht gibt.
 */
const MEASURED_MAPS: ReadonlySet<MapKind> = new Set<MapKind>(['contrast'])

const MEASURED_TITLE_SUFFIX = 'gemessen'
const MEASURED_LINE = 'Gemessene Kontrastwerte nach WCAG 2.1 AA — nachprüfbar, keine Vorhersage'

/** Trägt diese Karte eine Messung statt einer Vorhersage? */
export function isMeasuredMap(kind: MapKind): boolean {
  return MEASURED_MAPS.has(kind)
}

/**
 * What the findings frame says when no rule fired.
 *
 * „Nothing found" and „the feature does not exist" look identical if the block
 * is simply absent — and on a single-viewport phone screen two of the four
 * shipped rules cannot fire at all, so an empty result is the common case, not
 * the exception.
 *
 * **1.3: der Satz nennt seinen Umfang.** Vorher stand hier „Keine der geprüften
 * Auffälligkeiten trifft zu" — über einem Rahmen, der ausschließlich die
 * *Vorhersage*-Regeln enthält. Die Kontrastmessung ist nicht darin: sie reist in
 * `PLACE_RESULT.contrastFindings` mit und wird hier nicht gelesen. Wer also drei
 * durchgefallene Texte im Panel hatte und die Karten in eine Präsentation
 * kopierte, nahm einen Satz mit, der „nichts gefunden" sagte. Derselbe Satz mit
 * dem Wort „vorhergesagt" darin sagt, worüber er spricht.
 *
 * Die Lücke selbst bleibt und ist eigens vermerkt: die richtige Behebung ist,
 * die Messwerte **mit** auf den Canvas zu schreiben — als eigener Block, denn
 * eine Messung darf nicht in derselben Liste stehen wie eine Vorhersage (C4).
 */
const EMPTY_FINDINGS = 'Keine der geprüften vorhergesagten Auffälligkeiten trifft zu.'

/**
 * Der Hinweis, dass dieser Rahmen die Messwerte **nicht** enthält.
 *
 * Steht immer, nicht nur bei leerer Liste: auch ein Rahmen mit drei
 * Vorhersage-Befunden lässt offen, ob die Kontrastprüfung dabei war.
 */
const FINDINGS_SCOPE = 'Gemessene Kontrastwerte stehen im Panel, nicht in diesem Rahmen.'

const INK = { title: { r: 0.1, g: 0.1, b: 0.12 }, body: { r: 0.16, g: 0.16, b: 0.2 }, quiet: { r: 0.45, g: 0.45, b: 0.5 } }

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
 * The line under every map title.
 *
 * One line, in the panel's words: what the map is, which reference population
 * it was compared against, which viewing duration, which engine. „Ortsprior" is
 * gone — it named the mechanism, not the thing.
 */
export function metaLine(meta: MapMeta | undefined, kind?: MapKind): string {
  // Gemessene Karten bekommen ihre eigene Zeile und **nichts** aus der
  // Vorhersage-Vorlage — siehe `MEASURED_MAPS`.
  if (kind && isMeasuredMap(kind)) return MEASURED_LINE

  const parts = [DISCLAIMER]
  // Jedes Stück einzeln und nur, wenn es da ist. 1.3: die Felder sind optional
  // geworden, weil ein Pflichtfeld eine Behauptung erzwingt — fehlt der
  // Referenzprior, nennt die Zeile keine Kategorie und keine Dauer, sondern
  // sagt, was stattdessen gerechnet hat (`ui/map-meta.ts`).
  if (meta?.screenBehaviour) parts.push(`Blickverhalten: ${meta.screenBehaviour}`)
  if (meta?.duration) parts.push(`Betrachtungsdauer: ${meta.duration}`)
  if (meta?.fallback) parts.push(meta.fallback)
  parts.push(ENGINE_VERSION)
  return parts.join(' · ')
}

/** Die Überschrift über einer Karte. */
export function mapTitle(kind: MapKind): string {
  return `${MAP_LABELS[kind]} — ${isMeasuredMap(kind) ? MEASURED_TITLE_SUFFIX : 'vorhergesagt'}`
}

/**
 * Appends a text node and lets it fill the width of its auto-layout parent.
 *
 * The order is the whole reason this helper exists and it is *three* rules, all
 * of which have cost this module a bug:
 *
 *   1. `layoutSizingHorizontal` may only be set once the node **is** a child of
 *      an auto-layout frame. Setting it first throws "node must be an
 *      auto-layout frame or a child of an auto-layout frame".
 *   2. A text node is created with `textAutoResize = 'WIDTH_AND_HEIGHT'`: it
 *      grows sideways and never wraps. Without `'HEIGHT'` a long finding is one
 *      endless line that the frame either clips or is stretched by.
 *   3. `characters` may only be written after the font is loaded.
 */
function paragraph(
  parent: FrameNode,
  options: { font: FontName; size: number; text: string; colour: RGB; lineHeightFactor?: number },
): TextNode {
  const node = figma.createText()
  node.fontName = options.font
  node.fontSize = options.size
  node.characters = options.text
  node.fills = [{ type: 'SOLID', color: options.colour }]
  if (options.lineHeightFactor) {
    node.lineHeight = { unit: 'PIXELS', value: Math.round(options.size * options.lineHeightFactor) }
  }
  parent.appendChild(node)
  // Wrap instead of growing sideways, then fill the column.
  node.textAutoResize = 'HEIGHT'
  node.layoutSizingHorizontal = 'FILL'
  return node
}

/**
 * Vertical auto-layout column of fixed width whose height hugs its content.
 *
 * `resize()` is what makes this delicate: on an auto-layout frame it sets *both*
 * sizing modes to FIXED. Setting `primaryAxisSizingMode = 'AUTO'` before the
 * resize therefore does nothing — the frame keeps the height passed in, and the
 * content is clipped at that height. That is exactly how the findings frame
 * shipped at 520 × 90 px with the second finding cut in half. The width is set
 * first, the sizing modes after.
 */
function column(width: number, spacing: number, padding: number): FrameNode {
  const frame = figma.createFrame()
  frame.layoutMode = 'VERTICAL'
  frame.resize(width, 1)
  frame.counterAxisSizingMode = 'FIXED'
  frame.primaryAxisSizingMode = 'AUTO'
  frame.itemSpacing = spacing
  frame.paddingLeft = frame.paddingRight = frame.paddingTop = frame.paddingBottom = padding
  // Safety net: if a future change ever pins the height again, the content is
  // still readable instead of silently cut.
  frame.clipsContent = false
  frame.fills = []
  return frame
}

export type PlaceExtras = {
  findings?: readonly FindingPayload[]
  segments?: SegmentInfo
  /** Parameters of the prediction, written next to every map. */
  mapMeta?: MapMeta
}

/**
 * Creates one wrapper frame per run, holding one column per map.
 * Repeated runs never overwrite an earlier wrapper.
 */
export async function placeMaps(
  node: AnalysableNode,
  maps: readonly RenderedMap[],
  extras: PlaceExtras = {},
): Promise<FrameNode> {
  const cfg = ENGINE_CONFIG.placement
  const font = await loadTitleFont()
  const bodyFont = await loadBodyFont()
  const meta = extras.mapMeta

  // Vertical, because the CC BY line runs the full width under all maps —
  // once per run instead of once per image.
  const wrapper = figma.createFrame()
  // Die Dauer nur, wenn eine gerechnet wurde. `meta ? …` war falsch: seit 1.3 ist
  // `duration` optional, und ein vorhandenes `meta` ohne sie hätte
  // „— undefined" in den Ebenennamen geschrieben.
  wrapper.name = `[Figmaps] ${node.name}${meta?.duration ? ` — ${meta.duration}` : ''} — ${timestamp(new Date())}`
  wrapper.layoutMode = 'VERTICAL'
  wrapper.primaryAxisSizingMode = 'AUTO'
  wrapper.counterAxisSizingMode = 'AUTO'
  wrapper.counterAxisAlignItems = 'MIN'
  wrapper.itemSpacing = Math.round(cfg.padding * 0.5)
  wrapper.paddingLeft = wrapper.paddingRight = wrapper.paddingTop = wrapper.paddingBottom = cfg.padding
  wrapper.clipsContent = false
  wrapper.fills = [{ type: 'SOLID', color: { r: 0.96, g: 0.96, b: 0.97 } }]

  const row = figma.createFrame()
  row.name = 'Maps'
  row.layoutMode = 'HORIZONTAL'
  row.primaryAxisSizingMode = 'AUTO'
  row.counterAxisSizingMode = 'AUTO'
  row.counterAxisAlignItems = 'MIN'
  row.itemSpacing = cfg.gap
  row.clipsContent = false
  row.fills = []
  wrapper.appendChild(row)

  figma.currentPage.appendChild(wrapper)

  for (const map of maps) {
    // B-2 — the above-the-fold map covers only the first section, so it must
    // not be stretched to the full frame height.
    const height =
      map.kind === 'fold' && extras.segments
        ? Math.min(node.height, extras.segments.viewportHeight)
        : node.height

    const child = column(node.width, Math.round(cfg.titleFontSize * 0.5), 0)
    // Auch der Ebenenname trägt bei einer gemessenen Karte keine
    // Vorhersage-Parameter — er wandert mit, wenn jemand den Frame kopiert.
    child.name = isMeasuredMap(map.kind)
      ? `${MAP_LABELS[map.kind]} · ${MEASURED_TITLE_SUFFIX}`
      : `${MAP_LABELS[map.kind]}${meta?.duration ? ` · ${meta.duration}` : ''} · ${ENGINE_VERSION}`
    row.appendChild(child)

    paragraph(child, {
      font,
      size: cfg.titleFontSize,
      text: mapTitle(map.kind),
      colour: INK.title,
    })
    // The disclaimer lives in the image area, not only in the layer name: a
    // frame name does not travel with an exported PNG, this line does.
    paragraph(child, {
      font: bodyFont,
      size: Math.round(cfg.titleFontSize * 0.58),
      text: metaLine(meta, map.kind),
      colour: INK.quiet,
      lineHeightFactor: 1.5,
    })

    const image = figma.createImage(map.png)
    const rect = figma.createRectangle()
    rect.name = `${MAP_LABELS[map.kind]} — ${node.name}`
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
  //
  // Also written when *nothing* was found: a missing block reads as a missing
  // feature. „Keine der geprüften Auffälligkeiten trifft zu" is a result.
  try {
    await appendFindingsFrame(row, extras.findings ?? [], extras.segments)
  } catch (error) {
    figma.notify(`Befunde konnten nicht als Textframe abgelegt werden (${describe(error)}). Maps sind erstellt.`)
  }

  // CC BY 4.0 requires naming the source wherever the derived asset travels —
  // once per run is enough, and three identical lines next to each other read
  // as noise. See NOTICE.md.
  // Die Datengrundlage steht unter den Karten, die sie benutzen. Werden **nur**
  // gemessene Karten erzeugt, ist kein Wert daraus in die Ausgabe eingegangen —
  // dann wäre die Zeile eine Behauptung über eine Abhängigkeit, die es nicht
  // gibt. (Die CC-BY-Pflicht selbst bleibt davon unberührt: sie greift für den
  // Ortsprior, und der steckt in keiner Contrastmap.)
  const usesPrediction = maps.some((map) => !isMeasuredMap(map.kind))
  if (meta?.attribution && usesPrediction) {
    const footer = figma.createFrame()
    footer.layoutMode = 'HORIZONTAL'
    footer.primaryAxisSizingMode = 'AUTO'
    footer.counterAxisSizingMode = 'AUTO'
    footer.name = 'Datengrundlage'
    footer.fills = []
    wrapper.appendChild(footer)
    const line = figma.createText()
    line.fontName = bodyFont
    line.fontSize = Math.round(cfg.titleFontSize * 0.55)
    line.characters = `Datengrundlage: ${meta.attribution}`
    line.fills = [{ type: 'SOLID', color: INK.quiet }]
    footer.appendChild(line)
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
  row: FrameNode,
  findings: readonly FindingPayload[],
  segments?: SegmentInfo,
): Promise<void> {
  const cfg = ENGINE_CONFIG.placement
  const titleFont = await loadTitleFont()
  const bodyFont = await loadBodyFont()

  const frame = column(cfg.findingsWidth, Math.round(cfg.findingsFontSize * 0.9), cfg.findingsFontSize * 2)
  frame.name = `Befunde · ${ENGINE_VERSION}`
  frame.fills = [{ type: 'SOLID', color: { r: 1, g: 1, b: 1 } }]
  frame.cornerRadius = 12
  row.appendChild(frame)

  // If any paragraph fails, the half-built frame must not stay behind: an empty
  // white box next to the maps looks like a result, and is worse than nothing.
  try {
    paragraph(frame, { font: titleFont, size: cfg.titleFontSize, text: 'Befunde — vorhergesagt', colour: INK.title })

    if (segments?.segmented) {
      paragraph(frame, {
        font: bodyFont,
        size: cfg.findingsFontSize * 0.85,
        text: `Abschnittsweise analysiert: ${segments.sectionCount} Abschnitte à ${segments.viewportHeight} px`,
        colour: INK.quiet,
        lineHeightFactor: 1.45,
      })
    }

    if (findings.length === 0) {
      paragraph(frame, {
        font: bodyFont,
        size: cfg.findingsFontSize,
        text: EMPTY_FINDINGS,
        colour: INK.body,
        lineHeightFactor: 1.45,
      })
    }

    for (const finding of findings) {
      paragraph(frame, {
        font: bodyFont,
        size: cfg.findingsFontSize,
        text: `${SEVERITY_MARKERS[finding.severity]} · ${finding.text}`,
        colour: INK.body,
        lineHeightFactor: 1.45,
      })
    }

    paragraph(frame, {
      font: bodyFont,
      size: cfg.findingsFontSize * 0.8,
      text: `${DISCLAIMER}. ${FINDINGS_SCOPE}`,
      colour: INK.quiet,
      lineHeightFactor: 1.45,
    })
  } catch (error) {
    frame.remove()
    throw error
  }
}

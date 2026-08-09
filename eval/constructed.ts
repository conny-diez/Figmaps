/**
 * Prozedural gezeichnete Frames **mit Layer-Baum**, in den drei Formen, denen
 * die Findings-Regeln tatsächlich begegnen.
 *
 * WOZU: `cta-rank`, `cta-below-fold` und `dead-cta` brauchen Klick-Kandidaten,
 * und Kandidaten brauchen einen Layer-Baum. UEyes hat keinen — ein Screenshot
 * hat keine Ebenen. Drei der sechs Regeln sind an echten Bildern deshalb
 * grundsätzlich nicht messbar, und ohne diese Frames gäbe es für sie überhaupt
 * keine Verteilung.
 *
 * VORBEHALT, der zu jeder Zahl von hier gehört: diese Screens sind
 * **konstruiert, nicht beobachtet**. Eine Quote sagt, wie sich eine Regel auf
 * einem konventionellen Layout verhält — nicht, wie häufig ein solches Layout
 * vorkommt. Das eigene Set mit echten Layer-Bäumen (PRD Set 2) ersetzt das
 * hier, sobald es existiert.
 *
 * Alle drei Formen tragen dieselben Zutaten: eine Chrome-Leiste, einen
 * farbigen Kopf, ein Suchfeld, N Ergebniskarten mit fast gleichlautenden
 * Aktionsbeschriftungen und einen primären CTA. Was sich unterscheidet, ist
 * die Geometrie — und genau die ist die geprüfte Größe.
 */
import type { Bitmap } from '../src/engine/ops'
import type { PriorAssetId } from '../src/engine/priors'
import type { NodeSignal } from '../src/messages'

export type FrameShape = {
  id: string
  label: string
  frameWidth: number
  frameHeight: number
  prior: PriorAssetId
  /** What the rules are told the screen is — drives `flat`'s threshold. */
  category: string
  cards: number
}

/** A phone screen that fits in one viewport — 844 / (390 x 2) = 1.08 < 1.5. */
export const MOBILE_SHORT: FrameShape = {
  id: 'mobile-1vp',
  label: 'Telefon, ein Viewport (390 x 844)',
  frameWidth: 390,
  frameHeight: 844,
  prior: 'mobile',
  category: 'mobile',
  cards: 3,
}

/** A scrolling app screen — 3000 / 780 = 3.85 viewports, so segmented. */
export const MOBILE_LONG: FrameShape = {
  id: 'mobile-lang',
  label: 'Telefon, scrollend (390 x 3000)',
  frameWidth: 390,
  frameHeight: 3000,
  prior: 'mobile',
  category: 'mobile',
  cards: 9,
}

/** A desktop scroll page — 3200 / 900 = 3.56 viewports, so segmented. */
export const DESKTOP_LONG: FrameShape = {
  id: 'desktop-lang',
  label: 'Desktop, scrollend (1440 x 3200)',
  frameWidth: 1440,
  frameHeight: 3200,
  prior: 'web',
  category: 'web',
  cards: 8,
}

export const SHAPES: readonly FrameShape[] = [DESKTOP_LONG, MOBILE_SHORT, MOBILE_LONG]

type Rect = { x: number; y: number; width: number; height: number }
type Rgb = [number, number, number]

export type BuiltFrame = { image: Bitmap; signals: NodeSignal[]; label: string; shape: FrameShape }

const TITLES: ReadonlyArray<readonly [string, string]> = [
  ['Fahrzeugeinkäufer im Außendienst', 'Autohaus Nord GmbH'],
  ['Sachbearbeiter Buchhaltung (m/w/d)', 'Steuerkanzlei Weber'],
  ['Pflegefachkraft Nachtdienst', 'Klinikum Mitte'],
  ['Softwareentwickler Frontend', 'Digital Works AG'],
  ['Lagerlogistiker Schichtbetrieb', 'Nordfracht SE'],
  ['Kundenberatung Innendienst', 'Stadtwerke Süd'],
]

/**
 * Source resolution. Long frames are drawn at 1x so a 1440x3200 page stays
 * inside the analysis source budget; the engine rescales anyway.
 */
function scaleFor(shape: FrameShape): number {
  return shape.frameHeight > 1200 ? 1 : 2
}

function makePainter(pixels: Uint8ClampedArray, canvasWidth: number, scale: number) {
  const fill = (rect: Rect, rgb: Rgb): void => {
    for (let y = Math.round(rect.y * scale); y < Math.round((rect.y + rect.height) * scale); y++) {
      for (let x = Math.round(rect.x * scale); x < Math.round((rect.x + rect.width) * scale); x++) {
        const p = (y * canvasWidth + x) * 4
        pixels[p] = rgb[0]
        pixels[p + 1] = rgb[1]
        pixels[p + 2] = rgb[2]
        pixels[p + 3] = 255
      }
    }
  }

  /** Text as a run of glyph-sized bars — enough texture for edges and contrast. */
  const text = (rect: Rect, rgb: Rgb): void => {
    const glyph = Math.max(2, Math.round(rect.height * 0.55))
    for (let x = rect.x; x < rect.x + rect.width; x += glyph * 1.4) {
      fill({ x, y: rect.y + rect.height * 0.2, width: glyph, height: rect.height * 0.6 }, rgb)
    }
  }

  return { fill, text }
}

/**
 * What `variant` changes, and why it has to change something structural.
 *
 * A first version varied only the accent colour and the card texts. Every
 * decision variable then came out with min ≈ max, and a fire rate of 0 % or
 * 100 % said nothing about the rule — only that one layout had been measured
 * eight times. These five knobs move the quantities the rules actually cut:
 * how much hierarchy there is (`accent`, `hero`), how far the primary CTA sits
 * from the top (`ctaAtBottom`), and how much competes with it (`cards`).
 */
function layoutFor(shape: FrameShape, variant: number) {
  const accentStep = variant % 5
  return {
    cards: Math.max(2, shape.cards + (variant % 3) - 1),
    /** 0 = no hero image; otherwise a share of the frame height. */
    heroShare: variant % 4 === 0 ? 0 : 0.06 + (variant % 3) * 0.04,
    /** 0 = almost grey (no hierarchy), 4 = fully saturated. */
    accentStrength: accentStep / 4,
    /** false = the primary CTA sits directly under the hero, above the fold. */
    ctaAtBottom: variant % 3 !== 2,
    footerColoured: variant % 2 === 0,
  }
}

export function buildFrame(shape: FrameShape, variant: number): BuiltFrame {
  const scale = scaleFor(shape)
  const canvasWidth = Math.round(shape.frameWidth * scale)
  const canvasHeight = Math.round(shape.frameHeight * scale)
  const pixels = new Uint8ClampedArray(canvasWidth * canvasHeight * 4).fill(255)
  const { fill, text } = makePainter(pixels, canvasWidth, scale)

  const mobile = shape.prior === 'mobile'
  const layout = layoutFor(shape, variant)

  // Interpolated towards the page background, so a low-hierarchy variant really
  // is low-hierarchy instead of just a different hue.
  const mix = (colour: Rgb, strength: number): Rgb => [
    Math.round(246 + (colour[0] - 246) * strength),
    Math.round(247 + (colour[1] - 247) * strength),
    Math.round(249 + (colour[2] - 249) * strength),
  ]
  const accent = mix([200 - variant * 8, 40 + variant * 3, 50 + variant * 4], 0.25 + 0.75 * layout.accentStrength)
  const footerColour = layout.footerColoured
    ? mix([30 + variant * 2, 70 + variant * 5, 180 - variant * 6], 0.3 + 0.7 * layout.accentStrength)
    : ([238, 239, 242] as Rgb)
  const pad = mobile ? 16 : 80
  const contentWidth = shape.frameWidth - pad * 2

  let nextId = 0
  const signals: NodeSignal[] = []
  const signal = (partial: Partial<NodeSignal> & Rect & { name: string }): NodeSignal => {
    const node: NodeSignal = {
      id: `n${nextId++}`,
      parentId: null,
      type: 'FRAME',
      zIndex: nextId,
      opacity: 1,
      isText: false,
      isImage: false,
      hasFill: false,
      hasReactions: false,
      nameHints: [],
      ...partial,
    }
    signals.push(node)
    return node
  }

  fill({ x: 0, y: 0, width: shape.frameWidth, height: shape.frameHeight }, [246, 247, 249])

  // Chrome bar: a phone status bar, or a desktop browser/nav strip.
  const chromeHeight = mobile ? 44 : 56
  fill({ x: 0, y: 0, width: shape.frameWidth, height: chromeHeight }, [255, 255, 255])
  text({ x: pad, y: chromeHeight * 0.32, width: mobile ? 42 : 140, height: 14 }, [10, 10, 12])
  text({ x: shape.frameWidth - pad - 70, y: chromeHeight * 0.32, width: 70, height: 14 }, [10, 10, 12])
  signal({ name: mobile ? 'Statusleiste' : 'Topbar', x: 0, y: 0, width: shape.frameWidth, height: chromeHeight, hasFill: true })

  const headerHeight = mobile ? 60 : 120
  fill({ x: 0, y: chromeHeight, width: shape.frameWidth, height: headerHeight }, accent)
  text({ x: pad, y: chromeHeight + headerHeight * 0.3, width: contentWidth * 0.5, height: 22 }, [255, 255, 255])
  signal({ name: 'Header', x: 0, y: chromeHeight, width: shape.frameWidth, height: headerHeight, hasFill: true })

  const searchY = chromeHeight + headerHeight + 14
  fill({ x: pad, y: searchY, width: contentWidth, height: 44 }, [255, 255, 255])
  text({ x: pad + 14, y: searchY + 14, width: 150, height: 14 }, [140, 142, 150])
  signal({ name: 'SearchField', x: pad, y: searchY, width: contentWidth, height: 44, hasFill: true, nameHints: ['search'] })

  // Optional hero image — the strongest single eye-catcher a layout can have,
  // and the main lever on how concentrated the map comes out.
  let cursor = searchY + 64
  if (layout.heroShare > 0) {
    const heroHeight = Math.round(shape.frameHeight * layout.heroShare)
    fill({ x: pad, y: cursor, width: contentWidth, height: heroHeight }, accent)
    fill(
      { x: pad + contentWidth * 0.1, y: cursor + heroHeight * 0.25, width: contentWidth * 0.35, height: heroHeight * 0.5 },
      [255, 255, 255],
    )
    signal({ name: 'Hero-Bild', x: pad, y: cursor, width: contentWidth, height: heroHeight, hasFill: true, isImage: true })
    cursor += heroHeight + 24
  }

  // The primary CTA does not always live at the bottom — where it sits decides
  // `cta-below-fold` and moves `cta-rank`.
  const ctaWidth = mobile ? contentWidth - 16 : 320
  if (!layout.ctaAtBottom) {
    fill({ x: pad + 8, y: cursor, width: ctaWidth, height: 52 }, accent)
    text({ x: pad + 8 + ctaWidth * 0.3, y: cursor + 18, width: ctaWidth * 0.4, height: 16 }, [255, 255, 255])
    signal({
      name: 'Jetzt bewerben Button',
      x: pad + 8,
      y: cursor,
      width: ctaWidth,
      height: 52,
      hasFill: true,
      hasReactions: true,
      nameHints: ['button'],
    })
    cursor += 76
  }

  // Cards spread over everything between the search field and the footer, so a
  // long frame really does put candidates deep below the fold.
  const footerHeight = mobile ? 100 : 160
  const listTop = cursor
  const listBottom = shape.frameHeight - footerHeight - 24
  const step = (listBottom - listTop) / layout.cards
  const cardHeight = Math.min(step - 18, mobile ? 132 : 180)

  for (let i = 0; i < layout.cards; i++) {
    const y = listTop + i * step
    const cardRect = { x: pad, y, width: contentWidth, height: cardHeight }
    fill(cardRect, [255, 255, 255])
    const [title, company] = TITLES[(i + variant) % TITLES.length]
    text({ x: pad + 16, y: y + cardHeight * 0.16, width: contentWidth * 0.8, height: 18 }, [20, 22, 28])
    text({ x: pad + 16, y: y + cardHeight * 0.42, width: contentWidth * 0.5, height: 14 }, [120, 124, 132])
    fill({ x: pad + 16, y: y + cardHeight * 0.66, width: 110, height: 30 }, accent)
    text({ x: pad + 28, y: y + cardHeight * 0.72, width: 70, height: 12 }, [255, 255, 255])

    const card = signal({ name: 'JobsResultCard', ...cardRect, hasFill: true })
    signal({
      name: 'Stellentitel',
      parentId: card.id,
      x: pad + 16,
      y: y + cardHeight * 0.16,
      width: contentWidth * 0.8,
      height: 18,
      isText: true,
      charCount: title.length,
      fontSize: 16,
      fontWeight: 600,
      text: title,
    })
    signal({
      name: 'Firmenname',
      parentId: card.id,
      x: pad + 16,
      y: y + cardHeight * 0.42,
      width: contentWidth * 0.5,
      height: 14,
      isText: true,
      charCount: company.length,
      fontSize: 13,
      text: company,
    })
    signal({
      name: 'Details ansehen',
      parentId: card.id,
      x: pad + 16,
      y: y + cardHeight * 0.66,
      width: 110,
      height: 30,
      isText: true,
      charCount: 15,
      hasFill: true,
      nameHints: ['button'],
      text: 'Details ansehen',
    })
  }

  fill({ x: 0, y: shape.frameHeight - footerHeight, width: shape.frameWidth, height: footerHeight }, footerColour)
  const ctaY = shape.frameHeight - footerHeight + 24
  fill({ x: pad + 8, y: ctaY, width: ctaWidth, height: 52 }, [255, 255, 255])
  text({ x: pad + 8 + ctaWidth * 0.3, y: ctaY + 18, width: ctaWidth * 0.4, height: 16 }, footerColour)
  signal({ name: 'BottomBar', x: 0, y: shape.frameHeight - footerHeight, width: shape.frameWidth, height: footerHeight, hasFill: true })
  if (layout.ctaAtBottom) {
    signal({
      name: 'Jetzt bewerben Button',
      x: pad + 8,
      y: ctaY,
      width: ctaWidth,
      height: 52,
      hasFill: true,
      hasReactions: true,
      nameHints: ['button'],
    })
  } else {
    signal({ name: 'Impressum', x: pad + 8, y: ctaY, width: ctaWidth, height: 52, hasFill: true, nameHints: ['link'] })
  }

  return {
    image: { width: canvasWidth, height: canvasHeight, data: pixels },
    signals,
    label: `${shape.id}-${variant}`,
    shape,
  }
}

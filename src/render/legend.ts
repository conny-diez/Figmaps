/**
 * Legend and disclaimer footer (FR-7). Every generated map carries both, so a
 * screenshot pulled out of Figma can never be mistaken for measured data
 * (PRD §2.2).
 */
import { ENGINE_CONFIG, ENGINE_VERSION } from '../engine/config'
import { turboCss } from './colormap'

export const DISCLAIMER_TEXT = 'Vorhergesagte Aufmerksamkeit — keine Messdaten'

const FONT_STACK = 'Inter, "Helvetica Neue", Helvetica, Arial, sans-serif'

/** Scales typography with the output size but keeps it readable and bounded. */
export function uiScale(width: number, height: number): number {
  const cfg = ENGINE_CONFIG.render.legend
  const longer = Math.max(width, height)
  const raw = longer * cfg.fontSizeRatio
  return Math.min(cfg.maxFontSize, Math.max(cfg.minFontSize, raw))
}

/**
 * Greedily packs `segments` into lines of at most `maxWidth`, joined by " · ".
 * A segment that does not fit on a line of its own is wrapped at spaces —
 * shrinking has a floor, and clipping the prior category is not an option.
 */
function wrapSegments(
  ctx: CanvasRenderingContext2D,
  segments: readonly string[],
  maxWidth: number,
): string[] {
  const fits = (text: string): boolean => ctx.measureText(text).width <= maxWidth
  const packed: string[] = []
  let current = ''

  for (const segment of segments) {
    const candidate = current ? `${current} · ${segment}` : segment
    if (current && !fits(candidate)) {
      packed.push(current)
      current = segment
    } else {
      current = candidate
    }
  }
  if (current) packed.push(current)

  const out: string[] = []
  for (const line of packed) {
    if (fits(line)) {
      out.push(line)
      continue
    }
    let rest = ''
    for (const word of line.split(' ')) {
      const candidate = rest ? `${rest} ${word}` : word
      if (rest && !fits(candidate)) {
        out.push(rest)
        rest = word
      } else {
        rest = candidate
      }
    }
    if (rest) out.push(rest)
  }
  return out
}

export type FooterLayout = {
  barHeight: number
  font: number
  detailFont: number
  margin: number
  /** Wrapped detail lines, already laid out for `detailFont`. */
  lines: string[]
}

/**
 * Works out the footer's height *before* anything is drawn, so the legend can
 * sit above it and the detail lines can never be clipped.
 */
export function layoutFooter(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  options: FooterOptions = {},
): FooterLayout {
  const cfg = ENGINE_CONFIG.render.legend
  const font = uiScale(width, height)
  const margin = Math.round(font)
  const available = width - margin * 2

  const segments = [options.priorLabel, options.durationLabel, options.attribution].filter(
    (segment): segment is string => Boolean(segment),
  )

  // Shrink first, wrap second: two readable lines beat four tiny ones.
  // Measuring changes `ctx.font`, so it happens inside a save/restore — a
  // layout pass must not leave the context in a different state than it found.
  let detailFont = Math.round(font * 0.85)
  let lines: string[] = []
  if (segments.length > 0) {
    ctx.save()
    for (;;) {
      ctx.font = `400 ${detailFont}px ${FONT_STACK}`
      lines = wrapSegments(ctx, segments, available)
      if (lines.length <= 2 || detailFont <= cfg.minFontSize) break
      detailFont--
    }
    ctx.restore()
  }

  const lineHeight = Math.round(font * 1.5)
  const detailLineHeight = Math.round(font * 1.3)
  return {
    barHeight: lineHeight + lines.length * detailLineHeight + Math.round(font * 0.6),
    font,
    detailFont,
    margin,
    lines,
  }
}

/** Colour ramp bar with "kalt"/"heiß" end labels, drawn bottom-left. */
export function drawLegend(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  title: string,
  footer: FooterOptions = {},
): void {
  const cfg = ENGINE_CONFIG.render.legend
  const font = uiScale(width, height)
  const pad = Math.round(Math.max(width, height) * cfg.paddingRatio)
  const barWidth = Math.round(width * cfg.barWidthRatio)
  const barHeight = Math.round(Math.max(6, Math.max(width, height) * cfg.barHeightRatio))

  const boxHeight = Math.round(font * 1.4 + barHeight + font * 1.6)
  const boxWidth = barWidth + pad * 2
  const boxX = pad
  // The footer grew a second line; asking it how tall it is keeps the legend
  // clear of it instead of assuming a height that was true in 1.1.
  const boxY = height - layoutFooter(ctx, width, height, footer).barHeight - pad - boxHeight

  ctx.save()
  ctx.fillStyle = 'rgba(0, 0, 0, 0.62)'
  roundedRect(ctx, boxX, boxY, boxWidth, boxHeight, Math.round(font * 0.5))
  ctx.fill()

  ctx.fillStyle = '#ffffff'
  ctx.font = `600 ${Math.round(font)}px ${FONT_STACK}`
  ctx.textBaseline = 'top'
  ctx.fillText(title, boxX + pad, boxY + Math.round(font * 0.4))

  const barX = boxX + pad
  const barY = boxY + Math.round(font * 1.7)
  const gradient = ctx.createLinearGradient(barX, 0, barX + barWidth, 0)
  for (let i = 0; i <= 10; i++) gradient.addColorStop(i / 10, turboCss(i / 10))
  ctx.fillStyle = gradient
  ctx.fillRect(barX, barY, barWidth, barHeight)

  ctx.fillStyle = 'rgba(255, 255, 255, 0.85)'
  ctx.font = `400 ${Math.round(font * 0.82)}px ${FONT_STACK}`
  ctx.fillText('kalt', barX, barY + barHeight + Math.round(font * 0.25))
  ctx.textAlign = 'right'
  ctx.fillText('heiß', barX + barWidth, barY + barHeight + Math.round(font * 0.25))
  ctx.restore()
}

export type FooterOptions = {
  /**
   * Which location prior produced this map, and whether it was derived from
   * the frame geometry or chosen. Two maps of the same screen can differ only
   * in this, so it belongs on the image rather than only in the panel.
   */
  priorLabel?: string
  /**
   * Which viewing duration the prediction is calibrated for (Epic D).
   *
   * The same second axis as `priorLabel`: the profile selects the duration the
   * location prior was estimated from, and two maps of one screen can differ
   * in nothing else. A map without it cannot be filed.
   */
  durationLabel?: string
  /**
   * CC BY 4.0 attribution for the bundled location prior. The exported PNG
   * leaves Figma on its own, so the notice has to travel on the image and not
   * only in the panel. See NOTICE.md.
   */
  attribution?: string
}

/**
 * Full-width footer bar.
 *
 * Line 1: disclaimer (left) + engine version (right).
 * Line 2: the parameters this map depends on — prior category, viewing
 * duration — and the attribution.
 *
 * Two lines rather than one, because the single line did not fit: on a phone
 * frame the disclaimer alone takes about 620 px of an 780 px wide export, and
 * the right-aligned string was drawn straight over it. The second line is laid
 * out left-aligned and shrinks (never below `minFontSize`) until it fits, so
 * nothing can overprint anything.
 */
export function drawFooter(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  options: FooterOptions = {},
): void {
  const layout = layoutFooter(ctx, width, height, options)
  const { font, detailFont, margin, lines } = layout
  const available = width - margin * 2
  const lineHeight = Math.round(font * 1.5)
  const y = height - layout.barHeight

  ctx.save()
  ctx.fillStyle = 'rgba(0, 0, 0, 0.72)'
  ctx.fillRect(0, y, width, layout.barHeight)

  ctx.textBaseline = 'middle'
  const firstLineY = y + Math.round(font * 0.3) + lineHeight / 2

  // Line 1 — the version is short enough to stay opposite the disclaimer, and
  // is shortened to the bare number if even that would collide.
  ctx.fillStyle = '#ffffff'
  ctx.font = `600 ${Math.round(font)}px ${FONT_STACK}`
  ctx.textAlign = 'left'
  ctx.fillText(DISCLAIMER_TEXT, margin, firstLineY)
  const disclaimerWidth = ctx.measureText(DISCLAIMER_TEXT).width

  ctx.fillStyle = 'rgba(255, 255, 255, 0.6)'
  ctx.font = `400 ${Math.round(font * 0.85)}px ${FONT_STACK}`
  ctx.textAlign = 'right'
  const version = `Figmaps · ${ENGINE_VERSION}`
  if (disclaimerWidth + ctx.measureText(version).width + margin <= available) {
    ctx.fillText(version, width - margin, firstLineY)
  } else if (disclaimerWidth + ctx.measureText(ENGINE_VERSION).width + margin <= available) {
    ctx.fillText(ENGINE_VERSION, width - margin, firstLineY)
  }

  // The detail lines: prior category, viewing duration, attribution. Left
  // aligned and wrapped, so none of them can end up under the disclaimer.
  ctx.fillStyle = 'rgba(255, 255, 255, 0.72)'
  ctx.font = `400 ${detailFont}px ${FONT_STACK}`
  ctx.textAlign = 'left'
  const detailLineHeight = Math.round(font * 1.3)
  lines.forEach((line, index) => {
    ctx.fillText(line, margin, firstLineY + detailLineHeight * (index + 1))
  })
  ctx.restore()
}

function roundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): void {
  const r = Math.min(radius, width / 2, height / 2)
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + width, y, x + width, y + height, r)
  ctx.arcTo(x + width, y + height, x, y + height, r)
  ctx.arcTo(x, y + height, x, y, r)
  ctx.arcTo(x, y, x + width, y, r)
  ctx.closePath()
}

export { FONT_STACK }

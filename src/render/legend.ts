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

/** Colour ramp bar with "kalt"/"heiß" end labels, drawn bottom-left. */
export function drawLegend(ctx: CanvasRenderingContext2D, width: number, height: number, title: string): void {
  const cfg = ENGINE_CONFIG.render.legend
  const font = uiScale(width, height)
  const pad = Math.round(Math.max(width, height) * cfg.paddingRatio)
  const barWidth = Math.round(width * cfg.barWidthRatio)
  const barHeight = Math.round(Math.max(6, Math.max(width, height) * cfg.barHeightRatio))

  const footerHeight = Math.round(font * 2.6)
  const boxHeight = Math.round(font * 1.4 + barHeight + font * 1.6)
  const boxWidth = barWidth + pad * 2
  const boxX = pad
  const boxY = height - footerHeight - pad - boxHeight

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
}

/** Full-width footer bar: engine version + disclaimer. */
export function drawFooter(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  options: FooterOptions = {},
): void {
  const font = uiScale(width, height)
  const barHeight = Math.round(font * 2.6)
  const y = height - barHeight

  ctx.save()
  ctx.fillStyle = 'rgba(0, 0, 0, 0.72)'
  ctx.fillRect(0, y, width, barHeight)

  ctx.textBaseline = 'middle'
  ctx.fillStyle = '#ffffff'
  ctx.font = `600 ${Math.round(font)}px ${FONT_STACK}`
  ctx.textAlign = 'left'
  ctx.fillText(DISCLAIMER_TEXT, Math.round(font), y + barHeight / 2)

  ctx.fillStyle = 'rgba(255, 255, 255, 0.6)'
  ctx.font = `400 ${Math.round(font * 0.85)}px ${FONT_STACK}`
  ctx.textAlign = 'right'
  const right = options.priorLabel
    ? `FigMaps · ${ENGINE_VERSION} · ${options.priorLabel}`
    : `FigMaps · ${ENGINE_VERSION}`
  ctx.fillText(right, width - Math.round(font), y + barHeight / 2)
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

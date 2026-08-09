/**
 * B-2 — fold markers.
 *
 * A thin dashed line with a small label at every viewport boundary, so a map
 * pulled out of Figma carries the information that the frame was analysed in
 * sections and where the cuts are.
 */
import { ENGINE_CONFIG } from '../engine/config'

/**
 * Label typeface. The fold markers are data — where the viewport cuts the frame
 * — not the chrome that was taken off the images, so they stay on the map.
 */
const FONT_STACK = 'Inter, "Helvetica Neue", Helvetica, Arial, sans-serif'

export type FoldOptions = {
  /** Fold positions in frame pixels. */
  folds: readonly number[]
  /** Frame height in frame pixels — the coordinate system of `folds`. */
  frameHeight: number
}

export function drawFoldLines(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  options: FoldOptions,
): void {
  if (options.folds.length === 0 || options.frameHeight <= 0) return

  const cfg = ENGINE_CONFIG.render.fold
  const longer = Math.max(width, height)
  const lineWidth = Math.max(cfg.minLineWidth, Math.round(longer * cfg.lineWidthRatio))
  const font = Math.max(cfg.minLabelFontSize, Math.round(longer * cfg.labelFontSizeRatio))
  const scale = height / options.frameHeight

  ctx.save()
  ctx.setLineDash([Math.round(width * cfg.dashRatio), Math.round(width * cfg.gapRatio)])
  ctx.lineWidth = lineWidth
  ctx.textBaseline = 'bottom'
  ctx.textAlign = 'left'
  ctx.font = `600 ${font}px ${FONT_STACK}`

  options.folds.forEach((fold, index) => {
    const y = Math.round(fold * scale) + 0.5
    if (y <= 0 || y >= height) return

    // Drawn twice: a dark line under a light one stays visible on both a
    // white hero and a dark footer.
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.55)'
    ctx.beginPath()
    ctx.moveTo(0, y)
    ctx.lineTo(width, y)
    ctx.stroke()

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)'
    ctx.beginPath()
    ctx.moveTo(0, y - lineWidth)
    ctx.lineTo(width, y - lineWidth)
    ctx.stroke()

    const label = `Fold ${index + 1}`
    ctx.save()
    ctx.setLineDash([])
    const padding = Math.round(font * 0.5)
    const textWidth = ctx.measureText(label).width
    ctx.fillStyle = 'rgba(0, 0, 0, 0.7)'
    ctx.fillRect(padding, y - font - padding * 1.4, textWidth + padding * 2, font + padding)
    ctx.fillStyle = '#ffffff'
    ctx.fillText(label, padding * 2, y - padding * 0.6)
    ctx.restore()
  })

  ctx.restore()
}

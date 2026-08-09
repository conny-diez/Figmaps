/**
 * FR-5 step 5 — clickmap rendering: one radial blob per interactive candidate,
 * radius proportional to the predicted click share, plus a percent label.
 */
import type { ClickCandidate } from '../engine/clickmap'
import { ENGINE_CONFIG } from '../engine/config'
import { context2d, createCanvas } from './canvas'
import { turbo } from './colormap'
import { drawFoldLines } from './folds'

/** Label typeface — the percentages are part of the prediction, not chrome. */
const FONT_STACK = 'Inter, "Helvetica Neue", Helvetica, Arial, sans-serif'

export type ClickmapOptions = {
  /** Blob opacity, `0..1`. */
  opacity: number
  /** Frame size in frame pixels — candidates carry frame-pixel geometry. */
  frameWidth: number
  frameHeight: number
  /** B-2 — fold positions in frame pixels. */
  folds?: readonly number[]
}

export function renderClickmap(
  base: CanvasImageSource,
  candidates: readonly ClickCandidate[],
  width: number,
  height: number,
  options: ClickmapOptions,
): HTMLCanvasElement {
  const cfg = ENGINE_CONFIG.render.clickBlob
  const canvas = createCanvas(width, height)
  const ctx = context2d(canvas)

  // Dim the original so the blobs read clearly without hiding the layout.
  ctx.drawImage(base, 0, 0, canvas.width, canvas.height)
  ctx.fillStyle = 'rgba(0, 0, 0, 0.35)'
  ctx.fillRect(0, 0, canvas.width, canvas.height)

  const sx = canvas.width / options.frameWidth
  const sy = canvas.height / options.frameHeight
  const longer = Math.max(canvas.width, canvas.height)
  const maxScore = candidates.reduce((max, candidate) => Math.max(max, candidate.score), 0)

  // Weakest first, so the top candidate ends up on top.
  const ordered = [...candidates].sort((a, b) => a.score - b.score)

  for (const candidate of ordered) {
    const cx = (candidate.x + candidate.width / 2) * sx
    const cy = (candidate.y + candidate.height / 2) * sy
    const relative = maxScore > 0 ? candidate.score / maxScore : 0
    const elementRadius = Math.max(candidate.width * sx, candidate.height * sy) * cfg.elementRadiusFactor
    const radius = Math.max(
      longer * cfg.minRadiusRatio,
      Math.min(longer * cfg.maxRadiusRatio, elementRadius, longer * cfg.minRadiusRatio + relative * longer * cfg.maxRadiusRatio),
    )

    const [r, g, b] = turbo(0.25 + 0.75 * relative)
    const gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius)
    gradient.addColorStop(0, `rgba(${r}, ${g}, ${b}, ${options.opacity})`)
    gradient.addColorStop(0.6, `rgba(${r}, ${g}, ${b}, ${options.opacity * 0.45})`)
    gradient.addColorStop(1, `rgba(${r}, ${g}, ${b}, 0)`)
    ctx.fillStyle = gradient
    ctx.beginPath()
    ctx.arc(cx, cy, radius, 0, Math.PI * 2)
    ctx.fill()
  }

  const font = Math.max(cfg.minLabelFontSize, Math.round(longer * cfg.labelFontSizeRatio))
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  for (const candidate of candidates) {
    const cx = (candidate.x + candidate.width / 2) * sx
    const cy = (candidate.y + candidate.height / 2) * sy
    const label = `${Math.round(candidate.score * 100)}%`
    ctx.font = `700 ${font}px ${FONT_STACK}`
    const padding = font * 0.45
    const textWidth = ctx.measureText(label).width
    ctx.fillStyle = 'rgba(0, 0, 0, 0.75)'
    ctx.fillRect(cx - textWidth / 2 - padding, cy - font * 0.75, textWidth + padding * 2, font * 1.5)
    ctx.fillStyle = '#ffffff'
    ctx.fillText(label, cx, cy)
  }

  if (options.folds && options.folds.length > 0) {
    drawFoldLines(ctx, canvas.width, canvas.height, { folds: options.folds, frameHeight: options.frameHeight })
  }

  return canvas
}


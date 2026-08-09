/**
 * FR-6 — focusmap: the screen dimmed, desaturated and blurred, with only the
 * top attention regions punched back through in colour and focus.
 *
 * Purely compositional — it consumes the heatmap result, it does not predict.
 */
import { ENGINE_CONFIG } from '../engine/config'
import { percentile } from '../engine/imageops'
import type { ScalarMap } from '../engine/types'
import { context2d, createCanvas, drawScalarLayer } from './canvas'
import { drawFoldLines } from './folds'

export type FocusmapOptions = {
  /**
   * Percentile the falloff is anchored at. Defaults to
   * `ENGINE_CONFIG.focus.percentile`, which is what the plugin uses — the
   * parameter stays so the eval harness can sweep it without touching the
   * config.
   */
  threshold?: number
  /** Exponent of the falloff. Defaults to `ENGINE_CONFIG.focus.falloffGamma`. */
  gamma?: number
  /** B-2 — fold positions in frame pixels. */
  folds?: readonly number[]
  /** Frame height in frame pixels, required when `folds` is given. */
  frameHeight?: number
}

/**
 * Visibility mask from the attention map — a continuous falloff, not a cut.
 *
 * `alpha = min(1, (v / anchor)^gamma)` with `anchor` the value at
 * `focus.percentile`. Everything at or above the anchor is fully sharp; below
 * it the screen keeps a share of its visibility *proportional to the predicted
 * attention*, so the focusmap and the heatmap rank the same regions the same
 * way. The old binary version could not: a moderately warm area was either in
 * or out, which read as „not seen at all".
 *
 * `anchor` can be 0 on a degenerate map (everything zero) — then nothing is
 * distinguishable and the whole frame is drawn sharp rather than dark, which is
 * the honest answer for „no prediction to show".
 */
export function focusAlpha(map: ScalarMap, threshold: number, gamma: number): Uint8ClampedArray {
  const anchor = percentile(map.values, threshold)
  const rgba = new Uint8ClampedArray(map.width * map.height * 4)
  for (let i = 0, p = 0; i < map.values.length; i++, p += 4) {
    const t = anchor > 0 ? Math.min(1, Math.pow(Math.max(0, map.values[i]) / anchor, gamma)) : 1
    rgba[p] = 255
    rgba[p + 1] = 255
    rgba[p + 2] = 255
    rgba[p + 3] = Math.round(255 * t)
  }
  return rgba
}

export function renderFocusmap(
  base: CanvasImageSource,
  map: ScalarMap,
  width: number,
  height: number,
  options: FocusmapOptions = {},
): HTMLCanvasElement {
  const cfg = ENGINE_CONFIG.focus
  const threshold = options.threshold ?? cfg.percentile
  const gamma = options.gamma ?? cfg.falloffGamma
  const longer = Math.max(width, height)
  const backgroundBlur = Math.max(1, Math.round(longer * cfg.blurSigmaRatio))
  const featherBlur = Math.max(1, Math.round(longer * cfg.maskFeatherRatio))

  // 1) dimmed, greyscale, blurred background
  const canvas = createCanvas(width, height)
  const ctx = context2d(canvas)
  ctx.save()
  ctx.filter = `grayscale(1) brightness(${cfg.dimBrightness}) blur(${backgroundBlur}px)`
  ctx.drawImage(base, 0, 0, canvas.width, canvas.height)
  ctx.restore()

  // 2) the sharp original, weighted by the attention mask
  const sharp = createCanvas(width, height)
  const sharpCtx = context2d(sharp)
  sharpCtx.drawImage(base, 0, 0, sharp.width, sharp.height)

  const mask = createCanvas(width, height)
  const maskCtx = context2d(mask)
  maskCtx.save()
  maskCtx.filter = `blur(${featherBlur}px)`
  drawScalarLayer(maskCtx, map.width, map.height, focusAlpha(map, threshold, gamma), mask.width, mask.height)
  maskCtx.restore()

  sharpCtx.globalCompositeOperation = 'destination-in'
  sharpCtx.drawImage(mask, 0, 0)
  sharpCtx.globalCompositeOperation = 'source-over'

  // 3) composite
  ctx.drawImage(sharp, 0, 0)

  if (options.folds && options.folds.length > 0 && options.frameHeight) {
    drawFoldLines(ctx, canvas.width, canvas.height, { folds: options.folds, frameHeight: options.frameHeight })
  }

  return canvas
}

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
import { drawFooter } from './legend'

export type FocusmapOptions = {
  /** Percentile threshold, 60–95 (FR-10). */
  threshold: number
}

/** Binary-ish mask alpha from the attention map, feathered by the blur below. */
export function focusMaskAlpha(map: ScalarMap, threshold: number): Uint8ClampedArray {
  const cutoff = percentile(map.values, threshold)
  // A soft shoulder below the cutoff avoids a hard stair-step after upscaling.
  const shoulder = Math.max(1e-4, (1 - cutoff) * 0.25)
  const rgba = new Uint8ClampedArray(map.width * map.height * 4)
  for (let i = 0, p = 0; i < map.values.length; i++, p += 4) {
    const v = map.values[i]
    const t = v <= cutoff - shoulder ? 0 : v >= cutoff ? 1 : (v - (cutoff - shoulder)) / shoulder
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
  options: FocusmapOptions,
): HTMLCanvasElement {
  const cfg = ENGINE_CONFIG.focus
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

  // 2) the sharp original, clipped to the feathered attention mask
  const sharp = createCanvas(width, height)
  const sharpCtx = context2d(sharp)
  sharpCtx.drawImage(base, 0, 0, sharp.width, sharp.height)

  const mask = createCanvas(width, height)
  const maskCtx = context2d(mask)
  maskCtx.save()
  maskCtx.filter = `blur(${featherBlur}px)`
  drawScalarLayer(maskCtx, map.width, map.height, focusMaskAlpha(map, options.threshold), mask.width, mask.height)
  maskCtx.restore()

  sharpCtx.globalCompositeOperation = 'destination-in'
  sharpCtx.drawImage(mask, 0, 0)
  sharpCtx.globalCompositeOperation = 'source-over'

  // 3) composite
  ctx.drawImage(sharp, 0, 0)
  drawFooter(ctx, canvas.width, canvas.height)
  return canvas
}

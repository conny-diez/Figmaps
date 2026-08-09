/**
 * FR-7 — heatmap rendering: Turbo overlay on top of the original screen.
 *
 * Nothing but the prediction is painted onto the screenshot. Title, disclaimer,
 * prediction parameters and the CC BY notice are Figma text nodes placed around
 * the image (`figma/place.ts`) — see there for why.
 */
import { ENGINE_CONFIG } from '../engine/config'
import type { ScalarMap } from '../engine/types'
import { context2d, createCanvas, drawScalarLayer } from './canvas'
import { turbo } from './colormap'
import { drawFoldLines } from './folds'

export type HeatmapOptions = {
  /** Overlay opacity, `0..1`. */
  opacity: number
  /** B-2 — fold positions in frame pixels, drawn as dashed markers. */
  folds?: readonly number[]
  /** Frame height in frame pixels, required when `folds` is given. */
  frameHeight?: number
  /**
   * B-2 — region of `base` to draw, in source pixels. The above-the-fold map
   * covers only the first section, so the screenshot must be *cropped*, not
   * squashed into the shorter canvas.
   */
  sourceRect?: { x: number; y: number; width: number; height: number }
}

/** Colour-maps a scalar field into RGBA, with cold regions fully transparent. */
export function heatmapToRgba(map: ScalarMap, opacity: number): Uint8ClampedArray {
  const { transparencyCutoff, transparencyRamp } = ENGINE_CONFIG.render
  const rgba = new Uint8ClampedArray(map.width * map.height * 4)
  for (let i = 0, p = 0; i < map.values.length; i++, p += 4) {
    const v = map.values[i]
    if (v < transparencyCutoff) continue
    const [r, g, b] = turbo(v)
    const ramp = transparencyRamp > 0 ? Math.min(1, (v - transparencyCutoff) / transparencyRamp) : 1
    rgba[p] = r
    rgba[p + 1] = g
    rgba[p + 2] = b
    rgba[p + 3] = Math.round(255 * opacity * ramp)
  }
  return rgba
}

export function renderHeatmap(
  base: CanvasImageSource,
  map: ScalarMap,
  width: number,
  height: number,
  options: HeatmapOptions,
): HTMLCanvasElement {
  const canvas = createCanvas(width, height)
  const ctx = context2d(canvas)
  if (options.sourceRect) {
    const { x, y, width: sw, height: sh } = options.sourceRect
    ctx.drawImage(base, x, y, sw, sh, 0, 0, canvas.width, canvas.height)
  } else {
    ctx.drawImage(base, 0, 0, canvas.width, canvas.height)
  }

  const rgba = heatmapToRgba(map, options.opacity)
  drawScalarLayer(ctx, map.width, map.height, rgba, canvas.width, canvas.height)

  if (options.folds && options.folds.length > 0 && options.frameHeight) {
    drawFoldLines(ctx, canvas.width, canvas.height, { folds: options.folds, frameHeight: options.frameHeight })
  }

  return canvas
}

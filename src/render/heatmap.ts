/**
 * FR-7 — heatmap rendering: Turbo overlay on top of the original screen,
 * with legend and disclaimer footer.
 */
import { ENGINE_CONFIG } from '../engine/config'
import type { ScalarMap } from '../engine/types'
import { context2d, createCanvas, drawScalarLayer } from './canvas'
import { turbo } from './colormap'
import { drawFooter, drawLegend } from './legend'

export type HeatmapOptions = {
  /** Overlay opacity, `0..1`. */
  opacity: number
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
  ctx.drawImage(base, 0, 0, canvas.width, canvas.height)

  const rgba = heatmapToRgba(map, options.opacity)
  drawScalarLayer(ctx, map.width, map.height, rgba, canvas.width, canvas.height)

  drawLegend(ctx, canvas.width, canvas.height, 'Heatmap — vorhergesagte Aufmerksamkeit')
  drawFooter(ctx, canvas.width, canvas.height)
  return canvas
}

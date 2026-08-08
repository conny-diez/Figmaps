/**
 * A-1 — the platform-independent half of `ImageOps`.
 *
 * Pure JavaScript, no DOM, no Node built-ins: both the iframe and the eval
 * harness use *these* functions, so a resize in the browser and a resize in
 * Node produce bit-identical output.
 */
import { gaussianBlur } from './imageops'
import type { Bitmap } from './ops'
import type { Rect } from './types'

/** One destination sample: the source range it averages and the weights. */
type Tap = { start: number; weights: Float64Array }

/**
 * Builds the resampling taps for one axis.
 *
 * Box filter with a support of `max(1, scale)` source pixels — i.e. proper area
 * averaging when downscaling (every source pixel contributes exactly once) and
 * a one-pixel box when upscaling. Weights use `Float64Array` so the result does
 * not depend on the accumulation order.
 */
function buildTaps(srcSize: number, dstSize: number): Tap[] {
  const scale = srcSize / dstSize
  const support = Math.max(1, scale) / 2
  const taps: Tap[] = []

  for (let i = 0; i < dstSize; i++) {
    const center = (i + 0.5) * scale
    const lo = Math.max(0, Math.floor(center - support))
    const hi = Math.min(srcSize, Math.ceil(center + support))
    const count = Math.max(1, hi - lo)
    const weights = new Float64Array(count)

    let total = 0
    for (let k = 0; k < count; k++) {
      const s = lo + k
      // Overlap of the source pixel [s, s+1) with the destination footprint.
      const overlap = Math.min(s + 1, center + support) - Math.max(s, center - support)
      const w = overlap > 0 ? overlap : 0
      weights[k] = w
      total += w
    }
    if (total <= 0) {
      weights[0] = 1
      total = 1
    }
    for (let k = 0; k < count; k++) weights[k] /= total

    taps.push({ start: lo, weights })
  }
  return taps
}

/**
 * Separable area-averaged rescale of an RGBA bitmap.
 *
 * Alpha is *not* premultiplied: Figma frame exports are opaque, and
 * premultiplying would make the browser and Node paths disagree on
 * fully transparent pixels.
 */
export function resizeBitmap(src: Bitmap, width: number, height: number): Bitmap {
  const dstWidth = Math.max(1, Math.round(width))
  const dstHeight = Math.max(1, Math.round(height))
  if (dstWidth === src.width && dstHeight === src.height) {
    return { width: src.width, height: src.height, data: Uint8ClampedArray.from(src.data) }
  }

  // Horizontal pass into a Float64 intermediate — rounding only happens once.
  const xTaps = buildTaps(src.width, dstWidth)
  const tmp = new Float64Array(dstWidth * src.height * 4)
  for (let y = 0; y < src.height; y++) {
    const srcRow = y * src.width * 4
    const dstRow = y * dstWidth * 4
    for (let x = 0; x < dstWidth; x++) {
      const tap = xTaps[x]
      let r = 0
      let g = 0
      let b = 0
      let a = 0
      for (let k = 0; k < tap.weights.length; k++) {
        const p = srcRow + (tap.start + k) * 4
        const w = tap.weights[k]
        r += src.data[p] * w
        g += src.data[p + 1] * w
        b += src.data[p + 2] * w
        a += src.data[p + 3] * w
      }
      const q = dstRow + x * 4
      tmp[q] = r
      tmp[q + 1] = g
      tmp[q + 2] = b
      tmp[q + 3] = a
    }
  }

  const yTaps = buildTaps(src.height, dstHeight)
  const out = new Uint8ClampedArray(dstWidth * dstHeight * 4)
  for (let y = 0; y < dstHeight; y++) {
    const tap = yTaps[y]
    const dstRow = y * dstWidth * 4
    for (let x = 0; x < dstWidth; x++) {
      let r = 0
      let g = 0
      let b = 0
      let a = 0
      for (let k = 0; k < tap.weights.length; k++) {
        const p = (tap.start + k) * dstWidth * 4 + x * 4
        const w = tap.weights[k]
        r += tmp[p] * w
        g += tmp[p + 1] * w
        b += tmp[p + 2] * w
        a += tmp[p + 3] * w
      }
      const q = dstRow + x * 4
      // `Math.round` (not the implicit Uint8ClampedArray rounding, which is
      // round-half-to-even) so the result is trivially reproducible.
      out[q] = Math.round(r)
      out[q + 1] = Math.round(g)
      out[q + 2] = Math.round(b)
      out[q + 3] = Math.round(a)
    }
  }

  return { width: dstWidth, height: dstHeight, data: out }
}

/** Copies an axis-aligned region out of a bitmap, clamped to its bounds. */
export function cropBitmap(src: Bitmap, rect: Rect): Bitmap {
  const x0 = Math.max(0, Math.min(src.width - 1, Math.round(rect.x)))
  const y0 = Math.max(0, Math.min(src.height - 1, Math.round(rect.y)))
  const x1 = Math.max(x0 + 1, Math.min(src.width, Math.round(rect.x + rect.width)))
  const y1 = Math.max(y0 + 1, Math.min(src.height, Math.round(rect.y + rect.height)))
  const width = x1 - x0
  const height = y1 - y0

  const out = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y++) {
    const from = ((y0 + y) * src.width + x0) * 4
    out.set(src.data.subarray(from, from + width * 4), y * width * 4)
  }
  return { width, height, data: out }
}

/** Scales `width`/`height` down so the longer edge fits `maxEdge`. */
export function fitWithin(width: number, height: number, maxEdge: number): { width: number; height: number } {
  const longer = Math.max(width, height)
  if (longer <= maxEdge) return { width: Math.max(1, Math.round(width)), height: Math.max(1, Math.round(height)) }
  const factor = maxEdge / longer
  return {
    width: Math.max(1, Math.round(width * factor)),
    height: Math.max(1, Math.round(height * factor)),
  }
}

/**
 * Size of the bitmap the analysis crops sections out of (Epic B).
 *
 * Bounded on *width* rather than on the longer edge: a tall scroll page must
 * keep enough horizontal resolution that every section can still be sampled
 * down to the analysis grid. `maxPixels` is the memory guard on top.
 */
export function analysisSourceSize(
  width: number,
  height: number,
  maxWidth: number,
  maxPixels: number,
): { width: number; height: number } {
  let factor = width > maxWidth ? maxWidth / width : 1
  const pixels = width * factor * (height * factor)
  if (pixels > maxPixels) factor *= Math.sqrt(maxPixels / pixels)
  return {
    width: Math.max(1, Math.round(width * factor)),
    height: Math.max(1, Math.round(height * factor)),
  }
}

/** The shared blur — re-exported so both `ImageOps` implementations agree. */
export const blurField = gaussianBlur

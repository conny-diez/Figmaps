/**
 * Small, dependency-free image primitives operating on `Float32Array` grids.
 *
 * Everything here is deterministic: no `Math.random`, no time, no floating
 * point reduction that depends on iteration order (NFR-6).
 */
import type { ImageLike, Rect } from './types'

/** sRGB -> relative luminance weights (Rec. 709). */
const LUMA_R = 0.2126
const LUMA_G = 0.7152
const LUMA_B = 0.0722

/** Extracts the perceptual luminance channel, normalised to `[0,1]`. */
export function luminanceChannel(image: ImageLike): Float32Array {
  const { width, height, data } = image
  const out = new Float32Array(width * height)
  for (let i = 0, p = 0; i < out.length; i++, p += 4) {
    out[i] = (LUMA_R * data[p] + LUMA_G * data[p + 1] + LUMA_B * data[p + 2]) / 255
  }
  return out
}

/**
 * Red-Green and Blue-Yellow opponent channels, each in `[-1,1]`.
 * Mirrors the classic Itti-Koch colour opponency formulation.
 */
export function opponentChannels(image: ImageLike): { redGreen: Float32Array; blueYellow: Float32Array } {
  const { width, height, data } = image
  const n = width * height
  const redGreen = new Float32Array(n)
  const blueYellow = new Float32Array(n)
  for (let i = 0, p = 0; i < n; i++, p += 4) {
    const r = data[p] / 255
    const g = data[p + 1] / 255
    const b = data[p + 2] / 255
    redGreen[i] = r - g
    blueYellow[i] = b - (r + g) / 2
  }
  return { redGreen, blueYellow }
}

/**
 * Separable Gaussian blur with clamped (edge-extended) borders.
 * Kernel radius is `ceil(3 * sigma)`, which captures >99.7% of the mass.
 */
export function gaussianBlur(src: Float32Array, width: number, height: number, sigma: number): Float32Array {
  if (sigma <= 0) return Float32Array.from(src)

  const radius = Math.max(1, Math.ceil(sigma * 3))
  const kernel = new Float32Array(radius * 2 + 1)
  let sum = 0
  const denom = 2 * sigma * sigma
  for (let i = -radius; i <= radius; i++) {
    const v = Math.exp(-(i * i) / denom)
    kernel[i + radius] = v
    sum += v
  }
  for (let i = 0; i < kernel.length; i++) kernel[i] /= sum

  const tmp = new Float32Array(width * height)
  for (let y = 0; y < height; y++) {
    const row = y * width
    for (let x = 0; x < width; x++) {
      let acc = 0
      for (let k = -radius; k <= radius; k++) {
        let xx = x + k
        if (xx < 0) xx = 0
        else if (xx >= width) xx = width - 1
        acc += src[row + xx] * kernel[k + radius]
      }
      tmp[row + x] = acc
    }
  }

  const out = new Float32Array(width * height)
  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y++) {
      let acc = 0
      for (let k = -radius; k <= radius; k++) {
        let yy = y + k
        if (yy < 0) yy = 0
        else if (yy >= height) yy = height - 1
        acc += tmp[yy * width + x] * kernel[k + radius]
      }
      out[y * width + x] = acc
    }
  }
  return out
}

/** Difference of Gaussians (center-surround), returned as absolute response. */
export function differenceOfGaussians(
  src: Float32Array,
  width: number,
  height: number,
  centerSigma: number,
  surroundSigma: number,
): Float32Array {
  const center = gaussianBlur(src, width, height, centerSigma)
  const surround = gaussianBlur(src, width, height, surroundSigma)
  const out = new Float32Array(src.length)
  for (let i = 0; i < out.length; i++) out[i] = Math.abs(center[i] - surround[i])
  return out
}

/** Sobel gradient magnitude with clamped borders. */
export function sobelMagnitude(src: Float32Array, width: number, height: number): Float32Array {
  const out = new Float32Array(width * height)
  const at = (x: number, y: number): number => {
    const cx = x < 0 ? 0 : x >= width ? width - 1 : x
    const cy = y < 0 ? 0 : y >= height ? height - 1 : y
    return src[cy * width + cx]
  }
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const tl = at(x - 1, y - 1)
      const tc = at(x, y - 1)
      const tr = at(x + 1, y - 1)
      const ml = at(x - 1, y)
      const mr = at(x + 1, y)
      const bl = at(x - 1, y + 1)
      const bc = at(x, y + 1)
      const br = at(x + 1, y + 1)
      const gx = tl + 2 * ml + bl - (tr + 2 * mr + br)
      const gy = tl + 2 * tc + tr - (bl + 2 * bc + br)
      out[y * width + x] = Math.sqrt(gx * gx + gy * gy)
    }
  }
  return out
}

/**
 * Min-max normalisation into `[0,1]`.
 * A constant input yields an all-zero map (a flat field carries no salience).
 */
export function normalize01(src: Float32Array): Float32Array {
  let min = Infinity
  let max = -Infinity
  for (let i = 0; i < src.length; i++) {
    const v = src[i]
    if (v < min) min = v
    if (v > max) max = v
  }
  const out = new Float32Array(src.length)
  const range = max - min
  if (!(range > 1e-9)) return out
  for (let i = 0; i < src.length; i++) out[i] = (src[i] - min) / range
  return out
}

/** Value at the given quantile (`0..1`) of an ascending-sorted array. */
export function quantileOfSorted(sorted: Float32Array, q: number): number {
  if (sorted.length === 0) return 0
  const clamped = q < 0 ? 0 : q > 1 ? 1 : q
  const pos = clamped * (sorted.length - 1)
  const lo = Math.floor(pos)
  const hi = Math.ceil(pos)
  if (lo === hi) return sorted[lo]
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo)
}

/** Percentile of a (possibly unsorted) map — copies before sorting. */
export function percentile(src: Float32Array, pct: number): number {
  const sorted = Float32Array.from(src).sort()
  return quantileOfSorted(sorted, pct / 100)
}

/**
 * Normalises into `[0,1]` after clipping to the given percentiles, so a single
 * outlier cannot compress the whole scale (FR-4, post-processing step 3).
 */
export function percentileClipNormalize(src: Float32Array, lowPct: number, highPct: number): Float32Array {
  const sorted = Float32Array.from(src).sort()
  const lo = quantileOfSorted(sorted, lowPct / 100)
  const hi = quantileOfSorted(sorted, highPct / 100)
  const out = new Float32Array(src.length)
  const range = hi - lo
  if (!(range > 1e-9)) return out
  for (let i = 0; i < src.length; i++) {
    const v = (src[i] - lo) / range
    out[i] = v < 0 ? 0 : v > 1 ? 1 : v
  }
  return out
}

/** In-place-safe gamma correction of a `[0,1]` map. */
export function applyGamma(src: Float32Array, gamma: number): Float32Array {
  const out = new Float32Array(src.length)
  if (gamma === 1) return Float32Array.from(src)
  for (let i = 0; i < src.length; i++) {
    const v = src[i]
    out[i] = v <= 0 ? 0 : Math.pow(v, gamma)
  }
  return out
}

/** Weighted sum of equally sized maps. */
export function weightedSum(entries: ReadonlyArray<{ map: Float32Array; weight: number }>, length: number): Float32Array {
  const out = new Float32Array(length)
  for (const { map, weight } of entries) {
    if (weight === 0) continue
    for (let i = 0; i < length; i++) out[i] += map[i] * weight
  }
  return out
}

/**
 * Paints rectangles onto a grid, keeping the maximum where they overlap so a
 * stack of nested elements does not accumulate into an artificial hotspot.
 */
export function rasterizeRects(
  width: number,
  height: number,
  rects: ReadonlyArray<{ rect: Rect; intensity: number }>,
): Float32Array {
  const out = new Float32Array(width * height)
  for (const { rect, intensity } of rects) {
    if (intensity <= 0) continue
    const x0 = Math.max(0, Math.floor(rect.x))
    const y0 = Math.max(0, Math.floor(rect.y))
    const x1 = Math.min(width, Math.ceil(rect.x + rect.width))
    const y1 = Math.min(height, Math.ceil(rect.y + rect.height))
    for (let y = y0; y < y1; y++) {
      const row = y * width
      for (let x = x0; x < x1; x++) {
        if (out[row + x] < intensity) out[row + x] = intensity
      }
    }
  }
  return out
}

/** Mean of a map inside a rectangle; returns 0 for empty intersections. */
export function meanInRect(src: Float32Array, width: number, height: number, rect: Rect): number {
  const x0 = Math.max(0, Math.floor(rect.x))
  const y0 = Math.max(0, Math.floor(rect.y))
  const x1 = Math.min(width, Math.ceil(rect.x + rect.width))
  const y1 = Math.min(height, Math.ceil(rect.y + rect.height))
  if (x1 <= x0 || y1 <= y0) return 0
  let sum = 0
  let count = 0
  for (let y = y0; y < y1; y++) {
    const row = y * width
    for (let x = x0; x < x1; x++) {
      sum += src[row + x]
      count++
    }
  }
  return count === 0 ? 0 : sum / count
}

/** Bilinear sample of a scalar map at fractional coordinates. */
export function sampleBilinear(src: Float32Array, width: number, height: number, x: number, y: number): number {
  const cx = x < 0 ? 0 : x > width - 1 ? width - 1 : x
  const cy = y < 0 ? 0 : y > height - 1 ? height - 1 : y
  const x0 = Math.floor(cx)
  const y0 = Math.floor(cy)
  const x1 = Math.min(width - 1, x0 + 1)
  const y1 = Math.min(height - 1, y0 + 1)
  const fx = cx - x0
  const fy = cy - y0
  const top = src[y0 * width + x0] * (1 - fx) + src[y0 * width + x1] * fx
  const bottom = src[y1 * width + x0] * (1 - fx) + src[y1 * width + x1] * fx
  return top * (1 - fy) + bottom * fy
}

/** Cooperative yield so the iframe stays responsive (NFR-3). */
export function yieldToUi(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

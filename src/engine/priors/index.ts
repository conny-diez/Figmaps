/**
 * Data-estimated location priors.
 *
 * `heuristic-v1` uses an analytical F-pattern bell (`features/prior.ts`). The
 * diagnosis on UEyes showed that this bell is the single largest part of the
 * engine's deficit: an empirically estimated location prior beats it clearly,
 * and giving the analytical one *more* weight makes the prediction worse, not
 * better. `hybrid-v1` therefore replaces it with a small greyscale map averaged
 * over a reference set, and lays the image analysis on top additively.
 *
 * The maps are tiny on purpose — a location prior is smooth, so a coarse grid
 * plus bilinear upsampling loses nothing measurable and keeps the plugin
 * bundle small. Stored as base64 of raw 8-bit greyscale, decoded with a
 * self-contained decoder: `atob` is not guaranteed in the Figma main thread,
 * and a PNG would drag the canvas into a module the engine must stay free of.
 *
 * ATTRIBUTION: the shipped maps are derived from UEyes (CC BY 4.0). See
 * `NOTICE.md` — distributing them requires naming the authors.
 */
import { ENGINE_CONFIG } from '../config'
import { sampleBilinear } from '../imageops'
import { PRIOR_ASSETS } from './generated'

const DESKTOP_MIN_WIDTH = ENGINE_CONFIG.viewport.desktopMinWidth

/** Which reference population a prior was estimated from. */
export type PriorAssetId = 'web' | 'mobile'

export type PriorAsset = {
  width: number
  height: number
  /** Base64 of `width * height` raw 8-bit greyscale samples, row-major. */
  data: string
  /** Where it came from — reproduced in the attribution. */
  source: string
  /** How many ground-truth maps were averaged. */
  count: number
}

const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

/** Minimal base64 decoder — no `atob`, no `Buffer`, works in every realm. */
export function decodeBase64(input: string): Uint8Array {
  const lookup = new Int16Array(128).fill(-1)
  for (let i = 0; i < BASE64_ALPHABET.length; i++) lookup[BASE64_ALPHABET.charCodeAt(i)] = i

  const clean = input.replace(/[^A-Za-z0-9+/]/g, '')
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4))

  let bits = 0
  let accumulator = 0
  let cursor = 0
  for (let i = 0; i < clean.length; i++) {
    const value = lookup[clean.charCodeAt(i)]
    if (value < 0) continue
    accumulator = (accumulator << 6) | value
    bits += 6
    if (bits >= 8) {
      bits -= 8
      out[cursor++] = (accumulator >> bits) & 0xff
    }
  }
  return cursor === out.length ? out : out.subarray(0, cursor)
}

/**
 * Picks the prior for a frame.
 *
 * Inside the plugin the geometry is *design* pixels, where the same width
 * threshold that decides the viewport height (B-1) is a reliable mobile signal:
 * a phone frame is 360–430 px wide, a desktop frame 1024 px or more, and a long
 * desktop scroll page stays wide however tall it gets.
 *
 * This does **not** generalise to raw screenshots — UEyes stores phone captures
 * at 1080x1920 device pixels, which this rule would call desktop. The eval
 * harness therefore states the category explicitly instead of inferring it
 * (`EngineOptions.priorAsset`).
 */
export function priorAssetIdFor(frameWidth: number, _frameHeight: number): PriorAssetId {
  return frameWidth >= DESKTOP_MIN_WIDTH ? 'web' : 'mobile'
}

export function hasPriorAsset(id: PriorAssetId): boolean {
  return PRIOR_ASSETS[id] !== undefined
}

/**
 * True when the build carries derived UEyes data — and therefore when the
 * CC BY 4.0 attribution has to be visible. Note this does not depend on which
 * engine configuration is active: the asset is imported statically, so it ships
 * either way. See NOTICE.md.
 */
export function shipsPriorAsset(): boolean {
  return Object.keys(PRIOR_ASSETS).length > 0
}

/**
 * Decodes a prior and resamples it onto the analysis grid.
 *
 * Bilinear, not area-averaged: this is an *upsample* of a deliberately coarse,
 * smooth field, and area averaging would only reproduce the coarse steps.
 * Result is normalised to `[0,1]`.
 */
export function priorMap(id: PriorAssetId, width: number, height: number): Float32Array | null {
  const asset = PRIOR_ASSETS[id]
  if (!asset) return null

  const bytes = decodeBase64(asset.data)
  if (bytes.length < asset.width * asset.height) return null
  return resamplePrior(bytes, asset.width, asset.height, width, height)
}

/**
 * Turns quantised prior samples into a map on the target grid.
 *
 * Split out from `priorMap` so the cross-validation can feed a per-fold prior
 * through *exactly* the path the shipped asset takes — including the 8-bit
 * quantisation. Measuring a float prior and shipping a quantised one would be
 * measuring something else.
 */
export function resamplePrior(
  samples: Uint8Array,
  sourceWidth: number,
  sourceHeight: number,
  width: number,
  height: number,
): Float32Array {
  const source = new Float32Array(sourceWidth * sourceHeight)
  for (let i = 0; i < source.length; i++) source[i] = samples[i] / 255

  const out = new Float32Array(width * height)
  let max = 0
  for (let y = 0; y < height; y++) {
    // Map pixel centres onto the source grid, so the prior does not shift by
    // half a cell on small maps.
    const sy = ((y + 0.5) / height) * sourceHeight - 0.5
    for (let x = 0; x < width; x++) {
      const sx = ((x + 0.5) / width) * sourceWidth - 0.5
      const value = sampleBilinear(source, sourceWidth, sourceHeight, sx, sy)
      out[y * width + x] = value
      if (value > max) max = value
    }
  }
  if (max > 0) for (let i = 0; i < out.length; i++) out[i] /= max
  return out
}

export { PRIOR_ASSETS }

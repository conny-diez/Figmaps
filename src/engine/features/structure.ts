import type { NodeSignal } from '../../messages'
import { ENGINE_CONFIG } from '../config'
import { gaussianBlur, normalize01, rasterizeRects } from '../imageops'
import type { Rect } from '../types'

/** Maps a signal's frame-pixel geometry onto the analysis grid. */
export function signalRect(
  signal: NodeSignal,
  frameWidth: number,
  frameHeight: number,
  mapWidth: number,
  mapHeight: number,
): Rect {
  const sx = mapWidth / frameWidth
  const sy = mapHeight / frameHeight
  return {
    x: signal.x * sx,
    y: signal.y * sy,
    width: Math.max(1, signal.width * sx),
    height: Math.max(1, signal.height * sy),
  }
}

/** True when the node's name matched at least one interactive keyword. */
export function hasKeywordHit(signal: NodeSignal): boolean {
  return signal.nameHints.length > 0
}

/** True when the node is an interactive candidate by reaction or by name. */
export function isInteractive(signal: NodeSignal): boolean {
  return signal.hasReactions || hasKeywordHit(signal)
}

/**
 * FR-4 `textSalience`: text rectangles weighted by font size and font weight.
 * Large bold headlines dominate; small body copy contributes little.
 */
export function textSalience(
  signals: readonly NodeSignal[],
  frameWidth: number,
  frameHeight: number,
  mapWidth: number,
  mapHeight: number,
): Float32Array {
  const cfg = ENGINE_CONFIG.text
  const rects: Array<{ rect: Rect; intensity: number }> = []

  for (const signal of signals) {
    if (!signal.isText) continue
    const fontSize = signal.fontSize ?? cfg.minFontSize
    if (fontSize < cfg.minFontSize) continue

    const sizeFactor = Math.min(1, fontSize / cfg.referenceFontSize)
    const weightFactor = Math.pow(Math.max(1, signal.fontWeight ?? cfg.weightReference) / cfg.weightReference, cfg.weightExponent)
    // Longer runs of text read as blocks — slightly heavier, but sub-linear.
    const lengthFactor =
      1 + cfg.charCountInfluence * Math.min(1, (signal.charCount ?? 0) / cfg.charCountReference)

    const intensity = sizeFactor * weightFactor * lengthFactor * signal.opacity
    rects.push({ rect: signalRect(signal, frameWidth, frameHeight, mapWidth, mapHeight), intensity })
  }

  const raster = rasterizeRects(mapWidth, mapHeight, rects)
  const smoothed = gaussianBlur(raster, mapWidth, mapHeight, cfg.smoothSigma)
  return normalize01(smoothed)
}

/**
 * FR-4 `interactiveSalience`: rectangles of nodes carrying prototype reactions
 * or an interactive name hint. Real hotspots outrank guessed ones.
 */
export function interactiveSalience(
  signals: readonly NodeSignal[],
  frameWidth: number,
  frameHeight: number,
  mapWidth: number,
  mapHeight: number,
): Float32Array {
  const cfg = ENGINE_CONFIG.interactive
  const rects: Array<{ rect: Rect; intensity: number }> = []

  for (const signal of signals) {
    if (!isInteractive(signal)) continue
    const intensity = (signal.hasReactions ? cfg.reactionIntensity : cfg.keywordIntensity) * signal.opacity
    rects.push({ rect: signalRect(signal, frameWidth, frameHeight, mapWidth, mapHeight), intensity })
  }

  const raster = rasterizeRects(mapWidth, mapHeight, rects)
  const smoothed = gaussianBlur(raster, mapWidth, mapHeight, cfg.smoothSigma)
  return normalize01(smoothed)
}

/** FR-4 `imageSalience`: image nodes at a constant mid intensity. */
export function imageSalience(
  signals: readonly NodeSignal[],
  frameWidth: number,
  frameHeight: number,
  mapWidth: number,
  mapHeight: number,
): Float32Array {
  const cfg = ENGINE_CONFIG.image
  const rects: Array<{ rect: Rect; intensity: number }> = []

  for (const signal of signals) {
    if (!signal.isImage) continue
    rects.push({
      rect: signalRect(signal, frameWidth, frameHeight, mapWidth, mapHeight),
      intensity: cfg.intensity * signal.opacity,
    })
  }

  const raster = rasterizeRects(mapWidth, mapHeight, rects)
  const smoothed = gaussianBlur(raster, mapWidth, mapHeight, cfg.smoothSigma)
  return normalize01(smoothed)
}

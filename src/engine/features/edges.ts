import { ENGINE_CONFIG } from '../config'
import { gaussianBlur, luminanceChannel, normalize01, sobelMagnitude } from '../imageops'
import type { ImageLike } from '../types'

/**
 * FR-4 `edgeDensity`: Sobel magnitude smoothed into a local density —
 * busy regions (text blocks, dense UI) score higher than clean surfaces.
 */
export function edgeDensity(image: ImageLike, lum?: Float32Array): Float32Array {
  const { width, height } = image
  const channel = lum ?? luminanceChannel(image)
  const magnitude = sobelMagnitude(channel, width, height)
  const smoothed = gaussianBlur(magnitude, width, height, ENGINE_CONFIG.edges.smoothSigma)
  return normalize01(smoothed)
}

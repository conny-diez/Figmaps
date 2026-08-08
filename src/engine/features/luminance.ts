import { ENGINE_CONFIG } from '../config'
import { differenceOfGaussians, luminanceChannel, normalize01 } from '../imageops'
import type { ImageLike } from '../types'

/**
 * FR-4 `luminanceContrast`: center-surround difference of the luminance
 * channel (DoG). A uniform image produces a flat, all-zero map.
 */
export function luminanceContrast(image: ImageLike, lum?: Float32Array): Float32Array {
  const { width, height } = image
  const channel = lum ?? luminanceChannel(image)
  const { centerSigma, surroundSigma } = ENGINE_CONFIG.luminance
  const dog = differenceOfGaussians(channel, width, height, centerSigma, surroundSigma)
  return normalize01(dog)
}

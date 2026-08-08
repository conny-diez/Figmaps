import { ENGINE_CONFIG } from '../config'
import { differenceOfGaussians, normalize01, opponentChannels } from '../imageops'
import type { ImageLike } from '../types'

/**
 * FR-4 `colorOpponency`: red-green and blue-yellow opponency, each passed
 * through a center-surround filter and combined.
 *
 * Achromatic input (grey/white/black) produces a flat, all-zero map.
 */
export function colorOpponency(image: ImageLike): Float32Array {
  const { width, height } = image
  const { centerSigma, surroundSigma, redGreenWeight, blueYellowWeight } = ENGINE_CONFIG.color
  const { redGreen, blueYellow } = opponentChannels(image)

  const rg = differenceOfGaussians(redGreen, width, height, centerSigma, surroundSigma)
  const by = differenceOfGaussians(blueYellow, width, height, centerSigma, surroundSigma)

  const combined = new Float32Array(width * height)
  for (let i = 0; i < combined.length; i++) {
    combined[i] = rg[i] * redGreenWeight + by[i] * blueYellowWeight
  }
  return normalize01(combined)
}

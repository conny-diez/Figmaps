import { ENGINE_CONFIG } from '../config'

/** Mutable view of `ENGINE_CONFIG.prior` so callers can override single fields. */
export type PriorConfig = {
  centerX: number
  centerY: number
  sigmaLeft: number
  sigmaRight: number
  sigmaUp: number
  sigmaDown: number
  floor: number
  mirrorHorizontally: boolean
}

/**
 * FR-4 `positionPrior`: anisotropic 2D falloff approximating the F-pattern of
 * western reading direction — peak upper-left of centre, slower decay to the
 * right and downwards.
 *
 * Purely geometric: identical for every screen of the same aspect ratio.
 */
export function positionPrior(
  width: number,
  height: number,
  config: PriorConfig = ENGINE_CONFIG.prior,
): Float32Array {
  const out = new Float32Array(width * height)
  const cx = config.mirrorHorizontally ? 1 - config.centerX : config.centerX
  const cy = config.centerY
  const sigmaLeft = config.mirrorHorizontally ? config.sigmaRight : config.sigmaLeft
  const sigmaRight = config.mirrorHorizontally ? config.sigmaLeft : config.sigmaRight

  for (let y = 0; y < height; y++) {
    // Pixel centres, so the prior does not shift by half a pixel on small maps.
    const ny = (y + 0.5) / height
    const dy = ny - cy
    const sy = dy < 0 ? config.sigmaUp : config.sigmaDown
    const ey = (dy * dy) / (2 * sy * sy)
    const row = y * width
    for (let x = 0; x < width; x++) {
      const nx = (x + 0.5) / width
      const dx = nx - cx
      const sx = dx < 0 ? sigmaLeft : sigmaRight
      const ex = (dx * dx) / (2 * sx * sx)
      const v = Math.exp(-(ex + ey))
      out[row + x] = config.floor + (1 - config.floor) * v
    }
  }
  return out
}

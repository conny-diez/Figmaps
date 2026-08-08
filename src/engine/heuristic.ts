import { ENGINE_CONFIG, ENGINE_VERSION } from './config'
import { colorOpponency } from './features/color'
import { edgeDensity } from './features/edges'
import { luminanceContrast } from './features/luminance'
import { positionPrior } from './features/prior'
import { imageSalience, interactiveSalience, textSalience } from './features/structure'
import {
  applyGamma,
  gaussianBlur,
  luminanceChannel,
  percentileClipNormalize,
  weightedSum,
  yieldToUi,
} from './imageops'
import type { AttentionEngine, AttentionInput, FeatureMaps } from './types'

/**
 * FR-4 — the V1 attention engine.
 *
 * Pure computation on `Float32Array`s: no DOM, no canvas, no `figma.*`, no
 * randomness. Runs entirely inside the iframe and is unit-testable in Node.
 */
export class HeuristicAttentionEngine implements AttentionEngine {
  readonly version = ENGINE_VERSION

  async predict(input: AttentionInput): Promise<Float32Array> {
    const features = await this.computeFeatures(input)
    return combineFeatures(features, input.pixels.width, input.pixels.height)
  }

  /** Exposed separately so tests and debugging can inspect single features. */
  async computeFeatures(input: AttentionInput): Promise<FeatureMaps> {
    const { pixels, signals, frameWidth, frameHeight } = input
    const { width, height } = pixels
    const lum = luminanceChannel(pixels)

    // One yield between steps keeps the Figma UI under the 100 ms budget (NFR-3).
    const luminance = luminanceContrast(pixels, lum)
    await yieldToUi()
    const color = colorOpponency(pixels)
    await yieldToUi()
    const edges = edgeDensity(pixels, lum)
    await yieldToUi()
    const text = textSalience(signals, frameWidth, frameHeight, width, height)
    const interactive = interactiveSalience(signals, frameWidth, frameHeight, width, height)
    const images = imageSalience(signals, frameWidth, frameHeight, width, height)
    await yieldToUi()
    const prior = positionPrior(width, height)

    return {
      luminanceContrast: luminance,
      colorOpponency: color,
      edgeDensity: edges,
      textSalience: text,
      interactiveSalience: interactive,
      imageSalience: images,
      positionPrior: prior,
    }
  }
}

/**
 * Weighted sum + post-processing (FR-4, steps 1–4).
 * Split out so unit tests can feed synthetic feature maps.
 */
export function combineFeatures(features: FeatureMaps, width: number, height: number): Float32Array {
  const weights = ENGINE_CONFIG.weights
  const length = width * height

  const raw = weightedSum(
    [
      { map: features.luminanceContrast, weight: weights.luminanceContrast },
      { map: features.colorOpponency, weight: weights.colorOpponency },
      { map: features.edgeDensity, weight: weights.edgeDensity },
      { map: features.textSalience, weight: weights.textSalience },
      { map: features.interactiveSalience, weight: weights.interactiveSalience },
      { map: features.imageSalience, weight: weights.imageSalience },
      { map: features.positionPrior, weight: weights.positionPrior },
    ],
    length,
  )

  const post = ENGINE_CONFIG.post
  const blurSigma = Math.max(width, height) * post.blurSigmaRatio
  const blurred = gaussianBlur(raw, width, height, blurSigma)
  const normalized = percentileClipNormalize(blurred, post.clipLowPercentile, post.clipHighPercentile)
  return applyGamma(normalized, post.gamma)
}

/** Default engine instance used by the UI pipeline. */
export const defaultEngine: AttentionEngine = new HeuristicAttentionEngine()

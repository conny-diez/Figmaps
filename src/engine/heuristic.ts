import { colorOpponency } from './features/color'
import { edgeDensity } from './features/edges'
import { luminanceContrast } from './features/luminance'
import { positionPrior } from './features/prior'
import { imageSalience, interactiveSalience, textSalience } from './features/structure'
import { applyGamma, luminanceChannel, percentileClipNormalize, weightedSum, yieldToUi } from './imageops'
import { blurField } from './ops-pure'
import { ACTIVE_CONFIG_ID, DEFAULT_PROFILE, resolveParams, type EngineParams, type ProfileId } from './params'
import type { AttentionEngine, AttentionInput, FeatureMaps } from './types'

export type EngineOptions = {
  /** Named configuration (A-6). Defaults to the one the plugin ships. */
  configId?: string
  /** Viewing-duration profile (Epic D). */
  profile?: ProfileId
  /** Explicit parameters — wins over `configId`/`profile`. Used by the tuner. */
  params?: EngineParams
  /**
   * Blur implementation (A-1). Defaults to the shared pure one, which is what
   * both `ImageOpsCanvas` and `ImageOpsNode` delegate to; injecting a different
   * one is what the parity test uses to prove the realms agree.
   */
  blur?: (src: Float32Array, width: number, height: number, sigma: number) => Float32Array
}

/**
 * FR-4 — the heuristic attention engine.
 *
 * Pure computation on `Float32Array`s: no DOM, no canvas, no `figma.*`, no
 * randomness. Runs unchanged in the iframe and in the Node eval harness (A-1).
 */
export class HeuristicAttentionEngine implements AttentionEngine {
  readonly configId: string
  readonly profile: ProfileId
  readonly params: EngineParams
  private readonly blur: NonNullable<EngineOptions['blur']>

  constructor(options: EngineOptions = {}) {
    this.configId = options.configId ?? ACTIVE_CONFIG_ID
    this.profile = options.profile ?? DEFAULT_PROFILE
    this.params = options.params ?? resolveParams(this.configId, this.profile)
    this.blur = options.blur ?? blurField
  }

  get version(): string {
    return this.configId
  }

  async predict(input: AttentionInput): Promise<Float32Array> {
    const features = await this.computeFeatures(input)
    return combineFeatures(features, input.pixels.width, input.pixels.height, this.params, this.blur)
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
    const prior = positionPrior(width, height, this.params.prior)

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
 * Split out so unit tests and the tuner can feed synthetic feature maps.
 */
export function combineFeatures(
  features: FeatureMaps,
  width: number,
  height: number,
  params: EngineParams = resolveParams(),
  blur: NonNullable<EngineOptions['blur']> = blurField,
): Float32Array {
  const weights = params.weights
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

  const post = params.post
  const blurSigma = Math.max(width, height) * post.blurSigmaRatio
  const blurred = blur(raw, width, height, blurSigma)
  const normalized = percentileClipNormalize(blurred, post.clipLowPercentile, post.clipHighPercentile)
  return applyGamma(normalized, post.gamma)
}

/** Default engine instance used by the UI pipeline. */
export const defaultEngine: AttentionEngine = new HeuristicAttentionEngine()

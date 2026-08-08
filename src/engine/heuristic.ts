import { colorOpponency } from './features/color'
import { edgeDensity } from './features/edges'
import { luminanceContrast } from './features/luminance'
import { positionPrior } from './features/prior'
import { imageSalience, interactiveSalience, textSalience } from './features/structure'
import { applyGamma, luminanceChannel, normalize01, percentileClipNormalize, weightedSum, yieldToUi } from './imageops'
import { priorAssetIdFor, priorMap, type PriorAssetId } from './priors'
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
  /**
   * Forces which data prior `hybrid-v1` uses instead of inferring it from the
   * frame geometry. The inference is calibrated for Figma design pixels; the
   * eval harness works on raw screenshots and knows the category from the set.
   */
  priorAsset?: PriorAssetId
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
  private readonly priorAsset: PriorAssetId | undefined

  constructor(options: EngineOptions = {}) {
    this.configId = options.configId ?? ACTIVE_CONFIG_ID
    this.profile = options.profile ?? DEFAULT_PROFILE
    this.params = options.params ?? resolveParams(this.configId, this.profile)
    this.blur = options.blur ?? blurField
    this.priorAsset = options.priorAsset
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

    // hybrid-v1 replaces the analytical bell with a map averaged over a
    // reference set. Falls back to the analytical prior when the asset is
    // missing, so a build without the generated priors still runs.
    const prior =
      this.params.priorSource === 'data'
        ? (priorMap(this.priorAsset ?? priorAssetIdFor(frameWidth, frameHeight), width, height) ??
          positionPrior(width, height, this.params.prior))
        : positionPrior(width, height, this.params.prior)

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
  const post = params.post

  const postProcess = (raw: Float32Array): Float32Array => {
    const blurred = blur(raw, width, height, Math.max(width, height) * post.blurSigmaRatio)
    const normalized = percentileClipNormalize(blurred, post.clipLowPercentile, post.clipHighPercentile)
    return applyGamma(normalized, post.gamma)
  }

  const imagePart = weightedSum(
    [
      { map: features.luminanceContrast, weight: weights.luminanceContrast },
      { map: features.colorOpponency, weight: weights.colorOpponency },
      { map: features.edgeDensity, weight: weights.edgeDensity },
      { map: features.textSalience, weight: weights.textSalience },
      { map: features.interactiveSalience, weight: weights.interactiveSalience },
      { map: features.imageSalience, weight: weights.imageSalience },
    ],
    length,
  )

  // hybrid-v1: the prior is the base, the image analysis is added on top —
  // the two answer different questions and do not belong in one weighted sum.
  if (params.blendAlpha !== undefined) {
    const prior = normalize01(features.positionPrior)
    const image = postProcess(imagePart)
    const blended = new Float32Array(length)
    for (let i = 0; i < length; i++) blended[i] = prior[i] + params.blendAlpha * image[i]

    // Only a linear rescale into [0,1] — deliberately no second gamma. Gamma is
    // non-linear, so applying it again after the blend changes the *shape* of
    // the distribution and measurably worsens KL (web: 1.115 instead of 1.078).
    // The tone curve the renderer needs already sits inside the image term.
    return normalize01(blended)
  }

  // heuristic-v1: one weighted sum over all seven maps.
  const raw = new Float32Array(length)
  for (let i = 0; i < length; i++) raw[i] = imagePart[i] + features.positionPrior[i] * weights.positionPrior
  return postProcess(raw)
}

/** Default engine instance used by the UI pipeline. */
export const defaultEngine: AttentionEngine = new HeuristicAttentionEngine()

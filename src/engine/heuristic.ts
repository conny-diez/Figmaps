import { colorOpponency } from './features/color'
import { edgeDensity } from './features/edges'
import { luminanceContrast } from './features/luminance'
import { positionPrior } from './features/prior'
import { imageSalience, interactiveSalience, textSalience } from './features/structure'
import { applyGamma, luminanceChannel, normalize01, percentileClipNormalize, weightedSum, yieldToUi } from './imageops'
import {
  DEFAULT_PRIOR_DURATION,
  priorAssetIdFor,
  priorDurationFor,
  priorMap,
  resolvePriorAsset,
  type PriorAssetId,
  type PriorResolution,
} from './priors'
import { blurField } from './ops-pure'
import { ACTIVE_CONFIG_ID, DEFAULT_PROFILE, PROFILE_DURATIONS, resolveParams, type EngineParams, type ProfileId } from './params'
import type { AttentionEngine, AttentionInput, AttentionParts, FeatureMaps } from './types'

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
  /**
   * Supplies the data prior directly instead of reading the bundled asset.
   * Used by the cross-validation, where every fold needs a prior estimated
   * without the images it is about to be scored on.
   */
  priorProvider?: (width: number, height: number) => Float32Array | null
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
  private readonly priorProvider: EngineOptions['priorProvider']

  constructor(options: EngineOptions = {}) {
    this.configId = options.configId ?? ACTIVE_CONFIG_ID
    this.profile = options.profile ?? DEFAULT_PROFILE
    this.params = options.params ?? resolveParams(this.configId, this.profile)
    this.blur = options.blur ?? blurField
    this.priorAsset = options.priorAsset
    this.priorProvider = options.priorProvider
  }

  get version(): string {
    return this.configId
  }

  /**
   * Welcher Ortsprior für diesen Frame **tatsächlich** gerechnet wird.
   *
   * DIESELBE FUNKTION, DIE AUCH RECHNET — das ist der Punkt und nicht ein
   * Detail. `computeFeatures` unten liest die Antwort aus genau diesem Aufruf;
   * eine zweite Ableitung derselben Frage neben der Rechnung wäre wieder ein
   * Text, der parallel zur Sache entsteht. Genau daran ist die Fußzeile bis 1.2
   * gescheitert.
   *
   * `analytic` heißt: die F-Muster-Glocke von 1.0 hat gezeichnet, kein
   * Referenzdatensatz ist eingegangen. Für die Beschriftung ist das der Fall,
   * der bis 1.2 unsichtbar blieb — `priorMap(…) ?? positionPrior(…)`, ein `??`
   * ohne Protokoll und ohne Rückgabewert.
   */
  priorResolution(frameWidth: number, frameHeight: number): PriorResolution {
    const requested = this.priorAsset ?? priorAssetIdFor(frameWidth, frameHeight)
    // Ohne `priorSource: 'data'` läuft der Datenprior gar nicht — dann ist die
    // analytische Glocke keine Ersatzrechnung, sondern die Konfiguration.
    if (this.params.priorSource !== 'data') {
      return { source: 'analytic', asset: requested, requestedDuration: DEFAULT_PRIOR_DURATION }
    }
    const duration = priorDurationFor(PROFILE_DURATIONS[this.profile])
    if (duration === null) {
      // Ein Profil, dessen Dauer es als Prior nicht gibt. Heute unerreichbar,
      // weil `PROFILE_DURATIONS` und `PRIOR_DURATIONS` übereinstimmen — und
      // deshalb steht hier ein Zweig und kein `as`: die nächste Dauer, die
      // jemand hinzufügt, soll nicht stumm auf 3 s landen.
      return { source: 'analytic', asset: requested, requestedDuration: DEFAULT_PRIOR_DURATION }
    }
    return resolvePriorAsset(requested, duration)
  }

  async predict(input: AttentionInput): Promise<Float32Array> {
    return (await this.predictParts(input)).attention
  }

  async predictParts(input: AttentionInput): Promise<AttentionParts> {
    const features = await this.computeFeatures(input)
    return combineFeatureParts(features, input.pixels.width, input.pixels.height, this.params, this.blur)
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
    //
    // Der Rückfall ist derselbe wie in 1.2 — aber die Entscheidung, welcher
    // Prior gilt, steht jetzt in `priorResolution()` und nicht in dieser
    // `??`-Kette. Die Beschriftung liest dieselbe Funktion; damit kann sie nicht
    // mehr etwas anderes behaupten als das, was hier gerechnet hat.
    const resolution = this.priorResolution(frameWidth, frameHeight)
    const prior =
      this.params.priorSource === 'data'
        ? (this.priorProvider?.(width, height) ??
          // Epic D: the profile picks the viewing duration the prior was
          // estimated from. Measured — a matched prior beats the 3 s one.
          (resolution.source === 'data'
            ? priorMap(resolution.asset, width, height, resolution.duration)
            : null) ??
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
  return combineFeatureParts(features, width, height, params, blur).attention
}

/**
 * The same computation, but handing back the image term as well.
 *
 * One function, not two: if the term the rules read were computed anywhere but
 * here, it would drift away from the term that actually enters the prediction —
 * which is the failure this whole module is arranged to prevent (A-1).
 */
export function combineFeatureParts(
  features: FeatureMaps,
  width: number,
  height: number,
  params: EngineParams = resolveParams(),
  blur: NonNullable<EngineOptions['blur']> = blurField,
): AttentionParts {
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
  const image = postProcess(imagePart)

  if (params.blendAlpha !== undefined) {
    const prior = normalize01(features.positionPrior)
    const blended = new Float32Array(length)
    for (let i = 0; i < length; i++) blended[i] = prior[i] + params.blendAlpha * image[i]

    // Linearer Rescale nach [0,1] — und optional ein Gamma darüber.
    //
    // GESCHICHTE, WEIL SIE DEN DEFAULT ERKLÄRT: beim Einbau von `hybrid-v1`
    // wurde das zweite Gamma entfernt, weil es KL verschlechterte (web 1,115
    // statt 1,078). Das war eine Entscheidung nach genau der Metrik, die
    // Zuspitzung bestraft — und Zuspitzung ist seit 1.2 A die offene Frage
    // (die Ground Truth ist um Faktor 3,4 konzentrierter als unsere Karte).
    // Der Hebel ist deshalb wieder da, als Parameter statt als Entweder-Oder,
    // und wird in `eval/sharpness.ts` an AUC/CC/NSS gemessen. `undefined`
    // (und 1) ist exakt das Verhalten von 1.1.
    const normalised = normalize01(blended)
    const gamma = params.blendGamma
    return {
      attention: gamma === undefined || gamma === 1 ? normalised : applyGamma(normalised, gamma),
      imageTerm: image,
    }
  }

  // heuristic-v1: one weighted sum over all seven maps.
  const raw = new Float32Array(length)
  for (let i = 0; i < length; i++) raw[i] = imagePart[i] + features.positionPrior[i] * weights.positionPrior
  return { attention: postProcess(raw), imageTerm: image }
}

/** Default engine instance used by the UI pipeline. */
export const defaultEngine: AttentionEngine = new HeuristicAttentionEngine()

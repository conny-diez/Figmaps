import type { NodeSignal } from '../messages'
import type { Bitmap } from './ops'

/**
 * Structurally compatible with the DOM `ImageData`, but usable in a plain
 * Node/vitest environment — the engine must be testable without a canvas (A-1).
 */
export type ImageLike = Bitmap

/** A scalar field over the analysis grid; values are in `[0,1]`. */
export type ScalarMap = {
  readonly width: number
  readonly height: number
  readonly values: Float32Array
}

export type AttentionInput = {
  /**
   * The already downscaled screen (longer edge = `ENGINE_CONFIG.analysisEdge`).
   * The returned map has exactly these dimensions.
   */
  pixels: ImageLike
  signals: NodeSignal[]
  /** Size of the source frame in frame pixels — used to map signal geometry. */
  frameWidth: number
  frameHeight: number
}

/**
 * Swappable prediction backend. V1 ships a heuristic implementation; an ONNX
 * saliency model can be dropped in behind the same interface (PRD §9).
 */
export interface AttentionEngine {
  readonly version: string
  /**
   * @returns a `Float32Array` of length `pixels.width * pixels.height`,
   *          values in `[0,1]`, row-major.
   */
  predict(input: AttentionInput): Promise<Float32Array>
  /**
   * Optional: the same prediction, plus the **image-analysis term on its own** —
   * what this screen makes salient, before the location prior is added.
   *
   * Exists because the two answer different questions and one of the findings
   * rules needs the second: „does this screen have a pronounced hierarchy" is a
   * property of the design, while the finished map is prior-dominated
   * (`blendAlpha` 0,3) and therefore says as much about where attention usually
   * goes. An engine that cannot separate the two simply omits this.
   */
  predictParts?(input: AttentionInput): Promise<AttentionParts>
}

export type AttentionParts = {
  attention: Float32Array
  /** The weighted image features after post-processing, without the prior. */
  imageTerm: Float32Array
}

/** Named intermediate results, kept for debugging and unit tests. */
export type FeatureMaps = {
  luminanceContrast: Float32Array
  colorOpponency: Float32Array
  edgeDensity: Float32Array
  textSalience: Float32Array
  interactiveSalience: Float32Array
  imageSalience: Float32Array
  positionPrior: Float32Array
}

/** A rectangle on the analysis grid. */
export type Rect = {
  x: number
  y: number
  width: number
  height: number
}

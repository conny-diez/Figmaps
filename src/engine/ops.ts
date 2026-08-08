/**
 * A-1 — the platform port of the engine.
 *
 * Everything the engine cannot do in plain JavaScript (decoding a PNG, scaling
 * a bitmap, blurring a field) goes through this interface. The engine itself
 * only ever sees `Float32Array` and `Bitmap`; it must never touch
 * `CanvasRenderingContext2D`, `document` or `figma`.
 *
 * Two implementations exist:
 *   - `ImageOpsCanvas` (`src/platform/imageops-canvas.ts`) — the iframe
 *   - `ImageOpsNode`   (`src/platform/imageops-node.ts`)   — the eval harness
 *
 * Only `decode` is genuinely platform specific. `resize` and `blur` delegate to
 * the shared pure implementations in `ops-pure.ts` in *both* realms — otherwise
 * the harness would measure a different pipeline than the plugin ships
 * (see the parity test in `src/engine/__tests__/parity.test.ts`).
 */

/** A raw RGBA image. Structurally compatible with the DOM `ImageData`. */
export type Bitmap = {
  readonly width: number
  readonly height: number
  readonly data: Uint8ClampedArray
}

export interface ImageOps {
  /** Decodes PNG bytes into raw RGBA. Lossless — no scaling, no colour management. */
  decode(png: Uint8Array): Promise<Bitmap>
  /** Area-averaged rescale. Deterministic and identical across platforms. */
  resize(src: Bitmap, width: number, height: number): Bitmap
  /** Separable Gaussian blur of a scalar field. */
  blur(src: Float32Array, width: number, height: number, sigma: number): Float32Array
}

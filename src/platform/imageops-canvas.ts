/**
 * A-1 — `ImageOps` for the iframe.
 *
 * The canvas is used for exactly one thing: turning PNG bytes into raw pixels.
 * Scaling and blurring go through the same pure code as the Node harness —
 * `drawImage`-based downscaling is browser-specific and would silently make the
 * shipped prediction differ from the measured one.
 */
import type { Bitmap, ImageOps } from '../engine/ops'
import { blurField, resizeBitmap } from '../engine/ops-pure'
import { context2d, createCanvas } from '../render/canvas'

export class ImageOpsCanvas implements ImageOps {
  async decode(png: Uint8Array): Promise<Bitmap> {
    const blob = new Blob([png as unknown as BlobPart], { type: 'image/png' })
    const bitmap = await createImageBitmap(blob)
    try {
      return this.fromImageBitmap(bitmap)
    } finally {
      bitmap.close()
    }
  }

  /**
   * Reads an already decoded `ImageBitmap` back as raw pixels, optionally at a
   * reduced size so a 4096 px export does not allocate 67 MB in the iframe.
   * The reduction uses the browser's resampler; everything downstream of it
   * uses `resize`, which is shared with Node.
   */
  fromImageBitmap(bitmap: ImageBitmap, width = bitmap.width, height = bitmap.height): Bitmap {
    const canvas = createCanvas(width, height)
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    if (!ctx) throw new Error('2D-Kontext nicht verfügbar')
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
    return { width: imageData.width, height: imageData.height, data: imageData.data }
  }

  resize(src: Bitmap, width: number, height: number): Bitmap {
    return resizeBitmap(src, width, height)
  }

  blur(src: Float32Array, width: number, height: number, sigma: number): Float32Array {
    return blurField(src, width, height, sigma)
  }

  /** Wraps raw pixels in a canvas so the renderers can draw them. */
  toCanvas(src: Bitmap): HTMLCanvasElement {
    const canvas = createCanvas(src.width, src.height)
    const ctx = context2d(canvas)
    const imageData = ctx.createImageData(src.width, src.height)
    imageData.data.set(src.data)
    ctx.putImageData(imageData, 0, 0)
    return canvas
  }
}

export const canvasImageOps = new ImageOpsCanvas()

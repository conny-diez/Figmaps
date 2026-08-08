/**
 * Canvas helpers — iframe only. Never import this from `src/main.ts`:
 * the Figma main thread has no DOM (PRD §6.3).
 */
import { fitWithin } from '../engine/ops-pure'

export type Size = { width: number; height: number }

/** Re-exported so renderers keep one source of truth for output sizing (A-1). */
export { fitWithin }

export function createCanvas(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(width))
  canvas.height = Math.max(1, Math.round(height))
  return canvas
}

export function context2d(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const ctx = canvas.getContext('2d', { willReadFrequently: false })
  if (!ctx) throw new Error('2D-Kontext nicht verfügbar')
  return ctx
}

/** Decodes PNG bytes coming from `exportAsync` into a drawable bitmap. */
export async function decodePng(bytes: Uint8Array): Promise<ImageBitmap> {
  const blob = new Blob([bytes as unknown as BlobPart], { type: 'image/png' })
  return createImageBitmap(blob)
}

/** Encodes a canvas as PNG bytes for the trip back to the main thread (FR-8). */
export async function canvasToPngBytes(canvas: HTMLCanvasElement): Promise<Uint8Array> {
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
  if (!blob) throw new Error('PNG-Kodierung fehlgeschlagen')
  return new Uint8Array(await blob.arrayBuffer())
}

/**
 * Paints a scalar map as an RGBA layer at map resolution and upscales it onto
 * `target` — bilinear smoothing turns the 512 px analysis grid into a soft
 * overlay without any extra blur pass.
 */
export function drawScalarLayer(
  target: CanvasRenderingContext2D,
  mapWidth: number,
  mapHeight: number,
  rgba: Uint8ClampedArray,
  targetWidth: number,
  targetHeight: number,
): void {
  const layer = createCanvas(mapWidth, mapHeight)
  const layerCtx = context2d(layer)
  const imageData = layerCtx.createImageData(mapWidth, mapHeight)
  imageData.data.set(rgba)
  layerCtx.putImageData(imageData, 0, 0)
  target.imageSmoothingEnabled = true
  target.imageSmoothingQuality = 'high'
  target.drawImage(layer, 0, 0, targetWidth, targetHeight)
}

/**
 * A-1 — `ImageOps` for Node. Used by the eval harness, never by the plugin.
 *
 * `resize` and `blur` are the shared pure implementations, so the harness runs
 * exactly the pipeline the plugin ships. Only `decode` differs from the iframe
 * — and PNG decoding is lossless, so it cannot introduce a difference either.
 */
import { deflateSync, inflateSync } from 'node:zlib'
import type { Bitmap, ImageOps } from '../engine/ops'
import { blurField, resizeBitmap } from '../engine/ops-pure'
import { decodePngBytes, encodePngBytes, type RawImage, type Zlib } from './png'

export const nodeZlib: Zlib = {
  inflate: (data) => new Uint8Array(inflateSync(data)),
  deflate: (data) => new Uint8Array(deflateSync(data, { level: 6 })),
}

export class ImageOpsNode implements ImageOps {
  decode(png: Uint8Array): Promise<Bitmap> {
    return Promise.resolve(decodePngBytes(png, nodeZlib))
  }

  decodeSync(png: Uint8Array): Bitmap {
    return decodePngBytes(png, nodeZlib)
  }

  encode(image: RawImage): Uint8Array {
    return encodePngBytes(image, nodeZlib)
  }

  resize(src: Bitmap, width: number, height: number): Bitmap {
    return resizeBitmap(src, width, height)
  }

  blur(src: Float32Array, width: number, height: number, sigma: number): Float32Array {
    return blurField(src, width, height, sigma)
  }
}

export const nodeImageOps = new ImageOpsNode()

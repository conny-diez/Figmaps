/**
 * A-1 — a dependency-free PNG codec.
 *
 * The eval harness must read the reference images and write the contact sheet
 * without a native canvas binding: `@napi-rs/canvas` would pull a platform
 * binary into a repo whose only build tool is esbuild, and it would introduce a
 * second, subtly different resampler next to `ops-pure.ts`.
 *
 * Scope is deliberately narrow — 8-bit non-interlaced PNG, which is what
 * `exportAsync` and every fixture converter produce. Anything else throws with
 * a message that says what to do about it.
 *
 * The zlib layer is injected so this module stays free of Node built-ins and
 * can be unit-tested with a stub.
 */

export type Zlib = {
  inflate(data: Uint8Array): Uint8Array
  deflate(data: Uint8Array): Uint8Array
}

export type RawImage = {
  width: number
  height: number
  data: Uint8ClampedArray
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

const CHANNELS: Record<number, number> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }

function readUint32(bytes: Uint8Array, offset: number): number {
  return ((bytes[offset] << 24) >>> 0) + (bytes[offset + 1] << 16) + (bytes[offset + 2] << 8) + bytes[offset + 3]
}

function writeUint32(bytes: Uint8Array, offset: number, value: number): void {
  bytes[offset] = (value >>> 24) & 0xff
  bytes[offset + 1] = (value >>> 16) & 0xff
  bytes[offset + 2] = (value >>> 8) & 0xff
  bytes[offset + 3] = value & 0xff
}

const CRC_TABLE = (() => {
  const table = new Int32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c
  }
  return table
})()

function crc32(bytes: Uint8Array, start: number, end: number): number {
  let c = 0xffffffff
  for (let i = start; i < end; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c
  const pa = Math.abs(p - a)
  const pb = Math.abs(p - b)
  const pc = Math.abs(p - c)
  if (pa <= pb && pa <= pc) return a
  if (pb <= pc) return b
  return c
}

/** Reverses the per-scanline filters in place, producing raw sample bytes. */
function unfilter(raw: Uint8Array, width: number, height: number, bytesPerPixel: number): Uint8Array {
  const stride = width * bytesPerPixel
  const out = new Uint8Array(stride * height)
  let pos = 0

  for (let y = 0; y < height; y++) {
    const filter = raw[pos++]
    const line = pos
    pos += stride
    const outRow = y * stride
    const prevRow = outRow - stride

    for (let i = 0; i < stride; i++) {
      const x = raw[line + i]
      const a = i >= bytesPerPixel ? out[outRow + i - bytesPerPixel] : 0
      const b = y > 0 ? out[prevRow + i] : 0
      const c = y > 0 && i >= bytesPerPixel ? out[prevRow + i - bytesPerPixel] : 0

      let value: number
      switch (filter) {
        case 0:
          value = x
          break
        case 1:
          value = x + a
          break
        case 2:
          value = x + b
          break
        case 3:
          value = x + ((a + b) >> 1)
          break
        case 4:
          value = x + paeth(a, b, c)
          break
        default:
          throw new Error(`PNG: unbekannter Zeilenfilter ${filter}`)
      }
      out[outRow + i] = value & 0xff
    }
  }
  return out
}

/** Decodes 8-bit, non-interlaced PNG bytes into RGBA. */
export function decodePngBytes(bytes: Uint8Array, zlib: Zlib): RawImage {
  for (let i = 0; i < PNG_SIGNATURE.length; i++) {
    if (bytes[i] !== PNG_SIGNATURE[i]) throw new Error('PNG: ungültige Signatur')
  }

  let width = 0
  let height = 0
  let bitDepth = 0
  let colorType = 0
  let interlace = 0
  let palette: Uint8Array | null = null
  let transparency: Uint8Array | null = null
  const idat: Uint8Array[] = []

  let offset = 8
  while (offset + 8 <= bytes.length) {
    const length = readUint32(bytes, offset)
    const type = String.fromCharCode(bytes[offset + 4], bytes[offset + 5], bytes[offset + 6], bytes[offset + 7])
    const dataStart = offset + 8

    if (type === 'IHDR') {
      width = readUint32(bytes, dataStart)
      height = readUint32(bytes, dataStart + 4)
      bitDepth = bytes[dataStart + 8]
      colorType = bytes[dataStart + 9]
      interlace = bytes[dataStart + 12]
    } else if (type === 'PLTE') {
      palette = bytes.subarray(dataStart, dataStart + length)
    } else if (type === 'tRNS') {
      transparency = bytes.subarray(dataStart, dataStart + length)
    } else if (type === 'IDAT') {
      idat.push(bytes.subarray(dataStart, dataStart + length))
    } else if (type === 'IEND') {
      break
    }

    offset = dataStart + length + 4
  }

  if (width <= 0 || height <= 0) throw new Error('PNG: kein IHDR gefunden')
  if (bitDepth !== 8) {
    throw new Error(`PNG: nur 8 Bit pro Kanal unterstützt (gefunden: ${bitDepth}) — Fixture vorher konvertieren`)
  }
  if (interlace !== 0) throw new Error('PNG: Interlacing (Adam7) wird nicht unterstützt — Fixture vorher konvertieren')
  const channels = CHANNELS[colorType]
  if (!channels) throw new Error(`PNG: unbekannter Farbtyp ${colorType}`)

  let total = 0
  for (const chunk of idat) total += chunk.length
  const compressed = new Uint8Array(total)
  let cursor = 0
  for (const chunk of idat) {
    compressed.set(chunk, cursor)
    cursor += chunk.length
  }

  const samples = unfilter(zlib.inflate(compressed), width, height, channels)
  const out = new Uint8ClampedArray(width * height * 4)

  for (let i = 0, p = 0, q = 0; i < width * height; i++, p += channels, q += 4) {
    switch (colorType) {
      case 0:
        out[q] = out[q + 1] = out[q + 2] = samples[p]
        out[q + 3] = 255
        break
      case 2:
        out[q] = samples[p]
        out[q + 1] = samples[p + 1]
        out[q + 2] = samples[p + 2]
        out[q + 3] = 255
        break
      case 3: {
        if (!palette) throw new Error('PNG: Palettenbild ohne PLTE')
        const index = samples[p]
        out[q] = palette[index * 3]
        out[q + 1] = palette[index * 3 + 1]
        out[q + 2] = palette[index * 3 + 2]
        out[q + 3] = transparency && index < transparency.length ? transparency[index] : 255
        break
      }
      case 4:
        out[q] = out[q + 1] = out[q + 2] = samples[p]
        out[q + 3] = samples[p + 1]
        break
      default:
        out[q] = samples[p]
        out[q + 1] = samples[p + 1]
        out[q + 2] = samples[p + 2]
        out[q + 3] = samples[p + 3]
        break
    }
  }

  return { width, height, data: out }
}

function chunk(type: string, payload: Uint8Array): Uint8Array {
  const out = new Uint8Array(payload.length + 12)
  writeUint32(out, 0, payload.length)
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i)
  out.set(payload, 8)
  writeUint32(out, payload.length + 8, crc32(out, 4, payload.length + 8))
  return out
}

/** Encodes RGBA as an 8-bit truecolour-with-alpha PNG (filter type 0). */
export function encodePngBytes(image: RawImage, zlib: Zlib): Uint8Array {
  const { width, height, data } = image
  const stride = width * 4
  const raw = new Uint8Array((stride + 1) * height)
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0
    raw.set(data.subarray(y * stride, y * stride + stride), y * (stride + 1) + 1)
  }

  const ihdr = new Uint8Array(13)
  writeUint32(ihdr, 0, width)
  writeUint32(ihdr, 4, height)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // RGBA
  ihdr[10] = 0 // deflate
  ihdr[11] = 0 // adaptive filtering
  ihdr[12] = 0 // no interlace

  const parts = [
    new Uint8Array(PNG_SIGNATURE),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflate(raw)),
    chunk('IEND', new Uint8Array(0)),
  ]

  let size = 0
  for (const part of parts) size += part.length
  const out = new Uint8Array(size)
  let cursor = 0
  for (const part of parts) {
    out.set(part, cursor)
    cursor += part.length
  }
  return out
}

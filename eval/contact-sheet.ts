/**
 * A-5 — the contact sheet: the twelve worst cases as
 * `Original | Ground Truth | Vorhersage` triptychs, stacked into one PNG.
 *
 * The visual error analysis is worth more than the number alone — this is where
 * you see *which kind* of screen the engine does not understand. The image
 * carries no text (there is no font in this realm); the report table next to it
 * lists the rows in the same order with ids and scores.
 */
import { turbo } from '../src/render/colormap'
import type { Bitmap } from '../src/engine/ops'
import { resizeBitmap } from '../src/engine/ops-pure'
import { normalize01 } from '../src/engine/imageops'
import type { ScalarMap } from '../src/engine/types'
import { nodeImageOps } from '../src/platform/imageops-node'

export type Triptych = {
  original: Bitmap
  truth: ScalarMap
  prediction: ScalarMap
}

const TILE_WIDTH = 320
const GAP = 8
const BACKGROUND: [number, number, number] = [24, 24, 28]

/** Colour-maps a scalar field with the same ramp the plugin uses. */
function mapToBitmap(map: ScalarMap): Bitmap {
  const values = normalize01(map.values)
  const data = new Uint8ClampedArray(map.width * map.height * 4)
  for (let i = 0, p = 0; i < values.length; i++, p += 4) {
    const [r, g, b] = turbo(values[i])
    data[p] = r
    data[p + 1] = g
    data[p + 2] = b
    data[p + 3] = 255
  }
  return { width: map.width, height: map.height, data }
}

function blit(target: Bitmap, source: Bitmap, x0: number, y0: number): void {
  for (let y = 0; y < source.height; y++) {
    const ty = y0 + y
    if (ty < 0 || ty >= target.height) continue
    const from = y * source.width * 4
    const to = (ty * target.width + x0) * 4
    target.data.set(source.data.subarray(from, from + source.width * 4), to)
  }
}

/** Composes the triptychs into a single PNG, one row per case. */
export function renderContactSheet(rows: readonly Triptych[]): Uint8Array {
  if (rows.length === 0) throw new Error('Kontaktbogen ohne Fälle')

  const tiles = rows.map((row) => {
    const aspect = row.original.height / row.original.width
    const height = Math.max(1, Math.round(TILE_WIDTH * aspect))
    return {
      height,
      cells: [
        resizeBitmap(row.original, TILE_WIDTH, height),
        resizeBitmap(mapToBitmap(row.truth), TILE_WIDTH, height),
        resizeBitmap(mapToBitmap(row.prediction), TILE_WIDTH, height),
      ],
    }
  })

  const width = TILE_WIDTH * 3 + GAP * 4
  const height = tiles.reduce((sum, tile) => sum + tile.height + GAP, GAP)

  const data = new Uint8ClampedArray(width * height * 4)
  for (let p = 0; p < data.length; p += 4) {
    data[p] = BACKGROUND[0]
    data[p + 1] = BACKGROUND[1]
    data[p + 2] = BACKGROUND[2]
    data[p + 3] = 255
  }
  const sheet: Bitmap = { width, height, data }

  let y = GAP
  for (const tile of tiles) {
    for (let column = 0; column < tile.cells.length; column++) {
      blit(sheet, tile.cells[column], GAP + column * (TILE_WIDTH + GAP), y)
    }
    y += tile.height + GAP
  }

  return nodeImageOps.encode(sheet)
}

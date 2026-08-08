/**
 * Synthetic fixtures for the engine tests.
 *
 * The engine is tested against inputs with a *known* ground truth — real
 * screenshots have none (PRD §12).
 */
import type { NodeSignal } from '../../messages'
import type { ImageLike, Rect } from '../types'

export type Rgb = [number, number, number]

export function solidImage(width: number, height: number, color: Rgb): ImageLike {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let p = 0; p < data.length; p += 4) {
    data[p] = color[0]
    data[p + 1] = color[1]
    data[p + 2] = color[2]
    data[p + 3] = 255
  }
  return { width, height, data }
}

export function fillRect(image: ImageLike, rect: Rect, color: Rgb): ImageLike {
  const { width, data } = image
  for (let y = rect.y; y < rect.y + rect.height; y++) {
    for (let x = rect.x; x < rect.x + rect.width; x++) {
      const p = (y * width + x) * 4
      data[p] = color[0]
      data[p + 1] = color[1]
      data[p + 2] = color[2]
      data[p + 3] = 255
    }
  }
  return image
}

/** Index of the largest value; ties resolve to the lowest index (deterministic). */
export function argmax(values: Float32Array): number {
  let best = 0
  for (let i = 1; i < values.length; i++) {
    if (values[i] > values[best]) best = i
  }
  return best
}

export function coordsOf(index: number, width: number): { x: number; y: number } {
  return { x: index % width, y: Math.floor(index / width) }
}

export function meanOfRect(values: Float32Array, width: number, rect: Rect): number {
  let sum = 0
  let count = 0
  for (let y = rect.y; y < rect.y + rect.height; y++) {
    for (let x = rect.x; x < rect.x + rect.width; x++) {
      sum += values[y * width + x]
      count++
    }
  }
  return count === 0 ? 0 : sum / count
}

let nextId = 0

export function makeSignal(overrides: Partial<NodeSignal> = {}): NodeSignal {
  nextId++
  return {
    id: `node:${nextId}`,
    parentId: null,
    name: `node-${nextId}`,
    type: 'RECTANGLE',
    x: 0,
    y: 0,
    width: 100,
    height: 40,
    zIndex: nextId,
    opacity: 1,
    isText: false,
    isImage: false,
    hasFill: true,
    hasReactions: false,
    nameHints: [],
    ...overrides,
  }
}

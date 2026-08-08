/**
 * A-3 acceptance — every metric against a hand-computed 5x5 case with three
 * fixations, so a broken implementation cannot hide behind plausible-looking
 * averages over a real dataset.
 */
import { describe, expect, it } from 'vitest'
import type { Bitmap } from '../../../src/engine/ops'
import type { ScalarMap } from '../../../src/engine/types'
import { aucJudd } from '../auc'
import { correlationCoefficient } from '../cc'
import { klDivergence } from '../kl'
import { normalizedScanpathSaliency } from '../nss'
import { fixationsFromMap, fixationsFromMask } from '../types'

const W = 5
const H = 5

function map(values: number[]): ScalarMap {
  return { width: W, height: H, values: Float32Array.from(values) }
}

function constant(value: number): number[] {
  return Array.from({ length: W * H }, () => value)
}

/** Strictly descending values 25/25 .. 1/25, so there are no ties. */
const RANKED = map(Array.from({ length: 25 }, (_, i) => (25 - i) / 25))

/** One constant value per row: rows 1..5. */
function rows(perRow: number[]): ScalarMap {
  const values: number[] = []
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) values.push(perRow[y])
  return map(values)
}

describe('AUC-Judd', () => {
  it('is 1 when the three fixations are the three strongest pixels', () => {
    // tp climbs to 1 while fp stays at 0 -> the ROC curve hugs the corner.
    expect(aucJudd(RANKED, [0, 1, 2])).toBeCloseTo(1, 10)
  })

  it('is 1/6 when the three fixations are the three weakest pixels', () => {
    // fp jumps to 1 at the first threshold: area = (1 - 0) * (0 + 1/3) / 2.
    expect(aucJudd(RANKED, [22, 23, 24])).toBeCloseTo(1 / 6, 10)
  })

  it('is 21/22 for a perfect but tied map', () => {
    // Three fixated pixels at 1, everything else at 0: the ties cost 1/22.
    const values = constant(0)
    values[7] = values[12] = values[18] = 1
    expect(aucJudd(map(values), [7, 12, 18])).toBeCloseTo(21 / 22, 10)
  })

  it('is exactly chance for a constant map', () => {
    expect(aucJudd(map(constant(0.3)), [0, 12, 24])).toBe(0.5)
  })

  it('is NaN without fixations', () => {
    expect(Number.isNaN(aucJudd(RANKED, []))).toBe(true)
  })
})

describe('CC', () => {
  const a = rows([1, 2, 3, 4, 5])

  it('is 1 for the identical map and for any positive rescaling', () => {
    expect(correlationCoefficient(a, a)).toBeCloseTo(1, 10)
    expect(correlationCoefficient(rows([3, 5, 7, 9, 11]), a)).toBeCloseTo(1, 10)
  })

  it('is -1 for the mirrored map', () => {
    expect(correlationCoefficient(rows([5, 4, 3, 2, 1]), a)).toBeCloseTo(-1, 10)
  })

  it('is 12/sqrt(160) for the hand-computed case', () => {
    // dev(a) = (-2,-1,0,1,2), dev(b) = (-2,-2,0,2,2) per row, times 5 pixels.
    expect(correlationCoefficient(rows([1, 1, 3, 5, 5]), a)).toBeCloseTo(12 / Math.sqrt(160), 6)
  })

  it('is 0 against a constant map', () => {
    expect(correlationCoefficient(rows([2, 2, 2, 2, 2]), a)).toBe(0)
  })
})

describe('NSS', () => {
  // rows 1..5: mean 3, population sd sqrt(2). Row 5 normalises to +sqrt(2).
  const a = rows([1, 2, 3, 4, 5])

  it('equals the z-score of the fixated row', () => {
    expect(normalizedScanpathSaliency(a, [20, 21, 22])).toBeCloseTo(Math.SQRT2, 6)
  })

  it('is 0 when fixations are symmetric around the mean', () => {
    expect(normalizedScanpathSaliency(a, [0, 12, 24])).toBeCloseTo(0, 6)
  })

  it('is negative when fixations land on the quiet rows', () => {
    expect(normalizedScanpathSaliency(a, [0, 1, 2])).toBeCloseTo(-Math.SQRT2, 6)
  })

  it('is 0 for a constant map', () => {
    expect(normalizedScanpathSaliency(rows([2, 2, 2, 2, 2]), [0, 12, 24])).toBe(0)
  })
})

describe('KL', () => {
  it('is 0 for identical distributions', () => {
    expect(klDivergence(RANKED, RANKED)).toBeCloseTo(0, 10)
  })

  it('is log(25) when the truth is a point mass and the prediction uniform', () => {
    const point = constant(0)
    point[7] = 1
    expect(klDivergence(map(constant(0.04)), map(point))).toBeCloseTo(Math.log(25), 6)
  })

  it('is scale invariant', () => {
    const truth = rows([1, 2, 3, 4, 5])
    expect(klDivergence(rows([2, 4, 6, 8, 10]), truth)).toBeCloseTo(0, 10)
  })
})

describe('fixationsFromMap', () => {
  it('picks the strongest pixels and returns them in index order', () => {
    expect(fixationsFromMap(RANKED, 3)).toEqual([0, 1, 2])
  })

  it('breaks ties by index, so the result is reproducible', () => {
    expect(fixationsFromMap(map(constant(0.5)), 3)).toEqual([0, 1, 2])
  })
})

describe('fixationsFromMask', () => {
  /** Greyscale bitmap from a 0/255 pattern. */
  function mask(width: number, height: number, on: Array<[number, number]>): Bitmap {
    const data = new Uint8ClampedArray(width * height * 4)
    for (let i = 0; i < width * height; i++) data[i * 4 + 3] = 255
    for (const [x, y] of on) {
      const p = (y * width + x) * 4
      data[p] = data[p + 1] = data[p + 2] = 255
    }
    return { width, height, data }
  }

  it('maps fixated pixels onto the corresponding grid cells', () => {
    // 8x8 -> 4x4: source (0,0) and (7,7) land in grid cells 0 and 15.
    expect(fixationsFromMask(mask(8, 8, [[0, 0], [7, 7]]), 4, 4)).toEqual([0, 15])
  })

  it('max-pools rather than averaging — a single lit pixel keeps its cell', () => {
    // Averaging would give 255/4 = 64 and a threshold would then decide whether
    // this fixation survives at all. Max pooling has no such free parameter.
    expect(fixationsFromMask(mask(8, 8, [[3, 3]]), 4, 4)).toEqual([5])
  })

  it('collapses a dilated blob into the cells it covers, without duplicates', () => {
    const blob: Array<[number, number]> = []
    for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) blob.push([x, y])
    // A 4x4 blob at the origin of an 8x8 map covers exactly the top-left 2x2
    // cells of a 4x4 grid.
    expect(fixationsFromMask(mask(8, 8, blob), 4, 4)).toEqual([0, 1, 4, 5])
  })

  it('ignores pixels below the threshold', () => {
    const grey = mask(4, 4, [[0, 0]])
    grey.data[0] = grey.data[1] = grey.data[2] = 100
    expect(fixationsFromMask(grey, 2, 2)).toEqual([])
  })

  it('returns an empty list for an empty mask', () => {
    expect(fixationsFromMask(mask(4, 4, []), 2, 2)).toEqual([])
  })
})

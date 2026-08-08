/**
 * A-2 — the reference data set.
 *
 * Layout under `eval/fixtures/<set>/`:
 *
 *   index.json          { "name", "source", "license", "items": [...] }
 *   images/<id>.png     the screenshot
 *   maps/<id>.png       the ground-truth saliency map (greyscale)
 *   signals/<id>.json   optional NodeSignal[] — see the note below
 *
 * Fixtures are *not* committed (size + licence). `npm run eval:fixtures`
 * prepares them; `eval/fixtures/README.md` documents where they come from.
 *
 * Note on signals: a bare screenshot carries no layer tree, so `textSalience`,
 * `interactiveSalience` and `imageSalience` are all zero on such a sample and
 * only the pixel features and the position prior are actually measured. The
 * loader therefore reads an optional signal sidecar, and the report states how
 * many samples had one — a number that must not be quietly ignored when
 * reading the results.
 */
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { ENGINE_CONFIG } from '../src/engine/config'
import type { Bitmap } from '../src/engine/ops'
import { fitWithin } from '../src/engine/ops-pure'
import type { ScalarMap } from '../src/engine/types'
import type { NodeSignal } from '../src/messages'
import { nodeImageOps } from '../src/platform/imageops-node'
import { fixationsFromMap, type GroundTruth } from './metrics/types'

export type SplitName = 'tuning' | 'test' | 'quick'

export type DatasetItem = {
  id: string
  split: SplitName | SplitName[]
  /** UEyes viewing duration this ground-truth map belongs to, in seconds. */
  duration?: number
}

export type DatasetIndex = {
  name: string
  source?: string
  license?: string
  /** Number of top pixels treated as fixation points when none are supplied. */
  fixationCount?: number
  items: DatasetItem[]
}

export type EvalSample = {
  id: string
  /** Full-resolution screenshot pixels. */
  image: Bitmap
  /** Dimensions of the analysis grid every prediction is compared on. */
  grid: { width: number; height: number }
  signals: NodeSignal[]
  frameWidth: number
  frameHeight: number
  truth: GroundTruth
  duration?: number
  hasSignals: boolean
}

export const FIXTURES_ROOT = 'eval/fixtures'

/** Fraction of grid pixels treated as fixations when the set has no raw ones. */
const DEFAULT_FIXATION_SHARE = 0.02

function readPng(path: string): Bitmap {
  return nodeImageOps.decodeSync(new Uint8Array(readFileSync(path)))
}

/** Greyscale luminance of a decoded map, normalised to `[0,1]`. */
function toScalarMap(bitmap: Bitmap): ScalarMap {
  const values = new Float32Array(bitmap.width * bitmap.height)
  let max = 0
  for (let i = 0, p = 0; i < values.length; i++, p += 4) {
    // Ground-truth maps are greyscale; averaging the channels is robust to a
    // converter that wrote them as RGB.
    const v = (bitmap.data[p] + bitmap.data[p + 1] + bitmap.data[p + 2]) / 3
    values[i] = v
    if (v > max) max = v
  }
  if (max > 0) for (let i = 0; i < values.length; i++) values[i] /= max
  return { width: bitmap.width, height: bitmap.height, values }
}

function resizeScalarMap(map: ScalarMap, width: number, height: number): ScalarMap {
  // Reuse the shared bitmap resampler rather than writing a second one: pack
  // the field into the red channel, resize, unpack.
  const packed = new Uint8ClampedArray(map.width * map.height * 4)
  for (let i = 0, p = 0; i < map.values.length; i++, p += 4) {
    const v = Math.round(map.values[i] * 255)
    packed[p] = packed[p + 1] = packed[p + 2] = v
    packed[p + 3] = 255
  }
  const resized = nodeImageOps.resize({ width: map.width, height: map.height, data: packed }, width, height)
  const values = new Float32Array(width * height)
  for (let i = 0, p = 0; i < values.length; i++, p += 4) values[i] = resized.data[p] / 255
  return { width, height, values }
}

function matchesSplit(item: DatasetItem, split: SplitName): boolean {
  return Array.isArray(item.split) ? item.split.includes(split) : item.split === split
}

export function readIndex(setName: string, root = FIXTURES_ROOT): DatasetIndex {
  const path = join(root, setName, 'index.json')
  if (!existsSync(path)) {
    throw new Error(
      `Referenz-Set "${setName}" fehlt (${path}).\n` +
        `Fixtures liegen absichtlich nicht im Repo — siehe ${root}/README.md.\n` +
        `Für einen Rauchtest des Harness: npm run eval:fixtures -- --synthetic`,
    )
  }
  return JSON.parse(readFileSync(path, 'utf8')) as DatasetIndex
}

/**
 * Loads one split. Splits are kept strictly apart: weights are optimised on
 * `tuning` and reported on `test`, never the other way round (A-2).
 */
export function loadSamples(
  setName: string,
  split: SplitName,
  options: { limit?: number; root?: string } = {},
): EvalSample[] {
  const root = options.root ?? FIXTURES_ROOT
  const index = readIndex(setName, root)
  const base = join(root, setName)

  const items = index.items.filter((item) => matchesSplit(item, split))
  if (items.length === 0) throw new Error(`Referenz-Set "${setName}" enthält keine Einträge im Split "${split}"`)

  const selected = options.limit ? items.slice(0, options.limit) : items
  return selected.map((item) => {
    const image = readPng(join(base, 'images', `${item.id}.png`))
    const truthBitmap = readPng(join(base, 'maps', `${item.id}.png`))

    const grid = fitWithin(image.width, image.height, ENGINE_CONFIG.analysisEdge)
    const salience = resizeScalarMap(toScalarMap(truthBitmap), grid.width, grid.height)

    const signalsPath = join(base, 'signals', `${item.id}.json`)
    const hasSignals = existsSync(signalsPath)
    const signals = hasSignals ? (JSON.parse(readFileSync(signalsPath, 'utf8')) as NodeSignal[]) : []

    const fixationCount = index.fixationCount ?? Math.round(grid.width * grid.height * DEFAULT_FIXATION_SHARE)

    return {
      id: item.id,
      image,
      grid,
      signals,
      frameWidth: image.width,
      frameHeight: image.height,
      truth: { salience, fixations: fixationsFromMap(salience, fixationCount) },
      duration: item.duration,
      hasSignals,
    }
  })
}

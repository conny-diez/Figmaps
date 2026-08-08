/**
 * A-2 — the reference data set.
 *
 * Layout under `eval/fixtures/<set>/`:
 *
 *   index.json                { name, source, license, citation, durations, items }
 *   images/<id>.png           the screenshot
 *   heatmaps/<d>s/<id>.png    continuous ground-truth saliency  -> CC, KL
 *   fixmaps/<d>s/<id>.png     binary fixation map               -> AUC-Judd, NSS
 *   signals/<id>.json         optional NodeSignal[] — see the note below
 *
 * Fixtures are *not* committed (size + licence). `npm run eval:fixtures`
 * prepares them; `eval/fixtures/README.md` documents where they come from.
 *
 * Note on signals: a bare screenshot carries no layer tree, so `textSalience`,
 * `interactiveSalience` and `imageSalience` are all zero on such a sample and
 * only the pixel features and the position prior are actually measured. The
 * loader therefore reads an optional signal sidecar, and the report states how
 * many samples had one — and what share of the engine weighting that leaves
 * unmeasured. That number must not be quietly ignored when reading results.
 */
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { analysisGridFor } from '../src/engine/analyze'
import type { Bitmap } from '../src/engine/ops'
import type { ScalarMap } from '../src/engine/types'
import type { NodeSignal } from '../src/messages'
import { nodeImageOps } from '../src/platform/imageops-node'
import { fixationsFromMap, fixationsFromMask, type GroundTruth } from './metrics/types'

export type SplitName = 'tuning' | 'test' | 'quick'

export type DatasetItem = {
  id: string
  split: SplitName | SplitName[]
}

export type DatasetIndex = {
  name: string
  source?: string
  license?: string
  /** Full citation, reproduced verbatim in every report. */
  citation?: string
  /** Viewing durations present in the set, in seconds. */
  durations: number[]
  /** Caveats about the data itself — reproduced verbatim in every report. */
  notes?: string[]
  /** Fraction of grid pixels treated as fixations when no fixation map exists. */
  fixationShare?: number
  items: DatasetItem[]
}

export type EvalSample = {
  id: string
  /** Full-resolution screenshot pixels. */
  image: Bitmap
  /** The grid every prediction and every ground truth is compared on. */
  grid: { width: number; height: number }
  signals: NodeSignal[]
  frameWidth: number
  frameHeight: number
  truth: GroundTruth
  duration: number
  hasSignals: boolean
}

export const FIXTURES_ROOT = 'eval/fixtures'

/** Fallback share of grid pixels used as fixations when no fixmap exists. */
const DEFAULT_FIXATION_SHARE = 0.02

export function readPng(path: string): Bitmap {
  return nodeImageOps.decodeSync(new Uint8Array(readFileSync(path)))
}

/** Ids of one split, without loading a single pixel. */
export function listSplit(setName: string, split: SplitName, root = FIXTURES_ROOT): string[] {
  return readIndex(setName, root)
    .items.filter((item) => matchesSplit(item, split))
    .map((item) => item.id)
}

export function heatmapPath(setName: string, id: string, duration: number, root = FIXTURES_ROOT): string {
  return join(root, setName, 'heatmaps', `${duration}s`, `${id}.png`)
}

/** Greyscale luminance of a decoded map, normalised to `[0,1]`. */
export function toScalarMap(bitmap: Bitmap): ScalarMap {
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

/**
 * Area-averaged rescale of a continuous field, via the shared bitmap
 * resampler — packing into the red channel keeps one resampler in the repo.
 */
export function resizeScalarMap(map: ScalarMap, width: number, height: number): ScalarMap {
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
        `UEyes importieren:  npm run eval:fixtures -- --ueyes <pfad-zum-datensatz>\n` +
        `Rauchtest ohne Datensatz:  npm run eval:fixtures -- --synthetic`,
    )
  }
  return JSON.parse(readFileSync(path, 'utf8')) as DatasetIndex
}

export type LoadOptions = {
  limit?: number
  root?: string
  /** Viewing duration in seconds. Only this duration is scored. */
  duration?: number
}

/**
 * Loads one split. Splits are kept strictly apart: weights are optimised on
 * `tuning` and reported on `test`, never the other way round (A-2).
 */
export function loadSamples(setName: string, split: SplitName, options: LoadOptions = {}): EvalSample[] {
  const samples = [...iterateSamples(setName, split, options)]
  if (samples.length === 0) throw new Error(`Referenz-Set "${setName}" / "${split}": kein einziges Bild verwertbar.`)
  return samples
}

/**
 * Same as `loadSamples`, but yields one sample at a time and lets the previous
 * one be collected.
 *
 * A tuning split of 468 mobile screenshots is several gigabytes of decoded
 * pixels; anything that walks the whole split — the mean map, the diagnostics —
 * must stream rather than collect.
 */
export function* iterateSamples(setName: string, split: SplitName, options: LoadOptions = {}): Generator<EvalSample> {
  const root = options.root ?? FIXTURES_ROOT
  const index = readIndex(setName, root)
  const base = join(root, setName)
  const duration = options.duration ?? 3

  if (!index.durations.includes(duration)) {
    throw new Error(
      `Referenz-Set "${setName}" enthält keine Ground Truth für ${duration}s (vorhanden: ${index.durations.join(', ')}s).`,
    )
  }

  const items = index.items.filter((item) => matchesSplit(item, split))
  if (items.length === 0) throw new Error(`Referenz-Set "${setName}" enthält keine Einträge im Split "${split}"`)

  const selected = options.limit ? items.slice(0, options.limit) : items
  const heatmapDir = join(base, 'heatmaps', `${duration}s`)
  const fixmapDir = join(base, 'fixmaps', `${duration}s`)

  for (const item of selected) {
    const image = readPng(join(base, 'images', `${item.id}.png`))

    // The comparison grid is whatever the engine itself would produce for this
    // image — never a resolution invented by the harness.
    const grid = analysisGridFor(image.width, image.height)

    const heatmapPath = join(heatmapDir, `${item.id}.png`)
    if (!existsSync(heatmapPath)) {
      throw new Error(`Ground-Truth-Heatmap fehlt: ${heatmapPath}`)
    }
    const salience = resizeScalarMap(toScalarMap(readPng(heatmapPath)), grid.width, grid.height)

    // AUC-Judd and NSS want discrete fixations, CC and KL the continuous map.
    const fixmapPath = join(fixmapDir, `${item.id}.png`)
    let fixations: number[]
    let fixationSource: GroundTruth['fixationSource']
    if (existsSync(fixmapPath)) {
      fixations = fixationsFromMask(readPng(fixmapPath), grid.width, grid.height)
      fixationSource = 'measured'
    } else {
      const share = index.fixationShare ?? DEFAULT_FIXATION_SHARE
      fixations = fixationsFromMap(salience, Math.round(grid.width * grid.height * share))
      fixationSource = 'derived-from-heatmap'
    }

    // A sample whose fixations cover everything (or nothing) carries no signal
    // for AUC — dropping it beats letting it drag the mean somewhere arbitrary.
    if (fixations.length === 0 || fixations.length >= grid.width * grid.height) {
      console.warn(`  übersprungen: ${item.id} (${fixations.length} Fixationspunkte auf ${grid.width}x${grid.height})`)
      continue
    }

    const signalsPath = join(base, 'signals', `${item.id}.json`)
    const hasSignals = existsSync(signalsPath)

    yield {
      id: item.id,
      image,
      grid,
      signals: hasSignals ? (JSON.parse(readFileSync(signalsPath, 'utf8')) as NodeSignal[]) : [],
      frameWidth: image.width,
      frameHeight: image.height,
      truth: { salience, fixations, fixationSource },
      duration,
      hasSignals,
    }
  }
}

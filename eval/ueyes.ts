/**
 * A-2 — importing the UEyes data set.
 *
 * UEyes (CHI 2023, Jiang et al.), CC BY 4.0. The dataset path is a parameter,
 * never a constant: `--ueyes <pfad>` or the environment variable `UEYES_DIR`.
 *
 * What is taken over, and what deliberately is not:
 *   - only the `web` category (the README calls it "webpage")
 *   - the Train/Test assignment **from the index file**; no split is invented
 *   - `heatmaps_<d>s` as the continuous ground truth (CC, KL)
 *   - `fixmaps_<d>s` as the discrete fixations (AUC-Judd, NSS)
 *   - 1 s, 3 s and 7 s are all imported; only 3 s is scored for now, the other
 *     two are there for Epic D
 *   - no `signals/` sidecar: a screenshot has no layer tree, and inventing one
 *     would fake a measurement of three of the seven feature maps
 *
 * No code from the UEyes GitHub repository is used here — it carries no
 * licence. The published paper serves only as a reference for checking our own
 * metric implementations.
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { nodeImageOps } from '../src/platform/imageops-node'
import type { DatasetIndex, DatasetItem } from './dataset'

/** Both names occur: the README says `info.csv`, the release ships `image_types.csv`. */
const INDEX_FILE_NAMES = ['info.csv', 'image_types.csv']

/** The category column value for web pages. The README says "webpage". */
const WEB_CATEGORIES = ['web', 'webpage']

export const UEYES_DURATIONS = [1, 3, 7]

export const UEYES_CITATION =
  'Jiang, Yue, Luis A. Leiva, Hamed Rezazadegan Tavakoli, Paul R. B. Houssel, Julia Kylmälä und Antti Oulasvirta. ' +
  '"UEyes: Understanding Visual Saliency across User Interface Types." ' +
  'Proceedings of the 2023 CHI Conference on Human Factors in Computing Systems, S. 1–21, 2023. ' +
  'https://doi.org/10.1145/3544548.3581096'

export const UEYES_LICENSE = 'CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/)'

export type UeyesRow = {
  imageName: string
  category: string
  block: string
  split: string
}

/** Resolves the dataset root from an explicit path or `UEYES_DIR`. */
export function resolveDatasetRoot(explicit: string | undefined, env: Record<string, string | undefined>): string {
  const root = explicit ?? env.UEYES_DIR
  if (!root) {
    throw new Error(
      'Kein Datensatz-Pfad angegeben.\n' +
        '  npm run eval:fixtures -- --ueyes /pfad/zum/UEyes_dataset\n' +
        '  oder Umgebungsvariable UEYES_DIR setzen.',
    )
  }
  if (!existsSync(root) || !statSync(root).isDirectory()) {
    throw new Error(`Datensatz-Ordner nicht gefunden: ${root}`)
  }
  return root
}

/** Locates the index CSV and reports precisely what was looked for. */
export function resolveIndexFile(root: string): string {
  for (const name of INDEX_FILE_NAMES) {
    const path = join(root, name)
    if (existsSync(path)) return path
  }
  throw new Error(
    `Index-Datei nicht gefunden in ${root}.\n` +
      `Gesucht wurde nach: ${INDEX_FILE_NAMES.join(', ')}.\n` +
      'Erwartet werden die Spalten "Image Name", "Category", "Block", "Train/Test" (Semikolon-getrennt).',
  )
}

/**
 * Parses the index CSV. Column lookup is header-driven, so a differently
 * ordered `info.csv` still works; the separator is auto-detected because the
 * release uses `;` while the README implies a plain CSV.
 */
export function parseIndexCsv(text: string): UeyesRow[] {
  const lines = text.replace(/\r\n?/g, '\n').split('\n').filter((line) => line.trim().length > 0)
  if (lines.length < 2) throw new Error('Index-Datei enthält keine Datenzeilen.')

  const separator = (lines[0].match(/;/g)?.length ?? 0) >= (lines[0].match(/,/g)?.length ?? 0) ? ';' : ','
  const header = lines[0].split(separator).map((cell) => cell.trim().toLowerCase())

  const columnOf = (...candidates: string[]): number => {
    for (const candidate of candidates) {
      const index = header.indexOf(candidate)
      if (index >= 0) return index
    }
    throw new Error(
      `Spalte ${candidates.map((c) => `"${c}"`).join(' / ')} fehlt in der Index-Datei. Gefunden: ${header.join(', ')}`,
    )
  }

  const nameCol = columnOf('image name', 'image', 'name', 'filename')
  const categoryCol = columnOf('category', 'type', 'ui type')
  const blockCol = columnOf('block')
  const splitCol = columnOf('train/test', 'split', 'set')

  return lines.slice(1).map((line) => {
    const cells = line.split(separator)
    return {
      imageName: (cells[nameCol] ?? '').trim(),
      category: (cells[categoryCol] ?? '').trim(),
      block: (cells[blockCol] ?? '').trim(),
      split: (cells[splitCol] ?? '').trim(),
    }
  })
}

export function isWebRow(row: UeyesRow): boolean {
  return WEB_CATEGORIES.includes(row.category.toLowerCase())
}

/** Maps the dataset's own Train/Test label onto our split names. */
export function splitOf(row: UeyesRow): 'tuning' | 'test' | null {
  const value = row.split.toLowerCase()
  if (value === 'train' || value === 'training') return 'tuning'
  if (value === 'test' || value === 'testing') return 'test'
  return null
}

export type ImportOptions = {
  root: string
  target: string
  setName: string
  /** How many test images additionally carry the `quick` label for A-7. */
  quick: number
  log?: (message: string) => void
}

export type ImportSummary = {
  setName: string
  target: string
  tuning: number
  test: number
  quick: number
  skipped: Array<{ id: string; reason: string }>
  index: DatasetIndex
}

function copyPng(from: string, to: string): void {
  // Verified rather than blindly copied: our decoder handles 8-bit,
  // non-interlaced PNG only, and a file that fails here would otherwise blow up
  // in the middle of a long eval run.
  nodeImageOps.decodeSync(new Uint8Array(readFileSync(from)))
  copyFileSync(from, to)
}

export function importUeyes(options: ImportOptions): ImportSummary {
  const log = options.log ?? (() => {})
  const indexPath = resolveIndexFile(options.root)
  const rows = parseIndexCsv(readFileSync(indexPath, 'utf8'))

  const webRows = rows.filter(isWebRow)
  if (webRows.length === 0) {
    const categories = [...new Set(rows.map((row) => row.category))].join(', ')
    throw new Error(
      `Keine Zeilen der Kategorie ${WEB_CATEGORIES.join('/')} in ${indexPath}. Gefundene Kategorien: ${categories}`,
    )
  }
  log(`${indexPath}: ${rows.length} Zeilen, davon ${webRows.length} Kategorie "web"`)

  const base = join(options.target, options.setName)
  mkdirSync(join(base, 'images'), { recursive: true })
  for (const duration of UEYES_DURATIONS) {
    mkdirSync(join(base, 'heatmaps', `${duration}s`), { recursive: true })
    mkdirSync(join(base, 'fixmaps', `${duration}s`), { recursive: true })
  }

  const items: DatasetItem[] = []
  const skipped: ImportSummary['skipped'] = []
  let testSeen = 0

  for (const row of webRows) {
    const split = splitOf(row)
    if (!split) {
      skipped.push({ id: row.imageName, reason: `unbekannter Train/Test-Wert "${row.split}"` })
      continue
    }

    // The id drops the extension; every artefact is stored as `<id>.png`.
    const id = row.imageName.replace(/\.[^.]+$/, '')
    const sources = [
      { from: join(options.root, 'images', row.imageName), to: join(base, 'images', `${id}.png`) },
      ...UEYES_DURATIONS.flatMap((duration) => [
        {
          from: join(options.root, 'saliency_maps', `heatmaps_${duration}s`, row.imageName),
          to: join(base, 'heatmaps', `${duration}s`, `${id}.png`),
        },
        {
          from: join(options.root, 'saliency_maps', `fixmaps_${duration}s`, row.imageName),
          to: join(base, 'fixmaps', `${duration}s`, `${id}.png`),
        },
      ]),
    ]

    const missing = sources.filter((source) => !existsSync(source.from))
    if (missing.length > 0) {
      skipped.push({ id, reason: `fehlende Datei(en): ${missing.map((m) => m.from.replace(options.root, '…')).join(', ')}` })
      continue
    }

    try {
      for (const source of sources) copyPng(source.from, source.to)
    } catch (error) {
      skipped.push({ id, reason: error instanceof Error ? error.message : String(error) })
      continue
    }

    // The A-7 quick set is a prefix of the test split, so the gate never sees
    // an image the tuning split has touched.
    if (split === 'test' && testSeen < options.quick) {
      items.push({ id, split: ['test', 'quick'] })
      testSeen++
    } else {
      items.push({ id, split })
      if (split === 'test') testSeen++
    }

    if (items.length % 50 === 0) log(`  ${items.length} Bilder …`)
  }

  const index: DatasetIndex = {
    name: 'UEyes — Webpage-Teilmenge',
    source: `UEyes_dataset (${indexPath})`,
    license: UEYES_LICENSE,
    citation: UEYES_CITATION,
    durations: UEYES_DURATIONS,
    items,
  }

  return {
    setName: options.setName,
    target: base,
    tuning: items.filter((item) => item.split === 'tuning').length,
    test: items.filter((item) => item.split !== 'tuning').length,
    quick: items.filter((item) => Array.isArray(item.split)).length,
    skipped,
    index,
  }
}

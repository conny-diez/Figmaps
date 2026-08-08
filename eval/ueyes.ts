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
import { spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync } from 'node:fs'
import { basename, join } from 'node:path'
import { nodeImageOps } from '../src/platform/imageops-node'
import type { DatasetIndex, DatasetItem } from './dataset'

/** Both names occur: the README says `info.csv`, the release ships `image_types.csv`. */
const INDEX_FILE_NAMES = ['info.csv', 'image_types.csv']

/**
 * UI types of the data set, with the spellings that occur in the wild: the
 * README names them "webpage, desktop UI, mobile UI, poster", the released
 * index file writes the short forms.
 *
 * Each type is imported into its **own** set and reported separately. UEyes'
 * central finding is that location and gaze-direction bias differ between UI
 * types — averaging them together would erase exactly what we want to see.
 */
export const UEYES_CATEGORIES: Record<string, { label: string; matches: string[] }> = {
  web: { label: 'Webpage', matches: ['web', 'webpage'] },
  mobile: { label: 'Mobile UI', matches: ['mobile', 'mobile ui', 'mobileui'] },
  desktop: { label: 'Desktop UI', matches: ['desktop', 'desktop ui', 'desktopui'] },
  poster: { label: 'Poster', matches: ['poster'] },
}

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

export function categoryKey(name: string): string {
  const key = name.toLowerCase()
  for (const [id, entry] of Object.entries(UEYES_CATEGORIES)) {
    if (id === key || entry.matches.includes(key)) return id
  }
  throw new Error(
    `Unbekannte Kategorie "${name}". Verfügbar: ${Object.entries(UEYES_CATEGORIES)
      .map(([id, entry]) => `${id} (${entry.label})`)
      .join(', ')}`,
  )
}

export function rowHasCategory(row: UeyesRow, category: string): boolean {
  return UEYES_CATEGORIES[category].matches.includes(row.category.toLowerCase())
}

/** Kept for the web-specific call sites and tests. */
export function isWebRow(row: UeyesRow): boolean {
  return rowHasCategory(row, 'web')
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
  /** Which UI type to import — one set per type, never mixed. */
  category: string
  /** How many test images additionally carry the `quick` label for A-7. */
  quick: number
  log?: (message: string) => void
}

export type ImportSummary = {
  setName: string
  target: string
  category: string
  tuning: number
  test: number
  quick: number
  /** Files that had to be transcoded from JPEG to PNG. */
  converted: number
  skipped: Array<{ id: string; reason: string }>
  index: DatasetIndex
}

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47]

function isPng(path: string): boolean {
  const head = readFileSync(path).subarray(0, 4)
  return PNG_MAGIC.every((byte, i) => head[i] === byte)
}

/**
 * True when the file is a PNG *our* decoder can read.
 *
 * Being a PNG is not enough: part of the poster subset is interlaced (Adam7),
 * which the decoder rejects by design. Those files go through the transcoder
 * with the JPEGs instead of aborting the import — `sips` writes a baseline PNG.
 */
function isReadablePng(path: string): boolean {
  if (!isPng(path)) return false
  try {
    nodeImageOps.decodeSync(new Uint8Array(readFileSync(path)))
    return true
  } catch {
    return false
  }
}

/** Files per `sips` invocation — keeps the argument list well inside limits. */
const CONVERT_CHUNK = 200

/**
 * Transcodes non-PNG sources to PNG.
 *
 * Roughly half of UEyes ships as JPEG (the mobile subset entirely), and our
 * decoder is PNG-only by design — a JPEG decoder would be a large piece of
 * code whose only job is reading fixtures. `sips` is part of macOS; on other
 * platforms the error says what to install.
 */
function convertToPng(files: Array<{ from: string; to: string }>, outputDir: string): string[] {
  if (files.length === 0) return []

  for (let offset = 0; offset < files.length; offset += CONVERT_CHUNK) {
    const chunk = files.slice(offset, offset + CONVERT_CHUNK)
    const result = spawnSync('sips', ['-s', 'format', 'png', ...chunk.map((file) => file.from), '--out', outputDir], {
      encoding: 'utf8',
    })

    if (result.error && (result.error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(
        'Konvertierung nach PNG braucht `sips` (Teil von macOS) — nicht gefunden.\n' +
          'Auf anderen Plattformen die Bilder vorher konvertieren, z. B.:\n' +
          "  mogrify -format png -path <ziel> '*.jpg'",
      )
    }
    if (result.status !== 0) {
      throw new Error(`sips fehlgeschlagen (Exit ${result.status}): ${result.stderr?.trim() ?? 'keine Ausgabe'}`)
    }
  }

  // sips writes `<basename>.png` into the output directory; the ids already are
  // the basenames, so the names line up. Verify rather than assume.
  const failed: string[] = []
  for (const file of files) {
    if (!existsSync(file.to) || !isReadablePng(file.to)) failed.push(file.from)
  }
  return failed
}

/** Copies a PNG that has already been checked with `isReadablePng`. */
function copyPng(from: string, to: string): void {
  copyFileSync(from, to)
}

/**
 * Share of pixels in a fixation map that are neither 0 nor 255.
 *
 * A fixation map is binary by definition. Where UEyes stores it as JPEG, lossy
 * compression puts a ringing border around every blob — small, but it belongs
 * in the report rather than in a footnote nobody reads.
 */
export function nonBinaryShare(path: string): number {
  const bitmap = nodeImageOps.decodeSync(new Uint8Array(readFileSync(path)))
  const count = bitmap.width * bitmap.height
  let impure = 0
  for (let i = 0; i < count; i++) {
    const value = bitmap.data[i * 4]
    if (value !== 0 && value !== 255) impure++
  }
  return count === 0 ? 0 : impure / count
}

/** One artefact directory: where it comes from, where it goes. */
type Channel = { source: string; target: string }

export function importUeyes(options: ImportOptions): ImportSummary {
  const log = options.log ?? (() => {})
  const category = categoryKey(options.category)
  const indexPath = resolveIndexFile(options.root)
  const rows = parseIndexCsv(readFileSync(indexPath, 'utf8'))

  const selected = rows.filter((row) => rowHasCategory(row, category))
  if (selected.length === 0) {
    const categories = [...new Set(rows.map((row) => row.category))].join(', ')
    throw new Error(
      `Keine Zeilen der Kategorie "${category}" in ${indexPath}. Gefundene Kategorien: ${categories}`,
    )
  }
  log(`${indexPath}: ${rows.length} Zeilen, davon ${selected.length} Kategorie "${category}"`)

  const base = join(options.target, options.setName)
  const channels: Channel[] = [
    { source: join(options.root, 'images'), target: join(base, 'images') },
    ...UEYES_DURATIONS.flatMap((duration) => [
      { source: join(options.root, 'saliency_maps', `heatmaps_${duration}s`), target: join(base, 'heatmaps', `${duration}s`) },
      { source: join(options.root, 'saliency_maps', `fixmaps_${duration}s`), target: join(base, 'fixmaps', `${duration}s`) },
    ]),
  ]
  for (const channel of channels) mkdirSync(channel.target, { recursive: true })

  // --- 1) decide which rows are usable at all ------------------------------
  const skipped: ImportSummary['skipped'] = []
  const usable: Array<{ id: string; fileName: string; split: 'tuning' | 'test' }> = []

  for (const row of selected) {
    const split = splitOf(row)
    if (!split) {
      skipped.push({ id: row.imageName, reason: `unbekannter Train/Test-Wert "${row.split}"` })
      continue
    }

    const missing = channels.filter((channel) => !existsSync(join(channel.source, row.imageName)))
    if (missing.length > 0) {
      skipped.push({
        id: row.imageName,
        reason: `fehlende Datei(en) in ${missing.map((channel) => basename(channel.source)).join(', ')}`,
      })
      continue
    }

    // The id drops the extension; every artefact is stored as `<id>.png`.
    usable.push({ id: row.imageName.replace(/\.[^.]+$/, ''), fileName: row.imageName, split })
  }

  // --- 2) copy PNGs, transcode the rest, one batch per channel -------------
  let converted = 0
  const unreadable = new Set<string>()
  for (const channel of channels) {
    const toConvert: Array<{ from: string; to: string }> = []

    for (const entry of usable) {
      const from = join(channel.source, entry.fileName)
      const to = join(channel.target, `${entry.id}.png`)
      // Readable PNG -> copy verbatim. Everything else (JPEG, interlaced PNG,
      // 16-bit) goes through the transcoder rather than aborting the import.
      if (isReadablePng(from)) copyPng(from, to)
      else toConvert.push({ from, to })
    }

    if (toConvert.length > 0) {
      log(`  ${basename(channel.target)}: ${toConvert.length} Dateien nach PNG konvertieren …`)
      const failures = convertToPng(toConvert, channel.target)
      converted += toConvert.length - failures.length
      for (const from of failures) {
        unreadable.add(basename(from).replace(/\.[^.]+$/, ''))
      }
    }
  }

  // An image whose artefacts could not be made readable is dropped entirely —
  // a half-imported sample would fail later, in the middle of an eval run.
  for (const id of unreadable) {
    skipped.push({ id, reason: 'nicht lesbar und nicht konvertierbar (z. B. Adam7-Interlacing)' })
  }
  const readable = usable.filter((entry) => !unreadable.has(entry.id))

  // --- 3) how binary are the fixation maps really? -------------------------
  const fixmapDir = join(base, 'fixmaps', '3s')
  const probe = readable.slice(0, Math.min(20, readable.length))
  const impure = probe.map((entry) => nonBinaryShare(join(fixmapDir, `${entry.id}.png`)))
  const meanImpure = impure.length > 0 ? impure.reduce((sum, value) => sum + value, 0) / impure.length : 0

  const notes: string[] = []
  if (converted > 0) {
    notes.push(
      `${converted} Quelldateien lagen als JPEG vor und wurden verlustfrei nach PNG transcodiert ` +
        '(die JPEG-Kompression selbst ist bereits geschehen und nicht rückgängig zu machen).',
    )
  }
  if (meanImpure > 0.001) {
    notes.push(
      `Die Fixationskarten sind zu ${(meanImpure * 100).toFixed(1)} % nicht exakt binär (Stichprobe aus ${probe.length} Bildern) — ` +
        'JPEG-Ringing an den Rändern der Fixationsblobs. Beim Einlesen wird bei 127 re-binarisiert; ' +
        'ein dünner Saum je Blob bleibt als Rauschquelle, die in verlustfrei gespeicherten Teilmengen fehlt.',
    )
  }

  // --- 4) splits -----------------------------------------------------------
  const items: DatasetItem[] = []
  let testSeen = 0
  for (const entry of readable) {
    // The A-7 quick set is a prefix of the test split, so the gate never sees
    // an image the tuning split has touched.
    if (entry.split === 'test') {
      items.push({ id: entry.id, split: testSeen < options.quick ? ['test', 'quick'] : 'test' })
      testSeen++
    } else {
      items.push({ id: entry.id, split: entry.split })
    }
  }

  const index: DatasetIndex = {
    name: `UEyes — ${UEYES_CATEGORIES[category].label}-Teilmenge`,
    source: `UEyes_dataset (${indexPath}), Kategorie "${category}"`,
    license: UEYES_LICENSE,
    citation: UEYES_CITATION,
    durations: UEYES_DURATIONS,
    notes,
    items,
  }

  return {
    setName: options.setName,
    target: base,
    category,
    tuning: items.filter((item) => item.split === 'tuning').length,
    test: items.filter((item) => item.split !== 'tuning').length,
    quick: items.filter((item) => Array.isArray(item.split)).length,
    converted,
    skipped,
    index,
  }
}

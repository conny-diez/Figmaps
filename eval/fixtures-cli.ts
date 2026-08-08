/**
 * A-2 — preparing `eval/fixtures/`.
 *
 * Two modes:
 *
 *   --synthetic   generates a deterministic, licence-free set of UI-like
 *                 screens with a constructed ground truth. It does **not**
 *                 validate the engine — it validates the harness: metrics,
 *                 baselines, report and contact sheet all run end to end
 *                 without waiting for a dataset licence.
 *
 *   --import      converts an existing directory of screenshots + saliency maps
 *                 (e.g. the UEyes webpage subset) into the fixture layout and
 *                 assigns the tuning/test/quick splits.
 *
 * Fixtures are never committed: size and licence. See fixtures/README.md.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, extname, join } from 'node:path'
import type { Bitmap } from '../src/engine/ops'
import { blurField } from '../src/engine/ops-pure'
import type { NodeSignal } from '../src/messages'
import { nodeImageOps } from '../src/platform/imageops-node'
import type { DatasetIndex, DatasetItem } from './dataset'
import { mulberry32 } from './tune'

const ROOT = 'eval/fixtures'

type Rgb = [number, number, number]

function blank(width: number, height: number, color: Rgb): Bitmap {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let p = 0; p < data.length; p += 4) {
    data[p] = color[0]
    data[p + 1] = color[1]
    data[p + 2] = color[2]
    data[p + 3] = 255
  }
  return { width, height, data }
}

function paint(image: Bitmap, x: number, y: number, w: number, h: number, color: Rgb): void {
  const x0 = Math.max(0, Math.round(x))
  const y0 = Math.max(0, Math.round(y))
  const x1 = Math.min(image.width, Math.round(x + w))
  const y1 = Math.min(image.height, Math.round(y + h))
  for (let py = y0; py < y1; py++) {
    for (let px = x0; px < x1; px++) {
      const p = (py * image.width + px) * 4
      image.data[p] = color[0]
      image.data[p + 1] = color[1]
      image.data[p + 2] = color[2]
      image.data[p + 3] = 255
    }
  }
}

type Element = {
  name: string
  kind: 'headline' | 'body' | 'hero' | 'button' | 'chrome'
  x: number
  y: number
  width: number
  height: number
  color: Rgb
  /** Ground-truth attention weight of this element. */
  weight: number
}

/** One synthetic screen: layout, pixels, signals and constructed ground truth. */
function makeScreen(index: number, random: () => number): { image: Bitmap; truth: Bitmap; signals: NodeSignal[] } {
  const width = 1280
  const height = 800
  const image = blank(width, height, [246, 247, 249])

  const heroLeft = random() < 0.5
  const heroX = heroLeft ? 80 : 700
  const textX = heroLeft ? 700 : 80
  const accent: Rgb = [30 + Math.round(random() * 60), 90 + Math.round(random() * 120), 200 + Math.round(random() * 50)]

  const elements: Element[] = [
    { name: 'Header', kind: 'chrome', x: 0, y: 0, width, height: 72, color: [255, 255, 255], weight: 0.15 },
    { name: 'Logo', kind: 'chrome', x: 32, y: 24, width: 120, height: 24, color: [40, 40, 48], weight: 0.2 },
    {
      name: 'Hero-Bild',
      kind: 'hero',
      x: heroX,
      y: 140,
      width: 500,
      height: 340,
      color: [200 + Math.round(random() * 40), 120, 90],
      weight: 0.55 + random() * 0.3,
    },
    {
      name: 'Headline',
      kind: 'headline',
      x: textX,
      y: 170,
      width: 460,
      height: 90,
      color: [26, 26, 32],
      weight: 0.8 + random() * 0.2,
    },
    { name: 'Fließtext', kind: 'body', x: textX, y: 290, width: 440, height: 96, color: [110, 110, 120], weight: 0.2 },
    {
      name: 'Primary CTA Button',
      kind: 'button',
      x: textX,
      y: 420,
      width: 220,
      height: 56,
      color: accent,
      weight: 0.6 + random() * 0.35,
    },
    {
      name: 'Sekundär-Link',
      kind: 'button',
      x: textX + 250,
      y: 420,
      width: 160,
      height: 56,
      color: [225, 227, 232],
      weight: 0.25,
    },
    { name: 'Footer', kind: 'chrome', x: 0, y: 700, width, height: 100, color: [235, 236, 240], weight: 0.1 },
  ]

  for (const element of elements) paint(image, element.x, element.y, element.width, element.height, element.color)

  // Ground truth: a Gaussian per element, weighted, plus a mild centre bias —
  // the same shape an eye-tracking study would produce after smoothing.
  const truthField = new Float32Array(width * height)
  for (const element of elements) {
    const cx = element.x + element.width / 2
    const cy = element.y + element.height / 2
    const sigma = Math.max(40, Math.min(element.width, element.height) * 0.8)
    const radius = Math.round(sigma * 2.5)
    for (let y = Math.max(0, cy - radius); y < Math.min(height, cy + radius); y++) {
      for (let x = Math.max(0, cx - radius); x < Math.min(width, cx + radius); x++) {
        const dx = x - cx
        const dy = y - cy
        truthField[y * width + x] += element.weight * Math.exp(-(dx * dx + dy * dy) / (2 * sigma * sigma))
      }
    }
  }
  for (let y = 0; y < height; y++) {
    const ny = (y + 0.5) / height - 0.45
    for (let x = 0; x < width; x++) {
      const nx = (x + 0.5) / width - 0.5
      truthField[y * width + x] += 0.25 * Math.exp(-(nx * nx + ny * ny) / (2 * 0.3 * 0.3))
    }
  }

  const smoothed = blurField(truthField, width, height, 30)
  let max = 0
  for (const value of smoothed) if (value > max) max = value
  const truth = blank(width, height, [0, 0, 0])
  for (let i = 0, p = 0; i < smoothed.length; i++, p += 4) {
    const v = max > 0 ? Math.round((smoothed[i] / max) * 255) : 0
    truth.data[p] = truth.data[p + 1] = truth.data[p + 2] = v
  }

  const signals: NodeSignal[] = elements.map((element, i) => ({
    id: `${index}:${i}`,
    parentId: null,
    name: element.name,
    type: element.kind === 'headline' || element.kind === 'body' ? 'TEXT' : 'RECTANGLE',
    x: element.x,
    y: element.y,
    width: element.width,
    height: element.height,
    zIndex: i,
    opacity: 1,
    isText: element.kind === 'headline' || element.kind === 'body',
    fontSize: element.kind === 'headline' ? 56 : element.kind === 'body' ? 16 : undefined,
    fontWeight: element.kind === 'headline' ? 700 : 400,
    charCount: element.kind === 'headline' ? 34 : element.kind === 'body' ? 180 : undefined,
    isImage: element.kind === 'hero',
    hasFill: true,
    hasReactions: element.kind === 'button',
    nameHints: element.kind === 'button' ? ['button'] : [],
  }))

  return { image, truth, signals }
}

function writeSet(name: string, index: DatasetIndex): void {
  mkdirSync(join(ROOT, name), { recursive: true })
  writeFileSync(join(ROOT, name, 'index.json'), `${JSON.stringify(index, null, 2)}\n`)
}

function generateSynthetic(counts: { tuning: number; test: number; quick: number }): void {
  const name = 'synthetic'
  const base = join(ROOT, name)
  for (const dir of ['images', 'maps', 'signals']) mkdirSync(join(base, dir), { recursive: true })

  const items: DatasetItem[] = []
  const random = mulberry32(4711)
  const total = counts.tuning + counts.test

  for (let i = 0; i < total; i++) {
    const id = `syn-${String(i).padStart(3, '0')}`
    const { image, truth, signals } = makeScreen(i, random)
    writeFileSync(join(base, 'images', `${id}.png`), nodeImageOps.encode(image))
    writeFileSync(join(base, 'maps', `${id}.png`), nodeImageOps.encode(truth))
    writeFileSync(join(base, 'signals', `${id}.json`), JSON.stringify(signals))

    const isTuning = i < counts.tuning
    const split: DatasetItem['split'] =
      isTuning ? 'tuning' : items.filter((item) => item.split !== 'tuning').length < counts.quick ? ['test', 'quick'] : 'test'
    items.push({ id, split, duration: 3 })
    process.stdout.write(`\r  ${i + 1}/${total}   `)
  }
  process.stdout.write('\r              \r')

  writeSet(name, {
    name: 'FigMaps synthetic',
    source: 'generiert von npm run eval:fixtures -- --synthetic',
    license: 'keine — vollständig generiert',
    items,
  })

  console.log(`${total} synthetische Screens unter ${base}`)
  console.log('Achtung: dieses Set prüft den Harness, nicht die Engine. Die Ground Truth ist konstruiert,')
  console.log('nicht gemessen — Zahlen daraus sind kein Beleg für S-2 oder S-3.')
}

function importDirectory(from: string, name: string, counts: { tuning: number; test: number; quick: number }): void {
  const imagesFrom = join(from, 'images')
  const mapsFrom = join(from, 'maps')
  if (!existsSync(imagesFrom) || !existsSync(mapsFrom)) {
    throw new Error(`Erwartet werden ${imagesFrom} und ${mapsFrom} (jeweils PNG, 8 Bit, ohne Interlacing).`)
  }

  const base = join(ROOT, name)
  for (const dir of ['images', 'maps']) mkdirSync(join(base, dir), { recursive: true })

  const ids = readdirSync(imagesFrom)
    .filter((file) => extname(file).toLowerCase() === '.png')
    .map((file) => basename(file, '.png'))
    .sort()

  if (ids.length === 0) throw new Error(`Keine PNGs in ${imagesFrom}. Andere Formate vorher konvertieren (z. B. sips -s format png).`)

  const items: DatasetItem[] = []
  ids.forEach((id, i) => {
    const mapPath = join(mapsFrom, `${id}.png`)
    if (!existsSync(mapPath)) return
    writeFileSync(join(base, 'images', `${id}.png`), readFileSync(join(imagesFrom, `${id}.png`)))
    writeFileSync(join(base, 'maps', `${id}.png`), readFileSync(mapPath))

    // Deterministic split by position: tuning first, then test; the quick set
    // is a prefix of test. Splits stay strictly apart (A-2).
    const isTuning = i < counts.tuning
    const testIndex = i - counts.tuning
    const split: DatasetItem['split'] = isTuning ? 'tuning' : testIndex < counts.quick ? ['test', 'quick'] : 'test'
    items.push({ id, split })
  })

  writeSet(name, {
    name,
    source: from,
    license: 'VOR NUTZUNG PRÜFEN — siehe eval/fixtures/README.md',
    items,
  })
  console.log(`${items.length} Bilder importiert nach ${base}`)
  console.log(`  tuning: ${items.filter((item) => item.split === 'tuning').length}`)
  console.log(`  test:   ${items.filter((item) => item.split !== 'tuning').length}`)
  console.log(`  quick:  ${items.filter((item) => Array.isArray(item.split)).length}`)
}

export function main(argv: readonly string[]): number {
  const args = new Map<string, string | boolean>()
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith('--')) continue
    const key = argv[i].slice(2)
    const next = argv[i + 1]
    if (next === undefined || next.startsWith('--')) args.set(key, true)
    else {
      args.set(key, next)
      i++
    }
  }

  const number = (key: string, fallback: number): number => {
    const value = args.get(key)
    const parsed = typeof value === 'string' ? Number(value) : Number.NaN
    return Number.isFinite(parsed) ? parsed : fallback
  }

  const counts = {
    tuning: number('tuning', args.has('synthetic') ? 30 : 150),
    test: number('test', args.has('synthetic') ? 30 : 200),
    quick: number('quick', args.has('synthetic') ? 12 : 40),
  }

  try {
    if (args.has('synthetic')) {
      generateSynthetic(counts)
      return 0
    }
    const from = args.get('import')
    if (typeof from === 'string') {
      importDirectory(from, String(args.get('name') ?? 'ueyes-web'), counts)
      return 0
    }

    console.log(
      [
        'npm run eval:fixtures -- --synthetic [--tuning 30 --test 30 --quick 12]',
        '    Generiert ein lizenzfreies Set, um den Harness zu prüfen.',
        '',
        'npm run eval:fixtures -- --import <dir> --name ueyes-web [--tuning 150 --test 200 --quick 40]',
        '    Übernimmt <dir>/images/*.png und <dir>/maps/*.png in die Fixture-Struktur.',
        '',
        'UEyes (CHI 2023, Jiang et al.) liegt auf Zenodo. Der Download ist bewusst nicht',
        'automatisiert: die Lizenzfrage für die interne Nutzung bei meinestadt.de ist laut',
        'PRD §3 A-2 vom Product Owner mit der Rechtsabteilung zu klären, bevor Daten ins',
        'Repo-Umfeld gelangen. Siehe eval/fixtures/README.md.',
      ].join('\n'),
    )
    return 0
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    return 1
  }
}

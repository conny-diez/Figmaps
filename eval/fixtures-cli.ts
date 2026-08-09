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
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Bitmap } from '../src/engine/ops'
import { blurField } from '../src/engine/ops-pure'
import type { NodeSignal } from '../src/messages'
import { nodeImageOps } from '../src/platform/imageops-node'
import type { DatasetIndex, DatasetItem } from './dataset'
import { mulberry32 } from './tune'
import { importUeyes, resolveDatasetRoot } from './ueyes'

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
  // Layout varies per screen. A generator that emits one template makes every
  // findings rule fire on 0 % or 100 % of the set, which measures the
  // generator rather than the rules — that is what the first version did.
  const tall = random() < 0.4
  const height = tall ? 2200 : 800
  const image = blank(width, height, [246, 247, 249])

  const heroLeft = random() < 0.5
  const heroX = heroLeft ? 80 : 700
  const textX = heroLeft ? 700 : 80
  // Where the primary call to action sits, and how big it is: both decide
  // whether `cta-below-fold`, `cta-rank` and `dead-cta` have anything to say.
  const ctaY = tall && random() < 0.6 ? 1500 + Math.round(random() * 500) : 420
  const ctaWide = random() < 0.5
  const secondaryProminent = random() < 0.4
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
      y: ctaY,
      width: ctaWide ? 320 : 150,
      height: ctaWide ? 72 : 44,
      color: accent,
      weight: 0.6 + random() * 0.35,
    },
    {
      name: 'Alle Angebote',
      kind: 'button',
      x: textX + (ctaWide ? 350 : 180),
      y: ctaY,
      width: secondaryProminent ? 300 : 160,
      height: secondaryProminent ? 72 : 44,
      color: secondaryProminent ? [90, 90, 200] : [225, 227, 232],
      weight: secondaryProminent ? 0.5 : 0.25,
    },
    { name: 'Footer', kind: 'chrome', x: 0, y: height - 100, width, height: 100, color: [235, 236, 240], weight: 0.1 },
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

/** Top `share` of the truth field as a binary fixation map (0 or 255). */
function fixmapFrom(truth: Bitmap, share: number): Bitmap {
  const count = truth.width * truth.height
  const values = new Float32Array(count)
  for (let i = 0; i < count; i++) values[i] = truth.data[i * 4]
  const sorted = Float32Array.from(values).sort()
  const cutoff = sorted[Math.min(count - 1, Math.floor(count * (1 - share)))]

  const data = new Uint8ClampedArray(count * 4)
  for (let i = 0, p = 0; i < count; i++, p += 4) {
    const on = values[i] >= cutoff && cutoff > 0 ? 255 : 0
    data[p] = data[p + 1] = data[p + 2] = on
    data[p + 3] = 255
  }
  return { width: truth.width, height: truth.height, data }
}

function generateSynthetic(counts: { tuning: number; test: number; quick: number }): void {
  const name = 'synthetic'
  const base = join(ROOT, name)
  for (const dir of ['images', 'signals', 'heatmaps/3s', 'fixmaps/3s']) {
    mkdirSync(join(base, dir), { recursive: true })
  }

  const items: DatasetItem[] = []
  const random = mulberry32(4711)
  const total = counts.tuning + counts.test

  for (let i = 0; i < total; i++) {
    const id = `syn-${String(i).padStart(3, '0')}`
    const { image, truth, signals } = makeScreen(i, random)
    writeFileSync(join(base, 'images', `${id}.png`), nodeImageOps.encode(image))
    writeFileSync(join(base, 'heatmaps', '3s', `${id}.png`), nodeImageOps.encode(truth))
    // A constructed stand-in for measured fixations, so the synthetic set
    // exercises the same two-channel path as UEyes.
    writeFileSync(join(base, 'fixmaps', '3s', `${id}.png`), nodeImageOps.encode(fixmapFrom(truth, 0.01)))
    writeFileSync(join(base, 'signals', `${id}.json`), JSON.stringify(signals))

    const isTuning = i < counts.tuning
    const split: DatasetItem['split'] =
      isTuning ? 'tuning' : items.filter((item) => item.split !== 'tuning').length < counts.quick ? ['test', 'quick'] : 'test'
    items.push({ id, split })
    process.stdout.write(`\r  ${i + 1}/${total}   `)
  }
  process.stdout.write('\r              \r')

  writeSet(name, {
    name: 'Figmaps synthetic',
    source: 'generiert von npm run eval:fixtures -- --synthetic',
    license: 'keine — vollständig generiert',
    durations: [3],
    items,
  })

  console.log(`${total} synthetische Screens unter ${base}`)
  console.log('Achtung: dieses Set prüft den Harness, nicht die Engine. Die Ground Truth ist konstruiert,')
  console.log('nicht gemessen — Zahlen daraus sind kein Beleg für S-2 oder S-3.')
}

function runUeyesImport(explicitPath: string | undefined, category: string, name: string, quick: number): void {
  const root = resolveDatasetRoot(explicitPath, process.env)
  console.log(`UEyes-Datensatz: ${root}`)

  const summary = importUeyes({
    root,
    target: ROOT,
    setName: name,
    category,
    quick,
    log: (message) => console.log(message),
  })

  writeSet(name, summary.index)

  console.log('')
  console.log(`Importiert nach ${summary.target}`)
  console.log(`  Kategorie:      ${summary.category}`)
  console.log(`  tuning (Train): ${summary.tuning}`)
  console.log(`  test   (Test):  ${summary.test}`)
  console.log(`  davon quick:    ${summary.quick}`)
  console.log(`  Dauern:         ${summary.index.durations.map((d) => `${d}s`).join(', ')}`)
  if (summary.converted > 0) console.log(`  konvertiert:    ${summary.converted} JPEG → PNG`)
  console.log('')
  for (const note of summary.index.notes ?? []) console.log(`Hinweis: ${note}`)
  if ((summary.index.notes ?? []).length > 0) console.log('')
  console.log('Ground Truth: heatmaps/<d>s (kontinuierlich, für CC und KL)')
  console.log('              fixmaps/<d>s  (binär, für AUC-Judd und NSS)')
  console.log('Keine signals/ — ein Screenshot hat keinen Layer-Baum (Teilmessung, siehe Report).')

  if (summary.skipped.length > 0) {
    console.log('')
    console.log(`Übersprungen: ${summary.skipped.length}`)
    for (const entry of summary.skipped.slice(0, 10)) console.log(`  ${entry.id}: ${entry.reason}`)
    if (summary.skipped.length > 10) console.log(`  … und ${summary.skipped.length - 10} weitere`)
  }

  if (summary.test < 40) {
    console.log('')
    console.log(`Hinweis: Der Test-Split hat nur ${summary.test} Bilder. Das ist die Aufteilung des`)
    console.log('Datensatzes, nicht unsere — aber Mittelwerte darüber sind entsprechend unsicher.')
  }
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
    if (args.has('ueyes')) {
      const explicit = args.get('ueyes')
      const category = String(args.get('category') ?? 'web')
      runUeyesImport(
        typeof explicit === 'string' ? explicit : undefined,
        category,
        String(args.get('name') ?? `ueyes-${category}`),
        counts.quick,
      )
      return 0
    }

    console.log(
      [
        'npm run eval:fixtures -- --ueyes <pfad-zum-UEyes_dataset> [--category web] [--name …] [--quick 27]',
        '    Importiert eine Kategorie aus info.csv / image_types.csv.',
        '    --category: web | mobile | desktop | poster            (default: web)',
        '    Jede Kategorie landet in einem eigenen Set und wird getrennt berichtet —',
        '    Positions-Bias unterscheidet sich zwischen UI-Typen, Mischen verwischt das.',
        '    Der Pfad kann auch über die Umgebungsvariable UEYES_DIR kommen.',
        '    Übernommen wird die Train/Test-Aufteilung des Datensatzes, keine eigene.',
        '    Ground Truth: heatmaps_<d>s (für CC/KL) und fixmaps_<d>s (für AUC/NSS),',
        '    Dauern 1s, 3s und 7s. Ausgewertet wird zunächst nur 3s.',
        '    Nicht-PNG-Quellen werden mit `sips` nach PNG transcodiert.',
        '',
        'npm run eval:fixtures -- --synthetic [--tuning 30 --test 30 --quick 12]',
        '    Generiert ein lizenzfreies Set, um den Harness zu prüfen.',
        '    Nicht in Messungen der Engine einbeziehen — die Ground Truth ist konstruiert.',
        '',
        'UEyes steht unter CC BY 4.0. Die Autoren sind in jedem Report zu zitieren;',
        'das erledigt der Harness automatisch aus index.json.',
      ].join('\n'),
    )
    return 0
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    return 1
  }
}

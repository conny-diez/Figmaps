/**
 * Baut das **eingecheckte** Referenz-Set für das Regressions-Gate (A-7).
 *
 * WOZU. Das Gate lief bis 1.2 nie: erst war der Job rot, dann fehlte das
 * Referenz-Set im Actions-Cache und der Vergleich wurde übersprungen. Ein
 * Cache ist für diesen Zweck ohnehin die falsche Ablage — er kann verfallen,
 * und dann ist die Prüfung still weg. Ein kleines Set **im Repo** kann das
 * nicht.
 *
 * WAS DRIN IST. 20 Bilder je UI-Typ aus dem `quick`-Split, also aus dem
 * **Test**-Split des Datensatzes — nie aus dem Tuning-Split, sonst prüfte das
 * Gate gegen Daten, auf denen kalibriert wurde. Nur die 3-s-Ground-Truth: das
 * Gate bewertet eine Dauer, und 1 s und 7 s würden das Set verdreifachen.
 *
 * WARUM VERKLEINERT. Die Engine sieht ein Bild nie in Originalgröße: sie
 * rechnet auf dem **Analyseraster** (längste Kante 512), und die Ground Truth
 * wird beim Einlesen auf genau dasselbe Raster gebracht. Alles darüber wird
 * ohnehin weggeworfen. Hier wird deshalb direkt auf dieses Raster vorskaliert —
 * aus 30 MB werden gut 3.
 *
 * Für die **Fixationskarten** ist das nicht dasselbe wie ein Verkleinern: eine
 * Fixationskarte ist eine Menge von Orten, kein Intensitätsfeld. Der Loader
 * bildet sie mit Maximum-Pooling aufs Raster ab (`fixationsFromMask`), und
 * genau das passiert hier vorab — flächengemitteltes Verkleinern mit
 * anschließendem Schwellwert würde einzelne Fixationen verlieren.
 *
 * Eine Einschränkung gehört dazu und steht auch im `index.json`: die
 * Ground-Truth-Heatmaps werden einmal mehr resampled als beim vollen Set. Die
 * absoluten Zahlen aus diesem Set sind deshalb **nicht** mit denen aus dem
 * vollen Set vergleichbar. Für ein Gate ist das gleichgültig: es vergleicht
 * zwei Läufe auf **demselben** Set.
 *
 * LIZENZ. UEyes steht unter CC BY 4.0; die Weitergabe ist erlaubt, die Nennung
 * Pflicht. Sie steht in `NOTICE.md`, im `index.json` dieses Sets und in jedem
 * Report, der es liest.
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { analysisGridFor } from '../src/engine/analyze'
import type { Bitmap } from '../src/engine/ops'
import { nodeImageOps } from '../src/platform/imageops-node'
import { readIndex, type DatasetIndex } from './dataset'
import { UEYES_CITATION, UEYES_LICENSE } from './ueyes'

/** Die Dauer, die das Gate bewertet. */
const GATE_DURATION = 3

export type GateFixtureOptions = {
  /** Quell-Set, aus dem gezogen wird — muss lokal importiert sein. */
  source: string
  /** Ziel-Set unter `eval/fixtures/`. */
  target: string
  /** Wie viele Bilder übernommen werden. */
  count: number
  root?: string
  log?: (message: string) => void
}

export type GateFixtureSummary = {
  target: string
  count: number
  bytes: number
  /** Größe des Analyse-Quellbilds, auf die verkleinert wurde. */
  scaledTo: Array<{ id: string; from: string; to: string }>
}

function copyScaled(fromPath: string, toPath: string, width: number, height: number): number {
  const source = nodeImageOps.decodeSync(new Uint8Array(readFileSync(fromPath)))
  const scaled = source.width === width && source.height === height ? source : nodeImageOps.resize(source, width, height)
  const bytes = nodeImageOps.encode(scaled)
  writeFileSync(toPath, bytes)
  return bytes.byteLength
}

/**
 * Maximum-Pooling auf das Zielraster — dieselbe Abbildung, die
 * `fixationsFromMask` beim Einlesen macht.
 *
 * Eine Zelle gilt genau dann als fixiert, wenn irgendein Quellpixel darin es
 * war. Flächenmittelung würde Grauwerte erzeugen, die dann ein Schwellwert
 * entscheiden müsste — und dieser Schwellwert entschiede still, wie viele
 * Fixationen die Metriken sehen.
 */
function poolMask(fromPath: string, toPath: string, width: number, height: number): number {
  const mask = nodeImageOps.decodeSync(new Uint8Array(readFileSync(fromPath)))
  const data = new Uint8ClampedArray(width * height * 4)
  for (let i = 3; i < data.length; i += 4) data[i] = 255
  for (let y = 0; y < mask.height; y++) {
    const gy = Math.min(height - 1, Math.floor((y * height) / mask.height))
    const row = y * mask.width * 4
    for (let x = 0; x < mask.width; x++) {
      if (mask.data[row + x * 4] <= 127) continue
      const gx = Math.min(width - 1, Math.floor((x * width) / mask.width))
      const p = (gy * width + gx) * 4
      data[p] = data[p + 1] = data[p + 2] = 255
    }
  }
  const pooled: Bitmap = { width, height, data }
  const bytes = nodeImageOps.encode(pooled)
  writeFileSync(toPath, bytes)
  return bytes.byteLength
}

export function buildGateFixtures(options: GateFixtureOptions): GateFixtureSummary {
  const root = options.root ?? 'eval/fixtures'
  const log = options.log ?? (() => {})
  const index = readIndex(options.source, root)

  // Nur der `quick`-Anteil, und der ist per Konstruktion ein Präfix des
  // Test-Splits (siehe `ueyes.ts`). Das Gate darf keine Tuning-Bilder sehen.
  const candidates = index.items.filter((item) => Array.isArray(item.split) && item.split.includes('quick'))
  if (candidates.length < options.count) {
    throw new Error(
      `"${options.source}" hat nur ${candidates.length} Bilder im quick-Split, ${options.count} verlangt. ` +
        'Mehr gibt der Test-Split des Datensatzes nicht her — eine Auffüllung aus dem Tuning-Split wäre ein Fehler.',
    )
  }
  const selected = candidates.slice(0, options.count)

  const base = join(root, options.target)
  rmSync(base, { recursive: true, force: true })
  for (const dir of ['images', `heatmaps/${GATE_DURATION}s`, `fixmaps/${GATE_DURATION}s`]) {
    mkdirSync(join(base, dir), { recursive: true })
  }

  const sourceBase = join(root, options.source)
  let bytes = 0
  const scaledTo: GateFixtureSummary['scaledTo'] = []

  for (const item of selected) {
    const imagePath = join(sourceBase, 'images', `${item.id}.png`)
    const original = nodeImageOps.decodeSync(new Uint8Array(readFileSync(imagePath)))
    // Genau das Raster, auf dem die Engine rechnet und auf das der Loader die
    // Ground Truth bringt.
    const size = analysisGridFor(original.width, original.height)

    bytes += copyScaled(imagePath, join(base, 'images', `${item.id}.png`), size.width, size.height)
    bytes += copyScaled(
      join(sourceBase, 'heatmaps', `${GATE_DURATION}s`, `${item.id}.png`),
      join(base, 'heatmaps', `${GATE_DURATION}s`, `${item.id}.png`),
      size.width,
      size.height,
    )
    bytes += poolMask(
      join(sourceBase, 'fixmaps', `${GATE_DURATION}s`, `${item.id}.png`),
      join(base, 'fixmaps', `${GATE_DURATION}s`, `${item.id}.png`),
      size.width,
      size.height,
    )
    scaledTo.push({
      id: item.id,
      from: `${original.width}x${original.height}`,
      to: `${size.width}x${size.height}`,
    })
    log(`  ${item.id}: ${original.width}x${original.height} → ${size.width}x${size.height}`)
  }

  const gateIndex: DatasetIndex = {
    name: `${index.name} — Gate-Teilmenge`,
    source: `${options.source}, quick-Split (Präfix des Test-Splits), ${options.count} Bilder`,
    license: UEYES_LICENSE,
    citation: UEYES_CITATION,
    durations: [GATE_DURATION],
    notes: [
      'Eingecheckte Teilmenge für das Regressions-Gate (A-7). Erzeugt mit `npm run gate-fixtures`.',
      'Bilder und Ground Truth liegen auf dem Analyseraster (längste Kante 512) — genau dem Raster, auf dem ' +
        'die Engine rechnet und auf das der Loader die Ground Truth ohnehin bringt. Die Fixationskarten sind ' +
        'mit Maximum-Pooling abgebildet, nicht flächengemittelt: eine Fixationskarte ist eine Menge von Orten. ' +
        'Die Heatmaps werden dadurch einmal mehr resampled als beim vollen Set; die absoluten Zahlen aus diesem ' +
        'Set sind deshalb NICHT mit denen aus dem vollen Set vergleichbar. Für ein Gate ist das gleichgültig: ' +
        'es vergleicht zwei Läufe auf demselben Set.',
      'Ausschließlich Bilder aus dem Test-Split des Datensatzes. Eine Auffüllung aus dem Tuning-Split wäre ' +
        'ein Fehler — das Gate prüfte sonst gegen Daten, auf denen kalibriert wurde.',
      'Kein Tuning-Split enthalten, also auch keine Mean-Map-Baseline. Reports über dieses Set weisen das aus.',
    ],
    items: selected.map((item) => ({ id: item.id, split: ['test', 'quick'] as const })),
  }
  writeFileSync(join(base, 'index.json'), `${JSON.stringify(gateIndex, null, 2)}\n`)

  return { target: options.target, count: selected.length, bytes, scaledTo }
}

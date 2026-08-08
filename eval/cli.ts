/**
 * A-5 / A-6 / A-7 — the harness entry point.
 *
 *   npm run eval  -- --engine heuristic --set test --report out/eval-2026-08.md
 *   npm run eval  -- --set quick --gate --baseline out/gate-main.json
 *   npm run tune  -- --set tuning --iterations 300
 *
 * Runs offline in Node. It never imports anything from the iframe or the Figma
 * main thread — only the engine, which is platform free since A-1.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { PROFILE_IDS, type ProfileId } from '../src/engine/params'
import { renderContactSheet, type Triptych } from './contact-sheet'
import { loadSamples, type SplitName } from './dataset'
import { METRIC_IDS, METRIC_LABELS } from './metrics/types'
import { resolvePredictors } from './predictors'
import { buildReport } from './report'
import { runEvaluation, worstCases, type PredictorResult } from './runner'
import { renderTunedModule, tuneProfile, type TuneOutcome } from './tune'

const CONTACT_SHEET_CASES = 12

type Args = Record<string, string | boolean>

export function parseArgs(argv: readonly string[]): Args {
  const args: Args = {}
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i]
    if (!token.startsWith('--')) continue
    const key = token.slice(2)
    const next = argv[i + 1]
    if (next === undefined || next.startsWith('--')) {
      args[key] = true
    } else {
      args[key] = next
      i++
    }
  }
  return args
}

function str(args: Args, key: string, fallback: string): string {
  const value = args[key]
  return typeof value === 'string' ? value : fallback
}

function num(args: Args, key: string, fallback: number): number {
  const value = args[key]
  const parsed = typeof value === 'string' ? Number(value) : Number.NaN
  return Number.isFinite(parsed) ? parsed : fallback
}

function writeFile(path: string, content: string | Uint8Array): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, content)
}

function timestamp(): string {
  return new Date().toISOString().replace('T', ' ').slice(0, 16)
}

function logTable(results: readonly PredictorResult[]): void {
  const width = Math.max(...results.map((entry) => entry.predictor.label.length), 8)
  console.log('')
  console.log(`${'Engine'.padEnd(width)}  ${METRIC_IDS.map((id) => METRIC_LABELS[id].padStart(9)).join('  ')}`)
  for (const entry of results) {
    const cells = METRIC_IDS.map((id) =>
      (Number.isFinite(entry.mean[id]) ? entry.mean[id].toFixed(3) : '—').padStart(9),
    ).join('  ')
    console.log(`${entry.predictor.label.padEnd(width)}  ${cells}`)
  }
  console.log('')
}

// ---------------------------------------------------------------------------
// eval
// ---------------------------------------------------------------------------

async function runEval(args: Args): Promise<number> {
  const setName = str(args, 'fixtures', 'ueyes-web')
  const split = str(args, 'set', 'test') as SplitName
  const engine = str(args, 'engine', 'heuristic')
  const limit = args.limit ? num(args, 'limit', 0) : undefined

  const samples = loadSamples(setName, split, limit ? { limit } : {})
  const predictors = resolvePredictors(engine)
  const primary = predictors.find((predictor) => !predictor.baseline) ?? predictors[predictors.length - 1]

  console.log(`Referenz-Set "${setName}" / Split "${split}": ${samples.length} Bilder, ${predictors.length} Engines`)

  let lastPercent = -1
  const run = await runEvaluation(samples, predictors, {
    keepPredictionsFor: primary.id,
    onProgress: (done, total) => {
      const percent = Math.floor((done / total) * 100)
      if (percent !== lastPercent && percent % 10 === 0) {
        lastPercent = percent
        process.stdout.write(`\r  ${percent} %   `)
      }
    },
  })
  process.stdout.write('\r            \r')

  logTable(run.results)

  const primaryResult = run.results.find((entry) => entry.predictor.id === primary.id)
  const worst = primaryResult ? worstCases(primaryResult, CONTACT_SHEET_CASES) : []

  const reportPath = str(args, 'report', `out/eval-${new Date().toISOString().slice(0, 7)}.md`)
  let contactSheetPath: string | undefined

  if (worst.length > 0) {
    const byId = new Map(run.samples.map((sample) => [sample.id, sample]))
    const rows: Triptych[] = []
    for (const entry of worst) {
      const sample = byId.get(entry.sampleId)
      const prediction = run.primaryPredictions.get(entry.sampleId)
      if (!sample || !prediction) continue
      rows.push({ original: sample.image, truth: sample.truth.salience, prediction })
    }
    if (rows.length > 0) {
      const sheetPath = reportPath.replace(/\.md$/, '') + '-kontaktbogen.png'
      writeFile(sheetPath, renderContactSheet(rows))
      contactSheetPath = relative(dirname(reportPath), sheetPath) || sheetPath
      console.log(`Kontaktbogen: ${sheetPath}`)
    }
  }

  const notes: string[] = []
  if (limit) notes.push(`Lauf auf ${limit} Bildern begrenzt (\`--limit\`) — nicht als Abnahmezahl verwenden.`)
  if (worst.length < CONTACT_SHEET_CASES) {
    notes.push(`Kontaktbogen zeigt ${worst.length} statt ${CONTACT_SHEET_CASES} Fälle — das Set ist kleiner.`)
  }

  const markdown = buildReport({
    setName,
    split,
    generatedAt: timestamp(),
    samples: run.samples,
    results: run.results,
    worst,
    contactSheetPath,
    notes,
  })
  writeFile(reportPath, markdown)
  console.log(`Report: ${reportPath}`)

  // --- A-7 regression gate -------------------------------------------------
  if (args.gate) {
    const baselinePath = str(args, 'baseline', '')
    const maxDrop = num(args, 'max-cc-drop', 0.02)
    const current = primaryResult?.mean.cc ?? Number.NaN

    if (args.write) {
      writeFile(baselinePath || 'out/gate.json', JSON.stringify({ engine: primary.id, cc: current }, null, 2))
      console.log(`Gate-Referenz geschrieben: ${baselinePath || 'out/gate.json'}`)
      return 0
    }

    if (!baselinePath) {
      console.error('--gate benötigt --baseline <datei> (oder --write, um sie zu erzeugen)')
      return 2
    }
    const reference = JSON.parse(readFileSync(baselinePath, 'utf8')) as { cc: number }
    const drop = reference.cc - current
    console.log(`Gate: CC ${current.toFixed(4)} vs main ${reference.cc.toFixed(4)} (Δ ${(-drop).toFixed(4)})`)
    if (drop > maxDrop) {
      console.error(`CC ist um ${drop.toFixed(4)} gefallen — erlaubt sind ${maxDrop}.`)
      return 1
    }
  }

  return 0
}

// ---------------------------------------------------------------------------
// tune
// ---------------------------------------------------------------------------

async function runTune(args: Args): Promise<number> {
  const setName = str(args, 'fixtures', 'ueyes-web')
  const split = str(args, 'set', 'tuning') as SplitName
  if (split === 'test') {
    console.error('Getunt wird nie auf dem Test-Split — das ist der Punkt der Trennung (A-2).')
    return 2
  }

  const iterations = num(args, 'iterations', 300)
  const seed = num(args, 'seed', 20260808)
  const configId = str(args, 'config-id', 'heuristic-v2')
  const tunePrior = args.wide === true

  const samples = loadSamples(setName, split)
  console.log(`Tuning auf "${setName}" / "${split}": ${samples.length} Bilder, ${iterations} Iterationen, Seed ${seed}`)

  const outcomes = {} as Record<ProfileId, TuneOutcome>
  const withoutOwnData: ProfileId[] = []

  for (const [index, profile] of PROFILE_IDS.entries()) {
    // Epic D: each profile is tuned against its own UEyes viewing duration.
    const forProfile = samples.filter((sample) => sample.duration !== undefined && matchesDuration(sample.duration, profile))
    const used = forProfile.length > 0 ? forProfile : samples
    if (forProfile.length === 0) withoutOwnData.push(profile)

    // The seed is offset per profile: with identical data and an identical seed
    // all three searches would walk the same path and return the same weights,
    // which would look like a calibration result and be none.
    process.stdout.write(`  ${profile} (${used.length} Bilder${forProfile.length === 0 ? ', keine passende Dauer' : ''}) … `)
    outcomes[profile] = await tuneProfile(used, profile, { iterations, seed: seed + index * 1000, tunePrior })
    console.log(`CC ${outcomes[profile].baselineCc.toFixed(4)} → ${outcomes[profile].bestCc.toFixed(4)}`)
  }

  if (withoutOwnData.length > 0) {
    console.log('')
    console.log(
      `Warnung: für ${withoutOwnData.join(', ')} gibt es im Set keine Bilder mit passender Betrachtungsdauer.`,
    )
    console.log('Diese Profile wurden auf dem gesamten Split getunt und sind damit nicht kalibriert,')
    console.log('sondern nur angepasst. Ohne UEyes-Dauern (1 s / 3 s / 7 s) ist Epic D nicht belegbar.')
  }

  // Epic D gate — a profile only ships once it has been shown to beat
  // center-bias. That check runs in `npm run eval`; until it has, the flag
  // stays false and the UI keeps offering a single profile.
  const shipped: Record<ProfileId, boolean> = { glance: false, scan: false, read: false }
  const target = join('src', 'engine', 'tuned.ts')
  writeFile(target, renderTunedModule(configId, `Getunt auf ${setName}/${split}, Seed ${seed}`, outcomes, shipped))

  console.log('')
  console.log(`Geschrieben: ${target}`)
  console.log('Kein Auto-Deploy. Nächste Schritte:')
  console.log(`  1. npm run eval -- --engine ${configId} --set test`)
  console.log('  2. Kontaktbogen ansehen')
  console.log(`  3. bei Bedarf ENGINE_CONFIG.activeConfigId auf '${configId}' setzen`)
  console.log('  4. Profile, die Center-Bias schlagen, in tuned.ts auf shipped: true setzen')
  return 0
}

function matchesDuration(duration: number, profile: ProfileId): boolean {
  const target = { glance: 1, scan: 3, read: 7 }[profile]
  return Math.abs(duration - target) < 0.5
}

// ---------------------------------------------------------------------------

export async function main(argv: readonly string[]): Promise<number> {
  const args = parseArgs(argv)
  if (args.help) {
    console.log(
      [
        'npm run eval -- [options]',
        '  --engine <id>       heuristic | heuristic-v1 | <config>[:glance|scan|read] | all   (default: heuristic)',
        '  --set <split>       tuning | test | quick                                          (default: test)',
        '  --fixtures <name>   Referenz-Set unter eval/fixtures/                              (default: ueyes-web)',
        '  --report <path>     Zielpfad des Markdown-Reports',
        '  --limit <n>         nur die ersten n Bilder (Rauchtest)',
        '  --gate --baseline <file> [--max-cc-drop 0.02] [--write]   Regressions-Gate (A-7)',
        '',
        'npm run tune -- [options]',
        '  --set <split>       tuning | quick   (test ist gesperrt)',
        '  --iterations <n>    Random-Search-Iterationen                                       (default: 300)',
        '  --seed <n>          Seed der Suche                                                  (default: 20260808)',
        '  --config-id <id>    Name der erzeugten Konfiguration                                (default: heuristic-v2)',
        '  --wide              zusätzlich Positions-Prior und Gamma durchsuchen',
      ].join('\n'),
    )
    return 0
  }

  try {
    return args.tune ? await runTune(args) : await runEval(args)
  } catch (error) {
    console.error(`\n${error instanceof Error ? error.message : String(error)}`)
    return 1
  }
}

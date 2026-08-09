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
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import {
  ACTIVE_CONFIG_ID,
  cloneParams,
  DEFAULT_PROFILE,
  PROFILE_DURATIONS,
  PROFILE_IDS,
  resolveParams,
  type EngineParams,
  type ProfileId,
} from '../src/engine/params'
import { analyzeFrame } from '../src/engine/analyze'
import { HeuristicAttentionEngine } from '../src/engine/heuristic'
import { nodeImageOps } from '../src/platform/imageops-node'
import { renderContactSheet, type Triptych } from './contact-sheet'
import { iterateSamples, loadSamples, readIndex, type SplitName } from './dataset'
import { PRIOR_ASSET_IDS, PRIOR_DURATIONS, type PriorAssetId } from '../src/engine/priors'
import { buildPrior, renderPriorModule, type PriorBuild } from './build-prior'
import { crossValidate, ENGINE_LABELS, FOLDS } from './crossval'
import {
  alphaSweep,
  confirmOnTest,
  DEFAULT_ALPHAS,
  extendedAlphas,
  stillRising,
  type AlphaSweepResult,
  type TestConfirmation,
} from './alpha'
import { buildAlphaReport, buildTestConfirmationSection, decisionFor, DECISION_METRICS } from './alpha-report'
import { alphaVariants, runVisualCheck, type CheckVariant } from './visual-check'
import { ALL_RULE_IDS, buildSideEffectReport, measureSideEffects, SHIPPED_RULES } from './side-effects'
import { baseParams, beforeSharpnessVariant, sharpnessSweep, stageOneVariants, stageTwoVariants, type SharpnessResult, type Variant } from './sharpness'
import { buildSharpnessReport, verdictOf } from './sharpness-report'
import { groupSweep, GROUP_LABELS, type GroupSweepResult } from './groups'
import { measureCutoff } from './cutoff'
import { buildGateFixtures } from './gate-fixtures'
import { DURATIONS, measureEpicD, REFERENCE_DURATION } from './epic-d'
import { auditConstructed, auditFindings, quantiles, thresholdPosition, type AuditResult } from './findings-audit'
import { buildCrossvalReport } from './crossval-report'
import { buildEpicDReport } from './epic-d-report'
import { diagnose } from './diagnose'
import { buildDiagnoseReport } from './diagnose-report'
import { METRIC_IDS, METRIC_LABELS } from './metrics/types'
import { computeMeanMap, type MeanMap } from './mean-map'
import { CENTER_BIAS_SIGMAS, heuristicPredictor, meanMapPredictor, resolvePredictors } from './predictors'
import { buildReport, type UniformCheck } from './report'
import { meanProfile, runEvaluation, spatialProfile, sweepCenterBias, worstCases, type PredictorResult } from './runner'
import { renderTunedModule, tuneProfile, type TuneOutcome } from './tune'

const CONTACT_SHEET_CASES = 12

/**
 * A constant map cannot discriminate and cannot correlate. If these three are
 * not exact on real data, the import is wrong — not the engine. Abort rather
 * than publish numbers that look plausible.
 */
function checkUniform(results: readonly PredictorResult[]): UniformCheck {
  const uniform = results.find((entry) => entry.predictor.id === 'uniform')
  if (!uniform) return { ran: false, passed: false, problems: [] }

  const expectations: Array<[keyof typeof uniform.mean, number]> = [
    ['aucJudd', 0.5],
    ['cc', 0],
    ['nss', 0],
  ]
  const problems: string[] = []
  for (const [metric, expected] of expectations) {
    const actual = uniform.mean[metric]
    if (!Number.isFinite(actual) || Math.abs(actual - expected) > 1e-9) {
      problems.push(`${METRIC_LABELS[metric]}: erwartet ${expected}, gemessen ${actual}`)
    }
  }
  return { ran: true, passed: problems.length === 0, scores: uniform.mean, problems }
}

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
  // Voreinstellung ist die **ausgelieferte** Konfiguration, nicht mehr die
  // eingefrorene 1.0-Referenz.
  //
  // Bis 1.2 stand hier `'heuristic'`, und das hat das Regressions-Gate aus A-7
  // wirkungslos gemacht: `heuristic-v1` ist als Baseline markiert, also fiel
  // `primary` auf sie zurück, und das Gate schrieb ihren CC in die
  // Referenzdatei (0,2981). Diese Zahl kann sich nicht ändern — die
  // Konfiguration ist eingefroren. Das Gate hätte also **nie** ausgelöst,
  // gleich was mit der ausgelieferten Engine passiert. Gemessen am selben
  // Split: `hybrid-v1` liegt bei 0,4721.
  //
  // Dieselbe Fehlerklasse wie bei `cold-fold` und `flat`: eine Prüfung, die
  // grün ist, weil sie das Falsche ansieht.
  const engine = str(args, 'engine', ACTIVE_CONFIG_ID)
  const duration = num(args, 'duration', 3)
  const limit = args.limit ? num(args, 'limit', 0) : undefined

  const index = readIndex(setName)
  const samples = loadSamples(setName, split, { duration, ...(limit ? { limit } : {}) })
  // The prior category is stated, not inferred: raw screenshots carry device
  // pixels, where the plugin's width heuristic would misread a phone capture.
  const priorAsset: PriorAssetId | undefined = args['prior-asset']
    ? (str(args, 'prior-asset', 'web') as PriorAssetId)
    : setName.includes('mobile')
      ? 'mobile'
      : setName.includes('web')
        ? 'web'
        : undefined
  const predictors = resolvePredictors(engine, priorAsset)

  // `--blend-gamma` verstellt die Tonkurve der ausgelieferten Konfiguration.
  //
  // Der Schalter existiert für **einen** Zweck: nachzuweisen, dass das
  // Regressions-Gate überhaupt auslösen kann. Ein Gate, das nie rot wird, ist
  // kein Gate — und genau das war es bis 1.2, weil es die eingefrorene
  // Referenz bewachte. Dieselbe Lücke wie bei `cold-fold` und `flat`, drittes
  // Vorkommen; deshalb ist die Erreichbarkeit jetzt ein Schritt in der CI.
  if (typeof args['blend-gamma'] === 'string') {
    const gamma = num(args, 'blend-gamma', 1)
    for (const predictor of predictors) {
      if (predictor.baseline) continue
      const degraded = cloneParams(resolveParams(ACTIVE_CONFIG_ID))
      degraded.blendGamma = gamma
      const replacement = heuristicPredictor(ACTIVE_CONFIG_ID, DEFAULT_PROFILE, {
        label: `${predictor.label} — ABSICHTLICH VERSTELLT, blendGamma ${gamma}`,
        params: degraded,
        ...(priorAsset ? { priorAsset } : {}),
      })
      predictors[predictors.indexOf(predictor)] = { ...replacement, id: predictor.id }
    }
    console.log(`ACHTUNG: blendGamma auf ${gamma} verstellt. Das ist kein Messlauf, sondern ein Selbsttest.`)
  }

  // A-4, third baseline: the averaged ground truth of the *tuning* split.
  // Computed from tuning even when a different split is being scored, so the
  // baseline never contains the answer it is competing against.
  let meanMap: MeanMap | undefined
  if (args['mean-map'] !== false && !args['no-mean-map']) {
    try {
      process.stdout.write('Mean Map wird gebildet … ')
      meanMap = computeMeanMap(setName, 'tuning', duration)
      console.log(`${meanMap.count} Bilder`)
      predictors.unshift(meanMapPredictor(meanMap))
    } catch (error) {
      console.log('')
      console.warn(`  Mean-Map-Baseline übersprungen: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  const primary = predictors.find((predictor) => !predictor.baseline) ?? predictors[predictors.length - 1]

  console.log(
    `Referenz-Set "${setName}" / Split "${split}" / ${duration}s: ${samples.length} Bilder, ${predictors.length} Engines`,
  )

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

  const uniformCheck = checkUniform(run.results)
  if (uniformCheck.ran && !uniformCheck.passed) {
    console.error('Sanity-Check fehlgeschlagen — eine konstante Map muss exakt AUC 0,5 / CC 0 / NSS 0 liefern:')
    for (const problem of uniformCheck.problems) console.error(`  ${problem}`)
    console.error('')
    console.error('Das ist ein Befund über den Import, nicht über die Engine. Kein Report geschrieben.')
    console.error(`Prüfen: eval/fixtures/${setName}/ — Ground-Truth-Maps, Zuordnung Bild ↔ Map, Auflösungen.`)
    return 2
  }

  const centerBiasSweep = sweepCenterBias(run.samples, CENTER_BIAS_SIGMAS)

  const predictionProfiles = run.samples
    .map((sample) => run.primaryPredictions.get(sample.id))
    .filter((map): map is NonNullable<typeof map> => map !== undefined)
    .map(spatialProfile)
  const positionBias = {
    truth: meanProfile(run.samples.map((sample) => spatialProfile(sample.truth.salience))),
    ...(predictionProfiles.length > 0 ? { prediction: meanProfile(predictionProfiles) } : {}),
  }

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
  if (meanMap && split === 'tuning') {
    notes.push(
      'Die Mean-Map-Baseline wurde auf demselben Split gebildet, der hier bewertet wird. Ihre Werte sind ' +
        'deshalb optimistisch (in-sample) — für einen belastbaren Vergleich `--set test` verwenden.',
    )
  }
  if (worst.length < CONTACT_SHEET_CASES) {
    notes.push(`Kontaktbogen zeigt ${worst.length} statt ${CONTACT_SHEET_CASES} Fälle — das Set ist kleiner.`)
  }

  const markdown = buildReport({
    setName,
    split,
    duration,
    generatedAt: timestamp(),
    samples: run.samples,
    results: run.results,
    worst,
    index,
    uniformCheck,
    centerBiasSweep,
    positionBias,
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
// findings-audit — does every rule actually fire, and where does its threshold
// sit inside the distribution it cuts?
//
//   npm run findings-audit -- --fixtures ueyes-mobile --prior-asset mobile --single-viewport
//   npm run findings-audit -- --fixtures ueyes-web --viewport 500
//   npm run findings-audit -- --constructed [--variants 24]
//
// `--constructed` needs no dataset: it draws its own frames, and it is the only
// way to reach the three rules that require click candidates.
// ---------------------------------------------------------------------------

async function runFindingsAudit(args: Args): Promise<number> {
  if (args.constructed === true) return await runConstructedAudit(args)

  const setName = str(args, 'fixtures', 'ueyes-web')
  const viewportOverride = args.viewport ? num(args, 'viewport', 0) : undefined
  const limit = args.limit ? num(args, 'limit', 0) : undefined
  // Same flag as `npm run eval`, for the same reason: state the category
  // instead of letting the image size guess it.
  const priorAsset = args['prior-asset'] ? (str(args, 'prior-asset', 'web') as PriorAssetId) : undefined
  const segment = args['single-viewport'] !== true

  console.log(
    `Findings-Audit auf "${setName}"` +
      (viewportOverride ? `, Viewport erzwungen auf ${viewportOverride} px (sonst wäre nichts segmentiert)` : '') +
      (priorAsset ? `, Ortsprior "${priorAsset}"` : ', Ortsprior aus der Geometrie abgeleitet') +
      (segment ? '' : ', ein Viewport je Bild'),
  )
  let last = 0
  const result = await auditFindings({
    setName,
    ...(viewportOverride ? { viewportOverride } : {}),
    ...(limit ? { limit } : {}),
    ...(priorAsset ? { priorAsset } : {}),
    ...(segment ? {} : { segment: false }),
    onProgress: (done, total) => {
      if (done - last >= 25 || done === total) {
        last = done
        process.stdout.write(`\r  ${done}/${total} Bilder …   `)
      }
    },
  })
  process.stdout.write(`\r  ${result.imageCount} Bilder, davon ${result.withSignals} mit Layer-Signalen     \n`)

  printAudit(result)
  return 0
}

/**
 * The same audit on constructed frames with a layer tree.
 *
 * Exists because `cta-rank`, `cta-below-fold` and `dead-cta` need click
 * candidates, candidates need a layer tree, and a screenshot has none — on
 * UEyes those three are permanently blocked. The numbers are constructed, not
 * observed, and the header says so on every run.
 */
async function runConstructedAudit(args: Args): Promise<number> {
  const variants = args.variants ? num(args, 'variants', 24) : 24

  console.log(`Findings-Audit auf konstruierten Frames mit Layer-Baum, ${variants} Varianten je Form.`)
  console.log('ACHTUNG: konstruiert, nicht beobachtet. Eine Quote sagt, wie sich eine Regel auf einem')
  console.log('konventionellen Layout verhält — nicht, wie häufig ein solches Layout vorkommt.')

  let last = 0
  const results = await auditConstructed({
    variants,
    onProgress: (done, total) => {
      if (done - last >= 5 || done === total) {
        last = done
        process.stdout.write(`\r  ${done}/${total} Frames …   `)
      }
    },
  })
  process.stdout.write('\r                          \r')

  for (const result of results) printAudit(result)
  return 0
}

/**
 * Fire rate, distribution, and — the column that matters — where the threshold
 * sits inside that distribution. A threshold outside the observed range means
 * the rule can only ever fire always or never; that is how `flat` and
 * `dead-cta` were finally understood.
 */
function printAudit(result: AuditResult): void {
  console.log('')
  console.log(
    `${result.setName}: ${result.imageCount} Frames, Ortsprior ${result.priorAsset}, ` +
      `${result.segmented ? 'segmentiert' : 'ein Viewport'} — die Quoten gelten nur für diese Konfiguration.`,
  )
  console.log('  Regel              feuert   stumm  blockiert   Anteil  Schwelle  liegt bei')
  for (const rule of result.rules) {
    const evaluated = rule.fired + rule.silent
    const share = evaluated > 0 ? `${((rule.fired / evaluated) * 100).toFixed(1)} %` : '—'
    const position = evaluated > 0 ? thresholdPosition(rule.samples, rule.threshold?.value ?? null) : '—'
    const flag =
      (evaluated === 0
        ? '  (nicht bewertbar)'
        : rule.fired === 0
          ? '  ← feuert NIE'
          : rule.fired === evaluated
            ? '  ← feuert IMMER'
            : position === 'ÜBER max' || position === 'UNTER min'
              ? '  ← Schwelle außerhalb'
              : '') + (rule.shipped ? '' : '  [nicht ausgeliefert]')
    console.log(
      `    ${rule.id.padEnd(16)} ${String(rule.fired).padStart(5)} ${String(rule.silent).padStart(7)} ` +
        `${String(rule.blocked).padStart(10)}  ${share.padStart(7)}  ${(rule.threshold ? String(rule.threshold.value) : '—').padStart(8)}  ${position.padStart(9)}${flag}`,
    )
  }
  for (const rule of result.rules) {
    if (rule.blocked > 0) console.log(`    ${rule.id}: ${rule.blocked}x blockiert — ${rule.blockedReason}`)
  }
  console.log('  Verteilung der Entscheidungsgröße (p5 / p25 / Median / p75 / p95):')
  for (const rule of result.rules) {
    if (rule.samples.length === 0) continue
    const q = quantiles(rule.samples).map((value) => value.toFixed(3))
    console.log(`    ${rule.id.padEnd(16)} ${q.join('  ')}   [${rule.variable}]`)
  }
}

// ---------------------------------------------------------------------------
// epic-d — is viewing duration a prior effect?
// ---------------------------------------------------------------------------

async function runEpicD(args: Args): Promise<number> {
  const setName = str(args, 'fixtures', 'ueyes-web')
  console.log(`Epic D auf "${setName}" — Prior je Dauer, ${FOLDS} Folds, out-of-sample.`)

  let last = 0
  const result = await measureEpicD({
    setName,
    onProgress: (done, total) => {
      if (done - last >= 25 || done === total) {
        last = done
        process.stdout.write(`\r  ${done}/${total} Bilder …   `)
      }
    },
  })
  process.stdout.write(`\r  ${result.imageCount} Bilder bewertet          \n\n`)

  console.log('Ähnlichkeit der drei Prioren untereinander (CC):')
  for (const entry of result.priorSimilarity) {
    console.log(`  ${entry.a}s ↔ ${entry.b}s   ${entry.cc.toFixed(4)}`)
  }
  console.log('')

  console.log('CC — Zeile = Ground-Truth-Dauer, Spalte = verwendeter Prior:')
  console.log('          ' + DURATIONS.map((d) => `${d}s-Prior`.padStart(11)).join(''))
  for (const truth of DURATIONS) {
    const cells = DURATIONS.map((prior) => {
      const cell = result.cells.find((entry) => entry.truth === truth && entry.prior === prior)!
      const best = truth === prior ? '*' : ' '
      return `${cell.mean.cc.toFixed(4)}${best}`.padStart(11)
    }).join('')
    console.log(`  GT ${truth}s  ` + cells)
  }
  console.log('  (* = Prior passt zur Ground-Truth-Dauer)')
  console.log('')

  console.log(`Gepaart gegen den ${REFERENCE_DURATION}s-Prior, CC (+ = besser):`)
  for (const entry of result.comparisons.filter((c) => c.metric === 'cc')) {
    const flag = entry.ci95[0] > 0 ? 'belastbar besser' : entry.ci95[1] < 0 ? 'belastbar schlechter' : 'nicht unterscheidbar'
    console.log(
      `  GT ${entry.truth}s mit ${entry.prior}s-Prior: ${entry.mean >= 0 ? '+' : ''}${entry.mean.toFixed(4)} ` +
        `[${entry.ci95[0].toFixed(4)}, ${entry.ci95[1].toFixed(4)}]  t=${entry.tStatistic.toFixed(1)}  → ${flag}`,
    )
  }
  console.log('')
  console.log(
    result.durationMatters
      ? 'BEFUND: Ein dauerspezifischer Prior schlägt den 3s-Prior auf der eigenen Dauer. Drei Profile sind gerechtfertigt.'
      : 'BEFUND: Kein dauerspezifischer Prior schlägt den 3s-Prior auf der eigenen Dauer. Epic D ist zu streichen.',
  )

  const reportPath = str(args, 'report', `out/epic-d-${setName}.md`)
  writeFile(reportPath, buildEpicDReport(result, timestamp()))
  console.log(`Report: ${reportPath}`)
  return 0
}

// ---------------------------------------------------------------------------
// alpha — 1.2 A: how much the image analysis may count
//
//   npm run alpha
//   npm run alpha -- --alphas 0.3,0.5,0.8,1.2,1.8,2.7 --extend
//   npm run alpha -- --confirm            (der eine erlaubte Blick auf test)
//
// Läuft auf dem Tuning-Split, kreuzvalidiert, Ortsprior und Mean Map je Fold
// neu geschätzt. `--confirm` ist ein eigener Schalter, weil der Test-Split
// nicht nebenbei verbraucht werden darf.
// ---------------------------------------------------------------------------

const ALPHA_SETS: ReadonlyArray<{ setName: string; priorAsset: PriorAssetId }> = [
  { setName: 'ueyes-web', priorAsset: 'web' },
  { setName: 'ueyes-mobile', priorAsset: 'mobile' },
]

async function runAlpha(args: Args): Promise<number> {
  const duration = num(args, 'duration', 3)
  const folds = num(args, 'folds', 5)
  const limit = args.limit ? num(args, 'limit', 0) : undefined
  const requested = typeof args.alphas === 'string' ? args.alphas.split(',').map(Number).filter(Number.isFinite) : undefined
  const sets = typeof args.fixtures === 'string'
    ? ALPHA_SETS.filter((entry) => (args.fixtures as string).split(',').includes(entry.setName))
    : ALPHA_SETS

  let alphas = requested ?? [...DEFAULT_ALPHAS]
  const notes: string[] = []
  const results: AlphaSweepResult[] = []

  // `--confirm-only` überspringt den Sweep und macht ausschließlich den einen
  // Blick auf den Test-Split. Der Sweep dauert eine halbe Stunde je Kategorie,
  // und ihn allein für die Bestätigung zu wiederholen wäre kein zweites
  // Ergebnis — sondern dasselbe, zweimal bezahlt.
  if (args['confirm-only']) {
    const chosen = num(args, 'chosen', Number.NaN)
    if (!Number.isFinite(chosen)) {
      console.error('--confirm-only braucht --chosen <α>: welcher Wert bestätigt werden soll.')
      return 2
    }
    const referenceAlpha = num(args, 'reference', 0.3)
    console.log(`Test-Split, einmalig: α = ${chosen} gegen α = ${referenceAlpha}.`)
    const confirmations: TestConfirmation[] = []
    for (const set of sets) {
      const confirmation = await confirmOnTest({
        setName: set.setName,
        duration,
        alphas: [chosen],
        priorAsset: set.priorAsset,
        referenceAlpha,
      })
      confirmations.push(confirmation)
      console.log(`  ${set.setName}: ${confirmation.imageCount} Bilder`)
      for (const alpha of confirmation.alphas) {
        const metrics = confirmation.metrics.get(alpha)!
        console.log(
          `    α ${String(alpha).padEnd(4)} ` +
            `${METRIC_IDS.map((id) => `${METRIC_LABELS[id]} ${metrics[id].mean.toFixed(3)}`).join('  ')}` +
            `  Konz. ${confirmation.concentration.get(alpha)!.mean.toFixed(3)}`,
        )
      }
      console.log(`    Ground-Truth-Konzentration ${confirmation.truthConcentration.mean.toFixed(3)}`)
      for (const alpha of confirmation.alphas) {
        if (alpha === referenceAlpha) continue
        for (const delta of confirmation.paired.get(alpha)!) {
          console.log(
            `    Δ ${METRIC_LABELS[delta.metric].padEnd(9)} ${delta.mean >= 0 ? '+' : ''}${delta.mean.toFixed(4)}  ` +
              `95%-KI [${delta.ci95[0].toFixed(4)}, ${delta.ci95[1].toFixed(4)}]  t=${delta.tStatistic.toFixed(1)}`,
          )
        }
      }
    }
    const path = str(args, 'report', 'out/alpha-test-split.md')
    writeFile(path, buildTestConfirmationSection(confirmations))
    console.log('')
    console.log(`Report: ${path}`)
    return 0
  }

  for (let round = 0; ; round++) {
    results.length = 0
    for (const set of sets) {
      console.log(`Alpha-Sweep "${set.setName}" / tuning / ${duration}s — α ∈ {${alphas.join(', ')}}, ${folds} Folds.`)
      let last = 0
      const result = await alphaSweep({
        setName: set.setName,
        duration,
        folds,
        alphas,
        ...(limit ? { limit } : {}),
        onProgress: (done, total) => {
          if (done - last >= 25 || done === total) {
            last = done
            process.stdout.write(`\r  ${done}/${total} Bilder …   `)
          }
        },
      })
      process.stdout.write(`\r  ${result.imageCount} Bilder out-of-sample bewertet     \n`)
      printAlpha(result)
      results.push(result)
    }

    // A2: „und weiter, falls die Kurve am Ende noch steigt".
    // `--no-extend` landet als eigener Schlüssel im Parser, nicht als
    // `extend: false` — dieselbe Schreibweise wie bei `--no-mean-map`.
    if (args['no-extend'] === true || args.extend === false || round >= 2) break
    const rising = new Set(results.flatMap((result) => stillRising(result)))
    if (rising.size === 0) break
    const next = extendedAlphas(alphas)
    console.log('')
    console.log(
      `Die Kurve steigt am oberen Ende noch (${[...rising].map((id) => METRIC_LABELS[id]).join(', ')}) — ` +
        `verlängert um α = ${next.join(', ')}.`,
    )
    notes.push(
      `Der Sweep wurde verlängert: bei α = ${Math.max(...alphas)} stiegen ${[...rising]
        .map((id) => METRIC_LABELS[id])
        .join(', ')} gegenüber dem vorletzten Punkt noch über den Standardfehler hinaus.`,
    )
    alphas = [...alphas, ...next]
  }

  const reportPath = str(args, 'report', 'out/alpha.md')
  let markdown = buildAlphaReport(results, timestamp(), notes)

  if (args.confirm) {
    const winners = results.map((result) => decisionFor(result).winner).filter((alpha): alpha is number => alpha !== null)
    const chosen = num(args, 'chosen', winners.length > 0 ? Math.max(...winners) : results[0].referenceAlpha)
    console.log('')
    console.log(`Test-Split, einmalig: α = ${chosen} gegen α = ${results[0].referenceAlpha}.`)
    const confirmations: TestConfirmation[] = []
    for (const set of sets) {
      const confirmation = await confirmOnTest({
        setName: set.setName,
        duration,
        alphas: [chosen],
        priorAsset: set.priorAsset,
        referenceAlpha: results.find((result) => result.setName === set.setName)?.referenceAlpha ?? 0.3,
      })
      confirmations.push(confirmation)
      console.log(`  ${set.setName}: ${confirmation.imageCount} Bilder`)
      for (const alpha of confirmation.alphas) {
        const metrics = confirmation.metrics.get(alpha)!
        console.log(
          `    α ${String(alpha).padEnd(4)} ${METRIC_IDS.map((id) => `${METRIC_LABELS[id]} ${metrics[id].mean.toFixed(3)}`).join('  ')}`,
        )
      }
    }
    markdown += '\n\n---\n\n' + buildTestConfirmationSection(confirmations)
  }

  writeFile(reportPath, markdown)
  console.log('')
  console.log(`Report: ${reportPath}`)
  return 0
}

function printAlpha(result: AlphaSweepResult): void {
  console.log('')
  console.log(`  Konzentration (Top-5-%-Masse): Ground Truth ${result.truthConcentration.mean.toFixed(3)}`)
  console.log(`  ${'α'.padEnd(6)}${METRIC_IDS.map((id) => METRIC_LABELS[id].padStart(10)).join('')}${'Konz.'.padStart(10)}`)
  for (const point of result.points) {
    const cells = METRIC_IDS.map((id) => point.metrics[id].mean.toFixed(3).padStart(10)).join('')
    console.log(`  ${String(point.alpha).padEnd(6)}${cells}${point.concentration.mean.toFixed(3).padStart(10)}`)
  }
  const meanMapCells = METRIC_IDS.map((id) => result.meanMap.metrics[id].mean.toFixed(3).padStart(10)).join('')
  console.log(`  ${'Mean'.padEnd(6)}${meanMapCells}${result.meanMap.concentration.mean.toFixed(3).padStart(10)}`)
  const decision = decisionFor(result)
  console.log(
    `  Bester Wert — ${DECISION_METRICS.map((id) => `${METRIC_LABELS[id]} α=${decision.best[id]}`).join(', ')}` +
      `   (KL α=${decision.best.kl}, nicht Kriterium)`,
  )
  console.log('')
}

// ---------------------------------------------------------------------------
// sharpness — 1.2 A6: die Nachbearbeitung, nicht das Mischungsverhältnis
//
//   npm run sharpness                 Stufe 1 und Stufe 2 nacheinander
//   npm run sharpness -- --stage 1    nur die Einzelhebel
// ---------------------------------------------------------------------------

async function runSharpness(args: Args): Promise<number> {
  const duration = num(args, 'duration', 3)
  const folds = num(args, 'folds', 5)
  const limit = args.limit ? num(args, 'limit', 0) : undefined
  const stage = num(args, 'stage', 0)
  const sets = typeof args.fixtures === 'string'
    ? ALPHA_SETS.filter((entry) => (args.fixtures as string).split(',').includes(entry.setName))
    : ALPHA_SETS

  const runStage = async (variants: readonly Variant[], title: string): Promise<SharpnessResult[]> => {
    const out: SharpnessResult[] = []
    for (const set of sets) {
      console.log(`${title} — "${set.setName}", ${variants.length} Varianten, ${folds} Folds.`)
      let last = 0
      const result = await sharpnessSweep({
        setName: set.setName,
        duration,
        folds,
        variants,
        ...(limit ? { limit } : {}),
        onProgress: (done, total) => {
          if (done - last >= 25 || done === total) {
            last = done
            process.stdout.write(`\r  ${done}/${total} Bilder …   `)
          }
        },
      })
      process.stdout.write(`\r  ${result.imageCount} Bilder out-of-sample bewertet     \n`)
      printSharpness(result)
      out.push(result)
    }
    return out
  }

  const stageOne = await runStage(stageOneVariants(), 'Stufe 1')
  writeFile(str(args, 'report', 'out/schaerfe-stufe1.md'), buildSharpnessReport(stageOne, 'Stufe 1 — ein Hebel nach dem anderen', timestamp()))
  console.log(`Report: ${str(args, 'report', 'out/schaerfe-stufe1.md')}`)
  if (stage === 1) return 0

  const two = stageTwoVariants(stageOne)
  if (two.length <= 1) {
    console.log('')
    console.log('Kein Hebel hat Stufe 1 überstanden — keine Kombination zu prüfen. Das ist ein Ergebnis.')
    return 0
  }
  console.log('')
  const stageTwo = await runStage(two, 'Stufe 2')
  const path2 = str(args, 'report2', 'out/schaerfe-stufe2.md')
  writeFile(path2, buildSharpnessReport(stageTwo, 'Stufe 2 — Kombinationen', timestamp()))
  console.log(`Report: ${path2}`)
  return 0
}

function printSharpness(result: SharpnessResult): void {
  const basis = result.points.find((point) => point.variant.id === 'basis')
  console.log('')
  console.log(`  Konzentration Ground Truth ${result.truthConcentration.mean.toFixed(3)}`)
  console.log(`  ${'Hebel'.padEnd(12)}${'Wert'.padEnd(24)}${METRIC_IDS.map((id) => METRIC_LABELS[id].padStart(9)).join('')}${'Konz.'.padStart(9)}   Urteil`)
  for (const point of result.points) {
    const cells = METRIC_IDS.map((id) => point.metrics[id].mean.toFixed(3).padStart(9)).join('')
    const verdict = point.variant.id === 'basis' ? '—' : verdictOf(point)
    console.log(
      `  ${point.variant.lever.padEnd(12)}${point.variant.label.slice(0, 23).padEnd(24)}${cells}` +
        `${point.concentration.mean.toFixed(3).padStart(9)}   ${verdict}`,
    )
  }
  if (basis) console.log(`  (Ist-Zustand Konzentration ${basis.concentration.mean.toFixed(3)})`)
  console.log('')
}

// ---------------------------------------------------------------------------
// groups — 1.2 A7: wirkt blendGamma auf beide Hälften des Datensatzes gleich?
//
//   npm run groups -- --gammas 0.3,1.6,2.0
// ---------------------------------------------------------------------------

async function runGroups(args: Args): Promise<number> {
  const duration = num(args, 'duration', 3)
  const folds = num(args, 'folds', 5)
  const limit = args.limit ? num(args, 'limit', 0) : undefined
  const blendGammas = typeof args.gammas === 'string'
    ? args.gammas.split(',').map(Number).filter(Number.isFinite)
    : [0.3, 1.6, 2.0]
  const sets = typeof args.fixtures === 'string'
    ? ALPHA_SETS.filter((entry) => (args.fixtures as string).split(',').includes(entry.setName))
    : ALPHA_SETS

  const results: GroupSweepResult[] = []
  for (const set of sets) {
    console.log(`Gruppen-Sweep "${set.setName}" — blendGamma ∈ {${blendGammas.join(', ')}}, ${folds} Folds.`)
    console.log('  Die Gruppen werden EINMAL im Zustand vor der Schärfe-Änderung bestimmt und dann festgehalten.')
    let last = 0
    const result = await groupSweep({
      setName: set.setName,
      duration,
      folds,
      blendGammas,
      ...(limit ? { limit } : {}),
      onProgress: (done, total) => {
        if (done - last >= 25 || done === total) {
          last = done
          process.stdout.write(`\r  ${done}/${total} Bilder …   `)
        }
      },
    })
    process.stdout.write(`\r  ${result.imageCount} Bilder bewertet          \n`)
    printGroups(result)
    results.push(result)
  }

  writeFile(str(args, 'report', 'out/gruppen.md'), buildGroupReport(results, timestamp()))
  console.log(`Report: ${str(args, 'report', 'out/gruppen.md')}`)
  return 0
}

function printGroups(result: GroupSweepResult): void {
  for (const group of result.groups) {
    console.log('')
    console.log(
      `  ${GROUP_LABELS[group.group]} — ${group.imageCount} Bilder, ` +
        `Konzentration der Ground Truth ${group.truthConcentration.mean.toFixed(3)}`,
    )
    console.log(`  ${'γ'.padEnd(6)}${METRIC_IDS.map((id) => METRIC_LABELS[id].padStart(10)).join('')}${'Konz.'.padStart(10)}   ΔCC gegen γ=1`)
    for (const point of group.points) {
      const cells = METRIC_IDS.map((id) => point.metrics[id].mean.toFixed(3).padStart(10)).join('')
      const delta = point.versusNoGamma.cc
      const verdict = point.blendGamma === 1 ? '' : `   ${delta.mean >= 0 ? '+' : ''}${delta.mean.toFixed(4)} [${delta.ci95[0].toFixed(4)}, ${delta.ci95[1].toFixed(4)}]`
      console.log(`  ${String(point.blendGamma).padEnd(6)}${cells}${point.concentration.mean.toFixed(3).padStart(10)}${verdict}`)
    }
  }
  console.log('')
}

function buildGroupReport(results: readonly GroupSweepResult[], generatedAt: string): string {
  const lines: string[] = []
  lines.push('# Wirkt `blendGamma` auf beide Hälften des Datensatzes gleich? (1.2 A7)')
  lines.push('')
  lines.push(`Erzeugt: ${generatedAt}`)
  lines.push('')
  lines.push(
    'Die Gruppen kommen aus der Mean-Map-Diagnose: **Gewinner** sind die Screens, auf denen die Vorhersage die ' +
      '(fold-eigene) Mean Map in CC schlägt, **Verlierer** die übrigen. Sie werden **einmal** im Zustand vor der ' +
      'Schärfe-Änderung bestimmt und für jeden Gamma-Wert unverändert verwendet — würde die Zugehörigkeit ' +
      'mitwandern, verglichen man zwei Populationen statt zwei Konfigurationen.',
  )
  lines.push('')
  lines.push(
    '**Warum das zählt:** die Gewinner sind die Minderheit, für die das Plugin existiert. Auf einem Screen, dessen ' +
      'Aufmerksamkeit schon aus der Position folgt, trägt die Bildanalyse nichts bei. Ein Parameter, der den ' +
      'Mittelwert hebt, indem er die Mehrheit verbessert und die Minderheit verschlechtert, verbessert die Zahl ' +
      'und verschlechtert das Produkt.',
  )
  lines.push('')

  for (const result of results) {
    lines.push('---')
    lines.push('')
    lines.push(`## ${result.setName} — ${result.imageCount} Bilder`)
    lines.push('')
    for (const group of result.groups) {
      lines.push(`### ${GROUP_LABELS[group.group]}`)
      lines.push('')
      lines.push(
        `${group.imageCount} Bilder (${((group.imageCount / result.imageCount) * 100).toFixed(1).replace('.', ',')} %). ` +
          `Konzentration der **Ground Truth**: ${group.truthConcentration.mean.toFixed(3)} ` +
          `(Median ${group.truthConcentrationQuantiles[2].toFixed(3)}). ` +
          `Vorsprung gegen die Mean Map im Referenzzustand: ${group.referenceMargin.mean >= 0 ? '+' : ''}${group.referenceMargin.mean.toFixed(4)} CC.`,
      )
      lines.push('')
      lines.push('| γ | AUC | CC | NSS | KL | Konzentration | ΔCC gegen γ = 1 | ΔNSS | Urteil (CC) |')
      lines.push('|---|---:|---:|---:|---:|---:|---:|---:|---|')
      for (const point of group.points) {
        const cells = METRIC_IDS.map((id) => point.metrics[id].mean.toFixed(3))
        const cc = point.versusNoGamma.cc
        const nss = point.versusNoGamma.nss
        const verdict =
          point.blendGamma === 1
            ? '—'
            : cc.ci95[0] > 0
              ? '**besser**'
              : cc.ci95[1] < 0
                ? '**schlechter**'
                : 'nicht unterscheidbar'
        const fmtDelta = (d: { mean: number; ci95: [number, number] }): string =>
          point.blendGamma === 1 ? '—' : `${d.mean >= 0 ? '+' : ''}${d.mean.toFixed(4)}`
        lines.push(
          `| ${point.blendGamma}${point.blendGamma === 1 ? ' (Referenz)' : ''} | ${cells.join(' | ')} | ` +
            `${point.concentration.mean.toFixed(3)} | ${fmtDelta(cc)} | ${fmtDelta(nss)} | ${verdict} |`,
        )
      }
      lines.push('')
    }
  }
  return lines.join('\n')
}

// ---------------------------------------------------------------------------
// visual-check — 1.2 A4: die zwei Prüffälle am Onboarding-Screen
//
//   npm run visual-check -- --alphas 0.3,0.5
// ---------------------------------------------------------------------------

async function runVisualCheckCommand(args: Args): Promise<number> {
  const alphas = typeof args.alphas === 'string'
    ? args.alphas.split(',').map(Number).filter(Number.isFinite)
    : [0.3, 0.5, 0.8, 1.2]

  // `--sharp` stellt statt des Alpha-Sweeps die Schärfe-Kandidaten nebeneinander:
  // Ist-Zustand gegen die Varianten, die `npm run sharpness` übrig gelassen hat.
  const variants: CheckVariant[] = typeof args.sharp === 'string' ? sharpnessVariants(args.sharp) : alphaVariants(alphas)
  console.log(
    typeof args.sharp === 'string'
      ? `Prüffall Onboarding-Screen 393 x 852 — Schärfe-Varianten: ${variants.map((v) => v.label).join(', ')}`
      : `Prüffall Onboarding-Screen 393 x 852 — α ∈ {${alphas.join(', ')}}`,
  )
  console.log('KONSTRUIERT, nicht beobachtet: der Screen prüft zwei Fragen mit bekannter Antwort.')
  console.log('Keine Zahl von hier gehört in eine Feuerrate oder in einen Metrik-Vergleich.')
  const result = await runVisualCheck({ variants })

  for (const region of result.regions) {
    console.log('')
    console.log(`${region.label} — ${region.question}`)
    console.log(
      `  ${'Variante'.padEnd(22)}${'Mittel'.padStart(9)}${'Spitze'.padStart(9)}${'Perzentil'.padStart(11)}` +
        `${'Deckkraft'.padStart(11)}${'(alt)'.padStart(8)}   Farbe der Spitze`,
    )
    for (const picture of result.pictures) {
      const measurement = picture.measurements.find((entry) => entry.regionId === region.id)!
      console.log(
        `  ${picture.label.slice(0, 21).padEnd(22)}${measurement.mean.toFixed(3).padStart(9)}` +
          `${measurement.max.toFixed(3).padStart(9)}${(measurement.percentileOfMax * 100).toFixed(1).padStart(10)} %` +
          `${(measurement.opacityShipped * 100).toFixed(0).padStart(10)} %${(measurement.opacityOldCutoff * 100).toFixed(0).padStart(7)} %   ` +
          measurement.bandOfMax,
      )
    }
  }

  console.log('')
  console.log('Rang des CTA unter den Klick-Kandidaten:')
  for (const picture of result.pictures) {
    console.log(`  ${picture.label.padEnd(22)} Rang ${picture.ctaRank ?? '—'} von ${picture.candidateCount}`)
  }

  const target = str(args, 'out', 'out/a4-onboarding.png')
  writeFile(target, result.sheet)
  console.log('')
  console.log(`Bild: ${target}  (links das Original, danach je Variante eine Spalte)`)
  return 0
}

/**
 * Spalten für `--sharp`: eine Kommaliste von Varianten-Ids aus dem
 * Schärfe-Sweep (`eval/sharpness.ts`), immer mit dem Ist-Zustand voran.
 *
 * Damit zeigt der Prüfbogen dieselben Konfigurationen, über die die Zahlen
 * entschieden haben — und nicht eine, die nur ähnlich aussieht.
 */
function sharpnessVariants(ids: string): CheckVariant[] {
  const all = [...stageOneVariants(), beforeSharpnessVariant()]
  const wanted = ids.split(',').map((id) => id.trim())
  const out: CheckVariant[] = [{ label: 'Ist-Zustand', params: baseParams() }]
  for (const id of wanted) {
    const variant = all.find((entry) => entry.id === id)
    if (!variant) throw new Error(`Unbekannte Schärfe-Variante "${id}". Verfügbar: ${all.map((entry) => entry.id).join(', ')}`)
    out.push({ label: `${variant.lever} ${variant.label}`, params: variant.params })
  }
  return out
}

// ---------------------------------------------------------------------------
// cutoff — 1.2 A8: die Transparenzschwelle auf die neue Verteilung nachziehen
//
//   npm run cutoff -- --limit 150
// ---------------------------------------------------------------------------

async function runCutoff(args: Args): Promise<number> {
  const duration = num(args, 'duration', 3)
  const limit = args.limit ? num(args, 'limit', 0) : 150
  const sets = typeof args.fixtures === 'string'
    ? ALPHA_SETS.filter((entry) => (args.fixtures as string).split(',').includes(entry.setName))
    : ALPHA_SETS

  console.log(`Transparenzschwelle nachziehen — Regel: derselbe **Anteil** der Karte bleibt verdeckt.`)
  for (const set of sets) {
    let last = 0
    const result = await measureCutoff({
      setName: set.setName,
      duration,
      limit,
      onProgress: (done, total) => {
        if (done - last >= 25 || done === total) {
          last = done
          process.stdout.write(`\r  ${set.setName}: ${done}/${total} Bilder …   `)
        }
      },
    })
    process.stdout.write(`\r  ${set.setName}: ${result.imageCount} Bilder                \n`)
    console.log(
      `    alte Schwelle ${result.oldCutoff} verdeckte ${(result.hiddenShare.mean * 100).toFixed(1)} % der Karte, ` +
        `Rampenende ${result.oldRampEnd.toFixed(2)} bei ${(result.rampedShare.mean * 100).toFixed(1)} %`,
    )
    console.log(
      `    dieselbe Schwelle verdeckt auf der neuen Karte ${(result.hiddenShareUnchanged.mean * 100).toFixed(1)} %`,
    )
    console.log(
      `    gleicher Anteil ⇒ neue Schwelle ${result.newCutoff.mean.toFixed(3)} ± ${result.newCutoff.se.toFixed(4)}, ` +
        `neues Rampenende ${result.newRampEnd.mean.toFixed(3)} ± ${result.newRampEnd.se.toFixed(4)}`,
    )
  }
  return 0
}

// ---------------------------------------------------------------------------
// side-effects — 1.2 A5: Feuerraten der ausgelieferten Regeln vor und nach
// einer Änderung an blendAlpha
//
//   npm run side-effects -- --before 0.3 --after 0.5
// ---------------------------------------------------------------------------

async function runSideEffects(args: Args): Promise<number> {
  const limit = args.limit ? num(args, 'limit', 0) : undefined
  const ruleIds = args.rules === 'all' ? ALL_RULE_IDS : SHIPPED_RULES

  // Zwei Wege, eine Seite zu beschreiben: ein Alpha-Wert (`--before/--after`)
  // oder eine Varianten-Id aus dem Schärfe-Sweep (`--before-variant` …). Beides
  // landet in demselben `EngineParams` — die Messung kennt nur Parameter.
  const sideFor = (alphaKey: string, variantKey: string, fallbackAlpha: number): { label: string; params: EngineParams } => {
    if (typeof args[variantKey] === 'string') {
      const id = args[variantKey]
      if (id === 'basis') return { label: 'Ist-Zustand', params: baseParams() }
      const variant = [...stageOneVariants(), beforeSharpnessVariant()].find((entry) => entry.id === id)
      if (!variant) throw new Error(`Unbekannte Variante "${id}"`)
      return { label: `${variant.lever} ${variant.label}`, params: variant.params }
    }
    const alpha = num(args, alphaKey, fallbackAlpha)
    const params = baseParams()
    params.blendAlpha = alpha
    return { label: `α = ${String(alpha).replace('.', ',')}`, params }
  }

  const before = sideFor('before', 'before-variant', 0.3)
  const after = sideFor('after', 'after-variant', 0.5)

  console.log(`Feuerraten: ${before.label} gegen ${after.label}, ${ruleIds.length} Regeln.`)
  const result = await measureSideEffects({
    before,
    after,
    ruleIds,
    ...(args['mobile-viewport'] ? { mobileViewport: num(args, 'mobile-viewport', 400) } : {}),
    ...(limit ? { limit } : {}),
    onProgress: (message) => console.log(`  ${message} …`),
  })

  console.log('')
  for (const ruleId of ruleIds) {
    console.log(`${ruleId}`)
    for (const entry of result.before.entries.filter((item) => item.ruleId === ruleId)) {
      const other = result.after.entries.find((item) => item.ruleId === ruleId && item.population === entry.population)
      const rate = (value: number | null): string => (value === null ? '     —' : `${(value * 100).toFixed(1).padStart(6)}%`)
      console.log(
        `  ${entry.population.padEnd(46)} ${rate(entry.rate)} → ${rate(other?.rate ?? null)}` +
          `   (${entry.evaluated} bewertet, ${entry.blocked} blockiert)`,
      )
    }
  }

  const notes: string[] = []
  if (limit) notes.push(`Auf ${limit} Bilder je echter Population begrenzt (\`--limit\`) — keine Abnahmezahl.`)
  const reportPath = str(args, 'report', 'out/a5-nebenwirkungen.md')
  writeFile(reportPath, buildSideEffectReport(result, timestamp(), notes))
  console.log('')
  console.log(`Report: ${reportPath}`)
  return 0
}

// ---------------------------------------------------------------------------
// gate-fixtures — das eingecheckte Referenz-Set des Gates neu bauen
//
//   npm run gate-fixtures            20 je Kategorie, wie ausgeliefert
// ---------------------------------------------------------------------------

function runGateFixtures(args: Args): number {
  const count = num(args, 'count', 20)
  const pairs: Array<{ source: string; target: string }> = [
    { source: 'ueyes-web', target: 'gate-web' },
    { source: 'ueyes-mobile', target: 'gate-mobile' },
  ]

  let bytes = 0
  for (const pair of pairs) {
    console.log(`${pair.source} → eval/fixtures/${pair.target}, ${count} Bilder aus dem quick-Split:`)
    const summary = buildGateFixtures({ ...pair, count })
    bytes += summary.bytes
    console.log(`  ${summary.count} Bilder, ${(summary.bytes / 1024 / 1024).toFixed(1)} MB`)
  }
  console.log('')
  console.log(`Gesamt: ${(bytes / 1024 / 1024).toFixed(1)} MB — dieses Set wird eingecheckt.`)
  console.log('UEyes steht unter CC BY 4.0. Die Nennung steht in NOTICE.md und im index.json jedes Sets.')
  return 0
}

// ---------------------------------------------------------------------------
// crossval — k-fold over the whole category, both data-dependent parts refit
// ---------------------------------------------------------------------------

async function runCrossval(args: Args): Promise<number> {
  const setName = str(args, 'fixtures', 'ueyes-web')
  const duration = num(args, 'duration', 3)
  const folds = num(args, 'folds', 5)

  console.log(`Kreuzvalidierung "${setName}", ${folds} Folds, ${duration}s — Tuning und Test zusammen.`)
  let last = 0
  const result = await crossValidate({
    setName,
    duration,
    folds,
    onProgress: (done, total) => {
      if (done - last >= 25 || done === total) {
        last = done
        process.stdout.write(`\r  ${done}/${total} Bilder …   `)
      }
    },
  })
  process.stdout.write(`\r  ${result.imageCount} Bilder out-of-sample bewertet     \n\n`)

  const width = 14
  console.log(`${'Engine'.padEnd(width)}${METRIC_IDS.map((id) => METRIC_LABELS[id].padStart(18)).join('')}`)
  for (const engine of ['hybrid-v1', 'mean-map', 'heuristic-v1', 'center-bias', 'uniform'] as const) {
    const cells = METRIC_IDS.map((id) => {
      const summary = result.summaries[engine][id]
      return `${summary.mean.toFixed(3)} ± ${summary.sd.toFixed(3)}`.padStart(18)
    }).join('')
    console.log(`${ENGINE_LABELS[engine].padEnd(width)}${cells}`)
  }
  console.log('')
  console.log('hybrid-v1 − Mean Map, gepaart je Bild (+ ist besser):')
  for (const comparison of result.hybridVsMeanMap) {
    const significant = comparison.ci95[0] > 0
    console.log(
      `  ${METRIC_LABELS[comparison.metric].padEnd(9)} ` +
        `${comparison.mean >= 0 ? '+' : ''}${comparison.mean.toFixed(4)}  ` +
        `95%-KI [${comparison.ci95[0].toFixed(4)}, ${comparison.ci95[1].toFixed(4)}]  ` +
        `t=${comparison.tStatistic.toFixed(1)}  ` +
        `besser auf ${(comparison.winRate * 100).toFixed(1)} %  ` +
        `${significant ? '→ belastbar' : '→ nicht von Rauschen zu trennen'}`,
    )
  }
  console.log('')

  const reportPath = str(args, 'report', `out/crossval-${setName}.md`)
  writeFile(reportPath, buildCrossvalReport(result, timestamp()))
  console.log(`Report: ${reportPath}`)
  return 0
}

// ---------------------------------------------------------------------------
// build-prior — the data-estimated location priors of hybrid-v1
// ---------------------------------------------------------------------------

const PRIOR_SIZE_BUDGET_BYTES = 50 * 1024

function runBuildPrior(args: Args): number {
  const size = num(args, 'size', 64)
  // One prior per UI type. `desktop` and `poster` ship too, even though the
  // geometric rule never picks them — they are reachable by explicit choice.
  const sets: Array<{ id: PriorAssetId; setName: string }> = PRIOR_ASSET_IDS.map((id) => ({
    id,
    setName: str(args, `${id}-set`, `ueyes-${id}`),
  }))

  // Epic D: one prior per category *and* viewing duration. Measured to be a
  // real effect, so all three durations ship.
  console.log(`Ortsprioren aus dem **Tuning**-Split, ${size}x${size}, Dauern ${PRIOR_DURATIONS.join('/')}s`)
  const builds: PriorBuild[] = []
  let totalBytes = 0
  for (const set of sets) {
    if (!existsSync(join('eval', 'fixtures', set.setName, 'index.json'))) {
      console.log(`  ${set.id.padEnd(7)} übersprungen — ${set.setName} nicht importiert`)
      continue
    }
    const sizes: string[] = []
    for (const duration of PRIOR_DURATIONS) {
      const build = buildPrior(set.id, set.setName, duration, size, (bytes) => Buffer.from(bytes).toString('base64'))
      if (build.bytes > PRIOR_SIZE_BUDGET_BYTES) {
        console.error(`Budget von ${PRIOR_SIZE_BUDGET_BYTES / 1024} kB pro Map überschritten — kleineres --size wählen.`)
        return 2
      }
      sizes.push(`${duration}s ${(build.bytes / 1024).toFixed(1)} kB`)
      totalBytes += build.bytes
      builds.push(build)
    }
    console.log(`  ${set.id.padEnd(7)} ${sizes.join(' · ')}`)
  }
  console.log(`  Summe: ${(totalBytes / 1024).toFixed(1)} kB über ${builds.length} Maps`)

  const target = join('src', 'engine', 'priors', 'generated.ts')
  writeFile(target, renderPriorModule(builds))
  console.log('')
  console.log(`Geschrieben: ${target}`)
  console.log('Attribution (CC BY 4.0) steht im Kopf der Datei, in NOTICE.md und im Plugin-Panel.')
  return 0
}

// ---------------------------------------------------------------------------
// diagnose — two experiments on the tuning split, no tuning
// ---------------------------------------------------------------------------

async function runDiagnose(args: Args): Promise<number> {
  const setName = str(args, 'fixtures', 'ueyes-web')
  const duration = num(args, 'duration', 3)
  const limit = args.limit ? num(args, 'limit', 0) : undefined

  console.log(`Diagnose auf "${setName}" / tuning / ${duration}s — Test-Split wird nicht angefasst.`)
  process.stdout.write('Mean-Map-Akkumulator … ')

  let lastLogged = 0
  const result = await diagnose({
    setName,
    duration,
    ...(limit ? { limit } : {}),
    onProgress: (done) => {
      if (done === 1) process.stdout.write('fertig\n')
      if (done - lastLogged >= 25) {
        lastLogged = done
        process.stdout.write(`\r  ${done} Bilder …   `)
      }
    },
  })
  process.stdout.write(`\r  ${result.sampleCount} Bilder ausgewertet\n\n`)

  const width = 14
  console.log('Versuch 1 — Prior-Gewichtung')
  console.log(`${'Prior'.padEnd(width)}${METRIC_IDS.map((id) => METRIC_LABELS[id].padStart(10)).join('')}`)
  console.log(`${'Figmaps 1.0'.padEnd(width)}${METRIC_IDS.map((id) => result.engineV1[id].toFixed(3).padStart(10)).join('')}`)
  for (const entry of result.priorSweep) {
    console.log(
      `${entry.weight.toFixed(1).padEnd(width)}${METRIC_IDS.map((id) => entry.mean[id].toFixed(3).padStart(10)).join('')}`,
    )
  }
  console.log(`${'Mean Map (LOO)'.padEnd(width)}${METRIC_IDS.map((id) => result.meanMapAlone[id].toFixed(3).padStart(10)).join('')}`)
  console.log('')

  console.log('Versuch 2 — Mean Map + Bildanalyse')
  console.log(`${'α'.padEnd(width)}${METRIC_IDS.map((id) => METRIC_LABELS[id].padStart(10)).join('')}`)
  console.log(`${'0 (Mean Map)'.padEnd(width)}${METRIC_IDS.map((id) => result.meanMapAlone[id].toFixed(3).padStart(10)).join('')}`)
  for (const entry of result.hybridPixel) {
    console.log(
      `${`+Pixel ${entry.alpha}`.padEnd(width)}${METRIC_IDS.map((id) => entry.mean[id].toFixed(3).padStart(10)).join('')}`,
    )
  }
  for (const entry of result.hybridEngine) {
    console.log(
      `${`+Engine ${entry.alpha}`.padEnd(width)}${METRIC_IDS.map((id) => entry.mean[id].toFixed(3).padStart(10)).join('')}`,
    )
  }
  console.log('')
  console.log(`Figmaps schlägt die Mean Map auf ${result.winCount} von ${result.sampleCount} Bildern.`)

  // Contact sheet of the winners — what do these screens have in common?
  const reportPath = str(args, 'report', `out/diagnose-${setName}.md`)
  let contactSheet: string | undefined
  const shown = result.winners.slice(0, num(args, 'sheet', 12))
  if (shown.length > 0) {
    const wanted = new Set(shown.map((entry) => entry.id))
    const byId = new Map<string, Triptych>()
    const engine = new HeuristicAttentionEngine()
    for (const sample of iterateSamples(setName, 'tuning', { duration })) {
      if (!wanted.has(sample.id)) continue
      const analysis = await analyzeFrame(engine, nodeImageOps, {
        source: sample.image,
        signals: sample.signals,
        frameWidth: sample.frameWidth,
        frameHeight: sample.frameHeight,
        segment: false,
      })
      if (analysis) byId.set(sample.id, { original: sample.image, truth: sample.truth.salience, prediction: analysis.attention })
    }
    const rows = shown.map((entry) => byId.get(entry.id)).filter((row): row is Triptych => row !== undefined)
    if (rows.length > 0) {
      const sheetPath = reportPath.replace(/\.md$/, '') + '-gewinner.png'
      writeFile(sheetPath, renderContactSheet(rows))
      contactSheet = relative(dirname(reportPath), sheetPath) || sheetPath
      console.log(`Kontaktbogen der Gewinner: ${sheetPath}`)
    }
  }

  writeFile(reportPath, buildDiagnoseReport(result, timestamp(), contactSheet))
  console.log(`Report: ${reportPath}`)
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

  const index = readIndex(setName)
  console.log(`Tuning auf "${setName}" / "${split}": ${iterations} Iterationen, Seed ${seed}`)

  const outcomes = {} as Record<ProfileId, TuneOutcome>
  const withoutOwnData: ProfileId[] = []

  for (const [position, profile] of PROFILE_IDS.entries()) {
    // Epic D: each profile is tuned against its own viewing duration.
    const wanted = PROFILE_DURATIONS[profile]
    const available = index.durations.includes(wanted)
    if (!available) withoutOwnData.push(profile)
    const samples = loadSamples(setName, split, { duration: available ? wanted : index.durations[0] })

    // The seed is offset per profile: with identical data and an identical seed
    // all three searches would walk the same path and return the same weights,
    // which would look like a calibration result and be none.
    process.stdout.write(`  ${profile} (${samples.length} Bilder, ${available ? `${wanted}s` : `Ersatz ${index.durations[0]}s`}) … `)
    outcomes[profile] = await tuneProfile(samples, profile, { iterations, seed: seed + position * 1000, tunePrior })
    console.log(`CC ${outcomes[profile].baselineCc.toFixed(4)} → ${outcomes[profile].bestCc.toFixed(4)}`)
  }

  if (withoutOwnData.length > 0) {
    console.log('')
    console.log(`Warnung: für ${withoutOwnData.join(', ')} enthält das Set keine passende Betrachtungsdauer.`)
    console.log('Diese Profile wurden auf einer Ersatzdauer getunt und sind damit nicht kalibriert,')
    console.log('sondern nur angepasst. Ohne Ground Truth für 1 s / 3 s / 7 s ist Epic D nicht belegbar.')
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

// ---------------------------------------------------------------------------

export async function main(argv: readonly string[]): Promise<number> {
  const args = parseArgs(argv)
  if (args.help) {
    console.log(
      [
        'npm run eval -- [options]',
        '  --engine <id>       heuristic | heuristic-v1 | <config>[:glance|scan|read] | all',
        '                      (default: die ausgelieferte Konfiguration)',
        '  --set <split>       tuning | test | quick                                          (default: test)',
        '  --fixtures <name>   Referenz-Set unter eval/fixtures/                              (default: ueyes-web)',
        '  --duration <s>      Betrachtungsdauer der Ground Truth: 1 | 3 | 7                  (default: 3)',
        '  --no-mean-map       Mean-Map-Baseline weglassen (sie liest den Tuning-Split)',
        '  --report <path>     Zielpfad des Markdown-Reports',
        '  --limit <n>         nur die ersten n Bilder (Rauchtest)',
        '  --gate --baseline <file> [--max-cc-drop 0.02] [--write]   Regressions-Gate (A-7)',
        '  --blend-gamma <x>   verstellt die Tonkurve — nur für den Selbsttest des Gates',
        '',
        'npm run diagnose -- [options]     nur Diagnose, kein Tuning, nur Tuning-Split',
        '  --fixtures <name>   Referenz-Set                                                  (default: ueyes-web)',
        '  --duration <s>      Betrachtungsdauer                                             (default: 3)',
        '  --sheet <n>         Anzahl Gewinner im Kontaktbogen                               (default: 12)',
        '  --report <path>     Zielpfad des Markdown-Reports',
        '',
        'npm run epic-d -- [options]      misst, ob Betrachtungsdauer ein Prior-Effekt ist',
        '  --fixtures <name>   Referenz-Set                                                  (default: ueyes-web)',
        '',
        'npm run alpha -- [options]       1.2 A — Alpha-Kurve, Tuning-Split, kreuzvalidiert',
        '  --alphas <liste>    Kommaliste der Alpha-Werte                        (default: 0.3,0.5,0.8,1.2)',
        '  --fixtures <liste>  Kommaliste der Sets                (default: ueyes-web,ueyes-mobile)',
        '  --no-extend         nicht verlängern, auch wenn die Kurve am Ende noch steigt',
        '  --confirm           danach EINMAL den Test-Split, mit dem gewählten Wert',
        '  --confirm-only      nur den Test-Split, ohne den Sweep zu wiederholen',
        '  --chosen <α>        überschreibt, welcher Wert bestätigt wird',
        '  --reference <α>     Vergleichswert für --confirm-only              (default: 0.3)',
        '',
        'npm run sharpness -- [options]   1.2 A6 — Nachbearbeitung: Blur, Gamma, Clip, blendGamma',
        '  --stage 1           nur die Einzelhebel, ohne die Kombinationen',
        '  --fixtures <liste>  Kommaliste der Sets                (default: ueyes-web,ueyes-mobile)',
        '',
        'npm run groups -- [options]      1.2 A7 — blendGamma getrennt für Gewinner und Verlierer',
        '  --gammas <liste>    Kommaliste der blendGamma-Werte              (default: 0.3,1.6,2.0)',
        '',
        'npm run cutoff -- [options]      1.2 A8 — Transparenzschwelle auf die neue Verteilung ziehen',
        '',
        'npm run visual-check -- [options]  1.2 A4 — der Onboarding-Prüffall, je Alpha ein Bild',
        '  --alphas <liste>    Kommaliste der Alpha-Werte                    (default: 0.3,0.5,0.8,1.2)',
        '  --sharp <ids>       statt Alphas: Varianten-Ids aus dem Schärfe-Sweep, kommagetrennt',
        '  --out <pfad>        Zielpfad des PNG                        (default: out/a4-onboarding.png)',
        '',
        'npm run side-effects -- [options]  1.2 A5 — Feuerraten vor und nach einer Alpha-Änderung',
        '  --before <α> --after <α>   die beiden verglichenen Alpha-Werte        (default: 0.3 / 0.5)',
        '  --before-variant <id> --after-variant <id>   stattdessen Varianten aus dem Schärfe-Sweep',
        '  --rules all         auch die stillgelegten Regeln berichten',
        '  --mobile-viewport <px>   Telefon-Screens zusätzlich segmentiert messen (für cold-fold)',
        '  --limit <n>         Bilder je echter Population begrenzen',
        '',
        'npm run crossval -- [options]    k-fache Kreuzvalidierung über Tuning + Test',
        '  --fixtures <name>   Referenz-Set                                                  (default: ueyes-web)',
        '  --folds <k>         Anzahl Folds                                                  (default: 5)',
        '  --duration <s>      Betrachtungsdauer                                             (default: 3)',
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
    if (args['findings-audit']) return await runFindingsAudit(args)
    if (args.alpha) return await runAlpha(args)
    if (args.sharpness) return await runSharpness(args)
    if (args.groups) return await runGroups(args)
    if (args.cutoff) return await runCutoff(args)
    if (args['gate-fixtures']) return runGateFixtures(args)
    if (args['visual-check']) return await runVisualCheckCommand(args)
    if (args['side-effects']) return await runSideEffects(args)
    if (args['epic-d']) return await runEpicD(args)
    if (args.crossval) return await runCrossval(args)
    if (args['build-prior']) return runBuildPrior(args)
    if (args.diagnose) return await runDiagnose(args)
    return args.tune ? await runTune(args) : await runEval(args)
  } catch (error) {
    console.error(`\n${error instanceof Error ? error.message : String(error)}`)
    return 1
  }
}

/**
 * Wie oft feuert jede Findings-Regel auf echten Bildern?
 *
 * Anlass: `cold-fold` war seit seiner Einführung wirkungslos, obwohl der
 * Unit-Test grün war — der Test rief die Regel direkt auf, die Pipeline
 * fütterte sie mit etwas strukturell anderem. Diese Prüfung nimmt den
 * umgekehrten Weg: echte Bilder, echte Analyse, echter `deriveFindings`-Pfad,
 * und zählt.
 *
 * Zwei Zahlen sind wertlos: 0 % und 100 %. Eine Regel, die nie feuert, ist tot;
 * eine, die immer feuert, ist keine Aussage über den Screen.
 *
 * Wichtig ist dabei die Unterscheidung, an der `cold-fold` gescheitert war:
 *
 *   - **blockiert** — die Voraussetzung fehlt strukturell (keine Kandidaten,
 *     nicht segmentiert). Die Regel wurde gar nicht erst gefragt.
 *   - **stumm** — die Regel wurde gefragt und hat verneint.
 *
 * Nur das Zweite ist eine Aussage. Ein Set, das eine Regel durchgängig
 * blockiert, kann über sie nichts sagen — UEyes etwa enthält keine
 * Layer-Bäume, also keine Klick-Kandidaten.
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { analyzeFrame, type AnalyzeResult } from '../src/engine/analyze'
import { HeuristicAttentionEngine } from '../src/engine/heuristic'
import { cloneParams, resolveParams } from '../src/engine/params'
import { sectionSalience } from '../src/engine/segments'
import { nodeImageOps } from '../src/platform/imageops-node'
import type { NodeSignal } from '../src/messages'
import { findingsInputFor } from '../src/findings/derive'
import { ALL_RULES } from '../src/findings/rules'
import type { FindingsInput } from '../src/findings/types'
import { FIXTURES_ROOT, listSplit, readPng } from './dataset'
import { buildFrame, SHAPES } from './constructed'
import { ENGINE_CONFIG } from '../src/engine/config'
import type { Bitmap } from '../src/engine/ops'
import type { PriorAssetId } from '../src/engine/priors'

export type RuleOutcome = 'fired' | 'silent' | 'blocked'

export type RuleStats = {
  id: string
  /** False for a rule that is implemented but not offered — see `rules.ts`. */
  shipped: boolean
  fired: number
  silent: number
  blocked: number
  blockedReason: string
  /** Distribution of the rule's decision variable, for re-calibration. */
  variable: string
  samples: number[]
  /**
   * The constant this rule compares its decision variable against, and on
   * which side it fires. `null` for the two rules that have none — „not rank 1"
   * and „below the first fold" are definitions, not calibrations.
   */
  threshold: { value: number; firesBelow: boolean } | null
}

export type AuditResult = {
  setName: string
  imageCount: number
  /**
   * Der Mischungsanteil der Bildanalyse, mit dem gemessen wurde.
   *
   * Steht hier, weil eine Feuerrate nur für die Karte gilt, auf der sie
   * gemessen wurde — und `blendAlpha` ändert genau diese Karte. Drei der
   * Schwellen sind auf α = 0,3 kalibriert; wer α verstellt, misst neu.
   */
  blendAlpha: number
  viewportOverride: number | undefined
  /** The configuration the rates below are valid for — never leave it implicit. */
  priorAsset: PriorAssetId | 'aus der Geometrie abgeleitet'
  segmented: boolean
  withSignals: number
  rules: RuleStats[]
}

/**
 * Why a rule could not even be asked on this input.
 *
 * Deliberately written next to the rules rather than inside them: a rule
 * should stay a plain predicate, and this is a property of the *data*.
 */
export function blockedReason(id: string, input: FindingsInput): string | null {
  const needsCandidates = ['cta-rank', 'cta-below-fold', 'dead-cta']
  const needsSegments = ['cta-below-fold', 'cold-fold']

  if (needsCandidates.includes(id) && input.candidates.length === 0) return 'keine Klick-Kandidaten (keine Layer-Signale)'
  if (id === 'dead-cta' && input.candidates.length < 2) return 'nur ein Kandidat — „ruhiger als die anderen" ist leer'
  if (needsSegments.includes(id) && !input.plan.segmented) return 'Frame nicht segmentiert'
  if (id === 'cta-rank' && !input.candidates.some((candidate) => isPrimary(candidate.name))) {
    return 'kein Kandidat sieht nach primärem CTA aus'
  }
  return null
}

function isPrimary(name: string): boolean {
  const lower = name.toLowerCase()
  return ['primary', 'primär', 'cta', 'submit', 'anfragen', 'kaufen', 'jetzt'].some((key) => lower.includes(key))
}

/**
 * The quantity each rule compares against its threshold.
 *
 * Exported because a threshold is only meaningful next to the distribution of
 * the quantity it cuts — and that distribution has to be re-measurable in every
 * configuration the rule runs in, not just in this file's default one.
 */
export function decisionVariable(id: string, input: FindingsInput): number | null {
  const map = input.attention
  switch (id) {
    case 'flat':
      // Same map the rule reads: the first section's image term, without the
      // location prior — see `FindingsInput.aboveFoldImageTerm`.
      return sectionSalience(input.aboveFoldImageTerm ?? input.aboveFoldSection ?? map)
    case 'competition': {
      // The *binding* constraint, not the first one: on real screens the two
      // peaks are usually strong enough, and it is the valley between them
      // that decides. Reported as the minimum along the connecting path.
      let peak = 0
      let peakIndex = 0
      for (let i = 0; i < map.values.length; i++) if (map.values[i] > peak) { peak = map.values[i]; peakIndex = i }
      const x1 = peakIndex % map.width
      const y1 = Math.floor(peakIndex / map.width)
      const minDistance = 0.3 * map.width
      let second = 0
      let secondIndex = -1
      for (let i = 0; i < map.values.length; i++) {
        const dx = (i % map.width) - x1
        const dy = Math.floor(i / map.width) - y1
        if (Math.sqrt(dx * dx + dy * dy) <= minDistance) continue
        if (map.values[i] > second) { second = map.values[i]; secondIndex = i }
      }
      if (secondIndex < 0) return null
      const x2 = secondIndex % map.width
      const y2 = Math.floor(secondIndex / map.width)
      const steps = Math.max(Math.abs(x2 - x1), Math.abs(y2 - y1))
      let valley = Infinity
      for (let step = 1; step < steps; step++) {
        const t = step / steps
        const x = Math.round(x1 + (x2 - x1) * t)
        const y = Math.round(y1 + (y2 - y1) * t)
        valley = Math.min(valley, map.values[y * map.width + x])
      }
      // The scale-free quantity the rule now tests.
      return Number.isFinite(valley) && second > 0 ? valley / second : null
    }
    case 'cold-fold': {
      if (input.sectionSalience.length < 2 || !(input.sectionSalience[0] > 0)) return null
      const best = Math.max(...input.sectionSalience.slice(1))
      return best / input.sectionSalience[0] - 1
    }
    case 'dead-cta': {
      if (input.candidates.length < 2) return null
      // Same maps the rule reads: each candidate on its own section's
      // un-attenuated map, nearest section centre wins. On the composed map
      // this quantity carries the scroll-depth damping and only re-states
      // which candidate sits further down.
      const sections = input.sections && input.sections.length > 1 ? input.sections : null
      const means = input.candidates.map((candidate) => {
        let target = map
        let offsetY = 0
        if (sections) {
          const centre = candidate.y + candidate.height / 2
          let index = 0
          let bestDistance = Infinity
          for (const section of input.plan.sections) {
            const distance = Math.abs(centre - (section.y + section.height / 2))
            if (distance < bestDistance) { bestDistance = distance; index = section.index }
          }
          index = Math.min(index, sections.length - 1)
          target = sections[index]
          offsetY = input.plan.sections[index].y
        }
        const scale = target.width / input.frameWidth
        let sum = 0
        let count = 0
        const x0 = Math.max(0, Math.floor(candidate.x * scale))
        const y0 = Math.max(0, Math.floor((candidate.y - offsetY) * scale))
        const x1 = Math.min(target.width, Math.ceil((candidate.x + candidate.width) * scale))
        const y1 = Math.min(target.height, Math.ceil((candidate.y - offsetY + candidate.height) * scale))
        for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { sum += target.values[y * target.width + x]; count++ }
        return count > 0 ? sum / count : 0
      })
      const best = Math.max(...means)
      // Quietest candidate as a share of the strongest — the rule's quantity.
      return best > 0 ? Math.min(...means) / best : null
    }
    case 'cta-rank': {
      const index = input.candidates.findIndex((candidate) => isPrimary(candidate.name))
      return index < 0 ? null : index + 1
    }
    case 'cta-below-fold': {
      const leader = input.candidates[0]
      if (!leader || input.plan.folds.length === 0) return null
      return leader.y / input.plan.folds[0]
    }
    default:
      return null
  }
}

/**
 * The constant each rule cuts its decision variable at.
 *
 * Lives next to `decisionVariable` and has to be changed with it *and* with the
 * rule — three places for one fact, which is the price of measuring a rule from
 * outside. The report is worth it: a threshold only means something next to the
 * distribution it cuts, and „the threshold sits above the maximum" is what made
 * `flat` obvious after three attempts at re-calibrating it.
 */
export function thresholdOf(id: string, category: string): { value: number; firesBelow: boolean } | null {
  const cfg = ENGINE_CONFIG.findings
  switch (id) {
    case 'flat':
      return { value: cfg.flatConcentrationThreshold[category] ?? cfg.flatConcentrationThreshold.web, firesBelow: true }
    case 'competition':
      return { value: cfg.competitionValleyRatio, firesBelow: true }
    case 'cold-fold':
      return { value: cfg.coldFoldMargin, firesBelow: false }
    case 'dead-cta':
      return { value: cfg.deadCtaRelativeToBest, firesBelow: true }
    default:
      return null
  }
}

/**
 * Where a threshold sits inside the observed distribution.
 *
 * „ÜBER max" or „UNTER min" means the rule cannot do anything but fire always
 * or never — the finding that eventually explained both `flat` and `dead-cta`.
 */
export function thresholdPosition(samples: readonly number[], threshold: number | null): string {
  if (threshold === null) return 'ohne'
  if (samples.length === 0) return '—'
  const sorted = [...samples].sort((a, b) => a - b)
  if (threshold <= sorted[0]) return 'UNTER min'
  if (threshold > sorted[sorted.length - 1]) return 'ÜBER max'
  const below = sorted.filter((sample) => sample < threshold).length
  return `p${Math.round((below / sorted.length) * 100)}`
}

export type AuditOptions = {
  setName: string
  /** Forces segmentation, so the two section rules can be exercised at all. */
  viewportOverride?: number
  limit?: number
  onProgress?: (done: number, total: number) => void
  /**
   * Which location prior to run with, and which category the rules are told
   * they are looking at.
   *
   * Without this the audit lets `priorAssetIdFor` decide from the raw image
   * size — and a UEyes phone capture is 1080 px wide, so it is classified as a
   * *web page* and scored against the web thresholds. That is how `flat` came
   * to have a threshold calibrated in one configuration and applied in
   * another; it fired on 100 % of mobile frames in the shipped one. A rate is
   * only as valid as the configuration it was measured in, so the
   * configuration is now stated rather than guessed.
   */
  priorAsset?: PriorAssetId
  /**
   * `false` analyses each image as one viewport, which is what it is. The
   * default keeps segmentation on, because the two section rules cannot fire
   * otherwise.
   */
  segment?: boolean
  /** Overrides `blendAlpha` — see `AuditResult.blendAlpha`. */
  blendAlpha?: number
}

/** One frame to score, whatever it came from. */
type AuditCase = {
  image: Bitmap
  signals: NodeSignal[]
  frameWidth: number
  frameHeight: number
  priorAsset?: PriorAssetId
  /** What the rules are told the screen is — drives `flat`'s threshold. */
  category?: string
  viewportOverride?: number
  segment?: boolean
  /** Overrides `blendAlpha` of `hybrid-v1` — see `AuditResult.blendAlpha`. */
  blendAlpha?: number
}

const VARIABLE_NAMES: Record<string, string> = {
  flat: 'Konzentration des Bildanteils (Top-5-%-Masse, 1. Abschnitt)',
  competition: 'Tal ÷ zweites Maximum (bindend)',
  'cold-fold': 'relativer Vorsprung der stärksten Sektion',
  'dead-cta': 'ruhigster ÷ stärkster Kandidat (je eigener Abschnitt)',
  'cta-rank': 'Rang des primären CTA',
  'cta-below-fold': 'y des stärksten Kandidaten ÷ Fold 1',
}

function emptyStats(category: string): Map<string, RuleStats> {
  const stats = new Map<string, RuleStats>()
  // Deliberately ALL_RULES, not the shipped subset: re-calibrating a rule that
  // is switched off is exactly what this tool is for.
  for (const rule of ALL_RULES) {
    stats.set(rule.id, {
      id: rule.id,
      shipped: rule.shipped !== false,
      fired: 0,
      silent: 0,
      blocked: 0,
      blockedReason: '',
      variable: VARIABLE_NAMES[rule.id] ?? '',
      samples: [],
      threshold: thresholdOf(rule.id, category),
    })
  }
  return stats
}

/**
 * The one loop both audits go through: real analysis, real `deriveFindings`
 * input, real rules. Two of them would be two measurements.
 */
async function tally(
  cases: AsyncIterable<AuditCase> | Iterable<AuditCase>,
  category: string,
  onProgress?: (done: number) => void,
): Promise<{ stats: Map<string, RuleStats>; count: number; withSignals: number; segmented: number }> {
  const stats = emptyStats(category)
  let count = 0
  let withSignals = 0
  let segmented = 0

  for await (const item of cases) {
    if (item.signals.length > 0) withSignals++
    // A rate belongs to the map it was measured on, and `blendAlpha` *is* the
    // map — so the override goes through the same parameter object the plugin
    // resolves, not through a second code path.
    let params
    if (item.blendAlpha !== undefined) {
      params = cloneParams(resolveParams())
      params.blendAlpha = item.blendAlpha
    }
    const engine = new HeuristicAttentionEngine({
      ...(item.priorAsset ? { priorAsset: item.priorAsset } : {}),
      ...(params ? { params } : {}),
    })

    const analysis: AnalyzeResult | null = await analyzeFrame(engine, nodeImageOps, {
      source: item.image,
      signals: item.signals,
      frameWidth: item.frameWidth,
      frameHeight: item.frameHeight,
      ...(item.viewportOverride ? { viewportOverride: item.viewportOverride } : {}),
      ...(item.segment === false ? { segment: false } : {}),
    })
    if (!analysis) continue
    if (analysis.plan.segmented) segmented++

    const input = findingsInputFor({
      analysis,
      signals: item.signals,
      frameWidth: item.frameWidth,
      frameHeight: item.frameHeight,
      ...(item.category ? { priorCategory: item.category } : {}),
    })

    for (const rule of ALL_RULES) {
      const entry = stats.get(rule.id)!
      const blocked = blockedReason(rule.id, input)
      if (blocked) {
        entry.blocked++
        entry.blockedReason = blocked
        continue
      }
      const variable = decisionVariable(rule.id, input)
      if (variable !== null) entry.samples.push(variable)
      if (rule.evaluate(input)) entry.fired++
      else entry.silent++
    }

    count++
    onProgress?.(count)
  }

  return { stats, count, withSignals, segmented }
}

export async function auditFindings(options: AuditOptions): Promise<AuditResult> {
  const setName = options.setName
  const ids = [...new Set([...listSplit(setName, 'tuning'), ...listSplit(setName, 'test')])]
  const selected = options.limit ? ids.slice(0, options.limit) : ids

  function* cases(): Generator<AuditCase> {
    for (const id of selected) {
      const imagePath = join(FIXTURES_ROOT, setName, 'images', `${id}.png`)
      if (!existsSync(imagePath)) continue
      const signalsPath = join(FIXTURES_ROOT, setName, 'signals', `${id}.json`)
      yield {
        image: readPng(imagePath),
        signals: existsSync(signalsPath) ? (JSON.parse(readFileSync(signalsPath, 'utf8')) as NodeSignal[]) : [],
        frameWidth: 0,
        frameHeight: 0,
        ...(options.priorAsset ? { priorAsset: options.priorAsset, category: options.priorAsset } : {}),
        ...(options.viewportOverride ? { viewportOverride: options.viewportOverride } : {}),
        ...(options.segment === false ? { segment: false } : {}),
        ...(options.blendAlpha !== undefined ? { blendAlpha: options.blendAlpha } : {}),
      }
    }
  }

  // The frame size *is* the image size for a screenshot; filled in here rather
  // than in the generator so the pixels are only decoded once.
  function* sized(): Generator<AuditCase> {
    for (const item of cases()) yield { ...item, frameWidth: item.image.width, frameHeight: item.image.height }
  }

  const category = options.priorAsset ?? 'web'
  const { stats, count, withSignals, segmented } = await tally(sized(), category, (done) =>
    options.onProgress?.(done, selected.length),
  )

  return {
    setName,
    imageCount: count,
    blendAlpha: options.blendAlpha ?? resolveParams().blendAlpha ?? Number.NaN,
    viewportOverride: options.viewportOverride,
    priorAsset: options.priorAsset ?? 'aus der Geometrie abgeleitet',
    // Read off the plans, not off the option: `--viewport` only *requests*
    // segmentation, and a frame below the threshold is analysed whole anyway.
    segmented: segmented > 0,
    withSignals,
    rules: [...stats.values()],
  }
}

export type ConstructedAuditOptions = {
  /** Layout variants per shape. Each varies hierarchy, hero, CTA position, card count. */
  variants?: number
  /** Overrides `blendAlpha` — see `AuditResult.blendAlpha`. */
  blendAlpha?: number
  onProgress?: (done: number, total: number) => void
}

/**
 * The same audit on the constructed frames of `constructed.ts` — the only
 * population in which the three candidate-based rules can be measured at all.
 *
 * One result per frame shape, because that is the whole point: a rule whose
 * rate differs between a phone viewport and a scrolling desktop page has a
 * decision variable that depends on the geometry rather than on the design.
 */
export async function auditConstructed(options: ConstructedAuditOptions = {}): Promise<AuditResult[]> {
  const variants = options.variants ?? 24
  const total = SHAPES.length * variants
  let done = 0
  const out: AuditResult[] = []

  for (const shape of SHAPES) {
    function* cases(): Generator<AuditCase> {
      for (let variant = 0; variant < variants; variant++) {
        const frame = buildFrame(shape, variant)
        yield {
          image: frame.image,
          signals: frame.signals,
          frameWidth: shape.frameWidth,
          frameHeight: shape.frameHeight,
          priorAsset: shape.prior,
          category: shape.category,
          ...(options.blendAlpha !== undefined ? { blendAlpha: options.blendAlpha } : {}),
        }
      }
    }

    const result = await tally(cases(), shape.category, () => options.onProgress?.(++done, total))
    out.push({
      setName: shape.label,
      imageCount: result.count,
      blendAlpha: options.blendAlpha ?? resolveParams().blendAlpha ?? Number.NaN,
      viewportOverride: undefined,
      priorAsset: shape.prior,
      segmented: result.segmented > 0,
      withSignals: result.withSignals,
      rules: [...result.stats.values()],
    })
  }

  return out
}

/** Quantiles of a rule's decision variable — the basis for a threshold. */
export function quantiles(samples: readonly number[], points = [0.05, 0.25, 0.5, 0.75, 0.95]): number[] {
  if (samples.length === 0) return points.map(() => Number.NaN)
  const sorted = [...samples].sort((a, b) => a - b)
  return points.map((q) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))])
}

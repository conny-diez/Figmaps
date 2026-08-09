/**
 * 1.2 A5 — was eine Änderung an `blendAlpha` mit den Befundregeln macht.
 *
 * Die Schwellen von `cta-rank`, `competition` und `cold-fold` sind auf der
 * Karte kalibriert, die α = 0,3 erzeugt. Ändert sich α, ändert sich die Karte,
 * und damit die Verteilung, auf der die Schwellen sitzen — ohne dass eine
 * Zeile in `rules.ts` angefasst wurde.
 *
 * **Das ist die Fehlerklasse, die dieses Projekt fünfmal erwischt hat**: eine
 * Schwelle wird in einer Konfiguration geschätzt und in einer anderen
 * angewandt (`flat`, dritter Anlauf), oder eine Größe wird umgebaut und die
 * alte Quote weiterverwendet (`competition`, Abstandsmaß). Deshalb ist die
 * Messung hier kein Anhang, sondern Teil der Entscheidung: vorher und nachher,
 * in denselben Populationen.
 *
 * Populationen, getrennt gehalten — eine Rate gilt nur für ihre Frame-Form:
 *
 *   - die drei konstruierten Formen (`constructed.ts`): Desktop scrollend,
 *     Telefon scrollend, Telefon ein Viewport. Nur hier gibt es Layer-Bäume,
 *     also überhaupt Klick-Kandidaten und damit `cta-rank`.
 *   - UEyes-Webseiten mit erzwungener Segmentierung — die einzige echte
 *     Population, in der `cold-fold` gefragt werden kann.
 *   - UEyes-Telefon-Screens als ein Viewport — die Population, um die es in
 *     1.2 B geht.
 */
import type { EngineParams } from '../src/engine/params'
import { ALL_RULES } from '../src/findings/rules'
import { auditConstructed, auditFindings, describeParams, type AuditResult, type RuleStats } from './findings-audit'

/** Die drei ausgelieferten Regeln — die, deren Schwellen jetzt wackeln. */
export const SHIPPED_RULES: readonly string[] = ['cta-rank', 'competition', 'cold-fold']

/**
 * Alle implementierten Regeln, auch die stillgelegten.
 *
 * Nötig, seit die Nachbearbeitung des Bildanteils zur Debatte steht: `flat`
 * liest genau diesen Bildanteil, ist also von `post.gamma` und
 * `post.clipLowPercentile` direkt betroffen — auch wenn es nicht ausgeliefert
 * wird. Eine abgeschaltete Regel, deren Schwelle im Stillen veraltet, ist beim
 * Wiedereinschalten eine Falle.
 */
export const ALL_RULE_IDS: readonly string[] = ALL_RULES.map((rule) => rule.id)

export type PopulationId = 'konstruiert' | 'ueyes-web-segmentiert' | 'ueyes-mobile-1vp' | 'ueyes-mobile-segmentiert'

export type RateEntry = {
  population: string
  populationId: PopulationId
  ruleId: string
  fired: number
  evaluated: number
  blocked: number
  /** `null`, wenn die Regel in dieser Population strukturell blockiert ist. */
  rate: number | null
  /** Verteilung der Entscheidungsgröße — p5 / p25 / Median / p75 / p95. */
  quantiles: number[]
  threshold: number | null
}

export type SideEffectSide = {
  /** Wie diese Seite heißt, z. B. „ohne blendGamma (heute)". */
  label: string
  /** Die Parameter, mit denen gemessen wurde, ausgeschrieben. */
  configuration: string
  entries: RateEntry[]
}

export type SideEffectResult = {
  before: SideEffectSide
  after: SideEffectSide
  /** Wie viele Bilder je echter Population bewertet wurden. */
  realImageCount: Record<string, number>
  constructedVariants: number
  webViewport: number
  ruleIds: readonly string[]
}

function quantilesOf(samples: readonly number[], points = [0.05, 0.25, 0.5, 0.75, 0.95]): number[] {
  if (samples.length === 0) return points.map(() => Number.NaN)
  const sorted = [...samples].sort((a, b) => a - b)
  return points.map((q) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))])
}

function entriesOf(result: AuditResult, populationId: PopulationId, label: string, ruleIds: readonly string[]): RateEntry[] {
  return ruleIds.map((ruleId) => {
    const rule = result.rules.find((entry: RuleStats) => entry.id === ruleId)
    const evaluated = rule ? rule.fired + rule.silent : 0
    return {
      population: label,
      populationId,
      ruleId,
      fired: rule?.fired ?? 0,
      evaluated,
      blocked: rule?.blocked ?? 0,
      rate: evaluated > 0 ? (rule?.fired ?? 0) / evaluated : null,
      quantiles: quantilesOf(rule?.samples ?? []),
      threshold: rule?.threshold?.value ?? null,
    }
  })
}

export type Side = { label: string; params: EngineParams }

export type SideEffectOptions = {
  before: Side
  after: Side
  /** Welche Regeln berichtet werden. Default: die ausgelieferten. */
  ruleIds?: readonly string[]
  variants?: number
  /** Erzwungene Viewport-Höhe für die Webseiten — sonst ist nichts segmentiert. */
  webViewport?: number
  /**
   * Erzwungene Viewport-Höhe für die Telefon-Screens, **zusätzlich** zur
   * Ein-Viewport-Population.
   *
   * `cold-fold` ist eine von nur zwei belastbaren Regeln und braucht
   * Abschnitte. Auf einem Ein-Viewport-Screen ist sie strukturell blockiert,
   * also gäbe es sonst genau *eine* echte Population, in der sie überhaupt
   * gefragt werden kann. Eine Quote aus einer einzigen Population ist keine
   * Quote, sondern eine Beobachtung.
   */
  mobileViewport?: number
  /** Bildzahl je echter Population. Eine Begrenzung wird im Report ausgewiesen. */
  limit?: number
  onProgress?: (message: string) => void
}

async function measureSide(side: Side, options: SideEffectOptions): Promise<{ side: SideEffectSide; counts: Record<string, number> }> {
  const variants = options.variants ?? 24
  const webViewport = options.webViewport ?? 500
  const ruleIds = options.ruleIds ?? SHIPPED_RULES
  const entries: RateEntry[] = []
  const counts: Record<string, number> = {}

  options.onProgress?.(`${side.label}: konstruierte Frames`)
  for (const result of await auditConstructed({ variants, params: side.params })) {
    entries.push(...entriesOf(result, 'konstruiert', result.setName, ruleIds))
    counts[result.setName] = result.imageCount
  }

  options.onProgress?.(`${side.label}: UEyes-Webseiten, Viewport ${webViewport} px erzwungen`)
  const web = await auditFindings({
    setName: 'ueyes-web',
    priorAsset: 'web',
    viewportOverride: webViewport,
    params: side.params,
    ...(options.limit ? { limit: options.limit } : {}),
  })
  entries.push(...entriesOf(web, 'ueyes-web-segmentiert', `UEyes Webseiten (Viewport ${webViewport} px erzwungen)`, ruleIds))
  counts['UEyes Webseiten'] = web.imageCount

  options.onProgress?.(`${side.label}: UEyes-Telefon-Screens, ein Viewport`)
  const mobile = await auditFindings({
    setName: 'ueyes-mobile',
    priorAsset: 'mobile',
    segment: false,
    params: side.params,
    ...(options.limit ? { limit: options.limit } : {}),
  })
  entries.push(...entriesOf(mobile, 'ueyes-mobile-1vp', 'UEyes Telefon-Screens (ein Viewport)', ruleIds))
  counts['UEyes Telefon'] = mobile.imageCount

  if (options.mobileViewport) {
    options.onProgress?.(`${side.label}: UEyes-Telefon-Screens, Viewport ${options.mobileViewport} px erzwungen`)
    const segmented = await auditFindings({
      setName: 'ueyes-mobile',
      priorAsset: 'mobile',
      viewportOverride: options.mobileViewport,
      params: side.params,
      ...(options.limit ? { limit: options.limit } : {}),
    })
    entries.push(
      ...entriesOf(
        segmented,
        'ueyes-mobile-segmentiert',
        `UEyes Telefon-Screens (Viewport ${options.mobileViewport} px erzwungen)`,
        ruleIds,
      ),
    )
    counts['UEyes Telefon segmentiert'] = segmented.imageCount
  }

  return { side: { label: side.label, configuration: describeParams(side.params), entries }, counts }
}

export async function measureSideEffects(options: SideEffectOptions): Promise<SideEffectResult> {
  const before = await measureSide(options.before, options)
  const after = await measureSide(options.after, options)
  return {
    before: before.side,
    after: after.side,
    realImageCount: { ...before.counts, ...after.counts },
    constructedVariants: options.variants ?? 24,
    webViewport: options.webViewport ?? 500,
    ruleIds: options.ruleIds ?? SHIPPED_RULES,
  }
}

function pct(value: number | null): string {
  return value === null ? '—' : `${(value * 100).toFixed(1).replace('.', ',')} %`
}

export function buildSideEffectReport(result: SideEffectResult, generatedAt: string, notes: string[] = []): string {
  const lines: string[] = []
  lines.push('# Nebenwirkungen einer Engine-Änderung auf die Befundregeln')
  lines.push('')
  lines.push(`Feuerraten bei **${result.before.label}** und **${result.after.label}**. Erzeugt: ${generatedAt}`)
  lines.push('')
  lines.push(`- ${result.before.label}: \`${result.before.configuration}\``)
  lines.push(`- ${result.after.label}: \`${result.after.configuration}\``)
  lines.push('')
  lines.push(
    'Keine Zeile in `rules.ts` ist dafür angefasst worden. Was sich ändert, ist die Karte, auf der die drei ' +
      'Schwellen sitzen — genau die Fehlerklasse, an der `flat` dreimal und `cold-fold` einmal gescheitert ist: ' +
      'eine Schwelle wird in einer Konfiguration geschätzt und in einer anderen angewandt.',
  )
  lines.push('')
  for (const note of notes) {
    lines.push(`> ${note}`)
    lines.push('')
  }
  lines.push(
    `Populationen: ${result.constructedVariants} Varianten je konstruierter Frame-Form; UEyes-Webseiten mit ` +
      `erzwungenem Viewport von ${result.webViewport} px (sonst wäre nichts segmentiert und \`cold-fold\` nie ` +
      'gefragt); UEyes-Telefon-Screens als ein Viewport, also so, wie das Plugin sie behandeln würde.',
  )
  lines.push('')

  for (const ruleId of result.ruleIds) {
    lines.push(`## \`${ruleId}\``)
    lines.push('')
    lines.push(`| Population | bewertet | blockiert | ${result.before.label} | ${result.after.label} | Δ | Entscheidungsgröße p5 / Median / p95 (vorher → nachher) |`)
    lines.push('|---|---:|---:|---:|---:|---:|---|')
    for (const before of result.before.entries.filter((entry) => entry.ruleId === ruleId)) {
      const after = result.after.entries.find(
        (entry) => entry.ruleId === ruleId && entry.population === before.population,
      )
      if (!after) continue
      const delta =
        before.rate === null || after.rate === null
          ? '—'
          : `${after.rate - before.rate >= 0 ? '+' : ''}${((after.rate - before.rate) * 100).toFixed(1).replace('.', ',')} pp`
      const distribution =
        before.quantiles.every((value) => Number.isNaN(value))
          ? '—'
          : `${before.quantiles[0].toFixed(3)} / ${before.quantiles[2].toFixed(3)} / ${before.quantiles[4].toFixed(3)}` +
            ` → ${after.quantiles[0].toFixed(3)} / ${after.quantiles[2].toFixed(3)} / ${after.quantiles[4].toFixed(3)}`
      lines.push(
        `| ${before.population} | ${before.evaluated} | ${before.blocked} | ${pct(before.rate)} | ${pct(after.rate)} | ${delta} | ${distribution} |`,
      )
    }
    lines.push('')
    const threshold = result.before.entries.find((entry) => entry.ruleId === ruleId)?.threshold
    lines.push(
      threshold === null || threshold === undefined
        ? '_Ohne kalibrierte Schwelle — die Regel schneidet an einer Definition, nicht an einer Konstante._'
        : `_Schwelle: ${threshold}._`,
    )
    lines.push('')
  }

  return lines.join('\n')
}

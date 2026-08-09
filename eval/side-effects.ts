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
import { auditConstructed, auditFindings, type AuditResult, type RuleStats } from './findings-audit'

/** Die drei ausgelieferten Regeln — die, deren Schwellen jetzt wackeln. */
export const SHIPPED_RULES: readonly string[] = ['cta-rank', 'competition', 'cold-fold']

export type PopulationId = 'konstruiert' | 'ueyes-web-segmentiert' | 'ueyes-mobile-1vp'

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
  alpha: number
  entries: RateEntry[]
}

export type SideEffectResult = {
  before: SideEffectSide
  after: SideEffectSide
  /** Wie viele Bilder je echter Population bewertet wurden. */
  realImageCount: Record<string, number>
  constructedVariants: number
  webViewport: number
}

function quantilesOf(samples: readonly number[], points = [0.05, 0.25, 0.5, 0.75, 0.95]): number[] {
  if (samples.length === 0) return points.map(() => Number.NaN)
  const sorted = [...samples].sort((a, b) => a - b)
  return points.map((q) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))])
}

function entriesOf(result: AuditResult, populationId: PopulationId, label: string): RateEntry[] {
  return SHIPPED_RULES.map((ruleId) => {
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

export type SideEffectOptions = {
  before: number
  after: number
  variants?: number
  /** Erzwungene Viewport-Höhe für die Webseiten — sonst ist nichts segmentiert. */
  webViewport?: number
  /** Bildzahl je echter Population. Eine Begrenzung wird im Report ausgewiesen. */
  limit?: number
  onProgress?: (message: string) => void
}

async function measureSide(alpha: number, options: SideEffectOptions): Promise<{ side: SideEffectSide; counts: Record<string, number> }> {
  const variants = options.variants ?? 24
  const webViewport = options.webViewport ?? 500
  const entries: RateEntry[] = []
  const counts: Record<string, number> = {}

  options.onProgress?.(`α = ${alpha}: konstruierte Frames`)
  for (const result of await auditConstructed({ variants, blendAlpha: alpha })) {
    entries.push(...entriesOf(result, 'konstruiert', result.setName))
    counts[result.setName] = result.imageCount
  }

  options.onProgress?.(`α = ${alpha}: UEyes-Webseiten, Viewport ${webViewport} px erzwungen`)
  const web = await auditFindings({
    setName: 'ueyes-web',
    priorAsset: 'web',
    viewportOverride: webViewport,
    blendAlpha: alpha,
    ...(options.limit ? { limit: options.limit } : {}),
  })
  entries.push(...entriesOf(web, 'ueyes-web-segmentiert', `UEyes Webseiten (Viewport ${webViewport} px erzwungen)`))
  counts['UEyes Webseiten'] = web.imageCount

  options.onProgress?.(`α = ${alpha}: UEyes-Telefon-Screens, ein Viewport`)
  const mobile = await auditFindings({
    setName: 'ueyes-mobile',
    priorAsset: 'mobile',
    segment: false,
    blendAlpha: alpha,
    ...(options.limit ? { limit: options.limit } : {}),
  })
  entries.push(...entriesOf(mobile, 'ueyes-mobile-1vp', 'UEyes Telefon-Screens (ein Viewport)'))
  counts['UEyes Telefon'] = mobile.imageCount

  return { side: { alpha, entries }, counts }
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
  }
}

function pct(value: number | null): string {
  return value === null ? '—' : `${(value * 100).toFixed(1).replace('.', ',')} %`
}

export function buildSideEffectReport(result: SideEffectResult, generatedAt: string, notes: string[] = []): string {
  const lines: string[] = []
  lines.push(`# A5 — Nebenwirkungen einer Änderung an \`blendAlpha\``)
  lines.push('')
  lines.push(
    `Feuerraten der drei **ausgelieferten** Regeln bei α = ${result.before.alpha} (heute) und ` +
      `α = ${result.after.alpha}. Erzeugt: ${generatedAt}`,
  )
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

  for (const ruleId of SHIPPED_RULES) {
    lines.push(`## \`${ruleId}\``)
    lines.push('')
    lines.push('| Population | bewertet | blockiert | Rate α = ' + result.before.alpha + ' | Rate α = ' + result.after.alpha + ' | Δ | Entscheidungsgröße p5 / Median / p95 (vorher → nachher) |')
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

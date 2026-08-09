/**
 * Markdown zum Schärfe-Sweep (1.2 A6).
 *
 * Eine Tabelle je Hebel, nicht eine große über alles: die Frage ist „welcher
 * Hebel trägt", und die beantwortet man nicht in einer Punktwolke.
 *
 * Die Konzentrationsspalte steht in jeder Tabelle neben den Metriken, weil sie
 * das Ziel ist und die Metriken die Nebenbedingung. Umgekehrt gelesen wäre es
 * eine Optimierung auf eine Größe, die keine Ground Truth hat.
 */
import { LEVER_LABELS, type LeverId, type SharpnessPoint, type SharpnessResult } from './sharpness'
import { METRIC_IDS, type MetricId } from './metrics/types'

const DECISION: readonly MetricId[] = ['aucJudd', 'cc', 'nss']

function fmt(value: number, digits = 3): string {
  return Number.isFinite(value) ? value.toFixed(digits) : '—'
}

function signed(value: number, digits = 4): string {
  if (!Number.isFinite(value)) return '—'
  return `${value >= 0 ? '+' : ''}${value.toFixed(digits)}`
}

/** Urteil über eine Variante: hält sie die drei Hauptmetriken? */
export function verdictOf(point: SharpnessPoint): 'besser' | 'gehalten' | 'verloren' {
  const anyBetter = DECISION.some((metric) => point.versusBasis[metric].ci95[0] > 0)
  const anyWorse = DECISION.some((metric) => point.versusBasis[metric].ci95[1] < 0)
  if (anyWorse) return 'verloren'
  return anyBetter ? 'besser' : 'gehalten'
}

const VERDICT_MARK: Record<ReturnType<typeof verdictOf>, string> = {
  besser: '**besser**',
  gehalten: 'gehalten',
  verloren: 'verloren',
}

function table(points: readonly SharpnessPoint[], basis: SharpnessPoint, truth: number): string[] {
  const lines: string[] = []
  lines.push('| Wert | AUC ↑ | CC ↑ | NSS ↑ | KL ↓ | Konzentration | ΔAUC | ΔCC | ΔNSS | Urteil |')
  lines.push('|---|---:|---:|---:|---:|---:|---:|---:|---:|---|')
  const rows = [basis, ...points.filter((point) => point.variant.id !== basis.variant.id)]
  for (const point of rows) {
    const isBasis = point.variant.id === basis.variant.id
    const metrics = METRIC_IDS.map((metric) => fmt(point.metrics[metric].mean))
    const deltas = DECISION.map((metric) => (isBasis ? '—' : signed(point.versusBasis[metric].mean)))
    const gap = point.concentration.mean / truth
    lines.push(
      `| ${isBasis ? '**Ist-Zustand**' : point.variant.label} | ${metrics.join(' | ')} | ` +
        `${fmt(point.concentration.mean)} (${fmt(gap, 2)}× GT) | ${deltas.join(' | ')} | ` +
        `${isBasis ? '—' : VERDICT_MARK[verdictOf(point)]} |`,
    )
  }
  return lines
}

export function buildSharpnessReport(
  results: readonly SharpnessResult[],
  stage: 'Stufe 1 — ein Hebel nach dem anderen' | 'Stufe 2 — Kombinationen',
  generatedAt: string,
  notes: string[] = [],
): string {
  const lines: string[] = []
  const first = results[0]

  lines.push(`# Schärfe — ${stage} (1.2 A6)`)
  lines.push('')
  lines.push(
    `${first.folds}-fache Kreuzvalidierung auf dem **Tuning-Split**, ${first.duration} s, Ortsprior je Fold aus den ` +
      `übrigen Folds. Erzeugt: ${generatedAt}`,
  )
  lines.push('')
  lines.push(
    '**Ziel und Nebenbedingung sind nicht dasselbe.** Gesucht ist eine höhere Konzentration (Masse in den ' +
      'stärksten 5 % der Pixel, siehe A1), *ohne* AUC, CC und NSS zu verlieren. Eine Variante gilt als „verloren", ' +
      'sobald das 95-%-Intervall einer der drei gepaarten Differenzen ganz unter der Null liegt — auch wenn sie ' +
      'die schärfste wäre.',
  )
  lines.push('')
  lines.push(
    '**KL wird berichtet und entscheidet nicht** — dieselbe begründete Ausnahme wie in A3. Sie ist hier besonders ' +
      'wichtig: der Hebel `blendGamma` wurde beim Einbau von `hybrid-v1` *wegen KL* ausgebaut. Nach dem Kriterium, ' +
      'das Zuspitzung bestraft, über einen Parameter zu entscheiden, dessen Zweck Zuspitzung ist, ist zirkulär.',
  )
  lines.push('')
  for (const note of notes) {
    lines.push(`> ${note}`)
    lines.push('')
  }

  for (const result of results) {
    const basis = result.points.find((point) => point.variant.id === 'basis')
    if (!basis) continue
    lines.push('---')
    lines.push('')
    lines.push(`## ${result.setName} — ${result.imageCount} Bilder`)
    lines.push('')
    lines.push(
      `Konzentration der Ground Truth: **${fmt(result.truthConcentration.mean)}** ` +
        `(p5 ${fmt(result.truthConcentrationQuantiles[0])}, Median ${fmt(result.truthConcentrationQuantiles[2])}, ` +
        `p95 ${fmt(result.truthConcentrationQuantiles[4])}). Das ist die Zielmarke, nicht ein Grenzwert — ` +
        'eine Vorhersage, die sie exakt trifft, wäre nicht deshalb richtig.',
    )
    lines.push('')

    const levers = [...new Set(result.points.map((point) => point.variant.lever))].filter(
      (lever): lever is LeverId => lever !== 'basis',
    )
    for (const lever of levers) {
      lines.push(`### ${LEVER_LABELS[lever]}`)
      lines.push('')
      lines.push(...table(result.points.filter((point) => point.variant.lever === lever), basis, result.truthConcentration.mean))
      lines.push('')
    }
  }

  return lines.join('\n')
}

/**
 * Markdown zur Alpha-Kurve (1.2 A).
 *
 * Der Bericht hat zwei Teile, die nicht vermischt werden dürfen:
 *
 *   A1 — ist die Vorhersage systematisch weicher als die Ground Truth?
 *        Eine Verteilungsfrage, also Verteilungen statt Mittelwerte.
 *   A2/A3 — welcher Alpha-Wert gewinnt, und woran gemessen?
 *
 * A3 verlangt ausdrücklich, dass die **Ausnahme bei KL begründet** und nicht
 * stillschweigend gemacht wird. Diese Begründung steht deshalb hier im
 * Report-Generator und nicht in einer Fußnote, die beim nächsten Lauf
 * verschwindet.
 */
import type { AlphaSweepResult, PairedDelta, TestConfirmation } from './alpha'
import { CONCENTRATION_TOP_SHARE } from './alpha'
import { METRIC_DIRECTION, METRIC_IDS, METRIC_LABELS, type MetricId } from './metrics/types'

/** Metriken, die A3 als Entscheidungskriterium zulässt. */
export const DECISION_METRICS: readonly MetricId[] = ['aucJudd', 'cc', 'nss']

function fmt(value: number, digits = 3): string {
  return Number.isFinite(value) ? value.toFixed(digits) : '—'
}

function signed(value: number, digits = 4): string {
  if (!Number.isFinite(value)) return '—'
  return `${value >= 0 ? '+' : ''}${value.toFixed(digits)}`
}

function pct(value: number): string {
  return Number.isFinite(value) ? `${(value * 100).toFixed(1).replace('.', ',')} %` : '—'
}

/** Kompaktes Texthistogramm über einen festen Wertebereich. */
export function histogram(samples: readonly number[], from: number, to: number, bins = 20): string[] {
  const counts = new Array<number>(bins).fill(0)
  for (const value of samples) {
    if (!Number.isFinite(value)) continue
    const index = Math.min(bins - 1, Math.max(0, Math.floor(((value - from) / (to - from)) * bins)))
    counts[index]++
  }
  const peak = Math.max(1, ...counts)
  return counts.map((count, index) => {
    const low = from + ((to - from) * index) / bins
    const high = from + ((to - from) * (index + 1)) / bins
    const bar = '█'.repeat(Math.round((count / peak) * 40))
    return `${low.toFixed(2)}–${high.toFixed(2)}  ${String(count).padStart(4)}  ${bar}`
  })
}

function deltaLine(delta: PairedDelta): string {
  const verdict = delta.ci95[0] > 0 ? 'belastbar besser' : delta.ci95[1] < 0 ? 'belastbar schlechter' : 'nicht unterscheidbar'
  return (
    `| ${METRIC_LABELS[delta.metric]} | ${signed(delta.mean)} | [${fmt(delta.ci95[0], 4)}, ${fmt(delta.ci95[1], 4)}] | ` +
    `${fmt(delta.tStatistic, 1)} | ${pct(delta.winRate)} | ${verdict} |`
  )
}

/** Der Alpha-Wert, den AUC, CC und NSS gemeinsam tragen. */
export function decisionFor(result: AlphaSweepResult): {
  best: Record<MetricId, number>
  winner: number | null
  unanimous: boolean
} {
  const candidates = result.points.filter((point) => point.alpha > 0)
  const best = {} as Record<MetricId, number>
  for (const metric of METRIC_IDS) {
    const direction = METRIC_DIRECTION[metric]
    best[metric] = candidates.reduce((winner, point) =>
      point.metrics[metric].mean * direction > winner.metrics[metric].mean * direction ? point : winner,
    ).alpha
  }
  const decisionWinners = DECISION_METRICS.map((metric) => best[metric])
  const unanimous = decisionWinners.every((alpha) => alpha === decisionWinners[0])
  return { best, winner: unanimous ? decisionWinners[0] : null, unanimous }
}

export function buildAlphaReport(results: readonly AlphaSweepResult[], generatedAt: string, notes: string[] = []): string {
  const lines: string[] = []
  const first = results[0]

  lines.push('# Alpha-Kurve — wie stark die Bildanalyse zählen darf (1.2 A)')
  lines.push('')
  lines.push(
    `${first.folds}-fache Kreuzvalidierung auf dem **Tuning-Split**, Betrachtungsdauer ${first.duration} s. ` +
      `Erzeugt: ${generatedAt}`,
  )
  lines.push('')
  lines.push(
    'Pro Fold werden **beide** datenabhängigen Größen ausschließlich aus den übrigen Folds geschätzt — der ' +
      'Ortsprior (inklusive 8-Bit-Quantisierung auf 32 × 32, also in der ausgelieferten Form) und die ' +
      'Mean-Map-Baseline. Jedes Bild wird damit out-of-sample bewertet.',
  )
  lines.push('')
  lines.push(
    '**Abweichung von `npm run crossval`, bewusst:** dort läuft die Kreuzvalidierung über Tuning *und* Test ' +
      'zusammen, weil sie ein Ergebnis *berichtet*. Hier wird ein Parameter *entschieden*, und dafür darf der ' +
      'Test-Split nicht mitlaufen. Er wird genau einmal angefasst, am Ende, mit dem gewählten Wert.',
  )
  lines.push('')
  for (const note of notes) {
    lines.push(`> ${note}`)
    lines.push('')
  }

  for (const result of results) {
    lines.push('---')
    lines.push('')
    lines.push(`## ${result.setName} — ${result.imageCount} Bilder`)
    lines.push('')

    // --- A1 ----------------------------------------------------------------
    lines.push('### A1 — Ist unsere Karte weicher als die Wirklichkeit?')
    lines.push('')
    lines.push(
      `Gemessene Größe: der Anteil der Gesamtmasse, der auf die stärksten ` +
        `${(CONCENTRATION_TOP_SHARE * 100).toFixed(0)} % der Pixel entfällt. Eine gleichmäßige Karte liegt bei ` +
        `${CONCENTRATION_TOP_SHARE.toFixed(2)}, eine Karte mit einem einzigen scharfen Blickfang nahe 1. ` +
        'Beide Seiten werden vorher identisch normiert (Minimum und Maximum), sonst verglichen man zwei ' +
        'verschieden verschobene Verteilungen.',
    )
    lines.push('')
    lines.push('| | p5 | p25 | Median | p75 | p95 | Mittelwert |')
    lines.push('|---|---:|---:|---:|---:|---:|---:|')
    const t = result.truthConcentrationQuantiles
    lines.push(
      `| **UEyes Ground Truth** | ${t.map((value) => fmt(value)).join(' | ')} | ${fmt(result.truthConcentration.mean)} |`,
    )
    for (const point of result.points) {
      const label = point.alpha === 0 ? 'Vorhersage, nur Ortsprior (α = 0)' : `Vorhersage, α = ${point.alpha}`
      lines.push(
        `| ${label} | ${point.concentrationQuantiles.map((value) => fmt(value)).join(' | ')} | ${fmt(point.concentration.mean)} |`,
      )
    }
    lines.push(`| Mean-Map-Baseline | — | — | — | — | — | ${fmt(result.meanMap.concentration.mean)} |`)
    lines.push('')

    lines.push('Verteilung der Ground-Truth-Konzentration:')
    lines.push('')
    lines.push('```')
    lines.push(...histogram(result.truthConcentrationSamples, 0, 1))
    lines.push('```')
    lines.push('')
    const shipped = result.points.find((point) => point.alpha === result.referenceAlpha)
    if (shipped) {
      lines.push(`Verteilung der Vorhersage bei α = ${result.referenceAlpha} (ausgeliefert):`)
      lines.push('')
      lines.push('```')
      lines.push(...histogram(shipped.concentrationSamples, 0, 1))
      lines.push('```')
      lines.push('')
      const factor = result.truthConcentration.mean / shipped.concentration.mean
      lines.push(
        `**Befund.** Die Ground Truth ist im Mittel um den Faktor ${fmt(factor, 2)} konzentrierter als die ` +
          `ausgelieferte Vorhersage (${fmt(result.truthConcentration.mean)} gegen ${fmt(shipped.concentration.mean)}). ` +
          'Dieser Fehler zeigt sich in AUC kaum: die Metrik bewertet die **Reihenfolge** der Pixel, nicht die ' +
          'Schärfe der Verteilung. Eine zu weiche Karte kann dieselbe Rangfolge haben wie eine scharfe.',
      )
      lines.push('')
    }

    // --- A2 ----------------------------------------------------------------
    lines.push('### A2 — Alpha-Sweep')
    lines.push('')
    lines.push('| α | AUC-Judd ↑ | CC ↑ | NSS ↑ | KL ↓ | Konzentration |')
    lines.push('|---|---:|---:|---:|---:|---:|')
    for (const point of result.points) {
      const cells = METRIC_IDS.map((metric) => `${fmt(point.metrics[metric].mean)} ± ${fmt(point.metrics[metric].se, 4)}`)
      lines.push(`| ${point.alpha === 0 ? '0 (nur Prior)' : point.alpha} | ${cells.join(' | ')} | ${fmt(point.concentration.mean)} |`)
    }
    const meanMapCells = METRIC_IDS.map((metric) => fmt(result.meanMap.metrics[metric].mean))
    lines.push(`| Mean Map (je Fold) | ${meanMapCells.join(' | ')} | ${fmt(result.meanMap.concentration.mean)} |`)
    lines.push('')
    lines.push('Fold-Mittelwerte je Alpha (fünf unabhängige Schätzungen derselben Größe):')
    lines.push('')
    lines.push('| α | ' + METRIC_IDS.map((metric) => METRIC_LABELS[metric]).join(' | ') + ' |')
    lines.push('|---|' + METRIC_IDS.map(() => '---').join('|') + '|')
    for (const point of result.points) {
      const cells = METRIC_IDS.map((metric) => point.foldMeans[metric].map((value) => fmt(value)).join(' · '))
      lines.push(`| ${point.alpha} | ${cells.join(' | ')} |`)
    }
    lines.push('')

    // --- gepaarte Vergleiche ----------------------------------------------
    lines.push(`### Gepaart gegen den ausgelieferten Wert (α = ${result.referenceAlpha})`)
    lines.push('')
    for (const point of result.points) {
      if (point.alpha === result.referenceAlpha) continue
      const deltas = result.versusReference.get(point.alpha)
      if (!deltas) continue
      lines.push(`**α = ${point.alpha}**`)
      lines.push('')
      lines.push('| Metrik | Δ (+ = besser) | 95-%-KI | t | besser auf | Urteil |')
      lines.push('|---|---:|---|---:|---:|---|')
      for (const delta of deltas) lines.push(deltaLine(delta))
      lines.push('')
    }

    lines.push('### Gegen die Mean-Map-Baseline')
    lines.push('')
    lines.push(
      'Der Grund, aus dem 0,3 gewählt wurde: bei 0,5 verlor KL gegen die Mean Map, und S-2 verlangte einen Sieg ' +
        'in allen vier Metriken. Die Zeile steht deshalb hier vollständig.',
    )
    lines.push('')
    lines.push('| α | ' + METRIC_IDS.map((metric) => `Δ ${METRIC_LABELS[metric]}`).join(' | ') + ' |')
    lines.push('|---|' + METRIC_IDS.map(() => '---:').join('|') + '|')
    for (const point of result.points) {
      const deltas = result.versusMeanMap.get(point.alpha)
      if (!deltas) continue
      const cells = METRIC_IDS.map((metric) => {
        const delta = deltas.find((entry) => entry.metric === metric)!
        const mark = delta.ci95[0] > 0 ? '' : delta.ci95[1] < 0 ? ' ✗' : ' ~'
        return `${signed(delta.mean)}${mark}`
      })
      lines.push(`| ${point.alpha} | ${cells.join(' | ')} |`)
    }
    lines.push('')
    lines.push('(✗ = belastbar schlechter als die Mean Map, ~ = nicht von ihr zu unterscheiden, ohne Zeichen = belastbar besser)')
    lines.push('')

    // --- A3 ----------------------------------------------------------------
    const decision = decisionFor(result)
    lines.push('### A3 — Entscheidung')
    lines.push('')
    lines.push(
      '**Kriterium sind AUC, CC und NSS. KL wird berichtet, entscheidet aber nicht — und das ist eine ' +
        'ausdrückliche Ausnahme, keine Nachlässigkeit.** KL misst, wie viel Masse die Vorhersage dort liegen ' +
        'lässt, wo die Ground Truth Masse hat. Eine zugespitzte Karte verliert dabei zwangsläufig: sie räumt ' +
        'die Ränder leer, und jede Ground-Truth-Masse am Rand wird voll bestraft. Zuspitzung ist aber genau ' +
        'die Eigenschaft, die hier geprüft wird — KL als Kriterium hieße, die Frage mit der Antwort zu ' +
        'beantworten. Die Zahl steht in jeder Tabelle, damit der Preis der Entscheidung sichtbar bleibt.',
    )
    lines.push('')
    for (const metric of METRIC_IDS) {
      const marker = DECISION_METRICS.includes(metric) ? 'Kriterium' : 'nur berichtet'
      lines.push(`- **${METRIC_LABELS[metric]}** (${marker}): bester Wert bei α = ${decision.best[metric]}`)
    }
    lines.push('')
    lines.push(
      decision.unanimous
        ? `**Die drei Kriterien sind sich einig: α = ${decision.winner}.**`
        : '**Die drei Kriterien sind sich nicht einig.** Das ist kein Ergebnis, das aufgelöst werden darf, ohne ' +
            'es zu benennen — siehe die Tabelle oben.',
    )
    lines.push('')
  }

  return lines.join('\n')
}

export function buildTestConfirmationSection(confirmations: readonly TestConfirmation[]): string {
  const lines: string[] = []
  lines.push('## Bestätigung auf dem Test-Split (einmalig)')
  lines.push('')
  lines.push(
    'Der Test-Split wurde bis hierher nicht angefasst. Er läuft mit dem **ausgelieferten** Ortsprior, nicht mit ' +
      'einem Fold-Prior — hier soll stehen, was das Plugin tut, nicht was die Kreuzvalidierung schätzt.',
  )
  lines.push('')
  for (const confirmation of confirmations) {
    lines.push(`### ${confirmation.setName} — ${confirmation.imageCount} Bilder`)
    lines.push('')
    lines.push('| α | ' + METRIC_IDS.map((metric) => METRIC_LABELS[metric]).join(' | ') + ' | Konzentration |')
    lines.push('|---|' + METRIC_IDS.map(() => '---:').join('|') + '|---:|')
    for (const alpha of confirmation.alphas) {
      const metrics = confirmation.metrics.get(alpha)!
      const cells = METRIC_IDS.map((metric) => fmt(metrics[metric].mean))
      lines.push(`| ${alpha} | ${cells.join(' | ')} | ${fmt(confirmation.concentration.get(alpha)!.mean)} |`)
    }
    lines.push(`| Ground Truth | — | — | — | — | ${fmt(confirmation.truthConcentration.mean)} |`)
    lines.push('')
    for (const alpha of confirmation.alphas) {
      if (alpha === confirmation.referenceAlpha) continue
      lines.push(`**α = ${alpha} gegen α = ${confirmation.referenceAlpha}**`)
      lines.push('')
      lines.push('| Metrik | Δ (+ = besser) | 95-%-KI | t | besser auf | Urteil |')
      lines.push('|---|---:|---|---:|---:|---|')
      for (const delta of confirmation.paired.get(alpha)!) lines.push(deltaLine(delta))
      lines.push('')
    }
  }
  return lines.join('\n')
}

/**
 * Markdown für die Kreuzvalidierung.
 *
 * Der Bericht beantwortet eine Frage explizit: Ist der Unterschied zwischen
 * `hybrid-v1` und der Mean Map größer als die Streuung? Weil „die Streuung"
 * zwei verschiedene Dinge heißen kann, werden beide ausgewiesen und
 * auseinandergehalten.
 */
import { ENGINE_LABELS, type CrossvalResult, type EngineId, type PairedComparison } from './crossval'
import { METRIC_DIRECTION, METRIC_IDS, METRIC_LABELS } from './metrics/types'

function fmt(value: number, digits = 3): string {
  return Number.isFinite(value) ? value.toFixed(digits) : '—'
}

function signed(value: number, digits = 3): string {
  if (!Number.isFinite(value)) return '—'
  return `${value >= 0 ? '+' : ''}${value.toFixed(digits)}`
}

const ORDER: EngineId[] = ['hybrid-v1', 'mean-map', 'heuristic-v1', 'center-bias', 'uniform']

function verdictFor(comparison: PairedComparison): { holds: boolean; text: string } {
  const consistent = comparison.perFold.every((value) => value > 0) || comparison.perFold.every((value) => value < 0)
  const separated = comparison.ci95[0] > 0
  const label = METRIC_LABELS[comparison.metric]

  if (separated && consistent) {
    return {
      holds: true,
      text: `**${label}: ja.** Der Unterschied ist ${fmt(comparison.mean)} ± ${fmt(comparison.se)} (Standardfehler), das 95-%-Intervall [${fmt(comparison.ci95[0])}, ${fmt(comparison.ci95[1])}] schließt die Null aus, und alle fünf Folds zeigen dasselbe Vorzeichen.`,
    }
  }
  if (separated) {
    return {
      holds: true,
      text: `**${label}: ja, aber uneinheitlich.** Das 95-%-Intervall [${fmt(comparison.ci95[0])}, ${fmt(comparison.ci95[1])}] schließt die Null aus, die Folds sind sich jedoch nicht einig (${comparison.perFold.map((value) => signed(value, 3)).join(', ')}).`,
    }
  }
  return {
    holds: false,
    text: `**${label}: nein.** Der Unterschied ist ${fmt(comparison.mean)} ± ${fmt(comparison.se)}, das 95-%-Intervall [${fmt(comparison.ci95[0])}, ${fmt(comparison.ci95[1])}] enthält die Null. Auf dieser Datenmenge nicht von Rauschen zu unterscheiden.`,
  }
}

export function buildCrossvalReport(result: CrossvalResult, generatedAt: string): string {
  const lines: string[] = []

  lines.push(`# Kreuzvalidierung — ${result.setName}`)
  lines.push('')
  lines.push(
    `${result.folds} Folds über **alle ${result.imageCount} Bilder** der Kategorie (Tuning + Test zusammen), ` +
      `Betrachtungsdauer ${result.duration} s. Erzeugt: ${generatedAt}`,
  )
  lines.push('')
  lines.push(
    'Pro Fold werden **beide** datenabhängigen Größen ausschließlich aus den übrigen vier Folds geschätzt: die ' +
      'Mean-Map-Baseline **und** der Ortsprior von `hybrid-v1` — letzterer inklusive 8-Bit-Quantisierung auf ' +
      '32 × 32, also genau in der Form, die ausgeliefert wird. Jedes Bild wird damit **out-of-sample** bewertet.',
  )
  lines.push('')
  lines.push(`Fold-Größen: ${result.foldSizes.join(', ')}`)
  lines.push('')

  // --- 1) means and spreads ------------------------------------------------
  lines.push('## Mittelwert und Streuung je Metrik')
  lines.push('')
  lines.push(
    `Streuung ist hier die Standardabweichung **über die ${result.imageCount} Einzelbilder** — wie stark einzelne ` +
      'Screens voneinander abweichen. Der Standardfehler des Mittelwerts ist um den Faktor ' +
      `√${result.imageCount} kleiner und steht in Klammern.`,
  )
  lines.push('')

  for (const metric of METRIC_IDS) {
    lines.push(`### ${METRIC_LABELS[metric]} ${METRIC_DIRECTION[metric] > 0 ? '↑' : '↓'}`)
    lines.push('')
    lines.push('| Engine | Mittelwert | SD über Bilder | (Standardfehler) | Fold-Mittelwerte |')
    lines.push('|---|---:|---:|---:|---|')
    for (const engine of ORDER) {
      const summary = result.summaries[engine][metric]
      const folds = result.foldMeans[engine][metric].map((value) => fmt(value, 3)).join(' · ')
      lines.push(
        `| ${ENGINE_LABELS[engine]} | ${fmt(summary.mean)} | ${fmt(summary.sd)} | (${fmt(summary.se, 4)}) | ${folds} |`,
      )
    }
    lines.push('')
  }

  lines.push(
    '> **Diese Zahlen gelten für einzelne Viewport-Ausschnitte.** Alle Läufe verwenden `segment: false`; die ' +
      'Referenzbilder sind Einzel-Screenshots. Für **segmentierte Frames** (Epic B, ab 1,5 Viewport-Höhen) ist ' +
      'nichts davon gemessen: dort wird der Ortsprior je Abschnitt neu gebildet und mit der Scrolltiefe gedämpft, ' +
      'und UEyes enthält keine gescrollten Seiten, an denen sich das prüfen ließe.',
  )
  lines.push('')

  // --- 2) the question -----------------------------------------------------
  lines.push('## Ist der Unterschied größer als die Streuung?')
  lines.push('')
  lines.push(
    'Die Frage hat zwei Lesarten, und sie führen zu entgegengesetzten Antworten. Beide stehen hier, weil nur ' +
      'eine davon die Frage beantwortet, ob der Unterschied echt ist.',
  )
  lines.push('')

  lines.push('### Lesart A — Unterschied gegen die Streuung zwischen Screens')
  lines.push('')
  const ccPair = result.hybridVsMeanMap.find((entry) => entry.metric === 'cc')!
  const ccHybrid = result.summaries['hybrid-v1'].cc
  lines.push(
    `Der CC-Unterschied beträgt ${fmt(ccPair.mean)}, die Streuung zwischen einzelnen Screens ${fmt(ccHybrid.sd)}. ` +
      'In dieser Lesart ist der Unterschied **deutlich kleiner als die Streuung**.',
  )
  lines.push('')
  lines.push(
    'Das beantwortet aber eine andere Frage, nämlich: „Kann ich aus dem Mittelwert vorhersagen, wie gut die ' +
      'Engine auf *einem bestimmten* Screen abschneidet?" Antwort: nein — die Screens unterscheiden sich stark ' +
      'voneinander. Über die Verlässlichkeit des *Unterschieds* sagt das nichts, weil beide Engines auf ' +
      'denselben Screens gemessen werden und deren Schwierigkeit sich damit herauskürzt.',
  )
  lines.push('')

  lines.push('### Lesart B — Unterschied gegen seine eigene Unsicherheit (gepaart)')
  lines.push('')
  lines.push(
    'Für jedes Bild die Differenz beider Engines bilden und deren Mittelwert samt Unsicherheit betrachten. Das ' +
      'ist der Vergleich, der die Frage „ist der Unterschied echt?" beantwortet.',
  )
  lines.push('')

  for (const [title, comparisons] of [
    ['hybrid-v1 gegen Mean Map', result.hybridVsMeanMap],
    ['hybrid-v1 gegen Figmaps 1.0', result.hybridVsHeuristic],
  ] as const) {
    lines.push(`#### ${title}`)
    lines.push('')
    lines.push('| Metrik | Δ (richtungsbereinigt) | SD der Differenz | 95-%-Intervall | t | besser auf | Fold-Differenzen |')
    lines.push('|---|---:|---:|---|---:|---:|---|')
    for (const comparison of comparisons) {
      lines.push(
        `| ${METRIC_LABELS[comparison.metric]} | ${signed(comparison.mean)} | ${fmt(comparison.sd)} | ` +
          `[${fmt(comparison.ci95[0])}, ${fmt(comparison.ci95[1])}] | ${fmt(comparison.tStatistic, 1)} | ` +
          `${(comparison.winRate * 100).toFixed(1)} % | ${comparison.perFold.map((value) => signed(value, 3)).join(' · ')} |`,
      )
    }
    lines.push('')
  }

  lines.push('_Richtungsbereinigt: **+ ist immer besser**, auch bei KL. „t" ist der Mittelwert in Einheiten seines_')
  lines.push('_eigenen Standardfehlers; ab etwa 2 schließt das 95-%-Intervall die Null aus._')
  lines.push('')

  // --- 3) the answer -------------------------------------------------------
  lines.push('## Antwort')
  lines.push('')
  const verdicts = result.hybridVsMeanMap.map(verdictFor)
  for (const verdict of verdicts) lines.push(`- ${verdict.text}`)
  lines.push('')

  const held = verdicts.filter((verdict) => verdict.holds).length
  if (held === METRIC_IDS.length) {
    lines.push(
      '**In allen vier Metriken ist der Unterschied größer als seine Unsicherheit.** `hybrid-v1` schlägt die ' +
        'Mean Map nicht zufällig.',
    )
  } else if (held === 0) {
    lines.push(
      '**In keiner Metrik ist der Unterschied von Rauschen zu unterscheiden.** Auf dieser Datenmenge lässt sich ' +
        'nicht sagen, dass `hybrid-v1` die Mean Map schlägt.',
    )
  } else {
    const holds = METRIC_IDS.filter((_, index) => verdicts[index].holds).map((id) => METRIC_LABELS[id])
    const fails = METRIC_IDS.filter((_, index) => !verdicts[index].holds).map((id) => METRIC_LABELS[id])
    lines.push(
      `**Gemischt:** In ${holds.join(', ')} ist der Unterschied belastbar, in ${fails.join(', ')} nicht. ` +
        'Für S-2 zählt die schwächste Metrik — die Schwelle verlangt alle vier.',
    )
  }
  lines.push('')

  return lines.join('\n')
}

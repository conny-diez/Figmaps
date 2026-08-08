/**
 * A-5 — the Markdown report.
 *
 * Reads as a decision document, not as a log: the engine-vs-center-bias verdict
 * (S-2) is stated in words at the top, before any table.
 */
import { METRIC_DIRECTION, METRIC_IDS, METRIC_LABELS, type MetricScores } from './metrics/types'
import type { EvalSample } from './dataset'
import type { PredictorResult, SampleResult } from './runner'

export type ReportInput = {
  setName: string
  split: string
  generatedAt: string
  samples: readonly EvalSample[]
  results: readonly PredictorResult[]
  worst: readonly SampleResult[]
  contactSheetPath?: string
  notes?: string[]
}

function fmt(value: number): string {
  if (!Number.isFinite(value)) return '—'
  return value.toFixed(3)
}

/**
 * Direction-adjusted difference: positive always means "better than the
 * reference", including for KL where the raw difference points the other way.
 */
function delta(value: number, reference: number, direction: 1 | -1): string {
  if (!Number.isFinite(value) || !Number.isFinite(reference)) return '—'
  const improvement = (value - reference) * direction
  return `${improvement > 0 ? '+' : ''}${improvement.toFixed(3)}`
}

function row(label: string, scores: MetricScores): string {
  return `| ${label} | ${METRIC_IDS.map((id) => fmt(scores[id])).join(' | ')} |`
}

export function buildReport(input: ReportInput): string {
  const centerBias = input.results.find((entry) => entry.predictor.id === 'center-bias')
  const frozen = input.results.find((entry) => entry.predictor.id === 'heuristic-v1:scan')
  const candidates = input.results.filter((entry) => !entry.predictor.baseline)
  const primary = candidates[0] ?? frozen

  const lines: string[] = []

  lines.push(`# FigMaps Eval — ${input.setName} / ${input.split}`)
  lines.push('')
  lines.push(`Erzeugt: ${input.generatedAt} · ${input.samples.length} Bilder`)
  lines.push('')

  // --- S-2, in words, before any table -------------------------------------
  lines.push('## Befund')
  lines.push('')
  if (primary && centerBias) {
    const beatsAll = METRIC_IDS.every((id) => {
      const direction = METRIC_DIRECTION[id]
      return (primary.mean[id] - centerBias.mean[id]) * direction > 0
    })
    const beatsSome = METRIC_IDS.some((id) => (primary.mean[id] - centerBias.mean[id]) * METRIC_DIRECTION[id] > 0)

    if (beatsAll) {
      lines.push(
        `**${primary.predictor.label} schlägt die Center-Bias-Baseline in allen vier Metriken.** ` +
          `Die Feature-Maps tragen messbar zur Vorhersage bei (S-2 erfüllt).`,
      )
    } else if (beatsSome) {
      const losing = METRIC_IDS.filter((id) => (primary.mean[id] - centerBias.mean[id]) * METRIC_DIRECTION[id] <= 0)
      lines.push(
        `**${primary.predictor.label} schlägt die Center-Bias-Baseline nur teilweise** — ` +
          `nicht in ${losing.map((id) => METRIC_LABELS[id]).join(', ')}. ` +
          `S-2 ist damit nicht erfüllt; siehe PRD §8, Risiko 1.`,
      )
    } else {
      lines.push(
        `**${primary.predictor.label} schlägt die Center-Bias-Baseline in keiner Metrik.** ` +
          `Damit tun die sieben Feature-Maps nichts, was eine Gaußglocke in der Bildmitte nicht auch tut. ` +
          `Das ist das Ergebnis dieser Iteration — Konsequenz laut PRD §8: Heuristik verwerfen und in 1.2 ` +
          `direkt auf ein trainiertes Modell gehen.`,
      )
    }
  } else {
    lines.push('_Kein Vergleich möglich — Center-Bias-Baseline fehlt im Lauf._')
  }
  lines.push('')

  // --- Table ---------------------------------------------------------------
  lines.push('## Ergebnisse')
  lines.push('')
  lines.push(`| Engine | ${METRIC_IDS.map((id) => METRIC_LABELS[id]).join(' | ')} |`)
  lines.push(`|---|${METRIC_IDS.map(() => '---:').join('|')}|`)
  for (const entry of input.results) lines.push(row(entry.predictor.label, entry.mean))
  lines.push('')
  lines.push(`Richtung: ${METRIC_IDS.map((id) => `${METRIC_LABELS[id]} ${METRIC_DIRECTION[id] > 0 ? '↑' : '↓'}`).join(' · ')}`)
  lines.push('')

  // --- Deltas against the two references -----------------------------------
  if (centerBias || frozen) {
    lines.push('## Abstand zu den Referenzen')
    lines.push('')
    lines.push(`| Engine | ${METRIC_IDS.map((id) => `Δ ${METRIC_LABELS[id]} vs Center-Bias`).join(' | ')} | Δ AUC vs 1.0 |`)
    lines.push(`|---|${METRIC_IDS.map(() => '---:').join('|')}|---:|`)
    for (const entry of input.results) {
      const vsCenter = METRIC_IDS.map((id) =>
        centerBias ? delta(entry.mean[id], centerBias.mean[id], METRIC_DIRECTION[id]) : '—',
      ).join(' | ')
      const vsFrozen = frozen ? delta(entry.mean.aucJudd, frozen.mean.aucJudd, 1) : '—'
      lines.push(`| ${entry.predictor.label} | ${vsCenter} | ${vsFrozen} |`)
    }
    lines.push('')
    lines.push('_Vorzeichen sind richtungsbereinigt: **+ ist immer besser**, auch bei KL (wo der Rohwert kleiner wird)._')
    lines.push('')
    lines.push('_S-3 verlangt mindestens +0,040 AUC gegenüber der 1.0-Baseline._')
    lines.push('')
  }

  // --- Contact sheet -------------------------------------------------------
  if (input.worst.length > 0 && primary) {
    lines.push('## Kontaktbogen — die schlechtesten Fälle')
    lines.push('')
    if (input.contactSheetPath) {
      lines.push(`![Kontaktbogen](${input.contactSheetPath})`)
      lines.push('')
      lines.push('Spalten: Original · Ground Truth · Vorhersage. Zeilen in der Reihenfolge der Tabelle.')
      lines.push('')
    }
    lines.push(`| # | Bild | ${METRIC_IDS.map((id) => METRIC_LABELS[id]).join(' | ')} |`)
    lines.push(`|---:|---|${METRIC_IDS.map(() => '---:').join('|')}|`)
    input.worst.forEach((entry, index) => {
      lines.push(`| ${index + 1} | \`${entry.sampleId}\` | ${METRIC_IDS.map((id) => fmt(entry.scores[id])).join(' | ')} |`)
    })
    lines.push('')
  }

  // --- Caveats -------------------------------------------------------------
  const withSignals = input.samples.filter((sample) => sample.hasSignals).length
  lines.push('## Einordnung')
  lines.push('')
  lines.push(
    `- Struktur-Signale (Layer-Baum) lagen für ${withSignals} von ${input.samples.length} Bildern vor.` +
      (withSignals < input.samples.length
        ? ' Für die übrigen sind `textSalience`, `interactiveSalience` und `imageSalience` konstant null —' +
          ' gemessen werden dort nur die Pixel-Features und der Positions-Prior. Drei der sieben Feature-Maps' +
          ' gehen dann gar nicht in die Zahl ein.'
        : ''),
  )
  lines.push('- Die Bilder werden vor jedem Vergleich auf dasselbe Analyse-Raster gebracht; Metriken sehen nie unterschiedliche Auflösungen.')
  lines.push('- Vorhersage und Ground Truth sind Verteilungen, keine Messwerte pro Pixel. Ein CC von 0,5 ist für Saliency ein guter Wert, kein halber.')
  for (const note of input.notes ?? []) lines.push(`- ${note}`)
  lines.push('')

  return lines.join('\n')
}

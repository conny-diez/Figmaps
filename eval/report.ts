/**
 * A-5 — the Markdown report.
 *
 * Reads as a decision document, not as a log: the engine-vs-center-bias verdict
 * (S-2) is stated in words at the top, before any table, and every caveat that
 * limits how far the number carries is stated with it rather than in a footnote.
 */
import { ENGINE_CONFIG } from '../src/engine/config'
import { resolveParams } from '../src/engine/params'
import type { DatasetIndex, EvalSample } from './dataset'
import {
  METRIC_DIRECTION,
  METRIC_IDS,
  METRIC_LABELS,
  METRIC_TRUTH,
  type MetricScores,
} from './metrics/types'
import {
  bestOfSweep,
  type PredictorResult,
  type SampleResult,
  type SigmaSweepEntry,
  type SpatialProfile,
} from './runner'

/**
 * The S-2 threshold, mirrored from `eval/fixtures/README.md`.
 * Keep the two in sync — the README is what a human reads before deciding.
 */
export const S2_RULE =
  'Die Engine muss die stärkste bildunabhängige Baseline in allen vier Metriken schlagen — ' +
  'Center-Bias in seiner besten Breite und die Mean Map (Ø Ground Truth des Tuning-Splits).'
/** S-3, for the tuning iteration that follows. */
export const S3_MIN_AUC_GAIN = 0.04

export type UniformCheck = {
  ran: boolean
  passed: boolean
  scores?: MetricScores
  problems: string[]
}

export type ReportInput = {
  setName: string
  split: string
  duration: number
  generatedAt: string
  samples: readonly EvalSample[]
  results: readonly PredictorResult[]
  worst: readonly SampleResult[]
  index?: DatasetIndex
  uniformCheck?: UniformCheck
  /** Center-bias at several widths — the verdict is stated against the best. */
  centerBiasSweep?: readonly SigmaSweepEntry[]
  /** Where ground truth and prediction put their mass (per UI type). */
  positionBias?: { truth: SpatialProfile; prediction?: SpatialProfile }
  contactSheetPath?: string
  notes?: string[]
}

function fmt(value: number, digits = 3): string {
  if (!Number.isFinite(value)) return '—'
  return value.toFixed(digits)
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

/** Share of the engine weighting that a bare screenshot cannot exercise. */
function unmeasuredWeightShare(): number {
  const weights = resolveParams().weights
  return weights.textSalience + weights.interactiveSalience + weights.imageSalience
}

export function buildReport(input: ReportInput): string {
  const centerBias = input.results.find((entry) => entry.predictor.id === 'center-bias')
  const meanMap = input.results.find((entry) => entry.predictor.id === 'mean-map')
  const frozen = input.results.find((entry) => entry.predictor.id === 'heuristic-v1:scan')
  const candidates = input.results.filter((entry) => !entry.predictor.baseline)
  const primary = candidates[0] ?? frozen

  const lines: string[] = []

  lines.push(`# Figmaps Eval — ${input.setName} / ${input.split}`)
  lines.push('')
  lines.push(
    `Erzeugt: ${input.generatedAt} · **${input.samples.length} ausgewertete Bilder** · Betrachtungsdauer ${input.duration} s`,
  )
  lines.push('')

  // --- Sanity check first: a broken import invalidates everything below -----
  if (input.uniformCheck?.ran) {
    lines.push('## Sanity-Check')
    lines.push('')
    if (input.uniformCheck.passed) {
      lines.push(
        'Die Uniform-Baseline liefert exakt AUC-Judd 0,5 · CC 0 · NSS 0. ' +
          'Der Import und die Metrik-Implementierung verhalten sich damit wie erwartet.',
      )
    } else {
      lines.push('**Der Sanity-Check ist fehlgeschlagen.** Eine konstante Map muss exakt AUC-Judd 0,5, CC 0 und NSS 0 ergeben.')
      lines.push('')
      for (const problem of input.uniformCheck.problems) lines.push(`- ${problem}`)
      lines.push('')
      lines.push('Das ist ein Befund über den **Import**, nicht über die Engine. Alle Zahlen unten sind ungültig.')
    }
    lines.push('')
  }

  // --- S-2, in words, before any table -------------------------------------
  lines.push('## Befund')
  lines.push('')
  if (primary && centerBias) {
    // The binding reference is the strongest image-independent baseline per
    // metric: the best center-bias width *and* the mean map. A convenient sigma
    // or a missing mean map would make this a straw man.
    const bestCenter = input.centerBiasSweep ? bestOfSweep(input.centerBiasSweep) : centerBias.mean
    const reference = {} as typeof bestCenter
    const bindingBaseline = {} as Record<string, string>
    for (const id of METRIC_IDS) {
      const meanValue = meanMap?.mean[id]
      const meanWins = meanValue !== undefined && Number.isFinite(meanValue) && (meanValue - bestCenter[id]) * METRIC_DIRECTION[id] > 0
      reference[id] = meanWins ? meanValue : bestCenter[id]
      bindingBaseline[id] = meanWins ? 'Mean Map' : 'Center-Bias'
    }

    const better = METRIC_IDS.filter((id) => (primary.mean[id] - reference[id]) * METRIC_DIRECTION[id] > 0)
    const worse = METRIC_IDS.filter((id) => (primary.mean[id] - reference[id]) * METRIC_DIRECTION[id] <= 0)

    lines.push(`_Schwelle (S-2): ${S2_RULE}_`)
    lines.push('')
    if (worse.length === 0) {
      lines.push(
        `**${primary.predictor.label} schlägt jede bildunabhängige Baseline in allen vier Metriken. S-2 ist erfüllt.** ` +
          (meanMap
            ? 'Insbesondere schlägt sie die Mean Map — die Engine sagt also mehr vorher als „wo auf dieser Art von ' +
              'Screen üblicherweise Dinge stehen". Sie reagiert auf den konkreten Screen.'
            : 'Die Feature-Maps tragen messbar zur Vorhersage bei — sie sind keine Dekoration.'),
      )
    } else if (better.length > 0) {
      lines.push(
        `**${primary.predictor.label} schlägt die stärkste Baseline nur teilweise — S-2 ist nicht erfüllt.** ` +
          `Besser in ${better.map((id) => METRIC_LABELS[id]).join(', ')}, ` +
          `nicht besser in ${worse.map((id) => `${METRIC_LABELS[id]} (bindend: ${bindingBaseline[id]})`).join(', ')}. ` +
          'Siehe PRD §8, Risiko 1.',
      )
    } else {
      const beatsCenter = centerBias
        ? METRIC_IDS.filter((id) => (primary.mean[id] - bestCenter[id]) * METRIC_DIRECTION[id] > 0)
        : []
      lines.push(
        `**${primary.predictor.label} schlägt die stärkste bildunabhängige Baseline in keiner Metrik. ` +
          'S-2 ist nicht erfüllt.**' +
          (beatsCenter.length > 0
            ? ` Den Center-Bias schlägt sie zwar (in ${beatsCenter.map((id) => METRIC_LABELS[id]).join(', ')}), ` +
              'die Mean Map jedoch nicht — und die ist die aussagekräftigere Referenz.'
            : ''),
      )
      lines.push('')
      lines.push(
        'Konsequenz laut PRD §8: Die Heuristik in ihrer jetzigen Form trägt zu wenig eigene Information. ' +
          'Statt sie weiter von Hand zu justieren, ist der Schritt auf ein trainiertes Modell (Iteration 1.2) ' +
          'der billigere Weg — und mit diesem Harness ist er jetzt belegbar statt Glaubenssache.',
      )
    }

    // The mean map deserves its own sentence: it is the one that decides
    // whether the engine reads the screen or merely the genre.
    if (meanMap) {
      const vsMean = METRIC_IDS.filter((id) => (primary.mean[id] - meanMap.mean[id]) * METRIC_DIRECTION[id] > 0)
      const lostToMean = METRIC_IDS.filter((id) => (primary.mean[id] - meanMap.mean[id]) * METRIC_DIRECTION[id] <= 0)
      lines.push('')
      if (lostToMean.length === 0) {
        lines.push(
          `Gegen die **Mean Map** — den Durchschnitt der Ground Truth über den Tuning-Split, ohne Blick auf das ` +
            `jeweilige Bild — gewinnt ${primary.predictor.label} in allen vier Metriken. Das ist der eigentliche ` +
            'Beleg: die Vorhersage enthält bildspezifische Information und nicht nur den Ortsdurchschnitt des Genres.',
        )
      } else {
        lines.push(
          `**Achtung:** Gegen die **Mean Map** verliert ${primary.predictor.label} in ` +
            `${lostToMean.map((id) => METRIC_LABELS[id]).join(', ')}` +
            (vsMean.length > 0 ? ` und gewinnt nur in ${vsMean.map((id) => METRIC_LABELS[id]).join(', ')}` : '') +
            '. Die Mean Map sieht das konkrete Bild nie an — sie kennt nur, wo auf dieser Art von Screen ' +
            'üblicherweise Dinge stehen. Soweit die Engine sie nicht schlägt, sagt auch die Engine überwiegend ' +
            'genau das vorher und nicht, was in diesem konkreten Screen passiert.',
        )
      }
    }

    if (input.centerBiasSweep) {
      lines.push('')
      lines.push(
        '_Verglichen wurde gegen den **besten** Center-Bias je Metrik über alle geprüften Breiten ' +
          `(σ ${input.centerBiasSweep.map((entry) => entry.sigma).join(', ')}), nicht gegen die Standardbreite. ` +
          'Siehe „Robustheit der Baseline"._',
      )
    }
    lines.push('')
    lines.push(
      'Dieser Befund gilt unter dem Vorbehalt der Teilmessung weiter unten — ' +
        `rund ${Math.round(unmeasuredWeightShare() * 100)} % der Engine-Gewichtung sind hier gar nicht bewertet.`,
    )
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
  lines.push(
    '> **Diese Zahlen gelten für einzelne Viewport-Ausschnitte.** Alle Läufe verwenden `segment: false`; die ' +
      'Referenzbilder sind Einzel-Screenshots. Für **segmentierte Frames** (Epic B, ab 1,5 Viewport-Höhen) ist ' +
      'nichts davon gemessen: dort wird der Ortsprior je Abschnitt neu gebildet und mit der Scrolltiefe gedämpft, ' +
      'und UEyes enthält keine gescrollten Seiten, an denen sich das prüfen ließe.',
  )
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

    if (meanMap) {
      lines.push('Gegen die Mean Map — die härtere Referenz:')
      lines.push('')
      lines.push(`| Engine | ${METRIC_IDS.map((id) => `Δ ${METRIC_LABELS[id]} vs Mean Map`).join(' | ')} |`)
      lines.push(`|---|${METRIC_IDS.map(() => '---:').join('|')}|`)
      for (const entry of input.results) {
        if (entry.predictor.id === 'mean-map') continue
        lines.push(
          `| ${entry.predictor.label} | ${METRIC_IDS.map((id) => delta(entry.mean[id], meanMap.mean[id], METRIC_DIRECTION[id])).join(' | ')} |`,
        )
      }
      lines.push('')

      // A mean over 27 images hides whether the engine is uniformly worse or
      // better on some screens and much worse on others. The first would mean
      // "no image-specific signal", the second "signal, but noisy".
      if (primary && primary.predictor.id !== 'mean-map') {
        const wins = {} as Record<string, number>
        const byId = new Map(meanMap.perSample.map((entry) => [entry.sampleId, entry.scores]))
        for (const id of METRIC_IDS) {
          wins[id] = primary.perSample.filter((entry) => {
            const against = byId.get(entry.sampleId)
            if (!against || !Number.isFinite(entry.scores[id]) || !Number.isFinite(against[id])) return false
            return (entry.scores[id] - against[id]) * METRIC_DIRECTION[id] > 0
          }).length
        }
        const total = primary.perSample.length
        lines.push(
          `Pro Bild betrachtet gewinnt ${primary.predictor.label} gegen die Mean Map in ` +
            `${METRIC_IDS.map((id) => `${METRIC_LABELS[id]} ${wins[id]}/${total}`).join(', ')}.`,
        )
        lines.push('')
        lines.push(
          '_Ein Mittelwert allein verbirgt, ob die Engine überall gleichmäßig schlechter ist (dann enthält sie ' +
            'keine bildspezifische Information) oder auf manchen Screens besser und auf anderen deutlich ' +
            'schlechter (dann enthält sie Signal, aber verrauschtes)._',
        )
        lines.push('')
      }
    }
    lines.push('_Vorzeichen sind richtungsbereinigt: **+ ist immer besser**, auch bei KL (wo der Rohwert kleiner wird)._')
    lines.push('')
    lines.push(`_S-3 verlangt mindestens +${S3_MIN_AUC_GAIN.toFixed(3)} AUC gegenüber der 1.0-Baseline. Diese Iteration tunt nicht._`)
    lines.push('')
  }

  // --- Position bias -------------------------------------------------------
  if (input.positionBias) {
    const { truth, prediction } = input.positionBias
    const prior = resolveParams().prior

    lines.push('## Positions-Bias')
    lines.push('')
    lines.push(
      'Wo die Aufmerksamkeit im Bild liegt, in normierten Koordinaten — (0,0) ist oben links, (0,5 / 0,5) die Mitte. ' +
        'UEyes zeigt, dass sich dieser Bias zwischen UI-Typen unterscheidet; deshalb steht er hier pro Set und wird ' +
        'nicht über Typen gemittelt.',
    )
    lines.push('')
    lines.push('| | Schwerpunkt x | Schwerpunkt y | Streuung x | Streuung y | Masse im oberen Drittel |')
    lines.push('|---|---:|---:|---:|---:|---:|')
    lines.push(
      `| Ground Truth | ${fmt(truth.centerX, 3)} | ${fmt(truth.centerY, 3)} | ${fmt(truth.spreadX, 3)} | ${fmt(truth.spreadY, 3)} | ${fmt(truth.topThird * 100, 1)} % |`,
    )
    if (prediction) {
      lines.push(
        `| Vorhersage | ${fmt(prediction.centerX, 3)} | ${fmt(prediction.centerY, 3)} | ${fmt(prediction.spreadX, 3)} | ${fmt(prediction.spreadY, 3)} | ${fmt(prediction.topThird * 100, 1)} % |`,
      )
    }
    lines.push(`| Positions-Prior der Engine | ${fmt(prior.centerX, 3)} | ${fmt(prior.centerY, 3)} | — | — | — |`)
    lines.push('| Center-Bias | 0.500 | 0.500 | — | — | 21.5 % |')
    lines.push('')

    if (prediction) {
      const dy = truth.centerY - prediction.centerY
      const spreadRatio = prediction.spreadY > 0 ? truth.spreadY / prediction.spreadY : Number.NaN
      lines.push(
        `Die Vorhersage liegt vertikal ${Math.abs(dy) < 0.02 ? 'praktisch deckungsgleich mit' : dy < 0 ? `${fmt(Math.abs(dy) * 100, 1)} % der Bildhöhe **über**` : `${fmt(dy * 100, 1)} % der Bildhöhe **unter**`} ` +
          'der gemessenen Aufmerksamkeit.' +
          (Number.isFinite(spreadRatio)
            ? ` Die gemessene Aufmerksamkeit ist vertikal um Faktor ${fmt(1 / spreadRatio, 2)} ${spreadRatio < 1 ? 'breiter' : 'enger'} verteilt als die Vorhersage.`
            : ''),
      )
      lines.push('')
      lines.push(
        '_Der Positions-Prior der Engine ist derselbe für alle UI-Typen (`ENGINE_CONFIG.prior`). ' +
          'Getrennte Priors für Mobile und Desktop stehen als Punkt in PRD §9 für Iteration 1.2 — ' +
          'die Zahlen hier sind die Grundlage dafür._',
      )
      lines.push('')
    }
  }

  // --- Baseline robustness -------------------------------------------------
  if (input.centerBiasSweep && input.centerBiasSweep.length > 1) {
    const best = bestOfSweep(input.centerBiasSweep)
    lines.push('## Robustheit der Baseline')
    lines.push('')
    lines.push(
      'Die Breite der Center-Bias-Gaußglocke ist ein freier Parameter. Damit der wichtigste Vergleich der ' +
        'Iteration nicht an einer bequemen Wahl hängt, läuft die Baseline über mehrere Breiten.',
    )
    lines.push('')
    lines.push(`| σ | ${METRIC_IDS.map((id) => METRIC_LABELS[id]).join(' | ')} |`)
    lines.push(`|---:|${METRIC_IDS.map(() => '---:').join('|')}|`)
    for (const entry of input.centerBiasSweep) {
      lines.push(`| ${entry.sigma.toFixed(2)} | ${METRIC_IDS.map((id) => fmt(entry.mean[id])).join(' | ')} |`)
    }
    lines.push(`| **bester Wert** | ${METRIC_IDS.map((id) => `**${fmt(best[id])}**`).join(' | ')} |`)
    lines.push('')
    lines.push(
      '_AUC-Judd ist über alle Breiten identisch: die Metrik ist rangbasiert, und eine radialsymmetrische ' +
        'Gaußglocke erzeugt für jede Breite dieselbe Rangfolge der Pixel._',
    )
    lines.push('')
  }

  // --- Method --------------------------------------------------------------
  const grids = input.samples.map((sample) => sample.grid)
  const widths = grids.map((grid) => grid.width)
  const heights = grids.map((grid) => grid.height)
  const measured = input.samples.filter((sample) => sample.truth.fixationSource === 'measured').length

  lines.push('## Methode')
  lines.push('')
  lines.push('### Welche Metrik gegen welche Ground Truth')
  lines.push('')
  lines.push('| Metrik | Ground Truth | Quelle |')
  lines.push('|---|---|---|')
  for (const id of METRIC_IDS) {
    const truth = METRIC_TRUTH[id]
    lines.push(
      `| ${METRIC_LABELS[id]} | ${truth === 'fixations' ? 'diskrete Fixationen' : 'kontinuierliche Verteilung'} | ` +
        `\`${truth === 'fixations' ? `fixmaps/${input.duration}s` : `heatmaps/${input.duration}s`}\` |`,
    )
  }
  lines.push('')
  lines.push(
    'Die beiden Kanäle werden nicht vermischt: AUC-Judd und NSS brauchen Punkte, CC und KL eine Verteilung. ' +
      'Fixationen aus der Heatmap abzuleiten würde beide Seiten aus derselben Quelle speisen und die Zahlen still beschönigen.',
  )
  lines.push('')
  lines.push(
    `Fixationen aus gemessenen Fixation-Maps: **${measured} von ${input.samples.length}** Bildern` +
      (measured < input.samples.length ? ' — der Rest ist aus der Heatmap abgeleitet und nicht vergleichbar.' : '.'),
  )
  lines.push('')

  lines.push('### Gemeinsame Auflösung')
  lines.push('')
  lines.push(
    `Vorhersage und Ground Truth werden vor jedem Vergleich auf **das Analyse-Raster der Engine** gebracht: ` +
      `längere Kante ${ENGINE_CONFIG.analysisEdge} px, Seitenverhältnis erhalten ` +
      `(hier ${Math.min(...widths)}–${Math.max(...widths)} × ${Math.min(...heights)}–${Math.max(...heights)} px). ` +
      'Die Vorhersage wird dabei nie hochskaliert — verglichen wird auf der Auflösung, auf der die Engine tatsächlich rechnet.',
  )
  lines.push('')
  lines.push(
    '- Die kontinuierliche Ground Truth wird flächengemittelt herunterskaliert.\n' +
      '- Die Fixation-Map wird **max-gepoolt**, nie gemittelt: eine Rasterzelle gilt als fixiert, wenn irgendein ' +
      'Quellpixel darin fixiert war. Mitteln würde Graustufen erzeugen, deren Schwellwert stillschweigend ' +
      'entscheidet, wie viele Fixationen die Metriken sehen.',
  )
  lines.push('')

  // --- The caveat that limits the whole report -----------------------------
  const withSignals = input.samples.filter((sample) => sample.hasSignals).length
  const share = Math.round(unmeasuredWeightShare() * 100)

  lines.push('## Einordnung — dies ist eine TEILMESSUNG')
  lines.push('')
  if (withSignals < input.samples.length) {
    lines.push(
      `**Für ${input.samples.length - withSignals} von ${input.samples.length} Bildern liegen keine Struktur-Signale vor.** ` +
        'Ein Screenshot bringt keinen Layer-Baum mit, deshalb sind `textSalience`, `interactiveSalience` und ' +
        `\`imageSalience\` dort konstant null. Das sind **${share} % der Engine-Gewichtung**, die hier nicht bewertet werden — ` +
        `gemessen sind nur Luminanz-Kontrast, Farb-Opponenz, Kantendichte und der Positions-Prior (${100 - share} %).`,
    )
    lines.push('')
    lines.push(
      'Konsequenz für die Lesart: Der Befund oben gilt für die Pixel-Hälfte der Engine. ' +
        'Ob die Struktur-Signale tragen, ist mit diesem Datensatz grundsätzlich nicht beantwortbar — ' +
        'dafür braucht es Screens mit Layer-Baum, also das eigene Validierungsset aus First-Click-Tests.',
    )
  } else {
    lines.push(`Struktur-Signale lagen für alle ${input.samples.length} Bilder vor.`)
  }
  lines.push('')
  lines.push(
    '- Vorhersage und Ground Truth sind Verteilungen, keine Messwerte pro Pixel. ' +
      'Ein CC von 0,5 ist für Saliency ein guter Wert, kein halber.',
  )
  if (input.samples.length < 40) {
    lines.push(
      `- Der Split umfasst nur ${input.samples.length} Bilder. Das ist die Aufteilung des Datensatzes, nicht unsere — ` +
        'aber Mittelwerte darüber schwanken entsprechend stark.',
    )
  }
  for (const note of input.notes ?? []) lines.push(`- ${note}`)
  lines.push('')

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

  // --- Attribution ---------------------------------------------------------
  if (input.index?.citation || input.index?.license) {
    lines.push('## Datensatz')
    lines.push('')
    if (input.index.name) lines.push(`**${input.index.name}**`)
    if (input.index.license) lines.push(`Lizenz: ${input.index.license}`)
    lines.push('')
    for (const note of input.index.notes ?? []) lines.push(`- ${note}`)
    if ((input.index.notes ?? []).length > 0) lines.push('')
    if (input.index.citation) {
      lines.push('> ' + input.index.citation)
      lines.push('')
    }
  }

  return lines.join('\n')
}

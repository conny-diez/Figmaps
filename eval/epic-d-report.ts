/**
 * Markdown für die Epic-D-Messung.
 *
 * Beantwortet genau eine Frage: Unterscheiden sich 1 s, 3 s und 7 s so, dass
 * drei Profile gerechtfertigt sind — oder tun drei Schalter dasselbe?
 */
import { DURATIONS, REFERENCE_DURATION, type EpicDResult } from './epic-d'
import { METRIC_IDS, METRIC_LABELS } from './metrics/types'

function fmt(value: number, digits = 4): string {
  return Number.isFinite(value) ? value.toFixed(digits) : '—'
}

function signed(value: number, digits = 4): string {
  if (!Number.isFinite(value)) return '—'
  return `${value >= 0 ? '+' : ''}${value.toFixed(digits)}`
}

export function buildEpicDReport(result: EpicDResult, generatedAt: string): string {
  const lines: string[] = []

  lines.push(`# Epic D — ist Betrachtungsdauer ein Prior-Effekt?`)
  lines.push('')
  lines.push(
    `${result.setName}, ${result.imageCount} Bilder, ${result.folds} Folds. Erzeugt: ${generatedAt}`,
  )
  lines.push('')
  lines.push(
    'Hypothese: Betrachtungsdauer verschiebt vor allem, **wo** der Blick liegt, nicht wie stark einzelne ' +
      'Bildmerkmale zählen. Also wird je ein Ortsprior aus der Ground Truth für 1 s, 3 s und 7 s geschätzt und ' +
      'gegen die anderen beiden getestet. Alle Prioren entstehen pro Fold aus den übrigen vier Folds, inklusive ' +
      '8-Bit-Quantisierung — jede Bewertung ist out-of-sample.',
  )
  lines.push('')

  // --- how different are the priors at all? --------------------------------
  lines.push('## Wie verschieden sind die drei Prioren überhaupt?')
  lines.push('')
  lines.push('| Paar | CC |')
  lines.push('|---|---:|')
  for (const entry of result.priorSimilarity) {
    lines.push(`| ${entry.a} s ↔ ${entry.b} s | ${fmt(entry.cc)} |`)
  }
  lines.push('')
  const minSimilarity = Math.min(...result.priorSimilarity.map((entry) => entry.cc))
  lines.push(
    minSimilarity > 0.99
      ? `Die Prioren sind praktisch identisch (kleinstes CC ${fmt(minSimilarity)}). Schon das lässt kaum Raum für ` +
          'einen Dauer-Effekt.'
      : `Kleinstes CC zwischen zwei Prioren: ${fmt(minSimilarity)} — sie unterscheiden sich messbar in der Form.`,
  )
  lines.push('')

  // --- the matrix ----------------------------------------------------------
  lines.push('## Kreuztabelle')
  lines.push('')
  lines.push(
    'Zeile = Dauer der Ground Truth, Spalte = Dauer, aus der der Prior geschätzt wurde. Die Diagonale ist die ' +
      '„passende" Kombination.',
  )
  lines.push('')

  for (const metric of METRIC_IDS) {
    lines.push(`### ${METRIC_LABELS[metric]}`)
    lines.push('')
    lines.push(`| Ground Truth | ${DURATIONS.map((d) => `${d} s-Prior`).join(' | ')} |`)
    lines.push(`|---|${DURATIONS.map(() => '---:').join('|')}|`)
    for (const truth of DURATIONS) {
      const cells = DURATIONS.map((prior) => {
        const cell = result.cells.find((entry) => entry.truth === truth && entry.prior === prior)!
        const value = fmt(cell.mean[metric])
        return truth === prior ? `**${value}**` : value
      }).join(' | ')
      lines.push(`| ${truth} s | ${cells} |`)
    }
    lines.push('')
  }

  // --- the paired test -----------------------------------------------------
  lines.push('## Gepaarter Vergleich gegen den ausgelieferten Prior')
  lines.push('')
  lines.push(
    `Je Bild die Differenz zum ${REFERENCE_DURATION} s-Prior, richtungsbereinigt (**+ ist besser**). Die Zeilen ` +
      'mit passender Dauer sind die entscheidenden — dort müsste ein Dauer-Effekt sichtbar werden.',
  )
  lines.push('')
  lines.push('| Ground Truth | Prior | Metrik | Δ | 95-%-Intervall | t | besser auf | |')
  lines.push('|---|---|---|---:|---|---:|---:|---|')
  for (const entry of result.comparisons) {
    const matching = entry.truth === entry.prior
    const verdict = entry.ci95[0] > 0 ? 'belastbar besser' : entry.ci95[1] < 0 ? 'belastbar schlechter' : 'nicht unterscheidbar'
    lines.push(
      `| ${matching ? `**${entry.truth} s**` : `${entry.truth} s`} | ${entry.prior} s | ${METRIC_LABELS[entry.metric]} | ` +
        `${signed(entry.mean)} | [${fmt(entry.ci95[0])}, ${fmt(entry.ci95[1])}] | ${fmt(entry.tStatistic, 1)} | ` +
        `${(entry.winRate * 100).toFixed(1)} % | ${verdict} |`,
    )
  }
  lines.push('')

  // --- decision ------------------------------------------------------------
  lines.push('## Entscheidung')
  lines.push('')
  const matching = result.comparisons.filter((entry) => entry.truth === entry.prior && entry.metric === 'cc')
  for (const entry of matching) {
    const verdict = entry.ci95[0] > 0 ? 'schlägt' : 'schlägt **nicht**'
    lines.push(
      `- Auf ${entry.truth} s-Ground-Truth ${verdict} der ${entry.prior} s-Prior den ${REFERENCE_DURATION} s-Prior ` +
        `(CC ${signed(entry.mean)}, Intervall [${fmt(entry.ci95[0])}, ${fmt(entry.ci95[1])}]).`,
    )
  }
  lines.push('')

  if (result.durationMatters) {
    lines.push(
      '**Es gibt einen Dauer-Effekt.** Ein Prior, der zur Betrachtungsdauer passt, sagt die Aufmerksamkeit dieser ' +
        'Dauer besser vorher als der ausgelieferte. Drei Profile sind damit belegt und können ausgeliefert werden.',
    )
  } else {
    lines.push(
      '**Es gibt keinen belegbaren Dauer-Effekt.** Kein dauerspezifischer Prior schlägt den ' +
        `${REFERENCE_DURATION} s-Prior auf seiner eigenen Ground Truth. Die drei Profile würden praktisch dieselbe ` +
        'Vorhersage liefern.',
    )
    lines.push('')
    lines.push(
      '**Konsequenz: Epic D wird gestrichen.** Drei Schalter anzubieten, die dasselbe tun, ist schlechter als ' +
        'einer: sie suggerieren eine Kalibrierung, die es nicht gibt, und jede Auswahl daraus wäre eine ' +
        'Scheinentscheidung. Das PRD hat diesen Ausgang vorgesehen — „Wenn ein Profil die Center-Bias-Baseline ' +
        'nicht schlägt, wird es nicht ausgeliefert."',
    )
    lines.push('')
    lines.push(
      '_Was das **nicht** heißt: dass Betrachtungsdauer keine Rolle spielt. Es heißt, dass sie sich in einem ' +
        'gemittelten Ortsprior über diesen Datensatz nicht niederschlägt. Ein Modell mit mehr Kapazität könnte den ' +
        'Unterschied durchaus finden._',
    )
  }
  lines.push('')

  return lines.join('\n')
}

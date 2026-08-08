/**
 * Markdown für die Diagnose-Läufe. Keine Abnahmezahlen — der Report sagt das
 * in der ersten Zeile.
 */
import { METRIC_DIRECTION, METRIC_IDS, METRIC_LABELS, type MetricScores } from './metrics/types'
import { REQUESTED_ALPHA_MAX, type DiagnoseResult } from './diagnose'

function fmt(value: number, digits = 3): string {
  return Number.isFinite(value) ? value.toFixed(digits) : '—'
}

function cells(scores: MetricScores): string {
  return METRIC_IDS.map((id) => fmt(scores[id])).join(' | ')
}

/** Gap closed towards the mean map, in percent, per metric. */
function gapClosed(value: number, from: number, to: number, metric: keyof MetricScores): string {
  const total = (to - from) * METRIC_DIRECTION[metric]
  if (Math.abs(total) < 1e-9) return '—'
  const covered = (value - from) * METRIC_DIRECTION[metric]
  return `${Math.round((covered / total) * 100)} %`
}

export function buildDiagnoseReport(result: DiagnoseResult, generatedAt: string, contactSheet?: string): string {
  const lines: string[] = []
  const { engineV1, meanMapAlone } = result

  lines.push(`# Diagnose — ${result.setName} / ${result.split}`)
  lines.push('')
  lines.push(
    `> **Keine Abnahmezahlen.** Zwei Diagnose-Versuche, ausschließlich auf dem **Tuning-Split** ` +
      `(${result.sampleCount} Bilder, ${result.duration} s). Der Test-Split bleibt unberührt, es wurde nichts ` +
      'getunt und keine Konfiguration erzeugt.',
  )
  lines.push('')
  lines.push(`Erzeugt: ${generatedAt}`)
  lines.push('')
  lines.push(
    'Die Mean Map ist hier **leave-one-out** gebildet: das jeweils bewertete Bild fließt nicht in seine eigene ' +
      'Baseline ein. Sonst wäre der Vergleich auf demselben Split, aus dem die Baseline entsteht, zu ihren ' +
      'Gunsten verzerrt.',
  )
  lines.push('')

  lines.push('## Referenzen auf denselben Bildern')
  lines.push('')
  lines.push(`| | ${METRIC_IDS.map((id) => METRIC_LABELS[id]).join(' | ')} |`)
  lines.push(`|---|${METRIC_IDS.map(() => '---:').join('|')}|`)
  lines.push(`| FigMaps 1.0 | ${cells(engineV1)} |`)
  lines.push(`| Mean Map (leave-one-out) | ${cells(meanMapAlone)} |`)
  lines.push('')

  // --- Versuch 1 -----------------------------------------------------------
  lines.push('## Versuch 1 — wie viel erklärt allein die Prior-Gewichtung?')
  lines.push('')
  lines.push(
    'Der Positions-Prior wird von 0,1 auf 0,9 hochgezogen, die sechs übrigen Feature-Gewichte anteilig ' +
      'heruntergefahren. Die Zeile bei 0,1 entspricht der ausgelieferten Konfiguration.',
  )
  lines.push('')
  lines.push(`| Prior-Gewicht | ${METRIC_IDS.map((id) => METRIC_LABELS[id]).join(' | ')} | Lücke zur Mean Map (CC) |`)
  lines.push(`|---:|${METRIC_IDS.map(() => '---:').join('|')}|---:|`)
  for (const entry of result.priorSweep) {
    lines.push(
      `| ${entry.weight.toFixed(1)} | ${cells(entry.mean)} | ${gapClosed(entry.mean.cc, engineV1.cc, meanMapAlone.cc, 'cc')} |`,
    )
  }
  lines.push('')

  const best = [...result.priorSweep].sort((a, b) => b.mean.cc - a.mean.cc)[0]
  const closed = (best.mean.cc - engineV1.cc) / (meanMapAlone.cc - engineV1.cc)
  lines.push(
    `Bester Punkt der Kurve: Prior-Gewicht **${best.weight.toFixed(1)}** mit CC ${fmt(best.mean.cc)} ` +
      `(FigMaps 1.0: ${fmt(engineV1.cc)}, Mean Map: ${fmt(meanMapAlone.cc)}). ` +
      `Das schließt **${Math.round(closed * 100)} %** der Lücke zur Mean Map.`,
  )
  lines.push('')
  lines.push(
    closed > 0.8
      ? '**Lesart: Die Pixel-Features tragen praktisch nichts.** Fast die gesamte Vorhersagekraft der Engine ' +
          'steckt in der Positionsannahme; sie hochzuziehen genügt, um die Mean Map fast einzuholen.'
      : closed > 0.4
        ? '**Lesart: Der Prior trägt den größeren Teil**, schließt die Lücke aber nicht allein. Ein Rest bleibt, ' +
            'den ein reiner Ortsprior nicht erklärt.'
        : '**Lesart: Ein stärkerer Prior allein schließt die Lücke nicht.** Der Abstand zur Mean Map hat eine ' +
            'andere Ursache als die Gewichtung zwischen Ort und Bild.',
  )
  lines.push('')

  // --- Versuch 2 -----------------------------------------------------------
  lines.push('## Versuch 2 — trägt die Bildanalyse screen-spezifisches Signal?')
  lines.push('')
  lines.push(
    'Mean Map als Basis, Bildanalyse additiv mit kleinem Gewicht α obendrauf. Beide Terme vorher auf `[0,1]` ' +
      'normiert. α = 0 ist exakt die Mean Map.',
  )
  lines.push('')

  for (const [title, sweep, what] of [
    ['Nur Pixel-Features (Luminanz, Farbe, Kanten)', result.hybridPixel, 'Pixel-Features'],
    ['Vollständige FigMaps-1.0-Vorhersage', result.hybridEngine, 'FigMaps 1.0'],
  ] as const) {
    lines.push(`### ${title}`)
    lines.push('')
    lines.push(`| α | ${METRIC_IDS.map((id) => METRIC_LABELS[id]).join(' | ')} | besser als Mean Map? |`)
    lines.push(`|---:|${METRIC_IDS.map(() => '---:').join('|')}|---|`)
    lines.push(`| 0 (Mean Map) | ${cells(meanMapAlone)} | — |`)
    for (const entry of sweep) {
      const wins = METRIC_IDS.filter((id) => (entry.mean[id] - meanMapAlone[id]) * METRIC_DIRECTION[id] > 0)
      const marker = entry.alpha > REQUESTED_ALPHA_MAX ? ' ‡' : ''
      lines.push(
        `| ${entry.alpha.toFixed(2)}${marker} | ${cells(entry.mean)} | ${wins.length === 0 ? 'nein' : `${wins.map((id) => METRIC_LABELS[id]).join(', ')}`} |`,
      )
    }
    lines.push('')
    lines.push(
      `‡ jenseits des angefragten Bereichs (α ≤ ${REQUESTED_ALPHA_MAX}) — ergänzt, weil die Kurve dort noch stieg. ` +
        'Kein Vorschlag für die ausgelieferte Konfiguration.',
    )
    lines.push('')

    const bestAlpha = [...sweep].sort((a, b) => b.mean.cc - a.mean.cc)[0]
    const gain = bestAlpha.mean.cc - meanMapAlone.cc
    lines.push(
      gain > 0
        ? `**${what} verbessern die Mean Map** — bestes α = ${bestAlpha.alpha.toFixed(2)} mit CC ${fmt(bestAlpha.mean.cc)}, ` +
            `also **+${fmt(gain)}** gegenüber ${fmt(meanMapAlone.cc)}. Es gibt verwertbares bildspezifisches Signal, ` +
            'und das ist seine Größenordnung.'
        : `**${what} verbessern die Mean Map nicht** — selbst das beste α = ${bestAlpha.alpha.toFixed(2)} bleibt mit ` +
            `CC ${fmt(bestAlpha.mean.cc)} unter ${fmt(meanMapAlone.cc)}. Jede Beimischung verschlechtert die ` +
            'Vorhersage; das ist der Nachweis, dass diese Bildanalyse kein verwertbares Signal beiträgt.',
    )
    lines.push('')
  }

  // --- Versuch 3 -----------------------------------------------------------
  lines.push('## Versuch 3 — wie grob darf die ausgelieferte Prior-Map sein?')
  lines.push('')
  lines.push(
    'Dieselbe Mean Map, auf ein Raster reduziert und wieder hochskaliert. Misst den Verlust durch ein kleines ' +
      'Asset, statt ihn zu schätzen.',
  )
  lines.push('')
  lines.push(`| Raster | Roh-Bytes | ${METRIC_IDS.map((id) => METRIC_LABELS[id]).join(' | ')} |`)
  lines.push(`|---:|---:|${METRIC_IDS.map(() => '---:').join('|')}|`)
  for (const entry of result.priorSizes) {
    const raw = entry.size * entry.size
    lines.push(
      `| ${entry.size}×${entry.size} | ${(raw / 1024).toFixed(1)} kB | ${cells(entry.mean)} |`,
    )
  }
  lines.push('')
  const finest = result.priorSizes[result.priorSizes.length - 1]
  const acceptable = result.priorSizes.filter((entry) => Math.abs(entry.mean.cc - finest.mean.cc) < 0.002)
  if (acceptable.length > 0) {
    lines.push(
      `Ab **${acceptable[0].size}×${acceptable[0].size}** liegt CC innerhalb von 0,002 des feinsten Rasters — ` +
        'ein Ortsprior ist glatt, feinere Raster kodieren nur noch Rauschen.',
    )
    lines.push('')
  }

  // --- Deviation score -----------------------------------------------------
  const { deviation } = result
  lines.push('## Abweichungs-Score als Vertrauensindikator')
  lines.push('')
  lines.push(
    'Der Score ist `1 − CC(Bildanalyse, Prior)`, auf `[0,1]` abgebildet — **ohne Ground Truth berechenbar**, also ' +
      'zur Laufzeit im Plugin verfügbar. Die Frage ist, ob er vorhersagt, wo die Bildanalyse tatsächlich hilft.',
  )
  lines.push('')
  lines.push(
    `Korrelation mit dem tatsächlichen Gewinn (ΔCC): **${fmt(deviation.correlationWithGain)}**, ` +
      `mit „hat überhaupt geholfen": **${fmt(deviation.correlationWithHelped)}**. ` +
      `Insgesamt half die Bildanalyse auf ${fmt(deviation.helpedShare * 100, 1)} % der Screens.`,
  )
  lines.push('')
  lines.push('Nach Quintilen des Scores (gleich große Gruppen, damit die Verteilung nichts verdeckt):')
  lines.push('')
  lines.push('| Abweichungs-Score | Screens | davon geholfen | Ø Gewinn (ΔCC) |')
  lines.push('|---|---:|---:|---:|')
  for (const bucket of deviation.buckets) {
    if (bucket.count === 0) continue
    lines.push(
      `| ${bucket.label} | ${bucket.count} | ${fmt(bucket.helpedShare * 100, 1)} % | ${bucket.meanGain >= 0 ? '+' : ''}${fmt(bucket.meanGain)} |`,
    )
  }
  lines.push('')

  const usable = Math.abs(deviation.correlationWithGain) >= 0.2
  const rising = deviation.buckets.filter((bucket) => bucket.count > 0)
  const monotone =
    rising.length > 1 && rising.every((bucket, index) => index === 0 || bucket.helpedShare >= rising[index - 1].helpedShare - 0.05)
  lines.push(
    usable && monotone
      ? '**Der Score taugt als Vertrauensindikator.** Der Anteil der Screens, auf denen die Bildanalyse hilft, ' +
          'steigt mit dem Score, und der Zusammenhang mit dem tatsächlichen Gewinn ist deutlich genug, um ihn im ' +
          'Panel anzuzeigen — als Aussage über die Vorhersage, nicht über den Screen.'
      : usable
        ? '**Der Score trägt Information, aber nicht monoton.** Als grober Hinweis brauchbar, als Zahl im Panel ' +
            'noch nicht — die Schwellwerte müssten erst sauber gesetzt werden.'
        : '**Der Score taugt nicht als Vertrauensindikator.** Der Zusammenhang mit dem tatsächlichen Gewinn ist zu ' +
            'schwach; ihn anzuzeigen würde Sicherheit suggerieren, die die Zahl nicht hat.',
  )
  lines.push('')

  // --- Winners -------------------------------------------------------------
  lines.push('## Die Screens, auf denen FigMaps die Mean Map schlägt')
  lines.push('')
  lines.push(
    `**${result.winCount} von ${result.sampleCount}** Bildern (${Math.round((result.winCount / result.sampleCount) * 100)} %), ` +
      'gemessen an CC gegen die leave-one-out Mean Map.',
  )
  lines.push('')
  lines.push('| | Gewinner | Verlierer |')
  lines.push('|---|---:|---:|')
  lines.push(`| Anzahl | ${result.winCount} | ${result.sampleCount - result.winCount} |`)
  lines.push(`| Ø Konzentration der Ground Truth¹ | ${fmt(result.winnerConcentration * 100, 1)} % | ${fmt(result.loserConcentration * 100, 1)} % |`)
  lines.push(`| Ø Schwerpunkt y | ${fmt(result.winnerProfile.centerY)} | ${fmt(result.loserProfile.centerY)} |`)
  lines.push(`| Ø Masse im oberen Drittel | ${fmt(result.winnerProfile.topThird * 100, 1)} % | ${fmt(result.loserProfile.topThird * 100, 1)} % |`)
  lines.push(`| Ø vertikale Streuung | ${fmt(result.winnerProfile.spreadY)} | ${fmt(result.loserProfile.spreadY)} |`)
  lines.push(`| Ø Seitenverhältnis | ${fmt(result.winnerAspect, 2)} | ${fmt(result.loserAspect, 2)} |`)
  lines.push('')
  lines.push('¹ Anteil der Ground-Truth-Masse in den stärksten 5 % der Pixel — hoch heißt: wenige, enge Hotspots.')
  lines.push('')

  if (contactSheet) {
    lines.push(`![Kontaktbogen der Gewinner](${contactSheet})`)
    lines.push('')
    lines.push('Spalten: Original · Ground Truth · Vorhersage. Absteigend nach Vorsprung.')
    lines.push('')
  }

  lines.push(`| # | Bild | CC FigMaps | CC Mean Map | Vorsprung |`)
  lines.push('|---:|---|---:|---:|---:|')
  result.winners.slice(0, 20).forEach((entry, index) => {
    lines.push(
      `| ${index + 1} | \`${entry.id}\` | ${fmt(entry.engineCc)} | ${fmt(entry.meanCc)} | +${fmt(entry.margin)} |`,
    )
  })
  lines.push('')

  return lines.join('\n')
}

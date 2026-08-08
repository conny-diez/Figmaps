/**
 * Abweichungs-Score — wie stark weicht dieser Screen von der Norm ab?
 *
 * Eine Zahl in `[0,1]`, berechnet aus zwei Dingen, die zur Laufzeit ohnehin
 * vorliegen: der Prior-Map (wo Aufmerksamkeit auf dieser Art von Screen
 * üblicherweise liegt) und der Bildanalyse-Map (was auf diesem Screen
 * auffällt). **Keine Ground Truth nötig.**
 *
 * Der Hintergrund ist ein Befund der Diagnose: FigMaps schlägt den reinen
 * Ortsdurchschnitt fast ausschließlich auf Screens, deren Aufmerksamkeit
 * *nicht* dort liegt, wo sie üblicherweise liegt — Hero-dominierte Seiten mit
 * dem Blickfang in der Bildmitte statt in der Kopfzeile. Wenn sich das an der
 * Divergenz zwischen den beiden Maps ablesen lässt, ist es ein
 * Vertrauensindikator: hoch heißt „hier trägt die Bildanalyse etwas bei",
 * niedrig heißt „hier sagt die Vorhersage im Wesentlichen den Durchschnitt".
 *
 * ---------------------------------------------------------------------------
 * BEFUND (Tuning-Split, je 468 Bilder) — **wird derzeit nicht im UI angezeigt**
 *
 *   Mobile UI: Korrelation mit dem tatsächlichen Gewinn 0,24; der Anteil der
 *              Screens, auf denen die Bildanalyse hilft, steigt über die
 *              Quintile monoton von 71 % auf 84 %. Taugt.
 *   Webpage:   Korrelation 0,08, und der Verlauf ist nicht monoton, sondern ein
 *              umgekehrtes U — mittlere Abweichung ist am besten, sehr hohe
 *              wieder schlechter (54 % / 71 % / 77 % / 42 % / 45 %). Taugt nicht.
 *
 * Ein Indikator, der auf einem UI-Typ verlässlich ist und auf dem anderen in
 * die Irre führt, ist schlechter als keiner — der Nutzer kann nicht erkennen,
 * in welchem Fall er sich gerade befindet. Der Score bleibt als gemessene
 * Größe im Code (der Harness wertet ihn aus), wird aber nicht ins Panel
 * gehoben, bis er auf beiden Kategorien trägt.
 * ---------------------------------------------------------------------------
 *
 * Rein rechnerisch, kein DOM, kein `figma.*`.
 */

/** Pearson correlation of two equally sized fields. */
export function correlation(a: Float32Array, b: Float32Array): number {
  const n = Math.min(a.length, b.length)
  if (n === 0) return 0

  let meanA = 0
  let meanB = 0
  for (let i = 0; i < n; i++) {
    meanA += a[i]
    meanB += b[i]
  }
  meanA /= n
  meanB /= n

  let covariance = 0
  let varianceA = 0
  let varianceB = 0
  for (let i = 0; i < n; i++) {
    const da = a[i] - meanA
    const db = b[i] - meanB
    covariance += da * db
    varianceA += da * da
    varianceB += db * db
  }

  const denominator = Math.sqrt(varianceA * varianceB)
  return denominator > 1e-12 ? covariance / denominator : 0
}

export type DeviationLevel = 'low' | 'medium' | 'high'

export type Deviation = {
  /** `0` = image analysis agrees with the prior, `1` = it disagrees entirely. */
  score: number
  level: DeviationLevel
}

/**
 * Cut points between the three levels, on the `[0,1]` score.
 *
 * Provisional: set to the upper two quintile boundaries measured on the mobile
 * tuning split, the only category where the score behaves monotonically. They
 * are **not** validated for webpage — see the finding at the top of this file.
 */
export const DEVIATION_THRESHOLDS = { medium: 0.41, high: 0.48 }

/**
 * `1 - CC(image, prior)`, mapped from `[-1,1]` onto `[0,1]`.
 *
 * Correlation rather than a per-pixel difference: both maps are normalised
 * differently and an absolute difference would mostly measure their contrast,
 * not their disagreement about *where* things are.
 */
export function deviationScore(imageAnalysis: Float32Array, prior: Float32Array): number {
  const cc = correlation(imageAnalysis, prior)
  const score = (1 - cc) / 2
  return score < 0 ? 0 : score > 1 ? 1 : score
}

export function deviationLevel(score: number): DeviationLevel {
  if (score >= DEVIATION_THRESHOLDS.high) return 'high'
  if (score >= DEVIATION_THRESHOLDS.medium) return 'medium'
  return 'low'
}

export function deviationOf(imageAnalysis: Float32Array, prior: Float32Array): Deviation {
  const score = deviationScore(imageAnalysis, prior)
  return { score, level: deviationLevel(score) }
}

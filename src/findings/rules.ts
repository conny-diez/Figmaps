/**
 * Epic C — the rule set.
 *
 * Every rule is deterministic, reads its thresholds from
 * `ENGINE_CONFIG.findings` and returns at most one finding. The wording follows
 * C-2 without exception:
 *
 *   - describe what was measured, never prescribe what to do
 *     ("liegt auf Rang 3", not "sollte prominenter sein")
 *   - always in prediction mode ("vorhergesagt", "voraussichtlich"),
 *     never "Nutzer sehen"
 *   - at most one decimal place in any percentage
 *   - no exclamation marks, no warning emoji, no overall 0–100 score
 *
 * Changing a text here changes the product. Texts are signed off by a human.
 */
import type { ClickCandidate } from '../engine/clickmap'
import { ENGINE_CONFIG } from '../engine/config'
import { meanInRect } from '../engine/imageops'
import { sectionSalience } from '../engine/segments'
import { signalRect } from '../engine/features/structure'
import type { NodeSignal } from '../messages'
import { describeElement, type Describable } from './label'
import type { Finding, FindingsInput, Rule } from './types'

const cfg = ENGINE_CONFIG.findings

/**
 * Names an element the way the reviewer sees it: text content first, layer name
 * only as a fallback, plus a position when several elements read alike.
 * See `label.ts`.
 */
function describe(target: Describable, input: FindingsInput): string {
  return describeElement(target, input.signals, input.frameHeight)
}

/** Rounds to one decimal and drops a trailing ",0" — C-2 forbids false precision. */
export function formatPercent(share: number): string {
  const value = Math.round(share * 1000) / 10
  return `${Number.isInteger(value) ? value : value.toFixed(1).replace('.', ',')} %`
}

/** Frame pixels -> composed-map pixels. */
function mapScale(input: FindingsInput): number {
  return input.attention.width / input.frameWidth
}

function candidateRect(candidate: ClickCandidate, input: FindingsInput) {
  const scale = mapScale(input)
  return {
    x: candidate.x * scale,
    y: candidate.y * scale,
    width: Math.max(1, candidate.width * scale),
    height: Math.max(1, candidate.height * scale),
  }
}

/**
 * Which viewport a candidate belongs to: the section whose centre is nearest.
 *
 * Not "the first section that contains it". Sections overlap by 20 %, so an
 * element near a boundary sits at the *bottom* of one section and at the *top*
 * of the next — and the location prior is top-heavy. Picking the first
 * container would systematically score boundary elements against the dark end
 * of a section. The nearest centre is the viewport in which the element is
 * most fully visible.
 */
function sectionIndexFor(candidate: ClickCandidate, input: FindingsInput): number {
  const centre = candidate.y + candidate.height / 2
  let best = 0
  let bestDistance = Infinity
  for (const section of input.plan.sections) {
    const distance = Math.abs(centre - (section.y + section.height / 2))
    if (distance < bestDistance) {
      bestDistance = distance
      best = section.index
    }
  }
  return best
}

/**
 * Mean predicted attention of a candidate **within its own viewport**, read
 * from that section's un-attenuated map.
 *
 * On the composed map this quantity carries `sectionAttenuation^i`, so a button
 * in the footer of a scrolling frame is quiet by arithmetic rather than by
 * design — which is what made `dead-cta` fire on everything.
 *
 * Falls back to the composed map when no section maps were supplied (hand-built
 * test input); for an unsegmented frame the two are the same map anyway.
 */
function localMean(candidate: ClickCandidate, input: FindingsInput): number {
  const sections = input.sections
  if (!sections || sections.length <= 1) {
    return meanInRect(input.attention.values, input.attention.width, input.attention.height, candidateRect(candidate, input))
  }

  const index = Math.min(sectionIndexFor(candidate, input), sections.length - 1)
  const map = sections[index]
  const section = input.plan.sections[index]
  const scale = map.width / input.frameWidth
  return meanInRect(map.values, map.width, map.height, {
    x: candidate.x * scale,
    y: (candidate.y - section.y) * scale,
    width: Math.max(1, candidate.width * scale),
    height: Math.max(1, candidate.height * scale),
  })
}

/** True when a candidate reads as the primary call to action of the screen. */
export function isPrimaryCandidate(candidate: ClickCandidate): boolean {
  const name = candidate.name.toLowerCase()
  return cfg.primaryKeywords.some((keyword) => name.includes(keyword))
}

/** Name of the smallest node covering a point on the composed map, if any. */
function labelAt(input: FindingsInput, x: number, y: number): NodeSignal | null {
  let best: NodeSignal | null = null
  let bestArea = Infinity
  for (const signal of input.signals) {
    const rect = signalRect(signal, input.frameWidth, input.frameHeight, input.attention.width, input.attention.height)
    if (x < rect.x || x >= rect.x + rect.width || y < rect.y || y >= rect.y + rect.height) continue
    const area = rect.width * rect.height
    if (area < bestArea) {
      bestArea = area
      best = signal
    }
  }
  return best
}

/** Index of the strongest map pixel, ties resolved to the lowest index. */
function argmax(values: Float32Array, predicate?: (index: number) => boolean): number {
  let best = -1
  for (let i = 0; i < values.length; i++) {
    if (predicate && !predicate(i)) continue
    if (best < 0 || values[i] > values[best]) best = i
  }
  return best
}

/**
 * True when the straight path between two peaks drops clearly below the
 * hotspot threshold somewhere — i.e. they are two regions, not one band.
 */
function hasValleyBetween(
  map: { width: number; values: Float32Array },
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  secondPeak: number,
): boolean {
  const steps = Math.max(Math.abs(x2 - x1), Math.abs(y2 - y1))
  if (steps <= 0) return false
  // Relative to the weaker of the two peaks — see `competitionValleyRatio`.
  const valley = secondPeak * cfg.competitionValleyRatio

  for (let step = 1; step < steps; step++) {
    const t = step / steps
    const x = Math.round(x1 + (x2 - x1) * t)
    const y = Math.round(y1 + (y2 - y1) * t)
    if (map.values[y * map.width + x] < valley) return true
  }
  return false
}

// ---------------------------------------------------------------------------
// Rules
// ---------------------------------------------------------------------------

/**
 * The primary call to action is not the strongest predicted click target.
 *
 * Kein kalibrierter Schwellwert — „nicht auf Rang 1" ist eine Definition. Die
 * Regel kann daher nicht fehlkalibriert sein, wohl aber wenig aussagen: sie
 * feuert auf 43 % (synthetic) bis 92 % (Desktop, scrollend, konstruiert) der
 * Screens. Auf gescrollten Frames wird das von der Scroll-Dämpfung getrieben,
 * die den Fuß-CTA im Ranking nach unten schiebt.
 */
/**
 * Der primäre CTA liegt nicht auf einem der vordersten Ränge.
 *
 * **Nach dem Ausbau des Flächenanteils gemessen, gegen die bekannte Antwort.**
 * Die konstruierten Frames stellen den primären CTA in 6 von 8 Varianten nach
 * unten und in 2 von 8 direkt unter den Hero (`layoutFor`, `variant % 3 === 2`).
 * Die Regel soll also in genau 6 Fällen feuern und in 2 schweigen:
 *
 *   Desktop scrollend   16/24 — feuert auf genau den 16 „CTA unten"-Varianten
 *   Telefon 1 Viewport  16/24 — dieselbe Aufteilung, keine Abweichung
 *   Telefon scrollend   16/24 — dieselbe Aufteilung, keine Abweichung
 *
 * **24 von 24 Urteilen stimmen in jeder Frame-Form mit der Konstruktion
 * überein** (`npm run finding-load`). Keine Fehlmeldung, kein Versäumnis. Die
 * einzige Abweichung, die hier früher stand — eine Fehlmeldung auf „Telefon
 * scrollend" —, ist mit den Engine-Änderungen aus 1.2 A verschwunden.
 *
 * **Die 66,7 % sind die Quote des Generators, nicht die der Regel.**
 * `constructed.ts` → `layoutFor` setzt `ctaAtBottom = variant % 3 !== 2`,
 * stellt den CTA also in genau zwei Dritteln der Varianten nach unten. Wer
 * diese Zahl als Eigenschaft der Regel liest, liest eine Eigenschaft von
 * `layoutFor`. Auf echten Screens ist die Quote unbekannt und mit UEyes nicht
 * messbar — ohne Layer-Baum gibt es keine Kandidaten.
 *
 * Solange der Flächenanteil im Score steckte, war das anders: er addierte 0,20
 * auf jede Ergebniskarte (230.400 px² gegen 17.784 px² beim CTA) und schob die
 * Karten unabhängig vom Entwurf auf Rang 1. Die Regel feuerte dann 8/8. Siehe
 * `ENGINE_CONFIG.clickmap.weights`.
 */
const ctaRank: Rule = {
  id: 'cta-rank',
  evaluate(input) {
    const primaryIndex = input.candidates.findIndex(isPrimaryCandidate)
    if (primaryIndex < 0) return null

    const rank = primaryIndex + 1
    if (rank <= cfg.ctaRankThreshold) return null

    const primary = input.candidates[primaryIndex]
    const leader = input.candidates[0]
    return {
      id: 'cta-rank',
      severity: 'problem',
      text: `${describe(primary, input)} liegt auf Rang ${rank} der vorhergesagten Klicks — Rang 1 hat ${describe(leader, input)}.`,
      nodeIds: [primary.id, leader.id],
    }
  },
}

/**
 * The strongest predicted click target sits below the first fold.
 *
 * Ebenfalls ohne kalibrierten Schwellwert. Die Erreichbarkeit hängt aber an
 * `sectionAttenuation` — einer ausdrücklich nicht gemessenen Annahme (siehe
 * `config.ts`): weil jeder tiefere Abschnitt gedämpft wird, liegt der stärkste
 * Kandidat fast immer im ersten. Auf 24 konstruierten Desktop- und 24
 * Telefon-Scrollframes feuerte die Regel 0 Mal (y ÷ Fold 1 zwischen 0,15 und
 * 0,80); der End-to-End-Test löst sie nur mit einem sehr großen
 * Reaktions-Kandidaten weit unten aus. Sie ist nicht tot, aber sie meldet
 * seltener, als der Name vermuten lässt.
 */
/**
 * NICHT AUSGELIEFERT — strukturell blockiert, nicht falsch kalibriert.
 *
 * Die Regel liest `candidates[0]`, also den stärksten Kandidaten der
 * komponierten Karte, und meldet, wenn der unterhalb des ersten Folds liegt.
 * Zwei Eigenschaften der Vorhersage arbeiten dagegen, und beide sind
 * beabsichtigt:
 *
 *   1. Der Ortsprior ist **oben-lastig** — er ist aus Einzel-Viewports
 *      geschätzt, in denen der Blick oben beginnt.
 *   2. Jeder Abschnitt wird zusätzlich mit `sectionAttenuation^i` gedämpft.
 *      Ein Element unterhalb des Folds startet damit bei der Hälfte.
 *
 * Ein Kandidat unter dem Fold muss beides überkompensieren, um Rang 1 zu
 * erreichen. Gemessen auf 24 konstruierten Frames mit deutschen Ebenennamen:
 * **0 von 24**, in allen drei Frame-Formen. Der Erreichbarkeitstest zeigt, dass
 * es geht — aber nur mit Prototype-Interaktion *und* einem starken Block
 * dahinter *und* einem Gegenspieler, der beides nicht hat.
 *
 * **Die Dämpfung wird dafür nicht angefasst.** Sie ist ohnehin eine Annahme
 * ohne Messung (`config.ts`); sie zu verstellen, damit eine Regel feuert, hieße
 * die Vorhersage an die Regel anzupassen statt umgekehrt — genau der Fehler,
 * der in diesem Projekt schon viermal passiert ist.
 *
 * Was die Regel stattdessen bräuchte: eine Größe, die den Kandidaten **innerhalb
 * seines eigenen Abschnitts** bewertet statt auf der gedämpften Gesamtkarte.
 *
 * **Die gibt es schon.** `localMean` liest genau das — die mittlere
 * Aufmerksamkeit eines Kandidaten auf der *ungedämpften* Karte seines eigenen
 * Viewports — und wurde für `dead-cta` gebaut, aus demselben Grund: dort machte
 * die Dämpfung jeden Fußzeilen-Knopf rechnerisch leise. In 1.2 ist das damit
 * **eine Änderung für zwei Regeln**, nicht zwei Aufgaben: beide steigen von der
 * komponierten Karte auf die Abschnittskarte um.
 *
 * Was dabei mitentschieden werden muss: die Aussage ändert sich. „Der stärkste
 * Kandidat des Screens liegt unter dem Fold" wird zu „der Kandidat, der seinen
 * eigenen Viewport dominiert, sitzt nicht im ersten" — der Satz muss neu
 * geschrieben werden, nicht nur die Zahl. Siehe README, „Offen für 1.2".
 */
const ctaBelowFold: Rule = {
  id: 'cta-below-fold',
  shipped: false,
  evaluate(input) {
    if (input.plan.folds.length === 0) return null
    const leader = input.candidates[0]
    if (!leader) return null

    const firstFold = input.plan.folds[0]
    if (leader.y < firstFold) return null

    return {
      id: 'cta-below-fold',
      severity: 'problem',
      text: `Das interaktive Element mit der höchsten vorhergesagten Klickwahrscheinlichkeit, ${describe(leader, input)}, liegt unterhalb des ersten Folds.`,
      nodeIds: [leader.id],
    }
  },
}

/**
 * Two far-apart regions both reach near-maximum predicted attention.
 *
 * Auf echten Bildern nicht entartet: 2,2 % (Webseite, segmentiert) und 10,3 %
 * (Telefon, ein Viewport) bei α = 0,3. Die selektivste Regel, wie beabsichtigt.
 *
 * **ALLE DIESE QUOTEN SIND ZWEIFACH VERALTET, UND ZWAR AUS ZWEI UNABHÄNGIGEN
 * GRÜNDEN.** Beide sind Gründe, sie nicht als Anker zu benutzen:
 *
 * 1. *Das Abstandsmaß.* „Weit auseinander" ist ein Anteil der Karten**breite**
 *    und bedeutet je nach Frame-Form 3,9 % bis 48,0 % der Höhe (Tabelle unten).
 *    Die Zahlen beantworten also nicht dieselbe Frage zweimal.
 * 2. *Die Karte selbst.* Mit dem Umstieg auf `blendAlpha` 0,5 (1.2 A) ist die
 *    Rate ohne eine einzige Änderung an dieser Regel gestiegen — gemessen mit
 *    `npm run side-effects`:
 *
 *                                 α 0,3     α 0,5    + Schärfe (Stand)
 *      Webseite, segmentiert        2,2 %    11,9 %     10,3 %
 *      Telefon, ein Viewport       10,3 %    31,1 %     22,4 %
 *      Telefon, segmentiert           —       6,3 %      2,6 %
 *      Desktop scrollend (konstr.)  0,0 %     8,3 %      4,2 %
 *      Telefon scrollend (konstr.)  0,0 %    20,8 %      4,2 %
 *      Telefon 1 VP (konstruiert)   0,0 %    20,8 %     12,5 %
 *
 *    Die dritte Spalte ist der ausgelieferte Stand nach 1.2 A6 (Blur 0,035,
 *    `blendGamma` 2,0). Die Zuspitzung nimmt einen Teil des Anstiegs zurück —
 *    sie senkt die Fläche *neben* den Blickfängen stärker als die zwischen
 *    ihnen. Eine Verdopplung gegenüber 1.1 bleibt.
 *
 *    Der Grund steht in der Verteilung: das Tal zwischen den beiden Maxima
 *    fällt, weil der stärker gewichtete Bildanteil die Fläche zwischen zwei
 *    Blickfängen absenkt. Median Tal ÷ zweites Maximum auf Telefon-Screens
 *    1,002 → 0,967, p5 0,848 → 0,703; die Schwelle 0,9 liegt damit plötzlich
 *    mitten in der Verteilung statt an ihrem unteren Rand.
 *
 * **Nicht nachjustiert, mit Absicht.** 0,9 an die neue Verteilung anzupassen
 * wäre eine weitere unkalibrierte Bewegung. Die Regel wird in 1.2 B1 ohnehin
 * umgebaut (Abstand auf Diagonale oder getrennte x/y-Schwellen) und **danach**
 * neu kalibriert — auf der ausgelieferten Karte, in jeder der drei Frame-Formen
 * getrennt. Bis dahin gilt: 10,3 % / 22,4 % ist der Stand, nicht 3,3 % / 10,0 %.
 *
 * Offen bleibt `competitionMinDistance`: der Mindestabstand ist ein Anteil der
 * Karten**breite** und wird auf Karten angewandt, deren Seitenverhältnis um
 * eine Größenordnung schwankt. Derselbe Wert 0,3 bedeutet
 *
 *   Desktop, ein Viewport   154 px = 48,0 % der Kartenhöhe
 *   Telefon, ein Viewport    71 px = 13,9 %
 *   Telefon, scrollend       77 px =  3,9 %
 *
 * „weit auseinander" heißt also je nach Frame-Form etwas völlig anderes. Nicht
 * geändert, weil jede Änderung ohne neue Kalibrierung genau der Fehler wäre,
 * um den es hier geht.
 */
const competition: Rule = {
  id: 'competition',
  evaluate(input) {
    const { attention } = input
    const first = argmax(attention.values)
    if (first < 0 || attention.values[first] < cfg.competitionIntensity) return null

    const x1 = first % attention.width
    const y1 = Math.floor(first / attention.width)
    const minDistance = cfg.competitionMinDistance * attention.width

    const second = argmax(attention.values, (index) => {
      const dx = (index % attention.width) - x1
      const dy = Math.floor(index / attention.width) - y1
      return Math.sqrt(dx * dx + dy * dy) > minDistance
    })
    if (second < 0 || attention.values[second] < cfg.competitionIntensity) return null

    const x2 = second % attention.width
    const y2 = Math.floor(second / attention.width)

    // Two peaks inside one continuous bright band are one region, not two
    // competitors — require the connecting path to dip.
    if (!hasValleyBetween(attention, x1, y1, x2, y2, attention.values[second])) return null

    const a = labelAt(input, x1, y1)
    const b = labelAt(input, x2, y2)

    const named = a && b && a.id !== b.id
    return {
      id: 'competition',
      severity: 'attention',
      text: named
        ? `${describe(a, input)} und ${describe(b, input)} erreichen beide die vorhergesagte Spitzenaufmerksamkeit und liegen weit auseinander.`
        : 'Zwei weit auseinanderliegende Bereiche erreichen beide die vorhergesagte Spitzenaufmerksamkeit.',
      nodeIds: named ? [a.id, b.id] : undefined,
    }
  },
}

/**
 * A later section peaks higher than the section every user sees.
 *
 * Anders als `flat` und `dead-cta` liest diese Regel die **ungedämpften**
 * Abschnittskarten, ist also von der Komposition unabhängig. Auf echten Bildern
 * ist sie gutmütig: UEyes-Webseiten, Viewport 500 erzwungen — Rate 27,7 %
 * bei α = 0,3.
 *
 * Auf konstruierten Frames mit einem farbigen Fuß oder Hero weiter unten
 * feuert sie dagegen in 83–100 % der Fälle. 0,08 ist keine falsche, aber eine
 * sehr durchlässige Grenze; ob sie trägt, entscheidet sich an echten Designs,
 * nicht an Screenshots einzelner Viewports.
 *
 * **Auch diese Rate hängt an `blendAlpha`**, obwohl die Regel abschnittsweise
 * misst: die Konzentration eines Abschnitts steigt mit dem Gewicht des
 * Bildanteils, und tiefere Abschnitte haben mehr Inhalt als der Kopfbereich.
 * Gemessen beim Umstieg auf 0,5 (`npm run side-effects`):
 *
 *                                      α 0,3     α 0,5    + Schärfe   + Schwelle je Typ
 *   Webseite, Viewport 500 erzwungen   27,7 %   34,9 %     40,0 %      40,0 %
 *   Telefon, Viewport 400 erzwungen       —     58,6 %     61,6 %      39,8 %
 *   Desktop scrollend (konstruiert)    83,3 %   95,8 %    100,0 %
 *   Telefon scrollend (konstruiert)   100,0 %  100,0 %    100,0 %
 *
 * Auf beiden konstruierten Formen feuert sie damit **immer** und sagt dort
 * nichts mehr.
 *
 * **DER BEFUND STAND NICHT IN DER RATE, SONDERN IN DER VERTEILUNG — und ist
 * behoben.** Der relative Vorsprung des stärksten Abschnitts lag
 *
 *   auf Webseiten       im Median bei 0,037  — die Schwelle 0,08 darüber, p60
 *   auf Telefon-Screens im Median bei 0,131  — die Schwelle **darunter**, p38
 *
 * Auf Telefon-Screens sagte die Regel damit häufiger ja als nein. Seit 1.2 B
 * hat `coldFoldMargin` eine Schwelle je UI-Typ, beide am selben Perzentil
 * ihrer eigenen Verteilung (p60): web 0,080, mobile 0,189. Die Begründung und
 * die Grenzen der Kalibrierung stehen in `config.ts` — insbesondere, dass das
 * Perzentil selbst nicht kalibriert ist.
 *
 * Auf Webseiten bleibt die Regel mit 40,0 % im brauchbaren Bereich; die
 * konstruierten Frames stellen den Hero absichtlich weiter unten auf, ihre
 * Quote ist die des Aufbaus. Die Richtung ist über beide Schritte eindeutig,
 * und 0,08 ist damit endgültig nachzumessen — an echten Designs mit Layer-Baum
 * (PRD Set 2).
 */
const coldFold: Rule = {
  id: 'cold-fold',
  evaluate(input) {
    if (!input.plan.segmented || input.sectionSalience.length < 2) return null

    const aboveFold = input.sectionSalience[0]
    let bestIndex = 0
    for (let i = 1; i < input.sectionSalience.length; i++) {
      if (input.sectionSalience[i] > input.sectionSalience[bestIndex]) bestIndex = i
    }
    if (bestIndex === 0) return null
    // Relative: the concentration measure lives in a narrow band, so an
    // absolute margin would either never fire or fire always.
    if (!(aboveFold > 0)) return null
    // Schwelle je UI-Typ, wie bei `flat`: „der stärkste Abschnitt liegt nicht
    // oben" soll auf einer Webseite und auf einem Telefon-Screen dasselbe
    // heißen. Mit einer Zahl für beide hieß es das nicht — siehe `config.ts`.
    const margin = cfg.coldFoldMargin[input.priorCategory] ?? cfg.coldFoldMargin.web
    if (input.sectionSalience[bestIndex] / aboveFold - 1 < margin) return null

    return {
      id: 'cold-fold',
      severity: 'problem',
      text: `Die Aufmerksamkeit bündelt sich in Abschnitt ${bestIndex + 1} deutlich stärker als im ersten sichtbaren Bereich.`,
    }
  },
}

/**
 * Attention is spread evenly — the screen predicts no hierarchy.
 *
 * Diese Regel war zweimal abgeschaltet und ist es nicht mehr. Die Geschichte
 * steht hier, weil sie der Grund für den heutigen Aufbau ist.
 *
 * **Was schiefging.** Die Schwelle war auf der *komponierten* Karte geschätzt,
 * mit web-Prior und erzwungener Segmentierung (so misst `findings-audit`), und
 * wurde auf einem Telefon-Frame angewandt, der mit mobile-Prior als ein
 * einziger Viewport läuft. Dort lag sie über dem gesamten beobachteten
 * Wertebereich: 150 von 150 UEyes-Mobile-Bildern, 12 von 12 konstruierten
 * Frames mit bewusst starker Hierarchie — direkt neben einer Heatmap, die
 * genau diese Hierarchie zeigte.
 *
 * **Erster Anlauf: die Dämpfung raus.** Auf dem ersten Abschnitt für sich
 * (ungedämpft) fallen die Verteilungen zusammen — Telefon kurz 0,126–0,149,
 * Telefon scrollend 0,120–0,152, Desktop scrollend 0,122–0,147, vorher
 * 0,126–0,149 gegen 0,248–0,292. Die Größe wurde damit invariant gegen die
 * Segmentierung, aber sie maß immer noch das Falsche: an Fällen mit bekannter
 * Antwort lag ein **leerer** Frame (0,164) so hoch wie einer mit klarem
 * Blickfang (0,167), und was die Größe wirklich bewegte, war die Menge an
 * Inhalt.
 *
 * **Zweiter Anlauf: den Prior raus.** Unter `hybrid-v1` ist die fertige Karte
 * `norm(Prior) + α · Bild` (α = 0,5 seit 1.2, davor 0,3), also weitgehend der
 * Prior — und der ist auf jedem Screen derselbe. Gemessen auf dem **Bildanalyse-Anteil** (`aboveFoldImageTerm`)
 * stimmt die Ordnung:
 *
 *   leer                       0,000     3 gleich starke Blöcke   0,096
 *   ein kleiner Blickfang      0,871     6 gleich starke Blöcke   0,077
 *   ein großer Blickfang       0,283    12 gleich starke Blöcke   0,063
 *   Blickfang + ruhiger Inhalt 0,102
 *
 * Der unterscheidende Bereich ist damit 0,00–0,87 statt 0,113–0,167.
 *
 * **Stand.** Schwellen sind das p10 je UI-Typ aus je 150 UEyes-Bildern
 * (`config.ts`). Feuerraten auf konstruierten Frames: Telefon ein Viewport
 * 0/24, Telefon scrollend 6/24, Desktop scrollend 5/24. Der Frame aus dem
 * Vergleichstest — farbiger Kopf, farbiger Fuß — feuert nicht mehr.
 *
 * **Dritter Anlauf, und diesmal aus: die Größe misst das Falsche.** Der
 * Vorbehalt oben („reagiert auch auf die Menge an Inhalt") ist zu milde. Zwei
 * kontrollierte Sweeps auf derselben Fläche, gemessen auf dem Bildanalyse-Anteil:
 *
 *   Hierarchie konstant (ein Hero), nur mehr Inhalt
 *     Hero + 2 Zeilen 0,176 · +4 0,156 · +6 0,143 · +8 0,134 · +10 0,127
 *
 *   Inhalt konstant (6 Zeilen), nur der Blickfang wächst
 *     keiner 0,123 · 60 px 0,220 · 120 px 0,155 · 240 px 0,142 · 400 px 0,137
 *
 * Der zweite Sweep ist **nicht monoton**: ein *großer* Blickfang (0,137) landet
 * fast dort, wo *kein* Blickfang landet (0,123). Die Größe beantwortet damit
 * „wie klein ist die stärkste Stelle", nicht „wie deutlich ist die Hierarchie".
 * Und die reine Inhaltsmenge bewegt sie um 0,049 — bei einem Klassenabstand von
 * 0,004 (ohne Hierarchie 0,000–0,123, mit 0,127–0,220).
 *
 * **Warum das ein Abschalten ist und keine Nachjustierung.** Mit den
 * ausgelieferten Schwellen (p10 je UI-Typ, web 0,086) gibt die Regel auf diesen
 * 13 Fällen keine falsche Aussage ab — sie feuert auf keinem Screen mit
 * Blickfang. Der Grund ist aber nicht Trennschärfe, sondern dass die Schwelle
 * **unterhalb des gesamten realistischen Wertebereichs** (0,103–0,220) liegt:
 * sie feuert praktisch nur auf einem leeren Screen (0,000), und drei von vier
 * Screens ohne Hierarchie verpasst sie, darunter zwölf gleich starke Blöcke.
 * Eine faktisch blockierte Regel, die im Gebrauch als stumm erscheint — das ist
 * dieselbe Fehlerklasse wie beim wirkungslosen `cold-fold`, nur andersherum.
 * Und jede Schwelle, die „zwölf gleiche Blöcke" fängt, wird von einer Seite mit
 * Hero und viel Inhalt wieder gekippt.
 *
 * **Nächster Schritt (1.2, nicht hier).** Andere Entscheidungsgröße: ein
 * Kontrast zwischen der stärksten Stelle und dem Rest, unabhängig von deren
 * *Fläche* — z. B. p99 ÷ Median des Bildanalyse-Anteils statt des Massenanteils
 * der stärksten 5 %. Das ist eine Neuentwicklung mit eigener Messung. Steht im
 * README neben der Kandidaten-Gruppierung für `dead-cta`.
 */
const flat: Rule = {
  id: 'flat',
  shipped: false,
  evaluate(input) {
    // Concentration, not the p90-p50 spread. The spread depends on the map's
    // overall contrast, which differs systematically between UI types: on the
    // same threshold it fired on 11 % of webpages and 90 % of mobile screens.
    // The share of mass in the strongest pixels is scale-free and transfers.
    const threshold = cfg.flatConcentrationThreshold[input.priorCategory] ?? cfg.flatConcentrationThreshold.web
    // The image term of the first section: what *this screen* makes salient,
    // un-attenuated and without the location prior. See
    // `FindingsInput.aboveFoldImageTerm` for why not the finished map.
    const map = input.aboveFoldImageTerm ?? input.aboveFoldSection ?? input.attention
    if (sectionSalience(map) >= threshold) return null

    return {
      id: 'flat',
      severity: 'attention',
      text: 'Der Screen zeigt keine ausgeprägte visuelle Hierarchie — die vorhergesagte Aufmerksamkeit verteilt sich weitgehend gleichmäßig.',
    }
  },
}

/**
 * An interactive element sits in the quietest quarter of the screen.
 *
 * WARNUNG — dieselbe Fehlerklasse wie `flat`, noch nicht entschieden.
 *
 * Die Entscheidungsgröße ist „ruhigster ÷ stärkster Kandidat", gemessen auf der
 * **komponierten** Karte. Damit vergleicht sie Kandidaten über
 * Abschnittsgrenzen hinweg — und die Komposition dämpft jeden Abschnitt um
 * `sectionAttenuation^i`. Ein Button in der Fußzeile eines gescrollten Frames
 * liegt dadurch rechnerisch immer im ruhigen Bereich, unabhängig vom Entwurf.
 *
 * | Population | Verteilung | Schwelle 0,45 | Rate |
 * |---|---|---|---|
 * | synthetic (ein Viewport, 2 Kandidaten nebeneinander) | 0,310–0,994 | p3 | 3,3 % |
 * | Telefon, ein Viewport (konstruiert) | 0,128–0,286 | über max | 100 % |
 * | Desktop, scrollend (konstruiert) | 0,026–0,212 | über max | 100 % |
 * | Telefon, scrollend (konstruiert) | 0,020–0,038 | über max | 100 % |
 *
 * Die 0,45 stammen aus der ersten Zeile: einem Set, dessen Kandidaten alle im
 * selben Band eines top-lastigen Priors liegen. Sobald Kandidaten über den
 * Frame verteilt sind — der Normalfall —, fällt der Quotient mechanisch unter
 * die Schwelle.
 *
 * NICHT AUSGELIEFERT — und zwar nach dem Umbau, nicht mehr wegen ihm.
 *
 * Der Vergleich läuft inzwischen über die **ungedämpften** Abschnittskarten
 * (`localMean`, Variante B des Reviews): jeder Kandidat auf der Karte seines
 * eigenen Viewports, gemessen gegen den stärksten Kandidaten des Screens. Das
 * hat den Anteil der Scroll-Dämpfung an der Größe beseitigt — Desktop
 * scrollend ging von 0,026–0,212 auf 0,161–0,362, Telefon scrollend von
 * 0,020–0,038 auf 0,115–0,234 —, aber es reicht nicht:
 *
 * | Population | Kandidaten | Verteilung |
 * |---|---|---|
 * | `synthetic`, ein Viewport | 2 | 0,451–0,997 |
 * | Telefon, ein Viewport | 6–12 | 0,128–0,286 |
 * | Telefon, scrollend | 12 | 0,115–0,234 |
 * | Desktop, scrollend | 12 | 0,161–0,362 |
 *
 * Die Größe ist ein **Minimum über N Kandidaten** und sinkt deshalb mit deren
 * Anzahl: bei zwei Schaltflächen ist „die leiseste" fast nie weit unten, bei
 * zwölf fast immer eine. Keine Konstante ist über die Populationen hinweg
 * trennscharf — 0,45 feuert auf 100/100/100/0 %, 0,18 auf 29/50/54/0 %, 0,12
 * auf 0/0/13/0 %. Was dabei überwiegend gemeldet würde, ist die neunte von
 * zwölf gleichartigen Listenkarten, und das ist keine Aussage über den Entwurf.
 *
 * ENTSCHIEDEN FÜR 1.2 ODER SPÄTER, nicht in diesem Stand umgesetzt:
 *
 *   Vor der Minimum-Bildung werden **gleichartige, wiederholte Kandidaten zu
 *   einer Gruppe zusammengefasst und nur einmal gewertet** — gleicher
 *   Elementtyp, ähnliche Größe, Teil eines wiederholten Layout-Musters. Erst
 *   danach ist die Größe wieder sinnvoll kalibrierbar.
 *
 * Damit wird aus „die neunte von zwölf Listenkarten ist die leiseste" wieder
 * die Aussage, die die Regel machen will: „von den *unterscheidbaren*
 * Bedienelementen dieses Screens ist dieses das leiseste". Die Kandidatenzahl
 * hängt dann an der Zahl der Rollen statt an der Zahl der Listeneinträge, und
 * damit fällt der Grund weg, aus dem keine Konstante über die Frame-Formen
 * hinweg trennscharf war.
 *
 * `NodeSignal` trägt bereits, was ein Erkenner dafür braucht: `parentId`
 * (Geschwister im selben Container), `name` und `type` (gleiche Art), sowie
 * `width`/`height` (ähnliche Größe). Ein erster Schnitt wären Geschwister mit
 * demselben Elternteil, demselben Namen und Flächen innerhalb weniger Prozent
 * voneinander — das ist genau das Muster, das `label.ts` schon benutzt, um
 * „3. von 3" zu erkennen.
 *
 * Erst danach neu kalibrieren, und dafür fehlt weiterhin das Set mit echten
 * Layer-Bäumen (PRD Set 2) — ohne Layer-Baum gibt es keine Kandidaten, also an
 * UEyes grundsätzlich keine Messung.
 *
 * **ACHTUNG, alle Zahlen oben sind an einer anderen Population gemessen.** Sie
 * stammen von vor der Änderung der Kandidatenerkennung (deutsche Stichwörter +
 * Suche über die Vorfahrenkette, Kandidat ist jetzt der *Kasten* statt der
 * Beschriftung). Auf den konstruierten Frames mit deutschen Ebenennamen fiel
 * die Kandidatenzahl dadurch von 96 auf 87 (Desktop) bzw. 65 auf 47 (Telefon),
 * und die Größenverteilung ist eine völlig andere: statt vieler gleich großer
 * Beschriftungen wenige, sehr unterschiedlich große Kästen. Die Entscheidungs-
 * größe dieser Regel — ein Minimum über alle Kandidaten — hängt an genau
 * diesen beiden Dingen. Die 1.2-Aufgabe misst neu, sie übernimmt nichts.
 */
const deadCta: Rule = {
  id: 'dead-cta',
  shipped: false,
  evaluate(input) {
    // At least two candidates: "quiet compared to the others" is meaningless
    // when there is only one.
    if (input.candidates.length < 2) return null

    const means = input.candidates.map((candidate) => ({ candidate, mean: localMean(candidate, input) }))
    const best = Math.max(...means.map((entry) => entry.mean))
    if (!(best > 0)) return null

    const cutoff = best * cfg.deadCtaRelativeToBest
    let worst: { candidate: ClickCandidate; mean: number } | null = null
    for (const entry of means) {
      if (entry.mean > cutoff) continue
      if (!worst || entry.mean < worst.mean) worst = entry
    }
    if (!worst) return null

    const leader = means.find((entry) => entry.mean === best)
    if (!leader || leader.candidate.id === worst.candidate.id) return null

    // The comparison is *relative to the strongest button of the same screen*
    // and it is read per viewport — both have to be in the sentence, or the
    // number reads as an absolute share of attention, which it is not.
    return {
      id: 'dead-cta',
      severity: 'attention',
      text:
        `${describe(worst.candidate, input)} erreicht ${formatPercent(worst.mean / best)} der vorhergesagten ` +
        `Aufmerksamkeit der stärksten Schaltfläche ${describe(leader.candidate, input)}, jeweils im eigenen ` +
        `Bildschirmausschnitt gemessen.`,
      nodeIds: [worst.candidate.id, leader.candidate.id],
    }
  },
}

/**
 * Every implemented rule, in the order findings are listed in. Includes the
 * ones that are not currently offered.
 *
 * This is the *tie-breaker*, not the final order — `collectFindings` sorts by
 * severity first (C-1), so a `problem` precedes an `attention` whatever stands
 * here.
 *
 * The order is the one the review asked for. `flat` leads it although it is
 * not shipped: that is where it belongs the day its threshold is re-estimated,
 * and the position should not have to be rediscovered then.
 */
export const ALL_RULES: readonly Rule[] = [flat, ctaBelowFold, ctaRank, deadCta, competition, coldFold]

/**
 * The rules the plugin actually runs. A rule is dropped here, not deleted,
 * when its threshold is not backed by a measurement — see `flat`.
 */
export const RULES: readonly Rule[] = ALL_RULES.filter((rule) => rule.shipped !== false)

export function evaluateRule(id: string, input: FindingsInput): Finding | null {
  const rule = ALL_RULES.find((entry) => entry.id === id)
  if (!rule) throw new Error(`Unbekannte Regel: ${id}`)
  return rule.evaluate(input)
}

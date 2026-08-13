/**
 * 1.3 — was überhaupt messbar ist, und warum nicht.
 *
 * WORAN DIE KONTRASTMESSUNG SCHEITERT. Sie tastet den Hintergrund in der
 * **achsenparallelen Bounding-Box** eines Textknotens ab. Das ist genau so
 * lange richtig, wie diese Box zeigt, was man sieht — und die drei offenen
 * Risiken aus 1.2 C sind genau die Fälle, in denen sie das nicht tut
 * (Verdeckung, Rotation, Subpixel; siehe README, „Was die Generatoren nicht
 * erzeugen").
 *
 * ZWEI ARTEN VON ANTWORT, UND SIE DÜRFEN NICHT VERMISCHT WERDEN.
 *
 *   **Feststellbar** ist, was im Layer-Baum steht. Ob ein Knoten gedreht ist,
 *   ist eine Zahl an ihm; ob ein anderes Element später gezeichnet wird und ihn
 *   überlappt, folgt aus Zeichenreihenfolge und Geometrie. Für solche Fälle
 *   wäre eine Plausibilitätsheuristik der falsche Weg: sie würde eine
 *   Tatsache raten, die daneben liegt. Diese Datei stellt sie fest.
 *
 *   **Nicht feststellbar** ist der Rest — Masken, Effekte, Clipping,
 *   Subpixel-Kanten, alles, was erst beim Rendern entsteht. Dafür gibt es das
 *   Netz in `measure.ts`: es prüft nicht die Ursache, sondern das Ergebnis.
 *
 * WAS BEIDE GEMEINSAM HABEN. Sie liefern **kein** Ergebnis, sondern einen
 * benannten Grund. Eine erfundene Zahl ist bei einer Ausgabe, die als
 * überprüfbare Tatsache auftritt, der teuerste Fehler, den dieses Modul machen
 * kann — und „nicht messbar, weil verdeckt" ist eine brauchbare Auskunft,
 * „3,1:1" über fremde Pixel nicht.
 *
 * WAS DAS NETZ GEWORDEN IST, NACHDEM ES GEMESSEN WAR. Von den zwei Kandidaten
 * hat einer bestanden und einer nicht:
 *
 *   ✔ `textCoreShare` — kommt die angemeldete Textfarbe im Rahmen überhaupt
 *     vor? Trennt hundertfach (Maske 0,000 gegen kleinsten Korpuswert 0,133)
 *     und fängt Masken, Clipping und weggeschnittenen Text.
 *   ✘ `backgroundShare` — trägt die stärkste Fläche genug vom Rahmen? **Keine
 *     Schwelle möglich**: gleichverteiltes Rauschen liegt darin *über* einem
 *     Verlauf, und der Verlauf ist ausdrücklich messbar. Gemessen, nicht
 *     ausgeliefert, Zahlen bei `MeasurableLimits.backgroundShare`.
 *
 * Das ist kein Rückschlag, sondern der Zweck von 1d: die Prüfung wurde gezählt,
 * bevor sie ausgeliefert wurde, und die Zählung hat eine der beiden Ideen
 * widerlegt. Eine ungezählte Prüfung hätte beide ausgeliefert.
 */
import type { NodeSignal } from '../messages'

/**
 * Warum ein Element nicht gemessen wurde — als Code, nicht als Satz.
 *
 * **Codes und nicht Freitext, weil gezählt werden muss.** Die Warnung im Panel
 * lautet „3 Elemente nicht messbar (2 verdeckt, 1 gedreht)", und das lässt sich
 * aus zusammengesetzten Sätzen nicht bilden. Bis 1.2 stand hier ein `string`,
 * und die Warnung konnte deshalb nur die *Menge* der Gründe aufzählen, nie ihre
 * Häufigkeit — bei zwölf übersprungenen Elementen sagte sie nicht, ob elf davon
 * dieselbe Ursache hatten.
 */
export type SkipReason =
  /** Statusleiste, Home-Indicator — nicht Teil des Entwurfs. */
  | 'chrome'
  /** Kein einfarbiger, voll deckender Fill — die Textfarbe steht nicht fest. */
  | 'keine-textfarbe'
  /** Ohne Schriftgröße ist die WCAG-Schwelle nicht bestimmt. */
  | 'keine-schriftgroesse'
  /** Gedreht: die achsenparallele Box ist nicht der Textbereich. */
  | 'gedreht'
  /** Ein später gezeichnetes Element liegt über dem Textbereich. */
  | 'verdeckt'
  /** Im Rahmen und im Ring darum ist kein Hintergrundpixel zu finden. */
  | 'kein-hintergrund'
  /** Die Textfarbe kommt im Rahmen praktisch nicht vor — er zeigt diesen Text nicht. */
  | 'textkern-fehlt'
  /** Keine Fläche im Rahmen ist groß genug, um sein Hintergrund zu sein. */
  | 'hintergrund-zu-klein'
  /** 1.4.11: das Element liegt am Frame-Rand, es gibt keine angrenzende Farbe. */
  | 'kein-nachbar'

/**
 * Das kurze Wort für die gezählte Warnung — „2 verdeckt, 1 gedreht".
 *
 * Bewusst kurz und ohne Begründung: die Warnung ist eine Zeile im Panel, und
 * sie muss die Verteilung zeigen, nicht sie erklären. Die Erklärung steht in
 * `SKIP_TEXT` und wird pro Element ausgegeben, wo Platz dafür ist.
 */
export const SKIP_LABELS: Record<SkipReason, string> = {
  chrome: 'Betriebssystem-Chrome',
  'keine-textfarbe': 'keine einfarbige Textfarbe',
  'keine-schriftgroesse': 'keine Schriftgröße',
  gedreht: 'gedreht',
  verdeckt: 'verdeckt',
  'kein-hintergrund': 'kein Hintergrund im Rahmen',
  'textkern-fehlt': 'Text im Rahmen nicht zu sehen',
  'hintergrund-zu-klein': 'kein tragender Hintergrund',
  'kein-nachbar': 'am Frame-Rand',
}

/** Der ganze Satz — für die Einzelausgabe und für `npm run contrast-check`. */
export const SKIP_TEXT: Record<SkipReason, string> = {
  chrome: 'Betriebssystem-Chrome (Statusleiste, Home-Indicator) — nicht Teil des Entwurfs',
  'keine-textfarbe': 'keine einfarbige Textfarbe (Verlauf, Bild, mehrere Fills oder Deckkraft unter 1)',
  'keine-schriftgroesse': 'keine Schriftgröße — ohne sie ist die WCAG-Schwelle nicht bestimmt',
  gedreht:
    'gedreht — die achsenparallele Bounding-Box enthält überwiegend Pixel, die nicht hinter dem Text liegen',
  verdeckt: 'verdeckt — ein später gezeichnetes Element liegt über dem Textbereich',
  'kein-hintergrund': 'kein Hintergrund gefunden — Text füllt seinen Rahmen vollständig',
  'textkern-fehlt':
    'die Textfarbe kommt im Rahmen praktisch nicht vor — der Rahmen zeigt diesen Text nicht (Maske, Clipping, Effekt)',
  'hintergrund-zu-klein':
    'keine Fläche im Rahmen ist groß genug, um der Hintergrund dieses Elements zu sein',
  'kein-nachbar': 'keine angrenzende Fläche — Element liegt am Frame-Rand',
}

export type Skipped = { nodeId: string; reason: SkipReason }

/**
 * Die Gründe, gezählt und nach Häufigkeit sortiert — „2 verdeckt, 1 gedreht".
 *
 * Bei Gleichstand nach dem Code, damit die Zeile zwischen zwei Läufen auf
 * demselben Frame gleich lautet. Eine Warnung, deren Wortlaut sich ohne Grund
 * ändert, sieht wie ein Befund aus.
 */
export function summariseSkipped(skipped: readonly Skipped[]): string {
  const counts = new Map<SkipReason, number>()
  for (const entry of skipped) counts.set(entry.reason, (counts.get(entry.reason) ?? 0) + 1)
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([reason, count]) => `${count} ${SKIP_LABELS[reason]}`)
    .join(', ')
}

/**
 * Die Schwellen, an denen „nicht messbar" entschieden wird.
 *
 * **Als Objekt und nicht als Konstanten, weil sie gemessen werden müssen.**
 * Jede Zahl hier tauscht falsche Werte gegen fehlende Aussagen, und wo dieser
 * Tausch günstig liegt, ist keine Frage der Herleitung, sondern eine Zählung
 * über echte Frames. `npm run measurable` fährt sie durch; die hier
 * eingetragenen Werte sind das Ergebnis dieser Zählung, nicht ihr Ausgangspunkt
 * (README, „Wie streng die Plausibilitätsprüfung sein darf").
 */
export type MeasurableLimits = {
  /**
   * Ab diesem Winkel (Grad) gilt ein Knoten als gedreht.
   *
   * Nicht `!== 0`, und der Grund ist Rechengenauigkeit und nicht Toleranz:
   * Figma leitet `rotation` aus `relativeTransform` ab, und eine Kette aus
   * Auto-Layout und Instanzen liefert dort Werte wie `-1.4e-14`. Ein
   * Ungleich-Null-Vergleich würde daran unmessbare Elemente erzeugen, die
   * niemand gedreht hat.
   *
   * 0,1° ist die Grenze, unter der die Box nicht messbar wächst: ein 500 px
   * breiter Textrahmen wird bei 0,1° um 500 · sin(0,1°) = 0,87 px höher, also
   * um weniger als ein Pixel.
   */
  rotationDegrees: number
  /**
   * Ab diesem überdeckten Flächenanteil des Textrahmens gilt er als verdeckt.
   *
   * Nicht „irgendeine Überlappung", weil Bounding-Boxen einander in echten
   * Dateien ständig um einen Bruchteil berühren — ein Textrahmen mit fester
   * Breite reicht über das letzte Wort hinaus, und das nächste Element beginnt
   * dort. Ein solcher Saum verschiebt kein Histogramm.
   */
  occludedShare: number
  /**
   * So viel des abgetasteten Bereichs müsste die **tragende Hintergrundfläche**
   * einnehmen, damit sie als sein Hintergrund gilt — oder `null`, wenn daran
   * nichts verworfen wird.
   *
   * **GEMESSEN UND NICHT AUSGELIEFERT** (`null`). Das war meine eigene Idee für
   * das Netz, und die Messung hat sie widerlegt. Sie steht hier vollständig, weil
   * eine verworfene Prüfung mit ihren Zahlen mehr wert ist als eine stille
   * Auslassung — dieselbe Konstruktion wie `shipped: false` bei den
   * Vorhersageregeln und bei `SHIPPED_REASONS` in `non-text.ts`.
   *
   * Der Nenner wäre hier der **ganze** Bereich, Textpixel eingeschlossen — der
   * Unterschied zu `DOMINANT_SHARE` in `measure.ts`, das denselben Zähler durch
   * die *Nicht-Text*-Pixel teilt. Jenes fragt „wechselt der Hintergrund?",
   * dieses sollte fragen „ist überhaupt eine Fläche da, von der man sprechen
   * kann?".
   *
   * **WARUM ES KEINEN ARBEITSBEREICH GIBT.** Drei gemessene Werte
   * (`npm run measurable`) schließen jede Schwelle aus:
   *
   *   | Fall | Flächenanteil | soll |
   *   |---|---|---|
   *   | normale Elemente, kleinster Wert im Korpus | 0,551 | messbar |
   *   | weißer Text über Verlauf Schwarz→Weiß      | 0,034 | messbar (1.2 C5) |
   *   | weißer Text über gleichverteiltem Rauschen | 0,059 | verwerfen? |
   *
   * Das Rauschen liegt **über** dem Verlauf, nicht darunter. Der Grund ist die
   * sRGB-Kurve: gleichverteilte Bytes häufen sich im dunklen Ende der Luminanz,
   * und der unterste Bin sammelt rund ein Zehntel der Pixel. Eine Schwelle
   * zwischen beiden gibt es damit nicht — jeder Wert, der das Rauschen trifft,
   * verwirft auch den Verlauf, und der Verlauf ist in 1.2 C5 ausdrücklich als
   * messbar erklärt: gemeldet wird der schlechteste Wert, der Befund sagt, dass
   * der Grund wechselt, und die Fahne trägt ein „~". Weiß über einem Verlauf,
   * der bis Weiß läuft, **ist** am hellen Ende unlesbar. Diese Aussage gegen
   * „nicht messbar" zu tauschen wäre ein Rückschritt.
   *
   * Umgekehrt sitzt jede Schwelle unterhalb von 0,034 unter dem Wert, den selbst
   * reines Rauschen erreicht — sie würde nie greifen. Eine Prüfung, die nie
   * greift, ist keine.
   *
   * **WAS DIE PRÜFUNG ERSETZT.** Nichts, und das ist die Auskunft: die Fälle,
   * für die sie gedacht war, decken 1a (Drehung, Verdeckung) und `textCoreShare`
   * (Maske, Clipping) ab, jeder deterministisch oder mit hundertfachem Abstand.
   * Was übrig bleibt — Subpixel, Schatten, Effekte —, verschiebt den
   * Flächenanteil praktisch nicht und wäre über ihn nie zu finden gewesen.
   *
   * Der Wert wird weiter berechnet und steht in `ContrastResult.backgroundShare`
   * und in `npm run contrast-check`. Wer die Entscheidung neu aufmachen will,
   * braucht keine neue Messung, nur eine Zahl statt `null`.
   */
  backgroundShare: number | null
  /**
   * So viel des Rahmens muss die **Textfarbe** zeigen, damit der Rahmen als
   * „zeigt diesen Text" gilt.
   *
   * **Das ist keine Kontrastforderung, sondern eine Anwesenheitsforderung** —
   * der Unterschied ist wesentlich, sonst wäre die Prüfung zirkulär und würde
   * genau die Fälle verwerfen, die das Werkzeug finden soll. Gezählt werden
   * Pixel im ausgeblendeten Fenster um die Textfarbe; liegen Text und Grund
   * dicht beieinander, sind das *viele* Pixel, und ein Element mit 1,2:1
   * besteht die Prüfung mühelos. Sie schlägt nur an, wenn die angemeldete
   * Textfarbe im Rahmen praktisch nicht vorkommt — dann zeigt der Rahmen etwas
   * anderes als diesen Text.
   */
  textCoreShare: number
}

/**
 * Was ausgeliefert wird. Herleitung jeder Zahl: siehe `MeasurableLimits`.
 *
 * **Gemessen, bevor sie hier stand** (`npm run measurable`, 19 Frames mit
 * Layer-Baum, 369 Textknoten): mit diesen Werten verliert die Messung **kein
 * einziges** Element, das sie in 1.2 gemessen hat — 368 vorher, 368 nachher.
 * Der Abstand zur nächsten Schwelle ist in jeder Richtung mindestens zehnfach:
 * `textCoreShare` 0,01 gegen einen kleinsten Korpuswert von 0,133,
 * `occludedShare` 0,1 gegen 0,000, `rotationDegrees` 0,1 gegen 0,000.
 *
 * Das ist die Zahl, die zählt: eine Plausibilitätsprüfung, die bestehende
 * Ergebnisse wegnimmt, hätte falsche Werte gegen fehlende Aussagen getauscht.
 * Sie nimmt keines weg und fängt in der Gegenprobe alle drei Fälle, die sie
 * fangen soll.
 *
 * Der vierte Kandidat — `backgroundShare` — ist gemessen und **nicht**
 * ausgeliefert. Warum, steht bei ihm.
 */
export const MEASURABLE_LIMITS: MeasurableLimits = {
  rotationDegrees: 0.1,
  occludedShare: 0.1,
  backgroundShare: null,
  textCoreShare: 0.01,
}

/**
 * Alle Prüfungen aus — der Zustand von 1.2, als Vergleichspunkt für den Audit.
 *
 * Kein Schalter für Nutzer, sondern der Nullpunkt der Messung: ohne ihn wäre
 * „wie viele Elemente werden durch die Prüfung nicht messbar" nicht
 * beantwortbar, weil die Zahl vor der Prüfung fehlte.
 */
export const NO_LIMITS: MeasurableLimits = {
  rotationDegrees: Number.POSITIVE_INFINITY,
  occludedShare: Number.POSITIVE_INFINITY,
  backgroundShare: null,
  textCoreShare: 0,
}

type Rect = { x: number; y: number; width: number; height: number }

/** Ein Knoten, so weit diese Prüfungen ihn brauchen. */
type TreeNode = Pick<NodeSignal, 'id' | 'parentId'>

/**
 * Der Betrag der Drehung, die auf diesen Knoten wirkt — er selbst **und** seine
 * Vorfahren.
 *
 * Über die Vorfahren, weil `rotation` in Figma relativ zum Elternknoten ist:
 * ein Textknoten in einer gedrehten Gruppe hat selbst `rotation === 0` und
 * steht trotzdem schief auf dem Bildschirm. Nur den Knoten zu prüfen fände die
 * Gruppe, nicht ihren Inhalt — derselbe Fehler, den `isSystemChrome` mit
 * derselben Schleife vermeidet.
 *
 * Aufsummiert wird **nicht**: zwei entgegengesetzte Drehungen um 30° heben sich
 * geometrisch auf, und die Box wäre wieder achsenparallel. Gebildet wird das
 * Maximum der Beträge — die sichere Richtung, denn ob sich die Kette wirklich
 * aufhebt, hängt an Schwerpunkten, die `NodeSignal` nicht mitführt.
 */
export function rotationOf(
  node: TreeNode & { rotation?: number },
  byId: ReadonlyMap<string, TreeNode & { rotation?: number }>,
): number {
  let current: (TreeNode & { rotation?: number }) | undefined = node
  const seen = new Set<string>()
  let worst = 0
  while (current && !seen.has(current.id)) {
    worst = Math.max(worst, Math.abs(current.rotation ?? 0))
    seen.add(current.id)
    current = current.parentId ? byId.get(current.parentId) : undefined
  }
  return worst
}

/** Liegt `ancestorId` in der Elternkette von `node`? */
function isAncestor(ancestorId: string, node: TreeNode, byId: ReadonlyMap<string, TreeNode>): boolean {
  let current: TreeNode | undefined = node
  const seen = new Set<string>()
  while (current && !seen.has(current.id)) {
    if (current.id === ancestorId) return true
    seen.add(current.id)
    current = current.parentId ? byId.get(current.parentId) : undefined
  }
  return false
}

function intersection(a: Rect, b: Rect): Rect | null {
  const x0 = Math.max(a.x, b.x)
  const y0 = Math.max(a.y, b.y)
  const x1 = Math.min(a.x + a.width, b.x + b.width)
  const y1 = Math.min(a.y + a.height, b.y + b.height)
  return x1 > x0 && y1 > y0 ? { x: x0, y: y0, width: x1 - x0, height: y1 - y0 } : null
}

/**
 * Ab so vielen Überlappungen wird die Fläche nicht mehr exakt vereinigt.
 *
 * Die exakte Vereinigung läuft über ein Gitter aus allen Kanten und kostet
 * O(n³). Liegen mehr als so viele malende Elemente über einem einzigen
 * Textrahmen, ist er ohnehin verdeckt — dann wird die Summe genommen, die die
 * Vereinigung nie unterschätzt. Die Näherung kann also nur in Richtung „nicht
 * messbar" irren, und zwar in einem Fall, der es ist.
 */
const EXACT_UNION_MAX_RECTS = 24

/**
 * Fläche der Vereinigung von Rechtecken, exakt — über ein Gitter aus allen
 * vorkommenden Kanten.
 *
 * Exakt und nicht als Summe, weil zwei Elemente, die einander überlappen, sonst
 * doppelt zählen: drei Icons, die zu je 5 % über einem Textrahmen liegen und
 * sich dabei gegenseitig überdecken, wären als Summe 15 % und in Wahrheit 6 %.
 * Bei einer Schwelle von 10 % entscheidet dieser Unterschied.
 */
export function unionArea(rects: readonly Rect[]): number {
  if (rects.length === 0) return 0
  if (rects.length === 1) return rects[0].width * rects[0].height
  if (rects.length > EXACT_UNION_MAX_RECTS) {
    return rects.reduce((sum, rect) => sum + rect.width * rect.height, 0)
  }

  const xs = [...new Set(rects.flatMap((rect) => [rect.x, rect.x + rect.width]))].sort((a, b) => a - b)
  const ys = [...new Set(rects.flatMap((rect) => [rect.y, rect.y + rect.height]))].sort((a, b) => a - b)

  let area = 0
  for (let i = 0; i + 1 < xs.length; i++) {
    for (let j = 0; j + 1 < ys.length; j++) {
      const cx = (xs[i] + xs[i + 1]) / 2
      const cy = (ys[j] + ys[j + 1]) / 2
      const covered = rects.some(
        (rect) => cx > rect.x && cx < rect.x + rect.width && cy > rect.y && cy < rect.y + rect.height,
      )
      if (covered) area += (xs[i + 1] - xs[i]) * (ys[j + 1] - ys[j])
    }
  }
  return area
}

/**
 * Welcher Anteil des Textrahmens von **später gezeichneten** Elementen bedeckt
 * ist.
 *
 * WAS ALS VERDECKER ZÄHLT, und jede der drei Bedingungen schließt eine
 * Fehlmeldung aus:
 *
 *   1. **Später in der Zeichenreihenfolge** (`zIndex` größer). `collectSignals`
 *      nummeriert in Dokumentordnung, und die ist in Figma die Malordnung:
 *      Elternknoten vor Kindern, früheres Geschwister vor späterem. Ein Element
 *      *vor* dem Text liegt hinter ihm und ist genau der Hintergrund, den die
 *      Messung sucht — ein Scrim unter weißer Schrift darf sie nicht verwerfen.
 *   2. **Malt überhaupt** (`hasFill` oder `isImage`). Eine Gruppe oder ein
 *      Auto-Layout-Rahmen ohne Fill hat eine Bounding-Box über dem Text und
 *      verändert kein einziges Pixel. Ohne diese Bedingung wäre fast jeder Text
 *      in einer echten Datei „verdeckt", weil irgendein Container ihn umfasst.
 *   3. **Nicht sein eigener Vorfahr.** Folgt schon aus (1), steht aber
 *      ausdrücklich da: die Elternkette ist der Träger des Hintergrunds, nicht
 *      sein Verdecker.
 *
 * WAS DAMIT NICHT ERFASST IST: ein Element mit `opacity` zwischen `minOpacity`
 * und 1 zählt voll, obwohl es nur mischt. Das ist die sichere Richtung — die
 * gemischten Pixel gehören trotzdem nicht zum Hintergrund dieses Textes.
 */
export function occludedShare(node: NodeSignal, signals: readonly NodeSignal[]): number {
  const area = node.width * node.height
  if (area <= 0) return 0

  const byId = new Map<string, TreeNode>(signals.map((signal) => [signal.id, signal]))
  const overlaps: Rect[] = []
  for (const other of signals) {
    if (other.id === node.id) continue
    if (other.zIndex <= node.zIndex) continue
    if (!other.hasFill && !other.isImage) continue
    if (isAncestor(other.id, node, byId)) continue
    const overlap = intersection(node, other)
    if (overlap) overlaps.push(overlap)
  }

  return Math.min(1, unionArea(overlaps) / area)
}

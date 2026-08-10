/**
 * Betriebssystem-Chrome erkennen — Statusleiste und Home-Indicator.
 *
 * WOZU. Auf einem Handy-Frame liegt oben die Statusleiste („15:30", WLAN, Akku)
 * und unten der Home-Indicator. Das ist keine Gestaltung des Entwurfs, sondern
 * das Betriebssystem; einen Kontrastbefund darüber kann niemand beheben.
 *
 * WARUM ÜBER DEN NAMEN UND NICHT ÜBER DIE POSITION. Die naheliegende Regel wäre
 * „Textknoten im obersten Band eines Mobile-Frames". Sie löscht aber genau das
 * mit, was sie verschonen soll: auf einem Screen ohne Statusleiste sitzt dort
 * die Kopfzeile. Auf unserem eigenen Onboarding-Testframe steht „Willkommen
 * zurück" bei y = 84 von 852, also bei 9,8 % — jede Schwelle, die „15:30" bei
 * 3 % erwischt, ist einen Handgriff davon entfernt, eine echte Überschrift zu
 * verschlucken. Und es gibt keine Ground Truth dafür, wo eine Statusleiste
 * aufhört.
 *
 * **Die Fehlerrichtung entscheidet.** Ein Namensmuster scheitert zu Rauschen
 * hin: es übersieht eine anders benannte Statusleiste, und dann steht ein
 * Befund zu viel im Report. Die Positionsregel scheitert zu einem stillen
 * Ausfall: sie löscht eine echte Überschrift, und niemand sieht, dass sie
 * gefehlt hat.
 *
 * WAS NICHT DRIN IST. `navigation bar` — Androids Systemleiste heißt so, aber
 * App-Navigationen eben auch. Ein Muster, das beides trifft, löscht die
 * Hauptnavigation einer App aus der Prüfung.
 */

import { SKIP_TEXT } from './measurable'

/**
 * Die Muster, jeweils als Folge **ganzer Wörter**.
 *
 * Figmas eigene iOS- und Android-Komponenten heißen so, ebenso die verbreiteten
 * UI-Kits. Ein Treffer ist damit eine Aussage über die Datei, keine Schätzung
 * über Geometrie.
 */
const CHROME_PATTERNS: ReadonlyArray<readonly string[]> = [
  ['status', 'bar'],
  ['statusleiste'],
  ['statusbar'],
  ['home', 'indicator'],
]

/**
 * Zerlegt einen Ebenennamen in Wörter.
 *
 * Umlaute bleiben Wortzeichen — dieselbe Lehre wie beim Tokenizer der
 * Stichwortliste, der „Schaltfläche" einmal in „schaltfl" und „che" zerrissen
 * hat.
 */
function tokenise(name: string): string[] {
  return name
    .toLowerCase()
    .split(/[^a-z0-9äöüß]+/)
    .filter((token) => token.length > 0)
}

/**
 * Trägt dieser Name Betriebssystem-Chrome?
 *
 * **Auf Wortgrenzen, nicht als Teilstring.** Ein Teilstring-Vergleich würde eine
 * „Bewerbungsstatusleiste" verschlucken — und zwar in genau der Fehlerrichtung,
 * die mit der Entscheidung gegen die Positionsregel ausgeschlossen wurde: ein
 * stiller Ausfall an einem echten Element des Entwurfs.
 */
export function isSystemChromeName(name: string): boolean {
  const tokens = tokenise(name)
  return CHROME_PATTERNS.some((pattern) => {
    for (let start = 0; start + pattern.length <= tokens.length; start++) {
      if (pattern.every((word, index) => tokens[start + index] === word)) return true
    }
    return false
  })
}

/** Ein Knoten, so weit diese Prüfung ihn braucht. */
type ChromeNode = { id: string; parentId: string | null; name: string }

/**
 * Gehört dieser Knoten zum Betriebssystem-Chrome — er selbst oder ein Vorfahr?
 *
 * Über die Vorfahren, weil die Uhrzeit in einer Komponente „iOS Status Bar"
 * meist schlicht „15:30" heißt. Nur den Knoten selbst zu prüfen fände die
 * Leiste, aber nicht ihren Inhalt.
 */
export function isSystemChrome(node: ChromeNode, byId: ReadonlyMap<string, ChromeNode>): boolean {
  let current: ChromeNode | undefined = node
  const seen = new Set<string>()
  while (current && !seen.has(current.id)) {
    if (isSystemChromeName(current.name)) return true
    seen.add(current.id)
    current = current.parentId ? byId.get(current.parentId) : undefined
  }
  return false
}

/**
 * Der Grund, der im Report steht, wenn etwas deswegen übersprungen wird.
 *
 * Seit 1.3 steht der Wortlaut in `measurable.ts` bei allen anderen Gründen —
 * die Warnung im Panel zählt sie („2 verdeckt, 1 gedreht"), und dafür braucht
 * jeder Grund einen Code statt eines Satzes. Diese Konstante bleibt als die
 * eine Stelle, an der der Satz zum Code `chrome` gehört.
 */
export const SYSTEM_CHROME_REASON = SKIP_TEXT.chrome

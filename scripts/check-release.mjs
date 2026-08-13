// Prüft ein gebautes Plugin, bevor es in ein Release-Zip wandert.
//
// WOZU. Der Ortsprior ist das einzige Stück des Plugins, dessen Fehlen **still**
// bleibt: `HeuristicAttentionEngine` fällt ohne Asset auf die analytische
// F-Muster-Glocke zurück, ohne Meldung im Panel, ohne Fehler im Log. Wer das
// Plugin dann installiert, bekommt schlechtere Karten und keinen Hinweis
// darauf, warum. Ein Release, das den Prior verliert, sieht funktionierend aus.
//
// Deshalb prüft dieses Skript nicht, ob eine Datei existiert, sondern ob die
// **Nutzdaten im Bundle angekommen sind**: für jeden Schlüssel eine Karte in
// der erwarteten Kantenlänge, mit einer Verteilung, die kein Nullfeld ist. Die
// Schlüsselnamen allein beweisen nichts — sie überleben auch dann, wenn die
// Werte auf dem Weg verloren gingen.
import { readFile } from 'node:fs/promises'
import { Buffer } from 'node:buffer'

const CATEGORIES = ['web', 'mobile', 'desktop', 'poster']
const DURATIONS = [1, 3, 7]
/** Kantenlänge der Prior-Karten, wie `build-prior` sie schreibt. */
const EDGE = 32

const problems = []

const main = await readFile('build/main.js', 'utf8')
const html = await readFile('build/ui.html', 'utf8')

// --- Die Prior-Karten ------------------------------------------------------
//
// Der Prior liegt als 8-Bit-Feld in Base64 im Bundle. Gesucht wird pro
// Schlüssel die nächstliegende lange Base64-Zeichenkette; ihre dekodierte Länge
// muss EDGE * EDGE sein.
for (const category of CATEGORIES) {
  for (const duration of DURATIONS) {
    const key = `${category}@${duration}s`
    const at = main.indexOf(key)
    if (at < 0) {
      problems.push(`Ortsprior ${key} fehlt im Bundle`)
      continue
    }
    // Ab dem Schlüssel die erste ausreichend lange Zeichenkette in Anführungs-
    // zeichen. Base64 von 1024 Bytes sind mindestens 1366 Zeichen.
    const rest = main.slice(at, at + 8000)
    const match = rest.match(/["']([A-Za-z0-9+/]{1000,}={0,2})["']/)
    if (!match) {
      problems.push(`Ortsprior ${key}: Schlüssel vorhanden, aber keine Nutzdaten dahinter`)
      continue
    }
    const bytes = Buffer.from(match[1], 'base64')
    if (bytes.length !== EDGE * EDGE) {
      problems.push(`Ortsprior ${key}: ${bytes.length} Bytes statt ${EDGE * EDGE}`)
      continue
    }
    // Ein Feld aus lauter Nullen wäre formal gültig und praktisch kaputt.
    const max = bytes.reduce((a, b) => (b > a ? b : a), 0)
    if (max < 128) problems.push(`Ortsprior ${key}: Maximum ${max}, die Karte trägt kein Signal`)
  }
}

// --- Die Nennung, die die Lizenz verlangt ----------------------------------
//
// Liegt der Prior im Bundle, muss die CC-BY-4.0-Nennung mit ausgeliefert
// werden. Beide Hälften gehören zusammen, also werden sie zusammen geprüft.
//
// **Über beide Realms zusammen, nicht je einzeln.** Die Daten liegen im
// Hauptthread (`build/main.js`), der Nennungstext entsteht im Panel
// (`build/ui.html`) und reist als Teil der Nachricht zum Hauptthread. Eine
// Prüfung „Nennung in derselben Datei wie die Daten" wäre auf diesem Aufbau
// immer rot — sie würde eine Realm-Grenze zum Mangel erklären.
const shipped = `${main}\n${html}`
if (!shipped.includes('UEyes') || !shipped.includes('CC BY 4.0')) {
  problems.push('Der Prior liegt im Bundle, aber die CC-BY-4.0-Nennung fehlt in beiden Realms')
}

// --- Die Schriften ---------------------------------------------------------
//
// `networkAccess: none` heißt, dass die Webfonts als Data-URI im UI stecken.
// Fehlen sie, fällt das Panel still auf eine Systemschrift zurück — derselbe
// lautlose Ausfall wie beim Prior, nur harmloser.
//
// **Genau zwei, nicht „mindestens zwei".** Die Prüfung stand auf `< 2` und war
// deshalb grün, während jede Schrift zweimal im Bundle lag: `readUiCss()`
// ersetzt die Platzhalter mit `replaceAll` über die ganze Datei, und der
// Kommentar am Kopf von `src/ui/styles.css` nannte sie beim Namen. Eine
// Untergrenze sieht das nicht — sie kann nur melden, dass etwas fehlt, nicht,
// dass etwas doppelt da ist.
const fonts = (html.match(/data:font\/woff2;base64,/g) ?? []).length
if (fonts !== 2) problems.push(`build/ui.html trägt ${fonts} eingebettete Schriften, erwartet werden genau 2`)

if (problems.length > 0) {
  console.error(`\n✖ Das Build taugt nicht für ein Release:\n  - ${problems.join('\n  - ')}\n`)
  process.exit(1)
}

console.log(`✓ ${CATEGORIES.length * DURATIONS.length} Ortsprioren mit Nutzdaten, Nennung vorhanden, ${fonts} Schriften eingebettet`)

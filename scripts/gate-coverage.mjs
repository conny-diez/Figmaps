// Sagt an, welche Prüfungen diesen Lauf abdecken — und welche nicht.
//
// WOZU. Ein grüner Haken sagt nicht, worüber er grün ist. Dieses Repo hat
// mehrfach dieselbe Fehlerklasse gefunden, und meist war die Form identisch:
// eine Prüfung war grün, ohne das zu messen, was man ihr zuschrieb.
//
// Nach dem Schnitt in ein öffentliches und ein privates Repo kommt ein weiterer
// Fall in Reichweite, und diesmal absichtlich: das Eval-Gate der Vorhersage
// braucht die UEyes-Bilder, und die bleiben privat. Im öffentlichen Repo läuft
// es deshalb **nicht**. Ein PR dort wäre grün — mit einem Netz weniger, ohne dass
// es irgendwo steht.
//
// **Die Abwesenheit muss sichtbar sein.** Dieses Skript schreibt sie in die
// Zusammenfassung jedes Laufs: was abgedeckt ist, was nicht, und wo die
// Durchsetzung für das Fehlende stattfindet. Es urteilt nicht und wird nie rot —
// es ist ein Beipackzettel, kein Gate.
//
// ---
//
// **JEDE ZAHL HIER IST GEMESSEN, ODER SIE STEHT NICHT DA.**
//
// Der Anlass ist konkret und war genau die teure Fehlerrichtung: in der Zeile für
// `verify` stand „504 Tests" als Literal, während es 518 waren. Zu **hoch**, in
// dem einen Skript, dessen Aufgabe es ist, die Netze auszuweisen — und niemand
// merkt es, weil die Zahl nichts entscheidet. Dieselbe Form wie die Fälle, die
// dieses Repo dokumentiert, nur eine Ebene höher: nicht die Prüfung log, sondern
// ihr Beipackzettel.
//
// Die Regel, die daraus folgt und die `__tests__/gate-coverage.test.ts`
// durchsetzt: **in der Ausgabe darf keine Zahl vorkommen, die nicht hier
// ausgerechnet wurde.** Was sich nicht ableiten lässt, wird weggelassen —
// „Typecheck, Tests, Build, Realm-Trennung" sagt ohne Zahl genauso viel, und eine
// Zahl, die nichts entscheidet, aber falsch sein kann, ist ein schlechtes
// Geschäft.
//
// Abgeleitet wird deshalb: die Bilder der Gate-Sets (gezählt), die Frames und
// Messwerte des Contrastmap-Gates (aus der eingecheckten Erwartung), die
// Registry-Adressen im Lockfile (gezählt), die Zahl der Netze (aus der Tabelle
// selbst) — und **ob** die Wege, auf denen ein fehlendes Netz sonst durchgesetzt
// wird, überhaupt eingerichtet sind (aus den Workflow-Dateien).
import { existsSync, readdirSync, readFileSync } from 'node:fs'

/** Liegt ein Gate-Set mit Bildern vor? Gezählt, nicht angenommen. */
function fixtureSet(name) {
  const dir = `eval/fixtures/${name}/images`
  if (!existsSync(dir)) return { name, present: false, count: 0 }
  const count = readdirSync(dir).filter((file) => file.endsWith('.png')).length
  return { name, present: count > 0, count }
}

const sets = [fixtureSet('gate-web'), fixtureSet('gate-mobile')]
const images = sets.reduce((sum, set) => sum + set.count, 0)
const evalGate = sets.every((set) => set.present)

/**
 * Umfang des Contrastmap-Gates — aus der eingecheckten Erwartung, nicht aus dem
 * Gedächtnis. Sie ist die Quelle, gegen die das Gate vergleicht; was dort steht,
 * ist damit genau das, was bewacht wird.
 */
function contrastScope() {
  const path = 'eval/contrast-baseline.json'
  if (!existsSync(path)) return null
  const baseline = JSON.parse(readFileSync(path, 'utf8'))
  return { frames: baseline.frames.length, measured: baseline.totals.measured }
}

/** `resolved`-Adressen im Lockfile. Die Invariante ist „keine" — hier gezählt. */
function lockfileAddresses() {
  const path = 'package-lock.json'
  if (!existsSync(path)) return null
  return (readFileSync(path, 'utf8').match(/"resolved":/g) ?? []).length
}

/**
 * Sind die Wege eingerichtet, auf denen ein fehlendes Eval-Gate sonst
 * durchgesetzt wird?
 *
 * Gelesen wird der Text der Workflow-Dateien, **ohne Kommentarzeilen** — ein
 * `schedule:` in einem Kommentar ist keine Automatik, und die gefährliche
 * Richtung wäre hier „behauptet, es sei eingerichtet". Kein YAML-Parser, weil
 * das Skript keine Abhängigkeit tragen soll; dafür die vorsichtige Auswertung.
 */
function enforcement() {
  const dir = '.github/workflows'
  if (!existsSync(dir)) return { afterMerge: false, nightly: false, beforeRelease: false }
  const files = readdirSync(dir)
    .filter((file) => file.endsWith('.yml') || file.endsWith('.yaml'))
    .map((file) => ({
      name: file,
      body: readFileSync(`${dir}/${file}`, 'utf8')
        .split('\n')
        .filter((line) => !/^\s*#/.test(line))
        .join('\n'),
    }))
  const runsGate = (body) => /--gate\b/.test(body) || /\bcontrast-gate\b/.test(body)
  return {
    afterMerge: files.some((file) => runsGate(file.body) && /push:/.test(file.body) && /main/.test(file.body)),
    nightly: files.some((file) => runsGate(file.body) && /schedule:/.test(file.body)),
    beforeRelease: files.some((file) => runsGate(file.body) && /tags:/.test(file.body)),
  }
}

const contrast = contrastScope()
const addresses = lockfileAddresses()
const paths = enforcement()

/** Eine Zeile der Tabelle: was bewacht wird, und ob es in diesem Lauf läuft. */
const nets = [
  { check: '`verify`', guards: 'Typecheck, Tests, Build, Realm-Trennung', running: 'läuft' },
  {
    check: 'Lockfile-Invariante',
    guards:
      addresses === null
        ? 'keine Registry-Adressen im Lockfile'
        : `keine Registry-Adressen im Lockfile — gezählt: ${addresses}`,
    running: 'läuft',
  },
  {
    check: 'Contrastmap-Gate',
    guards: contrast
      ? `die **gemessene** Ausgabe, ${contrast.frames} Frames mit Layer-Baum, ${contrast.measured} Messwerte`
      : 'die **gemessene** Ausgabe',
    running: 'läuft',
  },
  {
    check: 'Eval-Gate (UEyes)',
    guards: 'die **vorhergesagte** Ausgabe',
    running: evalGate ? `läuft (${images} Bilder gefunden)` : '**läuft hier nicht**',
  },
]

const lines = []
lines.push('### Was dieser Lauf abdeckt')
lines.push('')
lines.push('| Prüfung | bewacht | Lauf |')
lines.push('|---|---|---|')
for (const net of nets) lines.push(`| ${net.check} | ${net.guards} | ${net.running} |`)
lines.push('')

if (evalGate) {
  lines.push(`Alle Netze dieser Tabelle sind gespannt (${nets.length}). Die Gate-Bilder liegen im Repo.`)
} else {
  // Der Kern: nicht „übersprungen", sondern wo es stattdessen stattfindet — und
  // ob es das schon tut. Ein Weg, der bloß vorgesehen ist, wird als vorgesehen
  // ausgewiesen; sonst wäre diese Liste dieselbe Behauptung wie ein grüner Haken
  // ohne Messung.
  lines.push('**Das Eval-Gate läuft in diesem Lauf nicht.** Die UEyes-Bilder liegen nicht in')
  lines.push('diesem Repo — sie sind Screenshots fremder Apps und Websites mit teils')
  lines.push('ungeklärter Vorgeschichte und bleiben deshalb privat.')
  lines.push('')
  lines.push('Die Vorhersage ist damit in **diesem** Lauf unbewacht. Durchgesetzt wird sie:')
  lines.push('')
  const state = (ok) => (ok ? 'eingerichtet' : '**noch nicht eingerichtet**')
  lines.push(`- **nach dem Merge** auf \`main\` — ${state(paths.afterMerge)}`)
  lines.push(`- **vor jedem Release**, am Tag — ${state(paths.beforeRelease)}`)
  lines.push(`- **nächtlich** gegen \`main\`, gegen Drift in Toolchain und Abhängigkeiten — ${state(paths.nightly)}`)
  lines.push('')
  lines.push('Ein PR aus einem Fork kann das Gate nicht vorab fahren: er bekommt keine Secrets,')
  lines.push('also keine Fixtures. Das ist eine Eigenschaft von GitHub und keine Nachlässigkeit —')
  lines.push('aber ein grüner Haken ohne diese Zeile hätte dieselbe Form wie die Fälle,')
  lines.push('die dieses Repo dokumentiert. Deshalb steht sie hier.')
}

const text = `${lines.join('\n')}\n`
process.stdout.write(text)

// In die Job-Zusammenfassung, wenn wir in Actions laufen. Lokal reicht stdout.
if (process.env.GITHUB_STEP_SUMMARY) {
  const { appendFileSync } = await import('node:fs')
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, text)
}

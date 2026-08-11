// Sagt an, welche Prüfungen diesen Lauf abdecken — und welche nicht.
//
// WOZU. Ein grüner Haken sagt nicht, worüber er grün ist. Dieses Repo hat
// sechsmal dieselbe Fehlerklasse gefunden, und in fünf der sechs Fälle war die
// Form identisch: eine Prüfung war grün, ohne das zu messen, was man ihr
// zuschrieb. Der sechste war eine Suche, die nichts fand, weil sie kaputt war.
//
// Nach dem Schnitt in ein öffentliches und ein privates Repo kommt ein siebter
// Fall in Reichweite, und diesmal absichtlich: das Eval-Gate der Vorhersage
// braucht die 40 UEyes-Bilder, und die bleiben privat. Im öffentlichen Repo läuft
// es deshalb **nicht**. Ein PR dort wäre grün — mit einem Netz weniger, ohne dass
// es irgendwo steht.
//
// **Die Abwesenheit muss sichtbar sein.** Dieses Skript schreibt sie in die
// Zusammenfassung jedes Laufs: was abgedeckt ist, was nicht, und wo die
// Durchsetzung für das Fehlende stattfindet. Es urteilt nicht und wird nie rot —
// es ist ein Beipackzettel, kein Gate.
//
// Erkannt wird der Zustand, nicht behauptet: ob die Fixtures da sind, wird
// nachgesehen. Damit läuft dasselbe Skript in beiden Repos und sagt in jedem die
// Wahrheit.
import { existsSync, readdirSync } from 'node:fs'

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

const lines = []
lines.push('### Was dieser Lauf abdeckt')
lines.push('')
lines.push('| Prüfung | bewacht | Lauf |')
lines.push('|---|---|---|')
lines.push('| `verify` | Typecheck, 504 Tests, Build, Realm-Trennung | läuft |')
lines.push('| Lockfile-Invariante | keine Registry-Adressen im Lockfile | läuft |')
lines.push('| Contrastmap-Gate | die **gemessene** Ausgabe, 20 Frames aus Generatoren | läuft |')
lines.push(
  `| Eval-Gate (UEyes) | die **vorhergesagte** Ausgabe, 40 Bilder | ${
    evalGate ? `läuft (${images} Bilder gefunden)` : '**läuft hier nicht**'
  } |`,
)
lines.push('')

if (evalGate) {
  lines.push(`Alle vier Netze sind gespannt. Die Gate-Bilder liegen im Repo (${images} Stück).`)
} else {
  // Der Kern: nicht „übersprungen", sondern wo es stattdessen stattfindet.
  lines.push('**Das Eval-Gate läuft in diesem Lauf nicht.** Die 40 UEyes-Bilder liegen nicht in')
  lines.push('diesem Repo — sie sind Screenshots fremder Apps und Websites mit teils')
  lines.push('ungeklärter Vorgeschichte und bleiben deshalb privat.')
  lines.push('')
  lines.push('Die Vorhersage ist damit in **diesem** Lauf unbewacht. Durchgesetzt wird sie:')
  lines.push('')
  lines.push('- **nach dem Merge** auf `main` — das private Gate schreibt einen Commit-Status zurück')
  lines.push('- **vor jedem Release** — ohne grünes Gate zum Tag wird nicht veröffentlicht')
  lines.push('- **nächtlich** gegen `main`, gegen Drift in Toolchain und Abhängigkeiten')
  lines.push('')
  lines.push('Ein PR aus einem Fork kann das Gate nicht vorab fahren: er bekommt keine Secrets,')
  lines.push('also keine Fixtures. Das ist eine Eigenschaft von GitHub und keine Nachlässigkeit —')
  lines.push('aber ein grüner Haken ohne diese Zeile hätte dieselbe Form wie die sechs Fälle,')
  lines.push('die dieses Repo dokumentiert. Deshalb steht sie hier.')
}

const text = `${lines.join('\n')}\n`
process.stdout.write(text)

// In die Job-Zusammenfassung, wenn wir in Actions laufen. Lokal reicht stdout.
if (process.env.GITHUB_STEP_SUMMARY) {
  const { appendFileSync } = await import('node:fs')
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, text)
}

// Macht `package-lock.json` **im Arbeitsverzeichnis des CI-Laufs** unabhängig
// von der Registry, aus der es erzeugt wurde. Die eingecheckte Datei bleibt
// unberührt — dieses Skript läuft nur auf dem Runner, vor `npm ci`.
//
// WARUM ES DAS GIBT
//
// `npm install` schreibt in jedes `resolved`-Feld die Registry, die auf der
// Maschine konfiguriert war. Steht dort ein internes Artifactory, ist das
// Lockfile außerhalb des Firmennetzes unbrauchbar: der Runner bekommt `503`,
// `npm ci` bricht ab, und mit ihm der ganze Workflow. Sechs von sechs Läufen
// seit dem 8.8.2026 sind genau daran gescheitert — inklusive des Eval-Gates aus
// A-7, das damit **nie** ausgeführt hat.
//
// WARUM NICHT EINFACHER
//
// `NPM_CONFIG_REGISTRY` allein reicht nicht. Lokal (npm 11.11) ersetzt npm den
// Host aus dem Lockfile durch den konfigurierten; auf dem GitHub-Runner tut es
// das nicht und lädt weiter von der Adresse im Lockfile. Auf ein Verhalten zu
// bauen, das zwischen zwei npm-Installationen abweicht, wäre genau die Sorte
// stiller Abhängigkeit, die dieses Projekt schon genug hat.
//
// Ein `sed` auf den Hostnamen wäre die naheliegende Alternative und ist hier
// bewusst **nicht** gewählt: der interne Hostname stünde damit wieder im Repo,
// und er soll da nicht stehen. Dieses Skript kommt ohne ihn aus, weil es gar
// nichts ersetzt, sondern die Adresse ganz entfernt.
//
// WAS DAS FÜR DIE LIEFERKETTE HEISST
//
// `integrity` bleibt in jedem Eintrag stehen und wird von `npm ci` geprüft. Was
// wegfällt, ist ausschließlich die *Bezugsquelle*, nicht die Zusicherung, was
// ankommen muss. Ein Paket mit falschem Inhalt schlägt weiterhin fehl.
//
// ZWEI BETRIEBSARTEN, und die zweite ist seit 1.3 die wichtigere
//
//   (ohne Schalter)  entfernt die Adressen aus der angegebenen Datei
//   --check          prüft nur und schlägt fehl, wenn welche drinstehen
//
// Seit 1.3 ist die **eingecheckte** Datei bereits frei von `resolved`-Adressen,
// die Bereinigung auf dem Runner also ein Leerlauf. Was bleibt, ist die Gefahr,
// dass ein `npm install` auf einer intern konfigurierten Maschine sie
// zurückschreibt und jemand das mitcommittet — lautlos, denn es funktioniert ja
// alles. `--check` macht daraus eine Invariante, die im Test und in CI rot wird,
// statt einer Reparatur, die niemand sieht.
//
// Die mutierende Betriebsart bleibt, und zwar aus einem konkreten Grund: das
// Eval-Gate baut seine Referenz in einem Worktree von `origin/main`, und jeder
// Commit von vor dieser Änderung trägt die Adressen für immer in der History.
// Läuft der Vergleich gegen einen solchen Stand, muss dort weiter bereinigt
// werden.
import { readFileSync, writeFileSync } from 'node:fs'

const args = process.argv.slice(2)
const checkOnly = args.includes('--check')
const path = args.find((arg) => !arg.startsWith('--')) ?? 'package-lock.json'
const lockfile = JSON.parse(readFileSync(path, 'utf8'))

if (checkOnly) {
  const offenders = Object.entries(lockfile.packages ?? {})
    .filter(([, entry]) => typeof entry.resolved === 'string')
    .map(([name, entry]) => [name, entry.resolved])
  if (offenders.length === 0) {
    const count = Object.values(lockfile.packages ?? {}).filter((e) => typeof e.integrity === 'string').length
    console.log(`${path}: keine resolved-Adressen, ${count} integrity-Hashes vorhanden.`)
    process.exit(0)
  }
  // Die Hosts werden **gezählt und benannt**, aber der volle Pfad nicht
  // ausgegeben: die Meldung landet in einem CI-Log, und ein Log ist kein Ort,
  // an dem eine interne Adresse zum ersten Mal auftauchen soll.
  const hosts = new Set(
    offenders.map(([, url]) => {
      try {
        return new URL(url).host
      } catch {
        return '(unlesbar)'
      }
    }),
  )
  console.error(`✖ ${path}: ${offenders.length} Einträge tragen eine resolved-Adresse.`)
  console.error(`  Betroffene Hosts: ${[...hosts].length} verschieden.`)
  console.error('')
  console.error('Das passiert nach einem `npm install` auf einer Maschine mit interner Registry.')
  console.error('Beheben mit:  node scripts/ci-lockfile.mjs package-lock.json')
  console.error('`integrity` bleibt dabei stehen, die Installation ist danach exakt dieselbe.')
  process.exit(1)
}

let cleared = 0
let withoutIntegrity = 0
for (const entry of Object.values(lockfile.packages ?? {})) {
  if (typeof entry.resolved !== 'string') continue
  // Ein Eintrag ohne `integrity` verlöre mit `resolved` seine einzige
  // Zusicherung. Das kommt bei Registry-Paketen nicht vor, und wenn doch, soll
  // es auffallen statt durchzurutschen.
  if (typeof entry.integrity !== 'string') {
    withoutIntegrity++
    continue
  }
  delete entry.resolved
  cleared++
}

if (withoutIntegrity > 0) {
  console.error(`${withoutIntegrity} Einträge haben kein integrity-Feld — deren resolved bleibt stehen.`)
  console.error('Wenn darunter ein Paket von einer internen Adresse ist, schlägt npm ci gleich fehl. Das ist beabsichtigt.')
}

writeFileSync(path, `${JSON.stringify(lockfile, null, 2)}\n`)
console.log(`${path}: ${cleared} resolved-Adressen entfernt, integrity unverändert.`)

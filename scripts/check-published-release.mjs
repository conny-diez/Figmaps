// Prüft, was eine Nutzerin am Tag tatsächlich findet.
//
// WOZU, UND ES IST EIN VORFALL UND KEINE VORSICHTSMASSNAHME. Für v1.2.0 gab es
// **zwei** Release-Objekte zum selben Tag: den Entwurf des Workflows, an dem das
// `figmaps-1.2.0.zip` hing, und ein von Hand angelegtes, veröffentlichtes
// Release ohne jedes Asset und mit der Repo-Beschreibung als Text. Wer dem Tag
// folgte, bekam die beiden automatischen „Source code"-Archive — Quellcode ohne
// `build/`, und der Figma-Import scheitert daran. Gemerkt hat es ein Kollege,
// nicht wir.
//
// Der Workflow war dabei grün. Er hatte auch alles richtig gemacht, was er
// prüfen konnte: Version gegen Tag, Ortsprior-Nutzdaten, Zip entpacken,
// `manifest.json`-Pfade. Nur die letzte Frage hat er nicht gestellt, weil sie
// zu seinem Zeitpunkt nicht beantwortbar war:
//
//     Liegt die Datei dort, wo ein Nutzer sie sucht?
//
// **Ein Entwurf kann das nicht beantworten.** Er hängt nicht am Tag; GitHub gibt
// ihm eine `untagged-…`-URL, und die Tag-Suche findet ihn überhaupt nicht
// (nachgemessen: `GET /releases/tags/v1.2.0` liefert das veröffentlichte Objekt
// mit null Assets und den Entwurf gar nicht). Die Prüfung muss deshalb dort
// laufen, wo die Antwort existiert: **nach** der Veröffentlichung.
//
// Dieselbe Klasse wie das Eval-Gate, das dreimal grün war, ohne zu messen — nur
// dass diesmal die Prüfung nicht das Falsche ansah, sondern zu früh.
//
// AUFRUF
//
//   node scripts/check-published-release.mjs v1.2.0
//   RELEASE_TAG=v1.2.0 node scripts/check-published-release.mjs
//
// Braucht `gh` mit Leserechten (im Workflow `GH_TOKEN`), weil das Repo privat
// ist und ein anonymer Abruf des Assets 404 liefert — was kein Defekt wäre,
// sondern fehlende Anmeldung. Geladen wird über den Asset-Endpunkt der API,
// also über denselben Weg, den `gh release download` und der Browser einer
// angemeldeten Kollegin nehmen.
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const tag = process.argv[2] ?? process.env.RELEASE_TAG ?? process.env.GITHUB_REF_NAME
if (!tag) {
  console.error('Aufruf: node scripts/check-published-release.mjs <tag>   (oder RELEASE_TAG=<tag>)')
  process.exit(2)
}

const problems = []
const notes = []

/** `gh api` als JSON. `null` bei 404 — das ist bei der Tag-Suche eine Antwort. */
function api(path, extra = []) {
  try {
    const out = execFileSync('gh', ['api', path, ...extra], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
    return JSON.parse(out)
  } catch (error) {
    const text = `${error.stdout ?? ''}${error.stderr ?? ''}`
    if (/HTTP 404/.test(text) || /Not Found/.test(text)) return null
    throw new Error(`gh api ${path} schlug fehl: ${text.trim().slice(0, 400)}`)
  }
}

const version = JSON.parse(readFileSync('package.json', 'utf8')).version
// Der Dateiname trägt die Beta, der Ordner im Zip nicht — siehe die Begründung
// im Pack-Schritt von `.github/workflows/release.yml`. Beides ist aus
// `package.json` abgeleitet und nicht abgeschrieben.
const expectedAsset = `figmaps-beta-${version}.zip`
const expectedDir = `figmaps-${version}`

console.log(`Prüfe das veröffentlichte Release zum Tag ${tag}.`)
console.log(`Erwartet: ein Objekt, nicht als Entwurf, als Pre-release markiert, „Beta" im Titel, mit ${expectedAsset}.`)
console.log('')

// --- 1. Wie viele Objekte tragen diesen Tag? -------------------------------
//
// Die Frage, die den Vorfall gefunden hätte. GitHub bindet einen Entwurf nicht
// an den Tag, also können ein Entwurf und ein veröffentlichtes Release
// gleichzeitig denselben `tag_name` tragen — und dann entscheidet der Zufall,
// an welchem das Asset hängt. Nachgemessen: `gh release create --draft` legt
// auch dann noch einen weiteren Entwurf an, wenn es zum Tag schon einen gibt,
// ohne Fehler und ohne Hinweis.
const all = api(`repos/:owner/:repo/releases?per_page=100`) ?? []
const forTag = all.filter((release) => release.tag_name === tag)

if (forTag.length === 0) {
  problems.push(`Kein Release-Objekt trägt den Tag ${tag}.`)
} else if (forTag.length > 1) {
  problems.push(
    `${forTag.length} Release-Objekte tragen den Tag ${tag}. Genau das ist bei v1.2.0 passiert: ` +
      'das Asset hing am Entwurf, veröffentlicht war das andere.',
  )
  for (const release of forTag) {
    problems.push(
      `   id=${release.id} ${release.draft ? 'ENTWURF' : 'veröffentlicht'} ` +
        `assets=${release.assets.length} — ${release.html_url}`,
    )
  }
}

// --- 2. Was findet die Tag-Suche? -----------------------------------------
//
// Nicht die Liste, sondern der Endpunkt, hinter dem die Seite
// `releases/tag/<tag>` steht. Ein Entwurf ist hier unsichtbar; wenn hier nichts
// steht, gibt es für den Tag nichts Öffentliches, egal wie viele Entwürfe
// daneben liegen.
const published = api(`repos/:owner/:repo/releases/tags/${tag}`)

if (!published) {
  problems.push(
    `Die Tag-Suche findet kein Release zu ${tag}. Es gibt also nichts Veröffentlichtes — ` +
      'ein Entwurf zählt nicht, er hängt nicht am Tag.',
  )
} else {
  if (published.draft) problems.push(`Das Objekt zum Tag ${tag} ist ein Entwurf.`)

  // --- 2b. Steht die Beta dort, wo sie stehen muss? -----------------------
  //
  // Der Beta-Marker ist eine Aussage über die Vorhersage (siehe
  // `src/version.ts`), und er steht an jeder Stelle, an der der Stand auftaucht:
  // Plugin-Name, Fenstertitel, Panel-Kopf, Wrapper-Frame. Am Release sind es
  // zwei Stellen, und beide sind hier prüfbar — der Titel, weil er in der
  // Release-Liste die einzige Zeile ist, die jeder sieht, und das
  // `prerelease`-Flag, weil GitHub daraus das Abzeichen macht und den Tag nicht
  // als „Latest release" führt.
  //
  // Ohne diese Prüfung wäre „überall sichtbar" eine Absicht: der Workflow setzt
  // beides nur, wenn er das Objekt selbst anlegt — bei einem von Hand
  // angelegten Release bleibt, was ein Mensch gesetzt hat.
  if (!/beta/i.test(published.name ?? '')) {
    problems.push(
      `Der Titel des Release lautet „${published.name ?? ''}" und nennt die Beta nicht. ` +
        'Erwartet wird die Form „Figmaps Beta <Version>".',
    )
  }
  if (!published.prerelease) {
    problems.push(
      'Das Release ist nicht als Pre-release markiert. GitHub führt es damit als „Latest release" — ' +
        'eine Aussage über die Vorhersage, die diese Fassung nicht deckt.',
    )
  }

  const asset = published.assets.find((a) => a.name === expectedAsset)
  if (!asset) {
    problems.push(
      `Am Release zum Tag ${tag} hängt kein ${expectedAsset}. Vorhanden: ` +
        `${published.assets.length === 0 ? 'nichts' : published.assets.map((a) => a.name).join(', ')}. ` +
        'Ohne dieses Asset sieht eine Nutzerin nur die beiden automatischen „Source code"-Archive — ' +
        'Quellcode ohne build/, der Figma-Import scheitert daran.',
    )
  } else if (asset.size === 0) {
    problems.push(`${expectedAsset} hängt am Release, ist aber 0 Bytes groß.`)
  } else {
    notes.push(`${expectedAsset}: ${asset.size} Bytes, ${asset.download_count} Downloads`)

    // --- 3. Das Asset wirklich laden und auspacken ------------------------
    //
    // Der Kern der Sache: nicht die Metadaten prüfen, sondern die Datei. Ein
    // Asset-Eintrag beweist, dass jemand etwas hochgeladen hat, nicht dass es
    // ein installierbares Plugin ist. Geprüft wird danach dasselbe, was der
    // Release-Workflow am frisch gebauten Zip prüft — nur eben an dem, was
    // wirklich im Release liegt.
    const dir = mkdtempSync(join(tmpdir(), 'figmaps-release-'))
    try {
      const zip = join(dir, expectedAsset)
      const bytes = execFileSync(
        'gh',
        ['api', `repos/:owner/:repo/releases/assets/${asset.id}`, '-H', 'Accept: application/octet-stream'],
        { maxBuffer: 256 * 1024 * 1024 },
      )
      writeFileSync(zip, bytes)
      if (bytes.length !== asset.size) {
        problems.push(`Geladen wurden ${bytes.length} Bytes, angekündigt waren ${asset.size}.`)
      }
      execFileSync('unzip', ['-q', zip, '-d', dir], { stdio: 'pipe' })

      const root = join(dir, expectedDir)
      const manifestPath = join(root, 'manifest.json')
      if (!statSync(manifestPath, { throwIfNoEntry: false })) {
        problems.push(`Im Zip liegt kein ${expectedDir}/manifest.json — Figmas Import braucht genau diese Datei.`)
      } else {
        const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
        for (const field of ['main', 'ui']) {
          const target = manifest[field]
          const stat = target ? statSync(join(root, target), { throwIfNoEntry: false }) : null
          if (!stat || stat.size === 0) {
            problems.push(`manifest.${field} zeigt auf „${target}" — dort liegt im Zip nichts.`)
          } else {
            notes.push(`manifest.${field} -> ${target} (${stat.size} Bytes)`)
          }
        }
        // Die Nutzdaten des Ortspriors, auf dem Stand, der im Release liegt.
        // Sein Fehlen bleibt zur Laufzeit still — deshalb existiert
        // `check-release.mjs`, und deshalb läuft es hier ein zweites Mal.
        try {
          execFileSync('node', [join(process.cwd(), 'scripts/check-release.mjs')], { cwd: root, stdio: 'pipe' })
          notes.push('Ortsprior-Nutzdaten und Nennung im ausgelieferten Bundle: in Ordnung')
        } catch (error) {
          const text = `${error.stdout ?? ''}${error.stderr ?? ''}`.trim()
          problems.push(`check-release.mjs auf dem ausgelieferten Zip: ${text.slice(0, 600)}`)
        }
      }
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }

  // --- 4. Steht im Text, was im Text stehen muss? -----------------------
  //
  // Die zweite Hälfte des Vorfalls, und sie wird gern übersehen: der Text des
  // veröffentlichten Release war die **Repo-Beschreibung**, 65 Zeichen, nicht
  // RELEASE.md. Damit fehlte auch der Hinweis, dass die „Source code"-Archive
  // nicht funktionieren — genau die Information, die den Kollegen den Nachmittag
  // gekostet hat.
  //
  // Geprüft wird gegen RELEASE.md und nicht gegen eine Kopie hier: es gibt eine
  // Quelle für diesen Absatz, und die Marker halten ihn auffindbar, ohne im
  // gerenderten Markdown zu erscheinen.
  const releaseMd = readFileSync('RELEASE.md', 'utf8')
  const between = releaseMd.match(/<!-- download-hinweis:anfang -->([\s\S]*?)<!-- download-hinweis:ende -->/)
  if (!between) {
    problems.push('RELEASE.md hat keinen Block zwischen <!-- download-hinweis:anfang --> und :ende.')
  } else {
    const hint = between[1].trim()
    if (!hint.includes(expectedAsset)) {
      problems.push(`Der Download-Hinweis in RELEASE.md nennt nicht ${expectedAsset}.`)
    }
    const body = (published.body ?? '').replace(/\r\n/g, '\n')
    // Zeilenweise, weil GitHub den Text unverändert speichert, aber Zeilenenden
    // normalisieren kann.
    const missing = hint
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !body.includes(line))
    if (missing.length > 0) {
      problems.push(
        `Der Text des Release enthält den Download-Hinweis aus RELEASE.md nicht. Fehlend, z. B.: ` +
          `„${missing[0].slice(0, 90)}"`,
      )
    }
    if (body.length < 500) {
      problems.push(
        `Der Text des Release ist ${body.length} Zeichen lang. RELEASE.md hat ${releaseMd.length}. ` +
          'Bei v1.2.0 stand dort die Repo-Beschreibung (65 Zeichen).',
      )
    }
  }
}

// --- Ergebnis --------------------------------------------------------------

for (const note of notes) console.log(`  ✓ ${note}`)
if (notes.length > 0) console.log('')

if (problems.length > 0) {
  console.error(`✖ ${problems.length} Punkt(e) am Release ${tag}:`)
  for (const problem of problems) console.error(`  - ${problem}`)
  console.error('')
  console.error('Solange das offen ist, findet eine Nutzerin am Tag kein installierbares Plugin.')
  process.exit(1)
}

// Der Nachweis, nicht der Haken: die Adresse, unter der die Datei liegt.
const asset = published.assets.find((a) => a.name === expectedAsset)
console.log(`Release:  ${published.html_url}`)
console.log(`Download: ${asset.browser_download_url}`)
console.log('')
console.log(`Geprüft an der Datei selbst: geladen, entpackt, manifest.json und build/ vorhanden,`)
console.log('Ortsprior-Nutzdaten im Bundle. Das ist der Stand, den eine Nutzerin bekommt.')

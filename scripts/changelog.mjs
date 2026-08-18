// Leitet aus den Commit-Botschaften einen Changelog ab — ohne Handarbeit und
// ohne eine zweite Vorstellung davon, was ein `feat` ist: die Liste der Typen
// kommt aus derselben Datei, gegen die `lefthook` jeden Commit prüft
// (`commitlint.config.js`). Durchsetzung und Changelog lesen dieselbe Quelle;
// ergänzt jemand dort einen Typ, taucht er hier auf, sobald er einen Titel
// bekommt (siehe `TITEL`).
//
// WARUM EIN EIGENES SKRIPT UND NICHT `conventional-changelog`. Dieses Repo rollt
// seine Werkzeuge als kleine, dokumentierte `.mjs` mit null Laufzeit-Abhängig-
// keiten (`build`, `eval`, `version-label`, `ci-lockfile`, `check-release`). Ein
// Generator mit großem Abhängigkeitsbaum und englischer Ausgabe fiele aus dieser
// Reihe. Diese knapp hundert Zeilen tun, was gebraucht wird, sprechen die
// Sprache des restlichen Repos und lassen sich in `scripts/__tests__` prüfen.
//
// WAS ER LIEST. `git log` je Versionsspanne (von Tag zu Tag, siehe unten). Nur
// die *erste Zeile* muss die Conventional-Commits-Form tragen; alles davor —
// die erzählenden deutschen Botschaften dieses Repos vor der Umstellung — trägt
// sie nicht und wird übersprungen. Eine Fassung ohne einen einzigen konformen
// Commit bekommt deshalb einen Hinweis auf RELEASE.md statt einer leeren Liste.
//
// AUFRUF
//
//   node scripts/changelog.mjs                 # CHANGELOG.md neu schreiben
//   node scripts/changelog.mjs --stdout        # dasselbe, aber nur ausgeben
//   node scripts/changelog.mjs --version 1.2.0 # nur den Abschnitt dieser
//                                              # Fassung, für den Release-Body
import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import commitlint from '../commitlint.config.js'

/** Die erlaubten Typen — aus der commitlint-Regel, nicht ein zweites Mal hier. */
const ERLAUBTE_TYPEN = new Set(commitlint.rules['type-enum'][2])

// Titel und Reihenfolge der sichtbaren Abschnitte. Ein Typ ohne Eintrag hier
// (etwa `docs`, `test`, `chore`) erscheint bewusst nicht im Changelog — er
// ändert nichts, was eine Nutzerin bemerkt. Breaking Changes stehen unabhängig
// vom Typ immer zuoberst.
const TITEL = {
  feat: 'Neue Funktionen',
  fix: 'Fehlerbehebungen',
  perf: 'Performance',
  refactor: 'Umbauten',
  revert: 'Zurückgenommen',
}
const BREAKING = '⚠ Breaking Changes'

/**
 * Zerlegt eine Botschaft in ihre Conventional-Commits-Teile. Gibt `null`
 * zurück, wenn die Kopfzeile die Form nicht trägt oder der Typ nicht erlaubt
 * ist — genau das trennt die konformen Commits von den erzählenden davor.
 */
export function parseCommit({ hash, subject, body }) {
  const match = /^(\w+)(?:\(([^)]+)\))?(!)?:\s+(.+)$/.exec(subject)
  if (!match) return null
  const [, type, scope, bang, description] = match
  if (!ERLAUBTE_TYPEN.has(type)) return null
  // `!` hinter dem Typ oder eine `BREAKING CHANGE:`-Fußnote im Body — beide
  // Schreibweisen der Spezifikation zählen.
  const breaking = Boolean(bang) || /^BREAKING[ -]CHANGE:/m.test(body ?? '')
  return { hash: hash.slice(0, 7), type, scope: scope ?? null, description, breaking }
}

/** Gruppiert geparste Commits nach Abschnitt, Breaking Changes zuerst. */
export function groupCommits(commits) {
  /** @type {Map<string, Array<{hash:string,scope:string|null,description:string}>>} */
  const groups = new Map()
  const add = (titel, commit) => {
    if (!groups.has(titel)) groups.set(titel, [])
    groups.get(titel).push(commit)
  }
  for (const commit of commits) {
    if (!commit) continue
    if (commit.breaking) add(BREAKING, commit)
    const titel = TITEL[commit.type]
    if (titel) add(titel, commit)
  }
  return groups
}

/** Die Abschnitte einer Fassung als Markdown — ohne die `## Version`-Zeile. */
export function renderGroups(groups) {
  const reihenfolge = [BREAKING, ...Object.values(TITEL)]
  const teile = []
  for (const titel of reihenfolge) {
    const eintraege = groups.get(titel)
    if (!eintraege || eintraege.length === 0) continue
    const zeilen = eintraege.map((c) => {
      const bereich = c.scope ? `**${c.scope}:** ` : ''
      return `- ${bereich}${c.description} (${c.hash})`
    })
    teile.push(`### ${titel}\n\n${zeilen.join('\n')}`)
  }
  return teile.join('\n\n')
}

/** Eine vollständige Fassung: Kopfzeile plus Gruppen (oder Hinweis, wenn leer). */
function renderSection(version, date, groups) {
  const kopf = date ? `## [${version}] — ${date}` : `## [${version}]`
  const rumpf = renderGroups(groups)
  if (!rumpf) {
    return `${kopf}\n\n_Keine Einträge nach Conventional-Commits-Konvention — die Notizen zu dieser Fassung stehen in RELEASE.md._`
  }
  return `${kopf}\n\n${rumpf}`
}

const git = (args) => execFileSync('git', args, { encoding: 'utf8' }).trim()

/** Alle Versions-Tags mit Datum, ältester zuerst. */
function versionTags() {
  const out = git([
    'for-each-ref',
    '--sort=creatordate',
    '--format=%(refname:short)%09%(creatordate:short)',
    'refs/tags/v*',
  ])
  if (!out) return []
  return out.split('\n').map((line) => {
    const [tag, date] = line.split('\t')
    return { tag, date, version: tag.replace(/^v/, '') }
  })
}

/** Geparste Commits einer Git-Spanne, Merges ausgenommen. */
function commitsIn(range) {
  // %x1f trennt die Felder, %x1e die Datensätze — beide kommen in
  // Commit-Text praktisch nicht vor.
  const out = git(['log', range, '--no-merges', '--format=%H%x1f%s%x1f%b%x1e'])
  if (!out) return []
  return out
    .split('\x1e')
    .map((rec) => rec.replace(/^\n/, ''))
    .filter(Boolean)
    .map((rec) => {
      const [hash, subject, body] = rec.split('\x1f')
      return parseCommit({ hash, subject, body })
    })
}

/** Der komplette Changelog als Markdown, neueste Fassung zuoberst. */
export function buildChangelog() {
  const tags = versionTags()
  const sections = []

  // Was seit dem letzten Tag auf HEAD liegt und noch keine Fassung trägt.
  const seitLetztem = tags.length ? `${tags[tags.length - 1].tag}..HEAD` : 'HEAD'
  const unreleased = groupCommits(commitsIn(seitLetztem))
  if (renderGroups(unreleased)) {
    sections.push(renderSection('Unveröffentlicht', null, unreleased))
  }

  // Je Tag die Spanne zum Vorgänger; neueste zuerst.
  for (let i = tags.length - 1; i >= 0; i--) {
    const { tag, date, version } = tags[i]
    const range = i > 0 ? `${tags[i - 1].tag}..${tag}` : tag
    sections.push(renderSection(version, date, groupCommits(commitsIn(range))))
  }

  const kopf =
    '# Changelog\n\n' +
    'Alle nennenswerten Änderungen dieses Projekts, abgeleitet aus den\n' +
    'Commit-Botschaften nach der Conventional-Commits-Konvention. Erzeugt von\n' +
    '`scripts/changelog.mjs` — von Hand geänderte Zeilen überschreibt der nächste\n' +
    'Lauf. Die erzählenden Release-Notizen stehen weiterhin in RELEASE.md.\n'
  return `${kopf}\n${sections.join('\n\n')}\n`
}

/** Nur den Abschnitt einer Fassung, in der Form für den Release-Body. */
export function buildVersionSection(version) {
  const tags = versionTags()
  const idx = tags.findIndex((t) => t.version === version || t.tag === version)
  let range
  if (idx === -1) {
    // Tag noch nicht angelegt: alles seit dem letzten vorhandenen Tag.
    range = tags.length ? `${tags[tags.length - 1].tag}..HEAD` : 'HEAD'
  } else {
    range = idx > 0 ? `${tags[idx - 1].tag}..${tags[idx].tag}` : tags[idx].tag
  }
  const groups = groupCommits(commitsIn(range))
  const rumpf = renderGroups(groups)
  if (!rumpf) {
    return '## Changelog\n\n_Diese Fassung liegt vor der Conventional-Commits-Konvention — siehe die Notizen oben._'
  }
  return `## Changelog\n\n${rumpf}`
}

function main() {
  const args = process.argv.slice(2)
  const vi = args.indexOf('--version')
  if (vi !== -1) {
    const version = args[vi + 1]
    if (!version) {
      console.error('Aufruf: node scripts/changelog.mjs --version <fassung>')
      process.exit(1)
    }
    process.stdout.write(buildVersionSection(version.replace(/^v/, '')))
    process.stdout.write('\n')
    return
  }
  const changelog = buildChangelog()
  if (args.includes('--stdout')) {
    process.stdout.write(changelog)
    return
  }
  writeFileSync('CHANGELOG.md', changelog)
  const zeilen = changelog.split('\n').filter((l) => l.startsWith('## ')).length
  console.log(`CHANGELOG.md geschrieben — ${zeilen} Fassung(en).`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
}

/**
 * Der Changelog gruppiert nur, was die Conventional-Commits-Form trägt — und er
 * trennt das verlässlich vom Erzählenden davor.
 *
 * WOZU. `scripts/changelog.mjs` steht zwischen zwei Dingen, die auseinanderlaufen
 * können: der Liste erlaubter Typen in `commitlint.config.js` (gegen die
 * `lefthook` jeden Commit prüft) und der Ausgabe, die bei Releases mitreist. Ein
 * `feat`, das die Prüfung besteht, aber im Changelog stillschweigend fehlt, wäre
 * genau die Sorte lautloser Lücke, die dieses Repo an anderer Stelle mit Tests
 * schließt.
 *
 * WARUM ALS ECHTES REPO UND NICHT ALS IMPORT. Wie `lockfile.test.ts` läuft die
 * Prüfung gegen das Skript, nicht gegen seine Innereien: ein Wegwerf-Git mit ein
 * paar Commits, dann dieselbe Kommandozeile, die auch der Release-Workflow ruft.
 * Damit ist die Spannenlogik (`git log` von Tag zu Tag) mitgeprüft, nicht nur
 * das Zerlegen einer Zeile.
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const SCRIPT = join(process.cwd(), 'scripts/changelog.mjs')

let repo: string

/** Ein Commit im Wegwerf-Repo — leer, es zählt nur die Botschaft. */
function commit(message: string): void {
  execFileSync(
    'git',
    ['-c', 'user.email=t@t', '-c', 'user.name=T', '-c', 'commit.gpgsign=false', 'commit', '-q', '--allow-empty', '-m', message],
    { cwd: repo },
  )
}

/** Das Skript im Repo laufen lassen und seine Ausgabe zurückgeben. */
function changelog(...args: string[]): string {
  return execFileSync('node', [SCRIPT, ...args], { cwd: repo, encoding: 'utf8' })
}

beforeAll(() => {
  repo = mkdtempSync(join(tmpdir(), 'figmaps-changelog-'))
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: repo })
  commit('chore: Grundgerüst, nur-aufraeumen')
  commit('Einfach nur Prosa ohne Form') // wie die Botschaften vor der Umstellung
  commit('feat(panel): Above-the-fold-Karte')
  commit('fix: Deckkraft floss nicht in die Farbe')
  commit('refactor!: Engine-API umgestellt')
  execFileSync('git', ['tag', 'v9.9.9'], { cwd: repo })
})

afterAll(() => {
  if (repo) rmSync(repo, { recursive: true, force: true })
})

describe('scripts/changelog.mjs', () => {
  it('gruppiert feat/fix und führt Breaking Changes zuoberst', () => {
    const out = changelog('--stdout')
    const breaking = out.indexOf('⚠ Breaking Changes')
    const features = out.indexOf('Neue Funktionen')
    expect(breaking).toBeGreaterThanOrEqual(0)
    expect(breaking).toBeLessThan(features)
    expect(out).toContain('**panel:** Above-the-fold-Karte')
    expect(out).toContain('Fehlerbehebungen')
    // Die Fassung erscheint unter ihrem Tag, nicht als „Unveröffentlicht".
    expect(out).toContain('## [9.9.9]')
  })

  it('lässt aus, was nichts Sichtbares ändert oder die Form nicht trägt', () => {
    const out = changelog('--stdout')
    expect(out).not.toContain('nur-aufraeumen') // chore hat keinen Changelog-Titel
    expect(out).not.toContain('Einfach nur Prosa') // keine konforme Kopfzeile
  })

  it('gibt mit --version nur den Abschnitt dieser Fassung aus, für den Release-Body', () => {
    const out = changelog('--version', '9.9.9')
    expect(out.startsWith('## Changelog')).toBe(true)
    expect(out).toContain('Above-the-fold-Karte')
    expect(out).not.toContain('## [9.9.9]') // ohne die Versions-Kopfzeile
  })
})

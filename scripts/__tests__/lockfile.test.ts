/**
 * 1.3 — das eingecheckte `package-lock.json` nennt keine Registry-Adressen.
 *
 * WOZU. Bis 1.3 trugen alle 211 `resolved`-Felder die Adresse einer internen
 * Artifactory-Instanz. Das war zweimal ein Problem: auf dem GitHub-Runner
 * unerreichbar (sechs von sechs Läufen gescheitert, das Eval-Gate lag deswegen
 * monatelang still), und bei der Frage nach einem öffentlichen Repo eine
 * Offenlegung, die sich aus HEAD entfernen lässt, aus der History aber nicht.
 *
 * Behoben ist es durch Entfernen der Felder: `integrity` bleibt in jedem
 * Eintrag und wird von `npm ci` geprüft, die Installation ist danach exakt
 * dieselbe — nachgemessen, 0 von 211 Abweichungen in Version und Hash.
 *
 * WARUM DIESER TEST UND NICHT NUR EIN CI-SCHRITT. Die Adressen kommen nicht
 * durch eine Entscheidung zurück, sondern durch ein beiläufiges `npm install`
 * auf einer intern konfigurierten Maschine. Danach funktioniert alles, nichts
 * fällt auf, und die Datei wird mitcommittet. Ein Test schlägt beim ersten
 * `npm test` an, also vor dem Commit statt danach.
 *
 * Und er prüft **beide Richtungen**: dass die echte Datei besteht, und dass die
 * Prüfung an einer Datei mit Adresse tatsächlich fehlschlägt. Eine Prüfung, von
 * der niemand gesehen hat, dass sie rot werden kann, ist ein grüner Haken —
 * dieselbe Regel wie beim Eval-Gate und beim Contrastmap-Gate.
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const SCRIPT = 'scripts/ci-lockfile.mjs'

function check(path: string): { code: number; out: string } {
  try {
    const out = execFileSync('node', [SCRIPT, '--check', path], { encoding: 'utf8' })
    return { code: 0, out }
  } catch (error) {
    const e = error as { status?: number; stdout?: string; stderr?: string }
    return { code: e.status ?? 1, out: `${e.stdout ?? ''}${e.stderr ?? ''}` }
  }
}

describe('package-lock.json nennt keine Registry-Adressen', () => {
  it('besteht die Prüfung auf der eingecheckten Datei', () => {
    const result = check('package-lock.json')
    expect(result.out).toContain('keine resolved-Adressen')
    expect(result.code).toBe(0)
  })

  it('behält für jeden Eintrag den integrity-Hash', () => {
    // Das ist die Zusicherung, die `resolved` ersetzt. Ohne sie wäre das
    // Entfernen ein Verlust an Lieferkettensicherheit und nicht bloß an
    // Bequemlichkeit.
    const lock = JSON.parse(readFileSync('package-lock.json', 'utf8')) as {
      packages: Record<string, { resolved?: string; integrity?: string; link?: boolean }>
    }
    const entries = Object.entries(lock.packages).filter(([name]) => name !== '')
    expect(entries.length).toBeGreaterThan(200)
    const withResolved = entries.filter(([, e]) => typeof e.resolved === 'string')
    const withoutIntegrity = entries.filter(([, e]) => typeof e.integrity !== 'string' && !e.link)
    expect(withResolved).toEqual([])
    expect(withoutIntegrity).toEqual([])
  })

  it('wird rot, wenn eine Adresse zurückkommt', () => {
    // Der Erreichbarkeitstest. Nachgebaut wird genau das, was ein `npm install`
    // mit interner Registry erzeugt: ein `resolved` neben einem intakten
    // `integrity`.
    const dir = mkdtempSync(join(tmpdir(), 'figmaps-lock-'))
    try {
      const lock = JSON.parse(readFileSync('package-lock.json', 'utf8')) as {
        packages: Record<string, { resolved?: string; integrity?: string }>
      }
      const victim = Object.keys(lock.packages).find((name) => name.startsWith('node_modules/'))
      expect(victim).toBeDefined()
      lock.packages[victim as string].resolved = 'https://example.invalid:443/artifactory/api/npm/x/-/x-1.0.0.tgz'
      const path = join(dir, 'package-lock.json')
      writeFileSync(path, JSON.stringify(lock, null, 2))

      const result = check(path)
      expect(result.code).toBe(1)
      expect(result.out).toContain('resolved-Adresse')
      // Der Hinweis muss sagen, wie es zu beheben ist — eine rote Prüfung ohne
      // Weg nach vorn kostet nur Zeit.
      expect(result.out).toContain('ci-lockfile.mjs')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('meldet die Hosts gezählt, nicht im Klartext', () => {
    // Die Meldung landet in einem CI-Log. Ein Log ist kein Ort, an dem eine
    // interne Adresse zum ersten Mal auftauchen soll — gezählt reicht, um zu
    // wissen, dass etwas zu tun ist.
    const dir = mkdtempSync(join(tmpdir(), 'figmaps-lock-'))
    try {
      const lock = JSON.parse(readFileSync('package-lock.json', 'utf8')) as {
        packages: Record<string, { resolved?: string }>
      }
      const victim = Object.keys(lock.packages).find((name) => name.startsWith('node_modules/')) as string
      lock.packages[victim].resolved = 'https://intern.example.invalid:443/artifactory/api/npm/repo/-/x-1.0.0.tgz'
      const path = join(dir, 'package-lock.json')
      writeFileSync(path, JSON.stringify(lock, null, 2))

      const result = check(path)
      expect(result.code).toBe(1)
      expect(result.out).not.toContain('intern.example.invalid')
      expect(result.out).toMatch(/\d+ verschieden/)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

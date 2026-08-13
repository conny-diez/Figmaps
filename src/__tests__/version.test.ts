/**
 * Die zwei Fassungen der Version — und die Zusage, dass sie dieselbe sind.
 *
 * `1.0.0-beta.1` ist Semver und heißt so am Tag, am Zip und im
 * Versionsabgleich des Workflows. Angezeigt wird „1.0.0 Beta 1". Umgeformt wird
 * an zwei Orten, weil eine YAML-Datei kein TypeScript importieren kann:
 * `humanVersion()` in `src/version.ts` für das Plugin und
 * `scripts/version-label.mjs` für alles, was von außen kommt.
 *
 * Zwei Orte driften. Deshalb ruft dieser Test das Skript wirklich auf und hält
 * sein Ergebnis gegen die Funktion — für die ausgelieferte Version und für die
 * Formen, die als Nächstes vorkommen.
 */
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { humanVersion, PLUGIN_LABEL, PLUGIN_VERSION } from '../version'

const CASES = ['1.0.0-beta.1', '1.0.0-beta.12', '1.2.3-rc.2', '1.0.0', '2.0.0-alpha.1']

/** Die lesbare Fassung, wie der Release-Workflow sie bekommt. */
function fromScript(version?: string): string {
  return execFileSync('node', ['scripts/version-label.mjs', ...(version ? [version] : [])], {
    encoding: 'utf8',
  })
}

describe('Version', () => {
  it('formt Semver-Vorabversionen in die lesbare Fassung', () => {
    expect(humanVersion('1.0.0-beta.1')).toBe('1.0.0 Beta 1')
    expect(humanVersion('1.0.0-beta.12')).toBe('1.0.0 Beta 12')
    expect(humanVersion('1.2.3-rc.2')).toBe('1.2.3 RC 2')
  })

  it('lässt eine Fassung, die sie nicht kennt, unverändert', () => {
    // Nicht raten: lieber ein Bindestrich im Panel als eine Beschriftung, die
    // eine andere Version behauptet.
    expect(humanVersion('1.0.0')).toBe('1.0.0')
    expect(humanVersion('1.0.0-beta')).toBe('1.0.0-beta')
    expect(humanVersion('1.0.0+build.7')).toBe('1.0.0+build.7')
  })

  it('stimmt mit `scripts/version-label.mjs` überein', () => {
    for (const version of CASES) {
      expect(fromScript(version), version).toBe(humanVersion(version))
    }
  })

  it('nennt die Version aus package.json und nur die', () => {
    const packaged = (JSON.parse(readFileSync('package.json', 'utf8')) as { version: string }).version
    expect(PLUGIN_VERSION).toBe(packaged)
    expect(PLUGIN_LABEL).toBe(humanVersion(packaged))
    // Und das Skript, ohne Argument, liest dieselbe Datei.
    expect(fromScript()).toBe(PLUGIN_LABEL)
  })

  it('trägt die Vorabversion sichtbar, solange package.json eine nennt', () => {
    // Die Zusage aus der Umstellung: eine Vorabversion ist im Panel als solche
    // erkennbar. Wäre `PLUGIN_LABEL` der nackte Kern („1.0.0"), stünde im Kopf
    // eine Zahl, die es als Release nicht gibt.
    if (PLUGIN_VERSION.includes('-')) {
      expect(PLUGIN_LABEL).toMatch(/\b(Beta|RC|Alpha)\b/)
      expect(PLUGIN_LABEL).not.toBe(PLUGIN_VERSION.split('-')[0])
    }
  })
})

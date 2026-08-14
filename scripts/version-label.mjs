// Gibt die lesbare Fassung der Version aus: `1.0.0-beta.1` -> `1.0.0 Beta 1`.
//
// WOZU EIN EIGENES SKRIPT. Der Release-Workflow braucht diese Form für den Titel
// des Release, und das Panel braucht sie für Kopf, Fenstertitel und die Fußzeile
// der Ausgabe. Das Panel liest sie aus `src/version.ts` (Build-Zeit-Konstante);
// eine YAML-Datei kann kein TypeScript importieren, und `sed` im Workflow wäre
// die zweite Fassung derselben Regel — also steht sie hier für alles, was von
// außen kommt.
//
// ZWEI FASSUNGEN BLEIBEN ZWEI FASSUNGEN, also werden sie geprüft:
// `src/__tests__/version.test.ts` ruft dieses Skript auf und hält sein Ergebnis
// gegen `humanVersion()` aus `src/version.ts`. Laufen sie auseinander, fällt der
// Test — nicht das Release.
//
// AUFRUF
//
//   node scripts/version-label.mjs            # Version aus package.json
//   node scripts/version-label.mjs 1.0.0-rc.2 # eine bestimmte Version
import { readFileSync } from 'node:fs'

/** Muss Zeichen für Zeichen dasselbe tun wie `humanVersion` in `src/version.ts`. */
export function humanVersion(version) {
  const match = /^(\d+\.\d+\.\d+)-([a-z]+)\.(\d+)$/.exec(version)
  if (!match) return version
  const [, core, name, number] = match
  const label = name === 'rc' ? 'RC' : `${name[0].toUpperCase()}${name.slice(1)}`
  return `${core} ${label} ${number}`
}

const argument = process.argv[2]
const version = argument ?? JSON.parse(readFileSync('package.json', 'utf8')).version
process.stdout.write(humanVersion(version))

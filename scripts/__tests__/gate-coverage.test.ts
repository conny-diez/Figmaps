/**
 * Der Beipackzettel darf keine Zahl behaupten, die er nicht gemessen hat.
 *
 * **Der Anlass.** In der `verify`-Zeile stand „504 Tests" als Literal, während es
 * 518 waren — zu hoch, in genau dem Skript, dessen Aufgabe es ist, die Netze
 * auszuweisen, und niemandem fällt es auf, weil die Zahl nichts entscheidet.
 * Dieselbe Form wie die Fälle, die dieses Repo dokumentiert, eine Ebene höher:
 * nicht die Prüfung log, sondern ihr Beipackzettel.
 *
 * **Die Prüfung ist deshalb nicht „steht 518 da", sondern die Regel selbst:** jede
 * Zahl in der Ausgabe muss aus einer Quelle im Repo stammen, die dieser Test
 * unabhängig liest. Eine neue Zahl, die jemand hineinschreibt, fällt hier auf,
 * ohne dass jemand an diesen Test denken musste.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/** Die Ausgabe des Skripts, so wie CI sie in die Zusammenfassung schreibt. */
const output = execFileSync('node', ['scripts/gate-coverage.mjs'], { encoding: 'utf8' })

/** Bilder der beiden Gate-Sets — unabhängig gezählt. */
function images(): number {
  return ['gate-web', 'gate-mobile'].reduce((sum, set) => {
    const dir = `eval/fixtures/${set}/images`
    if (!existsSync(dir)) return sum
    return sum + readdirSync(dir).filter((file) => file.endsWith('.png')).length
  }, 0)
}

const baseline = JSON.parse(readFileSync('eval/contrast-baseline.json', 'utf8')) as {
  frames: unknown[]
  totals: { measured: number }
}
const addresses = (readFileSync('package-lock.json', 'utf8').match(/"resolved":/g) ?? []).length
/**
 * Zeilen der Tabelle ohne die Kopfzeile — die Zahl der Netze. Die Trennlinie
 * (`|---|`) fängt ohne Leerzeichen an und ist damit schon draußen.
 */
const netRows = output
  .split('\n')
  .filter((line) => line.startsWith('| ') && !line.startsWith('| Prüfung')).length

describe('gate-coverage', () => {
  it('nennt keine Zahl, die nicht aus einer Quelle im Repo kommt', () => {
    const allowed = new Set(
      [images(), baseline.frames.length, baseline.totals.measured, addresses, netRows].map(String),
    )
    const found = output.match(/\d+/g) ?? []
    const stray = [...new Set(found)].filter((number) => !allowed.has(number))
    expect(
      stray,
      `Zahlen ohne Quelle: ${stray.join(', ')} — erlaubt sind ${[...allowed].join(', ')}. ` +
        'Ableiten oder weglassen (siehe Kopf von scripts/gate-coverage.mjs).',
    ).toEqual([])
  })

  it('nennt den Umfang des Contrastmap-Gates aus der eingecheckten Erwartung', () => {
    expect(output).toContain(`${baseline.frames.length} Frames mit Layer-Baum`)
    expect(output).toContain(`${baseline.totals.measured} Messwerte`)
  })

  it('zählt die Gate-Bilder, statt sie zu nennen', () => {
    const count = images()
    if (count > 0) {
      expect(output).toContain(`läuft (${count} Bilder gefunden)`)
    } else {
      expect(output).toContain('**läuft hier nicht**')
    }
  })

  it('schreibt der `verify`-Zeile keine Testzahl mehr zu', () => {
    // Die Zahl liegt nicht in Reichweite dieses Skripts — es läuft neben den
    // Tests, nicht nach ihnen. „Typecheck, Tests, Build, Realm-Trennung" sagt
    // ohne Zahl genauso viel.
    const row = output.split('\n').find((line) => line.startsWith('| `verify`'))
    expect(row).toBeDefined()
    expect(row).not.toMatch(/\d/)
  })
})

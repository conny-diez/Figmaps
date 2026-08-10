/**
 * 1.3 — das zweite Gate, und der Beweis, dass es rot werden kann.
 *
 * Das Gate läuft hier **und** im CI, und das ist keine Doppelung: der Test gibt
 * die Rückmeldung beim Entwickeln, der CI-Schritt beweist, dass der ganze Weg
 * bis zum Exit-Code rot wird. Beim ersten Gate (A-7) hat genau diese
 * Unterscheidung gefehlt — es war dreimal grün, ohne zu messen.
 *
 * WAS HIER GEPRÜFT WIRD, in dieser Reihenfolge:
 *
 *   1. Die eingecheckte Erwartung stimmt mit dem Code überein.
 *   2. Der Vergleich merkt jede der drei Zahlen — einzeln.
 *   3. Der Vergleich merkt einen Frame, der aus dem Korpus fällt. Das ist die
 *      gefährlichste Abweichung: die Summen sinken, und das sieht aus wie
 *      „weniger Befunde".
 *   4. Zwei absichtlich verschlechterte Läufe MÜSSEN abweichen.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { NO_LIMITS } from '../../src/contrast/measurable'
import {
  compareContrastGate,
  CONTRAST_BASELINE_PATH,
  CONTRAST_GATE_VARIANTS,
  runContrastGate,
  serialiseContrastGate,
  type ContrastGateReport,
} from '../contrast-gate'

function baseline(): ContrastGateReport {
  return JSON.parse(readFileSync(CONTRAST_BASELINE_PATH, 'utf8')) as ContrastGateReport
}

describe('Contrastmap-Gate', () => {
  it('stimmt mit der eingecheckten Erwartung überein', () => {
    // Das Gate selbst. Wird es rot, ist entweder die Messung anders geworden
    // oder ein Generator — beides ist eine Aussage, die in den PR-Text gehört.
    const differences = compareContrastGate(baseline(), runContrastGate())
    expect(differences, differences.join('\n')).toEqual([])
  })

  it('beschreibt denselben Korpus, den es messen soll', () => {
    // Eine Erwartung über 6 Varianten gegen einen Lauf mit 4 verglichen wäre
    // grün aus dem falschen Grund: andere Frames, zufällig passende Summen.
    expect(baseline().variants).toBe(CONTRAST_GATE_VARIANTS)
    expect(baseline().frames).toHaveLength(runContrastGate().frames.length)
  })

  it('schreibt die Datei genau so, wie sie im Repo liegt', () => {
    // Sonst erzeugt jeder `--write`-Lauf einen Diff aus Formatierung, und die
    // eigentliche Bewegung der Zahlen verschwindet darin.
    expect(serialiseContrastGate(runContrastGate())).toBe(readFileSync(CONTRAST_BASELINE_PATH, 'utf8'))
  })

  it('bewacht die Summen, die es behauptet', () => {
    const report = runContrastGate()
    expect(report.totals.measured).toBe(report.frames.reduce((sum, frame) => sum + frame.measured, 0))
    expect(report.totals.failed).toBe(report.frames.reduce((sum, frame) => sum + frame.failed, 0))
    expect(report.totals.notMeasurable).toBe(report.frames.reduce((sum, frame) => sum + frame.notMeasurable, 0))
    // Und die drei Zahlen sind nicht entartet: ein Gate, dessen Spalten alle
    // null sind, kann nichts halten. Das ist der Zustand, in dem das erste Gate
    // auf dem UEyes-Set für die Contrastmap steht.
    expect(report.totals.measured).toBeGreaterThan(100)
    expect(report.totals.failed).toBeGreaterThan(0)
    expect(report.totals.notMeasurable).toBeGreaterThan(0)
  })
})

describe('das Gate kann rot werden', () => {
  const reference = () => baseline()

  it('merkt jede der drei Zahlen einzeln', () => {
    for (const key of ['measured', 'failed', 'notMeasurable'] as const) {
      const moved = reference()
      moved.frames = moved.frames.map((frame, index) => (index === 0 ? { ...frame, [key]: frame[key] + 1 } : frame))
      const differences = compareContrastGate(moved, runContrastGate())
      expect(differences, `${key} wurde nicht bemerkt`).toHaveLength(1)
      expect(differences[0]).toContain(key)
    }
  })

  it('merkt einen Frame, der aus dem Korpus fällt', () => {
    const shorter = reference()
    const dropped = shorter.frames[3].label
    shorter.frames = shorter.frames.filter((frame) => frame.label !== dropped)
    const differences = compareContrastGate(shorter, runContrastGate())
    expect(differences.some((line) => line.startsWith('NEU im Korpus') && line.includes(dropped))).toBe(true)
  })

  it('merkt einen Frame, der neu dazukommt', () => {
    const longer = reference()
    longer.frames = [...longer.frames, { label: 'erfunden', measured: 1, failed: 1, notMeasurable: 1 }]
    const differences = compareContrastGate(longer, runContrastGate())
    expect(differences.some((line) => line.startsWith('FEHLT im Korpus') && line.includes('erfunden'))).toBe(true)
  })

  it('verweigert den Vergleich gegen einen anderen Korpus', () => {
    const other = { ...reference(), variants: CONTRAST_GATE_VARIANTS + 1 }
    const differences = compareContrastGate(other, runContrastGate())
    expect(differences).toHaveLength(1)
    expect(differences[0]).toContain('anderer')
  })

  it('wird rot, wenn die Plausibilitätsprüfung abgeschaltet ist', () => {
    // Der Erreichbarkeitstest für 1a: hört die Erkennung von Drehung und
    // Verdeckung auf zu greifen, wird die Gegenprobe wieder vollständig
    // „gemessen" — mit Werten über Fremdpixel.
    const differences = compareContrastGate(reference(), runContrastGate({ limits: NO_LIMITS }))
    expect(differences.length).toBeGreaterThan(0)
    expect(differences.some((line) => line.includes('notMeasurable 3 → 0'))).toBe(true)
  })

  it('wird rot, wenn die Messung auf einem verkleinerten Bild läuft', () => {
    // Der historische Fehler Nr. 3 in Reinform, und der Grund, warum dieses Gate
    // überhaupt existiert: auf dem Analysebild (1024 px gedeckelt) war zwischen
    // den Glyphen kein reiner Hintergrund mehr übrig. Die Unit-Tests waren
    // damals grün — sie prüfen die Rechnung, nicht den Weg.
    //
    // Bemerkenswert dabei: erkannt wird es von der Prüfung aus 1b. Bei 200 px
    // ist der Textkern verschwunden, und die Messung sagt „Text im Rahmen nicht
    // zu sehen" statt eine Zahl über den Grund zu melden.
    const differences = compareContrastGate(reference(), runContrastGate({ maxEdge: 200 }))
    expect(differences.length).toBeGreaterThan(0)
    expect(differences.some((line) => line.includes('measured') && line.includes('→ 0'))).toBe(true)
  })
})

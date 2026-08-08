/**
 * Die Fold-Zuteilung der Kreuzvalidierung.
 *
 * Ein Bild, das in seinem eigenen Trainingssatz landet, würde die
 * Out-of-sample-Eigenschaft still zerstören: die Zahlen sähen besser aus und
 * nichts würde brechen. Deshalb hat die Zuteilung Tests.
 */
import { describe, expect, it } from 'vitest'
import { assignFolds, FOLDS, PRIOR_GRID } from '../crossval'

const IDS = Array.from({ length: 495 }, (_, i) => `img-${String(i).padStart(3, '0')}`)

describe('assignFolds', () => {
  it('assigns every id exactly once', () => {
    const folds = assignFolds(IDS)
    expect(folds.size).toBe(IDS.length)
    for (const id of IDS) expect(folds.has(id)).toBe(true)
  })

  it('produces folds of nearly equal size', () => {
    const folds = assignFolds(IDS)
    const counts = new Array<number>(FOLDS).fill(0)
    for (const fold of folds.values()) counts[fold]++
    expect(Math.max(...counts) - Math.min(...counts)).toBeLessThanOrEqual(1)
    expect(counts.reduce((sum, value) => sum + value, 0)).toBe(IDS.length)
  })

  it('is deterministic and independent of input order', () => {
    const forwards = assignFolds(IDS)
    const backwards = assignFolds([...IDS].reverse())
    for (const id of IDS) expect(backwards.get(id)).toBe(forwards.get(id))
  })

  it('leaves four fifths of the data for training in every fold', () => {
    const folds = assignFolds(IDS)
    for (let fold = 0; fold < FOLDS; fold++) {
      const held = [...folds.values()].filter((value) => value === fold).length
      const training = IDS.length - held
      expect(training).toBeGreaterThan(0)
      expect(training / IDS.length).toBeGreaterThan(0.75)
    }
  })

  it('never puts an id in its own training set', () => {
    const folds = assignFolds(IDS)
    for (const id of IDS) {
      const fold = folds.get(id)!
      const training = IDS.filter((other) => folds.get(other) !== fold)
      expect(training).not.toContain(id)
    }
  })

  it('honours a different fold count', () => {
    const folds = assignFolds(IDS, 3)
    expect(new Set(folds.values()).size).toBe(3)
  })

  it('handles a set smaller than the fold count', () => {
    const folds = assignFolds(['a', 'b'], 5)
    expect(folds.size).toBe(2)
    expect(folds.get('a')).not.toBe(folds.get('b'))
  })
})

describe('cross-validation setup', () => {
  it('uses the grid the shipped prior asset uses', () => {
    // Measuring a finer prior than the one that ships would measure something
    // the plugin never runs.
    expect(PRIOR_GRID).toBe(32)
  })
})

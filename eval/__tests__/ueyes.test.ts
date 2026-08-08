/**
 * A-2 — the UEyes import.
 *
 * The index file is the only thing deciding which images are used and how they
 * are split, so parsing it wrong would silently produce a measurement of the
 * wrong data. Every branch that could do that has a test.
 */
import { describe, expect, it } from 'vitest'
import { isWebRow, parseIndexCsv, resolveDatasetRoot, splitOf } from '../ueyes'

const RELEASE_CSV = [
  'Image Name;Category;Block;Train/Test',
  '2021b7.png;desktop;0;Train',
  '9efc81.png;web;1;Train',
  'cac69c.png;web;55;Test',
  'poster1.png;poster;2;Test',
].join('\r\n')

describe('parseIndexCsv', () => {
  it('reads the shipped semicolon format with CRLF endings', () => {
    const rows = parseIndexCsv(RELEASE_CSV)
    expect(rows).toHaveLength(4)
    expect(rows[1]).toEqual({ imageName: '9efc81.png', category: 'web', block: '1', split: 'Train' })
    // A stray \r would make every split value unmatchable.
    expect(rows[2].split).toBe('Test')
  })

  it('handles a comma-separated file and a missing trailing newline', () => {
    const rows = parseIndexCsv('Image Name,Category,Block,Train/Test\na.png,web,0,Train\nb.png,web,1,Test')
    expect(rows.map((row) => row.imageName)).toEqual(['a.png', 'b.png'])
    expect(rows[1].split).toBe('Test')
  })

  it('finds columns by header, not by position', () => {
    const rows = parseIndexCsv('Train/Test;Category;Image Name;Block\nTest;web;x.png;3')
    expect(rows[0]).toEqual({ imageName: 'x.png', category: 'web', block: '3', split: 'Test' })
  })

  it('names the missing column instead of returning empty rows', () => {
    expect(() => parseIndexCsv('Image Name;Block\na.png;0')).toThrow(/"category"/i)
  })

  it('rejects a file without data rows', () => {
    expect(() => parseIndexCsv('Image Name;Category;Block;Train/Test')).toThrow(/Datenzeilen/)
  })
})

describe('category and split mapping', () => {
  it('accepts both spellings of the web category', () => {
    // The dataset README says "webpage", the released CSV says "web".
    expect(isWebRow({ imageName: 'a', category: 'web', block: '0', split: 'Train' })).toBe(true)
    expect(isWebRow({ imageName: 'a', category: 'webpage', block: '0', split: 'Train' })).toBe(true)
    expect(isWebRow({ imageName: 'a', category: 'WEB', block: '0', split: 'Train' })).toBe(true)
  })

  it('excludes the other three UI types', () => {
    for (const category of ['desktop', 'mobile', 'poster']) {
      expect(isWebRow({ imageName: 'a', category, block: '0', split: 'Train' })).toBe(false)
    }
  })

  it("takes over the dataset's own split rather than inventing one", () => {
    expect(splitOf({ imageName: 'a', category: 'web', block: '0', split: 'Train' })).toBe('tuning')
    expect(splitOf({ imageName: 'a', category: 'web', block: '0', split: 'Test' })).toBe('test')
    expect(splitOf({ imageName: 'a', category: 'web', block: '0', split: 'test' })).toBe('test')
  })

  it('refuses to guess for an unknown split value', () => {
    expect(splitOf({ imageName: 'a', category: 'web', block: '0', split: 'Validation' })).toBeNull()
    expect(splitOf({ imageName: 'a', category: 'web', block: '0', split: '' })).toBeNull()
  })
})

describe('resolveDatasetRoot', () => {
  it('prefers the explicit path over the environment', () => {
    expect(resolveDatasetRoot('.', { UEYES_DIR: '/nope' })).toBe('.')
  })

  it('falls back to UEYES_DIR', () => {
    expect(resolveDatasetRoot(undefined, { UEYES_DIR: '.' })).toBe('.')
  })

  it('explains what to do when no path is given at all', () => {
    expect(() => resolveDatasetRoot(undefined, {})).toThrow(/UEYES_DIR/)
  })

  it('names the folder it could not find', () => {
    expect(() => resolveDatasetRoot('/definitely/not/here', {})).toThrow(/definitely\/not\/here/)
  })
})

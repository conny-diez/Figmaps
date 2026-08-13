/**
 * Betriebssystem-Chrome — und die Wortgrenze, die eine echte Kopfzeile rettet.
 */
import { describe, expect, it } from 'vitest'
import type { Bitmap } from '../../engine/ops'
import type { NodeSignal } from '../../messages'
import { isSystemChrome, isSystemChromeName } from '../system-chrome'
import { measureContrast } from '../measure'
import { measureNonTextContrast } from '../non-text'

describe('isSystemChromeName', () => {
  it('trifft die vier vereinbarten Muster', () => {
    for (const name of ['Status Bar', 'iOS Status Bar', 'Statusleiste', 'StatusBar', 'Home Indicator', 'status-bar']) {
      expect(isSystemChromeName(name), name).toBe(true)
    }
  })

  it('verschluckt keine Bewerbungsstatusleiste', () => {
    // Der Fall, an dem sich Teilstring und Wortgrenze unterscheiden — und er
    // fällt in genau die Fehlerrichtung, die mit der Entscheidung gegen die
    // Positionsregel ausgeschlossen wurde: ein stiller Ausfall an einem echten
    // Element des Entwurfs.
    expect(isSystemChromeName('Bewerbungsstatusleiste')).toBe(false)
    expect(isSystemChromeName('Statusleiste Bewerbung')).toBe(true)
  })

  it('lässt Navigationen in Ruhe', () => {
    // „navigation bar" ist bewusst nicht in der Liste: Androids Systemleiste
    // heißt so, App-Navigationen aber auch.
    for (const name of ['Navigation Bar', 'Navigationsleiste', 'Bottom Navigation', 'Tab Bar']) {
      expect(isSystemChromeName(name), name).toBe(false)
    }
  })
})

function node(o: Partial<NodeSignal>): NodeSignal {
  return {
    id: 'n', parentId: null, name: 'Element', type: 'FRAME',
    x: 0, y: 0, width: 60, height: 16, zIndex: 1, opacity: 1,
    isText: false, isImage: false, hasFill: true, hasReactions: false,
    nameHints: [], ...o,
  }
}

describe('isSystemChrome über die Vorfahren', () => {
  it('erkennt die Uhrzeit an ihrer Elternkomponente', () => {
    const bar = node({ id: 'bar', name: 'iOS Status Bar' })
    const time = node({ id: 'time', parentId: 'bar', name: '15:30', isText: true })
    const byId = new Map([bar, time].map((entry) => [entry.id, entry]))
    expect(isSystemChrome(time, byId)).toBe(true)
    expect(isSystemChrome(node({ id: 'x', name: 'Überschrift' }), byId)).toBe(false)
  })
})

function canvas(w: number, h: number): Bitmap {
  const data = new Uint8ClampedArray(w * h * 4)
  for (let p = 0; p < data.length; p += 4) { data[p]=255; data[p+1]=255; data[p+2]=255; data[p+3]=255 }
  return { width: w, height: h, data }
}

describe('beide Pfade nehmen dieselbe Ausnahme', () => {
  const image = canvas(200, 100)
  const bar = node({ id: 'bar', name: 'Status Bar', width: 200, height: 20 })
  const time = node({ id: 'time', parentId: 'bar', name: '15:30', isText: true, fontSize: 12, fillLuminance: 0, x: 4, y: 2, width: 40, height: 14 })
  const wifi = node({ id: 'wifi', parentId: 'bar', name: 'WLAN', hasReactions: true, x: 160, y: 2, width: 16, height: 14 })
  const echt = node({ id: 'echt', name: 'Anmelden Button', nameHints: ['button'], hasReactions: true, x: 20, y: 50, width: 120, height: 30 })

  it('1.4.3 überspringt die Uhrzeit und sagt warum', () => {
    const { results, skipped } = measureContrast({ image, signals: [bar, time, wifi, echt], frameWidth: 200, frameHeight: 100 })
    expect(results.map((entry) => entry.nodeId)).not.toContain('time')
    expect(skipped.find((entry) => entry.nodeId === 'time')?.reason).toBe('chrome')
  })

  it('1.4.11 überspringt die Symbole daneben — sonst bliebe halbes Chrome stehen', () => {
    const { results, skipped } = measureNonTextContrast({ image, signals: [bar, time, wifi, echt], frameWidth: 200, frameHeight: 100 })
    expect(results.map((entry) => entry.nodeId)).not.toContain('wifi')
    expect(results.map((entry) => entry.nodeId)).not.toContain('bar')
    expect(skipped.find((entry) => entry.nodeId === 'wifi')?.reason).toBe('chrome')
    // Das echte Bedienelement bleibt drin.
    expect(results.map((entry) => entry.nodeId)).toContain('echt')
  })
})

/**
 * WCAG 1.4.11 — was geprüft wird und was ausdrücklich nicht.
 *
 * Der Fall, der diese Regel definiert, ist der gelbe Knopf: gegen den
 * cremefarbenen Grund hat er rund 1,2:1 und wäre nach einer naiven Lesart ein
 * Durchfaller. Nach der Norm ist er keiner, weil seine Beschriftung ihn
 * identifiziert. Genau diese Fehlmeldung produzieren rasterbasierte Werkzeuge.
 */
import { describe, expect, it } from 'vitest'
import type { Bitmap } from '../../engine/ops'
import type { NodeSignal } from '../../messages'
import { measureNonTextContrast, reasonFor, reportableNonText } from '../non-text'

type Rgb = [number, number, number]

function canvas(w: number, h: number, c: Rgb): Bitmap {
  const data = new Uint8ClampedArray(w * h * 4)
  for (let p = 0; p < data.length; p += 4) { data[p]=c[0]; data[p+1]=c[1]; data[p+2]=c[2]; data[p+3]=255 }
  return { width: w, height: h, data }
}

function fill(image: Bitmap, x: number, y: number, w: number, h: number, c: Rgb): void {
  for (let py = y; py < y + h; py++) for (let px = x; px < x + w; px++) {
    const p = (py * image.width + px) * 4
    image.data[p]=c[0]; image.data[p+1]=c[1]; image.data[p+2]=c[2]
  }
}

function node(o: Partial<NodeSignal>): NodeSignal {
  return {
    id: 'n', parentId: null, name: 'Element', type: 'FRAME',
    x: 0, y: 0, width: 100, height: 40, zIndex: 1, opacity: 1,
    isText: false, isImage: false, hasFill: true, hasReactions: false,
    nameHints: [], ...o,
  }
}

const CREME: Rgb = [250, 247, 240]
const GELB: Rgb = [255, 214, 0]

describe('Prüfumfang', () => {
  it('nimmt Prototype-Interaktion und Stichwort auf', () => {
    expect(reasonFor(node({ hasReactions: true }), [], 400, 800)).toBe('reaktion')
    expect(reasonFor(node({ nameHints: ['button'] }), [], 400, 800)).toBe('stichwort')
  })

  it('lässt Fotos aus — Messgrund, nicht Normgrund', () => {
    expect(reasonFor(node({ isImage: true, hasReactions: true }), [], 400, 800)).toBeNull()
  })

  it('lässt Flächen aus, die als Hintergrund durchgehen', () => {
    expect(reasonFor(node({ hasReactions: true, width: 400, height: 600 }), [], 400, 800)).toBeNull()
  })

  it('erkennt Trennlinien und Wiederholungen — beide nicht ausgeliefert', () => {
    expect(reasonFor(node({ width: 300, height: 2 }), [], 400, 800)).toBe('trennlinie')
    const siblings = [node({ id: 'a' }), node({ id: 'b' }), node({ id: 'c' })]
    expect(reasonFor(node({ id: 'a' }), siblings, 400, 800)).toBe('wiederholung')
  })
})

describe('Text-Identifizierbarkeit', () => {
  const image = canvas(200, 120, CREME)
  const buttonRect = { x: 20, y: 40, width: 160, height: 40 }

  it('meldet einen Knopf MIT Beschriftung nicht, obwohl er kaum Kontrast hat', () => {
    fill(image, 20, 40, 160, 40, GELB)
    const button = node({ id: 'cta', name: 'Los gehts', nameHints: ['button'], ...buttonRect })
    const label = node({ id: 'label', parentId: 'cta', name: 'Los gehts', type: 'TEXT', isText: true, charCount: 10, x: 60, y: 50, width: 80, height: 18 })
    const { results } = measureNonTextContrast({ image, signals: [button, label], frameWidth: 200, frameHeight: 120 })

    const cta = results.find((entry) => entry.nodeId === 'cta')!
    // Gelb auf Creme ist tatsächlich schwach — die Zahl steht trotzdem.
    expect(cta.ratio).toBeLessThan(3)
    expect(cta.status).toBe('durchgefallen')
    // Aber gemeldet wird er nicht: die Beschriftung identifiziert ihn.
    expect(cta.identifiableByText).toBe(true)
    expect(reportableNonText(results)).toHaveLength(0)
  })

  it('meldet denselben Knopf OHNE Beschriftung — dann trägt nur die Form', () => {
    const button = node({ id: 'icon', name: 'Aktion', nameHints: ['button'], ...buttonRect })
    const { results } = measureNonTextContrast({ image, signals: [button], frameWidth: 200, frameHeight: 120 })
    const icon = results.find((entry) => entry.nodeId === 'icon')!
    expect(icon.identifiableByText).toBe(false)
    expect(reportableNonText(results)).toHaveLength(1)
  })
})

describe('Begrenzung gegen die angrenzende Farbe', () => {
  it('misst die Kante, nicht die Füllung gegen irgendetwas', () => {
    // Dunkler Knopf auf hellem Grund: die Kante trägt viel Kontrast.
    const image = canvas(200, 120, [255, 255, 255])
    fill(image, 40, 40, 120, 40, [20, 20, 24])
    const button = node({ id: 'b', nameHints: ['button'], x: 40, y: 40, width: 120, height: 40 })
    const { results } = measureNonTextContrast({ image, signals: [button], frameWidth: 200, frameHeight: 120 })
    expect(results[0].ratio).toBeGreaterThan(15)
    expect(results[0].status).toBe('bestanden')
  })
})

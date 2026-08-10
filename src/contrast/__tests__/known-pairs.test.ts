/**
 * Bekannte Farbpaare, auf 0,05 genau — **mit Kantenglättung**.
 *
 * DIESER TEST EXISTIERT WEGEN EINES FEHLERS, DEN DIE ÜBRIGEN TESTS NICHT
 * FINDEN KONNTEN. Die Contrastmap meldete in Figma für jedes Element 3,5 bis
 * 3,9:1, unabhängig vom tatsächlichen Aussehen; weißer Text auf grauem Grund
 * kam auf 1,1:1. Im Harness stand für dasselbe Element 18,11:1.
 *
 * Der Unterschied waren die Testframes: sie zeichnen Text als hartkantige
 * Balken, also mit genau zwei Farben im Bild. Ein echter Renderer erzeugt an
 * jeder Glyphenkante Mischpixel. Die Messung bildete das **Minimum** über alle
 * Pixel im Textbereich — und der schlechteste Pixel ist dort immer ein
 * Mischpixel, dessen Kontrast gegen die Textfarbe nahe 1 liegt. Deshalb
 * stauchten sich alle Werte, und deshalb trug jede Messung das „~".
 *
 * Die Fixtures haben eine Methode bestätigt, die auf echten Renders falsch ist,
 * weil ihnen genau die Eigenschaft fehlte, an der sie scheitert. Dieser Test
 * hat sie: jeder Glyphenbalken bekommt links und rechts ein halb gemischtes
 * Randpixel.
 *
 * **Das ist die eine Stelle im Projekt mit bekannter Wahrheit.** Alles andere
 * hier wird gegen Ground Truth *verglichen*; diese drei Zahlen stehen fest, und
 * eine Ausgabe, die als überprüfbare Tatsache auftritt, muss sie treffen.
 */
import { describe, expect, it } from 'vitest'
import type { Bitmap } from '../../engine/ops'
import type { NodeSignal } from '../../messages'
import { measureContrast, pixelLuminance } from '../measure'

type Rgb = [number, number, number]

/** Fläche in einer Farbe. */
function canvas(w: number, h: number, c: Rgb): Bitmap {
  const data = new Uint8ClampedArray(w * h * 4)
  for (let p = 0; p < data.length; p += 4) { data[p]=c[0]; data[p+1]=c[1]; data[p+2]=c[2]; data[p+3]=255 }
  return { width: w, height: h, data }
}

/**
 * Glyphenbalken MIT Kantenglättung — je ein Pixel Übergang auf jeder Seite,
 * wie jeder echte Renderer sie erzeugt. Genau das fehlte den bisherigen
 * Testframes.
 */
function glyphs(image: Bitmap, y: number, height: number, ink: Rgb, bg: Rgb): void {
  for (let gx = 10; gx < image.width - 14; gx += 9) {
    for (let py = y; py < y + height; py++) {
      for (let d = 0; d < 5; d++) {
        const x = gx + d
        const edge = d === 0 || d === 4
        const mix = edge ? 0.5 : 1
        const p = (py * image.width + x) * 4
        for (let c = 0; c < 3; c++) image.data[p + c] = Math.round(bg[c] * (1 - mix) + ink[c] * mix)
      }
    }
  }
}

function textNode(o: Partial<NodeSignal>): NodeSignal {
  return {
    id: 't', parentId: null, name: 'Text', type: 'TEXT',
    x: 0, y: 0, width: 100, height: 20, zIndex: 1, opacity: 1,
    isText: true, isImage: false, hasFill: true, hasReactions: false,
    nameHints: [], fontSize: 16, ...o,
  }
}

const PAIRS: Array<[string, Rgb, Rgb, number]> = [
  ['weiß auf schwarz', [255,255,255], [0,0,0], 21],
  ['schwarz auf weiß', [0,0,0], [255,255,255], 21],
  ['weiß auf #767676', [255,255,255], [118,118,118], 4.54],
  // Weiß auf dunkel ist der Fall, an dem die Methode vorher am deutlichsten
  // gescheitert ist — dort meldete sie 1,1:1 statt zweistellig.
  ['weiß auf #222222', [255,255,255], [34,34,34], 15.91],
  ['weiß auf #4D4D4D', [255,255,255], [77,77,77], 8.45],
]

describe('bekannte Farbpaare, mit Kantenglättung', () => {
  for (const [label, ink, bg, expected] of PAIRS) {
    it(`${label} = ${expected}:1`, () => {
      const image = canvas(160, 80, bg)
      glyphs(image, 30, 14, ink, bg)
      const { results } = measureContrast({
        image,
        signals: [textNode({ x: 8, y: 28, width: 144, height: 18, fillLuminance: pixelLuminance(...ink), text: label })],
        frameWidth: 160, frameHeight: 80,
      })
      expect(results).toHaveLength(1)
      expect(results[0].ratio).toBeCloseTo(expected, 1)
      expect(Math.abs(results[0].ratio - expected)).toBeLessThan(0.05)
      expect(results[0].approximate).toBe(false)
    })
  }
})

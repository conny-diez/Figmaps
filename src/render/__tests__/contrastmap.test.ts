/**
 * Die Wertfahnen dürfen keinen markierten Text verdecken.
 *
 * DRITTER ANLAUF MIT DIESEN FAHNEN, deshalb ein Test. Zuletzt lag eine über dem
 * Wort „Hier" eines *anderen* Elements: rechts neben Element A war Platz, aber
 * genau dort begann Element B. Eine Karte, die von Lesbarkeit handelt, darf
 * keinen Text verdecken — dieselbe Regel, aus der Legende und Disclaimer aus
 * den Bildern verschwunden sind.
 */
import { describe, expect, it } from 'vitest'
import { __testing } from '../contrastmap'

const { placeTag, overlaps } = __testing

/** Ein Canvas-Kontext-Doppel: gebraucht wird nur die Textbreite. */
const ctx = {
  save() {},
  restore() {},
  font: '',
  measureText: (text: string) => ({ width: text.length * 6 }),
} as unknown as CanvasRenderingContext2D

const canvas = { width: 400, height: 800 }

describe('placeTag', () => {
  it('setzt die Fahne neben das Element, nie darauf', () => {
    const element = { x: 40, y: 100, width: 120, height: 20 }
    const tag = placeTag(ctx, element, '4,5:1', 12, canvas, [element], [])
    expect(overlaps(tag, element)).toBe(false)
  })

  it('weicht einem NACHBARELEMENT aus — der Fall aus dem Bericht', () => {
    // „Du hast ein Profil?" und direkt rechts daneben „Hier anmelden".
    const links = { x: 20, y: 700, width: 160, height: 20 }
    const rechts = { x: 190, y: 700, width: 120, height: 20 }
    const tag = placeTag(ctx, links, '3,9:1', 12, canvas, [links, rechts], [])
    expect(overlaps(tag, rechts)).toBe(false)
    expect(overlaps(tag, links)).toBe(false)
  })

  it('weicht einer bereits gesetzten Fahne aus', () => {
    const element = { x: 40, y: 300, width: 100, height: 20 }
    const belegt = { x: 145, y: 295, width: 60, height: 20 }
    const tag = placeTag(ctx, element, '4,5:1', 12, canvas, [element], [belegt])
    expect(overlaps(tag, belegt)).toBe(false)
  })

  it('bleibt im Bild, wenn das Element am rechten Rand klebt', () => {
    const element = { x: 300, y: 100, width: 95, height: 20 }
    const tag = placeTag(ctx, element, '18,4:1', 12, canvas, [element], [])
    expect(tag.x).toBeGreaterThanOrEqual(0)
    expect(tag.x + tag.width).toBeLessThanOrEqual(canvas.width)
    expect(overlaps(tag, element)).toBe(false)
  })

  it('nimmt im Zweifel den Platz mit der kleinsten Überlappung', () => {
    // Ein Element, das von allen Seiten eingekesselt ist: irgendwo muss die
    // Fahne hin, und dann soll sie den kleinsten Schaden anrichten.
    const element = { x: 180, y: 380, width: 40, height: 20 }
    const wand = [
      element,
      { x: 0, y: 300, width: 400, height: 70 },
      { x: 0, y: 410, width: 400, height: 70 },
      { x: 0, y: 370, width: 170, height: 40 },
      { x: 230, y: 370, width: 170, height: 40 },
    ]
    const tag = placeTag(ctx, element, '2,1:1', 12, canvas, wand, [])
    expect(overlaps(tag, element)).toBe(false)
  })
})

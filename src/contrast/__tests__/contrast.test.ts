/**
 * Die Contrastmap misst überprüfbare Tatsachen — also lassen sich diese Tests
 * gegen Werte schreiben, die *unabhängig* von uns feststehen. Das ist neu in
 * diesem Repo: bei Heatmap und Focusmap gibt es keine bekannte Wahrheit, hier
 * schon (WCAG 2.1, SC 1.4.3).
 */
import { describe, expect, it } from 'vitest'
import { relativeLuminance } from '../../figma/traverse'
import type { Bitmap } from '../../engine/ops'
import type { NodeSignal } from '../../messages'
import { measureContrast, pixelLuminance } from '../measure'
import {
  BORDERLINE_MARGIN,
  CONTRAST_LARGE,
  CONTRAST_NORMAL,
  contrastRatio,
  formatRatio,
  isLargeText,
  requiredRatio,
  statusOf,
} from '../wcag'

describe('WCAG-Kennwerte', () => {
  it('reproduziert die Eckwerte der Norm', () => {
    // Schwarz auf Weiß ist 21:1, der Höchstwert der Skala.
    expect(contrastRatio(1, 0)).toBeCloseTo(21, 6)
    // Gleiche Farbe ist 1:1.
    expect(contrastRatio(0.5, 0.5)).toBeCloseTo(1, 6)
    // Die Reihenfolge der Argumente darf nichts ändern.
    expect(contrastRatio(0.9, 0.1)).toBeCloseTo(contrastRatio(0.1, 0.9), 12)
  })

  it('kennt die Grenzen für großen Text', () => {
    expect(isLargeText(24)).toBe(true)
    expect(isLargeText(23.9)).toBe(false)
    // 14 pt fett = 18,66 px.
    expect(isLargeText(18.66, 700)).toBe(true)
    expect(isLargeText(18.65, 700)).toBe(false)
    // Fett unterhalb der Grenze bleibt normaler Text.
    expect(isLargeText(16, 700)).toBe(false)
    expect(requiredRatio(16)).toBe(CONTRAST_NORMAL)
    expect(requiredRatio(32)).toBe(CONTRAST_LARGE)
  })

  it('stuft knapp bestandene Werte als grenzwertig ein, nicht als durchgefallen', () => {
    // Unterhalb der Norm: durchgefallen. Die Norm selbst kennt kein „knapp".
    expect(statusOf(4.49, CONTRAST_NORMAL)).toBe('durchgefallen')
    expect(statusOf(4.5, CONTRAST_NORMAL)).toBe('grenzwertig')
    expect(statusOf(CONTRAST_NORMAL * BORDERLINE_MARGIN, CONTRAST_NORMAL)).toBe('bestanden')
  })

  it('schreibt Verhältnisse mit einer Nachkommastelle, deutsch', () => {
    expect(formatRatio(3.14159)).toBe('3,1:1')
    expect(formatRatio(21)).toBe('21,0:1')
  })

  it('rechnet dieselbe Luminanz wie der Layer-Baum', () => {
    // Beide Formeln stehen getrennt, weil die eine auf Bytes und die andere auf
    // Figmas [0,1] arbeitet. Sie müssen übereinstimmen, sonst vergleicht die
    // Messung Textfarbe und Hintergrund in zwei verschiedenen Größen.
    for (const [r, g, b] of [[0, 0, 0], [255, 255, 255], [255, 200, 0], [20, 22, 26], [120, 130, 140]]) {
      expect(pixelLuminance(r, g, b)).toBeCloseTo(relativeLuminance({ r: r / 255, g: g / 255, b: b / 255 }), 12)
    }
  })
})

// --- Testbilder ------------------------------------------------------------

type Rgb = [number, number, number]

function canvas(width: number, height: number, colour: Rgb): Bitmap {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let p = 0; p < data.length; p += 4) {
    data[p] = colour[0]
    data[p + 1] = colour[1]
    data[p + 2] = colour[2]
    data[p + 3] = 255
  }
  return { width, height, data }
}

function fill(image: Bitmap, x: number, y: number, w: number, h: number, colour: Rgb): void {
  for (let py = y; py < y + h; py++) {
    for (let px = x; px < x + w; px++) {
      const p = (py * image.width + px) * 4
      image.data[p] = colour[0]
      image.data[p + 1] = colour[1]
      image.data[p + 2] = colour[2]
    }
  }
}

function textSignal(overrides: Partial<NodeSignal>): NodeSignal {
  return {
    id: 't1',
    parentId: null,
    name: 'Text',
    type: 'TEXT',
    x: 0,
    y: 0,
    width: 100,
    height: 20,
    zIndex: 1,
    opacity: 1,
    isText: true,
    isImage: false,
    hasFill: true,
    hasReactions: false,
    nameHints: [],
    fontSize: 16,
    ...overrides,
  }
}

describe('measureContrast', () => {
  it('misst schwarzen Text auf weißem Grund als 21:1', () => {
    const image = canvas(200, 100, [255, 255, 255])
    // Glyphen als schmale Balken — dazwischen bleibt Hintergrund stehen.
    for (let x = 20; x < 120; x += 8) fill(image, x, 40, 3, 12, [0, 0, 0])
    const { results, skipped } = measureContrast({
      image,
      signals: [textSignal({ x: 20, y: 40, width: 100, height: 12, fillLuminance: 0, text: 'Hallo' })],
      frameWidth: 200,
      frameHeight: 100,
    })
    expect(skipped).toEqual([])
    expect(results).toHaveLength(1)
    expect(results[0].ratio).toBeCloseTo(21, 5)
    expect(results[0].status).toBe('bestanden')
    expect(results[0].approximate).toBe(false)
  })

  it('meldet grauen Text auf weißem Grund als durchgefallen', () => {
    const image = canvas(200, 100, [255, 255, 255])
    const grey: Rgb = [170, 170, 170]
    for (let x = 20; x < 120; x += 8) fill(image, x, 40, 3, 12, grey)
    const luminance = pixelLuminance(...grey)
    const { results } = measureContrast({
      image,
      signals: [textSignal({ x: 20, y: 40, width: 100, height: 12, fillLuminance: luminance, text: 'Zu hell' })],
      frameWidth: 200,
      frameHeight: 100,
    })
    // #AAA auf Weiß ist rund 2,3:1 — deutlich unter 4,5.
    expect(results[0].ratio).toBeLessThan(CONTRAST_NORMAL)
    expect(results[0].status).toBe('durchgefallen')
  })

  it('meldet denselben Text als bestanden, sobald er groß und fett ist', () => {
    const image = canvas(200, 100, [255, 255, 255])
    // Ein Grau, das zwischen 3:1 und 4,5:1 liegt.
    const grey: Rgb = [130, 130, 130]
    for (let x = 20; x < 160; x += 10) fill(image, x, 30, 4, 30, grey)
    const luminance = pixelLuminance(...grey)
    const base = { x: 20, y: 30, width: 140, height: 30, fillLuminance: luminance, text: 'Überschrift' }

    const normal = measureContrast({
      image,
      signals: [textSignal({ ...base, fontSize: 16 })],
      frameWidth: 200,
      frameHeight: 100,
    }).results[0]
    const large = measureContrast({
      image,
      signals: [textSignal({ ...base, fontSize: 20, fontWeight: 700 })],
      frameWidth: 200,
      frameHeight: 100,
    }).results[0]

    expect(normal.ratio).toBeCloseTo(large.ratio, 6)
    expect(normal.required).toBe(CONTRAST_NORMAL)
    expect(large.required).toBe(CONTRAST_LARGE)
    expect(normal.status).toBe('durchgefallen')
    expect(large.status).not.toBe('durchgefallen')
  })

  it('nimmt über einem Verlauf den schlechtesten Wert und nennt ihn eine Näherung', () => {
    const image = canvas(200, 100, [255, 255, 255])
    // Hintergrund läuft von dunkel nach hell — wie ein Foto unter dem Text.
    for (let x = 0; x < 200; x++) {
      const v = Math.round((x / 199) * 255)
      fill(image, x, 30, 1, 40, [v, v, v])
    }
    for (let x = 20; x < 160; x += 10) fill(image, x, 40, 4, 20, [255, 255, 255])
    const { results } = measureContrast({
      image,
      signals: [textSignal({ x: 20, y: 40, width: 140, height: 20, fillLuminance: 1, text: 'Über dem Bild' })],
      frameWidth: 200,
      frameHeight: 100,
    })
    expect(results[0].approximate).toBe(true)
    // Der schlechteste Wert steht im Ergebnis, nicht der beste oder ein Mittel.
    expect(results[0].ratio).toBeLessThan(results[0].bestRatio)
    expect(results[0].status).toBe('durchgefallen')
  })

  it('weicht nach außen aus, wenn der Text seinen Rahmen füllt', () => {
    const image = canvas(200, 100, [255, 255, 255])
    fill(image, 40, 40, 60, 16, [0, 0, 0]) // massiver Block, kein Grund dazwischen
    const { results } = measureContrast({
      image,
      signals: [textSignal({ x: 40, y: 40, width: 60, height: 16, fillLuminance: 0, text: 'Voll' })],
      frameWidth: 200,
      frameHeight: 100,
    })
    expect(results[0].sampledOutside).toBe(true)
    expect(results[0].ratio).toBeCloseTo(21, 5)
  })

  it('überspringt Text ohne einfarbige Farbe und sagt warum', () => {
    const image = canvas(200, 100, [255, 255, 255])
    const { results, skipped } = measureContrast({
      image,
      signals: [textSignal({ fillLuminance: undefined })],
      frameWidth: 200,
      frameHeight: 100,
    })
    expect(results).toEqual([])
    expect(skipped).toHaveLength(1)
    expect(skipped[0].reason).toContain('einfarbige')
  })

  it('sortiert das am deutlichsten durchgefallene Element nach oben', () => {
    const image = canvas(300, 100, [255, 255, 255])
    const pale: Rgb = [220, 220, 220]
    const mid: Rgb = [150, 150, 150]
    for (let x = 10; x < 90; x += 8) fill(image, x, 20, 3, 12, pale)
    for (let x = 110; x < 190; x += 8) fill(image, x, 20, 3, 12, mid)
    const { results } = measureContrast({
      image,
      signals: [
        textSignal({ id: 'mid', x: 110, y: 20, width: 80, height: 12, fillLuminance: pixelLuminance(...mid) }),
        textSignal({ id: 'pale', x: 10, y: 20, width: 80, height: 12, fillLuminance: pixelLuminance(...pale) }),
      ],
      frameWidth: 300,
      frameHeight: 100,
    })
    expect(results[0].nodeId).toBe('pale')
  })
})

/**
 * F4 — the footer must not overprint itself.
 *
 * The 1.1 footer drew the disclaimer left-aligned and „FigMaps · 1.1.0 ·
 * Ortsprior: …" right-aligned on the same line. On a phone-shaped export the
 * two together are wider than the image, so the second string was painted over
 * the first and the prior category became unreadable — which is why it read as
 * missing.
 *
 * Uses a recording stub instead of a real canvas: the layout is arithmetic, and
 * the arithmetic is what broke.
 */
import { describe, expect, it } from 'vitest'
import { DISCLAIMER_TEXT, drawFooter, layoutFooter } from '../legend'

type Drawn = { text: string; x: number; y: number; align: CanvasTextAlign; width: number }

/** Advance width ~0.5 em per character — close enough for a collision test. */
function widthOf(text: string, font: string): number {
  const size = Number(/(\d+)px/.exec(font)?.[1] ?? 10)
  return text.length * size * 0.5
}

function recorder(): { ctx: CanvasRenderingContext2D; drawn: Drawn[] } {
  const drawn: Drawn[] = []
  const ctx = {
    font: '10px sans-serif',
    fillStyle: '',
    textAlign: 'left' as CanvasTextAlign,
    textBaseline: 'alphabetic' as CanvasTextBaseline,
    save() {},
    restore() {},
    fillRect() {},
    measureText(text: string) {
      return { width: widthOf(text, this.font) } as TextMetrics
    },
    fillText(text: string, x: number, y: number) {
      drawn.push({ text, x, y, align: this.textAlign, width: widthOf(text, this.font) })
    },
  }
  return { ctx: ctx as unknown as CanvasRenderingContext2D, drawn }
}

/** [left, right] extent of a drawn string, whatever its alignment. */
function span(entry: Drawn): [number, number] {
  return entry.align === 'right' ? [entry.x - entry.width, entry.x] : [entry.x, entry.x + entry.width]
}

const LABELS = {
  priorLabel: 'Ortsprior: Mobile App (automatisch)',
  durationLabel: 'Betrachtungsdauer: Scan (3 s)',
  attribution: 'Ortsprior: UEyes (Jiang et al. 2023), CC BY 4.0',
}

describe('drawFooter', () => {
  // A 390x844 frame exported at 2x — the case that overlapped.
  const width = 780
  const height = 1688

  it('states the prior category and the viewing duration', () => {
    const { ctx, drawn } = recorder()
    drawFooter(ctx, width, height, LABELS)
    const all = drawn.map((entry) => entry.text).join(' | ')
    expect(all).toContain('Ortsprior: Mobile App')
    expect(all).toContain('Betrachtungsdauer: Scan (3 s)')
    expect(all).toContain('CC BY 4.0')
  })

  it('puts the details on their own line, below the disclaimer', () => {
    const { ctx, drawn } = recorder()
    drawFooter(ctx, width, height, LABELS)
    const disclaimer = drawn.find((entry) => entry.text === DISCLAIMER_TEXT)!
    const details = drawn.find((entry) => entry.text.includes('Betrachtungsdauer'))!
    expect(details.y).toBeGreaterThan(disclaimer.y)
  })

  it('never lets two strings on the same line overlap', () => {
    const { ctx, drawn } = recorder()
    drawFooter(ctx, width, height, LABELS)

    const byLine = new Map<number, Drawn[]>()
    for (const entry of drawn) byLine.set(entry.y, [...(byLine.get(entry.y) ?? []), entry])

    for (const line of byLine.values()) {
      const spans = line.map(span).sort((a, b) => a[0] - b[0])
      for (let i = 1; i < spans.length; i++) {
        expect(spans[i][0]).toBeGreaterThanOrEqual(spans[i - 1][1])
      }
    }
  })

  it('keeps every string inside the image', () => {
    const { ctx, drawn } = recorder()
    drawFooter(ctx, width, height, LABELS)
    for (const entry of drawn) {
      const [left, right] = span(entry)
      expect(left).toBeGreaterThanOrEqual(0)
      expect(right).toBeLessThanOrEqual(width)
    }
  })

  it('keeps every string inside a narrow export too', () => {
    const { ctx, drawn } = recorder()
    drawFooter(ctx, 400, 900, LABELS)
    for (const entry of drawn) expect(span(entry)[1]).toBeLessThanOrEqual(400)
    // Nothing was dropped: every detail still appears somewhere.
    const all = drawn.map((entry) => entry.text).join(' ')
    expect(all).toContain('Ortsprior: Mobile App')
    expect(all).toContain('Betrachtungsdauer')
    expect(all).toContain('CC BY 4.0')
  })

  it('drops the second line when there is nothing to state', () => {
    const { ctx, drawn } = recorder()
    drawFooter(ctx, width, height)
    const lines = new Set(drawn.map((entry) => entry.y))
    expect(lines.size).toBe(1)
    expect(layoutFooter(ctx, width, height).barHeight).toBeLessThan(
      layoutFooter(ctx, width, height, LABELS).barHeight,
    )
  })

  it('wraps instead of clipping when even the smallest type does not fit', () => {
    const { ctx, drawn } = recorder()
    drawFooter(ctx, 400, 900, LABELS)
    const details = drawn.filter((entry) => entry.text !== DISCLAIMER_TEXT && !entry.text.startsWith('FigMaps'))
    expect(details.length).toBeGreaterThan(1)
    expect(details.map((entry) => entry.text).join(' ')).toContain('Betrachtungsdauer')
  })
})

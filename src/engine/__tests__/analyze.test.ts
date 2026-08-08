/**
 * Epic B acceptance (M4) through the shared analysis path — the same function
 * the iframe and the eval harness call.
 */
import { describe, expect, it } from 'vitest'
import { ImageOpsNode } from '../../platform/imageops-node'
import { analyzeFrame, signalsForSection } from '../analyze'
import { ENGINE_CONFIG } from '../config'
import { HeuristicAttentionEngine } from '../heuristic'
import type { Bitmap } from '../ops'
import { fillRect, makeSignal, solidImage } from './helpers'

const ops = new ImageOpsNode()
const engine = new HeuristicAttentionEngine()

/** A tall page: light background, a dark band every 400 px. */
function scrollPage(width: number, height: number): Bitmap {
  const image = solidImage(width, height, [245, 246, 248])
  for (let y = 100; y + 80 < height; y += 400) {
    fillRect(image, { x: 40, y, width: Math.round(width * 0.5), height: 80 }, [24, 24, 32])
  }
  return image
}

describe('signalsForSection', () => {
  const signals = [
    makeSignal({ id: 'a', y: 0, height: 100 }),
    makeSignal({ id: 'b', y: 950, height: 100 }),
    makeSignal({ id: 'c', y: 2000, height: 100 }),
  ]

  it('keeps intersecting signals and rebases them onto the section origin', () => {
    const section = { index: 1, y: 900, height: 900 }
    const result = signalsForSection(signals, section)
    expect(result.map((signal) => signal.id)).toEqual(['b'])
    expect(result[0].y).toBe(50)
  })

  it('keeps a signal that straddles the section boundary', () => {
    const straddling = [makeSignal({ id: 'x', y: 880, height: 60 })]
    expect(signalsForSection(straddling, { index: 0, y: 0, height: 900 })).toHaveLength(1)
    expect(signalsForSection(straddling, { index: 1, y: 900, height: 900 })).toHaveLength(1)
  })

  it('does not mutate the input', () => {
    signalsForSection(signals, { index: 1, y: 900, height: 900 })
    expect(signals[1].y).toBe(950)
  })
})

describe('analyzeFrame', () => {
  it('treats a short frame as a whole, with no above-the-fold map', async () => {
    const source = scrollPage(600, 500)
    const result = await analyzeFrame(engine, ops, {
      source,
      signals: [],
      frameWidth: 600,
      frameHeight: 500,
    })

    expect(result).not.toBeNull()
    expect(result?.plan.segmented).toBe(false)
    expect(result?.plan.sections).toHaveLength(1)
    expect(result?.aboveFold).toBeNull()
    expect(result?.sectionSalience).toHaveLength(1)
  })

  it('segments a tall frame and returns an above-the-fold map', async () => {
    const frameWidth = 1440
    const frameHeight = 4000
    const result = await analyzeFrame(engine, ops, {
      source: scrollPage(720, 2000),
      signals: [makeSignal({ id: 'cta', name: 'Button', y: 3200, height: 60 })],
      frameWidth,
      frameHeight,
    })

    expect(result).not.toBeNull()
    expect(result?.plan.segmented).toBe(true)
    expect(result?.plan.sections.length).toBeGreaterThan(1)
    expect(result?.aboveFold).not.toBeNull()
    expect(result?.sectionSalience).toHaveLength(result?.plan.sections.length ?? 0)

    // The composed map covers the whole frame at the sections' own scale.
    const map = result!.attention
    const scale = map.width / frameWidth
    expect(map.height).toBe(Math.round(frameHeight * scale))

    // The above-the-fold map is exactly one section, not the whole frame.
    expect(result!.aboveFold!.height).toBeLessThan(map.height)

    // No dead rows: the blend must cover every row of the composite.
    let emptyRows = 0
    for (let y = 0; y < map.height; y++) {
      let sum = 0
      for (let x = 0; x < map.width; x++) sum += map.values[y * map.width + x]
      if (sum === 0) emptyRows++
    }
    expect(emptyRows).toBe(0)
  })

  it('honours the viewport override', async () => {
    const result = await analyzeFrame(engine, ops, {
      source: scrollPage(400, 800),
      signals: [],
      frameWidth: 800,
      frameHeight: 3000,
      viewportOverride: 600,
    })
    expect(result?.plan.viewportHeight).toBe(600)
    expect(result?.plan.folds[0]).toBe(600)
  })

  it('can be cancelled between sections', async () => {
    let calls = 0
    const result = await analyzeFrame(
      engine,
      ops,
      { source: scrollPage(720, 2000), signals: [], frameWidth: 1440, frameHeight: 4000 },
      {
        isCancelled: () => {
          calls++
          return calls > 2
        },
      },
    )
    expect(result).toBeNull()
  })

  /**
   * The prior is still rebuilt per section, so a featureless page still shows
   * one local maximum per section. What the scroll-depth attenuation changes is
   * their *amplitude*: without it all five sit at 0.50 — five equally bright
   * bands — with it they halve (0.50 / 0.25 / 0.13) and fall below the
   * renderer's transparency cutoff from the third section on.
   *
   * Measured on a featureless grey frame, which is the worst case: any real
   * content dominates the prior.
   */
  it('attenuates the per-section prior with scroll depth', async () => {
    const frameWidth = 1440
    const frameHeight = 4000
    // Uniform grey: every structure in the result comes from the prior alone.
    const flat = solidImage(720, 2000, [180, 180, 180])
    const result = await analyzeFrame(engine, ops, { source: flat, signals: [], frameWidth, frameHeight })

    const map = result!.attention
    const rowMeans: number[] = []
    for (let y = 0; y < map.height; y++) {
      let sum = 0
      for (let x = 0; x < map.width; x++) sum += map.values[y * map.width + x]
      rowMeans.push(sum / map.width)
    }

    // Local maxima of the row profile: position in frame pixels, plus height.
    const peaks: Array<{ y: number; value: number }> = []
    for (let y = 2; y < rowMeans.length - 2; y++) {
      const isPeak =
        rowMeans[y] > rowMeans[y - 1] && rowMeans[y] >= rowMeans[y + 1] &&
        rowMeans[y] > rowMeans[y - 2] && rowMeans[y] >= rowMeans[y + 2]
      if (isPeak) peaks.push({ y: Math.round((y / map.height) * frameHeight), value: rowMeans[y] })
    }

    // Still one maximum per section step — the attenuation changes height,
    // not position.
    const step = ENGINE_CONFIG.viewport.desktopHeight * (1 - ENGINE_CONFIG.viewport.overlap)
    expect(peaks.length).toBeGreaterThanOrEqual(result!.plan.sections.length - 2)
    for (let i = 1; i < peaks.length; i++) {
      expect(Math.abs(peaks[i].y - peaks[i - 1].y - step)).toBeLessThan(step * 0.2)
    }

    // Strictly decreasing while above the floor: no plateau of equal bands,
    // which is what read as an artefact before.
    expect(peaks[1].value).toBeLessThan(peaks[0].value * 0.65)
    expect(peaks[2].value).toBeLessThan(peaks[1].value * 0.65)

    // From the third section on, nothing is drawn at all on empty areas.
    const cutoff = ENGINE_CONFIG.render.transparencyCutoff
    expect(peaks[0].value).toBeGreaterThan(cutoff)
    for (const peak of peaks.slice(3)) expect(peak.value).toBeLessThan(cutoff)
  })

  it('leaves an unsegmented frame untouched by the attenuation', async () => {
    // Section 0 is scaled by factor^0 = 1, and a single-section frame returns
    // its map unchanged — the above-the-fold map must not be dimmed.
    const short = solidImage(600, 400, [200, 200, 200])
    const result = await analyzeFrame(engine, ops, { source: short, signals: [], frameWidth: 1200, frameHeight: 800 })
    expect(result!.plan.segmented).toBe(false)
    // Spread would overflow the stack on a 512x341 map.
    let peak = 0
    for (const value of result!.attention.values) if (value > peak) peak = value
    expect(peak).toBeCloseTo(1, 5)
  })

  it('bounds the analysis source, so a very tall frame stays affordable', async () => {
    const result = await analyzeFrame(engine, ops, {
      source: scrollPage(2400, 6000),
      signals: [],
      frameWidth: 2400,
      frameHeight: 6000,
    })
    // Each section is sampled *down* to the analysis grid, never up.
    expect(result!.attention.width).toBeLessThanOrEqual(ENGINE_CONFIG.analysisEdge)
    expect(result!.attention.width).toBeGreaterThan(ENGINE_CONFIG.analysisEdge / 2)
  })
})

/**
 * Epic C — end-to-end reachability of every rule.
 *
 * WHY THIS FILE EXISTS: `cold-fold` was inert from the day it was written and
 * every unit test in `rules.test.ts` was green. Those tests call the rule with
 * hand-built input; the pipeline fed it something structurally different (peaks
 * that are 1.0 by construction). The rule was correct and unreachable.
 *
 * So these tests do not call rules. They build a frame, run the **real**
 * analysis (`analyzeFrame` with real `ImageOps`), the **real** candidate
 * scoring, and the **real** `deriveFindings` — the same function the iframe
 * pipeline calls — and then check which findings came out.
 *
 * Every rule gets two: one frame where it must fire, one where it must not.
 * A rule that cannot be made to fire here is not shipped, it is decoration.
 */
import { describe, expect, it } from 'vitest'
import { analyzeFrame } from '../../engine/analyze'
import { HeuristicAttentionEngine } from '../../engine/heuristic'
import { ImageOpsNode } from '../../platform/imageops-node'
import type { Bitmap } from '../../engine/ops'
import type { NodeSignal } from '../../messages'
import { deriveFindings } from '../derive'
import { ALL_RULES, RULES } from '../rules'

const ops = new ImageOpsNode()
const engine = new HeuristicAttentionEngine()

type Rgb = [number, number, number]

/** A blank canvas in *source* pixels; frame coordinates are separate. */
function canvas(width: number, height: number, colour: Rgb = [244, 245, 247]): Bitmap {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let p = 0; p < data.length; p += 4) {
    data[p] = colour[0]
    data[p + 1] = colour[1]
    data[p + 2] = colour[2]
    data[p + 3] = 255
  }
  return { width, height, data }
}

function box(image: Bitmap, x: number, y: number, w: number, h: number, colour: Rgb): void {
  for (let py = Math.max(0, y); py < Math.min(image.height, y + h); py++) {
    for (let px = Math.max(0, x); px < Math.min(image.width, x + w); px++) {
      const p = (py * image.width + px) * 4
      image.data[p] = colour[0]
      image.data[p + 1] = colour[1]
      image.data[p + 2] = colour[2]
    }
  }
}

let nextId = 0
function signal(overrides: Partial<NodeSignal>): NodeSignal {
  nextId++
  return {
    id: `n${nextId}`,
    parentId: null,
    name: `node-${nextId}`,
    type: 'RECTANGLE',
    x: 0,
    y: 0,
    width: 100,
    height: 40,
    zIndex: nextId,
    opacity: 1,
    isText: false,
    isImage: false,
    hasFill: true,
    hasReactions: false,
    nameHints: [],
    ...overrides,
  }
}

/**
 * Runs the shipped path and returns the ids of the findings it produced.
 *
 * `includeUnshipped` widens the rule set to everything implemented. A rule that
 * is switched off (see `flat`) still has to be provably reachable — otherwise
 * switching it back on later is a guess, which is exactly how `cold-fold` got
 * to be inert.
 */
async function run(options: {
  source: Bitmap
  signals: NodeSignal[]
  frameWidth: number
  frameHeight: number
  viewportOverride?: number
  includeUnshipped?: boolean
}): Promise<string[]> {
  const analysis = await analyzeFrame(engine, ops, {
    source: options.source,
    signals: options.signals,
    frameWidth: options.frameWidth,
    frameHeight: options.frameHeight,
    ...(options.viewportOverride ? { viewportOverride: options.viewportOverride } : {}),
  })
  expect(analysis).not.toBeNull()

  const findings = deriveFindings(
    {
      analysis: analysis!,
      signals: options.signals,
      frameWidth: options.frameWidth,
      frameHeight: options.frameHeight,
    },
    options.includeUnshipped ? ALL_RULES : undefined,
  )
  return findings.map((finding) => finding.id)
}

// ---------------------------------------------------------------------------
// Frame builders — realistic enough that the rules see what they expect
// ---------------------------------------------------------------------------

/** A conventional desktop landing page: nav, hero, headline, two buttons. */
function landingPage(): { source: Bitmap; signals: NodeSignal[]; frameWidth: number; frameHeight: number } {
  const source = canvas(720, 450)
  box(source, 0, 0, 720, 36, [255, 255, 255]) // nav
  box(source, 40, 90, 300, 48, [22, 22, 28]) // headline
  box(source, 40, 160, 260, 60, [110, 110, 120]) // copy
  box(source, 40, 250, 140, 34, [20, 110, 220]) // primary button
  box(source, 200, 250, 110, 34, [225, 227, 232]) // secondary button
  box(source, 400, 80, 280, 200, [205, 120, 90]) // hero image

  // Frame coordinates are 2x the source, as a real export would be.
  const signals = [
    signal({ name: 'Headline', isText: true, fontSize: 44, fontWeight: 700, charCount: 28, x: 80, y: 180, width: 600, height: 96 }),
    signal({ name: 'Fließtext', isText: true, fontSize: 16, charCount: 160, x: 80, y: 320, width: 520, height: 120 }),
    signal({ name: 'Primary CTA Button', nameHints: ['button', 'cta'], hasReactions: true, x: 80, y: 500, width: 280, height: 68 }),
    signal({ name: 'Alle Angebote', nameHints: ['button'], x: 400, y: 500, width: 220, height: 68 }),
    signal({ name: 'Hero-Bild', isImage: true, x: 800, y: 160, width: 560, height: 400 }),
  ]
  return { source, signals, frameWidth: 1440, frameHeight: 900 }
}

describe('end-to-end reachability of every rule', () => {
  it('every implemented rule is covered by a firing test below', () => {
    // Guards against a rule being added without a reachability test.
    expect(ALL_RULES.map((rule) => rule.id).sort()).toEqual(
      ['cold-fold', 'competition', 'cta-below-fold', 'cta-rank', 'dead-cta', 'flat'].sort(),
    )
  })

  it('does not ship `flat` — its threshold sits below the whole realistic range', () => {
    // The decision quantity answers "how small is the strongest spot", not "how
    // clear is the hierarchy": a large eye-catcher scores 0,137, none at all
    // 0,123. The shipped threshold (web 0,086) is below the realistic range
    // 0,103–0,220 entirely, so the rule fires only on a near-empty screen. See
    // `rules.ts` for both sweeps.
    expect(RULES.map((rule) => rule.id)).not.toContain('flat')
  })

  it('does not ship `dead-cta` — its threshold is not backed by a measurement', () => {
    // 24 of 24 in each of three constructed frame shapes, in the redefined
    // form too: the quantity is a minimum over N candidates and falls with N,
    // so no single constant is selective across frame shapes. See `rules.ts`.
    expect(RULES.map((rule) => rule.id)).not.toContain('dead-cta')
  })

  // --- cta-rank ------------------------------------------------------------

  it('cta-rank fires when the primary button is out-ranked', async () => {
    const page = landingPage()
    // A huge, reaction-carrying competitor outranks the small primary CTA.
    page.signals.push(
      signal({ name: 'Alle Angebote entdecken', nameHints: ['button'], hasReactions: true, x: 800, y: 620, width: 560, height: 120 }),
    )
    expect(await run(page)).toContain('cta-rank')
  })

  it('cta-rank stays silent when the primary button leads', async () => {
    const page = landingPage()
    // Primary CTA is the biggest interactive element and carries the reaction.
    page.signals = page.signals.filter((s) => !s.nameHints.includes('button'))
    page.signals.push(
      signal({ name: 'Primary CTA', nameHints: ['button', 'cta'], hasReactions: true, x: 80, y: 200, width: 600, height: 200 }),
      signal({ name: 'Kleiner Link', nameHints: ['link'], x: 1200, y: 800, width: 120, height: 30 }),
    )
    expect(await run(page)).not.toContain('cta-rank')
  })

  // --- dead-cta ------------------------------------------------------------

  it('dead-cta fires for a button far quieter than its peers', async () => {
    const source = canvas(720, 450)
    box(source, 40, 60, 240, 60, [10, 10, 200]) // busy button, top
    const signals = [
      signal({ name: 'Jetzt starten', nameHints: ['button'], hasReactions: true, x: 80, y: 120, width: 480, height: 120 }),
      // Same size, but in the darkest corner of the map.
      signal({ name: 'Jetzt anfragen', nameHints: ['button'], x: 900, y: 800, width: 480, height: 90 }),
    ]
    expect(
      await run({ source, signals, frameWidth: 1440, frameHeight: 900, includeUnshipped: true }),
    ).toContain('dead-cta')
  })

  it('dead-cta stays silent when the buttons sit close together', async () => {
    const source = canvas(720, 450)
    box(source, 40, 120, 240, 60, [10, 10, 200])
    box(source, 320, 120, 240, 60, [10, 10, 200])
    const signals = [
      signal({ name: 'Jetzt starten', nameHints: ['button'], hasReactions: true, x: 80, y: 240, width: 480, height: 120 }),
      signal({ name: 'Mehr erfahren', nameHints: ['button'], x: 640, y: 240, width: 480, height: 120 }),
    ]
    expect(
      await run({ source, signals, frameWidth: 1440, frameHeight: 900, includeUnshipped: true }),
    ).not.toContain('dead-cta')
  })

  // --- competition ---------------------------------------------------------

  it('competition fires for two separated hotspots in the same band', async () => {
    // Both hotspots must sit where the prior is already high — the image term
    // is added at 0.3, so it cannot lift a low-prior region into contention.
    const source = canvas(720, 450, [248, 249, 250])
    box(source, 40, 50, 150, 130, [0, 0, 0]) // block inside the prior's peak
    box(source, 420, 50, 150, 130, [0, 0, 0]) // second block, past the min distance
    // No signals: this rule reads the attention map only, and structural
    // signals would add a third bright region.
    expect(await run({ source, signals: [], frameWidth: 1440, frameHeight: 900 })).toContain('competition')
  })

  it('competition stays silent for a single hotspot', async () => {
    const source = canvas(720, 450)
    box(source, 260, 170, 200, 120, [0, 0, 0]) // one central block
    const signals = [signal({ name: 'Headline', isText: true, fontSize: 56, fontWeight: 700, charCount: 24, x: 520, y: 340, width: 400, height: 240 })]
    expect(await run({ source, signals, frameWidth: 1440, frameHeight: 900 })).not.toContain('competition')
  })

  // --- flat ----------------------------------------------------------------

  it('flat fires on a screen without visual hierarchy', async () => {
    // Evenly distributed, equally strong content over the *whole* canvas: no
    // element is more salient than any other. Filling only the lower two thirds
    // would not do it any more — the rule reads the image-analysis term, and an
    // empty upper third is itself a contrast (measured: 0,099 against 0,057).
    const source = canvas(720, 450)
    for (let y = 10; y < 444; y += 10) {
      for (let x = 4; x < 714; x += 12) box(source, x, y, 8, 7, [0, 0, 0])
    }
    expect(
      await run({ source, signals: [], frameWidth: 1440, frameHeight: 900, includeUnshipped: true }),
    ).toContain('flat')
  })

  it('flat stays silent on a screen with one dominant element', async () => {
    const source = canvas(720, 450)
    box(source, 240, 140, 240, 170, [0, 0, 0])
    expect(
      await run({ source, signals: [], frameWidth: 1440, frameHeight: 900, includeUnshipped: true }),
    ).not.toContain('flat')
  })

  // --- cta-below-fold ------------------------------------------------------

  it('cta-below-fold fires when the strongest button sits past fold 1', async () => {
    const source = canvas(720, 2000)
    box(source, 40, 1500, 400, 120, [20, 110, 220])
    const signals = [
      signal({ name: 'Kleiner Link oben', nameHints: ['link'], x: 80, y: 100, width: 120, height: 40 }),
      signal({ name: 'Jetzt anfragen', nameHints: ['button', 'cta'], hasReactions: true, x: 80, y: 3000, width: 800, height: 240 }),
    ]
    const ids = await run({ source, signals, frameWidth: 1440, frameHeight: 4000 })
    expect(ids).toContain('cta-below-fold')
  })

  it('cta-below-fold stays silent when the strongest button is above fold 1', async () => {
    const source = canvas(720, 2000)
    box(source, 40, 100, 400, 120, [20, 110, 220])
    const signals = [
      signal({ name: 'Jetzt anfragen', nameHints: ['button', 'cta'], hasReactions: true, x: 80, y: 200, width: 800, height: 240 }),
      signal({ name: 'Fußzeilen-Link', nameHints: ['link'], x: 80, y: 3800, width: 120, height: 40 }),
    ]
    expect(await run({ source, signals, frameWidth: 1440, frameHeight: 4000 })).not.toContain('cta-below-fold')
  })

  // --- cold-fold -----------------------------------------------------------

  it('cold-fold fires when a later section concentrates attention more', async () => {
    // Busy, evenly textured first viewport; one strong focal point far down.
    const source = canvas(720, 2000)
    for (let y = 20; y < 440; y += 40) for (let x = 20; x < 700; x += 60) box(source, x, y, 40, 24, [150, 150, 158])
    box(source, 250, 1450, 220, 160, [0, 0, 0])
    const ids = await run({ source, signals: [], frameWidth: 1440, frameHeight: 4000 })
    expect(ids).toContain('cold-fold')
  })

  it('cold-fold stays silent when the first section is the most focused', async () => {
    const source = canvas(720, 2000)
    box(source, 250, 120, 220, 160, [0, 0, 0])
    for (let y = 1000; y < 1980; y += 40) for (let x = 20; x < 700; x += 60) box(source, x, y, 40, 24, [150, 150, 158])
    expect(await run({ source, signals: [], frameWidth: 1440, frameHeight: 4000 })).not.toContain('cold-fold')
  })
})

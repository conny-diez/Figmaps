/**
 * 1.2 A4 — die zwei visuellen Prüffälle, unabhängig von den Zahlen.
 *
 * Rendert den Onboarding-Screen aus `onboarding.ts` für jeden Alpha-Wert als
 * Heatmap-Overlay und misst dabei zwei Elemente mit bekannter Antwort: den
 * gelben CTA unten und die dunkle Kachel „Nachrichten".
 *
 * Das Overlay verwendet die **ausgelieferte** Farbabbildung samt
 * Transparenzschwelle (`render/heatmap.ts` → `heatmapToRgba`) statt einer
 * eigenen. Ein Prüffall, der anders einfärbt als das Plugin, prüft eine andere
 * Karte als die, über die entschieden wird — dieselbe Regel wie in A-1.
 */
import { analyzeFrame } from '../src/engine/analyze'
import { scoreCandidates } from '../src/engine/clickmap'
import { HeuristicAttentionEngine } from '../src/engine/heuristic'
import { meanInRect } from '../src/engine/imageops'
import type { Bitmap } from '../src/engine/ops'
import { resizeBitmap } from '../src/engine/ops-pure'
import { cloneParams, resolveParams } from '../src/engine/params'
import type { ScalarMap } from '../src/engine/types'
import { nodeImageOps } from '../src/platform/imageops-node'
import { heatmapToRgba } from '../src/render/heatmap'
import { resizeScalarMap } from './dataset'
import { buildOnboardingFrame, type Region } from './onboarding'

/**
 * Wortmarken für die Turbo-Skala, an den Farbwechseln der Rampe ausgerichtet
 * (`render/colormap.ts`). „Wird es warm?" braucht eine Grenze, die man
 * nachschlagen kann, sonst ist die Antwort Geschmackssache.
 */
export const BANDS: ReadonlyArray<{ upTo: number; label: string }> = [
  { upTo: 0.22, label: 'kalt (dunkelblau)' },
  { upTo: 0.36, label: 'blau' },
  { upTo: 0.5, label: 'türkis/grün' },
  { upTo: 0.62, label: 'gelbgrün' },
  { upTo: 0.75, label: 'warm (gelb/orange)' },
  { upTo: 1.01, label: 'heiß (rot)' },
]

export function bandOf(value: number): string {
  return BANDS.find((band) => value < band.upTo)?.label ?? BANDS[BANDS.length - 1].label
}

export type RegionMeasurement = {
  regionId: string
  label: string
  question: string
  /** Mittlere Aufmerksamkeit im Element. */
  mean: number
  /** Stärkster Punkt im Element — „heiß" ist eine Aussage über die Spitze. */
  max: number
  /** Wie viel Prozent aller Pixel schwächer sind als `max`. */
  percentileOfMax: number
  bandOfMean: string
  bandOfMax: string
}

export type AlphaPicture = {
  alpha: number
  /** Das fertige Overlay, in Bildschirmauflösung. */
  overlay: Bitmap
  /** Rang des CTA unter den Klick-Kandidaten — bewegt sich das mit? */
  ctaRank: number | null
  candidateCount: number
  measurements: RegionMeasurement[]
}

/** Anteil der Pixel unter `value`. */
function percentileOf(values: Float32Array, value: number): number {
  let below = 0
  for (let i = 0; i < values.length; i++) if (values[i] < value) below++
  return below / values.length
}

function measure(map: ScalarMap, region: Region, frameWidth: number): RegionMeasurement {
  const scale = map.width / frameWidth
  const rect = {
    x: region.rect.x * scale,
    y: region.rect.y * scale,
    width: Math.max(1, region.rect.width * scale),
    height: Math.max(1, region.rect.height * scale),
  }
  const mean = meanInRect(map.values, map.width, map.height, rect)

  let max = 0
  const x0 = Math.max(0, Math.floor(rect.x))
  const y0 = Math.max(0, Math.floor(rect.y))
  const x1 = Math.min(map.width, Math.ceil(rect.x + rect.width))
  const y1 = Math.min(map.height, Math.ceil(rect.y + rect.height))
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const value = map.values[y * map.width + x]
      if (value > max) max = value
    }
  }

  return {
    regionId: region.id,
    label: region.label,
    question: region.question,
    mean,
    max,
    percentileOfMax: percentileOf(map.values, max),
    bandOfMean: bandOf(mean),
    bandOfMax: bandOf(max),
  }
}

/** Legt das Heatmap-Overlay über das Bild, in Zielauflösung. */
function composite(base: Bitmap, map: ScalarMap, width: number, height: number, opacity: number): Bitmap {
  const scaled = resizeBitmap(base, width, height)
  // Erst hochskalieren, dann einfärben: umgekehrt würde die Transparenz
  // mitgemittelt und die Ränder der heißen Bereiche ausfransen.
  const rgba = heatmapToRgba(resizeScalarMap(map, width, height), opacity)
  const out = new Uint8ClampedArray(scaled.data)
  for (let p = 0; p < out.length; p += 4) {
    const alpha = rgba[p + 3] / 255
    if (alpha <= 0) continue
    out[p] = Math.round(out[p] * (1 - alpha) + rgba[p] * alpha)
    out[p + 1] = Math.round(out[p + 1] * (1 - alpha) + rgba[p + 1] * alpha)
    out[p + 2] = Math.round(out[p + 2] * (1 - alpha) + rgba[p + 2] * alpha)
  }
  return { width, height, data: out }
}

export type VisualCheckOptions = {
  alphas: readonly number[]
  /** Deckkraft des Overlays — die Voreinstellung des Panels. */
  opacity?: number
  tileWidth?: number
}

export type VisualCheckResult = {
  pictures: AlphaPicture[]
  /** Original links, danach je Alpha eine Spalte. */
  sheet: Uint8Array
  regions: Region[]
}

export async function runVisualCheck(options: VisualCheckOptions): Promise<VisualCheckResult> {
  const frame = buildOnboardingFrame()
  const opacity = options.opacity ?? 0.75
  const tileWidth = options.tileWidth ?? 320
  const tileHeight = Math.round((tileWidth * frame.frameHeight) / frame.frameWidth)

  const pictures: AlphaPicture[] = []

  for (const alpha of options.alphas) {
    const params = cloneParams(resolveParams('hybrid-v1'))
    params.blendAlpha = alpha
    const engine = new HeuristicAttentionEngine({ configId: 'hybrid-v1', params, priorAsset: 'mobile' })
    const analysis = await analyzeFrame(engine, nodeImageOps, {
      source: frame.image,
      signals: frame.signals,
      frameWidth: frame.frameWidth,
      frameHeight: frame.frameHeight,
    })
    if (!analysis) throw new Error('Analyse des Prüffalls abgebrochen')

    const candidates = scoreCandidates(frame.signals, analysis.attention, frame.frameWidth, frame.frameHeight)
    const ctaIndex = candidates.findIndex((candidate) => candidate.name.toLowerCase().includes('jetzt'))

    pictures.push({
      alpha,
      overlay: composite(frame.image, analysis.attention, tileWidth, tileHeight, opacity),
      ctaRank: ctaIndex < 0 ? null : ctaIndex + 1,
      candidateCount: candidates.length,
      measurements: frame.regions.map((region) => measure(analysis.attention, region, frame.frameWidth)),
    })
  }

  const gap = 8
  const background: [number, number, number] = [24, 24, 28]
  const columns = pictures.length + 1
  const width = columns * tileWidth + (columns + 1) * gap
  const height = tileHeight + gap * 2
  const data = new Uint8ClampedArray(width * height * 4)
  for (let p = 0; p < data.length; p += 4) {
    data[p] = background[0]
    data[p + 1] = background[1]
    data[p + 2] = background[2]
    data[p + 3] = 255
  }
  const sheet: Bitmap = { width, height, data }

  const blit = (source: Bitmap, x0: number, y0: number): void => {
    for (let y = 0; y < source.height; y++) {
      const from = y * source.width * 4
      const to = ((y0 + y) * width + x0) * 4
      sheet.data.set(source.data.subarray(from, from + source.width * 4), to)
    }
  }

  blit(resizeBitmap(frame.image, tileWidth, tileHeight), gap, gap)
  pictures.forEach((picture, index) => blit(picture.overlay, gap + (index + 1) * (tileWidth + gap), gap))

  return { pictures, sheet: nodeImageOps.encode(sheet), regions: frame.regions }
}

/**
 * iframe-side generation pipeline: PNG bytes in, rendered map PNGs out.
 *
 * Runs entirely in the iframe (PRD §6.3) — it must never call `figma.*`.
 */
import { scoreCandidates, type ClickCandidate } from '../engine/clickmap'
import { ENGINE_CONFIG } from '../engine/config'
import { defaultEngine } from '../engine/heuristic'
import { yieldToUi } from '../engine/imageops'
import type { ScalarMap } from '../engine/types'
import type { ClickRanking, MainToUi, RenderedMap, Settings } from '../messages'
import { canvasToPngBytes, decodePng, drawScaled, fitWithin, readPixels } from '../render/canvas'
import { renderClickmap } from '../render/clickmap'
import { renderFocusmap } from '../render/focusmap'
import { renderHeatmap } from '../render/heatmap'

export type FrameData = Extract<MainToUi, { type: 'FRAME_DATA' }>

export type PipelineResult = {
  maps: RenderedMap[]
  warnings: string[]
  /** Top candidates for the in-panel ranking list (FR-5). */
  ranking: ClickRanking[]
}

export type PipelineHooks = {
  /** Coarse progress within a single frame, `0..1`. */
  onStep?: (label: string, progress: number) => void
  /** Polled between steps; returning true aborts the frame. */
  isCancelled?: () => boolean
}

function toRanking(candidates: readonly ClickCandidate[]): ClickRanking[] {
  return candidates
    .slice(0, ENGINE_CONFIG.clickmap.rankingSize)
    .map((candidate) => ({ id: candidate.id, name: candidate.name, score: candidate.score }))
}

export async function generateMaps(
  data: FrameData,
  settings: Settings,
  hooks: PipelineHooks = {},
): Promise<PipelineResult> {
  const warnings: string[] = [...data.notices]
  const maps: RenderedMap[] = []
  const cancelled = (): boolean => hooks.isCancelled?.() === true

  hooks.onStep?.('Bild wird gelesen', 0.05)
  const bitmap = await decodePng(data.png)

  try {
    // Analysis always happens on the downscaled grid — never on full resolution.
    const analysisSize = fitWithin(bitmap.width, bitmap.height, ENGINE_CONFIG.analysisEdge)
    const analysisCanvas = drawScaled(bitmap, analysisSize.width, analysisSize.height)
    const pixels = readPixels(analysisCanvas)

    if (cancelled()) return { maps, warnings, ranking: [] }
    hooks.onStep?.('Aufmerksamkeit wird berechnet', 0.25)

    const values = await defaultEngine.predict({
      pixels,
      signals: data.signals,
      frameWidth: data.width,
      frameHeight: data.height,
    })
    const attention: ScalarMap = { width: analysisSize.width, height: analysisSize.height, values }

    // Output resolution is capped at Figma's image limit (verified: 4096 px).
    const output = fitWithin(bitmap.width, bitmap.height, ENGINE_CONFIG.render.maxImageEdge)
    const opacity = settings.overlayOpacity / 100

    let ranking: ClickRanking[] = []

    if (settings.maps.heat) {
      if (cancelled()) return { maps, warnings, ranking }
      hooks.onStep?.('Heatmap wird gezeichnet', 0.5)
      await yieldToUi()
      const canvas = renderHeatmap(bitmap, attention, output.width, output.height, { opacity })
      maps.push({ kind: 'heat', png: await canvasToPngBytes(canvas) })
    }

    if (settings.maps.click) {
      if (cancelled()) return { maps, warnings, ranking }
      hooks.onStep?.('Clickmap wird gezeichnet', 0.7)
      await yieldToUi()
      const candidates = scoreCandidates(data.signals, attention, data.width, data.height)
      if (candidates.length === 0) {
        warnings.push(
          'Keine interaktiven Elemente erkannt — benenne Buttons oder setze Prototype-Interaktionen. Clickmap übersprungen.',
        )
      } else {
        ranking = toRanking(candidates)
        const canvas = renderClickmap(bitmap, candidates, output.width, output.height, {
          opacity,
          frameWidth: data.width,
          frameHeight: data.height,
        })
        maps.push({ kind: 'click', png: await canvasToPngBytes(canvas), meta: ranking })
      }
    }

    if (settings.maps.focus) {
      if (cancelled()) return { maps, warnings, ranking }
      hooks.onStep?.('Focusmap wird gezeichnet', 0.85)
      await yieldToUi()
      const canvas = renderFocusmap(bitmap, attention, output.width, output.height, {
        threshold: settings.focusThreshold,
      })
      maps.push({ kind: 'focus', png: await canvasToPngBytes(canvas) })
    }

    hooks.onStep?.('Fertig', 1)
    return { maps, warnings, ranking }
  } finally {
    bitmap.close()
  }
}

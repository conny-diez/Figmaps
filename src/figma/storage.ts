/**
 * FR-10 — settings persistence via `figma.clientStorage`. Main thread only.
 */
import { DEFAULT_SETTINGS, type MapKind, type Settings } from '../messages'
import { ENGINE_CONFIG } from '../engine/config'

const STORAGE_KEY = 'attention-maps.settings.v1'

function clamp(value: number, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.min(max, Math.max(min, value))
}

/** Defensive normalisation — stored settings may predate a config change. */
export function normaliseSettings(raw: unknown): Settings {
  const input = (typeof raw === 'object' && raw !== null ? raw : {}) as Partial<Settings>
  const maps = (typeof input.maps === 'object' && input.maps !== null ? input.maps : {}) as Partial<Record<MapKind, boolean>>
  const focus = ENGINE_CONFIG.focus

  const normalised: Settings = {
    maps: {
      heat: maps.heat ?? DEFAULT_SETTINGS.maps.heat,
      click: maps.click ?? DEFAULT_SETTINGS.maps.click,
      focus: maps.focus ?? DEFAULT_SETTINGS.maps.focus,
    },
    overlayOpacity: Math.round(clamp(input.overlayOpacity as number, 0, 100, DEFAULT_SETTINGS.overlayOpacity)),
    focusThreshold: Math.round(
      clamp(input.focusThreshold as number, focus.minPercentile, focus.maxPercentile, DEFAULT_SETTINGS.focusThreshold),
    ),
    exportScale: input.exportScale === 1 ? 1 : 2,
  }
  return normalised
}

export async function loadSettings(): Promise<Settings> {
  try {
    return normaliseSettings(await figma.clientStorage.getAsync(STORAGE_KEY))
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

export async function saveSettings(settings: Settings): Promise<void> {
  await figma.clientStorage.setAsync(STORAGE_KEY, normaliseSettings(settings))
}

/**
 * FR-10 — settings persistence via `figma.clientStorage`. Main thread only.
 */
import { DEFAULT_SETTINGS, type MapKind, type Settings } from '../messages'
import { ENGINE_CONFIG } from '../engine/config'
import { DEFAULT_PROFILE, shippedProfiles } from '../engine/params'
import { hasPriorAsset, PRIOR_ASSET_IDS } from '../engine/priors'

const STORAGE_KEY = 'figmaps.settings.v1'

function clamp(value: number, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.min(max, Math.max(min, value))
}

/** Defensive normalisation — stored settings may predate a config change. */
export function normaliseSettings(raw: unknown): Settings {
  const input = (typeof raw === 'object' && raw !== null ? raw : {}) as Partial<Settings>
  const maps = (typeof input.maps === 'object' && input.maps !== null ? input.maps : {}) as Partial<Record<MapKind, boolean>>
  const focus = ENGINE_CONFIG.focus

  // Epic D — a stored profile that is no longer shipped falls back to the
  // default. Otherwise disabling an unproven profile would leave users stuck
  // on it.
  const allowed = shippedProfiles()
  const storedProfile = input.profile
  const profile = storedProfile && allowed.includes(storedProfile) ? storedProfile : DEFAULT_PROFILE

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
    profile,
    // A stored UI type whose prior is not in this build falls back to `auto`.
    uiType:
      input.uiType && input.uiType !== 'auto' && PRIOR_ASSET_IDS.includes(input.uiType) && hasPriorAsset(input.uiType)
        ? input.uiType
        : 'auto',
    viewportHeight:
      typeof input.viewportHeight === 'number' && Number.isFinite(input.viewportHeight)
        ? Math.round(clamp(input.viewportHeight, 200, 4000, ENGINE_CONFIG.viewport.desktopHeight))
        : null,
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

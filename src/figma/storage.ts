/**
 * FR-10 — settings persistence via `figma.clientStorage`. Main thread only.
 */
import {
  DEFAULT_PANEL_SIZE,
  DEFAULT_SETTINGS,
  PANEL_SIZE,
  type MapKind,
  type PanelSize,
  type Settings,
} from '../messages'
import { ENGINE_CONFIG } from '../engine/config'
import { DEFAULT_THEME } from '../ui/theme'
import { DEFAULT_PROFILE, shippedProfiles } from '../engine/params'
import { hasPriorAsset, PRIOR_ASSET_IDS } from '../engine/priors'

const STORAGE_KEY = 'figmaps.settings.v1'
const PANEL_SIZE_KEY = 'figmaps.panelSize.v1'

function clamp(value: number, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.min(max, Math.max(min, value))
}

/** Defensive normalisation — stored settings may predate a config change. */
export function normaliseSettings(raw: unknown): Settings {
  const input = (typeof raw === 'object' && raw !== null ? raw : {}) as Partial<Settings>
  const maps = (typeof input.maps === 'object' && input.maps !== null ? input.maps : {}) as Partial<Record<MapKind, boolean>>

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
      // Eine gespeicherte Einstellung von vor 1.2 kennt die Contrastmap nicht;
      // sie bekommt die Voreinstellung statt `false`. Eine neue Ausgabe, die
      // still ausgeschaltet ankommt, sieht aus wie eine, die es nicht gibt.
      contrast: maps.contrast ?? DEFAULT_SETTINGS.maps.contrast,
    },
    overlayOpacity: Math.round(clamp(input.overlayOpacity as number, 0, 100, DEFAULT_SETTINGS.overlayOpacity)),
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
    // Anything but an explicit `light` means dark — first start, a corrupted
    // value, or a Figma running in light mode all land on the same default.
    theme: input.theme === 'light' ? 'light' : DEFAULT_THEME,
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

// ---------------------------------------------------------------------------
// Panel geometry
// ---------------------------------------------------------------------------

/**
 * The single authority over what the panel may be sized to. The iframe clamps
 * too, for a cursor that stops where the panel stops, but it is untrusted: a
 * `resize` to a negative height throws in the Figma API and would take the
 * plugin down with it.
 */
export function normalisePanelSize(raw: unknown): PanelSize {
  const input = (typeof raw === 'object' && raw !== null ? raw : {}) as Partial<PanelSize>
  return {
    width: Math.round(
      clamp(input.width as number, PANEL_SIZE.minWidth, PANEL_SIZE.maxWidth, DEFAULT_PANEL_SIZE.width),
    ),
    height: Math.round(
      clamp(input.height as number, PANEL_SIZE.minHeight, PANEL_SIZE.maxHeight, DEFAULT_PANEL_SIZE.height),
    ),
  }
}

export async function loadPanelSize(): Promise<PanelSize> {
  try {
    return normalisePanelSize(await figma.clientStorage.getAsync(PANEL_SIZE_KEY))
  } catch {
    return { ...DEFAULT_PANEL_SIZE }
  }
}

export async function savePanelSize(size: PanelSize): Promise<void> {
  await figma.clientStorage.setAsync(PANEL_SIZE_KEY, normalisePanelSize(size))
}

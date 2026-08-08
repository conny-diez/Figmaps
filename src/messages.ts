/**
 * Shared message + data contract between the Figma main thread (`src/main.ts`)
 * and the iframe (`src/ui.tsx`). This module must stay free of any `figma.*`
 * access and free of any DOM access so that both bundles can import it.
 */

export type MapKind = 'heat' | 'click' | 'focus'

export const MAP_KINDS: readonly MapKind[] = ['heat', 'click', 'focus']

export const MAP_LABELS: Record<MapKind, string> = {
  heat: 'Heatmap',
  click: 'Clickmap',
  focus: 'Focusmap',
}

/**
 * Structural signal extracted per visible descendant node (FR-3).
 * All geometry is expressed in *root frame pixels* (unscaled), with the
 * root frame's top-left corner as origin.
 */
export type NodeSignal = {
  id: string
  /** Id of the parent node, or `null` for direct children of the root frame. */
  parentId: string | null
  name: string
  type: string
  x: number
  y: number
  width: number
  height: number
  /** Document order index, higher = further in front. */
  zIndex: number
  opacity: number
  isText: boolean
  fontSize?: number
  /** Derived from `fontName.style` (e.g. "Semi Bold" -> 600). */
  fontWeight?: number
  charCount?: number
  /** `fills` contains a visible IMAGE paint. */
  isImage: boolean
  /** `fills` contains any visible paint — used by the button heuristic (FR-5). */
  hasFill: boolean
  /** `node.reactions.length > 0` — a real prototype hotspot. */
  hasReactions: boolean
  /** Lowercased tokens of `node.name` matched against INTERACTIVE_KEYWORDS. */
  nameHints: string[]
  /** Relative luminance of the dominant solid fill, `[0,1]`. */
  fillLuminance?: number
}

export type FrameSummary = {
  id: string
  name: string
  width: number
  height: number
  /** Shorter edge below the minimum — rejected with a warning (FR-1). */
  tooSmall: boolean
}

export type Settings = {
  maps: Record<MapKind, boolean>
  /** Heatmap overlay opacity in percent, 0–100. */
  overlayOpacity: number
  /** Focusmap percentile threshold, 60–95. */
  focusThreshold: number
  exportScale: 1 | 2
}

export const DEFAULT_SETTINGS: Settings = {
  maps: { heat: true, click: true, focus: true },
  overlayOpacity: 65,
  focusThreshold: 80,
  exportScale: 2,
}

export type GenerateConfig = {
  frameIds: string[]
  settings: Settings
}

export type ClickRanking = {
  id: string
  name: string
  /** Normalised probability in `[0,1]`; all candidates of a frame sum to 1. */
  score: number
}

export type RenderedMap = {
  kind: MapKind
  png: Uint8Array
  meta?: ClickRanking[]
}

export type ErrorCode =
  | 'NO_SELECTION'
  | 'INVALID_NODE'
  | 'FRAME_TOO_SMALL'
  | 'EXPORT_FAILED'
  | 'DECODE_FAILED'
  | 'RENDER_FAILED'
  | 'PLACE_FAILED'
  | 'STORAGE_FAILED'
  | 'UNKNOWN'

/** German plain-text fallbacks — the user never sees a stack trace (NFR-5). */
export const ERROR_TEXT: Record<ErrorCode, string> = {
  NO_SELECTION: 'Wähle einen Frame aus.',
  INVALID_NODE: 'Die Auswahl enthält kein gültiges Frame-Element.',
  FRAME_TOO_SMALL: 'Der Frame ist zu klein für eine sinnvolle Analyse.',
  EXPORT_FAILED: 'Der Frame konnte nicht als Bild exportiert werden.',
  DECODE_FAILED: 'Das exportierte Bild konnte nicht gelesen werden.',
  RENDER_FAILED: 'Die Maps konnten nicht berechnet werden.',
  PLACE_FAILED: 'Die Maps konnten nicht auf dem Canvas platziert werden.',
  STORAGE_FAILED: 'Die Einstellungen konnten nicht gespeichert werden.',
  UNKNOWN: 'Unerwarteter Fehler.',
}

// ---------------------------------------------------------------------------
// UI -> Main
// ---------------------------------------------------------------------------

export type UiToMain =
  | { type: 'REQUEST_SELECTION' }
  | { type: 'GENERATE'; config: GenerateConfig }
  | { type: 'CANCEL' }
  | {
      type: 'PLACE_RESULT'
      frameId: string
      maps: RenderedMap[]
      /** Non-fatal, user-facing notes produced while rendering. */
      warnings: string[]
    }
  | { type: 'SAVE_SETTINGS'; settings: Settings }

// ---------------------------------------------------------------------------
// Main -> UI
// ---------------------------------------------------------------------------

export type MainToUi =
  | { type: 'SELECTION'; frames: FrameSummary[] }
  | { type: 'SETTINGS'; settings: Settings }
  | {
      type: 'FRAME_DATA'
      frameId: string
      frameName: string
      png: Uint8Array
      signals: NodeSignal[]
      /** Root frame size in frame pixels (not the exported pixel size). */
      width: number
      height: number
      /** Scale actually used for the export — may differ from the setting. */
      exportScale: number
      /** Non-fatal notes from the main thread (scale fallback, node cap, …). */
      notices: string[]
    }
  | { type: 'BATCH_PROGRESS'; current: number; total: number; frameName: string }
  | { type: 'FRAME_DONE'; frameId: string; frameName: string; maps: MapKind[]; warnings: string[] }
  | { type: 'DONE'; created: number; failed: number }
  | { type: 'ERROR'; code: ErrorCode; message: string; frameName?: string }

/** Narrows the raw `event.data.pluginMessage` payload. */
export function isMainToUi(value: unknown): value is MainToUi {
  return typeof value === 'object' && value !== null && typeof (value as { type?: unknown }).type === 'string'
}

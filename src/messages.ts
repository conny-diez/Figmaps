/**
 * Shared message + data contract between the Figma main thread (`src/main.ts`)
 * and the iframe (`src/ui.tsx`). This module must stay free of any `figma.*`
 * access and free of any DOM access so that both bundles can import it.
 */
import { DEFAULT_PROFILE, type ProfileId } from './engine/params'
import type { PriorAssetId } from './engine/priors'

export type { ProfileId, PriorAssetId }

/**
 * Which reference population the location prior is taken from.
 *
 * `auto` derives it from the frame geometry. That reliably separates web pages
 * from mobile apps, but cannot recognise desktop-app UIs or posters — they are
 * geometrically indistinguishable from web pages (see `priors/index.ts`). The
 * person who drew the frame can say instead.
 */
export type UiTypeSetting = PriorAssetId | 'auto'

/** `fold` is derived, not selectable — see `SELECTABLE_MAP_KINDS`. */
export type MapKind = 'heat' | 'click' | 'focus' | 'fold'

/** The maps the user can switch on and off. */
export const SELECTABLE_MAP_KINDS: readonly Exclude<MapKind, 'fold'>[] = ['heat', 'click', 'focus']

export const MAP_KINDS: readonly MapKind[] = ['heat', 'click', 'focus', 'fold']

export const MAP_LABELS: Record<MapKind, string> = {
  heat: 'Heatmap',
  click: 'Clickmap',
  focus: 'Focusmap',
  fold: 'Above the Fold',
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
  /**
   * Visible characters of a TEXT node, whitespace-collapsed and length-capped.
   *
   * Findings name elements by what they *say* before what their layer is
   * called: „JobsResultCard" is a fact about the file, not about the screen the
   * reviewer is looking at. Only the leading `maxTextLength` characters travel,
   * because a finding is one sentence.
   */
  text?: string
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
  maps: Record<Exclude<MapKind, 'fold'>, boolean>
  /** Heatmap overlay opacity in percent, 0–100. */
  overlayOpacity: number
  /** Focusmap percentile threshold, 60–95. */
  focusThreshold: number
  exportScale: 1 | 2
  /** Epic D — viewing-duration profile. Only shipped profiles are offered. */
  profile: ProfileId
  /** Which location prior to use; `auto` derives it from the frame geometry. */
  uiType: UiTypeSetting
  /**
   * Epic B — viewport height in frame px, or `null` for the derived default.
   * Overridable because "900 px desktop" is an assumption, not a measurement.
   */
  viewportHeight: number | null
}

export const DEFAULT_SETTINGS: Settings = {
  maps: { heat: true, click: true, focus: true },
  overlayOpacity: 65,
  focusThreshold: 80,
  exportScale: 2,
  profile: DEFAULT_PROFILE,
  uiType: 'auto',
  viewportHeight: null,
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

/**
 * Epic C — one finding as it travels to the main thread. Mirrors
 * `src/findings/types.ts`; declared here so `main.ts` does not have to import
 * the rule engine just to render a text frame.
 */
export type FindingPayload = {
  id: string
  severity: 'info' | 'attention' | 'problem'
  text: string
  nodeIds?: string[]
}

/** Epic B — what the analysis did with the frame, for labels and text frames. */
export type SegmentInfo = {
  segmented: boolean
  sectionCount: number
  viewportHeight: number
  /** Fold positions in frame pixels. */
  folds: number[]
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
      findings: FindingPayload[]
      segments?: SegmentInfo
    }
  | { type: 'SAVE_SETTINGS'; settings: Settings }
  /** C-3 — "Im Canvas zeigen": select the nodes and scroll them into view. */
  | { type: 'REVEAL_NODES'; nodeIds: string[] }

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
  | {
      type: 'FRAME_DONE'
      frameId: string
      frameName: string
      maps: MapKind[]
      warnings: string[]
      findings: FindingPayload[]
      segments?: SegmentInfo
    }
  | { type: 'DONE'; created: number; failed: number }
  | { type: 'ERROR'; code: ErrorCode; message: string; frameName?: string }

/** Narrows the raw `event.data.pluginMessage` payload. */
export function isMainToUi(value: unknown): value is MainToUi {
  return typeof value === 'object' && value !== null && typeof (value as { type?: unknown }).type === 'string'
}

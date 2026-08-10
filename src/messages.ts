/**
 * Shared message + data contract between the Figma main thread (`src/main.ts`)
 * and the iframe (`src/ui.tsx`). This module must stay free of any `figma.*`
 * access and free of any DOM access so that both bundles can import it.
 */
import { DEFAULT_PROFILE, type ProfileId } from './engine/params'
import type { PriorAssetId } from './engine/priors'
import { DEFAULT_THEME, type ThemeName } from './ui/theme'

export type { ThemeName }

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
export type MapKind = 'heat' | 'click' | 'focus' | 'contrast' | 'fold'

/**
 * The maps the user can switch on and off, in the order they are shown in the
 * panel — and the order the result frames are placed on the canvas (FR-8).
 * Heatmap first (where attention goes at all), then Focusmap (what stays sharp),
 * then Clickmap (what gets clicked).
 */
export const SELECTABLE_MAP_KINDS: readonly Exclude<MapKind, 'fold'>[] = ['heat', 'focus', 'contrast', 'click']

export const MAP_KINDS: readonly MapKind[] = ['heat', 'focus', 'contrast', 'click', 'fold']

/**
 * Whether the clickmap is offered in the panel. **Display only** — candidate
 * detection keeps running either way, because `cta-rank` and `cta-below-fold`
 * are derived from it (see `ui/pipeline.ts`).
 *
 * Off since the onboarding-screen review: exactly one candidate was found on a
 * screen that has at least six tappable things, and it was labelled „100 %".
 * A distribution over one element is not a prediction, it is an artefact of
 * normalising a single number. The conditions for switching this back on are in
 * the README („Clickmap — warum sie nicht im Panel steht").
 */
export const CLICKMAP_IN_PANEL = false

/** The maps the panel currently offers — `SELECTABLE_MAP_KINDS` minus the flag. */
export const PANEL_MAP_KINDS: readonly Exclude<MapKind, 'fold'>[] = SELECTABLE_MAP_KINDS.filter(
  (kind) => kind !== 'click' || CLICKMAP_IN_PANEL,
)

export const MAP_LABELS: Record<MapKind, string> = {
  heat: 'Heatmap',
  click: 'Clickmap',
  focus: 'Focusmap',
  contrast: 'Contrastmap',
  fold: 'Above the Fold',
}

/**
 * One line per map, shown under its label in the panel. Kept short enough to
 * fit on a single line at 320 px panel width — the row truncates rather than
 * wraps.
 */
export const MAP_DESCRIPTIONS: Record<Exclude<MapKind, 'fold'>, string> = {
  heat: 'Wohin die Aufmerksamkeit zuerst wandert',
  click: 'Die wahrscheinlichsten Klickziele',
  focus: 'Was scharf bleibt, wenn der Rest abfällt',
  contrast: 'Prüft, ob Texte genug Kontrast zu ihrem Hintergrund haben',
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
  /**
   * Eigendrehung des Knotens in Grad, relativ zum Elternknoten. Fehlt, wenn der
   * Knotentyp keine Drehung kennt.
   *
   * Nur die Kontrastmessung liest es, und sie liest es, weil `x/y/width/height`
   * hier die **achsenparallele** Bounding-Box sind: bei einem gedrehten
   * Textknoten ist diese Box größer als der Text und überwiegend mit Pixeln
   * gefüllt, die nicht hinter ihm liegen. Ohne dieses Feld ist das aus dem
   * Signal nicht zu erkennen — und die Messung meldete eine Zahl über
   * Fremdpixel (`contrast/measurable.ts`).
   */
  rotation?: number
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
  /** Epic D — viewing-duration profile. Only shipped profiles are offered. */
  profile: ProfileId
  /** Which location prior to use; `auto` derives it from the frame geometry. */
  uiType: UiTypeSetting
  /**
   * Epic B — viewport height in frame px, or `null` for the derived default.
   * Overridable because "900 px desktop" is an assumption, not a measurement.
   */
  viewportHeight: number | null
  /**
   * Panel skin. Deliberately not derived from Figma's theme — see `ui/theme.ts`.
   * Dark is the default at first start and when the stored value is unusable.
   */
  theme: ThemeName
}

export const DEFAULT_SETTINGS: Settings = {
  maps: { heat: true, click: true, focus: true, contrast: true },
  overlayOpacity: 65,
  profile: DEFAULT_PROFILE,
  uiType: 'auto',
  viewportHeight: null,
  theme: DEFAULT_THEME,
}

/**
 * Panel geometry in CSS pixels, as `figma.ui.resize` takes it.
 *
 * Kept out of `Settings` on purpose: the size is a property of the window, not
 * of the analysis, and it is written on every frame of a resize drag — mixing
 * it into the settings record would rewrite the analysis config hundreds of
 * times per drag.
 */
export type PanelSize = { width: number; height: number }

/**
 * The default is the compact panel of the redesign. `minWidth` is the width the
 * layout was drawn for — the map rows truncate rather than wrap, so narrower
 * would cut labels off. The maxima only exist so a stray pointer event cannot
 * produce an absurd window; Figma clamps to the viewport on top of this.
 */
export const PANEL_SIZE = {
  defaultWidth: 320,
  defaultHeight: 680,
  minWidth: 320,
  maxWidth: 720,
  minHeight: 420,
  maxHeight: 2400,
} as const

export const DEFAULT_PANEL_SIZE: PanelSize = {
  width: PANEL_SIZE.defaultWidth,
  height: PANEL_SIZE.defaultHeight,
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
 * What a map depends on, in the words the panel uses.
 *
 * Nothing of this is painted onto the screenshot any more — it is written as
 * Figma text nodes next to the image (`figma/place.ts`). It still has to travel
 * with the result, because the iframe is the only realm that knows which prior
 * and which profile were actually used.
 *
 * „Ortsprior" is gone from all of it on purpose: the term named the mechanism,
 * not the thing, and the panel now says „Blickverhalten" above the same choice.
 */
export type MapMeta = {
  /** Which reference population, e.g. „Mobile App" or „Webseite (automatisch)". */
  screenBehaviour: string
  /** Viewing duration the prediction is calibrated for, e.g. „Blick (1 s)". */
  duration: string
  /** CC BY 4.0 notice for the bundled data, or absent when none ships. */
  attribution?: string
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

/**
 * Ein Befund der Contrastmap (C4).
 *
 * **Eigener Typ, nicht `FindingPayload` mit einem Flag.** Die beiden sind
 * verschiedene Arten von Aussage, und die Trennung muss im Typ stehen, damit
 * sie nicht versehentlich in einer Liste landen:
 *
 *   `FindingPayload`  ist eine **Vorhersage**. „Liegt auf Rang 5 der
 *                     vorhergesagten Klicks." Kann falsch sein, trägt den
 *                     Vorhersage-Disclaimer, ist im Vorhersage-Modus formuliert.
 *   `ContrastFinding` ist eine **überprüfbare Tatsache**. „Hat 3,1:1 gegen
 *                     seinen Hintergrund, WCAG AA verlangt 4,5:1." Wer das
 *                     nachmisst, bekommt dieselbe Zahl. Der Disclaimer gilt
 *                     dafür ausdrücklich **nicht**.
 *
 * Das ist die belastbarste Ausgabe, die das Plugin hat, und sie darf nicht
 * durch Nachbarschaft an Glaubwürdigkeit verlieren.
 */
export type ContrastFinding = {
  nodeId: string
  status: 'bestanden' | 'grenzwertig' | 'durchgefallen'
  text: string
  /** Gemessenes Verhältnis, für die Sortierung im Panel. */
  ratio: number
  required: number
  /** Hintergrund wechselt unter dem Text — der Wert ist eine Näherung (C5). */
  approximate: boolean
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
      /** C4 — getrennt von `findings`, siehe `ContrastFinding`. */
      contrastFindings?: ContrastFinding[]
      segments?: SegmentInfo
      /** Absent only when the frame failed before anything was rendered. */
      mapMeta?: MapMeta
    }
  | { type: 'SAVE_SETTINGS'; settings: Settings }
  /** C-3 — "Im Canvas zeigen": select the nodes and scroll them into view. */
  | { type: 'REVEAL_NODES'; nodeIds: string[] }
  /** Sent continuously while the corner grip is dragged. */
  | { type: 'RESIZE'; size: PanelSize }

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
      /** C4 — getrennt von `findings`, siehe `ContrastFinding`. */
      contrastFindings?: ContrastFinding[]
      segments?: SegmentInfo
    }
  | { type: 'DONE'; created: number; failed: number }
  | { type: 'ERROR'; code: ErrorCode; message: string; frameName?: string }

/** Narrows the raw `event.data.pluginMessage` payload. */
export function isMainToUi(value: unknown): value is MainToUi {
  return typeof value === 'object' && value !== null && typeof (value as { type?: unknown }).type === 'string'
}

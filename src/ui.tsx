/**
 * iframe entry point (PRD §5, §6.3).
 *
 * This realm owns the whole UI and all image processing. It must never call
 * `figma.*` — the only channel to the document is `parent.postMessage`.
 */
import { render } from 'preact'
import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks'
import { ENGINE_CONFIG } from './engine/config'
import { PROFILE_LABELS, shippedProfiles, type ProfileId } from './engine/params'
import { availablePriorCategories, PRIOR_ASSET_LABELS, shipsPriorAsset } from './engine/priors'
import { SEVERITY_LABELS } from './findings/types'
import {
  DEFAULT_SETTINGS,
  isMainToUi,
  MAP_DESCRIPTIONS,
  CLICKMAP_IN_PANEL,
  MAP_LABELS,
  PANEL_MAP_KINDS,
  PANEL_SIZE,
  SELECTABLE_MAP_KINDS,
  type ClickRanking,
  type ContrastFinding,
  type FindingPayload,
  type FrameSummary,
  type MapKind,
  type SegmentInfo,
  type Settings,
  type UiToMain,
} from './messages'
import { Logo } from './ui/logo'
import { generateMaps, type FrameData } from './ui/pipeline'
import { paletteFor } from './ui/theme'
import { PLUGIN_LABEL } from './version'

type Phase = 'empty' | 'ready' | 'working' | 'done' | 'error'

type FrameOutcome = {
  frameName: string
  maps: MapKind[]
  warnings: string[]
  findings: FindingPayload[]
  segments?: SegmentInfo
}

/**
 * Was die Ergebnis-Sektionen zeigen, samt dem Frame, zu dem es gehört.
 *
 * Der Name ist Teil des Zustands und nicht ein zweites State daneben: eine
 * Beschriftung, die getrennt vom Inhalt gesetzt wird, kann von ihm abweichen —
 * genau der Fehler, den 1.3 an der Fußzeile der Karten behoben hat.
 */
type FrameDetail = {
  frameName: string
  findings: FindingPayload[]
  contrastFindings: ContrastFinding[]
  nonTextFindings: ContrastFinding[]
  segments: SegmentInfo
}

/**
 * Epic D — only profiles the harness has shown to beat the center-bias
 * baseline are offered. Three profiles of which one is noise are worse than
 * one profile, so the control disappears entirely while only `scan` is proven.
 */
const AVAILABLE_PROFILES: ProfileId[] = shippedProfiles()

/**
 * CC BY 4.0 requires naming the authors wherever the derived asset is
 * distributed. The maps are in the bundle as soon as the plugin is built —
 * independent of which engine configuration is active — so the notice is shown
 * whenever the bundle carries them. See NOTICE.md.
 */
const PRIOR_ATTRIBUTION = shipsPriorAsset()

/**
 * UI types with a prior in this build. The geometry rule only ever picks
 * `web` or `mobile`; desktop-app UIs and posters are geometrically
 * indistinguishable from web pages, so they need to be stated.
 */
const AVAILABLE_UI_TYPES = availablePriorCategories()

/**
 * Splits a label of the form `Blick (1 s)` so the parenthetical can be set in
 * the mono face, as the design does. Purely typographic — the words are the
 * ones from `PROFILE_LABELS`.
 */
function splitLabel(label: string): { main: string; sub: string | null } {
  const match = /^(.*?)\s*\(([^)]*)\)\s*$/.exec(label)
  return match ? { main: match[1], sub: match[2] } : { main: label, sub: null }
}

/**
 * Das 38-px-Bild links in jeder Map-Karte (`DESIGN.md` §4, „Selection Card").
 *
 * Es ist ein **abstraktes Bild der Map-Art, kein Abbild der Auswahl** — kein
 * Export, keine Engine, kein Caching, reines CSS. Deshalb nennt das UI es
 * nirgends eine Vorschau des Frames: es zeigt, was die Map-*Art* mit einem
 * Screen macht, nicht wie *dieser* Screen aussieht.
 *
 * Die Overlay-Deckkraft liest es trotzdem, denn ein Bild, das den Regler neben
 * sich ignoriert, ist Dekoration statt Erklärung — und eine abgeschaltete Map
 * dimmt das ganze Feld.
 *
 * **Was gegenüber dem 56 × 88-Schema davor wegfällt, und warum.** Die vier
 * Wireframe-Balken: auf 38 px wären sie Grieß. Und die Falz-Schraffur, die aus
 * der Viewport-Höhe kam: bei einem 2.400 px hohen Frame lagen zwei Drittel des
 * Feldes unter der Falz, und vom Bild der Map blieb ein Streifenmuster. Die
 * Alternative wäre gewesen, die Schraffur zu deckeln — dann hätte sie einen
 * Anteil behauptet, der nicht stimmt. Die Aussage steht jetzt dort, wo sie
 * überprüfbar ist: im Hinweis unter dem Viewport-Regler.
 */
function MapPreview({
  kind,
  settings,
}: {
  kind: Exclude<MapKind, 'fold'>
  settings: Settings
}): preact.JSX.Element {
  // The focus threshold is a constant now, so the spread of the sharp area is
  // one too — derived from it rather than restated.
  const spread = 30 + (100 - ENGINE_CONFIG.focus.percentile) * 1.6

  return (
    <span
      class="preview"
      aria-hidden="true"
      style={{
        '--layer-opacity': settings.maps[kind] ? (settings.overlayOpacity / 100).toFixed(2) : '0',
        '--spread': `${spread.toFixed(0)}%`,
      }}
    >
      <span class={`preview__layer preview__layer--${kind}`} />
    </span>
  )
}

/** Balken eines Reglers — 20, wie `DESIGN.md` §4 sie angibt. */
const SLIDER_BARS = 20

/**
 * Bar slider — the design's control, and a `role="slider"` rather than an
 * `input[type=range]`, because a native range cannot draw bars of growing
 * height.
 *
 * Everything a native range would have given us for free is therefore ours to
 * provide, and all of it is required, not optional: the ARIA value trio plus
 * `aria-valuetext` (the number alone reads as „80" where the panel shows
 * „80 %"), arrow keys, Home/End, Shift for the coarse step, a visible focus
 * ring, and `setPointerCapture` — without which the value jumps as soon as the
 * pointer leaves the strip mid-drag.
 */
function BarSlider({
  label,
  value,
  valueText,
  min,
  max,
  step,
  disabled,
  onChange,
}: {
  label: string
  value: number
  valueText: string
  min: number
  max: number
  step: number
  disabled: boolean
  onChange: (value: number) => void
}): preact.JSX.Element {
  const ref = useRef<HTMLDivElement | null>(null)
  const fraction = max > min ? (Math.min(Math.max(value, min), max) - min) / (max - min) : 0

  const quantise = (raw: number): number => {
    const snapped = Math.round(raw / step) * step
    // Steps of 0.1 accumulate float noise that would show up in the label.
    const rounded = Math.round(snapped * 1000) / 1000
    return Math.min(max, Math.max(min, rounded))
  }

  const setFromPointer = (clientX: number): void => {
    const rect = ref.current?.getBoundingClientRect()
    if (!rect || rect.width <= 0) return
    const t = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width))
    onChange(quantise(min + t * (max - min)))
  }

  const onKeyDown = (event: KeyboardEvent): void => {
    if (disabled) return
    const coarse = event.shiftKey ? Math.max(step, (max - min) / 10) : step
    const key = event.key
    let next: number | null = null
    if (key === 'ArrowRight' || key === 'ArrowUp') next = value + coarse
    else if (key === 'ArrowLeft' || key === 'ArrowDown') next = value - coarse
    else if (key === 'PageUp') next = value + Math.max(step, (max - min) / 10)
    else if (key === 'PageDown') next = value - Math.max(step, (max - min) / 10)
    else if (key === 'Home') next = min
    else if (key === 'End') next = max
    if (next === null) return
    event.preventDefault()
    onChange(quantise(next))
  }

  return (
    <div class="slider">
      <div class="slider__head">
        <span class="slider__name" id={`slider-${label}`}>
          {label}
        </span>
        <span class="slider__value">{valueText}</span>
      </div>
      <div
        ref={ref}
        class="slider__bars"
        role="slider"
        tabIndex={disabled ? -1 : 0}
        aria-labelledby={`slider-${label}`}
        aria-valuenow={value}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuetext={valueText}
        aria-disabled={disabled}
        onKeyDown={onKeyDown}
        onPointerDown={(event: PointerEvent) => {
          if (disabled || event.button !== 0) return
          ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
          setFromPointer(event.clientX)
        }}
        onPointerMove={(event: PointerEvent) => {
          if (disabled || event.buttons === 0) return
          if (!(event.currentTarget as HTMLElement).hasPointerCapture(event.pointerId)) return
          setFromPointer(event.clientX)
        }}
        onPointerUp={(event: PointerEvent) => {
          ;(event.currentTarget as HTMLElement).releasePointerCapture(event.pointerId)
        }}
      >
        {/* §4: gefüllt `6px + index · 0.6px`, leer 5 px. Die Höhe trägt den
            Wert mit, damit die Leiste nicht nur zwei Farben ist. */}
        {Array.from({ length: SLIDER_BARS }, (_, index) => {
          const centre = (index + 0.5) / SLIDER_BARS
          const on = centre <= fraction
          return (
            <i
              key={index}
              class={on ? 'is-on' : ''}
              style={{ height: `${(on ? 6 + index * 0.6 : 5).toFixed(1)}px` }}
            />
          )
        })}
      </div>
    </div>
  )
}

function send(message: UiToMain): void {
  parent.postMessage({ pluginMessage: message }, '*')
}

type DropdownOption = { value: string; label: string }

/**
 * The design specifies a custom listbox (amber dot, rotating caret, floating
 * panel) that a native `<select>` cannot express. Same options and the same
 * change callback as the `<select>` it replaces.
 */
function Dropdown({
  value,
  options,
  disabled,
  onChange,
}: {
  value: string
  options: DropdownOption[]
  disabled: boolean
  onChange: (value: string) => void
}): preact.JSX.Element {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (disabled) setOpen(false)
  }, [disabled])

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent): void => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  const current = options.find((option) => option.value === value)

  return (
    <div class="select" ref={rootRef}>
      <button
        type="button"
        class="select__trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen((prev) => !prev)}
      >
        <span class="select__value">{current?.label ?? ''}</span>
        <span class="select__caret" aria-hidden="true">
          ▼
        </span>
      </button>
      {open && (
        <div class="select__menu" role="listbox">
          {options.map((option) => (
            <button
              key={option.value}
              type="button"
              role="option"
              aria-selected={option.value === value}
              class="select__option"
              onClick={() => {
                onChange(option.value)
                setOpen(false)
              }}
            >
              <span>{option.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

/** Arrow-key step of the resize grip, in px. */
const RESIZE_STEP = 24

function clampSize(width: number, height: number): { width: number; height: number } {
  return {
    width: Math.round(Math.min(PANEL_SIZE.maxWidth, Math.max(PANEL_SIZE.minWidth, width))),
    height: Math.round(Math.min(PANEL_SIZE.maxHeight, Math.max(PANEL_SIZE.minHeight, height))),
  }
}

/**
 * Corner grip that resizes the plugin window.
 *
 * Figma owns the iframe's size, so the panel's current size is exactly
 * `window.innerWidth/innerHeight`. The grab offset is taken once on pointerdown
 * — without it the panel would jump so that its corner lands under the cursor.
 * The main thread clamps again; this clamp only exists so the panel stops
 * growing under the cursor at the limits instead of silently ignoring the drag.
 */
function Resizer(): preact.JSX.Element {
  const grab = useRef<{ dx: number; dy: number } | null>(null)

  const requestSize = useCallback((width: number, height: number) => {
    send({ type: 'RESIZE', size: clampSize(width, height) })
  }, [])

  return (
    <div
      class="resizer"
      role="separator"
      aria-label="Panelgröße ändern"
      tabIndex={0}
      title="Ziehen, um das Panel zu skalieren"
      onPointerDown={(event: PointerEvent) => {
        if (event.button !== 0) return
        grab.current = {
          dx: window.innerWidth - event.clientX,
          dy: window.innerHeight - event.clientY,
        }
        ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
        event.preventDefault()
      }}
      onPointerMove={(event: PointerEvent) => {
        const offset = grab.current
        if (!offset) return
        // The pointer can leave the iframe mid-drag (the panel is a separate
        // document), and the `pointerup` then never arrives here. Without this
        // check, moving back over the grip would resume the drag with no button
        // held down.
        if (event.buttons === 0) {
          grab.current = null
          return
        }
        requestSize(event.clientX + offset.dx, event.clientY + offset.dy)
      }}
      onPointerUp={(event: PointerEvent) => {
        grab.current = null
        ;(event.currentTarget as HTMLElement).releasePointerCapture(event.pointerId)
      }}
      onPointerCancel={() => {
        grab.current = null
      }}
      onKeyDown={(event: KeyboardEvent) => {
        const dx = event.key === 'ArrowRight' ? RESIZE_STEP : event.key === 'ArrowLeft' ? -RESIZE_STEP : 0
        const dy = event.key === 'ArrowDown' ? RESIZE_STEP : event.key === 'ArrowUp' ? -RESIZE_STEP : 0
        if (dx === 0 && dy === 0) return
        event.preventDefault()
        requestSize(window.innerWidth + dx, window.innerHeight + dy)
      }}
      onDblClick={() => requestSize(PANEL_SIZE.defaultWidth, PANEL_SIZE.defaultHeight)}
    >
      <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
        <path d="M11 1 1 11M11 5.5 5.5 11M11 10l-1 1" stroke="currentColor" stroke-width="1.25" fill="none" />
      </svg>
    </div>
  )
}

function App(): preact.JSX.Element {
  const [frames, setFrames] = useState<FrameSummary[]>([])
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS)
  const [phase, setPhase] = useState<Phase>('empty')
  const [progress, setProgress] = useState({ current: 0, total: 0, label: '', fraction: 0 })
  const [outcomes, setOutcomes] = useState<FrameOutcome[]>([])
  const [ranking, setRanking] = useState<ClickRanking[]>([])
  const [errors, setErrors] = useState<string[]>([])
  /**
   * Die Ergebnis-Sektionen zeigen **einen** Frame — den letzten, der fertig
   * wurde. Der Name steht deshalb im selben Zustand wie der Inhalt.
   *
   * Vorher lagen Befunde, Kontrastwerte und Abschnitte in vier getrennten
   * States, und jeder wurde je Frame überschrieben. Die Ergebniszeile darüber
   * zählte den ganzen Lauf — die Sektionen darunter beschrieben einen Frame und
   * sagten nicht, welchen. Dieselbe Fehlerklasse wie die Fußzeile der Karten,
   * und mit derselben Antwort: der Name gehört an den Inhalt, nicht daneben.
   * Ein Objekt statt vier States, damit die beiden nicht auseinanderlaufen
   * können.
   */
  const [detail, setDetail] = useState<FrameDetail | null>(null)

  // Refs, because the message handler is installed once and must not close over
  // stale state.
  const settingsRef = useRef(settings)
  settingsRef.current = settings
  // Mirrors `errors` synchronously — `DONE` may arrive before Preact re-renders.
  const errorsRef = useRef<string[]>([])
  const cancelledRef = useRef(false)

  const pushError = useCallback((text: string) => {
    errorsRef.current = [...errorsRef.current, text]
    setErrors(errorsRef.current)
  }, [])

  const usableFrames = useMemo(() => frames.filter((frame) => !frame.tooSmall), [frames])
  const tooSmallFrames = useMemo(() => frames.filter((frame) => frame.tooSmall), [frames])

  const handleFrameData = useCallback(async (data: FrameData) => {
    try {
      const result = await generateMaps(data, settingsRef.current, {
        isCancelled: () => cancelledRef.current,
        onStep: (label, fraction) => setProgress((prev) => ({ ...prev, label, fraction })),
      })
      // Ohne die Bedingung wäre die Liste leer, wenn der letzte Frame keine
      // Kandidaten hatte — mit ihr stand sie aus einem FRÜHEREN Frame da, und
      // eine Rangliste, die zu einem anderen Screen gehört als die Befunde
      // darunter, ist schlimmer als keine.
      setRanking(result.ranking)
      setDetail({
        frameName: data.frameName,
        findings: result.findings,
        contrastFindings: result.contrastFindings,
        nonTextFindings: result.nonTextFindings,
        segments: result.segments,
      })
      send({
        type: 'PLACE_RESULT',
        frameId: data.frameId,
        maps: result.maps,
        warnings: result.warnings,
        findings: result.findings,
        contrastFindings: result.contrastFindings,
        segments: result.segments,
        mapMeta: result.mapMeta,
      })
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      pushError(`${data.frameName}: Maps konnten nicht berechnet werden (${detail}).`)
      send({ type: 'PLACE_RESULT', frameId: data.frameId, maps: [], warnings: [], findings: [] })
    }
  }, [pushError])

  useEffect(() => {
    const onMessage = (event: MessageEvent): void => {
      const envelope = event.data as { pluginMessage?: unknown } | null | undefined
      const typed = envelope?.pluginMessage
      if (!isMainToUi(typed)) return

      switch (typed.type) {
        case 'SETTINGS':
          setSettings(typed.settings)
          break

        case 'SELECTION':
          setFrames(typed.frames)
          setPhase((prev) => {
            if (prev === 'working') return prev
            return typed.frames.some((frame) => !frame.tooSmall) ? 'ready' : 'empty'
          })
          break

        case 'BATCH_PROGRESS':
          setProgress({ current: typed.current, total: typed.total, label: typed.frameName, fraction: 0 })
          break

        case 'FRAME_DATA':
          void handleFrameData(typed)
          break

        case 'FRAME_DONE':
          setOutcomes((prev) => [
            ...prev,
            {
              frameName: typed.frameName,
              maps: typed.maps,
              warnings: typed.warnings,
              findings: typed.findings,
              segments: typed.segments,
            },
          ])
          break

        case 'DONE':
          setPhase(errorsRef.current.length > 0 ? 'error' : 'done')
          break

        case 'ERROR':
          pushError(typed.frameName ? `${typed.frameName}: ${typed.message}` : typed.message)
          break
      }
    }

    window.addEventListener('message', onMessage)
    send({ type: 'REQUEST_SELECTION' })
    return () => window.removeEventListener('message', onMessage)
  }, [handleFrameData, pushError])

  // The palette is written as custom properties rather than swapped as a
  // stylesheet, so every rule keeps referring to the same token names and the
  // switch cannot leave half the panel on the old theme.
  useEffect(() => {
    const palette = paletteFor(settings.theme)
    const root = document.documentElement
    for (const [token, value] of Object.entries(palette)) root.style.setProperty(`--${token}`, value)
    root.dataset.theme = settings.theme
  }, [settings.theme])

  const patchSettings = useCallback((patch: Partial<Settings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch }
      send({ type: 'SAVE_SETTINGS', settings: next })
      return next
    })
  }, [])

  const toggleMap = useCallback(
    (kind: MapKind, enabled: boolean) => {
      setSettings((prev) => {
        const next = { ...prev, maps: { ...prev.maps, [kind]: enabled } }
        send({ type: 'SAVE_SETTINGS', settings: next })
        return next
      })
    },
    [],
  )

  const activeMapCount = PANEL_MAP_KINDS.filter((kind) => settings.maps[kind]).length
  const anyMapSelected = activeMapCount > 0
  const canGenerate = phase !== 'working' && usableFrames.length > 0 && anyMapSelected

  const start = useCallback(() => {
    cancelledRef.current = false
    setOutcomes([])
    setRanking([])
    setDetail(null)
    errorsRef.current = []
    setErrors([])
    setPhase('working')
    setProgress({ current: 0, total: usableFrames.length, label: 'Wird vorbereitet', fraction: 0 })
    send({
      type: 'GENERATE',
      config: { frameIds: usableFrames.map((frame) => frame.id), settings: settingsRef.current },
    })
  }, [usableFrames])

  const cancel = useCallback(() => {
    cancelledRef.current = true
    send({ type: 'CANCEL' })
  }, [])

  /**
   * „Zurücksetzen" — die sekundäre Aktion der Fußzeile (`DESIGN.md` §4).
   *
   * Das Theme bleibt dabei stehen: es ist keine Einstellung der Analyse, sondern
   * die Entscheidung, in welchem Licht der Nutzer arbeitet. Ein Reset, der das
   * Panel ins Dunkle zurückwirft, während es hell steht, hätte etwas
   * zurückgesetzt, worüber niemand gesprochen hat.
   */
  const reset = useCallback(() => {
    patchSettings({ ...DEFAULT_SETTINGS, theme: settingsRef.current.theme })
  }, [patchSettings])

  const isDefaultSettings =
    settings.overlayOpacity === DEFAULT_SETTINGS.overlayOpacity &&
    settings.profile === DEFAULT_SETTINGS.profile &&
    settings.uiType === DEFAULT_SETTINGS.uiType &&
    settings.viewportHeight === DEFAULT_SETTINGS.viewportHeight &&
    SELECTABLE_MAP_KINDS.every((kind) => settings.maps[kind] === DEFAULT_SETTINGS.maps[kind])

  const reveal = useCallback((nodeIds: string[]) => {
    send({ type: 'REVEAL_NODES', nodeIds })
  }, [])

  const isFinished = phase === 'done' || phase === 'error'
  const createdCount = outcomes.reduce((sum, outcome) => sum + outcome.maps.length, 0)
  // 1.3, Text-Bindungs-Prinzip: beides aus den Karten, die es gibt.
  //
  // Vorher zählte die Zeile `outcomes.length` — und darin steckt auch ein Frame,
  // der gar keine Karte erzeugt hat (`maps: []` bei `RENDER_FAILED`). „2 Maps für
  // 2 Frames erstellt" stand dann über einem Lauf, in dem ein Frame leer
  // ausgegangen war.
  const framesWithMaps = outcomes.filter((outcome) => outcome.maps.length > 0).length
  /**
   * Der Frame-Name vor einer Sektions-Beschriftung — nur, wenn mehr als ein
   * Frame gelaufen ist.
   *
   * Dieselbe Regel und dieselbe Form wie bei den Warnungen ein paar Zeilen
   * weiter unten (`${outcome.frameName}: ${warning}`). Bei einem Frame wäre der
   * Name Rauschen; bei mehreren ist „Befunde" ohne ihn eine Behauptung über den
   * ganzen Lauf, während darunter ein Frame steht.
   */
  const sectionLabel = (label: string): string =>
    outcomes.length > 1 && detail ? `${detail.frameName}: ${label}` : label
  // Und ob eine Above-the-fold-Map entstanden ist, hängt nicht an der
  // Segmentierung, sondern daran, ob die Heatmap eingeschaltet war: die Fold-Map
  // wird im Rumpf des Heatmap-Zweigs erzeugt (`ui/pipeline.ts`). Mit
  // ausgeschalteter Heatmap versprach die Zusammenfassung eine Karte, die es
  // nicht gab.
  const hasFoldMap = outcomes.some((outcome) => outcome.maps.includes('fold'))
  const allWarnings = outcomes.flatMap((outcome) =>
    outcome.warnings.map((warning) => (outcomes.length > 1 ? `${outcome.frameName}: ${warning}` : warning)),
  )

  const percentDone = Math.round(progress.fraction * 100)
  /**
   * Der Statuszähler rechts in der Aktionszeile.
   *
   * Jede der drei Formen kommt aus dem, was tatsächlich gilt: während des Laufs
   * der Frame-Fortschritt, danach die Zahl der **entstandenen** Karten (nicht
   * der gewünschten), davor die Zahl der gewählten Maps. Er ist knapp gehalten,
   * weil er neben zwei Knöpfen in eine 320 px breite Zeile muss — und er ist der
   * Grund, warum der CTA seine eigene Zählung („2×") verloren hat: dieselbe Zahl
   * zweimal in einer Zeile ist keine zweite Information.
   */
  const runCount =
    phase === 'working'
      ? `${progress.current}/${progress.total}`
      : isFinished
        ? `${createdCount} ${createdCount === 1 ? 'Map' : 'Maps'}`
        : `${activeMapCount}×`

  return (
    <div class="app">
      {/* §4: Icon-Tile → Plugin-Name → Version → Theme-Schalter → Schließen. */}
      <header class="app__header">
        <span class="app__tile">
          <Logo size={16} />
        </span>
        <h1 class="app__title">Figmaps</h1>
        {/* The engine version stays with the maps (the line under each map
            title); the header names the product the user installed — plus the
            Beta marker, which is a statement about the prediction, not about
            the code (see `version.ts`). */}
        <p class="app__version">{PLUGIN_LABEL}</p>
        <button
          type="button"
          class="themepill"
          aria-label={settings.theme === 'dark' ? 'Zum hellen Design wechseln' : 'Zum dunklen Design wechseln'}
          aria-pressed={settings.theme === 'light'}
          title="Design wechseln"
          onClick={() => patchSettings({ theme: settings.theme === 'dark' ? 'light' : 'dark' })}
        >
          {/* Mond = Dark, Punkt = Light (§4). */}
          <span class={settings.theme === 'dark' ? 'is-on' : ''} aria-hidden="true">
            ☾
          </span>
          <span class={settings.theme === 'light' ? 'is-on' : ''} aria-hidden="true">
            ●
          </span>
        </button>
        <button type="button" class="iconbutton" aria-label="Plugin schließen" onClick={() => send({ type: 'CLOSE' })}>
          <span aria-hidden="true">✕</span>
        </button>
      </header>

      <div class="app__body">
        <section class="section">
          {frames.length === 0 ? (
            <div class="selection selection--empty">
              <span class="selection__icon" aria-hidden="true" />
              <span class="selection__name">Wähle einen Frame aus.</span>
            </div>
          ) : (
            <div class={`selection${usableFrames.length === 0 ? ' selection--empty' : ''}`}>
              <span class="selection__icon" aria-hidden="true" />
              {usableFrames.length === 1 ? (
                <>
                  <span class="selection__name">{usableFrames[0].name}</span>
                  <span class="selection__meta">
                    {usableFrames[0].width}×{usableFrames[0].height}
                  </span>
                </>
              ) : usableFrames.length > 1 ? (
                <>
                  <span class="selection__name">{usableFrames.length} Frames ausgewählt</span>
                  <span class="selection__meta">Werden nacheinander verarbeitet</span>
                </>
              ) : (
                <span class="selection__name">Kein verwendbarer Frame ausgewählt.</span>
              )}
            </div>
          )}
          {tooSmallFrames.length > 0 && (
            <div class="notice">
              {tooSmallFrames.length === 1
                ? `„${tooSmallFrames[0].name}" ist zu klein für eine sinnvolle Analyse (min. ${ENGINE_CONFIG.traversal.minFrameEdge} px pro Kante).`
                : `${tooSmallFrames.length} Frames sind zu klein für eine sinnvolle Analyse (min. ${ENGINE_CONFIG.traversal.minFrameEdge} px pro Kante).`}
            </div>
          )}
        </section>

        {AVAILABLE_PROFILES.length > 1 && (
          <section class="section">
            <p class="section__label">Betrachtungsdauer</p>
            {/* Kein gleitender Thumb mehr: aktiv ist eine hellere Fläche mit
                Kontur (§4, §6.2). Ein Thumb in Akzentfarbe war das zweite Gelb
                im Panel. */}
            <div class="segmented" style={{ '--seg-count': String(AVAILABLE_PROFILES.length) }}>
              {AVAILABLE_PROFILES.map((profile) => {
                const { main, sub } = splitLabel(PROFILE_LABELS[profile])
                return (
                  <button
                    key={profile}
                    type="button"
                    aria-pressed={settings.profile === profile}
                    disabled={phase === 'working'}
                    onClick={() => patchSettings({ profile })}
                  >
                    {main}
                    {sub && <span class="segmented__sub"> {sub}</span>}
                  </button>
                )
              })}
            </div>
          </section>
        )}

        {PRIOR_ATTRIBUTION && AVAILABLE_UI_TYPES.length > 0 && (
          <section class="section">
            <p class="section__label">Art des Screens</p>
            <Dropdown
              value={settings.uiType}
              disabled={phase === 'working'}
              options={[
                { value: 'auto', label: 'Automatisch erkennen' },
                ...AVAILABLE_UI_TYPES.map((id) => ({ value: id, label: PRIOR_ASSET_LABELS[id] })),
              ]}
              onChange={(uiType) => patchSettings({ uiType: uiType as Settings['uiType'] })}
            />
            <p class="hint">
              Bestimmt, mit welchem typischen Blickverhalten verglichen wird.
              {settings.uiType === 'auto' &&
                ' Aus der Frame-Geometrie abgeleitet — unterscheidet Webseite und Mobile App zuverlässig, Desktop-Anwendung und Poster nicht.'}
            </p>
          </section>
        )}

        <section class="section section--maps">
          <p class="section__label">Maps</p>
          <div class="maplist">
            {PANEL_MAP_KINDS.map((kind) => (
              <label class={`mapcard${settings.maps[kind] ? ' is-on' : ''}`} key={kind}>
                <input
                  type="checkbox"
                  checked={settings.maps[kind]}
                  disabled={phase === 'working'}
                  onChange={(event) => toggleMap(kind, event.currentTarget.checked)}
                />
                <MapPreview kind={kind} settings={settings} />
                <span class="mapcard__text">
                  <span class="mapcard__label">{MAP_LABELS[kind]}</span>
                  <span class="mapcard__desc">{MAP_DESCRIPTIONS[kind]}</span>
                </span>
                {/* Last in the row: the switch belongs at the edge of the card,
                    not wedged between the preview and the words it labels. */}
                <span class="toggle" aria-hidden="true">
                  <span class="toggle__knob" />
                </span>
              </label>
            ))}
          </div>
          {!anyMapSelected && <div class="notice">Wähle mindestens eine Map aus.</div>}
        </section>

        <section class="section section--sliders">
          <BarSlider
            label="Overlay-Deckkraft"
            value={settings.overlayOpacity}
            valueText={`${settings.overlayOpacity} %`}
            min={0}
            max={100}
            step={1}
            disabled={phase === 'working'}
            onChange={(overlayOpacity) => patchSettings({ overlayOpacity: Math.round(overlayOpacity) })}
          />

          <div class="slider-with-hint">
            <BarSlider
              label="Viewport-Höhe"
              value={settings.viewportHeight ?? ENGINE_CONFIG.viewport.desktopHeight}
              valueText={settings.viewportHeight === null ? 'automatisch' : `${settings.viewportHeight} px`}
              min={ENGINE_CONFIG.viewport.desktopHeight - 500}
              max={ENGINE_CONFIG.viewport.desktopHeight + 700}
              step={50}
              disabled={phase === 'working'}
              onChange={(viewportHeight) => patchSettings({ viewportHeight: Math.round(viewportHeight) })}
            />
            <p class="hint">
              Ab {ENGINE_CONFIG.viewport.segmentThreshold} Viewport-Höhen wird der Frame abschnittsweise
              analysiert.{' '}
              {settings.viewportHeight !== null && (
                <button type="button" class="linkbutton" onClick={() => patchSettings({ viewportHeight: null })}>
                  zurücksetzen
                </button>
              )}
            </p>
          </div>
        </section>

        {/* Meldungen bleiben im Rumpf, die Knöpfe sind in die Fußzeile gezogen
            (`DESIGN.md` §4, „Footer"). „Erneut versuchen" ist damit weg: es tat
            dasselbe wie der CTA, und zwei primäre Aktionen widersprechen Regel 1
            — der eine Knopf unten startet den Lauf, ob nach einem Fehler oder
            nicht. */}
        {(allWarnings.length > 0 || errors.length > 0) && (
          <section class="section">
            {allWarnings.map((warning) => (
              <div class="notice" key={warning}>
                {warning}
              </div>
            ))}

            {errors.map((error) => (
              <div class="notice notice--error" key={error}>
                {error}
              </div>
            ))}
          </section>
        )}

        {isFinished && (
          <>
            <section class="section section--result">
              <p class="section__label">Ergebnis</p>
              <div class="result">
                <span class="result__count">{createdCount}</span>
                <span class="result__text">
                  {createdCount === 1 ? 'Map' : 'Maps'} für{' '}
                  {framesWithMaps === 1 ? '1 Frame' : `${framesWithMaps} Frames`} erstellt
                </span>
              </div>
              {(detail?.segments.segmented || errors.length > 0) && (
                <ul class="summary">
                  {detail?.segments.segmented && (
                    <li>
                      {outcomes.length > 1 ? `${detail.frameName}: ` : ''}
                      In {detail.segments.sectionCount} Abschnitten à {detail.segments.viewportHeight} px analysiert
                      {hasFoldMap ? ', mit Above-the-fold-Map' : ''}
                    </li>
                  )}
                  {errors.length > 0 && <li>{errors.length} Frame(s) mit Fehlern</li>}
                </ul>
              )}
            </section>

            {detail && detail.findings.length > 0 && (
              <section class="section">
                <p class="section__label">{sectionLabel('Befunde')}</p>
                <ul class="findings">
                  {detail.findings.map((finding) => (
                    <li key={finding.id} class={`findings__item findings__item--${finding.severity}`}>
                      <span class="findings__dot" aria-hidden="true" />
                      <div class="findings__body">
                        <span class="findings__severity">{SEVERITY_LABELS[finding.severity]}</span>
                        <span class="findings__text">{finding.text}</span>
                        {finding.nodeIds && finding.nodeIds.length > 0 && (
                          <button
                            type="button"
                            class="linkbutton findings__link"
                            onClick={() => reveal(finding.nodeIds ?? [])}
                          >
                            Im Canvas zeigen
                          </button>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {/* C4 — eigene Sektion, eigene Bezeichnung, und der
                Vorhersage-Disclaimer gilt hier NICHT.

                Die Trennung ist kein Layout-Detail: darüber stehen
                Vorhersagen, die falsch sein können, hier stehen Messwerte, die
                jeder nachrechnen kann. In einer Liste vermischt würde das eine
                das andere abwerten — und zwar in die falsche Richtung, denn die
                belastbarere Aussage verlöre. */}
            {detail && detail.contrastFindings.length > 0 && (
              <section class="section">
                <p class="section__label">{sectionLabel('Kontrast (gemessen)')}</p>
                <p class="section__hint">
                  Nach WCAG 2.1 AA geprüft. Keine Vorhersage — diese Werte sind nachmessbar.
                </p>
                <ul class="findings">
                  {detail.contrastFindings
                    .filter((entry) => entry.status !== 'bestanden')
                    .map((entry) => (
                      <li key={entry.nodeId} class={`findings__item findings__item--${entry.status === 'durchgefallen' ? 'problem' : 'attention'}`}>
                        <span class="findings__dot" aria-hidden="true" />
                        <div class="findings__body">
                          <span class="findings__severity">
                            {entry.status === 'durchgefallen' ? 'Durchgefallen' : 'Grenzwertig'}
                          </span>
                          <span class="findings__text">{entry.text}</span>
                          <button
                            type="button"
                            class="linkbutton findings__link"
                            onClick={() => reveal([entry.nodeId])}
                          >
                            Im Canvas zeigen
                          </button>
                        </div>
                      </li>
                    ))}
                </ul>
                <p class="section__hint">
                  {detail.contrastFindings.filter((entry) => entry.status === 'bestanden').length} weitere Textelemente
                  erfüllen die Anforderung.
                </p>
              </section>
            )}

            {/* WCAG 1.4.11 — eigene Sektion, weil hier eine EINSCHÄTZUNG
                drinsteckt: ob ein Element eine Komponente ist, entscheidet
                eine Heuristik über Name und Prototype-Interaktion. 1.4.3
                darüber ist reine Tatsache. Die beiden dürfen nicht denselben
                Anstrich bekommen. */}
            {detail && detail.nonTextFindings.length > 0 && (
              <section class="section">
                <p class="section__label">{sectionLabel('Kontrast von Bedienelementen')}</p>
                <p class="section__hint">
                  Nach WCAG 2.1 AA (1.4.11), 3:1 für die Begrenzung gegen die angrenzende Farbe. Welche Elemente
                  Komponenten sind, schätzt das Plugin aus Name und Prototype-Interaktion — Elemente mit eigener
                  Beschriftung sind ausgenommen, weil die Beschriftung sie identifiziert.
                </p>
                <ul class="findings">
                  {detail.nonTextFindings.map((entry) => (
                    <li key={entry.nodeId} class="findings__item findings__item--attention">
                      <span class="findings__dot" aria-hidden="true" />
                      <div class="findings__body">
                        <span class="findings__severity">Prüfen</span>
                        <span class="findings__text">{entry.text}</span>
                        <button type="button" class="linkbutton findings__link" onClick={() => reveal([entry.nodeId])}>
                          Im Canvas zeigen
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
                <p class="section__hint">
                  Nicht prüfbar: Zustände (ein Frame zeigt einen), und ob eine Komponente inaktiv ist — inaktive
                  sind von 1.4.11 ausgenommen.
                </p>
              </section>
            )}

            {/* The ranking is the clickmap's numbers in list form and goes
                with it: percentages over a candidate set that is not proven
                complete read as a measurement. See `CLICKMAP_IN_PANEL`. */}
            {CLICKMAP_IN_PANEL && ranking.length > 0 && (
              <section class="section">
                <div class="section__head">
                  <p class="section__label">{sectionLabel('Klick-Ranking')}</p>
                  <span class="section__note">vorhergesagt</span>
                </div>
                <ol class="ranking">
                  {ranking.map((entry, index) => (
                    <li key={entry.id}>
                      <span
                        class="ranking__fill"
                        aria-hidden="true"
                        style={{ '--pct': `${Math.round(entry.score * 100)}%` }}
                      />
                      <span class="ranking__rank">{String(index + 1).padStart(2, '0')}</span>
                      <span class="ranking__name">{entry.name}</span>
                      <span class="ranking__score">{Math.round(entry.score * 100)} %</span>
                    </li>
                  ))}
                </ol>
              </section>
            )}
          </>
        )}
      </div>

      {/* §4: zwei Zonen. Oben die Aktionszeile mit genau einer primären Aktion
          und dem Statuszähler rechts, darunter die Hinweiszeile — Hinweise
          stehen immer am Panelende und sind nie farbig. */}
      <footer class="app__footer">
        {phase === 'working' && (
          <div class="footer__run">
            <div class="status">
              <span>
                {progress.total > 1 && progress.current > 0
                  ? `Frame ${progress.current} von ${progress.total}`
                  : 'Wird berechnet'}
              </span>
              <span class="status__value">{percentDone} %</span>
            </div>
            <div class="progress">
              <div class="progress__bar" style={{ width: `${percentDone}%` }} />
            </div>
            <div class="status__detail">{progress.label}</div>
          </div>
        )}

        <div class="footer__actions">
          {/* Während eines Laufs gibt es keinen gelben Knopf: „Abbrechen" ist
              nicht die primäre Aktion, und ein deaktivierter CTA daneben wäre
              eine gelbe Fläche, die nichts tut. */}
          {phase === 'working' ? (
            <button type="button" class="button" onClick={cancel}>
              Abbrechen
            </button>
          ) : (
            <button type="button" class="button button--primary" disabled={!canGenerate} onClick={start}>
              Maps erstellen
            </button>
          )}
          <button type="button" class="button" disabled={phase === 'working' || isDefaultSettings} onClick={reset}>
            Zurücksetzen
          </button>
          {/* Statuszähler, Mono: er sagt, was gilt — vor dem Lauf, was gewählt
              ist, danach, was tatsächlich entstanden ist. */}
          <span class="footer__count">{runCount}</span>
        </div>

        <div class="footer__hint">
          <span class="hintmark" aria-hidden="true">
            i
          </span>
          {/* One type style for all three paragraphs: the graded, dimmer
              secondary style made the provenance unreadable, and it is not
              secondary — it is what the disclaimer above it rests on. */}
          <div>
            <p>
              Algorithmische Vorhersage, keine Messdaten. Basiert auf Layout und Pixeln, nicht auf beobachtetem
              Nutzerverhalten.
            </p>
            {PRIOR_ATTRIBUTION && (
              <p>
                Die Vorhersage nutzt echte Blickdaten von 62 Testpersonen, gemessen auf 1.980 UI-Screens
                (UEyes-Datensatz, Jiang et al., CHI 2023, CC BY 4.0).
              </p>
            )}
            <p>Figmaps — entwickelt von Constantin Diessenbacher</p>
          </div>
        </div>
      </footer>

      <Resizer />
    </div>
  )
}

const root = document.getElementById('root')
if (root) render(<App />, root)

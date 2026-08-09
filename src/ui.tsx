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
  MAP_LABELS,
  PANEL_SIZE,
  SELECTABLE_MAP_KINDS,
  type ClickRanking,
  type FindingPayload,
  type FrameSummary,
  type MapKind,
  type SegmentInfo,
  type Settings,
  type UiToMain,
} from './messages'
import { Logo } from './ui/logo'
import { generateMaps, type FrameData } from './ui/pipeline'
import { PLUGIN_VERSION } from './version'

type Phase = 'empty' | 'ready' | 'working' | 'done' | 'error'

type FrameOutcome = {
  frameName: string
  maps: MapKind[]
  warnings: string[]
  findings: FindingPayload[]
  segments?: SegmentInfo
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

/** Position of a range value on its track, in percent — drives `--fill`. */
function fillPercent(value: number, min: number, max: number): string {
  if (max <= min) return '0%'
  const clamped = Math.min(Math.max(value, min), max)
  return `${((clamped - min) / (max - min)) * 100}%`
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
  const [findings, setFindings] = useState<FindingPayload[]>([])
  const [segments, setSegments] = useState<SegmentInfo | null>(null)

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
      if (result.ranking.length > 0) setRanking(result.ranking)
      setFindings(result.findings)
      setSegments(result.segments)
      send({
        type: 'PLACE_RESULT',
        frameId: data.frameId,
        maps: result.maps,
        warnings: result.warnings,
        findings: result.findings,
        segments: result.segments,
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

  const activeMapCount = SELECTABLE_MAP_KINDS.filter((kind) => settings.maps[kind]).length
  const anyMapSelected = settings.maps.heat || settings.maps.click || settings.maps.focus
  const canGenerate = phase !== 'working' && usableFrames.length > 0 && anyMapSelected

  const start = useCallback(() => {
    cancelledRef.current = false
    setOutcomes([])
    setRanking([])
    setFindings([])
    setSegments(null)
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

  const reveal = useCallback((nodeIds: string[]) => {
    send({ type: 'REVEAL_NODES', nodeIds })
  }, [])

  const isFinished = phase === 'done' || phase === 'error'
  const createdCount = outcomes.reduce((sum, outcome) => sum + outcome.maps.length, 0)
  const allWarnings = outcomes.flatMap((outcome) =>
    outcome.warnings.map((warning) => (outcomes.length > 1 ? `${outcome.frameName}: ${warning}` : warning)),
  )

  const profileIndex = Math.max(0, AVAILABLE_PROFILES.indexOf(settings.profile))
  const percentDone = Math.round(progress.fraction * 100)

  return (
    <div class="app">
      <header class="app__header">
        <Logo size={27} />
        <h1 class="app__title">Figmaps</h1>
        {/* The engine version stays on the maps themselves (legend footer);
            the header names the version of the plugin. */}
        <p class="app__subtitle">{PLUGIN_VERSION}</p>
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
            <div class="notice notice--warning">
              {tooSmallFrames.length === 1
                ? `„${tooSmallFrames[0].name}" ist zu klein für eine sinnvolle Analyse (min. ${ENGINE_CONFIG.traversal.minFrameEdge} px pro Kante).`
                : `${tooSmallFrames.length} Frames sind zu klein für eine sinnvolle Analyse (min. ${ENGINE_CONFIG.traversal.minFrameEdge} px pro Kante).`}
            </div>
          )}
        </section>

        {AVAILABLE_PROFILES.length > 1 && (
          <section class="section">
            <p class="section__label">Betrachtungsdauer</p>
            <div
              class="segmented"
              style={{
                '--seg-count': String(AVAILABLE_PROFILES.length),
                '--seg-index': String(profileIndex),
              }}
            >
              <span class="segmented__thumb" aria-hidden="true" />
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
            {SELECTABLE_MAP_KINDS.map((kind) => (
              <label class={`maptoggle${settings.maps[kind] ? ' is-on' : ''}`} key={kind}>
                <input
                  type="checkbox"
                  checked={settings.maps[kind]}
                  disabled={phase === 'working'}
                  onChange={(event) => toggleMap(kind, event.currentTarget.checked)}
                />
                <span class="maptoggle__track" aria-hidden="true">
                  <span class="maptoggle__knob" />
                </span>
                <span class="maptoggle__text">
                  <span class="maptoggle__label">{MAP_LABELS[kind]}</span>
                  <span class="maptoggle__desc">{MAP_DESCRIPTIONS[kind]}</span>
                </span>
                <span class={`maptoggle__swatch maptoggle__swatch--${kind}`} aria-hidden="true" />
              </label>
            ))}
          </div>
          {!anyMapSelected && <div class="notice notice--warning">Wähle mindestens eine Map aus.</div>}
        </section>

        <section class="section section--sliders">
          <div class="slider">
            <div class="slider__head">
              <span class="slider__name">Overlay-Deckkraft</span>
              <span class="slider__value">{settings.overlayOpacity} %</span>
            </div>
            <input
              type="range"
              min={0}
              max={100}
              step={1}
              value={settings.overlayOpacity}
              disabled={phase === 'working'}
              style={{ '--fill': fillPercent(settings.overlayOpacity, 0, 100) }}
              onInput={(event) =>
                patchSettings({ overlayOpacity: Number(event.currentTarget.value) })
              }
            />
          </div>

          <div class="slider">
            <div class="slider__head">
              <span class="slider__name">Viewport-Höhe</span>
              <span class="slider__value">
                {settings.viewportHeight === null ? 'automatisch' : `${settings.viewportHeight} px`}
              </span>
            </div>
            <input
              type="range"
              min={ENGINE_CONFIG.viewport.desktopHeight - 500}
              max={ENGINE_CONFIG.viewport.desktopHeight + 700}
              step={50}
              value={settings.viewportHeight ?? ENGINE_CONFIG.viewport.desktopHeight}
              disabled={phase === 'working'}
              style={{
                '--fill': fillPercent(
                  settings.viewportHeight ?? ENGINE_CONFIG.viewport.desktopHeight,
                  ENGINE_CONFIG.viewport.desktopHeight - 500,
                  ENGINE_CONFIG.viewport.desktopHeight + 700,
                ),
              }}
              onInput={(event) => patchSettings({ viewportHeight: Number(event.currentTarget.value) })}
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

        <section class="section section--cta">
          {phase === 'working' ? (
            <>
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
              <button type="button" class="button button--secondary" onClick={cancel}>
                Abbrechen
              </button>
            </>
          ) : (
            <button type="button" class="button" disabled={!canGenerate} onClick={start}>
              <span>Maps erstellen</span>
              {canGenerate && <span class="button__hint">{activeMapCount}×</span>}
            </button>
          )}

          {allWarnings.map((warning) => (
            <div class="notice notice--warning" key={warning}>
              {warning}
            </div>
          ))}

          {errors.map((error) => (
            <div class="notice notice--error" key={error}>
              {error}
            </div>
          ))}

          {isFinished && errors.length > 0 && (
            <button type="button" class="button button--secondary" disabled={!canGenerate} onClick={start}>
              Erneut versuchen
            </button>
          )}
        </section>

        {isFinished && (
          <>
            <section class="section section--result">
              <p class="section__label">Ergebnis</p>
              <div class="result">
                <span class="result__count">{createdCount}</span>
                <span class="result__text">
                  {createdCount === 1 ? 'Map' : 'Maps'} für{' '}
                  {outcomes.length === 1 ? '1 Frame' : `${outcomes.length} Frames`} erstellt
                </span>
              </div>
              {(segments?.segmented || errors.length > 0) && (
                <ul class="summary">
                  {segments?.segmented && (
                    <li>
                      In {segments.sectionCount} Abschnitten à {segments.viewportHeight} px analysiert, mit
                      Above-the-fold-Map
                    </li>
                  )}
                  {errors.length > 0 && <li>{errors.length} Frame(s) mit Fehlern</li>}
                </ul>
              )}
            </section>

            {findings.length > 0 && (
              <section class="section">
                <p class="section__label">Befunde</p>
                <ul class="findings">
                  {findings.map((finding) => (
                    <li key={finding.id} class={`findings__item findings__item--${finding.severity}`}>
                      <span class="findings__bar" aria-hidden="true" />
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

            {ranking.length > 0 && (
              <section class="section">
                <div class="section__head">
                  <p class="section__label">Klick-Ranking</p>
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

      <footer class="app__footer">
        <span class="disclaimer__icon" aria-hidden="true">
          i
        </span>
        <div>
          <span class="disclaimer__text">
            Algorithmische Vorhersage, keine Messdaten. Basiert auf Layout und Pixeln, nicht auf beobachtetem
            Nutzerverhalten.
          </span>
          {PRIOR_ATTRIBUTION && (
            <p class="attribution">
              Der Ortsprior basiert auf echten Blickdaten von 62 Testpersonen, gemessen auf 1.980 UI-Screens
              (UEyes-Datensatz, Jiang et al., CHI 2023, CC BY 4.0), gemittelt und verkleinert.
            </p>
          )}
          <p class="attribution attribution--author">Figmaps — entwickelt von Constantin Diessenbacher</p>
        </div>
      </footer>

      <Resizer />
    </div>
  )
}

const root = document.getElementById('root')
if (root) render(<App />, root)

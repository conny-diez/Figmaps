/**
 * iframe entry point (PRD §5, §6.3).
 *
 * This realm owns the whole UI and all image processing. It must never call
 * `figma.*` — the only channel to the document is `parent.postMessage`.
 */
import { render } from 'preact'
import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks'
import { ENGINE_CONFIG, ENGINE_VERSION } from './engine/config'
import { PROFILE_LABELS, shippedProfiles, type ProfileId } from './engine/params'
import { shipsPriorAsset } from './engine/priors'
import { SEVERITY_LABELS } from './findings/types'
import {
  DEFAULT_SETTINGS,
  isMainToUi,
  MAP_LABELS,
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

function send(message: UiToMain): void {
  parent.postMessage({ pluginMessage: message }, '*')
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

  return (
    <div class="app">
      <header class="app__header">
        <Logo />
        <div>
          <h1 class="app__title">FigMaps</h1>
          <p class="app__subtitle">Engine {ENGINE_VERSION}</p>
        </div>
      </header>

      <div class="app__body">
        <section class="section">
          <p class="section__label">Selection</p>
          {frames.length === 0 ? (
            <div class="selection selection--empty">Wähle einen Frame aus.</div>
          ) : (
            <div class="selection">
              {usableFrames.length === 1 ? (
                <>
                  <div class="selection__name">{usableFrames[0].name}</div>
                  <div class="selection__meta">
                    {usableFrames[0].width} × {usableFrames[0].height}
                  </div>
                </>
              ) : usableFrames.length > 1 ? (
                <>
                  <div class="selection__name">{usableFrames.length} Frames ausgewählt</div>
                  <div class="selection__meta">Werden nacheinander verarbeitet</div>
                </>
              ) : (
                <div class="selection--empty">Kein verwendbarer Frame ausgewählt.</div>
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
            <div class="segmented">
              {AVAILABLE_PROFILES.map((profile) => (
                <button
                  key={profile}
                  type="button"
                  aria-pressed={settings.profile === profile}
                  disabled={phase === 'working'}
                  onClick={() => patchSettings({ profile })}
                >
                  {PROFILE_LABELS[profile]}
                </button>
              ))}
            </div>
          </section>
        )}

        <section class="section">
          <p class="section__label">Maps</p>
          {SELECTABLE_MAP_KINDS.map((kind) => (
            <label class="checkbox" key={kind}>
              <input
                type="checkbox"
                checked={settings.maps[kind]}
                disabled={phase === 'working'}
                onChange={(event) => toggleMap(kind, event.currentTarget.checked)}
              />
              <span>{MAP_LABELS[kind]}</span>
            </label>
          ))}
          {!anyMapSelected && <div class="notice notice--warning">Wähle mindestens eine Map aus.</div>}
        </section>

        <section class="section">
          <div class="slider">
            <div class="slider__head">
              <span>Overlay-Deckkraft</span>
              <span class="slider__value">{settings.overlayOpacity} %</span>
            </div>
            <input
              type="range"
              min={0}
              max={100}
              step={1}
              value={settings.overlayOpacity}
              disabled={phase === 'working'}
              onInput={(event) =>
                patchSettings({ overlayOpacity: Number(event.currentTarget.value) })
              }
            />
          </div>

          <div class="slider">
            <div class="slider__head">
              <span>Focus-Schwelle</span>
              <span class="slider__value">{settings.focusThreshold}. Perzentil</span>
            </div>
            <input
              type="range"
              min={ENGINE_CONFIG.focus.minPercentile}
              max={ENGINE_CONFIG.focus.maxPercentile}
              step={1}
              value={settings.focusThreshold}
              disabled={phase === 'working'}
              onInput={(event) =>
                patchSettings({ focusThreshold: Number(event.currentTarget.value) })
              }
            />
          </div>

          <div class="slider">
            <div class="slider__head">
              <span>Viewport-Höhe</span>
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

          <div class="slider">
            <div class="slider__head">
              <span>Export-Skalierung</span>
            </div>
            <div class="segmented">
              {([1, 2] as const).map((scale) => (
                <button
                  key={scale}
                  type="button"
                  aria-pressed={settings.exportScale === scale}
                  disabled={phase === 'working'}
                  onClick={() => patchSettings({ exportScale: scale })}
                >
                  {scale}×
                </button>
              ))}
            </div>
          </div>
        </section>

        <section class="section">
          {phase === 'working' ? (
            <>
              <div class="status">
                <span>
                  {progress.total > 1 && progress.current > 0
                    ? `Frame ${progress.current} von ${progress.total}`
                    : 'Wird berechnet'}
                </span>
                <span>{Math.round(progress.fraction * 100)} %</span>
              </div>
              <div class="progress">
                <div class="progress__bar" style={{ width: `${Math.round(progress.fraction * 100)}%` }} />
              </div>
              <div class="status">
                <span class="ranking__name">{progress.label}</span>
              </div>
              <button type="button" class="button button--secondary" onClick={cancel} style={{ marginTop: 8 }}>
                Abbrechen
              </button>
            </>
          ) : (
            <button type="button" class="button" disabled={!canGenerate} onClick={start}>
              Maps erstellen
            </button>
          )}

          {isFinished && (
            <div style={{ marginTop: 10 }}>
              <p class="section__label" style={{ marginBottom: 4 }}>
                Ergebnis
              </p>
              <ul class="summary">
                <li>
                  {createdCount} {createdCount === 1 ? 'Map' : 'Maps'} für{' '}
                  {outcomes.length === 1 ? '1 Frame' : `${outcomes.length} Frames`} erstellt
                </li>
                {segments?.segmented && (
                  <li>
                    In {segments.sectionCount} Abschnitten à {segments.viewportHeight} px analysiert, mit
                    Above-the-fold-Map
                  </li>
                )}
                {errors.length > 0 && <li>{errors.length} Frame(s) mit Fehlern</li>}
              </ul>

              {findings.length > 0 && (
                <>
                  <p class="section__label" style={{ margin: '10px 0 0' }}>
                    Befunde
                  </p>
                  <ul class="findings">
                    {findings.map((finding) => (
                      <li key={finding.id} class={`findings__item findings__item--${finding.severity}`}>
                        <span class="findings__severity">{SEVERITY_LABELS[finding.severity]}</span>
                        <span class="findings__text">{finding.text}</span>
                        {finding.nodeIds && finding.nodeIds.length > 0 && (
                          <button
                            type="button"
                            class="linkbutton"
                            onClick={() => reveal(finding.nodeIds ?? [])}
                          >
                            Im Canvas zeigen
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                </>
              )}

              {ranking.length > 0 && (
                <>
                  <p class="section__label" style={{ margin: '10px 0 0' }}>
                    Klick-Ranking (vorhergesagt)
                  </p>
                  <ol class="ranking">
                    {ranking.map((entry) => (
                      <li key={entry.id}>
                        <span class="ranking__name">{entry.name}</span>
                        <span class="ranking__score">{Math.round(entry.score * 100)} %</span>
                      </li>
                    ))}
                  </ol>
                </>
              )}
            </div>
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
            <button
              type="button"
              class="button button--secondary"
              style={{ marginTop: 8 }}
              disabled={!canGenerate}
              onClick={start}
            >
              Erneut versuchen
            </button>
          )}
        </section>
      </div>

      <footer class="app__footer">
        <span class="disclaimer__icon" aria-hidden="true">
          ⓘ
        </span>
        <div>
          <span>
            Algorithmische Vorhersage, keine Messdaten. Basiert auf Layout und Pixeln, nicht auf beobachtetem
            Nutzerverhalten.
          </span>
          {PRIOR_ATTRIBUTION && (
            <p class="attribution">
              Ortsprior abgeleitet aus dem UEyes-Datensatz (Jiang et al., CHI 2023), CC BY 4.0, gemittelt und
              verkleinert.
            </p>
          )}
        </div>
      </footer>
    </div>
  )
}

const root = document.getElementById('root')
if (root) render(<App />, root)

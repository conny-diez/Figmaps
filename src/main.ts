/**
 * Figma main thread entry point.
 *
 * Responsibilities (PRD §6.3): selection, export, tree traversal, placing the
 * results and client storage. This file — and everything under `src/figma/` —
 * must never touch `document`, `canvas`, `Image` or `fetch`; none of them exist
 * in this realm.
 */
import { exportFrame } from './figma/export'
import { placeMaps } from './figma/place'
import { currentSelection, isAnalysable, type AnalysableNode } from './figma/selection'
import { loadPanelSize, loadSettings, normalisePanelSize, savePanelSize, saveSettings } from './figma/storage'
import { collectSignals } from './figma/traverse'
import { ENGINE_CONFIG } from './engine/config'
import {
  DEFAULT_PANEL_SIZE,
  ERROR_TEXT,
  type ErrorCode,
  type FindingPayload,
  type MainToUi,
  type MapMeta,
  type PanelSize,
  type RenderedMap,
  type SegmentInfo,
  type UiToMain,
} from './messages'

/** Safety net so a crashed iframe cannot wedge the batch forever. */
const PLACE_RESULT_TIMEOUT_MS = 180_000

type FrameResult = {
  maps: RenderedMap[]
  warnings: string[]
  findings: FindingPayload[]
  segments?: SegmentInfo
  /** Parameters of the prediction — written next to the maps, not onto them. */
  mapMeta?: MapMeta
}

type PendingResult = {
  frameId: string
  resolve: (value: FrameResult | null) => void
}

let pending: PendingResult | null = null
let cancelled = false
let running = false

function post(message: MainToUi): void {
  figma.ui.postMessage(message)
}

function postError(code: ErrorCode, error?: unknown, frameName?: string): void {
  const detail = error instanceof Error && error.message ? ` (${error.message})` : ''
  post({ type: 'ERROR', code, message: `${ERROR_TEXT[code]}${detail}`, frameName })
}

figma.showUI(__html__, {
  width: DEFAULT_PANEL_SIZE.width,
  height: DEFAULT_PANEL_SIZE.height,
  themeColors: true,
  title: 'Figmaps',
})

// `showUI` is synchronous, `clientStorage` is not — the panel therefore opens at
// the default size and snaps to the remembered one a tick later.
void (async () => {
  const size = await loadPanelSize()
  if (size.width !== DEFAULT_PANEL_SIZE.width || size.height !== DEFAULT_PANEL_SIZE.height) {
    figma.ui.resize(size.width, size.height)
  }
})()

// A drag emits a resize message per pointer move. Resizing on each is what makes
// the drag feel direct; persisting on each would hammer clientStorage, so only
// the size the drag came to rest at is written.
let sizeWriteTimer: ReturnType<typeof setTimeout> | null = null

function rememberPanelSize(size: PanelSize): void {
  if (sizeWriteTimer !== null) clearTimeout(sizeWriteTimer)
  sizeWriteTimer = setTimeout(() => {
    sizeWriteTimer = null
    void savePanelSize(size).catch(() => {
      // Best effort — a panel that forgets its size is not worth an error dialog.
    })
  }, 400)
}

figma.on('selectionchange', () => {
  post({ type: 'SELECTION', frames: currentSelection() })
})

// ---------------------------------------------------------------------------
// Generation pipeline
// ---------------------------------------------------------------------------

function waitForMaps(frameId: string): Promise<FrameResult | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      if (pending && pending.frameId === frameId) {
        pending = null
        resolve(null)
      }
    }, PLACE_RESULT_TIMEOUT_MS)

    pending = {
      frameId,
      resolve: (value) => {
        clearTimeout(timer)
        resolve(value)
      },
    }
  })
}

async function resolveNode(frameId: string): Promise<AnalysableNode> {
  const node = await figma.getNodeByIdAsync(frameId)
  if (!node || !isAnalysable(node)) throw new Error('Frame nicht gefunden')
  return node
}

/**
 * The analysis settings are not read here — they belong to the iframe realm,
 * which does the rendering. The main thread only exports, places and persists.
 */
async function generate(frameIds: string[]): Promise<void> {
  cancelled = false
  running = true
  const wrappers: SceneNode[] = []
  let created = 0
  let failed = 0

  try {
    for (let index = 0; index < frameIds.length; index++) {
      if (cancelled) break

      let node: AnalysableNode
      try {
        node = await resolveNode(frameIds[index])
      } catch (error) {
        failed++
        postError('INVALID_NODE', error)
        continue
      }

      post({ type: 'BATCH_PROGRESS', current: index + 1, total: frameIds.length, frameName: node.name })

      if (Math.min(node.width, node.height) < ENGINE_CONFIG.traversal.minFrameEdge) {
        failed++
        postError('FRAME_TOO_SMALL', undefined, node.name)
        continue
      }

      try {
        const exported = await exportFrame(node)
        const tree = collectSignals(node)

        post({
          type: 'FRAME_DATA',
          frameId: node.id,
          frameName: node.name,
          png: exported.png,
          signals: tree.signals,
          width: node.width,
          height: node.height,
          exportScale: exported.scale,
          notices: [...exported.notices, ...tree.notices],
        })
      } catch (error) {
        failed++
        postError('EXPORT_FAILED', error, node.name)
        continue
      }

      const result = await waitForMaps(node.id)
      if (cancelled || result === null) {
        if (!cancelled) {
          failed++
          postError('RENDER_FAILED', undefined, node.name)
        }
        continue
      }

      if (result.maps.length === 0) {
        failed++
        post({
          type: 'FRAME_DONE',
          frameId: node.id,
          frameName: node.name,
          maps: [],
          warnings: result.warnings,
          findings: result.findings,
          segments: result.segments,
        })
        continue
      }

      try {
        const wrapper = await placeMaps(node, result.maps, {
          findings: result.findings,
          segments: result.segments,
          mapMeta: result.mapMeta,
        })
        wrappers.push(wrapper)
        created += result.maps.length
        post({
          type: 'FRAME_DONE',
          frameId: node.id,
          frameName: node.name,
          maps: result.maps.map((map) => map.kind),
          warnings: result.warnings,
          findings: result.findings,
          segments: result.segments,
        })
      } catch (error) {
        failed++
        postError('PLACE_FAILED', error, node.name)
      }
    }

    if (wrappers.length > 0) figma.viewport.scrollAndZoomIntoView(wrappers)

    post({ type: 'DONE', created, failed })

    if (cancelled) {
      figma.notify(created > 0 ? `Abgebrochen — ${created} Maps erstellt` : 'Abgebrochen')
    } else if (created > 0) {
      figma.notify(created === 1 ? '1 Map erstellt' : `${created} Maps erstellt`)
    } else if (failed > 0) {
      figma.notify('Keine Maps erstellt', { error: true })
    }
  } finally {
    running = false
    pending = null
  }
}

// ---------------------------------------------------------------------------
// Message handling — every branch is wrapped, the user never sees a trace (NFR-5)
// ---------------------------------------------------------------------------

figma.ui.onmessage = (message: UiToMain): void => {
  void (async () => {
    try {
      switch (message.type) {
        case 'REQUEST_SELECTION': {
          post({ type: 'SETTINGS', settings: await loadSettings() })
          post({ type: 'SELECTION', frames: currentSelection() })
          break
        }

        case 'GENERATE': {
          if (running) break
          const frames = message.config.frameIds
          if (frames.length === 0) {
            postError('NO_SELECTION')
            post({ type: 'DONE', created: 0, failed: 0 })
            break
          }
          try {
            await saveSettings(message.config.settings)
          } catch {
            // Persisting settings is best effort — never block a run for it.
          }
          await generate(frames)
          break
        }

        case 'CANCEL': {
          cancelled = true
          if (pending) {
            const resolve = pending.resolve
            pending = null
            resolve(null)
          }
          break
        }

        case 'PLACE_RESULT': {
          if (pending && pending.frameId === message.frameId) {
            const resolve = pending.resolve
            pending = null
            resolve({
              maps: message.maps,
              warnings: message.warnings,
              findings: message.findings,
              segments: message.segments,
              mapMeta: message.mapMeta,
            })
          }
          break
        }

        // C-3 — "Im Canvas zeigen": select the nodes a finding refers to and
        // scroll them into view. Nodes may be gone since the run; that is not
        // an error the user needs a dialog for.
        case 'REVEAL_NODES': {
          const nodes: SceneNode[] = []
          for (const id of message.nodeIds) {
            const node = await figma.getNodeByIdAsync(id)
            if (node && node.type !== 'DOCUMENT' && node.type !== 'PAGE') nodes.push(node)
          }
          if (nodes.length === 0) {
            figma.notify('Die Ebene ist nicht mehr vorhanden.')
            break
          }
          figma.currentPage.selection = nodes
          figma.viewport.scrollAndZoomIntoView(nodes)
          break
        }

        case 'RESIZE': {
          const size = normalisePanelSize(message.size)
          figma.ui.resize(size.width, size.height)
          rememberPanelSize(size)
          break
        }

        case 'SAVE_SETTINGS': {
          try {
            await saveSettings(message.settings)
          } catch (error) {
            postError('STORAGE_FAILED', error)
          }
          break
        }

        default: {
          // Exhaustiveness guard — an unknown message must not crash the plugin.
          const unhandled: never = message
          void unhandled
        }
      }
    } catch (error) {
      postError('UNKNOWN', error)
    }
  })()
}

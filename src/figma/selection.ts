/**
 * FR-1 — selection handling. Main thread only.
 */
import { ENGINE_CONFIG } from '../engine/config'
import type { FrameSummary } from '../messages'

/** Node types that can be analysed (FR-1). */
const VALID_TYPES: ReadonlySet<string> = new Set(['FRAME', 'COMPONENT', 'COMPONENT_SET', 'INSTANCE', 'SECTION', 'GROUP'])

export type AnalysableNode = SceneNode & { width: number; height: number }

export function isAnalysable(node: BaseNode): node is AnalysableNode {
  if (!VALID_TYPES.has(node.type)) return false
  const candidate = node as Partial<AnalysableNode>
  return typeof candidate.width === 'number' && typeof candidate.height === 'number'
}

export function summarise(node: AnalysableNode): FrameSummary {
  const shorterEdge = Math.min(node.width, node.height)
  return {
    id: node.id,
    name: node.name,
    width: Math.round(node.width),
    height: Math.round(node.height),
    tooSmall: shorterEdge < ENGINE_CONFIG.traversal.minFrameEdge,
  }
}

/** Current selection, reduced to the nodes the plugin can work with. */
export function currentSelection(): FrameSummary[] {
  return figma.currentPage.selection.filter(isAnalysable).map(summarise)
}

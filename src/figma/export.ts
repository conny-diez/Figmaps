/**
 * FR-2 — frame export. Main thread only.
 *
 * Figma's image pipeline caps out at 4096 px per edge (`figma.createImage`
 * throws "Image is too large" beyond that), so the export constraint is chosen
 * such that the resulting PNG always fits — falling back from 2x to 1x first,
 * and clamping the longer edge outright for very tall frames (NFR-4).
 */
import { ENGINE_CONFIG } from '../engine/config'
import type { AnalysableNode } from './selection'

export type ExportResult = {
  png: Uint8Array
  /** Effective pixel-per-frame-pixel factor of the exported image. */
  scale: number
  notices: string[]
}

export async function exportFrame(node: AnalysableNode, requestedScale: 1 | 2): Promise<ExportResult> {
  const maxEdge = ENGINE_CONFIG.render.maxImageEdge
  const longerEdge = Math.max(node.width, node.height)
  const notices: string[] = []

  let constraint: ExportSettingsConstraints
  let scale: number

  if (longerEdge * requestedScale <= maxEdge) {
    constraint = { type: 'SCALE', value: requestedScale }
    scale = requestedScale
  } else if (longerEdge <= maxEdge) {
    constraint = { type: 'SCALE', value: 1 }
    scale = 1
    notices.push(`Export auf 1× reduziert — bei ${requestedScale}× läge der Frame über der Bildgrenze von ${maxEdge} px.`)
  } else {
    const onWidth = node.width >= node.height
    constraint = onWidth ? { type: 'WIDTH', value: maxEdge } : { type: 'HEIGHT', value: maxEdge }
    scale = maxEdge / longerEdge
    notices.push(
      `Frame ist größer als die Bildgrenze von ${maxEdge} px — die Maps werden auf ${maxEdge} px längste Kante herunterskaliert.`,
    )
  }

  const png = await node.exportAsync({ format: 'PNG', constraint })
  return { png, scale, notices }
}

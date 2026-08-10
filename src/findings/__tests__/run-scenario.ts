/**
 * Der eine Weg, einen Erreichbarkeitsfall auszuwerten.
 *
 * Ruft die **echte** Analyse und den **echten** `deriveFindings`-Pfad — also
 * das, was auch die iframe-Pipeline ruft. Genau eine Implementierung davon,
 * aus demselben Grund, aus dem `derive.ts` existiert: `cold-fold` war
 * wirkungslos, während jeder Unit-Test grün war, weil der Test die Regel direkt
 * mit handgebautem Input aufrief und die Pipeline ihr etwas strukturell
 * anderes fütterte.
 */
import { analyzeFrame } from '../../engine/analyze'
import { HeuristicAttentionEngine } from '../../engine/heuristic'
import type { EngineParams } from '../../engine/params'
import { ImageOpsNode } from '../../platform/imageops-node'
import { deriveFindings } from '../derive'
import { ALL_RULES } from '../rules'
import type { ScenarioFrame } from './scenarios'

const ops = new ImageOpsNode()

/**
 * Führt einen Fall aus und liefert die Ids der entstandenen Befunde.
 *
 * `params` verstellt die Engine — das braucht `robustness.test.ts`, um zu
 * prüfen, ob ein Fall nur bei genau den heutigen Konstanten das Erwartete tut.
 */
export async function runScenario(frame: ScenarioFrame, params?: EngineParams): Promise<string[]> {
  const engine = params
    ? new HeuristicAttentionEngine({ configId: 'hybrid-v1', params })
    : new HeuristicAttentionEngine()

  const analysis = await analyzeFrame(engine, ops, {
    source: frame.source,
    signals: frame.signals,
    frameWidth: frame.frameWidth,
    frameHeight: frame.frameHeight,
    ...(frame.viewportOverride ? { viewportOverride: frame.viewportOverride } : {}),
  })
  if (!analysis) throw new Error('Analyse des Erreichbarkeitsfalls abgebrochen')

  const findings = deriveFindings(
    {
      analysis,
      signals: frame.signals,
      frameWidth: frame.frameWidth,
      frameHeight: frame.frameHeight,
    },
    frame.includeUnshipped ? ALL_RULES : undefined,
  )
  return findings.map((finding) => finding.id)
}

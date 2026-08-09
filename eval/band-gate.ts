/**
 * Misst, ob eine **Inhaltsschwelle** im Renderer die Ausgabe auf echten
 * Screens verändert.
 *
 * DER VORSCHLAG. Die Abschnittsbänder auf inhaltsfreien Frames sind der
 * Ortsprior ohne Inhalt (README, „Die Streifen aus 1.1"). Der Bildanalyse-Anteil
 * weiß, wo Inhalt ist — er ist dort, wo nichts ist, exakt null. Der Renderer
 * könnte ihn als **Schwelle** benutzen: unterhalb eines sehr kleinen Werts wird
 * nicht gezeichnet, oberhalb **unverändert** volle Deckkraft, dazwischen ein
 * weicher Auslauf.
 *
 * Als Schwelle und nicht als Faktor — das ist der Unterschied, an dem die
 * Entscheidung hängt. Ein Faktor würde jede Stelle verändern, auch die mit
 * Inhalt, und damit stillschweigend die Aussage der Karte umschreiben: ein
 * Element, das allein durch seine *Position* Aufmerksamkeit bekommt, würde
 * blasser. Eine Schwelle mit vollem Durchlass darüber tut das nicht — sofern
 * auf echten Screens nichts unter der Schwelle liegt.
 *
 * **Genau das prüft dieses Modul, und es ist eine Falsifikation**: findet es
 * auf den 40 Gate-Bildern eine sichtbare Änderung, ist der Vorschlag erledigt
 * und es bleibt bei „nichts tun". Deshalb wird gemessen, bevor gebaut wird, und
 * deshalb misst es die **gerenderte Deckkraft** und nicht die Karte — was zählt,
 * ist, was jemand sieht.
 */
import { analyzeFrame } from '../src/engine/analyze'
import { ENGINE_CONFIG } from '../src/engine/config'
import { HeuristicAttentionEngine } from '../src/engine/heuristic'
import { composeSections } from '../src/engine/segments'
import type { PriorAssetId } from '../src/engine/priors'
import type { ScalarMap } from '../src/engine/types'
import { nodeImageOps } from '../src/platform/imageops-node'
import { iterateSamples } from './dataset'

/** Der Alpha-Verlauf des Renderers, als reine Funktion. */
function rampAlpha(value: number, cutoff: number, ramp: number): number {
  if (value < cutoff) return 0
  return ramp > 0 ? Math.min(1, (value - cutoff) / ramp) : 1
}

export type ThresholdCandidate = { cutoff: number; ramp: number }

export type BandGateResult = {
  setName: string
  imageCount: number
  candidates: Array<{
    candidate: ThresholdCandidate
    /** Anteil der Pixel, deren gerenderte Deckkraft sich ändert. */
    changedShare: number
    /** Größte Änderung der Deckkraft über alle Pixel und Bilder. */
    maxDelta: number
    /** Mittlere Änderung, nur über die veränderten Pixel. */
    meanDeltaWhereChanged: number
    /** Anteil der bisher **sichtbaren** Pixel, die ganz verschwinden. */
    lostVisibleShare: number
    /** Auf wie vielen der Bilder sich überhaupt etwas ändert. */
    imagesAffected: number
  }>
  /** Verteilung des Bildanteils — zeigt, wo eine Schwelle überhaupt greifen kann. */
  imageTermQuantiles: number[]
}

export type BandGateOptions = {
  setName: string
  priorAsset: PriorAssetId
  duration?: number
  candidates: readonly ThresholdCandidate[]
  onProgress?: (done: number) => void
}

export async function measureBandGate(options: BandGateOptions): Promise<BandGateResult> {
  const duration = options.duration ?? 3
  const cutoff = ENGINE_CONFIG.render.transparencyCutoff
  const ramp = ENGINE_CONFIG.render.transparencyRamp

  const engine = new HeuristicAttentionEngine({ priorAsset: options.priorAsset })
  const stats = options.candidates.map(() => ({
    changed: 0,
    maxDelta: 0,
    deltaSum: 0,
    lostVisible: 0,
    imagesAffected: 0,
  }))
  let pixels = 0
  let visiblePixels = 0
  let imageCount = 0
  const imageTermSamples: number[] = []

  for (const sample of iterateSamples(options.setName, 'quick', { duration })) {
    const analysis = await analyzeFrame(engine, nodeImageOps, {
      source: sample.image,
      signals: sample.signals,
      frameWidth: sample.image.width,
      frameHeight: sample.image.height,
    })
    if (!analysis || analysis.imageTerms.length === 0) continue

    const map: ScalarMap = analysis.attention
    // Der Bildanteil über den ganzen Frame, mit derselben Überblendung wie
    // `attention` — aber **ohne** Dämpfung: die Frage „ist hier Inhalt?" hat
    // mit der Scrolltiefe nichts zu tun. `composeSections` liest die Dämpfung
    // aus der Konfiguration, also genügt es, beide Faktoren auf 1 zu setzen.
    //
    // Bewusst hier und nicht in `AnalyzeResult`: der Renderer benutzt die
    // Größe nach dieser Messung nicht, und die Engine soll sie nicht bei jedem
    // Lauf im Plugin mitberechnen.
    const content = composeSections(
      analysis.imageTerms.map((imageTerm, index) => ({ section: analysis.plan.sections[index], map: imageTerm })),
      sample.image.height,
      { ...ENGINE_CONFIG.viewport, sectionAttenuation: 1, sectionAttenuationFloor: 1 },
    )
    if (content.width !== map.width || content.height !== map.height) {
      throw new Error(`Bildanteil und Karte haben verschiedene Größen: ${content.width}x${content.height} vs ${map.width}x${map.height}`)
    }

    const touched = new Array(options.candidates.length).fill(false)
    for (let i = 0; i < map.values.length; i++) {
      const base = rampAlpha(map.values[i], cutoff, ramp)
      pixels++
      if (base > 0) visiblePixels++
      // Stichprobe der Verteilung, jedes 37. Pixel — genug für Quantile, ohne
      // 40 Bilder vollständig im Speicher zu halten.
      if (i % 37 === 0) imageTermSamples.push(content.values[i])

      for (let c = 0; c < options.candidates.length; c++) {
        const { cutoff: cc, ramp: cr } = options.candidates[c]
        const gated = base * rampAlpha(content.values[i], cc, cr)
        const delta = Math.abs(gated - base)
        if (delta <= 1e-9) continue
        stats[c].changed++
        stats[c].deltaSum += delta
        if (delta > stats[c].maxDelta) stats[c].maxDelta = delta
        if (base > 0 && gated === 0) stats[c].lostVisible++
        touched[c] = true
      }
    }
    for (let c = 0; c < touched.length; c++) if (touched[c]) stats[c].imagesAffected++

    imageCount++
    options.onProgress?.(imageCount)
  }

  const sorted = imageTermSamples.sort((a, b) => a - b)
  const quantile = (q: number): number => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]

  return {
    setName: options.setName,
    imageCount,
    candidates: options.candidates.map((candidate, c) => ({
      candidate,
      changedShare: pixels > 0 ? stats[c].changed / pixels : 0,
      maxDelta: stats[c].maxDelta,
      meanDeltaWhereChanged: stats[c].changed > 0 ? stats[c].deltaSum / stats[c].changed : 0,
      lostVisibleShare: visiblePixels > 0 ? stats[c].lostVisible / visiblePixels : 0,
      imagesAffected: stats[c].imagesAffected,
    })),
    imageTermQuantiles: [0.01, 0.05, 0.1, 0.25, 0.5].map(quantile),
  }
}

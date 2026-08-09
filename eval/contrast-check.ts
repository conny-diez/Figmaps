/**
 * Die Contrastmap auf zwei Frames, als Bild und als Befundliste.
 *
 * WOZU. Die Karte trifft eine Aussage, die sich **nachrechnen** lässt — anders
 * als jede andere Ausgabe dieses Plugins. Genau deshalb muss man sie einmal
 * ansehen: ein falscher Kontrastwert wäre schlimmer als eine falsche Heatmap,
 * weil er als Tatsache auftritt.
 *
 * Der Renderer selbst (`render/contrastmap.ts`) braucht ein Canvas und läuft
 * nur im iframe. Hier wird deshalb dieselbe Darstellung mit reiner
 * Bitmap-Arithmetik nachgezogen — Rahmen und Wertfahnen, gleiche Farben,
 * gleiche Regel „nichts über dem Text". Was hier zu sehen ist, ist die
 * Anordnung und die Messung; die exakte Typografie der Fahnen kommt im Plugin
 * vom Canvas.
 */
import { ENGINE_CONFIG } from '../src/engine/config'
import type { Bitmap } from '../src/engine/ops'
import { fitWithin, resizeBitmap } from '../src/engine/ops-pure'
import type { NodeSignal } from '../src/messages'
import { nodeImageOps } from '../src/platform/imageops-node'
import { measureContrast, type ContrastResult } from '../src/contrast/measure'
import { contrastFindingText } from '../src/contrast/measure'
import { measureNonTextContrast, reportableNonText, type NonTextResult } from '../src/contrast/non-text'
import { buildOnboardingFrame } from './onboarding'
import { buildFrame, SHAPES } from './constructed'

type Rgb = [number, number, number]

const STATUS_RGB: Record<ContrastResult['status'], Rgb> = {
  bestanden: [32, 148, 96],
  grenzwertig: [214, 150, 20],
  durchgefallen: [206, 46, 46],
}

const STATUS_WIDTH: Record<ContrastResult['status'], number> = {
  bestanden: 2,
  grenzwertig: 3,
  durchgefallen: 4,
}

function blend(image: Bitmap, x: number, y: number, colour: Rgb, alpha: number): void {
  if (x < 0 || y < 0 || x >= image.width || y >= image.height) return
  const p = (y * image.width + x) * 4
  for (let c = 0; c < 3; c++) image.data[p + c] = Math.round(image.data[p + c] * (1 - alpha) + colour[c] * alpha)
}

function strokeRect(image: Bitmap, rect: { x: number; y: number; width: number; height: number }, colour: Rgb, width: number): void {
  const x0 = Math.round(rect.x)
  const y0 = Math.round(rect.y)
  const x1 = Math.round(rect.x + rect.width)
  const y1 = Math.round(rect.y + rect.height)
  for (let w = 0; w < width; w++) {
    for (let x = x0 - w; x <= x1 + w; x++) {
      blend(image, x, y0 - w, colour, 1)
      blend(image, x, y1 + w, colour, 1)
    }
    for (let y = y0 - w; y <= y1 + w; y++) {
      blend(image, x0 - w, y, colour, 1)
      blend(image, x1 + w, y, colour, 1)
    }
  }
}

/** Eine Wertfahne als Balken — die Ziffern kann diese Umgebung nicht setzen. */
function valueTag(image: Bitmap, rect: { x: number; y: number; width: number; height: number }, colour: Rgb, size: number): void {
  const tagWidth = Math.round(size * 3.2)
  const tagHeight = Math.round(size * 1.6)
  let x = Math.round(rect.x + rect.width + size * 0.4)
  let y = Math.round(rect.y + rect.height / 2 - tagHeight / 2)
  if (x + tagWidth > image.width) {
    x = Math.max(0, Math.round(rect.x))
    y = Math.max(0, Math.round(rect.y - tagHeight - size * 0.3))
  }
  for (let py = y; py < y + tagHeight; py++) for (let px = x; px < x + tagWidth; px++) blend(image, px, py, colour, 1)
}

export type ContrastCheckCase = {
  id: string
  label: string
  image: Bitmap
  signals: NodeSignal[]
  frameWidth: number
  frameHeight: number
}

/**
 * Die beiden Prüffälle.
 *
 * Der Onboarding-Screen, weil er der Fall aus A4 ist und weil auf ihm eine
 * bekannte Antwort steht: die dunkle Kachel trägt weißen Text auf fast Schwarz
 * (muss bestehen), der gelbe CTA dunklen Text auf kräftigem Gelb (grenzwertig
 * bis bestanden), die Unterzeile ist absichtlich hellgrau (muss durchfallen).
 *
 * Dazu ein konstruierter Desktop-Frame — dieselbe Messung auf einer anderen
 * Frame-Form, mit Fließtext in Grau auf Weiß.
 */
export function contrastCheckCases(): ContrastCheckCase[] {
  const onboarding = buildOnboardingFrame()
  const desktop = SHAPES.find((shape) => shape.id === 'desktop-lang')!
  const constructed = buildFrame(desktop, 3)
  return [
    {
      id: 'onboarding',
      label: 'Onboarding-Screen 393 x 852',
      image: onboarding.image,
      signals: onboarding.signals,
      frameWidth: onboarding.frameWidth,
      frameHeight: onboarding.frameHeight,
    },
    {
      id: 'desktop',
      label: desktop.label,
      image: constructed.image,
      signals: constructed.signals,
      frameWidth: desktop.frameWidth,
      frameHeight: desktop.frameHeight,
    },
  ]
}

export type ContrastCheckResult = {
  id: string
  label: string
  results: ContrastResult[]
  skipped: Array<{ nodeId: string; reason: string }>
  findings: string[]
  /** WCAG 1.4.11 — alle geprüften Elemente, auch die nicht ausgelieferten. */
  nonText: NonTextResult[]
  /** Davon das, was tatsächlich gemeldet würde. */
  nonTextReported: NonTextResult[]
  png: Uint8Array
}

export function runContrastCheck(options: { tileWidth?: number } = {}): ContrastCheckResult[] {
  const out: ContrastCheckResult[] = []

  for (const item of contrastCheckCases()) {
    // Dieselbe Auflösungsregel wie im Plugin — die Messung darf nicht auf einem
    // verkleinerten Bild laufen (siehe `ENGINE_CONFIG.contrastSource`).
    const size = fitWithin(item.image.width, item.image.height, ENGINE_CONFIG.contrastSource.maxEdge)
    const pixels = size.width === item.image.width ? item.image : resizeBitmap(item.image, size.width, size.height)
    const { results, skipped } = measureContrast({
      image: pixels,
      signals: item.signals,
      frameWidth: item.frameWidth,
      frameHeight: item.frameHeight,
    })

    const tileWidth = options.tileWidth ?? 420
    const tileHeight = Math.max(1, Math.round((tileWidth * item.frameHeight) / item.frameWidth))
    const canvas = resizeBitmap(item.image, tileWidth, tileHeight)
    // Abdunklung außerhalb der markierten Elemente — dieselbe Idee wie im
    // Renderer, damit die Markierungen hervortreten, ohne Text zu verdecken.
    const inside = new Uint8Array(tileWidth * tileHeight)
    const scaleX = tileWidth / item.frameWidth
    const scaleY = tileHeight / item.frameHeight
    for (const result of results) {
      const x0 = Math.max(0, Math.floor(result.rect.x * scaleX))
      const y0 = Math.max(0, Math.floor(result.rect.y * scaleY))
      const x1 = Math.min(tileWidth, Math.ceil((result.rect.x + result.rect.width) * scaleX))
      const y1 = Math.min(tileHeight, Math.ceil((result.rect.y + result.rect.height) * scaleY))
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) inside[y * tileWidth + x] = 1
    }
    for (let y = 0; y < tileHeight; y++) {
      for (let x = 0; x < tileWidth; x++) {
        if (inside[y * tileWidth + x]) continue
        blend(canvas, x, y, [255, 255, 255], 0.45)
      }
    }

    const labelSize = Math.max(9, tileWidth * 0.026)
    for (const result of results) {
      const rect = {
        x: result.rect.x * scaleX,
        y: result.rect.y * scaleY,
        width: Math.max(1, result.rect.width * scaleX),
        height: Math.max(1, result.rect.height * scaleY),
      }
      strokeRect(canvas, rect, STATUS_RGB[result.status], STATUS_WIDTH[result.status])
      valueTag(canvas, rect, STATUS_RGB[result.status], labelSize)
    }

    const nonText = measureNonTextContrast({
      image: pixels,
      signals: item.signals,
      frameWidth: item.frameWidth,
      frameHeight: item.frameHeight,
    })

    out.push({
      id: item.id,
      label: item.label,
      results,
      skipped,
      nonText: nonText.results,
      nonTextReported: reportableNonText(nonText.results),
      findings: results.map((result) => contrastFindingText(result)),
      png: nodeImageOps.encode(canvas),
    })
  }

  return out
}

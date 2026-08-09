/**
 * 1.2 C3 — Darstellung der Contrastmap.
 *
 * Anders als Heatmap und Focusmap legt diese Karte **kein Overlay über den
 * Inhalt**. Sie markiert Textelemente am Rand und schreibt den gemessenen Wert
 * daneben — dieselbe Regel, aus der die Legende und der Disclaimer 1.1 aus den
 * Bildern verschwunden sind: was den Screen verdeckt, kann man nicht mehr
 * beurteilen. Bei einer Karte, die von Lesbarkeit handelt, wäre das besonders
 * absurd.
 *
 * Konkret heißt das:
 *
 *   - ein Rahmen **um** den Text, nicht darauf; die Linie liegt außerhalb der
 *     Textfläche
 *   - der Kontrastwert daneben, in einer Fahne mit eigenem Hintergrund, damit
 *     er selbst lesbar ist (eine Beschriftung über Kontrast, die man nicht
 *     lesen kann, wäre ein schlechter Witz)
 *   - eine leichte Abdunklung des **restlichen** Bildes, damit die Markierungen
 *     hervortreten — sie liegt nirgends über einem markierten Text
 *
 * Die drei Farben sind Status, nicht Skala: bestanden, grenzwertig,
 * durchgefallen. Ein Verlauf würde eine Genauigkeit vortäuschen, die die
 * Abtastung nicht hat.
 */
import type { ContrastResult } from '../contrast/measure'
import { formatRatio } from '../contrast/wcag'
import { context2d, createCanvas } from './canvas'

/**
 * Statusfarben.
 *
 * Nicht Rot/Grün allein: rund 8 % der Männer unterscheiden die beiden
 * schlecht, und eine Barrierefreiheits-Ansicht, die selbst eine Barriere hat,
 * wäre schwer zu verteidigen. Getragen wird die Aussage deshalb von der
 * **Beschriftung** — die Zahl steht an jedem Element —, die Farbe ist die
 * Zugabe. Zusätzlich unterscheiden sich die Rahmen in der Strichstärke.
 */
const STATUS_COLOURS = {
  bestanden: { stroke: 'rgba(32, 148, 96, 0.95)', fill: 'rgba(32, 148, 96, 0.95)', width: 1.5 },
  grenzwertig: { stroke: 'rgba(214, 150, 20, 0.95)', fill: 'rgba(214, 150, 20, 0.95)', width: 2 },
  durchgefallen: { stroke: 'rgba(206, 46, 46, 0.98)', fill: 'rgba(206, 46, 46, 0.98)', width: 3 },
} as const

export type ContrastmapOptions = {
  /** Wie stark der nicht markierte Teil des Bildes abgedunkelt wird, 0–1. */
  dim?: number
  /** Schriftgröße der Wertfahnen, als Anteil der längeren Ausgabekante. */
  labelSizeRatio?: number
  minLabelSize?: number
}

const FONT_STACK = 'Inter, "Helvetica Neue", Helvetica, Arial, sans-serif'

/**
 * Zeichnet den Screen und markiert jedes gemessene Textelement.
 *
 * `results` kommt aus `contrast/measure.ts`; die Rechtecke stehen dort in
 * Frame-Pixeln und werden hier auf die Ausgabegröße skaliert.
 */
export function renderContrastmap(
  base: CanvasImageSource,
  results: readonly ContrastResult[],
  width: number,
  height: number,
  frameWidth: number,
  frameHeight: number,
  options: ContrastmapOptions = {},
): HTMLCanvasElement {
  const canvas = createCanvas(width, height)
  const ctx = context2d(canvas)
  ctx.drawImage(base, 0, 0, canvas.width, canvas.height)

  const scaleX = canvas.width / frameWidth
  const scaleY = canvas.height / frameHeight
  const dim = options.dim ?? 0.45

  // Abdunklung, dann die markierten Bereiche wieder freistellen. So liegt
  // nirgends etwas über einem Text, um den es geht.
  if (dim > 0) {
    ctx.save()
    ctx.fillStyle = `rgba(255, 255, 255, ${dim})`
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.restore()
    for (const result of results) {
      const rect = scaled(result, scaleX, scaleY)
      ctx.save()
      ctx.beginPath()
      ctx.rect(rect.x, rect.y, rect.width, rect.height)
      ctx.clip()
      ctx.drawImage(base, 0, 0, canvas.width, canvas.height)
      ctx.restore()
    }
  }

  const labelSize = Math.max(options.minLabelSize ?? 11, Math.max(canvas.width, canvas.height) * (options.labelSizeRatio ?? 0.012))

  for (const result of results) {
    const rect = scaled(result, scaleX, scaleY)
    const colours = STATUS_COLOURS[result.status]

    ctx.save()
    ctx.strokeStyle = colours.stroke
    ctx.lineWidth = colours.width
    // Der Rahmen sitzt **außerhalb** der Textfläche, eine halbe Strichstärke
    // versetzt — sonst überdeckt er die obersten Pixel der Glyphen.
    const inset = colours.width / 2
    ctx.strokeRect(rect.x - inset, rect.y - inset, rect.width + colours.width, rect.height + colours.width)
    ctx.restore()

    drawValueTag(ctx, rect, `${formatRatio(result.ratio)}${result.approximate ? ' ~' : ''}`, colours.fill, labelSize, canvas.width)
  }

  return canvas
}

function scaled(result: ContrastResult, scaleX: number, scaleY: number) {
  return {
    x: result.rect.x * scaleX,
    y: result.rect.y * scaleY,
    width: Math.max(1, result.rect.width * scaleX),
    height: Math.max(1, result.rect.height * scaleY),
  }
}

/**
 * Die Wertfahne — rechts neben dem Element, sonst darüber.
 *
 * Sie bekommt einen eigenen Hintergrund, weil sie sonst genau das Problem hätte,
 * das sie meldet: eine Zahl über einem beliebigen Screen ist irgendwann selbst
 * unlesbar.
 */
function drawValueTag(
  ctx: CanvasRenderingContext2D,
  rect: { x: number; y: number; width: number; height: number },
  text: string,
  colour: string,
  size: number,
  canvasWidth: number,
): void {
  ctx.save()
  ctx.font = `600 ${size}px ${FONT_STACK}`
  ctx.textBaseline = 'middle'
  const padding = size * 0.4
  const tagWidth = ctx.measureText(text).width + padding * 2
  const tagHeight = size * 1.6

  let x = rect.x + rect.width + padding
  let y = rect.y + rect.height / 2 - tagHeight / 2
  if (x + tagWidth > canvasWidth) {
    // Kein Platz rechts: über das Element, linksbündig.
    x = Math.max(0, rect.x)
    y = Math.max(0, rect.y - tagHeight - padding * 0.5)
  }

  ctx.fillStyle = colour
  ctx.fillRect(x, y, tagWidth, tagHeight)
  ctx.fillStyle = '#ffffff'
  ctx.fillText(text, x + padding, y + tagHeight / 2)
  ctx.restore()
}

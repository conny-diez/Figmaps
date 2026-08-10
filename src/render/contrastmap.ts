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

  // Alle markierten Elemente sind Sperrflächen für die Fahnen — auch die
  // *anderen*. Beim dritten Anlauf mit diesen Fahnen lag eine über dem Wort
  // „Hier" eines Nachbarelements: rechts neben Element A war frei, aber genau
  // dort begann Element B.
  const blocked: Rect[] = results.map((result) => scaled(result, scaleX, scaleY))
  const placed: Rect[] = []

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

    const text = `${formatRatio(result.ratio)}${result.approximate ? ' ~' : ''}`
    const tag = placeTag(ctx, rect, text, labelSize, canvas, blocked, placed)
    placed.push(tag)
    drawValueTag(ctx, tag, text, colours.fill, labelSize)
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

type Rect = { x: number; y: number; width: number; height: number }

function overlaps(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y
}

/**
 * Wo die Wertfahne hinkommt.
 *
 * Regel eins, und sie ist der Grund für diese Funktion: **niemals über einem
 * markierten Element** — weder über dem eigenen noch über einem anderen. Eine
 * Karte, die von Lesbarkeit handelt, darf keinen Text verdecken; das galt schon
 * für die Legende und den Disclaimer, und es gilt hier zweimal.
 *
 * Der Reihe nach werden Kandidatenplätze probiert: rechts, links, darüber,
 * darunter, jeweils außerhalb des Elements. Der erste, der in die Ausgabe passt
 * und weder ein markiertes Element noch eine bereits gesetzte Fahne trifft,
 * gewinnt. Findet keiner Platz, wird der am wenigsten schlechte genommen —
 * gemessen an der überlappten Fläche, damit die Fahne im Zweifel den kleinsten
 * Schaden anrichtet.
 */
function placeTag(
  ctx: CanvasRenderingContext2D,
  rect: Rect,
  text: string,
  size: number,
  canvas: { width: number; height: number },
  blocked: readonly Rect[],
  placed: readonly Rect[],
): Rect {
  ctx.save()
  ctx.font = `600 ${size}px ${FONT_STACK}`
  const padding = size * 0.4
  const width = ctx.measureText(text).width + padding * 2
  const height = size * 1.6
  ctx.restore()

  const gap = size * 0.35
  const candidates: Rect[] = [
    { x: rect.x + rect.width + gap, y: rect.y + rect.height / 2 - height / 2, width, height },
    { x: rect.x - width - gap, y: rect.y + rect.height / 2 - height / 2, width, height },
    { x: rect.x, y: rect.y - height - gap, width, height },
    { x: rect.x, y: rect.y + rect.height + gap, width, height },
    { x: rect.x + rect.width - width, y: rect.y - height - gap, width, height },
    { x: rect.x + rect.width - width, y: rect.y + rect.height + gap, width, height },
  ]

  const inside = (candidate: Rect): boolean =>
    candidate.x >= 0 && candidate.y >= 0 && candidate.x + candidate.width <= canvas.width && candidate.y + candidate.height <= canvas.height

  const cost = (candidate: Rect): number => {
    let area = 0
    for (const other of [...blocked, ...placed]) {
      if (other === rect) continue
      if (!overlaps(candidate, other)) continue
      const w = Math.min(candidate.x + candidate.width, other.x + other.width) - Math.max(candidate.x, other.x)
      const h = Math.min(candidate.y + candidate.height, other.y + other.height) - Math.max(candidate.y, other.y)
      area += Math.max(0, w) * Math.max(0, h)
    }
    return area
  }

  for (const candidate of candidates) {
    if (inside(candidate) && cost(candidate) === 0) return candidate
  }

  // Nichts ist frei — dann der Platz mit der kleinsten Überlappung, und unter
  // gleich schlechten der, der noch ins Bild passt.
  return [...candidates].sort((a, b) => cost(a) - cost(b) || Number(inside(b)) - Number(inside(a)))[0]
}

/** Zeichnet die Fahne an der berechneten Stelle. */
function drawValueTag(
  ctx: CanvasRenderingContext2D,
  tag: Rect,
  text: string,
  colour: string,
  size: number,
): void {
  ctx.save()
  ctx.font = `600 ${size}px ${FONT_STACK}`
  ctx.textBaseline = 'middle'
  ctx.fillStyle = colour
  ctx.fillRect(tag.x, tag.y, tag.width, tag.height)
  ctx.fillStyle = '#ffffff'
  ctx.fillText(text, tag.x + size * 0.4, tag.y + tag.height / 2)
  ctx.restore()
}

/** Nur für den Test: wohin käme die Fahne? */
export const __testing = { placeTag, overlaps }

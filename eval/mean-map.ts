/**
 * A-4, dritte Baseline — die gemittelte Ground-Truth-Heatmap ("mean map").
 *
 * Der Mittelwert aller Ground-Truth-Maps des **Tuning**-Splits, angewandt auf
 * jedes Testbild, ohne das Bild anzusehen. Das ist die übliche Vergleichsbasis
 * der Saliency-Literatur und deutlich stärker als eine radialsymmetrische
 * Gaußglocke: sie kennt die tatsächliche räumliche Verteilung des Datensatzes,
 * also den F-Pattern-Bias, die Kopfzeile, den linken Rand.
 *
 * Sie ist damit der eigentliche Test für S-2. Alles, was die mean map schon
 * erklärt, ist Wissen darüber, *wo auf dieser Art von Screen üblicherweise
 * Dinge stehen* — nicht darüber, was in diesem konkreten Screen passiert.
 *
 * Zwei Dinge sind hier entscheidend:
 *
 *  1. Berechnet **nur auf dem Tuning-Split**. Würde der Test-Split einfließen,
 *     enthielte die Baseline die Antwort, gegen die sie antritt.
 *  2. Gemittelt wird in **normierten Koordinaten**: die Bilder des Datensatzes
 *     haben unterschiedliche Seitenverhältnisse, und ein Mittelwert über
 *     absolute Pixel wäre bedeutungslos. Jede Map wird dafür auf ein
 *     quadratisches Referenzraster gestreckt und beim Anwenden zurück auf das
 *     Seitenverhältnis des Zielbilds.
 */
import { existsSync } from 'node:fs'
import type { ScalarMap } from '../src/engine/types'
import { heatmapPath, listSplit, readPng, resizeScalarMap, toScalarMap, type SplitName } from './dataset'

/** Resolution the average is accumulated on, in normalised coordinates. */
export const MEAN_MAP_GRID = 128

export type MeanMap = {
  map: ScalarMap
  /** How many ground-truth maps went into the average. */
  count: number
  split: SplitName
  duration: number
}

/**
 * Streams the ground-truth maps of a split and accumulates their average.
 *
 * Reads one PNG at a time and drops it again — a split of 468 mobile
 * screenshots would otherwise hold several gigabytes of pixels at once.
 */
export function computeMeanMap(
  setName: string,
  split: SplitName,
  duration: number,
  options: { root?: string; onProgress?: (done: number, total: number) => void } = {},
): MeanMap {
  const ids = listSplit(setName, split, options.root)
  if (ids.length === 0) throw new Error(`Mean map: Split "${split}" von "${setName}" ist leer.`)

  const size = MEAN_MAP_GRID
  const accumulator = new Float64Array(size * size)
  let count = 0

  for (const id of ids) {
    const path = heatmapPath(setName, id, duration, options.root)
    if (!existsSync(path)) continue

    // Each map is normalised to its own maximum first, so a single
    // high-contrast screen cannot dominate the average.
    const normalised = resizeScalarMap(toScalarMap(readPng(path)), size, size)
    for (let i = 0; i < accumulator.length; i++) accumulator[i] += normalised.values[i]
    count++
    options.onProgress?.(count, ids.length)
  }

  if (count === 0) throw new Error(`Mean map: keine Ground-Truth-Maps für "${setName}" / "${split}" / ${duration}s gefunden.`)

  const values = new Float32Array(accumulator.length)
  let max = 0
  for (let i = 0; i < accumulator.length; i++) {
    values[i] = accumulator[i] / count
    if (values[i] > max) max = values[i]
  }
  if (max > 0) for (let i = 0; i < values.length; i++) values[i] /= max

  return { map: { width: size, height: size, values }, count, split, duration }
}

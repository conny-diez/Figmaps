/**
 * Erzeugt die datengeschätzten Ortsprioren für `hybrid-v1`.
 *
 * Gebildet **ausschließlich aus dem Tuning-Split**. Der Test-Split darf nicht
 * einfließen: er ist die Messlatte, gegen die die fertige Konfiguration antritt.
 *
 * Ausgabe ist ein generiertes TS-Modul mit base64-kodierten Graustufen — klein
 * genug zum Mitbündeln, ohne PNG-Decoder oder Asset-Loader im Plugin.
 *
 * LIZENZ: Die Maps sind aus UEyes abgeleitet (CC BY 4.0). Sie mitzuliefern ist
 * erlaubt und verlangt Namensnennung samt Hinweis auf die Bearbeitung — der
 * Generator schreibt beides in den Kopf des erzeugten Moduls, `NOTICE.md` und
 * das Plugin-Panel tragen es sichtbar.
 */
import type { PriorAssetId } from '../src/engine/priors'
import { resizeScalarMap } from './dataset'
import { computeMeanMapAccumulator, MEAN_MAP_GRID } from './mean-map'
import type { ScalarMap } from '../src/engine/types'

export type PriorBuild = {
  id: PriorAssetId
  width: number
  height: number
  base64: string
  count: number
  source: string
  /** Size of the base64 payload in bytes — the budget is per map. */
  bytes: number
}

/** Averages the tuning split and reduces it to a `size x size` greyscale map. */
export function buildPrior(
  id: PriorAssetId,
  setName: string,
  duration: number,
  size: number,
  encodeBase64: (bytes: Uint8Array) => string,
): PriorBuild {
  const accumulator = computeMeanMapAccumulator(setName, 'tuning', duration)

  const mean = new Float32Array(accumulator.sum.length)
  let max = 0
  for (let i = 0; i < mean.length; i++) {
    mean[i] = accumulator.sum[i] / accumulator.count
    if (mean[i] > max) max = mean[i]
  }
  if (max > 0) for (let i = 0; i < mean.length; i++) mean[i] /= max

  const full: ScalarMap = { width: MEAN_MAP_GRID, height: MEAN_MAP_GRID, values: mean }
  const reduced = size === MEAN_MAP_GRID ? full : resizeScalarMap(full, size, size)

  const bytes = new Uint8Array(size * size)
  for (let i = 0; i < bytes.length; i++) bytes[i] = Math.round(Math.max(0, Math.min(1, reduced.values[i])) * 255)

  const base64 = encodeBase64(bytes)
  return {
    id,
    width: size,
    height: size,
    base64,
    count: accumulator.count,
    source: `${setName} / tuning / ${duration}s`,
    bytes: base64.length,
  }
}

const HEADER = `/**
 * Generated file — do not edit by hand.
 *
 * Written by \`npm run build-prior\`. Data-estimated location priors for
 * \`hybrid-v1\`, averaged over the **tuning** split of the reference sets. The
 * test split never contributed to them.
 *
 * ---------------------------------------------------------------------------
 * ATTRIBUTION — required, do not remove
 *
 * These maps are a derivative work of the UEyes dataset:
 *
 *   Jiang, Yue, Luis A. Leiva, Hamed Rezazadegan Tavakoli, Paul R. B. Houssel,
 *   Julia Kylmälä and Antti Oulasvirta. "UEyes: Understanding Visual Saliency
 *   across User Interface Types." Proceedings of the 2023 CHI Conference on
 *   Human Factors in Computing Systems, pp. 1-21, 2023.
 *   https://doi.org/10.1145/3544548.3581096
 *
 * Licence: CC BY 4.0 — https://creativecommons.org/licenses/by/4.0/
 * Changes made: the per-image saliency maps of the tuning split were rescaled
 * to a common square grid, averaged, normalised and quantised to 8 bit.
 *
 * See NOTICE.md. The attribution is also shown in the plugin panel, because
 * the maps ship inside the plugin.
 * ---------------------------------------------------------------------------
 */
import type { PriorAsset, PriorAssetId } from './index'
`

export function renderPriorModule(builds: readonly PriorBuild[]): string {
  const entries = builds
    .map(
      (build) => `  ${build.id}: {
    width: ${build.width},
    height: ${build.height},
    count: ${build.count},
    source: ${JSON.stringify(build.source)},
    data:
      '${build.base64}',
  },`,
    )
    .join('\n')

  return `${HEADER}
export const PRIOR_ASSETS: Partial<Record<PriorAssetId, PriorAsset>> = {
${entries}
}
`
}

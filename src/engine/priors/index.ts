/**
 * Data-estimated location priors.
 *
 * `heuristic-v1` uses an analytical F-pattern bell (`features/prior.ts`). The
 * diagnosis on UEyes showed that this bell is the single largest part of the
 * engine's deficit: an empirically estimated location prior beats it clearly,
 * and giving the analytical one *more* weight makes the prediction worse, not
 * better. `hybrid-v1` therefore replaces it with a small greyscale map averaged
 * over a reference set, and lays the image analysis on top additively.
 *
 * The maps are tiny on purpose — a location prior is smooth, so a coarse grid
 * plus bilinear upsampling loses nothing measurable and keeps the plugin
 * bundle small. Stored as base64 of raw 8-bit greyscale, decoded with a
 * self-contained decoder: `atob` is not guaranteed in the Figma main thread,
 * and a PNG would drag the canvas into a module the engine must stay free of.
 *
 * ATTRIBUTION: the shipped maps are derived from UEyes (CC BY 4.0). See
 * `NOTICE.md` — distributing them requires naming the authors.
 */
import { ENGINE_CONFIG } from '../config'
import { sampleBilinear } from '../imageops'
import { PRIOR_ASSETS } from './generated'

const MOBILE_MAX_WIDTH = ENGINE_CONFIG.viewport.mobileMaxWidth
const MOBILE_MIN_ASPECT = ENGINE_CONFIG.viewport.mobileMinAspect

/** Which reference population a prior was estimated from. */
export type PriorAssetId = 'web' | 'mobile' | 'desktop' | 'poster'

export const PRIOR_ASSET_IDS: readonly PriorAssetId[] = ['web', 'mobile', 'desktop', 'poster']

export const PRIOR_ASSET_LABELS: Record<PriorAssetId, string> = {
  web: 'Webseite',
  mobile: 'Mobile App',
  desktop: 'Desktop-Anwendung',
  poster: 'Poster / Grafik',
}

export type PriorAsset = {
  width: number
  height: number
  /** Base64 of `width * height` raw 8-bit greyscale samples, row-major. */
  data: string
  /** Where it came from — reproduced in the attribution. */
  source: string
  /** How many ground-truth maps were averaged. */
  count: number
}

/**
 * Viewing durations a prior exists for, in seconds (Epic D).
 *
 * Measured on both UI categories: a prior matched to the viewing duration
 * predicts that duration's attention better than the 3 s prior does
 * (web +0.012/+0.018 CC, mobile +0.008/+0.021, all intervals clear of zero).
 * Duration is therefore a *location* effect, not a feature-weighting one —
 * which is why the profiles swap the prior rather than the weights.
 */
export const PRIOR_DURATIONS = [1, 3, 7] as const
export type PriorDuration = (typeof PRIOR_DURATIONS)[number]

export const DEFAULT_PRIOR_DURATION: PriorDuration = 3

const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

/** Minimal base64 decoder — no `atob`, no `Buffer`, works in every realm. */
export function decodeBase64(input: string): Uint8Array {
  const lookup = new Int16Array(128).fill(-1)
  for (let i = 0; i < BASE64_ALPHABET.length; i++) lookup[BASE64_ALPHABET.charCodeAt(i)] = i

  const clean = input.replace(/[^A-Za-z0-9+/]/g, '')
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4))

  let bits = 0
  let accumulator = 0
  let cursor = 0
  for (let i = 0; i < clean.length; i++) {
    const value = lookup[clean.charCodeAt(i)]
    if (value < 0) continue
    accumulator = (accumulator << 6) | value
    bits += 6
    if (bits >= 8) {
      bits -= 8
      out[cursor++] = (accumulator >> bits) & 0xff
    }
  }
  return cursor === out.length ? out : out.subarray(0, cursor)
}

/**
 * Picks the prior for a frame from its geometry.
 *
 * Needs **both** criteria; each alone gets a common case wrong:
 *
 *   - width alone (the rule until 2026-08-08, threshold 1024 px) sent a
 *     960 px wide desktop layout to `mobile`. Measured against the labelled
 *     UEyes images it hit 24 % — *worse* than always answering `web`.
 *   - aspect ratio alone sends a 1440x6000 desktop scroll page to `mobile`,
 *     because it is four times taller than wide.
 *
 * So: phone-width **and** portrait. A tall desktop page stays wide and is
 * caught by the width test; a small landscape widget is caught by the aspect
 * test. On the labelled data the aspect part separates webpage from mobile
 * perfectly (495/495 each) at a threshold of 1.5.
 *
 * The width part is a **design-pixel** rule and cannot be validated against
 * UEyes, which stores phone captures at 1080 px device width. The eval harness
 * therefore states the category explicitly (`EngineOptions.priorAsset`) rather
 * than inferring it.
 *
 * `desktop` and `poster` are never returned: see `PRIOR_SELECTION_NOTE`.
 */
export function priorAssetIdFor(frameWidth: number, frameHeight: number): PriorAssetId {
  const portrait = frameWidth > 0 && frameHeight / frameWidth >= MOBILE_MIN_ASPECT
  return frameWidth < MOBILE_MAX_WIDTH && portrait ? 'mobile' : 'web'
}

/**
 * Why the automatic rule only ever answers `web` or `mobile`, although priors
 * for `desktop` and `poster` ship.
 *
 * Measured on all 1.980 labelled UEyes images: webpage and desktop-app UI are
 * geometrically indistinguishable (median aspect 0.67 vs 0.56, widths
 * 720–1896 vs 237–3170), and posters span everything from 0.32 to 3.25. The
 * best geometric four-way rule reached 53 % accuracy and identified only
 * 11 of 495 desktop images, while misrouting 64 webpages to the poster prior —
 * for a gain of 0.0005 CC over the two-way rule. Guessing those two categories
 * costs more than it returns.
 *
 * They are reachable by explicit selection instead (`Settings.uiType`), where
 * the person who drew the frame states what it is.
 */
export const PRIOR_SELECTION_NOTE = 'automatisch nur web/mobile; desktop und poster nur bei expliziter Wahl'

export function hasPriorAsset(id: PriorAssetId, duration: PriorDuration = DEFAULT_PRIOR_DURATION): boolean {
  return PRIOR_ASSETS[assetKey(id, duration)] !== undefined
}

/**
 * Was am Ende **gerechnet** hat — nicht, was angefordert wurde.
 *
 * DAS TEXT-BINDUNGS-PRINZIP, an seiner Wurzel. Bis 1.2 hat die Fußzeile der
 * Karte die Kategorie aus `priorAssetIdFor(…)` und die Betrachtungsdauer aus
 * der Einstellung genannt — beides Aussagen darüber, welcher Prior **gewählt**
 * wurde. Fehlte das Asset, wich `priorMap` stumm aus oder fiel auf die
 * analytische Glocke zurück, und dieselbe Zeile stand mit denselben Worten
 * unter einer Karte, die etwas anderes gezeichnet hatte.
 *
 * Diese Funktion ist die einzige Stelle, an der die Auflösung stattfindet, und
 * `priorMap` benutzt sie ebenfalls. Damit kann die Beschriftung nicht mehr von
 * der Rechnung abweichen — nicht weil jemand daran denkt, sondern weil es nur
 * eine Antwort gibt.
 *
 * Geprüft wird auch die **Nutzlast**, nicht nur die Anwesenheit des Schlüssels:
 * `priorMap` gibt `null` zurück, wenn die dekodierten Bytes nicht für
 * `width × height` reichen, und genau diesen Fall bewacht `check-release.mjs`
 * im Build. Ein Eintrag mit leerem `data` wäre sonst „geladen" und die Zeile
 * wieder eine Behauptung.
 */
export type PriorResolution =
  | {
      source: 'data'
      /** Die Kategorie, deren Karte tatsächlich gelesen wurde. */
      asset: PriorAssetId
      /** Die Dauer, deren Karte tatsächlich gelesen wurde. */
      duration: PriorDuration
      /** Die angeforderte Dauer — abweichend, wenn auf 3 s ausgewichen wurde. */
      requestedDuration: PriorDuration
    }
  /** Kein Asset lesbar — gerechnet hat die analytische F-Muster-Glocke von 1.0. */
  | { source: 'analytic'; asset: PriorAssetId; requestedDuration: PriorDuration }

/** Reicht die Base64-Nutzlast für `width × height` Samples? */
function hasPayload(asset: PriorAsset | undefined): boolean {
  if (!asset) return false
  const clean = asset.data.replace(/[^A-Za-z0-9+/]/g, '')
  return Math.floor((clean.length * 3) / 4) >= asset.width * asset.height
}

export function resolvePriorAsset(
  id: PriorAssetId,
  duration: PriorDuration = DEFAULT_PRIOR_DURATION,
  assets: Record<string, PriorAsset> = PRIOR_ASSETS,
): PriorResolution {
  if (hasPayload(assets[assetKey(id, duration)])) {
    return { source: 'data', asset: id, duration, requestedDuration: duration }
  }
  // Derselbe Rückfall, den `priorMap` schon immer hatte — jetzt mit Rückgabewert.
  if (hasPayload(assets[assetKey(id, DEFAULT_PRIOR_DURATION)])) {
    return { source: 'data', asset: id, duration: DEFAULT_PRIOR_DURATION, requestedDuration: duration }
  }
  return { source: 'analytic', asset: id, requestedDuration: duration }
}

/**
 * Die Betrachtungsdauer eines Profils als `PriorDuration`, oder `null`.
 *
 * `PROFILE_DURATIONS` ist ein `Record<ProfileId, number>`, und `number` ist
 * hier zu weit: eine Dauer, für die es keinen Prior gibt, muss als solche
 * erkennbar sein statt in einen `as`-Ausdruck zu rutschen. Genau dieser Cast
 * stand bis 1.2 in `heuristic.ts`.
 */
export function priorDurationFor(seconds: number): PriorDuration | null {
  return PRIOR_DURATIONS.find((duration) => duration === seconds) ?? null
}

/** Key into the generated table: category and viewing duration. */
export function assetKey(id: PriorAssetId, duration: PriorDuration): string {
  return `${id}@${duration}s`
}

/**
 * True when the build carries derived UEyes data — and therefore when the
 * CC BY 4.0 attribution has to be visible. Note this does not depend on which
 * engine configuration is active: the asset is imported statically, so it ships
 * either way. See NOTICE.md.
 */
export function shipsPriorAsset(): boolean {
  return Object.keys(PRIOR_ASSETS).length > 0
}

/**
 * The attribution in the form that fits next to a placed map.
 *
 * **Source only, no label.** The label is the caller's — `figma/place.ts`
 * writes „Datengrundlage: …" in front of it. This string used to start with
 * „Ortsprior: " and produced „Datengrundlage: Ortsprior: UEyes …" on the
 * wrapper: a double colon, and the one word that is no longer allowed to appear
 * anywhere in the output.
 */
export const PRIOR_ATTRIBUTION_SHORT = 'UEyes (Jiang et al. 2023), CC BY 4.0'

/** Categories that have a prior for every shipped duration. */
export function availablePriorCategories(): PriorAssetId[] {
  return PRIOR_ASSET_IDS.filter((id) => PRIOR_DURATIONS.every((duration) => hasPriorAsset(id, duration) === true))
}

/** Durations that have a prior for every available category. */
export function availablePriorDurations(): PriorDuration[] {
  const categories = PRIOR_ASSET_IDS.filter((id) => hasPriorAsset(id) === true)
  return PRIOR_DURATIONS.filter((duration) => categories.every((id) => hasPriorAsset(id, duration) === true))
}

/**
 * Decodes a prior and resamples it onto the analysis grid.
 *
 * Bilinear, not area-averaged: this is an *upsample* of a deliberately coarse,
 * smooth field, and area averaging would only reproduce the coarse steps.
 * Result is normalised to `[0,1]`.
 */
export function priorMap(
  id: PriorAssetId,
  width: number,
  height: number,
  duration: PriorDuration = DEFAULT_PRIOR_DURATION,
): Float32Array | null {
  // Über `resolvePriorAsset`, damit die Karte und ihre Beschriftung dieselbe
  // Antwort benutzen. Vorher stand der Rückfall auf 3 s hier als `??`-Kette und
  // war von außen nicht zu sehen — die Fußzeile nannte weiter die angeforderte
  // Dauer (siehe `PriorResolution`).
  const resolution = resolvePriorAsset(id, duration)
  if (resolution.source !== 'data') return null
  const asset = PRIOR_ASSETS[assetKey(resolution.asset, resolution.duration)]
  if (!asset) return null

  const bytes = decodeBase64(asset.data)
  if (bytes.length < asset.width * asset.height) return null
  return resamplePrior(bytes, asset.width, asset.height, width, height)
}

/**
 * Turns quantised prior samples into a map on the target grid.
 *
 * Split out from `priorMap` so the cross-validation can feed a per-fold prior
 * through *exactly* the path the shipped asset takes — including the 8-bit
 * quantisation. Measuring a float prior and shipping a quantised one would be
 * measuring something else.
 */
export function resamplePrior(
  samples: Uint8Array,
  sourceWidth: number,
  sourceHeight: number,
  width: number,
  height: number,
): Float32Array {
  const source = new Float32Array(sourceWidth * sourceHeight)
  for (let i = 0; i < source.length; i++) source[i] = samples[i] / 255

  const out = new Float32Array(width * height)
  let max = 0
  for (let y = 0; y < height; y++) {
    // Map pixel centres onto the source grid, so the prior does not shift by
    // half a cell on small maps.
    const sy = ((y + 0.5) / height) * sourceHeight - 0.5
    for (let x = 0; x < width; x++) {
      const sx = ((x + 0.5) / width) * sourceWidth - 0.5
      const value = sampleBilinear(source, sourceWidth, sourceHeight, sx, sy)
      out[y * width + x] = value
      if (value > max) max = value
    }
  }
  if (max > 0) for (let i = 0; i < out.length; i++) out[i] /= max
  return out
}

export { PRIOR_ASSETS }

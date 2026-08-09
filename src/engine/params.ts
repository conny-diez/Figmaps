/**
 * Named, versioned engine configurations (A-6) and the viewing-duration
 * profiles of Epic D.
 *
 * `ENGINE_CONFIG` in `config.ts` stays the single place where a *number* is
 * written down. This module carves the tunable subset of it out into a plain,
 * mutable `EngineParams` object so the eval harness can search over it and so
 * a tuned result can be checked in as a second named configuration next to the
 * shipped one.
 */
import { ENGINE_CONFIG } from './config'
import type { PriorConfig } from './features/prior'
import { TUNED_CONFIGS } from './tuned'

export type FeatureWeights = {
  luminanceContrast: number
  colorOpponency: number
  edgeDensity: number
  textSalience: number
  interactiveSalience: number
  imageSalience: number
  positionPrior: number
}

export type PostParams = {
  blurSigmaRatio: number
  clipLowPercentile: number
  clipHighPercentile: number
  gamma: number
}

/**
 * How the position prior is obtained.
 *
 * `analytic` is the F-pattern bell of `features/prior.ts` (Figmaps 1.0).
 * `data` is a small greyscale map averaged over a reference set — measurably
 * better, but it makes the prediction dependent on that reference set and
 * carries its licence (see `NOTICE.md`).
 */
export type PriorSource = 'analytic' | 'data'

/** Everything the tuner is allowed to move. */
export type EngineParams = {
  weights: FeatureWeights
  prior: PriorConfig
  post: PostParams
  priorSource?: PriorSource
  /**
   * When set, the prediction is `norm(prior) + blendAlpha * norm(imageFeatures)`
   * instead of one weighted sum over all seven maps. The diagnosis showed the
   * two roles are additive rather than interchangeable: the prior says where
   * attention usually goes, the image analysis says how this screen deviates.
   */
  blendAlpha?: number
  /**
   * Exponent über der **fertigen**, gemischten Karte — `map^blendGamma`.
   *
   * Nur im Hybrid-Pfad wirksam. `undefined` oder 1 heißt „kein zweites Gamma",
   * also das Verhalten von 1.1; Werte über 1 spitzen zu (schwache Werte fallen
   * stärker als starke), Werte darunter glätten.
   *
   * Getrennt von `post.gamma`: das sitzt **innerhalb** des Bildanteils, vor der
   * Mischung mit dem Ortsprior, und formt damit nur, was die Bildanalyse
   * beiträgt. `blendGamma` formt die Verteilung, die am Ende gezeichnet wird —
   * inklusive des Priors, der den Sockel stellt. Für die Konzentration der
   * ausgelieferten Karte ist das der wirksamere der beiden.
   */
  blendGamma?: number
}

/** Epic D — viewing duration the prediction is calibrated for. */
export type ProfileId = 'glance' | 'scan' | 'read'

export const PROFILE_IDS: readonly ProfileId[] = ['glance', 'scan', 'read']

export const PROFILE_LABELS: Record<ProfileId, string> = {
  glance: 'Blick (1 s)',
  scan: 'Scan (3 s)',
  read: 'Lesen (7 s)',
}

/** UEyes ground-truth duration each profile is tuned against (seconds). */
export const PROFILE_DURATIONS: Record<ProfileId, number> = { glance: 1, scan: 3, read: 7 }

export const DEFAULT_PROFILE: ProfileId = 'scan'

export type EngineConfigEntry = {
  id: string
  label: string
  profiles: Record<ProfileId, EngineParams>
  /**
   * Epic D gate: a profile is only offered in the UI once the harness has shown
   * it beats the center-bias baseline. Three profiles of which one is noise are
   * worse than one profile.
   */
  shipped: Record<ProfileId, boolean>
}

function cloneParams(params: EngineParams): EngineParams {
  return {
    weights: { ...params.weights },
    prior: { ...params.prior },
    post: { ...params.post },
    ...(params.priorSource ? { priorSource: params.priorSource } : {}),
    ...(params.blendAlpha !== undefined ? { blendAlpha: params.blendAlpha } : {}),
    ...(params.blendGamma !== undefined ? { blendGamma: params.blendGamma } : {}),
  }
}

/** The configuration Figmaps 1.0 shipped — the frozen reference of A-4. */
export const HEURISTIC_V1: EngineParams = {
  weights: { ...ENGINE_CONFIG.weights },
  prior: { ...ENGINE_CONFIG.prior },
  post: {
    blurSigmaRatio: ENGINE_CONFIG.post.blurSigmaRatio,
    clipLowPercentile: ENGINE_CONFIG.post.clipLowPercentile,
    clipHighPercentile: ENGINE_CONFIG.post.clipHighPercentile,
    gamma: ENGINE_CONFIG.post.gamma,
  },
}

/**
 * Epic D starting hypothesis, explicitly *not* evidence:
 * a short glance is dominated by where things are and by raw contrast, a long
 * read shifts weight onto text and interactive elements. The harness replaces
 * these numbers; until it has, neither profile ships.
 */
function withWeights(base: EngineParams, weights: Partial<FeatureWeights>): EngineParams {
  const merged = { ...base.weights, ...weights }
  const total = Object.values(merged).reduce((sum, value) => sum + value, 0)
  const normalised = {} as FeatureWeights
  for (const key of Object.keys(merged) as Array<keyof FeatureWeights>) {
    normalised[key] = total > 0 ? merged[key] / total : 0
  }
  return { ...cloneParams(base), weights: normalised }
}

const GLANCE_HYPOTHESIS = withWeights(HEURISTIC_V1, {
  luminanceContrast: 0.24,
  colorOpponency: 0.2,
  edgeDensity: 0.16,
  textSalience: 0.12,
  interactiveSalience: 0.04,
  imageSalience: 0.08,
  positionPrior: 0.22,
})

const READ_HYPOTHESIS = withWeights(HEURISTIC_V1, {
  luminanceContrast: 0.14,
  colorOpponency: 0.1,
  edgeDensity: 0.12,
  textSalience: 0.28,
  interactiveSalience: 0.18,
  imageSalience: 0.12,
  positionPrior: 0.06,
})

const BASE_CONFIG: EngineConfigEntry = {
  id: 'heuristic-v1',
  label: 'Figmaps 1.0 (heuristisch, handkalibriert)',
  profiles: {
    glance: GLANCE_HYPOTHESIS,
    scan: HEURISTIC_V1,
    read: READ_HYPOTHESIS,
  },
  // `scan` is what 1.0 shipped and what users see today; the other two stay
  // hidden until `npm run eval` proves them.
  shipped: { glance: false, scan: true, read: false },
}

/**
 * The share the image analysis is mixed in with, on top of the data prior.
 *
 * **0,5 seit 1.2, vorher 0,3.** Der alte Wert stammte aus dem Diagnose-Sweep,
 * war *in-sample* auf dem Tuning-Split abgelesen und an einem einzigen
 * Kriterium entschieden: bei 0,5 verlor KL gegen die Mean Map (1,092 gegen
 * 1,088), und S-2 verlangte einen Sieg in allen vier Metriken.
 *
 * Nachgemessen mit `npm run alpha` — 5-fache Kreuzvalidierung auf dem
 * Tuning-Split, Ortsprior **und** Mean Map je Fold neu geschätzt, jedes Bild
 * out-of-sample, 468 Bilder je Kategorie:
 *
 *   α      AUC     CC      NSS     KL      Konzentration
 *   0      0,768   0,420   0,991   1,088   0,164     (nur Prior)
 *   0,3    0,780   0,443   1,049   1,078   0,141
 *   0,5    0,783   0,447   1,061   1,091   0,133
 *   0,8    0,782   0,444   1,055   1,111   0,127
 *   1,2    0,777   0,431   1,028   1,133   0,124
 *                                                    (Webpage; Mobile identisch
 *                                                     im Verlauf, Optimum ebenso
 *                                                     bei 0,5)
 *
 * AUC, CC und NSS haben ihr Maximum bei 0,5 — einstimmig, in beiden
 * Kategorien, jede gepaarte Differenz gegen 0,3 mit einem 95-%-Intervall ohne
 * Null (web +0,0025 / +0,0040 / +0,0117, mobile +0,0018 / +0,0061 / +0,0149).
 * Die Kurve fällt danach, verlängert wurde deshalb nicht.
 *
 * **KL ist ausdrücklich nicht das Kriterium** und das ist eine begründete
 * Ausnahme, keine Nachlässigkeit: KL bestraft eine Karte dafür, dass sie Masse
 * von den Rändern abzieht — also genau für Zuspitzung, und Zuspitzung ist die
 * geprüfte Eigenschaft. Der Preis steht in der Tabelle: KL wird von 1,078 auf
 * 1,091 schlechter.
 *
 * Der historische Grund für 0,3 hält der Nachmessung übrigens nicht stand.
 * Gepaart je Bild und out-of-sample ist KL bei 0,5 gegen die Mean Map **kein
 * Verlust, sondern ein Unentschieden** (web −0,0014, Intervall über die Null;
 * mobile +0,0112, ebenfalls). Der alte Vergleich war in-sample und über
 * Mittelwerte statt gepaart.
 *
 * **Was 0,5 nicht behebt.** Der Verdacht, unsere Karten seien systematisch zu
 * weich, ist bestätigt und wird von diesem Parameter *nicht* behoben: die
 * Ground Truth hält 48,2 % ihrer Masse in den stärksten 5 % der Pixel
 * (Webpage; Mobile 38,3 %), unsere Vorhersage 14,1 % bei α = 0,3. Ein höheres
 * α macht das **schlechter**, nicht besser — 0,133 bei 0,5 und 0,124 bei 1,2 —,
 * weil der Bildanteil eine breite, weichgezeichnete Fläche ist und den Sockel
 * überall anhebt. Schärfe ist an anderer Stelle zu holen; siehe README,
 * „Alpha-Kurve".
 */
export const HYBRID_BLEND_ALPHA = 0.5

/**
 * `hybrid-v1` — data-estimated prior plus additive image analysis.
 *
 * The weights are the 1.0 weights with the position prior removed and the rest
 * renormalised: the prior no longer competes inside the weighted sum, it is the
 * base the rest is added to.
 */
function imageOnlyWeights(base: FeatureWeights): FeatureWeights {
  const withoutPrior = { ...base, positionPrior: 0 }
  const total = Object.values(withoutPrior).reduce((sum, value) => sum + value, 0)
  const out = {} as FeatureWeights
  for (const key of Object.keys(withoutPrior) as Array<keyof FeatureWeights>) {
    out[key] = total > 0 ? withoutPrior[key] / total : 0
  }
  return out
}

const HYBRID_PARAMS: EngineParams = {
  ...cloneParams(HEURISTIC_V1),
  weights: imageOnlyWeights(HEURISTIC_V1.weights),
  priorSource: 'data',
  blendAlpha: HYBRID_BLEND_ALPHA,
}

const HYBRID_CONFIG: EngineConfigEntry = {
  id: 'hybrid-v1',
  label: 'Figmaps 1.1 (datengeschätzter Ortsprior + Bildanalyse)',
  // Identical parameters on purpose: Epic D turned out to be a *prior* effect,
  // not a weighting one. The profile selects which viewing duration the
  // location prior was estimated from (see `priors/index.ts`), the feature
  // weights stay the same.
  profiles: { glance: HYBRID_PARAMS, scan: HYBRID_PARAMS, read: HYBRID_PARAMS },
  /**
   * All three ship. Measured out-of-sample on 495 images per UI category: a
   * prior matched to the viewing duration beats the 3 s prior on its own
   * ground truth — web +0.012 CC (1 s, t=7.9) and +0.018 (7 s, t=7.4), mobile
   * +0.008 (t=6.3) and +0.021 (t=8.0), every interval clear of zero.
   */
  shipped: { glance: true, scan: true, read: true },
}

/** All configurations the harness and the plugin know about, by id. */
export const ENGINE_CONFIGS: Record<string, EngineConfigEntry> = {
  [BASE_CONFIG.id]: BASE_CONFIG,
  [HYBRID_CONFIG.id]: HYBRID_CONFIG,
  ...Object.fromEntries(TUNED_CONFIGS.map((entry) => [entry.id, entry])),
}

/** The configuration the plugin currently ships. */
export const ACTIVE_CONFIG_ID = ENGINE_CONFIG.activeConfigId

export function engineConfigEntry(configId: string = ACTIVE_CONFIG_ID): EngineConfigEntry {
  return ENGINE_CONFIGS[configId] ?? BASE_CONFIG
}

/** Resolves `(configId, profile)` to the parameter set the engine runs with. */
export function resolveParams(configId: string = ACTIVE_CONFIG_ID, profile: ProfileId = DEFAULT_PROFILE): EngineParams {
  const entry = engineConfigEntry(configId)
  return entry.profiles[profile] ?? entry.profiles[DEFAULT_PROFILE]
}

/**
 * Profiles of the active configuration that passed the Epic D gate.
 *
 * Never empty: a freshly tuned configuration starts with every `shipped` flag
 * false, and a plugin that offers no profile at all could not run.
 */
export function shippedProfiles(configId: string = ACTIVE_CONFIG_ID): ProfileId[] {
  const entry = engineConfigEntry(configId)
  const shipped = PROFILE_IDS.filter((id) => entry.shipped[id])
  return shipped.length > 0 ? shipped : [DEFAULT_PROFILE]
}

/** Human-readable engine label used in layer names, legends and reports. */
export function engineLabel(configId: string = ACTIVE_CONFIG_ID, profile: ProfileId = DEFAULT_PROFILE): string {
  const shipped = shippedProfiles(configId)
  return shipped.length > 1 ? `${configId} · ${profile}` : configId
}

export { cloneParams }

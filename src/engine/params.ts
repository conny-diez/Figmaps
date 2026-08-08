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

/** Everything the tuner is allowed to move. */
export type EngineParams = {
  weights: FeatureWeights
  prior: PriorConfig
  post: PostParams
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
  }
}

/** The configuration FigMaps 1.0 shipped — the frozen reference of A-4. */
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
  label: 'FigMaps 1.0 (heuristisch, handkalibriert)',
  profiles: {
    glance: GLANCE_HYPOTHESIS,
    scan: HEURISTIC_V1,
    read: READ_HYPOTHESIS,
  },
  // `scan` is what 1.0 shipped and what users see today; the other two stay
  // hidden until `npm run eval` proves them.
  shipped: { glance: false, scan: true, read: false },
}

/** All configurations the harness and the plugin know about, by id. */
export const ENGINE_CONFIGS: Record<string, EngineConfigEntry> = {
  [BASE_CONFIG.id]: BASE_CONFIG,
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

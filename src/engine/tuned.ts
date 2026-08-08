/**
 * Generated file — do not edit by hand.
 *
 * `npm run tune` (A-6) writes the outcome of a random search over the engine
 * weights here as an additional named configuration. Nothing is deployed
 * automatically: switching the plugin over means changing
 * `ENGINE_CONFIG.activeConfigId` in `config.ts` by hand, after a human has
 * looked at the contact sheet.
 *
 * Empty until the harness has been run against a reference set. A run against
 * the synthetic set is deliberately not committed: its ground truth is
 * constructed, so a configuration tuned on it would be calibrated against our
 * own assumptions rather than against measured behaviour.
 */
import type { EngineConfigEntry } from './params'

export const TUNED_CONFIGS: EngineConfigEntry[] = []

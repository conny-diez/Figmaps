/**
 * Version of the *plugin*, as shown in the panel header.
 *
 * Deliberately separate from `ENGINE_VERSION` (`src/engine/config.ts`): the
 * engine version says which prediction produced a map and belongs on the map
 * itself — it is printed next to every rendered map (see
 * `figma/place.ts`). The header names the product the user installed.
 *
 * Keep in sync with `package.json` — the panel cannot import it, because the
 * iframe bundle has no module resolution for JSON.
 */
export const PLUGIN_VERSION = 'v1.1'

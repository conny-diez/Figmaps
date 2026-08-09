/**
 * Version of the *plugin*, as shown in the panel header.
 *
 * Deliberately separate from `ENGINE_VERSION` (`src/engine/config.ts`): the
 * engine version says which prediction produced a map and belongs on the map
 * itself — it is printed next to every rendered map (see
 * `figma/place.ts`). The header names the product the user installed.
 *
 * **Eine Quelle, nicht zwei.** Die Zahl steht ausschließlich in `package.json`
 * und wird beim Bündeln eingesetzt (`scripts/build.mjs` und `vitest.config.ts`,
 * beide über `define`). Vorher stand sie hier als Literal „in sync with
 * package.json" — und eine Konstante, deren Richtigkeit von einer Bitte im
 * Kommentar abhängt, ist genau so lange richtig, bis jemand die andere Stelle
 * anfasst.
 *
 * Das `declare` ist der Preis dafür: ohne Bündler existiert der Bezeichner
 * nicht, deshalb ist er als Build-Zeit-Konstante deklariert statt importiert.
 * Ein `import` aus JSON wäre die Alternative — den kann der iframe-Bundle-Pfad
 * nicht auflösen.
 */
declare const __PACKAGE_VERSION__: string

/** `1.1.0` -> `v1.1`. Die Patch-Stelle sagt im Panel nichts. */
function short(version: string): string {
  const [major, minor] = version.split('.')
  return `v${major}.${minor}`
}

export const PLUGIN_VERSION = short(__PACKAGE_VERSION__)

/**
 * Was im Kopf des Panels steht.
 *
 * Der Beta-Marker ist eine Aussage über die Vorhersage, nicht über die
 * Stabilität des Codes: die Engine ist gegen einen einzigen öffentlichen
 * Datensatz gemessen, drei der sechs Befundregeln sind abgeschaltet, und für
 * die eigenen Screens fehlt weiterhin ein Validierungsset. Wer das Panel
 * öffnet, soll das sehen, bevor er eine Karte für eine Messung hält.
 */
export const PLUGIN_LABEL = `Beta ${PLUGIN_VERSION}`

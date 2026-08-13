/**
 * Version des *Plugins*, in zwei Formen — der maschinellen und der lesbaren.
 *
 * Bewusst getrennt von `ENGINE_VERSION` (`src/engine/config.ts`): die
 * Engine-Version sagt, welche Vorhersage eine Karte erzeugt hat, und gehört
 * deshalb an die Karte (siehe `figma/place.ts`). Diese hier sagt, aus welchem
 * ausgelieferten Stand das Plugin kommt.
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
 *
 * ---
 *
 * **Zwei Formen, und warum es zwei sein müssen.**
 *
 * `1.0.0-beta.1` ist Semver: so heißt der Tag, so heißt das Zip, so vergleicht
 * der Release-Workflow. Für ein Panel ist es die falsche Form — ein Bindestrich
 * mitten in einer Versionsnummer liest sich als Tippfehler oder als Suffix, das
 * man überliest. Angezeigt wird deshalb **„1.0.0 Beta 1"**.
 *
 * Beide kommen aus derselben Zeichenkette; `humanVersion` ist die einzige Stelle,
 * die umformt. Dieselbe Umformung braucht der Release-Workflow für den Titel, und
 * damit die beiden nicht auseinanderlaufen, gibt es `scripts/version-label.mjs`
 * und einen Test, der beide gegeneinander hält
 * (`src/__tests__/version.test.ts`).
 */
declare const __PACKAGE_VERSION__: string

/**
 * Semver in die lesbare Form: `1.0.0-beta.1` → `1.0.0 Beta 1`.
 *
 * Erkannt wird nur die Form `<kern>-<name>.<zahl>`. Alles andere kommt
 * **unverändert** zurück — eine Vorabversion, deren Form wir nicht kennen, wird
 * nicht geraten, sondern gezeigt, wie sie ist. Lieber ein Bindestrich im Panel
 * als eine Beschriftung, die eine andere Version behauptet.
 */
export function humanVersion(version: string): string {
  const match = /^(\d+\.\d+\.\d+)-([a-z]+)\.(\d+)$/.exec(version)
  if (!match) return version
  const [, core, name, number] = match
  // `rc` ist eine Abkürzung und bleibt eine; `beta` ist ein Wort.
  const label = name === 'rc' ? 'RC' : `${name[0].toUpperCase()}${name.slice(1)}`
  return `${core} ${label} ${number}`
}

/** Die Semver-Fassung: Tag, Zip-Name, Versionsabgleich im Workflow. */
export const PLUGIN_VERSION = __PACKAGE_VERSION__

/**
 * Was der Nutzer sieht — im Kopf des Panels, im Fenstertitel, im Namen jedes
 * Wrapper-Frames und in der Fußzeile der Ausgabe.
 *
 * Der Beta-Teil ist eine Aussage über die **Vorhersage**, nicht über die
 * Stabilität des Codes: die Engine ist gegen einen einzigen öffentlichen
 * Datensatz gemessen, drei der sechs Befundregeln sind abgeschaltet, und für die
 * eigenen Screens fehlt ein Validierungsset. Wer das Panel öffnet, soll das
 * sehen, bevor er eine Karte für eine Messung hält.
 *
 * **Deshalb steht die Fassung an jeder Stelle, an der ein Ergebnis auftaucht,
 * und nicht nur im Panel.** Ein Ergebnis wandert weiter, als das Panel reicht:
 * der Wrapper-Frame landet in einer Datei, die jemand anderes öffnet, und die
 * Fußzeile reist sogar mit einer exportierten Map — sie ist die einzige dieser
 * Stellen, die einen Export übersteht, und damit die wichtigste.
 */
export const PLUGIN_LABEL = humanVersion(PLUGIN_VERSION)

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

/**
 * Die vollständige Version, wie das Release heißt: `1.2.0`.
 *
 * **Vorher stand hier die verkürzte Form `v1.2`**, mit der Begründung, die
 * Patch-Stelle sage im Panel nichts. Für eine Beta sagt sie das Wichtigste: wer
 * ein Verhalten meldet, muss den Stand benennen können, den er vor sich hat, und
 * „v1.2" trifft auf 1.2.0 und 1.2.3 gleichermaßen zu. Solange die Vorhersage
 * Beta ist, ist die genaue Zahl die nützlichere.
 */
export const PLUGIN_VERSION = __PACKAGE_VERSION__

/**
 * Was im Kopf des Panels steht — und, über `PLUGIN_LABEL`, im Fenstertitel und
 * am Namen jedes Wrapper-Frames auf dem Canvas.
 *
 * Der Beta-Marker ist eine Aussage über die Vorhersage, nicht über die
 * Stabilität des Codes: die Engine ist gegen einen einzigen öffentlichen
 * Datensatz gemessen, drei der sechs Befundregeln sind abgeschaltet, und für
 * die eigenen Screens fehlt weiterhin ein Validierungsset. Wer das Panel
 * öffnet, soll das sehen, bevor er eine Karte für eine Messung hält.
 *
 * **Deshalb steht er an jeder Stelle, an der die Version steht, und nicht nur
 * im Panel.** Ein Ergebnis wandert weiter, als das Panel reicht: der
 * Wrapper-Frame landet in einer Datei, die jemand anderes öffnet, und das Zip
 * liegt in einem Ordner, den jemand in einem halben Jahr wiederfindet. Wer die
 * Karte sieht, sieht dann auch, aus welchem Stand sie kommt.
 */
export const PLUGIN_LABEL = `Beta ${PLUGIN_VERSION}`

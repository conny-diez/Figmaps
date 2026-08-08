<img src="assets/logo.svg" width="72" height="72" alt="FigMaps">

# FigMaps — Figma Plugin

Erzeugt für einen ausgewählten Frame drei Visualisierungen und legt sie als Bild
rechts neben dem Original auf dem Canvas ab:

- **Heatmap** — vorhergesagte Verteilung visueller Aufmerksamkeit (Turbo-Colormap)
- **Clickmap** — vorhergesagte Klickwahrscheinlichkeit je interaktivem Element, inkl. Ranking
- **Focusmap** — Screen abgedunkelt und unscharf, nur die Top-Regionen bleiben klar

> Die Ausgabe ist eine **algorithmische Vorhersage**, keine Messung. Es fließen
> keine Daten echten Nutzerverhaltens ein. Jede Map trägt ein Label mit
> Engine-Version und Disclaimer.

Kein Backend, kein Login, keine Netzwerkanfragen — `networkAccess` steht auf
`["none"]`, das Design verlässt die Maschine nicht.

---

## Setup

```bash
npm install
npm run build
```

Danach in der **Figma Desktop App**: `Plugins → Development → Import plugin from
manifest…` → `manifest.json` aus diesem Verzeichnis wählen.

Während der Entwicklung:

```bash
npm run watch     # esbuild im Watch-Modus (unminified, inline sourcemaps)
npm run verify    # typecheck + tests + build
npm run lint      # eslint inkl. @figma/eslint-plugin-figma-plugins
```

Die `id` in `manifest.json` ist ein lokaler Platzhalter. Beim Publishing in die
Community vergibt Figma eine echte ID, die dann eingetragen wird.

---

## Bedienung

1. Frame, Component, Instance, Section oder Group auswählen (Mehrfachauswahl = Batch)
2. Maps an-/abwählen, Overlay-Deckkraft und Focus-Schwelle einstellen
3. **Maps erstellen** — Ergebnis landet in einem neuen Wrapper-Frame
   `[FigMaps] {Frame-Name} — {Zeitstempel}` rechts daneben

Wiederholte Läufe erzeugen immer einen **neuen** Wrapper und überschreiben nichts.
Frames mit einer Kante unter 200 px werden abgelehnt.

---

## Architektur

Zwei Realms, strikt getrennt (PRD §6.3) — die häufigste Fehlerquelle in
Figma-Plugins:

| | Main Thread (`src/main.ts`, `src/figma/`) | iframe (`src/ui.tsx`, `src/engine/`, `src/render/`) |
|---|---|---|
| **darf** | `figma.*`, `exportAsync`, Scene Graph, `clientStorage` | DOM, Canvas 2D, `createImageBitmap` |
| **darf nicht** | `document`, `canvas`, `Image`, `fetch` — existieren dort nicht | `figma.*` — existiert dort nicht |

`npm run build` prüft das am gebauten Bundle und bricht ab, wenn eine Seite in
die andere greift (`assertRealmSeparation` in `scripts/build.mjs`).

Der Message-Contract liegt in `src/messages.ts` und wird von beiden Seiten
importiert — Discriminated Union, kein `any`.

```
src/
├─ main.ts                 Main-Thread-Entry: Orchestrierung des Batch-Laufs
├─ ui.tsx                  iframe-Entry: Preact-Panel
├─ messages.ts             geteilte Typen (UiToMain / MainToUi / NodeSignal / Settings)
├─ figma/
│  ├─ selection.ts         FR-1  gültige Selection, Mindestgröße
│  ├─ export.ts            FR-2  exportAsync inkl. 4096-px-Fallback
│  ├─ traverse.ts          FR-3  Layer-Tree → NodeSignal[]
│  ├─ place.ts             FR-8  Wrapper-Frame, Bild-Rects, Titel
│  └─ storage.ts           FR-10 clientStorage
├─ engine/
│  ├─ config.ts            ENGINE_CONFIG — jede Konstante des Systems
│  ├─ types.ts             AttentionEngine-Interface
│  ├─ heuristic.ts         FR-4  Gewichtete Summe + Nachverarbeitung
│  ├─ imageops.ts          Blur, Sobel, DoG, Perzentil-Clipping, Rasterisierung
│  ├─ features/            luminance · color · edges · structure · prior
│  ├─ clickmap.ts          FR-5  Kandidaten + Scoring
│  └─ __tests__/           synthetische Eingaben mit bekannter Wahrheit
├─ render/
│  ├─ canvas.ts            Decode/Encode/Skalierung
│  ├─ colormap.ts          Turbo-Stops
│  ├─ heatmap.ts           FR-7
│  ├─ clickmap.ts          FR-5 Rendering
│  ├─ focusmap.ts          FR-6
│  └─ legend.ts            Legende + Disclaimer-Fußzeile
└─ ui/
   ├─ pipeline.ts          iframe-Pipeline: PNG rein, Map-PNGs raus
   ├─ logo.tsx             FigMaps-Wortmarke als Inline-SVG
   └─ styles.css

assets/
└─ logo.svg                Produkt-Logo (Quelle für Panel-Mark und Store-Icon)
```

### Ablauf eines Laufs

```
UI  ──GENERATE──────────────▶ Main
                              exportAsync + collectSignals   (je Frame, sequenziell)
UI  ◀─FRAME_DATA────────────  Main
    predict → render
UI  ──PLACE_RESULT─────────▶  Main
                              createImage + Wrapper-Frame
UI  ◀─FRAME_DONE───────────   Main
                              … nächster Frame …
UI  ◀─DONE─────────────────   Main   + figma.notify
```

### Engine tunen

Alle Gewichte, Sigmas und Schwellwerte stehen in **`src/engine/config.ts`** —
kein Algorithmus-Code enthält inline-Konstanten. `ENGINE_VERSION` bei jeder
Änderung der Vorhersage hochziehen; sie taucht in Layer-Namen und im Label jeder
Map auf.

Die Engine liegt hinter dem Interface `AttentionEngine` (`src/engine/types.ts`).
Ein ML-Modell (ONNX Runtime Web, SALICON) lässt sich später als zweite
Implementierung einsetzen, ohne die Pipeline anzufassen.

---

## Verifizierte API-Grenzen

`figma.createImage()`: **maximal 4096 px** pro Kante, sonst
`Error: Image is too large`
([Doku](https://developers.figma.com/docs/plugins/api/properties/figma-createimage)).

Konsequenz in `src/figma/export.ts` und `src/ui/pipeline.ts`:

| Frame | Export-Constraint | Hinweis im UI |
|---|---|---|
| längere Kante × 2 ≤ 4096 | `SCALE 2` | — |
| längere Kante ≤ 4096, ×2 zu groß | `SCALE 1` | „Export auf 1× reduziert" |
| längere Kante > 4096 (z. B. 4000 × 8000) | `WIDTH`/`HEIGHT` = 4096 | „wird auf 4096 px herunterskaliert" |

Das ausgegebene Bild wird dabei auf ein Rechteck in **Originalgröße des Frames**
gelegt (`scaleMode: "FILL"`), die Map deckt sich also weiterhin exakt mit dem
Screen.

---

## Performance

Analyse läuft grundsätzlich auf einem herunterskalierten Raster (längere Kante
512 px), nie auf Originalauflösung. Gemessen für einen 1440 × 3000-Frame mit 800
Layern (M-Series MacBook, Node 24):

```
Grid 246 × 512   predict 116 ms   clickmap 1 ms
```

Der Rest des 5-Sekunden-Budgets aus NFR-1 entfällt auf PNG-Decode, Compositing
und PNG-Encode — alles Canvas-2D und GPU-beschleunigt. Zwischen den Schritten
wird per `setTimeout(0)` an den Eventloop zurückgegeben, damit das Figma-UI nicht
blockiert (NFR-3).

---

## Tests

```bash
npm test
```

75 Unit-Tests gegen **synthetische** Eingaben mit bekannter Wahrheit — weißes
Bild ⇒ flache Feature-Map, schwarzes Quadrat ⇒ Peak an dessen Position,
Prototype-Hotspot schlägt Namens-Treffer, gleiche Eingabe ⇒ identische Ausgabe.
Echte Screens haben keine bekannte Wahrheit und eignen sich nicht für
Assertions (PRD §12); sie dienen der manuellen Abnahme, siehe
`test-fixtures/README.md`.

---

## Manuelle Abnahme

Figma-Plugins lassen sich nicht automatisiert im Canvas prüfen. Die folgende
Liste deckt die Abnahmekriterien der Milestones M0–M5 ab und ist in der Desktop
App durchzugehen:

| # | Schritt | Erwartung |
|---|---|---|
| 1 | Plugin importieren, öffnen | Panel 320 × 480 erscheint, Empty State „Wähle einen Frame aus.", Button disabled |
| 2 | Frame auswählen | Name + Dimensionen erscheinen, Button aktiv |
| 3 | Selection wechseln, Text-Node auswählen | Panel folgt live; Text-Node ⇒ zurück in den Empty State, kein Absturz |
| 4 | Frame < 200 px auswählen | Warnung „zu klein für eine sinnvolle Analyse", Button disabled |
| 5 | **Maps erstellen** auf einem Referenz-Screen | Ladezustand < 300 ms sichtbar; Wrapper `[FigMaps] … — …` rechts daneben, Viewport springt darauf, `3 Maps erstellt` |
| 6 | Heatmap begutachten | Headlines und primärer CTA erkennbar heiß, leere Flächen kalt, Legende + Fußzeile mit `heuristic-v1` vorhanden |
| 7 | Clickmap begutachten | Ranking im Panel; primärer CTA auf Platz 1 (mind. 2 von 3 Referenz-Screens) |
| 8 | Focus-Schwelle 60 → 95, neu erzeugen | Sichtbare klare Fläche wird monoton kleiner |
| 9 | Overlay-Deckkraft ändern, neu erzeugen | Heatmap-Overlay entsprechend transparenter/kräftiger |
| 10 | Frame ohne benannte Buttons/Reactions | Hinweis „Keine interaktiven Elemente erkannt…", Heat- und Focusmap entstehen trotzdem |
| 11 | 5 Frames auswählen, erzeugen | „Frame 2 von 5", je Frame ein eigener Wrapper |
| 12 | Während des Batches **Abbrechen** | Lauf stoppt, bereits erzeugte Wrapper bleiben, Notify „Abgebrochen" |
| 13 | Plugin schließen und neu öffnen | Slider- und Checkbox-Einstellungen sind erhalten |
| 14 | Frame mit 6000 px Höhe | Hinweis auf Downscale, Maps entstehen, kein Absturz |
| 15 | Zweiter Lauf auf demselben Frame | Neuer Wrapper, der erste bleibt unverändert |

---

## Offene Entscheidungen (PRD §11)

1. ~~**Plugin-Name**~~ — entschieden: `FigMaps`. Das Logo liegt als
   `assets/logo.svg` und wird beim Community-Publishing als Plugin-Icon
   hochgeladen (die `manifest.json` hat kein Icon-Feld).
2. **`positionPrior` für RTL** — implementiert als Schalter
   `ENGINE_CONFIG.prior.mirrorHorizontally` (Default `false` = westliche
   Leserichtung). Noch nicht im UI exponiert, weil die Selection allein die
   Leserichtung nicht verrät.
3. **Flaches Bild vs. Gruppe aus Original + Overlay-Layer** — V1 fügt flache
   Bilder ein. Die Overlay-Variante würde nachträgliche Deckkraft-Anpassung in
   Figma erlauben, verdoppelt aber die eingefügte Bildmenge; Entscheidung offen.
4. **Referenz-Screens** — noch nicht festgelegt, siehe `test-fixtures/README.md`.

## Nicht in V1

Keine Messung echten Nutzerverhaltens, keine Prototype-Flows über mehrere
Screens, keine A/B-Berichte oder Score-Exporte, kein Community-Publishing.
Backlog siehe PRD §9 (Clarity-/Hotjar-Import, Gesichtserkennung, ML-Saliency via
ONNX, Vergleichsmodus, WCAG-Kontrastprüfung).

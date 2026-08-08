<img src="assets/logo.svg" width="72" height="72" alt="FigMaps">

# FigMaps — Figma Plugin

**Version 1.1** — „Messbar und handlungsleitend"

Erzeugt für einen ausgewählten Frame Visualisierungen und legt sie als Bild
rechts neben dem Original auf dem Canvas ab:

- **Heatmap** — vorhergesagte Verteilung visueller Aufmerksamkeit (Turbo-Colormap)
- **Clickmap** — vorhergesagte Klickwahrscheinlichkeit je interaktivem Element, inkl. Ranking
- **Focusmap** — Screen abgedunkelt und unscharf, nur die Top-Regionen bleiben klar
- **Above the Fold** — bei langen Frames zusätzlich der erste Abschnitt allein
- **Befunde** — 3–6 Sätze in Deutsch, im Panel und als Textframe neben den Maps

> Die Ausgabe ist eine **algorithmische Vorhersage**, keine Messung. Es fließen
> keine Daten echten Nutzerverhaltens ein. Jede Map trägt ein Label mit
> Engine-Version und Disclaimer.

Kein Backend, kein Login, keine Netzwerkanfragen — `networkAccess` steht auf
`["none"]`, das Design verlässt die Maschine nicht.

### Was 1.1 hinzufügt

| | |
|---|---|
| **Eval-Harness** | `npm run eval` misst die Engine gegen ein Referenz-Set (AUC-Judd, CC, NSS, KL) und immer gegen Center-Bias, Uniform und die eingefrorene 1.0-Konfiguration. Ohne diese Zahl ist jede weitere Arbeit an der Engine Glaubenssache. |
| **Abschnittsweise Analyse** | Frames über 1,5 Viewport-Höhen werden in überlappende Abschnitte geschnitten und einzeln analysiert. Saliency ist relativ zum sichtbaren Ausschnitt, nicht zum Gesamtdokument. |
| **Befunde** | Ein deterministisches Regelwerk formuliert, was gemessen wurde — mit „Im Canvas zeigen" auf die betroffene Ebene. |
| **Betrachtungsdauer** | Drei Profile (`glance` 1 s, `scan` 3 s, `read` 7 s). Ausgeliefert wird nur, was der Harness belegt hat; aktuell ist das `scan`. |

**Aktueller Stand:** gemessen gegen UEyes, getrennt für Webpage und Mobile UI.
FigMaps 1.0 schlägt den Center-Bias deutlich, verliert aber gegen die Mean Map —
**S-2 ist nicht erfüllt**. Siehe [Messungen](#messungen-ueyes-3s).

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

Eval-Harness (läuft offline in Node, nicht im Plugin):

```bash
# Referenz-Daten importieren — Pfad als Parameter, nie im Code
npm run eval:fixtures -- --ueyes /pfad/zum/UEyes_dataset
# alternativ: UEYES_DIR=/pfad/zum/UEyes_dataset npm run eval:fixtures -- --ueyes

npm run eval -- --fixtures ueyes-web --set test --duration 3 --report out/eval.md
npm run eval -- --help
```

Die `id` in `manifest.json` ist ein lokaler Platzhalter. Beim Publishing in die
Community vergibt Figma eine echte ID, die dann eingetragen wird.

---

## Bedienung

1. Frame, Component, Instance, Section oder Group auswählen (Mehrfachauswahl = Batch)
2. Maps an-/abwählen, Overlay-Deckkraft, Focus-Schwelle und ggf. Viewport-Höhe einstellen
3. **Maps erstellen** — Ergebnis landet in einem neuen Wrapper-Frame
   `[FigMaps] {Frame-Name} — {Zeitstempel}` rechts daneben
4. Befunde unter dem Ergebnis lesen; **Im Canvas zeigen** springt auf die
   betroffene Ebene und wählt sie aus

Wiederholte Läufe erzeugen immer einen **neuen** Wrapper und überschreiben nichts.
Frames mit einer Kante unter 200 px werden abgelehnt.

### Lange Frames (Epic B)

Die Viewport-Höhe wird aus der Frame-Breite abgeleitet: ab 1.024 px gilt Desktop
mit 900 px, darunter Mobile mit `Breite × 2`. Der Slider **Viewport-Höhe**
überschreibt das.

- Frames **unter 1,5 Viewport-Höhen** werden unverändert als Ganzes analysiert.
- Darüber wird in Abschnitte à eine Viewport-Höhe geschnitten, mit **20 %
  Überlappung**, damit Elemente an Schnittkanten nicht zerteilt werden. Jeder
  Abschnitt wird eigenständig analysiert und danach linear überblendet
  zusammengesetzt.
- Zusätzlich entsteht eine **Above-the-fold-Map** aus dem ersten Abschnitt.
- Fold-Linien werden gestrichelt mit Label „Fold 1", „Fold 2" in jede Map
  gezeichnet.

Abschnitte laufen sequenziell; der Fortschritt zeigt „Abschnitt 3 von 7".

---

## Architektur

Zwei Realms, strikt getrennt (PRD §6.3) — die häufigste Fehlerquelle in
Figma-Plugins:

Seit 1.1 sind es **drei** Realms, weil der Eval-Harness in Node läuft:

| | Main Thread (`src/main.ts`, `src/figma/`) | iframe (`src/ui.tsx`, `src/render/`) | Node (`eval/`) |
|---|---|---|---|
| **darf** | `figma.*`, `exportAsync`, Scene Graph, `clientStorage` | DOM, Canvas 2D, `createImageBitmap` | `node:fs`, `node:zlib` |
| **darf nicht** | `document`, `canvas`, `Image`, `fetch`, Node-Builtins | `figma.*`, Node-Builtins | `figma.*`, DOM |

`src/engine/` gehört **keinem** Realm: es kennt weder Canvas noch `figma` noch
Node und läuft in allen dreien.

`npm run build` prüft das am gebauten Bundle und bricht ab, wenn eine Seite in
die andere greift (`assertRealmSeparation` in `scripts/build.mjs`) — inklusive
versehentlich mitgebundelter Node-Builtins.

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
├─ engine/                 plattformfrei — läuft im iframe und in Node
│  ├─ config.ts            ENGINE_CONFIG — jede Konstante des Systems
│  ├─ params.ts            A-6  benannte Konfigurationen + Profile (Epic D)
│  ├─ tuned.ts             generiert von `npm run tune`, nicht von Hand ändern
│  ├─ types.ts             AttentionEngine-Interface
│  ├─ ops.ts               A-1  Bitmap + ImageOps-Port
│  ├─ ops-pure.ts          A-1  geteilter Resampler, Crop, Blur
│  ├─ analyze.ts           gemeinsamer Einstieg für Plugin und Harness
│  ├─ segments.ts          B-1/B-2  Viewport-Ableitung, Schnitt, Überblendung
│  ├─ heuristic.ts         FR-4  Gewichtete Summe + Nachverarbeitung
│  ├─ imageops.ts          Blur, Sobel, DoG, Perzentil-Clipping, Rasterisierung
│  ├─ features/            luminance · color · edges · structure · prior
│  ├─ clickmap.ts          FR-5  Kandidaten + Scoring
│  └─ __tests__/           synthetische Eingaben mit bekannter Wahrheit
├─ platform/               die einzigen plattformabhängigen Bausteine
│  ├─ imageops-canvas.ts   A-1  ImageOps für den iframe
│  ├─ imageops-node.ts     A-1  ImageOps für Node
│  └─ png.ts               A-1  abhängigkeitsfreier PNG-Codec
├─ findings/
│  ├─ rules.ts             C-1  sechs deterministische Regeln
│  ├─ types.ts             C-1  Finding, Severity
│  └─ __tests__/           je Regel ein Test + die Sprachregeln aus C-2
├─ render/
│  ├─ canvas.ts            Decode/Encode
│  ├─ colormap.ts          Turbo-Stops
│  ├─ heatmap.ts           FR-7
│  ├─ clickmap.ts          FR-5 Rendering
│  ├─ focusmap.ts          FR-6
│  ├─ folds.ts             B-2  gestrichelte Fold-Marker
│  └─ legend.ts            Legende + Disclaimer-Fußzeile
└─ ui/
   ├─ pipeline.ts          iframe-Pipeline: PNG rein, Map-PNGs raus
   ├─ logo.tsx             FigMaps-Wortmarke als Inline-SVG
   └─ styles.css

eval/                      Epic A — läuft offline in Node
├─ cli.ts                  A-5/A-6/A-7  eval, tune, Regressions-Gate
├─ fixtures-cli.ts         A-2  Fixtures vorbereiten / synthetisches Set
├─ dataset.ts              A-2  Splits laden, auf das Analyse-Raster bringen
├─ metrics/                A-3  AUC-Judd · CC · NSS · KL (+ Unit-Tests)
├─ predictors.ts           A-4  Center-Bias · Uniform · 1.0 · getunte Configs
├─ runner.ts               A-5  Lauf über alle Bilder und Engines
├─ report.ts               A-5  Markdown-Report
├─ contact-sheet.ts        A-5  Triptychon der zwölf schlechtesten Fälle
├─ tune.ts                 A-6  Random Search
└─ fixtures/               nicht im Repo — siehe fixtures/README.md

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

---

## Eval-Harness (Epic A)

Der Kern von 1.1. Ohne ihn lässt sich nicht unterscheiden, ob eine Änderung an
der Engine hilft oder schadet.

```bash
npm run eval -- --engine heuristic --set test --report out/eval-2026-08.md
```

Ausgabe: eine Markdown-Tabelle (Engine × Metrik) plus ein Kontaktbogen mit den
zwölf schlechtesten Fällen als `Original | Ground Truth | Vorhersage`. Die
visuelle Fehleranalyse ist wertvoller als die Zahl allein — dort sieht man,
*welche* Art von Screen die Engine nicht versteht.

### Metriken (A-3)

| Metrik | Bedeutung | Ground Truth | Richtung |
|---|---|---|---|
| AUC-Judd | Trennschärfe Fixation vs. Nicht-Fixation | Fixationskarte (diskret) | höher besser |
| CC | Pearson-Korrelation der Maps | Heatmap (kontinuierlich) | höher besser |
| NSS | Normalisierte Saliency an Fixationspunkten | Fixationskarte (diskret) | höher besser |
| KL | Divergenz der Verteilungen | Heatmap (kontinuierlich) | niedriger besser |

**Die beiden Ground-Truth-Kanäle werden nicht vermischt.** AUC-Judd und NSS
brauchen Punkte, CC und KL eine Verteilung. Fixationen aus der Heatmap
abzuleiten würde beide Seiten aus derselben Quelle speisen und die Zahlen still
beschönigen; wo das mangels Fixationskarten nötig ist, markiert der Loader es
als `derived-from-heatmap` und der Report sagt es.

Vorhersage und Ground Truth kommen vor jedem Vergleich auf **das Analyse-Raster
der Engine** (längere Kante 512 px, Seitenverhältnis erhalten). Die Vorhersage
wird nie hochskaliert. Die Fixationskarte wird dabei max-gepoolt, nie gemittelt.

Jede Metrik hat einen Unit-Test gegen einen handgerechneten 5×5-Fall mit drei
Fixationen — inklusive der Fälle, in denen ein plausibel aussehender Mittelwert
über ein echtes Set eine falsche Implementierung verdecken würde.

### Baselines (A-4)

Laufen immer mit:

1. **Center-Bias** — nur eine Gaußglocke in der Bildmitte, keine Bildanalyse.
   Der wichtigste Vergleich der Iteration: schlagen die sieben Feature-Maps das
   nicht deutlich, tun sie nichts. Der Report sagt das in Worten, vor der
   ersten Tabelle.
   Damit dieser Vergleich nicht an einer bequemen Wahl hängt, läuft die
   Baseline über mehrere Breiten (σ 0,15 – 0,8) und das Urteil wird gegen den
   **besten** Center-Bias je Metrik gefällt.
2. **Mean Map** — der Durchschnitt der Ground Truth über den **Tuning**-Split,
   angewandt auf jedes Testbild, ohne das Bild anzusehen. Die übliche
   Vergleichsbasis der Saliency-Literatur und deutlich stärker als eine
   Gaußglocke: sie kennt die tatsächliche räumliche Verteilung des Datensatzes.
   Alles, was sie erklärt, ist Wissen über das *Genre*, nicht über den
   konkreten Screen. Berechnet in normierten Koordinaten und ausschließlich auf
   dem Tuning-Split — sonst enthielte sie die Antwort, gegen die sie antritt.
3. **Uniform** — konstante Map. Untergrenze und Sanity-Check der Metriken: muss
   exakt AUC 0,5 / CC 0 / NSS 0 liefern. Tut sie das auf echten Daten nicht,
   bricht `npm run eval` ab und schreibt keinen Report — dann stimmt der
   Import, nicht die Engine.
4. **FigMaps 1.0** — die ausgelieferte Konfiguration, eingefroren.

Der Report vergleicht gegen die **stärkste** dieser Baselines je Metrik und
weist zusätzlich aus, in wie vielen Einzelbildern die Engine die Mean Map
schlägt — ein Mittelwert allein verbirgt, ob eine Engine überall gleichmäßig
schlechter ist oder nur auf manchen Screens.

### Tuning (A-6)

```bash
npm run tune -- --set tuning --iterations 300
```

Random Search über die Gewichte, Zielmetrik CC auf dem **Tuning**-Split; der
Test-Split ist gesperrt. Das Ergebnis landet als zusätzliche benannte
Konfiguration in `src/engine/tuned.ts`, die alte bleibt erhalten.

**Kein Auto-Deploy.** Ein Mensch sieht sich den Kontaktbogen an und setzt danach
`ENGINE_CONFIG.activeConfigId` von Hand.

### Regressions-Gate (A-7)

`.github/workflows/eval-gate.yml` misst bei jedem PR ein 40-Bild-Schnellset und
schlägt fehl, wenn CC gegenüber `main` um mehr als 0,02 fällt. Der Job
überspringt sich selbst, solange kein Referenz-Set im Cache liegt.

### Referenz-Daten (A-2)

Fixtures liegen **nicht** im Repo (Größe + Lizenz), `.gitignore` deckt
`eval/fixtures/*` ab. Struktur, Import und Schwellen:
**[`eval/fixtures/README.md`](eval/fixtures/README.md)**.

Importiert ist die **Webpage-Teilmenge von UEyes** (CC BY 4.0), 468 Bilder
`tuning` / 27 Bilder `test` — die Aufteilung stammt aus dem Datensatz, nicht von
uns. Ground Truth für 1 s, 3 s und 7 s; ausgewertet wird bislang nur 3 s.

Für einen Rauchtest des Harness ohne Datensatz gibt es zusätzlich ein
synthetisches Set. Es prüft den **Harness**, nicht die Engine — die Ground Truth
ist konstruiert, Zahlen daraus belegen weder S-2 noch S-3 und werden nicht mit
UEyes-Läufen gemischt.

---

## Messungen (UEyes, 3 s)

Jede UI-Kategorie ist ein **eigenes Set** und wird **getrennt** berichtet. UEyes'
zentraler Befund ist, dass Positions- und Blickrichtungs-Bias sich zwischen
UI-Typen unterscheiden; ein Mittelwert über Typen würde genau das verwischen.

```bash
npm run eval:fixtures -- --ueyes <pfad> --category web
npm run eval:fixtures -- --ueyes <pfad> --category mobile

npm run eval -- --fixtures ueyes-web    --set test --duration 3
npm run eval -- --fixtures ueyes-mobile --set test --duration 3
```

Je 27 Bilder (Test-Split des Datensatzes), Betrachtungsdauer 3 s:

**Webpage**

| Engine | AUC-Judd ↑ | CC ↑ | NSS ↑ | KL ↓ |
|---|---:|---:|---:|---:|
| **Mean Map** (Ø GT, 468 Tuning-Bilder) | **0,787** | **0,450** | **1,116** | **1,111** |
| FigMaps 1.0 | 0,718 | 0,298 | 0,760 | 1,401 |
| Center-Bias (bester σ je Metrik) | 0,592 | 0,119 | 0,324 | 1,624 |
| Uniform | 0,500 | 0,000 | 0,000 | 1,673 |

**Mobile UI**

| Engine | AUC-Judd ↑ | CC ↑ | NSS ↑ | KL ↓ |
|---|---:|---:|---:|---:|
| **Mean Map** (Ø GT, 468 Tuning-Bilder) | **0,782** | **0,518** | **1,096** | **0,833** |
| FigMaps 1.0 | 0,746 | 0,404 | 0,900 | 1,059 |
| Center-Bias (bester σ je Metrik) | 0,545 | 0,090 | 0,157 | 1,456 |
| Uniform | 0,500 | 0,000 | 0,000 | 1,349 |

### Befund: S-2 ist nicht erfüllt

FigMaps 1.0 schlägt den Center-Bias **deutlich** — in beiden Kategorien, in
allen vier Metriken, auch gegen dessen beste Breite. Gegen die **Mean Map**
verliert die Engine jedoch ebenso deutlich, ebenfalls in beiden Kategorien und
allen vier Metriken.

Die Mean Map ist der Durchschnitt der Ground Truth über den Tuning-Split,
angewandt auf jedes Testbild, **ohne das Bild je anzusehen**. Sie ist die
übliche Vergleichsbasis der Saliency-Literatur und die aussagekräftigere
Referenz: alles, was sie schon erklärt, ist Wissen darüber, *wo auf dieser Art
von Screen üblicherweise Dinge stehen* — nicht darüber, was in diesem konkreten
Screen passiert.

Pro Bild betrachtet gewinnt die Engine gegen die Mean Map in **5–7 von 27**
Fällen (beide Kategorien, je nach Metrik). Es ist also nicht so, dass gar keine
bildspezifische Information enthalten wäre — aber auf rund vier Fünfteln der
Screens ist der generische Durchschnitt die bessere Vorhersage.

**Konsequenz laut PRD §8:** Die Heuristik trägt in ihrer jetzigen Form zu wenig
eigene Information. Sie weiter von Hand zu justieren lohnt weniger als der
Schritt auf ein trainiertes Modell (Iteration 1.2) — und dieser Schritt ist mit
dem Harness jetzt belegbar statt Glaubenssache.

Der Sanity-Check ist in beiden Läufen sauber: Uniform liefert auf echten Daten
exakt AUC 0,5 / CC 0 / NSS 0.

### Positions-Bias — der Unterschied zwischen den UI-Typen

Schwerpunkt der Aufmerksamkeit in normierten Koordinaten, (0,0) = oben links:

| | Schwerpunkt x | Schwerpunkt y | Masse im oberen Drittel |
|---|---:|---:|---:|
| Ground Truth Webpage | 0,380 | 0,301 | 64,2 % |
| Ground Truth Mobile UI | 0,346 | 0,297 | 61,9 % |
| Vorhersage Webpage | 0,476 | 0,482 | 33,8 % |
| Vorhersage Mobile UI | 0,461 | 0,455 | 38,9 % |
| Positions-Prior der Engine | 0,350 | 0,280 | — |
| Center-Bias | 0,500 | 0,500 | 21,5 % |

Zwei Dinge fallen auf:

1. **Der gemessene Bias der beiden UI-Typen liegt nah beieinander** — Mobile ist
   etwas weiter links (0,346 vs 0,380), vertikal praktisch identisch. Der große
   Unterschied liegt nicht zwischen den Typen, sondern zwischen Ground Truth und
   unserer Vorhersage.
2. **Der Positions-Prior der Engine trifft die Realität gut** (0,35 / 0,28 gegen
   gemessene 0,35–0,38 / 0,30) — aber die fertige Vorhersage landet bei
   0,46–0,48 / 0,46–0,48, also fast in der Bildmitte. Die Pixel-Features ziehen
   den guten Prior in die Mitte zurück.

Das erklärt den Befund oben: die Mean Map ist im Kern genau dieser
Positions-Prior, sauber aus Daten geschätzt — und unsere Feature-Maps
verschlechtern ihn, statt ihn zu ergänzen.

### Was der Kontaktbogen zeigt

Die visuelle Fehleranalyse passt dazu: die Ground Truth besteht aus **wenigen,
eng begrenzten Hotspots** (Logo, Headline, Gesichter, oben links), unsere
Vorhersage ist **flächig** und färbt fast die ganze Seite warm ein. Auf dichten
Screens findet die Heuristik überall Kontrast und Kanten und verteilt
Aufmerksamkeit entsprechend breit — die gemessene Aufmerksamkeit ist vertikal um
Faktor 1,5 enger konzentriert als die vorhergesagte.

Der Engpass ist **Selektivität**, nicht Position.

### Zwei Vorbehalte, die zum Ergebnis gehören

1. **Teilmessung.** Ein Screenshot bringt keinen Layer-Baum mit, deshalb sind
   `textSalience`, `interactiveSalience` und `imageSalience` auf diesem
   Datensatz konstant null. Das sind **40 % der Engine-Gewichtung**, die hier
   nicht bewertet sind. Ob die Struktur-Signale tragen, ist mit UEyes
   grundsätzlich nicht beantwortbar — dafür braucht es das eigene Set aus
   First-Click-Tests. Der Befund gilt für die Pixel-Hälfte der Engine.
2. **Kleiner Test-Split.** Je 27 Bilder sind wenig. Der Befund fällt aber in
   zwei unabhängigen Kategorien identisch aus und mit deutlichem Abstand, nicht
   knapp. Ein Kontrolllauf auf dem Train-Split (468 Bilder) bestätigt die
   Größenordnung ebenfalls.

---

## Befunde (Epic C)

Nach der Berechnung läuft ein Satz deterministischer Regeln über Heatmap,
Clickmap und Node-Signale. Jede Regel liefert höchstens ein Finding; sortiert
wird nach Severity, angezeigt werden maximal sechs.

| ID | Auslöser |
|---|---|
| `cta-rank` | Primärer Kandidat der Clickmap nicht auf Rang 1 |
| `cta-below-fold` | Höchstbewerteter Kandidat unterhalb Fold 1 |
| `competition` | Zwei Regionen über 80 % Intensität, weit auseinander, mit Tal dazwischen |
| `cold-fold` | Above-the-fold-Abschnitt hat niedrigere Spitzenintensität als ein späterer |
| `flat` | Differenz zwischen 90. und 50. Perzentil unter Schwellwert |
| `dead-cta` | Interaktives Element im untersten Aufmerksamkeitsquartil |

Sprachregeln (C-2), von den Tests erzwungen:

- Beschreiben, was gemessen wurde — nicht vorschreiben, was zu tun ist
- Immer im Modus der Vorhersage („vorhergesagt"), nie „Nutzer sehen"
- Höchstens eine Dezimalstelle bei Prozentangaben
- Kein Ausrufezeichen, keine Warn-Emoji, **kein Gesamtscore** — ein Score von
  0–100 würde die Unsicherheit des Modells verstecken und zum Optimierungsziel
  werden

---

## Betrachtungsdauer (Epic D)

Drei Profile in `src/engine/params.ts`: `glance` (1 s), `scan` (3 s), `read`
(7 s). Startwerte sind eine **Hypothese** — kurze Dauer stärker von
Positions-Prior und Roh-Kontrast dominiert, lange Dauer stärker von Text- und
Interaktions-Signalen — die der Harness prüfen und ersetzen soll.

Ein Profil wird erst ausgeliefert, wenn es die Center-Bias-Baseline schlägt
(Flag `shipped` in `params.ts` bzw. `tuned.ts`). Aktuell erfüllt das nur `scan`
— das ist die 1.0-Konfiguration —, deshalb zeigt das Panel **keinen** Umschalter.
Drei Profile anzubieten, von denen eines Rauschen ist, ist schlechter als eines
anzubieten.

---

## Engine tunen von Hand

Alle Gewichte, Sigmas und Schwellwerte stehen in **`src/engine/config.ts`** —
kein Algorithmus-Code enthält inline-Konstanten. `ENGINE_VERSION` bei jeder
Änderung der Vorhersage hochziehen; sie taucht in Layer-Namen und im Label jeder
Map auf.

Die Engine liegt hinter dem Interface `AttentionEngine` (`src/engine/types.ts`)
und arbeitet ausschließlich auf `Float32Array` und `Bitmap`. Alles
Plattformabhängige (PNG-Decode, Skalierung, Blur) liegt hinter `ImageOps`
(`src/engine/ops.ts`). Ein ML-Modell (ONNX Runtime Web) lässt sich als zweite
Implementierung einsetzen, ohne die Pipeline anzufassen — und wäre dann sofort
mit `npm run eval` vergleichbar.

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

152 Unit-Tests gegen **synthetische** Eingaben mit bekannter Wahrheit — weißes
Bild ⇒ flache Feature-Map, schwarzes Quadrat ⇒ Peak an dessen Position,
Prototype-Hotspot schlägt Namens-Treffer, gleiche Eingabe ⇒ identische Ausgabe.
Echte Screens haben keine bekannte Wahrheit und eignen sich nicht für
Assertions (PRD §12); sie dienen der manuellen Abnahme, siehe
`test-fixtures/README.md`.

Die für 1.1 tragenden Gruppen:

| Datei | prüft |
|---|---|
| `src/engine/__tests__/parity.test.ts` | A-1 — beide Realms teilen sich einen Resampler und einen Blur; die Vorhersagen weichen um ≤ 1e-4 ab; PNG-Roundtrip verlustfrei |
| `src/engine/__tests__/segments.test.ts` | B-1/B-2 — Schnittgeometrie, 20 % Überlappung, konstantes Feld bleibt nach der Überblendung konstant (keine Naht) |
| `src/engine/__tests__/analyze.test.ts` | M4 — Abschnitte, Above-the-fold-Map, Viewport-Override, Abbruch, keine leeren Zeilen im Komposit |
| `eval/metrics/__tests__/metrics.test.ts` | A-3 — jede Metrik gegen einen handgerechneten 5×5-Fall |
| `src/findings/__tests__/rules.test.ts` | C-1 — je Regel Auslöser *und* Nicht-Auslöser; C-2 — die Sprachregeln maschinell erzwungen |
| `src/engine/__tests__/params.test.ts` | Epic D — Profile normalisiert, `scan` identisch zu 1.0, nur Belegtes wird ausgeliefert |

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

Zusätzlich für 1.1 (M4, M5):

| # | Schritt | Erwartung |
|---|---|---|
| 16 | Frame 1440 × 4000 erzeugen | Fortschritt zeigt „Abschnitt 3 von 6"; Wrapper enthält zusätzlich eine **Above the Fold**-Map über nur 900 px |
| 17 | Heatmap des langen Frames im Überlappungsbereich prüfen | Keine sichtbare Naht, kein dunkles Band an den Schnittkanten |
| 18 | Fold-Linien prüfen | Gestrichelte Linien mit „Fold 1", „Fold 2" auf allen drei Maps, auf hellem und dunklem Untergrund lesbar |
| 19 | Viewport-Höhe auf 600 px stellen, neu erzeugen | Mehr Abschnitte, Fold-Linien rücken zusammen; „zurücksetzen" stellt die Automatik wieder her |
| 20 | Befunde-Liste im Panel | 3–6 Sätze, nach Severity sortiert, kein Ausrufezeichen, kein Score |
| 21 | **Im Canvas zeigen** auf einem Finding | Viewport springt auf die Ebene, Ebene ist ausgewählt |
| 22 | Textframe „Befunde" im Wrapper | Enthält dieselben Sätze plus Disclaimer, Zeilenumbruch passt in 520 px |
| 23 | Frame ohne Auffälligkeiten | Leere Befundliste ist zulässig — es wird nichts erfunden, um die Liste zu füllen |

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

---

## Stand der 1.1-Milestones

| ID | Inhalt | Stand |
|---|---|---|
| M1 | A-1 Engine-Entkopplung | **fertig** — Engine kennt nur `Bitmap`/`Float32Array`, `ImageOps` mit Canvas- und Node-Implementierung, Parity-Test grün |
| M2 | A-2 bis A-5 Harness | **fertig** — UEyes importiert (Webpage + Mobile UI), `npm run eval` liefert Report und Kontaktbogen, die Zahl für 1.0 liegt auf dem Tisch: **S-2 nicht erfüllt** |
| M3 | A-6, A-7 Tuning | **Code fertig, Abnahme offen** — `npm run tune` und das Gate stehen; `heuristic-v2` ist noch nicht erzeugt und nach dem S-2-Befund auch nicht die naheliegende nächste Maßnahme |
| M4 | Epic B | **fertig** |
| M5 | Epic C | **fertig bis auf die Textabnahme** — sechs Regeln implementiert und getestet, Formulierungen sind noch von einem Menschen freizugeben (C-1) |
| M6 | Epic D | **Code fertig, Beleg offen** — drei Profile existieren und sind evaluierbar; ausgeliefert wird bis zum Beleg nur `scan` |

### Stand der Erfolgskriterien

- **S-1** (ein Befehl liefert AUC/CC/NSS) — **erfüllt.** Reproduzierbar,
  versioniert, Referenz-Set und Metrik-Zuordnung im Report dokumentiert.
- **S-2** (Engine schlägt die Baseline) — **nicht erfüllt.** Center-Bias ja,
  Mean Map nein, in beiden UI-Kategorien. Siehe
  [Messungen](#messungen-ueyes-3s). Laut PRD §8 ist genau das ein zulässiges
  und wertvolles Iterationsergebnis: „Unangenehm, aber deutlich billiger als es
  nicht zu wissen."
- **S-3** (+0,04 AUC nach Tuning) — **offen.** In dieser Iteration wurde nicht
  getunt, `src/engine/tuned.ts` ist leer. Angesichts des S-2-Befunds ist Tuning
  der Gewichte auch nicht der naheliegende nächste Schritt.
- **S-4** (abschnittsweise Analyse) — erfüllt, siehe Epic B.
- **S-5** (3–6 Befunde in verständlichem Deutsch) — erfüllt bis auf die
  Textabnahme durch einen Menschen.

### Offen

1. **Entscheidung zum S-2-Befund.** Die Optionen stehen im PRD §8: trainiertes
   Modell in 1.2 (ONNX Runtime Web im iframe; UMSI auf UEyes nachtrainiert
   erreicht laut Literatur 0,878 AUC gegen 0,778 ohne UI-Training) oder die
   Heuristik gezielt auf Selektivität umbauen. Beides ist jetzt messbar.
2. **Eigenes Validierungsset** aus First-Click-Tests. Der einzige Weg,
   `textSalience`, `interactiveSalience` und `imageSalience` überhaupt zu
   bewerten — auf Screenshots sind sie konstant null. Ohne das bleibt jede
   Messung eine Teilmessung über 60 % der Gewichtung.
3. **Textabnahme der Findings (M5)** — C-1 verlangt ausdrücklich, dass keine
   Regel feuert, deren Text nicht von einem Menschen bestätigt wurde.
4. **Epic D belegen** — 1 s und 7 s sind importiert, aber noch nicht ausgewertet.
5. **Desktop und Poster** sind importierbar (`--category desktop|poster`), aber
   für FigMaps nicht die relevanten UI-Typen.

## Nicht in 1.1

Bewusst ausgelassen, obwohl fachlich attraktiv (PRD §2):

- **Kein ML-Modell** (ONNX / UMSI) — ohne Eval-Harness nicht beweisbar besser.
  Das ist 1.2.
- **Keine Gesichtserkennung** — gleicher Grund.
- **Kein Import echter Analytics-Daten.**
- **Keine Scanpath-Animation** — sieht spektakulär aus, ist deutlich schwerer
  vorherzusagen als eine Saliency-Map und ändert keine Design-Entscheidung.

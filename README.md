<img src="assets/logo.svg" width="72" height="72" alt="Figmaps">

# Figmaps — Figma Plugin

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

> **Namensnennung:** Das Plugin liefert einen Ortsprior mit, der aus dem
> UEyes-Datensatz abgeleitet ist (Jiang et al., CHI 2023), lizenziert unter
> CC BY 4.0. Details und die Stellen, an denen die Nennung stehen muss:
> **[`NOTICE.md`](NOTICE.md)**.

### Was 1.1 hinzufügt

| | |
|---|---|
| **Eval-Harness** | `npm run eval` misst die Engine gegen ein Referenz-Set (AUC-Judd, CC, NSS, KL) und immer gegen Center-Bias, Uniform und die eingefrorene 1.0-Konfiguration. Ohne diese Zahl ist jede weitere Arbeit an der Engine Glaubenssache. |
| **Abschnittsweise Analyse** | Frames über 1,5 Viewport-Höhen werden in überlappende Abschnitte geschnitten und einzeln analysiert. Saliency ist relativ zum sichtbaren Ausschnitt, nicht zum Gesamtdokument. |
| **Befunde** | Ein deterministisches Regelwerk formuliert, was gemessen wurde — mit „Im Canvas zeigen" auf die betroffene Ebene. |
| **Betrachtungsdauer** | Drei Profile (`glance` 1 s, `scan` 3 s, `read` 7 s), **gemessen belegt**: sie tauschen den Ortsprior, nicht die Gewichte. |

**Aktueller Stand:** gemessen gegen UEyes, getrennt für Webpage und Mobile UI.
`hybrid-v1` — datengeschätzter Ortsprior plus additive Bildanalyse — schlägt in
einer 5-fachen Kreuzvalidierung über je 495 Bilder **jede bildunabhängige
Baseline in allen vier Metriken**, in beiden Kategorien. **S-2 ist erfüllt.**
Siehe [Kreuzvalidierung](#kreuzvalidierung-495-bilder-je-kategorie).

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
   `[Figmaps] {Frame-Name} — {Zeitstempel}` rechts daneben
4. Befunde unter dem Ergebnis lesen; **Im Canvas zeigen** springt auf die
   betroffene Ebene und wählt sie aus

Wiederholte Läufe erzeugen immer einen **neuen** Wrapper und überschreiben nichts.
Frames mit einer Kante unter 200 px werden abgelehnt.

Das Panel öffnet 320 × 680 und lässt sich am **Griff unten rechts** ziehen —
320–720 px breit, 420–2400 px hoch. Doppelklick auf den Griff stellt die
Ausgangsgröße wieder her, Pfeiltasten verstellen sie bei Tastaturfokus in
24-px-Schritten. Die zuletzt eingestellte Größe wird in `clientStorage`
gemerkt und beim nächsten Öffnen wiederhergestellt.

Die **Export-Skalierung ist fest auf 2×** — die Engine ist bei dieser
Abtastdichte gemessen, und 1× verliert genau die Kanten- und Textdetails, aus
denen die Merkmale bestehen. Nur die technischen Grenzen unten schalten
automatisch herunter.

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
│  ├─ deviation.ts         Abweichungs-Score (gemessen, nicht ausgeliefert)
│  ├─ priors/              datengeschätzter Ortsprior für hybrid-v1
│  │  ├─ index.ts          Decoder + Resampling, CC-BY-Attribution
│  │  └─ generated.ts      generiert von `npm run build-prior`
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
│  ├─ rules.ts             C-1  sechs Regeln, davon fünf ausgeliefert
│  ├─ label.ts             C-1  Benennung: Textinhalt vor Layername, Lageangabe
│  ├─ derive.ts            C-1  der eine Pfad von der Analyse zu den Befunden
│  ├─ types.ts             C-1  Finding, Severity
│  └─ __tests__/           je Regel ein Test + die Sprachregeln aus C-2
├─ render/
│  ├─ canvas.ts            Decode/Encode
│  ├─ colormap.ts          Turbo-Stops
│  ├─ heatmap.ts           FR-7
│  ├─ clickmap.ts          FR-5 Rendering
│  ├─ focusmap.ts          FR-6
│  ├─ folds.ts             B-2  gestrichelte Fold-Marker
│  └─ legend.ts            Legende + zweizeilige Fußzeile (Prior, Dauer, CC BY)
└─ ui/
   ├─ pipeline.ts          iframe-Pipeline: PNG rein, Map-PNGs raus
   ├─ logo.tsx             Figmaps-Wortmarke als Inline-SVG
   └─ styles.css

eval/                      Epic A — läuft offline in Node
├─ cli.ts                  A-5/A-6/A-7  eval, tune, diagnose, crossval, Gate
├─ crossval.ts             k-fache Kreuzvalidierung, Prior je Fold neu geschätzt
├─ fixtures-cli.ts         A-2  Fixtures vorbereiten / synthetisches Set
├─ dataset.ts              A-2  Splits laden, auf das Analyse-Raster bringen
├─ metrics/                A-3  AUC-Judd · CC · NSS · KL (+ Unit-Tests)
├─ predictors.ts           A-4  Center-Bias · Uniform · 1.0 · getunte Configs
├─ runner.ts               A-5  Lauf über alle Bilder und Engines
├─ report.ts               A-5  Markdown-Report
├─ contact-sheet.ts        A-5  Triptychon der zwölf schlechtesten Fälle
├─ tune.ts                 A-6  Random Search
├─ findings-audit.ts       C-1  Feuerraten, Verteilungen, Lage der Schwelle
├─ constructed.ts          C-1  Frames mit Layer-Baum — ohne die drei Regeln
│                               mit Klick-Kandidaten unmessbar sind
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
4. **Figmaps 1.0** — die ausgelieferte Konfiguration, eingefroren.

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
| Figmaps 1.0 | 0,718 | 0,298 | 0,760 | 1,401 |
| Center-Bias (bester σ je Metrik) | 0,592 | 0,119 | 0,324 | 1,624 |
| Uniform | 0,500 | 0,000 | 0,000 | 1,673 |

**Mobile UI**

| Engine | AUC-Judd ↑ | CC ↑ | NSS ↑ | KL ↓ |
|---|---:|---:|---:|---:|
| **Mean Map** (Ø GT, 468 Tuning-Bilder) | **0,782** | **0,518** | **1,096** | **0,833** |
| Figmaps 1.0 | 0,746 | 0,404 | 0,900 | 1,059 |
| Center-Bias (bester σ je Metrik) | 0,545 | 0,090 | 0,157 | 1,456 |
| Uniform | 0,500 | 0,000 | 0,000 | 1,349 |

### hybrid-v1 — der datengeschätzte Ortsprior

Aus der [Diagnose](#diagnose-woher-kommt-die-vorhersagekraft) folgte die
Konsequenz: den analytischen F-Pattern-Prior durch einen aus Daten geschätzten
ersetzen und die Bildanalyse additiv darüberlegen. Genau das ist `hybrid-v1`.
`heuristic-v1` bleibt unverändert erhalten.

```
Vorhersage = norm(Ortsprior)  +  0,3 · norm(Bildanalyse)
```

- **Ortsprior:** je eine 32 × 32-Graustufen-Map für Webpage und Mobile UI,
  gemittelt über die 468 Bilder des **Tuning**-Splits. Base64 im Bundle,
  **1,3 kB pro Map** (Budget: 50 kB). Kein PNG-Decoder, kein Asset-Loader, kein
  `atob` — die Figma-Main-Thread-Umgebung garantiert keines davon.
- **Rastergröße:** gemessen, nicht geschätzt. Ein Ortsprior ist glatt; schon
  16 × 16 erreicht denselben CC wie 128 × 128. 32 × 32 ist mit Reserve gewählt.
- **α = 0,3**, nicht 0,5: 0,5 maximiert zwar CC (0,448 statt 0,444), **verliert
  aber KL gegen die Mean Map** — und S-2 verlangt alle vier Metriken. Bei 0,3
  gewinnen auf dem Tuning-Split alle vier, in beiden Kategorien.
- **Kategorie-Wahl:** im Plugin über die Frame-Breite (dieselbe Schwelle wie die
  Viewport-Ableitung). Im Harness wird die Kategorie explizit gesetzt — UEyes
  speichert Handy-Screenshots mit 1080 px Gerätebreite, was die Breitenregel als
  Desktop lesen würde.

`hybrid-v1` ist seit dem 8.8.2026 die **aktive Konfiguration**
(`ENGINE_VERSION`). `heuristic-v1` bleibt vollständig erhalten und ist im
Harness weiterhin die eingefrorene 1.0-Referenz.

#### Vier Prioren, zwei davon automatisch erreichbar

Es gibt einen Ortsprior je UEyes-Kategorie — `web`, `mobile`, `desktop`,
`poster` —, je 32 × 32 und 1,3 kB. Die **automatische** Auswahl liefert aber nur
`web` oder `mobile`, und das ist ein Messergebnis, keine Bequemlichkeit:

| Regel | Trefferquote auf 1.980 gelabelten Bildern | Ø CC |
|---|---:|---:|
| Oracle (Kategorie immer bekannt) | 100 % | 0,4450 |
| **Seitenverhältnis, 2 Kategorien** | **50,0 %** | **0,4304** |
| 4 Kategorien aus Geometrie | 53,1 % | 0,4309 |
| immer `web` (gar keine Regel) | 25,0 % | 0,4268 |
| Breite ≥ 1024 (die Regel bis 8.8.) | 24,0 % | 0,4247 |

Zwei Dinge stehen darin. Erstens war die **alte Breiten-Regel schlechter als
gar keine Regel**. Zweitens bringt die geometrische Vier-Wege-Auflösung
+0,0005 CC gegenüber zwei Kategorien — sie erkennt 11 von 495 Desktop-Bildern
und leitet dafür 64 Webseiten auf den Poster-Prior um. Webseite und
Desktop-Anwendung sind geometrisch nicht unterscheidbar (Median-Seitenverhältnis
0,67 gegen 0,56, Breiten 720–1896 gegen 237–3170), Poster überdecken alles von
0,32 bis 3,25.

Deshalb: `desktop` und `poster` sind **nur über die explizite Auswahl**
„Art des Screens" im Panel erreichbar. Wer den Frame gezeichnet hat, weiß, was
es ist; raten kostet mehr, als es bringt.

Der Preis einer Fehlzuordnung ist begrenzt, aber nicht null — die vier Prioren
korrelieren untereinander mit 0,87 bis 0,97, eine falsche Wahl kostet 0,02 bis
0,05 CC. Das ist in derselben Größenordnung wie der gesamte Gewinn von
`hybrid-v1` gegenüber der Mean Map.

#### Wie der Prior ausgewählt wird

Auflösungskette in `computeFeatures`, in dieser Reihenfolge:

1. `priorProvider(width, height)` — injizierter Callback, nur von der
   Kreuzvalidierung genutzt
2. `priorMap(priorAsset ?? priorAssetIdFor(frameWidth, frameHeight), …)` — das
   gebündelte Asset
3. `positionPrior(…)` — die analytische F-Pattern-Glocke, falls kein Asset da ist

Der ganze Zweig wird nur betreten, wenn `priorSource === 'data'` ist;
`heuristic-v1` nimmt immer den analytischen Weg.

Die Regel braucht **beide** Kriterien, weil jedes für sich einen Alltagsfall
falsch macht:

```ts
mobil  ⇔  Breite < 600 px  UND  Höhe / Breite >= 1,5
```

- **Breite allein** (die Regel bis 8.8.) schickte ein 960 px breites
  Desktop-Layout auf den Mobile-Prior.
- **Seitenverhältnis allein** schickt eine 1440 × 6000-Scrollseite auf den
  Mobile-Prior — sie ist viermal höher als breit.

Der Seitenverhältnis-Teil trennt auf den gelabelten Daten Webseite und Mobile
**fehlerfrei** (je 495/495) bei Schwelle 1,5; Telefone liegen bei 1,78–2,17,
Webseiten bei höchstens 1,11. Der Breiten-Teil ist eine **Design-Pixel**-Regel
und an UEyes nicht überprüfbar, weil der Datensatz Geräte-Pixel speichert.

Vorher / nachher für die fünf Formate aus der Analyse:

| Frame | vorher (Breite ≥ 1024) | nachher | |
|---|---|---|---|
| Webpage Desktop 1440 × 900 | `web` | `web` | |
| Langer Scroll 1440 × 6000 | `web` | `web` | Seitenverhältnis allein hätte hier `mobile` gesagt |
| Poster / Social 1080 × 1080 | `web` | `web` | jetzt explizit auf `poster` stellbar |
| Desktop-App-UI 1280 × 800 | `web` | `web` | jetzt explizit auf `desktop` stellbar |
| **Schmaler Desktop 960 × 600** | **`mobile`** | **`web`** | **Fehlzuordnung behoben** |
| **Tablet 834 × 1194** | **`mobile`** | **`web`** | **geändert** |
| Banner 1920 × 400 | `web` | `web` | |
| Phone 390 × 844 | `mobile` | `mobile` | |

Die 960-px-Fehlzuordnung ist damit weg. Frames, die zu keiner Kategorie passen,
bekommen weiterhin `web` — aber die Auswahl „Art des Screens" im Panel erlaubt
jetzt, es zu sagen.

#### Prior bei segmentierten Frames (Epic B)

`analyzeFrame` übergibt je Abschnitt `frameHeight: section.height`. Der Prior
wird damit **pro Abschnitt neu gebildet** — jeder Abschnitt bekommt seine eigene
top-lastige Glocke, nicht einen Ausschnitt aus einer Glocke über den ganzen
Frame.

Das passt zur Prämisse von Epic B (Saliency ist relativ zum sichtbaren
Ausschnitt) und dazu, wie der Prior geschätzt wurde (aus Einzel-Viewport-
Screenshots). **Es war aber keine Entscheidung, sondern aus 1.0 geerbt**, und
keine Messung deckt es ab: die gesamte Auswertung läuft mit `segment: false`,
und UEyes enthält keine gescrollten Seiten.

Es hat sichtbare Kosten. Auf einem inhaltsfreien grauen 1440 × 4000-Frame zeigt
die zusammengesetzte Map ein Band am Kopf **jedes** Abschnitts, im Abstand von
720 px (ein Abschnittsschritt), mit einem Zeilenprofil von 0,50 bis 0,08.
`heuristic-v1` zeigt dieselbe Periodizität deutlich schwächer (0,77 bis 0,39),
weil der Prior dort ein gewichteter Term von sieben mit Gewicht 0,1 war — in
`hybrid-v1` ist er die Basis der Vorhersage.

**Behoben am 8.8.2026** durch eine Dämpfung mit der Scrolltiefe, die
**ausschließlich in der zusammengesetzten Gesamt-Map** wirkt: Abschnitt *i*
geht mit `max(0,12; 0,5^i)` in die Gesamtkarte ein
(`ENGINE_CONFIG.viewport.sectionAttenuation`). Gemessen auf demselben grauen
Testframe:

| | Peak-Höhen der fünf Abschnitte | über der Render-Schwelle (0,08) |
|---|---|---:|
| vorher | 0,50 · 0,50 · 0,50 · 0,50 · 0,50 | 5 von 5 |
| nachher | 0,50 · 0,25 · 0,13 · 0,06 · 0,06 | 3 von 5 |

Statt fünf gleich heller Bänder halbieren sich die Maxima, und ab dem dritten
Abschnitt liegen sie unter der Transparenzschwelle des Renderers — auf leeren
Flächen wird dort nichts mehr gezeichnet. Die Untergrenze von 0,12 liegt bewusst
knapp darunter: ein echter Blickfang tief in der Seite bleibt schwach sichtbar,
eine leere Fläche nicht.

Die **Abschnitts-Maps selbst bleiben unberührt**: jede ist für sich auf
`[0,1]` normiert, `analyzeFrame` gibt sie als `sections[]` heraus, und die
Above-the-fold-Map ist `sections[0]`. Die Hierarchie innerhalb eines
Ausschnitts liest sich damit gleich, egal wie tief er liegt — gemessen auf
demselben Testframe: alle sechs Abschnitts-Maps spannen 0,000 bis 1,000,
während die Gesamt-Map von 0,50 auf 0,01 abfällt.

> **Das ist eine begründete Annahme, keine Messung.** Dass Aufmerksamkeit mit
> der Scrolltiefe abnimmt, ist aus Analytics gut belegt; der Verlauf, der Faktor
> und die Untergrenze sind es nicht. UEyes enthält keine gescrollten Seiten. Der
> Startwert ist nach dem Erscheinungsbild auf dem Testframe gewählt, nicht nach
> Vorhersagegüte. Siehe [`NOTICE.md`](NOTICE.md), „Nicht gemessene Annahmen".

### Nebenbefund: `cold-fold` war wirkungslos

Beim Trennen von Dämpfung und Darstellung fiel auf, dass die Regel `cold-fold`
seit ihrer Einführung **nie feuern konnte**. Sie verglich die Spitzenwerte der
Abschnitte — und weil jede Abschnitts-Map für sich normiert wird, ist dieser
Spitzenwert per Konstruktion immer exakt 1,0. Gemessen auf einem Testframe mit
absichtlich viel stärkerem Blickfang in Abschnitt 4: `1.0000 1.0000 1.0000
1.0000 1.0000 1.0000`.

Die Regel vergleicht jetzt die **Konzentration** der Aufmerksamkeit — den
Anteil der Masse in den stärksten 5 % der Pixel. Der übersteht die Normierung,
weil er die Form misst, nicht die Amplitude. Da diese Größe in einem engen Band
liegt (0,153 bis 0,182 auf dem Testframe), ist der Schwellwert
`coldFoldMargin` jetzt **relativ**: ein späterer Abschnitt muss 8 % stärker
bündeln als der erste.

### Messung: hybrid-v1 gegen den Test-Split

Einmalig gemessen, nachdem alles auf dem Tuning-Split entwickelt war:

| Webpage | AUC-Judd ↑ | CC ↑ | NSS ↑ | KL ↓ |
|---|---:|---:|---:|---:|
| **hybrid-v1** | **0,801** | **0,472** | **1,175** | 1,124 |
| Mean Map | 0,787 | 0,450 | 1,116 | **1,111** |
| Figmaps 1.0 | 0,718 | 0,298 | 0,760 | 1,401 |

| Mobile UI | AUC-Judd ↑ | CC ↑ | NSS ↑ | KL ↓ |
|---|---:|---:|---:|---:|
| **hybrid-v1** | **0,794** | **0,547** | **1,171** | 0,834 |
| Mean Map | 0,782 | 0,518 | 1,096 | **0,833** |
| Figmaps 1.0 | 0,746 | 0,404 | 0,900 | 1,059 |

Auf diesen 27 Bildern schlägt `hybrid-v1` die Mean Map in AUC, CC und NSS
deutlich, bei KL liegt es gleichauf bzw. minimal darunter. **27 Bilder tragen
diese Aussage aber nicht** — siehe die Kreuzvalidierung unten, die dieselbe
Frage mit 495 statt 27 out-of-sample-Bewertungen beantwortet und das KL-Ergebnis
umdreht.

Gegenüber der ausgelieferten 1.0 ist der Sprung erheblich:

| | Webpage | Mobile UI |
|---|---|---|
| Δ AUC | +0,083 | +0,048 |
| Δ CC | +0,174 | +0,143 |
| Δ NSS | +0,415 | +0,271 |
| Δ KL | −0,277 (besser) | −0,225 (besser) |

Die S-3-Schwelle von +0,040 AUC ist damit in beiden Kategorien überschritten —
ohne dass Gewichte getunt wurden.

---

## Kreuzvalidierung (495 Bilder je Kategorie)

```bash
npm run crossval -- --fixtures ueyes-web
npm run crossval -- --fixtures ueyes-mobile
```

Der Test-Split des Datensatzes hat 27 Bilder — zu wenig, um 0,02 CC von
Rauschen zu trennen. Die Kreuzvalidierung nimmt **Tuning und Test zusammen**
(495 Bilder), teilt sie in 5 Folds und schätzt pro Fold **beide**
datenabhängigen Größen ausschließlich aus den übrigen vier: die
Mean-Map-Baseline **und** den Ortsprior von `hybrid-v1` — letzteren inklusive
der 8-Bit-Quantisierung auf 32 × 32, also genau in der ausgelieferten Form.
Jedes Bild wird damit out-of-sample bewertet.

### Mittelwert ± Streuung über die Einzelbilder

**Webpage** (n = 495)

| Engine | AUC-Judd ↑ | CC ↑ | NSS ↑ | KL ↓ |
|---|---|---|---|---|
| **hybrid-v1** | **0,781** ± 0,064 | **0,444** ± 0,134 | **1,054** ± 0,326 | **1,080** ± 0,253 |
| Mean Map | 0,768 ± 0,069 | 0,422 ± 0,146 | 0,997 ± 0,347 | 1,093 ± 0,310 |
| Figmaps 1.0 | 0,688 ± 0,114 | 0,276 ± 0,173 | 0,668 ± 0,428 | 1,355 ± 0,297 |
| Center-Bias | 0,604 ± 0,095 | 0,133 ± 0,154 | 0,343 ± 0,357 | 1,562 ± 0,344 |
| Uniform | 0,500 ± 0,000 | 0,000 ± 0,000 | 0,000 ± 0,000 | 1,583 ± 0,275 |

**Mobile UI** (n = 495)

| Engine | AUC-Judd ↑ | CC ↑ | NSS ↑ | KL ↓ |
|---|---|---|---|---|
| **hybrid-v1** | **0,780** ± 0,070 | **0,546** ± 0,171 | **1,082** ± 0,374 | **0,777** ± 0,220 |
| Mean Map | 0,765 ± 0,076 | 0,508 ± 0,189 | 1,001 ± 0,391 | 0,798 ± 0,279 |
| Figmaps 1.0 | 0,743 ± 0,075 | 0,439 ± 0,130 | 0,885 ± 0,317 | 0,969 ± 0,223 |
| Center-Bias | 0,557 ± 0,135 | 0,103 ± 0,263 | 0,192 ± 0,499 | 1,348 ± 0,491 |
| Uniform | 0,500 ± 0,000 | 0,000 ± 0,000 | 0,000 ± 0,000 | 1,264 ± 0,287 |

### Ist der Unterschied größer als die Streuung?

Die Frage hat zwei Lesarten, und sie führen zu **entgegengesetzten Antworten**.
Beide stehen hier, weil nur eine davon beantwortet, ob der Unterschied echt ist.

**Lesart A — gegen die Streuung zwischen Screens: nein.** Der CC-Unterschied
ist 0,023, die Streuung zwischen einzelnen Screens 0,134. Der Unterschied ist
also rund sechsmal kleiner als die Streuung. Das beantwortet aber die Frage
„kann ich aus dem Mittelwert ablesen, wie gut die Engine auf *einem bestimmten*
Screen abschneidet?" — und die Antwort darauf ist tatsächlich nein.

**Lesart B — gegen die eigene Unsicherheit, gepaart je Bild: ja, deutlich.**
Beide Engines werden auf denselben Screens gemessen, deren Schwierigkeit kürzt
sich also heraus. Differenz je Bild bilden, dann Mittelwert und Unsicherheit:

| | Δ AUC | Δ CC | Δ NSS | Δ KL |
|---|---|---|---|---|
| **Webpage** | +0,0134 | +0,0228 | +0,0575 | +0,0134 |
| 95-%-Intervall | [0,012 – 0,015] | [0,020 – 0,026] | [0,051 – 0,065] | [0,002 – 0,025] |
| t | 17,8 | 15,5 | 16,1 | 2,4 |
| besser auf | 89,9 % | 76,0 % | 77,8 % | 46,1 % |
| **Mobile UI** | +0,0150 | +0,0383 | +0,0808 | +0,0209 |
| 95-%-Intervall | [0,013 – 0,017] | [0,035 – 0,042] | [0,073 – 0,088] | [0,012 – 0,030] |
| t | 18,8 | 20,8 | 21,2 | 4,4 |
| besser auf | 83,8 % | 82,0 % | 83,2 % | 51,5 % |

Alle Vorzeichen richtungsbereinigt: **+ ist besser**, auch bei KL.

**In allen vier Metriken und beiden Kategorien schließt das 95-%-Intervall die
Null aus.** Bei AUC, CC und NSS mit t zwischen 15 und 21 — der Unterschied ist
das Zehn- bis Zwanzigfache seiner eigenen Unsicherheit. **S-2 ist damit
erfüllt**; das gegenteilige Ergebnis auf dem 27-Bild-Test-Split war ein Artefakt
der Stichprobengröße.

### Ein Vorbehalt bei KL

KL ist der schwächste Fall und verdient eine eigene Zeile: t = 2,4 (Webpage)
bzw. 4,4 (Mobile), und die **Trefferquote liegt bei 46 % bzw. 52 %** — der
Mittelwert verbessert sich, der Median praktisch nicht. Der Gewinn kommt also
von einer Minderheit von Screens mit großer Verbesserung, nicht von einer
durchgängig besseren Vorhersage. Bei Webpage sind sich die fünf Folds im
Vorzeichen zudem nicht einig (−0,007 / +0,010 / +0,035 / +0,023 / +0,006).

Das entwertet den Befund nicht — AUC, CC und NSS sind eindeutig, und alle vier
Intervalle schließen die Null aus. Aber „hybrid-v1 schlägt die Mean Map auch in
KL" ist die schwächste der vier Aussagen und sollte nicht als die stärkste
zitiert werden.

---

### Abweichungs-Score: nicht ausgeliefert

Der Score ist `1 − CC(Bildanalyse, Prior)`, ohne Ground Truth berechenbar. Auf
dem Tuning-Split geprüft, ob er vorhersagt, wo die Bildanalyse hilft:

| | Korrelation mit ΔCC | Verlauf über die Quintile |
|---|---:|---|
| Mobile UI | 0,24 | monoton steigend, 71 % → 84 % |
| Webpage | 0,08 | **umgekehrtes U**: 54 / 71 / 77 / 42 / 45 % |

**Ergebnis: taugt so nicht als Vertrauensindikator.** Auf Mobile trägt er, auf
Webpage führt er in die Irre — und der Nutzer kann nicht erkennen, in welchem
Fall er ist. Ein Indikator, der auf der Hälfte der Screens falsch liegt, ist
schlechter als keiner. Der Score bleibt als gemessene Größe im Code
(`src/engine/deviation.ts`), wird aber nicht ins Panel gehoben.

Bemerkenswert bleibt die Form: auf Webpage ist **mittlere** Abweichung am
nützlichsten. Sehr hohe Abweichung heißt meist, dass die Bildanalyse schlicht
danebenliegt. Das ist eine Hypothese für später, kein Feature.

### Befund zu Figmaps 1.0: S-2 ist nicht erfüllt

Figmaps 1.0 schlägt den Center-Bias **deutlich** — in beiden Kategorien, in
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

---

## Diagnose: woher kommt die Vorhersagekraft?

```bash
npm run diagnose -- --fixtures ueyes-web     # nur Tuning-Split, kein Tuning
npm run diagnose -- --fixtures ueyes-mobile
```

Zwei Versuche, **ausschließlich auf dem Tuning-Split** (je 468 Bilder), zur
Diagnose — nicht als Tuning für S-3. Es wird nichts gespeichert und keine
Konfiguration erzeugt; der Test-Split bleibt unberührt.

Die Mean Map ist hier **leave-one-out** gebildet: das bewertete Bild fließt
nicht in seine eigene Baseline ein. Sonst wäre der Vergleich auf demselben
Split, aus dem die Baseline entsteht, zu ihren Gunsten verzerrt.

### Versuch 1 — Prior-Gewichtung: schließt sie die Lücke? **Nein.**

Positions-Prior von 0,1 auf 0,9 hochgezogen, übrige Features anteilig herunter
(CC, Webpage / Mobile UI):

| Prior-Gewicht | 0,1 (= 1.0) | 0,2 | 0,3 | 0,5 | 0,7 | 0,9 | Mean Map |
|---|---:|---:|---:|---:|---:|---:|---:|
| Webpage | 0,279 | **0,295** | 0,294 | 0,282 | 0,271 | 0,262 | **0,421** |
| Mobile UI | 0,441 | **0,458** | 0,439 | 0,397 | 0,369 | 0,351 | **0,507** |

Die Kurve hat ein flaches Maximum bei 0,2 und fällt danach **monoton ab**. Der
beste Punkt schließt nur **11 % (Web) bzw. 26 % (Mobile)** der Lücke zur Mean
Map.

**Damit ist die Hypothese widerlegt:** Der Rückstand liegt *nicht* daran, dass
der Prior zu schwach gewichtet wäre. Ein reiner Ortsprior in unserer Form —
eine analytische F-Pattern-Glocke — ist schlechter als der empirisch geschätzte
Ortsprior der Mean Map. Das Problem ist die **Form** des Priors, nicht sein
Gewicht.

### Versuch 2 — trägt die Bildanalyse Signal? **Ja, messbar.**

Mean Map als Basis, Bildanalyse additiv mit Gewicht α (beide auf `[0,1]`
normiert). α = 0 ist exakt die Mean Map:

**Webpage** (CC)

| α | 0 | 0,1 | 0,2 | 0,3 | 0,4 | **0,5** | 0,75 | 1,5 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| + Pixel-Features | 0,421 | 0,431 | 0,439 | 0,444 | 0,447 | **0,448** | 0,445 | 0,420 |
| + Figmaps 1.0 | 0,421 | 0,429 | 0,434 | 0,438 | 0,440 | 0,441 | 0,441 | 0,431 |

**Mobile UI** (CC)

| α | 0 | 0,1 | 0,2 | 0,3 | 0,4 | **0,5** | 0,75 | 1,5 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| + Pixel-Features | 0,507 | 0,524 | 0,537 | 0,545 | 0,550 | **0,551** | 0,546 | 0,506 |
| + Figmaps 1.0 | 0,507 | 0,519 | 0,529 | 0,535 | 0,540 | 0,543 | 0,545 | 0,535 |

Der Hybrid ist in **allen vier Metriken** besser als die Mean Map allein, in
beiden Kategorien, über den gesamten Bereich. Bestwerte bei α ≈ 0,5:

| | CC | AUC-Judd | NSS | KL |
|---|---:|---:|---:|---:|
| Webpage: Mean Map → Hybrid | 0,421 → **0,448** | 0,767 → **0,782** | 0,992 → **1,062** | 1,088 → **1,071** |
| Mobile UI: Mean Map → Hybrid | 0,507 → **0,551** | 0,764 → **0,781** | 0,995 → **1,091** | 0,797 → **0,777** |

**Die Pixel-Features sind also nicht wertlos.** Sie tragen bildspezifisches
Signal in der Größenordnung **+0,027 CC (Web)** und **+0,044 CC (Mobile)** — die
Kurve steigt sauber an, hat ein Maximum und fällt wieder, wie es ein echter
Effekt tut, nicht wie Rauschen.

Bemerkenswert: **nur die Pixel-Features beizumischen ist besser als die
komplette 1.0-Vorhersage beizumischen.** Deren eigener Positions-Prior ist neben
der Mean Map redundant und, wie Versuch 1 zeigt, schlechter — er verwässert den
Beitrag der Bildanalyse.

### Wo Figmaps die Mean Map schlägt

115 von 468 Bildern (25 %) bei Webpage, 166 von 468 (35 %) bei Mobile UI. Der
Unterschied zwischen Gewinnern und Verlierern ist eindeutig und in beiden
Kategorien derselbe:

| | Gewinner Web | Verlierer Web | Gewinner Mobile | Verlierer Mobile |
|---|---:|---:|---:|---:|
| Ø Masse im oberen Drittel | **45,1 %** | 62,7 % | **42,6 %** | 70,3 % |
| Ø Schwerpunkt y | **0,382** | 0,296 | **0,383** | 0,262 |
| Ø Konzentration der GT | 47,3 % | 48,5 % | 38,8 % | 38,0 % |
| Ø Seitenverhältnis | 1,46 | 1,41 | 0,56 | 0,56 |

Konzentration und Seitenverhältnis unterscheiden sich **nicht** — der einzige
Trennfaktor ist die vertikale Lage der Aufmerksamkeit.

Der Kontaktbogen bestätigt es: die Gewinner sind durchweg
**Hero-dominierte Landingpages** — ein großes Bild oder eine
kontrastreiche Grafik mit einer fetten Headline in der **Bildmitte**, nicht in
der Kopfzeile. Also genau die Screens, auf denen der generische
Ortsdurchschnitt danebenliegt und Luminanz-Kontrast und Kantendichte etwas
finden. Verlierer sind dichte, konventionell aufgebaute Seiten mit starker
Navigation oben, wo der Durchschnitt schon fast alles erklärt.

### Was daraus folgt

Die Engine hat zwei trennbare Probleme, und nur eines davon ist gravierend:

1. **Der analytische Positions-Prior ist zu schlecht.** Ein aus Daten
   geschätzter Ortsprior (Mean Map) schlägt ihn deutlich, und mehr Gewicht auf
   den analytischen Prior macht es schlechter, nicht besser. Das ist der
   Hauptanteil des Rückstands — und billig zu beheben.
2. **Die Bildanalyse trägt echtes, aber schwaches Signal** — rund +0,03 bis
   +0,04 CC über einem guten Ortsprior. Sie ist kein Ersatz für den Prior,
   sondern eine Ergänzung, und sie wirkt vor allem dort, wo der Screen von der
   Norm abweicht.

Der naheliegende nächste Schritt ist damit **nicht** Gewichts-Tuning, sondern
den Prior durch einen datengeschätzten zu ersetzen und die Bildanalyse additiv
darüberzulegen. Das ist zugleich die Struktur, die ein trainiertes Modell von
selbst lernt — Iteration 1.2 bleibt der sauberere Weg, hat jetzt aber eine
Messlatte und eine Erklärung.

> Die Zahlen dieses Abschnitts stammen vom **Tuning-Split** und sind
> Diagnose, keine Abnahme. Eine daraus abgeleitete Konfiguration müsste auf dem
> Test-Split neu gemessen werden.

---

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

| ID | Auslöser | ausgeliefert |
|---|---|---|
| `cta-rank` | Primärer Kandidat der Clickmap nicht auf Rang 1 | ja |
| `cta-below-fold` | Höchstbewerteter Kandidat unterhalb Fold 1 | ja |
| `competition` | Zwei Regionen über 65 % Intensität, weit auseinander, mit Tal dazwischen | ja |
| `cold-fold` | Above-the-fold-Abschnitt bündelt Aufmerksamkeit schwächer als ein späterer | ja |
| `dead-cta` | Interaktives Element unter 45 % des stärksten Kandidaten seines Viewports | **nein** (siehe unten) |
| `flat` | Konzentration des Bildanalyse-Anteils unter Schwellwert | ja |

`dead-cta` ist abgeschaltet: die Größe, die sie misst, ist ein Minimum über
alle Kandidaten und sinkt mit deren Anzahl, sodass keine Konstante über die
Frame-Formen hinweg trennscharf ist. `flat` war es aus verwandtem Grund und ist
es nicht mehr — siehe die beiden Abschnitte unten.

Die Reihenfolge der Regeln in `rules.ts` ist die Reihenfolge, in der Befunde
gelistet werden — als **Tie-Break innerhalb einer Severity**, denn sortiert
wird weiterhin zuerst nach Severity (C-1): `flat`, `cta-below-fold`,
`cta-rank`, `dead-cta`, `competition`, `cold-fold`. `flat` steht vorn, obwohl
es nicht ausgeliefert wird — dort gehört es hin, sobald seine Schwelle neu
geschätzt ist.

### Wie ein Element benannt wird

Ein Befund nennt ein Element nach seinem **Textinhalt**, nicht nach seinem
Layernamen: „JobsResultCard" ist eine Tatsache über die Datei, der Prüfende
sieht eine Karte, auf der „Fahrzeugeinkäufer im Außendienst" steht. Ein
Container erbt dabei den prominentesten Text seines Teilbaums (größte
Schriftgröße, dann größte Fläche, dann weiter oben); erst wenn der Teilbaum
keinen Text enthält, bleibt der Layername.

Sind mehrere Elemente danach **gleich benannt** — drei „Details ansehen" —
kommt eine Lageangabe dazu: `‚Details ansehen‘ (3. von 3, unten)`. Ohne sie ist
der Befund bei drei identischen Karten nicht auflösbar. Sind die Karten durch
ihren Text unterscheidbar, entfällt die Angabe wieder. Dasselbe gilt für das
Klick-Ranking im Panel, wo drei identische Zeilen mit drei Prozentwerten am
meisten stören (`src/findings/label.ts`).

### Feuert jede Regel überhaupt?

```bash
# echte Bilder — in der Konfiguration, in der die Regel läuft
npm run findings-audit -- --fixtures ueyes-mobile --prior-asset mobile --single-viewport
npm run findings-audit -- --fixtures ueyes-web --viewport 500

# konstruierte Frames mit Layer-Baum — braucht keinen Datensatz
npm run findings-audit -- --constructed
```

Der zweite Aufruf existiert, weil `cta-rank`, `cta-below-fold` und `dead-cta`
Klick-Kandidaten brauchen, Kandidaten einen Layer-Baum, und ein Screenshot
keinen hat. An UEyes sind diese drei dauerhaft blockiert. `eval/constructed.ts`
zeichnet dafür Frames in drei Formen — Telefon als ein Viewport, Telefon
scrollend, Desktop scrollend — mit variierender Hierarchie, Hero, CTA-Position
und Kartenzahl. **Konstruiert, nicht beobachtet:** eine Quote von dort sagt, wie
sich eine Regel auf einem konventionellen Layout verhält, nicht wie häufig ein
solches Layout vorkommt. Der Aufruf schreibt diesen Vorbehalt in jeden Lauf.

Beide Aufrufe geben dieselbe Tabelle aus, und die entscheidende Spalte ist
**„liegt bei"** — wo die Schwelle innerhalb der beobachteten Verteilung sitzt.
`ÜBER max` oder `UNTER min` heißt, dass die Regel gar nichts anderes tun kann,
als immer oder nie zu feuern. Das ist die Zahl, an der `flat` und `dead-cta`
schließlich verstanden wurden.

`cold-fold` war seit seiner Einführung wirkungslos, obwohl alle Unit-Tests grün
waren: die Tests riefen die Regel direkt mit handgebauten Werten auf, die
Pipeline fütterte sie mit etwas strukturell anderem. Dagegen gibt es jetzt zwei
Vorkehrungen.

**1. Ein gemeinsamer Pfad.** `findings/derive.ts` ist die einzige Stelle, an der
aus einem Analyse-Ergebnis Befunde werden. Pipeline *und* Tests gehen hindurch.

**2. End-to-End-Tests je Regel.** `findings/__tests__/end-to-end.test.ts` baut
je Regel einen Frame, lässt die **echte** Analyse laufen und prüft, dass die
Regel dabei feuert — plus ein Gegenbeispiel, bei dem sie schweigen muss. Eine
Regel, die sich so nicht auslösen lässt, wird nicht ausgeliefert.

**3. Gemessene Trefferquoten** auf echten Bildern:

| Regel | UEyes Webpage | UEyes Mobile | synthetisch¹ |
|---|---:|---:|---:|
| `flat` | 9,5 % | 15,2 % | 25,8 % |
| `competition` | 2,2 % | 5,3 % | 0 % |
| `cold-fold` | 27,7 % | 39,4 % | 25,6 % |
| `cta-rank` | nicht messbar² | nicht messbar² | 47,5 % |
| `cta-below-fold` | nicht messbar² | nicht messbar² | 58,1 % |
| `dead-cta` | nicht messbar² | nicht messbar² | 4,2 % |

¹ Das synthetische Set ist das einzige mit Layer-Bäumen. Seine Quoten messen
teilweise den Generator, nicht die Realität — sie stehen hier, weil sie die
einzige Zahl für die kandidatenbasierten Regeln sind.
² UEyes enthält keine Layer-Bäume, also keine Klick-Kandidaten. Der Audit
unterscheidet **blockiert** (Voraussetzung fehlt, Regel wurde nie gefragt) von
**stumm** (Regel wurde gefragt und hat verneint) — genau die Unterscheidung,
an der `cold-fold` gescheitert war.

Für die beiden Abschnitts-Regeln erzwingt der Audit mit `--viewport 500` eine
Segmentierung; UEyes-Bilder sind Einzel-Viewports und wären sonst ebenfalls
blockiert.

### Was der Audit ans Licht gebracht hat

Drei weitere Regeln feuerten auf echten Bildern **nie**, aus derselben Ursache:
ihre Schwellwerte stammten aus der Ausgabeverteilung von `heuristic-v1` und
wurden beim Wechsel auf `hybrid-v1` nicht nachgemessen.

| Regel | vorher | Problem | jetzt |
|---|---|---|---|
| `flat` | `p90 − p50 < 0,25` | `hybrid-v1` liegt nie unter 0,39 — der Prior allein erzeugt diese Spanne | Konzentration der Top-5-%-Masse, **Schwelle je UI-Typ** |
| `competition` | zweites Maximum ≥ 0,8, Tal absolut | prior-dominierte Karte lässt entfernte Regionen kaum über 0,66 | ≥ 0,65, Tal **relativ zum zweiten Maximum** |
| `dead-cta` | unter dem 25. Perzentil der Karte | dort liegen nur Ränder und Weißraum; jedes echte Element ist heller | unter 45 % des **stärksten Kandidaten** |

Bei `flat` war ein Zwischenstand besonders lehrreich: mit einer skalenfreien,
aber absoluten Schwelle feuerte sie auf 11 % der Webseiten und auf **90 %** der
Mobile-Screens. Die Verteilungen der beiden UI-Typen überlappen sich kaum
(Median 0,163 gegen 0,258), deshalb ist die Schwelle pro Kategorie hinterlegt:
„flach" heißt flach *für diese Art Screen*. Das war die richtige Diagnose und
die falsche Kalibrierung — siehe direkt darunter.

### `flat` ist ausgeschaltet

Im Vergleichstest meldete `flat` „keine ausgeprägte visuelle Hierarchie" auf
einem Screen mit rotem Kopf und blauem Fuß — direkt neben einer Heatmap, die
genau diese Hierarchie zeigte. Nachgemessen auf 150 UEyes-Mobile-Bildern:

| Konfiguration | Verteilung der Konzentration | Schwelle | Feuerrate |
|---|---|---:|---:|
| Geometrie → `web`-Prior, segmentiert (so misst `findings-audit`) | Median 0,194, Spanne 0,124–0,228 | 0,148 | 18 % |
| `mobile`-Prior, ein Viewport (so läuft ein Telefon-Frame) | Median 0,143, Spanne **0,120–0,181** | 0,200 | **100 %** |

Die Schwelle 0,2 stammt aus der ersten Zeile und wird in der zweiten angewandt.
`findings-audit.ts` lässt `priorAssetIdFor` über ein 1080 px breites
UEyes-Bild entscheiden — das ist nach der Regel eine *Webseite*, läuft mit dem
Web-Prior und wird in Desktop-Abschnitte geschnitten. Ein in Figma gezeichneter
Telefon-Frame ist 390 px breit und hochkant, läuft mit dem Mobile-Prior und als
ein einziger Viewport. Beide Unterschiede verschieben die Verteilung, und in der
ausgelieferten Konfiguration liegt die Schwelle **oberhalb des gesamten
beobachteten Wertebereichs**. Auf 12 konstruierten Telefon-Frames mit bewusst
starker Hierarchie feuerte sie 12 von 12 Mal.

Ein Befund, der der Karte daneben widerspricht, kostet mehr Vertrauen, als die
Regel zurückgeben kann. Sie bleibt deshalb im Code (`shipped: false`), samt
Erreichbarkeitstest, und wird nicht angeboten, bis die Schwelle **in der
Konfiguration neu geschätzt ist, in der sie greift** — je UI-Typ *und* je
Segmentierungszustand.

Die Zahlen in der Tabelle darüber (`flat` 15,2 % auf Mobile) stammen aus der
ersten Zeile dieser Tabelle und sind für die ausgelieferte Konfiguration nicht
aussagekräftig. Das ist die eigentliche Lehre: eine Trefferquote ist nur so
gültig wie die Konfiguration, in der sie gemessen wurde.

Der Audit sagt die Konfiguration deshalb jetzt an, statt sie zu raten, und
umfasst auch die nicht ausgelieferten Regeln — eine abgeschaltete Regel neu zu
kalibrieren ist genau der Zweck:

```bash
npm run findings-audit -- --fixtures ueyes-mobile --prior-asset mobile --single-viewport
```

```
Konfiguration: Ortsprior mobile, ein Viewport — die Quoten gelten nur für diese.
Regel              feuert   stumm  blockiert   Anteil (von bewertbaren)
  flat               120       0          0   100.0 %  ← feuert IMMER  [nicht ausgeliefert]
  competition         16     104          0    13.3 %
  …
  flat             0.123  0.133  0.144  0.153  0.164   [Konzentration der Top-5-%-Masse]
```

Nach dem Umbau derselben Regel (siehe unten) meldet derselbe Aufruf 14,0 % statt
100 %, mit der Entscheidungsgröße bei p5 0,085 gegen eine Schwelle von 0,091.

(`competition` liegt in dieser Konfiguration bei 13,3 % statt der 5,3 % aus der
Tabelle oben — dieselbe Ursache, hier ohne Folgen, weil die Regel damit im
brauchbaren Bereich bleibt.)

### `dead-cta` ist ausgeschaltet

Aus verwandtem Grund, gefunden mit derselben Prüfung. Die Entscheidungsgröße war
„mittlere Aufmerksamkeit des ruhigsten Kandidaten ÷ die des stärksten",
gemessen auf der **komponierten** Karte — und die dämpft jeden tieferen
Abschnitt um `sectionAttenuation^i`. Ein Bedienelement in der Fußzeile eines
gescrollten Frames lag dadurch rechnerisch immer im ruhigen Bereich,
unabhängig vom Entwurf:

| Population | Verteilung | Schwelle 0,45 liegt | Rate |
|---|---|---|---:|
| `synthetic`, ein Viewport, Kandidaten nebeneinander | 0,310–0,994 | bei p3 | 3,3 % |
| Telefon, ein Viewport (konstruiert, n=24) | 0,128–0,286 | **über max** | 100 % |
| Desktop, scrollend (konstruiert, n=24) | 0,026–0,212 | **über max** | 100 % |
| Telefon, scrollend (konstruiert, n=24) | 0,020–0,038 | **über max** | 100 % |

Die 0,45 stammen aus der ersten Zeile — einem Set, dessen Kandidaten alle im
selben Band eines top-lastigen Priors liegen. Sobald sie über den Frame
verteilt sind, was der Normalfall ist, fällt der Quotient mechanisch darunter.
Die Regel meldet dann nicht mehr „visuell ruhig", sondern „weit unten", und
wiederholt damit `cta-below-fold`.

**Umgebaut, und trotzdem aus.** Der Vergleich läuft jetzt über die
ungedämpften Abschnittskarten: jeder Kandidat auf der Karte seines eigenen
Viewports, gemessen gegen den stärksten Kandidaten des Screens. Der
Befundtext sagt das auch — er nennt beide Elemente und den Anteil, statt eine
absolute Aussage zu machen:

> ‚Details ansehen' (3. von 3, unten) erreicht 18,4 % der vorhergesagten
> Aufmerksamkeit der stärksten Schaltfläche ‚Jetzt bewerben', jeweils im
> eigenen Bildschirmausschnitt gemessen.

Der Anteil der Scroll-Dämpfung ist damit weg — Desktop scrollend ging von
0,026–0,212 auf 0,161–0,362, Telefon scrollend von 0,020–0,038 auf
0,115–0,234. Es reicht trotzdem nicht:

| Population | Kandidaten | Verteilung |
|---|---:|---|
| `synthetic`, ein Viewport | 2 | 0,451–0,997 |
| Telefon, ein Viewport | 6–12 | 0,128–0,286 |
| Telefon, scrollend | 12 | 0,115–0,234 |
| Desktop, scrollend | 12 | 0,161–0,362 |

Die Größe ist ein **Minimum über N Kandidaten** und sinkt mit deren Anzahl: bei
zwei Schaltflächen ist „die leiseste" fast nie weit unten, bei zwölf fast immer
eine. Keine Konstante ist über die Populationen hinweg trennscharf — 0,45
feuert auf 100/100/100/0 %, 0,18 auf 29/50/54/0 %, 0,12 auf 0/0/13/0 %. Und was
überwiegend gemeldet würde, ist die neunte von zwölf gleichartigen Listenkarten.

**Der Weg zurück ist entschieden, aber nicht Teil dieses Stands** (1.2 oder
später): vor der Minimum-Bildung werden **gleichartige, wiederholte Kandidaten
zu einer Gruppe zusammengefasst und nur einmal gewertet** — gleicher
Elementtyp, ähnliche Größe, Teil eines wiederholten Layout-Musters. Erst danach
ist die Größe wieder sinnvoll kalibrierbar.

Damit wird aus „die neunte von zwölf Listenkarten ist die leiseste" wieder die
Aussage, die die Regel machen will: von den *unterscheidbaren* Bedienelementen
dieses Screens ist dieses das leiseste. Die Kandidatenzahl hängt dann an der
Zahl der Rollen statt an der Zahl der Listeneinträge — und damit fällt der
Grund weg, aus dem keine Konstante über die Frame-Formen hinweg trennscharf
war. `NodeSignal` trägt schon alles, was ein Erkenner braucht (`parentId`,
`name`, `type`, `width`/`height`); dasselbe Muster erkennt `label.ts` bereits,
um „3. von 3" zu schreiben.

Für die Neukalibrierung danach fehlt weiterhin das Set mit echten Layer-Bäumen
(PRD Set 2) — ohne Layer-Baum gibt es keine Kandidaten, also an UEyes
grundsätzlich keine Messung.

### Dieselbe Frage für alle sechs Regeln

`flat` war der dritte Fall dieser Fehlerklasse in einer Iteration (nach
`cold-fold` und dem ersten `flat`-Anlauf). Deshalb wurde sie einmal
systematisch für jede Regel gestellt: **ist die Entscheidungsgröße invariant
gegenüber Engine-Version, Ortsprior und Viewport-Segmentierung — und wenn
nicht, wo liegt die Schwelle in der jeweiligen Verteilung?**

Die letzte Zahl ist die entscheidende. Bei `flat` lag sie *über dem Maximum*;
eine Regel, deren Schwelle außerhalb des beobachteten Wertebereichs liegt, kann
gar nichts anderes tun als immer oder nie zu feuern.

Zwei Populationen, weil drei Regeln Klick-Kandidaten brauchen und UEyes keinen
Layer-Baum hat:

**A) Echte Screenshots (UEyes)** — nur die Regeln, die allein die Karte lesen:

| Regel | Desktop-Abschnitte (web, Viewport 500, n=60) | Mobile-Single-Viewport (mobile, n=60) |
|---|---|---|
| `flat` | 6,7 %, Schwelle 0,148 bei **p7** | **100 %**, Schwelle 0,2 **über max** (0,122–0,181) |
| `competition` | 3,3 %, Schwelle bei p3 | 10,0 %, Schwelle bei p10 |
| `cold-fold` | 29,8 %, Schwelle 0,08 bei p70 | blockiert (nicht segmentiert) |

**B) Konstruierte Frames mit Layer-Baum** (je 24, mit variierender Hierarchie,
Hero, CTA-Position und Kartenzahl — konstruiert, nicht beobachtet;
reproduzierbar mit `npm run findings-audit -- --constructed`):

| Regel | Desktop scrollend | Telefon, ein Viewport | Telefon scrollend |
|---|---|---|---|
| `flat` | 0 % (0,250–0,282, Schwelle **unter min**) | 100 % (0,126–0,149, **über max**) | 0 % (0,248–0,292, **unter min**) |
| `dead-cta` | **100 %** (0,026–0,212, **über max**) | **100 %** (0,128–0,286, **über max**) | **100 %** (0,020–0,038, **über max**) |
| `cold-fold` | 83,3 % (Schwelle bei p17) | blockiert | 100 % (**unter min**) |
| `competition` | 0 % | 0 % | 0 % |
| `cta-rank` | 91,7 % | 54,2 % | 66,7 % |
| `cta-below-fold` | 0 % | blockiert | 0 % |

**Befund je Regel:**

| Regel | Schwelle kalibriert an | verschiebt sich durch | Urteil |
|---|---|---|---|
| `flat` | web-Prior + Desktop-Abschnitte | Prior **und** Segmentierung | behoben: misst jetzt den Bildanteil des ersten Abschnitts, neu kalibriert, wieder an (s. u.) |
| `dead-cta` | `synthetic`, ein Viewport, Kandidaten nebeneinander | Segmentierung (Scroll-Dämpfung) | umgebaut, aber weiter aus: die Größe hängt an der Kandidatenzahl (s. u.) |
| `cold-fold` | Abschnittskarten (ungedämpft) | nur den Prior | auf echten Bildern gesund (p70); auf konstruierten Layouts sehr durchlässig |
| `competition` | UEyes, web-Prior | Prior (3,3 % → 10,0 %) | nicht entartet; **aber** `competitionMinDistance` ist geometrieabhängig (s. u.) |
| `cta-rank` | — (Definition „nicht Rang 1") | nicht fehlkalibrierbar | feuert auf 43–92 % der Screens; wenig trennscharf |
| `cta-below-fold` | — (Definition „unterhalb Fold 1") | nicht fehlkalibrierbar | durch die Scroll-Dämpfung strukturell unterdrückt: 0 von 48 konstruierten Scrollframes |

**`flat` braucht mehr als eine Schwelle je UI-Typ** — und, wie sich beim
Nachmessen herausstellte, mehr als eine neue Schwelle überhaupt. Siehe den
eigenen Abschnitt unten.

**`dead-cta` ist derselbe Fall.** Die 0,45 stammen aus `synthetic`, wo alle
Kandidaten im selben Band eines top-lastigen Priors liegen (Verteilung dort
0,310–0,994, Schwelle bei p3, Rate 3,3 %). Sobald Kandidaten über den Frame
verteilt sind — der Normalfall, ein CTA in der Fußzeile —, fällt der Quotient
mechanisch darunter, weil die Komposition jeden Abschnitt um
`sectionAttenuation^i` dämpft. Die Regel meldet dann nicht mehr „visuell ruhig",
sondern „weit unten", und wiederholt damit `cta-below-fold`. Sie ist **nicht
abgeschaltet**, weil die Belege bisher aus konstruierten Frames stammen; bei
`flat` lagen 150 echte Screenshots vor. Der naheliegende Umbau ist derselbe wie
dort: gegen die ungedämpften Abschnittskarten vergleichen.

**`competitionMinDistance` misst in der falschen Achse.** Der Mindestabstand
zwischen den beiden Maxima ist ein Anteil der Karten*breite*, angewandt auf
Karten, deren Seitenverhältnis um eine Größenordnung schwankt:

| Frame | Karte | Mindestabstand | davon Höhe |
|---|---|---:|---:|
| Desktop, ein Viewport | 512 × 320 | 154 px | 48,0 % |
| Telefon, ein Viewport | 237 × 512 | 71 px | 13,9 % |
| Desktop, scrollend | 512 × 1138 | 154 px | 13,5 % |
| Telefon, scrollend | 256 × 1969 | 77 px | 3,9 % |

„Weit auseinander" heißt damit je nach Frame-Form etwas völlig anderes.
Nicht geändert — eine Änderung ohne neue Kalibrierung wäre genau der Fehler,
um den es hier geht.

**Die gemeinsame Ursache** aller drei Fälle: die Entscheidungsgröße wird auf der
komponierten Karte gemessen, deren Kontrast von zwei Größen abhängt, die nichts
mit dem Entwurf zu tun haben — der Wahl des Ortspriors und der
Scroll-Dämpfung (`sectionAttenuation`, laut `config.ts` ausdrücklich eine
Annahme ohne Messung). Wer eine Regel gegen eine solche Karte kalibriert,
kalibriert gegen die Konfiguration, nicht gegen den Screen.

`competition` bleibt mit 3–10 % die selektivste Regel. Das ist kein Fehler —
zwei wirklich getrennte, gleich starke Blickfänge sind selten —, aber sie ist
die erste, die man streichen sollte, falls sie sich im Gebrauch nicht bewährt.

### `flat` ist wieder an — nach zwei Umbauten

Die Regel brauchte zwei Schritte, und der erste allein hätte nur gut ausgesehen.

**Schritt 1 — die Scroll-Dämpfung raus.** Gemessen wurde auf der komponierten
Karte, die jeden tieferen Abschnitt dämpft und damit Masse im ersten anhäuft.
Auf dem ersten Abschnitt für sich fallen die Verteilungen zusammen:

| Frame | vorher (komponierte Karte) | danach (Abschnittskarte) |
|---|---|---|
| Telefon, ein Viewport | 0,126–0,149 | 0,126–0,149 |
| Telefon, scrollend | 0,248–0,292 | 0,120–0,152 |
| Desktop, scrollend | 0,250–0,282 | 0,122–0,147 |

Die Größe war damit invariant gegen die Segmentierung — und maß immer noch das
Falsche. An Fällen mit bekannter Antwort lag ein **leerer** Frame (0,164) so
hoch wie einer mit klarem Blickfang (0,167), und was sie tatsächlich bewegte,
war die Menge an Inhalt, nicht die Hierarchie.

**Schritt 2 — den Ortsprior raus.** Unter `hybrid-v1` ist die fertige Karte
`norm(Prior) + 0,3 · Bild`, also weitgehend der Prior — und der ist auf jedem
Screen derselbe. Gemessen auf dem **Bildanalyse-Anteil** vor dem Blend
(`FindingsInput.aboveFoldImageTerm`) stimmt die Ordnung:

| Fall | fertige Karte | Bildanteil |
|---|---:|---:|
| leer (nur Hintergrund) | 0,1635 | **0,0000** |
| ein kleiner Blickfang | 0,1665 | **0,8706** |
| ein mittlerer Blickfang | 0,1663 | 0,4756 |
| ein großer Blickfang | 0,1594 | 0,2825 |
| Blickfang + ruhiger Inhalt | 0,1333 | 0,1018 |
| 3 gleich starke Blöcke | 0,1242 | 0,0955 |
| 6 gleich starke Blöcke | 0,1190 | 0,0771 |
| 12 gleich starke Blöcke | 0,1135 | 0,0631 |

Der unterscheidende Bereich wächst von 0,054 auf 0,87, und ein leerer Frame
liegt jetzt am flachen Ende statt am hierarchischen.

**Kalibrierung.** p10 je UI-Typ aus je 150 UEyes-Bildern mit passendem Prior und
einem Viewport — die Konfiguration, in der ein Figma-Frame läuft:

| Kategorie | Verteilung (min / p10 / Median / max) | alt | neu |
|---|---|---:|---:|
| `web` | 0,079 / 0,086 / 0,108 / 0,389 | 0,148 | **0,086** |
| `mobile` | 0,079 / 0,091 / 0,125 / 0,294 | 0,200 | **0,091** |
| `desktop` | 0,073 / 0,092 / 0,119 / 0,392 | 0,128 | **0,092** |
| `poster` | 0,071 / 0,080 / 0,105 / 0,345 | 0,135 | **0,080** |

**Abnahme.** Feuerraten auf konstruierten Frames: Telefon ein Viewport 0/24,
Telefon scrollend 6/24, Desktop scrollend 5/24. Der Frame aus dem
Vergleichstest — farbiger Kopf, farbiger Fuß — feuert nicht mehr, und zwar in
keiner der 20 Varianten.

**Was bleibt.** Die Größe reagiert weiterhin auch auf die *Menge* an Inhalt: auf
gescrollten Desktop-Frames feuerte sie bei den Varianten mit den meisten Karten,
darunter eine mit starkem Akzent und Hero. „Zwölf fast gleiche Karten sind
flach" ist vertretbar, aber es ist nicht dasselbe wie „kein Blickfang". Wenn das
im Gebrauch stört, ist es die nächste Frage — und wieder eine Bedeutungs-, keine
Kalibrierungsfrage.

### Bekannte Einschränkungen — bewusst nicht in diesem Schritt behoben

Zwei Befunde aus dem Audit bleiben stehen. Beide sind belegt, beide sind
**keine offenen Bugs ohne Notiz**, und beide werden hier absichtlich nicht
angefasst: eine Korrektur ohne neue Kalibrierung wäre derselbe Fehler, um den
es in diesem Abschnitt geht.

| Was | Beleg | warum jetzt nicht |
|---|---|---|
| `competitionMinDistance` misst am Karten**breiten**anteil und bedeutet je nach Frame-Form 3,9 % bis 48,0 % der Kartenhöhe | Tabelle oben | Die Regel ist mit 3–10 % nicht entartet. Eine Umstellung auf die Diagonale oder auf getrennte x/y-Schwellen ändert die Verteilung und verlangt eine eigene Neukalibrierung — ein eigener Schritt. |
| `cta-below-fold` ist durch `sectionAttenuation` strukturell unterdrückt (0 von 48 konstruierten Scrollframes) | Tabelle oben | Die Ursache ist die Scroll-Dämpfung, laut `config.ts` ausdrücklich eine **Annahme ohne Messung**. Sie zu ändern, um eine Regel häufiger feuern zu lassen, hieße die Vorhersage an die Regel anzupassen statt umgekehrt. Erst die Dämpfung belegen, dann die Regel. |

Beide stehen zusätzlich als Kommentar an der jeweiligen Regel in
`src/findings/rules.ts`, damit sie beim Lesen des Codes nicht erst gesucht
werden müssen.

Sprachregeln (C-2), von den Tests erzwungen:

- Beschreiben, was gemessen wurde — nicht vorschreiben, was zu tun ist
- Immer im Modus der Vorhersage („vorhergesagt"), nie „Nutzer sehen"
- Höchstens eine Dezimalstelle bei Prozentangaben
- Kein Ausrufezeichen, keine Warn-Emoji, **kein Gesamtscore** — ein Score von
  0–100 würde die Unsicherheit des Modells verstecken und zum Optimierungsziel
  werden

---

## Betrachtungsdauer (Epic D) — gemessen

```bash
npm run epic-d -- --fixtures ueyes-web
npm run epic-d -- --fixtures ueyes-mobile
```

Die ursprüngliche Hypothese war, Betrachtungsdauer verschiebe die **Gewichte**
(kurz = Kontrast, lang = Text). Die neue Hypothese war, sie verschiebe den
**Ort**. Gemessen wurde die zweite — je ein Ortsprior aus der Ground Truth für
1 s, 3 s und 7 s, mit derselben 5-fachen Kreuzvalidierung, alle Prioren pro
Fold aus den übrigen vier geschätzt.

**Ergebnis: Es ist ein Ortseffekt, und er ist belastbar.**

CC, Zeile = Ground-Truth-Dauer, Spalte = verwendeter Prior (Webpage):

| Ground Truth | 1 s-Prior | 3 s-Prior | 7 s-Prior |
|---|---:|---:|---:|
| 1 s | **0,4039** | 0,3916 | 0,3680 |
| 3 s | 0,4337 | **0,4444** | 0,4164 |
| 7 s | 0,4099 | 0,4165 | **0,4342** |

Die Diagonale gewinnt in jeder Zeile, in beiden Kategorien. Gepaart gegen den
ausgelieferten 3 s-Prior:

| | Δ CC | 95-%-Intervall | t |
|---|---:|---|---:|
| Webpage, 1 s-GT mit 1 s-Prior | **+0,0123** | [0,0093 – 0,0154] | 7,9 |
| Webpage, 7 s-GT mit 7 s-Prior | **+0,0177** | [0,0130 – 0,0224] | 7,4 |
| Mobile, 1 s-GT mit 1 s-Prior | **+0,0075** | [0,0052 – 0,0099] | 6,3 |
| Mobile, 7 s-GT mit 7 s-Prior | **+0,0208** | [0,0157 – 0,0259] | 8,0 |

Alle Intervalle klar über null. Die drei Prioren unterscheiden sich auch direkt
messbar (CC 1 s↔7 s: 0,909 Webpage, 0,929 Mobile) — sie sind nicht dieselbe Map.

**Konsequenz: Epic D wird ausgeliefert**, aber anders als geplant. Die drei
Profile tauschen den **Ortsprior**, nicht die Feature-Gewichte; die Gewichte
sind in allen drei identisch. Die Hypothese aus dem PRD („kurze Dauer stärker
von Positions-Prior und Roh-Kontrast dominiert") war in ihrer Gewichts-Lesart
falsch und in ihrer Orts-Lesart richtig.

Die fertigen Vorhersagen der drei Profile korrelieren untereinander mit
0,909 bis 0,966 — verwandt, aber unterscheidbar. Drei Schalter, die dasselbe
tun, wären es nicht geworden.

### Was der Umschalter am fertigen Bild ändert

Aus dem Vergleichstest kam die Rückmeldung, die drei Dauern lieferten optisch
dieselbe Map. Nachgemessen wurde deshalb nicht die Vorhersage, sondern das
**Bild**: dieselbe Analyse, dreimal, und anschließend ein Pixel-Diff der
gerenderten Overlay-RGBA (`heatmapToRgba`, Deckkraft 0,7).

**Kein Bug.** Auf keinem einzigen Frame waren zwei Dauern byte-identisch — auf
12 UEyes-Mobile-Screenshots und auf 12 prozeduralen Telefon-Frames nicht:

| Paar | r | max &#124;Δ&#124; | Pixel ≥ 8/255 | IoU der heißesten 25 % | Versatz der Spitze |
|---|---:|---:|---:|---:|---:|
| Blick ↔ Scan | 0,983–0,990 | 0,20 | 71 % | 0,80 | 2,3 % |
| Scan ↔ Lesen | 0,962–0,978 | 0,22 | 86 % | 0,74 | 6,2 % |
| Blick ↔ Lesen | 0,935–0,959 | 0,31 | 88 % | 0,66 | 7,6 % |

Die Korrelationen liegen im erwarteten Band (0,909–0,966 aus der Messung
oben). Der Grund für den Eindruck „identisch" steht in der letzten Spalte: auf
einem Screen mit ausgeprägter Hierarchie **wandert die Spitze nicht** (0,2–0,4 %
der Diagonale). Was sich ändert, ist die *Ausdehnung* des heißen Bereichs — ein
Drittel der heißesten 25 % ist zwischen 1 s und 7 s nicht mehr dieselbe Fläche.
Nebeneinandergelegt ist das sichtbar, nacheinander betrachtet nicht.

In der Clickmap kommt davon wenig an, aber nicht nichts. Gemessen über 12
Telefon-Frames und 20 synthetische Screens mit Layer-Baum:

| Paar | Kendall τ | max Δ Anteil | Reihenfolge Top-5 | Rang 1 |
|---|---:|---:|---:|---:|
| Blick ↔ Scan | 1,000 | 1,0 pp | unverändert | unverändert |
| Scan ↔ Lesen | 0,903 | 2,2 pp | 12/12 geändert | unverändert |
| Blick ↔ Lesen | 0,903 | 3,2 pp | 12/12 geändert | unverändert |

Rang 1 bleibt in **jedem** gemessenen Fall derselbe; getauscht werden Plätze 4
und 5. Die Prozentwerte verschieben sich um 1 bis 3 Prozentpunkte.

**Konsequenz: der Umschalter bleibt.** Die Bedingung, ihn zu entfernen, war
„weder Heatmap noch Clickmap unterscheiden sich sichtbar" — beide tun es
messbar, die Heatmap in der Fläche, die Clickmap in den hinteren Rängen. Was
fehlte, war nicht der Unterschied, sondern der Hinweis darauf, dass man zwei
verschiedene Dinge ansieht: die gewählte Dauer steht jetzt in der Fußzeile
jeder erzeugten Map.

### Die Fußzeile jeder Map

Zwei Angaben entscheiden maßgeblich über das Ergebnis und sind an der Map
selbst nicht abzulesen — **Ortsprior-Kategorie** und **Betrachtungsdauer**. Zwei
Bilder desselben Screens können sich in nichts sonst unterscheiden. Beide
stehen deshalb auf dem Bild, zusammen mit der CC-BY-Nennung für den
Ortsprior: ein exportiertes PNG verlässt Figma ohne das Panel, und die Lizenz
hängt am abgeleiteten Asset, nicht an der Oberfläche, die es erzeugt hat.

Die Fußzeile ist dafür **zweizeilig**. Bis 1.1 stand der Disclaimer
linksbündig und „Figmaps · 1.1.0 · Ortsprior: …" rechtsbündig auf derselben
Zeile; auf einem Telefon-Frame (390 × 844 bei 2×, also 780 px breit) braucht
allein der Disclaimer rund 620 px, und der rechte String wurde darüber gemalt.
Deshalb las sich die Ortsprior-Angabe als „fehlt". Jetzt trägt Zeile 1
Disclaimer und Version, Zeile 2 die Parameter; Zeile 2 verkleinert sich bis zur
Mindestgröße und bricht danach um, statt beschnitten zu werden. Dass sich auf
einer Zeile nichts überlappt und nichts über den Bildrand hinausragt, prüft
`src/render/__tests__/legend.test.ts` mit einem aufzeichnenden Canvas-Stub.

### Die heißeste Stelle auf der Statusleiste

Zweite Rückmeldung aus dem Vergleichstest: die Spitze der Heatmap liegt auf
Uhrzeit / WLAN / Akku. Verdacht war ein Artefakt der UEyes-Screenshots im
Ortsprior. **Der Verdacht trägt nicht.**

Das Zeilenprofil der Mobile-Prioren ist oben nicht überhöht — im Gegenteil,
Zeile 0 ist dunkler als die Zeilen darunter:

| Prior | Spitzenzeile | Masse in den obersten 3 % |
|---|---|---:|
| `mobile@1s` | 14,1 % der Höhe | 5,3 % |
| `mobile@3s` | 10,9 % der Höhe | 5,4 % |
| `mobile@7s` | 20,3 % der Höhe | 4,2 % |

Auf 27 UEyes-Mobile-Bildern lag die Spitze der *fertigen* Karte in 9 Fällen im
obersten 5-%-Band — die Spitze des **reinen Priors** in null Fällen. Der Prior
ist dort zwar hoch (0,97 seines Maximums an der Stelle der Spitze), aber flach;
den Ausschlag gibt die Bildanalyse, und die sieht in einer Statusleiste genau
das, wonach sie sucht: kleine, sehr kontrastreiche Glyphen auf ruhigem Grund.

Eine Dämpfung der obersten Zeilen wurde trotzdem durchgemessen, bevor sie
gebaut worden wäre — und **nicht gebaut**, weil sie in jeder Variante schadet:

| Variante | Δ CC | Δ KL | Δ AUC | Δ NSS |
|---|---:|---:|---:|---:|
| oberste 3 % auf 0,7 | −0,0018 | +0,0040 | −0,0002 | −0,0028 |
| oberste 3 % auf 0,4 | −0,0116 | +0,0149 | −0,0032 | −0,0207 |
| oberste 5 % auf 0,4 | −0,0199 | +0,0243 | −0,0050 | −0,0350 |
| oberste 8 % auf 0,4 | −0,0309 | +0,0374 | −0,0071 | −0,0539 |

(Tuning-Split, 60 Bilder; KL kleiner ist besser. Auf dem 27er-Test-Split zeigt
die mildeste Variante +0,0011 CC — ein Vorzeichenwechsel, der auf dem größeren
Split verschwindet und damit Rauschen ist.) Die Ground Truth enthält die
Statusleiste; sie zu dämpfen entfernt Aufmerksamkeit, die dort gemessen wurde.

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

Der Export läuft immer mit 2×; die Tabelle beschreibt, wann die API-Grenze das
erzwungenermaßen unterläuft.

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
| 1 | Plugin importieren, öffnen | Panel 320 × 680 erscheint, Empty State „Wähle einen Frame aus.", Button disabled |
| 2 | Frame auswählen | Name + Dimensionen erscheinen, Button aktiv |
| 3 | Selection wechseln, Text-Node auswählen | Panel folgt live; Text-Node ⇒ zurück in den Empty State, kein Absturz |
| 4 | Frame < 200 px auswählen | Warnung „zu klein für eine sinnvolle Analyse", Button disabled |
| 5 | **Maps erstellen** auf einem Referenz-Screen | Ladezustand < 300 ms sichtbar; Wrapper `[Figmaps] … — …` rechts daneben, Viewport springt darauf, `3 Maps erstellt` |
| 6 | Heatmap begutachten | Headlines und primärer CTA erkennbar heiß, leere Flächen kalt, Legende + Fußzeile mit `hybrid-v1` vorhanden |
| 7 | Clickmap begutachten | Ranking im Panel; primärer CTA auf Platz 1 (mind. 2 von 3 Referenz-Screens) |
| 8 | Focus-Schwelle 60 → 95, neu erzeugen | Sichtbare klare Fläche wird monoton kleiner |
| 9 | Overlay-Deckkraft ändern, neu erzeugen | Heatmap-Overlay entsprechend transparenter/kräftiger |
| 10 | Frame ohne benannte Buttons/Reactions | Hinweis „Keine interaktiven Elemente erkannt…", Heat- und Focusmap entstehen trotzdem |
| 11 | 5 Frames auswählen, erzeugen | „Frame 2 von 5", je Frame ein eigener Wrapper |
| 12 | Während des Batches **Abbrechen** | Lauf stoppt, bereits erzeugte Wrapper bleiben, Notify „Abgebrochen" |
| 13 | Plugin schließen und neu öffnen | Slider- und Checkbox-Einstellungen sowie die Panelgröße sind erhalten |
| 14 | Frame mit 6000 px Höhe | Hinweis auf Downscale, Maps entstehen, kein Absturz |
| 15 | Zweiter Lauf auf demselben Frame | Neuer Wrapper, der erste bleibt unverändert |
| 15a | Griff unten rechts über den ganzen Bildschirm ziehen | Panel folgt dem Cursor ohne Sprung, stoppt bei 720 × 2400, Layout bleibt intakt; Doppelklick stellt 320 × 680 her |

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

1. ~~**Plugin-Name**~~ — entschieden: `Figmaps`. Das Logo liegt als
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
- **S-2** (Engine schlägt die Baseline) — **erfüllt.** In der Kreuzvalidierung
  über je 495 Bilder schlägt `hybrid-v1` jede bildunabhängige Baseline in allen
  vier Metriken, in beiden Kategorien, mit 95-%-Intervallen ohne Null.
  `heuristic-v1` verliert weiterhin klar. Siehe
  [Kreuzvalidierung](#kreuzvalidierung-495-bilder-je-kategorie); KL ist der
  schwächste Fall und dort eigens vermerkt.
- **S-3** (+0,04 AUC gegenüber 1.0) — **erreicht, aber nicht durch Tuning.**
  `hybrid-v1` liegt +0,083 (Webpage) bzw. +0,048 (Mobile) über 1.0.
  `src/engine/tuned.ts` ist weiterhin leer; die Verbesserung kommt aus dem
  Ortsprior, nicht aus einer Gewichtssuche.
- **S-4** (abschnittsweise Analyse) — erfüllt, siehe Epic B.
- **S-5** (3–6 Befunde in verständlichem Deutsch) — erfüllt bis auf die
  Textabnahme durch einen Menschen. Vier der sechs Regeln waren bis zum 8.8.
  auf echten Bildern wirkungslos; alle sechs sind jetzt nachweislich erreichbar
  und ihre Trefferquoten gemessen.

### Offen

1. **`hybrid-v1` scharfschalten — oder nicht.** Der Code steht, die Zahl steht
   (S-2 erfüllt), das Umschalten ist eine Zeile. Zwei Dinge sprechen dagegen und
   gehören auf den Tisch: die Engine wird damit **datensatzabhängig** (der Prior stammt aus
   UEyes und passt auf meinestadt-Screens nur, soweit die dem Durchschnitt
   ähneln), und mit dem Asset kommt die **CC-BY-Pflicht** ins Produkt
   ([`NOTICE.md`](NOTICE.md)). Dafür spricht der gemessene Sprung.
2. **Vorab prüfen, ob der Prior auf meinestadt-Screens trägt.** Der billigste
   Test ist das eigene First-Click-Set — es beantwortet gleichzeitig die
   Teilmessungs-Frage.
3. **Trainiertes Modell (1.2)** bleibt der sauberere Weg: ONNX Runtime Web im
   iframe, UMSI auf UEyes nachtrainiert erreicht laut Literatur 0,878 AUC gegen
   0,778 ohne UI-Training. `hybrid-v1` ist jetzt die Messlatte dafür.
4. **Eigenes Validierungsset** aus First-Click-Tests. Der einzige Weg,
   `textSalience`, `interactiveSalience` und `imageSalience` überhaupt zu
   bewerten — auf Screenshots sind sie konstant null. Ohne das bleibt jede
   Messung eine Teilmessung über 60 % der Gewichtung.
5. **Textabnahme der Findings (M5)** — C-1 verlangt ausdrücklich, dass keine
   Regel feuert, deren Text nicht von einem Menschen bestätigt wurde.
6. **Desktop und Poster** sind importierbar (`--category desktop|poster`), aber
   für Figmaps nicht die relevanten UI-Typen.

## Nicht in 1.1

Bewusst ausgelassen, obwohl fachlich attraktiv (PRD §2):

- **Kein ML-Modell** (ONNX / UMSI) — ohne Eval-Harness nicht beweisbar besser.
  Das ist 1.2.
- **Keine Gesichtserkennung** — gleicher Grund.
- **Kein Import echter Analytics-Daten.**
- **Keine Scanpath-Animation** — sieht spektakulär aus, ist deutlich schwerer
  vorherzusagen als eine Saliency-Map und ändert keine Design-Entscheidung.
- **`dead-cta` bleibt abgeschaltet.** Der nächste Schritt ist festgelegt:
  gleichartige, wiederholte Kandidaten vor der Minimum-Bildung gruppieren und
  einmal werten, dann neu kalibrieren. Siehe „`dead-cta` ist ausgeschaltet".

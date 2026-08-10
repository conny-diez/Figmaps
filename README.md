<img src="assets/logo.svg" width="72" height="72" alt="Figmaps">

# Figmaps — Figma Plugin

**Version 1.1** — „Messbar und handlungsleitend"

Erzeugt für einen ausgewählten Frame Visualisierungen und legt sie als Bild
rechts neben dem Original auf dem Canvas ab:

- **Heatmap** — vorhergesagte Verteilung visueller Aufmerksamkeit (Turbo-Colormap)
- **Focusmap** — der Screen bleibt dort scharf, wo Aufmerksamkeit vorhergesagt
  wird, und wird zum ruhigen Rand hin **stufenlos** abgedunkelt und unscharf
- **Above the Fold** — bei langen Frames zusätzlich der erste Abschnitt allein
- **Befunde** — 3–6 Sätze in Deutsch, im Panel und als Textframe neben den Maps
- **Clickmap** — implementiert, aber derzeit nicht im Panel angeboten, siehe
  „Clickmap — warum sie nicht im Panel steht"

> Die Ausgabe ist eine **algorithmische Vorhersage**, keine Messung. Es fließen
> keine Daten echten Nutzerverhaltens ein. Auf die Screenshots wird **nichts**
> gemalt außer der Vorhersage selbst; Titel, Disclaimer, Parameter und die
> CC-BY-Nennung stehen als Figma-Textebenen daneben (`figma/place.ts`).

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

### Was 1.2 bisher ändert

1.2 lief in drei Blöcken (A Alpha-Kurve, B Regeln für Ein-Viewport-Screens,
C Contrastmap). **A und C sind fertig, B ist abgeschlossen — aber nur eine
seiner vier Aufgaben hat eine Regel hervorgebracht:**

| | |
|---|---|
| **B1** `competition` auf die Diagonale | gebaut und neu kalibriert |
| **B2** Kopfbereich gegen Inhalt | gemessen und **verworfen** — die Größe ordnet die bekannten Fälle nicht |
| **B3** CTA in der ruhigsten Zone | **nicht angefangen.** Kein Code, keine Messung |
| **B4** `cta-below-fold` auf `localMean` | gebaut, gemessen, **bleibt abgeschaltet** — der Umbau behebt den Defekt nicht |

Das Regelwerk hat 1.2 damit **keine neue Regel** hinzugefügt; es hat zwei
bestehende neu kalibriert und zwei Ideen widerlegt.

| | |
|---|---|
| **`blendAlpha` 0,3 → 0,5** | Kreuzvalidiert und out-of-sample nachgemessen statt in-sample abgelesen. AUC, CC und NSS haben ihr Optimum einstimmig bei 0,5, in beiden Kategorien. Siehe [Alpha-Kurve](#alpha-kurve-12-a). |
| **Befund: unsere Karten sind zu weich** | Die gemessene Aufmerksamkeit ist um **Faktor 3,4** konzentrierter als unsere Vorhersage. Die Verteilungen überlappen nicht. `blendAlpha` ist dafür der falsche Hebel — ein höheres α macht die Karten weicher, nicht schärfer. |
| **Contrastmap — die Hauptausgabe, nicht die dritte Karte** | Auf dem Onboarding-Screen stehen **8 gemessene Kontrastaussagen gegen 1 Vorhersagebefund**, auf einem Desktop-Frame **14 durchgefallene von 21 gemessenen Elementen gegen Ø 1,67 Vorhersagebefunde**. Sie braucht weder Folds noch Abschnitte noch Kandidaten noch Kalibrierung und sagt auf **jeder** Frame-Form etwas — als einzige Ausgabe des Plugins. Siehe [Contrastmap](#contrastmap-12-c). |
| **Schärfe: Blur 0,035 + `blendGamma` 1,6** | Der A1-Befund ist zu gut einem Drittel behoben, bei **besseren Werten in allen vier Metriken**, KL eingeschlossen. Der entscheidende Hebel war der, den 1.1 wegen KL ausgebaut hatte. Nicht 2,0, obwohl der Mittelwert dafür spräche: dieser Wert lässt die Gruppe stehen, für die das Plugin existiert. Siehe [Schärfe](#a6--schärfe-die-nachbearbeitung-nicht-das-mischungsverhältnis) und [A7](#a7--derselbe-mittelwert-zwei-gegenläufige-hälften). |
| **Transparenzschwelle nachgezogen** | 0,08 → 0,02. Dieselbe Schwelle hätte auf der neuen Karte 37,5 % statt 18,0 % verdeckt — ein Gutteil von „das Overlay ist leerer" war der Renderer, nicht die Vorhersage. |
| **CI grün, Gate scharf** | Sechs von sechs Läufen waren an `npm ci` gescheitert; danach lief das Gate, meldete aber „übersprungen"; und als es lief, bewachte es die **eingefrorene** 1.0-Referenz. Dreimal dieselbe Lücke. Jetzt: 40 Bilder im Repo, echte Messung bei jedem PR, und ein CI-Schritt, der beweist, dass das Gate rot werden **kann**. Die Zahlen des Gates sind **kein Qualitätsbeleg** — siehe unten. |
| **Nebenwirkungen ausgewiesen** | `competition` verdreifacht seine Feuerrate, ohne dass die Regel angefasst wurde. Nicht nachjustiert: der Umbau in B kalibriert sie neu. |
| **Erreichbarkeitstests robust** | Drei der zwölf Fälle hingen an der dritten Nachkommastelle eines Engine-Parameters. Repariert und durch einen zweiten Test abgesichert, der sie unter verstellten Parametern wiederholt. |
| **Beta-Marker im Panel** | Der Kopf zeigt „Beta v1.2" — eine Aussage über die Vorhersage, nicht über die Stabilität des Codes. Die Version kommt aus `package.json` und nur von dort; die Zahl im Kopf folgt dem Versionssprung automatisch. |

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

# 1.2 A — die Alpha-Kurve (siehe „Alpha-Kurve")
npm run alpha                                     # Sweep, Tuning-Split, kreuzvalidiert
npm run visual-check                              # die zwei Prüffälle als Bild
npm run side-effects -- --before 0.3 --after 0.5  # Feuerraten vorher/nachher
```

Die `id` in `manifest.json` ist ein lokaler Platzhalter. Beim Publishing in die
Community vergibt Figma eine echte ID, die dann eingetragen wird.

### Ein Release bauen

```bash
git tag v1.2.0 && git push origin v1.2.0
```

`.github/workflows/release.yml` baut daraufhin, prüft und hängt
`figmaps-1.2.0.zip` an ein **Release im Entwurfsstatus** — der Text
(`RELEASE.md`) wird vor der Veröffentlichung gelesen. Ein Zip, das schon
jemand geladen hat, lässt sich nicht zurückziehen.

Im Zip liegt `manifest.json` neben `build/`, sodass „Import plugin from
manifest…" direkt greift, dazu `NOTICE.md` und eine dreizeilige
`LIESMICH.txt`.

**Warum zwischen Bau und Zip eine eigene Prüfung steht
(`scripts/check-release.mjs`).** Der Ortsprior ist das einzige Stück dieses
Plugins, dessen Fehlen **still** bleibt: ohne Asset fällt die Engine auf die
analytische F-Muster-Glocke zurück — keine Meldung im Panel, kein Fehler im
Log, nur schlechtere Karten. Ein Release, das den Prior verliert, sieht
funktionierend aus. Geprüft werden deshalb die **Nutzdaten**, nicht die
Dateinamen: für jeden der zwölf Schlüssel eine Karte mit 32 × 32 dekodierten
Bytes und einem Maximum, das kein Nullfeld verrät. Dazu die CC-BY-4.0-Nennung
(über beide Realms zusammen — die Daten liegen im Hauptthread, der
Nennungstext entsteht im Panel) und die eingebetteten Schriften, die ohne
Netzzugriff sonst genauso lautlos ausfallen.

Danach wird das Zip an einem anderen Ort **wieder ausgepackt** und dort
geprüft, was Figma prüfen würde: zeigen `manifest.main` und `manifest.ui` auf
Dateien, die es gibt. Gepackt ist nicht installierbar.

Der Tag muss zur Version in `package.json` passen; ein Schritt im Workflow
bricht sonst ab. Sonst wäre die eine Stelle, an der die Version steht, wieder
zwei — und das Panel zeigte etwas anderes an, als das Release heißt.

`package-lock.json` trägt die alte Version weiter und bleibt unangetastet;
`npm ci` stört das nicht (nachgemessen, nicht angenommen). Die offene Frage am
Lockfile ist eine andere und steht unter den offenen Punkten.

---

## Bedienung

1. Frame, Component, Instance, Section oder Group auswählen (Mehrfachauswahl = Batch)
2. Maps an-/abwählen, Overlay-Deckkraft und ggf. Viewport-Höhe einstellen
3. **Maps erstellen** — Ergebnis landet in einem neuen Wrapper-Frame
   `[Figmaps] {Frame-Name} — {Betrachtungsdauer} — {Zeitstempel}` rechts daneben
4. Befunde unter dem Ergebnis lesen; **Im Canvas zeigen** springt auf die
   betroffene Ebene und wählt sie aus

### Was neben den Maps steht — und warum nicht darauf

Auf dem Screenshot steht nur die Vorhersage. Alles andere sind Textebenen im
Weißraum des Wrapper-Frames:

| wo | was |
|---|---|
| Frame-Name der Map | `Heatmap · Blick (1 s) · hybrid-v1` |
| unter dem Titel jeder Map | `Algorithmische Vorhersage, keine Messdaten · Blickverhalten: Mobile App · Betrachtungsdauer: Blick (1 s) · hybrid-v1` |
| einmal unten am Wrapper | `Datengrundlage: UEyes (Jiang et al. 2023), CC BY 4.0` |

Die beiden Anforderungen ziehen gegeneinander, und die Aufteilung ist der
Kompromiss: der **Frame-Name reist nicht mit**, wenn jemand eine einzelne Map
als PNG exportiert — deshalb steht der Disclaimer als Text im *Bildbereich*,
nicht nur in der Ebenenbenennung. Und die Map ist ein Screenshot fremder
Arbeit — deshalb liegt der Text *neben* dem Bild statt als Balken darin. Die
CC-BY-Nennung steht einmal pro Lauf statt dreimal nebeneinander.

Der Begriff **„Ortsprior" kommt im UI nicht mehr vor**. Er benannte den
Mechanismus, nicht die Sache; im Panel heißt dieselbe Auswahl „Art des
Screens", auf den Maps steht „Blickverhalten", bei der Herkunft
„Datengrundlage".

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

### Panel: Design, Theming, Bedienelemente

**Der Kopf trägt einen Beta-Marker.** Neben dem Produktnamen steht „Beta v1.2".
Der Marker ist eine Aussage über die **Vorhersage**, nicht über die Stabilität
des Codes: die Engine ist gegen einen einzigen öffentlichen Datensatz gemessen,
drei der sechs Befundregeln sind abgeschaltet, und für die eigenen Screens fehlt
weiterhin ein Validierungsset. Wer das Panel öffnet, soll das sehen, bevor er
eine Karte für eine Messung hält.

Die Zahl selbst kommt aus **`package.json` und nur von dort**; `scripts/build.mjs`
und `vitest.config.ts` setzen sie beim Bündeln als Konstante ein
(`src/version.ts`). Vorher stand sie als Literal im Code mit der Bitte, sie mit
`package.json` synchron zu halten — eine Konstante, deren Richtigkeit von einem
Kommentar abhängt, ist genau so lange richtig, bis jemand die andere Stelle
anfasst. Die Engine-Version (`hybrid-v1`) ist davon getrennt und steht weiterhin
an den Maps, nicht im Kopf: sie sagt, welche Vorhersage eine Karte erzeugt hat.

**Zwei Themes, eigener Schalter.** Im Header sitzt eine Pille mit Mond und
Sonne. Bewusst **nicht** `figma.showUI({ themeColors: true })`: die Farben des
Panels — und damit die Lesbarkeit des Disclaimers unter den Maps — sollen nicht
davon abhängen, was der Host als Nächstes tut. **Dark ist immer der Startwert**,
auch beim ersten Öffnen und wenn Figma im Light-Mode läuft; die Wahl wird in
`figma.clientStorage` gemerkt (`Settings.theme`, `ui/theme.ts`).

**Der Kontrast ist eine Zusage, keine Absicht.** Beide Paletten stehen in
TypeScript, nicht in der CSS-Datei, weil jeder Wert die Hälfte eines
Kontrastpaares ist und `ui/__tests__/theme.test.ts` **jedes tatsächlich
vorkommende Paar** gegen 4,5:1 prüft und darunter fehlschlägt. Der Anlass ist
konkret: die Fußzeile war schon einmal mit 3,93:1 und 2,41:1 ausgeliefert,
wurde behoben — und die nächste Design-Übergabe brachte exakt dieselben Werte
zurück. Gemessen, beide Themes:

| Paar | dark | light |
|---|---:|---:|
| `text` auf `bg` | 16,46:1 | 17,17:1 |
| `text-body` auf `surface` | 8,94:1 | 10,31:1 |
| `text-dim` auf `bg` | 8,25:1 | 7,37:1 |
| `text-quiet` auf `bg-footer` (die drei Fußtext-Absätze) | 5,80:1 | 5,69:1 |
| `text-quiet` auf `surface` | 5,38:1 | 5,46:1 |
| `accent-text` auf `bg` (Reglerwert) | 11,90:1 | 5,94:1 |
| `ink` auf `accent` (Knopfbeschriftung) | 11,90:1 | 11,19:1 |
| `danger` auf `bg` | 7,63:1 | 6,54:1 |

Zwei Entscheidungen dahinter:

- **Zwei Abstufungen für leise Schrift, nicht drei.** Die Übergabe hatte
  `dim`/`dim2`/`dim3`, alle drei unter der Grenze. Hebt man alle drei über
  4,5:1, rücken sie so eng zusammen, dass die dritte Stufe nur noch eine
  Gelegenheit ist, die falsche zu wählen: `text-dim` für Sekundärtext,
  `text-quiet` für die leiseste Schrift, die noch Schrift ist.
- **Das Gelb ist im Light-Theme keine Textfarbe.** `#F5C518` auf Weiß sind
  1,63:1. Es bleibt Flächenfarbe; Text, der als Akzent lesen soll, nimmt
  `accent-text` (`#7A6100`). Ein Test hält das fest. Aus demselben Grund heißt
  die Farbe *auf* dem gelben Knopf `ink` und nicht „Hintergrundfarbe" — mit
  `--bg` wäre die Beschriftung im Light-Theme weiß auf Gelb gewesen.

**Balken-Slider.** Statt Schiene und Knopf 24 Balken, deren Höhe mit dem Wert
wächst. Ein natives `input[type=range]` kann das nicht darstellen, also ist es
ein `role="slider"` — und damit liegt alles, was das native Element geschenkt
hätte, bei uns und ist Pflicht, nicht Kür: `aria-valuenow/min/max` **plus**
`aria-valuetext` (die nackte Zahl liest sich als „80", wo das Panel „80 %"
zeigt), Pfeiltasten, Home/End, Shift für den groben Schritt, ein sichtbarer
Fokusring in beiden Themes, und `setPointerCapture` — ohne das springt der Wert,
sobald der Zeiger die Leiste verlässt.

**Map-Schema.** Neben jeder Map-Zeile steht ein 56 × 88 px großes Wireframe:
vier feste Balken, darüber die für die Map typische Fläche, eine gestrichelte
Schnittlinie und die Falz-Schraffur. Es ist ein **abstrakter Screen, kein
Abbild der Auswahl** — kein Export, keine Engine, kein Caching, reines CSS.
Deshalb heißt es im UI nirgends „Vorschau"; falls es je eine Beschriftung
braucht, „Schema". Es reagiert aber auf die Einstellungen, sonst wäre es
Dekoration statt Erklärung: Overlay-Deckkraft steuert die Schicht,
Viewport-Höhe die Schnittlinie und die Schraffur, eine abgeschaltete Map dimmt
das Ganze.

**Schriften.** Manrope und JetBrains Mono, je ein Latin-Subset, zusammen 56 KB,
als base64 in `build/ui.html`. `networkAccess` steht auf `"none"` — nachladen
ist nicht möglich, alles muss ins Bundle. Die 12 woff2-Dateien aus der
Design-Übergabe (~140 KB, alle Unicode-Bereiche) wurden **nicht** übernommen.

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
│  └─ folds.ts             B-2  gestrichelte Fold-Marker
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
Vorhersage = norm(Ortsprior)  +  0,5 · norm(Bildanalyse)
```

- **Ortsprior:** je eine 32 × 32-Graustufen-Map für Webpage und Mobile UI,
  gemittelt über die 468 Bilder des **Tuning**-Splits. Base64 im Bundle,
  **1,3 kB pro Map** (Budget: 50 kB). Kein PNG-Decoder, kein Asset-Loader, kein
  `atob` — die Figma-Main-Thread-Umgebung garantiert keines davon.
- **Rastergröße:** gemessen, nicht geschätzt. Ein Ortsprior ist glatt; schon
  16 × 16 erreicht denselben CC wie 128 × 128. 32 × 32 ist mit Reserve gewählt.
- **α = 0,5 seit 1.2**, vorher 0,3. Der alte Wert war in-sample abgelesen und
  an einem einzigen Kriterium entschieden (KL gegen die Mean Map). Kreuzvalidiert
  und out-of-sample nachgemessen liegt das Optimum von AUC, CC und NSS
  einstimmig bei 0,5, in beiden Kategorien. Siehe
  [Alpha-Kurve](#alpha-kurve-12-a) — dort steht auch, warum KL dabei nicht das
  Kriterium ist und was der Wechsel **nicht** behebt.
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

## Alpha-Kurve (1.2 A)

```bash
npm run alpha                                    # Sweep, Tuning-Split, kreuzvalidiert
npm run alpha -- --confirm-only --chosen 0.5     # der eine Blick auf den Test-Split
npm run visual-check                             # A4, die zwei Prüffälle als Bild
npm run side-effects -- --before 0.3 --after 0.5 # A5, Feuerraten vorher/nachher
```

`blendAlpha` stand seit 1.1 auf 0,3 — und zwar aus einem einzigen Grund: bei 0,5
verlor KL gegen die Mean Map, und S-2 verlangte einen Sieg in allen vier
Metriken. Der Wert war damit an der schwächsten der vier Metriken aufgehängt,
in-sample abgelesen und nie gegen eine Alternative geprüft. Das ist hier
nachgeholt.

**Ergebnis vorweg: 0,5, einstimmig in AUC, CC und NSS, in beiden Kategorien.**
Und ein zweiter Befund, der wichtiger ist als der erste: der Verdacht, unsere
Karten seien systematisch zu weich, **stimmt** — aber `blendAlpha` ist nicht das
Mittel dagegen. Ein höheres α macht die Karten *weicher*, nicht schärfer.

### Wie gemessen wurde

5-fache Kreuzvalidierung, aber **nur auf dem Tuning-Split** (468 Bilder je
Kategorie), nicht wie `npm run crossval` über Tuning + Test zusammen. Der
Unterschied ist Absicht: `crossval` *berichtet* ein Ergebnis, hier wird ein
Parameter *entschieden*, und dafür darf der Test-Split nicht mitlaufen. Pro Fold
werden Ortsprior **und** Mean-Map-Baseline ausschließlich aus den übrigen vier
Folds geschätzt, der Prior inklusive 8-Bit-Quantisierung auf 32 × 32 — also in
der Form, die ausgeliefert wird.

Der Sweep rechnet den Bildanteil einmal je Bild und mischt ihn danach für jeden
α-Wert neu; dass diese Abkürzung Zeichen für Zeichen dieselbe Mischung ergibt
wie `combineFeatureParts`, ist in `eval/__tests__/alpha.test.ts` festgenagelt.
Eine Abkürzung, die still von der Engine wegdriftet, wäre genau der Fehler, für
den A-1 existiert.

### A1 — sind unsere Karten weicher als die Wirklichkeit?

Gemessene Größe: **Anteil der Gesamtmasse in den stärksten 5 % der Pixel.** Eine
gleichmäßige Karte liegt bei 0,05, eine mit einem einzigen scharfen Blickfang
nahe 1. Beide Seiten werden vorher identisch normiert (Minimum *und* Maximum) —
die Größe ist invariant gegen Skalierung, aber nicht gegen einen Sockel.

| Webpage | p5 | p25 | Median | p75 | p95 | Mittel |
|---|---:|---:|---:|---:|---:|---:|
| **UEyes Ground Truth** | 0,278 | 0,383 | 0,483 | 0,578 | 0,681 | **0,482** |
| Vorhersage, α = 0,3 (bisher) | 0,120 | 0,127 | 0,136 | 0,150 | 0,167 | 0,141 |
| Vorhersage, α = 0,5 (jetzt) | 0,110 | 0,118 | 0,128 | 0,148 | 0,167 | 0,133 |
| Vorhersage, α = 1,2 | 0,092 | 0,102 | 0,115 | 0,147 | 0,167 | 0,124 |
| nur Ortsprior (α = 0) | | | | | | 0,164 |
| Mean-Map-Baseline | | | | | | 0,165 |

Mobile UI liegt gleichartig: Ground Truth 0,383, Vorhersage 0,145 (α = 0,3) bzw.
0,138 (α = 0,5).

**Der Verdacht ist bestätigt, und deutlicher als erwartet.** Die gemessene
Aufmerksamkeit ist um den **Faktor 3,4** konzentrierter als unsere Vorhersage
(Webpage; Mobile 2,6). Die beiden Verteilungen überlappen praktisch nicht: das
95. Perzentil unserer Vorhersage (0,167) liegt unter dem 5. Perzentil der Ground
Truth (0,278). Es gibt kein einziges Bild, auf dem unsere Karte so scharf ist
wie eine durchschnittliche echte.

**Warum das in AUC kaum sichtbar ist.** AUC-Judd bewertet die *Reihenfolge* der
Pixel, nicht die Schärfe der Verteilung. Eine Karte, die dieselben Stellen
richtig einsortiert, sie aber alle breit verschmiert, bekommt denselben Wert.
CC und NSS sind ebenfalls weitgehend blind dafür — CC ist gegen lineare
Reskalierung invariant, NSS z-normiert. Von den vier Metriken bestraft **nur KL**
diesen Fehler, und KL ist genau die Metrik, an der die 0,3 hing. Das ist kein
Zufall, sondern die Erklärung: der alte Wert war für die falsche Eigenschaft
optimiert.

Der Befund war im Ansatz schon da — „die gemessene Aufmerksamkeit ist vertikal
um Faktor 1,5 enger konzentriert" (siehe [Kontaktbogen](#was-der-kontaktbogen-zeigt)).
Vertikal um 1,5 und insgesamt um 3,4 sind aber zwei verschiedene Größenordnungen
von Problem.

### A2 — der Sweep

Webpage, 468 Bilder, out-of-sample:

| α | AUC-Judd ↑ | CC ↑ | NSS ↑ | KL ↓ | Konzentration |
|---|---:|---:|---:|---:|---:|
| 0 (nur Prior) | 0,768 | 0,420 | 0,991 | 1,088 | 0,164 |
| 0,3 | 0,780 | 0,443 | 1,049 | **1,078** | 0,141 |
| **0,5** | **0,783** | **0,447** | **1,061** | 1,091 | 0,133 |
| 0,8 | 0,782 | 0,444 | 1,055 | 1,111 | 0,127 |
| 1,2 | 0,777 | 0,431 | 1,028 | 1,133 | 0,124 |
| Mean Map (je Fold) | 0,766 | 0,420 | 0,990 | 1,090 | 0,165 |

Mobile UI, 468 Bilder — derselbe Verlauf, dasselbe Optimum:

| α | AUC-Judd ↑ | CC ↑ | NSS ↑ | KL ↓ | Konzentration |
|---|---:|---:|---:|---:|---:|
| 0 (nur Prior) | 0,766 | 0,507 | 0,995 | 0,795 | 0,164 |
| 0,3 | 0,779 | 0,546 | 1,076 | **0,774** | 0,145 |
| **0,5** | **0,781** | **0,552** | **1,091** | 0,785 | 0,138 |
| 0,8 | 0,779 | 0,545 | 1,080 | 0,805 | 0,133 |
| 1,2 | 0,771 | 0,523 | 1,042 | 0,829 | 0,130 |
| Mean Map (je Fold) | 0,764 | 0,507 | 0,995 | 0,796 | 0,164 |

Gepaart je Bild gegen α = 0,3, 95-%-Intervalle ohne Null in allen sechs Fällen:

| | ΔAUC | ΔCC | ΔNSS |
|---|---:|---:|---:|
| Webpage | +0,0025 (t = 7,0) | +0,0040 (t = 4,7) | +0,0117 (t = 5,8) |
| Mobile UI | +0,0018 (t = 4,5) | +0,0061 (t = 5,5) | +0,0149 (t = 6,9) |

**Verlängert wurde nicht.** Die Kurve fällt nach 0,5 in allen drei
Entscheidungsmetriken, in beiden Kategorien — die Bedingung „falls die Kurve am
Ende noch steigt" ist nicht erfüllt. Der Sweep prüft das selbst
(`stillRising` in `eval/alpha.ts`) und hätte automatisch verlängert.

**Der Gewinn ist klein und soll klein aussehen.** +0,004 CC ist ein Fünftel
dessen, was der Ortsprior gebracht hat. Er ist belastbar, aber er ist keine
neue Fähigkeit — er ist das Aufräumen einer Entscheidung, die an der falschen
Metrik hing. Bei Webpage liegt die **Trefferquote in CC sogar bei 44,2 %**: der
Mittelwert steigt, die Mehrheit der Einzelbilder wird leicht schlechter und eine
Minderheit deutlich besser. Bei Mobile ist es einheitlicher (56,6 %).

### A3 — warum KL nicht entscheidet

**Ausdrücklich und nicht stillschweigend:** KL wird berichtet, aber es
entscheidet nicht. Der Grund ist kein Ausweichen vor einer unbequemen Zahl,
sondern dass KL genau die Eigenschaft bestraft, die hier geprüft wird. KL misst,
wie viel Masse die Vorhersage dort liegen lässt, wo die Ground Truth Masse hat.
Eine zugespitzte Karte räumt die Ränder leer und wird dafür voll bestraft —
Zuspitzung ist aber die *gesuchte* Eigenschaft (A1). KL als Kriterium hieße, die
Frage mit der Antwort zu beantworten.

Der Preis steht in jeder Tabelle: KL wird von 1,078 auf 1,091 (Webpage) bzw.
0,774 auf 0,785 (Mobile) schlechter. Das ist die Zeile, die man zitieren muss,
wenn man diese Entscheidung angreifen will.

**Der historische Grund für 0,3 hält der Nachmessung nicht stand.** Gepaart je
Bild und out-of-sample ist KL bei α = 0,5 gegen die Mean Map **kein Verlust,
sondern ein Unentschieden** — Webpage −0,0014, Mobile +0,0112, beide Intervalle
enthalten die Null. Der alte Vergleich war in-sample und über Mittelwerte statt
gepaart:

| α | ΔAUC | ΔCC | ΔNSS | ΔKL | |
|---|---:|---:|---:|---:|---|
| 0,3 | +0,0137 | +0,0233 | +0,0590 | +0,0123 | alle vier besser |
| 0,5 | +0,0163 | +0,0273 | +0,0706 | −0,0014 | KL unentschieden |
| 0,8 | +0,0159 | +0,0235 | +0,0646 | −0,0212 | KL belastbar schlechter |
| 1,2 | +0,0109 | +0,0108 | +0,0376 | −0,0427 | KL belastbar schlechter |

(Webpage, gegen die Mean Map des jeweiligen Folds.)

Damit bleibt **S-2 erfüllt**: `hybrid-v1` mit α = 0,5 schlägt die Mean Map in
AUC, CC und NSS belastbar und verliert in KL nicht.

### Der Test-Split, einmalig

Je 27 Bilder, mit dem **ausgelieferten** Prior statt einem Fold-Prior — hier
soll stehen, was das Plugin tut:

| | AUC | CC | NSS | KL | Konz. |
|---|---:|---:|---:|---:|---:|
| Webpage α = 0,3 | 0,796 | 0,464 | 1,153 | 1,111 | 0,139 |
| Webpage α = 0,5 | 0,797 | 0,463 | 1,152 | 1,136 | 0,132 |
| Mobile α = 0,3 | 0,794 | 0,547 | 1,171 | 0,834 | 0,144 |
| Mobile α = 0,5 | 0,794 | 0,548 | 1,181 | 0,853 | 0,137 |

**Der Test-Split kann diese Frage nicht beantworten, und das ist die ehrliche
Auskunft.** Alle drei Entscheidungsmetriken zeigen Differenzen, deren
95-%-Intervalle die Null einschließen (z. B. Webpage ΔCC −0,0010 [−0,0090,
+0,0070]). Das halbe Intervall ist mit ±0,008 doppelt so breit wie der Effekt,
den die Kreuzvalidierung über 468 Bilder gemessen hat (+0,004). 27 Bilder können
einen Unterschied dieser Größe nicht auflösen — der Lauf widerlegt ihn also
nicht, er ist nur blind dafür. Nur KL ist auch hier belastbar schlechter
(t = −3,4 bzw. −3,3), was die Erwartung bestätigt.

Die Konzentration bestätigt sich unabhängig davon: Ground Truth 0,505 (Webpage)
bzw. 0,412 (Mobile) gegen 0,132–0,144 in der Vorhersage.

### A4 — die zwei Prüffälle am Bild

Ein Onboarding-Screen, 393 × 852, vier Kategorie-Kacheln, ein gelber CTA unten
(`eval/onboarding.ts`). **Konstruiert, nicht beobachtet** — der Zweck ist, zwei
Fragen mit *bekannter* Antwort zu stellen. Keine Zahl von hier gehört in eine
Feuerrate.

![A4 — Onboarding-Prüffall über den Alpha-Sweep](assets/messungen/a4-onboarding.png)

Links das Original, dann α = 0,3 / 0,5 / 0,8 / 1,2.

| Element | α = 0,3 | α = 0,5 | α = 0,8 | α = 1,2 |
|---|---|---|---|---|
| dunkle Kachel „Nachrichten", Spitze | 0,569 gelbgrün | 0,591 gelbgrün | 0,619 gelbgrün | 0,655 **warm** |
| gelber CTA unten, Spitze | 0,287 **blau** | 0,370 türkis | 0,460 türkis | 0,542 gelbgrün |

**Die Bilder und die Zahlen sind sich nicht einig, und das wird hier nicht
aufgelöst.** Die Metriken haben ihr Optimum bei 0,5 und fallen danach; die
beiden Prüfelemente werden aber erst jenseits von 0,8 sichtbar wärmer. Der gelbe
CTA erreicht auf **keinem** der geprüften Werte „heiß" — bei 1,2 liegt seine
Spitze bei 0,542, also gelbgrün, im 70. Perzentil der Karte. Die dunkle Kachel
wird erst bei 1,2 warm.

Was dagegen bei jedem α gleich bleibt: die Überschrift dominiert den Screen, und
der Rang des CTA unter den Klick-Kandidaten steht unverändert auf 5 von 6. Der
Parameter verschiebt Helligkeit, keine Rangfolge.

**Deutung, ohne den Konflikt wegzuräumen.** Beide Beobachtungen zeigen in
dieselbe Richtung wie A1: was hier fehlt, ist nicht Gewicht, sondern *Schärfe*.
Ein höheres α hebt den ganzen Bildanteil an — die Kachel wird wärmer, der
Hintergrund aber auch, und die Konzentration sinkt dabei sogar (0,141 → 0,124).
Die Bilder verlangen also nicht nach einem größeren α, sondern nach einem
Bildanteil, der überhaupt selektiver ist. Das ist eine andere Baustelle
(Nachbearbeitung: `blurSigmaRatio`, `gamma`, Perzentil-Clip — oder ein anderes
Modell) und ausdrücklich **nicht** in diesem Schritt erledigt.

### A5 — was der Wechsel an den Befundregeln verändert hat

Die Schwellen von `cta-rank`, `competition` und `cold-fold` sind auf der Karte
mit α = 0,3 kalibriert. Keine Zeile in `rules.ts` wurde angefasst, trotzdem:

| Regel | Population | α = 0,3 | α = 0,5 |
|---|---|---:|---:|
| `cta-rank` | Desktop scrollend / Telefon 1 VP / Telefon scrollend | 66,7 % | 66,7 % |
| `competition` | UEyes Webseiten (Viewport 500 erzwungen) | 2,2 % | **11,9 %** |
| `competition` | UEyes Telefon-Screens (ein Viewport) | 10,3 % | **31,1 %** |
| `competition` | Telefon, ein Viewport (konstruiert) | 0,0 % | 20,8 % |
| `competition` | Telefon scrollend (konstruiert) | 0,0 % | 20,8 % |
| `competition` | Desktop scrollend (konstruiert) | 0,0 % | 8,3 % |
| `cold-fold` | UEyes Webseiten (Viewport 500 erzwungen) | 27,7 % | **34,9 %** |
| `cold-fold` | Desktop scrollend (konstruiert) | 83,3 % | 95,8 % |
| `cold-fold` | Telefon scrollend (konstruiert) | 100,0 % | 100,0 % |

`cta-rank` ist unbeeindruckt, und das ist erwartbar: die Regel vergleicht Ränge,
und der Parameter verschiebt keine Rangfolgen (dasselbe Bild wie in A4).

**`competition` verdreifacht seine Quote.** Der Grund steht in der Verteilung:
die Entscheidungsgröße ist Tal ÷ zweites Maximum, und der stärker gewichtete
Bildanteil senkt die Fläche *zwischen* zwei Blickfängen ab. Auf Telefon-Screens
fällt der Median von 1,002 auf 0,967 und das 5. Perzentil von 0,848 auf 0,703 —
die Schwelle 0,9 liegt damit plötzlich mitten in der Verteilung statt an ihrem
unteren Rand.

**Nicht nachjustiert, mit Absicht.** 0,9 jetzt an die neue Verteilung
anzupassen wäre eine zweite unkalibrierte Bewegung im selben Schritt. Die Regel
wird in 1.2 B1 ohnehin umgebaut — der Mindestabstand wandert von einem Anteil
der Kartenbreite auf die Diagonale oder auf getrennte x/y-Schwellen — und
**danach** neu kalibriert, auf der Karte mit α = 0,5. Genau dafür steht A vor B.

Bei `cold-fold` ist die Bewegung kleiner, aber die konstruierte Desktop-Form
landet mit 95,8 % nahe bei „feuert immer". Auf echten Bildern bleibt die Regel
mit 34,9 % im brauchbaren Bereich; 0,08 ist trotzdem neu zu bewerten, und dafür
fehlt weiterhin das Set mit echten Layer-Bäumen.

**Ein vierter Effekt, außerhalb der Tabelle.** Der Erreichbarkeitstest von
`cta-below-fold` (nicht ausgeliefert) schlug nach dem Wechsel fehl. Die Ursache
war nicht die Regel, sondern der Testaufbau: der CTA unter dem Fold gewann dort
mit 0,5227 gegen 0,4773 — vier Tausendstel —, und das Verhältnis kippt schon bei
α ≈ 0,35. „Diese Regel ist erreichbar" hing damit an der dritten
Nachkommastelle eines Engine-Parameters. Der Wettbewerber steht jetzt dort, wo
ein Impressum-Link wirklich steht, unten rechts im ersten Viewport; der CTA
führt damit über den ganzen geprüften Alpha-Bereich. Siehe
`findings/__tests__/end-to-end.test.ts`.

### Das Regressions-Gate — was seine Zahlen sagen und was nicht

Seit 1.2 liegen 40 Bilder im Repo (`eval/fixtures/gate-web`, `gate-mobile`), und
das Gate vergleicht bei jedem PR den CC der ausgelieferten Konfiguration gegen
`main`. Es meldet zum Beispiel:

```
gate-web     CC 0,4735 vs main 0,4561  (Δ +0,0174)
gate-mobile  CC 0,5720 vs main 0,5543  (Δ +0,0177)
```

**Diese Zahlen sind kein Beleg für Genauigkeit, und sie dürfen nie als einer
zitiert werden.** Der Grund ist nicht die Größe des Sets, sondern seine
Verwendung: es nimmt 20 der 27 Test-Split-Bilder je Kategorie und läuft bei
jedem PR **mit sichtbarem Ergebnis**. Wer eine Änderung so lange dreht, bis der
Check grüner wird, hat auf diesem Set kalibriert — der Split ist damit
Rückkopplung, nicht Beleg.

Das ist der Preis des Aufbaus und nicht sein Fehler: ein Gate, dessen Zahl man
nicht sieht, ist kein Gate. Deshalb steht hier eine Regel statt einer
Gegenmaßnahme:

> Das Gate beantwortet **„ist etwas kaputtgegangen"**. Es beantwortet **nicht**
> „wie gut ist es". Jede Aussage über Güte kommt aus der Kreuzvalidierung über
> 495 Bilder je Kategorie — und aus nichts anderem.

Derselbe Absatz steht im `index.json` beider Sets, gleichrangig neben den drei
anderen nicht verhandelbaren Eigenschaften (nur Test-Split, nur 3 s, auf dem
Analyseraster), damit ihn auch findet, wer nur die Daten ansieht.

### A6 — Schärfe: die Nachbearbeitung, nicht das Mischungsverhältnis

```bash
npm run sharpness                       # zwei Stufen, kreuzvalidiert
npm run visual-check -- --sharp vor-a6  # der Prüffall, vorher gegen nachher
```

A1 hat den Befund geliefert und `blendAlpha` als Hebel ausgeschlossen. Was die
*Form* der Verteilung bestimmt, sind die Schritte danach — und einer davon
existierte in 1.1 gar nicht mehr:

| Hebel | wo er sitzt | Stand 1.1 |
|---|---|---|
| `post.blurSigmaRatio` | Weichzeichnung des Bildanteils | 0,025 |
| `post.gamma` | Tonkurve **innerhalb** des Bildanteils | 0,8 |
| `post.clip{Low,High}Percentile` | Sockel und Sättigung des Bildanteils | p1 / p99 |
| `blendGamma` | Tonkurve über der **fertigen** Karte | **ausgebaut** |

Der vierte ist der eigentliche Anlass. Er wurde beim Einbau von `hybrid-v1`
entfernt, **weil er KL verschlechterte** (1,115 statt 1,078) — nach genau dem
Kriterium, das bei einer Frage nach Zuspitzung nicht entscheiden darf. Er ist
als Parameter zurück, mit `undefined` = Verhalten von 1.1, und wurde an AUC,
CC und NSS gemessen.

Aufbau: erst ein Hebel nach dem anderen (vier lesbare Kurven statt einer
Punktwolke), dann Kombinationen aus dem, was übrig blieb. Kreuzvalidiert auf dem
Tuning-Split, Ortsprior je Fold, 468 Bilder je Kategorie.

#### Was die Einzelhebel ergeben (Webpage)

| Hebel | Wert | AUC | CC | NSS | KL | Konzentration | Urteil |
|---|---|---:|---:|---:|---:|---:|---|
| — | **Ist-Zustand** | 0,783 | 0,447 | 1,061 | 1,091 | 0,133 | — |
| Blur | 0,006 | 0,778 | 0,440 | 1,044 | 1,089 | 0,139 | verloren |
| Blur | 0,015 | 0,781 | 0,444 | 1,054 | 1,090 | 0,136 | verloren |
| Blur | **0,035** | 0,784 | 0,449 | 1,063 | 1,094 | 0,131 | **besser** |
| `post.gamma` | 1,4 | 0,782 | 0,450 | 1,067 | 1,065 | 0,143 | verloren |
| `post.gamma` | 2,0 | 0,781 | 0,450 | 1,067 | 1,055 | 0,150 | verloren |
| Clip | p20/p99 | 0,782 | 0,448 | 1,062 | 1,074 | 0,140 | besser |
| Clip | p40/p99 | 0,781 | 0,449 | 1,066 | 1,058 | 0,148 | verloren |
| `blendGamma` | **1,6** | 0,783 | 0,456 | 1,083 | 1,038 | 0,188 | **besser** |
| `blendGamma` | 2,0 | 0,783 | 0,454 | 1,080 | 1,055 | 0,225 | **besser** |
| `blendGamma` | 2,5 | 0,783 | 0,448 | 1,066 | 1,117 | 0,270 | gehalten |
| `blendGamma` | 3,5 | 0,783 | 0,430 | 1,025 | 1,337 | 0,353 | verloren |

„Verloren" heißt: das 95-%-Intervall einer der drei gepaarten Differenzen liegt
ganz unter der Null. Bei 468 Bildern ist das ein strenges Kriterium — `post.gamma`
1,4 gewinnt 0,003 CC und verliert 0,001 AUC, und das reicht.

**Drei Befunde, von denen zwei überraschen:**

1. **Schärfer zeichnen hilft nicht.** Blur 0,006 bis 0,020 verlieren in allen
   drei Hauptmetriken, monoton, in beiden Kategorien. Der Bildanteil ist kein
   Detailkanal — was er beiträgt, ist grobe Struktur. Der einzige Blur-Wert, der
   hält, ist der **größere**.
2. **`post.gamma` und der Clip sind Sackgassen.** Beide erhöhen die
   Konzentration und kosten dabei zuverlässig ein bis zwei Tausendstel AUC. Sie
   spitzen den *Bildanteil* zu, und der ist mit α = 0,5 nur die halbe Miete —
   der Ortsprior bleibt so weich wie vorher.
3. **`blendGamma` ist der Hebel.** Er sitzt über der fertigen Karte, nimmt den
   Prior also mit. Bei 2,0 steigt die Konzentration von 0,133 auf 0,225, ohne
   dass eine der drei Metriken leidet — und **KL wird besser**, nicht
   schlechter. Der 1.1 entfernte Gamma-Wert war ein *glättender* (unter 1); ein
   zuspitzender ist nie gemessen worden.

Auf Mobile derselbe Verlauf. Die Obergrenze ist gemessen, nicht gewählt: bei
`blendGamma` 2,5 hält Webpage noch (Konzentration 0,270), Mobile verliert CC
belastbar (0,538 gegen 0,552). 2,0 ist damit der größte Wert, der **im
Mittel** keine Metrik kostet — welcher Wert ausgeliefert wird, entscheidet
allerdings nicht der Mittelwert, sondern die Aufteilung im Abschnitt danach.

#### Die Kombination, und warum sie gegenläufig ist

| | AUC | CC | NSS | KL | Konzentration |
|---|---:|---:|---:|---:|---:|
| **Webpage**, Ist-Zustand | 0,783 | 0,447 | 1,061 | 1,091 | 0,133 (0,28× GT) |
| Webpage, Blur 0,035 + `blendGamma` 2 | **0,784** | **0,456** | **1,083** | **1,049** | **0,221** (0,46× GT) |
| **Mobile**, Ist-Zustand | 0,781 | 0,552 | 1,091 | 0,785 | 0,138 (0,36× GT) |
| Mobile, Blur 0,035 + `blendGamma` 2 | **0,783** | **0,557** | **1,115** | **0,728** | **0,247** (0,64× GT) |

**Alle vier Metriken verbessern sich, KL eingeschlossen.** Die Zuspitzung wird
hier nicht mit Vorhersagegüte bezahlt — sie bringt welche mit. Das ist der
Unterschied zu A2, wo jeder Gewinn an AUC/CC/NSS mit KL bezahlt wurde.

Der Mechanismus ist gegenläufig und deshalb erklärungsbedürftig: die
**Bildanalyse wird weicher gezeichnet, das Ergebnis härter angezogen**. Ein
glatterer Bildanteil passt besser zu einer Ground Truth, die selbst aus
überlagerten Blickpunkten besteht; die Schärfe kommt danach aus der Tonkurve
über der fertigen Karte, wo sie den Ortsprior mitnimmt statt ihn zu umgehen.

### A7 — derselbe Mittelwert, zwei gegenläufige Hälften

```bash
npm run groups -- --gammas 0.3,1.3,1.6,2.0
```

Die Tabelle oben mittelt über alle Bilder, und ein Mittelwert kann zwei
gegenläufige Effekte verdecken. Für den Verdacht gibt es hier einen konkreten
Anlass: die Mean-Map-Diagnose teilt den Datensatz in zwei Gruppen — Screens,
auf denen unsere Vorhersage die (fold-eigene) Mean Map schlägt, und die
übrigen. **Die erste Gruppe ist die, für die das Plugin existiert.** Wo ein
Ortsprior schon reicht, ist unsere Vorhersage ein Prior mit Zierrat; dort
besser zu werden ist billig.

Die Gruppen werden **einmal** im Zustand vor der Schärfe-Änderung bestimmt und
dann festgehalten. Würde die Zugehörigkeit je Gamma-Wert neu berechnet,
verglichen man zwei Populationen statt zwei Konfigurationen.

ΔCC gegen „kein Gamma", je Gruppe:

| γ | Webpage, Gewinner (326) | Webpage, übrige (142) | Mobile, Gewinner (351) | Mobile, übrige (117) |
|---|---:|---:|---:|---:|
| 0,3 | −0,0492 | −0,0594 | −0,0550 | −0,0634 |
| 1,3 | +0,0058 | +0,0092 | +0,0057 | +0,0076 |
| **1,6** | **+0,0072** | +0,0134 | **+0,0055** | +0,0087 |
| 2,0 | +0,0051 | +0,0141 | **−0,0007** | +0,0034 |

**Der Verdacht bestätigt sich.** In jeder Zeile gewinnt die Gewinner-Gruppe
weniger als die andere, und der Abstand wächst mit γ. Bei 2,0 **verschwindet
der Gewinn für die Gewinner auf Mobile ganz** (−0,0007, Intervall über der
Null), während die übrigen weiter zulegen; auf Webpage bekommt die Gruppe noch
ein Drittel dessen, was die andere bekommt. Bei **1,6 gewinnen beide Gruppen in
beiden Kategorien**, jedes 95-%-Intervall ohne Null.

**Ausgeliefert wird deshalb 1,6, nicht 2,0.** Der Mittelwert spricht für 2,0;
die Aufteilung sagt, dass dieser Mittelwert von der Hälfte kommt, auf die es
weniger ankommt. Gekostet wird das mit Konzentration — 0,188/0,207 statt
0,221/0,253 — und damit schließt sich die Lücke zur Ground Truth zu **gut einem
Drittel** statt zur Hälfte: Faktor 3,6 → 2,6 (Webpage), 2,8 → 1,9 (Mobile).

**Woran sich die Gruppen wirklich unterscheiden.** „Hero-dominiert" ist ein
Etikett aus der visuellen Lesung des Kontaktbogens, nicht aus einer Messung —
siehe [Wo Figmaps die Mean Map schlägt](#wo-figmaps-die-mean-map-schlägt).
Gemessen trennt sie **die vertikale Lage der Aufmerksamkeit**: Schwerpunkt y
0,382 gegen 0,296, Masse im oberen Drittel 45,1 % gegen 62,7 %. Die
Konzentration ihrer Ground Truth trennt sie **nicht** (0,479 gegen 0,488 hier
nachgemessen, 47,3 % gegen 48,5 % in der Diagnose vom 8.8.), das
Seitenverhältnis auch nicht.

Das passt zum Befund oben, statt ihm zu widersprechen: der Ortsprior ist
oben-lastig, und `blendGamma` zieht die Karte in Richtung ihrer stärksten
Stellen — also nach oben. Genau dort steht bei der Gewinner-Gruppe **nicht**,
worauf geschaut wird. Deshalb kostet ein zu großes Gamma sie ihren Gewinn,
während es der anderen Gruppe hilft.

γ unter 1 ist nebenbei eindeutig erledigt: 0,3 kostet rund 0,05 CC in jeder
Gruppe und Kategorie. Der 1.1 wegen KL ausgebaute Wert war ein solcher.

Ausgeliefert wird das als eigener Block `ENGINE_CONFIG.hybrid`, **nicht** in
`post`: `HEURISTIC_V1` liest `post` und ist die eingefrorene 1.0-Referenz des
Harness. Würde sie mitwandern, verschöbe jede Messung an der aktiven
Konfiguration ihre eigene Vergleichsbasis.

#### Die Prüffälle sagen etwas anderes — auch das bleibt stehen

![A6 — Onboarding-Prüffall, neu gegen alt](assets/messungen/a6-schaerfe-onboarding.png)

Links das Original, Mitte der neue Stand, rechts der alte.

| Element (Spitzenwert) | vor A6 | nach A6 |
|---|---|---|
| dunkle Kachel „Nachrichten" | 0,591 gelbgrün | 0,388 türkis/grün |
| gelber CTA unten | 0,370 türkis/grün | 0,133 **kalt (dunkelblau)** |

**Beide Prüfelemente werden kälter, nicht wärmer.** Auf 936 echten Screens ist
die Karte in allen vier Metriken besser geworden; auf dem konstruierten
Prüffall sind genau die zwei Elemente, nach denen A4 fragt, deutlicher aus dem
Bild verschwunden. Beides ist wahr, und es wird hier nicht aufgelöst.

Was die Bilder zeigen: die neue Karte ist **selektiv**. Sie setzt fast alles auf
die Überschrift und lässt den Rest fallen — und die Überschrift ist auf einem
Screen dieses Typs auch das, wohin die gemessene Aufmerksamkeit geht. Die alte
Karte war überall lauwarm und hat damit *keine* Aussage gemacht, die man hätte
widerlegen können. Ob eine Karte, die den CTA klar als kalt ausweist, das
bessere Produkt ist als eine, die ihn milde grün färbt, ist eine Frage, die
UEyes nicht beantwortet: der Datensatz enthält keinen Screen dieser Art mit
bekannter Antwort.

#### Nebenwirkungen, zum zweiten Mal gemessen

Dieselbe Prüfung wie A5, jetzt für die Nachbearbeitung — über **alle sechs**
Regeln statt nur die drei ausgelieferten (`flat` liest den Bildanteil direkt,
und der Blur formt genau den) und mit einer zweiten echten Population für
`cold-fold`: Telefon-Screens mit erzwungener Segmentierung. Ohne die gäbe es
für die Regel genau *eine* echte Population, und eine Quote aus einer einzigen
Population ist keine Quote, sondern eine Beobachtung.

| Regel | Population | vor A6 | jetzt | seit 1.1 |
|---|---|---:|---:|---|
| `cta-rank` | alle drei konstruierten Formen | 66,7 % | 66,7 % | unverändert |
| `competition` | UEyes Telefon, ein Viewport | 31,1 % | **22,4 %** | 10,3 % → 22,4 % |
| `competition` | UEyes Webseiten, segmentiert | 11,9 % | 10,3 % | 2,2 % → 10,3 % |
| `competition` | UEyes Telefon, segmentiert | 6,3 % | 2,6 % | — |
| `cold-fold` | UEyes Webseiten, segmentiert | 34,9 % | **40,0 %** | 27,7 % → 40,0 % |
| `cold-fold` | UEyes Telefon, segmentiert | 58,6 % | **61,6 %** | — |
| `cold-fold` | Desktop scrollend (konstruiert) | 95,8 % | 100,0 % | 83,3 % → 100,0 % |
| `flat` (nicht ausgeliefert) | UEyes Webseiten, segmentiert | 15,2 % | 22,2 % | — |
| `dead-cta` (nicht ausgeliefert) | Desktop scrollend (konstruiert) | 83,3 % | 100,0 % | — |
| `cta-below-fold` (nicht ausgeliefert) | alle | 0,0 % | 0,0 % | unverändert |

**`competition` bewegt sich zurück.** Die Zuspitzung senkt die Fläche *neben*
den Blickfängen stärker als die zwischen ihnen, das Tal-Verhältnis steigt
wieder. Über beide Schritte von 1.2 bleibt eine Verdopplung stehen (10,3 % →
22,4 % auf Telefon-Screens) — die Regel ist damit zweimal auf einer Karte
gemessen worden, für die sie nicht kalibriert wurde. B1 baut sie um und
kalibriert danach neu; bis dahin ist keine dieser Zahlen eine Schwelle.

##### `cold-fold`: die Rate steigt auch auf echten Daten — der Befund steht aber in der Verteilung

Auf echten UEyes-Daten klettert sie mit, in beiden Populationen und in beiden
Schritten: Webseiten 27,7 % → 34,9 % → **40,0 %**, Telefon-Screens 58,6 % →
**61,6 %**. Die 100 % auf der konstruierten Desktop-Form bleiben ein Artefakt
des Aufbaus — dort steht der Hero absichtlich weiter unten, die Quote ist die
der Konstruktion, nicht die der Regel.

Wichtiger als die Rate ist, **wo die Schwelle in der Verteilung sitzt**. Der
relative Vorsprung des stärksten Abschnitts liegt

| Population | p5 | Median | p95 | Schwelle 0,08 |
|---|---:|---:|---:|---|
| UEyes Webseiten, segmentiert | −0,172 | 0,037 | 0,318 | **über** dem Median |
| UEyes Telefon, segmentiert | −0,129 | 0,131 | 0,502 | **unter** dem Median |

Auf Telefon-Screens sagt die Regel damit häufiger ja als nein, und zwar nicht
knapp. 0,08 stammt aus der Webseiten-Verteilung und ist auf der
Telefon-Verteilung nie geprüft worden — **dieselbe Fehlerklasse wie bei `flat`,
nur dass die Schwelle diesmal zwischen Populationen wandert statt zwischen
Konfigurationen.** Eine Schwelle je UI-Typ, wie `flat` sie schon hat, ist der
naheliegende Umbau; er gehört zu 1.2 B und braucht eine eigene Messung. Bis
dahin gilt: von den zwei belastbaren Regeln ist eine auf der Hälfte ihrer
Population unkalibriert.

**`flat` und `dead-cta` sind nicht ausgeliefert, ihre Zahlen aber trotzdem
veraltet.** Genau deshalb stehen sie hier: eine abgeschaltete Regel, deren
Schwelle im Stillen wegdriftet, ist beim Wiedereinschalten eine Falle. `flat`
liegt jetzt bei 22,2 % statt 15,2 %, weil sein Bildanteil mit dem neuen Blur
gerechnet wird.

### A8 — wie viel davon war der Renderer?

```bash
npm run cutoff -- --limit 150
```

Der Renderer blendet alles unter `transparencyCutoff` aus und fadet über
`transparencyRamp` ein. Beides sind **Werte**, gewählt an einer Karte, deren
Masse breiter lag. Gemessen, was dieselben Zahlen auf der neuen Karte tun:

| | verdeckt vorher | verdeckt nachher, gleiche Schwelle |
|---|---:|---:|
| Webpage | 18,0 % | **37,5 %** |
| Mobile | 13,1 % | **36,4 %** |

Die Schwelle allein verdoppelt bis verdreifacht die unsichtbare Fläche. Ein
Gutteil des Eindrucks „das Overlay ist leerer geworden" war also nicht die
Vorhersage.

Nachgezogen wurde nach einer Regel statt nach Augenmaß: **derselbe Anteil der
Karte bleibt verdeckt wie bisher.** Das ergibt 0,021 (Webpage) und 0,020
(Mobile) für die Schwelle und 0,082 bzw. 0,079 für das Rampenende —
ausgeliefert werden 0,02 und eine Rampenbreite von 0,06. Was damit **nicht**
entschieden ist: ob 18 % die richtige verdeckte Fläche sind. Diese Frage hat
keine Ground Truth; sie wird übernommen, nicht geprüft.

#### Was vom Prüffall-Effekt übrig bleibt

![A8 — Onboarding-Prüffall mit nachgezogenem Cutoff](assets/messungen/a8-onboarding-cutoff.png)

Links das Original, Mitte der Stand nach A6–A8, rechts der Stand vor 1.2 A6.

| Element | Kartenwert (Spitze) | Deckkraft, neue Schwelle | Deckkraft, alte Schwelle |
|---|---:|---:|---:|
| dunkle Kachel, vor A6 | 0,591 | — | 100 % |
| dunkle Kachel, jetzt | 0,469 | 100 % | 87 % |
| gelber CTA, vor A6 | 0,370 | — | 99 % |
| gelber CTA, jetzt | 0,199 | **97 %** | **41 %** |

**Beim CTA war es fast vollständig der Renderer.** Mit nachgezogener Schwelle
wird er wieder mit 97 % Deckkraft gezeichnet, praktisch wie vorher (99 %) — mit
der alten Schwelle wären es 41 % gewesen. Was bleibt, ist die **Farbe**: er ist
blau statt türkis, die Karte weist ihn also weiterhin als kalte Zone aus. Das
ist die Aussage der Engine, und sie steht.

Bei der dunklen Kachel war es umgekehrt: 100 % gegen 87 % Deckkraft, der
Renderer trägt wenig bei. Ihr Rückgang von 0,591 auf 0,469 ist echt — und
kleiner als die 0,388, die `blendGamma` 2,0 ergeben hätte.

### Die Streifen aus 1.1 sind zurück — gemessen

Auf einem inhaltsfreien grauen 1440 × 4000-Frame, dem Testbild, an dem die
Scroll-Dämpfung 1.1 eingeführt wurde:

![Abschnittsbänder auf einem leeren Frame](assets/messungen/a8-baender-grauer-frame.png)

| Band | y | Wert | Deckkraft neu (0,02) | Deckkraft alt (0,08) |
|---|---:|---:|---:|---:|
| 1 | 180 px | 0,4048 | 100 % | 100 % |
| 2 | 900 px | 0,2024 | 100 % | 100 % |
| 3 | 1620 px | 0,1012 | 100 % | **18 %** |
| 4 | 2340 px | 0,0506 | **51 %** | **0 %** |
| 5 | 3060 px | 0,0486 | **48 %** | **0 %** |

Täler dazwischen: 0,019 / 0,009 / 0,005 / 0,002 / 0,000 — die Bänder sind also
sauber getrennt und einzeln sichtbar. **Ja, das Artefakt ist zurück**, und zwar
deutlicher, als die eine Zahl 0,0506 vermuten ließ: nicht nur Band 4, auch Band
3 springt von 18 % auf volle Deckkraft.

**Die Dämpfung wird dafür nicht angefasst.** Sie ist eine ausdrücklich nicht
gemessene Annahme (`config.ts`), und sie zu verstellen, damit ein Bild ruhiger
aussieht, ist dieselbe Bewegung, die dieses Projekt sich bei den Regeln verboten
hat. `sectionAttenuationFloor` scheidet ohnehin aus: von 0,12 bis 0,03
nachgemessen bleibt Band 4 unverändert, weil dort noch `sectionAttenuation³`
greift und nicht der Boden.

#### Optionen, die weder Dämpfung noch Vorhersage anfassen

| Option | was sie tut | was sie kostet |
|---|---|---|
| **(a) Schwelle wieder höher** | zurück Richtung 0,08 | Direkter Tausch: 0,08 verdeckt auf echten Screens 37,5 % der Karte statt 18,0 %. Der A8-Gewinn ist weg, der CTA aus dem Prüffall fällt auf 41 % Deckkraft zurück. Ehrlich, aber es ist ein Rückschritt, keine Lösung. |
| **(b) Inhaltsschwelle im Renderer** — *gemessen und verworfen, siehe unten* | Unterhalb eines sehr kleinen **Bildanalyse-Anteils** wird nicht gezeichnet, darüber unverändert volle Deckkraft, dazwischen ein weicher Auslauf. Als Schwelle statt als Faktor, damit sich auf Inhalt **exakt** nichts ändert. | Auf echten Screens ändert sich eben doch etwas — 1,3 bis 3,8 % der sichtbaren Fläche verschwinden ganz. Zahlen unten. |
| **(c) Lokaler Kontrast statt absolutem Wert** | Gezeichnet wird, wo die Karte sich von ihrer *Umgebung* abhebt, nicht wo sie über einer festen Zahl liegt. Ein breiter, glatter Hügel — genau die Form der Bänder — fällt damit weg, ein Blickfang nicht. | Neue Heuristik im Renderer mit eigener Fehlerrate und eigenen Konstanten. Am ehesten das, was das Auge ohnehin tut, aber es ist eine Neuentwicklung, keine Justierung. |
| **(d) Nichts tun, benennen** | Der Fall betrifft Flächen **ohne jeden Inhalt**; echter Inhalt dominiert den Prior lokal. | Der erste Frame, den jemand zum Ausprobieren auswählt, ist oft ein halbleerer. Das Artefakt trifft damit ausgerechnet den ersten Eindruck. |

#### (b) wurde gemessen, bevor sie gebaut wurde — und ist damit erledigt

```bash
npm run band-gate
```

Der Einwand gegen (b) war, dass sie als *Faktor* die Aussage der Karte
umschreibt. Als **Schwelle** mit vollem Durchlass darüber gilt er nicht mehr —
vorausgesetzt, auf echten Screens liegt nichts unter der Schwelle. Das ist eine
prüfbare Bedingung, und sie ist auf den 40 Gate-Bildern geprüft worden, an der
**gerenderten Deckkraft**, nicht an der Karte.

| Schwelle / Auslauf | Pixel verändert | sichtbare Fläche ganz verloren | größte Δ Deckkraft | betroffene Bilder |
|---|---:|---:|---:|---:|
| **Webpage** | | | | |
| 0,005 / 0,01 | 1,50 % | 1,28 % | 1,000 | 13/20 |
| 0,01 / 0,02 | 2,00 % | 1,50 % | 1,000 | 14/20 |
| 0,05 / 0,05 | 4,98 % | 3,00 % | 1,000 | 19/20 |
| **Mobile** | | | | |
| 0,005 / 0,01 | 4,09 % | 3,81 % | 1,000 | 16/20 |
| 0,01 / 0,02 | 4,91 % | 4,24 % | 1,000 | 18/20 |
| 0,05 / 0,05 | 8,70 % | 6,61 % | 1,000 | 20/20 |

**Die Bedingung ist nicht erfüllt, und zwar schon beim kleinsten geprüften
Wert.** Selbst 0,005 löscht auf mehr als der Hälfte der Bilder Fläche, die heute
gezeichnet wird — und die größte Änderung ist 1,000, also *voll sichtbar → gar
nicht mehr sichtbar*, nicht ein Verblassen.

Der Grund steht in der Verteilung des Bildanteils: p1 liegt bei 0,0000 und p5
bei 0,0063 (Webpage) bzw. 0,0000 (Mobile). Auf einem echten Screen gibt es
reichlich Fläche mit fast keinem Bildanteil — Weißraum, ruhige Ränder,
Randbereiche neben dem Inhalt —, und dort zeichnet die Karte heute etwas, weil
der **Ortsprior** dort etwas sagt. Genau das ist eine Aussage: „hier schaut man
hin, obwohl nichts steht" ist auf einem realen Entwurf oft richtig. Die Schwelle
kann nicht zwischen „leerer Frame" und „leere Stelle auf einem vollen Frame"
unterscheiden, weil der Bildanteil diesen Unterschied nicht kennt.

**Damit gilt (d): nichts tun.** Das Artefakt bleibt bestehen und ist oben
dokumentiert. (a) wäre ein Rückschritt, (c) eine Neuentwicklung mit eigener
Fehlerrate; beide sind nicht ausgeschlossen, aber keine davon ist eine
Justierung, und keine wird hier nebenbei getroffen.

Das Messwerkzeug bleibt im Repo (`eval/band-gate.ts`) — nicht, weil die Idee
noch lebt, sondern damit die nächste Variante desselben Gedankens nicht wieder
bei null anfängt.

### Was offen bleibt

1. **Die Schärfe ist zu gut einem Drittel geschlossen, nicht ganz.** Faktor
   3,6 → 2,6 (Webpage) und 2,8 → 1,9 (Mobile). Weiter zu gehen wäre technisch
   möglich (γ 2,0 bringt die Hälfte), kostet aber genau die Gruppe, für die das
   Plugin gebaut ist — siehe A7. Was noch fehlt, holt keiner der vier geprüften
   Hebel: `post.gamma` und der Clip spitzen den Bildanteil zu und
   kosten dabei zuverlässig AUC, ein schärferer Blur verliert überall, und
   `blendGamma` ist bei 2,0 an seiner gemessenen Obergrenze. Der nächste Schritt
   ist keine Konstante mehr, sondern eine andere Bildanalyse — der
   Ortsprior selbst ist eine weiche Glocke und deckelt, wie scharf die Summe
   werden kann.
2. **Wie viel Fläche ein Overlay verdecken soll, ist weiterhin ungeprüft.** Die
   Schwelle ist auf denselben *Anteil* nachgezogen wie vorher (A8) — aber dass
   18 % der richtige Anteil sind, ist eine Annahme aus 1.0, nicht eine Messung.
   Diese Frage hat keine Ground Truth und gehört an einen Menschen mit echten
   Screens vor sich.
3. **Die Streifen aus 1.1 sind zurück** — siehe unten, eigener Abschnitt.
4. **`competition` neu kalibrieren**, nach dem Umbau in B1, auf der
   ausgelieferten Karte, getrennt je Frame-Form.
5. **Bei `cold-fold` ist die Höhe der Schwelle offen, nicht mehr ihre Form.**
   Sie liegt jetzt je UI-Typ am selben Perzentil (p60, Raten 40,0 % und
   39,8 %). Ob p60 die richtige Stelle ist — ob ein Befund auf 40 % der Screens
   erscheinen soll —, ist eine Produktfrage und nicht beantwortet.
6. **`flat` ist doppelt veraltet.** Seine Schwellen sind auf dem Bildanteil mit
   Blur 0,025 geschätzt; der ist jetzt 0,035. Die Regel ist nicht ausgeliefert,
   aber die Zahlen in `config.ts` sind es dem Namen nach — beim
   Wiedereinschalten sind sie neu zu messen, nicht zu übernehmen.

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

**Das Etikett „hero-dominiert" ist hier entstanden — und es ist eine
Lesart, keine Messung.** Auf dem Kontaktbogen sehen die Gewinner nach
Landingpages mit großem Bild und fetter Headline in der Bildmitte aus, die
Verlierer nach dichten Seiten mit starker Navigation oben. Das ist eine
plausible Beschreibung von zwölf Bildern, und sie hat sich als Kurzform
festgesetzt.

Belegt ist sie nicht. Gemessen unterscheiden sich die beiden Gruppen **allein in
der vertikalen Lage der Aufmerksamkeit** — Schwerpunkt y 0,382 gegen 0,296,
Masse im oberen Drittel 45,1 % gegen 62,7 %. In der Konzentration der Ground
Truth unterscheiden sie sich **nicht** (47,3 % gegen 48,5 %), im
Seitenverhältnis auch nicht. „Hero" ist eine mögliche Ursache dafür, dass
Aufmerksamkeit tiefer liegt; die Daten sagen nur, *dass* sie tiefer liegt.

Der Unterschied ist nicht akademisch: die Gruppe taucht in 1.2 als
Entscheidungsgrundlage wieder auf (siehe [A7](#a7--derselbe-mittelwert-zwei-gegenläufige-hälften)),
und wer dort „hero-dominiert" liest, sucht die Erklärung im falschen Merkmal.
Deshalb ab hier: **Gewinner = Screens, deren Aufmerksamkeit tiefer liegt, als
der Ortsdurchschnitt erwartet.**

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

## Clickmap — warum sie nicht im Panel steht

Die Clickmap ist implementiert, getestet und wird **nicht angeboten**:
`CLICKMAP_IN_PANEL` in `messages.ts` steht auf `false`. Die
Kandidatenerkennung läuft unverändert weiter — `cta-rank` und
`cta-below-fold` leiten sich daraus ab, das Ausblenden darf keine zwei Regeln
still abschalten. Es ist ausschließlich die Anzeige (Checkbox, Map,
Klick-Ranking).

**Anlass.** Auf einem Onboarding-Screen wurde genau **ein** Kandidat erkannt
und mit **100 %** ausgewiesen. „Hier anmelden" und vier offensichtlich
tappbare Kategorie-Karten fehlten. Eine Verteilung über einen einzigen
Kandidaten ist keine Vorhersage, sondern ein Artefakt der Normierung: die
Prozentwerte summieren sich auf 1, egal wie unvollständig die Menge ist.

**Warum die Elemente fehlten.** Der Erkenner (`engine/clickmap.ts`) nimmt einen
Knoten auf, wenn er eine Prototype-Reaktion trägt, wenn sein *Name* ein
Stichwort aus `INTERACTIVE_KEYWORDS` enthält, oder wenn er ein kurzer **Text**
ist, dessen **direkter** Elternteil eine Füllung hat. Nachgestellt an den
Ebenenformen, die solche Screens haben:

| Aufbau | erkannt? |
|---|---|
| Frame „Primary Button" + Text | ja, über den Namen |
| Frame „Anmelden" (kein Stichwort), Text direkt darin | ja, über den Text im gefüllten Container |
| Frame „Anmelden" → Auto-Layout ohne Füllung → Text | **nein** |
| Outline-Button ohne Füllung, Text direkt darin | **nein** |
| Karte „Kategorie/Sport" mit Füllung + Text | ja |
| Karte „Kachel" mit Bild + Text in einem Auto-Layout | **nein** |
| Karte „Category Card" (englisch benannt) | ja, über „card" |
| Karte „Kachel" mit Prototype-Interaktion | ja |

Drei Ursachen, alle systematisch. Zwei davon sind behoben:

1. ~~**Nur der direkte Elternteil** wird auf eine Füllung geprüft.~~
   **Behoben:** die Suche läuft jetzt die Vorfahrenkette hoch, bis zu
   `clickmap.buttonContainerDepth` (3) Ebenen, und der gefundene *Kasten* wird
   Kandidat statt der Beschriftung — „die Schaltfläche, nicht ihr Text", dieselbe
   Vorliebe, die `dropNestedCandidates` schon kannte. Der Kasten muss die
   Größengrenzen selbst einhalten, sonst wandert die Suche aus dem Knopf heraus
   in den Seitenhintergrund.
2. **Rahmen ohne Text** werden nie über die Label-Regel erfasst; die verlangt
   `isText`. Eine Bildkachel ohne Beschriftung ist nur über Namen oder
   Reaktion erreichbar. **Offen** — Aufwandsschätzung unten.
3. ~~Die Stichwortliste ist **englisch**.~~ **Behoben:** deutsche Stichwörter
   ergänzt und der Tokenizer repariert. `extractNameHints` zerlegte an
   `[^a-z0-9]`, was „Schaltfläche" in „schaltfl" + „che" zerriss — kein
   Stichwort mit Umlaut konnte je treffen. Der Trenner lässt jetzt `äöüß`
   stehen.

**Gemessen, vorher → nachher:**

| | vorher | nachher |
|---|---:|---:|
| 24 typische deutsche Ebenennamen, die ein Stichwort treffen | 0 | **21** |
| Kandidaten im Onboarding-Nachbau (Kachel + Knopf, je mit Auto-Layout-Zwischenebene) | 0 | **2** |
| Kandidaten über die 24 konstruierten Frames | 445 | **368** |

Die Zahl auf den konstruierten Frames *sinkt*, und das ist der Zweck: drei
Beschriftungen einer Karte fallen zu einem Kandidaten — der Karte — zusammen,
statt als drei konkurrierende Einträge in der Rangfolge zu stehen. Das entlastet
nebenbei `dead-cta`, dessen Entscheidungsgröße mit der Kandidatenzahl sinkt.

**Was jetzt gefunden wird.** Ein nachgebauter Onboarding-Screen (393 × 852,
zwei Knöpfe, vier Kategorie-Kacheln je 165 × 150 px mit Bild und Beschriftung in
einer Auto-Layout-Zwischenebene) liefert **6 von 6** erwarteten Kandidaten. Die
Größengrenzen waren nie das Problem: die Kacheln belegen 7,4 % der Fläche, die
Grenze liegt bei 50 %. Was fehlte, war die Vorfahrenkette — und für die Kacheln
zusätzlich, dass „Freizeit", „Immobilien", „Jobs", „Nachrichten" kein englisches
Stichwort treffen.

Dieselben Kacheln **ohne Textbeschriftung** — nur ein Bild darin — liefern
weiterhin **0 Kandidaten**. Das ist Ursache (2) und nichts anderes.

**Aufwand für Ursache (2), noch nicht umgesetzt.** Ein Rahmen ohne Text und ohne
Stichwort ist nur über Form-Heuristik erkennbar, und jede davon ist eine neue
Entscheidungsgröße mit eigener Fehlerrate: „gefüllt, abgerundet, zwischen 24 und
72 px hoch, breiter als hoch" fängt Knöpfe und Kacheln — und ebenso Badges,
Chips, Bildplatzhalter und jede farbige Trennfläche. Der Code selbst ist klein
(eine Bedingung in `findCandidates`, ~20 Zeilen); die Arbeit steckt in der
Messung, denn ohne Beleg tauscht man fehlende Kandidaten gegen falsche. Das ist
dieselbe Kalibrierungsfrage wie bei `flat` und `dead-cta` und gehört an
dasselbe Set mit echten Layer-Bäumen (PRD Set 2). Schätzung: ein halber Tag
Code, der Rest ist das Set.

**Bedingungen für die Rückkehr ins Panel.** Beide, nicht eine davon:

- **(a) Die Kandidatenerkennung ist gegen Enrico belegt vollständig.** Nicht
  „findet viel", sondern: auf einer gezogenen Stichprobe echter Screens mit
  Layer-Baum ist ausgewiesen, welcher Anteil der tatsächlich bedienbaren
  Elemente gefunden wird, aufgeschlüsselt nach den drei Ursachen oben.
- **(b) Die Rückkehr erfolgt ohne Prozentwerte** — als Liste oder als
  Hervorhebung der Kandidaten, nicht als Verteilung. Enrico validiert die
  **Erkennung**, nicht die Rangfolge; eine Zahl, die Rangfolge behauptet,
  wäre durch nichts gedeckt.

---

## Contrastmap (1.2 C)

```bash
npm run contrast-check      # die Karte auf zwei Frames, Bild und Befunde
```

**Die dritte Karte, und die einzige, die keine Vorhersage ist.** Sie hat keinen
Datensatz, keine Kalibrierung und keine Schwelle, die veralten kann — sie
rechnet eine Norm aus. Sie kann nicht in dem Sinne falsch sein, in dem eine
Heatmap falsch sein kann; sie kann nur ungenau sein, und wo sie das ist, sagt
sie es.

**Nach den Befundzahlen ist sie die Hauptausgabe des Plugins, nicht die dritte
Karte.** Gemessen auf denselben zwei Frames:

| Frame | Contrastmap | Vorhersage-Befunde |
|---|---:|---:|
| Onboarding 393 × 852 | **8** gemessene Aussagen (davon 2 zu beachten) | **1** |
| Desktop 1440 × 3200 | **21** gemessene Aussagen, **10 durchgefallen** | Ø **1,67** |

Von den drei Vorhersage-Regeln bedient jede genau eine Frame-Form
([siehe oben](#die-aufteilung-ist-keine-einschränkung-sondern-die-struktur)); auf
einem Ein-Viewport-Telefon bekommt ein Drittel der Screens gar nichts, und der
Rest genau einen Befund. Die Contrastmap braucht weder Folds noch Abschnitte
noch Kandidaten noch Kalibrierung — sie sagt auf **jeder** Frame-Form etwas, und
was sie sagt, kann man nachrechnen.

Das gehört auch in die Beschreibung fürs Publishing: wer das Plugin installiert,
bekommt zuerst eine Kontrastprüfung nach WCAG und **zusätzlich** eine
Aufmerksamkeitsvorhersage — nicht umgekehrt.

### Wie gemessen wird (C1)

Hybrid, und beide Hälften aus dem Grund, aus dem sie dort herkommen müssen:

| aus dem Layer-Baum | aus den gerenderten Pixeln |
|---|---|
| Position, Größe, Schriftgröße, Schriftschnitt, Textfarbe | die tatsächliche Hintergrundfarbe |

Den Hintergrund aus dem Baum zu rekonstruieren hieße, den Renderer nachzubauen —
gestapelte Fills, Verläufe, Fotos, Deckkraft, Masken —, und jede Abweichung wäre
ein falscher Befund über etwas, das man ansehen kann. Umgekehrt wäre „alles aus
den Pixeln" ebenso falsch: aus einem Screenshot ist nicht zu erkennen, was ein
Textknoten ist und wie groß seine Schrift wirklich ist — und genau davon hängt
die Schwelle ab.

Abgetastet wird **innerhalb** des Textrahmens, ohne die Glyphen: Pixel nahe der
Textfarbe fallen weg, samt Antialiasing-Saum. Füllt der Text seinen Rahmen, wird
auf einen Ring außerhalb ausgewichen. Gemessen wird auf der **vollen**
Auflösung (`ENGINE_CONFIG.contrastSource`), nicht auf dem 1024 px breiten
Analysebild — zwischen den Glyphen wäre dort kein reiner Hintergrund mehr übrig,
und der Wert wäre eine Interpolation statt einer Messung.

### Die Schwellen sind zitiert, nicht kalibriert (C2)

WCAG 2.1, Erfolgskriterium 1.4.3, Level AA: **4,5:1** für normalen Text, **3:1**
für großen — groß heißt ab 24 px, oder ab 18,66 px bei fett. Diese Zahlen stehen
in einem Standard und veralten nicht mit unserer Engine.

Was **nicht** übernommen ist, weil es ohne Auslegung nicht geht: die Ausnahmen
des Kriteriums für rein dekorativen Text, für Logotypen und für inaktive
Bedienelemente. Ein Layer-Baum sagt nicht, ob ein Text dekorativ ist. Gemessen
werden deshalb alle Textknoten, und die Ausnahme bleibt beim Menschen — ein
falsch gemeldeter Logotyp ist ein Ärgernis, ein verschwiegener Fließtext ein
Fehler.

Eine Stufe kommt von uns und ist als unsere gekennzeichnet: **grenzwertig** für
Werte knapp über der Norm. 4,52:1 trägt dieselbe Aussage wie 4,48:1, und die
Abtastung hat in der zweiten Nachkommastelle ohnehin keinen Halt.

### Darstellung (C3)

![Contrastmap auf dem Onboarding-Screen](assets/messungen/c-contrastmap-onboarding.png)
![Contrastmap auf einem Desktop-Frame](assets/messungen/c-contrastmap-desktop.png)

**Kein Overlay über dem Inhalt** — dieselbe Regel, aus der 1.1 die Legende und
der Disclaimer aus den Bildern verschwunden sind. Bei einer Karte, die von
Lesbarkeit handelt, wäre es besonders absurd, den Text zu verdecken. Stattdessen:
ein Rahmen **um** jedes Textelement, der Wert in einer Fahne daneben, und der
Rest des Bildes leicht abgedunkelt, damit die Markierungen hervortreten.

Die drei Farben sind Status, keine Skala. Und sie sind nicht die einzige
Kodierung: die Zahl steht an jedem Element, und die Rahmen unterscheiden sich in
der Strichstärke — eine Barrierefreiheits-Ansicht, die selbst auf
Rot-Grün-Unterscheidung angewiesen ist, wäre schwer zu verteidigen.

Gemessen auf den beiden Prüffällen:

| Frame | gemessen | durchgefallen | grenzwertig |
|---|---:|---:|---:|
| Onboarding-Screen 393 × 852 | 8 | 0 | 2 |
| Desktop, scrollend 1440 × 3200 | 21 | 10 | 0 |

Auf dem Desktop-Frame fallen die Firmennamen (4,1:1) und die Kartenknöpfe
(4,4:1) durch, die Stellentitel bestehen mit 18,0:1. Auf dem Onboarding-Screen
besteht alles; die Unterzeile liegt mit 4,5:1 knapp darüber und wird als
grenzwertig markiert.

#### Die angezeigte Zahl darf dem Urteil nicht widersprechen

Die Kartenknöpfe standen in der ersten Fassung mit **„4,50:1"** neben „WCAG AA
verlangt 4,5:1" und dem Urteil „durchgefallen". Beide Erklärungen waren zu
prüfen:

| | |
|---|---|
| Vergleichsoperator `>` statt `>=` | **Nein.** `statusOf` schneidet bei `ratio < required`; genau 4,5 besteht, wie WCAG 1.4.3 es verlangt („mindestens"). Ein Test hält das jetzt fest. |
| Anzeige-Rundung | **Ja.** Der Rohwert war **4,499204**, das Urteil also richtig — kaufmännisch gerundet wurde daraus „4,50". |

Rechnerisch stimmte alles, im Bild war es unhaltbar. Behoben durch **Abrunden**
statt Runden, und zwar nicht als Notlösung: weil beide Schwellen bei einer
Nachkommastelle exakt darstellbar sind (4,5 und 3,0), ist die angezeigte Zahl
damit **beweisbar** widerspruchsfrei zum Urteil —

```
Verhältnis <  Schwelle  ⇒  Anzeige ≤ Verhältnis <  Schwelle
Verhältnis ≥  Schwelle  ⇒  Anzeige ≥ Schwelle
```

Der Test prüft das als Eigenschaft über den ganzen Wertebereich beider
Schwellen, nicht an Beispielen. Abrunden ist zusätzlich die sichere Richtung:
wir behaupten nie mehr Kontrast, als gemessen wurde.

### Die Befunde stehen getrennt (C4)

> „Digital Works AG" hat 4,2:1 gegen seinen Hintergrund — WCAG AA verlangt
> 4,5:1 (normaler Text).

Eigene Sektion im Panel, eigene Bezeichnung („Kontrast (gemessen)"), und **der
Vorhersage-Disclaimer gilt für sie nicht**. Die Trennung steht im Typ, nicht nur
im Layout: `ContrastFinding` ist ein anderer Typ als `FindingPayload`, damit die
beiden nicht versehentlich in einer Liste landen. In einer Liste vermischt würde
das eine das andere abwerten — und zwar in die falsche Richtung, denn die
belastbarere Aussage verlöre.

### Bedienelemente: WCAG 1.4.11 (Non-text Contrast)

**Was gemessen wird, und was ausdrücklich nicht.** 1.4.11 fordert 3:1 für
visuelle Information, die nötig ist, um eine Komponente oder ihren **Zustand**
zu *identifizieren*. Das ist nicht „jede Fläche gegen irgendetwas": gemessen
wird die **Begrenzung gegen die unmittelbar angrenzende Farbe** — die Kante, an
der man erkennt, dass hier eine Komponente anfängt.

**Die Ausnahme, die die meisten Fehlmeldungen verhindert:** ist eine Komponente
durch ihren **eigenen sichtbaren Text** identifizierbar, ist ihre Begrenzung
nicht erforderlich. Der gelbe Knopf „Los geht's" hat gegen den cremefarbenen
Grund **1,45:1** und wäre ohne diese Ausnahme ein Durchfaller — nach der Norm
ist er keiner, weil die Beschriftung ihn identifiziert. Genau diese Fehlmeldung
produzieren rasterbasierte Werkzeuge, die nur Pixel sehen. **Wir können es
besser, weil wir wissen, was ein Element ist.** Icon-Knöpfe ohne Text bleiben
drin, denn dort trägt nur die Form die Information.

#### Umfang: sortiert nach „wie sicher verlangt die Norm hier 3:1"

| Grund | ausgeliefert | warum |
|---|---|---|
| Prototype-Interaktion (`hasReactions`) | **ja** | per Definition bedienbar |
| Name trifft ein Stichwort (Button, Kachel, Feld …) | **ja** | von einem Menschen so benannt |
| wiederholtes Element (≥ 3 gleichartige Geschwister) | nein | klassischer Dekorationsfall |
| Trennlinie (dünn, lang) | nein | eine Linie zwischen ohnehin unterscheidbaren Karten ist zum Verständnis nicht nötig |

Die unteren beiden werden **gemessen, aber nicht gemeldet** — dieselbe
Konstruktion wie `shipped: false` bei den Vorhersageregeln: Code und Grund
bleiben beieinander, und die Rate ist da, wenn jemand entscheiden will. Auf dem
konstruierten Desktop-Frame fallen 7 von 9 Elementen in diese Kategorie
(Ergebniskarten), alle mit eigener Beschriftung — sie würden also selbst bei
Auslieferung nichts melden.

Gemessen auf den beiden Prüffällen:

| Frame | im Prüfumfang | davon gemeldet |
|---|---:|---:|
| Onboarding 393 × 852 | 6 | **0** (alle tragen eine Beschriftung) |
| Desktop 1440 × 3200 | 9 | **2** (Suchfeld, CTA — beide ohne Textkind) |

**Fotos sind ausgenommen — aus einem Messgrund, nicht aus einem Normgrund.** Die
Ausnahmen der Norm sind inaktive Komponenten, browserbestimmte Darstellung und
Grafiken, bei denen eine bestimmte Darstellung wesentlich ist; Fotos stehen
nicht darunter. Sie fallen hier trotzdem raus, weil es über einem Foto keinen
definierbaren Vordergrund gegen Hintergrund gibt, gegen den sich eine Begrenzung
berechnen ließe. Der Unterschied ist wichtig: eine falsche Normbehauptung im
Werkzeug kostet die ganze Sektion ihre Glaubwürdigkeit.

#### Zwei Grenzen, die prinzipiell bleiben

1. **Zustände sind in einem statischen Frame nicht prüfbar.** Man sieht einen
   Zustand. 1.4.11 verlangt Kontrast auch für die *Unterscheidung* der Zustände
   untereinander — ob der aktive Reiter sich vom inaktiven abhebt, ist aus einem
   Frame nicht zu beantworten.
2. **Inaktive Komponenten sind ausgenommen, und „inaktiv" ist aus dem Layer-Baum
   nicht zuverlässig zu erkennen.** Ein ausgegrauter Knopf sieht aus wie ein
   Knopf mit wenig Kontrast. Wir melden ihn; die Entscheidung bleibt beim
   Menschen.

Beide stehen im Panel, nicht nur hier. Und 1.4.11 bekommt eine **eigene
Sektion**: in 1.4.3 steckt keine Einschätzung, hier schon — ob ein Element eine
Komponente ist, schätzt eine Heuristik.

### Was die Generatoren nicht erzeugen — und was davon eine Messung kippt

**Zweimal hintereinander haben die Testframes eine kaputte Methode bestätigt,
weil ihnen eine Eigenschaft echter Renders fehlte.** Erst die Textfarbe (jeder
Knoten wurde übersprungen), dann die Kantenglättung (jeder Wert war falsch).
Beide Male war die Messung falsch und alle Tests grün. Das ist kein Zufall
mehr, sondern ein Muster — also einmal systematisch durchgegangen, was
`constructed.ts`, `onboarding.ts` und `fixtures-cli.ts` **nicht** erzeugen.

| Fehlt in den Fixtures | Kippt es eine Messung? | Stand |
|---|---|---|
| **Kantenglättung** an Glyphen | **Ja, tat es.** Minimum über Pixel traf immer ein Mischpixel | **behoben**, eigener Test mit bekannten Farbpaaren |
| **Textfarbe** (`fillLuminance`) | **Ja, tat es.** Ohne sie misst die Contrastmap gar nicht | **behoben**, beide Generatoren setzen sie |
| **Deckkraft < 1** an Fill oder Knoten | **Ja.** Die Farbe aus dem Layer-Baum ist dann nicht die, die man sieht — der gemeldete Kontrast wäre **besser** als die Wirklichkeit | **behoben ohne Testfall**: `traverse.ts` setzt `fillLuminance` nur noch, wenn Paint und Knoten voll deckend sind. Lieber „nicht messbar" als eine geschönte Zahl |
| **Überlappende Elemente / Verdeckung** | **Ja, offen.** Ein Knoten, der von einem späteren Element überdeckt wird, wird gegen Pixel gemessen, die gar nicht zu ihm gehören. Die Generatoren zeichnen überschneidungsfrei | **offen** — braucht einen Frame mit bewusster Verdeckung |
| **Verläufe als Hintergrund** | **Vermutlich nein.** Der `varies`-Pfad ist getestet, aber nur mit einem synthetischen Verlauf, nicht aus einem Generator | **offen**, geringes Risiko |
| **Text auf Fotos** | **Vermutlich nein**, gleicher Pfad wie Verläufe. Die Onboarding-Kacheln haben Bildflächen, aber der Text liegt darunter, nie darauf | **offen**, geringes Risiko |
| **Subpixel-Positionen** | **Möglich.** Alle Rechtecke der Generatoren liegen auf ganzen Pixeln; Figma liefert Bruchteile. `luminancesIn` rundet, kann also eine Pixelreihe daneben greifen — bei kleinem Text anteilig viel | **offen** |
| **Rotation** | **Ja, vermutlich.** Ein gedrehter Textknoten hat eine achsenparallele Bounding-Box voller Hintergrund; die dominante Fläche wäre dann der Grund neben dem Text statt der dahinter | **offen** |
| **Effekte (Schatten, Blur), Masken, Clipping** | **Möglich.** Ein Schatten unter Text verschiebt den gemessenen Hintergrund; eine Maske kann Pixel zeigen, die nicht zum Knoten gehören | **offen** |
| **`figma.mixed`** (mehrere Schriftgrößen, mehrere Fills in einem Knoten) | Nein — der Übersprungpfad existiert und meldet den Grund | abgedeckt durch Konstruktion |

**Was das über die Testframes sagt.** Sie sind gut für Geometrie und für die
Befundregeln, und sie waren für die Kontrastmessung von Anfang an ungeeignet:
ein Generator, der Text als hartkantige Balken in ganzzahligen Rechtecken
zeichnet, kann eine pixelbasierte Messung nicht prüfen. Der Test mit **bekannten
Farbpaaren** ist die Antwort darauf — er baut die eine Eigenschaft nach, die
zählt, und prüft gegen Zahlen, die feststehen.

**Die drei offenen Punkte mit echtem Risiko** (Verdeckung, Rotation, Subpixel)
haben eines gemeinsam: bei allen dreien ist die **Bounding-Box nicht das, was
man sieht**. Der naheliegende nächste Schritt ist deshalb keine weitere
Fixture-Variante, sondern eine Plausibilitätsprüfung in der Messung selbst — ob
die dominante Fläche überhaupt groß genug ist, um der Hintergrund *dieses*
Elements zu sein. Nicht in diesem Schritt gebaut.

### Der Kopf der Contrastmap läuft nicht durch die Vorhersage-Vorlage

Über jeder Karte stehen ein Titel und eine Zeile mit dem Disclaimer, dem
Blickverhalten, der Betrachtungsdauer und der Engine-Version; unter allen Karten
die UEyes-Datengrundlage. Für die Contrastmap ist **jedes einzelne davon
falsch**: sie sagt nichts vorher, benutzt keinen Ortsprior, und keine der drei
Größen geht in ein Kontrastverhältnis ein.

| | Vorhersage-Karten | Contrastmap |
|---|---|---|
| Titel | „Heatmap — vorhergesagt" | **„Contrastmap — gemessen"** |
| Zeile | „Algorithmische Vorhersage, keine Messdaten · Blickverhalten … · Betrachtungsdauer … · hybrid-v1" | **„Gemessene Kontrastwerte nach WCAG 2.1 AA — nachprüfbar, keine Vorhersage"** |
| Ebenenname | `Heatmap · Blick (1 s) · hybrid-v1` | `Contrastmap · gemessen` |
| Datengrundlage darunter | ja | **nur, wenn auch eine Vorhersage-Karte erzeugt wurde** |

Die Datengrundlage hängt am Wrapper, nicht an der einzelnen Karte — sie
verschwindet jetzt, wenn **ausschließlich** gemessene Karten entstehen. Sie
belegt eine Abhängigkeit, und eine Contrastmap hat keine. (Die CC-BY-Pflicht
selbst bleibt davon unberührt: sie greift für den Ortsprior, und der steckt in
keiner Contrastmap.)

Abgesichert wie der Ortsprior-Test: **kein Textknoten und kein Ebenenname in der
Karten-Spalte** darf „vorhergesagt", „Vorhersage", „Betrachtungsdauer",
„Blickverhalten", „UEyes" oder die Engine-Version enthalten. Ausgenommen sind
genau die beiden freigegebenen Zeichenketten — die Zeile enthält „Vorhersage" in
ihrer Verneinung —, und deren Wortlaut steht in einem eigenen Test.

### Die Wertfahnen verdecken keinen Text mehr

Dritter Anlauf mit diesen Fahnen: zuletzt lag eine über dem Wort „Hier" eines
**anderen** Elements — rechts neben Element A war Platz, aber genau dort begann
Element B. Die Platzierung probiert jetzt sechs Positionen um das Element herum
(rechts, links, oben, unten, jeweils auch bündig) und nimmt die erste, die
weder ein markiertes Element noch eine bereits gesetzte Fahne trifft und ins
Bild passt. Findet keine Platz, gewinnt die mit der **kleinsten überlappten
Fläche** — im Zweifel der kleinste Schaden statt einer willkürlichen Wahl.

Fünf Tests halten das fest, darunter der Fall aus dem Bericht (zwei
nebeneinanderliegende Textelemente) und der Rand des Bildes. Das Prüfbild aus
`npm run contrast-check` benutzt dieselbe Platzierungsfunktion wie das Plugin —
sonst zeigte es etwas anderes als das, was ausgeliefert wird.

### Die gemessene Hintergrundfarbe steht im Ergebnis

`npm run contrast-check` weist zu jedem Element aus, **gegen welche Farbe**
gerechnet wurde. Das macht einen Verdacht überprüfbar statt ihn Verdacht bleiben
zu lassen: wer einen Wert für falsch hält, hält diese Farbe gegen den Fill in
der Datei.

Der Anlass: ein weißer Text auf einer dunklen Kachel wurde mit 15,9:1 gemeldet,
und das sah zu hoch aus. Nachgerechnet entspricht 15,9:1 **exakt #222222** — die
Messung ist also in sich stimmig. Ob die Kachel wirklich so dunkel ist oder ob
etwas Dunkleres darunter liegt (Schatten, Scrim, Overlay), zeigt jetzt die
ausgewiesene Farbe. Zusätzlich sind **weiß auf #222222** (15,91:1) und **weiß
auf #4D4D4D** (8,45:1) in den Test mit bekannten Farbpaaren aufgenommen — mit
Kantenglättung, auf 0,05 genau.

### Betriebssystem-Chrome bleibt außen vor

Auf einem Handy-Frame liegt oben die Statusleiste („15:30", WLAN, Akku) und
unten der Home-Indicator. Das ist keine Gestaltung des Entwurfs, sondern das
Betriebssystem; einen Kontrastbefund darüber kann niemand beheben.

**Erkannt über den Namen, nicht über die Position** — und die Entscheidung fiel
an der Fehlerrichtung:

| | scheitert wie |
|---|---|
| Positionsregel („oberstes Band eines Mobile-Frames") | **stiller Ausfall.** Auf einem Screen ohne Statusleiste sitzt dort die Kopfzeile. Im eigenen Onboarding-Testframe steht „Willkommen zurück" bei 9,8 % der Höhe — jede Schwelle, die „15:30" bei 3 % erwischt, ist einen Handgriff davon entfernt, eine echte Überschrift zu verschlucken. Und niemand sieht, dass sie gefehlt hat. |
| Namensmuster | **zu Rauschen hin.** Es übersieht eine anders benannte Statusleiste, und dann steht ein Befund zu viel im Report. Das sieht man. |

Die Liste ist bewusst kurz: `status bar`, `statusleiste`, `statusbar`,
`home indicator`. **`navigation bar` ist nicht dabei** — Androids Systemleiste
heißt so, App-Navigationen aber auch, und ein Muster, das beides trifft, löscht
die Hauptnavigation aus der Prüfung.

**Auf Wortgrenzen, nicht als Teilstring.** Ein Teilstring-Vergleich verschluckt
eine „Bewerbungsstatusleiste" — und zwar in genau der Fehlerrichtung, die mit
der Entscheidung gegen die Positionsregel ausgeschlossen wurde. Der Test führt
dieses Beispiel namentlich.

Geprüft wird der Knoten **und seine Vorfahren**: die Uhrzeit in einer Komponente
„iOS Status Bar" heißt meist schlicht „15:30". Und die Ausnahme gilt für
**beide** Pfade — ohne das verschwände „15:30" aus 1.4.3 und die Symbole daneben
blieben in 1.4.11 stehen. Übersprungenes wird gezählt und benannt, wie jedes
andere nicht messbare Element auch.

### Grenzen, ehrlich benannt (C5)

Über einem Foto oder einem Verlauf gibt es kein „das" Kontrastverhältnis,
sondern eine Verteilung. Gemeldet wird der **schlechteste** Wert im Textbereich
— die Aussage, die nicht zu gut aussieht — und der Befund sagt dazu, dass der
Hintergrund wechselt und der Wert eine Näherung nach unten ist. In der Karte
trägt die Fahne dann ein `~`.

Elemente, die gar nicht messbar sind, werden **gezählt und benannt** statt still
ausgelassen: mehrfarbiger Text ohne einfarbigen Fill, fehlende Schriftgröße,
Text, der seinen Rahmen vollständig füllt. Eine Messung, die Elemente
verschweigt, sagt „in Ordnung", wo sie „ich weiß es nicht" meint.

### Panel (C6)

Dritter Schalter, Reihenfolge Heatmap, Focusmap, Contrastmap — dieselbe
Reihenfolge, in der die Ergebnisframes auf dem Canvas landen. Beschreibung:
„Prüft, ob Texte genug Kontrast zu ihrem Hintergrund haben". Eine gespeicherte
Einstellung von vor 1.2 bekommt die Karte **eingeschaltet**: eine neue Ausgabe,
die still ausgeschaltet ankommt, sieht aus wie eine, die es nicht gibt.

---

## Befunde (Epic C)

Nach der Berechnung läuft ein Satz deterministischer Regeln über Heatmap,
Clickmap und Node-Signale. Jede Regel liefert höchstens ein Finding; sortiert
wird nach Severity, angezeigt werden maximal sechs.

| ID | Auslöser | ausgeliefert |
|---|---|---|
| `cta-rank` | Primärer Kandidat der Clickmap nicht auf Rang 1 | ja |
| `cta-below-fold` | Höchstbewerteter Kandidat unterhalb Fold 1 | **nein** (siehe unten) |
| `competition` | Zwei Regionen über 65 % Intensität, weit auseinander, mit Tal dazwischen | ja |
| `cold-fold` | Above-the-fold-Abschnitt bündelt Aufmerksamkeit schwächer als ein späterer | ja |
| `dead-cta` | Interaktives Element unter 45 % des stärksten Kandidaten seines Viewports | **nein** (siehe unten) |
| `flat` | Konzentration des Bildanalyse-Anteils unter Schwellwert | **nein** (siehe unten) |

Drei von sechs Regeln sind abgeschaltet, aus zwei verschiedenen Gründen.

`dead-cta` und `flat`: die **Entscheidungsgröße misst nicht das, was die Regel
behauptet**. Bei `dead-cta` ist es ein Minimum über alle Kandidaten, das mit
deren Anzahl sinkt; bei `flat` ein Massenanteil, der auf die *Fläche* der
stärksten Stelle reagiert statt auf die Deutlichkeit der Hierarchie.

`cta-below-fold`: **strukturell blockiert**, nicht falsch kalibriert. Der
oben-lastige Prior und die Scroll-Dämpfung zusammen sorgen dafür, dass der
stärkste Kandidat fast nie unter dem Fold liegt — 0 von 24 konstruierten
Frames.

Alle drei bleiben implementiert und erreichbarkeitsgetestet — siehe unten.

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

**Die einzige positive Evidenz von `competition` steht auf demselben Maß.** Die
3,3 % (Webseite) und 10,0 % (Telefon) wurden mit genau dem Abstandsmaß gemessen,
das hier als falsch skaliert dokumentiert ist: „weit auseinander" bedeutete bei
den beiden Messungen 48,0 % bzw. 13,9 % der Kartenhöhe. Es sind also nicht
dieselbe Frage, zweimal beantwortet. Sobald der Abstand in 1.2 auf die Diagonale
oder auf getrennte x/y-Schwellen umgestellt wird, **ist die Feuerrate neu zu
messen** — die alten Zahlen dürfen weder übernommen noch als
Plausibilitätsanker benutzt werden. Bis dahin ist die Regel ausgeliefert, weil
sie nicht entartet ist, nicht weil sie validiert wäre.

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

### `flat` ist wieder aus — die Größe misst das Falsche

Der Vorbehalt oben („reagiert auch auf die Menge an Inhalt") war zu milde
formuliert. Zwei kontrollierte Sweeps auf derselben Fläche, gemessen auf dem
Bildanalyse-Anteil des ersten Abschnitts:

| Hierarchie konstant (ein Hero), nur mehr Inhalt | c |
|---|---:|
| Hero + 2 Zeilen | 0,176 |
| Hero + 4 Zeilen | 0,156 |
| Hero + 6 Zeilen | 0,143 |
| Hero + 8 Zeilen | 0,134 |
| Hero + 10 Zeilen | 0,127 |

| Inhalt konstant (6 Zeilen), nur der Blickfang wächst | c |
|---|---:|
| kein Blickfang | 0,123 |
| 60 px | 0,220 |
| 120 px | 0,155 |
| 240 px | 0,142 |
| 400 px | 0,137 |

Der zweite Sweep ist **nicht monoton**: ein *großer* Blickfang (0,137) landet
fast dort, wo *kein* Blickfang landet (0,123). Präzise formuliert misst die
Größe, **wie klein die stärkste Stelle ist, nicht wie deutlich die Hierarchie
ist**. Dazu bewegt die reine Inhaltsmenge sie um 0,049 — bei einem
Klassenabstand von 0,004 (ohne Hierarchie 0,000–0,123, mit 0,127–0,220).

**Warum das ein Abschalten ist und keine Nachjustierung.** Mit den
ausgelieferten Schwellen gibt die Regel auf 13 Fällen mit bekannter Antwort
keine falsche Aussage ab — sie feuert auf keinem Screen mit Blickfang. Der Grund
ist aber nicht Trennschärfe:

| Fall | c | `flat` |
|---|---:|---|
| Hero + 2…10 Zeilen | 0,176…0,127 | schweigt ✓ |
| Blickfang 60…400 px | 0,220…0,137 | schweigt ✓ |
| kein Blickfang, 6 Zeilen | 0,123 | schweigt — **verpasst** |
| 4 gleiche Blöcke | 0,120 | schweigt — **verpasst** |
| 12 gleiche Blöcke | 0,103 | schweigt — **verpasst** |
| leerer Screen | 0,000 | feuert ✓ |

Die Schwelle (web 0,086) liegt **unterhalb des gesamten realistischen
Wertebereichs** (0,103–0,220). Die Regel ist damit faktisch blockiert: sie
feuert nur auf einem leeren Screen und erscheint im Gebrauch als stumm — genau
die Fehlerklasse, die bei `cold-fold` schon einmal ein Jahr lang unbemerkt
blieb, nur andersherum. Und jede Schwelle, die „zwölf gleiche Blöcke" fängt,
wird von einer Seite mit Hero und viel Inhalt wieder gekippt.

`flat` steht deshalb auf `shipped: false`, mit demselben Muster wie `dead-cta`:
Erreichbarkeitstest bleibt (beide Richtungen), Zahlen stehen im Kommentar,
Grund steht hier.

### Wie viele Befunde bekommt ein Screen?

```bash
npm run finding-load
```

„Feuert diese Regel zu oft?" ist pro Regel nicht zu beantworten. Die Regeln
konkurrieren um denselben Platz — `maxShown` ist 6, und wer einen Screen
ansieht, liest die Liste als Ganzes. Was zählt, ist die Verteilung der
**Befundzahl pro Screen**, und die ist eine Eigenschaft des Regelsatzes, nicht
einer Regel. Gezählt wird, was das Panel zeigt: nur ausgelieferte Regeln, durch
denselben `deriveFindings`-Pfad.

#### Mit Layer-Baum — die Zahl, die für eine Figma-Datei gilt

Eine Figma-Datei hat immer Ebenen. Die konstruierten Frames sind die einzige
Population, auf der deshalb der **vollständige** Regelsatz laufen kann:

| Population (24 Varianten) | 0 Befunde | 1 | 2 | Ø |
|---|---:|---:|---:|---:|
| Desktop, scrollend | 0,0 % | 33,3 % | **66,7 %** | **1,67** |
| Telefon, scrollend | 0,0 % | 37,5 % | 62,5 % | 1,63 |
| **Telefon, ein Viewport** | **33,3 %** | 66,7 % | 0 % | **0,67** |

Dazu der Onboarding-Nachbau (393 × 852, 6 Kandidaten), der Prüffall aus A4 —
**ein** Befund:

> `cta-rank`: „Jetzt loslegen Button" liegt auf Rang 5 der vorhergesagten
> Klicks — Rang 1 hat „Wetter".

Auf gescrollten Frames bekommt damit **jeder** Screen mindestens einen Befund
und zwei Drittel bekommen zwei. Auf dem Ein-Viewport-Telefon bekommt ein Drittel
nichts, und der Rest bekommt genau einen — immer `cta-rank`.

#### Ohne Layer-Baum — und warum diese Zahlen zu niedrig sind

| Population | 0 Befunde | 1 | 2 | Ø |
|---|---:|---:|---:|---:|
| UEyes Webseiten, segmentiert (495) | 57,6 % | 37,8 % | 4,6 % | 0,47 |
| UEyes Telefon, ein Viewport (495) | 77,6 % | 22,4 % | 0 % | 0,22 |
| UEyes Telefon, segmentiert (495) | 58,6 % | 40,4 % | 1,0 % | 0,42 |

**Diese Zahlen unterschätzen die Befundlast systematisch, und zwar um den
Faktor drei.** UEyes besteht aus Screenshots; ein Screenshot hat keine Ebenen,
also keine Klick-Kandidaten, also kann `cta-rank` dort **nie** feuern — die
einzige Regel ohne bekannten Defekt fehlt in jeder dieser Zeilen. Auf dem
Ein-Viewport-Telefon steht 0,22 gegen 0,67 mit Layer-Baum.

**Wer 0,22 zitiert, zitiert eine untere Schranke als Ergebnis.** Die Zahl für
eine Figma-Datei ist die aus der Tabelle davor.

Was beide Tabellen gemeinsam sagen: **kein Screen bekommt mehr als zwei
Befunde.** Die Obergrenze von 6 wird nicht annähernd erreicht — die Regeln
nehmen einander nichts weg. Die Frage, die diesen Abschnitt ausgelöst hat, ob
`cold-fold` mit 40 % zu laut sei, ist damit anders zu stellen: das Problem ist
das Gegenteil.

Für 1.2 B heißt das: **eine Schwelle zu senken, damit eine Regel häufiger
feuert, ist die falsche Bewegung.** Was fehlt, sind Regeln, die auf einem
Ein-Viewport-Screen überhaupt etwas zu sagen haben.

#### Die Aufteilung ist keine Einschränkung, sondern die Struktur

Die beiden Vorhersage-Regeln, die **ohne** Layer-Baum auskommen, schließen
einander aus — nicht durch Absicht, sondern durch ihre Voraussetzungen:

| | Ein Viewport | segmentiert |
|---|---:|---:|
| `competition` | **15,2 %** (Telefon) / 15,8 % (Web) | 0,0 % (Telefon) / 7,1 % (Web) |
| `cold-fold` | **blockiert** (keine Abschnitte) | **39,8 %** (Telefon) / 40,0 % (Web) |

`competition` ist faktisch eine **Ein-Viewport-Regel**: auf der komponierten
Karte ist jeder tiefere Abschnitt gedämpft, das zweite Maximum erreicht die
Intensitätsschwelle nicht mehr. `cold-fold` ist eine **Abschnitts-Regel**: ohne
zwei Abschnitte hat sie nichts zu vergleichen und wird gar nicht erst gefragt.

**Jede Frame-Form hat damit genau eine Vorhersage-Regel, die feuern kann, ohne
jede Überdeckung.** Fällt sie aus — durch eine Kalibrierung, einen Umbau, eine
Engine-Änderung —, bekommt diese Form nichts. Das ist keine Redundanz, die man
verliert, sondern eine, die es nie gab.

`cta-rank` ist die einzige Regel, die **beide** Formen bedient. Sie braucht
dafür einen Layer-Baum — in Figma immer vorhanden, in jedem Datensatz, den wir
messen können, nie. Das macht sie strukturell zur wichtigsten der drei und
erklärt nebenbei, warum sie in den UEyes-Zahlen fehlt.

#### `cta-rank` mit 67 % — das ist der Generator, nicht die Regel

Die einzige Regel ohne bekannten Defekt ist auch die häufigste, und die 66,7 %
sahen nach einem Ausreißer aus. Sie sind keiner. Gegenübergestellt, ob der
Aufbau den CTA nach unten stellt und ob die Regel feuert, über 24 Varianten je
Frame-Form:

| Frame-Form | CTA unten, feuert | CTA unten, schweigt | CTA oben, feuert | CTA oben, schweigt | Übereinstimmung |
|---|---:|---:|---:|---:|---:|
| Desktop, scrollend | 16 | 0 | 0 | 8 | **100 %** |
| Telefon, ein Viewport | 16 | 0 | 0 | 8 | **100 %** |
| Telefon, scrollend | 16 | 0 | 0 | 8 | **100 %** |

`constructed.ts` → `layoutFor` setzt `ctaAtBottom = variant % 3 !== 2`, stellt
den CTA also in **genau zwei Dritteln** der Varianten nach unten. Die Regel
feuert auf genau diesen und schweigt auf genau den anderen — **keine
Fehlmeldung, kein Versäumnis, in keiner Frame-Form.** 66,7 % ist die Quote von
`layoutFor`, nicht die von `cta-rank`.

Wer 67 % als Eigenschaft der Regel liest, liest eine Eigenschaft des Generators.
Und die Quote auf echten Screens ist **unbekannt und mit UEyes auch nicht
messbar**: ohne Layer-Baum gibt es keine Kandidaten. Was hier gemessen wurde,
ist nicht „wie oft der Fall vorkommt", sondern „ob die Regel den Fall erkennt" —
und das tut sie vollständig.

(Nebenbei erledigt: der Kommentar in `rules.ts` nannte für „Telefon scrollend"
noch 7/8 mit einer Fehlmeldung. Die ist mit den Engine-Änderungen aus 1.2 A
verschwunden — jetzt 24/24 in allen drei Formen.)

**Was das über die Häufigkeit nicht sagt.** Ob eine Regel, die auf zwei Dritteln
der Screens dasselbe sagt, überlesen wird, ist eine Frage an echte Nutzung und
an ein Set mit Layer-Bäumen. Beides fehlt. Solange es fehlt, ist an dieser Regel
nichts zu justieren — sie hat ohnehin keine Schwelle, „nicht auf Rang 1" ist
eine Definition.

### B1 — `competition` misst den Abstand jetzt auf der Diagonale

```bash
npm run competition
```

Der Mindestabstand der beiden Spitzen war ein Anteil der Karten**breite** und
bedeutete je nach Frame-Form 3,9 % bis 48,0 % der Höhe. Er ist jetzt ein Anteil
der **Diagonale** — die Größe, die mit der Form skaliert, statt eine Kante
willkürlich auszuzeichnen. **Alle Quoten dieser Regel von vor 1.2 B1 sind damit
ungültig**, auch die 3,3 % / 10,0 % aus 1.1; das stand seit 1.1 so im Code und
ist hiermit eingelöst.

Getrennte x/y-Schwellen wären ausdrucksstärker — „nebeneinander" ist etwas
anderes als „untereinander" —, sind aber **zwei** Konstanten auf einer
Population, auf der die Regel selten feuert. Zwei Werte an so wenigen Auslösern
zu kalibrieren hieße, Rauschen zu kalibrieren.

Feuerrate über je 495 Bilder, die beiden Ein-Viewport-Populationen — der Fall,
um den es in B geht:

| Abstand (Anteil Diagonale) | Webseiten | Telefon |
|---|---:|---:|
| 0,15 | 47,1 % | 22,2 % |
| 0,20 | 31,1 % | 18,6 % |
| **0,25** | **15,8 %** | **15,2 %** |
| 0,30 | 4,0 % | 10,5 % |
| 0,35 | 0,8 % | 6,3 % |

**Bei 0,25 sind die beiden Formen praktisch gleich.** Darunter unterscheiden sie
sich um mehr als das Doppelte, darüber kippt das Verhältnis um. Genau diese
Formunabhängigkeit war der Zweck der Umstellung — und sie ist der Grund für den
Wert, nicht die Rate selbst, für die es keine Ground Truth gibt.

Die bindende Bedingung ist dabei **nicht** der Abstand, sondern
`competitionIntensity`: je weiter der Suchradius, desto schwächer das zweite
Maximum. Sein Median fällt auf Webseiten von 0,873 (bei 0,15) auf 0,390 (bei
0,35) und unterschreitet die Schwelle 0,65 zwischen 0,25 und 0,30. Das
Talverhältnis sitzt bei 0,25 in beiden Ein-Viewport-Populationen innerhalb der
Verteilung (p22 bzw. p34) — die Regel kann dort also beides, feuern und
schweigen.

#### Ein neuer Befund: auf segmentierten Telefon-Frames feuert sie nicht mehr

| Population | Rate bei 0,25 |
|---|---:|
| UEyes Webseiten, ein Viewport | 15,8 % |
| UEyes Webseiten, segmentiert | 7,1 % |
| UEyes Telefon, ein Viewport | 15,2 % |
| **UEyes Telefon, segmentiert** | **0,0 %** |
| Telefon, ein Viewport (konstruiert) | 0,0 % |
| beide konstruierten Scroll-Formen | 0,0 % |

Der Grund ist strukturell und nicht der Abstand: auf der komponierten Karte ist
jeder tiefere Abschnitt um `sectionAttenuation^i` gedämpft, das zweite Maximum
erreicht `competitionIntensity` = 0,65 dort nicht mehr. **Dieselbe Blockade wie
bei `cta-below-fold`**, und dieselbe Konsequenz: die Dämpfung wird dafür nicht
angefasst, sie ist eine nicht gemessene Annahme.

`competition` ist damit faktisch eine **Ein-Viewport-Regel**. Für B ist das
keine schlechte Nachricht — der Ein-Viewport-Screen ist genau der Fall, für den
B gebaut wird —, aber es heißt, dass von den zwei belastbaren Regeln auf einer
gescrollten Telefonseite keine übrig bleibt: `cold-fold` braucht Abschnitte und
feuert dort, `competition` kann dort nicht.

### Hinweis auf inhaltsarme Frames

```bash
npm run band-gate      # prüft die Schwelle bei jedem Lauf mit
```

Aus dem verworfenen Renderer-Vorschlag folgt eine, die trägt: **die
Unterscheidung, die pro Pixel unmöglich ist, ist pro Frame möglich.** Der
Bildanalyse-Anteil kann nicht sagen, ob *diese Stelle* leer ist — Weißraum auf
einem vollen Screen sieht aus wie Fläche auf einem leeren. Über den ganzen
Frame gemittelt kann er es sehr wohl, weil die Perzentil-Normierung auf einer
strukturlosen Fläche gar keinen Wertebereich findet und exakt null liefert.

| | Frame-Mittelwert des Bildanteils |
|---|---:|
| grauer 1440 × 4000-Testframe, ohne Inhalt | **0,000000** |
| niedrigster der 40 Gate-Bilder | **0,228585** |
| Median der 40 Gate-Bilder | 0,4516 |

Zwei Größenordnungen Abstand, dazwischen in dieser Stichprobe nichts. Die
Schwelle liegt bei **0,02**, eine Größenordnung unter dem kleinsten echten
Wert; auf keinem der 40 Gate-Bilder erscheint der Hinweis, und `npm run
band-gate` prüft das bei jedem Lauf nach.

Statt der Karte ändert sich der Text daneben:

> Dieser Frame enthält kaum Inhalt — die Karte zeigt überwiegend die
> Positionsannahme. Die wiederkehrenden Bänder sind der Ortsprior je Abschnitt,
> keine Aussage über den Entwurf.

Er steht bei den **Warnungen**, nicht bei den Befunden: ein Befund sagt etwas
über den Entwurf, dieser Satz sagt etwas über die Karte.

**Was die Schwelle nicht leistet.** 40 Bilder zeigen keine Population — dass
zwischen 0,02 und 0,23 nie ein echter Frame liegt, ist nicht bewiesen. Die Wahl
ist deshalb bewusst konservativ: ein *dünn* gefüllter Frame löst den Hinweis
nicht aus, obwohl er ihn vielleicht verdiente. Das ist die richtige Richtung
für einen Fehler — ein fehlender Hinweis kostet nichts, ein falscher erzählt dem
Nutzer, seine Datei sei leer.

### Bekannte Einschränkungen — bewusst nicht in diesem Schritt behoben

Drei Befunde bleiben stehen. Alle drei sind belegt, alle drei sind **keine
offenen Bugs ohne Notiz**, und alle drei werden absichtlich nicht angefasst:
eine Korrektur ohne neue Kalibrierung wäre derselbe Fehler, um den es in diesem
Abschnitt geht.

**Der erste ist ein sichtbarer Defekt, und er ist der einzige seiner Art.** Die
anderen beiden sind Regeln, die zu selten oder falsch skaliert feuern — das
merkt niemand, der das Plugin benutzt. Diesen hier sieht man.

#### Abschnittsbänder auf inhaltsarmen Flächen (sichtbar, ausgeliefert)

Auf einem Frame ohne Inhalt zeichnet die Karte pro Abschnitt ein Band — den
Ortsprior, der sich je Abschnitt wiederholt. Gemessen auf dem grauen
1440 × 4000-Testframe, an dem die Scroll-Dämpfung 1.1 eingeführt wurde:

| Band | y | Wert | Deckkraft heute | Deckkraft vor 1.2 A8 |
|---|---:|---:|---:|---:|
| 1 | 180 px | 0,4048 | 100 % | 100 % |
| 2 | 900 px | 0,2024 | 100 % | 100 % |
| 3 | 1620 px | 0,1012 | **100 %** | 18 % |
| 4 | 2340 px | 0,0506 | **~51 %** | 0 % |
| 5 | 3060 px | 0,0486 | **~48 %** | 0 % |

Vor 1.2 waren die Bänder 4 und 5 unsichtbar und Band 3 kaum zu sehen — nicht
weil die Dämpfung sie wegbekommen hätte, sondern weil die Transparenzschwelle
des Renderers zufällig darüber lag. Mit der auf die neue Verteilung
nachgezogenen Schwelle (A8) liegt sie darunter, und das Artefakt ist zurück.

**Warum es bleibt.** Die Dämpfung steiler zu stellen wäre die einzige direkte
Abhilfe, und sie ist eine ausdrücklich nicht gemessene Annahme
([`NOTICE.md`](NOTICE.md)) — sie zu verstellen, damit ein Bild ruhiger aussieht,
ist dieselbe Bewegung, die dieses Projekt sich bei den Regeln verboten hat. Die
naheliegende Alternative, im Renderer unterhalb eines sehr kleinen
Bildanalyse-Anteils nicht zu zeichnen, ist **gemessen und verworfen**: sie
löscht auf echten Screens 1,3 bis 3,8 % der sichtbaren Fläche, siehe
[A8](#b-wurde-gemessen-bevor-sie-gebaut-wurde--und-ist-damit-erledigt).

Was stattdessen passiert: das Panel **sagt es**, statt die Karte zu ändern —
siehe [Hinweis auf inhaltsarme Frames](#hinweis-auf-inhaltsarme-frames).

#### Die beiden übrigen

| Was | Beleg | warum jetzt nicht |
|---|---|---|
| `competition` kann auf segmentierten Telefon-Frames nicht feuern (0,0 % bei 495 Bildern) | [B1](#b1--competition-misst-den-abstand-jetzt-auf-der-diagonale) | Die Ursache ist `sectionAttenuation`: das zweite Maximum erreicht die Intensitätsschwelle auf der gedämpften Karte nicht mehr. Dieselbe Blockade wie bei `cta-below-fold`, und dieselbe Antwort — die Dämpfung ist eine nicht gemessene Annahme und wird nicht verstellt, damit eine Regel feuert. |
| `cta-below-fold` ist durch `sectionAttenuation` strukturell unterdrückt (0 von 48 konstruierten Scrollframes) | Tabelle oben | Die Ursache ist die Scroll-Dämpfung, laut `config.ts` ausdrücklich eine **Annahme ohne Messung**. Sie zu ändern, um eine Regel häufiger feuern zu lassen, hieße die Vorhersage an die Regel anzupassen statt umgekehrt. Erst die Dämpfung belegen, dann die Regel. |

Beide stehen zusätzlich als Kommentar an der jeweiligen Regel in
`src/findings/rules.ts`, damit sie beim Lesen des Codes nicht erst gesucht
werden müssen.

### Der Umlaut-Fehler war ein Engine-Fehler, nicht nur ein Findings-Fehler

`extractNameHints` zerlegte Ebenennamen an `[^a-z0-9]` und zerriss damit jeden
Namen mit Umlaut. Betroffen war nicht nur die Kandidatenerkennung:
`nameHints` speist über `isInteractive` auch die Feature-Map
**`interactiveSalience`** — Gewicht 0,10 in der Basiskonfiguration, unter
`hybrid-v1` nach Renormierung ohne Prior **0,111 des Bildanalyse-Anteils**, der
wiederum mit 0,3 auf den Prior addiert wird.

Auf einer deutschsprachigen Datei fiel damit für die Bildanalyse praktisch
jedes Bedienelement weg. Übrig blieben nur Knoten mit echter
Prototype-Interaktion. Gemessen auf den konstruierten Frames mit eingedeutschten
Ebenennamen, je 4 Varianten:

| Frame | interaktive Knoten vorher | nachher | CC(Karte alt, neu) | CC(Bildanteil) |
|---|---:|---:|---:|---:|
| Desktop scrollend | 4 | 44 | 0,998 | 0,962 |
| Telefon 1 Viewport | 4 | 24 | 0,996 | 0,939 |
| Telefon scrollend | 4 | 48 | 0,999 | 0,984 |

Die Größenordnung ehrlich eingeordnet: die **fertige** Karte ändert sich wenig
(CC 0,996–0,999), weil `hybrid-v1` prior-dominiert ist und diese eine Feature-
Map rund 3 % des Endergebnisses trägt. Auf dem **Bildanalyse-Anteil**, also auf
dem, was der Screen selbst beiträgt, sind es 0,939–0,984 — dort war der Fehler
messbar. Er hat die Vorhersage auf allen deutschen Dateien systematisch
geschwächt, ohne je aufzufallen, weil die englischen Testnamen
(„Primary Button", „SearchInputField") immer trafen.

### Der Flächenanteil ist raus — und was das an den Regeln geändert hat

Die Änderung der Kandidatenerkennung (deutsche Stichwörter, Suche über die
Vorfahrenkette, Kandidat ist der *Kasten* statt der Beschriftung) hat beide
ausgelieferten Regeln, die an der Rangfolge hängen, aus dem Tritt gebracht:
`cta-rank` feuerte plötzlich 8/8, `cta-below-fold` 0/8.

**Ursache war der Flächenanteil im Score.** `scoreCandidates` rechnete
`sizeRank = Fläche ÷ größte Fläche` mit Gewicht 0,2. Solange Kandidaten
Beschriftungen waren, lagen die Flächen nah beieinander. Als Kästen nicht mehr:

| Element | Fläche | `sizeRank` | Aufmerksamkeit |
|---|---:|---:|---:|
| Stellenkarte | 230.400 px² | 1,00 | 0,55 |
| Suchfeld | 56.320 px² | 0,24 | 0,61 |
| Jetzt bewerben (CTA) | 17.784 px² | 0,38 | 0,16 |

Der Term addierte 0,20 auf jede Karte und entschied die Rangfolge allein.

**Entfernt, nicht neu kalibriert.** Der Flächenanteil war für die *Clickmap*
gedacht — ein größeres Ziel wird häufiger getroffen. Die drei Regeln, die noch
an der Rangfolge hängen, sprechen aber über **Aufmerksamkeit**, nicht über
Klickwahrscheinlichkeit, und die Clickmap steht nicht im Panel. „Median statt
Maximum" wäre eine zweite Zahl gegen dieselbe unvalidierte Population gewesen.
Der Score ist jetzt `0,625 · meanAttention + 0,375 · reactionBonus` — die alten
zwei Gewichte, auf 1 renormiert. Die Ordnung lautet damit
`Suchfeld > Stellenkarte > CTA`.

**`cta-rank` bleibt ausgeliefert.** Die konstruierten Frames stellen den
primären CTA in 6 von 8 Varianten nach unten und in 2 von 8 direkt unter den
Hero — die richtige Antwort ist also bekannt:

| Frame | Quote | Übereinstimmung mit der Konstruktion |
|---|---|---|
| Desktop scrollend | 6/8 | feuert auf genau den 6 „CTA unten"-Varianten |
| Telefon 1 Viewport | 6/8 | dieselbe Aufteilung, keine Abweichung |
| Telefon scrollend | 7/8 | eine Fehlmeldung (v5, CTA oben) |

23 von 24 Urteilen stimmen. Die Quote von rund 79 % ist hoch, aber sie ist die
Quote, die der Aufbau vorgibt — kein Zeichen einer Regel, die immer feuert.

**`cta-below-fold` steht auf `shipped: false`** — bis 1.2 aus einem
strukturellen Grund, seit 1.2 B4 aus einem gemessenen. Der Unterschied ist der
eigentliche Ertrag dieser Runde, auch wenn der Schalter auf derselben Stellung
bleibt.

*Vorher:* die Regel las `candidates[0]` auf der komponierten Karte, und diese
Karte ist zweifach oben-lastig — der Ortsprior ist aus Einzel-Viewports
geschätzt, und jeder Abschnitt wird zusätzlich mit `sectionAttenuation^i`
gedämpft. Ein Element unter dem Fold startet bei der Hälfte. **0 von 24**
konstruierten Frames, in allen drei Formen. Über die eigene
Entscheidungsgröße war damit nichts zu erfahren: die Regel kam nie zu Wort.

Die Dämpfung wird dafür **nicht** angefasst. Sie ist selbst eine Annahme ohne
Messung; sie zu verstellen, damit eine Regel feuert, hieße die Vorhersage an die
Regel anzupassen.

*Der Umbau (1.2 B4):* die Rangfolge läuft jetzt über `localMean`, also über die
ungedämpfte Karte des eigenen Abschnitts — derselbe Weg, den `dead-cta` schon
geht. Der Befundsatz ist neu geschrieben, weil sich die Aussage ändert: aus
„der stärkste Kandidat des Screens liegt unter dem Fold" wird „der Kandidat,
der seinen eigenen Viewport anführt, sitzt nicht im ersten".

*Das Ergebnis, gegen die bekannte Antwort des Generators, je 24 Frames
(`npm run finding-load`):*

| Frame-Form | Rate | CTA unten → feuert | CTA **oben** → feuert | Übereinstimmung |
|---|---:|---:|---:|---:|
| Desktop, scrollend | 4,2 % | 0/16 | 1/8 | 29,2 % |
| Telefon, scrollend | 100,0 % | 16/16 | 8/8 | 66,7 % |
| Telefon, ein Viewport | — | keine Folds, also keine Frage | | |

**Der Umbau behebt den Defekt nicht, und beide Zeilen sind aus
entgegengesetzten Richtungen wertlos.** Auf Desktop meldet die Regel genau
einmal, und dieser eine Fall ist einer mit CTA oben — die einzige Aussage, die
sie macht, ist falsch. Auf Telefon meldet sie ausnahmslos, auch auf allen acht
Frames mit CTA oben; die 66,7 % Übereinstimmung sind der Sockel des Generators,
den eine Regel, die immer „ja" sagt, gratis bekommt.

**Die Ursache ist verwertbar.** Der Umbau nimmt die Dämpfung *zwischen* den
Abschnitten heraus, lässt den oben-lastigen Prior aber *innerhalb* jedes
Abschnitts stehen. Der Vergleich über Abschnitte hinweg wird damit zu „wer
sitzt am dichtesten am oberen Rand seines eigenen Viewports" — eine Frage ohne
Bezug zum Fold. Und weil ein 390 × 3000-Frame vier Ausschnitte hat, von denen
drei unter dem Fold liegen, gewinnt dort fast zwangsläufig einer von den
dreien.

Was die Regel bräuchte, ist keine dritte Karte, sondern eine **relative**
Größe: nicht „dieser Kandidat führt seinen Ausschnitt an", sondern „er führt
ihn deutlicher an, als der Anführer des ersten Ausschnitts den seinen" — ein
Verhältnis zweier Dominanzen und damit unabhängig von der Zahl der Ausschnitte.
Nicht gemessen, und ohne das Set mit echten Layer-Bäumen (PRD Set 2) auch nicht
kalibrierbar.

Der Messcode bleibt trotzdem stehen. Die alte Fassung schwieg; diese feuert,
und man *sieht*, dass sie das Falsche trifft. Ein Rückbau würde diese
Beobachtung wegwerfen und den nächsten Anlauf wieder bei der Dämpfung anfangen
lassen.

Damit sind **drei von sechs** Regeln ausgeliefert: `cta-rank`, `competition`,
`cold-fold`.

### Auf einem Handy-Screen feuert fast nichts — der wichtigste offene Punkt

Ein typischer Onboarding-Screen (393 × 852) ist **nicht segmentiert**: 852 ÷ 786
= 1,08 Viewport-Höhen, die Schwelle liegt bei 1,5. Von den drei ausgelieferten
Regeln fällt damit eine strukturell aus, bevor irgendetwas gerechnet wird:

| Regel | auf einem Ein-Viewport-Handy | Grund |
|---|---|---|
| `cold-fold` | **kann nicht feuern** | verlangt `plan.segmented` und ≥ 2 Abschnitte |
| `competition` | kann — feuerte in der Messung 0/8 | Mindestabstand am Kartenbreitenanteil, siehe oben |
| `cta-rank` | kann — feuerte 6/8, korrekt gegen die Konstruktion | |

**Effektiv bleibt eine Regel.** Das ist der wichtigste offene Produktpunkt: der
häufigste Fall unserer Nutzung — ein Handy-Screen, der in einen Viewport passt —
bekommt aus dem Befundsystem fast nichts. Die Regeln sind für scrollende Seiten
entworfen; sie sprechen über Abschnittsgrenzen, und auf einem Screen ohne
Abschnitte gibt es nichts zu sagen.

#### Was 1.2 dafür vorhatte — und was daraus geworden ist

Drei Regel-Ideen, die ohne Folds und ohne Abschnitte auskommen. Die Spalte
„vorhanden" war der Plan; die letzte Spalte ist das Ergebnis, und in zwei von
drei Fällen ist es nicht das erhoffte.

**Der Plan hat sich in genau der Form geirrt, vor der die Spalte „vorhanden"
warnt:** dass ein Baustein existiert, sagt nichts darüber, ob er die Frage
beantwortet. Das ist bei B4 explizit schiefgegangen und hier zweimal
mitgezählt.

| Regel-Idee | vorhanden | Stand nach 1.2 |
|---|---|---|
| **Konkurrierende Blickfänge** — zwei etwa gleich starke, weit auseinanderliegende Spitzen | `competition` gibt es bereits: Zwei-Maxima-Suche, Talprüfung, Schwellen in `config.ts` | **B1, erledigt.** Der Abstand läuft auf der Diagonale und ist an je 495 Bildern neu kalibriert (0,25). Die Feuerraten sind neu gemessen, alle älteren Quoten sind ungültig |
| **CTA in der ruhigsten Zone** — der primäre Kandidat liegt dort, wo die Karte kalt ist | `meanInRect` über die Kandidatengeometrie, `percentile` über die ganze Karte, `isPrimaryCandidate` | **B3, nicht angefangen.** Kein Code, keine Messung. Die Bausteine liegen weiterhin da — was nach B4 ausdrücklich *kein* Argument dafür ist, dass es nur Anschließen wäre |
| **Kopfbereich stärker als Inhalt** — die Aufmerksamkeit bleibt im oberen Band hängen | Die Karte selbst, `sectionSalience` als Konzentrationsmaß, Geometrie aller Knoten | **B2, gemessen und verworfen.** Die Größe ist auf dem klarsten Fall undefiniert, spannt 0–202, und drei gleich große Blöcke (1,280) übertreffen den „hoch"-Fall (1,246). Siehe [B2](#b2--kopfbereich-stärker-als-inhalt-wird-nicht-gebaut) |

**Vierter Punkt, in 1.2 A dazugekommen und als Erstes von B erledigt:
`cold-fold` hat jetzt eine Schwelle je UI-Typ.**

```bash
npm run cold-fold
```

Die Regel ist eine von nur zwei belastbaren, und ihre einzige Konstante —
`coldFoldMargin` — war eine Zahl für alle UI-Typen, geschätzt an Webseiten.
Gemessen mit erzwungener Segmentierung, je rund 500 Bilder:

| Dezile der Entscheidungsgröße | p10 | p20 | p30 | p40 | p50 | p60 | p70 | p80 | p90 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| UEyes Webseiten | −0,132 | −0,081 | −0,043 | 0,005 | 0,037 | **0,080** | 0,128 | 0,181 | 0,259 |
| UEyes Telefon | −0,071 | −0,007 | 0,045 | 0,088 | 0,131 | **0,189** | 0,250 | 0,315 | 0,411 |

Die alte 0,08 sitzt in der Webseiten-Verteilung bei **p60** (Rate 40,0 %) und in
der Telefon-Verteilung bei **p38** (61,6 %) — dort also unter dem Median, die
Regel sagte häufiger ja als nein. Dieselbe Fehlerklasse wie bei `flat`, nur
wandert die Schwelle hier zwischen **UI-Typen** statt zwischen Konfigurationen.

**Kalibriert wird auf Vergleichbarkeit, nicht gegen eine Wahrheit.** Es gibt
keine Ground Truth dafür, ob ein Screen diesen Befund verdient — niemand hat
gelabelt, wo Aufmerksamkeit „zu weit unten" bündelt. Die Schwelle liegt deshalb
in jedem Typ am **selben Perzentil** seiner eigenen Verteilung, damit die
Aussage in beiden dasselbe heißt. Genau die Begründung, mit der `flat` seine
vier Schwellen bekommen hat.

| | Schwelle | Rate |
|---|---:|---:|
| web | 0,080 | 40,0 % |
| mobile | **0,189** | 39,8 % |

**Das Perzentil selbst ist nicht kalibriert.** p60 ist aus dem ausgelieferten
Zustand übernommen. Ob ein Befund auf 40 % der Screens erscheinen soll, ist eine
Produktfrage und hier ausdrücklich **nicht** entschieden — entschieden ist nur,
dass die Regel in beiden Typen dieselbe Frage stellt. `desktop` und `poster`
fallen auf den web-Wert zurück; das ist eine Annahme, keine Messung.

**Der entscheidende Vorteil der drei Regel-Ideen oben:** sie lesen nur die Karte
und die Geometrie, nicht die Abschnittsstruktur — und damit sind sie **an UEyes
kalibrierbar**. Der Datensatz besteht aus 1.980 Einzel-Viewport-Screenshots,
also genau der Population, um die es hier geht. Nur der CTA-Teil der zweiten
Regel braucht Layer-Bäume (PRD Set 2); die anderen beiden nicht. Das ist der
Unterschied zu `flat` und `dead-cta`, die ohne das fehlende Set gar nicht
messbar sind.

**Die Contrastmap ist die naheliegende Kompensation.** Sie braucht weder Folds
noch Abschnitte und funktioniert auf einem Ein-Viewport-Screen vollständig —
damit deckt sie genau die Lücke ab, die die Befunde dort lassen. (In diesem
Branch existiert sie noch nicht; hier steht sie als Vormerkung für 1.2.)

### B2 — „Kopfbereich stärker als Inhalt" wird nicht gebaut

```bash
npm run header-weight
```

Die Regel wäre die zweite Vorhersage-Regel für Ein-Viewport-Screens gewesen. Die
vorgeschlagene Größe — Bandaufteilung plus Verhältnismaß, mittlerer
Bildanalyse-Anteil im oberen Viertel geteilt durch den im Rest — ist **vor**
jeder Kalibrierung an Fällen mit bekannter Antwort geprüft worden. Sie besteht
die Prüfung nicht.

| Fall | erwartet | Bildanteil | fertige Karte |
|---|---|---:|---:|
| leer | undefiniert | — | 3,757 |
| kräftiger Kopfbereich, ruhiger Inhalt | **hoch** | 1,246 | 2,637 |
| ein kleiner Blickfang in der Mitte | niedrig | **—** | 2,437 |
| ein großer Blickfang in der Mitte | niedrig | 0,000 | 1,572 |
| ein kleiner Blickfang im Kopfbereich | **hoch** | **201,955** | 5,820 |
| 3 gleich starke Blöcke | neutral | **1,280** | 2,410 |
| 6 gleich starke Blöcke | neutral | 1,035 | 1,959 |
| 12 gleich starke Blöcke | neutral | 0,953 | 1,870 |

**Drei Gründe, jeder für sich hinreichend:**

1. **Die Größe ist auf dem klarsten Fall undefiniert.** „Ein kleiner Blickfang
   in der Mitte" hat im oberen Band gar keine Masse — der Bildanteil ist dort
   nach der Perzentil-Normierung exakt null. Ein Verhältnis 0 ÷ x ist keine
   kleine Zahl, sondern keine Zahl. Genau dort, wo die Antwort am eindeutigsten
   ist, sagt die Größe nichts.
2. **Der Wertebereich ist unbrauchbar.** Ein Verhältnis zweier Mittelwerte
   explodiert, sobald der Nenner klein wird: 0,000 bis 201,955, mit Löchern
   dazwischen. In einer solchen Verteilung liegt keine Schwelle sinnvoll.
3. **Die Inhaltsmenge schiebt die Fälle über die Klassengrenze.** Drei gleich
   starke Blöcke kommen auf **1,280** und liegen damit **über** dem Fall, der
   „hoch" heißen soll (kräftiger Kopfbereich, 1,246). Das ist exakt die
   `flat`-Falle: die Größe reagiert stärker auf die Menge an Inhalt als auf das,
   was sie messen soll.

Die Spalte „fertige Karte" steht daneben, weil sie die naheliegende Alternative
erledigt: dort bekommt der **leere** Frame mit 3,757 den höchsten Wert von
allen. Das ist der Ortsprior, der von sich aus oben-lastig ist — auf der
fertigen Karte misst diese Größe die Positionsannahme, nicht den Entwurf.

**Es gibt keinen zweiten Anlauf.** Weder ein anderes Band noch ein anderes
Verhältnis: die Instabilität kommt aus der Konstruktion „Quotient zweier
Mittelwerte" und nicht aus der Bandgröße, und `flat` hat fünf Anläufe gekostet,
von denen vier nichts gefunden haben, was der erste nicht schon zeigte.

**Was das kostet, und warum es tragbar ist.** Ein-Viewport-Screens behalten
damit genau eine Vorhersage-Regel (`competition`, 15,2 %) plus `cta-rank`, wo
ein Layer-Baum vorliegt. Die Lücke, die B2 hätte füllen sollen, füllt die
[Contrastmap](#contrastmap-12-c) — und zwar besser, als diese Regel es gekonnt
hätte: sie sagt auf jedem Screen etwas, und was sie sagt, ist nachrechenbar.

---

### Offen für 1.2 — die abgeschalteten Regeln

Alle drei brauchen eine **neue Entscheidungsgröße**, nicht eine neue Schwelle.
In allen Fällen ist der Umbau benannt und die Messung fehlt noch:

**Zwei der drei teilten sich eine vermutete Änderung — und die Vermutung war
falsch.** `cta-below-fold` und `dead-cta` scheitern am selben Mechanismus: die
komponierte Karte ist um `sectionAttenuation^i` gedämpft, also ist alles weiter
unten rechnerisch leise, unabhängig vom Entwurf. Die Größe dagegen war schon
gebaut — `localMean` liest die mittlere Aufmerksamkeit eines Kandidaten auf der
*ungedämpften* Karte seines eigenen Viewports. Der Plan war, `cta-below-fold`
seine Rangfolge ebenfalls darauf zu stellen: eine Änderung für zwei Regeln.

**In 1.2 B4 umgesetzt und gemessen: die Änderung reicht nicht.** Die Regel
feuert danach zwar, aber unkorreliert mit dem Aufbau — auf Desktop einmal, und
zwar falsch; auf Telefon scrollend auf 24 von 24 Frames. Der Grund steht oben
im Abschnitt zu `cta-below-fold`: der Umbau entfernt die Dämpfung *zwischen*
den Abschnitten und lässt den oben-lastigen Prior *innerhalb* jedes Abschnitts
stehen, womit der Vergleich zu „wer sitzt am dichtesten am oberen Rand seines
eigenen Viewports" wird. Der Befundsatz ist neu geschrieben, die Regel bleibt
`shipped: false`, der Messcode bleibt stehen.

**Was daraus zu lernen ist, gilt über diese Regel hinaus:** „die Größe existiert
schon und muss nur angeschlossen werden" ist eine Vermutung wie jede andere und
gehört gemessen, bevor sie in einer Tabelle als Lösung steht. Diese Tabelle
sagte genau das, drei Runden lang.

| Regel | neue Größe | Stand |
|---|---|---|
| `cta-below-fold` | **Vergleich nur gegen die Kandidaten des ersten Ausschnitts** — statt gegen alle Kandidaten aller Ausschnitte | Die naheliegende Größe (`localMean`) ist in 1.2 B4 gebaut, gemessen und als unzureichend belegt. Siehe die Notiz für 1.3 unmittelbar darunter. Nicht gemessen. |

#### Für 1.3 vorgemerkt: `cta-below-fold` hat die falsche Frage, nicht die falsche Schwelle

Der Unterschied entscheidet, was als Nächstes zu tun ist, deshalb steht er
eigens hier. Eine falsche Schwelle justiert man nach; eine falsche Frage nicht.

**Die Frage lautet heute:** „führt der stärkste Kandidat des Screens seinen
eigenen Ausschnitt an, und liegt dieser Ausschnitt unter dem Fold?" Auf einem
langen Frame liegen die meisten Ausschnitte unter dem Fold — bei 390 × 3000
sind es drei von vier. Die Antwort ist damit überwiegend von der
**Frame-Länge** bestimmt und nicht vom Entwurf. Gemessen: 100 % auf Telefon
scrollend, 4,2 % auf Desktop scrollend, und in beiden Fällen ohne Bezug zu der
Frage, ob der CTA oben oder unten steht.

**Das ist strukturell derselbe Fehler wie bei `dead-cta`.** Dort ist die Größe
ein Minimum über N Kandidaten und sinkt mit deren *Zahl*; hier ist sie ein
Maximum über N Ausschnitte und steigt mit deren *Zahl*. Beide Male hängt die
Antwort an einer Eigenschaft des Frames statt an einer Eigenschaft des
Entwurfs. Wer das übersieht, sucht nach einer Konstante, die es nicht geben
kann — bei `dead-cta` hat genau diese Suche fünf Anläufe gekostet.

**Mögliche Richtung:** den Vergleich auf die Kandidaten des **ersten
Ausschnitts** beschränken. Die Regel fragt dann „gibt es unterhalb des Folds
einen Kandidaten, der stärker ist als alles im ersten Ausschnitt?" — eine
Frage, deren Antwort nicht davon abhängt, wie viele Ausschnitte es darunter
noch gibt. Nicht gemessen, und wie alles in dieser Tabelle erst nach dem Set
mit echten Layer-Bäumen kalibrierbar (PRD Set 2).
| `flat` | **p99 ÷ Median** des Bildanalyse-Anteils statt Massenanteil der stärksten 5 % | Ein Verhältnis von Spitze zu Grundrauschen ist unabhängig von der *Fläche* der Spitze. Genau die Fläche ist es, die den heutigen Wert bei einem großen Hero nach unten zieht und die Größe nicht monoton macht. |
| `dead-cta` | **gleichartige, wiederholte Kandidaten gruppieren**, dann das Minimum bilden — auf `localMean`, das dafür schon existiert | Aus „die neunte von zwölf Listenkarten ist die leiseste" wird „von den *unterscheidbaren* Bedienelementen ist dieses das leiseste". Die Kandidatenzahl hängt dann an der Zahl der Rollen statt an der Zahl der Listeneinträge. |

Was für beide gilt: nach dem Umbau ist neu zu kalibrieren, und dafür fehlt
weiterhin das Set mit echten Layer-Bäumen (PRD Set 2). An UEyes ist keine der
beiden messbar — ein Screenshot hat keine Ebenen.

#### Für 1.3 vorgemerkt: der Rückfall auf die analytische Glocke ist unsichtbar

`check-release.mjs` bewacht die Nutzdaten des Ortspriors, weil sein Fehlen
**still** bleibt. Der Prüfer steht aber im Build, nicht im Plugin. Zur Laufzeit
sagt nichts, welcher Prior tatsächlich gerechnet hat.

**Der Rückfall selbst** (`engine/heuristic.ts`): `priorMap(…) ?? positionPrior(…)`
— ein `??` ohne Protokoll, ohne Rückgabewert, ohne Warnung.

**Was die Fußzeile sagt.** `metaLine` schreibt „Blickverhalten: Mobile App
(automatisch)". Die Kategorie kommt aus `priorAssetIdFor(…)`, also aus der
Geometrie des Frames. Sie ist eine Aussage darüber, welcher Prior **gewählt**
wurde, nicht darüber, welcher **geladen** ist — `hasPriorAsset()` existiert und
wird an dieser Stelle nicht gefragt. Fehlt das Asset, steht dieselbe Zeile mit
denselben Worten unter einer Karte, die die 1.0-Glocke gezeichnet hat.

Zwei Fälle, beide heute unsichtbar:

| Fall | was fehlt | was der Nutzer sieht |
|---|---|---|
| **Kategorie fehlt** | z. B. `mobile@3s` | „Blickverhalten: Mobile App (automatisch)", unverändert. Im Panel verschwindet „Mobile App" aus dem Dropdown (`availablePriorCategories`) — aber „Automatisch erkennen" ist die Voreinstellung und leitet weiter dorthin |
| **Betrachtungsdauer fehlt** | z. B. `web@7s` | `priorMap` weicht stumm auf `web@3s` aus, die Kopfzeile behauptet weiter „Betrachtungsdauer: 7 s". Nach Epic D ist das ein **gemessener** Unterschied (+0,012 bis +0,021 CC) — die Zeile behauptet also genau die Eigenschaft, die gerade nicht gilt |

Sichtbar ist nur ein Grenzfall: fallen **alle zwölf** Assets weg, wird
`shipsPriorAsset()` falsch und die Zeile „Datengrundlage: UEyes …" fehlt. Das
ist das Verschwinden einer Zeile, keine Meldung — und der Alles-oder-nichts-Fall
ist der unwahrscheinlichste.

**Warum es hierher gehört.** Das ist dieselbe Klasse wie die Textfarbe, die
Kantenglättung, die Deckkraft, `dead-cta` und B4: eine Größe ist falsch oder
fehlt, und die Ausgabe sieht unverändert aus. Fünf Anläufe, fünfmal dasselbe
Muster.

**Mögliche Richtung** — der Kanal existiert schon: `pipeline.ts` führt
`warnings: string[]`, dort steht bereits der Bänder-Hinweis. Vor dem Lauf
`hasPriorAsset(resolvedPrior, PROFILE_DURATIONS[profile])` fragen; ist die
Antwort nein, eine Warnung setzen und die Kopfzeile qualifizieren, statt eine
Kategorie zu nennen, die nicht gerechnet hat. Der Test dazu ist billig und
fehlt heute ganz: eine leere Asset-Tabelle darf keine Kopfzeile erzeugen, die
von der intakten nicht zu unterscheiden ist.

Nicht gemessen, nicht gebaut — und anders als der Rest dieser Liste braucht es
kein Set mit echten Layer-Bäumen, sondern nur die Entscheidung, dass ein
Werkzeug seine eigene Ersatzrechnung ansagt.

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

414 Unit-Tests gegen **synthetische** Eingaben mit bekannter Wahrheit — weißes
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
| `src/findings/__tests__/end-to-end.test.ts` | C-1 — jede Regel ist über den **echten** Analysepfad auslösbar *und* zum Schweigen zu bringen |
| `src/findings/__tests__/robustness.test.ts` | 1.2 — dieselben zwölf Fälle noch einmal unter verstellten Engine-Parametern |
| `eval/__tests__/alpha.test.ts` | 1.2 — die Abkürzung im Alpha-Sweep rechnet dasselbe wie `combineFeatureParts` |

### Die Erreichbarkeitsfälle halten auch, wenn jemand an der Engine dreht

Beim Umstieg auf `blendAlpha` 0,5 fiel der Erreichbarkeitstest von
`cta-below-fold` um — nicht, weil die Regel falsch war, sondern weil der Fall
auf der Kippe stand: 0,5227 gegen 0,4773 im Score, und das Verhältnis dreht
sich schon bei α ≈ 0,35. Ein Fall, der nur bei genau den heutigen Konstanten
das Erwartete tut, belegt nichts über die Regel.

Die anderen elf wurden daraufhin unter denselben Störungen nachgemessen. Zwei
weitere waren genauso zerbrechlich, beide bei `competition`:

| Fall | kippte unter | Ursache |
|---|---|---|
| `competition` feuert | `blendGamma` | Ein Gamma über der fertigen Karte drückt alle Werte außer dem Maximum nach unten; das zweite Maximum fiel von 0,709 auf 0,502, unter die Schwelle 0,65. |
| `competition` schweigt | `post.gamma` | Die steilere Tonkurve machte einen abseits stehenden Textknoten zu einer zweiten Region. |
| `cta-below-fold` feuert | `blendAlpha` | Der Gegenspieler stand oben links statt dort, wo ein Impressum-Link wirklich steht. |

Alle drei sind repariert — größere Blöcke und eine größere Lücke bei
`competition`, der Textknoten näher am Block, der Gegenspieler in die ruhigste
Ecke des ersten Viewports. Danach halten **elf von zwölf** Fällen über alle
fünf geprüften Parameter-Ränder (`blendAlpha` 0,3, `blendGamma` 2, `post.gamma`
2, `blurSigmaRatio` 0,035, `clipLowPercentile` 40).

**Der zwölfte hält nicht, und das ist ein Befund über die Regel.** `flat` feuert
nicht mehr, sobald `clipLowPercentile` angehoben wird. Der Grund ist nicht der
Testfall: die Entscheidungsgröße ist die Konzentration des Bildanteils, und der
Clip ist genau dessen Sockel — was darunter liegt, wird 0 und trägt keine Masse
mehr, also steigt die gemessene Konzentration mechanisch, auf einem
gleichmäßigen Screen wie auf einem mit Blickfang. Das ist dieselbe Schwäche der
Größe, an der `flat` schon dreimal gescheitert ist. Die Ausnahme steht als
begründeter Eintrag im Szenario, und der Test prüft, dass die Liste dieser
Ausnahmen **genau einen** Eintrag hat: eine Ausnahmeliste, die wächst, ist ein
Feigenblatt.

Was der Test ausdrücklich **nicht** behauptet: dass die Regeln unter diesen
Parametern gleich *häufig* feuern. Das tun sie nachweislich nicht — siehe A5.
Geprüft wird nur, dass ein Fall mit bekannter Antwort diese Antwort behält.

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
| 5 | **Maps erstellen** auf einem Referenz-Screen | Ladezustand < 300 ms sichtbar; Wrapper `[Figmaps] … — {Dauer} — …` rechts daneben, Viewport springt darauf, `2 Maps erstellt` |
| 6 | Heatmap begutachten | Headlines und primärer CTA erkennbar heiß, leere Flächen kalt; **nichts** ins Bild gemalt außer Overlay und Fold-Marken |
| 7 | Beschriftung neben den Maps | Unter jedem Titel eine Zeile „Algorithmische Vorhersage, keine Messdaten · Blickverhalten: … · Betrachtungsdauer: … · hybrid-v1"; CC-BY-Zeile genau **einmal** unten am Wrapper; nirgends „Ortsprior" |
| 8 | Focusmap gegen die Heatmap halten | Kein harter Rand: ein in der Heatmap deutlich warmer Bereich ist auch in der Focusmap sichtbar, nur schwächer; völlig dunkel ist nur, was in der Heatmap kalt ist |
| 9 | Overlay-Deckkraft ändern, neu erzeugen | Heatmap-Overlay entsprechend transparenter/kräftiger |
| 10 | Frame ohne benannte Buttons/Reactions | Heat- und Focusmap entstehen; Befunde, die Kandidaten brauchen, entfallen still |
| 11 | 5 Frames auswählen, erzeugen | „Frame 2 von 5", je Frame ein eigener Wrapper |
| 12 | Während des Batches **Abbrechen** | Lauf stoppt, bereits erzeugte Wrapper bleiben, Notify „Abgebrochen" |
| 13 | Plugin schließen und neu öffnen | Slider- und Checkbox-Einstellungen sowie die Panelgröße sind erhalten |
| 14 | Frame mit 6000 px Höhe | Hinweis auf Downscale, Maps entstehen, kein Absturz |
| 15 | Zweiter Lauf auf demselben Frame | Neuer Wrapper, der erste bleibt unverändert |
| 15a | Griff unten rechts über den ganzen Bildschirm ziehen | Panel folgt dem Cursor ohne Sprung, stoppt bei 720 × 2400, Layout bleibt intakt; Doppelklick stellt 320 × 680 her |
| 15b | Panel auf 420 px Höhe ziehen | Fußtext bleibt vollständig sichtbar, der Bereich darüber scrollt |
| 15d | Theme-Pille umschalten | Panel wechselt vollständig, nichts bleibt auf der alten Palette; nach Schließen und Öffnen ist die Wahl erhalten |
| 15e | Plugin bei hellem Figma zum ersten Mal öffnen | Panel startet **dunkel** |
| 15f | Regler nur mit der Tastatur bedienen | Tab setzt einen sichtbaren Fokusring, Pfeiltasten ändern den Wert, Shift+Pfeil grob, Home/End ans Ende |
| 15c | Frame mit vielen Befunden erzeugen | Der Befunde-Frame ist so hoch wie sein Inhalt, kein Text angeschnitten |

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
| M5 | Epic C | **fertig bis auf die Textabnahme** — sechs Regeln implementiert und getestet, davon **drei ausgeliefert** (`cta-rank`, `competition`, `cold-fold`); Formulierungen sind noch von einem Menschen freizugeben (C-1) |
| M6 | Epic D | **fertig** — der Beleg liegt vor (Ortseffekt, kreuzvalidiert, siehe [Betrachtungsdauer](#betrachtungsdauer-epic-d--gemessen)); **alle drei Profile werden ausgeliefert**, `shippedProfiles()` gibt `glance, scan, read` |

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
   UEyes und passt auf die eigenen Screens nur, soweit die dem Durchschnitt
   ähneln), und mit dem Asset kommt die **CC-BY-Pflicht** ins Produkt
   ([`NOTICE.md`](NOTICE.md)). Dafür spricht der gemessene Sprung.
2. **Vorab prüfen, ob der Prior auf den eigenen Screens trägt.** Der billigste
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
7. **Das Lockfile zeigt weiterhin auf eine interne Registry** — 211 von 211
   `resolved`-URLs. Die CI kommt inzwischen daran vorbei
   (`scripts/ci-lockfile.mjs` nimmt die Adressen vor `npm ci` aus der
   Arbeitskopie, `integrity` bleibt), aber die Ursache liegt weiter in der
   npm-Konfiguration, die das Lockfile erzeugt: es gibt keine Repo-`.npmrc`,
   der Eintrag kommt aus der Benutzerkonfiguration der Maschine, und der
   nächste `npm install` schreibt die Hosts zurück. Der dauerhafte Ort für
   diese Entscheidung ist eine Repo-`.npmrc` oder die Benutzerkonfiguration —
   beides berührt, wie intern gebaut wird, und liegt bei Security.
8. **Der Gate-Split ist verbrannt.** Er nimmt 20 der 27 Test-Split-Bilder je
   Kategorie und läuft bei jedem PR mit sichtbaren Zahlen — wer eine Änderung
   dreht, bis die Zahl im Check steigt, hat auf ihm kalibriert. Das ist kein
   Mangel des Aufbaus, sondern sein Preis: ein Gate, dessen Zahl man nicht
   sieht, ist kein Gate. Die Konsequenz ist eine Regel, keine Gegenmaßnahme —
   **diese Zahlen dürfen nie als Beleg für Genauigkeit zitiert werden.** Und
   das Set ist mit 40 Bildern ohnehin nur grob: eine Verschlechterung von
   0,065 CC fällt auf, eine von 0,005 nicht zuverlässig.

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

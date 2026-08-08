# Referenz-Daten (A-2)

Dieses Verzeichnis ist **absichtlich leer im Repo** bis auf diese Datei. Fixtures werden nicht committet — Größe (die UEyes-Webseiten-Teilmenge belegt rund 420 MB) und Lizenz. `.gitignore` deckt `eval/fixtures/*` ab, mit dieser README als einziger Ausnahme.

## Struktur

```
eval/fixtures/<set>/
  index.json                { name, source, license, citation, durations, items }
  images/<id>.png           Screenshot, 8 Bit, ohne Interlacing
  heatmaps/<d>s/<id>.png    kontinuierliche Ground Truth   -> CC, KL
  fixmaps/<d>s/<id>.png     binäre Fixationskarte          -> AUC-Judd, NSS
  signals/<id>.json         optional: NodeSignal[] (Layer-Baum)
```

`split` je Eintrag ist `"tuning"`, `"test"`, `"quick"` oder eine Liste davon.
**Tuning und Test bleiben strikt getrennt**: Gewichte werden auf `tuning` optimiert und auf `test` gemessen, nie umgekehrt (A-2). `npm run tune` verweigert den Test-Split.

### Warum zwei Ground-Truth-Kanäle

Das ist keine Redundanz, und die beiden dürfen nicht vermischt werden:

| Metrik | braucht | Datei |
|---|---|---|
| AUC-Judd, NSS | diskrete Fixationspunkte | `fixmaps/<d>s` |
| CC, KL | kontinuierliche Verteilung | `heatmaps/<d>s` |

Fixationen aus der Heatmap abzuleiten (der Fallback für Sets ohne Fixmaps) speist beide Seiten aus derselben Quelle und beschönigt AUC und NSS still. Der Loader markiert das als `fixationSource: 'derived-from-heatmap'`, und der Report weist aus, für wie viele Bilder gemessene Fixationen vorlagen.

Die Fixationskarte wird beim Herunterskalieren **max-gepoolt**, nie gemittelt — Mitteln erzeugt Graustufen, deren Schwellwert stillschweigend entscheidet, wie viele Fixationen die Metriken sehen.

## Schwelle für S-2

> **Die Engine muss die stärkste bildunabhängige Baseline in allen vier Metriken schlagen.**

Bildunabhängig heißt: die Baseline sieht das konkrete Bild nie an. Zwei davon laufen mit:

| Baseline | was sie weiß |
|---|---|
| **Center-Bias**, beste Breite | „Aufmerksamkeit liegt eher mittig" |
| **Mean Map** (Ø Ground Truth des Tuning-Splits) | „so sieht die Verteilung auf dieser Art von Screen üblicherweise aus" |

Die Mean Map ist die härtere und aussagekräftigere: sie kennt den tatsächlichen räumlichen Prior des Datensatzes. **Alles, was sie bereits erklärt, ist Wissen über das Genre und nicht über den konkreten Screen.** Sie wird ausschließlich auf dem Tuning-Split gebildet — andernfalls enthielte sie die Antwort, gegen die sie antritt — und in normierten Koordinaten gemittelt, weil die Bilder unterschiedliche Seitenverhältnisse haben.

Verglichen wird gegen den **besten** Center-Bias je Metrik über eine Reihe von Breiten (σ 0,15 bis 0,8), nicht gegen eine bequem gewählte Standardbreite. Der Report führt die Streuung unter „Robustheit der Baseline" auf, und weist zusätzlich aus, in wie vielen Einzelbildern die Engine die Mean Map schlägt.

Wird die Schwelle nicht erreicht, ist das das Ergebnis der Iteration und **kein Grund, die Baseline zu schwächen** — Konsequenz laut PRD §8: Heuristik verwerfen und in 1.2 direkt auf ein trainiertes Modell gehen.

S-3 (Tuning) verlangt zusätzlich mindestens **+0,040 AUC** gegenüber der 1.0-Baseline auf dem Test-Split.

## Set 1 — UEyes (importiert)

UEyes (CHI 2023, Jiang et al.) — Eye-Tracking auf 1.980 UI-Screenshots über vier UI-Typen (webpage, desktop UI, mobile UI, poster) zu je 495 Bildern, mit Saliency-Maps für 1 s, 3 s und 7 s.

**Lizenz: CC BY 4.0.** Die Autoren sind in jeder Veröffentlichung zu nennen; der Harness schreibt das Zitat automatisch aus `index.json` in jeden Report.

```bash
npm run eval:fixtures -- --ueyes /pfad/zum/UEyes_dataset --category web
npm run eval:fixtures -- --ueyes /pfad/zum/UEyes_dataset --category mobile
# oder:  UEYES_DIR=/pfad/zum/UEyes_dataset npm run eval:fixtures -- --ueyes --category mobile
```

Der Pfad ist ein Parameter, nie eine Konstante im Code. Fehlt der Ordner oder die Index-Datei, bricht der Import mit einer Meldung ab, die sagt, wonach gesucht wurde.

### Eine Kategorie, ein Set — nie gemischt

`--category` ist `web`, `mobile`, `desktop` oder `poster` und landet jeweils in einem eigenen Set (`ueyes-web`, `ueyes-mobile`, …), das getrennt berichtet wird. Das ist keine Bequemlichkeit: UEyes' zentraler Befund ist, dass Location- und Gaze-Direction-Bias sich zwischen UI-Typen unterscheiden. Ein gemeinsamer Mittelwert würde genau das verwischen, und eine gemeinsame Mean Map wäre für jeden einzelnen Typ falsch.

### Was der Import tut

- übernimmt die **Train/Test-Zuordnung des Datensatzes**, ohne eine eigene Aufteilung zu erfinden: `Train` → `tuning`, `Test` → `test`,
- kopiert `heatmaps_<d>s` und `fixmaps_<d>s` für **1 s, 3 s und 7 s**,
- legt **kein** `signals/` an — ein Screenshot hat keinen Layer-Baum, und einen zu erfinden würde eine Messung von drei der sieben Feature-Maps vortäuschen,
- prüft jede Datei mit unserem PNG-Decoder, statt sie blind zu übernehmen,
- transcodiert Nicht-PNG-Quellen mit `sips` nach PNG (siehe unten).

Die Index-Datei heißt je nach Release `info.csv` oder `image_types.csv`; beide werden gefunden. Die Kategorie steht dort als `web` / `mobile`, die README des Datensatzes nennt sie „webpage" / „mobile UI" — beide Schreibweisen werden akzeptiert. Die Spaltenzuordnung läuft über die Kopfzeile, das Trennzeichen (`;` oder `,`) wird erkannt.

### Ergebnis des Imports (Stand 2026-08-08)

| Kategorie | tuning | test | quick | übersprungen | Quellformat |
|---|---:|---:|---:|---:|---|
| `web` | 468 | 27 | 27 | 0 | PNG, verlustfrei |
| `mobile` | 468 | 27 | 27 | 0 | JPEG → PNG transcodiert |
| `desktop` | 468 | 27 | 27 | 0 | überwiegend PNG, 91 transcodiert |
| `poster` | 467 | 27 | 27 | 1 | JPEG → PNG, 1 Adam7-PNG nicht konvertierbar |

**Der Test-Split ist mit je 27 Bildern klein.** Das ist die Aufteilung des Datensatzes, nicht unsere. Mittelwerte darüber schwanken entsprechend; solange nichts getunt ist, ist ein Kontrolllauf auf dem Train-Split zur Absicherung zulässig und sinnvoll.

### Datenqualität: JPEG-Fixationskarten

Die Mobile-Teilmenge liegt vollständig als JPEG vor — **auch die Fixationskarten**, die per Definition binär sind. JPEG ist verlustbehaftet, entsprechend sitzt um jeden Fixationsblob ein Ringing-Saum: rund **0,7 % der Pixel** sind weder 0 noch 255. Beim Einlesen wird bei 127 re-binarisiert; ein dünner Saum je Blob bleibt als Rauschquelle, die in der verlustfreien Web-Teilmenge fehlt.

Der Import misst das an einer Stichprobe und schreibt es als Hinweis in `index.json`, von wo es in jeden Report wandert. Es ist klein genug, um die Messung nicht zu entwerten, und zu groß, um es zu verschweigen.

## Set 2 — eigenes Validierungsset (offen)

10 meinestadt-Screens mit First-Click-Test (Lyssna oder Maze, ca. 50 Teilnehmer). Kleiner und lauter als UEyes, aber domänennah — und vor allem das **einzige** Set, mit dem sich `textSalience`, `interactiveSalience` und `imageSalience` überhaupt bewerten lassen, weil dort ein Layer-Baum existiert. Solange es fehlt, bleibt jede Messung eine Teilmessung über rund 60 % der Engine-Gewichtung.

## Set 3 — synthetisch (Rauchtest)

```bash
npm run eval:fixtures -- --synthetic
npm run eval -- --fixtures synthetic --set test --report out/eval-synthetic.md
```

Generiert lizenzfreie UI-artige Screens mit konstruierter Ground Truth, inklusive Layer-Signalen und Fixationskarten.

**Dieses Set prüft den Harness, nicht die Engine.** Die Ground Truth ist gebaut, nicht gemessen. Zahlen daraus sind kein Beleg für S-2 oder S-3, gehören nicht in einen Abnahmebericht und werden nicht mit UEyes-Läufen gemischt.

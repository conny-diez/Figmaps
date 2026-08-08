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

> **Die Engine muss die Center-Bias-Baseline in allen vier Metriken schlagen.**

Verglichen wird gegen den **besten** Center-Bias je Metrik über eine Reihe von Breiten (σ 0,15 bis 0,8), nicht gegen eine bequem gewählte Standardbreite. Der Report führt die Streuung unter „Robustheit der Baseline" auf.

Wird die Schwelle nicht erreicht, ist das das Ergebnis der Iteration und nicht ein Grund, die Baseline zu schwächen — Konsequenz laut PRD §8: Heuristik verwerfen und in 1.2 direkt auf ein trainiertes Modell gehen.

S-3 (Tuning) verlangt zusätzlich mindestens **+0,040 AUC** gegenüber der 1.0-Baseline auf dem Test-Split.

## Set 1 — UEyes (importiert)

UEyes (CHI 2023, Jiang et al.) — Eye-Tracking auf 1.980 UI-Screenshots, davon 495 Webpages, mit Saliency-Maps für 1 s, 3 s und 7 s.

**Lizenz: CC BY 4.0.** Die Autoren sind in jeder Veröffentlichung zu nennen; der Harness schreibt das Zitat automatisch aus `index.json` in jeden Report.

```bash
npm run eval:fixtures -- --ueyes /pfad/zum/UEyes_dataset
# oder:  UEYES_DIR=/pfad/zum/UEyes_dataset npm run eval:fixtures -- --ueyes
```

Der Pfad ist ein Parameter, nie eine Konstante im Code. Fehlt der Ordner oder die Index-Datei, bricht der Import mit einer Meldung ab, die sagt, wonach gesucht wurde.

Der Import:

- nimmt **nur die Kategorie `web`** (die README des Datensatzes nennt sie „webpage"; die Index-Datei schreibt `web`),
- übernimmt die **Train/Test-Zuordnung des Datensatzes**, ohne eine eigene Aufteilung zu erfinden: `Train` → `tuning`, `Test` → `test`,
- kopiert `heatmaps_<d>s` und `fixmaps_<d>s` für **1 s, 3 s und 7 s**,
- legt **kein** `signals/` an — ein Screenshot hat keinen Layer-Baum, und einen zu erfinden würde eine Messung von drei der sieben Feature-Maps vortäuschen,
- prüft jede Datei beim Kopieren mit unserem PNG-Decoder, statt sie blind zu übernehmen.

Die Index-Datei heißt je nach Release `info.csv` oder `image_types.csv`; beide werden gefunden. Die Spaltenzuordnung läuft über die Kopfzeile, das Trennzeichen (`;` oder `,`) wird erkannt.

Ergebnis des Imports (Stand 2026-08-08):

| | |
|---|---|
| tuning (Train) | 468 |
| test (Test) | 27 |
| davon quick (A-7) | 27 |
| übersprungen | 0 |

**Der Test-Split ist mit 27 Bildern klein.** Das ist die Aufteilung des Datensatzes, nicht unsere. Mittelwerte darüber schwanken entsprechend; ein Kontrolllauf auf dem Train-Split (468 Bilder, ohne dass je darauf getunt wurde) ist zur Absicherung sinnvoll, solange nichts getunt ist.

## Set 2 — eigenes Validierungsset (offen)

10 meinestadt-Screens mit First-Click-Test (Lyssna oder Maze, ca. 50 Teilnehmer). Kleiner und lauter als UEyes, aber domänennah — und vor allem das **einzige** Set, mit dem sich `textSalience`, `interactiveSalience` und `imageSalience` überhaupt bewerten lassen, weil dort ein Layer-Baum existiert. Solange es fehlt, bleibt jede Messung eine Teilmessung über rund 60 % der Engine-Gewichtung.

## Set 3 — synthetisch (Rauchtest)

```bash
npm run eval:fixtures -- --synthetic
npm run eval -- --fixtures synthetic --set test --report out/eval-synthetic.md
```

Generiert lizenzfreie UI-artige Screens mit konstruierter Ground Truth, inklusive Layer-Signalen und Fixationskarten.

**Dieses Set prüft den Harness, nicht die Engine.** Die Ground Truth ist gebaut, nicht gemessen. Zahlen daraus sind kein Beleg für S-2 oder S-3, gehören nicht in einen Abnahmebericht und werden nicht mit UEyes-Läufen gemischt.

# Referenz-Daten (A-2)

Dieses Verzeichnis ist **absichtlich leer im Repo**. Fixtures werden nicht committet — Größe und Lizenz.

## Struktur

```
eval/fixtures/<set>/
  index.json          { name, source, license, fixationCount?, items: [{ id, split, duration? }] }
  images/<id>.png     Screenshot, 8 Bit, ohne Interlacing
  maps/<id>.png       Ground-Truth-Saliency, Graustufen
  signals/<id>.json   optional: NodeSignal[] (Layer-Baum)
```

`split` ist `"tuning"`, `"test"`, `"quick"` oder eine Liste davon.
**Tuning und Test bleiben strikt getrennt**: Gewichte werden auf `tuning` optimiert und auf `test` gemessen, nie umgekehrt (A-2). `npm run tune` verweigert den Test-Split.

## Set 1 — UEyes (geplant, offene Lizenzfrage)

UEyes (CHI 2023, Jiang et al.) — Eye-Tracking auf 1.980 UI-Screenshots, davon 495 Webpages, mit Saliency-Maps für 1 s, 3 s und 7 s. Öffentlich auf Zenodo.

Verwendet wird zunächst nur die **Webpage**-Teilmenge: 150 Bilder Tuning, 200 Bilder Test.

> **Vor Nutzung durch den Product Owner zu klären:** Ob die Lizenz des Datensatzes die interne Verwendung bei meinestadt.de zur Kalibrierung eines internen Tools abdeckt. Der Datensatz ist für Forschung publiziert; das ist eine Frage an die Rechtsabteilung, keine technische. Der Download ist deshalb **nicht** automatisiert.

Sobald geklärt und heruntergeladen:

```bash
# Bilder ggf. nach PNG konvertieren (macOS):
#   sips -s format png quelle.jpg --out ziel/images/id.png
npm run eval:fixtures -- --import /pfad/zu/ueyes-web --name ueyes-web
```

`duration` pro Eintrag (1, 3 oder 7) setzen, damit Epic D jedes Profil gegen die passende Betrachtungsdauer tunt.

## Set 2 — eigenes Validierungsset (ohne Lizenzfrage)

10 meinestadt-Screens mit First-Click-Test (Lyssna oder Maze, ca. 50 Teilnehmer). Kleiner und lauter als UEyes, aber unstrittig und domänennah — prüft vor allem die Rangfolge der Clickmap.

## Set 3 — synthetisch (sofort verfügbar)

```bash
npm run eval:fixtures -- --synthetic
npm run eval -- --fixtures synthetic --set test --report out/eval-synthetic.md
```

Generiert lizenzfreie UI-artige Screens mit konstruierter Ground Truth, inklusive Layer-Signalen.

**Dieses Set prüft den Harness, nicht die Engine.** Die Ground Truth ist gebaut, nicht gemessen. Zahlen daraus sind kein Beleg für S-2 oder S-3 und gehören nicht in einen Abnahmebericht.

# Drittanbieter-Inhalte, Namensnennung und nicht gemessene Annahmen

## Nicht gemessene Annahmen

Alles, was Figmaps über Aufmerksamkeit behauptet, ist entweder an UEyes
gemessen oder steht hier. Diese Liste ist kurz zu halten.

### Scrolltiefen-Dämpfung (`ENGINE_CONFIG.viewport.sectionAttenuation`)

Bei segmentierten Frames trägt jeder Abschnitt abgeschwächt zur Gesamtkarte
bei — Abschnitt *i* mit `max(0,12; 0,5^i)`.

**Begründung:** Ohne Dämpfung bekommt jeder Abschnitt seinen eigenen,
gleich starken Ortsprior; auf inhaltsarmen Flächen entsteht dadurch ein Band
am Kopf *jedes* Abschnitts im Abstand eines Abschnittsschritts. Dass
Aufmerksamkeit mit der Scrolltiefe abnimmt, ist aus Web-Analytics gut belegt.

**Was nicht gemessen ist:** alles Quantitative daran. UEyes enthält
ausschließlich einzelne Viewport-Ausschnitte, keine gescrollten Seiten. Weder
der Verlauf (geometrisch) noch der Faktor (0,5) noch die Untergrenze (0,12)
sind an Daten überprüft. Der Startwert wurde so gewählt, dass die Bänder auf
einem grauen 1440 × 4000-Testframe verschwinden — ein Kriterium für die
Darstellung, nicht für die Vorhersagegüte.

**Wie es überprüfbar würde:** Eye-Tracking oder Scroll-Analytics auf gescrollten
Seiten. Das eigene First-Click-Set könnte den Anfang liefern.

### Was inzwischen doch gemessen ist

Die **Betrachtungsdauer** (Epic D) stand hier ursprünglich als Hypothese. Sie
ist seit dem 8.8.2026 gemessen: ein Ortsprior, der zur Betrachtungsdauer passt,
sagt die Aufmerksamkeit dieser Dauer belastbar besser vorher als der 3 s-Prior
(alle 95-%-Intervalle klar über null, beide UI-Kategorien). Die drei Profile
tauschen deshalb den Prior und nicht die Gewichte. Siehe README, „Betrachtungs-
dauer (Epic D)".

### Alle Messzahlen gelten für einzelne Viewport-Ausschnitte

Sämtliche Reports (`npm run eval`, `crossval`, `diagnose`) laufen mit
`segment: false` auf Einzel-Screenshots. **Für segmentierte Frames ist keine
einzige Zahl gemessen.** Das steht auch in jedem Report neben den Tabellen.

### Ortsprior-Auswahl aus der Frame-Breite

Die Regel „schmaler als 600 px **und** hochkant ⇒ mobil" nutzt eine
Design-Pixel-Schwelle, die an UEyes nicht überprüfbar ist: der Datensatz
speichert Geräte-Pixel (Telefone mit 1080 px Breite). Überprüft ist nur der
Seitenverhältnis-Teil — er trennt Webseite und Mobile auf den 1.980 gelabelten
Bildern fehlerfrei.

---

# Drittanbieter-Inhalte und Namensnennung

## UEyes — Ortsprioren in `src/engine/priors/generated.ts`

Figmaps liefert zwölf kleine Graustufen-Maps mit (vier UI-Kategorien × drei
Betrachtungsdauern, je 1,3 kB), die als **Ortsprior** der Konfiguration
`hybrid-v1` dienen. Sie sind ein **abgeleitetes Werk** des Datensatzes UEyes.

> Jiang, Yue, Luis A. Leiva, Hamed Rezazadegan Tavakoli, Paul R. B. Houssel,
> Julia Kylmälä und Antti Oulasvirta. „UEyes: Understanding Visual Saliency
> across User Interface Types." In *Proceedings of the 2023 CHI Conference on
> Human Factors in Computing Systems*, S. 1–21, 2023.
> <https://doi.org/10.1145/3544548.3581096>

**Lizenz:** Creative Commons Attribution 4.0 International (CC BY 4.0) —
<https://creativecommons.org/licenses/by/4.0/>

**Vorgenommene Änderungen** (CC BY verlangt, Bearbeitungen kenntlich zu machen):
Die Saliency-Maps des Tuning-Splits **aller vier Kategorien** (webpage,
mobile UI, desktop UI, poster) wurden je Betrachtungsdauer (1 s, 3 s, 7 s) auf
ein gemeinsames quadratisches Raster skaliert, gemittelt, normiert und auf
8 Bit bei 32 × 32 quantisiert. Es werden **keine Einzelbilder und keine
Einzel-Maps** des Datensatzes ausgeliefert — nur Mittelwerte über je 467–468
Maps.

### Wo die Namensnennung stehen muss

CC BY 4.0 verlangt die Nennung „in einer der Art der Nutzung angemessenen
Weise". Konkret für dieses Plugin:

| Ort | Status | Warum |
|---|---|---|
| Diese Datei (`NOTICE.md`) | ✅ | Kanonische Stelle im Repo |
| Kopf von `src/engine/priors/generated.ts` | ✅ | Wandert mit dem Code, überlebt Copy-Paste |
| Plugin-Panel, Fußbereich | ✅ | Die einzige Stelle, die Nutzer tatsächlich sehen |
| `README.md` | ✅ | Für Entwickler und Evaluierende |
| Beschreibung beim Community-Publishing | ⚠️ offen | Muss beim Veröffentlichen eingetragen werden — siehe unten |

> **Wichtig:** Die Maps liegen im Bundle, **sobald das Plugin gebaut wird** —
> unabhängig davon, ob `hybrid-v1` die aktive Konfiguration ist. `params.ts`
> importiert sie statisch. Die Pflicht zur Namensnennung entsteht also mit dem
> Ausliefern des Builds, nicht erst mit dem Umschalten der Engine. Wer die
> Attribution vermeiden will, muss das Asset entfernen, nicht nur die
> Konfiguration umstellen.

### Beim Community-Publishing einzutragen

In die Plugin-Beschreibung, wörtlich:

> Der Ortsprior dieses Plugins ist abgeleitet aus dem UEyes-Datensatz
> (Jiang et al., CHI 2023, https://doi.org/10.1145/3544548.3581096),
> lizenziert unter CC BY 4.0. Die Daten wurden gemittelt und verkleinert.

### Nicht ausgeliefert

Der Datensatz selbst (`eval/fixtures/`) ist **nicht** Teil des Repos und wird
nicht verteilt — siehe `eval/fixtures/README.md`. Er wird lokal zum Messen
verwendet.

### Seit 1.2 liegen 40 UEyes-Bilder im Repository

`eval/fixtures/gate-web/` und `gate-mobile/` enthalten je 20 Bilder aus dem
Test-Split von UEyes, samt Heatmaps und Fixationskarten für 3 s, verkleinert auf
das Analyseraster. Sie sind die Datengrundlage des Regressions-Gates.

CC BY 4.0 erlaubt die Weitergabe ausdrücklich, auch verändert und auch
kommerziell, solange die Nennung erfolgt und Änderungen kenntlich sind. Beides
ist erfüllt: die Nennung steht hier, im `index.json` beider Sets und in jedem
Report; die Verkleinerung und das Maximum-Pooling der Fixationskarten sind im
`index.json` als Änderung vermerkt.

### Für die Rechtsabteilung

Zwei Punkte, die eine technische Entscheidung überschreiten und vor einer
Veröffentlichung zu klären sind:

1. **Reichweite des abgeleiteten Werks.** Die erzeugten Maps entstehen unter
   Verwendung des Priors. Ob die *Ausgabe* des Plugins damit ebenfalls als
   abgeleitetes Werk gilt und die Namensnennung tragen müsste, ist eine
   juristische Bewertung. Technisch wäre es umsetzbar (die Fußzeile jeder Map
   ließe sich um eine Zeile ergänzen); ob es nötig ist, entscheiden wir nicht.
2. **Interne vs. öffentliche Nutzung.** Für die rein interne Verwendung gelten
   dieselben CC-BY-Pflichten; beim Publishing in die Figma Community kommt die
   Sichtbarkeit in der Store-Beschreibung hinzu.

## Manrope und JetBrains Mono — Schriften in `assets/fonts/`

Das Panel liefert zwei Webfonts als Base64-Data-URI in `build/ui.html` aus;
`scripts/build.mjs` setzt sie beim Bauen in `src/ui/styles.css` ein. Das
Manifest verbietet Netzwerkzugriff (`networkAccess: none`), die Schriften
können also nicht von einem CDN geladen werden.

| Schrift | Datei | Lizenz |
|---|---|---|
| Manrope | `assets/fonts/manrope-latin.woff2` | SIL Open Font License 1.1 |
| JetBrains Mono | `assets/fonts/jetbrains-mono-latin.woff2` | SIL Open Font License 1.1 |

**Vorgenommene Änderungen:** keine. Es sind die unveränderten Latin-Subsets in
der Fassung, die Google Fonts ausliefert (variable Fonts, Achse `wght`).

Die OFL erlaubt Weitergabe und Einbettung; sie verlangt, dass die Lizenz
mitgeliefert wird und die Schriften nicht einzeln verkauft werden.

- Manrope: <https://github.com/sharanda/manrope> (Mikhail Sharanda, OFL 1.1)
- JetBrains Mono: <https://github.com/JetBrains/JetBrainsMono> (JetBrains, OFL 1.1)
- Lizenztext: <https://openfontlicense.org/>

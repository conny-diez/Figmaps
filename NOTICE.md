# Drittanbieter-Inhalte und Namensnennung

## UEyes — Ortsprioren in `src/engine/priors/generated.ts`

FigMaps liefert zwei kleine Graustufen-Maps mit, die als **Ortsprior** der
Konfiguration `hybrid-v1` dienen. Sie sind ein **abgeleitetes Werk** des
Datensatzes UEyes.

> Jiang, Yue, Luis A. Leiva, Hamed Rezazadegan Tavakoli, Paul R. B. Houssel,
> Julia Kylmälä und Antti Oulasvirta. „UEyes: Understanding Visual Saliency
> across User Interface Types." In *Proceedings of the 2023 CHI Conference on
> Human Factors in Computing Systems*, S. 1–21, 2023.
> <https://doi.org/10.1145/3544548.3581096>

**Lizenz:** Creative Commons Attribution 4.0 International (CC BY 4.0) —
<https://creativecommons.org/licenses/by/4.0/>

**Vorgenommene Änderungen** (CC BY verlangt, Bearbeitungen kenntlich zu machen):
Die Saliency-Maps des Tuning-Splits der Kategorien *webpage* und *mobile UI*
wurden auf ein gemeinsames quadratisches Raster skaliert, gemittelt, normiert
und auf 8 Bit bei 32 × 32 quantisiert. Es werden **keine Einzelbilder und keine
Einzel-Maps** des Datensatzes ausgeliefert — nur der Mittelwert über 468 Maps je
Kategorie.

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

### Für die Rechtsabteilung

Zwei Punkte, die eine technische Entscheidung überschreiten und vor einer
Veröffentlichung zu klären sind:

1. **Reichweite des abgeleiteten Werks.** Die erzeugten Maps entstehen unter
   Verwendung des Priors. Ob die *Ausgabe* des Plugins damit ebenfalls als
   abgeleitetes Werk gilt und die Namensnennung tragen müsste, ist eine
   juristische Bewertung. Technisch wäre es umsetzbar (die Fußzeile jeder Map
   ließe sich um eine Zeile ergänzen); ob es nötig ist, entscheiden wir nicht.
2. **Interne vs. öffentliche Nutzung.** Für die interne Verwendung bei
   meinestadt.de gelten dieselben CC-BY-Pflichten; beim Publishing in die
   Figma Community kommt die Sichtbarkeit in der Store-Beschreibung hinzu.

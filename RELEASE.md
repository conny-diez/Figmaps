# Figmaps 1.0.0 Beta 1

Figmaps ist ein Figma-Plugin. Es nimmt einen ausgewählten Frame und legt rechts
daneben Karten als Bilder auf den Canvas:

- **Heatmap** — wohin die Aufmerksamkeit voraussichtlich zuerst wandert.
- **Focusmap** — derselbe Screen, scharf dort, wo Aufmerksamkeit vorhergesagt
  wird, und zum ruhigen Rand hin abgedunkelt und unscharf.
- **Contrastmap** — welche Texte zu wenig Kontrast zu ihrem tatsächlichen
  Hintergrund haben, gemessen nach WCAG 2.1 AA.

Dazu ein Textrahmen mit **Vorhersage-Befunden** in ganzen Sätzen („Der Blickfang
liegt unter der Falz") und, bei langen Frames, eine **Above-the-fold**-Karte über
den ersten Bildschirmausschnitt allein.

Der Unterschied zwischen den ersten beiden Karten und der dritten ist der
wichtigste Satz dieses Textes: **Heatmap und Focusmap sind Vorhersagen, die
Contrastmap ist eine Messung.** In der Ausgabe stehen die beiden Arten getrennt,
mit eigener Beschriftung, und die Fußzeile jeder Karte sagt, welche von beiden
sie trägt.

> **Das ist eine Beta.** Die Kennung gilt für die **Vorhersage**, nicht für die
> Stabilität des Codes: die Engine ist gegen einen einzigen öffentlichen
> Datensatz gemessen, drei der sechs Befundregeln sind abgeschaltet, und für die
> eigenen Screens fehlt ein Validierungsset. Die **Contrastmap ist davon nicht
> betroffen** — sie rechnet eine Norm aus und ist nachprüfbar.
>
> Sichtbar ist die Fassung an jeder Stelle, an der ein Ergebnis auftaucht: im
> Kopf des Panels, im Fenstertitel, im Plugin-Namen „Figmaps (Beta)", im Namen
> des Wrapper-Frames und in der Fußzeile unter jeder Karte — die reist auch mit
> einer exportierten Map mit.

<!-- download-hinweis:anfang -->
> **Lade `figmaps-1.0.0-beta.1.zip`.** Die beiden „Source code"-Archive von
> GitHub funktionieren nicht — sie enthalten den Quellcode ohne gebautes Plugin.
> Nach dem Entpacken müssen `manifest.json` und ein Ordner `build/`
> nebeneinander liegen.
<!-- download-hinweis:ende -->

---

## Was die Contrastmap misst

Die einzige Karte, die keine Vorhersage ist. Geprüft wird nach WCAG 2.1 AA:

- **1.4.3 Kontrast (Minimum)** — Text gegen seinen tatsächlichen Hintergrund,
  4,5:1 bzw. 3:1 bei großer Schrift.
- **1.4.11 Kontrast von Nicht-Text-Inhalten** — die Begrenzung eines
  Bedienelements gegen die unmittelbar angrenzende Farbe, 3:1. Mit der
  Ausnahme, die die meisten Fehlmeldungen verhindert: trägt eine Komponente
  eigenen sichtbaren Text, ist ihre Begrenzung nicht erforderlich. Ein gelber
  Knopf mit dunkler Beschriftung wird deshalb **nicht** gemeldet, obwohl seine
  Fläche 1,45:1 misst. Wir vermuten, dass rasterbasierte Prüfwerkzeuge hier
  melden, weil sie nur Pixel sehen und nicht wissen, was ein Element ist —
  nachgeprüft haben wir das nicht, der Eindruck stammt aus einem Screenshot.

Gemessen wird hybrid: Geometrie, Schriftgröße und Textfarbe aus dem
Layer-Baum, der Hintergrund aus den gerenderten Pixeln. Den Hintergrund aus dem
Baum zu rekonstruieren hieße, Figmas Renderer nachzubauen.

Die Schwellen sind **zitiert, nicht kalibriert**. Sie stehen in der Norm; es
gibt nichts an ihnen einzustellen, und sie veralten nicht.

---

## Drei Einordnungen, die in jede Beschreibung gehören

**1. Vorhersage ist keine Messung — die Contrastmap schon.** Heatmap und
Focusmap schätzen, wohin ein Blick wahrscheinlich fällt; sie sind an einem
Datensatz kalibriert und können daneben liegen. Die Contrastmap rechnet eine
Norm aus.

Der Unterschied liegt nicht darin, dass die Messung nicht falsch sein könnte.
Sie war es: in der Entwicklung dieser Fassung sind drei Messfehler in der
Contrastmap aufgefallen — die Kantenglättung an Glyphen, die fehlende Textfarbe
und eine Deckkraft unter 1, die aus dem Layer-Baum nicht in die Farbe einging.
Der letzte hat es gerade **nicht** gesagt: er meldete stillschweigend zu gute
Werte, und kein Test schlug an.

Nachprüfbar ist deshalb nicht die Implementierung, sondern die **Größe**. Ein
Kontrastverhältnis kann jeder mit einer Pipette gegenrechnen und uns
widerlegen — das ist die Eigenschaft, die zählt. Eine Heatmap kann man nicht
gegenrechnen; es gibt keinen Wert, gegen den man sie hielte. Im Plugin sind die
beiden Arten deshalb getrennt: eigene Karte, eigene Befundliste, eigener
Kartenkopf, kein gemeinsamer Text.

**2. Das Werkzeug hilft mehr bei Screens, deren Blickfang tiefer liegt als
üblich.** Der Gewinn gegenüber einer generischen Annahme („oben wird
geschaut") ist dort am größten, wo der Schwerpunkt der Aufmerksamkeit
ungewöhnlich weit unten sitzt. Bei einem Entwurf, der ohnehin dem üblichen
Muster folgt, bestätigt die Karte meist, was man erwartet hat. Das ist kein
Mangel, aber es entscheidet, wann sich das Öffnen lohnt.

**3. Drei der sechs Befundregeln sind abgeschaltet, und zwar mit Grund.**
Ausgeliefert sind `cta-rank`, `competition` und `cold-fold`. Nicht
ausgeliefert sind `flat`, `dead-cta` und `cta-below-fold` — allen dreien fehlt
eine belastbare **Entscheidungsgröße**, nicht eine Schwelle, und ohne einen
Satz echter Figma-Dateien mit Layer-Baum lässt sich keine von ihnen
kalibrieren. Eine Regel, die auf 0 % oder auf 100 % der Screens feuert, wird
hier nicht ausgeliefert, auch wenn sie plausibel klingt. Das heißt auch: ein
Screen bekommt selten mehr als ein bis zwei Vorhersage-Befunde. Das ist so
gewollt.

---

## Bekannte Einschränkungen

- **Sichtbar, und der einzige sichtbare Defekt, den wir bewusst ausliefern:**
  auf sehr langen, gleichförmigen Frames zeichnet die Heatmap waagerechte
  Bänder an den Abschnittsgrenzen. Auf dem grauen 1440 × 4000-Testframe
  gemessen: Band 3 bei **100 %** Deckkraft, Bänder 4 und 5 bei rund **50 %**
  (51 % und 48 %). Die naheliegende Abhilfe wurde gemessen und verworfen — sie
  kostet auf echten Screens sichtbare Fläche.
- Über Fotos und Verläufen gibt es kein „das" Kontrastverhältnis; gemeldet wird
  der schlechteste Wert im Textbereich, gekennzeichnet als Näherung.
- Zustände (Hover, Fokus, deaktiviert) sind in einem statischen Frame nicht
  prüfbar.
- Betriebssystem-Chrome (Statusleiste, Home-Indicator) wird anhand des
  Ebenennamens übersprungen und gezählt.
- Verdeckte, gedrehte und subpixelgenau platzierte Elemente sind ungeprüft:
  die Bounding-Box eines Layers ist nicht immer das, was man sieht.
- Die Vorhersage ist an **freiem Betrachten** kalibriert — die UEyes-Probanden
  hatten keine Aufgabe. Wer vor einem Screen mit einer klaren
  Handlungsaufforderung sitzt, schaut zielgerichtet, nicht frei. Auf
  explorativen Screens ist die Vorhersage deshalb näher dran als auf Screens
  mit einer einzelnen klaren Aktion.

## Installation

Das angehängte Zip entpacken, dann in Figma: **Plugins → Development → Import
plugin from manifest…** und die `manifest.json` im entpackten Ordner wählen. Im
Menü erscheint das Plugin als **„Figmaps (Beta)"**. Die Kurzanleitung liegt als
`LIESMICH.txt` daneben.

## Datengrundlage

Der Ortsprior der Vorhersage ist aus dem UEyes-Datensatz abgeleitet
(Jiang et al., CHI 2023), CC BY 4.0. Einzelheiten in `NOTICE.md`.

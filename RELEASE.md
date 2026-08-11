# Figmaps 1.2 — Beta

<!-- download-hinweis:anfang -->
> **Lade `figmaps-1.2.0.zip`.** Die beiden „Source code"-Archive von GitHub
> funktionieren nicht — sie enthalten den Quellcode ohne gebautes Plugin. Nach
> dem Entpacken müssen `manifest.json` und ein Ordner `build/` nebeneinander
> liegen.
<!-- download-hinweis:ende -->

**Die Verschiebung dieser Version in einem Satz:** Figmaps war ein
Vorhersagewerkzeug mit einem Kontrast-Zusatz und ist ein **Messwerkzeug mit
einem Vorhersage-Zusatz** geworden.

Das ist keine Umbenennung, sondern eine Beobachtung an der Ausgabe. Auf einem
typischen Onboarding-Screen (393 × 852) misst die neue Contrastmap **acht
Textelemente** und nennt für jedes einen nachrechenbaren Wert; die Vorhersage
steuert **einen** Befund bei. Auf einem Desktop-Frame sind es 21 gemessene
Werte, davon 14 unter der Anforderung, gegen im Schnitt 1,7 vorhergesagte
Befunde. Wer das Plugin öffnet, bekommt ab 1.2 überwiegend Zahlen, die man
nachrechnen kann — auch dort, wo sie „bestanden" lauten.

---

## Neu: die Contrastmap

Eine dritte Karte, und die einzige, die keine Vorhersage ist. Sie misst nach
WCAG 2.1 AA:

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

## Besser: die Vorhersage

- Die Karten sind schärfer. Die Prüfung der Ausgangsvermutung („die Karten sind
  zu weich") ergab, dass der bisher dafür gehaltene Regler der falsche war —
  eine höhere Bildgewichtung macht die Karte *weicher*, nicht schärfer.
  Wirksam ist eine Tonkurve über der fertigen Karte.
- `competition` misst den Abstand zweier Blickfänge jetzt auf der Diagonale
  statt an der Breite. „Weit auseinander" hieß vorher auf einem Telefon etwas
  anderes als auf einem Desktop.
- `cold-fold` hat eine Schwelle je UI-Typ. Mit einer gemeinsamen Zahl sagte die
  Regel auf Telefon-Screens häufiger ja als nein.

---

## Drei Einordnungen, die in jede Beschreibung gehören

**1. Vorhersage ist keine Messung — die Contrastmap schon.** Heatmap und
Focusmap schätzen, wohin ein Blick wahrscheinlich fällt; sie sind an einem
Datensatz kalibriert und können daneben liegen. Die Contrastmap rechnet eine
Norm aus.

Der Unterschied liegt nicht darin, dass die Messung nicht falsch sein könnte.
Sie war es: allein in dieser Version sind drei Messfehler in der Contrastmap
aufgefallen — die Kantenglättung an Glyphen, die fehlende Textfarbe und eine
Deckkraft unter 1, die aus dem Layer-Baum nicht in die Farbe einging. Der
letzte hat es gerade **nicht** gesagt: er meldete stillschweigend zu gute
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

Offen gesagt hat 1.2 dem Regelwerk **keine neue Regel** hinzugefügt: zwei
bestehende wurden neu kalibriert, zwei Ideen gemessen und verworfen, eine
nicht angefangen. Der Zuwachs dieser Version liegt bei der Messung, nicht bei
der Vorhersage — was die Verschiebung oben noch einmal von der anderen Seite
beschreibt.

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
plugin from manifest…** und die `manifest.json` im entpackten Ordner wählen.
Die Kurzanleitung liegt als `LIESMICH.txt` daneben.

## Datengrundlage

Der Ortsprior der Vorhersage ist aus dem UEyes-Datensatz abgeleitet
(Jiang et al., CHI 2023), CC BY 4.0. Einzelheiten in `NOTICE.md`.

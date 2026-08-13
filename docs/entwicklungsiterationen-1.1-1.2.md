# Entwicklungsiterationen 1.1 und 1.2

**Diese Datei ist nicht der Release-Text.** Sie sammelt die Absätze, die den
Stand der Entwicklung gegen einen **Vorgänger** beschreiben — und ein Vorgänger,
den ein Leser kennt, gibt es nicht: das erste Release ist `1.0.0-beta.1`.

Die Zahlen 1.1 und 1.2 hier sind **Entwicklungsiterationen**, keine Releases.
Was das genau heißt und warum es zwei Zählungen mit denselben Ziffern gibt, steht
an einer Stelle: „Zwei Zählungen mit denselben Ziffern" in der [README](../README.md).

Nichts hiervon ist gelöscht, weil nichts davon falsch ist. Es setzt nur Wissen
voraus, das der Leser eines Release-Textes nicht hat.

---

## Die Verschiebung von Iteration 1.1 zu 1.2

**In einem Satz:** Figmaps war ein Vorhersagewerkzeug mit einem Kontrast-Zusatz
und ist ein **Messwerkzeug mit einem Vorhersage-Zusatz** geworden.

Das ist keine Umbenennung, sondern eine Beobachtung an der Ausgabe. Auf einem
typischen Onboarding-Screen (393 × 852) misst die Contrastmap **acht
Textelemente** und nennt für jedes einen nachrechenbaren Wert; die Vorhersage
steuert **einen** Befund bei. Auf einem Desktop-Frame sind es 21 gemessene
Werte, davon 14 unter der Anforderung, gegen im Schnitt 1,7 vorhergesagte
Befunde. Wer das Plugin öffnet, bekommt überwiegend Zahlen, die man nachrechnen
kann — auch dort, wo sie „bestanden" lauten.

## Was Iteration 1.2 an der Vorhersage verbessert hat

- Die Karten sind schärfer. Die Prüfung der Ausgangsvermutung („die Karten sind
  zu weich") ergab, dass der bisher dafür gehaltene Regler der falsche war —
  eine höhere Bildgewichtung macht die Karte *weicher*, nicht schärfer.
  Wirksam ist eine Tonkurve über der fertigen Karte.
- `competition` misst den Abstand zweier Blickfänge jetzt auf der Diagonale
  statt an der Breite. „Weit auseinander" hieß vorher auf einem Telefon etwas
  anderes als auf einem Desktop.
- `cold-fold` hat eine Schwelle je UI-Typ. Mit einer gemeinsamen Zahl sagte die
  Regel auf Telefon-Screens häufiger ja als nein.

## Was Iteration 1.2 am Regelwerk *nicht* geändert hat

Offen gesagt hat 1.2 dem Regelwerk **keine neue Regel** hinzugefügt: zwei
bestehende wurden neu kalibriert, zwei Ideen gemessen und verworfen, eine nicht
angefangen. Der Zuwachs dieser Iteration liegt bei der Messung, nicht bei der
Vorhersage — was die Verschiebung oben noch einmal von der anderen Seite
beschreibt.

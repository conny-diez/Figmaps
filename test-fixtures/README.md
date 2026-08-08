# Referenz-Screens

Ablage für die Referenz-Screens aus PRD §8 (M3/M4) und §11.4.

**Offen:** Die drei Referenz-Screens sind noch nicht festgelegt — das ist eine
Produktentscheidung, keine Implementierungsfrage. Empfohlen wird eine Mischung,
weil sie unterschiedliche Feature-Maps unter Druck setzt:

| Screen | Prüft vor allem |
|---|---|
| Marketing-Landingpage mit Hero-Bild | `imageSalience` vs. `textSalience` — konkurriert die Illustration mit der Headline? |
| Checkout-/Formular-Screen | `interactiveSalience`, Clickmap-Ranking des primären CTA |
| Dashboard mit dichter Datentabelle | `edgeDensity` — dichte Flächen dürfen nicht die ganze Map aufheizen |

Ablage als PNG (`2×`, längere Kante ≤ 4096 px) plus die dazugehörige `.fig`-Datei
oder ein Link auf den Frame, damit der Layer-Tree reproduzierbar bleibt.

## Warum hier keine automatisierten Tests laufen

Echte Screens haben keine bekannte Wahrheit — es gibt keinen Sollwert, gegen den
man eine Heatmap assertieren könnte. Die Unit-Tests der Engine arbeiten deshalb
ausschließlich mit synthetischen Eingaben (`src/engine/__tests__/`, PRD §12).
Die Referenz-Screens dienen der **manuellen** Plausibilitätsprüfung der
Milestone-Abnahmen.

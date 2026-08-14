# Figma Plugins — Design System

Ein System für Figma-Plugins. Dark Mode ist Default, Light Mode ist gleichwertig gemappt.
Leitregel: **Gelb ist ausschließlich die primäre Aktion.** Auswahl, Aktivität und Hierarchie werden über Helligkeit und Kontur gelöst, nie über Farbe.

---

## 1. Farb-Tokens

### Dark (Default)

| Token | Wert | Verwendung |
|---|---|---|
| `bg/base` | `#0A0A0C` | Plugin-Hintergrund |
| `bg/surface` | `#111114` | Inputs, Selects, Segment-Tracks |
| `bg/raised` | `#17171B` | Sekundäre Buttons, Icon-Tiles |
| `bg/selected` | `#22222A` | aktives Segment / aktiver Tab |
| `border` | `#1F1F25` | Standardkontur auf `bg/surface` |
| `border/strong` | `#26262C` | Kontur auf `bg/raised` |
| `border/soft` | `#17171C` | Trennlinien Header/Footer |
| `border/active` | `#33333C` | aktive Karte (Selection Card) |
| `text/hi` | `#EDEDEB` | Titel, aktive Labels |
| `text/mid` | `#83838C` | Fließtext, inaktive Labels |
| `text/low` | `#4E4E56` | Section-Labels, Meta, Chevrons |
| `text/disabled` | `#48484F` | deaktivierte Buttons |
| `cta` | `#FFD60A` | primärer Button, ein Akzentelement im Logo |
| `cta/on` | `#141418` | Text auf `cta` |
| `success` | `#4FBF8B` | Kategorie-Dot |
| `danger` | `#F27272` | destruktive Aktion (nur Outline) |

### Light

| Token | Wert |
|---|---|
| `bg/base` | `#FBFBF9` |
| `bg/surface` | `#F7F7F4` |
| `bg/raised` | `#FFFFFF` |
| `bg/selected` | `#FFFFFF` + 1 px `border` (Weiß statt Grau, damit der Sprung sichtbar bleibt) |
| `bg/track` | `#F2F2EF` (Segment-/Tab-Track) |
| `border` | `#E7E7E1` |
| `border/strong` | `#E0E0DA` |
| `border/soft` | `#EDEDE8` |
| `border/active` | `#C9C9C1` |
| `text/hi` | `#17171A` |
| `text/mid` | `#6B6B73` |
| `text/low` | `#9A9AA0` |
| `text/disabled` | `#B4B4AC` |
| `cta` | `#FFD60A` (unverändert), Text `#141418` |
| `success` | `#2F9E6E` |
| `danger` | `#D64545` |

Panel im Light Mode: `background: #FFFFFF`, `border: 1px solid #E2E2DC`, `box-shadow: 0 1px 2px rgba(20,20,24,0.05)`.

### Daten-Rampe (Heatmaps, Logo)

Abgeleitet aus `cta`, damit ein Theme-Wechsel des Akzents die Visualisierung mitzieht:

```css
--tone-600: color-mix(in oklab, var(--cta) 72%, #0A0A0C);
--tone-700: color-mix(in oklab, var(--cta) 44%, #0A0A0C);
--tone-800: color-mix(in oklab, var(--cta) 22%, #0A0A0C);
/* kalte Seite: dark #26262C · light rgba(26,26,30,0.22) */
```

Volles Gelb erscheint in Visualisierungen nur im heißesten Punkt.

---

## 2. Typografie

- UI: **Plus Jakarta Sans** (400 / 500 / 600 / 700)
- Zahlen, Tokens, Einheiten, Section-Labels: **JetBrains Mono** (400 / 500 / 700)

| Rolle | Font | Größe / Weight | Farbe |
|---|---|---|---|
| Plugin-Titel (Header) | Jakarta | 13 px / 700 | `text/hi` |
| Card-Titel, aktive Controls | Jakarta | 12 px / 600 | `text/hi` |
| Control-Label, inaktives Segment | Jakarta | 12 px / 500 | `text/mid` |
| Fließtext / Hilfetext | Jakarta | 11 px / 400, `line-height: 1.5` | `text/mid` |
| Fußnote | Jakarta | 10 px / 400, `line-height: 1.5` | `text/low`–`text/mid` |
| Section-Label | Mono | 9 px / 500, `letter-spacing: .18em`, uppercase | `text/low` |
| Werte, Einheiten, Tokens | Mono | 10–11 px / 400–700 | `text/mid`–`text/hi`, **nie** `cta` |

Section-Labels sind nie farbig und nie fett. Werte werden durch den Mono-Schnitt lesbar, nicht durch Farbe.

---

## 3. Geometrie & Abstände

- Panelbreite: **320 px**
- Radien: `4` Chip · `8` Control · `12` Card · `14` Panel. Ein Element hat genau einen Radius.
- Padding: Panelinhalt `14`, Card `10–12`, Header/Footer `12 14`
- Abstände: Sektionsgruppen `16`, Label→Control `7`, Buttonreihe `6–8`
- Layout immer `display:flex` / `grid` mit `gap`, keine Margins zur Abstandsbildung
- Trennlinien: `1px solid border/soft` unter Header und über Footer

---

## 4. Komponenten

**Header** — 12/14 Padding, `gap: 9`. Reihenfolge: Icon-Tile (24 px, Radius 7, `bg/raised` + `border/strong`) → Plugin-Name → Version (Mono 9 px, `.14em`, `text/low`) → Theme-Switcher → Close.

**Theme-Switcher** — Pill (`bg/surface` + `border`, Radius 999, Padding 2, `gap: 2`), zwei 17-px-Kreise. Aktive Seite: `bg/selected` (dark) bzw. `#FFFFFF` (light), Glyph in `text/hi`; inaktiv `text/low`. Mond = Dark, Punkt = Light. Default: Dark, Wert persistieren.

**Segmented Control** — Track `bg/surface` + `border`, Radius 8, Padding 3, `gap: 3`. Segmente `flex: 1`, Padding `6 3`, Radius 6. Aktiv: `bg/selected` + `text/hi` + 600 (light: `#FFFFFF` + `border`). Inaktiv: transparent + `text/mid` + 500. Sekundärwerte im Segment in Mono, `text/mid`.

**Tabs** — wie Segmente, aber ohne Track: aktiver Tab `bg/selected` + `border/strong`, Radius 8, Padding `7 13`.

**Select** — `bg/surface` + `border`, Radius 8, Padding `10 12`. Optionaler Status-Dot 6 px links (`success` etc.). Chevron `▼` 9 px in `text/low`.

**Textarea / Input** — `bg/surface` + `border`, Radius 8, Padding `10 12`, `min-height: 54`, Text 12 px `text/hi`.

**Selection Card** — Radius 12, Padding 10, `gap: 10`. Aktiv: `border/active` + `bg/raised`-Ton; inaktiv: `border` + gedämpfter Hintergrund und `text/mid`-Titel. Links 38-px-Preview (Radius 6), rechts Toggle.

**Toggle** — 32×18, Radius 9, Knopf 14 px. An: Track `#3A3A44` (light: `#17171A`), Knopf `text/hi`/Weiß. Aus: `bg/raised` + `border/strong`, Knopf `text/low`. **Kein Gelb.**

**Stepped Slider** — 20 Balken, `gap: 2`, Radius 2. Gefüllt: Höhe `6px + index*0.6px`, Farbe `#5A5A64` (light `#8A8A90`); leer: 5 px, `border`. Wert rechts im Label als Mono.

**Buttons** — Radius 8, Padding `9 16`, 12 px.
- Primär (CTA): `cta` + `cta/on`, 700 — **genau einer pro Panel**
- Sekundär: `bg/raised` + `border/strong` + `text/hi`, 600
- Destruktiv: transparent + `1px solid danger @ 28%` + `danger`, 600
- Add / leerer Slot: `1px dashed border/strong` + `text/low`, 500

**Property-Zeile** — Container `bg/surface` + `border`, Radius 12, Padding 10, Zeilen `gap: 10`. Links Property-Name (12/500), rechts Wert; Farbwerte mit 5×15-Swatch + Token-Chip (Pill, `bg/raised` + `border/strong`, Mono 10 px, `text/mid`). Aktionen (`↑ ↓ −`) in `text/low`.

**Footer** — zwei Zonen: Aktionszeile (CTA + Sekundär + rechts Statuszähler in Mono `text/low`) und darunter optional die Hinweiszeile: 14-px-`i`-Kreis (`border/strong`) + 10-px-Text in `text/low`. Hinweise stehen immer am Panelende und sind nie farbig.

---

## 5. Logos

Beide Marken: 64er Raster, ein Akzentelement, Stroke 4 (bei ≤24 px Stroke 6). Dateien in `logos/`:
`figmaps-mark-dark|light|mono.svg`, `figmaps-icon-16.svg`, `figtations-mark-dark|light|mono.svg`, `figtations-icon-16.svg` (`mono` nutzt `currentColor`).

**Figmaps — Heat-Raster.** 4×4-Punktgitter, Schrittweite 13.5, Start (12,12). Radius `max(1.6, 5.4 − d·1.35)` mit `d = hypot(row−0.6, col−1.2)`; Farbe nach `d`: `<0.9` = `cta`, `<1.9` = `tone-600`, `<2.8` = `tone-700`, sonst kalt. Punktgröße ist Intensität, der Fokus sitzt oben links.

**Figtations — Klammer.** Klammer aus drei Linien (`x=12`, `y 14→50`, Arme bis `x=20`, `linecap: round`) plus zwei Bänder rechts: `30,22 24×6 r3` in `cta` und `30,36 15×6 r3` in `tone-700`.

**Kleingrößen (≤24 px):** vereinfachte Varianten.
Figmaps: vier Kreise in `viewBox="2 2 52 52"` — `(18,18) r12` `cta`, `(42,22) r7` `tone-600`, `(20,42) r6` `tone-700`, `(44,46) r3.5` kalt.
Figtations: dieselbe Klammer mit Stroke 6, Bänder `31,21 23×7` und `31,36 14×7`, `viewBox="7 9 49 46"`.

---

## 6. Regeln

1. Gelb erscheint nur auf der primären Aktion — ein gelber Button pro Panel, sonst nirgends.
2. Auswahl ist Helligkeit, nicht Farbe: `bg/selected` + `text/hi`. Aktive Container erhalten eine hellere Kontur.
3. Section-Labels: Mono, 9 px, `.18em`, `text/low`. Nie farbig, nie fett.
4. Werte, Tokens und Einheiten in Mono und neutral.
5. Statusfarben nur punktuell: 6-px-Dot für Kategorien, Outline für Destruktives.
6. Datenvisualisierung nutzt die gedämpfte Rampe; volles Gelb bleibt dem CTA vorbehalten.
7. Aktive Toggles sind Tinte, nicht Gelb.
8. Hilfetext steht unter seinem Control, Verfahrenshinweise in der abgesetzten Footer-Zeile.

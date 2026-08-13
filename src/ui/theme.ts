/**
 * Die beiden Paletten des Panels — die Farb-Tokens aus `DESIGN.md` §1 — und die
 * Kontrastzusage, die sie einhalten müssen.
 *
 * **Warum nicht `figma.showUI({ themeColors: true })`.** Das Panel bringt seine
 * eigene Haut und seinen eigenen Schalter mit. Figmas Theme-Variablen würden die
 * Farben des Plugins an das binden, was der Host als Nächstes tut — und das
 * Einzige, was nicht vom Host abhängen darf, ist die Lesbarkeit des Disclaimers
 * unter den Maps. Dark ist der Startwert und bleibt es, auch wenn Figma hell
 * läuft; die Wahl gehört dem Nutzer und wird gemerkt (`Settings.theme`).
 *
 * Kein DOM-Zugriff hier: `messages.ts` importiert dieses Modul für
 * `Settings.theme`, und `messages.ts` lädt auch der Hauptthread, in dem es kein
 * `document` gibt. Aufgetragen wird die Palette in `ui.tsx`.
 *
 * **Warum die Palette in TypeScript steht.** Jeder Wert hier ist die Hälfte
 * eines Kontrastpaares, und `__tests__/theme.test.ts` prüft jedes Paar, das
 * tatsächlich vorkommt, gegen 4,5:1. Eine Palette in einer CSS-Datei lässt sich
 * so nicht prüfen; eine ungeprüfte driftet zurück. Genau das ist zweimal
 * passiert — die Fußzeile war mit 3,93:1 und 2,41:1 ausgeliefert, wurde behoben,
 * und die nächste Design-Übergabe brachte dieselben Werte wieder mit.
 *
 * ---
 *
 * **Die Abweichung von `DESIGN.md`, und warum sie nötig ist.**
 *
 * Sie betrifft genau einen Token, `text/low`, und sie hat zwei Hälften.
 *
 * 1. **Es ist keine Schriftfarbe.** `DESIGN.md` weist `text/low` Section-Labels,
 *    Meta-Werte, Chevrons und die Hinweiszeile der Fußzeile zu. Der angegebene
 *    Wert `#4E4E56` liegt auf `bg/base` bei **2,40:1** — auf zwei Stellen
 *    derselbe Wert, den dieses Repo schon zweimal entfernt hat (siehe oben).
 *    Alles, was gelesen werden muss, nimmt deshalb `text-mid` (5,27:1 dark /
 *    5,28:1 light); `text-low` bleibt für das, was **Form ist statt Schrift**:
 *    Chevron, Statuspunkte, Kontur des `i`-Kreises, Greifer in der Ecke,
 *    ausgeschalteter Toggle-Knopf.
 *
 *    Die Hierarchie geht dabei nicht verloren, und zwar mit dem Argument aus
 *    `DESIGN.md` selbst: Section-Labels und Werte unterscheiden sich durch den
 *    **Mono-Schnitt, Versalien und 0,18 em Laufweite** von der Fließschrift,
 *    nicht durch ihre Farbe („Werte werden durch den Mono-Schnitt lesbar, nicht
 *    durch Farbe", §2). Eine dritte lesbare Textstufe wurde absichtlich **nicht**
 *    eingeführt: drei Abstufungen über der Grenze rücken so eng zusammen, dass
 *    die dritte nur eine Gelegenheit ist, die falsche zu wählen.
 *
 * 2. **Auch als Form ist der Wert zu leise.** WCAG 1.4.11 verlangt für
 *    Bedienelemente und bedeutungstragende Grafik 3:1. `#4E4E56` erreicht auf
 *    `bg/raised` — dort sitzt der ausgeschaltete Toggle-Knopf — 2,17:1. Der
 *    Token ist deshalb auf `#64646D` (dark) bzw. `#8B8B92` (light) gehoben, den
 *    nächstliegenden Wert, der jede seiner Flächen über 3:1 hält.
 *    `NON_TEXT_PAIRS` unten misst das nach.
 *
 * `text-disabled` bleibt wie angegeben — WCAG 1.4.3 nimmt inaktive
 * Bedienelemente ausdrücklich aus, und ein deaktivierter Knopf, der wie ein
 * aktiver liest, ist der teurere Fehler.
 */

export type ThemeName = 'dark' | 'light'

/**
 * Token-Namen sind die CSS-Custom-Properties ohne `--`; sie werden zur Laufzeit
 * auf das Wurzelelement geschrieben (`ui.tsx`). Die Namen folgen `DESIGN.md` §1,
 * `/` wird zu `-`: `bg/surface` → `bg-surface`.
 */
export type Palette = {
  /** Flächen. */
  'bg-base': string
  'bg-surface': string
  'bg-raised': string
  'bg-selected': string
  /** Track von Segmented Control und Tabs — im Light-Theme eigener Wert. */
  'bg-track': string
  /**
   * Das Panel selbst. Im Light-Theme ist es Papier auf `bg/base`: Weiß, 1 px
   * Kontur, ein Hauch Schatten (`DESIGN.md` §1). Im Dark-Theme fällt es mit
   * `bg/base` zusammen, und Kontur und Schatten verschwinden.
   */
  'panel-bg': string
  'panel-border': string
  'panel-shadow': string
  /** Linien. */
  border: string
  'border-strong': string
  'border-soft': string
  'border-active': string
  /** Schrift, von laut nach leise. */
  'text-hi': string
  'text-mid': string
  /** **Keine Schriftfarbe** — siehe Modulkommentar. Chevrons, Punkte, Konturen. */
  'text-low': string
  'text-disabled': string
  /** Die primäre Aktion. Fläche, nie Schrift — die einzige Stelle mit Gelb. */
  cta: string
  /** Schrift auf `cta`. */
  'cta-on': string
  /** Kategoriepunkt, 6 px. Nie Schrift, nie Fläche. */
  success: string
  /** Destruktive Kontur — als Fläche nie verwendet. */
  danger: string
  /** Dieselbe Kontur mit den 28 % Deckkraft aus `DESIGN.md` §4. */
  'danger-outline': string
  /**
   * Destruktive **Schrift**. Im Dark-Theme identisch mit `danger`; im
   * Light-Theme ist `#D64545` als Text 4,38:1 und damit unter der Grenze, also
   * hat die Schrift dort einen eigenen, dunkleren Wert. Dieselbe Trennung, die
   * das Gelb erzwingt: eine Kontur darf heller sein als eine Beschriftung.
   */
  'danger-text': string
  /**
   * Daten-Rampe (`DESIGN.md` §1) — die gedämpften Stufen der Visualisierung.
   * Volles Gelb erscheint darin nur im heißesten Punkt; die Werte sind die
   * oklab-Mischungen aus `cta`, gerundet wie in `logos/figmaps-mark-*.svg`.
   */
  'tone-600': string
  'tone-700': string
  'tone-800': string
  /** Kalte Seite der Rampe. */
  'tone-cold': string
  /** Gefüllte Balken des Steppers. Neutral — Regel 6: kein Gelb in Daten. */
  'bar-fill': string
  /** Eingeschalteter Toggle: Tinte, nicht Gelb (Regel 7). */
  'toggle-on': string
  'toggle-knob-on': string
  /** Schatten des Dropdown-Menüs. */
  'menu-shadow': string
  /**
   * Fokusring. `DESIGN.md` sagt dazu nichts — ein Panel, das nur mit der Maus
   * bedienbar ist, wäre aber eine Regression: die Regler sind `role="slider"`,
   * und dort ist der sichtbare Fokus Pflicht. Neutral, damit er nicht als
   * zweites Gelb im Panel liest.
   */
  'focus-ring': string
  /**
   * Falz-Schraffur der Vorschau, zwei Töne, damit sie als Textur liest und nicht
   * als Balken.
   */
  'fold-hatch': string
  'fold-hatch-2': string
}

const DARK: Palette = {
  'bg-base': '#0A0A0C',
  'bg-surface': '#111114',
  'bg-raised': '#17171B',
  'bg-selected': '#22222A',
  'bg-track': '#111114',

  'panel-bg': '#0A0A0C',
  // Im Dark-Theme trägt das Panel keine Kontur und keinen Schatten: es liegt
  // nicht auf einer Fläche, es *ist* die Fläche.
  'panel-border': '#0A0A0C',
  'panel-shadow': 'none',

  border: '#1F1F25',
  'border-strong': '#26262C',
  'border-soft': '#17171C',
  'border-active': '#33333C',

  'text-hi': '#EDEDEB',
  'text-mid': '#83838C',
  // `DESIGN.md`: #4E4E56. Gehoben, damit jede Form-Fläche 3:1 hält — siehe
  // Modulkommentar.
  'text-low': '#64646D',
  'text-disabled': '#48484F',

  cta: '#FFD60A',
  'cta-on': '#141418',

  success: '#4FBF8B',
  danger: '#F27272',
  'danger-outline': 'rgba(242, 114, 114, 0.28)',
  'danger-text': '#F27272',

  'tone-600': '#B79A2A',
  'tone-700': '#6E6234',
  'tone-800': '#36301A',
  'tone-cold': '#26262C',

  // `DESIGN.md`: #5A5A64 — 2,90:1 gegen das Panel, knapp unter 1.4.11.
  'bar-fill': '#5F5F69',
  'toggle-on': '#3A3A44',
  'toggle-knob-on': '#EDEDEB',

  'menu-shadow': '0 12px 28px -10px rgba(0, 0, 0, 0.8)',
  'focus-ring': '#83838C',
  'fold-hatch': 'rgba(0, 0, 0, 0.55)',
  'fold-hatch-2': 'rgba(0, 0, 0, 0.22)',
}

const LIGHT: Palette = {
  'bg-base': '#FBFBF9',
  'bg-surface': '#F7F7F4',
  'bg-raised': '#FFFFFF',
  // Weiß statt Grau, damit der Sprung zur Auswahl sichtbar bleibt — die Kontur
  // macht den Unterschied, nicht die Fläche (`DESIGN.md` §1).
  'bg-selected': '#FFFFFF',
  'bg-track': '#F2F2EF',

  'panel-bg': '#FFFFFF',
  'panel-border': '#E2E2DC',
  'panel-shadow': '0 1px 2px rgba(20, 20, 24, 0.05)',

  border: '#E7E7E1',
  'border-strong': '#E0E0DA',
  'border-soft': '#EDEDE8',
  'border-active': '#C9C9C1',

  'text-hi': '#17171A',
  'text-mid': '#6B6B73',
  // `DESIGN.md`: #9A9AA0 — 2,61:1 auf `bg/surface`, für eine Form zu leise.
  'text-low': '#8B8B92',
  'text-disabled': '#B4B4AC',

  cta: '#FFD60A',
  'cta-on': '#141418',

  success: '#2F9E6E',
  danger: '#D64545',
  'danger-outline': 'rgba(214, 69, 69, 0.28)',
  // #D64545 als Text sind 4,38:1 — die Kontur behält den Wert, die Schrift wird
  // dunkler.
  'danger-text': '#C4302F',

  // Auf hellem Grund läuft die Rampe nicht ins Papier, sondern in die Tinte;
  // die Werte sind die des hellen Marks (`logos/figmaps-mark-light.svg`).
  'tone-600': '#9C8730',
  'tone-700': '#6E6234',
  'tone-800': '#453E2A',
  'tone-cold': 'rgba(26, 26, 30, 0.22)',

  'bar-fill': '#8A8A90',
  'toggle-on': '#17171A',
  'toggle-knob-on': '#FFFFFF',

  'menu-shadow': '0 12px 28px -14px rgba(20, 20, 24, 0.28)',
  'focus-ring': '#6B6B73',
  'fold-hatch': 'rgba(26, 26, 30, 0.28)',
  'fold-hatch-2': 'rgba(26, 26, 30, 0.10)',
}

export const THEMES: Record<ThemeName, Palette> = { dark: DARK, light: LIGHT }

export const DEFAULT_THEME: ThemeName = 'dark'

/**
 * Jedes Vordergrund/Hintergrund-Paar, das im Panel tatsächlich vorkommt.
 *
 * Von Hand gepflegt, mit Absicht: die überprüfbare Behauptung ist „diese
 * Schrift sitzt auf jener Fläche", und das weiß nur das Stylesheet. Ein Paar,
 * das in der CSS-Datei entsteht, ohne hier zu stehen, wird nicht geprüft — die
 * Liste ist damit Teil des Reviews einer Farbänderung, und `where` sagt, welche
 * Regel gemeint ist.
 */
export const CONTRAST_PAIRS: ReadonlyArray<{ fg: keyof Palette; bg: keyof Palette; where: string }> = [
  { fg: 'text-hi', bg: 'panel-bg', where: 'Plugin-Titel, Card-Titel, Reglername' },
  { fg: 'text-hi', bg: 'bg-surface', where: 'Textarea, Select-Wert, Property-Zeile' },
  { fg: 'text-hi', bg: 'bg-raised', where: 'sekundärer Knopf, Icon-Tile, aktive Karte' },
  // `text-mid` steht hier **nicht**: auf `bg/selected` sind es im Dark-Theme
  // 4,20:1. Auf der gewählten Fläche hebt die leise Stufe deshalb mit (aktives
  // Segment), und der Balken hinter einer Ranking-Zeile nimmt die leisere
  // Fläche `bg/raised` — siehe `styles.css`.
  { fg: 'text-hi', bg: 'bg-selected', where: 'aktives Segment, aktiver Tab, Theme-Schalter' },
  { fg: 'text-hi', bg: 'bg-track', where: 'aktives Segment im Light-Theme (Track darunter)' },
  { fg: 'text-mid', bg: 'panel-bg', where: 'Fließtext, Section-Label, Hinweiszeile' },
  { fg: 'text-mid', bg: 'bg-surface', where: 'Kartenbeschreibung, Werte, Meta' },
  { fg: 'text-mid', bg: 'bg-raised', where: 'inaktive Karte, Dropdown-Eintrag' },
  { fg: 'text-mid', bg: 'bg-track', where: 'inaktives Segment' },
  { fg: 'cta-on', bg: 'cta', where: 'Beschriftung der primären Aktion' },
  { fg: 'danger-text', bg: 'panel-bg', where: 'destruktive Aktion, Fehlermeldung' },
  { fg: 'danger-text', bg: 'bg-surface', where: 'Fehlermeldung auf einer Fläche' },
]

/**
 * Paare, die keine Schrift tragen, sondern Form: Punkte, Konturen, Balken. WCAG
 * 1.4.11 verlangt dafür 3:1, nicht 4,5:1 — und `text-low` steht hier, weil es
 * genau diese Rolle hat (siehe Modulkommentar).
 */
export const NON_TEXT_PAIRS: ReadonlyArray<{ fg: keyof Palette; bg: keyof Palette; where: string }> = [
  { fg: 'text-low', bg: 'panel-bg', where: 'Greifer, Kontur des i-Kreises' },
  { fg: 'text-low', bg: 'bg-surface', where: 'Chevron im Select' },
  { fg: 'text-low', bg: 'bg-raised', where: 'Knopf des ausgeschalteten Toggles' },
  { fg: 'success', bg: 'bg-surface', where: 'Kategoriepunkt im Select' },
  { fg: 'danger', bg: 'panel-bg', where: 'Kontur der destruktiven Aktion' },
  { fg: 'bar-fill', bg: 'panel-bg', where: 'gefüllte Balken des Steppers' },
  // Der eingeschaltete Toggle ist absichtlich **nicht** mit Track gegen Karte
  // gemessen: den Zustand zeigt die Lage des Knopfes, und der Knopf ist das,
  // was gegen den Track lesbar sein muss. Ein Track, der selbst 3:1 gegen die
  // Karte hätte, wäre bei „aus" eine Fläche, die wie „an" aussieht.
  { fg: 'toggle-knob-on', bg: 'toggle-on', where: 'Knopf des eingeschalteten Toggles' },
]

/** WCAG 2.1 relative Luminanz einer `#rrggbb`-Farbe. */
export function relativeLuminance(hex: string): number {
  const value = parseInt(hex.slice(1), 16)
  const channel = (raw: number): number => {
    const c = raw / 255
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
  }
  return (
    0.2126 * channel((value >> 16) & 255) +
    0.7152 * channel((value >> 8) & 255) +
    0.0722 * channel(value & 255)
  )
}

/** WCAG 2.1 Kontrastverhältnis, `1`…`21`. */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a)
  const lb = relativeLuminance(b)
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}

/** WCAG AA für normale Schrift. Kleine Grade sind in einem 320-px-Panel die Norm. */
export const MIN_CONTRAST = 4.5

/** WCAG 1.4.11 — Bedienelemente und Bedeutungsträger, die keine Schrift sind. */
export const MIN_CONTRAST_NON_TEXT = 3

/** Die Palette, mit der gemalt wird — fällt bei unbekanntem Namen auf Dark. */
export function paletteFor(name: ThemeName): Palette {
  return THEMES[name] ?? THEMES[DEFAULT_THEME]
}

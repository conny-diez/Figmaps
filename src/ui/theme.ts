/**
 * The panel's two palettes, and the contrast contract they have to satisfy.
 *
 * **Why not `figma.showUI({ themeColors: true })`.** The panel ships its own
 * skin and its own switch. Figma's theme variables would tie the plugin's
 * colours to whatever the host does next, and the one thing that must not
 * depend on the host is whether the disclaimer under the maps is readable.
 * Dark is the default at first start and stays the default when Figma runs in
 * light mode; the choice is the user's and is persisted (`Settings.theme`).
 *
 * No DOM access here: `messages.ts` imports this for `Settings.theme`, and that
 * module is loaded by the main thread too, where there is no `document`. The
 * palette is applied in `ui.tsx`.
 *
 * **Why the palette lives in TypeScript.** Every colour here is one half of a
 * contrast pair, and `__tests__/theme.test.ts` checks every pair that actually
 * occurs against the 4.5:1 floor for normal text. A palette in a CSS file
 * cannot be checked that way; one that is not checked drifts back. The design
 * hand-off it came from carried exactly the values we had removed the day
 * before — `dim` 3,93:1, `dim3` 2,41:1 — which is how this file came to exist.
 *
 * **Two muted levels, not three.** The hand-off had `dim`/`dim2`/`dim3`, and
 * all three were under the floor in both themes. Lifting them all over 4.5:1
 * compresses them into each other, so the third step buys nothing but a way to
 * pick the wrong one: `dim` for secondary text, `quiet` for the quietest text
 * that is still text.
 */

export type ThemeName = 'dark' | 'light'

/**
 * Token names are the CSS custom properties without the `--` prefix; they are
 * written onto the root element at runtime (`applyTheme`).
 */
export type Palette = {
  /** Surfaces. */
  bg: string
  'bg-page': string
  'bg-footer': string
  surface: string
  'surface-menu': string
  'surface-row': string
  'surface-hover': string
  /** Lines. */
  shell: string
  divider: string
  border: string
  'border-strong': string
  'border-open': string
  'border-icon': string
  /** Text, from loudest to quietest. */
  text: string
  'text-body': string
  'text-dim': string
  'text-quiet': string
  /** Accent. `accent` is a *surface* colour; `accent-text` is the text one. */
  accent: string
  'accent-text': string
  /** Text on top of `accent`. */
  ink: string
  danger: string
  /** Slider bars that are not filled yet. */
  track: string
  'rank-fill': string
  /** Map schema (the abstract wireframe next to each map row). */
  'schema-bg': string
  wire1: string
  wire2: string
  wire3: string
  'cut-line': string
  /** Fold hatching — two tones, so it reads as a texture and not as bars. */
  'fold-hatch': string
  'fold-hatch-2': string
}

const DARK: Palette = {
  bg: '#0d0d10',
  'bg-page': '#08080a',
  'bg-footer': '#0a0a0d',
  surface: '#141419',
  'surface-menu': '#17171d',
  'surface-row': '#121217',
  'surface-hover': '#212129',

  shell: '#1f1f25',
  divider: '#1b1b21',
  border: '#22222a',
  'border-strong': '#2b2b34',
  'border-open': '#3d3d49',
  'border-icon': '#2e2e38',

  text: '#ECECEF',
  'text-body': '#B4B4C0',
  'text-dim': '#A8A8B4',
  'text-quiet': '#8A8A96',

  accent: '#F5C518',
  // On a near-black surface the yellow itself is a legitimate text colour
  // (11,7:1). On the light theme it is not — see below.
  'accent-text': '#F5C518',
  ink: '#0d0d10',
  danger: '#FF7A6E',

  track: '#2b2b34',
  'rank-fill': 'rgba(245, 197, 24, 0.12)',

  'schema-bg': '#1b1b21',
  wire1: '#33333d',
  wire2: '#2b2b34',
  wire3: '#26262f',
  'cut-line': 'rgba(245, 197, 24, 0.55)',
  'fold-hatch': 'rgba(0, 0, 0, 0.55)',
  'fold-hatch-2': 'rgba(0, 0, 0, 0.22)',
}

const LIGHT: Palette = {
  bg: '#FFFFFF',
  'bg-page': '#E9E9EE',
  'bg-footer': '#FAFAFB',
  surface: '#F5F5F8',
  'surface-menu': '#FFFFFF',
  'surface-row': '#F2F2F6',
  'surface-hover': '#EFEFF3',

  shell: '#E2E2E7',
  divider: '#E9E9EE',
  border: '#E4E4EA',
  'border-strong': '#D8D8E0',
  'border-open': '#B9B9C4',
  'border-icon': '#D4D4DC',

  text: '#1B1B1F',
  'text-body': '#3A3A45',
  'text-dim': '#55555F',
  'text-quiet': '#63636D',

  accent: '#F5C518',
  // #F5C518 as text on white is 1,63:1. The yellow stays a *surface* colour in
  // the light theme; text that has to read as accent uses this instead.
  'accent-text': '#7A6100',
  ink: '#1B140A',
  danger: '#B3261E',

  track: '#DCDCE4',
  'rank-fill': 'rgba(245, 197, 24, 0.28)',

  'schema-bg': '#F0F0F4',
  wire1: '#C6C6D2',
  wire2: '#DDDDE4',
  wire3: '#E6E6EC',
  'cut-line': 'rgba(150, 116, 0, 0.7)',
  'fold-hatch': 'rgba(0, 0, 0, 0.28)',
  'fold-hatch-2': 'rgba(0, 0, 0, 0.10)',
}

export const THEMES: Record<ThemeName, Palette> = { dark: DARK, light: LIGHT }

export const DEFAULT_THEME: ThemeName = 'dark'

/**
 * Every foreground/background pair that actually occurs in the panel.
 *
 * Hand-maintained on purpose: the checkable claim is „this text sits on that
 * surface", and only the stylesheet knows it. A pair that is added to the CSS
 * without being added here is not checked — so the list is part of reviewing a
 * colour change, and `where` says which rule to look at.
 */
export const CONTRAST_PAIRS: ReadonlyArray<{ fg: keyof Palette; bg: keyof Palette; where: string }> = [
  { fg: 'text', bg: 'bg', where: 'Titel, Auswahlname' },
  { fg: 'text', bg: 'surface', where: 'Auswahlkarte, aktive Map-Zeile' },
  { fg: 'text', bg: 'surface-menu', where: 'Dropdown-Eintrag' },
  { fg: 'text', bg: 'surface-hover', where: 'Dropdown-Eintrag unter dem Zeiger' },
  { fg: 'text-body', bg: 'bg', where: 'Befundtext' },
  { fg: 'text-body', bg: 'surface', where: 'Befundtext auf Karte' },
  { fg: 'text-body', bg: 'surface-row', where: 'Ranking-Name' },
  { fg: 'text-dim', bg: 'bg', where: 'Abschnittslabels, Reglername' },
  { fg: 'text-dim', bg: 'surface', where: 'inaktive Map-Zeile' },
  { fg: 'text-dim', bg: 'bg-footer', where: 'Fußtext-Icon' },
  { fg: 'text-quiet', bg: 'bg', where: 'Hinweise unter den Reglern' },
  { fg: 'text-quiet', bg: 'surface', where: 'Maßangabe der Auswahl, Map-Beschreibung' },
  { fg: 'text-quiet', bg: 'bg-footer', where: 'die drei Fußtext-Absätze' },
  { fg: 'text-quiet', bg: 'surface-menu', where: 'Dropdown-Nebentext' },
  { fg: 'text-quiet', bg: 'surface-row', where: 'Ranking-Rang' },
  { fg: 'accent-text', bg: 'bg', where: 'Reglerwert' },
  { fg: 'accent-text', bg: 'surface', where: 'gewählter Dropdown-Eintrag' },
  { fg: 'ink', bg: 'accent', where: 'Beschriftung auf dem gelben Knopf und dem Segment-Thumb' },
  { fg: 'danger', bg: 'bg', where: 'Fehlermeldung' },
  { fg: 'danger', bg: 'surface', where: 'Fehlermeldung auf Karte' },
]

/** WCAG 2.1 relative luminance of an `#rrggbb` colour. */
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

/** WCAG 2.1 contrast ratio, `1`…`21`. */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a)
  const lb = relativeLuminance(b)
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}

/** WCAG AA for normal text. Small type is the norm in a 320 px panel. */
export const MIN_CONTRAST = 4.5

/** The palette to paint with — falls back to dark for an unknown name. */
export function paletteFor(name: ThemeName): Palette {
  return THEMES[name] ?? THEMES[DEFAULT_THEME]
}

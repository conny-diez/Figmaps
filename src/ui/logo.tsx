/**
 * Figmaps product mark — inline SVG so the panel needs no network access and no
 * separate asset in the bundle. Source of truth: `assets/logo.svg` (the dark
 * variant; `assets/logo-light.svg` is the same mark for light backgrounds).
 */

/** Unique per instance is unnecessary: the panel renders exactly one mark. */
const CLIP_ID = 'figmaps-logo-inner'

export function Logo({ size = 20 }: { size?: number }): preact.JSX.Element {
  return (
    <svg
      class="app__logo"
      width={size}
      height={size}
      viewBox="0 0 128 128"
      role="img"
      aria-label="Figmaps"
    >
      <defs>
        <clipPath id={CLIP_ID}>
          <rect x="28.5" y="26.5" width="71" height="57" rx="7" />
        </clipPath>
      </defs>
      <g transform="translate(0,7)">
        <g clip-path={`url(#${CLIP_ID})`}>
          <rect x="28.5" y="26.5" width="71" height="57" rx="7" fill="#FFF0A0" />
          <rect x="28.5" y="26.5" width="71" height="19" fill="#FFDD00" />
          <rect x="28.5" y="45.5" width="71" height="19" fill="#FFB300" />
          <rect x="28.5" y="64.5" width="71" height="19" fill="#FF8A00" />
        </g>
        {/* The frame outline is drawn with `currentColor`; `.app__logo` sets it
            to the panel's foreground, which is the #ECECEF of the dark asset. */}
        <rect
          x="16"
          y="14"
          width="96"
          height="82"
          rx="15"
          fill="none"
          stroke="currentColor"
          stroke-width="9"
        />
        <rect x="59.5" y="96" width="9" height="18" rx="4.5" fill="currentColor" />
      </g>
    </svg>
  )
}

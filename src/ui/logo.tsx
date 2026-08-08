/**
 * FigMaps product mark — inline SVG so the panel needs no network access and no
 * separate asset in the bundle. Source of truth: `assets/logo.svg`.
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
      aria-label="FigMaps"
    >
      <defs>
        <clipPath id={CLIP_ID}>
          <rect x="28.5" y="26.5" width="71" height="57" rx="7" />
        </clipPath>
      </defs>
      <g transform="translate(0,7)">
        <g clip-path={`url(#${CLIP_ID})`}>
          <rect x="28.5" y="26.5" width="71" height="57" rx="7" fill="#FFF0A0" />
          <ellipse cx="54" cy="45" rx="26" ry="23" fill="#FFDD00" />
          <ellipse cx="54" cy="45" rx="15" ry="13" fill="#FFB300" />
          <ellipse cx="54" cy="45" rx="7" ry="6" fill="#FF8A00" />
          <ellipse cx="85" cy="70" rx="14" ry="11" fill="#FFDD00" />
          <ellipse cx="85" cy="70" rx="7" ry="5" fill="#FFB300" />
        </g>
        {/* The frame outline follows the panel theme instead of the fixed #333
            of the asset, so the mark stays legible in dark mode. */}
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

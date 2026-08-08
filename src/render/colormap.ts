/**
 * Turbo colormap (Google, 2019) — perceptually more uniform than Jet and it
 * keeps its ordering in greyscale print.
 *
 * Stops are stored explicitly as `[t, r, g, b]` so they can be swapped without
 * touching the interpolation code.
 */
export const TURBO_STOPS: ReadonlyArray<readonly [number, number, number, number]> = [
  [0.0, 48, 18, 59],
  [0.07, 65, 69, 171],
  [0.14, 70, 117, 237],
  [0.21, 57, 162, 252],
  [0.29, 27, 207, 212],
  [0.36, 36, 236, 166],
  [0.43, 97, 252, 108],
  [0.5, 164, 252, 60],
  [0.57, 209, 232, 52],
  [0.64, 243, 198, 58],
  [0.71, 254, 155, 45],
  [0.79, 243, 99, 21],
  [0.86, 203, 42, 4],
  [0.93, 155, 23, 3],
  [1.0, 122, 4, 3],
]

export type Rgb = readonly [number, number, number]

/** Linearly interpolated Turbo colour for `t` in `[0,1]`. */
export function turbo(t: number): Rgb {
  const v = t < 0 ? 0 : t > 1 ? 1 : t
  let hi = 1
  while (hi < TURBO_STOPS.length - 1 && TURBO_STOPS[hi][0] < v) hi++
  const a = TURBO_STOPS[hi - 1]
  const b = TURBO_STOPS[hi]
  const span = b[0] - a[0]
  const f = span <= 0 ? 0 : (v - a[0]) / span
  return [
    Math.round(a[1] + (b[1] - a[1]) * f),
    Math.round(a[2] + (b[2] - a[2]) * f),
    Math.round(a[3] + (b[3] - a[3]) * f),
  ]
}

/** `rgb(...)` string, for canvas fill/stroke styles. */
export function turboCss(t: number): string {
  const [r, g, b] = turbo(t)
  return `rgb(${r}, ${g}, ${b})`
}

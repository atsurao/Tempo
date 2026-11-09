/**
 * The clock and easing for the calendar views' settle glides.
 *
 * The snap does not hand its travel to the webview's smooth scroll: engines
 * scale that duration with distance and can cover a short correction in a
 * single frame, which reads as a jolt. A fixed, short tween keeps every
 * adjustment visibly gentle, whether it moves a few pixels or half a month.
 */

/** Glide length in ms: a floor so tiny corrections still glide, a ceiling so
 * settling never turns into travel. */
export function glideDuration(distance: number): number {
  return Math.round(Math.min(300, Math.max(160, 140 + Math.abs(distance) * 0.22)));
}

/**
 * Smoothstep: leaves and arrives at rest, monotone in between, no overshoot.
 * The gentle ends are what make the adjustment feel placed rather than snapped.
 */
export function glideEase(t: number): number {
  const x = Math.min(1, Math.max(0, t));
  return x * x * (3 - 2 * x);
}

/** Scroll offset `elapsed` ms into a glide from `from` to `to`. */
export function glideTop(from: number, to: number, elapsed: number, duration: number): number {
  if (duration <= 0) return to;
  return from + (to - from) * glideEase(elapsed / duration);
}

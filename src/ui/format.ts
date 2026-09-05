/**
 * A signed gap against the personal ghost, in seconds to two places.
 *
 * Explicitly signed in both directions: an unsigned "1.42" beside a ghost is
 * ambiguous at a glance and the glance is all a rider gets. A null gap prints a
 * dash rather than a zero, because "no comparison exists here" and "dead level"
 * are different facts and only one of them is worth chasing.
 */
export function formatGhostDelta(milliseconds: number | null): string {
  if (milliseconds === null || !Number.isFinite(milliseconds)) return "--.--";
  const seconds = milliseconds / 1_000;
  const sign = milliseconds < 0 ? "-" : "+";
  return `${sign}${Math.abs(seconds).toFixed(2)}`;
}

export function formatTime(milliseconds: number): string {
  if (!Number.isFinite(milliseconds)) return "--:--.--";
  const minutes = Math.floor(milliseconds / 60_000);
  const seconds = Math.floor((milliseconds % 60_000) / 1_000);
  const hundredths = Math.floor((milliseconds % 1_000) / 10);
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${String(hundredths).padStart(2, "0")}`;
}

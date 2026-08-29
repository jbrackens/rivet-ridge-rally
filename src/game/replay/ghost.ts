import type { BikePhase, LaneIndex, SurfaceKind } from "../simulation";
import type { ReplayFrame } from "./replayCodec";

/**
 * A ghost is the replay log folded back into a presentable rider.
 *
 * The recorder writes one sample every {@link REPLAY_SAMPLE_INTERVAL_STEPS}
 * fixed steps — 10 Hz at the 60 Hz simulation rate, and half that again for
 * every compaction a long custom race forces. Drawing those samples directly
 * would step the ghost six or more frames at a time, so everything continuous
 * is interpolated between the two samples that bracket the requested time and
 * everything discrete is held from the earlier one, which is the state that
 * actually obtained across the interval.
 *
 * This module is deliberately free of Three.js, React, and browser globals: it
 * is a pure fold over recorded state, so it is exercised by unit tests at the
 * same fidelity the renderer sees rather than only through a canvas.
 */

export interface GhostSample {
  readonly forwardPosition: number;
  readonly lanePosition: number;
  readonly lane: LaneIndex;
  readonly speed: number;
  readonly heat: number;
  readonly pitch: number;
  readonly height: number;
  readonly phase: BikePhase;
  readonly surface: SurfaceKind;
  readonly wheelie: boolean;
  readonly overheated: boolean;
  /** True once the requested time has reached the recorded terminal sample. */
  readonly finished: boolean;
}

function lerp(from: number, to: number, ratio: number): number {
  return from + (to - from) * ratio;
}

/**
 * The index of the last frame at or before `timeSeconds`.
 *
 * Binary rather than linear because this runs once per rendered frame against a
 * log that reaches tens of thousands of samples on a nine-lap custom course.
 */
function frameIndexAt(frames: readonly ReplayFrame[], timeSeconds: number): number {
  let low = 0;
  let high = frames.length - 1;
  while (low < high) {
    const middle = (low + high + 1) >> 1;
    const frame = frames[middle];
    if (frame !== undefined && frame.timeSeconds <= timeSeconds) low = middle;
    else high = middle - 1;
  }
  return low;
}

/**
 * Where the ghost was at `timeSeconds`, or null when the log is unusable.
 *
 * Times before the first sample clamp to the grid and times at or past the
 * terminal sample clamp to the finish — a ghost that has already crossed stays
 * parked on the line rather than disappearing, because vanishing reads as a
 * rendering fault while a stationary rider reads as "you are behind".
 */
export function sampleGhostAt(
  frames: readonly ReplayFrame[],
  timeSeconds: number,
): GhostSample | null {
  if (frames.length === 0) return null;
  if (!Number.isFinite(timeSeconds)) return null;

  const first = frames[0];
  const last = frames[frames.length - 1];
  if (first === undefined || last === undefined) return null;

  if (timeSeconds <= first.timeSeconds) return toSample(first, first, 0, false);
  if (timeSeconds >= last.timeSeconds) return toSample(last, last, 0, true);

  const index = frameIndexAt(frames, timeSeconds);
  const from = frames[index];
  const to = frames[index + 1];
  if (from === undefined) return null;
  if (to === undefined) return toSample(from, from, 0, from.terminal);

  const span = to.timeSeconds - from.timeSeconds;
  const ratio = span > 0 ? (timeSeconds - from.timeSeconds) / span : 0;
  return toSample(from, to, ratio, false);
}

function toSample(
  from: ReplayFrame,
  to: ReplayFrame,
  ratio: number,
  finished: boolean,
): GhostSample {
  return {
    forwardPosition: lerp(from.forwardPosition, to.forwardPosition, ratio),
    lanePosition: lerp(from.lanePosition, to.lanePosition, ratio),
    speed: lerp(from.speed, to.speed, ratio),
    heat: lerp(from.heat, to.heat, ratio),
    pitch: lerp(from.pitch, to.pitch, ratio),
    height: lerp(from.height, to.height, ratio),
    // Discrete state is held from the earlier sample rather than blended: there
    // is no meaningful midpoint between "grounded" and "airborne", and a lane
    // index that averaged to 1.5 would index nothing.
    lane: from.lane,
    phase: from.phase,
    surface: from.surface,
    wheelie: from.wheelie,
    overheated: from.overheated,
    finished,
  };
}

/**
 * When the ghost reached `forwardPosition`, for the live split delta.
 *
 * Comparing times at a shared *distance* is the comparison a rider can act on:
 * a delta measured at a shared clock instead would report the gap in metres
 * dressed up as seconds, and would swing wildly every time either rider jumped.
 *
 * Returns null when the ghost never reached that distance — the player is past
 * everything the ghost achieved, and the honest HUD answer is to stop quoting a
 * delta rather than to invent one by extrapolating.
 */
export function ghostTimeAtDistance(
  frames: readonly ReplayFrame[],
  forwardPosition: number,
): number | null {
  if (frames.length === 0) return null;
  if (!Number.isFinite(forwardPosition)) return null;

  const first = frames[0];
  const last = frames[frames.length - 1];
  if (first === undefined || last === undefined) return null;
  if (forwardPosition <= first.forwardPosition) return first.timeSeconds;
  if (forwardPosition > last.forwardPosition) return null;

  // A scan for the first crossing rather than a binary search: forward position
  // is non-decreasing in practice, but a recovery that nudges the bike back a
  // few centimetres would break the ordering a binary search depends on, and
  // the first crossing is the correct answer either way.
  for (let index = 1; index < frames.length; index += 1) {
    const to = frames[index];
    const from = frames[index - 1];
    if (to === undefined || from === undefined) continue;
    if (to.forwardPosition < forwardPosition) continue;

    const span = to.forwardPosition - from.forwardPosition;
    const ratio = span > 0 ? (forwardPosition - from.forwardPosition) / span : 0;
    return lerp(from.timeSeconds, to.timeSeconds, ratio);
  }
  return null;
}

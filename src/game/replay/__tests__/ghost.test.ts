import { describe, expect, it } from "vitest";

import {
  FIXED_DT,
  RaceSimulation,
  type SimulationState,
} from "../../simulation";
import { ghostTimeAtDistance, sampleGhostAt } from "../ghost";
import { decodeReplay, ReplayRecorder, type ReplayFrame } from "../replayCodec";

function stateAt(
  stepCount: number,
  forwardPosition: number,
  overrides: Partial<SimulationState["bike"]> = {},
): SimulationState {
  const state = new RaceSimulation().snapshot;
  return {
    ...state,
    stepCount,
    timeSeconds: stepCount * FIXED_DT,
    bike: {
      ...state.bike,
      forwardPosition,
      lane: 1,
      lanePosition: -1.5,
      speed: 18,
      heat: 40,
      pitch: 0,
      height: 0,
      phase: "grounded",
      surface: "dirt",
      wheelie: false,
      overheated: false,
      ...overrides,
    },
  };
}

/** Three samples at the recorder's 10 Hz cadence: 0 s, 0.1 s, 0.2 s. */
function ghostFrames(): readonly ReplayFrame[] {
  const recorder = new ReplayRecorder(512_000);
  recorder.capture(stateAt(0, 0));
  recorder.capture(stateAt(6, 10, { lane: 2, phase: "airborne", wheelie: true, height: 2 }));
  if (!recorder.finalize(stateAt(12, 30))) {
    throw new Error("Expected the ghost fixture to finalize.");
  }
  return decodeReplay(recorder.toUint8Array());
}

describe("ghost fold", () => {
  it("interpolates continuous state between two recorded samples", () => {
    const frames = ghostFrames();
    // Halfway between the 0.1 s sample (10 m) and the 0.2 s sample (30 m).
    const sample = sampleGhostAt(frames, 0.15);
    if (!sample) throw new Error("Expected a ghost sample.");

    expect(sample.forwardPosition).toBeCloseTo(20, 5);
    expect(sample.height).toBeCloseTo(1, 5);
    expect(sample.finished).toBe(false);
  });

  it("holds discrete state from the earlier sample rather than blending it", () => {
    const frames = ghostFrames();
    const sample = sampleGhostAt(frames, 0.15);
    if (!sample) throw new Error("Expected a ghost sample.");

    // The 0.1 s sample is airborne in lane 2 with a wheelie; the 0.2 s sample
    // is not. Everything discrete must read as the interval that was actually
    // being flown, never an average of the two.
    expect(sample.lane).toBe(2);
    expect(sample.phase).toBe("airborne");
    expect(sample.wheelie).toBe(true);
  });

  it("clamps to the grid before the first sample", () => {
    const frames = ghostFrames();
    const sample = sampleGhostAt(frames, -5);
    if (!sample) throw new Error("Expected a ghost sample.");

    expect(sample.forwardPosition).toBe(0);
    expect(sample.finished).toBe(false);
  });

  it("parks on the finish once the terminal sample is reached", () => {
    const frames = ghostFrames();
    const sample = sampleGhostAt(frames, 99);
    if (!sample) throw new Error("Expected a ghost sample.");

    expect(sample.forwardPosition).toBeCloseTo(30, 5);
    expect(sample.finished).toBe(true);
  });

  it("refuses an empty log and a non-finite time", () => {
    expect(sampleGhostAt([], 1)).toBeNull();
    expect(sampleGhostAt(ghostFrames(), Number.NaN)).toBeNull();
    expect(ghostTimeAtDistance([], 1)).toBeNull();
    expect(ghostTimeAtDistance(ghostFrames(), Number.NaN)).toBeNull();
  });
});

describe("ghost split delta", () => {
  it("interpolates the time at which the ghost reached a distance", () => {
    const frames = ghostFrames();
    // 20 m sits halfway between the 0.1 s (10 m) and 0.2 s (30 m) samples.
    expect(ghostTimeAtDistance(frames, 20)).toBeCloseTo(0.15, 5);
  });

  it("reports the grid time at or before the first recorded distance", () => {
    const frames = ghostFrames();
    expect(ghostTimeAtDistance(frames, 0)).toBeCloseTo(0, 5);
    expect(ghostTimeAtDistance(frames, -10)).toBeCloseTo(0, 5);
  });

  it("stops quoting a delta once the player is past everything the ghost reached", () => {
    const frames = ghostFrames();
    expect(ghostTimeAtDistance(frames, 30)).toBeCloseTo(0.2, 5);
    expect(ghostTimeAtDistance(frames, 30.01)).toBeNull();
  });
});

import { describe, expect, it } from "vitest";

import type { CrashCause } from "../../simulation";
import {
  CRASH_RAGDOLL_BIKE_LYING_ROLL,
  advanceCrashRagdoll,
  crashRagdollSupportHeight,
  createCrashRagdoll,
  resolveCrashRagdollWeight,
  type CrashRagdollLaunch,
  type CrashRagdollState,
} from "../crashRagdoll";

const PLAYER_SCALE = 1.46;
const CAUSES: readonly CrashCause[] = [
  "obstacle",
  "landing",
  "wheelie-timeout",
  "rider-contact",
  "external",
];

function launch(overrides: Partial<CrashRagdollLaunch> = {}): CrashRagdollLaunch {
  return {
    cause: "obstacle",
    entrySpeed: 18,
    entryPitch: 0,
    riderRestHeight: 2.39,
    rider: {
      halfWidth: 0.34 * PLAYER_SCALE,
      halfHeight: 0.62 * PLAYER_SCALE,
      halfLength: 0.2 * PLAYER_SCALE,
    },
    bikeRestHeight: 1.17,
    bike: { halfWidth: 0.73, halfHeight: 1.17, halfLength: 1.95 },
    seed: 4_217,
    ...overrides,
  };
}

function run(state: CrashRagdollState, seconds: number, frameSeconds = 1 / 60): void {
  const frames = Math.round(seconds / frameSeconds);
  for (let frame = 0; frame < frames; frame += 1) advanceCrashRagdoll(state, frameSeconds);
}

describe("presentation crash tumble", () => {
  it("throws the rider clear and tumbles them while the bike falls onto its side and slides", () => {
    const state = createCrashRagdoll(launch());
    run(state, 0.6);

    expect(state.rider.forward - state.bike.forward).toBeGreaterThan(1.5);
    expect(Math.abs(state.rider.pitch)).toBeGreaterThan(1.5);
    expect(state.bike.roll).toBeLessThan(-1.2);
    expect(state.bike.height).toBeLessThan(launch().bikeRestHeight);
    expect(state.bike.forward).toBeGreaterThan(0.3);
    expect(state.limbs.leftArm).not.toEqual([0, 0, 0]);
  });

  it("is deterministic and independent of how render time is chunked", () => {
    const smooth = createCrashRagdoll(launch({ cause: "rider-contact" }));
    const uneven = createCrashRagdoll(launch({ cause: "rider-contact" }));
    run(smooth, 1.5, 1 / 120);
    // 0.5 s each at 10, 30, and 60 frames per second.
    run(uneven, 0.5, 0.1);
    run(uneven, 0.5, 1 / 30);
    run(uneven, 0.5, 1 / 60);

    expect(uneven.elapsedSeconds).toBeCloseTo(smooth.elapsedSeconds, 9);
    expect(uneven.rider).toEqual(smooth.rider);
    expect(uneven.bike).toEqual(smooth.bike);
    expect(uneven.limbs).toEqual(smooth.limbs);
  });

  it("stays bounded, above the surface, and comes to rest lying flat for every cause", () => {
    for (const cause of CAUSES) {
      for (const entrySpeed of [0, 8, 14, 22, 80]) {
        const state = createCrashRagdoll(launch({ cause, entrySpeed, entryPitch: 0.5 }));
        for (let frame = 0; frame < 60 * 5; frame += 1) {
          advanceCrashRagdoll(state, 1 / 60);
          const { rider, bike } = state;
          const clearance = crashRagdollSupportHeight(launch().rider, rider.pitch, rider.roll);
          expect(rider.height, `${cause} ${entrySpeed} rider height`).toBeGreaterThanOrEqual(clearance - 1e-9);
          expect(Math.hypot(rider.forward, rider.lateral), `${cause} ${entrySpeed} rider travel`).toBeLessThan(12);
          expect(Math.hypot(bike.forward, bike.lateral), `${cause} ${entrySpeed} bike travel`).toBeLessThan(3);
          expect(bike.roll, `${cause} ${entrySpeed} bike roll`).toBeGreaterThanOrEqual(CRASH_RAGDOLL_BIKE_LYING_ROLL);
        }
        expect(state.settled, `${cause} ${entrySpeed} settled`).toBe(true);
        expect(Math.abs(Math.cos(state.rider.pitch)), `${cause} ${entrySpeed} lying`).toBeLessThan(0.05);
        expect(state.bike.roll).toBe(CRASH_RAGDOLL_BIKE_LYING_ROLL);
      }
    }
  });

  it("sends the rider over the bars at a barrier and off the back on a wheelie loop-out", () => {
    const barrier = createCrashRagdoll(launch({ cause: "obstacle", entrySpeed: 14 }));
    const loopOut = createCrashRagdoll(launch({ cause: "wheelie-timeout", entrySpeed: 14 }));
    run(barrier, 4);
    run(loopOut, 4);

    expect(barrier.rider.forward - barrier.bike.forward).toBeGreaterThan(3);
    expect(barrier.rider.pitch).toBeLessThan(0);
    expect(loopOut.rider.forward).toBeLessThan(loopOut.bike.forward);
    expect(loopOut.rider.pitch).toBeGreaterThan(0);
  });

  it("sanitizes non-finite launch values and render deltas", () => {
    const state = createCrashRagdoll(launch({
      entrySpeed: Number.NaN,
      entryPitch: Number.POSITIVE_INFINITY,
      seed: Number.NaN,
    }));
    advanceCrashRagdoll(state, Number.NaN);
    advanceCrashRagdoll(state, -1);
    expect(state.elapsedSeconds).toBe(0);

    run(state, 2);
    for (const value of [...Object.values(state.rider), ...Object.values(state.bike)]) {
      expect(Number.isFinite(value)).toBe(true);
    }
  });
});

describe("crash tumble hand-back", () => {
  it("shows the whole tumble while crashed and hands back to the static pose as Recover is held", () => {
    expect(resolveCrashRagdollWeight("crashed", 0, false)).toBe(1);
    expect(resolveCrashRagdollWeight("crashed", 0.15, false)).toBe(1);
    expect(resolveCrashRagdollWeight("crashed", 1, false)).toBe(0);

    let previous = 1;
    for (let progress = 0; progress <= 1; progress += 0.05) {
      const weight = resolveCrashRagdollWeight("crashed", progress, false);
      expect(weight).toBeLessThanOrEqual(previous);
      previous = weight;
    }
  });

  it("never tumbles outside the crashed phase or under Reduced Motion", () => {
    for (const phase of ["grounded", "airborne", "recovering"] as const) {
      expect(resolveCrashRagdollWeight(phase, 0, false)).toBe(0);
    }
    expect(resolveCrashRagdollWeight("crashed", 0, true)).toBe(0);
    expect(resolveCrashRagdollWeight("crashed", Number.NaN, false)).toBe(1);
  });
});

import { describe, expect, it } from "vitest";

import { BIKE_PERFORMANCE_LIMITS } from "../../simulation";
import { getMasteryTargetMs, TRACKS } from "../tracks";

const RACE_LAPS = 2;

function cleanStandardRideMs(courseLength: number): number {
  const distance = courseLength * RACE_LAPS;
  const speed = BIKE_PERFORMANCE_LIMITS.standardSpeed;
  const acceleration = BIKE_PERFORMANCE_LIMITS.standardAcceleration;
  const accelerationAllowanceSeconds = speed / (2 * acceleration);
  return (distance / speed + accelerationAllowanceSeconds) * 1_000;
}

function absoluteTurboFloorMs(courseLength: number): number {
  const distance = courseLength * RACE_LAPS;
  const speed = BIKE_PERFORMANCE_LIMITS.turboSpeed;
  const acceleration = BIKE_PERFORMANCE_LIMITS.turboAcceleration;
  return (distance / speed + speed / (2 * acceleration)) * 1_000;
}

describe("production race target feasibility", () => {
  it("keeps every Solo target above a clean standard-Ride reference with human margin", () => {
    for (const track of TRACKS) {
      const cleanReferenceMs = cleanStandardRideMs(track.courseLength);
      expect(track.parTimeMs, `${track.name} par`).toBe(
        Math.ceil(cleanReferenceMs / 1_000) * 1_000,
      );
      expect(track.soloTargetMs, `${track.name} Solo target`).toBe(
        Math.ceil((cleanReferenceMs * 1.05) / 1_000) * 1_000,
      );
      expect(track.parTimeMs, `${track.name} physical floor`).toBeGreaterThan(
        absoluteTurboFloorMs(track.courseLength),
      );
      expect(track.parTimeMs, `${track.name} par ordering`).toBeLessThan(track.soloTargetMs);
    }
  });

  it("keeps all seven Summit mastery targets above the production clean-Ride reference", () => {
    const summit = TRACKS.find((track) => track.id === "summit-showdown");
    if (!summit) throw new Error("Summit Showdown is required.");
    const cleanReferenceMs = Math.ceil(cleanStandardRideMs(summit.courseLength) / 1_000) * 1_000;
    const targets = Array.from({ length: 7 }, (_, masteryLevel) => (
      getMasteryTargetMs(summit.soloTargetMs, masteryLevel)
    ));

    expect(targets).toEqual([257_000, 255_000, 253_000, 251_000, 249_000, 248_000, 247_000]);
    expect(targets.every((target) => target >= cleanReferenceMs)).toBe(true);
    expect(targets.every((target, index) => index === 0 || target < (targets[index - 1] ?? 0))).toBe(true);
    expect(getMasteryTargetMs(summit.soloTargetMs, 7)).toBe(targets.at(-1));
  });

  it("keeps every compact QA-fast mastery tier above its shortened physical floor", () => {
    const qaFastCourseLength = 84;
    const qaFastBaseTargetMs = 18_000;
    const targets = Array.from({ length: 7 }, (_, masteryLevel) => (
      getMasteryTargetMs(qaFastBaseTargetMs, masteryLevel)
    ));

    expect(targets.every((target) => target > absoluteTurboFloorMs(qaFastCourseLength))).toBe(true);
    expect(targets.every((target, index) => index === 0 || target < (targets[index - 1] ?? 0))).toBe(true);
  });
});

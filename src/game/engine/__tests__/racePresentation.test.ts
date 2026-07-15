import { describe, expect, it } from "vitest";

import {
  resolveRiderSpeedTuck,
  resolveRiderSteeringRoll,
  usesPortraitRacePresentation,
} from "../racePresentation";

describe("race presentation selection", () => {
  it.each([
    [390, 844],
    [768, 1_024],
    [620, 360],
  ])("uses portrait framing for a %sx%s viewport", (width, height) => {
    expect(usesPortraitRacePresentation(width, height)).toBe(true);
  });

  it.each([
    [1_672, 941],
    [1_024, 768],
    [680, 500],
  ])("uses desktop framing for a %sx%s viewport", (width, height) => {
    expect(usesPortraitRacePresentation(width, height)).toBe(false);
  });
});

describe("reduced-motion rider presentation", () => {
  it("suppresses speed tuck while preserving the standard pose otherwise", () => {
    expect(resolveRiderSpeedTuck(22, false, false)).toBeCloseTo(-0.055);
    expect(resolveRiderSpeedTuck(22, false, true)).toBe(0);
    expect(resolveRiderSpeedTuck(22, true, false)).toBe(0);
  });

  it("suppresses steering lean without removing the crash pose", () => {
    expect(resolveRiderSteeringRoll(-3, 0, false, false)).toBeCloseTo(0.17);
    expect(resolveRiderSteeringRoll(-3, 0, false, true)).toBe(0);
    expect(resolveRiderSteeringRoll(-3, 0, true, true)).toBe(-1.05);
  });
});

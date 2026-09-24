import { describe, expect, it } from "vitest";

import {
  RIDER_LANE_CHANGE_LEAN_HOLD_SECONDS,
  resolveBikePresentationPitch,
  resolveHeldLaneChangePresentationRoll,
  resolveLandingCompression,
  resolvePresentationRecoveryProgress,
  resolveRiderPose,
  resolveRiderPresentationRoll,
  resolveRiderSpeedTuck,
  resolveRiderSteeringRoll,
  usesPortraitRacePresentation,
} from "../racePresentation";

const basePoseInput = {
  speed: 0,
  progress: 0,
  phase: "grounded",
  pitch: 0,
  lean: 0,
  height: 0,
  wheelie: false,
  recoveryProgress: 0,
  landingAgeSeconds: Number.POSITIVE_INFINITY,
  lastLanding: null,
  reducedMotion: false,
} as const;

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
    expect(resolveRiderSteeringRoll(-3, 0, true, true)).toBe(-1.22);
  });

  it("eases the crashed bike upright throughout the real recovery phase", () => {
    expect(resolveRiderPresentationRoll(0, 0, "crashed", 0, true)).toBe(-1.22);
    expect(resolveRiderPresentationRoll(0, 0, "recovering", 0, true)).toBe(-1.22);
    expect(resolveRiderPresentationRoll(0, 0, "recovering", 0.5, true)).toBeCloseTo(-0.61);
    expect(resolveRiderPresentationRoll(0, 0, "recovering", 1, true)).toBe(0);
  });

  it("holds a readable lane-change lean after the bike reaches the lane center", () => {
    expect(resolveHeldLaneChangePresentationRoll(
      0,
      -1,
      RIDER_LANE_CHANGE_LEAN_HOLD_SECONDS,
      "grounded",
      false,
    )).toBeCloseTo(0.17);
    expect(resolveHeldLaneChangePresentationRoll(
      0,
      1,
      RIDER_LANE_CHANGE_LEAN_HOLD_SECONDS / 2,
      "grounded",
      false,
    )).toBeCloseTo(-0.085);
    expect(resolveHeldLaneChangePresentationRoll(
      0.17,
      1,
      RIDER_LANE_CHANGE_LEAN_HOLD_SECONDS,
      "grounded",
      false,
    )).toBeCloseTo(0.17);
    expect(resolveHeldLaneChangePresentationRoll(
      0,
      -1,
      RIDER_LANE_CHANGE_LEAN_HOLD_SECONDS,
      "grounded",
      true,
    )).toBe(0);
    expect(resolveHeldLaneChangePresentationRoll(
      -1.22,
      -1,
      RIDER_LANE_CHANGE_LEAN_HOLD_SECONDS,
      "crashed",
      false,
    )).toBe(-1.22);
  });

  it("amplifies readable action pitch without changing crash or Reduced Motion framing", () => {
    expect(resolveBikePresentationPitch("grounded", 0.28, true, 0, false)).toBeCloseTo(0.406);
    expect(resolveBikePresentationPitch("airborne", -0.18, false, 0, false)).toBeCloseTo(-0.261);
    expect(resolveBikePresentationPitch("grounded", 0.62, true, 0, false)).toBe(0.72);
    expect(resolveBikePresentationPitch("airborne", -0.62, false, 0, false)).toBe(-0.72);
    expect(resolveBikePresentationPitch("grounded", 0.28, true, 0, true)).toBeCloseTo(0.28);
    expect(resolveBikePresentationPitch("airborne", -0.18, false, 0, true)).toBeCloseTo(-0.18);
    expect(resolveBikePresentationPitch("airborne", 1.1, false, 0, true)).toBeCloseTo(1.1);
    expect(resolveBikePresentationPitch("crashed", 0.62, false, 0, false)).toBe(0);
    expect(resolveBikePresentationPitch("recovering", 0.4, false, 0, false)).toBe(0);
    expect(resolveBikePresentationPitch("grounded", 0, false, 0.72, false)).toBeCloseTo(-0.1008);
  });

  it("decays an interrupted recovery hold instead of snapping back to the crash pose", () => {
    expect(resolvePresentationRecoveryProgress("crashed", 0.6, 0, 1 / 60)).toBe(0.6);
    const released = resolvePresentationRecoveryProgress("crashed", 0, 0.6, 1 / 60);
    expect(released).toBeLessThan(0.6);
    expect(released).toBeGreaterThan(0.5);
    expect(resolvePresentationRecoveryProgress("recovering", 0.25, released, 1 / 60)).toBe(0.25);
    expect(resolvePresentationRecoveryProgress("grounded", 0, released, 1 / 60)).toBe(0);
  });
});

describe("action-state rider posing", () => {
  it("keeps neutral still and makes the speed tuck visibly distinct", () => {
    const neutral = resolveRiderPose(basePoseInput);
    const tuck = resolveRiderPose({ ...basePoseInput, speed: 22, progress: 1 });

    expect(neutral.actionState).toBe("neutral");
    expect(neutral.rootRotationX).toBe(0);
    expect(neutral.rig.torso).toEqual([0, 0, 0]);
    expect(tuck.actionState).toBe("tuck");
    expect(tuck.rootRotationX).toBeLessThan(-0.03);
    expect(tuck.rig.torso[0]).toBeLessThan(-0.22);
    expect(tuck.rig.head[0]).toBeGreaterThan(0.12);
  });

  it("adds a bounded rider counterweight pose to a grounded wheelie", () => {
    const tuck = resolveRiderPose({ ...basePoseInput, speed: 16 });
    const wheelie = resolveRiderPose({
      ...basePoseInput,
      speed: 16,
      pitch: 0.28,
      wheelie: true,
    });

    expect(wheelie.actionState).toBe("wheelie");
    expect(wheelie.rig.torso[0]).toBeLessThan(tuck.rig.torso[0] - 0.14);
    expect(wheelie.rig.head[0]).toBeGreaterThan(tuck.rig.head[0] + 0.08);
    expect(wheelie.rig.leftLeg[0]).toBeGreaterThan(tuck.rig.leftLeg[0] + 0.07);
    expect(wheelie.rootPositionZ).toBeGreaterThan(0.1);
  });

  it("keeps airborne up, down, and neutral poses semantically and numerically distinct", () => {
    const neutral = resolveRiderPose({
      ...basePoseInput,
      speed: 16,
      phase: "airborne",
      height: 1.2,
    });
    const up = resolveRiderPose({ ...basePoseInput, speed: 16, phase: "airborne", height: 1.2, pitch: 0.4 });
    const down = resolveRiderPose({ ...basePoseInput, speed: 16, phase: "airborne", height: 1.2, pitch: -0.4 });

    expect(neutral.actionState).toBe("airborne-neutral");
    expect(up.actionState).toBe("airborne-up");
    expect(down.actionState).toBe("airborne-down");
    expect(up.rig.torso[0]).toBeLessThan(neutral.rig.torso[0]);
    expect(down.rig.torso[0]).toBeGreaterThan(neutral.rig.torso[0]);
    expect(up.rig.head[0]).toBeGreaterThan(neutral.rig.head[0]);
    expect(down.rig.head[0]).toBeLessThan(neutral.rig.head[0]);
  });

  it("uses a readable presentation-only landing compression pulse", () => {
    expect(resolveLandingCompression(0, "clean", false)).toBe(0);
    expect(resolveLandingCompression(0.08, "clean", false)).toBeCloseTo(0.72);
    expect(resolveLandingCompression(0.08, "rough", false)).toBeCloseTo(1);
    expect(resolveLandingCompression(0.46, "clean", false)).toBeGreaterThan(0.1);
    expect(resolveLandingCompression(0.72, "clean", false)).toBe(0);
    expect(resolveLandingCompression(0.82, "rough", false)).toBe(0);
    expect(resolveLandingCompression(0.08, "clean", true)).toBe(0);

    const landing = resolveRiderPose({
      ...basePoseInput,
      speed: 16,
      landingAgeSeconds: 0.08,
      lastLanding: "clean",
    });
    expect(landing.actionState).toBe("landing");
    expect(landing.rootRotationX).toBeLessThan(-0.08);
    expect(landing.rootPositionY).toBeLessThan(-0.15);
    expect(landing.rootPositionZ).toBeLessThan(-0.15);
    expect(landing.frontSuspensionCompression).toBeGreaterThan(0.1);
    expect(landing.rearSuspensionCompression).toBeGreaterThan(0.025);
    expect(landing.frontSuspensionCompression).toBeGreaterThan(
      landing.rearSuspensionCompression * 3,
    );
  });

  it("preserves the exact crash pose and interpolates it through recovery", () => {
    const crash = resolveRiderPose({ ...basePoseInput, phase: "crashed" });
    const recovery = resolveRiderPose({
      ...basePoseInput,
      phase: "recovering",
      recoveryProgress: 0.5,
      reducedMotion: true,
    });

    expect(crash.actionState).toBe("crash");
    expect(crash.rootPositionX).toBeCloseTo(0.72);
    expect(crash.rootPositionY).toBeCloseTo(0.48);
    expect(crash.rootPositionZ).toBeCloseTo(-0.18);
    expect(crash.rootRotationZ).toBeCloseTo(0.62);
    expect(crash.rig).toEqual({
      torso: [-0.32, 0.18, 0.5],
      head: [0.38, -0.24, 0.28],
      leftArm: [0.62, -0.2, 0.82],
      rightArm: [-0.32, 0.18, -0.72],
      leftLeg: [-0.52, 0.16, 0.4],
      rightLeg: [0.44, -0.12, -0.34],
    });
    expect(recovery.actionState).toBe("recovery");
    expect(recovery.rig.torso[0]).toBeCloseTo(-0.21);
    expect(recovery.rig.torso[1]).toBeCloseTo(-0.08);
    expect(recovery.rig.torso[2]).toBeCloseTo(-0.23);
    expect(recovery.rootPositionX).toBeCloseTo(0.27);
    expect(recovery.rootPositionY).toBeCloseTo(0.9);
    expect(recovery.rootPositionZ).toBeCloseTo(0.11);
    expect(recovery.rootRotationZ).toBeCloseTo(0.09);
  });

  it("turns a held recovery input into a distinct bracing pose with continuous recovery", () => {
    const crash = resolveRiderPose({ ...basePoseInput, phase: "crashed" });
    const hold = resolveRiderPose({
      ...basePoseInput,
      phase: "crashed",
      recoveryProgress: 0.5,
    });
    const completedHold = resolveRiderPose({
      ...basePoseInput,
      phase: "crashed",
      recoveryProgress: 1,
    });
    const recoveryStart = resolveRiderPose({
      ...basePoseInput,
      phase: "recovering",
      recoveryProgress: 0,
    });

    expect(hold.actionState).toBe("recovery-hold");
    expect(hold.rootPositionX).toBeLessThan(crash.rootPositionX);
    expect(hold.rootPositionY).toBeGreaterThan(crash.rootPositionY);
    expect(hold.rig).not.toEqual(crash.rig);
    expect(recoveryStart).toEqual({
      ...completedHold,
      actionState: "recovery",
    });
  });

  it("suppresses secondary action motion under Reduced Motion without suppressing recovery", () => {
    const reduced = resolveRiderPose({
      ...basePoseInput,
      speed: 22,
      pitch: 0.28,
      wheelie: true,
      landingAgeSeconds: 0.08,
      lastLanding: "clean",
      reducedMotion: true,
    });
    expect(reduced.actionState).toBe("reduced-motion");
    expect(reduced.rootRotationX).toBe(0);
    expect(reduced.rootPositionY).toBe(0);
    expect(reduced.rig.torso).toEqual([0, 0, 0]);
    expect(reduced.frontSuspensionCompression).toBe(0);
  });
});

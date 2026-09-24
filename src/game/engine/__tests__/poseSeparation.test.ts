import { describe, expect, it } from "vitest";

import {
  createResolvedRiderPose,
  resolveRiderPose,
  type ResolvedRiderPose,
  type RiderPoseInput,
} from "../racePresentation";

/**
 * How far apart two rider poses actually read, in degrees.
 *
 * `racePresentation.test.ts` asserts *ordering* — that airborne-up pitches the
 * torso further than airborne-neutral — and only within one family. Ordering is
 * satisfied by a tenth of a degree, so it cannot answer the question the red
 * team actually asked: can a player tell these apart on a rider 8.85 m ahead of
 * the camera. This file answers that one, and pins it as a ratchet.
 *
 * The metric is the **largest single weighted channel difference**, not a sum.
 * A sum is dominated by the crash pose's large numbers and would let a genuinely
 * unreadable pair pass on the strength of six tiny differences that no player
 * resolves. What a viewer notices is the one joint that moved most.
 *
 * Weights are lever arms, not opinions: the torso swings the whole upper body
 * and the head swings almost nothing, so a degree is worth more at the torso.
 * Channels are weighted by visibility from a rear chase camera — pitch reads
 * most, yaw least.
 */

const JOINT_WEIGHT = {
  torso: 1,
  leftLeg: 0.8,
  rightLeg: 0.8,
  leftArm: 0.6,
  rightArm: 0.6,
  head: 0.4,
} as const;

/** X is pitch, Y is yaw, Z is roll — as seen from directly behind the rider. */
const CHANNEL_WEIGHT = [1, 0.5, 0.8] as const;

const DEGREES = 180 / Math.PI;

function separationDegrees(first: ResolvedRiderPose, second: ResolvedRiderPose): number {
  let widest = 0;
  for (const joint of Object.keys(JOINT_WEIGHT) as Array<keyof typeof JOINT_WEIGHT>) {
    const a = first.rig[joint];
    const b = second.rig[joint];
    for (let channel = 0; channel < 3; channel += 1) {
      const spread = Math.abs(a[channel]! - b[channel]!)
        * DEGREES
        * JOINT_WEIGHT[joint]
        * CHANNEL_WEIGHT[channel]!;
      widest = Math.max(widest, spread);
    }
  }
  return widest;
}

const BASE: RiderPoseInput = {
  speed: 18,
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
};

/**
 * One canonical input per moment a player has to read. Labelled by the moment
 * rather than by `actionState`, because two inputs can resolve to the same
 * state and it is the *moment* a rider needs to tell apart.
 */
const MOMENTS: ReadonlyArray<readonly [string, RiderPoseInput]> = [
  ["grounded-slow", { ...BASE, speed: 4 }],
  ["grounded-fast", { ...BASE, speed: 20 }],
  ["lean-a", { ...BASE, lean: -1 }],
  ["lean-b", { ...BASE, lean: 1 }],
  ["wheelie", { ...BASE, wheelie: true, pitch: 0.5 }],
  ["airborne-neutral", { ...BASE, speed: 20, phase: "airborne", height: 2 }],
  ["airborne-up", { ...BASE, phase: "airborne", height: 2, pitch: 0.6 }],
  ["airborne-down", { ...BASE, phase: "airborne", height: 2, pitch: -0.6 }],
  ["landing-rough", { ...BASE, lastLanding: "rough", landingAgeSeconds: 0.08 }],
  ["crash", { ...BASE, phase: "crashed", recoveryProgress: 0 }],
  ["recovery-hold", { ...BASE, phase: "crashed", recoveryProgress: 0.9 }],
  ["recovering", { ...BASE, phase: "recovering", recoveryProgress: 0.5 }],
] as const;

function posed(): ReadonlyArray<readonly [string, ResolvedRiderPose]> {
  return MOMENTS.map(([label, input]) => [
    label,
    resolveRiderPose(input, createResolvedRiderPose()),
  ] as const);
}

function pairs(): Array<{ label: string; degrees: number }> {
  const all = posed();
  const out: Array<{ label: string; degrees: number }> = [];
  for (let a = 0; a < all.length; a += 1) {
    for (let b = a + 1; b < all.length; b += 1) {
      out.push({
        label: `${all[a]![0]} vs ${all[b]![0]}`,
        degrees: separationDegrees(all[a]![1], all[b]![1]),
      });
    }
  }
  return out.sort((first, second) => first.degrees - second.degrees);
}

/**
 * The measured floor as of 2026-08-29, not a target.
 *
 * This is a ratchet's zero point: it passes today by construction, and exists
 * so the distance between two moments cannot quietly shrink. Raising it is the
 * machine-checkable half of closing the "weak landing/crash/recovery
 * readability" finding — when the pose work lands, this number goes up and the
 * commit that raises it is the evidence.
 */
const MEASURED_FLOOR_DEGREES = 2.8;

describe("rider pose separation", () => {
  it("keeps every pair of readable moments above the measured floor", () => {
    const collapsed = pairs().filter((pair) => pair.degrees < MEASURED_FLOOR_DEGREES);
    expect(collapsed).toEqual([]);
  });

  it("holds the three closest pairs where they are, so none of them tightens", () => {
    // Named rather than merely bounded: if the ranking changes, the pose work
    // moved something, and that should be a deliberate edit here rather than a
    // silent pass.
    const closest = pairs().slice(0, 3).map((pair) => pair.label);
    expect(closest).toEqual([
      "grounded-slow vs airborne-down",
      "grounded-fast vs airborne-neutral",
      "airborne-up vs landing-rough",
    ]);
  });

  it("records the grounded/airborne collision as the defect it is", () => {
    // THIS ASSERTION DOCUMENTS A DEFECT, NOT A REQUIREMENT.
    //
    // `resolveRiderSpeedTuck` reads speed with no phase term, so at the same
    // speed a rider on the ground and a rider in the air hold an identical
    // torso and identical arms. Only the legs differ, by 6.3°. From the rear
    // chase camera at 8.85 m that is close to unreadable, and it is a direct,
    // measurable cause of the owner's "weak landing/crash/recovery readability"
    // rejection (README.md).
    //
    // Fixing it MUST break this test. That is the point: the fix should be a
    // visible edit here, not a silent improvement nothing recorded.
    const grounded = resolveRiderPose({ ...BASE, speed: 20 }, createResolvedRiderPose());
    const airborne = resolveRiderPose(
      { ...BASE, speed: 20, phase: "airborne", height: 2 },
      createResolvedRiderPose(),
    );

    expect(grounded.rig.torso).toEqual(airborne.rig.torso);
    expect(grounded.rig.leftArm).toEqual(airborne.rig.leftArm);
    expect(grounded.rig.rightArm).toEqual(airborne.rig.rightArm);
    // The legs are the only thing telling the two apart today.
    expect(separationDegrees(grounded, airborne)).toBeLessThan(6);
  });

  it("resolves every canonical moment to a finite pose", () => {
    for (const [label, pose] of posed()) {
      for (const joint of Object.keys(JOINT_WEIGHT) as Array<keyof typeof JOINT_WEIGHT>) {
        for (const channel of pose.rig[joint]) {
          expect(Number.isFinite(channel), `${label}.${joint}`).toBe(true);
        }
      }
    }
  });
});

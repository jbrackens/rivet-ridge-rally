import type { BikePhase, LaneChange, LandingQuality } from "../simulation";

const NARROW_RACE_PRESENTATION_WIDTH = 680;
const RIDER_CRASH_ROLL = -1.22;
const RIDER_STEERING_ROLL = 0.17;
export const RIDER_LANE_CHANGE_LEAN_HOLD_SECONDS = 0.42;

export type RiderActionState =
  | "neutral"
  | "tuck"
  | "lean-left"
  | "lean-right"
  | "wheelie"
  | "airborne-up"
  | "airborne-down"
  | "airborne-neutral"
  | "landing"
  | "crash"
  | "recovery-hold"
  | "recovery"
  | "reduced-motion";

export type RiderPoseRotation = [number, number, number];

export interface RiderPoseInput {
  speed: number;
  progress: number;
  phase: BikePhase;
  pitch: number;
  lean: number;
  height: number;
  wheelie: boolean;
  recoveryProgress: number;
  landingAgeSeconds: number;
  lastLanding: LandingQuality;
  reducedMotion: boolean;
}

export interface ResolvedRiderPose {
  actionState: RiderActionState;
  rootPositionX: number;
  rootRotationX: number;
  rootRotationY: number;
  rootRotationZ: number;
  rootPositionY: number;
  rootPositionZ: number;
  landingCompression: number;
  frontSuspensionCompression: number;
  rearSuspensionCompression: number;
  rig: {
    torso: RiderPoseRotation;
    head: RiderPoseRotation;
    leftArm: RiderPoseRotation;
    rightArm: RiderPoseRotation;
    leftLeg: RiderPoseRotation;
    rightLeg: RiderPoseRotation;
  };
}

const CRASH_POSE = {
  torso: [-0.32, 0.18, 0.5],
  head: [0.38, -0.24, 0.28],
  leftArm: [0.62, -0.2, 0.82],
  rightArm: [-0.32, 0.18, -0.72],
  leftLeg: [-0.52, 0.16, 0.4],
  rightLeg: [0.44, -0.12, -0.34],
} as const;

const RECOVERY_HOLD_POSE = {
  torso: [-0.18, -0.08, -0.1],
  head: [0.12, 0.12, -0.04],
  leftArm: [-0.1, 0.15, -0.18],
  rightArm: [-0.4, -0.1, 0.18],
  leftLeg: [-0.65, 0.12, -0.15],
  rightLeg: [0.12, -0.12, 0.18],
} as const;

const RECOVERY_POSE = {
  torso: [-0.12, -0.04, -0.18],
  head: [0.08, 0.1, -0.06],
  leftArm: [-0.16, 0.12, -0.2],
  rightArm: [-0.36, -0.08, 0.14],
  leftLeg: [-0.5, 0.1, -0.12],
  rightLeg: [0.16, -0.1, 0.16],
} as const;

const CRASH_ROOT = {
  position: [0.72, 0.48, -0.18],
  rotation: [-0.12, 0.18, 0.62],
} as const;

const RECOVERY_HOLD_ROOT = {
  position: [0.3, 1.1, 0.02],
  rotation: [-0.16, 0.12, 0.46],
} as const;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function smoothstep(value: number): number {
  const normalized = clamp(value, 0, 1);
  return normalized * normalized * (3 - 2 * normalized);
}

function cleanZero(value: number): number {
  return Math.abs(value) < 1e-12 ? 0 : value;
}

function writeScaledRotation(
  target: RiderPoseRotation,
  rotation: readonly [number, number, number],
  factor: number,
): void {
  target[0] = cleanZero(rotation[0] * factor);
  target[1] = cleanZero(rotation[1] * factor);
  target[2] = cleanZero(rotation[2] * factor);
}

function writeRecoveryRotation(
  target: RiderPoseRotation,
  crashRotation: readonly [number, number, number],
  crashFactor: number,
  recoveryRotation: readonly [number, number, number],
  recoveryFactor: number,
): void {
  target[0] = cleanZero(crashRotation[0] * crashFactor + recoveryRotation[0] * recoveryFactor);
  target[1] = cleanZero(crashRotation[1] * crashFactor + recoveryRotation[1] * recoveryFactor);
  target[2] = cleanZero(crashRotation[2] * crashFactor + recoveryRotation[2] * recoveryFactor);
}

export function createResolvedRiderPose(): ResolvedRiderPose {
  return {
    actionState: "neutral",
    rootPositionX: 0,
    rootRotationX: 0,
    rootRotationY: 0,
    rootRotationZ: 0,
    rootPositionY: 0,
    rootPositionZ: 0,
    landingCompression: 0,
    frontSuspensionCompression: 0,
    rearSuspensionCompression: 0,
    rig: {
      torso: [0, 0, 0],
      head: [0, 0, 0],
      leftArm: [0, 0, 0],
      rightArm: [0, 0, 0],
      leftLeg: [0, 0, 0],
      rightLeg: [0, 0, 0],
    },
  };
}

export function usesPortraitRacePresentation(width: number, height: number): boolean {
  return height > width || width < NARROW_RACE_PRESENTATION_WIDTH;
}

export function resolveRiderSpeedTuck(
  speed: number,
  crashed: boolean,
  reducedMotion: boolean,
): number {
  if (crashed || reducedMotion) return 0;
  return -0.055 * clamp(speed / 22, 0, 1);
}

export function resolveRiderSteeringRoll(
  targetLanePosition: number,
  lanePosition: number,
  crashed: boolean,
  reducedMotion: boolean,
): number {
  if (crashed) return RIDER_CRASH_ROLL;
  if (reducedMotion) return 0;
  return clamp(
    (targetLanePosition - lanePosition) * -0.12,
    -RIDER_STEERING_ROLL,
    RIDER_STEERING_ROLL,
  );
}

export function resolveRiderPresentationRoll(
  targetLanePosition: number,
  lanePosition: number,
  phase: BikePhase,
  recoveryProgress: number,
  reducedMotion: boolean,
): number {
  if (phase === "crashed") return RIDER_CRASH_ROLL;
  if (phase === "recovering") {
    return cleanZero(RIDER_CRASH_ROLL * (1 - smoothstep(recoveryProgress)));
  }
  return resolveRiderSteeringRoll(
    targetLanePosition,
    lanePosition,
    false,
    reducedMotion,
  );
}

export function resolveHeldLaneChangePresentationRoll(
  baseRoll: number,
  heldLaneChange: LaneChange,
  holdSeconds: number,
  phase: BikePhase,
  reducedMotion: boolean,
): number {
  if (phase === "crashed" || phase === "recovering" || reducedMotion) return baseRoll;
  if (heldLaneChange !== -1 && heldLaneChange !== 1) return baseRoll;
  if (holdSeconds <= 0) return baseRoll;
  const holdBlend = clamp(holdSeconds / RIDER_LANE_CHANGE_LEAN_HOLD_SECONDS, 0, 1);
  const heldRoll = heldLaneChange === -1 ? RIDER_STEERING_ROLL : -RIDER_STEERING_ROLL;
  if (Math.abs(baseRoll) >= Math.abs(heldRoll) * holdBlend) return baseRoll;
  return cleanZero(heldRoll * holdBlend);
}

export function resolvePresentationRecoveryProgress(
  phase: BikePhase,
  recoveryProgress: number,
  previousPresentationProgress: number,
  deltaSeconds: number,
): number {
  const gameplayProgress = clamp(recoveryProgress, 0, 1);
  if (phase === "recovering") return gameplayProgress;
  if (phase !== "crashed") return 0;

  const previousProgress = clamp(previousPresentationProgress, 0, 1);
  const elapsed = Number.isFinite(deltaSeconds) ? Math.max(0, deltaSeconds) : 0;
  const releasedHoldProgress = previousProgress * Math.exp(-elapsed * 5);
  return Math.max(gameplayProgress, releasedHoldProgress);
}

export function resolveBikePresentationPitch(
  phase: BikePhase,
  pitch: number,
  wheelie: boolean,
  landingCompression: number,
  reducedMotion: boolean,
): number {
  if (phase === "crashed" || phase === "recovering") return 0;
  if (reducedMotion) return cleanZero(pitch);
  const actionPitch = wheelie || phase === "airborne"
    ? pitch * 1.45
    : pitch;
  const landingPitch = landingCompression * 0.14;
  return cleanZero(clamp(actionPitch - landingPitch, -0.72, 0.72));
}

export function resolveLandingCompression(
  landingAgeSeconds: number,
  lastLanding: LandingQuality,
  reducedMotion: boolean,
): number {
  if (
    reducedMotion
    || (lastLanding !== "clean" && lastLanding !== "rough")
    || !Number.isFinite(landingAgeSeconds)
    || landingAgeSeconds < 0
  ) return 0;

  const duration = lastLanding === "rough" ? 0.82 : 0.72;
  if (landingAgeSeconds >= duration) return 0;
  const attackSeconds = 0.08;
  const attack = smoothstep(landingAgeSeconds / attackSeconds);
  const decay = 1 - smoothstep(
    (landingAgeSeconds - attackSeconds) / (duration - attackSeconds),
  );
  return attack * decay * (lastLanding === "rough" ? 1 : 0.72);
}

export function resolveRiderPose(
  input: RiderPoseInput,
  output = createResolvedRiderPose(),
): ResolvedRiderPose {
  const recoveryProgress = clamp(input.recoveryProgress, 0, 1);
  if (input.phase === "crashed") {
    const holdBlend = smoothstep(recoveryProgress);
    const crashBlend = 1 - holdBlend;
    output.actionState = holdBlend > 0.01 ? "recovery-hold" : "crash";
    output.rootPositionX = cleanZero(
      CRASH_ROOT.position[0] * crashBlend + RECOVERY_HOLD_ROOT.position[0] * holdBlend,
    );
    output.rootPositionY = cleanZero(
      CRASH_ROOT.position[1] * crashBlend + RECOVERY_HOLD_ROOT.position[1] * holdBlend,
    );
    output.rootPositionZ = cleanZero(
      CRASH_ROOT.position[2] * crashBlend + RECOVERY_HOLD_ROOT.position[2] * holdBlend,
    );
    output.rootRotationX = cleanZero(
      CRASH_ROOT.rotation[0] * crashBlend + RECOVERY_HOLD_ROOT.rotation[0] * holdBlend,
    );
    output.rootRotationY = cleanZero(
      CRASH_ROOT.rotation[1] * crashBlend + RECOVERY_HOLD_ROOT.rotation[1] * holdBlend,
    );
    output.rootRotationZ = cleanZero(
      CRASH_ROOT.rotation[2] * crashBlend + RECOVERY_HOLD_ROOT.rotation[2] * holdBlend,
    );
    output.landingCompression = 0;
    output.frontSuspensionCompression = 0;
    output.rearSuspensionCompression = 0;
    writeRecoveryRotation(output.rig.torso, CRASH_POSE.torso, crashBlend, RECOVERY_HOLD_POSE.torso, holdBlend);
    writeRecoveryRotation(output.rig.head, CRASH_POSE.head, crashBlend, RECOVERY_HOLD_POSE.head, holdBlend);
    writeRecoveryRotation(output.rig.leftArm, CRASH_POSE.leftArm, crashBlend, RECOVERY_HOLD_POSE.leftArm, holdBlend);
    writeRecoveryRotation(output.rig.rightArm, CRASH_POSE.rightArm, crashBlend, RECOVERY_HOLD_POSE.rightArm, holdBlend);
    writeRecoveryRotation(output.rig.leftLeg, CRASH_POSE.leftLeg, crashBlend, RECOVERY_HOLD_POSE.leftLeg, holdBlend);
    writeRecoveryRotation(output.rig.rightLeg, CRASH_POSE.rightLeg, crashBlend, RECOVERY_HOLD_POSE.rightLeg, holdBlend);
    return output;
  }
  if (input.phase === "recovering") {
    const recoveryBlend = 1 - smoothstep(recoveryProgress);
    const recoveryLift = Math.sin(smoothstep(recoveryProgress) * Math.PI);
    output.actionState = "recovery";
    output.rootPositionX = cleanZero(RECOVERY_HOLD_ROOT.position[0] * recoveryBlend + 0.12 * recoveryLift);
    output.rootPositionY = cleanZero(RECOVERY_HOLD_ROOT.position[1] * recoveryBlend + 0.35 * recoveryLift);
    output.rootPositionZ = cleanZero(RECOVERY_HOLD_ROOT.position[2] * recoveryBlend + 0.1 * recoveryLift);
    output.rootRotationX = cleanZero(RECOVERY_HOLD_ROOT.rotation[0] * recoveryBlend - 0.04 * recoveryLift);
    output.rootRotationY = cleanZero(RECOVERY_HOLD_ROOT.rotation[1] * recoveryBlend);
    output.rootRotationZ = cleanZero(RECOVERY_HOLD_ROOT.rotation[2] * recoveryBlend - 0.14 * recoveryLift);
    output.landingCompression = 0;
    output.frontSuspensionCompression = 0;
    output.rearSuspensionCompression = 0;
    writeRecoveryRotation(output.rig.torso, RECOVERY_HOLD_POSE.torso, recoveryBlend, RECOVERY_POSE.torso, recoveryLift);
    writeRecoveryRotation(output.rig.head, RECOVERY_HOLD_POSE.head, recoveryBlend, RECOVERY_POSE.head, recoveryLift);
    writeRecoveryRotation(output.rig.leftArm, RECOVERY_HOLD_POSE.leftArm, recoveryBlend, RECOVERY_POSE.leftArm, recoveryLift);
    writeRecoveryRotation(output.rig.rightArm, RECOVERY_HOLD_POSE.rightArm, recoveryBlend, RECOVERY_POSE.rightArm, recoveryLift);
    writeRecoveryRotation(output.rig.leftLeg, RECOVERY_HOLD_POSE.leftLeg, recoveryBlend, RECOVERY_POSE.leftLeg, recoveryLift);
    writeRecoveryRotation(output.rig.rightLeg, RECOVERY_HOLD_POSE.rightLeg, recoveryBlend, RECOVERY_POSE.rightLeg, recoveryLift);
    return output;
  }

  const landingCompression = resolveLandingCompression(
    input.landingAgeSeconds,
    input.lastLanding,
    input.reducedMotion,
  );
  if (input.reducedMotion) {
    output.actionState = "reduced-motion";
    output.rootPositionX = 0;
    output.rootRotationX = 0;
    output.rootRotationY = 0;
    output.rootRotationZ = 0;
    output.rootPositionY = 0;
    output.rootPositionZ = 0;
    output.landingCompression = 0;
    output.frontSuspensionCompression = 0;
    output.rearSuspensionCompression = 0;
    writeScaledRotation(output.rig.torso, CRASH_POSE.torso, 0);
    writeScaledRotation(output.rig.head, CRASH_POSE.head, 0);
    writeScaledRotation(output.rig.leftArm, CRASH_POSE.leftArm, 0);
    writeScaledRotation(output.rig.rightArm, CRASH_POSE.rightArm, 0);
    writeScaledRotation(output.rig.leftLeg, CRASH_POSE.leftLeg, 0);
    writeScaledRotation(output.rig.rightLeg, CRASH_POSE.rightLeg, 0);
    return output;
  }

  const speedFactor = clamp(input.speed / 22, 0, 1);
  const speedTuck = speedFactor === 0
    ? 0
    : resolveRiderSpeedTuck(input.speed, false, false);
  const pitchPose = clamp(input.pitch, -0.65, 0.65);
  const leanPose = clamp(input.lean, -RIDER_STEERING_ROLL, RIDER_STEERING_ROLL);
  const groundedCadence = input.phase === "grounded"
    ? Math.sin(input.progress * 2.7) * 0.018 * speedFactor
    : 0;
  const wheelieFactor = input.wheelie && input.phase === "grounded"
    ? clamp(input.pitch / 0.28, 0.55, 1)
    : 0;
  const airborneFactor = input.phase === "airborne"
    ? Math.max(0.35, clamp(input.height / 1.2, 0, 1))
    : 0;

  let torsoPitch = speedTuck * 4.15;
  let headPitch = -torsoPitch * 0.58;
  let armPitch = -torsoPitch * 0.72;
  let legPitch = speedFactor * 0.04;
  let rootRotationX = speedTuck * 0.62;

  if (wheelieFactor > 0) {
    rootRotationX -= wheelieFactor * 0.035;
    torsoPitch -= wheelieFactor * 0.15;
    headPitch += wheelieFactor * 0.085;
    armPitch += wheelieFactor * 0.1;
    legPitch += wheelieFactor * 0.075;
  }

  if (airborneFactor > 0) {
    rootRotationX -= pitchPose * 0.04 * airborneFactor;
    torsoPitch -= pitchPose * 0.3 * airborneFactor;
    headPitch += pitchPose * 0.24 * airborneFactor;
    armPitch = -torsoPitch * 0.72 - pitchPose * 0.18 * airborneFactor;
    legPitch += airborneFactor * (0.11 + pitchPose * 0.18);
  }

  if (landingCompression > 0) {
    rootRotationX -= landingCompression * 0.08;
    torsoPitch -= landingCompression * 0.25;
    headPitch += landingCompression * 0.14;
    armPitch += landingCompression * 0.16;
    legPitch += landingCompression * 0.34;
  }

  let actionState: RiderActionState = "neutral";
  if (landingCompression > 0.01) actionState = "landing";
  else if (input.phase === "airborne") {
    actionState = pitchPose > 0.12
      ? "airborne-up"
      : pitchPose < -0.12
        ? "airborne-down"
        : "airborne-neutral";
  } else if (wheelieFactor > 0) actionState = "wheelie";
  else if (leanPose > 0.04) actionState = "lean-left";
  else if (leanPose < -0.04) actionState = "lean-right";
  else if (speedFactor > 0.08) actionState = "tuck";

  output.actionState = actionState;
  output.rootPositionX = 0;
  output.rootRotationX = cleanZero(rootRotationX);
  output.rootRotationY = 0;
  output.rootRotationZ = 0;
  output.rootPositionY = cleanZero(-landingCompression * 0.22
    + groundedCadence * 0.75 * (1 - landingCompression));
  output.rootPositionZ = cleanZero(wheelieFactor * 0.12 - landingCompression * 0.22);
  output.landingCompression = landingCompression;
  output.frontSuspensionCompression = landingCompression * 0.15;
  output.rearSuspensionCompression = landingCompression * 0.04;
  output.rig.torso[0] = cleanZero(torsoPitch);
  output.rig.torso[1] = 0;
  output.rig.torso[2] = cleanZero(leanPose * 0.72);
  output.rig.head[0] = cleanZero(headPitch);
  output.rig.head[1] = 0;
  output.rig.head[2] = cleanZero(-leanPose * 0.42);
  output.rig.leftArm[0] = cleanZero(armPitch - groundedCadence);
  output.rig.leftArm[1] = 0;
  output.rig.leftArm[2] = cleanZero(leanPose * 0.34);
  output.rig.rightArm[0] = cleanZero(armPitch + groundedCadence);
  output.rig.rightArm[1] = 0;
  output.rig.rightArm[2] = cleanZero(leanPose * 0.34);
  output.rig.leftLeg[0] = cleanZero(legPitch + groundedCadence);
  output.rig.leftLeg[1] = 0;
  output.rig.leftLeg[2] = cleanZero(leanPose * 0.4);
  output.rig.rightLeg[0] = cleanZero(legPitch - groundedCadence);
  output.rig.rightLeg[1] = 0;
  output.rig.rightLeg[2] = cleanZero(leanPose * 0.4);
  return output;
}

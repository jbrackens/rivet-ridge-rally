import type { BikePhase, CrashCause } from "../simulation";

/*
 * Presentation-only crash tumble. The fixed-step simulation decides that a
 * crash happens, its cause, where the bike stops, and when recovery begins.
 * This module only animates the rider thrown clear and the bike sliding onto
 * its side from the crash-moment scalars, then hands both back to the static
 * crash pose while Recover is held. It runs on render time, in plain numbers,
 * and nothing it computes feeds simulation, AI, timing, collision, or replay.
 *
 * Positions are metres in the course frame: `forward` and `lateral` measure
 * each body's travel from where it sat when the crash began, and `height`
 * measures its centre above the riding surface.
 */

export const CRASH_RAGDOLL_STEP_SECONDS = 1 / 120;
/** The bike settles on the same side the static crash pose leans to. */
export const CRASH_RAGDOLL_BIKE_LYING_ROLL = -1.38;

const MAX_ADVANCE_SECONDS = 0.1;
const MAX_ENTRY_SPEED = 22;
const GRAVITY = 15;
const RIDER_RESTITUTION = 0.3;
const RIDER_SLIDE_FRICTION = 0.55;
const BIKE_SLIDE_FRICTION = 0.72;
const BIKE_ROLLING_DECELERATION = 3;
const BOUNCE_SPEED = 1;
const MAX_BOUNCES = 3;
const SETTLE_SPEED = 1.1;
const SPRAWL_SECONDS = 0.3;

export type CrashRagdollRotation = [number, number, number];

export interface CrashRagdollLimbs {
  torso: CrashRagdollRotation;
  head: CrashRagdollRotation;
  leftArm: CrashRagdollRotation;
  rightArm: CrashRagdollRotation;
  leftLeg: CrashRagdollRotation;
  rightLeg: CrashRagdollRotation;
}

type LimbName = keyof CrashRagdollLimbs;

/** Half extents in metres, measured in the course frame while seated. */
export interface CrashRagdollBodyShape {
  readonly halfWidth: number;
  readonly halfHeight: number;
  readonly halfLength: number;
}

export interface CrashRagdollLaunch {
  readonly cause: CrashCause | null;
  /** Speed carried into the crash; the simulation zeroes it on impact. */
  readonly entrySpeed: number;
  /** Bike pitch at the crash; only a nose-up landing changes the throw. */
  readonly entryPitch: number;
  readonly riderRestHeight: number;
  readonly rider: CrashRagdollBodyShape;
  readonly bikeRestHeight: number;
  readonly bike: CrashRagdollBodyShape;
  readonly seed: number;
}

export interface CrashRagdollBody {
  forward: number;
  lateral: number;
  height: number;
  pitch: number;
  yaw: number;
  roll: number;
  forwardVelocity: number;
  lateralVelocity: number;
  verticalVelocity: number;
  pitchRate: number;
  yawRate: number;
  rollRate: number;
}

export interface CrashRagdollState {
  readonly launch: CrashRagdollLaunch;
  readonly rider: CrashRagdollBody;
  readonly bike: CrashRagdollBody;
  readonly limbs: CrashRagdollLimbs;
  elapsedSeconds: number;
  accumulatorSeconds: number;
  /** In rolling contact: the rider's lowest point stays on the surface. */
  riderGrounded: boolean;
  riderImpacts: number;
  flail: number;
  /** Wheel spin in radians per second, coasting down from the entry speed. */
  wheelSpinRate: number;
  settled: boolean;
}

const LIMB_NAMES: readonly LimbName[] = [
  "torso",
  "head",
  "leftArm",
  "rightArm",
  "leftLeg",
  "rightLeg",
];

const SPRAWL_POSE: Readonly<Record<LimbName, readonly [number, number, number]>> = {
  torso: [0.25, 0.15, 0.32],
  head: [0.35, -0.3, 0.25],
  leftArm: [1.05, -0.25, 0.7],
  rightArm: [-0.55, 0.3, -0.85],
  leftLeg: [-0.7, 0.15, 0.35],
  rightLeg: [0.5, -0.15, -0.4],
};

const FLAIL_AMPLITUDE: Readonly<Record<LimbName, readonly [number, number, number]>> = {
  torso: [0.22, 0.12, 0.18],
  head: [0.3, 0.25, 0.15],
  leftArm: [0.75, 0.3, 0.6],
  rightArm: [0.7, 0.3, 0.65],
  leftLeg: [0.5, 0.15, 0.3],
  rightLeg: [0.55, 0.15, 0.3],
};

const FLAIL_FREQUENCY: Readonly<Record<LimbName, number>> = {
  torso: 7.5,
  head: 9,
  leftArm: 11.5,
  rightArm: 12.5,
  leftLeg: 8.5,
  rightLeg: 10,
};

interface LaunchKick {
  readonly riderForward: number;
  readonly riderUp: number;
  readonly riderPitchRate: number;
  /** Throw toward +lateral: off the high side, clear of where the bike lies. */
  readonly riderLateral: number;
  readonly bikeForward: number;
  readonly bikePitchRate: number;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function finiteOr(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

function smoothstep(value: number): number {
  const normalized = clamp(value, 0, 1);
  return normalized * normalized * (3 - 2 * normalized);
}

function cleanZero(value: number): number {
  return Math.abs(value) < 1e-12 ? 0 : value;
}

/** Deterministic value in [0, 1) so the same crash tumbles the same way. */
function seeded(seed: number, salt: number): number {
  const value = Math.sin(seed * 12.9898 + salt * 78.233) * 43_758.5453;
  return value - Math.floor(value);
}

function signedSeeded(seed: number, salt: number): number {
  return seeded(seed, salt) * 2 - 1;
}

function resolveLaunchKick(cause: CrashCause | null, speed: number, pitch: number): LaunchKick {
  if (cause === "obstacle") {
    // The barrier stops the bike; the rider goes over the bars.
    return {
      riderForward: Math.min(speed * 0.38, 6.5),
      riderUp: 2.6 + speed * 0.05,
      riderPitchRate: -(3.8 + speed * 0.12),
      riderLateral: 0.7 + speed * 0.04,
      bikeForward: speed * 0.1,
      bikePitchRate: -(1.5 + speed * 0.06),
    };
  }
  if (cause === "wheelie-timeout" || (cause === "landing" && pitch > 0.2)) {
    // The bike loops out underneath and the rider falls off the back.
    return {
      riderForward: speed * 0.05,
      riderUp: 2.2,
      riderPitchRate: 3.2 + speed * 0.06,
      riderLateral: 2.2 + speed * 0.04,
      bikeForward: speed * 0.25,
      bikePitchRate: 2.4,
    };
  }
  if (cause === "landing") {
    return {
      riderForward: Math.min(speed * 0.36, 6),
      riderUp: 2.3 + speed * 0.04,
      riderPitchRate: -(3.4 + speed * 0.1),
      riderLateral: 0.6 + speed * 0.04,
      bikeForward: Math.min(speed * 0.3, 5),
      bikePitchRate: -1.8,
    };
  }
  // Rider contact and other external impacts knock the rider further sideways.
  return {
    riderForward: Math.min(speed * 0.34, 5.8),
    riderUp: 2 + speed * 0.04,
    riderPitchRate: -(3 + speed * 0.1),
    riderLateral: 0.9 + speed * 0.05,
    bikeForward: Math.min(speed * 0.3, 5),
    bikePitchRate: -0.8,
  };
}

/** Height of a body's lowest point below its centre for this orientation. */
export function crashRagdollSupportHeight(
  shape: CrashRagdollBodyShape,
  pitch: number,
  roll: number,
): number {
  const cosPitch = Math.cos(pitch);
  return shape.halfWidth * Math.abs(cosPitch * Math.sin(roll))
    + shape.halfHeight * Math.abs(cosPitch * Math.cos(roll))
    + shape.halfLength * Math.abs(Math.sin(pitch));
}

function nearestLyingPitch(pitch: number): number {
  return Math.PI / 2 + Math.round((pitch - Math.PI / 2) / Math.PI) * Math.PI;
}

function createBody(height: number): CrashRagdollBody {
  return {
    forward: 0,
    lateral: 0,
    height,
    pitch: 0,
    yaw: 0,
    roll: 0,
    forwardVelocity: 0,
    lateralVelocity: 0,
    verticalVelocity: 0,
    pitchRate: 0,
    yawRate: 0,
    rollRate: 0,
  };
}

function reduceHorizontalSpeed(body: CrashRagdollBody, deceleration: number, dt: number): number {
  const speed = Math.hypot(body.forwardVelocity, body.lateralVelocity);
  if (speed <= 0) return 0;
  const reduced = Math.max(0, speed - deceleration * dt);
  const scale = reduced / speed;
  body.forwardVelocity *= scale;
  body.lateralVelocity *= scale;
  return reduced;
}

export function createCrashRagdoll(launch: CrashRagdollLaunch): CrashRagdollState {
  const speed = clamp(finiteOr(launch.entrySpeed, 0), 0, MAX_ENTRY_SPEED);
  const pitch = clamp(finiteOr(launch.entryPitch, 0), -0.9, 0.9);
  const seed = finiteOr(launch.seed, 0);
  const kick = resolveLaunchKick(launch.cause, speed, pitch);

  const rider = createBody(Math.max(0, finiteOr(launch.riderRestHeight, 0)));
  rider.forwardVelocity = kick.riderForward;
  rider.lateralVelocity = kick.riderLateral * (0.8 + seeded(seed, 1) * 0.4);
  rider.verticalVelocity = kick.riderUp;
  rider.pitchRate = kick.riderPitchRate * (0.85 + seeded(seed, 3) * 0.3);
  rider.yawRate = signedSeeded(seed, 4) * 2.4;
  rider.rollRate = signedSeeded(seed, 5) * 3.2;

  const bike = createBody(Math.max(0, finiteOr(launch.bikeRestHeight, 0)));
  bike.forwardVelocity = kick.bikeForward;
  bike.lateralVelocity = signedSeeded(seed, 6) * 0.4;
  bike.pitchRate = kick.bikePitchRate;
  bike.yawRate = signedSeeded(seed, 7) * (0.5 + speed * 0.05);
  bike.rollRate = -(1.1 + speed * 0.04);

  return {
    launch: { ...launch, entrySpeed: speed, entryPitch: pitch, seed },
    rider,
    bike,
    limbs: {
      torso: [0, 0, 0],
      head: [0, 0, 0],
      leftArm: [0, 0, 0],
      rightArm: [0, 0, 0],
      leftLeg: [0, 0, 0],
      rightLeg: [0, 0, 0],
    },
    elapsedSeconds: 0,
    accumulatorSeconds: 0,
    riderGrounded: false,
    riderImpacts: 0,
    flail: 1,
    wheelSpinRate: speed * 1.7,
    settled: false,
  };
}

function stepRider(state: CrashRagdollState, dt: number): void {
  const rider = state.rider;
  const shape = state.launch.rider;
  rider.verticalVelocity -= GRAVITY * dt;
  rider.forward += rider.forwardVelocity * dt;
  rider.lateral += rider.lateralVelocity * dt;
  rider.height += rider.verticalVelocity * dt;
  rider.pitch += rider.pitchRate * dt;
  rider.yaw += rider.yawRate * dt;
  rider.roll += rider.rollRate * dt;

  const clearance = crashRagdollSupportHeight(shape, rider.pitch, rider.roll);
  if (!state.riderGrounded) {
    if (rider.height > clearance) return;
    rider.height = clearance;
    if (rider.verticalVelocity < -BOUNCE_SPEED && state.riderImpacts < MAX_BOUNCES) {
      const impactSpeed = -rider.verticalVelocity;
      rider.verticalVelocity = impactSpeed * RIDER_RESTITUTION;
      rider.pitchRate *= 0.6;
      rider.rollRate *= 0.55;
      rider.yawRate *= 0.7;
      state.flail = Math.min(1.2, state.flail + impactSpeed / 8);
      state.riderImpacts += 1;
    } else {
      state.riderGrounded = true;
    }
  }
  if (state.riderGrounded) {
    // Rolling over its own corners: follow the surface rather than hopping,
    // so tumbling along the ground adds no energy.
    rider.height = clearance;
    rider.verticalVelocity = 0;
  }

  const slideSpeed = reduceHorizontalSpeed(rider, RIDER_SLIDE_FRICTION * GRAVITY, dt);
  const spinDamping = Math.exp(-3 * dt);
  rider.rollRate *= spinDamping;
  rider.yawRate *= spinDamping;
  if (!state.riderGrounded) return;
  if (slideSpeed >= SETTLE_SPEED) {
    // Tumble end over end while sliding down the course.
    const tumbleRate = -rider.forwardVelocity / Math.max(0.3, clearance + 0.25);
    rider.pitchRate += (tumbleRate - rider.pitchRate) * Math.min(1, 5 * dt);
  } else {
    // Then fall flat, face down or face up, whichever is nearer.
    const lyingPitch = nearestLyingPitch(rider.pitch);
    rider.pitchRate += ((lyingPitch - rider.pitch) * 30 - rider.pitchRate * 8) * dt;
  }
}

function stepBike(state: CrashRagdollState, dt: number): void {
  const bike = state.bike;
  const shape = state.launch.bike;

  // Topple like an inverted pendulum until the bars and pegs catch it.
  if (bike.roll > CRASH_RAGDOLL_BIKE_LYING_ROLL) {
    const toppleRate = GRAVITY / Math.max(0.4, shape.halfHeight);
    bike.rollRate -= toppleRate * Math.sin(Math.abs(bike.roll) + 0.12) * dt;
  }
  bike.roll += bike.rollRate * dt;
  if (bike.roll <= CRASH_RAGDOLL_BIKE_LYING_ROLL) {
    bike.roll = CRASH_RAGDOLL_BIKE_LYING_ROLL;
    bike.rollRate = bike.rollRate < -1.5 ? -bike.rollRate * 0.22 : 0;
  }

  bike.pitchRate += (-40 * bike.pitch - 7 * bike.pitchRate) * dt;
  bike.pitch += bike.pitchRate * dt;

  const onSide = Math.abs(bike.roll) > 0.7;
  reduceHorizontalSpeed(
    bike,
    onSide ? BIKE_SLIDE_FRICTION * GRAVITY : BIKE_ROLLING_DECELERATION,
    dt,
  );
  if (onSide) bike.yawRate *= Math.exp(-2.5 * dt);
  bike.forward += bike.forwardVelocity * dt;
  bike.lateral += bike.lateralVelocity * dt;
  bike.yaw += bike.yawRate * dt;
  bike.height = state.launch.bikeRestHeight
    + crashRagdollSupportHeight(shape, bike.pitch, bike.roll)
    - crashRagdollSupportHeight(shape, 0, 0);

  state.wheelSpinRate *= Math.exp(-1.2 * dt);
}

function writeLimbs(state: CrashRagdollState): void {
  const sprawl = smoothstep(state.elapsedSeconds / SPRAWL_SECONDS);
  for (const [limbIndex, name] of LIMB_NAMES.entries()) {
    const target = state.limbs[name];
    const pose = SPRAWL_POSE[name];
    const amplitude = FLAIL_AMPLITUDE[name];
    const frequency = FLAIL_FREQUENCY[name];
    for (let axis = 0; axis < 3; axis += 1) {
      const phase = seeded(state.launch.seed, 10 + limbIndex * 3 + axis) * Math.PI * 2;
      const flail = (amplitude[axis] ?? 0) * state.flail
        * Math.sin(frequency * state.elapsedSeconds + phase);
      target[axis] = cleanZero((pose[axis] ?? 0) * sprawl + flail);
    }
  }
}

function isSettled(state: CrashRagdollState): boolean {
  const { rider, bike } = state;
  const riderClearance = crashRagdollSupportHeight(state.launch.rider, rider.pitch, rider.roll);
  return rider.height <= riderClearance + 1e-6
    && Math.hypot(rider.forwardVelocity, rider.lateralVelocity) < 0.05
    && Math.abs(rider.verticalVelocity) < 0.05
    && Math.abs(rider.pitchRate) < 0.2
    && Math.hypot(bike.forwardVelocity, bike.lateralVelocity) < 0.05
    && bike.roll <= CRASH_RAGDOLL_BIKE_LYING_ROLL + 1e-6
    && Math.abs(bike.rollRate) < 0.05;
}

/** Advances the tumble in fixed sub-steps so equal elapsed time gives equal poses. */
export function advanceCrashRagdoll(state: CrashRagdollState, deltaSeconds: number): void {
  const elapsed = Number.isFinite(deltaSeconds)
    ? clamp(deltaSeconds, 0, MAX_ADVANCE_SECONDS)
    : 0;
  state.accumulatorSeconds += elapsed;
  const epsilon = CRASH_RAGDOLL_STEP_SECONDS * 1e-6;
  while (state.accumulatorSeconds + epsilon >= CRASH_RAGDOLL_STEP_SECONDS) {
    stepRider(state, CRASH_RAGDOLL_STEP_SECONDS);
    stepBike(state, CRASH_RAGDOLL_STEP_SECONDS);
    state.flail *= Math.exp(-2.4 * CRASH_RAGDOLL_STEP_SECONDS);
    state.elapsedSeconds += CRASH_RAGDOLL_STEP_SECONDS;
    state.accumulatorSeconds = Math.max(0, state.accumulatorSeconds - CRASH_RAGDOLL_STEP_SECONDS);
  }
  writeLimbs(state);
  state.settled = isSettled(state);
}

/**
 * How much of the tumble is shown: all of it while the rider lies crashed,
 * handing back to the static crash-and-recover pose as Recover is held so the
 * pose is exactly static when the simulation begins recovering. Reduced Motion
 * keeps the static crash silhouette throughout.
 */
export function resolveCrashRagdollWeight(
  phase: BikePhase,
  presentationRecoveryProgress: number,
  reducedMotion: boolean,
): number {
  if (phase !== "crashed" || reducedMotion) return 0;
  const progress = clamp(finiteOr(presentationRecoveryProgress, 0), 0, 1);
  return cleanZero(1 - smoothstep((progress - 0.15) / 0.85));
}

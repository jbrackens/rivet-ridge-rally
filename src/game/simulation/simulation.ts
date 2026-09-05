import {
  DIRT_ENVIRONMENT,
  FIXED_DT,
  LANE_POSITIONS,
  NEUTRAL_INPUT,
  type BikeState,
  type CrashCause,
  type LaneChange,
  type LaneIndex,
  type RaceState,
  type SimulationEnvironment,
  type SimulationInput,
  type SimulationOptions,
  type SimulationState,
  type SurfaceKind,
} from "./types";

export const BIKE_PERFORMANCE_LIMITS = Object.freeze({
  standardSpeed: 14,
  turboSpeed: 20,
  standardAcceleration: 18,
  turboAcceleration: 23,
});

const PHYSICS = Object.freeze({
  standardSpeed: BIKE_PERFORMANCE_LIMITS.standardSpeed,
  turboSpeed: BIKE_PERFORMANCE_LIMITS.turboSpeed,
  acceleration: BIKE_PERFORMANCE_LIMITS.standardAcceleration,
  turboAcceleration: BIKE_PERFORMANCE_LIMITS.turboAcceleration,
  coastDeceleration: 10,
  surfaceDeceleration: 24,
  laneTransitionSpeed: 12,
  standardHeatPerSecond: 8,
  standardHeatCeiling: 62,
  turboHeatPerSecond: 8,
  turboWarningHeat: 78,
  turboCriticalHeatPerSecond: 4,
  passiveCoolingPerSecond: 14,
  overheatCoolingPerSecond: 20,
  coolingZonePerSecond: 80,
  coolingZoneEntryDrop: 18,
  maximumHeat: 100,
  overheatRecoveryHeat: 35,
  gravity: 9.8,
  defaultRampImpulse: 8,
  minimumRampSpeed: 4,
  airPitchSpeed: 1.8,
  airPitchReturnSpeed: 0.9,
  groundPitchSpeed: 2.4,
  maximumGroundPitch: 0.62,
  wheeliePitch: 0.28,
  wheelieCrashSeconds: 1.4,
  cleanLandingPitch: 0.38,
  crashLandingPitch: 0.78,
  crashRecoveryHoldSeconds: 0.75,
  recoveryAnimationSeconds: 0.45,
});

const SURFACE_SPEED: Readonly<Record<SurfaceKind, number>> = Object.freeze({
  dirt: 1,
  grass: 0.62,
  mud: 0.46,
  cooling: 1,
  ramp: 0.96,
});

const ACCUMULATOR_EPSILON = FIXED_DT * 1e-9;
const INITIAL_LANE: LaneIndex = 1;

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function approach(value: number, target: number, maximumDelta: number): number {
  if (value < target) {
    return Math.min(value + maximumDelta, target);
  }
  return Math.max(value - maximumDelta, target);
}

function toLaneIndex(value: number): LaneIndex {
  return clamp(Math.round(value), 0, LANE_POSITIONS.length - 1) as LaneIndex;
}

function createBikeState(
  initialHeat: number,
  initialLane: LaneIndex,
  initialForwardPosition: number,
): BikeState {
  return {
    forwardPosition: initialForwardPosition,
    lane: initialLane,
    lanePosition: LANE_POSITIONS[initialLane],
    speed: 0,
    heat: initialHeat,
    overheated: false,
    phase: "grounded",
    height: 0,
    verticalVelocity: 0,
    pitch: 0,
    wheelie: false,
    recoveryProgress: 0,
    lastLanding: null,
    crashCause: null,
    surface: "dirt",
  };
}

function createRaceState(checkpointCount: number, totalLaps: number): RaceState {
  return {
    lap: 1,
    totalLaps,
    checkpointCount,
    nextCheckpoint: 0,
    elapsedSeconds: 0,
    lapElapsedSeconds: 0,
    lapTimes: [],
    splitTimes: [],
    finished: false,
  };
}

/**
 * Deterministic arcade-bike simulation. Rendering and track collision detection
 * are deliberately external; this class only consumes their surface samples and
 * ordered checkpoint events.
 */
export class RaceSimulation {
  private readonly checkpointCount: number;
  private readonly totalLaps: number;
  private readonly initialHeat: number;
  private readonly initialLane: LaneIndex;
  private readonly initialForwardPosition: number;
  private retroRecovery: boolean;
  private readonly wheelieCrashSeconds: number;
  private stateValue: SimulationState;
  private accumulatorSeconds = 0;
  private laneLatch: LaneChange = 0;
  private previousSurface: SurfaceKind = "dirt";
  private wheelieSeconds = 0;
  private recoverLatch = false;

  constructor(options: SimulationOptions = {}) {
    const checkpointCount = options.checkpointCount ?? 3;
    const totalLaps = options.totalLaps ?? 2;
    if (!Number.isInteger(checkpointCount) || checkpointCount < 1) {
      throw new RangeError("checkpointCount must be a positive integer");
    }
    if (!Number.isInteger(totalLaps) || totalLaps < 1 || totalLaps > 9) {
      throw new RangeError("totalLaps must be an integer from one through nine");
    }

    this.checkpointCount = checkpointCount;
    this.totalLaps = totalLaps;
    this.initialHeat = clamp(options.initialHeat ?? 0, 0, PHYSICS.maximumHeat - 1);
    const initialLane = options.initialLane ?? INITIAL_LANE;
    if (!Number.isInteger(initialLane) || initialLane < 0 || initialLane >= LANE_POSITIONS.length) {
      throw new RangeError("initialLane must be a lane from zero through three");
    }
    const initialForwardPosition = options.initialForwardPosition ?? 0;
    if (!Number.isFinite(initialForwardPosition)) {
      throw new RangeError("initialForwardPosition must be finite");
    }
    this.initialLane = initialLane;
    this.initialForwardPosition = initialForwardPosition;
    this.retroRecovery = options.retroRecovery ?? false;
    const wheelieCrashSeconds = options.wheelieCrashSeconds ?? PHYSICS.wheelieCrashSeconds;
    if (!Number.isFinite(wheelieCrashSeconds) || wheelieCrashSeconds <= 0) {
      throw new RangeError("wheelieCrashSeconds must be a positive finite number");
    }
    this.wheelieCrashSeconds = wheelieCrashSeconds;
    this.stateValue = this.createInitialState();
  }

  get snapshot(): SimulationState {
    return {
      stepCount: this.stateValue.stepCount,
      timeSeconds: this.stateValue.timeSeconds,
      bike: { ...this.stateValue.bike },
      race: {
        ...this.stateValue.race,
        lapTimes: [...this.stateValue.race.lapTimes],
        splitTimes: [...this.stateValue.race.splitTimes],
      },
    };
  }

  /** Fraction of a fixed step left over for render interpolation. */
  get interpolationAlpha(): number {
    return this.accumulatorSeconds / FIXED_DT;
  }

  setRetroRecovery(enabled: boolean): void {
    this.retroRecovery = enabled;
    if (!enabled) this.recoverLatch = false;
  }

  reset(): void {
    this.stateValue = this.createInitialState();
    this.accumulatorSeconds = 0;
    this.laneLatch = 0;
    this.previousSurface = "dirt";
    this.wheelieSeconds = 0;
    this.recoverLatch = false;
  }

  /**
   * Advances real time through zero or more fixed 60 Hz steps and returns the
   * number of simulated steps. Input and environment are held for those steps.
   */
  advance(
    deltaSeconds: number,
    input: SimulationInput = NEUTRAL_INPUT,
    environment: SimulationEnvironment = DIRT_ENVIRONMENT,
  ): number {
    if (!Number.isFinite(deltaSeconds) || deltaSeconds < 0) {
      throw new RangeError("deltaSeconds must be a finite non-negative number");
    }

    this.accumulatorSeconds += deltaSeconds;
    let stepCount = 0;

    while (this.accumulatorSeconds + ACCUMULATOR_EPSILON >= FIXED_DT) {
      this.fixedStep(input, environment);
      this.accumulatorSeconds -= FIXED_DT;
      if (this.accumulatorSeconds < 0 && this.accumulatorSeconds > -ACCUMULATOR_EPSILON) {
        this.accumulatorSeconds = 0;
      }
      stepCount += 1;
    }

    return stepCount;
  }

  /** Accepts only the next ordered checkpoint for the current lap. */
  markCheckpoint(index: number): boolean {
    const race = this.stateValue.race;
    if (race.finished || index !== race.nextCheckpoint || index >= race.checkpointCount) {
      return false;
    }

    race.nextCheckpoint += 1;
    race.splitTimes.push(race.elapsedSeconds);
    return true;
  }

  /** Applies a one-shot fair slowdown for bumps and soft collision responses. */
  applySpeedPenalty(retainedSpeed: number): void {
    if (!Number.isFinite(retainedSpeed) || retainedSpeed < 0 || retainedSpeed > 1) {
      throw new RangeError("retainedSpeed must be between zero and one");
    }
    const bike = this.stateValue.bike;
    if (bike.phase === "crashed" || bike.phase === "recovering") return;
    bike.speed *= retainedSpeed;
  }

  /** Completes a lap only after every ordered checkpoint has been marked. */
  crossFinishLine(): boolean {
    const race = this.stateValue.race;
    if (race.finished || race.nextCheckpoint !== race.checkpointCount) {
      return false;
    }

    race.lapTimes.push(race.lapElapsedSeconds);
    race.nextCheckpoint = 0;

    if (race.lap === race.totalLaps) {
      race.finished = true;
    } else {
      race.lap += 1;
      race.lapElapsedSeconds = 0;
    }

    return true;
  }

  /** Collision systems can use this for rider or obstacle impacts. */
  forceCrash(cause: CrashCause = "external"): void {
    const bike = this.stateValue.bike;
    if (bike.phase === "crashed" || bike.phase === "recovering") {
      return;
    }

    bike.phase = "crashed";
    bike.crashCause = cause;
    bike.speed = 0;
    bike.height = 0;
    bike.verticalVelocity = 0;
    bike.wheelie = false;
    bike.recoveryProgress = 0;
    this.wheelieSeconds = 0;
  }

  /** Repositions a crashed rider after collision separation without bypassing bike state. */
  relocate(forwardPosition: number): void {
    if (!Number.isFinite(forwardPosition)) {
      throw new RangeError("forwardPosition must be finite");
    }
    this.stateValue.bike.forwardPosition = forwardPosition;
  }

  private createInitialState(): SimulationState {
    return {
      stepCount: 0,
      timeSeconds: 0,
      bike: createBikeState(
        this.initialHeat,
        this.initialLane,
        this.initialForwardPosition,
      ),
      race: createRaceState(this.checkpointCount, this.totalLaps),
    };
  }

  private fixedStep(input: SimulationInput, environment: SimulationEnvironment): void {
    const state = this.stateValue;
    const bike = state.bike;
    const surface = environment.surface;

    state.stepCount += 1;
    state.timeSeconds = state.stepCount * FIXED_DT;
    bike.surface = surface;

    if (!state.race.finished) {
      state.race.elapsedSeconds += FIXED_DT;
      state.race.lapElapsedSeconds += FIXED_DT;
    }

    this.updateHeat(input, surface);

    const hasControl =
      !bike.overheated && bike.phase !== "crashed" && bike.phase !== "recovering";
    this.updateLane(input.laneChange, hasControl);

    if (this.updateCrashRecovery(input)) {
      this.previousSurface = surface;
      return;
    }

    if (bike.phase === "grounded") {
      this.updateGroundSpeed(input, surface, hasControl);
      this.updateGroundPitch(input.pitch, hasControl);

      if (
        bike.phase === "grounded" &&
        surface === "ramp" &&
        this.previousSurface !== "ramp" &&
        bike.speed >= PHYSICS.minimumRampSpeed
      ) {
        this.launch(environment.rampImpulse);
      }
    } else {
      this.updateAirborne(input.pitch, hasControl);
    }

    if (bike.phase !== "crashed" && bike.phase !== "recovering") {
      bike.forwardPosition += bike.speed * FIXED_DT;
    }

    this.previousSurface = surface;
  }

  private updateHeat(input: SimulationInput, surface: SurfaceKind): void {
    const bike = this.stateValue.bike;
    const canUseTurbo =
      !bike.overheated && bike.phase !== "crashed" && bike.phase !== "recovering";

    if (input.turbo && canUseTurbo) {
      const turboHeatRate = bike.heat >= PHYSICS.turboWarningHeat
        ? PHYSICS.turboCriticalHeatPerSecond
        : PHYSICS.turboHeatPerSecond;
      bike.heat += turboHeatRate * FIXED_DT;
    } else if (input.throttle && canUseTurbo && surface !== "cooling") {
      const standardHeatRate = bike.heat < PHYSICS.standardHeatCeiling
        ? PHYSICS.standardHeatPerSecond
        : PHYSICS.passiveCoolingPerSecond;
      bike.heat = approach(
        bike.heat,
        PHYSICS.standardHeatCeiling,
        standardHeatRate * FIXED_DT,
      );
    } else {
      const coolingRate = bike.overheated
        ? PHYSICS.overheatCoolingPerSecond
        : PHYSICS.passiveCoolingPerSecond;
      bike.heat -= coolingRate * FIXED_DT;
    }

    if (surface === "cooling") {
      if (this.previousSurface !== "cooling") {
        bike.heat -= PHYSICS.coolingZoneEntryDrop;
      }
      bike.heat -= PHYSICS.coolingZonePerSecond * FIXED_DT;
    }

    bike.heat = clamp(bike.heat, 0, PHYSICS.maximumHeat);

    if (!bike.overheated && bike.heat >= PHYSICS.maximumHeat) {
      bike.overheated = true;
    } else if (bike.overheated && bike.heat <= PHYSICS.overheatRecoveryHeat) {
      bike.overheated = false;
    }
  }

  private updateCrashRecovery(input: SimulationInput): boolean {
    const bike = this.stateValue.bike;

    if (bike.phase === "crashed") {
      if (input.recover) {
        bike.recoveryProgress += FIXED_DT / PHYSICS.crashRecoveryHoldSeconds;
        if (this.retroRecovery && !this.recoverLatch) {
          bike.recoveryProgress += 0.16;
        }
        this.recoverLatch = true;
      } else if (this.retroRecovery) {
        bike.recoveryProgress = Math.max(0, bike.recoveryProgress - FIXED_DT * 0.08);
        this.recoverLatch = false;
      } else {
        bike.recoveryProgress = 0;
        this.recoverLatch = false;
      }

      if (bike.recoveryProgress >= 1) {
        bike.phase = "recovering";
        bike.crashCause = null;
        bike.recoveryProgress = 0;
        this.recoverLatch = false;
      }
      return true;
    }

    if (bike.phase === "recovering") {
      bike.recoveryProgress += FIXED_DT / PHYSICS.recoveryAnimationSeconds;
      if (bike.recoveryProgress >= 1) {
        bike.phase = "grounded";
        bike.recoveryProgress = 0;
        bike.pitch = 0;
        this.recoverLatch = false;
      }
      return true;
    }

    bike.recoveryProgress = 0;
    return false;
  }

  private updateLane(laneChange: LaneChange, hasControl: boolean): void {
    const bike = this.stateValue.bike;
    const requestedChange = laneChange === -1 || laneChange === 1 ? laneChange : 0;

    if (requestedChange === 0) {
      this.laneLatch = 0;
    } else if (requestedChange !== this.laneLatch) {
      if (hasControl) {
        bike.lane = toLaneIndex(bike.lane + requestedChange);
      }
      this.laneLatch = requestedChange;
    }

    if (bike.phase === "grounded" && hasControl) {
      bike.lanePosition = approach(
        bike.lanePosition,
        LANE_POSITIONS[bike.lane],
        PHYSICS.laneTransitionSpeed * FIXED_DT,
      );
    }
  }

  private updateGroundSpeed(
    input: SimulationInput,
    surface: SurfaceKind,
    hasControl: boolean,
  ): void {
    const bike = this.stateValue.bike;
    const turboActive = hasControl && input.turbo;
    const throttleActive = hasControl && (input.throttle || turboActive);
    const topSpeed = turboActive ? PHYSICS.turboSpeed : PHYSICS.standardSpeed;
    const targetSpeed = throttleActive ? topSpeed * SURFACE_SPEED[surface] : 0;
    const acceleration = turboActive ? PHYSICS.turboAcceleration : PHYSICS.acceleration;
    const deceleration = throttleActive
      ? PHYSICS.surfaceDeceleration
      : PHYSICS.coastDeceleration;

    bike.speed = approach(
      bike.speed,
      targetSpeed,
      (targetSpeed > bike.speed ? acceleration : deceleration) * FIXED_DT,
    );
  }

  private updateGroundPitch(pitchInput: number, hasControl: boolean): void {
    const bike = this.stateValue.bike;
    const normalizedPitch = hasControl ? clamp(pitchInput, -1, 1) : 0;
    const canWheelie = bike.speed >= PHYSICS.minimumRampSpeed;
    const targetPitch = canWheelie
      ? normalizedPitch * PHYSICS.maximumGroundPitch
      : Math.min(normalizedPitch, 0) * PHYSICS.maximumGroundPitch;

    bike.pitch = approach(
      bike.pitch,
      targetPitch,
      PHYSICS.groundPitchSpeed * FIXED_DT,
    );
    bike.wheelie = canWheelie && bike.pitch >= PHYSICS.wheeliePitch;

    if (bike.wheelie && normalizedPitch > 0) {
      this.wheelieSeconds += FIXED_DT;
      if (this.wheelieSeconds >= this.wheelieCrashSeconds) {
        this.forceCrash("wheelie-timeout");
      }
    } else {
      this.wheelieSeconds = 0;
    }
  }

  private launch(rampImpulse: number | undefined): void {
    const bike = this.stateValue.bike;
    bike.phase = "airborne";
    bike.height = 0.001;
    bike.verticalVelocity = Math.max(0, rampImpulse ?? PHYSICS.defaultRampImpulse);
    bike.wheelie = false;
    bike.lastLanding = null;
    this.wheelieSeconds = 0;
  }

  private updateAirborne(pitchInput: number, hasControl: boolean): void {
    const bike = this.stateValue.bike;
    const normalizedPitch = hasControl ? clamp(pitchInput, -1, 1) : 0;
    if (hasControl) {
      bike.pitch = normalizedPitch === 0
        ? approach(bike.pitch, 0, PHYSICS.airPitchReturnSpeed * FIXED_DT)
        : clamp(
          bike.pitch + normalizedPitch * PHYSICS.airPitchSpeed * FIXED_DT,
          -Math.PI / 2,
          Math.PI / 2,
        );
      // Pulling back trades a little distance for lift; pushing forward lowers
      // the arc and carries slightly more speed. Landing angle remains decisive.
      bike.verticalVelocity += normalizedPitch * 1.35 * FIXED_DT;
      bike.speed = clamp(
        bike.speed + (normalizedPitch > 0 ? -0.9 : -normalizedPitch * 0.35) * FIXED_DT,
        0,
        PHYSICS.turboSpeed,
      );
    }

    bike.height += bike.verticalVelocity * FIXED_DT;
    bike.verticalVelocity -= PHYSICS.gravity * FIXED_DT;

    if (bike.height <= 0 && bike.verticalVelocity < 0) {
      this.land();
    }
  }

  private land(): void {
    const bike = this.stateValue.bike;
    const landingPitch = Math.abs(bike.pitch);
    bike.height = 0;
    bike.verticalVelocity = 0;
    bike.wheelie = false;

    if (landingPitch <= PHYSICS.cleanLandingPitch) {
      bike.phase = "grounded";
      bike.lastLanding = "clean";
      bike.speed *= 0.98;
      bike.pitch *= 0.2;
    } else if (landingPitch < PHYSICS.crashLandingPitch) {
      bike.phase = "grounded";
      bike.lastLanding = "rough";
      bike.speed *= 0.6;
      bike.pitch *= 0.2;
    } else {
      bike.lastLanding = "crash";
      this.forceCrash("landing");
    }
  }
}

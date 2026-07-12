export const FIXED_HZ = 60;
export const FIXED_DT = 1 / FIXED_HZ;

export const LANE_POSITIONS = [-4.5, -1.5, 1.5, 4.5] as const;

export type LaneIndex = 0 | 1 | 2 | 3;
export type LaneChange = -1 | 0 | 1;

export type SurfaceKind = "dirt" | "grass" | "mud" | "cooling" | "ramp";
export type BikePhase = "grounded" | "airborne" | "crashed" | "recovering";
export type LandingQuality = "clean" | "rough" | "crash" | null;

export interface SimulationInput {
  readonly throttle: boolean;
  readonly turbo: boolean;
  readonly laneChange: LaneChange;
  /** Positive raises the front wheel; negative lowers it. */
  readonly pitch: number;
  readonly recover: boolean;
}

export interface SimulationEnvironment {
  readonly surface: SurfaceKind;
  /** Optional upward launch speed in metres per second. */
  readonly rampImpulse?: number;
}

export interface BikeState {
  forwardPosition: number;
  lane: LaneIndex;
  lanePosition: number;
  speed: number;
  heat: number;
  overheated: boolean;
  phase: BikePhase;
  height: number;
  verticalVelocity: number;
  pitch: number;
  wheelie: boolean;
  recoveryProgress: number;
  lastLanding: LandingQuality;
  surface: SurfaceKind;
}

export interface RaceState {
  lap: number;
  readonly totalLaps: number;
  readonly checkpointCount: number;
  nextCheckpoint: number;
  elapsedSeconds: number;
  lapElapsedSeconds: number;
  lapTimes: number[];
  splitTimes: number[];
  finished: boolean;
}

export interface SimulationState {
  stepCount: number;
  timeSeconds: number;
  bike: BikeState;
  race: RaceState;
}

export interface SimulationOptions {
  /** Number of ordered checkpoints required before each finish-line crossing. */
  readonly checkpointCount?: number;
  /** Race laps, constrained to the editor-supported range of one through nine. */
  readonly totalLaps?: number;
  /** Optional mastery modifier applied before the first fixed step. */
  readonly initialHeat?: number;
  /** Optional race-grid lane for an authoritative rider simulation. */
  readonly initialLane?: LaneIndex;
  /** Optional signed race-grid offset for an authoritative rider simulation. */
  readonly initialForwardPosition?: number;
  /** Lets separate recovery taps accumulate while preserving hold-to-recover. */
  readonly retroRecovery?: boolean;
  /** Optional training allowance before a continuously held wheelie crashes. */
  readonly wheelieCrashSeconds?: number;
}

export const NEUTRAL_INPUT: Readonly<SimulationInput> = Object.freeze({
  throttle: false,
  turbo: false,
  laneChange: 0,
  pitch: 0,
  recover: false,
});

export const DIRT_ENVIRONMENT: Readonly<SimulationEnvironment> = Object.freeze({
  surface: "dirt",
});

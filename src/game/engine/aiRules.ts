import type { Difficulty } from "../../app/types";
import type { LaneIndex, ObstacleKind } from "../content/tracks";
import {
  type RaceSimulation,
  type BikePhase,
  type LaneChange,
  type SimulationEnvironment,
  type SimulationOptions,
} from "../simulation";
/*
 * RaceSimulation is the authoritative rider rules path for both the player and
 * AI. This module supplies deterministic decisions and race-line bookkeeping;
 * it does not maintain a second movement or timing model.
 */
export type AiBehavior = "route" | "pursuer";

export interface AiDifficultyProfile {
  readonly baseSpeed: number;
  readonly planningIntervalSeconds: number;
  readonly recoveryDelaySeconds: number;
  readonly heatLimit: number;
  readonly obstacleLookahead: number;
  readonly coolingLookahead: number;
  readonly consistencyPenalty: number;
  readonly pitchCorrection: number;
  readonly pitchErrorBand: number;
  readonly routeDecisionStride: number;
}

export const AI_DIFFICULTY_PROFILES: Readonly<Record<Difficulty, AiDifficultyProfile>> = {
  rookie: {
    baseSpeed: 12.6,
    planningIntervalSeconds: 1.2,
    recoveryDelaySeconds: 1.2,
    heatLimit: 97,
    obstacleLookahead: 48,
    coolingLookahead: 58,
    consistencyPenalty: 0.025,
    pitchCorrection: 0.35,
    pitchErrorBand: 0.72,
    routeDecisionStride: 2,
  },
  rider: {
    baseSpeed: 14.6,
    planningIntervalSeconds: 0.75,
    recoveryDelaySeconds: 0.5,
    heatLimit: 86,
    obstacleLookahead: 48,
    coolingLookahead: 58,
    consistencyPenalty: 0.012,
    pitchCorrection: 0.75,
    pitchErrorBand: 0.42,
    routeDecisionStride: 1,
  },
  ace: {
    baseSpeed: 16.4,
    planningIntervalSeconds: 0.45,
    recoveryDelaySeconds: 0,
    heatLimit: 76,
    obstacleLookahead: 72,
    coolingLookahead: 90,
    consistencyPenalty: 0.006,
    pitchCorrection: 1.35,
    pitchErrorBand: 0.18,
    routeDecisionStride: 1,
  },
};

export interface AiObstaclePolicy {
  readonly environment: SimulationEnvironment;
  readonly avoidable: boolean;
  readonly crashesOnContact: boolean;
  readonly retainedSpeed: number;
}

const DIRT_POLICY: AiObstaclePolicy = {
  environment: { surface: "dirt" },
  avoidable: false,
  crashesOnContact: false,
  retainedSpeed: 1,
};

const OBSTACLE_POLICIES: Readonly<Record<ObstacleKind, AiObstaclePolicy>> = {
  bump: {
    environment: { surface: "dirt" },
    avoidable: false,
    crashesOnContact: false,
    retainedSpeed: 0.7,
  },
  "small-ramp": {
    environment: { surface: "ramp", rampImpulse: 6.4 },
    avoidable: false,
    crashesOnContact: false,
    retainedSpeed: 1,
  },
  "medium-ramp": {
    environment: { surface: "ramp", rampImpulse: 8.1 },
    avoidable: false,
    crashesOnContact: false,
    retainedSpeed: 1,
  },
  "large-ramp": {
    environment: { surface: "ramp", rampImpulse: 9.5 },
    avoidable: false,
    crashesOnContact: false,
    retainedSpeed: 1,
  },
  "jump-chain": {
    environment: { surface: "ramp", rampImpulse: 7.4 },
    avoidable: false,
    crashesOnContact: false,
    retainedSpeed: 1,
  },
  mud: {
    environment: { surface: "mud" },
    avoidable: true,
    crashesOnContact: false,
    retainedSpeed: 1,
  },
  grass: {
    environment: { surface: "grass" },
    avoidable: true,
    crashesOnContact: false,
    retainedSpeed: 1,
  },
  "cooling-gate": {
    environment: { surface: "cooling" },
    avoidable: false,
    crashesOnContact: false,
    retainedSpeed: 1,
  },
  barrier: {
    environment: { surface: "dirt" },
    avoidable: true,
    crashesOnContact: true,
    retainedSpeed: 1,
  },
  bank: DIRT_POLICY,
  "super-jump": {
    environment: { surface: "ramp", rampImpulse: 11.2 },
    avoidable: false,
    crashesOnContact: false,
    retainedSpeed: 1,
  },
};

export function getAiDifficultyProfile(difficulty: Difficulty): AiDifficultyProfile {
  return AI_DIFFICULTY_PROFILES[difficulty];
}

export function getObstaclePolicy(kind?: ObstacleKind): AiObstaclePolicy {
  return kind ? OBSTACLE_POLICIES[kind] : DIRT_POLICY;
}

export function isRampObstacle(kind?: ObstacleKind): boolean {
  return getObstaclePolicy(kind).environment.surface === "ramp";
}

export function createAiSimulationOptions(
  lane: LaneIndex,
  forwardPosition: number,
  initialHeat: number,
): SimulationOptions {
  return {
    checkpointCount: 3,
    totalLaps: 2,
    initialHeat,
    initialLane: lane,
    initialForwardPosition: forwardPosition,
  };
}

export function advanceAiRaceProgress(
  simulation: RaceSimulation,
  courseLength: number,
  beforePosition: number,
  afterPosition: number,
): number | undefined {
  if (!Number.isFinite(courseLength) || courseLength <= 0) {
    throw new RangeError("courseLength must be a positive finite number");
  }

  const race = simulation.snapshot.race;
  if (race.finished) return Math.round(race.elapsedSeconds * 1_000);
  if (afterPosition <= beforePosition) return undefined;

  const lapStart = (race.lap - 1) * courseLength;
  for (let checkpoint = race.nextCheckpoint; checkpoint < race.checkpointCount; checkpoint += 1) {
    const checkpointDistance = lapStart
      + courseLength * ((checkpoint + 1) / (race.checkpointCount + 1));
    if (beforePosition < checkpointDistance && afterPosition >= checkpointDistance) {
      simulation.markCheckpoint(checkpoint);
    }
  }

  const finishDistance = race.lap * courseLength;
  if (beforePosition < finishDistance && afterPosition >= finishDistance) {
    simulation.crossFinishLine();
  }

  const updatedRace = simulation.snapshot.race;
  return updatedRace.finished
    ? Math.round(updatedRace.elapsedSeconds * 1_000)
    : undefined;
}

export function getAiConsistency(profile: AiDifficultyProfile, riderIndex: number): number {
  return 1 - ((riderIndex * 17) % 9) * profile.consistencyPenalty;
}

interface AiLaneDecision {
  readonly behavior: AiBehavior;
  readonly currentLane: LaneIndex;
  readonly riderIndex: number;
  readonly riderProgress: number;
  readonly playerLane: LaneIndex;
  readonly playerProgress: number;
  readonly heat: number;
  readonly profile: AiDifficultyProfile;
  readonly aheadObstacle?: AiLaneObstacle | undefined;
  readonly aheadObstacleAvoidable?: boolean | undefined;
  readonly aheadCooling?: AiLaneObstacle | undefined;
}

interface AiLaneObstacle {
  readonly kind: ObstacleKind;
  readonly lanes: readonly LaneIndex[];
}

export function chooseAiLane(decision: AiLaneDecision): LaneIndex {
  if (
    decision.behavior === "pursuer"
    && decision.riderProgress < decision.playerProgress
    && decision.playerProgress - decision.riderProgress < 35
  ) {
    return decision.playerLane;
  }

  const makesRouteDecision = decision.riderIndex % decision.profile.routeDecisionStride === 0;
  if (!makesRouteDecision) return decision.currentLane;

  if (decision.aheadCooling && decision.heat >= 62) {
    return decision.aheadCooling.lanes[
      decision.riderIndex % decision.aheadCooling.lanes.length
    ] ?? decision.currentLane;
  }

  if (
    decision.aheadObstacle
    && (decision.aheadObstacleAvoidable
      ?? getObstaclePolicy(decision.aheadObstacle.kind).avoidable)
  ) {
    return ([0, 1, 2, 3] as const).find(
      (lane) => !decision.aheadObstacle?.lanes.includes(lane),
    ) ?? decision.currentLane;
  }

  return decision.currentLane;
}

export function getAiLaneChange(
  currentLane: LaneIndex,
  targetLane: LaneIndex,
  previousCommand: LaneChange,
): LaneChange {
  if (previousCommand !== 0 || currentLane === targetLane) return 0;
  return targetLane > currentLane ? 1 : -1;
}

interface AiDriveDecision {
  readonly speed: number;
  readonly heat: number;
  readonly overheated: boolean;
  readonly hasAheadObstacle: boolean;
  readonly consistency: number;
  readonly profile: AiDifficultyProfile;
}

export function getAiDriveControl(decision: AiDriveDecision): {
  readonly throttle: boolean;
  readonly turbo: boolean;
} {
  const baseTarget = decision.profile.baseSpeed * decision.consistency;
  const canTurbo = !decision.overheated
    && decision.heat < decision.profile.heatLimit
    && !decision.hasAheadObstacle;
  const turbo = canTurbo && decision.speed < baseTarget + 1.5;
  return {
    throttle: turbo || decision.speed < baseTarget,
    turbo,
  };
}

interface AiPitchDecision {
  readonly phase: BikePhase;
  readonly pitch: number;
  readonly preparingRamp: boolean;
  readonly errorSign: -1 | 0 | 1;
  readonly profile: AiDifficultyProfile;
}

export function getAiPitchControl(decision: AiPitchDecision): number {
  if (decision.phase === "airborne") {
    if (Math.abs(decision.pitch) <= 0.01) return 0;
    return -Math.sign(decision.pitch) * Math.min(1, decision.profile.pitchCorrection / 1.8);
  }
  if (decision.phase !== "grounded" || !decision.preparingRamp) return 0;

  const target = decision.errorSign * decision.profile.pitchErrorBand;
  if (Math.abs(target - decision.pitch) <= 0.01) return 0;
  return Math.sign(target - decision.pitch);
}

export type RiderCollisionOutcome = "player-crashes" | "pursuer-crashes" | null;

export type RiderPairCollisionOutcome = "first-rider-crashes" | "second-rider-crashes" | null;

const RIDER_PAIR_FORGIVENESS_GAP = 1.75;

interface RiderPairCollision {
  readonly sameLane: boolean;
  /** Signed second-rider progress minus first-rider progress. */
  readonly gap: number;
  readonly firstSpeed: number;
  readonly secondSpeed: number;
  readonly firstPhase: BikePhase;
  readonly secondPhase: BikePhase;
}

export function resolveRiderPairCollision(
  contact: RiderPairCollision,
): RiderPairCollisionOutcome {
  if (!contact.sameLane || contact.firstPhase !== "grounded" || contact.secondPhase !== "grounded") {
    return null;
  }
  if (
    contact.gap > 0
    && contact.gap < RIDER_PAIR_FORGIVENESS_GAP
    && contact.firstSpeed > contact.secondSpeed + 0.5
  ) {
    return "first-rider-crashes";
  }
  if (
    contact.gap < 0
    && contact.gap > -RIDER_PAIR_FORGIVENESS_GAP
    && contact.secondSpeed > contact.firstSpeed + 0.5
  ) {
    return "second-rider-crashes";
  }
  return null;
}

interface RiderCollision {
  readonly sameLane: boolean;
  readonly gap: number;
  readonly playerSpeed: number;
  readonly aiSpeed: number;
  readonly playerPhase: BikePhase;
  readonly aiPhase: BikePhase;
  readonly behavior: AiBehavior;
}

export function resolveRiderCollision(contact: RiderCollision): RiderCollisionOutcome {
  const outcome = resolveRiderPairCollision({
    sameLane: contact.sameLane,
    gap: contact.gap,
    firstSpeed: contact.playerSpeed,
    secondSpeed: contact.aiSpeed,
    firstPhase: contact.playerPhase,
    secondPhase: contact.aiPhase,
  });
  if (outcome === "first-rider-crashes") return "player-crashes";
  if (outcome === "second-rider-crashes" && contact.behavior === "pursuer") {
    return "pursuer-crashes";
  }
  return null;
}

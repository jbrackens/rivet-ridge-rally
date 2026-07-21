import { describe, expect, it } from "vitest";

import {
  BIKE_PERFORMANCE_LIMITS,
  FIXED_DT,
  RaceSimulation,
  type SimulationEnvironment,
  type SimulationInput,
} from "../../simulation";
import {
  advanceAiRaceProgress,
  getObstaclePolicy,
  type AiObstaclePolicy,
} from "../../engine/aiRules";
import {
  getMasteryTargetMs,
  TRACKS,
  type LaneIndex,
  type ObstacleKind,
  type TrackDefinition,
  type TrackObstacle,
} from "../tracks";

const RACE_LAPS = 2;
const CHECKPOINT_COUNT = 3;
const TARGET_LOOKAHEAD_METRES = 115;
const COMPLETION_TIMEOUT_SECONDS = 15 * 60;

const neutralInput: SimulationInput = {
  throttle: false,
  turbo: false,
  laneChange: 0,
  pitch: 0,
  recover: false,
};

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

function obstacleLength(obstacle: TrackObstacle): number {
  return obstacle.length !== undefined && Number.isFinite(obstacle.length) && obstacle.length > 0
    ? obstacle.length
    : 8;
}

function distanceIntoCourse(position: number, courseLength: number): number {
  return ((position % courseLength) + courseLength) % courseLength;
}

function activeObstacle(
  track: TrackDefinition,
  position: number,
  lane: LaneIndex,
): TrackObstacle | undefined {
  const coursePosition = distanceIntoCourse(position, track.courseLength);
  return track.obstacles.find((obstacle) => {
    if (!obstacle.lanes.includes(lane)) return false;
    const halfLength = obstacleLength(obstacle) / 2;
    return Math.abs(coursePosition - obstacle.distance) <= halfLength;
  });
}

function distanceAhead(track: TrackDefinition, position: number, obstacle: TrackObstacle): number {
  const coursePosition = distanceIntoCourse(position, track.courseLength);
  const ahead = obstacle.distance - coursePosition;
  return ahead >= 0 ? ahead : ahead + track.courseLength;
}

function laneScore(track: TrackDefinition, position: number, lane: LaneIndex, heat: number): number {
  let score = lane * 0.01;
  for (const obstacle of track.obstacles) {
    if (!obstacle.lanes.includes(lane)) continue;
    const ahead = distanceAhead(track, position, obstacle);
    if (ahead > TARGET_LOOKAHEAD_METRES) continue;
    const urgency = (TARGET_LOOKAHEAD_METRES - ahead) / TARGET_LOOKAHEAD_METRES;
    const policy = getObstaclePolicy(obstacle.kind);
    if (policy.crashesOnContact) score -= 80 * urgency;
    if (policy.avoidable && obstacle.kind !== "cooling-gate") score -= 24 * urgency;
    if (obstacle.kind === "mud") score -= 18 * urgency;
    if (obstacle.kind === "grass") score -= 10 * urgency;
    if (obstacle.kind === "cooling-gate" && heat >= 46) score += 32 * urgency;
    if (
      policy.environment.surface === "ramp" &&
      heat < 82 &&
      track.obstacles.some((candidate) => (
        candidate.kind === "cooling-gate" &&
        candidate.lanes.includes(lane) &&
        distanceAhead(track, position, candidate) <= 170
      ))
    ) {
      score += 8 * urgency;
    }
  }
  return score;
}

function chooseRepresentativeLane(
  track: TrackDefinition,
  position: number,
  currentLane: LaneIndex,
  heat: number,
): LaneIndex {
  const lanes = [0, 1, 2, 3] as const;
  return lanes.reduce((bestLane, lane) => {
    const candidateScore = laneScore(track, position, lane, heat);
    const bestScore = laneScore(track, position, bestLane, heat);
    if (candidateScore > bestScore + 0.5) return lane;
    return bestLane;
  }, currentLane);
}

function obstacleEnvironment(obstacle: TrackObstacle | undefined): {
  readonly environment: SimulationEnvironment;
  readonly policy: AiObstaclePolicy;
  readonly kind: ObstacleKind | undefined;
} {
  const policy = getObstaclePolicy(obstacle?.kind);
  return {
    environment: policy.environment,
    policy,
    kind: obstacle?.kind,
  };
}

function shouldTurbo(
  track: TrackDefinition,
  position: number,
  heat: number,
  obstacle: TrackObstacle | undefined,
): boolean {
  if (heat >= 84) return false;
  if (obstacle?.kind === "cooling-gate") return heat >= 38;
  const nextCoolingDistance = track.obstacles
    .filter((candidate) => candidate.kind === "cooling-gate")
    .map((candidate) => distanceAhead(track, position, candidate))
    .sort((first, second) => first - second)[0];
  if (nextCoolingDistance !== undefined && nextCoolingDistance <= 180 && heat < 92) return true;
  return heat < 70;
}

function representativeInput(
  track: TrackDefinition,
  simulation: RaceSimulation,
): SimulationInput {
  const { bike } = simulation.snapshot;
  const targetLane = chooseRepresentativeLane(track, bike.forwardPosition, bike.lane, bike.heat);
  const laneChange = targetLane === bike.lane ? 0 : targetLane > bike.lane ? 1 : -1;
  const obstacle = activeObstacle(track, bike.forwardPosition, bike.lane);
  const turbo = shouldTurbo(track, bike.forwardPosition, bike.heat, obstacle);

  return {
    ...neutralInput,
    throttle: true,
    turbo,
    laneChange,
    pitch: bike.phase === "airborne" ? 0 : 0,
  };
}

function runRepresentativePlayer(track: TrackDefinition): {
  readonly finishMs: number;
  readonly maxHeat: number;
  readonly obstacleContacts: number;
} {
  const simulation = new RaceSimulation({
    checkpointCount: CHECKPOINT_COUNT,
    totalLaps: RACE_LAPS,
  });
  let maxHeat = simulation.snapshot.bike.heat;
  let lastContactKey: string | undefined;
  let obstacleContacts = 0;

  while (
    !simulation.snapshot.race.finished &&
    simulation.snapshot.race.elapsedSeconds < COMPLETION_TIMEOUT_SECONDS
  ) {
    const before = simulation.snapshot.bike.forwardPosition;
    const input = representativeInput(track, simulation);
    const obstacle = activeObstacle(track, before, simulation.snapshot.bike.lane);
    const { environment, policy, kind } = obstacleEnvironment(obstacle);
    const contactKey = obstacle ? `${simulation.snapshot.race.lap}:${obstacle.id}` : undefined;
    const enteringContact = contactKey !== undefined && contactKey !== lastContactKey;

    simulation.advance(FIXED_DT, input, environment);

    if (enteringContact && kind !== undefined && policy.retainedSpeed < 1) {
      simulation.applySpeedPenalty(policy.retainedSpeed);
    }
    if (enteringContact && policy.crashesOnContact) {
      throw new Error(`${track.name} representative route contacted crashing obstacle ${obstacle?.id}`);
    }

    const after = simulation.snapshot.bike.forwardPosition;
    advanceAiRaceProgress(simulation, track.courseLength, before, after);
    maxHeat = Math.max(maxHeat, simulation.snapshot.bike.heat);
    lastContactKey = contactKey;
    if (enteringContact) obstacleContacts += 1;

    if (simulation.snapshot.bike.phase === "crashed" || simulation.snapshot.bike.overheated) {
      throw new Error(`${track.name} representative route failed at ${after.toFixed(1)} m`);
    }
  }

  if (!simulation.snapshot.race.finished) {
    throw new Error(`${track.name} representative route did not finish`);
  }

  return {
    finishMs: Math.round(simulation.snapshot.race.elapsedSeconds * 1_000),
    maxHeat,
    obstacleContacts,
  };
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

  it("keeps every Solo target reachable by a deterministic production-length representative rider", () => {
    const calibrations = TRACKS.map((track) => ({
      track,
      result: runRepresentativePlayer(track),
    }));

    for (const { track, result } of calibrations) {
      expect(result.finishMs, `${track.name} finish`).toBeLessThanOrEqual(track.soloTargetMs);
      expect(result.finishMs, `${track.name} physical floor`).toBeGreaterThan(
        absoluteTurboFloorMs(track.courseLength),
      );
      expect(result.maxHeat, `${track.name} heat`).toBeLessThan(100);
      expect(result.obstacleContacts, `${track.name} obstacle contact count`).toBeGreaterThan(0);
    }
  });
});

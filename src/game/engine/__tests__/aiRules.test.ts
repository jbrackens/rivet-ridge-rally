import { describe, expect, it } from "vitest";

import {
  TRACKS,
  type LaneIndex,
  type TrackDefinition,
  type TrackObstacle,
} from "../../content/tracks";
import type { Difficulty } from "../../../app/types";
import {
  FIXED_DT,
  NEUTRAL_INPUT,
  RaceSimulation,
  type SimulationInput,
} from "../../simulation";
import {
  AI_DIFFICULTY_PROFILES,
  advanceAiRaceProgress,
  chooseAiLane,
  createAiSimulationOptions,
  getAiConsistency,
  getAiDriveControl,
  getAiLaneChange,
  getAiPitchControl,
  getObstacleContactOutcome,
  getObstaclePolicy,
  resolveRiderCollision,
  resolveRiderPairCollision,
} from "../aiRules";

const throttle: SimulationInput = {
  ...NEUTRAL_INPUT,
  throttle: true,
};

const CALIBRATION_RIDERS = [
  { name: "Copper Comet", behavior: "route", lane: 0, progress: 5, initialHeat: 0 },
  { name: "Bluejay", behavior: "route", lane: 1, progress: 9.6, initialHeat: 7 },
  { name: "Night Spur", behavior: "route", lane: 2, progress: 14.2, initialHeat: 14 },
  { name: "Greenline", behavior: "route", lane: 3, progress: 18.8, initialHeat: 21 },
  { name: "Ember Scout", behavior: "pursuer", lane: 0, progress: -11, initialHeat: 28 },
] as const;

interface CalibrationEntrant {
  readonly name: string;
  readonly simulation: RaceSimulation;
  readonly behavior: "route" | "pursuer";
  targetLane: LaneIndex;
  previousLaneCommand: -1 | 0 | 1;
  routeTimerSeconds: number;
  recoveryDelaySeconds: number;
  lastObstacleKey: string;
  finishTimeMs?: number;
}

function positiveModulo(value: number, modulus: number): number {
  return ((value % modulus) + modulus) % modulus;
}

function obstacleLength(obstacle: TrackObstacle): number {
  if (obstacle.length !== undefined) return obstacle.length;
  if (obstacle.kind === "barrier" || obstacle.kind === "bump") return 8;
  return 12;
}

function activeObstacle(
  track: TrackDefinition,
  localDistance: number,
  lane: LaneIndex,
): TrackObstacle | undefined {
  return track.obstacles.find((candidate) => (
    candidate.lanes.includes(lane)
    && localDistance >= candidate.distance
    && localDistance <= candidate.distance + obstacleLength(candidate)
  ));
}

function nextObstacle(
  track: TrackDefinition,
  localDistance: number,
  lane: LaneIndex,
  lookahead: number,
  predicate: (obstacle: TrackObstacle) => boolean,
): TrackObstacle | undefined {
  return track.obstacles.find((candidate) => {
    const gap = candidate.distance - localDistance;
    return gap > 0
      && gap < lookahead
      && candidate.lanes.includes(lane)
      && predicate(candidate);
  });
}

function nextCooling(
  track: TrackDefinition,
  localDistance: number,
  lookahead: number,
): TrackObstacle | undefined {
  return track.obstacles.find((candidate) => {
    const gap = candidate.distance - localDistance;
    return candidate.kind === "cooling-gate" && gap > 0 && gap < lookahead;
  });
}

function createCalibrationField(): CalibrationEntrant[] {
  return CALIBRATION_RIDERS.map((entrant, index) => ({
    name: entrant.name,
    behavior: entrant.behavior,
    simulation: new RaceSimulation(createAiSimulationOptions(
      entrant.lane,
      entrant.progress,
      entrant.initialHeat,
    )),
    targetLane: entrant.lane,
    previousLaneCommand: 0,
    routeTimerSeconds: index * 0.1,
    recoveryDelaySeconds: 0,
    lastObstacleKey: "",
  }));
}

function stepCalibrationEntrant(
  entrant: CalibrationEntrant,
  index: number,
  difficulty: Difficulty,
  track: TrackDefinition,
  playerProgress: number,
): void {
  const profile = AI_DIFFICULTY_PROFILES[difficulty];
  const beforeState = entrant.simulation.snapshot;
  const bike = beforeState.bike;
  if (entrant.finishTimeMs !== undefined || beforeState.race.finished) {
    entrant.finishTimeMs ??= Math.round(beforeState.race.elapsedSeconds * 1_000);
    return;
  }

  const local = positiveModulo(bike.forwardPosition, track.courseLength);
  const currentObstacle = activeObstacle(track, local, bike.lane);
  const currentPolicy = getObstaclePolicy(currentObstacle?.kind);
  const aheadObstacle = nextObstacle(
    track,
    local,
    bike.lane,
    profile.obstacleLookahead,
    () => true,
  );
  const aheadCooling = nextCooling(track, local, profile.coolingLookahead);
  const aheadPolicy = getObstaclePolicy(aheadObstacle?.kind);

  if (bike.phase !== "crashed" && bike.phase !== "recovering") {
    entrant.routeTimerSeconds -= FIXED_DT;
    if (entrant.routeTimerSeconds <= 0) {
      entrant.routeTimerSeconds = profile.planningIntervalSeconds + index * 0.035;
      entrant.targetLane = chooseAiLane({
        behavior: entrant.behavior,
        currentLane: bike.lane,
        riderIndex: index,
        riderProgress: bike.forwardPosition,
        playerLane: 1,
        playerProgress,
        heat: bike.heat,
        profile,
        aheadObstacle,
        aheadObstacleAvoidable: aheadPolicy.avoidable,
        aheadCooling,
      });
    }
  }

  const consistency = getAiConsistency(profile, index);
  const laneChange = getAiLaneChange(bike.lane, entrant.targetLane, entrant.previousLaneCommand);
  const drive = getAiDriveControl({
    speed: bike.speed,
    heat: bike.heat,
    overheated: bike.overheated,
    hasAheadObstacle: aheadObstacle !== undefined,
    consistency,
    profile,
  });
  const aheadGap = aheadObstacle ? aheadObstacle.distance - local : Number.POSITIVE_INFINITY;
  const preparingRamp = currentPolicy.environment.surface === "ramp"
    || (aheadPolicy.environment.surface === "ramp" && aheadGap < 8);
  const rawErrorIndex = (index * 7 + Math.floor(bike.forwardPosition / track.courseLength)) % 3;
  const errorSign = (((rawErrorIndex + 3) % 3) - 1) as -1 | 0 | 1;

  if (bike.phase === "crashed") {
    entrant.recoveryDelaySeconds = Math.max(0, entrant.recoveryDelaySeconds - FIXED_DT);
  }

  entrant.previousLaneCommand = laneChange;
  entrant.simulation.advance(FIXED_DT, {
    throttle: drive.throttle,
    turbo: drive.turbo,
    laneChange,
    pitch: getAiPitchControl({
      phase: bike.phase,
      pitch: bike.pitch,
      preparingRamp,
      errorSign,
      profile,
    }),
    recover: bike.phase === "crashed" && entrant.recoveryDelaySeconds <= 0,
  }, currentPolicy.environment);

  const afterState = entrant.simulation.snapshot;
  const finishTimeMs = advanceAiRaceProgress(
    entrant.simulation,
    track.courseLength,
    beforeState.bike.forwardPosition,
    afterState.bike.forwardPosition,
  );
  if (finishTimeMs !== undefined) entrant.finishTimeMs = finishTimeMs;

  const after = afterState.bike;
  if (bike.phase !== "crashed" && after.phase === "crashed") {
    entrant.recoveryDelaySeconds = profile.recoveryDelaySeconds;
  } else if (after.phase === "grounded" && bike.phase === "recovering") {
    entrant.recoveryDelaySeconds = 0;
  }

  const afterLocal = positiveModulo(after.forwardPosition, track.courseLength);
  const afterObstacle = activeObstacle(track, afterLocal, after.lane);
  if (afterObstacle && after.phase === "grounded") {
    const obstacleKey = `${Math.floor(after.forwardPosition / track.courseLength)}:${afterObstacle.id}`;
    if (obstacleKey !== entrant.lastObstacleKey) {
      entrant.lastObstacleKey = obstacleKey;
      const policy = getObstaclePolicy(afterObstacle.kind);
      const frontWheelClear = after.wheelie || after.pitch >= 0.18;
      const outcome = getObstacleContactOutcome(afterObstacle.kind, policy, frontWheelClear);
      if (outcome === "crash") {
        entrant.simulation.forceCrash();
        entrant.recoveryDelaySeconds = profile.recoveryDelaySeconds;
      } else if (outcome === "slowdown") {
        entrant.simulation.applySpeedPenalty(policy.retainedSpeed);
      }
    }
  }
}

function classifyCalibrationRace(track: TrackDefinition, difficulty: Difficulty): {
  readonly aiTimes: readonly number[];
  readonly classification: readonly { name: string; timeMs: number; isPlayer: boolean }[];
} {
  const field = createCalibrationField();
  const representativePlayerMs = track.parTimeMs;
  const representativePlayerSpeed = track.courseLength * 2 / (representativePlayerMs / 1_000);

  for (let step = 0; step < 60 * 60 * 15; step += 1) {
    const playerProgress = Math.min(
      track.courseLength * 2,
      representativePlayerSpeed * step * FIXED_DT,
    );
    for (const [index, entrant] of field.entries()) {
      stepCalibrationEntrant(entrant, index, difficulty, track, playerProgress);
    }
    if (field.every((entrant) => entrant.finishTimeMs !== undefined)) break;
  }

  const aiTimes = field.map((entrant) => {
    if (entrant.finishTimeMs === undefined) {
      throw new Error(`${difficulty} ${track.name} did not classify ${entrant.name}`);
    }
    return entrant.finishTimeMs;
  });
  const classification = [
    ...field.map((entrant, index) => ({
      name: entrant.name,
      timeMs: aiTimes[index]!,
      isPlayer: false,
    })),
    { name: "You", timeMs: representativePlayerMs, isPlayer: true },
  ].sort((left, right) => left.timeMs - right.timeMs);

  return { aiTimes, classification };
}

function obstacle(
  kind: TrackObstacle["kind"],
  lanes: TrackObstacle["lanes"] = [1],
): TrackObstacle {
  return { id: `test-${kind}`, kind, distance: 20, lanes };
}

describe("AI difficulty policy", () => {
  it("defines exact planning, recovery, heat, consistency, and pitch differences", () => {
    expect(AI_DIFFICULTY_PROFILES).toEqual({
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
    });

    const profiles = Object.values(AI_DIFFICULTY_PROFILES);
    for (const key of [
      "planningIntervalSeconds",
      "recoveryDelaySeconds",
      "heatLimit",
      "consistencyPenalty",
      "pitchCorrection",
      "pitchErrorBand",
    ] as const) {
      expect(new Set(profiles.map((profile) => profile[key])).size).toBe(3);
    }
    expect(profiles.map((profile) => getAiConsistency(profile, 3))).toEqual([
      1 - 6 * 0.025,
      1 - 6 * 0.012,
      1 - 6 * 0.006,
    ]);
  });

  it("uses heat limits and pitch correction as decision inputs", () => {
    expect(getAiDriveControl({
      speed: 10,
      heat: 80,
      overheated: false,
      hasAheadObstacle: false,
      consistency: 1,
      profile: AI_DIFFICULTY_PROFILES.rookie,
    }).turbo).toBe(true);
    expect(getAiDriveControl({
      speed: 10,
      heat: 80,
      overheated: false,
      hasAheadObstacle: false,
      consistency: 1,
      profile: AI_DIFFICULTY_PROFILES.ace,
    }).turbo).toBe(false);

    expect(getAiPitchControl({
      phase: "airborne",
      pitch: 0.5,
      preparingRamp: false,
      errorSign: 0,
      profile: AI_DIFFICULTY_PROFILES.rookie,
    })).toBeCloseTo(-0.35 / 1.8, 8);
    expect(getAiPitchControl({
      phase: "airborne",
      pitch: 0.5,
      preparingRamp: false,
      errorSign: 0,
      profile: AI_DIFFICULTY_PROFILES.ace,
    })).toBeCloseTo(-1.35 / 1.8, 8);
  });
});

describe("AI behavior and collision policy", () => {
  const sharedDecision = {
    currentLane: 1 as const,
    riderIndex: 0,
    riderProgress: 80,
    playerLane: 3 as const,
    playerProgress: 100,
    heat: 20,
    profile: AI_DIFFICULTY_PROFILES.rider,
  };

  it("keeps route followers distinct from pursuing riders", () => {
    expect(chooseAiLane({ ...sharedDecision, behavior: "route" })).toBe(1);
    expect(chooseAiLane({ ...sharedDecision, behavior: "pursuer" })).toBe(3);
    expect(chooseAiLane({
      ...sharedDecision,
      behavior: "route",
      aheadObstacle: obstacle("barrier", [1, 2]),
    })).toBe(0);
    expect(chooseAiLane({
      ...sharedDecision,
      behavior: "route",
      heat: 70,
      aheadCooling: obstacle("cooling-gate", [2, 3]),
    })).toBe(2);
  });

  it("pulses lane commands through the shared lane-change latch", () => {
    expect(getAiLaneChange(1, 3, 0)).toBe(1);
    expect(getAiLaneChange(2, 3, 1)).toBe(0);
    expect(getAiLaneChange(2, 3, 0)).toBe(1);
    expect(getAiLaneChange(3, 3, 0)).toBe(0);
  });

  it("applies the required asymmetric rear-contact outcomes", () => {
    expect(resolveRiderCollision({
      sameLane: true,
      gap: 1,
      playerSpeed: 14,
      aiSpeed: 12,
      playerPhase: "grounded",
      aiPhase: "grounded",
      behavior: "route",
    })).toBe("player-crashes");
    expect(resolveRiderCollision({
      sameLane: true,
      gap: -1,
      playerSpeed: 12,
      aiSpeed: 14,
      playerPhase: "grounded",
      aiPhase: "grounded",
      behavior: "pursuer",
    })).toBe("pursuer-crashes");
    expect(resolveRiderCollision({
      sameLane: true,
      gap: -1,
      playerSpeed: 12,
      aiSpeed: 14,
      playerPhase: "grounded",
      aiPhase: "grounded",
      behavior: "route",
    })).toBeNull();
    expect(resolveRiderCollision({
      sameLane: true,
      gap: -1,
      playerSpeed: 14,
      aiSpeed: 12,
      playerPhase: "grounded",
      aiPhase: "grounded",
      behavior: "pursuer",
    })).toBeNull();
    expect(resolveRiderCollision({
      sameLane: true,
      gap: 1,
      playerSpeed: 14,
      aiSpeed: 12,
      playerPhase: "airborne",
      aiPhase: "grounded",
      behavior: "route",
    })).toBeNull();
  });

  it("applies the same rear-impact rule between rival riders", () => {
    expect(resolveRiderPairCollision({
      sameLane: true,
      gap: 1,
      firstSpeed: 14,
      secondSpeed: 12,
      firstPhase: "grounded",
      secondPhase: "grounded",
    })).toBe("first-rider-crashes");
    expect(resolveRiderPairCollision({
      sameLane: true,
      gap: -1,
      firstSpeed: 12,
      secondSpeed: 14,
      firstPhase: "grounded",
      secondPhase: "grounded",
    })).toBe("second-rider-crashes");
    expect(resolveRiderPairCollision({
      sameLane: true,
      gap: 1.7,
      firstSpeed: 14,
      secondSpeed: 12,
      firstPhase: "grounded",
      secondPhase: "grounded",
    })).toBe("first-rider-crashes");
    expect(resolveRiderPairCollision({
      sameLane: true,
      gap: -1.7,
      firstSpeed: 12,
      secondSpeed: 14,
      firstPhase: "grounded",
      secondPhase: "grounded",
    })).toBe("second-rider-crashes");
    expect(resolveRiderPairCollision({
      sameLane: false,
      gap: 1,
      firstSpeed: 14,
      secondSpeed: 12,
      firstPhase: "grounded",
      secondPhase: "grounded",
    })).toBeNull();
    expect(resolveRiderPairCollision({
      sameLane: true,
      gap: 1.8,
      firstSpeed: 14,
      secondSpeed: 12,
      firstPhase: "grounded",
      secondPhase: "grounded",
    })).toBeNull();
    expect(resolveRiderPairCollision({
      sameLane: true,
      gap: 1,
      firstSpeed: 14,
      secondSpeed: 12,
      firstPhase: "airborne",
      secondPhase: "grounded",
    })).toBeNull();
  });
});

describe("shared rider simulation contract", () => {
  it("advances ordered AI checkpoints, laps, and an authoritative finish time", () => {
    const simulation = new RaceSimulation({ checkpointCount: 3, totalLaps: 2 });
    let finishTimeMs: number | undefined;

    for (let step = 0; step < 600 && finishTimeMs === undefined; step += 1) {
      const before = simulation.snapshot.bike.forwardPosition;
      simulation.advance(FIXED_DT, throttle);
      const after = simulation.snapshot.bike.forwardPosition;
      finishTimeMs = advanceAiRaceProgress(simulation, 20, before, after);
    }

    expect(finishTimeMs).toBeDefined();
    expect(simulation.snapshot.race).toMatchObject({
      lap: 2,
      nextCheckpoint: 0,
      finished: true,
    });
    expect(simulation.snapshot.race.lapTimes).toHaveLength(2);
    expect(simulation.snapshot.race.splitTimes).toHaveLength(6);
    expect(finishTimeMs).toBe(Math.round(simulation.snapshot.race.elapsedSeconds * 1_000));
  });

  it("maps terrain, ramps, barriers, cooling, and bumps to exact shared semantics", () => {
    expect(getObstaclePolicy("mud").environment).toEqual({ surface: "mud" });
    expect(getObstaclePolicy("grass").environment).toEqual({ surface: "grass" });
    expect(getObstaclePolicy("bank").environment).toEqual({ surface: "dirt" });
    expect(getObstaclePolicy("cooling-gate").environment).toEqual({ surface: "cooling" });
    expect(getObstaclePolicy("small-ramp").environment).toEqual({ surface: "ramp", rampImpulse: 6.4 });
    expect(getObstaclePolicy("medium-ramp").environment).toEqual({ surface: "ramp", rampImpulse: 8.1 });
    expect(getObstaclePolicy("large-ramp").environment).toEqual({ surface: "ramp", rampImpulse: 9.5 });
    expect(getObstaclePolicy("jump-chain").environment).toEqual({ surface: "ramp", rampImpulse: 7.4 });
    expect(getObstaclePolicy("super-jump").environment).toEqual({ surface: "ramp", rampImpulse: 11.2 });
    const barrier = getObstaclePolicy("barrier");
    expect(barrier.crashesOnContact).toBe(true);
    expect(barrier.retainedSpeed).toBe(0.6);
    expect(getObstacleContactOutcome("barrier", barrier, false)).toBe("crash");
    expect(getObstacleContactOutcome("barrier", barrier, true)).toBe("slowdown");
    expect(getObstaclePolicy("bump").retainedSpeed).toBe(0.7);
    expect(getObstacleContactOutcome("bump", getObstaclePolicy("bump"), false)).toBe("slowdown");
    expect(getObstacleContactOutcome("bump", getObstaclePolicy("bump"), true)).toBe("clear");
    expect(getObstacleContactOutcome("medium-ramp", {
      ...getObstaclePolicy("medium-ramp"),
      crashesOnContact: true,
    }, true)).toBe("crash");
  });

  it("starts an AI rider inside RaceSimulation and applies cooling entry exactly once", () => {
    const simulation = new RaceSimulation(createAiSimulationOptions(3, -11, 50));
    expect(simulation.snapshot.bike).toMatchObject({
      lane: 3,
      lanePosition: 4.5,
      forwardPosition: -11,
      heat: 50,
    });

    const cooling = getObstaclePolicy("cooling-gate").environment;
    simulation.advance(FIXED_DT, NEUTRAL_INPUT, cooling);
    expect(simulation.snapshot.bike.heat).toBeCloseTo(50 - 18 - (14 + 80) * FIXED_DT, 8);
    simulation.advance(FIXED_DT, NEUTRAL_INPUT, cooling);
    expect(simulation.snapshot.bike.heat).toBeCloseTo(50 - 18 - (14 + 80) * FIXED_DT * 2, 8);
  });

  it("launches AI and player riders through the same fixed-step ramp path", () => {
    const simulation = new RaceSimulation(createAiSimulationOptions(1, 0, 0));
    for (let step = 0; step < 20; step += 1) {
      simulation.advance(FIXED_DT, throttle, getObstaclePolicy().environment);
    }
    simulation.advance(FIXED_DT, throttle, getObstaclePolicy("medium-ramp").environment);

    expect(simulation.snapshot.bike.phase).toBe("airborne");
    expect(simulation.snapshot.bike.verticalVelocity).toBe(8.1);
    expect(simulation.snapshot.stepCount).toBe(21);
  });

  it("keeps authoritative AI movement deterministic across render-sized chunks", () => {
    const options = createAiSimulationOptions(2, 7, 20);
    const fixed = new RaceSimulation(options);
    const chunked = new RaceSimulation(options);
    for (let step = 0; step < 120; step += 1) {
      fixed.advance(FIXED_DT, throttle, getObstaclePolicy("grass").environment);
    }
    chunked.advance(2, throttle, getObstaclePolicy("grass").environment);

    expect(chunked.snapshot).toEqual(fixed.snapshot);
  });

  it("classifies complete six-rider fields across all launch tracks and difficulty profiles", () => {
    const averageAiMsByDifficulty = new Map<Difficulty, number>();

    for (const difficulty of ["rookie", "rider", "ace"] as const) {
      const allAiTimes: number[] = [];
      for (const track of TRACKS) {
        const { aiTimes, classification } = classifyCalibrationRace(track, difficulty);
        allAiTimes.push(...aiTimes);

        expect(classification, `${difficulty} ${track.name} field size`).toHaveLength(6);
        expect(classification.filter((entry) => entry.isPlayer), `${difficulty} ${track.name} player row`).toHaveLength(1);
        expect(
          classification.map((entry) => entry.timeMs),
          `${difficulty} ${track.name} classification order`,
        ).toEqual([...aiTimes, track.parTimeMs].sort((left, right) => left - right));
        expect(
          aiTimes.every((timeMs) => timeMs > 0 && timeMs <= 15 * 60_000),
          `${difficulty} ${track.name} AI finish bounds`,
        ).toBe(true);
      }
      averageAiMsByDifficulty.set(
        difficulty,
        allAiTimes.reduce((total, timeMs) => total + timeMs, 0) / allAiTimes.length,
      );
    }

    expect(averageAiMsByDifficulty.get("rookie")).toBeGreaterThan(
      averageAiMsByDifficulty.get("rider") ?? Number.POSITIVE_INFINITY,
    );
    expect(averageAiMsByDifficulty.get("rider")).toBeGreaterThan(
      averageAiMsByDifficulty.get("ace") ?? Number.POSITIVE_INFINITY,
    );
  });
});

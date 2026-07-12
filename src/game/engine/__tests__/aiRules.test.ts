import { describe, expect, it } from "vitest";

import type { TrackObstacle } from "../../content/tracks";
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
  getObstaclePolicy,
  resolveRiderCollision,
} from "../aiRules";

const throttle: SimulationInput = {
  ...NEUTRAL_INPUT,
  throttle: true,
};

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
    expect(getObstaclePolicy("barrier").crashesOnContact).toBe(true);
    expect(getObstaclePolicy("bump").retainedSpeed).toBe(0.7);
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
});

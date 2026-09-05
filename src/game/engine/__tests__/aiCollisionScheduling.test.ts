import { describe, expect, it, vi } from "vitest";

import {
  FIXED_DT,
  RaceSimulation,
  type SimulationEnvironment,
  type SimulationInput,
  type SimulationState,
} from "../../simulation";
import type { TrackDefinition } from "../../content/tracks";
import { AI_DIFFICULTY_PROFILES, getObstaclePolicy } from "../aiRules";
import { GameEngine } from "../GameEngine";
import { resolveObstacleContacts, type ObstacleContactSection } from "../obstacleContacts";

type AiCollisionSchedulingMethods = {
  advanceRaceSimulation: (delta: number, input: SimulationInput) => number;
  updateAi: (state: SimulationState) => void;
  advanceAiClassification: (
    work: {
      readonly playerState: SimulationState;
      readonly profile: (typeof AI_DIFFICULTY_PROFILES)["rider"];
      ticks: number;
    },
    tickBudget: number,
  ) => "pending" | "complete" | "exhausted";
  stepAi: (
    ai: TestAiRider,
    index: number,
    profile: (typeof AI_DIFFICULTY_PROFILES)["rider"],
    playerState: SimulationState,
  ) => void;
};

interface TestAiRider {
  simulation: {
    readonly snapshot: SimulationState;
    advance: (delta: number, input: SimulationInput, environment: SimulationEnvironment) => void;
    applySpeedPenalty: (retainedSpeed: number) => void;
    markCheckpoint: (checkpoint: number) => boolean;
    crossFinishLine: () => boolean;
  };
  behavior: "route";
  targetLane: 1;
  previousLaneCommand: 0 | -1 | 1;
  routeTimerSeconds: number;
  recoveryDelaySeconds: number;
  lastObstacleKey: string;
  finishTimeMs?: number;
}

const schedulingMethods = GameEngine.prototype as unknown as AiCollisionSchedulingMethods;
const playerState = {} as SimulationState;
const heldInput: SimulationInput = {
  throttle: true,
  turbo: false,
  laneChange: 0,
  pitch: 0,
  recover: false,
};

function createFixedStepHarness() {
  const events: string[] = [];
  const simulation = new RaceSimulation();
  const harness = {
    paused: false,
    simulation,
    sampleEnvironment: (state: SimulationState): SimulationEnvironment => {
      events.push(`environment:${state.stepCount}`);
      return { surface: state.stepCount === 1 ? "mud" : "dirt" };
    },
    processTrackEvents: (before: SimulationState, after: SimulationState) => {
      events.push(`track:${before.stepCount}->${after.stepCount}`);
    },
    processBikeEvents: (state: SimulationState) => {
      events.push(`bike:${state.stepCount}`);
    },
    captureDemonstratedMechanics: (_before: SimulationState, state: SimulationState) => {
      events.push(`mechanics:${state.stepCount}`);
    },
    replayRecorder: {
      capture: (state: SimulationState) => events.push(`replay:${state.stepCount}`),
      finalize: (state: SimulationState) => events.push(`replay-final:${state.stepCount}`),
    },
    updateAi: (state: SimulationState) => {
      events.push(`ai-and-contacts:${state.stepCount}`);
    },
  };
  return { events, harness, simulation };
}

describe("AI collision scheduling", () => {
  it("interleaves catch-up work exactly like repeated fixed ticks", () => {
    const catchUp = createFixedStepHarness();
    const repeated = createFixedStepHarness();

    expect(schedulingMethods.advanceRaceSimulation.call(
      catchUp.harness,
      FIXED_DT / 2,
      heldInput,
    )).toBe(0);
    expect(catchUp.events).toEqual([]);
    expect(schedulingMethods.advanceRaceSimulation.call(
      catchUp.harness,
      FIXED_DT * 2.5,
      heldInput,
    )).toBe(3);

    for (let step = 0; step < 3; step += 1) {
      schedulingMethods.advanceRaceSimulation.call(repeated.harness, FIXED_DT, heldInput);
    }

    expect(catchUp.events).toEqual(repeated.events);
    expect(catchUp.simulation.snapshot).toEqual(repeated.simulation.snapshot);
    expect(catchUp.events).toEqual([
      "environment:0",
      "track:0->1",
      "ai-and-contacts:1",
      "bike:1",
      "mechanics:1",
      "replay:1",
      "environment:1",
      "track:1->2",
      "ai-and-contacts:2",
      "bike:2",
      "mechanics:2",
      "replay:2",
      "environment:2",
      "track:2->3",
      "ai-and-contacts:3",
      "bike:3",
      "mechanics:3",
      "replay:3",
    ]);
  });

  it("presents a player crash caused by same-step rival contact", () => {
    const simulation = new RaceSimulation();
    const observedPhases: string[] = [];
    const replayCapture = vi.fn();
    const harness = {
      paused: false,
      simulation,
      sampleEnvironment: () => ({ surface: "dirt" as const }),
      processTrackEvents: vi.fn(),
      updateAi: () => simulation.forceCrash("rider-contact"),
      processBikeEvents: (state: SimulationState) => observedPhases.push(state.bike.phase),
      captureDemonstratedMechanics: vi.fn(),
      replayRecorder: { capture: replayCapture, finalize: vi.fn() },
    };

    schedulingMethods.advanceRaceSimulation.call(harness, FIXED_DT, heldInput);

    expect(observedPhases).toEqual(["crashed"]);
    expect(replayCapture).toHaveBeenCalledWith(expect.objectContaining({
      bike: expect.objectContaining({ phase: "crashed" }),
    }));
  });

  it("resolves every unique rival pair after each live AI step before player contact", () => {
    const stepAi = vi.fn();
    const resolveAiPairCollisions = vi.fn();
    const resolvePlayerAiCollisions = vi.fn();
    const harness = {
      settings: { difficulty: "rider" as const },
      aiRiders: [{ riderId: "first" }, { riderId: "second" }],
      stepAi,
      resolveAiPairCollisions,
      resolvePlayerAiCollisions,
    };

    schedulingMethods.updateAi.call(harness, playerState);

    expect(stepAi).toHaveBeenCalledTimes(2);
    expect(resolveAiPairCollisions).toHaveBeenCalledOnce();
    expect(resolveAiPairCollisions).toHaveBeenCalledWith(
      AI_DIFFICULTY_PROFILES.rider,
      true,
    );
    expect(resolvePlayerAiCollisions).toHaveBeenCalledTimes(1);
    const lastAiOrder = stepAi.mock.invocationCallOrder.at(-1) ?? Number.POSITIVE_INFINITY;
    const pairOrder = resolveAiPairCollisions.mock.invocationCallOrder[0]
      ?? Number.NEGATIVE_INFINITY;
    const playerOrder = resolvePlayerAiCollisions.mock.invocationCallOrder[0]
      ?? Number.NEGATIVE_INFINITY;
    expect(lastAiOrder).toBeLessThan(pairOrder);
    expect(pairOrder).toBeLessThan(playerOrder);
  });

  it("keeps applying rival-pair rules while completing the post-finish classification", () => {
    const rider: { finishTimeMs?: number } = {};
    const resolveAiPairCollisions = vi.fn();
    const harness = {
      aiRiders: [rider],
      stepAi: vi.fn(() => {
        rider.finishTimeMs = 90_000;
      }),
      resolveAiPairCollisions,
    };
    const work = {
      playerState,
      profile: AI_DIFFICULTY_PROFILES.rider,
      ticks: 0,
    };

    const status = schedulingMethods.advanceAiClassification.call(harness, work, 1);

    expect(status).toBe("complete");
    expect(work.ticks).toBe(1);
    expect(resolveAiPairCollisions).toHaveBeenCalledOnce();
    expect(resolveAiPairCollisions).toHaveBeenCalledWith(
      AI_DIFFICULTY_PROFILES.rider,
      false,
    );
  });

  it("evaluates a barrier against the AI bike's post-step wheelie state", () => {
    const state = new RaceSimulation().snapshot;
    const beforeState: SimulationState = {
      ...state,
      bike: { ...state.bike, forwardPosition: 99.7, lane: 1, speed: 14, wheelie: false },
    };
    const afterState: SimulationState = {
      ...beforeState,
      stepCount: beforeState.stepCount + 1,
      bike: {
        ...beforeState.bike,
        forwardPosition: 100.1,
        wheelie: true,
        pitch: 0.32,
      },
    };
    let currentState = beforeState;
    const applySpeedPenalty = vi.fn();
    const ai: TestAiRider = {
      simulation: {
        get snapshot() { return currentState; },
        advance: () => { currentState = afterState; },
        applySpeedPenalty,
        markCheckpoint: vi.fn(() => false),
        crossFinishLine: vi.fn(() => false),
      },
      behavior: "route",
      targetLane: 1,
      previousLaneCommand: 0,
      routeTimerSeconds: 1,
      recoveryDelaySeconds: 0,
      lastObstacleKey: "",
    };
    const barrier = {
      id: "ai-wheelie-barrier",
      kind: "barrier" as const,
      moduleId: "barrier-short",
      distance: 100,
      lanes: [1] as const,
      length: 8,
    };
    const obstacleContacts = resolveObstacleContacts(barrier);
    const crashAi = vi.fn();
    const harness = {
      track: { courseLength: 1_000 } as TrackDefinition,
      obstacleContacts,
      obstaclePolicy: (obstacle?: typeof barrier) => getObstaclePolicy(obstacle?.kind),
      nearestObstacleContact: (
        localDistance: number,
        lane: number,
      ): ObstacleContactSection | undefined => obstacleContacts.find((contact) => (
        contact.lanes.includes(lane as 0 | 1 | 2 | 3)
        && Math.abs(localDistance - contact.distance) <= contact.length / 2
      )),
      crashAi,
    };

    schedulingMethods.stepAi.call(
      harness,
      ai,
      0,
      AI_DIFFICULTY_PROFILES.rider,
      beforeState,
    );

    expect(crashAi).not.toHaveBeenCalled();
    expect(applySpeedPenalty).toHaveBeenCalledOnce();
    expect(applySpeedPenalty).toHaveBeenCalledWith(0.6);
  });
});

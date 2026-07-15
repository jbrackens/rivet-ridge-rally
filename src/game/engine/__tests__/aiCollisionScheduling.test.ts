import { describe, expect, it, vi } from "vitest";

import {
  FIXED_DT,
  RaceSimulation,
  type SimulationEnvironment,
  type SimulationInput,
  type SimulationState,
} from "../../simulation";
import { AI_DIFFICULTY_PROFILES } from "../aiRules";
import { GameEngine } from "../GameEngine";

type AiCollisionSchedulingMethods = {
  advanceRaceSimulation: (delta: number, input: SimulationInput) => number;
  updateAi: (state: SimulationState) => void;
  completeAiClassification: (playerState: SimulationState) => boolean;
};

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
      "bike:1",
      "mechanics:1",
      "ai-and-contacts:1",
      "environment:1",
      "track:1->2",
      "bike:2",
      "mechanics:2",
      "ai-and-contacts:2",
      "environment:2",
      "track:2->3",
      "bike:3",
      "mechanics:3",
      "ai-and-contacts:3",
    ]);
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
      settings: { difficulty: "rider" as const },
      aiRiders: [rider],
      stepAi: vi.fn(() => {
        rider.finishTimeMs = 90_000;
      }),
      resolveAiPairCollisions,
    };

    const completed = schedulingMethods.completeAiClassification.call(harness, playerState);

    expect(completed).toBe(true);
    expect(resolveAiPairCollisions).toHaveBeenCalledOnce();
    expect(resolveAiPairCollisions).toHaveBeenCalledWith(
      AI_DIFFICULTY_PROFILES.rider,
      false,
    );
  });
});

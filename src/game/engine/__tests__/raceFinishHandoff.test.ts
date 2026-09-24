import { describe, expect, it, vi } from "vitest";

import type { RaceClassificationEntry } from "../../../app/types";
import { RaceSimulation, type SimulationState } from "../../simulation";
import { GameEngine } from "../GameEngine";

type FinishRaceMethod = (this: Record<string, unknown>) => void;
type ContinueFinishClassificationMethod = (
  this: Record<string, unknown>,
  tickBudget?: number,
) => void;
type AdvanceAiClassificationMethod = (
  this: Record<string, unknown>,
  work: {
    readonly playerState: SimulationState;
    readonly profile: unknown;
    ticks: number;
  },
  tickBudget: number,
) => "pending" | "complete" | "exhausted";
type DeliverFinishResultMethod = (
  this: Record<string, unknown>,
  state: SimulationState,
) => void;

const finishMethods = GameEngine.prototype as unknown as {
  finishRace: FinishRaceMethod;
  continueFinishClassification: ContinueFinishClassificationMethod;
  advanceAiClassification: AdvanceAiClassificationMethod;
  deliverFinishResult: DeliverFinishResultMethod;
};

function finishedState(): SimulationState {
  const state = new RaceSimulation({ checkpointCount: 3, totalLaps: 2 }).snapshot;
  return {
    ...state,
    race: {
      ...state.race,
      lap: 2,
      elapsedSeconds: 82,
      lapElapsedSeconds: 41,
      lapTimes: [41, 41],
      splitTimes: [],
      finished: true,
    },
  };
}

describe("GameEngine finish handoff", () => {
  it("delivers one completed result when replay finalization failed", () => {
    const classification: RaceClassificationEntry[] = [{
      riderId: "player",
      riderName: "You",
      position: 1,
      finishTimeMs: 82_000,
      isPlayer: true,
    }];
    const onFinish = vi.fn();
    const onFinishStart = vi.fn();
    const onFatal = vi.fn();
    const toUint8Array = vi.fn(() => new Uint8Array([1, 2, 3]));
    const harness = {
      finished: false,
      finishFinalized: false,
      finishClassification: null,
      audio: { play: vi.fn() },
      simulation: { snapshot: finishedState() },
      settings: { difficulty: "rider" },
      aiRiders: [],
      onFinishStart,
      continueFinishClassification: finishMethods.continueFinishClassification,
      advanceAiClassification: finishMethods.advanceAiClassification,
      deliverFinishResult: finishMethods.deliverFinishResult,
      buildClassification: vi.fn(() => classification),
      mode: "solo",
      track: { id: "canyon-kickoff", name: "Canyon Kickoff" },
      targetMs: 190_000,
      existingBestMs: undefined,
      crashes: 0,
      overheats: 0,
      replayRecorder: {
        status: { complete: false, failureReason: "cadence" },
        toUint8Array,
      },
      onFinish,
      onFatal,
    };

    finishMethods.finishRace.call(harness);
    finishMethods.finishRace.call(harness);

    expect(onFinishStart).toHaveBeenCalledOnce();
    expect(onFinish).toHaveBeenCalledOnce();
    expect(onFinish).toHaveBeenCalledWith(
      expect.objectContaining({ finishTimeMs: 82_000, classification }),
      { status: "unavailable", reason: "cadence" },
    );
    expect(toUint8Array).not.toHaveBeenCalled();
    expect(onFatal).not.toHaveBeenCalled();
  });

  it("delivers one completed result and one replay payload on the successful branch", () => {
    const classification: RaceClassificationEntry[] = [{
      riderId: "player",
      riderName: "You",
      position: 1,
      finishTimeMs: 82_000,
      isPlayer: true,
    }];
    const replayBytes = new Uint8Array([1, 2, 3]);
    const toUint8Array = vi.fn(() => replayBytes);
    const onFinish = vi.fn();
    const onFinishStart = vi.fn();
    const onFatal = vi.fn();
    const harness = {
      finished: false,
      finishFinalized: false,
      finishClassification: null,
      audio: { play: vi.fn() },
      simulation: { snapshot: finishedState() },
      settings: { difficulty: "rider" },
      aiRiders: [],
      onFinishStart,
      continueFinishClassification: finishMethods.continueFinishClassification,
      advanceAiClassification: finishMethods.advanceAiClassification,
      deliverFinishResult: finishMethods.deliverFinishResult,
      buildClassification: vi.fn(() => classification),
      mode: "solo",
      track: { id: "canyon-kickoff", name: "Canyon Kickoff" },
      targetMs: 190_000,
      existingBestMs: undefined,
      crashes: 0,
      overheats: 0,
      replayRecorder: {
        status: { complete: true },
        toUint8Array,
      },
      onFinish,
      onFatal,
    };

    finishMethods.finishRace.call(harness);
    finishMethods.finishRace.call(harness);

    expect(onFinishStart).toHaveBeenCalledOnce();
    expect(onFinish).toHaveBeenCalledOnce();
    expect(onFinish).toHaveBeenCalledWith(
      expect.objectContaining({ finishTimeMs: 82_000, classification }),
      { status: "complete", samples: replayBytes },
    );
    expect(toUint8Array).toHaveBeenCalledOnce();
    expect(onFatal).not.toHaveBeenCalled();
  });

  it("advances classification in deterministic whole-field slices", () => {
    const riders = [
      { riderId: "first", finishTimeMs: undefined as number | undefined },
      { riderId: "second", finishTimeMs: undefined as number | undefined },
    ];
    const order: string[] = [];
    let collisionTicks = 0;
    const playerState = finishedState();
    const profile = { id: "captured-profile" };
    const stepAi = vi.fn((
      _rider: unknown,
      index: number,
      _profile: unknown,
      _playerState: SimulationState,
    ) => {
      void _profile;
      void _playerState;
      order.push(`rider:${index}`);
    });
    const resolveAiPairCollisions = vi.fn(() => {
      order.push("collisions");
      collisionTicks += 1;
      if (collisionTicks === 31) {
        riders[0]!.finishTimeMs = 83_000;
        riders[1]!.finishTimeMs = 84_000;
      }
    });
    const harness = { aiRiders: riders, stepAi, resolveAiPairCollisions };
    const work = { playerState, profile, ticks: 0 };

    expect(finishMethods.advanceAiClassification.call(harness, work, 30)).toBe("pending");
    expect(work.ticks).toBe(30);
    expect(stepAi).toHaveBeenCalledTimes(60);
    expect(resolveAiPairCollisions).toHaveBeenCalledTimes(30);
    expect(order.slice(0, 3)).toEqual(["rider:0", "rider:1", "collisions"]);

    expect(finishMethods.advanceAiClassification.call(harness, work, 30)).toBe("complete");
    expect(work.ticks).toBe(31);
    expect(stepAi).toHaveBeenCalledTimes(62);
    expect(resolveAiPairCollisions).toHaveBeenCalledTimes(31);
    for (const call of stepAi.mock.calls) {
      expect(call[2]).toBe(profile);
      expect(call[3]).toBe(playerState);
    }
  });

  it("accepts completion on the final classification tick before exhausting the cap", () => {
    const rider = { finishTimeMs: undefined as number | undefined };
    const work = { playerState: finishedState(), profile: {}, ticks: 53_999 };
    const harness = {
      aiRiders: [rider],
      stepAi: vi.fn(),
      resolveAiPairCollisions: vi.fn(() => {
        rider.finishTimeMs = 90_000;
      }),
    };

    expect(finishMethods.advanceAiClassification.call(harness, work, 1)).toBe("complete");
    expect(work.ticks).toBe(54_000);
  });

  it("reports exhaustion once the fixed classification cap is reached", () => {
    const work = { playerState: finishedState(), profile: {}, ticks: 53_999 };
    const harness = {
      aiRiders: [{ finishTimeMs: undefined }],
      stepAi: vi.fn(),
      resolveAiPairCollisions: vi.fn(),
    };

    expect(finishMethods.advanceAiClassification.call(harness, work, 1)).toBe("exhausted");
    expect(work.ticks).toBe(54_000);
  });
});

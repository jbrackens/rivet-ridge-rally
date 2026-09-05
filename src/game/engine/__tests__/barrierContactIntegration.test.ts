import { describe, expect, it, vi } from "vitest";

import { RaceSimulation, type SimulationState } from "../../simulation";
import type { TrackDefinition } from "../../content/tracks";
import { getObstaclePolicy, type AiObstaclePolicy } from "../aiRules";
import { GameEngine } from "../GameEngine";
import { resolveObstacleContacts, type ObstacleContactSection } from "../obstacleContacts";

type BarrierContactMethods = {
  processTrackEvents: (before: SimulationState, state: SimulationState) => void;
  nearestObstacleContact: (
    localDistance: number,
    lane: number,
    bikeHeight?: number,
  ) => ObstacleContactSection | undefined;
};

const methods = GameEngine.prototype as unknown as BarrierContactMethods;

function stateAt(forwardPosition: number, wheelie: boolean, pitch = wheelie ? 0.32 : 0): SimulationState {
  const state = new RaceSimulation().snapshot;
  return {
    ...state,
    bike: {
      ...state.bike,
      forwardPosition,
      lane: 1,
      speed: 14,
      wheelie,
      pitch,
    },
  };
}

describe("player barrier contact", () => {
  it("waits for the visible rail and converts a wheelie contact into slowdown, not a crash", () => {
    const barrier = {
      id: "visible-short-barrier",
      kind: "barrier" as const,
      moduleId: "barrier-short",
      distance: 100,
      lanes: [1] as const,
      length: 8,
    };
    const contacts = resolveObstacleContacts(barrier);
    const forceCrash = vi.fn();
    const applySpeedPenalty = vi.fn();
    const captionEvent = vi.fn();
    const harness = {
      track: { courseLength: 1_000 } as TrackDefinition,
      obstacleContacts: contacts,
      simulation: {
        markCheckpoint: vi.fn(),
        crossFinishLine: vi.fn(),
        forceCrash,
        applySpeedPenalty,
      },
      handledObstacleKeys: new Set<string>(),
      mode: "solo",
      demonstrated: { hazardAvoided: false },
      tutorialEvents: {},
      tutorialRecoveryBarrierCrashPending: false,
      captionEvent,
      observeTutorialLesson: vi.fn(),
      obstaclePolicy: (obstacle?: typeof barrier): AiObstaclePolicy => getObstaclePolicy(obstacle?.kind),
      nearestObstacleContact(
        localDistance: number,
        lane: number,
        bikeHeight?: number,
      ): ObstacleContactSection | undefined {
        return methods.nearestObstacleContact.call(this, localDistance, lane, bikeHeight);
      },
    };

    methods.processTrackEvents.call(harness, stateAt(99.4, true), stateAt(99.7, true));
    expect(forceCrash).not.toHaveBeenCalled();
    expect(applySpeedPenalty).not.toHaveBeenCalled();

    methods.processTrackEvents.call(harness, stateAt(99.7, true), stateAt(100.1, true));
    expect(forceCrash).not.toHaveBeenCalled();
    expect(applySpeedPenalty).toHaveBeenCalledOnce();
    expect(applySpeedPenalty).toHaveBeenCalledWith(0.6);
    expect(captionEvent).toHaveBeenLastCalledWith(
      "Front wheel clear — barrier cost speed",
      "rough-landing",
    );
  });

  it("treats a lifted front wheel as a barrier clear even before the wheelie latch is true", () => {
    const barrier = {
      id: "lifted-front-wheel-barrier",
      kind: "barrier" as const,
      moduleId: "barrier-short",
      distance: 100,
      lanes: [1] as const,
      length: 8,
    };
    const contacts = resolveObstacleContacts(barrier);
    const forceCrash = vi.fn();
    const applySpeedPenalty = vi.fn();
    const captionEvent = vi.fn();
    const harness = {
      track: { courseLength: 1_000 } as TrackDefinition,
      obstacleContacts: contacts,
      simulation: {
        markCheckpoint: vi.fn(),
        crossFinishLine: vi.fn(),
        forceCrash,
        applySpeedPenalty,
      },
      handledObstacleKeys: new Set<string>(),
      mode: "solo",
      demonstrated: { hazardAvoided: false },
      tutorialEvents: {},
      tutorialRecoveryBarrierCrashPending: false,
      captionEvent,
      observeTutorialLesson: vi.fn(),
      obstaclePolicy: (obstacle?: typeof barrier): AiObstaclePolicy => getObstaclePolicy(obstacle?.kind),
      nearestObstacleContact(
        localDistance: number,
        lane: number,
        bikeHeight?: number,
      ): ObstacleContactSection | undefined {
        return methods.nearestObstacleContact.call(this, localDistance, lane, bikeHeight);
      },
    };

    methods.processTrackEvents.call(harness, stateAt(99.7, false, 0.2), stateAt(100.1, false, 0.2));

    expect(forceCrash).not.toHaveBeenCalled();
    expect(applySpeedPenalty).toHaveBeenCalledOnce();
    expect(applySpeedPenalty).toHaveBeenCalledWith(0.6);
    expect(captionEvent).toHaveBeenLastCalledWith(
      "Front wheel clear — barrier cost speed",
      "rough-landing",
    );
  });
});

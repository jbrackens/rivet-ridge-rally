import { describe, expect, it, vi } from "vitest";

import {
  RaceSimulation,
  type BikePhase,
  type CrashCause,
  type LandingQuality,
  type SimulationState,
} from "../../simulation";
import { GameEngine } from "../GameEngine";

type CrashFeedbackMethods = {
  processBikeEvents: (state: SimulationState) => void;
  captionEvent: (caption: string, cue: string) => void;
};

const crashFeedbackMethods = GameEngine.prototype as unknown as CrashFeedbackMethods;

function crashState(cause: CrashCause, lastLanding: LandingQuality = null): SimulationState {
  const state = new RaceSimulation().snapshot;
  return {
    ...state,
    bike: {
      ...state.bike,
      phase: "crashed",
      crashCause: cause,
      lastLanding,
    },
  };
}

function createHarness() {
  const simulation = new RaceSimulation();
  return {
    simulation,
    audio: { play: vi.fn() },
    settings: { accessibility: { reducedShake: false } },
    caption: "",
    captionUntil: 0,
    cameraShake: 0,
    lastBikePhase: "grounded" as BikePhase,
    lastLanding: null as LandingQuality,
    crashes: 0,
    demonstrated: { crash: false, recovery: false },
    tutorialRecoveryBarrierCrashPending: false,
    tutorialEvents: { recoveryBarrierRecovered: false },
    observeTutorialLesson: vi.fn(),
    lastHeatWarning: false,
    lastOverheated: false,
    overheats: 0,
    input: { warnOverheat: vi.fn() },
    captionEvent(caption: string, cue: string) {
      crashFeedbackMethods.captionEvent.call(this, caption, cue);
    },
  };
}

describe("player crash feedback", () => {
  it("translates a wheelie timeout into one precise crash cue", () => {
    const harness = createHarness();
    const state = crashState("wheelie-timeout");

    crashFeedbackMethods.processBikeEvents.call(harness, state);
    crashFeedbackMethods.processBikeEvents.call(harness, state);

    expect(harness.caption).toBe("Wheelie held too long — hold recover");
    expect(harness.captionUntil).toBe(2.5);
    expect(harness.audio.play).toHaveBeenCalledOnce();
    expect(harness.audio.play).toHaveBeenCalledWith("crash");
    expect(harness.cameraShake).toBe(0.34);
    expect(harness.crashes).toBe(1);
  });

  it("counts a later obstacle crash even when the previous landing marker is stale", () => {
    const harness = createHarness();
    const landingCrash = crashState("landing", "crash");

    crashFeedbackMethods.processBikeEvents.call(harness, landingCrash);
    crashFeedbackMethods.processBikeEvents.call(harness, {
      ...landingCrash,
      bike: { ...landingCrash.bike, phase: "recovering", crashCause: null },
    });
    crashFeedbackMethods.processBikeEvents.call(harness, {
      ...landingCrash,
      bike: { ...landingCrash.bike, phase: "grounded", crashCause: null },
    });
    crashFeedbackMethods.processBikeEvents.call(harness, crashState("obstacle", "crash"));

    expect(harness.crashes).toBe(2);
  });
});

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
    emitContactDustBurst: vi.fn(),
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
    expect(harness.emitContactDustBurst).toHaveBeenCalledOnce();
    expect(harness.emitContactDustBurst).toHaveBeenCalledWith(state, "crash");
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
    expect(harness.emitContactDustBurst).toHaveBeenCalledTimes(3);
    expect(harness.emitContactDustBurst).toHaveBeenNthCalledWith(1, landingCrash, "crash");
    expect(harness.emitContactDustBurst).toHaveBeenNthCalledWith(2, expect.anything(), "recovery");
    expect(harness.emitContactDustBurst).toHaveBeenNthCalledWith(3, expect.anything(), "crash");
  });

  it("emits a distinct dust burst for rough landings without counting a crash", () => {
    const harness = createHarness();
    const state = {
      ...new RaceSimulation().snapshot,
      bike: {
        ...new RaceSimulation().snapshot.bike,
        phase: "grounded" as BikePhase,
        lastLanding: "rough" as LandingQuality,
      },
    };

    crashFeedbackMethods.processBikeEvents.call(harness, state);
    crashFeedbackMethods.processBikeEvents.call(harness, state);

    expect(harness.caption).toBe("Rough landing — rebalance");
    expect(harness.crashes).toBe(0);
    expect(harness.emitContactDustBurst).toHaveBeenCalledOnce();
    expect(harness.emitContactDustBurst).toHaveBeenCalledWith(state, "rough-landing");
  });

  it("emits a recovery settle burst when the player returns to grounded", () => {
    const harness = createHarness();
    const state = new RaceSimulation().snapshot;
    const recovering = {
      ...state,
      bike: { ...state.bike, phase: "recovering" as BikePhase },
    };
    const grounded = {
      ...state,
      bike: { ...state.bike, phase: "grounded" as BikePhase },
    };

    crashFeedbackMethods.processBikeEvents.call(harness, recovering);
    crashFeedbackMethods.processBikeEvents.call(harness, grounded);

    expect(harness.demonstrated.recovery).toBe(true);
    expect(harness.emitContactDustBurst).toHaveBeenCalledOnce();
    expect(harness.emitContactDustBurst).toHaveBeenCalledWith(grounded, "recovery");
  });
});

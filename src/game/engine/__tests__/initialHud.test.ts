import { afterEach, describe, expect, it, vi } from "vitest";

import { RaceSimulation, type SimulationState } from "../../simulation";
import { GameEngine } from "../GameEngine";

type StartMethod = (this: Record<string, unknown>) => void;

const startEngine = GameEngine.prototype.start as unknown as StartMethod;

describe("GameEngine initial HUD", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("publishes the authoritative simulation snapshot before scheduling the first frame", () => {
    const events: string[] = [];
    const simulation = new RaceSimulation({ totalLaps: 7 });
    const snapshot = simulation.snapshot;
    const emitHud = vi.fn((state: SimulationState) => {
      events.push(`hud:${state.race.totalLaps}`);
    });

    class ResizeObserverStub {
      observe = vi.fn();
      disconnect = vi.fn();
      unobserve = vi.fn();
    }

    vi.stubGlobal("ResizeObserver", ResizeObserverStub);
    vi.stubGlobal("requestAnimationFrame", vi.fn(() => {
      events.push("frame");
      return 17;
    }));

    const canvas = document.createElement("canvas");
    const unlockAudio = vi.fn();
    const handleContextLost = vi.fn();
    const harness = {
      running: false,
      disposed: false,
      input: { connect: vi.fn() },
      resize: vi.fn(),
      resizeObserver: null,
      canvas,
      handleContextLost,
      contextLostListenerActive: false,
      unlockAudio,
      timer: { connect: vi.fn(), reset: vi.fn() },
      simulation,
      emitHud,
      animationFrame: 0,
      frame: vi.fn(),
    };

    try {
      startEngine.call(harness);

      expect(emitHud).toHaveBeenCalledOnce();
      expect(emitHud).toHaveBeenCalledWith(snapshot);
      expect(events).toEqual(["hud:7", "frame"]);
    } finally {
      window.removeEventListener("pointerdown", unlockAudio);
      window.removeEventListener("keydown", unlockAudio);
      canvas.removeEventListener("webglcontextlost", handleContextLost);
    }
  });
});

import { describe, expect, it } from "vitest";

import { TutorialLessonGate } from "../tutorialLessonGate";

describe("TutorialLessonGate", () => {
  it("does not let evidence observed before a lesson pre-clear that lesson", () => {
    const gate = new TutorialLessonGate();

    expect(gate.observe("lane-change")).toBe(false);
    gate.activate(0);
    expect(gate.observe("lane-change")).toBe(false);
    expect(gate.snapshot.complete).toBe(false);

    gate.activate(2);
    expect(gate.snapshot.complete).toBe(false);
    expect(gate.observe("lane-change")).toBe(true);
    expect(gate.snapshot.complete).toBe(true);
  });

  it("requires multi-part lessons in their authored order", () => {
    const gate = new TutorialLessonGate();
    gate.activate(6);

    expect(gate.observe("airborne-pitch-down")).toBe(false);
    expect(gate.observe("airborne-pitch-up")).toBe(true);
    expect(gate.observe("airborne-pitch-neutral")).toBe(false);
    expect(gate.observe("airborne-pitch-down")).toBe(true);
    expect(gate.snapshot.complete).toBe(false);
    expect(gate.observe("airborne-pitch-neutral")).toBe(true);
    expect(gate.snapshot.complete).toBe(true);
  });

  it("keeps an active heat lesson latched after the threshold observation", () => {
    const gate = new TutorialLessonGate();
    gate.activate(3);

    expect(gate.observe("critical-heat-reached")).toBe(true);
    expect(gate.snapshot.complete).toBe(true);
    expect(gate.activate(3)).toBe(false);
    expect(gate.snapshot.complete).toBe(true);
  });

  it("resets scoped evidence only when the active lesson changes", () => {
    const gate = new TutorialLessonGate();
    gate.activate(10);
    gate.observe("grass-slowdown");
    expect(gate.snapshot.observedSignals).toEqual(["grass-slowdown"]);

    gate.activate(11);
    expect(gate.snapshot.observedSignals).toEqual([]);
    expect(gate.snapshot.complete).toBe(false);
  });

  it("retries the active lesson without changing its index", () => {
    const gate = new TutorialLessonGate();
    gate.activate(10);
    gate.observe("grass-slowdown");

    expect(gate.resetActiveEvidence()).toBe(true);
    expect(gate.snapshot).toEqual({
      activeLessonIndex: 10,
      complete: false,
      observedSignals: [],
    });
    expect(gate.observe("grass-returned-to-dirt")).toBe(false);
    expect(gate.observe("grass-slowdown")).toBe(true);
    expect(gate.observe("grass-returned-to-dirt")).toBe(true);
    expect(gate.snapshot.complete).toBe(true);

    gate.activate(null);
    expect(gate.resetActiveEvidence()).toBe(false);
  });
});

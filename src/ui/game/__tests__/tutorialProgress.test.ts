import { describe, expect, it } from "vitest";

import {
  TUTORIAL_LESSON_COUNT,
  formatTutorialHoldControl,
  getInitialTutorialInputDevice,
  getTutorialExitDecision,
  isTutorialPostRidePhase,
  isTutorialLessonComplete,
  type TutorialHudEvidence,
} from "../tutorialProgress";

function tutorialHud(
  activeLessonIndex: number | null,
  complete: boolean,
): TutorialHudEvidence {
  return {
    tutorialLesson: {
      activeLessonIndex,
      complete,
      observedSignals: [],
    },
  };
}

describe("tutorial lesson activation", () => {
  it("accepts completion only for the currently active lesson", () => {
    expect(isTutorialLessonComplete(2, tutorialHud(2, true))).toBe(true);
    expect(isTutorialLessonComplete(2, tutorialHud(1, true))).toBe(false);
    expect(isTutorialLessonComplete(2, tutorialHud(2, false))).toBe(false);
    expect(isTutorialLessonComplete(2, tutorialHud(null, true))).toBe(false);
  });

  it("freezes the route after the final riding lesson", () => {
    expect(isTutorialPostRidePhase(TUTORIAL_LESSON_COUNT - 1)).toBe(false);
    expect(isTutorialPostRidePhase(TUTORIAL_LESSON_COUNT)).toBe(true);
    expect(isTutorialPostRidePhase(TUTORIAL_LESSON_COUNT + 1)).toBe(true);
  });
});

describe("tutorial input labels", () => {
  it("seeds touch for coarse pointers without mislabeling fine-pointer desktops", () => {
    expect(getInitialTutorialInputDevice(true)).toBe("touch");
    expect(getInitialTutorialInputDevice(false)).toBe("keyboard");
  });

  it("adds the recovery hold instruction exactly once", () => {
    expect(formatTutorialHoldControl("A")).toBe("Hold A");
    expect(formatTutorialHoldControl("RIDE")).toBe("Hold RIDE");
    expect(formatTutorialHoldControl("hold hold R")).toBe("Hold R");
  });
});

describe("tutorial exit integrity", () => {
  it("restarts an unfinished route and never converts the race finish into completion", () => {
    expect(getTutorialExitDecision("race-finish", 0, 0)).toBe("restart");
    expect(getTutorialExitDecision("race-finish", 11, 2)).toBe("restart");
    expect(getTutorialExitDecision("race-finish", 12, 1)).toBe("restart");
    expect(getTutorialExitDecision("race-finish", 12, 2)).toBe("stay");
  });

  it("allows earned completion only after all lessons and both drills", () => {
    expect(getTutorialExitDecision("earned", 11, 2)).toBe("stay");
    expect(getTutorialExitDecision("earned", 12, 1)).toBe("stay");
    expect(getTutorialExitDecision("earned", 12, 2)).toBe("complete");
  });

  it("keeps the explicit skip path distinct from earned completion", () => {
    expect(getTutorialExitDecision("skip", 0, 0)).toBe("skip");
  });
});

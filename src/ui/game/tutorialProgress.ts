import type { EngineHudState } from "../../game/engine/GameEngine";
import type { InputDevice } from "../../game/input/InputManager";
import { TUTORIAL_LESSON_COUNT } from "../../game/engine/tutorialLessonGate";

export { TUTORIAL_LESSON_COUNT };
export const TUTORIAL_COLLISION_DRILL_COUNT = 2;

export type TutorialHudEvidence = Pick<
  EngineHudState,
  "tutorialLesson"
>;

export type TutorialExitSource = "race-finish" | "skip" | "earned";
export type TutorialExitDecision = "stay" | "restart" | "skip" | "complete";

export function getInitialTutorialInputDevice(coarsePointer: boolean): InputDevice {
  return coarsePointer ? "touch" : "keyboard";
}

export function formatTutorialHoldControl(control: string): string {
  return `Hold ${control.replace(/^(?:hold\s+)+/i, "")}`;
}

export function isTutorialPostRidePhase(lessonIndex: number): boolean {
  return lessonIndex >= TUTORIAL_LESSON_COUNT;
}

export function isTutorialLessonComplete(
  lessonIndex: number,
  state: TutorialHudEvidence,
): boolean {
  return state.tutorialLesson.activeLessonIndex === lessonIndex
    && state.tutorialLesson.complete;
}

export function canEarnTutorialCompletion(
  completedLessonCount: number,
  completedCollisionDrillCount: number,
): boolean {
  return completedLessonCount >= TUTORIAL_LESSON_COUNT
    && completedCollisionDrillCount >= TUTORIAL_COLLISION_DRILL_COUNT;
}

export function getTutorialExitDecision(
  source: TutorialExitSource,
  completedLessonCount: number,
  completedCollisionDrillCount: number,
): TutorialExitDecision {
  if (source === "skip") return "skip";
  if (source === "race-finish") {
    return canEarnTutorialCompletion(completedLessonCount, completedCollisionDrillCount)
      ? "stay"
      : "restart";
  }
  if (
    source === "earned"
    && canEarnTutorialCompletion(completedLessonCount, completedCollisionDrillCount)
  ) {
    return "complete";
  }
  return "stay";
}

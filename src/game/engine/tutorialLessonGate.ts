export const TUTORIAL_LESSON_SIGNAL_REQUIREMENTS = [
  ["ride-at-usable-speed"],
  ["coast"],
  ["lane-change"],
  ["critical-heat-reached"],
  ["cooling-release"],
  ["training-bump-wheelie"],
  ["airborne-pitch-up", "airborne-pitch-down", "airborne-pitch-neutral"],
  ["clean-landing"],
  ["choice-barrier-avoided"],
  ["mud-slowdown"],
  ["grass-slowdown", "grass-returned-to-dirt"],
  ["recovery-barrier-crash", "recovery-barrier-recovered"],
] as const;

export type TutorialLessonSignal =
  (typeof TUTORIAL_LESSON_SIGNAL_REQUIREMENTS)[number][number];

export const TUTORIAL_LESSON_COUNT = TUTORIAL_LESSON_SIGNAL_REQUIREMENTS.length;

export interface TutorialLessonGateSnapshot {
  activeLessonIndex: number | null;
  complete: boolean;
  observedSignals: readonly TutorialLessonSignal[];
}

export class TutorialLessonGate {
  private activeLessonIndex: number | null = null;
  private observedSignalCount = 0;

  activate(lessonIndex: number | null): boolean {
    if (lessonIndex === this.activeLessonIndex) return false;
    this.activeLessonIndex = lessonIndex;
    this.observedSignalCount = 0;
    return true;
  }

  /** Starts fresh evidence collection without advancing or clearing the lesson. */
  resetActiveEvidence(): boolean {
    if (this.activeLessonIndex === null) return false;
    this.observedSignalCount = 0;
    return true;
  }

  observe(signal: TutorialLessonSignal): boolean {
    if (this.activeLessonIndex === null) return false;
    const requirements = TUTORIAL_LESSON_SIGNAL_REQUIREMENTS[this.activeLessonIndex];
    if (!requirements || requirements[this.observedSignalCount] !== signal) return false;
    this.observedSignalCount += 1;
    return true;
  }

  get snapshot(): TutorialLessonGateSnapshot {
    const requirements = this.activeLessonIndex === null
      ? undefined
      : TUTORIAL_LESSON_SIGNAL_REQUIREMENTS[this.activeLessonIndex];
    return {
      activeLessonIndex: this.activeLessonIndex,
      complete: requirements !== undefined
        && this.observedSignalCount === requirements.length,
      observedSignals: requirements?.slice(0, this.observedSignalCount) ?? [],
    };
  }
}

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type CSSProperties,
  type ReactNode,
} from "react";

import { useAppStore } from "../../app/store";
import { CRITICAL_HEAT_WARNING, GameEngine, type EngineHudState } from "../../game/engine/GameEngine";
import type { LaneChange } from "../../game/simulation";
import { getTrack } from "../../game/content/tracks";
import { customTrackToDefinition } from "../../game/editor/toTrackDefinition";
import { formatKeyCode } from "../../game/input/keyLabels";
import { firstConnectedGamepad } from "../../game/input/gamepad";
import { isInteractiveInputTarget, type InputDevice } from "../../game/input/InputManager";
import { saveReplay } from "../../game/persistence/database";
import {
  startLifecycleResource,
  stopLifecycleResource,
} from "../../game/qa/lifecycleDiagnostics";
import { formatTime } from "../format";
import { RallyIcon } from "../icons/RallyIcon";
import { TouchControlIcon, type TouchControlIconKind } from "./TouchControlIcon";
import {
  TUTORIAL_COLLISION_DRILL_COUNT,
  TUTORIAL_LESSON_COUNT,
  formatTutorialHoldControl,
  getInitialTutorialInputDevice,
  getTutorialExitDecision,
  isTutorialPostRidePhase,
  isTutorialLessonComplete,
  type TutorialExitSource,
} from "./tutorialProgress";

const INITIAL_HUD: EngineHudState = {
  position: 1,
  fieldSize: 1,
  lap: 1,
  totalLaps: 2,
  elapsedMs: 0,
  targetMs: 0,
  savedBestMs: undefined,
  heat: 0,
  overheated: false,
  bikePhase: "grounded",
  lane: 1,
  pitch: 0,
  wheelie: false,
  landing: null,
  surface: "dirt",
  recoveryProgress: 0,
  speed: 0,
  caption: "",
  hint: "",
  inputDevice: "keyboard",
  fps: 0,
  frameTimeMs: 0,
  drawCalls: 0,
  droppedSimulationMs: 0,
  tutorialLesson: {
    activeLessonIndex: null,
    complete: false,
    observedSignals: [],
  },
  demonstrated: {
    rideAtUsableSpeed: false,
    coast: false,
    criticalHeatReached: false,
    cooling: false,
    coolingRelease: false,
    laneChange: false,
    wheelie: false,
    airbornePitch: false,
    airbornePitchUp: false,
    airbornePitchDown: false,
    airborneNeutral: false,
    cleanLanding: false,
    hazardAvoided: false,
    mud: false,
    grass: false,
    crash: false,
    recovery: false,
  },
  tutorialEvents: {
    trainingBumpClearedInWheelie: false,
    choiceBarrierAvoided: false,
    grassSlowdownExperienced: false,
    grassReturnedToDirt: false,
    recoveryBarrierCrash: false,
    recoveryBarrierRecovered: false,
  },
};

type RaceGatePhase = "loading" | "countdown" | "racing" | "finishing";
const RACE_LOADING_REVEAL_MS = 150;
const RACE_LOADING_MINIMUM_VISIBLE_MS = 400;

interface TutorialStep {
  title: string;
  copy: string;
  control: string;
}

function getTutorialControls(hud: EngineHudState, bindings: Record<string, string>) {
  if (hud.inputDevice === "gamepad") {
    return {
      ride: "A / RT",
      turbo: "B / LT",
      lane: "D-pad or left stick ← / →",
      pitch: "left stick ↑ / ↓",
      recover: "A",
      pause: "Start",
    };
  }
  if (hud.inputDevice === "touch") {
    return {
      ride: "RIDE",
      turbo: "TURBO",
      lane: "← / → rocker",
      pitch: "↑ / ↓ rocker",
      recover: "RIDE",
      pause: "pause button",
    };
  }
  return {
    ride: formatKeyCode(bindings.throttle ?? "KeyW"),
    turbo: formatKeyCode(bindings.turbo ?? "ShiftLeft"),
    lane: `${formatKeyCode(bindings.laneLeft ?? "ArrowLeft")} / ${formatKeyCode(bindings.laneRight ?? "ArrowRight")}`,
    pitch: `${formatKeyCode(bindings.pitchUp ?? "ArrowUp")} / ${formatKeyCode(bindings.pitchDown ?? "ArrowDown")}`,
    recover: formatKeyCode(bindings.recover ?? "Space"),
    pause: formatKeyCode(bindings.pause ?? "Escape"),
  };
}

function getTutorialSteps(hud: EngineHudState, bindings: Record<string, string>): readonly TutorialStep[] {
  const controls = getTutorialControls(hud, bindings);
  return [
    {
      title: "Ride and read the HUD",
      copy: "Build usable speed. Position or run type sits left, lap and time sit center, and the target sits right.",
      control: `Hold ${controls.ride}`,
    },
    {
      title: "Coast to slow",
      copy: "There is no separate brake: release Ride and Turbo before a tight line or hot section and the bike coasts down safely.",
      control: `Release ${controls.ride} and ${controls.turbo}`,
    },
    {
      title: "Choose a lane",
      copy: "Use the left and right directions. One press commits one lane, so choose early instead of weaving constantly.",
      control: controls.lane,
    },
    {
      title: "Turbo and heat",
      copy: "Turbo adds speed and heat. Reach the white warning marker, then release before the red zone disables control.",
      control: `Hold ${controls.turbo}`,
    },
    {
      title: "Cool the bike",
      copy: "Release Turbo and pass through the cyan snowflake gate. Cooling gates remove heat much faster than coasting.",
      control: `Release ${controls.turbo}`,
    },
    {
      title: "Wheelie the bump",
      copy: "Raise the front wheel while grounded to skim the bump and keep speed. Holding a wheelie too long will crash.",
      control: controls.pitch.split(" / ")[0] ?? controls.pitch,
    },
    {
      title: "Shape the jump",
      copy: "Pitch nose-up after takeoff, then nose-down and release the control so the bike returns toward level.",
      control: controls.pitch,
    },
    {
      title: "Land both wheels",
      copy: "Touch down nearly level to keep momentum. Steep landings are rough; extreme angles cause a fair crash.",
      control: "Level the bike before touchdown",
    },
    {
      title: "Read or clear the barrier",
      copy: "Move into an open lane to keep full speed. If trapped, raise the front wheel before contact to clear the striped barrier with a heavy speed loss.",
      control: `${controls.lane} or ${controls.pitch.split(" / ")[0] ?? controls.pitch}`,
    },
    {
      title: "Mud slowdown",
      copy: "Ride through the glossy ruts and feel the speed fall. Mud slows the player and every rival by the same rules.",
      control: "Keep the bike steady",
    },
    {
      title: "Track edges",
      copy: "Grass and off-line terrain reduce grip. Return to the marked dirt lanes for full acceleration and control.",
      control: controls.lane,
    },
    {
      title: "Crash and recover",
      copy: "For this drill, lower the front wheel and hit the full-width training barrier. Hold Recover until the meter fills; tapping is optional in Settings.",
      control: formatTutorialHoldControl(controls.recover),
    },
  ];
}

function ContactDrillProgress({ completedDrills }: { completedDrills: number }) {
  return (
    <div
      className="contact-drill-progress"
      role="list"
      aria-label={`Contact rule progress: drill ${Math.min(completedDrills + 1, TUTORIAL_COLLISION_DRILL_COUNT)} of ${TUTORIAL_COLLISION_DRILL_COUNT}`}
    >
      {Array.from({ length: TUTORIAL_COLLISION_DRILL_COUNT }, (_, index) => {
        const markerState = index < completedDrills
          ? "complete"
          : index === completedDrills
            ? "active"
            : "future";
        const markerLabel = markerState === "complete"
          ? "completed"
          : markerState === "active"
            ? "current"
            : "not started";
        return (
          <span
            key={`contact-drill-${index + 1}`}
            role="listitem"
            data-state={markerState}
            aria-label={`Contact drill ${index + 1}: ${markerLabel}`}
          >
            {markerState === "complete" ? "✓" : markerState === "active" ? <RallyIcon kind="play" className="progress-icon" /> : index + 1}
          </span>
        );
      })}
    </div>
  );
}

const HEAT_WARNING_STYLE = {
  "--heat-warning-threshold": `${CRITICAL_HEAT_WARNING}%`,
} as CSSProperties;

export function HeatMeter({ heat, overheated }: { heat: number; overheated: boolean }) {
  return (
    <div className={`heat-meter ${overheated ? "overheated" : ""}`} aria-label={`Heat ${Math.round(heat)} percent${overheated ? ", overheated" : ""}`} role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(heat)}>
      <strong>Heat</strong>
      <div className="heat-track" style={HEAT_WARNING_STYLE}><span style={{ width: `${heat}%` }} /><i className="heat-warning" aria-hidden="true" /></div>
      {overheated ? <b aria-hidden="true"><span>!</span></b> : null}
    </div>
  );
}

interface TouchButtonProps {
  label: string;
  className: string;
  dataControl: TouchControlIconKind;
  displayLabel?: ReactNode;
  activation: "hold" | "pulse";
  resetPressed?: boolean;
  onChange: (pressed: boolean) => void;
}

export function TouchButton({
  label,
  className,
  dataControl,
  displayLabel,
  activation,
  resetPressed = false,
  onChange,
}: TouchButtonProps) {
  const [pressed, setPressed] = useState(false);
  const pressedRef = useRef(false);
  const onChangeRef = useRef(onChange);
  const pointerClickPendingRef = useRef(false);
  const pointerClickTimerRef = useRef(0);
  const pulseFrameRef = useRef(0);

  useLayoutEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  const setControlPressed = useCallback((nextPressed: boolean) => {
    if (pressedRef.current === nextPressed) return;
    pressedRef.current = nextPressed;
    setPressed(nextPressed);
    onChangeRef.current(nextPressed);
  }, []);

  const cancelPulse = useCallback(() => {
    if (!pulseFrameRef.current) return;
    window.cancelAnimationFrame(pulseFrameRef.current);
    pulseFrameRef.current = 0;
  }, []);

  const clearPendingPointerClick = useCallback(() => {
    pointerClickPendingRef.current = false;
    if (!pointerClickTimerRef.current) return;
    window.clearTimeout(pointerClickTimerRef.current);
    pointerClickTimerRef.current = 0;
  }, []);

  const schedulePendingPointerClickClear = useCallback(() => {
    if (pointerClickTimerRef.current) window.clearTimeout(pointerClickTimerRef.current);
    pointerClickTimerRef.current = window.setTimeout(() => {
      pointerClickPendingRef.current = false;
      pointerClickTimerRef.current = 0;
    }, 0);
  }, []);

  const releaseControl = useCallback(() => {
    cancelPulse();
    setControlPressed(false);
  }, [cancelPulse, setControlPressed]);

  useEffect(() => {
    const releaseForWindowBlur = () => {
      clearPendingPointerClick();
      releaseControl();
    };
    window.addEventListener("blur", releaseForWindowBlur);
    return () => {
      window.removeEventListener("blur", releaseForWindowBlur);
      clearPendingPointerClick();
      cancelPulse();
    };
  }, [cancelPulse, clearPendingPointerClick, releaseControl]);

  useLayoutEffect(() => {
    if (!resetPressed) return;
    clearPendingPointerClick();
    releaseControl();
  }, [clearPendingPointerClick, releaseControl, resetPressed]);

  return (
    <button
      className={className}
      data-control={dataControl}
      data-pressed={activation === "hold" ? pressed : undefined}
      aria-label={label}
      aria-pressed={activation === "hold" ? pressed : undefined}
      onPointerDown={(event) => {
        event.preventDefault();
        clearPendingPointerClick();
        pointerClickPendingRef.current = true;
        cancelPulse();
        setControlPressed(true);
        try {
          event.currentTarget.setPointerCapture(event.pointerId);
        } catch {
          // Some embedded browsers reject capture while still delivering the press.
        }
      }}
      onPointerUp={() => {
        releaseControl();
        schedulePendingPointerClickClear();
      }}
      onPointerCancel={() => {
        clearPendingPointerClick();
        releaseControl();
      }}
      onLostPointerCapture={() => {
        releaseControl();
        schedulePendingPointerClickClear();
      }}
      onClick={(event) => {
        if (pointerClickPendingRef.current) {
          clearPendingPointerClick();
          return;
        }
        if (event.detail !== 0) return;
        if (activation === "hold") {
          setControlPressed(!pressedRef.current);
          return;
        }
        setControlPressed(true);
        cancelPulse();
        pulseFrameRef.current = window.requestAnimationFrame(() => {
          pulseFrameRef.current = 0;
          setControlPressed(false);
        });
      }}
    >
      {displayLabel ?? label}
    </button>
  );
}

interface PitchTouchControlsProps {
  resetPressed?: boolean;
  onChange: (direction: LaneChange) => void;
}

export function PitchTouchControls({
  resetPressed = false,
  onChange,
}: PitchTouchControlsProps) {
  const [direction, setDirection] = useState<LaneChange>(0);
  const directionRef = useRef<LaneChange>(0);
  const onChangeRef = useRef(onChange);

  useLayoutEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  const setPitchDirection = useCallback((nextDirection: LaneChange) => {
    if (directionRef.current === nextDirection) return;
    directionRef.current = nextDirection;
    setDirection(nextDirection);
    onChangeRef.current(nextDirection);
  }, []);

  const updatePitchDirection = useCallback((controlDirection: -1 | 1, pressed: boolean) => {
    if (pressed) {
      setPitchDirection(controlDirection);
      return;
    }
    if (directionRef.current === controlDirection) setPitchDirection(0);
  }, [setPitchDirection]);

  return (
    <div className="touch-rocker touch-pitch-rocker" role="group" aria-label="Pitch controls">
      <TouchButton
        label="Pitch front wheel up"
        className=""
        dataControl="pitch-up"
        displayLabel={<TouchControlIcon kind="pitch-up" />}
        activation="hold"
        resetPressed={resetPressed || direction === -1}
        onChange={(pressed) => updatePitchDirection(1, pressed)}
      />
      <TouchButton
        label="Pitch front wheel down"
        className=""
        dataControl="pitch-down"
        displayLabel={<TouchControlIcon kind="pitch-down" />}
        activation="hold"
        resetPressed={resetPressed || direction === 1}
        onChange={(pressed) => updatePitchDirection(-1, pressed)}
      />
    </div>
  );
}

export function RecoveryPrompt({ hint, progress }: { hint: string; progress: number }) {
  const progressPercent = Math.round(Math.min(1, Math.max(0, progress)) * 100);
  return (
    <div className="recover-prompt">
      <strong>{hint || "Hold Recover to recover"}</strong>
      <div
        role="progressbar"
        aria-label="Recovery progress"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={progressPercent}
        aria-valuetext={`${progressPercent}% recovered`}
      >
        <span style={{ width: `${progressPercent}%` }} />
      </div>
    </div>
  );
}

function containDialogFocus(event: ReactKeyboardEvent<HTMLElement>): void {
  if (event.key !== "Tab") return;
  const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>("button:not(:disabled)"));
  const first = buttons[0];
  const last = buttons.at(-1);
  if (!first || !last) return;

  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

export function GameView({ tutorial = false }: { tutorial?: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<GameEngine | null>(null);
  const finishingGateRef = useRef<HTMLElement>(null);
  const pauseDialogRef = useRef<HTMLElement>(null);
  const pauseReturnFocusRef = useRef<HTMLElement | null>(null);
  const tutorialSettingsButtonRef = useRef<HTMLButtonElement>(null);
  const wasPauseDialogOpenRef = useRef(false);
  const [initialInputDevice] = useState<InputDevice>(() => (
    tutorial && typeof window !== "undefined"
      ? getInitialTutorialInputDevice(
          typeof window.matchMedia === "function" && window.matchMedia("(pointer: coarse)").matches,
        )
      : "keyboard"
  ));
  const screen = useAppStore((state) => state.screen);
  const returnScreen = useAppStore((state) => state.returnScreen);
  const settings = useAppStore((state) => state.settings);
  const progress = useAppStore((state) => state.progress);
  const persistenceStatus = useAppStore((state) => state.persistenceStatus);
  const activeRace = useAppStore((state) => state.activeRace);
  const raceAttempt = useAppStore((state) => state.raceAttempt);
  const finishRace = useAppStore((state) => state.finishRace);
  const presentRaceResult = useAppStore((state) => state.presentRaceResult);
  const retryRace = useAppStore((state) => state.retryRace);
  const completeTutorial = useAppStore((state) => state.completeTutorial);
  const skipTutorial = useAppStore((state) => state.skipTutorial);
  const pauseRace = useAppStore((state) => state.pauseRace);
  const resumeRace = useAppStore((state) => state.resumeRace);
  const openSettings = useAppStore((state) => state.openSettings);
  const navigate = useAppStore((state) => state.navigate);
  const [hud, setHud] = useState<EngineHudState>(() => (
    tutorial
      ? { ...INITIAL_HUD, totalLaps: 1, inputDevice: initialInputDevice }
      : INITIAL_HUD
  ));
  const [fatal, setFatal] = useState<string | null>(null);
  const [tutorialStarted, setTutorialStarted] = useState(false);
  const [tutorialPaused, setTutorialPaused] = useState(false);
  const [tutorialAttempt, setTutorialAttempt] = useState(0);
  const [tutorialStep, setTutorialStep] = useState(0);
  const [collisionQuizStep, setCollisionQuizStep] = useState(0);
  const [collisionQuizError, setCollisionQuizError] = useState("");
  const [tutorialNotice, setTutorialNotice] = useState("");
  const [raceGatePhase, setRaceGatePhase] = useState<RaceGatePhase>(tutorial ? "racing" : "loading");
  const [showLoadingGate, setShowLoadingGate] = useState(false);
  const [countdownLabel, setCountdownLabel] = useState("3");
  const [showGoSignal, setShowGoSignal] = useState(false);
  const finishingRef = useRef(false);
  const tutorialProgressRef = useRef({ completedLessons: 0, completedDrills: 0 });
  const settingsRef = useRef(settings);
  const trackId = tutorial ? "canyon-kickoff" : (activeRace?.trackId ?? progress.selectedTrackId);
  const mode = tutorial ? "tutorial" : (activeRace?.mode ?? "practice");
  const customTrack = tutorial ? undefined : activeRace?.customTrack;
  const track = customTrack
    ? customTrackToDefinition(customTrack)
    : getTrack(trackId);
  const appPaused = screen === "paused" || (screen === "settings" && returnScreen === "paused");
  const tutorialSteps = useMemo(() => (
    tutorial
      ? getTutorialSteps(hud, settings.controls.keyBindings)
      : []
  ), [hud, settings.controls.keyBindings, tutorial]);
  const tutorialControls = getTutorialControls(hud, settings.controls.keyBindings);
  const tutorialStepComplete = tutorial
    ? Boolean(tutorialStarted && isTutorialLessonComplete(tutorialStep, hud))
    : false;
  const tutorialAnnouncement = useMemo(() => {
    if (!tutorial) return "";
    if (!tutorialStarted) return "Rider School intro. Twelve lessons and two contact drills.";
    if (tutorialStep < tutorialSteps.length) {
      const step = tutorialSteps[tutorialStep];
      const state = tutorialStepComplete ? "cleared" : "active";
      return `Lesson ${tutorialStep + 1} of ${tutorialSteps.length}: ${step?.title ?? "Rider School"}. ${state}. ${step?.control ?? ""}`.trim();
    }
    if (collisionQuizStep < TUTORIAL_COLLISION_DRILL_COUNT) {
      return `Contact drill ${collisionQuizStep + 1} of ${TUTORIAL_COLLISION_DRILL_COUNT}: ${collisionQuizStep === 0 ? "Rival contact" : "Rear-wheel defense"}.`;
    }
    return "Training cleared. Enter the festival when ready.";
  }, [collisionQuizStep, tutorial, tutorialStarted, tutorialStep, tutorialStepComplete, tutorialSteps]);
  const tutorialLessonSynchronized = !tutorial
    || tutorialStep >= TUTORIAL_LESSON_COUNT
    || hud.tutorialLesson.activeLessonIndex === tutorialStep;
  const tutorialHandoff = tutorial
    && tutorialStarted
    && tutorialStep < TUTORIAL_LESSON_COUNT
    && tutorialLessonSynchronized
    && tutorialStepComplete;
  const tutorialPostRide = tutorial
    && tutorialStarted
    && isTutorialPostRidePhase(tutorialStep);
  const finishing = !tutorial && raceGatePhase === "finishing";
  const waitingAtRaceGate = raceGatePhase === "loading" || raceGatePhase === "countdown";
  const paused = tutorial
    ? !tutorialStarted || tutorialPaused || !tutorialLessonSynchronized || tutorialHandoff || tutorialPostRide
    : appPaused || waitingAtRaceGate;
  const visuallyPaused = tutorial ? tutorialPaused : appPaused || raceGatePhase !== "racing";
  const resetTouchControls = visuallyPaused || tutorialPostRide;
  const pauseDialogOpen = tutorial
    ? tutorialPaused
    : appPaused && raceGatePhase === "racing";
  const pausedRef = useRef(paused);
  const previousScreenRef = useRef(screen);
  const restartTutorial = useCallback((notice = "") => {
    setHud({
      ...INITIAL_HUD,
      totalLaps: 1,
      inputDevice: initialInputDevice,
    });
    setTutorialStep(0);
    setCollisionQuizStep(0);
    setCollisionQuizError("");
    setTutorialNotice(notice);
    setTutorialPaused(false);
    setTutorialStarted(true);
    setTutorialAttempt((value) => value + 1);
  }, [initialInputDevice]);
  const exitTutorial = useCallback((source: TutorialExitSource) => {
    const { completedLessons, completedDrills } = tutorialProgressRef.current;
    const decision = getTutorialExitDecision(source, completedLessons, completedDrills);
    if (decision === "complete") completeTutorial();
    if (decision === "skip") skipTutorial();
    if (decision === "restart") {
      restartTutorial("Finish reached before training clearance. The route and checklist have restarted.");
    }
  }, [completeTutorial, restartTutorial, skipTutorial]);
  const retryTutorialLesson = useCallback(() => {
    if (!engineRef.current?.retryTutorialLesson()) return;
    setTutorialNotice(`Lesson ${tutorialStep + 1} restarted. Earlier lesson credit is preserved.`);
    setTutorialPaused(false);
    canvasRef.current?.focus({ preventScroll: true });
  }, [tutorialStep]);

  useLayoutEffect(() => {
    tutorialProgressRef.current = {
      completedLessons: tutorialStep,
      completedDrills: collisionQuizStep,
    };
  }, [collisionQuizStep, tutorialStep]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let engine: GameEngine;
    let cancelled = false;
    const raceGateTimers: number[] = [];
    const raceGateAnimationFrames: number[] = [];
    let loadingGateShownAt: number | null = null;
    let finishPresentationTimer = 0;
    if (!tutorial) {
      finishingRef.current = false;
    }
    try {
      const attemptProgress = useAppStore.getState().progress.tracks[trackId];
      engine = new GameEngine({
        canvas,
        trackId,
        mode,
        settings: settingsRef.current,
        initialInputDevice,
        customTrack,
        existingBestMs: attemptProgress.bestSoloMs,
        masteryLevel: attemptProgress.masteryLevel,
        onHud: setHud,
        onFinishStart: () => {
          if (tutorial) return;
          finishingRef.current = true;
          setShowGoSignal(false);
          setRaceGatePhase("finishing");
        },
        onFinish: (result, replay) => {
          if (tutorial) {
            exitTutorial("race-finish");
            return;
          }
          finishRace(result, {
            raceAttempt,
            presentResults: false,
            ...(replay.status === "unavailable"
              ? { replayFailureReason: replay.reason }
              : {}),
          });
          if (replay.status === "complete") {
            const latestRaceState = useAppStore.getState();
            const replayCustomTrack = latestRaceState.raceAttempt === raceAttempt
              ? (latestRaceState.activeRace?.savedCustomTrack ?? customTrack)
              : customTrack;
            void saveReplay(result, replay.samples, replayCustomTrack).catch(() => undefined);
          }
          finishPresentationTimer = window.setTimeout(() => {
            finishPresentationTimer = 0;
            presentRaceResult(raceAttempt);
          }, 650);
        },
        onFatal: setFatal,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "The race could not start.";
      window.setTimeout(() => setFatal(message), 0);
      return;
    }
    engineRef.current = engine;
    if (tutorial) engine.setTutorialLesson(0);
    engine.setPaused(tutorial ? pausedRef.current : true);
    engine.start();
    if (!tutorial) {
      const loadingStartedAt = performance.now();
      const schedule = (delay: number, action: () => void) => {
        raceGateTimers.push(window.setTimeout(() => {
          if (!cancelled) action();
        }, delay));
      };
      const startCountdown = () => {
        if (cancelled) return;
        setShowLoadingGate(false);
        setRaceGatePhase("countdown");
        schedule(1_000, () => setCountdownLabel("2"));
        schedule(2_000, () => setCountdownLabel("1"));
        schedule(3_000, () => {
          setCountdownLabel("GO");
          setShowGoSignal(true);
          const beforeGoPaint = window.requestAnimationFrame(() => {
            if (cancelled) return;
            const afterGoPaint = window.requestAnimationFrame(() => {
              if (!cancelled) setRaceGatePhase("racing");
            });
            raceGateAnimationFrames.push(afterGoPaint);
          });
          raceGateAnimationFrames.push(beforeGoPaint);
        });
        schedule(3_450, () => setShowGoSignal(false));
      };
      schedule(RACE_LOADING_REVEAL_MS, () => {
        loadingGateShownAt = performance.now();
        setShowLoadingGate(true);
      });
      void engine.whenReady().then(() => {
        if (cancelled) return;
        const readyAt = performance.now();
        if (readyAt - loadingStartedAt < RACE_LOADING_REVEAL_MS) {
          startCountdown();
          return;
        }
        const visibleSince = loadingGateShownAt ?? readyAt;
        const remainingVisibleMs = Math.max(0, RACE_LOADING_MINIMUM_VISIBLE_MS - (readyAt - visibleSince));
        schedule(remainingVisibleMs, startCountdown);
      });
    }
    return () => {
      cancelled = true;
      if (finishPresentationTimer) window.clearTimeout(finishPresentationTimer);
      for (const timer of raceGateTimers) window.clearTimeout(timer);
      for (const animationFrame of raceGateAnimationFrames) window.cancelAnimationFrame(animationFrame);
      const currentState = useAppStore.getState();
      const sameSessionSurvives = tutorial
        ? currentState.screen === "tutorial"
          || (currentState.screen === "settings" && currentState.returnScreen === "tutorial")
        : currentState.screen === "race"
          || currentState.screen === "paused"
          || (currentState.screen === "settings" && currentState.returnScreen === "paused");
      const retainRenderer = canvas.isConnected && sameSessionSurvives;
      engine.dispose({ retainRenderer });
      engineRef.current = null;
    };
  }, [customTrack, exitTutorial, finishRace, initialInputDevice, mode, presentRaceResult, raceAttempt, trackId, tutorial, tutorialAttempt]);

  useLayoutEffect(() => {
    if (!tutorial) return;
    engineRef.current?.setTutorialLesson(
      tutorialStep < TUTORIAL_LESSON_COUNT ? tutorialStep : null,
    );
  }, [tutorial, tutorialStep]);

  useLayoutEffect(() => {
    if (!fatal) return;
    const engine = engineRef.current;
    engineRef.current = null;
    engine?.dispose();
  }, [fatal]);

  useEffect(() => {
    settingsRef.current = settings;
    engineRef.current?.updateSettings(settings);
  }, [settings]);

  useLayoutEffect(() => {
    engineRef.current?.setPaused(paused);
    pausedRef.current = paused;
  }, [paused]);

  useLayoutEffect(() => {
    if (finishing) finishingGateRef.current?.focus({ preventScroll: true });
  }, [finishing]);

  useLayoutEffect(() => {
    const wasPauseDialogOpen = wasPauseDialogOpenRef.current;
    const returnedFromSettings = previousScreenRef.current === "settings" && screen !== "settings";

    if (pauseDialogOpen && !wasPauseDialogOpen) {
      const activeElement = document.activeElement;
      pauseReturnFocusRef.current = activeElement instanceof HTMLElement && activeElement !== document.body
        ? activeElement
        : canvasRef.current;
    }

    if (pauseDialogOpen && screen !== "settings" && (!wasPauseDialogOpen || returnedFromSettings)) {
      pauseDialogRef.current?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus({ preventScroll: true });
    }

    if (!pauseDialogOpen && wasPauseDialogOpen) {
      const returnTarget = pauseReturnFocusRef.current;
      const fallbackTarget = canvasRef.current;
      if (returnTarget?.isConnected) returnTarget.focus({ preventScroll: true });
      else fallbackTarget?.focus({ preventScroll: true });
      pauseReturnFocusRef.current = null;
    }

    if (returnedFromSettings && tutorial && !tutorialStarted && !pauseDialogOpen) {
      tutorialSettingsButtonRef.current?.focus({ preventScroll: true });
    }

    wasPauseDialogOpenRef.current = pauseDialogOpen;
    previousScreenRef.current = screen;
  }, [pauseDialogOpen, screen, tutorial, tutorialStarted]);

  useLayoutEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.code !== (settings.controls.keyBindings.pause ?? "Escape")) return;
      if (screen === "settings") return;
      if (
        isInteractiveInputTarget(event.target)
        && ["Enter", "NumpadEnter", "Space"].includes(event.code)
      ) return;
      event.preventDefault();
      if (event.repeat) return;
      if (finishingRef.current) return;
      if (tutorial) {
        if (tutorialStarted) setTutorialPaused((value) => !value);
        return;
      }
      if (raceGatePhase !== "racing") return;
      if (paused) resumeRace(); else pauseRace();
    };
    const onVisibility = () => {
      if (!document.hidden) return;
      if (tutorial) {
        if (tutorialStarted) setTutorialPaused(true);
        return;
      }
      if (finishingRef.current || raceGatePhase === "finishing") return;
      if (raceGatePhase !== "racing" || !paused) pauseRace();
    };
    window.addEventListener("keydown", onKeyDown);
    document.addEventListener("visibilitychange", onVisibility);
    startLifecycleResource("visibilityListenerGroups");
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("visibilitychange", onVisibility);
      stopLifecycleResource("visibilityListenerGroups");
    };
  }, [pauseRace, paused, raceGatePhase, resumeRace, screen, settings.controls.keyBindings.pause, tutorial, tutorialStarted]);

  useEffect(() => {
    let animationFrame = 0;
    let startWasPressed = false;
    const pollPause = () => {
      const pressed = Boolean(firstConnectedGamepad()?.buttons[9]?.pressed);
      if (
        pressed
        && !startWasPressed
        && !finishingRef.current
        && useAppStore.getState().screen !== "settings"
      ) {
        engineRef.current?.input.markGamepadCommand();
        if (tutorial) {
          if (tutorialStarted) setTutorialPaused((value) => !value);
        } else if (raceGatePhase === "racing") {
          if (pausedRef.current) resumeRace(); else pauseRace();
        }
      }
      startWasPressed = pressed;
      animationFrame = requestAnimationFrame(pollPause);
    };
    animationFrame = requestAnimationFrame(pollPause);
    startLifecycleResource("pausePollLoops");
    return () => {
      cancelAnimationFrame(animationFrame);
      stopLifecycleResource("pausePollLoops");
    };
  }, [pauseRace, raceGatePhase, resumeRace, tutorial, tutorialStarted]);

  useEffect(() => {
    if (!tutorial || tutorialPaused || !tutorialStepComplete) return undefined;
    const timer = window.setTimeout(() => {
      setTutorialNotice("");
      setTutorialStep((value) => Math.min(value + 1, tutorialSteps.length));
    }, 550);
    return () => window.clearTimeout(timer);
  }, [tutorial, tutorialPaused, tutorialStep, tutorialStepComplete, tutorialSteps.length]);

  const restartRace = useCallback(() => {
    finishingRef.current = false;
    setRaceGatePhase("loading");
    setShowLoadingGate(false);
    setCountdownLabel("3");
    setShowGoSignal(false);
    retryRace();
  }, [retryRace]);
  const setTouch = (control: "throttle" | "turbo" | "laneChange" | "pitch" | "recover", value: boolean | number) => engineRef.current?.input.setTouchControl(control, value);
  const mirrored = settings.controls.mirroredTouch;
  const laneControl = (direction: LaneChange) => setTouch("laneChange", direction);
  const runLabel = tutorial ? "Training" : mode === "practice" ? "Practice" : mode === "solo" ? "Solo" : null;
  const showCaption = settings.accessibility.captions && Boolean(hud.caption);

  if (fatal) {
    return <main className="fatal-screen"><div><span>Race recovery</span><h1>Race interrupted</h1><p>{fatal}</p><button className="button-primary" onClick={() => window.location.reload()}>Reload race</button><button onClick={() => navigate("title")}>Return to menu</button></div></main>;
  }

  return (
    <main
      className="game-shell"
      data-paused={visuallyPaused}
      data-race-gate-phase={tutorial ? undefined : raceGatePhase}
      aria-busy={!tutorial && raceGatePhase === "loading" ? true : undefined}
      inert={screen === "settings" ? true : undefined}
      aria-hidden={screen === "settings" ? true : undefined}
    >
      <div
        className="game-surface"
        inert={pauseDialogOpen || finishing ? true : undefined}
        aria-hidden={pauseDialogOpen || finishing ? true : undefined}
      >
      <h1 className="sr-only">{tutorial ? `${track.name} training` : `${track.name} ${runLabel ?? mode} race`}</h1>
      <canvas
        key={raceAttempt}
        ref={canvasRef}
        className="game-canvas"
        tabIndex={0}
        aria-label={`Live 3D race on ${track.name}`}
      />
      <div className="race-vignette" aria-hidden="true" />
      <header className="race-hud">
        <div className={`position-block ${runLabel ? "run-label" : ""}`}><span>{runLabel ? "Run" : "Position"}</span><strong>{runLabel ?? `${hud.position} / ${hud.fieldSize}`}</strong></div>
        <div className="timing-block"><span>Lap <b>{hud.lap}</b> / {hud.totalLaps}</span><strong>{formatTime(hud.elapsedMs)}</strong></div>
        <div className="target-hud">
          <span>Target</span>
          <strong>{mode === "practice" || mode === "custom" || tutorial ? "Free ride" : formatTime(hud.targetMs)}</strong>
          {mode === "solo" ? <small>Saved best <b>{hud.savedBestMs === undefined ? "No time" : formatTime(hud.savedBestMs)}</b></small> : null}
        </div>
        {(tutorial ? tutorialStarted : raceGatePhase === "racing") ? (
          <button
            className="pause-button"
            aria-label={visuallyPaused ? (tutorial ? "Resume training" : "Resume race") : (tutorial ? "Pause training" : "Pause race")}
            onClick={() => {
              if (tutorial) setTutorialPaused((value) => !value);
              else if (paused) resumeRace();
              else pauseRace();
            }}
          >
            <RallyIcon kind={visuallyPaused ? "play" : "pause"} />
          </button>
        ) : null}
      </header>
      <div className="race-bottom">
        <HeatMeter heat={hud.heat} overheated={hud.overheated} />
        <p className="race-hint">{hud.hint}</p>
      </div>
      {!tutorial && ((raceGatePhase === "loading" && showLoadingGate) || raceGatePhase === "countdown" || showGoSignal) ? (
        <section
          className={`race-start-gate${raceGatePhase === "loading" ? " loading-gate" : ""}${showGoSignal ? " go-signal" : ""}`}
          role="status"
          aria-live={raceGatePhase === "loading" ? "polite" : "assertive"}
          aria-atomic="true"
          data-gate-mode={raceGatePhase === "loading" ? "loading" : countdownLabel === "GO" ? "go" : "countdown"}
          aria-label={raceGatePhase === "loading"
            ? `Loading ${track.name} race`
            : countdownLabel === "GO"
              ? "Go. Ride now."
              : `Race starts in ${countdownLabel}`}
        >
          {raceGatePhase === "loading" ? (
            <>
              <span>Preparing the ridge</span>
              <h2>{track.name}</h2>
              <div className="loading-track race-loading-track" aria-hidden="true"><span /></div>
              <p>Loading rider, course, and race systems…</p>
            </>
          ) : (
            <>
              <span>Ready at the gate</span>
              <strong key={countdownLabel}>{countdownLabel}</strong>
              <p>{countdownLabel === "GO" ? "Ride!" : "Race time starts after GO"}</p>
            </>
          )}
        </section>
      ) : null}
      {!tutorial && showCaption ? <p className="caption-cue" role="status"><span aria-hidden="true">!</span>{hud.caption}</p> : null}
      {hud.bikePhase === "crashed" ? (
        <RecoveryPrompt hint={hud.hint} progress={hud.recoveryProgress} />
      ) : null}
      <p className="input-device" aria-live="polite">{hud.inputDevice === "gamepad" ? "Gamepad controls" : hud.inputDevice === "touch" ? "Touch controls" : "Keyboard controls"}</p>
      <div
        className={`touch-controls ${mirrored ? "mirrored" : ""}`}
        data-touch-icon-set="rally-pictograms-v1"
        role="group"
        aria-label="Touch race controls"
      >
        <div className="touch-steering">
          <div className="touch-rocker touch-lane-rocker" role="group" aria-label="Lane controls">
            <TouchButton label="Move one lane left" className="" dataControl="lane-left" displayLabel={<TouchControlIcon kind="lane-left" />} activation="pulse" resetPressed={resetTouchControls} onChange={(pressed) => laneControl(pressed ? -1 : 0)} />
            <TouchButton label="Move one lane right" className="" dataControl="lane-right" displayLabel={<TouchControlIcon kind="lane-right" />} activation="pulse" resetPressed={resetTouchControls} onChange={(pressed) => laneControl(pressed ? 1 : 0)} />
          </div>
          <PitchTouchControls resetPressed={resetTouchControls} onChange={(direction) => setTouch("pitch", direction)} />
        </div>
        <div className="touch-throttle" role="group" aria-label="Ride controls">
          <TouchButton label="Ride" className="touch-ride" dataControl="ride" displayLabel={<TouchControlIcon kind="ride" label="Ride" />} activation="hold" resetPressed={resetTouchControls} onChange={(value) => { setTouch("throttle", value); setTouch("recover", value); }} />
          <TouchButton label="Turbo" className="touch-turbo" dataControl="turbo" displayLabel={<TouchControlIcon kind="turbo" label="Turbo" />} activation="hold" resetPressed={resetTouchControls} onChange={(value) => setTouch("turbo", value)} />
        </div>
      </div>
      {tutorial && !tutorialPaused ? (
        <aside className={`tutorial-card ${!tutorialStarted ? "tutorial-intro" : ""}`} aria-label="Rider school lesson">
          <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">{tutorialAnnouncement}</p>
          {showCaption ? <p className="tutorial-caption-cue" aria-atomic="true"><span aria-hidden="true">!</span>{hud.caption}</p> : null}
          {!tutorialStarted ? (
            <>
              <span>First ride · 12 lessons + 2 contact drills</span>
              <h2>Rider school</h2>
              {persistenceStatus.mode === "session" ? (
                <div className="tutorial-session-notice" role="alert">
                  <strong>Device saving unavailable</strong>
                  <p>Rider School remains playable in session mode. New progress may disappear when this tab closes; skip or finish training to open recovery steps.</p>
                </div>
              ) : null}
              <p>Learn the full race loop on a purpose-built training route. Each lesson waits until you perform the action.</p>
              <div className="tutorial-control-map" aria-label="Current controls">
                <span>Ride</span><strong>{tutorialControls.ride}</strong>
                <span>Turbo</span><strong>{tutorialControls.turbo}</strong>
                <span>Lanes</span><strong>{tutorialControls.lane}</strong>
                <span>Pitch</span><strong>{tutorialControls.pitch}</strong>
                <span>Recover</span><strong>{formatTutorialHoldControl(tutorialControls.recover)}</strong>
                <span>Pause</span><strong>{tutorialControls.pause}</strong>
              </div>
              <p className="tutorial-objective">Pause freezes the lesson. Restart training resets the route and checklist.</p>
              <button className="button-primary tutorial-start" onClick={() => setTutorialStarted(true)}>Start lesson 1</button>
              <button ref={tutorialSettingsButtonRef} onClick={openSettings}>Settings and controls</button>
              <button className="tutorial-skip" onClick={() => exitTutorial("skip")}>Skip training</button>
            </>
          ) : tutorialStep < tutorialSteps.length ? (
            <>
              {tutorialNotice ? <p className="tutorial-notice" role="status">{tutorialNotice}</p> : null}
              <div className="tutorial-progress" role="list" aria-label={`Lesson progress: lesson ${tutorialStep + 1} of ${tutorialSteps.length}`}>
                {tutorialSteps.map((step, index) => {
                  const markerState = index < tutorialStep
                    ? "complete"
                    : index === tutorialStep
                      ? "active"
                      : "future";
                  const markerLabel = markerState === "complete"
                    ? "completed"
                    : markerState === "active"
                      ? "current"
                      : "not started";
                  return (
                    <span
                      key={step.title}
                      role="listitem"
                      data-state={markerState}
                      aria-label={`Lesson ${index + 1}: ${markerLabel}`}
                    >
                      {markerState === "complete" ? "✓" : markerState === "active" ? <RallyIcon kind="play" className="progress-icon" /> : index + 1}
                    </span>
                  );
                })}
              </div>
              <span>Lesson {tutorialStep + 1} / {tutorialSteps.length}</span>
              <h2>{tutorialSteps[tutorialStep]?.title}</h2>
              <p>{tutorialSteps[tutorialStep]?.copy}</p>
              <strong className="tutorial-control">{tutorialSteps[tutorialStep]?.control}</strong>
              <small>{tutorialStepComplete ? "Lesson cleared" : "Complete the action to continue"}</small>
              {!tutorialStepComplete ? (
                <button
                  className="tutorial-retry"
                  disabled={!tutorialLessonSynchronized}
                  onClick={retryTutorialLesson}
                >
                  Retry this lesson
                </button>
              ) : null}
              <button className="tutorial-skip" onClick={() => exitTutorial("skip")}>Skip training</button>
            </>
          ) : collisionQuizStep === 0 ? (
            <>
              <ContactDrillProgress completedDrills={collisionQuizStep} />
              <span>Contact drill · 1 / 2</span><h2>Rival contact</h2>
              <p>You catch a slower rider and hit their rear wheel. Who crashes?</p>
              <div className="tutorial-answers"><button className="button-primary" onClick={() => { setCollisionQuizError(""); setCollisionQuizStep(1); }}>I crash</button><button onClick={() => setCollisionQuizError("Not quite — the rider who hits from behind crashes.")}>Rider ahead crashes</button></div>
              {collisionQuizError ? <small role="alert">{collisionQuizError}</small> : null}
            </>
          ) : collisionQuizStep === 1 ? (
            <>
              <ContactDrillProgress completedDrills={collisionQuizStep} />
              <span>Contact drill · 2 / 2</span><h2>Rear-wheel defense</h2>
              <p>A pursuing rider clips your rear wheel from behind. Who crashes?</p>
              <div className="tutorial-answers"><button className="button-primary" onClick={() => { setCollisionQuizError(""); setCollisionQuizStep(2); }}>Pursuer crashes</button><button onClick={() => setCollisionQuizError("Protect your line — the pursuer who clips you from behind crashes.")}>I crash</button></div>
              {collisionQuizError ? <small role="alert">{collisionQuizError}</small> : null}
            </>
          ) : (
            <>
              <ContactDrillProgress completedDrills={collisionQuizStep} />
              <span>Training cleared</span><h2>Race fair, ride bold</h2>
              <p>You rode, coasted, managed heat, cooled, changed lanes, shaped and landed a jump, read hazards, handled slow terrain, recovered from a crash, and learned both contact rules.</p>
              <div className="tutorial-control-map tutorial-control-map-compact" aria-label="Control recap">
                <span>Ride</span><strong>{tutorialControls.ride}</strong>
                <span>Turbo</span><strong>{tutorialControls.turbo}</strong>
                <span>Lanes</span><strong>{tutorialControls.lane}</strong>
                <span>Pitch</span><strong>{tutorialControls.pitch}</strong>
                <span>Recover</span><strong>{formatTutorialHoldControl(tutorialControls.recover)}</strong>
                <span>Pause</span><strong>{tutorialControls.pause}</strong>
              </div>
              <button className="button-primary" onClick={() => exitTutorial("earned")}>Enter the festival</button>
            </>
          )}
        </aside>
      ) : null}
      <output className="performance-hud" aria-label="Performance metrics">{hud.fps || "--"} FPS · {hud.frameTimeMs || "--"} ms · {hud.drawCalls} draws · {Math.round(hud.droppedSimulationMs)} ms dropped</output>
      </div>
      {finishing ? (
        <section
          ref={finishingGateRef}
          className="race-start-gate finish-classification-gate"
          role="status"
          tabIndex={-1}
          aria-live="assertive"
          aria-atomic="true"
          aria-label={`Finish confirmed on ${track.name}. Finalizing official field results.`}
        >
          <span>Finish confirmed</span>
          <h2>Finalizing results</h2>
          <p>Calculating the official field order…</p>
        </section>
      ) : tutorial && tutorialPaused ? (
        <section ref={pauseDialogRef} className="pause-overlay" role="dialog" aria-modal="true" aria-label="Training paused" onKeyDown={containDialogFocus}>
          <p>Training paused</p><h1>{track.name}</h1>
          <small>The clock and rider input are frozen. Resume this lesson or reset the complete training route.</small>
          <button className="button-primary" onClick={() => setTutorialPaused(false)}>Resume lesson</button>
          <button onClick={openSettings}>Settings</button>
          <button onClick={() => restartTutorial()}>Restart training</button>
          <button onClick={() => exitTutorial("skip")}>Skip training and return to festival</button>
        </section>
      ) : !tutorial && appPaused && raceGatePhase === "racing" ? (
        <section ref={pauseDialogRef} className="pause-overlay" role="dialog" aria-modal="true" aria-label="Race paused" onKeyDown={containDialogFocus}>
          <p>Race paused</p><h1>{track.name}</h1>
          <button className="button-primary" onClick={resumeRace}>Resume</button>
          <button onClick={openSettings}>Settings</button>
          <button onClick={restartRace}>Restart now</button>
          {mode === "custom"
            ? <button onClick={() => navigate("editor")}>Return to Track Builder</button>
            : <button onClick={() => navigate("mode-select")}>Change mode</button>}
          <button onClick={() => navigate("title")}>Festival menu</button>
        </section>
      ) : null}
    </main>
  );
}

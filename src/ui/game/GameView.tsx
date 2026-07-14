import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { useAppStore } from "../../app/store";
import { GameEngine, type EngineHudState } from "../../game/engine/GameEngine";
import type { LaneChange } from "../../game/simulation";
import { getTrack } from "../../game/content/tracks";
import { customTrackToDefinition } from "../../game/editor/toTrackDefinition";
import { formatKeyCode } from "../../game/input/keyLabels";
import { saveReplay } from "../../game/persistence/database";
import {
  startLifecycleResource,
  stopLifecycleResource,
} from "../../game/qa/lifecycleDiagnostics";
import { formatTime } from "../format";

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
  demonstrated: {
    coast: false,
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
};

interface TutorialStep {
  title: string;
  copy: string;
  control: string;
  complete: (hud: EngineHudState) => boolean;
}

function getTutorialControls(hud: EngineHudState, bindings: Record<string, string>) {
  if (hud.inputDevice === "gamepad") {
    return {
      ride: "A / RT",
      turbo: "B / LT",
      lane: "D-pad or left stick ← / →",
      pitch: "left stick ↑ / ↓",
      recover: "hold A",
      pause: "Start",
    };
  }
  if (hud.inputDevice === "touch") {
    return {
      ride: "RIDE",
      turbo: "TURBO",
      lane: "← / → rocker",
      pitch: "↑ / ↓ rocker",
      recover: "hold RIDE",
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
      complete: (state) => state.speed >= 5,
    },
    {
      title: "Coast to slow",
      copy: "There is no separate brake: release Ride before a tight line or hot section and the bike coasts down safely.",
      control: `Release ${controls.ride}`,
      complete: (state) => state.demonstrated.coast,
    },
    {
      title: "Choose a lane",
      copy: "Use the left and right directions. One press commits one lane, so choose early instead of weaving constantly.",
      control: controls.lane,
      complete: (state) => state.demonstrated.laneChange,
    },
    {
      title: "Turbo and heat",
      copy: "Turbo adds speed and heat. Reach the white warning marker, then release before the red zone disables control.",
      control: `Hold ${controls.turbo}`,
      complete: (state) => state.heat >= 78,
    },
    {
      title: "Cool the bike",
      copy: "Release Turbo and pass through the cyan snowflake gate. Cooling gates remove heat much faster than coasting.",
      control: `Release ${controls.turbo}`,
      complete: (state) => state.demonstrated.coolingRelease,
    },
    {
      title: "Wheelie the bump",
      copy: "Raise the front wheel while grounded to skim the bump and keep speed. Holding a wheelie too long will crash.",
      control: controls.pitch.split(" / ")[0] ?? controls.pitch,
      complete: (state) => state.demonstrated.wheelie,
    },
    {
      title: "Shape the jump",
      copy: "Pitch nose-up after takeoff, then nose-down and release the control so the bike returns toward level.",
      control: controls.pitch,
      complete: (state) => state.demonstrated.airbornePitchUp
        && state.demonstrated.airbornePitchDown
        && state.demonstrated.airborneNeutral,
    },
    {
      title: "Land both wheels",
      copy: "Touch down nearly level to keep momentum. Steep landings are rough; extreme angles cause a fair crash.",
      control: "Level the bike before touchdown",
      complete: (state) => state.demonstrated.cleanLanding,
    },
    {
      title: "Read the barrier",
      copy: "Striped barriers are hard hazards. Move into an open lane before the barrier reaches the rider.",
      control: controls.lane,
      complete: (state) => state.demonstrated.hazardAvoided,
    },
    {
      title: "Mud slowdown",
      copy: "Ride through the glossy ruts and feel the speed fall. Mud slows the player and every rival by the same rules.",
      control: "Keep the bike steady",
      complete: (state) => state.demonstrated.mud,
    },
    {
      title: "Track edges",
      copy: "Grass and off-line terrain reduce grip. Return to the marked dirt lanes for full acceleration and control.",
      control: controls.lane,
      complete: (state) => state.demonstrated.grass,
    },
    {
      title: "Crash and recover",
      copy: "The training barrier will stop the bike. Hold Recover until the meter fills; tapping is optional in Settings.",
      control: `Hold ${controls.recover}`,
      complete: (state) => state.demonstrated.crash && state.demonstrated.recovery,
    },
  ];
}

function HeatMeter({ heat, overheated }: { heat: number; overheated: boolean }) {
  return (
    <div className={`heat-meter ${overheated ? "overheated" : ""}`} aria-label={`Heat ${Math.round(heat)} percent${overheated ? ", overheated" : ""}`} role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(heat)}>
      <strong>Heat</strong>
      <div className="heat-track"><span style={{ width: `${heat}%` }} /><i className="heat-warning" aria-hidden="true" /></div>
      {overheated ? <b>!</b> : null}
    </div>
  );
}

interface TouchButtonProps {
  label: string;
  className: string;
  onChange: (pressed: boolean) => void;
}

function TouchButton({ label, className, onChange }: TouchButtonProps) {
  return <button className={className} aria-label={label} onPointerDown={(event) => {
    onChange(true);
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // Some embedded browsers reject capture while still delivering the press.
    }
  }} onPointerUp={() => onChange(false)} onPointerCancel={() => onChange(false)}>{label}</button>;
}

export function GameView({ tutorial = false }: { tutorial?: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<GameEngine | null>(null);
  const screen = useAppStore((state) => state.screen);
  const returnScreen = useAppStore((state) => state.returnScreen);
  const settings = useAppStore((state) => state.settings);
  const progress = useAppStore((state) => state.progress);
  const activeRace = useAppStore((state) => state.activeRace);
  const raceAttempt = useAppStore((state) => state.raceAttempt);
  const finishRace = useAppStore((state) => state.finishRace);
  const retryRace = useAppStore((state) => state.retryRace);
  const completeTutorial = useAppStore((state) => state.completeTutorial);
  const pauseRace = useAppStore((state) => state.pauseRace);
  const resumeRace = useAppStore((state) => state.resumeRace);
  const openSettings = useAppStore((state) => state.openSettings);
  const navigate = useAppStore((state) => state.navigate);
  const [hud, setHud] = useState(INITIAL_HUD);
  const [fatal, setFatal] = useState<string | null>(null);
  const [tutorialStarted, setTutorialStarted] = useState(false);
  const [tutorialPaused, setTutorialPaused] = useState(false);
  const [tutorialAttempt, setTutorialAttempt] = useState(0);
  const [tutorialStep, setTutorialStep] = useState(0);
  const [collisionQuizStep, setCollisionQuizStep] = useState(0);
  const [collisionQuizError, setCollisionQuizError] = useState("");
  const settingsRef = useRef(settings);
  const trackId = tutorial ? "canyon-kickoff" : (activeRace?.trackId ?? progress.selectedTrackId);
  const mode = tutorial ? "tutorial" : (activeRace?.mode ?? "practice");
  const track = activeRace?.customTrack
    ? customTrackToDefinition(activeRace.customTrack)
    : getTrack(trackId);
  const appPaused = screen === "paused" || (screen === "settings" && returnScreen === "paused");
  const paused = tutorial ? !tutorialStarted || tutorialPaused : appPaused;
  const pausedRef = useRef(paused);
  const tutorialSteps = tutorial
    ? getTutorialSteps(hud, settings.controls.keyBindings)
    : [];
  const tutorialControls = getTutorialControls(hud, settings.controls.keyBindings);
  const tutorialStepComplete = tutorial
    ? Boolean(tutorialStarted && tutorialSteps[tutorialStep]?.complete(hud))
    : false;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let engine: GameEngine;
    try {
      engine = new GameEngine({
        canvas,
        trackId,
        mode,
        settings: settingsRef.current,
        customTrack: activeRace?.customTrack,
        existingBestMs: progress.tracks[trackId].bestSoloMs,
        masteryLevel: progress.tracks[trackId].masteryLevel,
        onHud: setHud,
        onFinish: (result, replaySamples) => {
          if (tutorial) {
            completeTutorial();
          } else {
            void saveReplay(result, replaySamples).catch(() => undefined);
            finishRace(result);
          }
        },
        onFatal: setFatal,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "The race could not start.";
      window.setTimeout(() => setFatal(message), 0);
      return;
    }
    engineRef.current = engine;
    engine.start();
    return () => {
      const currentState = useAppStore.getState();
      const sameSessionSurvives = tutorial
        ? currentState.screen === "tutorial"
        : currentState.screen === "race"
          || currentState.screen === "paused"
          || (currentState.screen === "settings" && currentState.returnScreen === "paused");
      const retainRenderer = canvas.isConnected && sameSessionSurvives;
      engine.dispose({ retainRenderer });
      engineRef.current = null;
    };
  }, [activeRace?.customTrack, completeTutorial, finishRace, mode, progress.tracks, raceAttempt, trackId, tutorial, tutorialAttempt]);

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

  useEffect(() => {
    engineRef.current?.setPaused(paused);
    pausedRef.current = paused;
  }, [paused]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.code !== (settings.controls.keyBindings.pause ?? "Escape")) return;
      if (screen === "settings") return;
      event.preventDefault();
      if (tutorial) {
        if (tutorialStarted) setTutorialPaused((value) => !value);
        return;
      }
      if (paused) resumeRace(); else pauseRace();
    };
    const onVisibility = () => {
      if (document.hidden && !tutorial && !paused) pauseRace();
    };
    window.addEventListener("keydown", onKeyDown);
    document.addEventListener("visibilitychange", onVisibility);
    startLifecycleResource("visibilityListenerGroups");
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("visibilitychange", onVisibility);
      stopLifecycleResource("visibilityListenerGroups");
    };
  }, [pauseRace, paused, resumeRace, screen, settings.controls.keyBindings.pause, tutorial, tutorialStarted]);

  useEffect(() => {
    let animationFrame = 0;
    let startWasPressed = false;
    const pollPause = () => {
      const pressed = Boolean(navigator.getGamepads?.()[0]?.buttons[9]?.pressed);
      if (pressed && !startWasPressed && useAppStore.getState().screen !== "settings") {
        if (tutorial) {
          if (tutorialStarted) setTutorialPaused((value) => !value);
        } else if (pausedRef.current) resumeRace(); else pauseRace();
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
  }, [pauseRace, resumeRace, tutorial, tutorialStarted]);

  useEffect(() => {
    if (!tutorial) return undefined;
    if (tutorialStepComplete) {
      const timer = window.setTimeout(() => setTutorialStep((value) => Math.min(value + 1, tutorialSteps.length)), 550);
      return () => window.clearTimeout(timer);
    }
    return undefined;
  }, [tutorial, tutorialStep, tutorialStepComplete, tutorialSteps.length]);

  const setTouch = (control: "throttle" | "turbo" | "laneChange" | "pitch" | "recover", value: boolean | number) => engineRef.current?.input.setTouchControl(control, value);
  const mirrored = settings.controls.mirroredTouch;
  const laneControl = (direction: LaneChange) => setTouch("laneChange", direction);
  const runLabel = tutorial ? "Training" : mode === "practice" ? "Practice" : mode === "solo" ? "Solo" : null;
  const restartTutorial = () => {
    setHud(INITIAL_HUD);
    setTutorialStep(0);
    setCollisionQuizStep(0);
    setCollisionQuizError("");
    setTutorialPaused(false);
    setTutorialStarted(true);
    setTutorialAttempt((value) => value + 1);
  };

  if (fatal) {
    return <main className="fatal-screen"><div><span>Graphics recovery</span><h1>Race paused at the gate</h1><p>{fatal}</p><button className="button-primary" onClick={() => window.location.reload()}>Retry loading</button><button onClick={() => navigate("title")}>Return to menu</button></div></main>;
  }

  const visuallyPaused = tutorial ? tutorialPaused : paused;

  return (
    <main className="game-shell" data-paused={visuallyPaused} inert={screen === "settings" ? true : undefined} aria-hidden={screen === "settings" ? true : undefined}>
      <h1 className="sr-only">{tutorial ? `${track.name} training` : `${track.name} ${runLabel ?? mode} race`}</h1>
      <canvas ref={canvasRef} className="game-canvas" tabIndex={0} aria-label={`Live 3D race on ${track.name}`} />
      <div className="race-vignette" aria-hidden="true" />
      <header className="race-hud">
        <div className={`position-block ${runLabel ? "run-label" : ""}`}><span>{runLabel ? "Run" : "Position"}</span><strong>{runLabel ?? `${hud.position} / ${hud.fieldSize}`}</strong></div>
        <div className="timing-block"><span>Lap <b>{hud.lap}</b> / {hud.totalLaps}</span><strong>{formatTime(hud.elapsedMs)}</strong></div>
        <div className="target-hud">
          <span>Target</span>
          <strong>{mode === "practice" || mode === "custom" || tutorial ? "Free ride" : formatTime(hud.targetMs)}</strong>
          {mode === "solo" ? <small>Saved best <b>{hud.savedBestMs === undefined ? "No time" : formatTime(hud.savedBestMs)}</b></small> : null}
        </div>
        {!tutorial || tutorialStarted ? (
          <button
            className="pause-button"
            aria-label={visuallyPaused ? (tutorial ? "Resume training" : "Resume race") : (tutorial ? "Pause training" : "Pause race")}
            onClick={() => {
              if (tutorial) setTutorialPaused((value) => !value);
              else if (paused) resumeRace();
              else pauseRace();
            }}
          >
            {visuallyPaused ? "▶" : "Ⅱ"}
          </button>
        ) : null}
      </header>
      <div className="race-bottom">
        <HeatMeter heat={hud.heat} overheated={hud.overheated} />
        <p className="race-hint">{hud.hint}</p>
      </div>
      {settings.accessibility.captions && hud.caption ? <p className="caption-cue" role="status"><span aria-hidden="true">!</span>{hud.caption}</p> : null}
      {hud.bikePhase === "crashed" ? <div className="recover-prompt"><strong>Hold to recover</strong><div><span style={{ width: `${hud.recoveryProgress * 100}%` }} /></div></div> : null}
      <p className="input-device" aria-live="polite">{hud.inputDevice === "gamepad" ? "Gamepad controls" : hud.inputDevice === "touch" ? "Touch controls" : "Keyboard controls"}</p>
      <div className={`touch-controls ${mirrored ? "mirrored" : ""}`} aria-label="Touch race controls">
        <div className="touch-steering">
          <button aria-label="Move one lane left" onPointerDown={() => laneControl(-1)} onPointerUp={() => laneControl(0)} onPointerCancel={() => laneControl(0)}>←</button>
          <button aria-label="Move one lane right" onPointerDown={() => laneControl(1)} onPointerUp={() => laneControl(0)} onPointerCancel={() => laneControl(0)}>→</button>
          <button aria-label="Pitch front wheel up" onPointerDown={() => setTouch("pitch", 1)} onPointerUp={() => setTouch("pitch", 0)} onPointerCancel={() => setTouch("pitch", 0)}>↑</button>
          <button aria-label="Pitch front wheel down" onPointerDown={() => setTouch("pitch", -1)} onPointerUp={() => setTouch("pitch", 0)} onPointerCancel={() => setTouch("pitch", 0)}>↓</button>
        </div>
        <div className="touch-throttle">
          <TouchButton label="Ride" className="touch-ride" onChange={(value) => { setTouch("throttle", value); setTouch("recover", value); }} />
          <TouchButton label="Turbo" className="touch-turbo" onChange={(value) => setTouch("turbo", value)} />
        </div>
      </div>
      {tutorial && !tutorialPaused ? (
        <aside className={`tutorial-card ${!tutorialStarted ? "tutorial-intro" : ""}`} aria-label="Rider school lesson" aria-live="polite">
          {!tutorialStarted ? (
            <>
              <span>First ride · 12 guided lessons</span>
              <h2>Rider school</h2>
              <p>Learn the full race loop on a purpose-built training route. Each lesson waits until you perform the action.</p>
              <div className="tutorial-control-map" aria-label="Current controls">
                <span>Ride</span><strong>{tutorialControls.ride}</strong>
                <span>Turbo</span><strong>{tutorialControls.turbo}</strong>
                <span>Lanes</span><strong>{tutorialControls.lane}</strong>
                <span>Pitch</span><strong>{tutorialControls.pitch}</strong>
                <span>Recover</span><strong>{tutorialControls.recover}</strong>
                <span>Pause</span><strong>{tutorialControls.pause}</strong>
              </div>
              <p className="tutorial-objective">Pause freezes the lesson. Restart training resets the route and checklist.</p>
              <button className="button-primary tutorial-start" onClick={() => setTutorialStarted(true)}>Start lesson 1</button>
              <button className="tutorial-skip" onClick={completeTutorial}>Skip training</button>
            </>
          ) : tutorialStep < tutorialSteps.length ? (
            <>
              <div className="tutorial-progress" aria-label={`Lesson ${tutorialStep + 1} of ${tutorialSteps.length}`}>
                {tutorialSteps.map((step, index) => <span key={step.title} data-state={index < tutorialStep ? "complete" : index === tutorialStep ? "active" : "future"} />)}
              </div>
              <span>Lesson {tutorialStep + 1} / {tutorialSteps.length}</span>
              <h2>{tutorialSteps[tutorialStep]?.title}</h2>
              <p>{tutorialSteps[tutorialStep]?.copy}</p>
              <strong className="tutorial-control">{tutorialSteps[tutorialStep]?.control}</strong>
              <small>{tutorialStepComplete ? "Lesson cleared" : "Complete the action to continue"}</small>
              <button className="tutorial-skip" onClick={completeTutorial}>Skip training</button>
            </>
          ) : collisionQuizStep === 0 ? (
            <>
              <span>Contact drill · 1 / 2</span><h2>Rival contact</h2>
              <p>You catch a slower rider and hit their rear wheel. Who crashes?</p>
              <div className="tutorial-answers"><button className="button-primary" onClick={() => { setCollisionQuizError(""); setCollisionQuizStep(1); }}>I crash</button><button onClick={() => setCollisionQuizError("Not quite — the rider who hits from behind crashes.")}>Rider ahead crashes</button></div>
              {collisionQuizError ? <small role="alert">{collisionQuizError}</small> : null}
            </>
          ) : collisionQuizStep === 1 ? (
            <>
              <span>Contact drill · 2 / 2</span><h2>Rear-wheel defense</h2>
              <p>A pursuing rider clips your rear wheel from behind. Who crashes?</p>
              <div className="tutorial-answers"><button className="button-primary" onClick={() => { setCollisionQuizError(""); setCollisionQuizStep(2); }}>Pursuer crashes</button><button onClick={() => setCollisionQuizError("Protect your line — the pursuer who clips you from behind crashes.")}>I crash</button></div>
              {collisionQuizError ? <small role="alert">{collisionQuizError}</small> : null}
            </>
          ) : (
            <>
              <span>Training cleared</span><h2>Race fair, ride bold</h2>
              <p>You rode, coasted, managed heat, cooled, changed lanes, shaped and landed a jump, read hazards, handled slow terrain, recovered from a crash, and learned both contact rules.</p>
              <div className="tutorial-control-map tutorial-control-map-compact" aria-label="Control recap">
                <span>Lanes</span><strong>{tutorialControls.lane}</strong>
                <span>Pitch</span><strong>{tutorialControls.pitch}</strong>
                <span>Pause</span><strong>{tutorialControls.pause}</strong>
              </div>
              <button className="button-primary" onClick={completeTutorial}>Enter the festival</button>
            </>
          )}
        </aside>
      ) : null}
      {tutorial && tutorialPaused ? (
        <section className="pause-overlay" role="dialog" aria-modal="true" aria-label="Training paused">
          <p>Training paused</p><h1>{track.name}</h1>
          <small>The clock and rider input are frozen. Resume this lesson or reset the complete training route.</small>
          <button className="button-primary" onClick={() => setTutorialPaused(false)}>Resume lesson</button>
          <button onClick={restartTutorial}>Restart training</button>
          <button onClick={() => navigate("title")}>Festival menu</button>
        </section>
      ) : !tutorial && paused ? (
        <section className="pause-overlay" role="dialog" aria-modal="true" aria-label="Race paused">
          <p>Race paused</p><h1>{track.name}</h1>
          <button className="button-primary" onClick={resumeRace}>Resume</button>
          <button onClick={openSettings}>Settings</button>
          <button onClick={retryRace}>Restart now</button>
          <button onClick={() => navigate("mode-select")}>Change mode</button>
          <button onClick={() => navigate("title")}>Festival menu</button>
        </section>
      ) : null}
      <output className="performance-hud" aria-label="Performance metrics">{hud.fps || "--"} FPS · {hud.frameTimeMs || "--"} ms · {hud.drawCalls} draws · {Math.round(hud.droppedSimulationMs)} ms dropped</output>
    </main>
  );
}

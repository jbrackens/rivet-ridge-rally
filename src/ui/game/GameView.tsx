import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { useAppStore } from "../../app/store";
import { GameEngine, type EngineHudState } from "../../game/engine/GameEngine";
import type { LaneChange } from "../../game/simulation";
import { getTrack } from "../../game/content/tracks";
import { customTrackToDefinition } from "../../game/editor/toTrackDefinition";
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
    cooling: false,
    laneChange: false,
    wheelie: false,
    airbornePitch: false,
    cleanLanding: false,
    mud: false,
    grass: false,
  },
};

const TUTORIAL_STEPS = [
  { title: "Ride", copy: "Hold W, RIDE, or the south gamepad button to build speed.", complete: (hud: EngineHudState) => hud.speed >= 5 },
  { title: "Turbo and heat", copy: "Hold Shift, TURBO, or the east button until the warning marker. Release before overheat.", complete: (hud: EngineHudState) => hud.heat >= 78 },
  { title: "Cooling gates", copy: "Release turbo and pass through a cyan gate. Cyan arches also use a snowflake shape.", complete: (hud: EngineHudState) => hud.demonstrated.cooling },
  { title: "Choose a lane", copy: "Tap A / D, the direction rocker, or the left stick. A lane move commits once per press.", complete: (hud: EngineHudState) => hud.demonstrated.laneChange },
  { title: "Wheelie the bump", copy: "Hold ↑ or pull back while grounded. Keep the front wheel raised to clear the bump ahead.", complete: (hud: EngineHudState) => hud.demonstrated.wheelie },
  { title: "Air control", copy: "Pull back for lift as the ramp launches, then press ↓ to bring both wheels near level before touchdown.", complete: (hud: EngineHudState) => hud.demonstrated.airbornePitch },
  { title: "Clean landing", copy: "Land nearly level to retain momentum. A harsh angle causes a fair crash.", complete: (hud: EngineHudState) => hud.demonstrated.cleanLanding },
  { title: "Mud slowdown", copy: "Ride through the glossy mud and feel the speed fall. Mud slows every rider.", complete: (hud: EngineHudState) => hud.demonstrated.mud },
  { title: "Track edges", copy: "Grass and off-line terrain also reduce grip. Return to dirt for full pace.", complete: (hud: EngineHudState) => hud.demonstrated.grass },
] as const;

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
  const [tutorialStep, setTutorialStep] = useState(0);
  const [collisionQuizStep, setCollisionQuizStep] = useState(0);
  const [collisionQuizError, setCollisionQuizError] = useState("");
  const settingsRef = useRef(settings);
  const trackId = tutorial ? "canyon-kickoff" : (activeRace?.trackId ?? progress.selectedTrackId);
  const mode = tutorial ? "tutorial" : (activeRace?.mode ?? "practice");
  const track = activeRace?.customTrack
    ? customTrackToDefinition(activeRace.customTrack)
    : getTrack(trackId);
  const paused = screen === "paused" || (screen === "settings" && returnScreen === "paused");
  const pausedRef = useRef(paused);
  const tutorialStepComplete = tutorial
    ? Boolean(TUTORIAL_STEPS[tutorialStep]?.complete(hud))
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
  }, [activeRace?.customTrack, completeTutorial, finishRace, mode, progress.tracks, raceAttempt, trackId, tutorial]);

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
      if (tutorial) return;
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
  }, [pauseRace, paused, resumeRace, screen, settings.controls.keyBindings.pause, tutorial]);

  useEffect(() => {
    if (tutorial) return undefined;
    let animationFrame = 0;
    let startWasPressed = false;
    const pollPause = () => {
      const pressed = Boolean(navigator.getGamepads?.()[0]?.buttons[9]?.pressed);
      if (pressed && !startWasPressed && useAppStore.getState().screen !== "settings") {
        if (pausedRef.current) resumeRace(); else pauseRace();
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
  }, [pauseRace, resumeRace, tutorial]);

  useEffect(() => {
    if (!tutorial) return undefined;
    if (tutorialStepComplete) {
      const timer = window.setTimeout(() => setTutorialStep((value) => Math.min(value + 1, TUTORIAL_STEPS.length)), 550);
      return () => window.clearTimeout(timer);
    }
    return undefined;
  }, [tutorial, tutorialStep, tutorialStepComplete]);

  const setTouch = (control: "throttle" | "turbo" | "laneChange" | "pitch" | "recover", value: boolean | number) => engineRef.current?.input.setTouchControl(control, value);
  const mirrored = settings.controls.mirroredTouch;
  const laneControl = (direction: LaneChange) => setTouch("laneChange", direction);
  const runLabel = tutorial ? "Training" : mode === "practice" ? "Practice" : mode === "solo" ? "Solo" : null;

  if (fatal) {
    return <main className="fatal-screen"><div><span>Graphics recovery</span><h1>Race paused at the gate</h1><p>{fatal}</p><button className="button-primary" onClick={() => window.location.reload()}>Retry loading</button><button onClick={() => navigate("title")}>Return to menu</button></div></main>;
  }

  return (
    <main className="game-shell" data-paused={paused} inert={screen === "settings" ? true : undefined} aria-hidden={screen === "settings" ? true : undefined}>
      <h1 className="sr-only">{tutorial ? `${track.name} training` : `${track.name} ${runLabel ?? mode} race`}</h1>
      <canvas ref={canvasRef} className="game-canvas" tabIndex={0} aria-label={`Live 3D race on ${track.name}`} />
      <div className="race-vignette" aria-hidden="true" />
      <header className="race-hud">
        <div className="position-block"><span>{runLabel ? "Run" : "Position"}</span><strong>{runLabel ?? `${hud.position} / ${hud.fieldSize}`}</strong></div>
        <div className="timing-block"><span>Lap <b>{hud.lap}</b> / {hud.totalLaps}</span><strong>{formatTime(hud.elapsedMs)}</strong></div>
        <div className="target-hud">
          <span>Target</span>
          <strong>{mode === "practice" || mode === "custom" || tutorial ? "Free ride" : formatTime(hud.targetMs)}</strong>
          {mode === "solo" ? <small>Saved best <b>{hud.savedBestMs === undefined ? "No time" : formatTime(hud.savedBestMs)}</b></small> : null}
        </div>
        {!tutorial ? <button className="pause-button" aria-label={paused ? "Resume race" : "Pause race"} onClick={paused ? resumeRace : pauseRace}>{paused ? "▶" : "Ⅱ"}</button> : null}
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
      {tutorial ? (
        <aside className="tutorial-card" aria-live="polite">
          {tutorialStep < TUTORIAL_STEPS.length ? <><span>Lesson {tutorialStep + 1} / {TUTORIAL_STEPS.length}</span><h2>{TUTORIAL_STEPS[tutorialStep]?.title}</h2><p>{TUTORIAL_STEPS[tutorialStep]?.copy}</p><small>Complete the action to continue</small><button className="tutorial-skip" onClick={completeTutorial}>Skip training</button></> : collisionQuizStep === 0 ? <><span>Contact drill · 1 / 2</span><h2>Rival contact</h2><p>You catch a slower rider and hit their rear wheel. Who crashes?</p><div className="tutorial-answers"><button className="button-primary" onClick={() => { setCollisionQuizError(""); setCollisionQuizStep(1); }}>I crash</button><button onClick={() => setCollisionQuizError("Not quite — the rider who hits from behind crashes.")}>Rider ahead crashes</button></div>{collisionQuizError ? <small role="alert">{collisionQuizError}</small> : null}</> : collisionQuizStep === 1 ? <><span>Contact drill · 2 / 2</span><h2>Rear-wheel defense</h2><p>A pursuing rider clips your rear wheel from behind. Who crashes?</p><div className="tutorial-answers"><button className="button-primary" onClick={() => { setCollisionQuizError(""); setCollisionQuizStep(2); }}>Pursuer crashes</button><button onClick={() => setCollisionQuizError("Protect your line — the pursuer who clips you from behind crashes.")}>I crash</button></div>{collisionQuizError ? <small role="alert">{collisionQuizError}</small> : null}</> : <><span>Training cleared</span><h2>Race fair, ride bold</h2><p>You demonstrated throttle, heat, cooling, lanes, wheelies, air control, landings, mud, grass, and both contact rules.</p><button className="button-primary" onClick={completeTutorial}>Enter the festival</button></>}
        </aside>
      ) : null}
      {paused ? (
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

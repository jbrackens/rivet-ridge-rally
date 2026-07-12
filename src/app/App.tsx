import { Component, lazy, Suspense, useEffect, useState, useSyncExternalStore, type ReactNode } from "react";

import { useAppStore } from "./store";
import { AudioManager } from "../game/audio/AudioManager";
import {
  BootScreen,
  ModeScreen,
  ResultsScreen,
  SettingsScreen,
  TitleScreen,
} from "../ui/screens/MenuScreens";

const GameView = lazy(() => import("../ui/game/GameView").then((module) => ({ default: module.GameView })));
const TrackEditorScreen = lazy(() => import("../ui/editor/TrackEditorScreen").then((module) => ({ default: module.TrackEditorScreen })));

interface LoadBoundaryProps {
  children: ReactNode;
  onExit: () => void;
}

class LoadBoundary extends Component<LoadBoundaryProps, { failed: boolean }> {
  override state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  override render() {
    if (!this.state.failed) return this.props.children;
    return (
      <main className="fatal-screen">
        <div>
          <span>Asset recovery</span>
          <h1>This section could not load</h1>
          <p>Reconnect if you are offline, then retry. Your local progress is safe.</p>
          <button className="button-primary" onClick={() => window.location.reload()}>Retry loading</button>
          <button onClick={this.props.onExit}>Return to menu</button>
        </div>
      </main>
    );
  }
}

function subscribeToConnectivity(callback: () => void): () => void {
  window.addEventListener("online", callback);
  window.addEventListener("offline", callback);
  return () => {
    window.removeEventListener("online", callback);
    window.removeEventListener("offline", callback);
  };
}

function ConnectivityBanner() {
  const online = useSyncExternalStore(
    subscribeToConnectivity,
    () => navigator.onLine,
    () => true,
  );
  return online ? null : (
    <div className="offline-banner" role="status">
      Offline mode · saved tracks and cached races remain available
    </div>
  );
}

function PersistenceNotice() {
  const screen = useAppStore((state) => state.screen);
  const status = useAppStore((state) => state.persistenceStatus);
  const retryDevicePersistence = useAppStore((state) => state.retryDevicePersistence);
  const openSettings = useAppStore((state) => state.openSettings);
  if (status.mode !== "session" || ["boot", "race", "tutorial", "paused"].includes(screen)) return null;

  const title = status.reason === "quota"
    ? "Device storage is full"
    : status.reason === "upgrade"
      ? "Save upgrade needs attention"
      : status.reason === "blocked"
        ? "Device storage is busy"
        : "Device saving unavailable";
  const summary = status.reason === "upgrade"
    ? "The local rider database could not be opened after a version check. Existing data has not been deleted."
    : status.reason === "quota"
      ? "The browser rejected a write because storage is full or denied."
      : "The browser cannot currently open or write the local rider database.";
  const inEditor = screen === "editor" || screen === "custom-library";
  const guidance = inEditor
    ? "Editing and test rides still work this session. Use Export for a valid draft before closing this tab or resetting site data."
    : screen === "settings"
      ? "Changes still apply this session. Allow site storage or free space, then retry. Export accessible custom tracks first; reset site data only as a last resort because it permanently deletes local progress and tracks."
      : "You can keep playing this session, but new progress and settings may disappear when the tab closes. Open recovery steps before resetting site data.";

  return (
    <aside className="persistence-notice" role="alert" aria-labelledby="persistence-notice-title">
      <div>
        <span>Session mode</span>
        <h2 id="persistence-notice-title">{title}</h2>
        <p>{summary} {guidance}</p>
      </div>
      <div className="persistence-actions">
        <button className="button-primary" disabled={status.retrying} onClick={() => void retryDevicePersistence()}>
          {status.retrying ? "Retrying…" : "Retry device saving"}
        </button>
        {!inEditor && screen !== "settings" ? <button onClick={openSettings}>Recovery steps</button> : null}
      </div>
    </aside>
  );
}

export function App() {
  const screen = useAppStore((state) => state.screen);
  const returnScreen = useAppStore((state) => state.returnScreen);
  const settings = useAppStore((state) => state.settings);
  const hydrate = useAppStore((state) => state.hydrate);
  const navigate = useAppStore((state) => state.navigate);
  const [uiAudio] = useState(() => new AudioManager(settings.audio));

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty("--ui-scale", String(settings.accessibility.uiScale));
    root.dataset.highContrast = String(settings.accessibility.highContrast);
    root.dataset.reducedMotion = String(settings.accessibility.reducedMotion);
    root.dataset.colorblindSafe = String(settings.accessibility.colorblindSafe);
  }, [settings.accessibility]);

  useEffect(() => {
    uiAudio.updateSettings(settings.audio);
  }, [settings.audio, uiAudio]);

  useEffect(() => {
    const play = (cue: "ui-move" | "ui-confirm") => {
      void uiAudio.unlock().then(() => uiAudio.play(cue));
    };
    const onPointerDown = (event: PointerEvent) => {
      if (event.target instanceof Element && event.target.closest("button:not(:disabled)")) {
        play("ui-confirm");
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.code === "Tab") play("ui-move");
      else if (["Enter", "Space"].includes(event.code) && document.activeElement instanceof HTMLButtonElement) play("ui-confirm");
    };
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
      uiAudio.dispose();
    };
  }, [uiAudio]);

  const settingsOverRace = screen === "settings" && returnScreen === "paused";
  const boundaryKey = screen === "race" || screen === "paused" || settingsOverRace ? "race-session" : screen;
  let surface;
  if (screen === "boot") surface = <BootScreen />;
  else if (screen === "title") surface = <TitleScreen />;
  else if (screen === "mode-select" || screen === "track-select") surface = <ModeScreen />;
  else if (screen === "settings" && !settingsOverRace) surface = <SettingsScreen />;
  else if (screen === "results") surface = <ResultsScreen />;
  else if (screen === "editor" || screen === "custom-library") surface = <Suspense fallback={<BootScreen />}><TrackEditorScreen /></Suspense>;
  else if (screen === "tutorial") surface = <Suspense fallback={<BootScreen />}><GameView tutorial /></Suspense>;
  else if (screen === "race" || screen === "paused" || settingsOverRace) surface = <><Suspense fallback={<BootScreen />}><GameView /></Suspense>{settingsOverRace ? <div className="race-settings-overlay"><SettingsScreen /></div> : null}</>;
  else surface = <TitleScreen />;

  return <><ConnectivityBanner /><LoadBoundary key={boundaryKey} onExit={() => navigate("title")}>{surface}</LoadBoundary><PersistenceNotice /></>;
}

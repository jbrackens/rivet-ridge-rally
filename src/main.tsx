import { createRoot } from "react-dom/client";

import { App } from "./app/App";
import { useAppStore } from "./app/store";
import type { RaceMode } from "./app/types";
import { TRACK_IDS, type TrackId } from "./game/content/tracks";
import { getLifecycleDiagnostics } from "./game/qa/lifecycleDiagnostics";
import "./styles.css";

const root = document.getElementById("root");

if (!root) {
  throw new Error("Application root is missing.");
}

createRoot(root).render(<App />);

if (import.meta.env.VITE_QA_MODE === "1") {
  window.__RRR_QA__ = {
    startTrack(trackId: string, mode: RaceMode = "practice") {
      if (!TRACK_IDS.includes(trackId as TrackId)) throw new Error(`Unknown QA track: ${trackId}`);
      useAppStore.getState().startRace(mode, trackId as TrackId);
    },
    unlockCampaign() {
      const progress = structuredClone(useAppStore.getState().progress);
      for (const trackId of TRACK_IDS) {
        progress.tracks[trackId].soloQualified = true;
        progress.tracks[trackId].rivalUnlocked = true;
        progress.tracks[trackId].bestRivalPosition = 1;
      }
      progress.selectedTrackId = "summit-showdown";
      useAppStore.setState({ progress });
    },
    lifecycle: getLifecycleDiagnostics,
  };
}

if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    void prepareOfflineShell().catch(() => undefined);
  });
}

async function prepareOfflineShell(): Promise<void> {
  const registration = await navigator.serviceWorker.register("/sw.js");
  const readyRegistration = await navigator.serviceWorker.ready;
  const worker = readyRegistration.active ?? registration.active;
  if (!worker) return;

  // Warm route chunks only after the initial screen has loaded. They remain
  // lazy for startup, while an installed offline shell can still open races
  // and the local track builder on a later disconnected visit.
  await Promise.allSettled([
    import("./ui/game/GameView"),
    import("./ui/editor/TrackEditorScreen"),
  ]);

  const resourceUrls = performance.getEntriesByType("resource")
    .map((entry) => entry.name)
    .filter((value) => new URL(value, window.location.href).origin === window.location.origin);
  resourceUrls.push(
    new URL("/", window.location.origin).href,
    new URL("/index.html", window.location.origin).href,
  );

  const channel = new MessageChannel();
  const acknowledged = new Promise<boolean>((resolve) => {
    const timeout = window.setTimeout(() => resolve(false), 10_000);
    channel.port1.onmessage = (event: MessageEvent<{ ok?: boolean }>) => {
      window.clearTimeout(timeout);
      resolve(event.data?.ok === true);
    };
  });

  worker.postMessage(
    { type: "CACHE_RUNTIME_RESOURCES", urls: [...new Set(resourceUrls)] },
    [channel.port2],
  );

  if (!(await acknowledged)) return;
  if (!navigator.serviceWorker.controller) {
    await new Promise<void>((resolve) => {
      const timeout = window.setTimeout(resolve, 10_000);
      navigator.serviceWorker.addEventListener("controllerchange", () => {
        window.clearTimeout(timeout);
        resolve();
      }, { once: true });
    });
  }
  if (navigator.serviceWorker.controller) {
    document.documentElement.dataset.offlineReady = "true";
  }
}

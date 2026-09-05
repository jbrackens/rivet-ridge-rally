import { createRoot } from "react-dom/client";

import { App } from "./app/App";
import { useAppStore } from "./app/store";
import type { Difficulty, RaceMode } from "./app/types";
import { TRACK_IDS, type TrackId } from "./game/content/tracks";
import { getLifecycleDiagnostics } from "./game/qa/lifecycleDiagnostics";
import "./styles.css";

const root = document.getElementById("root");
const OFFLINE_CACHE_NAME = "rivet-ridge-rally-shell-v35";
const OFFLINE_READINESS_EVENT = "rivet-ridge-rally:offline-readiness-change";
const OFFLINE_PREPARATION_TIMEOUT_MS = 20_000;

interface OfflineCacheAcknowledgement {
  cacheName?: string;
  ok?: boolean;
}

if (!root) {
  throw new Error("Application root is missing.");
}

window.__RRR_BUILD__ = Object.freeze({ ...__RRR_BUILD_IDENTITY__ });
document.documentElement.dataset.buildCommit = window.__RRR_BUILD__.commit;
document.documentElement.dataset.buildDirty = String(window.__RRR_BUILD__.dirty);

createRoot(root).render(<App />);

if (import.meta.env.VITE_QA_MODE === "1") {
  window.__RRR_QA__ = {
    startTrack(trackId: string, mode: RaceMode = "practice") {
      if (!TRACK_IDS.includes(trackId as TrackId)) throw new Error(`Unknown QA track: ${trackId}`);
      useAppStore.getState().startRace(mode, trackId as TrackId);
    },
    openEditor() {
      useAppStore.getState().navigate("editor");
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
    setDifficulty(difficulty: Difficulty) {
      if (!["rookie", "rider", "ace"].includes(difficulty)) {
        throw new Error(`Unknown QA difficulty: ${difficulty}`);
      }
      const state = useAppStore.getState();
      state.updateSettings({ ...state.settings, difficulty });
    },
    lifecycle: getLifecycleDiagnostics,
  };
}

if (import.meta.env.PROD && "serviceWorker" in navigator) {
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    clearOfflineReadiness();
    requestOfflinePreparation();
  });
  window.addEventListener("load", () => {
    requestOfflinePreparation();
  });
  window.addEventListener("online", () => {
    if (!hasCurrentOfflineReadiness()) requestOfflinePreparation();
  });
}

let offlinePreparation: Promise<void> | null = null;
let offlinePreparationPending = false;

function requestOfflinePreparation(): void {
  if (offlinePreparation) {
    offlinePreparationPending = true;
    return;
  }
  offlinePreparationPending = false;
  offlinePreparation = prepareOfflineShell()
    .catch(() => undefined)
    .finally(() => {
      offlinePreparation = null;
      if (offlinePreparationPending) {
        offlinePreparationPending = false;
        requestOfflinePreparation();
      }
    });
}

function hasCurrentOfflineReadiness(): boolean {
  return document.documentElement.dataset.offlineReady === "true"
    && document.documentElement.dataset.offlineCache === OFFLINE_CACHE_NAME;
}

function clearOfflineReadiness(): void {
  delete document.documentElement.dataset.offlineReady;
  delete document.documentElement.dataset.offlineCache;
  window.dispatchEvent(new Event(OFFLINE_READINESS_EVENT));
}

async function prepareOfflineShell(): Promise<void> {
  clearOfflineReadiness();

  const registration = await navigator.serviceWorker.register("/sw.js");
  registration.waiting?.postMessage({ type: "SKIP_WAITING" });

  // Warm route chunks only after the initial screen has loaded. They remain
  // lazy for startup, while an installed offline shell can still open races
  // and the local track builder on a later disconnected visit.
  const routeChunks = await Promise.allSettled([
    import("./ui/game/GameView"),
    import("./ui/editor/TrackEditorScreen"),
  ]);
  if (routeChunks.some((result) => result.status === "rejected")) return;

  const resourceUrls = performance.getEntriesByType("resource")
    .map((entry) => offlineCacheResourceURL(entry.name))
    .filter((value): value is string => value !== null);
  resourceUrls.push(
    new URL("/", window.location.origin).href,
    new URL("/index.html", window.location.origin).href,
  );

  if (!(await cacheWithCurrentGeneration(registration, [...new Set(resourceUrls)]))) return;

  document.documentElement.dataset.offlineCache = OFFLINE_CACHE_NAME;
  document.documentElement.dataset.offlineReady = "true";
  window.dispatchEvent(new Event(OFFLINE_READINESS_EVENT));
}

function offlineCacheResourceURL(value: string): string | null {
  try {
    const url = new URL(value, window.location.href);
    if (
      url.origin !== window.location.origin
      || url.protocol !== window.location.protocol
      || url.username
      || url.password
      || url.search
      || url.hash
      || !(
        url.pathname === "/"
        || url.pathname === "/index.html"
        || url.pathname === "/manifest.webmanifest"
        || url.pathname.startsWith("/assets/")
      )
    ) return null;
    return url.href;
  } catch {
    return null;
  }
}

async function cacheWithCurrentGeneration(
  registration: ServiceWorkerRegistration,
  resourceUrls: string[],
): Promise<boolean> {
  const deadline = Date.now() + OFFLINE_PREPARATION_TIMEOUT_MS;
  let worker = navigator.serviceWorker.controller;

  // Upgrades can begin under the previous controller. Its acknowledgement is
  // rejected by cache identity, then retried after the controller changes.
  while (Date.now() < deadline) {
    if (!worker) {
      worker = await waitForDifferentController(null, deadline - Date.now());
      if (!worker) return false;
    }

    const acknowledgement = await requestRuntimeCache(
      worker,
      resourceUrls,
      Math.min(10_000, Math.max(1, deadline - Date.now())),
    );
    if (acknowledgement?.cacheName === OFFLINE_CACHE_NAME) {
      if (navigator.serviceWorker.controller !== worker) {
        worker = navigator.serviceWorker.controller;
        continue;
      }
      return acknowledgement.ok === true;
    }

    registration.waiting?.postMessage({ type: "SKIP_WAITING" });
    worker = await waitForDifferentController(worker, deadline - Date.now());
    if (!worker) return false;
  }

  return false;
}

function requestRuntimeCache(
  worker: ServiceWorker,
  resourceUrls: string[],
  timeoutMs: number,
): Promise<OfflineCacheAcknowledgement | null> {
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    let settled = false;
    let timeout = 0;
    const finish = (value: OfflineCacheAcknowledgement | null) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      channel.port1.close();
      resolve(value);
    };
    timeout = window.setTimeout(() => finish(null), timeoutMs);
    channel.port1.onmessage = (event: MessageEvent<OfflineCacheAcknowledgement>) => finish(event.data);
    channel.port1.onmessageerror = () => finish(null);

    try {
      worker.postMessage(
        { type: "CACHE_RUNTIME_RESOURCES", urls: resourceUrls },
        [channel.port2],
      );
    } catch {
      finish(null);
    }
  });
}

function waitForDifferentController(
  previous: ServiceWorker | null,
  timeoutMs: number,
): Promise<ServiceWorker | null> {
  const current = navigator.serviceWorker.controller;
  if (current && current !== previous) return Promise.resolve(current);
  if (timeoutMs <= 0) return Promise.resolve(null);

  return new Promise((resolve) => {
    let settled = false;
    let timeout = 0;
    const finish = (value: ServiceWorker | null) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      navigator.serviceWorker.removeEventListener("controllerchange", onControllerChange);
      resolve(value);
    };
    const onControllerChange = () => {
      const controller = navigator.serviceWorker.controller;
      if (controller && controller !== previous) finish(controller);
    };
    timeout = window.setTimeout(() => finish(null), timeoutMs);
    navigator.serviceWorker.addEventListener("controllerchange", onControllerChange);
    onControllerChange();
  });
}

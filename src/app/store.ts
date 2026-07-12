import { create } from "zustand";

import type {
  AppScreen,
  CampaignProgress,
  GameSettings,
  MasteryGoal,
  RaceMode,
  RaceResult,
} from "./types";
import { TRACKS, type TrackId } from "../game/content/tracks";
import {
  DEFAULT_SETTINGS,
  createDefaultProgress,
  loadGameData,
  retryPersistence as retryDatabasePersistence,
  saveProgress,
  saveSettings,
  subscribePersistenceFailures,
  type CustomTrackData,
  type PersistenceFailure,
} from "../game/persistence/database";

interface ActiveRace {
  mode: RaceMode;
  trackId: TrackId;
  customTrack?: CustomTrackData | undefined;
}

export type PersistenceStatus =
  | { mode: "persistent"; retrying: false }
  | ({ mode: "session"; retrying: boolean } & PersistenceFailure);

interface AppState {
  screen: AppScreen;
  returnScreen: AppScreen;
  bootMessage: string;
  recoveredSave: boolean;
  persistenceStatus: PersistenceStatus;
  settings: GameSettings;
  progress: CampaignProgress;
  activeRace: ActiveRace | null;
  latestResult: RaceResult | null;
  raceAttempt: number;
  hydrate: () => Promise<void>;
  navigate: (screen: AppScreen) => void;
  openSettings: () => void;
  closeOverlay: () => void;
  updateSettings: (settings: GameSettings) => void;
  selectTrack: (trackId: TrackId) => void;
  startRace: (mode: RaceMode, trackId?: TrackId) => void;
  startCustomRace: (track: CustomTrackData) => void;
  pauseRace: () => void;
  resumeRace: () => void;
  finishRace: (result: RaceResult) => void;
  completeTutorial: () => void;
  retryRace: () => void;
  resetLocalProgress: () => void;
  retryDevicePersistence: () => Promise<void>;
  recordPersistenceFailure: (failure: PersistenceFailure) => void;
}

let hydrationStarted = false;

export const MASTERY_TRACK_ID = "summit-showdown" satisfies TrackId;
export const MASTERY_TIER_COUNT = 7;

function copyProgress(progress: CampaignProgress): CampaignProgress {
  return structuredClone(progress);
}

function persistInBackground(operation: Promise<unknown>): void {
  void operation.catch(() => {
    // The database publishes failures to the shared session-mode notice before rejecting.
  });
}

export function isTrackUnlocked(progress: CampaignProgress, trackId: TrackId): boolean {
  const index = TRACKS.findIndex((track) => track.id === trackId);
  if (index <= 0) return true;
  const previous = TRACKS[index - 1];
  return previous ? (progress.tracks[previous.id].bestRivalPosition ?? 99) <= 3 : false;
}

export function isMasteryUnlocked(progress: CampaignProgress): boolean {
  const summitProgress = progress.tracks[MASTERY_TRACK_ID];
  return isTrackUnlocked(progress, MASTERY_TRACK_ID)
    && summitProgress.rivalUnlocked
    && (summitProgress.bestRivalPosition ?? 99) <= 3;
}

export function getMasteryGoal(completedTiers: number): MasteryGoal {
  const masteryLevel = Math.max(0, Math.floor(completedTiers));
  const track = TRACKS.find((candidate) => candidate.id === MASTERY_TRACK_ID);
  if (!track) throw new Error("Summit mastery configuration is unavailable.");
  return {
    tier: Math.min(masteryLevel + 1, MASTERY_TIER_COUNT),
    tierCount: MASTERY_TIER_COUNT,
    targetMs: Math.round(
      track.soloTargetMs * Math.max(0.8, 0.94 - masteryLevel * 0.025),
    ),
    modifier: "Hot start",
    startingHeat: Math.min(65, 35 + masteryLevel * 5),
    isMaxTierReplay: masteryLevel >= MASTERY_TIER_COUNT,
  };
}

export function isMasteryGoalMet(result: RaceResult, goal: MasteryGoal): boolean {
  return result.mode === "mastery"
    && result.trackId === MASTERY_TRACK_ID
    && result.position <= 3
    && result.finishTimeMs <= goal.targetMs;
}

export function applyRaceResult(
  currentProgress: CampaignProgress,
  result: RaceResult,
): CampaignProgress {
  const progress = copyProgress(currentProgress);
  const track = TRACKS.find((item) => item.id === result.trackId);
  if (!track) return progress;
  const trackProgress = progress.tracks[result.trackId];

  if (result.mode === "solo") {
    trackProgress.bestSoloMs = Math.min(
      trackProgress.bestSoloMs ?? Number.POSITIVE_INFINITY,
      result.finishTimeMs,
    );
    if (result.finishTimeMs <= track.soloTargetMs) {
      trackProgress.soloQualified = true;
      trackProgress.rivalUnlocked = true;
    }
  }

  if (result.mode === "rival" && trackProgress.rivalUnlocked) {
    trackProgress.bestRivalPosition = Math.min(
      trackProgress.bestRivalPosition ?? 99,
      result.position,
    );
  }

  if (result.mode === "mastery" && isMasteryUnlocked(currentProgress)) {
    const goal = getMasteryGoal(trackProgress.masteryLevel);
    if (
      trackProgress.masteryLevel < goal.tierCount
      && isMasteryGoalMet(result, goal)
    ) {
      trackProgress.masteryLevel += 1;
    }
  }

  return progress;
}

export function prepareRaceResult(
  currentProgress: CampaignProgress,
  result: RaceResult,
): RaceResult {
  const playerClassification = result.classification.find((entry) => entry.isPlayer);
  const classifiedResult = playerClassification
    ? {
        ...result,
        position: playerClassification.position,
        fieldSize: result.classification.length,
      }
    : result;

  if (classifiedResult.mode !== "solo") return classifiedResult;

  const previousBestMs = currentProgress.tracks[classifiedResult.trackId].bestSoloMs;
  const personalBest = previousBestMs === undefined
    || classifiedResult.finishTimeMs < previousBestMs;
  return {
    ...classifiedResult,
    personalBest,
    previousBestMs,
    bestTimeMs: personalBest ? classifiedResult.finishTimeMs : previousBestMs,
  };
}

export const useAppStore = create<AppState>((set, get) => ({
  screen: "boot",
  returnScreen: "title",
  bootMessage: "Preparing the paddock…",
  recoveredSave: false,
  persistenceStatus: { mode: "persistent", retrying: false },
  settings: DEFAULT_SETTINGS,
  progress: createDefaultProgress(),
  activeRace: null,
  latestResult: null,
  raceAttempt: 0,

  hydrate: async () => {
    if (hydrationStarted) return;
    hydrationStarted = true;
    set({ bootMessage: "Loading rider data…" });
    try {
      const { settings, progress, recovered } = await loadGameData();
      set({
        settings,
        progress,
        recoveredSave: recovered,
        screen: progress.tutorialComplete ? "title" : "tutorial",
      });
    } catch {
      set({
        bootMessage: "Local storage is unavailable. Progress will last for this session.",
        screen: "title",
      });
    }
  },

  navigate: (screen) => set({ screen }),

  openSettings: () => {
    const { screen } = get();
    set({ returnScreen: screen, screen: "settings" });
  },

  closeOverlay: () => set((state) => ({ screen: state.returnScreen })),

  updateSettings: (settings) => {
    set({ settings });
    persistInBackground(saveSettings(settings));
  },

  selectTrack: (trackId) => {
    const progress = copyProgress(get().progress);
    progress.selectedTrackId = trackId;
    set({ progress });
    persistInBackground(saveProgress(progress));
  },

  startRace: (mode, trackId) => {
    const progress = get().progress;
    const selectedTrackId = trackId ?? progress.selectedTrackId;
    if (mode === "rival" && !progress.tracks[selectedTrackId].rivalUnlocked) return;
    if (
      mode === "mastery"
      && (selectedTrackId !== MASTERY_TRACK_ID || !isMasteryUnlocked(progress))
    ) return;
    set({
      activeRace: { mode, trackId: selectedTrackId },
      latestResult: null,
      raceAttempt: get().raceAttempt + 1,
      screen: mode === "tutorial" ? "tutorial" : "race",
    });
  },

  startCustomRace: (customTrack) => set({
    activeRace: { mode: "custom", trackId: "canyon-kickoff", customTrack },
    latestResult: null,
    raceAttempt: get().raceAttempt + 1,
    screen: "race",
  }),

  pauseRace: () => set({ screen: "paused" }),
  resumeRace: () => set({ screen: "race" }),

  finishRace: (result) => {
    const currentProgress = get().progress;
    const preparedResult = prepareRaceResult(currentProgress, result);
    const masteryGoal = preparedResult.mode === "mastery" && preparedResult.trackId === MASTERY_TRACK_ID
      ? getMasteryGoal(currentProgress.tracks[MASTERY_TRACK_ID].masteryLevel)
      : undefined;
    const latestResult = masteryGoal
      ? {
          ...preparedResult,
          targetMs: masteryGoal.targetMs,
          masteryGoal,
          masteryGoalMet: isMasteryGoalMet(preparedResult, masteryGoal),
        }
      : preparedResult;
    const progress = applyRaceResult(currentProgress, latestResult);
    set({ progress, latestResult, screen: "results" });
    persistInBackground(saveProgress(progress));
  },

  completeTutorial: () => {
    const progress = copyProgress(get().progress);
    progress.tutorialComplete = true;
    set({ progress, screen: "title" });
    persistInBackground(saveProgress(progress));
  },

  retryRace: () => {
    if (get().activeRace) set((state) => ({ latestResult: null, raceAttempt: state.raceAttempt + 1, screen: "race" }));
  },

  resetLocalProgress: () => {
    const progress = createDefaultProgress();
    set({ progress });
    persistInBackground(saveProgress(progress));
  },

  retryDevicePersistence: async () => {
    if (get().persistenceStatus.mode !== "session") return;
    set((state) => ({
      persistenceStatus: state.persistenceStatus.mode === "session"
        ? { ...state.persistenceStatus, retrying: true }
        : state.persistenceStatus,
    }));
    try {
      const { settings, progress } = get();
      await retryDatabasePersistence(settings, progress);
      set({ persistenceStatus: { mode: "persistent", retrying: false } });
    } catch {
      set((state) => ({
        persistenceStatus: state.persistenceStatus.mode === "session"
          ? { ...state.persistenceStatus, retrying: false }
          : state.persistenceStatus,
      }));
    }
  },

  recordPersistenceFailure: (failure) => set({
    persistenceStatus: { mode: "session", retrying: false, ...failure },
  }),
}));

subscribePersistenceFailures((failure) => {
  useAppStore.getState().recordPersistenceFailure(failure);
});

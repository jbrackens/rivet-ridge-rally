import { create } from "zustand";

import type {
  AppScreen,
  CampaignProgress,
  GameSettings,
  MasteryGoal,
  RaceMode,
  RaceReplayFailureReason,
  RaceResult,
} from "./types";
import {
  getMasteryTargetMs,
  MASTERY_TARGET_TIER_COUNT,
  TRACKS,
  type TrackId,
} from "../game/content/tracks";
import {
  DEFAULT_SETTINGS,
  createDefaultProgress,
  loadGameData,
  mergeProgressChanges,
  mergeSettingsChanges,
  resetProgress as resetDatabaseProgress,
  retryPersistence as retryDatabasePersistence,
  saveCustomTrack,
  saveProgress,
  saveSettings,
  subscribePersistenceFailures,
  type CustomTrackData,
  type PersistenceFailure,
} from "../game/persistence/database";
import type { EditorModuleCategory } from "../game/editor/modules";

interface ActiveRace {
  mode: RaceMode;
  trackId: TrackId;
  customTrack?: CustomTrackData | undefined;
  savedCustomTrack?: CustomTrackData | undefined;
}

interface FinishRaceOptions {
  raceAttempt?: number;
  presentResults?: boolean;
  replayFailureReason?: RaceReplayFailureReason;
}

export interface EditorSessionState {
  track: CustomTrackData;
  persistedBase: CustomTrackData | null;
  past: CustomTrackData[];
  future: CustomTrackData[];
  category: EditorModuleCategory;
  selectedModuleId: string;
  selectedPlacementId: string | null;
}

export interface PendingTestRideSave {
  track: CustomTrackData;
  persistedBase: CustomTrackData | null;
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
  editorSession: EditorSessionState | null;
  pendingTestRideSave: PendingTestRideSave | null;
  latestResult: RaceResult | null;
  latestResultAttempt: number | null;
  latestReplayFailureReason: RaceReplayFailureReason | null;
  raceAttempt: number;
  hydrate: () => Promise<void>;
  navigate: (screen: AppScreen) => void;
  openSettings: () => void;
  closeOverlay: () => void;
  updateSettings: (settings: GameSettings) => void;
  selectTrack: (trackId: TrackId) => void;
  startRace: (mode: RaceMode, trackId?: TrackId) => void;
  startCustomRace: (track: CustomTrackData) => void;
  setEditorSession: (session: EditorSessionState) => void;
  saveTestRideTrack: (
    track: CustomTrackData,
    persistedBase: CustomTrackData | null,
  ) => Promise<CustomTrackData>;
  clearPendingTestRideSave: (trackId: string) => void;
  pauseRace: () => void;
  resumeRace: () => void;
  finishRace: (result: RaceResult, options?: FinishRaceOptions) => void;
  presentRaceResult: (raceAttempt: number) => void;
  completeTutorial: () => void;
  skipTutorial: () => void;
  retryRace: () => void;
  resetLocalProgress: () => void;
  retryDevicePersistence: () => Promise<void>;
  recordPersistenceFailure: (failure: PersistenceFailure) => void;
}

let hydrationStarted = false;
let profileLoadedFromPersistence = false;
let profileWritesBlocked = false;
let persistenceRetryInFlight = false;
let persistenceFailureRevision = 0;
let progressResetRevision = 0;
let pendingProgressReplacementRevision: number | null = null;
let lastAppliedSettingsSnapshot = structuredClone(DEFAULT_SETTINGS);
let lastAppliedProgressSnapshot = createDefaultProgress();
let settingsWriteQueue: Promise<void> = Promise.resolve();
let progressWriteQueue: Promise<void> = Promise.resolve();

export const MASTERY_TRACK_ID = "summit-showdown" satisfies TrackId;
export const MASTERY_TIER_COUNT = MASTERY_TARGET_TIER_COUNT;

function copyProgress(progress: CampaignProgress): CampaignProgress {
  return structuredClone(progress);
}

function sameTrackSnapshot(left: CustomTrackData, right: CustomTrackData): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function reconcileEditorSessionAfterTrackSave(
  editorSession: EditorSessionState | null,
  attempted: CustomTrackData,
  saved: CustomTrackData,
): EditorSessionState | null {
  if (!editorSession || editorSession.track.id !== attempted.id) return editorSession;
  if (!sameTrackSnapshot(editorSession.track, attempted)) {
    return saved.id === attempted.id
      ? { ...editorSession, persistedBase: structuredClone(saved) }
      : editorSession;
  }
  const identityChanged = saved.id !== attempted.id;
  return {
    ...editorSession,
    track: structuredClone(saved),
    persistedBase: structuredClone(saved),
    ...(identityChanged ? { past: [], future: [] } : {}),
  };
}

function reconcileActiveRaceAfterTrackSave(
  activeRace: ActiveRace | null,
  attempted: CustomTrackData,
  saved: CustomTrackData,
): ActiveRace | null {
  if (
    activeRace?.mode !== "custom"
    || !activeRace.customTrack
    || !sameTrackSnapshot(activeRace.customTrack, attempted)
  ) return activeRace;
  return { ...activeRace, savedCustomTrack: structuredClone(saved) };
}

function promoteSavedCustomTrack(activeRace: ActiveRace): ActiveRace {
  if (activeRace.mode !== "custom" || !activeRace.savedCustomTrack) return activeRace;
  const { savedCustomTrack, ...attempt } = activeRace;
  return { ...attempt, customTrack: structuredClone(savedCustomTrack) };
}

async function waitForProfileWritesToSettle(): Promise<void> {
  while (true) {
    const settingsBarrier = settingsWriteQueue;
    const progressBarrier = progressWriteQueue;
    await Promise.all([settingsBarrier, progressBarrier]);
    if (settingsBarrier === settingsWriteQueue && progressBarrier === progressWriteQueue) return;
  }
}

function persistSettingsInBackground(base: GameSettings, next: GameSettings): void {
  if (!profileLoadedFromPersistence || profileWritesBlocked) return;
  const baseSnapshot = structuredClone(base);
  const nextSnapshot = structuredClone(next);
  settingsWriteQueue = settingsWriteQueue.then(async () => {
    if (profileWritesBlocked) return;
    try {
      const merged = await saveSettings(baseSnapshot, nextSnapshot);
      lastAppliedSettingsSnapshot = structuredClone(merged);
      useAppStore.setState((state) => ({
        settings: mergeSettingsChanges(nextSnapshot, merged, state.settings),
      }));
    } catch {
      profileWritesBlocked = true;
      // The database publishes the failure before rejecting.
    }
  });
}

function persistProgressInBackground(
  base: CampaignProgress,
  next: CampaignProgress,
  replace = false,
): void {
  if (!profileLoadedFromPersistence || profileWritesBlocked) return;
  const baseSnapshot = structuredClone(base);
  const nextSnapshot = structuredClone(next);
  const resetRevisionSnapshot = progressResetRevision;
  const replacementRevision = replace ? pendingProgressReplacementRevision : null;
  progressWriteQueue = progressWriteQueue.then(async () => {
    if (profileWritesBlocked) return;
    try {
      const merged = replace
        ? await resetDatabaseProgress(nextSnapshot)
        : await saveProgress(baseSnapshot, nextSnapshot);
      lastAppliedProgressSnapshot = structuredClone(merged);
      if (progressResetRevision === resetRevisionSnapshot) {
        useAppStore.setState((state) => ({
          progress: mergeProgressChanges(nextSnapshot, merged, state.progress),
        }));
      }
      if (
        replacementRevision !== null
        && pendingProgressReplacementRevision === replacementRevision
      ) {
        pendingProgressReplacementRevision = null;
      }
    } catch {
      profileWritesBlocked = true;
      // The database publishes the failure before rejecting.
    }
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
    targetMs: getMasteryTargetMs(track.soloTargetMs, masteryLevel),
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
    const isPersonalBest = trackProgress.bestSoloMs === undefined
      || result.finishTimeMs < trackProgress.bestSoloMs;
    if (isPersonalBest) {
      trackProgress.bestSoloMs = result.finishTimeMs;
      trackProgress.bestSoloLapTimesMs = [...result.lapTimesMs];
      trackProgress.bestSoloSplitTimesMs = [...result.splitTimesMs];
    }
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

  const previousTrackProgress = currentProgress.tracks[classifiedResult.trackId];
  const previousBestMs = previousTrackProgress.bestSoloMs;
  const personalBest = previousBestMs === undefined
    || classifiedResult.finishTimeMs < previousBestMs;
  return {
    ...classifiedResult,
    personalBest,
    previousBestMs,
    previousBestLapTimesMs: previousTrackProgress.bestSoloLapTimesMs === undefined
      ? undefined
      : [...previousTrackProgress.bestSoloLapTimesMs],
    previousBestSplitTimesMs: previousTrackProgress.bestSoloSplitTimesMs === undefined
      ? undefined
      : [...previousTrackProgress.bestSoloSplitTimesMs],
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
  editorSession: null,
  pendingTestRideSave: null,
  latestResult: null,
  latestResultAttempt: null,
  latestReplayFailureReason: null,
  raceAttempt: 0,

  hydrate: async () => {
    if (hydrationStarted) return;
    hydrationStarted = true;
    set({ bootMessage: "Loading rider data…" });
    try {
      const { settings, progress, recovered } = await loadGameData();
      profileLoadedFromPersistence = true;
      profileWritesBlocked = false;
      pendingProgressReplacementRevision = null;
      lastAppliedSettingsSnapshot = structuredClone(settings);
      lastAppliedProgressSnapshot = structuredClone(progress);
      set({
        settings,
        progress,
        recoveredSave: recovered,
        screen: progress.tutorialComplete ? "title" : "tutorial",
      });
    } catch {
      set({
        bootMessage: "Local storage is unavailable. Progress will last for this session.",
        screen: "tutorial",
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
    const base = get().settings;
    set({ settings });
    persistSettingsInBackground(base, settings);
  },

  selectTrack: (trackId) => {
    const base = get().progress;
    const progress = copyProgress(base);
    progress.selectedTrackId = trackId;
    set({ progress });
    persistProgressInBackground(base, progress);
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
      latestResultAttempt: null,
      latestReplayFailureReason: null,
      raceAttempt: get().raceAttempt + 1,
      screen: mode === "tutorial" ? "tutorial" : "race",
    });
  },

  startCustomRace: (customTrack) => set({
    activeRace: { mode: "custom", trackId: "canyon-kickoff", customTrack },
    latestResult: null,
    latestResultAttempt: null,
    latestReplayFailureReason: null,
    raceAttempt: get().raceAttempt + 1,
    screen: "race",
  }),

  setEditorSession: (editorSession) => set({ editorSession }),

  saveTestRideTrack: async (track, persistedBase) => {
    const snapshot = structuredClone(track);
    const pending: PendingTestRideSave = {
      track: snapshot,
      persistedBase: structuredClone(persistedBase),
    };
    set({ pendingTestRideSave: pending });
    const saved = await saveCustomTrack(snapshot, pending.persistedBase);
    set((state) => state.pendingTestRideSave === pending
      ? {
          pendingTestRideSave: null,
          editorSession: reconcileEditorSessionAfterTrackSave(
            state.editorSession,
            snapshot,
            saved.track,
          ),
        }
      : state);
    return saved.track;
  },

  clearPendingTestRideSave: (trackId) => set((state) => (
    state.pendingTestRideSave?.track.id === trackId
      ? { pendingTestRideSave: null }
      : state
  )),

  pauseRace: () => set({ screen: "paused" }),
  resumeRace: () => set({ screen: "race" }),

  finishRace: (result, options) => {
    const currentState = get();
    const resultAttempt = options?.raceAttempt ?? currentState.raceAttempt;
    if (
      resultAttempt !== currentState.raceAttempt
      || currentState.latestResultAttempt === resultAttempt
    ) return;

    const currentProgress = currentState.progress;
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
    set({
      progress,
      latestResult,
      latestResultAttempt: resultAttempt,
      latestReplayFailureReason: options?.replayFailureReason ?? null,
      ...(options?.presentResults === false ? {} : { screen: "results" as const }),
    });
    persistProgressInBackground(currentProgress, progress);
  },

  presentRaceResult: (raceAttempt) => set((state) => {
    const raceSessionVisible = state.screen === "race"
      || state.screen === "paused"
      || (state.screen === "settings" && state.returnScreen === "paused");
    if (
      state.raceAttempt !== raceAttempt
      || state.latestResultAttempt !== raceAttempt
      || !state.latestResult
      || !raceSessionVisible
    ) return state;
    return { screen: "results" };
  }),

  completeTutorial: () => {
    const base = get().progress;
    const progress = copyProgress(base);
    progress.tutorialComplete = true;
    set({ progress, screen: "title" });
    persistProgressInBackground(base, progress);
  },

  skipTutorial: () => {
    const base = get().progress;
    const progress = copyProgress(base);
    progress.tutorialComplete = true;
    set({ progress, screen: "title" });
    persistProgressInBackground(base, progress);
  },

  retryRace: () => {
    if (get().activeRace) {
      set((state) => ({
        activeRace: state.activeRace
          ? promoteSavedCustomTrack(state.activeRace)
          : state.activeRace,
        latestResult: null,
        latestResultAttempt: null,
        latestReplayFailureReason: null,
        raceAttempt: state.raceAttempt + 1,
        screen: "race",
      }));
    }
  },

  resetLocalProgress: () => {
    const base = get().progress;
    const progress = createDefaultProgress();
    progressResetRevision += 1;
    pendingProgressReplacementRevision = progressResetRevision;
    set({ progress });
    persistProgressInBackground(base, progress, true);
  },

  retryDevicePersistence: async () => {
    const persistenceStatus = get().persistenceStatus;
    if (
      persistenceStatus.mode !== "session"
      || persistenceStatus.retrying
      || persistenceRetryInFlight
    ) return;
    persistenceRetryInFlight = true;
    profileWritesBlocked = true;
    set((state) => ({
      persistenceStatus: state.persistenceStatus.mode === "session"
        ? { ...state.persistenceStatus, retrying: true }
        : state.persistenceStatus,
    }));
    try {
      await waitForProfileWritesToSettle();
      const failureRevisionSnapshot = persistenceFailureRevision;
      const preserveExistingProfile = !profileLoadedFromPersistence;
      const settingsSnapshot = structuredClone(get().settings);
      const progressSnapshot = structuredClone(get().progress);
      const resetRevisionSnapshot = progressResetRevision;
      const replacementRevision = pendingProgressReplacementRevision;
      const profile = await retryDatabasePersistence(settingsSnapshot, progressSnapshot, {
        preserveExistingProfile,
        baseSettings: lastAppliedSettingsSnapshot,
        baseProgress: lastAppliedProgressSnapshot,
        replaceProgress: replacementRevision !== null,
      });
      if (persistenceFailureRevision !== failureRevisionSnapshot) {
        throw new Error("A newer persistence failure interrupted retry.");
      }
      const current = get();
      const settings = mergeSettingsChanges(
        settingsSnapshot,
        profile.settings,
        current.settings,
      );
      const retryAppliedReplacement = !preserveExistingProfile && replacementRevision !== null;
      const preservePendingReplacement = (
        progressResetRevision !== resetRevisionSnapshot
        || (preserveExistingProfile && replacementRevision !== null)
      );
      const progress = preservePendingReplacement
        ? structuredClone(current.progress)
        : mergeProgressChanges(progressSnapshot, profile.progress, current.progress);
      profileLoadedFromPersistence = true;
      lastAppliedSettingsSnapshot = structuredClone(profile.settings);
      lastAppliedProgressSnapshot = structuredClone(profile.progress);
      if (
        retryAppliedReplacement
        && pendingProgressReplacementRevision === replacementRevision
      ) {
        pendingProgressReplacementRevision = null;
      }
      profileWritesBlocked = false;
      set((state) => ({
        settings,
        progress,
        recoveredSave: state.recoveredSave || profile.recovered,
      }));
      persistSettingsInBackground(profile.settings, settings);
      persistProgressInBackground(
        profile.progress,
        progress,
        pendingProgressReplacementRevision !== null,
      );
      await waitForProfileWritesToSettle();
      if (profileWritesBlocked) throw new Error("Profile writes remain unavailable after retry.");
      const pendingTestRideSave = get().pendingTestRideSave;
      const pendingTrackResult = pendingTestRideSave
        ? await saveCustomTrack(
            pendingTestRideSave.track,
            pendingTestRideSave.persistedBase,
          )
        : null;
      set((state) => {
        if (state.pendingTestRideSave !== pendingTestRideSave) return state;
        return {
          pendingTestRideSave: null,
          ...(pendingTrackResult && pendingTestRideSave
            ? {
                editorSession: reconcileEditorSessionAfterTrackSave(
                  state.editorSession,
                  pendingTestRideSave.track,
                  pendingTrackResult.track,
                ),
                activeRace: reconcileActiveRaceAfterTrackSave(
                  state.activeRace,
                  pendingTestRideSave.track,
                  pendingTrackResult.track,
                ),
              }
            : {}),
        };
      });
      await waitForProfileWritesToSettle();
      if (profileWritesBlocked) throw new Error("A profile write failed during retry.");
      set((state) => ({
        persistenceStatus: state.pendingTestRideSave === null
          ? { mode: "persistent", retrying: false }
          : state.persistenceStatus.mode === "session"
            ? { ...state.persistenceStatus, retrying: false }
            : state.persistenceStatus,
      }));
    } catch {
      profileWritesBlocked = true;
      set((state) => ({
        persistenceStatus: state.persistenceStatus.mode === "session"
          ? { ...state.persistenceStatus, retrying: false }
          : state.persistenceStatus,
      }));
    } finally {
      persistenceRetryInFlight = false;
    }
  },

  recordPersistenceFailure: (failure) => {
    profileWritesBlocked = true;
    persistenceFailureRevision += 1;
    set({
      persistenceStatus: {
        mode: "session",
        retrying: persistenceRetryInFlight,
        ...failure,
      },
    });
  },
}));

subscribePersistenceFailures((failure) => {
  useAppStore.getState().recordPersistenceFailure(failure);
});

import { beforeEach, describe, expect, it, vi } from "vitest";

import type { CampaignProgress, GameSettings } from "../types";
import type {
  CustomTrackData,
  CustomTrackSaveResult,
  RetryPersistenceOptions,
} from "../../game/persistence/database";
import { EXAMPLE_TRACKS } from "../../game/editor/examples";

interface ProfileData {
  settings: GameSettings;
  progress: CampaignProgress;
  recovered: boolean;
}

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve: ((value: T) => void) | undefined;
  let reject: ((reason?: unknown) => void) | undefined;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  if (!resolve || !reject) throw new Error("Expected deferred controls to initialize.");
  return { promise, resolve, reject };
}

const databaseMocks = vi.hoisted(() => ({
  loadGameData: vi.fn<() => Promise<ProfileData>>(),
  retryPersistence: vi.fn<(
    settings: GameSettings,
    progress: CampaignProgress,
    options: RetryPersistenceOptions,
  ) => Promise<ProfileData>>(),
  saveCustomTrack: vi.fn<(
    track: CustomTrackData,
    persistedBase?: CustomTrackData | null,
  ) => Promise<CustomTrackSaveResult>>(),
  resetProgress: vi.fn<(next?: CampaignProgress) => Promise<CampaignProgress>>(),
  saveProgress: vi.fn<(base: CampaignProgress, next: CampaignProgress) => Promise<CampaignProgress>>(),
  saveSettings: vi.fn<(base: GameSettings, next: GameSettings) => Promise<GameSettings>>(),
  subscribePersistenceFailures: vi.fn(() => () => undefined),
}));

vi.mock("../../game/persistence/database", async (importOriginal) => ({
  ...await importOriginal<typeof import("../../game/persistence/database")>(),
  ...databaseMocks,
}));

import {
  DEFAULT_SETTINGS,
  createDefaultProgress,
} from "../../game/persistence/database";

let useAppStore: (typeof import("../store"))["useAppStore"];

async function hydratePersistentStore(): Promise<void> {
  databaseMocks.loadGameData.mockResolvedValueOnce({
    settings: structuredClone(DEFAULT_SETTINGS),
    progress: createDefaultProgress(),
    recovered: false,
  });
  await useAppStore.getState().hydrate();
}

beforeEach(async () => {
  vi.resetModules();
  databaseMocks.loadGameData.mockReset();
  databaseMocks.retryPersistence.mockReset();
  databaseMocks.saveCustomTrack.mockReset();
  databaseMocks.resetProgress.mockReset();
  databaseMocks.saveProgress.mockReset();
  databaseMocks.saveSettings.mockReset();
  databaseMocks.resetProgress.mockImplementation(async (next = createDefaultProgress()) => (
    structuredClone(next)
  ));
  databaseMocks.saveProgress.mockImplementation(async (_base, next) => structuredClone(next));
  databaseMocks.saveSettings.mockImplementation(async (_base, next) => structuredClone(next));
  databaseMocks.subscribePersistenceFailures.mockClear();
  ({ useAppStore } = await import("../store"));
});

describe("device persistence retry", () => {
  it("reloads a valid stored profile before enabling writes after the initial load fails", async () => {
    databaseMocks.loadGameData.mockRejectedValueOnce(new Error("IndexedDB open failed"));
    await useAppStore.getState().hydrate();

    const sessionSettings = structuredClone(DEFAULT_SETTINGS);
    sessionSettings.audio.master = 0.15;
    useAppStore.getState().updateSettings(sessionSettings);
    useAppStore.getState().selectTrack("pine-run");

    expect(databaseMocks.saveSettings).not.toHaveBeenCalled();
    expect(databaseMocks.saveProgress).not.toHaveBeenCalled();

    const storedSettings = structuredClone(DEFAULT_SETTINGS);
    storedSettings.audio.master = 0.65;
    const storedProgress = createDefaultProgress();
    storedProgress.tutorialComplete = true;
    storedProgress.selectedTrackId = "summit-showdown";
    storedProgress.tracks["canyon-kickoff"].bestSoloMs = 98_000;

    databaseMocks.retryPersistence.mockResolvedValueOnce({
      settings: storedSettings,
      progress: storedProgress,
      recovered: false,
    });
    useAppStore.getState().recordPersistenceFailure({
      reason: "write",
      operation: "settings",
      occurredAt: 1,
    });

    const sessionProfile = useAppStore.getState();
    await sessionProfile.retryDevicePersistence();

    expect(databaseMocks.retryPersistence).toHaveBeenCalledWith(
      sessionProfile.settings,
      sessionProfile.progress,
      expect.objectContaining({ preserveExistingProfile: true }),
    );
    expect(useAppStore.getState()).toMatchObject({
      settings: storedSettings,
      progress: storedProgress,
      persistenceStatus: { mode: "persistent", retrying: false },
    });
  });

  it("retains and retries the exact Test Ride snapshot until a track save succeeds", async () => {
    await hydratePersistentStore();
    const example = EXAMPLE_TRACKS[0];
    if (!example) throw new Error("Expected a custom-track recovery fixture.");
    const persistedBase = structuredClone(example);
    const attemptedTrack = {
      ...structuredClone(example),
      name: "Test Ride revision",
      updatedAt: example.updatedAt + 1,
    };
    const failedSnapshot = structuredClone(attemptedTrack);
    const failedBase = structuredClone(persistedBase);
    let rejectInitialSave: ((reason?: unknown) => void) | undefined;
    databaseMocks.saveCustomTrack.mockImplementationOnce(() => new Promise<CustomTrackSaveResult>((_resolve, reject) => {
      rejectInitialSave = reject;
    }));
    useAppStore.setState({
      pendingTestRideSave: null,
      persistenceStatus: { mode: "persistent", retrying: false },
    });

    const initialSave = useAppStore.getState().saveTestRideTrack(attemptedTrack, persistedBase);
    attemptedTrack.name = "Changed after Test Ride launched";
    persistedBase.name = "Changed after the save attempt";
    if (!rejectInitialSave) throw new Error("Expected the Test Ride save to start.");
    rejectInitialSave(new Error("Injected Test Ride save failure."));
    await expect(initialSave).rejects.toThrow("Injected Test Ride save failure.");
    useAppStore.getState().startCustomRace(failedSnapshot);

    expect(useAppStore.getState().pendingTestRideSave).toEqual({
      track: failedSnapshot,
      persistedBase: failedBase,
    });
    useAppStore.getState().recordPersistenceFailure({
      reason: "write",
      operation: "custom-tracks",
      occurredAt: 2,
    });

    const recoveredSettings = structuredClone(DEFAULT_SETTINGS);
    recoveredSettings.audio.master = 0.45;
    const recoveredProgress = createDefaultProgress();
    recoveredProgress.selectedTrackId = "pine-run";
    databaseMocks.retryPersistence.mockResolvedValue({
      settings: recoveredSettings,
      progress: recoveredProgress,
      recovered: false,
    });
    databaseMocks.saveCustomTrack
      .mockRejectedValueOnce(new Error("Injected retry failure."))
      .mockResolvedValueOnce({ track: failedSnapshot, conflictCopy: false });

    await useAppStore.getState().retryDevicePersistence();

    expect(useAppStore.getState()).toMatchObject({
      settings: recoveredSettings,
      progress: recoveredProgress,
      pendingTestRideSave: {
        track: failedSnapshot,
        persistedBase: failedBase,
      },
      persistenceStatus: {
        mode: "session",
        operation: "custom-tracks",
        retrying: false,
      },
    });

    await useAppStore.getState().retryDevicePersistence();

    expect(databaseMocks.saveCustomTrack).toHaveBeenLastCalledWith(failedSnapshot, failedBase);
    expect(useAppStore.getState()).toMatchObject({
      pendingTestRideSave: null,
      activeRace: {
        mode: "custom",
        customTrack: { id: failedSnapshot.id },
      },
      persistenceStatus: { mode: "persistent", retrying: false },
    });
  });

  it("keeps the current Test Ride immutable and promotes its saved identity on retry", async () => {
    await hydratePersistentStore();
    const example = EXAMPLE_TRACKS[0];
    if (!example) throw new Error("Expected a Test Ride identity fixture.");
    const pendingTrack = {
      ...structuredClone(example),
      name: "Pending local revision",
      updatedAt: example.updatedAt + 1,
    };
    const conflictCopy = {
      ...structuredClone(pendingTrack),
      id: "saved-conflict-copy",
      name: "Pending local revision Conflict Copy",
      createdAt: pendingTrack.createdAt + 2,
      updatedAt: pendingTrack.updatedAt + 2,
    };
    const storedSettings = structuredClone(DEFAULT_SETTINGS);
    const storedProgress = createDefaultProgress();
    databaseMocks.retryPersistence.mockResolvedValueOnce({
      settings: storedSettings,
      progress: storedProgress,
      recovered: false,
    });
    databaseMocks.saveCustomTrack.mockResolvedValueOnce({
      track: conflictCopy,
      conflictCopy: true,
    });
    useAppStore.getState().startCustomRace(pendingTrack);
    useAppStore.setState({
      pendingTestRideSave: {
        track: pendingTrack,
        persistedBase: structuredClone(example),
      },
      persistenceStatus: {
        mode: "session",
        retrying: false,
        reason: "write",
        operation: "custom-tracks",
        occurredAt: 3,
      },
    });

    await useAppStore.getState().retryDevicePersistence();

    expect(useAppStore.getState()).toMatchObject({
      pendingTestRideSave: null,
      activeRace: {
        mode: "custom",
        customTrack: { id: pendingTrack.id },
        savedCustomTrack: { id: conflictCopy.id },
      },
      persistenceStatus: { mode: "persistent", retrying: false },
    });
    useAppStore.getState().retryRace();
    expect(useAppStore.getState().activeRace).toMatchObject({
      mode: "custom",
      customTrack: { id: conflictCopy.id },
    });
    expect(useAppStore.getState().activeRace).not.toHaveProperty("savedCustomTrack");
  });

  it("does not mask a profile failure during a pending-track retry", async () => {
    await hydratePersistentStore();
    const example = EXAMPLE_TRACKS[0];
    if (!example) throw new Error("Expected a pending-track retry fixture.");
    const pendingTrack = structuredClone(example);
    const trackSave = deferred<CustomTrackSaveResult>();
    databaseMocks.saveCustomTrack.mockImplementationOnce(() => trackSave.promise);
    const storedSettings = structuredClone(DEFAULT_SETTINGS);
    const storedProgress = createDefaultProgress();
    databaseMocks.retryPersistence.mockResolvedValueOnce({
      settings: storedSettings,
      progress: storedProgress,
      recovered: false,
    });
    useAppStore.setState({
      settings: storedSettings,
      progress: storedProgress,
      pendingTestRideSave: { track: pendingTrack, persistedBase: null },
      persistenceStatus: {
        mode: "session",
        retrying: false,
        reason: "write",
        operation: "custom-tracks",
        occurredAt: 3,
      },
    });

    const retrying = useAppStore.getState().retryDevicePersistence();
    await vi.waitFor(() => expect(databaseMocks.saveCustomTrack).toHaveBeenCalledTimes(1));

    databaseMocks.saveSettings.mockRejectedValueOnce(new Error("Injected profile failure."));
    const changedSettings = structuredClone(useAppStore.getState().settings);
    changedSettings.audio.master = 0.25;
    useAppStore.getState().updateSettings(changedSettings);
    await vi.waitFor(() => expect(databaseMocks.saveSettings).toHaveBeenCalledTimes(2));
    trackSave.resolve({ track: pendingTrack, conflictCopy: false });
    await retrying;

    expect(useAppStore.getState()).toMatchObject({
      pendingTestRideSave: null,
      settings: { audio: { master: 0.25 } },
      persistenceStatus: { mode: "session", retrying: false },
    });

    const recoveryState = useAppStore.getState();
    databaseMocks.retryPersistence.mockResolvedValueOnce({
      settings: recoveryState.settings,
      progress: recoveryState.progress,
      recovered: false,
    });
    await recoveryState.retryDevicePersistence();
  });

  it("keeps retry single-flight and visibly busy after a new failure interrupts it", async () => {
    await hydratePersistentStore();
    const retry = deferred<ProfileData>();
    databaseMocks.retryPersistence.mockImplementationOnce(() => retry.promise);
    const storedSettings = structuredClone(DEFAULT_SETTINGS);
    const storedProgress = createDefaultProgress();
    useAppStore.setState({
      settings: storedSettings,
      progress: storedProgress,
      pendingTestRideSave: null,
      persistenceStatus: {
        mode: "session",
        retrying: false,
        reason: "write",
        operation: "settings",
        occurredAt: 4,
      },
    });

    const firstRetry = useAppStore.getState().retryDevicePersistence();
    await vi.waitFor(() => expect(databaseMocks.retryPersistence).toHaveBeenCalledTimes(1));
    useAppStore.getState().recordPersistenceFailure({
      reason: "write",
      operation: "progress",
      occurredAt: 5,
    });
    expect(useAppStore.getState().persistenceStatus).toMatchObject({
      mode: "session",
      operation: "progress",
      retrying: true,
    });
    await useAppStore.getState().retryDevicePersistence();
    expect(databaseMocks.retryPersistence).toHaveBeenCalledTimes(1);

    retry.resolve({
      settings: storedSettings,
      progress: storedProgress,
      recovered: false,
    });
    await firstRetry;
    expect(useAppStore.getState().persistenceStatus).toMatchObject({
      mode: "session",
      operation: "progress",
      retrying: false,
    });

    databaseMocks.retryPersistence.mockResolvedValueOnce({
      settings: storedSettings,
      progress: storedProgress,
      recovered: false,
    });
    await useAppStore.getState().retryDevicePersistence();
  });

  it("rebases newer local settings onto the database's merged return value", async () => {
    await hydratePersistentStore();
    const firstWrite = deferred<GameSettings>();
    const secondWrite = deferred<GameSettings>();
    databaseMocks.saveSettings
      .mockImplementationOnce(() => firstWrite.promise)
      .mockImplementationOnce(() => secondWrite.promise);
    const base = structuredClone(DEFAULT_SETTINGS);
    useAppStore.setState({
      settings: base,
      persistenceStatus: { mode: "persistent", retrying: false },
    });

    const firstLocal = structuredClone(base);
    firstLocal.accessibility.highContrast = true;
    useAppStore.getState().updateSettings(firstLocal);
    await vi.waitFor(() => expect(databaseMocks.saveSettings).toHaveBeenCalledTimes(1));

    const newerLocal = structuredClone(firstLocal);
    newerLocal.accessibility.captions = false;
    useAppStore.getState().updateSettings(newerLocal);
    const firstMerged = structuredClone(firstLocal);
    firstMerged.audio.master = 0.35;
    firstWrite.resolve(firstMerged);

    await vi.waitFor(() => expect(databaseMocks.saveSettings).toHaveBeenCalledTimes(2));
    expect(useAppStore.getState().settings).toMatchObject({
      audio: { master: 0.35 },
      accessibility: { highContrast: true, captions: false },
    });

    const secondMerged = structuredClone(newerLocal);
    secondMerged.audio.master = 0.35;
    secondWrite.resolve(secondMerged);
    await vi.waitFor(() => expect(useAppStore.getState().settings).toEqual(secondMerged));
  });

  it("does not let an older progress write resurrect data after reset", async () => {
    await hydratePersistentStore();
    const olderWrite = deferred<CampaignProgress>();
    const replacement = deferred<CampaignProgress>();
    databaseMocks.saveProgress.mockImplementationOnce(() => olderWrite.promise);
    databaseMocks.resetProgress.mockImplementationOnce(() => replacement.promise);
    const base = createDefaultProgress();
    base.tutorialComplete = true;
    base.tracks["canyon-kickoff"].bestSoloMs = 95_000;
    useAppStore.setState({
      progress: base,
      persistenceStatus: { mode: "persistent", retrying: false },
    });

    useAppStore.getState().selectTrack("pine-run");
    await vi.waitFor(() => expect(databaseMocks.saveProgress).toHaveBeenCalledTimes(1));
    useAppStore.getState().resetLocalProgress();
    const staleMerged = structuredClone(base);
    staleMerged.selectedTrackId = "pine-run";
    staleMerged.tracks["canyon-kickoff"].bestSoloMs = 80_000;
    olderWrite.resolve(staleMerged);

    await vi.waitFor(() => expect(databaseMocks.resetProgress).toHaveBeenCalledTimes(1));
    expect(useAppStore.getState().progress).toEqual(createDefaultProgress());

    const reset = createDefaultProgress();
    replacement.resolve(reset);
    useAppStore.getState().selectTrack("pine-run");
    await vi.waitFor(() => expect(databaseMocks.saveProgress).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(useAppStore.getState().progress).toMatchObject({
      tutorialComplete: false,
      selectedTrackId: "pine-run",
    }));
    expect(
      useAppStore.getState().progress.tracks["canyon-kickoff"].bestSoloMs,
    ).toBeUndefined();
  });

  it("does not replace newer editor changes when a Test Ride save resolves", async () => {
    await hydratePersistentStore();
    const example = EXAMPLE_TRACKS[0];
    if (!example) throw new Error("Expected a Test Ride editor fixture.");
    const persistedBase = structuredClone(example);
    const snapshot = {
      ...structuredClone(example),
      name: "Snapshot under test",
      updatedAt: example.updatedAt + 1,
    };
    const saving = deferred<CustomTrackSaveResult>();
    databaseMocks.saveCustomTrack.mockImplementationOnce(() => saving.promise);
    useAppStore.setState({
      editorSession: {
        track: structuredClone(snapshot),
        persistedBase,
        past: [],
        future: [],
        category: "jumps",
        selectedModuleId: "ramp-medium",
        selectedPlacementId: null,
      },
      pendingTestRideSave: null,
    });

    const save = useAppStore.getState().saveTestRideTrack(snapshot, persistedBase);
    await vi.waitFor(() => expect(databaseMocks.saveCustomTrack).toHaveBeenCalledTimes(1));
    const newerDraft = {
      ...structuredClone(snapshot),
      name: "Newer edit while saving",
      updatedAt: snapshot.updatedAt + 1,
    };
    const currentSession = useAppStore.getState().editorSession;
    if (!currentSession) throw new Error("Expected the editor session to remain available.");
    useAppStore.getState().setEditorSession({
      ...currentSession,
      track: newerDraft,
    });
    saving.resolve({ track: snapshot, conflictCopy: false });
    await save;

    expect(useAppStore.getState().editorSession).toMatchObject({
      track: newerDraft,
      persistedBase: snapshot,
    });
  });

  it("rebases mutations and a reset made while retry is in flight", async () => {
    await hydratePersistentStore();
    const retry = deferred<ProfileData>();
    databaseMocks.retryPersistence.mockImplementationOnce(() => retry.promise);
    const beforeRetrySettings = structuredClone(DEFAULT_SETTINGS);
    const beforeRetryProgress = createDefaultProgress();
    beforeRetryProgress.tutorialComplete = true;
    beforeRetryProgress.tracks["canyon-kickoff"].bestSoloMs = 92_000;
    useAppStore.setState({
      settings: beforeRetrySettings,
      progress: beforeRetryProgress,
      pendingTestRideSave: null,
      persistenceStatus: {
        mode: "session",
        retrying: false,
        reason: "write",
        operation: "progress",
        occurredAt: 3,
      },
    });

    const retrying = useAppStore.getState().retryDevicePersistence();
    await vi.waitFor(() => expect(databaseMocks.retryPersistence).toHaveBeenCalledTimes(1));
    await useAppStore.getState().retryDevicePersistence();
    expect(databaseMocks.retryPersistence).toHaveBeenCalledTimes(1);

    const changedSettings = structuredClone(beforeRetrySettings);
    changedSettings.accessibility.highContrast = true;
    useAppStore.getState().updateSettings(changedSettings);
    useAppStore.getState().resetLocalProgress();
    useAppStore.getState().selectTrack("pine-run");

    const storedSettings = structuredClone(DEFAULT_SETTINGS);
    storedSettings.audio.master = 0.4;
    const storedProgress = createDefaultProgress();
    storedProgress.tutorialComplete = true;
    storedProgress.tracks["canyon-kickoff"].bestSoloMs = 80_000;
    retry.resolve({
      settings: storedSettings,
      progress: storedProgress,
      recovered: false,
    });
    await retrying;

    expect(databaseMocks.retryPersistence).toHaveBeenCalledWith(
      beforeRetrySettings,
      beforeRetryProgress,
      expect.objectContaining({ replaceProgress: false }),
    );
    expect(databaseMocks.resetProgress).toHaveBeenCalledWith(expect.objectContaining({
      tutorialComplete: false,
      selectedTrackId: "pine-run",
    }));
    expect(useAppStore.getState()).toMatchObject({
      settings: {
        audio: { master: 0.4 },
        accessibility: { highContrast: true },
      },
      progress: {
        tutorialComplete: false,
        selectedTrackId: "pine-run",
      },
      persistenceStatus: { mode: "persistent", retrying: false },
    });
    expect(
      useAppStore.getState().progress.tracks["canyon-kickoff"].bestSoloMs,
    ).toBeUndefined();
  });
});

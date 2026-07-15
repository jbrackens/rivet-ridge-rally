import { describe, expect, it, vi } from "vitest";

import type { CampaignProgress, GameSettings } from "../types";
import type { CustomTrackData } from "../../game/persistence/database";
import { EXAMPLE_TRACKS } from "../../game/editor/examples";

interface ProfileData {
  settings: GameSettings;
  progress: CampaignProgress;
  recovered: boolean;
}

const databaseMocks = vi.hoisted(() => ({
  loadGameData: vi.fn<() => Promise<ProfileData>>(),
  retryPersistence: vi.fn<(
    settings: GameSettings,
    progress: CampaignProgress,
    options: { preserveExistingProfile: boolean },
  ) => Promise<ProfileData>>(),
  saveCustomTrack: vi.fn<(track: CustomTrackData) => Promise<void>>(),
  saveProgress: vi.fn<(progress: CampaignProgress) => Promise<void>>(),
  saveSettings: vi.fn<(settings: GameSettings) => Promise<void>>(),
  subscribePersistenceFailures: vi.fn(() => () => undefined),
}));

vi.mock("../../game/persistence/database", async (importOriginal) => ({
  ...await importOriginal<typeof import("../../game/persistence/database")>(),
  ...databaseMocks,
}));

import { useAppStore } from "../store";
import {
  DEFAULT_SETTINGS,
  createDefaultProgress,
} from "../../game/persistence/database";

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
      { preserveExistingProfile: true },
    );
    expect(useAppStore.getState()).toMatchObject({
      settings: storedSettings,
      progress: storedProgress,
      persistenceStatus: { mode: "persistent", retrying: false },
    });
  });

  it("retains and retries the exact Test Ride snapshot until a track save succeeds", async () => {
    databaseMocks.retryPersistence.mockReset();
    databaseMocks.saveCustomTrack.mockReset();
    const example = EXAMPLE_TRACKS[0];
    if (!example) throw new Error("Expected a custom-track recovery fixture.");
    const attemptedTrack = structuredClone(example);
    const failedSnapshot = structuredClone(attemptedTrack);
    let rejectInitialSave: ((reason?: unknown) => void) | undefined;
    databaseMocks.saveCustomTrack.mockImplementationOnce(() => new Promise<void>((_resolve, reject) => {
      rejectInitialSave = reject;
    }));
    useAppStore.setState({
      pendingTestRideSave: null,
      persistenceStatus: { mode: "persistent", retrying: false },
    });

    const initialSave = useAppStore.getState().saveTestRideTrack(attemptedTrack);
    attemptedTrack.name = "Changed after Test Ride launched";
    if (!rejectInitialSave) throw new Error("Expected the Test Ride save to start.");
    rejectInitialSave(new Error("Injected Test Ride save failure."));
    await expect(initialSave).rejects.toThrow("Injected Test Ride save failure.");

    expect(useAppStore.getState().pendingTestRideSave).toEqual(failedSnapshot);
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
      .mockResolvedValueOnce(undefined);

    await useAppStore.getState().retryDevicePersistence();

    expect(useAppStore.getState()).toMatchObject({
      settings: recoveredSettings,
      progress: recoveredProgress,
      pendingTestRideSave: failedSnapshot,
      persistenceStatus: {
        mode: "session",
        operation: "custom-tracks",
        retrying: false,
      },
    });

    await useAppStore.getState().retryDevicePersistence();

    expect(databaseMocks.saveCustomTrack).toHaveBeenLastCalledWith(failedSnapshot);
    expect(useAppStore.getState()).toMatchObject({
      pendingTestRideSave: null,
      persistenceStatus: { mode: "persistent", retrying: false },
    });
  });
});

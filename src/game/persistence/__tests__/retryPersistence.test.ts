import { afterEach, describe, expect, it, vi } from "vitest";

import {
  DEFAULT_SETTINGS,
  createDefaultProgress,
  gameDatabase,
  loadGameData,
  retryPersistence,
} from "../database";

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function runTransactionsImmediately(beforeTask?: () => void) {
  return vi.spyOn(gameDatabase, "transaction").mockImplementation((async (...args: unknown[]) => {
    const task = args.at(-1);
    if (typeof task !== "function") throw new Error("Expected a transaction callback.");
    beforeTask?.();
    return (task as () => unknown)();
  }) as never);
}

describe("persistence retry reconciliation", () => {
  it("reads and preserves valid stored records after a failed initial load", async () => {
    runTransactionsImmediately();
    const sessionSettings = structuredClone(DEFAULT_SETTINGS);
    sessionSettings.audio.master = 0.1;
    const sessionProgress = createDefaultProgress();
    sessionProgress.selectedTrackId = "pine-run";

    const storedSettings = structuredClone(DEFAULT_SETTINGS);
    storedSettings.audio.master = 0.7;
    const storedProgress = createDefaultProgress();
    storedProgress.tutorialComplete = true;
    storedProgress.selectedTrackId = "summit-showdown";
    storedProgress.tracks["canyon-kickoff"].bestSoloMs = 98_000;

    vi.spyOn(gameDatabase, "close").mockImplementation(() => undefined);
    vi.spyOn(gameDatabase, "open").mockResolvedValue(gameDatabase);
    vi.spyOn(gameDatabase.settings, "get").mockResolvedValue({
      id: "rider-01",
      schemaVersion: 1,
      value: storedSettings,
      updatedAt: 1,
    });
    vi.spyOn(gameDatabase.progress, "get").mockResolvedValue({
      id: "rider-01",
      schemaVersion: 1,
      value: storedProgress,
      updatedAt: 1,
    });
    const settingsPut = vi.spyOn(gameDatabase.settings, "put");
    const progressPut = vi.spyOn(gameDatabase.progress, "put");

    const reconciled = await retryPersistence(sessionSettings, sessionProgress, {
      preserveExistingProfile: true,
    });

    expect(reconciled).toEqual({
      settings: storedSettings,
      progress: storedProgress,
      recovered: false,
    });
    expect(settingsPut).not.toHaveBeenCalled();
    expect(progressPut).not.toHaveBeenCalled();
  });

  it("quarantines one corrupt profile record and writes only that fallback", async () => {
    const transaction = runTransactionsImmediately();
    const storedSettings = structuredClone(DEFAULT_SETTINGS);
    storedSettings.audio.master = 0.72;
    const fallbackProgress = createDefaultProgress();
    fallbackProgress.selectedTrackId = "pine-run";
    const corruptProgressRecord = {
      id: "rider-01",
      schemaVersion: 1,
      value: { version: 1 },
      updatedAt: 1,
    };

    vi.spyOn(gameDatabase, "close").mockImplementation(() => undefined);
    vi.spyOn(gameDatabase, "open").mockResolvedValue(gameDatabase);
    vi.spyOn(gameDatabase.settings, "get").mockResolvedValue({
      id: "rider-01",
      schemaVersion: 1,
      value: storedSettings,
      updatedAt: 1,
    });
    vi.spyOn(gameDatabase.progress, "get").mockResolvedValue(corruptProgressRecord as never);
    vi.spyOn(gameDatabase.quarantine, "toArray").mockResolvedValue([]);
    const quarantineAdd = vi.spyOn(gameDatabase.quarantine, "add").mockResolvedValue(1);
    const settingsPut = vi.spyOn(gameDatabase.settings, "put").mockResolvedValue("rider-01");
    const progressPut = vi.spyOn(gameDatabase.progress, "put").mockResolvedValue("rider-01");

    const reconciled = await retryPersistence(DEFAULT_SETTINGS, fallbackProgress, {
      preserveExistingProfile: true,
    });

    expect(reconciled).toEqual({
      settings: storedSettings,
      progress: fallbackProgress,
      recovered: true,
    });
    expect(transaction).toHaveBeenCalledWith(
      "rw",
      gameDatabase.settings,
      gameDatabase.progress,
      gameDatabase.quarantine,
      expect.any(Function),
    );
    expect(quarantineAdd).toHaveBeenCalledWith(expect.objectContaining({
      kind: "progress",
      payload: corruptProgressRecord,
    }));
    expect(settingsPut).not.toHaveBeenCalled();
    expect(progressPut).toHaveBeenCalledWith(expect.objectContaining({
      value: fallbackProgress,
    }));
  });

  it("re-reads and preserves a concurrently updated valid companion record", async () => {
    const staleProgress = createDefaultProgress();
    staleProgress.selectedTrackId = "pine-run";
    const concurrentProgress = createDefaultProgress();
    concurrentProgress.tutorialComplete = true;
    concurrentProgress.selectedTrackId = "summit-showdown";
    let currentProgressRecord = {
      id: "rider-01",
      schemaVersion: 1 as const,
      value: staleProgress,
      updatedAt: 1,
    };
    const transaction = runTransactionsImmediately(() => {
      currentProgressRecord = {
        id: "rider-01",
        schemaVersion: 1,
        value: concurrentProgress,
        updatedAt: 2,
      };
    });
    const fallbackSettings = structuredClone(DEFAULT_SETTINGS);
    fallbackSettings.audio.master = 0.15;
    const corruptSettingsRecord = {
      id: "rider-01",
      schemaVersion: 1,
      value: { quality: "invalid" },
      updatedAt: 1,
    };

    vi.spyOn(gameDatabase, "close").mockImplementation(() => undefined);
    vi.spyOn(gameDatabase, "open").mockResolvedValue(gameDatabase);
    vi.spyOn(gameDatabase.settings, "get").mockResolvedValue(corruptSettingsRecord as never);
    vi.spyOn(gameDatabase.progress, "get").mockImplementation((async () => currentProgressRecord) as never);
    vi.spyOn(gameDatabase.quarantine, "toArray").mockResolvedValue([]);
    const quarantineAdd = vi.spyOn(gameDatabase.quarantine, "add").mockResolvedValue(1);
    const settingsPut = vi.spyOn(gameDatabase.settings, "put").mockResolvedValue("rider-01");
    const progressPut = vi.spyOn(gameDatabase.progress, "put").mockResolvedValue("rider-01");

    const reconciled = await retryPersistence(fallbackSettings, staleProgress, {
      preserveExistingProfile: true,
    });

    expect(reconciled).toEqual({
      settings: fallbackSettings,
      progress: concurrentProgress,
      recovered: true,
    });
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(quarantineAdd).toHaveBeenCalledWith(expect.objectContaining({
      kind: "settings",
      payload: corruptSettingsRecord,
    }));
    expect(settingsPut).toHaveBeenCalledWith(expect.objectContaining({
      value: fallbackSettings,
    }));
    expect(progressPut).not.toHaveBeenCalled();
  });

  it("refuses to overwrite profile data from a future schema version", async () => {
    runTransactionsImmediately();
    const storedProgress = createDefaultProgress();
    vi.spyOn(gameDatabase, "close").mockImplementation(() => undefined);
    vi.spyOn(gameDatabase, "open").mockResolvedValue(gameDatabase);
    vi.spyOn(gameDatabase.settings, "get").mockResolvedValue({
      id: "rider-01",
      schemaVersion: 2,
      value: DEFAULT_SETTINGS,
      updatedAt: 1,
    } as never);
    vi.spyOn(gameDatabase.progress, "get").mockResolvedValue({
      id: "rider-01",
      schemaVersion: 1,
      value: storedProgress,
      updatedAt: 1,
    });
    const settingsPut = vi.spyOn(gameDatabase.settings, "put");
    const progressPut = vi.spyOn(gameDatabase.progress, "put");
    const quarantineAdd = vi.spyOn(gameDatabase.quarantine, "add");

    await expect(retryPersistence(DEFAULT_SETTINGS, storedProgress, {
      preserveExistingProfile: true,
    })).rejects.toThrow("newer schema version");
    expect(settingsPut).not.toHaveBeenCalled();
    expect(progressPut).not.toHaveBeenCalled();
    expect(quarantineAdd).not.toHaveBeenCalled();
  });

  it("leaves boot with a blocked failure instead of waiting forever", async () => {
    vi.useFakeTimers();
    vi.spyOn(gameDatabase, "isOpen").mockReturnValue(false);
    vi.spyOn(gameDatabase, "close").mockImplementation(() => undefined);
    vi.spyOn(gameDatabase, "open").mockImplementation(
      () => new Promise(() => undefined) as ReturnType<typeof gameDatabase.open>,
    );

    const loading = loadGameData();
    const rejection = expect(loading).rejects.toThrow("blocked by another open");
    gameDatabase.on.blocked.fire(new Event("blocked"));
    await vi.advanceTimersByTimeAsync(2_000);

    await rejection;
  });
});

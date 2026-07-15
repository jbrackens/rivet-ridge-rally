import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { RaceResult } from "../../../app/types";
import { EXAMPLE_TRACKS } from "../../editor/examples";
import {
  DEFAULT_SETTINGS,
  deleteCustomTrackRecovery,
  gameDatabase,
  listCustomTracks,
  saveCustomTrack,
  saveReplay,
  saveSettings,
  type CustomTrackData,
} from "../database";

function cloneExample(): CustomTrackData {
  const example = EXAMPLE_TRACKS[0];
  if (!example) throw new Error("Editor examples must include a persistence-boundary fixture.");
  return structuredClone(example);
}

function resultFixture(): RaceResult {
  return {
    mode: "solo",
    trackId: "canyon-kickoff",
    finishTimeMs: 60_000,
    position: 1,
    fieldSize: 1,
    checkpointCount: 2,
    lapTimesMs: [60_000],
    splitTimesMs: [30_000, 60_000],
    personalBest: true,
    bestTimeMs: 60_000,
    classification: [{
      riderId: "player",
      riderName: "Rider",
      position: 1,
      finishTimeMs: 60_000,
      isPlayer: true,
    }],
    crashes: 0,
    overheats: 0,
    coachingHint: "Clean run.",
  };
}

function runTransactionsImmediately(): void {
  vi.spyOn(gameDatabase, "transaction").mockImplementation((async (...args: unknown[]) => {
    const task = args.at(-1);
    if (typeof task !== "function") throw new Error("Expected a transaction callback.");
    return (task as () => unknown)();
  }) as never);
}

beforeEach(() => {
  vi.spyOn(gameDatabase, "isOpen").mockReturnValue(true);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("strict settings records", () => {
  it("rejects unknown key-binding actions", async () => {
    const settings = structuredClone(DEFAULT_SETTINGS);
    (settings.controls.keyBindings as Record<string, string>).accelerate = "KeyW";
    const put = vi.spyOn(gameDatabase.settings, "put");

    await expect(saveSettings(settings)).rejects.toThrow();
    expect(put).not.toHaveBeenCalled();
  });

  it("rejects unbounded key-code strings", async () => {
    const settings = structuredClone(DEFAULT_SETTINGS);
    settings.controls.keyBindings.throttle = "K".repeat(65);
    const put = vi.spyOn(gameDatabase.settings, "put");

    await expect(saveSettings(settings)).rejects.toThrow();
    expect(put).not.toHaveBeenCalled();
  });

  it("rejects a missing required key-binding action", async () => {
    const settings = structuredClone(DEFAULT_SETTINGS);
    delete (settings.controls.keyBindings as Partial<Record<string, string>>).pause;
    const put = vi.spyOn(gameDatabase.settings, "put");

    await expect(saveSettings(settings)).rejects.toThrow();
    expect(put).not.toHaveBeenCalled();
  });
});

describe("bounded local collections", () => {
  it("rejects a new custom track when the 100-record library is full", async () => {
    runTransactionsImmediately();
    vi.spyOn(gameDatabase.customTracks, "get").mockResolvedValue(undefined);
    vi.spyOn(gameDatabase.customTracks, "count").mockResolvedValue(100);
    const put = vi.spyOn(gameDatabase.customTracks, "put");

    await expect(saveCustomTrack(cloneExample())).rejects.toThrow("Track library limit reached");
    expect(put).not.toHaveBeenCalled();
  });

  it("rejects a new custom track when existing records consume the 25 MB aggregate limit", async () => {
    runTransactionsImmediately();
    const storedPayload = "x".repeat(300_000);
    vi.spyOn(gameDatabase.customTracks, "get").mockResolvedValue(undefined);
    vi.spyOn(gameDatabase.customTracks, "count").mockResolvedValue(84);
    vi.spyOn(gameDatabase.customTracks, "toArray").mockResolvedValue(Array.from(
      { length: 84 },
      (_, index) => ({ id: `stored-${index}`, thumbnail: storedPayload }),
    ) as never);
    const put = vi.spyOn(gameDatabase.customTracks, "put");
    const remove = vi.spyOn(gameDatabase.customTracks, "delete");

    await expect(saveCustomTrack(cloneExample())).rejects.toThrow(
      "Track library has reached its 25 MB safety limit",
    );
    expect(put).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
  });

  it("fails closed when an existing custom-track record cannot be measured", async () => {
    runTransactionsImmediately();
    const cyclicRecord: Record<string, unknown> = { id: "cyclic-record" };
    cyclicRecord.self = cyclicRecord;
    vi.spyOn(gameDatabase.customTracks, "get").mockResolvedValue(undefined);
    vi.spyOn(gameDatabase.customTracks, "count").mockResolvedValue(1);
    vi.spyOn(gameDatabase.customTracks, "toArray").mockResolvedValue([cyclicRecord] as never);
    const put = vi.spyOn(gameDatabase.customTracks, "put");

    await expect(saveCustomTrack(cloneExample())).rejects.toThrow(
      "An existing track record could not be measured safely",
    );
    expect(put).not.toHaveBeenCalled();
  });

  it("leaves a corrupt active track in place when recovery storage is full", async () => {
    runTransactionsImmediately();
    const corruptTrack = {
      ...cloneExample(),
      id: "missing-updated-at",
      updatedAt: undefined,
    };
    vi.spyOn(gameDatabase.customTracks, "toArray").mockResolvedValue([corruptTrack] as never);
    vi.spyOn(gameDatabase.customTracks, "get").mockResolvedValue(corruptTrack as never);
    vi.spyOn(gameDatabase.quarantine, "toArray").mockResolvedValue(Array.from(
      { length: 100 },
      (_, key) => ({
        key: key + 1,
        kind: "custom-track",
        reason: "Earlier recovery",
        payload: {},
        payloadBytes: 2,
        createdAt: key + 1,
      }),
    ) as never);
    const quarantineAdd = vi.spyOn(gameDatabase.quarantine, "add");
    const activeDelete = vi.spyOn(gameDatabase.customTracks, "delete");
    vi.spyOn(gameDatabase.quarantine, "where").mockReturnValue({
      equals: () => ({
        reverse: () => ({ sortBy: async () => [] }),
      }),
    } as never);

    const library = await listCustomTracks();

    expect(quarantineAdd).not.toHaveBeenCalled();
    expect(activeDelete).not.toHaveBeenCalled();
    expect(library).toMatchObject({
      tracks: [],
      recoveries: [{ name: "Cooling Canyon", quarantined: false, key: null }],
    });
  });

  it("leaves a corrupt active track in place at the 10 MB aggregate recovery limit", async () => {
    runTransactionsImmediately();
    const corruptTrack = {
      ...cloneExample(),
      id: "aggregate-recovery-limit",
      updatedAt: undefined,
    };
    vi.spyOn(gameDatabase.customTracks, "toArray").mockResolvedValue([corruptTrack] as never);
    vi.spyOn(gameDatabase.customTracks, "get").mockResolvedValue(corruptTrack as never);
    vi.spyOn(gameDatabase.quarantine, "toArray").mockResolvedValue(Array.from(
      { length: 10 },
      (_, key) => ({
        key: key + 1,
        kind: "custom-track",
        reason: "Earlier recovery",
        payload: {},
        payloadBytes: 1_000_000,
        createdAt: key + 1,
      }),
    ) as never);
    const quarantineAdd = vi.spyOn(gameDatabase.quarantine, "add");
    const activeDelete = vi.spyOn(gameDatabase.customTracks, "delete");
    vi.spyOn(gameDatabase.quarantine, "where").mockReturnValue({
      equals: () => ({
        reverse: () => ({ sortBy: async () => [] }),
      }),
    } as never);

    const library = await listCustomTracks();

    expect(quarantineAdd).not.toHaveBeenCalled();
    expect(activeDelete).not.toHaveBeenCalled();
    expect(library.recoveries).toEqual([
      expect.objectContaining({ name: "Cooling Canyon", quarantined: false, key: null }),
    ]);
  });

  it("keeps a valid cross-tab replacement instead of recovering a stale corrupt snapshot", async () => {
    runTransactionsImmediately();
    const staleTrack = {
      ...cloneExample(),
      id: "cross-tab-track",
      updatedAt: undefined,
    };
    const replacement = {
      ...cloneExample(),
      id: "cross-tab-track",
      name: "Cross-tab replacement",
      updatedAt: Date.now(),
    };
    vi.spyOn(gameDatabase.customTracks, "toArray").mockResolvedValue([staleTrack] as never);
    vi.spyOn(gameDatabase.customTracks, "get").mockResolvedValue(replacement);
    const quarantineAdd = vi.spyOn(gameDatabase.quarantine, "add");
    const activeDelete = vi.spyOn(gameDatabase.customTracks, "delete");
    vi.spyOn(gameDatabase.quarantine, "where").mockReturnValue({
      equals: () => ({
        reverse: () => ({ sortBy: async () => [] }),
      }),
    } as never);

    const library = await listCustomTracks();

    expect(quarantineAdd).not.toHaveBeenCalled();
    expect(activeDelete).not.toHaveBeenCalled();
    expect(library).toEqual({ tracks: [replacement], recoveries: [] });
  });

  it("quarantines the current corrupt cross-tab snapshot instead of the stale scan result", async () => {
    runTransactionsImmediately();
    const staleTrack = {
      ...cloneExample(),
      id: "cross-tab-corrupt-track",
      name: "Stale corrupt track",
      updatedAt: undefined,
    };
    const currentTrack = {
      ...cloneExample(),
      id: "cross-tab-corrupt-track",
      name: "Current corrupt track",
      laps: 0,
    };
    vi.spyOn(gameDatabase.customTracks, "toArray").mockResolvedValue([staleTrack] as never);
    vi.spyOn(gameDatabase.customTracks, "get").mockResolvedValue(currentTrack as never);
    vi.spyOn(gameDatabase.quarantine, "toArray").mockResolvedValue([]);
    const quarantineAdd = vi.spyOn(gameDatabase.quarantine, "add").mockResolvedValue(1);
    const activeDelete = vi.spyOn(gameDatabase.customTracks, "delete").mockResolvedValue(undefined);
    vi.spyOn(gameDatabase.quarantine, "where").mockReturnValue({
      equals: () => ({
        reverse: () => ({ sortBy: async () => [] }),
      }),
    } as never);

    await listCustomTracks();

    expect(quarantineAdd).toHaveBeenCalledWith(expect.objectContaining({
      kind: "custom-track",
      payload: currentTrack,
    }));
    expect(activeDelete).toHaveBeenCalledWith(currentTrack.id);
  });

  it("removes only the selected custom-track recovery record", async () => {
    runTransactionsImmediately();
    vi.spyOn(gameDatabase.quarantine, "get").mockResolvedValue({
      key: 7,
      kind: "custom-track",
      reason: "Invalid route",
      payload: {},
      payloadBytes: 2,
      createdAt: 1,
    } as never);
    const remove = vi.spyOn(gameDatabase.quarantine, "delete").mockResolvedValue(undefined);

    await deleteCustomTrackRecovery(7);

    expect(remove).toHaveBeenCalledWith(7);
  });

  it("refuses to remove another quarantine kind through the track-recovery API", async () => {
    runTransactionsImmediately();
    vi.spyOn(gameDatabase.quarantine, "get").mockResolvedValue({
      key: 8,
      kind: "settings",
      reason: "Invalid settings",
      payload: {},
      payloadBytes: 2,
      createdAt: 1,
    } as never);
    const remove = vi.spyOn(gameDatabase.quarantine, "delete");

    await expect(deleteCustomTrackRecovery(8)).rejects.toThrow(
      "The selected track recovery is no longer available.",
    );
    expect(remove).not.toHaveBeenCalled();
  });

  it("rejects replay samples beyond the 512 KB limit before writing", async () => {
    const put = vi.spyOn(gameDatabase.replays, "put");

    await expect(saveReplay(resultFixture(), new Uint8Array(512_001))).rejects.toThrow(
      "Replay exceeds the 512 KB local-storage safety limit",
    );
    expect(put).not.toHaveBeenCalled();
  });

  it("prunes replay history to the newest 20 records", async () => {
    runTransactionsImmediately();
    vi.spyOn(gameDatabase.replays, "put").mockResolvedValue("new-replay");
    vi.spyOn(gameDatabase.replays, "where").mockReturnValue({
      equals: () => ({
        reverse: () => ({
          sortBy: async () => Array.from(
            { length: 21 },
            (_, index) => ({ id: `replay-${index}` }),
          ),
        }),
      }),
    } as never);
    const remove = vi.spyOn(gameDatabase.replays, "bulkDelete").mockResolvedValue(undefined);

    await saveReplay(resultFixture(), new Uint8Array([1, 2, 3]));

    expect(remove).toHaveBeenCalledWith(["replay-20"]);
  });

  it("rejects the replay transaction when pruning fails after insertion", async () => {
    const events: string[] = [];
    const transaction = vi.spyOn(gameDatabase, "transaction").mockImplementation((async (...args: unknown[]) => {
      const task = args.at(-1);
      if (typeof task !== "function") {
        throw new Error("Expected a transaction callback.");
      }

      events.push("transaction:start");
      try {
        return await (task as () => Promise<unknown>)();
      } finally {
        events.push("transaction:end");
      }
    }) as never);
    vi.spyOn(gameDatabase.replays, "put").mockImplementation((async () => {
      events.push("put");
      return "new-replay";
    }) as never);
    vi.spyOn(gameDatabase.replays, "where").mockImplementation(() => {
      events.push("query");
      return {
        equals: () => ({
          reverse: () => ({
            sortBy: async () => {
              events.push("sort");
              return Array.from(
                { length: 21 },
                (_, index) => ({ id: `replay-${index}` }),
              );
            },
          }),
        }),
      } as never;
    });
    vi.spyOn(gameDatabase.replays, "bulkDelete").mockImplementation((async () => {
      events.push("delete");
      throw new Error("Injected replay prune failure.");
    }) as never);

    await expect(saveReplay(resultFixture(), new Uint8Array([1, 2, 3]))).rejects.toThrow(
      "Injected replay prune failure.",
    );

    expect(transaction).toHaveBeenCalledWith("rw", gameDatabase.replays, expect.any(Function));
    expect(events).toEqual([
      "transaction:start",
      "put",
      "query",
      "sort",
      "delete",
      "transaction:end",
    ]);
  });
});

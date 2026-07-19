import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { RaceResult } from "../../../app/types";
import { EXAMPLE_TRACKS } from "../../editor/examples";
import { FIXED_DT, RaceSimulation } from "../../simulation";
import { ReplayRecorder } from "../../replay/replayCodec";
import {
  DEFAULT_SETTINGS,
  createDefaultProgress,
  deleteCustomTrack,
  deleteCustomTrackRecovery,
  gameDatabase,
  getCustomTrackReplayRevision,
  listCustomTracks,
  MAX_REPLAY_RECORDS,
  saveCustomTrack,
  saveProgress,
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

function replayFixture(): Uint8Array {
  const recorder = new ReplayRecorder(512_000);
  const initial = new RaceSimulation().snapshot;
  const terminalStep = Math.round(60 / FIXED_DT);
  for (let stepCount = 0; stepCount < terminalStep; stepCount += 6) {
    recorder.capture({
      ...initial,
      stepCount,
      timeSeconds: stepCount * FIXED_DT,
    });
  }
  if (!recorder.finalize({
    ...initial,
    stepCount: terminalStep,
    timeSeconds: terminalStep * FIXED_DT,
  })) {
    throw new Error("Expected the replay fixture to finalize.");
  }
  return recorder.toUint8Array();
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

    await expect(saveSettings(DEFAULT_SETTINGS, settings)).rejects.toThrow();
    expect(put).not.toHaveBeenCalled();
  });

  it("rejects unbounded key-code strings", async () => {
    const settings = structuredClone(DEFAULT_SETTINGS);
    settings.controls.keyBindings.throttle = "K".repeat(65);
    const put = vi.spyOn(gameDatabase.settings, "put");

    await expect(saveSettings(DEFAULT_SETTINGS, settings)).rejects.toThrow();
    expect(put).not.toHaveBeenCalled();
  });

  it("rejects a missing required key-binding action", async () => {
    const settings = structuredClone(DEFAULT_SETTINGS);
    delete (settings.controls.keyBindings as Partial<Record<string, string>>).pause;
    const put = vi.spyOn(gameDatabase.settings, "put");

    await expect(saveSettings(DEFAULT_SETTINGS, settings)).rejects.toThrow();
    expect(put).not.toHaveBeenCalled();
  });
});

describe("cross-tab profile reconciliation", () => {
  it("preserves a concurrent audio edit while applying a disjoint accessibility change", async () => {
    runTransactionsImmediately();
    const base = structuredClone(DEFAULT_SETTINGS);
    const current = structuredClone(base);
    current.audio.master = 0.35;
    const next = structuredClone(base);
    next.accessibility.highContrast = true;
    vi.spyOn(gameDatabase.settings, "get").mockResolvedValue({
      id: "rider-01",
      schemaVersion: 1,
      value: current,
      updatedAt: 1,
    });
    const put = vi.spyOn(gameDatabase.settings, "put").mockResolvedValue("rider-01");

    const saved = await saveSettings(base, next);

    expect(saved.audio.master).toBe(0.35);
    expect(saved.accessibility.highContrast).toBe(true);
    expect(put).toHaveBeenCalledWith(expect.objectContaining({ value: saved }));
  });

  it("preserves disjoint key-binding edits from two tabs", async () => {
    runTransactionsImmediately();
    const base = structuredClone(DEFAULT_SETTINGS);
    const current = structuredClone(base);
    current.controls.keyBindings.throttle = "KeyT";
    const next = structuredClone(base);
    next.controls.keyBindings.recover = "KeyR";
    vi.spyOn(gameDatabase.settings, "get").mockResolvedValue({
      id: "rider-01",
      schemaVersion: 1,
      value: current,
      updatedAt: 1,
    });
    vi.spyOn(gameDatabase.settings, "put").mockResolvedValue("rider-01");

    const saved = await saveSettings(base, next);

    expect(saved.controls.keyBindings).toMatchObject({
      throttle: "KeyT",
      recover: "KeyR",
    });
  });

  it("resolves a combined key-binding collision in favor of the local remap", async () => {
    runTransactionsImmediately();
    const base = structuredClone(DEFAULT_SETTINGS);
    const current = structuredClone(base);
    current.controls.keyBindings.throttle = "KeyR";
    const next = structuredClone(base);
    next.controls.keyBindings.recover = "KeyR";
    vi.spyOn(gameDatabase.settings, "get").mockResolvedValue({
      id: "rider-01",
      schemaVersion: 1,
      value: current,
      updatedAt: 1,
    });
    vi.spyOn(gameDatabase.settings, "put").mockResolvedValue("rider-01");

    const saved = await saveSettings(base, next);

    expect(saved.controls.keyBindings.throttle).toBe("KeyW");
    expect(saved.controls.keyBindings.recover).toBe("KeyR");
    expect(new Set(Object.values(saved.controls.keyBindings)).size).toBe(
      Object.keys(saved.controls.keyBindings).length,
    );
  });

  it("unions concurrent progress gains without detaching best-time splits", async () => {
    runTransactionsImmediately();
    const base = createDefaultProgress();
    const current = structuredClone(base);
    current.tracks["pine-run"].rivalUnlocked = true;
    current.tracks["pine-run"].bestRivalPosition = 2;
    const next = structuredClone(base);
    next.tracks["canyon-kickoff"].soloQualified = true;
    next.tracks["canyon-kickoff"].bestSoloMs = 90_000;
    next.tracks["canyon-kickoff"].bestSoloLapTimesMs = [90_000];
    next.tracks["canyon-kickoff"].bestSoloSplitTimesMs = [45_000, 90_000];
    vi.spyOn(gameDatabase.progress, "get").mockResolvedValue({
      id: "rider-01",
      schemaVersion: 1,
      value: current,
      updatedAt: 1,
    });
    vi.spyOn(gameDatabase.progress, "put").mockResolvedValue("rider-01");

    const saved = await saveProgress(base, next);

    expect(saved.tracks["pine-run"]).toMatchObject({
      rivalUnlocked: true,
      bestRivalPosition: 2,
    });
    expect(saved.tracks["canyon-kickoff"]).toMatchObject({
      soloQualified: true,
      bestSoloMs: 90_000,
      bestSoloLapTimesMs: [90_000],
      bestSoloSplitTimesMs: [45_000, 90_000],
    });
  });

  it("does not resurrect unchanged stale progress after another tab resets it", async () => {
    runTransactionsImmediately();
    const base = createDefaultProgress();
    base.tutorialComplete = true;
    base.tracks["canyon-kickoff"].soloQualified = true;
    base.tracks["canyon-kickoff"].bestSoloMs = 90_000;
    const reset = createDefaultProgress();
    vi.spyOn(gameDatabase.progress, "get").mockResolvedValue({
      id: "rider-01",
      schemaVersion: 1,
      value: reset,
      updatedAt: 2,
    });
    vi.spyOn(gameDatabase.progress, "put").mockResolvedValue("rider-01");

    const saved = await saveProgress(base, structuredClone(base));

    expect(saved).toEqual(reset);
  });

  it("restores prerequisite unlocks when accepting new gains after a remote reset", async () => {
    runTransactionsImmediately();
    const base = createDefaultProgress();
    const baseTrack = base.tracks["canyon-kickoff"];
    baseTrack.soloQualified = true;
    baseTrack.rivalUnlocked = true;
    baseTrack.bestSoloMs = 95_000;
    baseTrack.bestRivalPosition = 3;
    baseTrack.masteryLevel = 1;
    const current = createDefaultProgress();
    const next = structuredClone(base);
    const nextTrack = next.tracks["canyon-kickoff"];
    nextTrack.bestSoloMs = 90_000;
    nextTrack.bestRivalPosition = 2;
    nextTrack.masteryLevel = 2;
    vi.spyOn(gameDatabase.progress, "get").mockResolvedValue({
      id: "rider-01",
      schemaVersion: 1,
      value: current,
      updatedAt: 2,
    });
    vi.spyOn(gameDatabase.progress, "put").mockResolvedValue("rider-01");

    const saved = await saveProgress(base, next);

    expect(saved.tracks["canyon-kickoff"]).toMatchObject({
      soloQualified: true,
      rivalUnlocked: true,
      bestSoloMs: 90_000,
      bestRivalPosition: 2,
      masteryLevel: 2,
    });
  });
});

describe("cross-tab custom-track safety", () => {
  it("keeps the authored identity when the persisted base is still current", async () => {
    runTransactionsImmediately();
    const base = cloneExample();
    const local = {
      ...structuredClone(base),
      name: "Test Ride revision",
      updatedAt: base.updatedAt + 1,
    };
    vi.spyOn(gameDatabase.customTracks, "get").mockResolvedValue(base);
    vi.spyOn(gameDatabase.customTracks, "toArray").mockResolvedValue([base]);
    const put = vi.spyOn(gameDatabase.customTracks, "put").mockResolvedValue(local.id);

    const saved = await saveCustomTrack(local, base);

    expect(saved).toEqual({ track: local, conflictCopy: false });
    expect(put).toHaveBeenCalledWith(local);
  });

  it("preserves both versions by creating a conflict copy for a stale editor", async () => {
    runTransactionsImmediately();
    const base = cloneExample();
    const current = { ...structuredClone(base), laps: 3, updatedAt: base.updatedAt + 1 };
    const local = { ...structuredClone(base), name: "Local revision", updatedAt: base.updatedAt + 2 };
    vi.spyOn(gameDatabase.customTracks, "get").mockResolvedValue(current);
    vi.spyOn(gameDatabase.customTracks, "count").mockResolvedValue(1);
    vi.spyOn(gameDatabase.customTracks, "toArray").mockResolvedValue([current]);
    const put = vi.spyOn(gameDatabase.customTracks, "put").mockResolvedValue(local.id);

    const saved = await saveCustomTrack(local, base);

    expect(saved.conflictCopy).toBe(true);
    expect(saved.track.id).not.toBe(local.id);
    expect(saved.track.name).toContain("Conflict Copy");
    expect(put).toHaveBeenCalledWith(saved.track);
  });

  it("refuses a stale delete after the stored track changes", async () => {
    runTransactionsImmediately();
    const base = cloneExample();
    const current = { ...structuredClone(base), laps: 3, updatedAt: base.updatedAt + 1 };
    vi.spyOn(gameDatabase.customTracks, "get").mockResolvedValue(current);
    const remove = vi.spyOn(gameDatabase.customTracks, "delete");

    await expect(deleteCustomTrack(base.id, base)).resolves.toEqual({
      deleted: false,
      conflict: true,
    });
    expect(remove).not.toHaveBeenCalled();
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

  it("rejects malformed replay bytes before writing", async () => {
    const put = vi.spyOn(gameDatabase.replays, "put");

    await expect(saveReplay(resultFixture(), new Uint8Array([1, 2, 3]))).rejects.toThrow(
      "Replay header is truncated",
    );
    expect(put).not.toHaveBeenCalled();
  });

  it("rejects incomplete replays and result times that do not match the terminal step", async () => {
    const put = vi.spyOn(gameDatabase.replays, "put");
    const incomplete = new ReplayRecorder(512_000);
    incomplete.capture(new RaceSimulation().snapshot);

    await expect(saveReplay(resultFixture(), incomplete.toUint8Array())).rejects.toThrow(
      "does not end with a terminal sample",
    );
    await expect(saveReplay(
      { ...resultFixture(), finishTimeMs: 60_001 },
      replayFixture(),
    )).rejects.toThrow("terminal time does not match the race result");
    expect(put).not.toHaveBeenCalled();
  });

  it("binds custom replays to the exact authored course revision", async () => {
    runTransactionsImmediately();
    const track = cloneExample();
    const revision = getCustomTrackReplayRevision(track);
    let inserted: unknown;
    vi.spyOn(gameDatabase.replays, "put").mockImplementation((async (record: unknown) => {
      inserted = record;
      return "new-replay";
    }) as never);
    vi.spyOn(gameDatabase.replays, "where").mockReturnValue({
      equals: () => ({ toArray: async () => [] }),
    } as never);
    vi.spyOn(gameDatabase.replays, "toArray").mockResolvedValue([]);

    await saveReplay(
      {
        ...resultFixture(),
        mode: "custom",
        trackName: track.name,
      },
      replayFixture(),
      track,
    );

    expect(inserted).toMatchObject({
      schemaVersion: 2,
      codecVersion: 2,
      courseKey: `custom:${track.id}:${revision}`,
      trackId: "custom",
      customTrackId: track.id,
      customTrackRevision: revision,
      mode: "custom",
    });
  });

  it("refuses a custom replay when its exact course revision is unavailable", async () => {
    const put = vi.spyOn(gameDatabase.replays, "put");

    await expect(saveReplay(
      { ...resultFixture(), mode: "custom" },
      replayFixture(),
    )).rejects.toThrow("requires its exact authored course revision");
    expect(put).not.toHaveBeenCalled();
  });

  it("prunes replay history deterministically per exact course", async () => {
    runTransactionsImmediately();
    vi.spyOn(gameDatabase.replays, "put").mockResolvedValue("new-replay");
    const records = Array.from(
      { length: 21 },
      (_, index) => ({ id: `replay-${index}`, createdAt: 21 - index }),
    );
    vi.spyOn(gameDatabase.replays, "where").mockReturnValue({
      equals: () => ({
        toArray: async () => records,
      }),
    } as never);
    vi.spyOn(gameDatabase.replays, "toArray").mockResolvedValue(records as never);
    const remove = vi.spyOn(gameDatabase.replays, "bulkDelete").mockResolvedValue(undefined);

    await saveReplay(resultFixture(), replayFixture());

    expect(remove).toHaveBeenCalledWith(["replay-20"]);
  });

  it("caps replay records globally across many custom course identities", async () => {
    runTransactionsImmediately();
    vi.spyOn(gameDatabase.replays, "put").mockResolvedValue("new-replay");
    vi.spyOn(gameDatabase.replays, "where").mockReturnValue({
      equals: () => ({ toArray: async () => [] }),
    } as never);
    vi.spyOn(gameDatabase.replays, "toArray").mockResolvedValue(Array.from(
      { length: MAX_REPLAY_RECORDS + 1 },
      (_, index) => ({ id: `replay-${index}`, createdAt: MAX_REPLAY_RECORDS + 1 - index }),
    ) as never);
    const remove = vi.spyOn(gameDatabase.replays, "bulkDelete").mockResolvedValue(undefined);

    await saveReplay(resultFixture(), replayFixture());

    expect(remove).toHaveBeenCalledWith([`replay-${MAX_REPLAY_RECORDS}`]);
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
          toArray: async () => {
            events.push("course-list");
            return Array.from(
              { length: 21 },
              (_, index) => ({ id: `replay-${index}`, createdAt: 21 - index }),
            );
          },
        }),
      } as never;
    });
    vi.spyOn(gameDatabase.replays, "toArray").mockImplementation((async () => {
      events.push("global-list");
      return [];
    }) as never);
    vi.spyOn(gameDatabase.replays, "bulkDelete").mockImplementation((async () => {
      events.push("delete");
      throw new Error("Injected replay prune failure.");
    }) as never);

    await expect(saveReplay(resultFixture(), replayFixture())).rejects.toThrow(
      "Injected replay prune failure.",
    );

    expect(transaction).toHaveBeenCalledWith("rw", gameDatabase.replays, expect.any(Function));
    expect(events).toEqual([
      "transaction:start",
      "put",
      "query",
      "course-list",
      "global-list",
      "delete",
      "transaction:end",
    ]);
  });
});

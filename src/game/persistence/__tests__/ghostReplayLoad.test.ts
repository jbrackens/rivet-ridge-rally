import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { RaceResult } from "../../../app/types";
import { FIXED_DT, RaceSimulation } from "../../simulation";
import { REPLAY_FORMAT_VERSION, ReplayRecorder } from "../../replay/replayCodec";
import { gameDatabase, loadBestReplay } from "../database";

function resultFixture(finishTimeMs: number): RaceResult {
  return {
    mode: "solo",
    trackId: "canyon-kickoff",
    finishTimeMs,
    position: 1,
    fieldSize: 1,
    checkpointCount: 2,
    lapTimesMs: [finishTimeMs],
    splitTimesMs: [Math.round(finishTimeMs / 2), finishTimeMs],
    personalBest: true,
    bestTimeMs: finishTimeMs,
    classification: [{
      riderId: "player",
      riderName: "Rider",
      position: 1,
      finishTimeMs,
      isPlayer: true,
    }],
    crashes: 0,
    overheats: 0,
    coachingHint: "Clean run.",
  };
}

/** A valid replay whose terminal sample lands exactly on `finishTimeMs`. */
function replayFixture(finishTimeMs: number, metres = 1_000): Uint8Array {
  const recorder = new ReplayRecorder(512_000);
  const initial = new RaceSimulation().snapshot;
  const terminalStep = Math.round(finishTimeMs / 1_000 / FIXED_DT);
  for (let stepCount = 0; stepCount < terminalStep; stepCount += 6) {
    recorder.capture({
      ...initial,
      stepCount,
      timeSeconds: stepCount * FIXED_DT,
      bike: { ...initial.bike, forwardPosition: (stepCount / terminalStep) * metres },
    });
  }
  if (!recorder.finalize({
    ...initial,
    stepCount: terminalStep,
    timeSeconds: terminalStep * FIXED_DT,
    bike: { ...initial.bike, forwardPosition: metres },
  })) {
    throw new Error("Expected the ghost replay fixture to finalize.");
  }
  return recorder.toUint8Array();
}

interface StoredRow {
  id: string;
  schemaVersion: number;
  codecVersion?: number;
  courseKey?: string;
  result?: RaceResult;
  samples?: Uint8Array;
  createdAt: number;
}

/** Stand in for the courseKey index, which is all `loadBestReplay` reads. */
function stubCourseKeyIndex(rows: readonly StoredRow[]): void {
  vi.spyOn(gameDatabase.replays, "where").mockImplementation(((field: string) => {
    expect(field).toBe("courseKey");
    return {
      equals: (key: string) => ({
        toArray: async () => rows.filter((row) => row.courseKey === key),
      }),
    };
  }) as never);
}

beforeEach(() => {
  vi.spyOn(gameDatabase, "isOpen").mockReturnValue(true);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("ghost replay load", () => {
  it("returns the fastest stored run for the course", async () => {
    stubCourseKeyIndex([
      {
        id: "slow",
        schemaVersion: 2,
        codecVersion: REPLAY_FORMAT_VERSION,
        courseKey: "canyon-kickoff",
        result: resultFixture(90_000),
        samples: replayFixture(90_000),
        createdAt: 10,
      },
      {
        id: "fast",
        schemaVersion: 2,
        codecVersion: REPLAY_FORMAT_VERSION,
        courseKey: "canyon-kickoff",
        result: resultFixture(60_000),
        samples: replayFixture(60_000),
        createdAt: 20,
      },
    ]);

    const ghost = await loadBestReplay("canyon-kickoff");
    expect(ghost?.finishTimeMs).toBe(60_000);
    expect(ghost?.courseKey).toBe("canyon-kickoff");
    expect(ghost?.frames.length ?? 0).toBeGreaterThan(1);
    expect(ghost?.frames.at(-1)?.terminal).toBe(true);
  });

  it("does not return a run recorded on a different course", async () => {
    stubCourseKeyIndex([{
      id: "other",
      schemaVersion: 2,
      codecVersion: REPLAY_FORMAT_VERSION,
      courseKey: "pine-run",
      result: resultFixture(60_000),
      samples: replayFixture(60_000),
      createdAt: 10,
    }]);

    expect(await loadBestReplay("canyon-kickoff")).toBeNull();
  });

  it("skips legacy schema-1 rows that predate the course binding", async () => {
    stubCourseKeyIndex([{
      id: "legacy",
      schemaVersion: 1,
      courseKey: "canyon-kickoff",
      result: resultFixture(30_000),
      samples: replayFixture(30_000),
      createdAt: 10,
    }]);

    expect(await loadBestReplay("canyon-kickoff")).toBeNull();
  });

  it("falls through a corrupt fastest run to the next usable one", async () => {
    stubCourseKeyIndex([
      {
        id: "corrupt",
        schemaVersion: 2,
        codecVersion: REPLAY_FORMAT_VERSION,
        courseKey: "canyon-kickoff",
        result: resultFixture(45_000),
        samples: new Uint8Array([1, 2, 3]),
        createdAt: 10,
      },
      {
        id: "usable",
        schemaVersion: 2,
        codecVersion: REPLAY_FORMAT_VERSION,
        courseKey: "canyon-kickoff",
        result: resultFixture(75_000),
        samples: replayFixture(75_000),
        createdAt: 20,
      },
    ]);

    const ghost = await loadBestReplay("canyon-kickoff");
    expect(ghost?.finishTimeMs).toBe(75_000);
  });

  it("returns null when the course has no stored run at all", async () => {
    stubCourseKeyIndex([]);
    expect(await loadBestReplay("canyon-kickoff")).toBeNull();
  });
});

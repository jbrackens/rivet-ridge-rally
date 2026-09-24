import { beforeEach, describe, expect, it } from "vitest";

import { useAppStore } from "../store";
import type { RaceResult } from "../types";
import { createDefaultProgress } from "../../game/persistence/database";

function result(finishTimeMs = 82_000): RaceResult {
  return {
    mode: "solo",
    trackId: "canyon-kickoff",
    trackName: "Canyon Kickoff",
    finishTimeMs,
    position: 1,
    fieldSize: 1,
    checkpointCount: 3,
    lapTimesMs: [41_000, 41_000],
    splitTimesMs: [],
    personalBest: true,
    classification: [{
      riderId: "player",
      riderName: "You",
      position: 1,
      finishTimeMs,
      isPlayer: true,
    }],
    crashes: 0,
    overheats: 0,
    coachingHint: "Test result",
  };
}

describe("race result delivery", () => {
  beforeEach(() => {
    useAppStore.setState({
      screen: "race",
      returnScreen: "title",
      progress: createDefaultProgress(),
      activeRace: { mode: "solo", trackId: "canyon-kickoff" },
      latestResult: null,
      latestResultAttempt: null,
      latestReplayFailureReason: null,
      raceAttempt: 7,
    });
  });

  it("keeps the result and progression when its replay is unavailable", () => {
    useAppStore.getState().finishRace(result(), {
      raceAttempt: 7,
      presentResults: false,
      replayFailureReason: "cadence",
    });

    expect(useAppStore.getState()).toMatchObject({
      latestResultAttempt: 7,
      latestResult: { finishTimeMs: 82_000 },
      latestReplayFailureReason: "cadence",
    });
    expect(useAppStore.getState().latestResult).not.toHaveProperty("replayFailureReason");
    expect(useAppStore.getState().progress.tracks["canyon-kickoff"].bestSoloMs).toBe(82_000);

    useAppStore.getState().finishRace(result(70_000), {
      raceAttempt: 7,
      presentResults: false,
      replayFailureReason: "capacity",
    });
    expect(useAppStore.getState().latestResult?.finishTimeMs).toBe(82_000);
    expect(useAppStore.getState().latestReplayFailureReason).toBe("cadence");
  });

  it("commits a finished attempt once before presenting its results", () => {
    useAppStore.getState().finishRace(result(), {
      raceAttempt: 7,
      presentResults: false,
    });

    expect(useAppStore.getState()).toMatchObject({
      screen: "race",
      latestResultAttempt: 7,
      latestResult: { finishTimeMs: 82_000 },
    });
    expect(useAppStore.getState().progress.tracks["canyon-kickoff"].bestSoloMs).toBe(82_000);

    useAppStore.getState().finishRace(result(70_000), {
      raceAttempt: 7,
      presentResults: false,
    });
    expect(useAppStore.getState().latestResult?.finishTimeMs).toBe(82_000);
    expect(useAppStore.getState().progress.tracks["canyon-kickoff"].bestSoloMs).toBe(82_000);

    useAppStore.getState().presentRaceResult(7);
    expect(useAppStore.getState().screen).toBe("results");
  });

  it("never lets an old finish presentation override retry or menu navigation", () => {
    useAppStore.getState().finishRace(result(), {
      raceAttempt: 7,
      presentResults: false,
    });
    useAppStore.getState().retryRace();
    useAppStore.getState().presentRaceResult(7);

    expect(useAppStore.getState()).toMatchObject({
      screen: "race",
      raceAttempt: 8,
      latestResult: null,
      latestResultAttempt: null,
      latestReplayFailureReason: null,
    });
    expect(useAppStore.getState().progress.tracks["canyon-kickoff"].bestSoloMs).toBe(82_000);

    useAppStore.getState().finishRace(result(79_000), {
      raceAttempt: 8,
      presentResults: false,
    });
    useAppStore.getState().navigate("title");
    useAppStore.getState().presentRaceResult(8);
    expect(useAppStore.getState().screen).toBe("title");
    expect(useAppStore.getState().progress.tracks["canyon-kickoff"].bestSoloMs).toBe(79_000);
  });
});

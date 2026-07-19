import { describe, expect, it } from "vitest";

import {
  applyRaceResult,
  getMasteryGoal,
  isMasteryUnlocked,
  isTrackUnlocked,
  MASTERY_TIER_COUNT,
  MASTERY_TRACK_ID,
  prepareRaceResult,
} from "../store";
import type { CampaignProgress, RaceMode, RaceResult, TrackProgress } from "../types";
import { TRACK_IDS, TRACKS, getTrack, type TrackId } from "../../game/content/tracks";

function trackProgress(): TrackProgress {
  return {
    soloQualified: false,
    rivalUnlocked: false,
    masteryLevel: 0,
  };
}

function progress(): CampaignProgress {
  return {
    version: 1,
    tutorialComplete: true,
    selectedTrackId: TRACK_IDS[0],
    tracks: Object.fromEntries(
      TRACK_IDS.map((trackId) => [trackId, trackProgress()]),
    ) as Record<TrackId, TrackProgress>,
  };
}

function raceResult(
  mode: RaceMode,
  trackId: TrackId,
  overrides: Partial<RaceResult> = {},
): RaceResult {
  return {
    mode,
    trackId,
    finishTimeMs: getTrack(trackId).soloTargetMs,
    position: 1,
    fieldSize: 6,
    checkpointCount: 3,
    lapTimesMs: [60_000, 60_000],
    splitTimesMs: [],
    personalBest: true,
    classification: [{
      riderId: "player",
      riderName: "You",
      position: 1,
      finishTimeMs: getTrack(trackId).soloTargetMs,
      isPlayer: true,
    }],
    crashes: 0,
    overheats: 0,
    coachingHint: "Test result",
    ...overrides,
  };
}

function qualifySolo(
  current: CampaignProgress,
  trackId: TrackId,
): CampaignProgress {
  return applyRaceResult(current, raceResult("solo", trackId));
}

function finishRival(
  current: CampaignProgress,
  trackId: TrackId,
  position: number,
): CampaignProgress {
  return applyRaceResult(current, raceResult("rival", trackId, { position }));
}

function unlockSummitMastery(): CampaignProgress {
  let current = progress();
  for (const track of TRACKS) {
    current = qualifySolo(current, track.id);
    current = finishRival(current, track.id, 3);
  }
  return current;
}

describe("campaign progression", () => {
  it("reports the saved Solo best before a run and the resulting best explicitly", () => {
    const initial = progress();
    initial.tracks["canyon-kickoff"].bestSoloMs = 120_000;
    const slower = prepareRaceResult(
      initial,
      raceResult("solo", "canyon-kickoff", {
        finishTimeMs: 125_000,
        personalBest: true,
      }),
    );
    const faster = prepareRaceResult(
      initial,
      raceResult("solo", "canyon-kickoff", {
        finishTimeMs: 115_000,
        personalBest: false,
      }),
    );

    expect(slower).toMatchObject({
      previousBestMs: 120_000,
      bestTimeMs: 120_000,
      personalBest: false,
    });
    expect(faster).toMatchObject({
      previousBestMs: 120_000,
      bestTimeMs: 115_000,
      personalBest: true,
    });
  });

  it("preserves standing-PB lap and checkpoint splits until a faster Solo run replaces them", () => {
    const firstLapTimes = [64_000, 66_000];
    const firstSplitTimes = [20_000, 42_000, 64_000, 86_000, 108_000, 130_000];
    const slowerLapTimes = [66_000, 68_000];
    const slowerSplitTimes = [21_000, 43_000, 66_000, 89_000, 111_000, 134_000];
    const fasterLapTimes = [61_000, 63_000];
    const fasterSplitTimes = [19_000, 40_000, 61_000, 81_000, 102_000, 124_000];

    const first = applyRaceResult(progress(), raceResult("solo", "canyon-kickoff", {
      finishTimeMs: 130_000,
      lapTimesMs: firstLapTimes,
      splitTimesMs: firstSplitTimes,
    }));
    expect(first.tracks["canyon-kickoff"]).toMatchObject({
      bestSoloMs: 130_000,
      bestSoloLapTimesMs: firstLapTimes,
      bestSoloSplitTimesMs: firstSplitTimes,
    });

    const preparedSlower = prepareRaceResult(first, raceResult("solo", "canyon-kickoff", {
      finishTimeMs: 134_000,
      lapTimesMs: slowerLapTimes,
      splitTimesMs: slowerSplitTimes,
    }));
    expect(preparedSlower).toMatchObject({
      personalBest: false,
      previousBestMs: 130_000,
      previousBestLapTimesMs: firstLapTimes,
      previousBestSplitTimesMs: firstSplitTimes,
    });

    const afterSlower = applyRaceResult(first, preparedSlower);
    expect(afterSlower.tracks["canyon-kickoff"]).toMatchObject({
      bestSoloMs: 130_000,
      bestSoloLapTimesMs: firstLapTimes,
      bestSoloSplitTimesMs: firstSplitTimes,
    });

    const afterFaster = applyRaceResult(afterSlower, raceResult("solo", "canyon-kickoff", {
      finishTimeMs: 124_000,
      lapTimesMs: fasterLapTimes,
      splitTimesMs: fasterSplitTimes,
    }));
    expect(afterFaster.tracks["canyon-kickoff"]).toMatchObject({
      bestSoloMs: 124_000,
      bestSoloLapTimesMs: fasterLapTimes,
      bestSoloSplitTimesMs: fasterSplitTimes,
    });
  });

  it("uses the official player classification for position and field size", () => {
    const result = prepareRaceResult(progress(), raceResult("rival", "canyon-kickoff", {
      position: 1,
      fieldSize: 1,
      classification: [
        { riderId: "leader", riderName: "Leader", position: 1, finishTimeMs: 100_000, isPlayer: false },
        { riderId: "second", riderName: "Second", position: 2, finishTimeMs: 101_000, isPlayer: false },
        { riderId: "player", riderName: "You", position: 3, finishTimeMs: 102_000, isPlayer: true },
      ],
    }));

    expect(result.position).toBe(3);
    expect(result.fieldSize).toBe(3);
  });

  it("unlocks a track's Rival race only when Solo meets its target", () => {
    const initial = progress();
    const track = getTrack("canyon-kickoff");

    const missed = applyRaceResult(
      initial,
      raceResult("solo", track.id, { finishTimeMs: track.soloTargetMs + 1 }),
    );
    const qualified = applyRaceResult(
      missed,
      raceResult("solo", track.id, { finishTimeMs: track.soloTargetMs }),
    );

    expect(missed.tracks[track.id]).toMatchObject({
      soloQualified: false,
      rivalUnlocked: false,
      bestSoloMs: track.soloTargetMs + 1,
    });
    expect(qualified.tracks[track.id]).toMatchObject({
      soloQualified: true,
      rivalUnlocked: true,
      bestSoloMs: track.soloTargetMs,
    });
    expect(initial.tracks[track.id]).toEqual(trackProgress());
  });

  it("ignores Rival results submitted before that Rival race is unlocked", () => {
    const updated = finishRival(progress(), "canyon-kickoff", 1);

    expect(updated.tracks["canyon-kickoff"].bestRivalPosition).toBeUndefined();
    expect(isTrackUnlocked(updated, "pine-run")).toBe(false);
  });

  it("unlocks each next track on a top-three Rival finish and not on fourth", () => {
    let current = progress();

    for (let index = 0; index < TRACKS.length - 1; index += 1) {
      const track = TRACKS[index];
      const nextTrack = TRACKS[index + 1];
      if (!track || !nextTrack) throw new Error("Campaign tracks must stay ordered.");
      current = qualifySolo(current, track.id);
      current = finishRival(current, track.id, 4);
      expect(isTrackUnlocked(current, nextTrack.id)).toBe(false);
      current = finishRival(current, track.id, 3);
      expect(isTrackUnlocked(current, nextTrack.id)).toBe(true);
      expect(current.tracks[nextTrack.id].rivalUnlocked).toBe(false);
    }
  });

  it("keeps the best Rival finish and never relocks the next track", () => {
    let current = qualifySolo(progress(), "canyon-kickoff");
    current = finishRival(current, "canyon-kickoff", 2);
    current = finishRival(current, "canyon-kickoff", 6);

    expect(current.tracks["canyon-kickoff"].bestRivalPosition).toBe(2);
    expect(isTrackUnlocked(current, "pine-run")).toBe(true);
  });

  it("unlocks Summit mastery only after the Summit Rival race earns a podium", () => {
    let current = progress();
    for (const track of TRACKS.slice(0, -1)) {
      current = qualifySolo(current, track.id);
      current = finishRival(current, track.id, 3);
    }

    expect(isTrackUnlocked(current, MASTERY_TRACK_ID)).toBe(true);
    expect(isMasteryUnlocked(current)).toBe(false);
    current = qualifySolo(current, MASTERY_TRACK_ID);
    current = finishRival(current, MASTERY_TRACK_ID, 4);
    expect(isMasteryUnlocked(current)).toBe(false);
    current = finishRival(current, MASTERY_TRACK_ID, 3);
    expect(isMasteryUnlocked(current)).toBe(true);
  });
});

describe("Summit mastery", () => {
  it("escalates its target and hot-start modifier through seven tiers", () => {
    expect(Array.from({ length: MASTERY_TIER_COUNT }, (_, masteryLevel) => {
      const goal = getMasteryGoal(masteryLevel);
      return { targetMs: goal.targetMs, startingHeat: goal.startingHeat };
    })).toEqual([
      { targetMs: 257_000, startingHeat: 35 },
      { targetMs: 255_000, startingHeat: 40 },
      { targetMs: 253_000, startingHeat: 45 },
      { targetMs: 251_000, startingHeat: 50 },
      { targetMs: 249_000, startingHeat: 55 },
      { targetMs: 248_000, startingHeat: 60 },
      { targetMs: 247_000, startingHeat: 65 },
    ]);
    expect(getMasteryGoal(0)).toMatchObject({
      tier: 1,
      tierCount: 7,
      targetMs: 257_000,
      startingHeat: 35,
      isMaxTierReplay: false,
    });
    expect(getMasteryGoal(1)).toMatchObject({
      tier: 2,
      targetMs: 255_000,
      startingHeat: 40,
    });
    expect(getMasteryGoal(6)).toMatchObject({
      tier: 7,
      targetMs: 247_000,
      startingHeat: 65,
      isMaxTierReplay: false,
    });
    expect(getMasteryGoal(MASTERY_TIER_COUNT)).toMatchObject({
      tier: 7,
      targetMs: 247_000,
      startingHeat: 65,
      isMaxTierReplay: true,
    });
  });

  it("requires both the mastery target and a top-three finish to advance", () => {
    const unlocked = unlockSummitMastery();
    const goal = getMasteryGoal(0);

    const missedTime = applyRaceResult(
      unlocked,
      raceResult("mastery", MASTERY_TRACK_ID, {
        finishTimeMs: goal.targetMs + 1,
        position: 1,
      }),
    );
    const missedPodium = applyRaceResult(
      unlocked,
      raceResult("mastery", MASTERY_TRACK_ID, {
        finishTimeMs: goal.targetMs,
        position: 4,
      }),
    );
    const cleared = applyRaceResult(
      unlocked,
      raceResult("mastery", MASTERY_TRACK_ID, {
        finishTimeMs: goal.targetMs,
        position: 3,
      }),
    );

    expect(missedTime.tracks[MASTERY_TRACK_ID].masteryLevel).toBe(0);
    expect(missedPodium.tracks[MASTERY_TRACK_ID].masteryLevel).toBe(0);
    expect(cleared.tracks[MASTERY_TRACK_ID].masteryLevel).toBe(1);
  });

  it("caps progression at the final tier while keeping its goal replayable", () => {
    const unlocked = unlockSummitMastery();
    unlocked.tracks[MASTERY_TRACK_ID].masteryLevel = MASTERY_TIER_COUNT - 1;
    const finalGoal = getMasteryGoal(MASTERY_TIER_COUNT - 1);
    const cleared = applyRaceResult(
      unlocked,
      raceResult("mastery", MASTERY_TRACK_ID, {
        finishTimeMs: finalGoal.targetMs,
        position: 1,
      }),
    );
    const replayed = applyRaceResult(
      cleared,
      raceResult("mastery", MASTERY_TRACK_ID, {
        finishTimeMs: getMasteryGoal(MASTERY_TIER_COUNT).targetMs,
        position: 1,
      }),
    );

    expect(cleared.tracks[MASTERY_TRACK_ID].masteryLevel).toBe(MASTERY_TIER_COUNT);
    expect(replayed.tracks[MASTERY_TRACK_ID].masteryLevel).toBe(MASTERY_TIER_COUNT);
    expect(getMasteryGoal(replayed.tracks[MASTERY_TRACK_ID].masteryLevel).isMaxTierReplay).toBe(true);
  });
});

import { describe, expect, it } from "vitest";

import { TRACKS } from "../../content/tracks";
import { RaceSimulation } from "../../simulation";
import {
  createAiSimulationOptions,
  DEFAULT_RACE_CONTRACT,
  deriveRaceContract,
  type RaceContract,
} from "../aiRules";

/**
 * The player and the rivals must race the same course.
 *
 * `GameEngine` derives the player's checkpoint and lap counts from track data;
 * `createAiSimulationOptions` used to return the literals `{checkpointCount: 3,
 * totalLaps: 2}`. Those agreed only by luck of content — no shipped track
 * defines an `authoredCourse`, so every built-in race falls through to exactly
 * those numbers. The first authored course with a different checkpoint count,
 * or the first rival field on a custom track with other than two laps, would
 * have had the field lapping and finishing on a contract the player was not
 * racing, and the classification would have been wrong with nothing to show for
 * it.
 *
 * These assertions pin both halves: that the change is a no-op on everything
 * shipped, and that a different contract genuinely reaches the AI.
 */

// `deriveRaceContract` is the function GameEngine itself calls, so these
// assertions exercise the shipped derivation rather than a copy of it. An
// earlier draft re-implemented the expression here and would have stayed green
// if the engine's own derivation changed.

describe("race contract", () => {
  it("is unchanged for every shipped track and racing mode", () => {
    for (const track of TRACKS) {
      for (const mode of ["solo", "rival", "practice", "mastery"] as const) {
        expect(deriveRaceContract(track, { mode }), `${track.id} / ${mode}`)
          .toEqual(DEFAULT_RACE_CONTRACT);
      }
    }
  });

  it("still gives the tutorial its single lap", () => {
    const track = TRACKS[0];
    if (!track) throw new Error("Expected at least one shipped track.");
    expect(deriveRaceContract(track, { mode: "tutorial" })).toEqual({
      checkpointCount: 3,
      totalLaps: 1,
    });
  });

  it("defaults the AI field to the built-in contract when none is passed", () => {
    const options = createAiSimulationOptions(1, 0, 0);
    expect(options.checkpointCount).toBe(DEFAULT_RACE_CONTRACT.checkpointCount);
    expect(options.totalLaps).toBe(DEFAULT_RACE_CONTRACT.totalLaps);
  });

  it("hands a derived contract through to the rival simulation", () => {
    // The case that was previously impossible to express: an authored course
    // with four checkpoints raced over three laps.
    const authored: RaceContract = { checkpointCount: 4, totalLaps: 3 };
    const options = createAiSimulationOptions(2, 7, 20, authored);

    expect(options.checkpointCount).toBe(4);
    expect(options.totalLaps).toBe(3);

    // And it survives into the rider's own simulation, not just the options.
    const snapshot = new RaceSimulation(options).snapshot;
    expect(snapshot.race.checkpointCount).toBe(4);
    expect(snapshot.race.totalLaps).toBe(3);
  });

  it("keeps the rest of the AI options untouched by the contract", () => {
    const options = createAiSimulationOptions(3, -11, 50, { checkpointCount: 9, totalLaps: 9 });
    expect(options.initialLane).toBe(3);
    expect(options.initialForwardPosition).toBe(-11);
    expect(options.initialHeat).toBe(50);
  });
});

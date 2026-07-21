import { describe, expect, it } from "vitest";

import { FIXED_DT, NEUTRAL_INPUT, RaceSimulation } from "../../simulation";
import {
  CRITICAL_HEAT_WARNING,
  TUTORIAL_OBSTACLES,
  TUTORIAL_USABLE_SPEED,
} from "../GameEngine";

describe("Rider School heat path", () => {
  it("defines the canonical non-overlapping lesson obstacle sequence", () => {
    expect(TUTORIAL_OBSTACLES.map(({ id, kind, distance, length }) => [
      id,
      kind,
      distance,
      length,
    ])).toEqual([
      ["qa-cooling", "cooling-gate", 250, 18],
      ["qa-bump", "bump", 300, 10],
      ["qa-ramp", "medium-ramp", 340, 18],
      ["qa-choice-barrier", "barrier", 440, 6],
      ["qa-mud", "mud", 500, 30],
      ["qa-grass", "grass", 560, 22],
      ["qa-recovery-barrier", "barrier", 620, 6],
    ]);

    const intervals = TUTORIAL_OBSTACLES.map((obstacle) => ({
      entry: obstacle.distance - obstacle.length / 2,
      exit: obstacle.distance + obstacle.length / 2,
    }));
    intervals.slice(1).forEach((current, previousIndex) => {
      expect(current.entry).toBeGreaterThan(intervals[previousIndex]!.exit);
    });
  });

  it("leaves dirt runway after the required lead-in reaches critical heat", () => {
    const simulation = new RaceSimulation({ totalLaps: 1 });
    const ride = { ...NEUTRAL_INPUT, throttle: true };
    for (
      let step = 0;
      step < 60 * 2 && simulation.snapshot.bike.speed < TUTORIAL_USABLE_SPEED;
      step += 1
    ) {
      simulation.advance(FIXED_DT, ride);
    }
    expect(simulation.snapshot.bike.speed).toBeGreaterThanOrEqual(TUTORIAL_USABLE_SPEED);

    const speedBeforeCoast = simulation.snapshot.bike.speed;
    simulation.advance(FIXED_DT, NEUTRAL_INPUT);
    expect(simulation.snapshot.bike.speed).toBeLessThan(speedBeforeCoast);
    simulation.advance(FIXED_DT, { ...NEUTRAL_INPUT, laneChange: -1 });
    expect(simulation.snapshot.bike.lane).toBe(0);

    const turbo = { ...NEUTRAL_INPUT, turbo: true };

    for (
      let step = 0;
      step < 60 * 20 && simulation.snapshot.bike.heat < CRITICAL_HEAT_WARNING;
      step += 1
    ) {
      simulation.advance(FIXED_DT, turbo);
    }

    const coolingGate = TUTORIAL_OBSTACLES[0];
    const coolingGateEntry = coolingGate.distance - coolingGate.length / 2;
    expect(simulation.snapshot.bike.heat).toBeGreaterThanOrEqual(CRITICAL_HEAT_WARNING);
    expect(coolingGateEntry - simulation.snapshot.bike.forwardPosition).toBeGreaterThan(30);
    expect(coolingGateEntry).toBe(241);
  });
});

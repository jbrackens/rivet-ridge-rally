import { describe, expect, it } from "vitest";

import {
  FIXED_DT,
  LANE_POSITIONS,
  RaceSimulation,
  type SimulationEnvironment,
  type SimulationInput,
  type SurfaceKind,
} from "..";

const neutralInput: SimulationInput = {
  throttle: false,
  turbo: false,
  laneChange: 0,
  pitch: 0,
  recover: false,
};

function input(overrides: Partial<SimulationInput> = {}): SimulationInput {
  return { ...neutralInput, ...overrides };
}

function environment(surface: SurfaceKind, rampImpulse?: number): SimulationEnvironment {
  return rampImpulse === undefined ? { surface } : { surface, rampImpulse };
}

function runUntil(
  simulation: RaceSimulation,
  predicate: () => boolean,
  simulationInput: SimulationInput,
  maximumSteps = 600,
): void {
  for (let step = 0; step < maximumSteps; step += 1) {
    if (predicate()) {
      return;
    }
    simulation.advance(FIXED_DT, simulationInput, environment("dirt"));
  }
  throw new Error("simulation did not reach the expected state");
}

describe("fixed stepping", () => {
  it("accumulates partial frames and exposes interpolation progress", () => {
    const simulation = new RaceSimulation();

    expect(simulation.advance(FIXED_DT / 2, neutralInput)).toBe(0);
    expect(simulation.snapshot.stepCount).toBe(0);
    expect(simulation.interpolationAlpha).toBeCloseTo(0.5);

    expect(simulation.advance(FIXED_DT / 2, neutralInput)).toBe(1);
    expect(simulation.snapshot.stepCount).toBe(1);
    expect(simulation.interpolationAlpha).toBeCloseTo(0);
  });

  it("is deterministic for equivalent elapsed time chunking", () => {
    const oneFrame = new RaceSimulation();
    const manyFrames = new RaceSimulation();
    const heldInput = input({ throttle: true, turbo: true, laneChange: 1 });

    oneFrame.advance(1, heldInput);
    for (let frame = 0; frame < 120; frame += 1) {
      manyFrames.advance(1 / 120, heldInput);
    }

    expect(oneFrame.snapshot).toEqual(manyFrames.snapshot);
  });
});

describe("lane movement", () => {
  it("moves between four lane positions and treats a held direction as one action", () => {
    const simulation = new RaceSimulation();

    simulation.advance(1, input({ throttle: true, laneChange: 1 }));
    expect(simulation.snapshot.bike.lane).toBe(2);
    expect(simulation.snapshot.bike.lanePosition).toBe(LANE_POSITIONS[2]);

    simulation.advance(FIXED_DT, input({ throttle: true, laneChange: 0 }));
    simulation.advance(1, input({ throttle: true, laneChange: 1 }));
    expect(simulation.snapshot.bike.lane).toBe(3);
    expect(simulation.snapshot.bike.lanePosition).toBe(LANE_POSITIONS[3]);

    simulation.advance(FIXED_DT, input({ laneChange: 0 }));
    simulation.advance(1, input({ laneChange: 1 }));
    expect(simulation.snapshot.bike.lane).toBe(3);
  });

  it("interpolates rather than teleporting laterally", () => {
    const simulation = new RaceSimulation();

    simulation.advance(FIXED_DT, input({ laneChange: 1 }));
    const { bike } = simulation.snapshot;

    expect(bike.lane).toBe(2);
    expect(bike.lanePosition).toBeGreaterThan(LANE_POSITIONS[1]);
    expect(bike.lanePosition).toBeLessThan(LANE_POSITIONS[2]);
  });

  it("does not queue a held lane command while controls are disabled", () => {
    const simulation = new RaceSimulation();
    simulation.forceCrash();

    simulation.advance(0.8, input({ laneChange: 1, recover: true }));
    simulation.advance(0.5, input({ laneChange: 1 }));
    expect(simulation.snapshot.bike.phase).toBe("grounded");
    expect(simulation.snapshot.bike.lane).toBe(1);

    simulation.advance(FIXED_DT, input({ laneChange: 0 }));
    simulation.advance(FIXED_DT, input({ laneChange: 1 }));
    expect(simulation.snapshot.bike.lane).toBe(2);
  });
});

describe("heat and surfaces", () => {
  it("heats under turbo, locks controls at maximum heat, and recovers after cooling", () => {
    const simulation = new RaceSimulation();

    simulation.advance(3, input({ turbo: true }));
    expect(simulation.snapshot.bike.overheated).toBe(true);
    expect(simulation.snapshot.bike.heat).toBeGreaterThan(80);

    const speedAtLockout = simulation.snapshot.bike.speed;
    simulation.advance(0.5, input({ turbo: true, laneChange: 1 }));
    expect(simulation.snapshot.bike.lane).toBe(1);
    expect(simulation.snapshot.bike.speed).toBeLessThan(speedAtLockout);

    simulation.advance(4, neutralInput);
    expect(simulation.snapshot.bike.heat).toBeLessThanOrEqual(35);
    expect(simulation.snapshot.bike.overheated).toBe(false);
  });

  it("builds standard throttle to a safe heat ceiling while preserving cooling", () => {
    const simulation = new RaceSimulation();

    simulation.advance(20, input({ throttle: true }));
    expect(simulation.snapshot.bike.heat).toBe(62);
    expect(simulation.snapshot.bike.overheated).toBe(false);

    simulation.advance(0.5, input({ throttle: true, turbo: true }));
    expect(simulation.snapshot.bike.heat).toBeGreaterThan(62);

    simulation.advance(2, input({ throttle: true }));
    expect(simulation.snapshot.bike.heat).toBe(62);

    simulation.advance(1, neutralInput);
    expect(simulation.snapshot.bike.heat).toBeCloseTo(48, 8);
  });

  it("applies an immediate cooling-zone drop and continued cooling", () => {
    const simulation = new RaceSimulation();
    simulation.advance(1, input({ turbo: true }));
    const heated = simulation.snapshot.bike.heat;

    simulation.advance(FIXED_DT, input({ throttle: true }), environment("cooling"));
    const afterEntry = simulation.snapshot.bike.heat;
    simulation.advance(0.5, input({ throttle: true }), environment("cooling"));

    expect(heated - afterEntry).toBeGreaterThan(18);
    expect(simulation.snapshot.bike.heat).toBeLessThan(afterEntry);
  });

  it("makes grass and mud slower than dirt", () => {
    const speeds = new Map<SurfaceKind, number>();

    for (const surface of ["dirt", "grass", "mud"] as const) {
      const simulation = new RaceSimulation();
      simulation.advance(3, input({ throttle: true }), environment(surface));
      speeds.set(surface, simulation.snapshot.bike.speed);
    }

    expect(speeds.get("dirt")).toBeGreaterThan(speeds.get("grass") ?? 0);
    expect(speeds.get("grass")).toBeGreaterThan(speeds.get("mud") ?? 0);
  });
});

describe("jumping, pitch, and landing", () => {
  it("rewards a tactical turbo run-up with more ramp speed and distance", () => {
    const standard = new RaceSimulation();
    const boosted = new RaceSimulation();
    standard.advance(1, input({ throttle: true }));
    boosted.advance(1, input({ throttle: true, turbo: true }));
    standard.advance(FIXED_DT, input({ throttle: true }), environment("ramp", 7));
    boosted.advance(FIXED_DT, input({ throttle: true }), environment("ramp", 7));

    expect(boosted.snapshot.bike.speed).toBeGreaterThan(standard.snapshot.bike.speed);
    standard.advance(0.4, neutralInput);
    boosted.advance(0.4, neutralInput);
    expect(boosted.snapshot.bike.forwardPosition).toBeGreaterThan(standard.snapshot.bike.forwardPosition);
  });

  it("launches from a ramp and preserves speed on a clean landing", () => {
    const simulation = new RaceSimulation();
    simulation.advance(1, input({ throttle: true }));

    simulation.advance(FIXED_DT, input({ throttle: true }), environment("ramp", 7));
    expect(simulation.snapshot.bike.phase).toBe("airborne");
    const takeoffSpeed = simulation.snapshot.bike.speed;

    runUntil(
      simulation,
      () => simulation.snapshot.bike.phase === "grounded",
      neutralInput,
    );

    expect(simulation.snapshot.bike.lastLanding).toBe("clean");
    expect(simulation.snapshot.bike.speed).toBeCloseTo(takeoffSpeed * 0.98, 4);
  });

  it("uses airborne pitch to turn a bad landing into a crash", () => {
    const simulation = new RaceSimulation();
    simulation.advance(1, input({ throttle: true }));
    simulation.advance(FIXED_DT, input({ throttle: true }), environment("ramp", 7));

    runUntil(
      simulation,
      () => simulation.snapshot.bike.phase === "crashed",
      input({ pitch: 1 }),
    );

    expect(simulation.snapshot.bike.lastLanding).toBe("crash");
    expect(simulation.snapshot.bike.crashCause).toBe("landing");
    expect(simulation.snapshot.bike.speed).toBe(0);
  });

  it("raises the front wheel from grounded pitch input", () => {
    const simulation = new RaceSimulation();
    simulation.advance(1, input({ throttle: true }));
    simulation.advance(0.25, input({ throttle: true, pitch: 1 }));

    expect(simulation.snapshot.bike.wheelie).toBe(true);
    expect(simulation.snapshot.bike.pitch).toBeGreaterThan(0);
  });

  it("turns an overheld wheelie into a fair recoverable crash", () => {
    const simulation = new RaceSimulation();
    simulation.advance(1, input({ throttle: true }));
    simulation.advance(1.6, input({ throttle: true, pitch: 1 }));

    expect(simulation.snapshot.bike.phase).toBe("crashed");
    expect(simulation.snapshot.bike.crashCause).toBe("wheelie-timeout");
    expect(simulation.snapshot.bike.speed).toBe(0);
    simulation.advance(0.8, input({ recover: true }));
    expect(simulation.snapshot.bike.phase).toBe("recovering");
    expect(simulation.snapshot.bike.crashCause).toBeNull();
  });

  it("can extend the same wheelie rule for a finite training window", () => {
    const simulation = new RaceSimulation({ wheelieCrashSeconds: 3 });
    simulation.advance(1, input({ throttle: true }));
    simulation.advance(1.6, input({ throttle: true, pitch: 1 }));

    expect(simulation.snapshot.bike.phase).toBe("grounded");
    expect(simulation.snapshot.bike.wheelie).toBe(true);
    simulation.advance(1.6, input({ throttle: true, pitch: 1 }));
    expect(simulation.snapshot.bike.phase).toBe("crashed");
    expect(simulation.snapshot.bike.crashCause).toBe("wheelie-timeout");
  });

  it("trades distance for lift when pitching back in the air", () => {
    const neutralArc = new RaceSimulation();
    const liftedArc = new RaceSimulation();
    for (const simulation of [neutralArc, liftedArc]) {
      simulation.advance(1, input({ throttle: true }));
      simulation.advance(FIXED_DT, input({ throttle: true }), environment("ramp", 7));
    }

    neutralArc.advance(0.35, neutralInput);
    liftedArc.advance(0.35, input({ pitch: 1 }));

    expect(liftedArc.snapshot.bike.height).toBeGreaterThan(neutralArc.snapshot.bike.height);
    expect(liftedArc.snapshot.bike.forwardPosition).toBeLessThan(neutralArc.snapshot.bike.forwardPosition);
  });

  it("returns airborne pitch toward level after the rider releases pitch input", () => {
    const simulation = new RaceSimulation();
    simulation.advance(1, input({ throttle: true }));
    simulation.advance(FIXED_DT, input({ throttle: true }), environment("ramp", 8));
    simulation.advance(0.25, input({ pitch: 1 }));
    const raisedPitch = simulation.snapshot.bike.pitch;

    simulation.advance(0.5, neutralInput);

    expect(raisedPitch).toBeGreaterThan(0.3);
    expect(Math.abs(simulation.snapshot.bike.pitch)).toBeLessThan(Math.abs(raisedPitch));
  });
});

describe("crash recovery", () => {
  it("keeps the first crash cause until recovery begins", () => {
    const simulation = new RaceSimulation();

    simulation.forceCrash("obstacle");
    simulation.forceCrash("wheelie-timeout");

    expect(simulation.snapshot.bike.crashCause).toBe("obstacle");
    simulation.advance(0.8, input({ recover: true }));
    expect(simulation.snapshot.bike.crashCause).toBeNull();
  });

  it("requires a continuous hold before recovery completes", () => {
    const simulation = new RaceSimulation();
    simulation.forceCrash();

    simulation.advance(0.5, input({ recover: true }));
    expect(simulation.snapshot.bike.phase).toBe("crashed");
    expect(simulation.snapshot.bike.recoveryProgress).toBeGreaterThan(0);

    simulation.advance(FIXED_DT, neutralInput);
    expect(simulation.snapshot.bike.recoveryProgress).toBe(0);

    simulation.advance(0.8, input({ recover: true }));
    expect(simulation.snapshot.bike.phase).toBe("recovering");

    simulation.advance(0.5, neutralInput);
    expect(simulation.snapshot.bike.phase).toBe("grounded");
    expect(simulation.snapshot.bike.recoveryProgress).toBe(0);
  });

  it("supports optional tapping without removing hold-to-recover", () => {
    const tapping = new RaceSimulation({ retroRecovery: true });
    tapping.forceCrash();
    for (let tap = 0; tap < 6; tap += 1) {
      tapping.advance(FIXED_DT, input({ recover: true }));
      tapping.advance(FIXED_DT, neutralInput);
    }
    expect(tapping.snapshot.bike.phase).toBe("recovering");

    const holding = new RaceSimulation({ retroRecovery: true });
    holding.forceCrash();
    holding.advance(0.8, input({ recover: true }));
    expect(holding.snapshot.bike.phase).toBe("recovering");
  });
});

describe("race state", () => {
  it("requires ordered checkpoints and finishes after two laps", () => {
    const simulation = new RaceSimulation({ checkpointCount: 2 });

    simulation.advance(1, input({ throttle: true }));
    expect(simulation.markCheckpoint(1)).toBe(false);
    expect(simulation.crossFinishLine()).toBe(false);
    expect(simulation.markCheckpoint(0)).toBe(true);
    expect(simulation.markCheckpoint(1)).toBe(true);
    expect(simulation.crossFinishLine()).toBe(true);
    expect(simulation.snapshot.race.lap).toBe(2);
    expect(simulation.snapshot.race.finished).toBe(false);

    simulation.advance(1, input({ throttle: true }));
    expect(simulation.markCheckpoint(0)).toBe(true);
    expect(simulation.markCheckpoint(1)).toBe(true);
    expect(simulation.crossFinishLine()).toBe(true);

    const { race } = simulation.snapshot;
    expect(race.finished).toBe(true);
    expect(race.lapTimes).toHaveLength(2);
    expect(race.elapsedSeconds).toBeCloseTo(2);
    expect(race.lapTimes[0]).toBeCloseTo(1);
    expect(race.lapTimes[1]).toBeCloseTo(1);
    expect(race.splitTimes).toHaveLength(4);
    expect(race.splitTimes[0]).toBeCloseTo(1);
    expect(race.splitTimes[2]).toBeCloseTo(2);
  });

  it("applies bounded obstacle speed penalties", () => {
    const simulation = new RaceSimulation();
    simulation.advance(1, input({ throttle: true }));
    const before = simulation.snapshot.bike.speed;
    simulation.applySpeedPenalty(0.7);
    expect(simulation.snapshot.bike.speed).toBeCloseTo(before * 0.7);
    expect(() => simulation.applySpeedPenalty(1.1)).toThrow(/zero and one/);
  });

  it("supports every editor lap value from one through nine", () => {
    for (let totalLaps = 1; totalLaps <= 9; totalLaps += 1) {
      const simulation = new RaceSimulation({ checkpointCount: 1, totalLaps });
      for (let lap = 0; lap < totalLaps; lap += 1) {
        expect(simulation.markCheckpoint(0)).toBe(true);
        expect(simulation.crossFinishLine()).toBe(true);
      }
      expect(simulation.snapshot.race.finished).toBe(true);
      expect(simulation.snapshot.race.lapTimes).toHaveLength(totalLaps);
    }
  });

  it("rejects lap values outside the editor contract", () => {
    expect(() => new RaceSimulation({ totalLaps: 0 })).toThrow(/one through nine/);
    expect(() => new RaceSimulation({ totalLaps: 10 })).toThrow(/one through nine/);
  });
});

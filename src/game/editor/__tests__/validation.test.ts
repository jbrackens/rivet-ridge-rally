import { describe, expect, it } from "vitest";

import { EXAMPLE_TRACKS } from "../examples";
import { validateCustomTrack } from "../validation";
import type { CustomTrackData, CustomTrackModule } from "../../persistence/database";

function cloneExample(): CustomTrackData {
  const example = EXAMPLE_TRACKS[0];
  if (!example) throw new Error("Editor examples must include a baseline track.");
  return structuredClone(example);
}

function findModule(track: CustomTrackData, moduleId: string): CustomTrackModule {
  const module = track.modules.find((candidate) => candidate.moduleId === moduleId);
  if (!module) throw new Error(`Expected ${moduleId} in the test track.`);
  return module;
}

function placement(
  id: string,
  moduleId: string,
  lane: 0 | 1 | 2 | 3,
  gridPosition: number,
  rotation: 0 | 90 | 180 | 270 = 0,
  height = 0,
): CustomTrackModule {
  return { id, moduleId, lane, gridPosition, rotation, height };
}

function minimalTrack(modules: CustomTrackModule[] = []): CustomTrackData {
  const track = cloneExample();
  track.modules = [
    placement("route-start", "start-grid", 0, 0),
    placement("route-checkpoint", "checkpoint", 0, 50),
    placement("route-finish", "finish-arch", 0, 100),
    ...modules,
  ];
  return track;
}

describe("custom track validation", () => {
  it("accepts every bundled editor example", () => {
    for (const track of EXAMPLE_TRACKS) {
      expect(validateCustomTrack(structuredClone(track))).toMatchObject({
        valid: true,
        errors: [],
      });
    }
  });

  it.each([
    ["start-grid", "Place exactly one Start Grid."],
    ["finish-arch", "Place exactly one Finish Arch."],
    ["checkpoint", "Place at least one checkpoint between start and finish."],
  ] as const)("rejects a track without %s", (moduleId, expectedError) => {
    const track = cloneExample();
    track.modules = track.modules.filter((module) => module.moduleId !== moduleId);

    const result = validateCustomTrack(track);

    expect(result.valid).toBe(false);
    expect(result.errors).toContain(expectedError);
  });

  it("rejects a finish ordered before the start", () => {
    const track = cloneExample();
    findModule(track, "finish-arch").gridPosition = 0;

    const result = validateCustomTrack(track);

    expect(result.valid).toBe(false);
    expect(result.errors).toContain("The finish must come after the start.");
  });

  it("rejects checkpoints outside the start-to-finish route", () => {
    const track = cloneExample();
    const finish = findModule(track, "finish-arch");
    findModule(track, "checkpoint").gridPosition = finish.gridPosition + 2;

    const result = validateCustomTrack(track);

    expect(result.valid).toBe(false);
    expect(result.errors).toContain("Every checkpoint must be ordered between the start and finish.");
  });

  it("rejects longitudinal interval overlap in the same lane", () => {
    const track = minimalTrack([
      placement("ramp", "ramp-medium", 0, 30),
      placement("overlapping-bump", "bump-single", 0, 32),
    ]);

    const result = validateCustomTrack(track);

    expect(result.valid).toBe(false);
    expect(result.errors).toContain(
      "Trail Bump (overlapping-bump) overlaps Medium Ramp (ramp) near 31 m. Move one module to another lane, position, rotation, or height.",
    );
  });

  it("allows the same interval in separate lanes and route markers over obstacles", () => {
    const track = minimalTrack([
      placement("left-bump", "bump-single", 0, 30),
      placement("right-bump", "bump-single", 3, 30),
      placement("marker-overlap", "checkpoint", 0, 30),
    ]);

    const result = validateCustomTrack(track);

    expect(result).toMatchObject({ valid: true, errors: [] });
  });

  it("allows vertically separated modules with the same lane and interval", () => {
    const track = minimalTrack([
      placement("lower-bump", "bump-single", 1, 30, 0, 0),
      placement("upper-bump", "bump-single", 1, 30, 0, 2),
    ]);

    const result = validateCustomTrack(track);

    expect(result).toMatchObject({ valid: true, errors: [] });
  });

  it("rejects lane spans and rotated footprints outside the collision bounds", () => {
    const track = minimalTrack([
      placement("wide-edge", "ramp-large", 3, 30),
      placement("rotated-edge", "ramp-medium", 0, 60, 90),
    ]);

    const result = validateCustomTrack(track);

    expect(result.valid).toBe(false);
    expect(result.errors).toContain(
      "Large Ramp (wide-edge) has invalid collision bounds: its 2-lane span leaves the four-lane track. Move it inward.",
    );
    expect(result.errors).toContain(
      "Medium Ramp (rotated-edge) has invalid collision bounds after rotation. Move it inward or change its rotation.",
    );
  });

  it.each([0, 2.5, 6, Number.NaN])("rejects an invalid difficulty estimate of %s", (difficultyEstimate) => {
    const track = cloneExample();
    track.difficultyEstimate = difficultyEstimate;

    const result = validateCustomTrack(track);

    expect(result.valid).toBe(false);
    expect(result.errors).toContain("Declare a whole-number difficulty estimate from 1 through 5.");
  });

  it("rejects modules that this editor version does not support", () => {
    const track = cloneExample();
    track.modules.push({
      id: "future-module",
      moduleId: "future-loop",
      lane: 0,
      gridPosition: 84,
      rotation: 0,
      height: 0,
    });

    const result = validateCustomTrack(track);

    expect(result.valid).toBe(false);
    expect(result.errors).toContain("Module “future-loop” is not supported by this version.");
  });
});

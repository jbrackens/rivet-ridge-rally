import { describe, expect, it } from "vitest";

import { EXAMPLE_TRACKS } from "../examples";
import {
  CUSTOM_TRACK_MODULE_LIMIT,
  CUSTOM_TRACK_ROUTE_ELEVATION_LIMIT,
  CUSTOM_TRACK_ROUTE_LATERAL_LIMIT,
  CUSTOM_TRACK_ROUTE_MAX_GRADE_DEGREES,
  CUSTOM_TRACK_ROUTE_MAX_YAW_DEGREES,
  CUSTOM_TRACK_ROUTE_MIN_RADIUS,
  validateCustomTrack,
  validateCustomTrackPlacement,
  validateLegacyCustomTrack,
} from "../validation";
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

function boundedTrack(modules: CustomTrackModule[] = []): CustomTrackData {
  const track = cloneExample();
  track.modules = [
    placement("bounded-start", "start-grid", 0, 20),
    placement("bounded-checkpoint", "checkpoint", 0, 60),
    placement("bounded-finish", "finish-arch", 0, 100),
    ...modules,
  ];
  return track;
}

function trackWithModuleCount(moduleCount: number): CustomTrackData {
  const track = cloneExample();
  const checkpointCount = moduleCount - 2;
  track.modules = [
    placement("boundary-start", "start-grid", 0, 0),
    ...Array.from({ length: checkpointCount }, (_, index) => (
      placement(`boundary-checkpoint-${index + 1}`, "checkpoint", 0, index + 1)
    )),
    placement("boundary-finish", "finish-arch", 0, checkpointCount + 1),
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

  it("ships schema-v2 examples with safe nonzero checkpoint route anchors", () => {
    for (const track of EXAMPLE_TRACKS) {
      expect(track.schemaVersion).toBe(2);
      expect(track.modules.filter((module) => (
        module.moduleId !== "checkpoint" && module.routeAnchor !== undefined
      ))).toEqual([]);
      const checkpoints = track.modules
        .filter((module) => module.moduleId === "checkpoint")
        .sort((first, second) => first.gridPosition - second.gridPosition);
      expect(checkpoints.length).toBeGreaterThan(0);
      const checkpointAnchors = checkpoints.map((checkpoint) => {
        const anchor = checkpoint.routeAnchor;
        if (!anchor) throw new Error(`${track.name} checkpoint ${checkpoint.id} needs a route anchor.`);
        expect(anchor.lateralOffset).not.toBe(0);
        expect(anchor.lateralOffset).toBeGreaterThanOrEqual(-CUSTOM_TRACK_ROUTE_LATERAL_LIMIT);
        expect(anchor.lateralOffset).toBeLessThanOrEqual(CUSTOM_TRACK_ROUTE_LATERAL_LIMIT);
        expect(anchor.elevation).toBeGreaterThan(0);
        expect(anchor.elevation).toBeLessThanOrEqual(CUSTOM_TRACK_ROUTE_ELEVATION_LIMIT);
        return { distance: checkpoint.gridPosition, ...anchor };
      });
      const start = findModule(track, "start-grid");
      const finish = findModule(track, "finish-arch");
      const routeAnchors = [
        { distance: start.gridPosition, lateralOffset: 0, elevation: 0 },
        ...checkpointAnchors,
        { distance: finish.gridPosition, lateralOffset: 0, elevation: 0 },
      ];
      for (let index = 1; index < routeAnchors.length; index += 1) {
        const previous = routeAnchors[index - 1];
        const current = routeAnchors[index];
        if (!previous || !current) throw new Error("Expected an adjacent route-anchor pair.");
        const distance = current.distance - previous.distance;
        const lateralDelta = Math.abs(current.lateralOffset - previous.lateralOffset);
        const lateralDerivative = 1.875 * lateralDelta / distance;
        const elevationDerivative = 1.875 * Math.abs(current.elevation - previous.elevation) / distance;
        const lateralCurvature = (10 / Math.sqrt(3)) * lateralDelta / distance ** 2;
        const elevationCurvature = (10 / Math.sqrt(3))
          * Math.abs(current.elevation - previous.elevation) / distance ** 2;
        const longitudinalDerivative = Math.sqrt(
          1 - lateralDerivative ** 2 - elevationDerivative ** 2,
        );
        expect(Math.atan2(lateralDerivative, longitudinalDerivative)).toBeLessThanOrEqual(
          CUSTOM_TRACK_ROUTE_MAX_YAW_DEGREES * Math.PI / 180,
        );
        expect(elevationDerivative).toBeLessThanOrEqual(Math.sin(
          CUSTOM_TRACK_ROUTE_MAX_GRADE_DEGREES * Math.PI / 180,
        ));
        expect(lateralDerivative ** 2 + elevationDerivative ** 2).toBeLessThan(1);
        expect(lateralCurvature).toBeLessThanOrEqual(1 / CUSTOM_TRACK_ROUTE_MIN_RADIUS);
        expect(elevationCurvature).toBeLessThanOrEqual(1 / CUSTOM_TRACK_ROUTE_MIN_RADIUS);
      }
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

  it.each([
    ["start", placement("offset-start", "barrier-offset", 0, 22, 90)],
    ["finish", placement("offset-finish", "barrier-offset", 0, 98, 270)],
    ["start", placement("chain-start", "jump-chain", 0, 24, 180)],
  ] as const)("rejects a rotated multi-part footprint crossing the %s marker", (_boundary, module) => {
    const result = validateCustomTrack(boundedTrack([module]));

    expect(result.valid).toBe(false);
    expect(result.errors).toContain(
      `${module.moduleId === "jump-chain" ? "Jump Chain" : "Offset Barriers"} (${module.id}) extends outside the start-to-finish route. Move its full footprint between the route markers.`,
    );
  });

  it("accepts rotated multi-part footprints wholly inside the route markers", () => {
    const result = validateCustomTrack(boundedTrack([
      placement("safe-offset-start", "barrier-offset", 0, 23, 90),
      placement("safe-offset-finish", "barrier-offset", 0, 97, 270),
    ]));

    expect(result).toMatchObject({ valid: true, errors: [] });
  });

  it("keeps a former center-contained v1 footprint editable but requires a v2 repair", () => {
    const track = boundedTrack([
      placement("legacy-offset-start", "barrier-offset", 0, 22, 90),
    ]);

    expect(validateLegacyCustomTrack(track)).toMatchObject({ valid: true, errors: [] });
    expect(validateCustomTrack(track)).toMatchObject({ valid: false });
  });

  it("accepts bounded checkpoint-authored turns and rises", () => {
    const track = cloneExample();
    const checkpoints = track.modules.filter((module) => module.moduleId === "checkpoint");
    if (checkpoints[0]) checkpoints[0].routeAnchor = { lateralOffset: 4, elevation: 3 };
    if (checkpoints[1]) checkpoints[1].routeAnchor = { lateralOffset: -3, elevation: 2 };

    expect(validateCustomTrack(track)).toMatchObject({ valid: true, errors: [] });
  });

  it("rejects route anchors outside the authored corridor", () => {
    const track = cloneExample();
    const checkpoint = track.modules.find((module) => module.moduleId === "checkpoint");
    if (!checkpoint) throw new Error("Expected checkpoint fixture.");
    checkpoint.routeAnchor = { lateralOffset: 17, elevation: 13 };

    const result = validateCustomTrack(track);

    expect(result.valid).toBe(false);
    expect(result.errors).toContain(
      `Checkpoint (${checkpoint.id}) has an invalid route anchor. Keep Route turn within ±16 m and Route rise from 0–12 m.`,
    );
  });

  it("rejects a checkpoint centerline segment that bends too sharply", () => {
    const track = boundedTrack();
    const checkpoint = track.modules.find((module) => module.moduleId === "checkpoint");
    if (!checkpoint) throw new Error("Expected checkpoint fixture.");
    checkpoint.routeAnchor = { lateralOffset: 16, elevation: 0 };

    const result = validateCustomTrack(track);

    expect(result.valid).toBe(false);
    expect(result.errors.some((error) => error.includes("turns or rises too sharply"))).toBe(true);
  });

  it("keeps the rendered yaw within 12 degrees when a segment also rises", () => {
    const track = boundedTrack();
    const checkpoint = track.modules.find((module) => module.moduleId === "checkpoint");
    if (!checkpoint) throw new Error("Expected checkpoint fixture.");
    checkpoint.routeAnchor = { lateralOffset: 4.4, elevation: 3.5 };

    const result = validateCustomTrack(track);

    expect(result.valid).toBe(false);
    expect(result.errors.some((error) => error.includes("turns or rises too sharply"))).toBe(true);
  });

  it("rejects route shaping metadata on a non-checkpoint module", () => {
    const track = cloneExample();
    const obstacle = track.modules.find((module) => module.moduleId === "bump-row");
    if (!obstacle) throw new Error("Expected obstacle fixture.");
    obstacle.routeAnchor = { lateralOffset: 1, elevation: 1 };

    const result = validateCustomTrack(track);

    expect(result.valid).toBe(false);
    expect(result.errors).toContain(
      `${obstacle.moduleId} (${obstacle.id}) cannot shape the route. Route turn and rise belong only to checkpoints.`,
    );
  });

  it.each([0, 2.5, 6, Number.NaN])("rejects an invalid difficulty estimate of %s", (difficultyEstimate) => {
    const track = cloneExample();
    track.difficultyEstimate = difficultyEstimate;

    const result = validateCustomTrack(track);

    expect(result.valid).toBe(false);
    expect(result.errors).toContain("Declare a whole-number difficulty estimate from 1 through 5.");
  });

  it("rejects a blank track name", () => {
    const track = cloneExample();
    track.name = "   ";

    const result = validateCustomTrack(track);

    expect(result.valid).toBe(false);
    expect(result.errors).toContain("Enter a track name.");
  });

  it("accepts the 42-character name boundary and rejects longer names", () => {
    const track = cloneExample();
    track.name = "R".repeat(42);
    expect(validateCustomTrack(track).valid).toBe(true);

    track.name = "R".repeat(43);
    const result = validateCustomTrack(track);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("Keep the track name to 42 characters or fewer.");
  });

  it("accepts the shared module limit and rejects one module over it", () => {
    expect(validateCustomTrack(trackWithModuleCount(CUSTOM_TRACK_MODULE_LIMIT))).toMatchObject({
      valid: true,
      errors: [],
    });

    const result = validateCustomTrack(trackWithModuleCount(CUSTOM_TRACK_MODULE_LIMIT + 1));
    expect(result.valid).toBe(false);
    expect(result.errors).toContain(`Keep the track to ${CUSTOM_TRACK_MODULE_LIMIT} modules or fewer.`);
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

describe("editor placement preview validation", () => {
  it("rejects a new placement at the shared module limit", () => {
    const track = trackWithModuleCount(CUSTOM_TRACK_MODULE_LIMIT);
    const candidate = placement("overflow", "bump-single", 3, 250, 0, 10);

    expect(validateCustomTrackPlacement(track, candidate)).toEqual({
      valid: false,
      errors: [`The track has reached the ${CUSTOM_TRACK_MODULE_LIMIT}-module safety limit.`],
    });
  });

  it("accepts a bounded placement between the route markers", () => {
    const track = minimalTrack();
    const candidate = placement("preview", "ramp-medium", 1, 70);

    expect(validateCustomTrackPlacement(track, candidate)).toEqual({
      valid: true,
      errors: [],
    });
  });

  it.each([
    ["start", placement("preview-start", "barrier-offset", 0, 22, 90)],
    ["finish", placement("preview-finish", "barrier-offset", 0, 98, 270)],
  ] as const)("rejects a rotated multi-part preview crossing the %s marker", (_boundary, candidate) => {
    const result = validateCustomTrackPlacement(boundedTrack(), candidate);

    expect(result.valid).toBe(false);
    expect(result.errors).toContain(
      `Offset Barriers (${candidate.id}) extends outside the start-to-finish route. Move its full footprint between the route markers.`,
    );
  });

  it("reports overlap before a placement is committed", () => {
    const track = minimalTrack([
      placement("existing-ramp", "ramp-medium", 0, 30),
    ]);
    const candidate = placement("preview", "bump-single", 0, 32);

    const result = validateCustomTrackPlacement(track, candidate);

    expect(result.valid).toBe(false);
    expect(result.errors.some((error) => error.includes("overlaps Medium Ramp"))).toBe(true);
  });

  it("reports duplicate race markers before a placement is committed", () => {
    const track = minimalTrack();
    const candidate = placement("preview", "start-grid", 0, 10);

    const result = validateCustomTrackPlacement(track, candidate);

    expect(result.valid).toBe(false);
    expect(result.errors).toContain("A Start Grid already exists. Select the existing grid instead.");
  });
});

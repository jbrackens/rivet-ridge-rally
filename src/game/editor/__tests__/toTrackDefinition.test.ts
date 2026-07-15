import { describe, expect, it } from "vitest";

import type { CustomTrackData, CustomTrackModule } from "../../persistence/database";
import {
  CUSTOM_TRACK_PRESENTATION_FALLBACK_LENGTH,
  customTrackToDefinition,
  customTrackToPresentationDefinition,
} from "../toTrackDefinition";
import { EDITOR_MODULES } from "../modules";

function placement(
  id: string,
  moduleId: string,
  lane: CustomTrackModule["lane"],
  gridPosition: number,
  rotation: CustomTrackModule["rotation"] = 0,
  height = 0,
  routeAnchor?: CustomTrackModule["routeAnchor"],
): CustomTrackModule {
  return {
    id,
    moduleId,
    lane,
    gridPosition,
    rotation,
    height,
    ...(routeAnchor ? { routeAnchor } : {}),
  };
}

function customTrack(laps: number): CustomTrackData {
  return {
    schemaVersion: 2,
    id: "conversion-fixture",
    name: "Workshop Circuit",
    laps,
    difficultyEstimate: 4,
    createdAt: 1_735_689_600_000,
    updatedAt: 1_735_689_600_000,
    modules: [
      placement("start", "start-grid", 0, 0),
      placement("straight", "straight-short", 0, 12),
      placement("curve", "curve-left", 0, 24, 90, 2),
      placement("checkpoint", "checkpoint", 0, 40, 0, 0, {
        lateralOffset: -2.5,
        elevation: 1.5,
      }),
      placement("ramp", "ramp-large", 2, 60, 90, 1.5),
      placement("mud", "mud-wide", 2, 80),
      placement("grass", "grass-cut", 0, 90),
      placement("checkpoint-two", "checkpoint", 0, 98, 180, 0.5, {
        lateralOffset: 3,
        elevation: 2,
      }),
      placement("cooling", "cooling-single", 1, 100),
      placement("barrier", "barrier-short", 0, 115),
      placement("bump", "bump-single", 2, 130),
      placement("bank", "bank-left", 0, 140, 270, 3),
      placement("finish", "finish-arch", 0, 160, 180, 1),
    ],
  };
}

describe("custom track conversion", () => {
  it("preserves authored gates, course pieces, obstacle semantics, and every transform", () => {
    const definition = customTrackToDefinition(customTrack(2));

    expect(definition).toMatchObject({
      name: "Workshop Circuit",
      theme: "Custom workshop course",
      skillFocus: "Editor difficulty 4 / 5",
      courseLength: 160,
    });
    expect(definition.obstacles.map(({ id, kind }) => ({ id, kind }))).toEqual([
      { id: "ramp", kind: "large-ramp" },
      { id: "mud", kind: "mud" },
      { id: "grass", kind: "grass" },
      { id: "cooling", kind: "cooling-gate" },
      { id: "barrier", kind: "barrier" },
      { id: "bump", kind: "bump" },
    ]);
    expect(definition.obstacles[0]).toMatchObject({
      moduleId: "ramp-large",
      distance: 60,
      lanes: [2, 3],
      length: 5.5,
      width: 4.84,
      unrotatedWidth: 5.5,
      unrotatedLength: 4.84,
      rotation: 90,
      height: 1.5,
      intensity: 0.6,
      rampImpulse: 9.5,
    });
    expect(definition.obstacles[1]?.lanes).toEqual([2, 3]);
    expect(definition.authoredCourse).toMatchObject({
      start: { id: "start", distance: 0, order: 0, rotation: 0, height: 0 },
      checkpoints: [
        { id: "checkpoint", distance: 40, order: 1, rotation: 0, height: 0 },
        { id: "checkpoint-two", distance: 98, order: 2, rotation: 180, height: 0.5 },
      ],
      finish: { id: "finish", distance: 160, order: 3, rotation: 180, height: 1 },
      centerline: [
        { distance: 0, lateralOffset: 0, elevation: 0 },
        { distance: 40, lateralOffset: -2.5, elevation: 1.5 },
        { distance: 98, lateralOffset: 3, elevation: 2 },
        { distance: 160, lateralOffset: 0, elevation: 0 },
      ],
      trackPieces: [
        { id: "straight", kind: "straight", distance: 12, rotation: 0, height: 0 },
        { id: "curve", kind: "curve-left", distance: 24, rotation: 90, height: 2 },
        { id: "bank", kind: "bank-left", distance: 140, rotation: 270, height: 3 },
      ],
    });
  });

  it("keeps course geometry stable and scales targets for every supported lap count", () => {
    for (let laps = 1; laps <= 9; laps += 1) {
      const definition = customTrackToDefinition(customTrack(laps));

      expect(definition.courseLength).toBe(160);
      expect(definition.obstacles).toHaveLength(6);
      expect(definition.authoredCourse?.checkpoints).toHaveLength(2);
      expect(definition.soloTargetMs).toBe(Math.round((160 / 12.5) * laps * 1_000));
      expect(definition.parTimeMs).toBe(Math.round((160 / 14.5) * laps * 1_000));
    }
  });

  it("accounts for every supported editor module in one runtime-native collection", () => {
    const now = 1_735_689_600_000;
    const modules = EDITOR_MODULES.map((module, index) => placement(
      `all-${module.id}`,
      module.id,
      0,
      module.id === "start-grid" ? 0 : module.id === "checkpoint" ? 200 : module.id === "finish-arch" ? 400 : index * 12 + 12,
      index % 4 === 0 ? 90 : 0,
      index % 3,
    ));
    const definition = customTrackToDefinition({
      schemaVersion: 2,
      id: "all-runtime-modules",
      name: "All Runtime Modules",
      laps: 2,
      difficultyEstimate: 5,
      modules,
      createdAt: now,
      updatedAt: now,
    });
    const authored = definition.authoredCourse;
    expect(authored).toBeDefined();
    const accountedIds = [
      authored?.start.id,
      ...((authored?.checkpoints ?? []).map(({ id }) => id)),
      authored?.finish.id,
      ...((authored?.trackPieces ?? []).map(({ id }) => id)),
      ...definition.obstacles.map(({ id }) => id),
    ];
    expect(new Set(accountedIds)).toEqual(new Set(modules.map(({ id }) => id)));
    expect(accountedIds).toHaveLength(EDITOR_MODULES.length);
  });

  it("returns an authored all-zero route instead of throwing for an incomplete editor draft", () => {
    const draft = customTrack(2);
    draft.modules = draft.modules.filter((module) => module.moduleId !== "checkpoint");

    const definition = customTrackToPresentationDefinition(draft);

    expect(definition.courseLength).toBe(CUSTOM_TRACK_PRESENTATION_FALLBACK_LENGTH);
    expect(definition.obstacles).toEqual([]);
    expect(definition.authoredCourse?.centerline).toEqual([
      { distance: 0, lateralOffset: 0, elevation: 0 },
      {
        distance: CUSTOM_TRACK_PRESENTATION_FALLBACK_LENGTH / 2,
        lateralOffset: 0,
        elevation: 0,
      },
      {
        distance: CUSTOM_TRACK_PRESENTATION_FALLBACK_LENGTH,
        lateralOffset: 0,
        elevation: 0,
      },
    ]);
  });

  it("extends an incomplete editor draft fallback to its visible working range", () => {
    const draft = customTrack(2);
    draft.modules = draft.modules.filter((module) => module.moduleId !== "checkpoint");

    const definition = customTrackToPresentationDefinition(draft, 12_048);

    expect(definition.courseLength).toBe(12_048);
    expect(definition.authoredCourse?.finish.distance).toBe(12_048);
  });
});

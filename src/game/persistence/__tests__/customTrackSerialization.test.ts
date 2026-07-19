import { describe, expect, it, vi } from "vitest";

import { EXAMPLE_TRACKS } from "../../editor/examples";
import { CUSTOM_TRACK_MODULE_LIMIT } from "../../editor/validation";
import {
  classifyPersistenceFailure,
  exportCustomTrack,
  exportCustomTrackRecovery,
  importCustomTrack,
  type CustomTrackData,
} from "../database";

describe("persistence failure classification", () => {
  it("distinguishes quota, upgrade, and unavailable failures for recovery copy", () => {
    expect(classifyPersistenceFailure(
      new DOMException("Storage quota reached.", "QuotaExceededError"),
      "settings",
    )).toBe("quota");
    expect(classifyPersistenceFailure(
      new DOMException("A newer database version exists.", "VersionError"),
      "load",
    )).toBe("upgrade");
    expect(classifyPersistenceFailure(
      new Error("Database access is blocked by another open tab."),
      "load",
    )).toBe("blocked");
    const missingApi = new Error("IndexedDB API missing");
    missingApi.name = "MissingAPIError";
    expect(classifyPersistenceFailure(missingApi, "load")).toBe("unavailable");
  });
});

function cloneExample(): CustomTrackData {
  const example = EXAMPLE_TRACKS[1];
  if (!example) throw new Error("Editor examples must include a serialization fixture.");
  return structuredClone(example);
}

function legacyTrack(track = cloneExample()): Record<string, unknown> {
  return {
    ...track,
    schemaVersion: 1,
    modules: track.modules.map((module) => {
      const legacyModule: Record<string, unknown> = { ...module };
      delete legacyModule.routeAnchor;
      return legacyModule;
    }),
  };
}

describe("custom track JSON serialization", () => {
  it("round-trips a valid track without losing data", () => {
    const original = cloneExample();

    const serialized = exportCustomTrack(original);
    const imported = importCustomTrack(serialized);

    expect(imported).toEqual(original);
    expect(imported).not.toBe(original);
    expect(serialized).toContain('\n  "schemaVersion": 2');
  });

  it("round-trips a checkpoint route anchor without changing its values", () => {
    const original = cloneExample();
    const checkpoint = original.modules.find((module) => module.moduleId === "checkpoint");
    if (!checkpoint) throw new Error("Serialization fixture must contain a checkpoint.");
    checkpoint.routeAnchor = { lateralOffset: 2, elevation: 1 };

    expect(importCustomTrack(exportCustomTrack(original))).toEqual(original);
  });

  it("normalizes a valid version-1 file without changing its payload fields", () => {
    const legacy = legacyTrack();
    const imported = importCustomTrack(JSON.stringify(legacy));

    expect(imported).toEqual({ ...legacy, schemaVersion: 2 });
    expect(imported.modules).toEqual(legacy.modules);
    expect(imported.createdAt).toBe(legacy.createdAt);
    expect(imported.updatedAt).toBe(legacy.updatedAt);
  });

  it("keeps a legacy center-contained track editable when v2 requires footprint repair", () => {
    const legacy = legacyTrack();
    legacy.modules = [
      {
        id: "legacy-start",
        moduleId: "start-grid",
        lane: 0,
        gridPosition: 20,
        rotation: 0,
        height: 0,
      },
      {
        id: "legacy-offset",
        moduleId: "barrier-offset",
        lane: 0,
        gridPosition: 22,
        rotation: 90,
        height: 0,
      },
      {
        id: "legacy-checkpoint",
        moduleId: "checkpoint",
        lane: 0,
        gridPosition: 60,
        rotation: 0,
        height: 0,
      },
      {
        id: "legacy-finish",
        moduleId: "finish-arch",
        lane: 0,
        gridPosition: 100,
        rotation: 0,
        height: 0,
      },
    ];

    const imported = importCustomTrack(JSON.stringify(legacy));

    expect(imported).toEqual({ ...legacy, schemaVersion: 2 });
    expect(() => exportCustomTrack(imported)).toThrow(/extends outside the start-to-finish route/);
  });

  it("exports only the current custom-track schema", () => {
    expect(() => exportCustomTrack(legacyTrack() as unknown as CustomTrackData)).toThrow();
  });

  it("round-trips the schema-valid module boundary", () => {
    const original = cloneExample();
    original.id = "maximum-module-track";
    original.name = "Maximum Module Track";
    original.modules = [
      {
        id: "maximum-start",
        moduleId: "start-grid",
        lane: 0,
        gridPosition: 0,
        rotation: 0,
        height: 0,
      },
      ...Array.from({ length: CUSTOM_TRACK_MODULE_LIMIT - 2 }, (_, index) => ({
        id: `maximum-checkpoint-${index + 1}`,
        moduleId: "checkpoint",
        lane: 0 as const,
        gridPosition: index + 1,
        rotation: 0 as const,
        height: 0,
      })),
      {
        id: "maximum-finish",
        moduleId: "finish-arch",
        lane: 0,
        gridPosition: CUSTOM_TRACK_MODULE_LIMIT - 1,
        rotation: 0,
        height: 0,
      },
    ];

    expect(importCustomTrack(exportCustomTrack(original))).toEqual(original);
  });

  it("rejects one module over the shared persistence boundary", () => {
    const original = cloneExample();
    original.modules = Array.from({ length: CUSTOM_TRACK_MODULE_LIMIT + 1 }, (_, index) => ({
      id: `overflow-${index}`,
      moduleId: "checkpoint",
      lane: 0 as const,
      gridPosition: index,
      rotation: 0 as const,
      height: 0,
    }));

    expect(() => importCustomTrack(JSON.stringify(original))).toThrow(
      /Track file is incompatible or invalid/,
    );
  });

  it("rejects corrupt JSON", () => {
    expect(() => importCustomTrack('{"schemaVersion":')).toThrow(
      "Track file is not valid JSON.",
    );
  });

  it("rejects files larger than the one-megabyte safety limit", () => {
    expect(() => importCustomTrack("x".repeat(1_000_001))).toThrow(
      "Track file exceeds the 1 MB safety limit.",
    );
  });

  it.each([0, 10])("rejects an invalid lap count of %i", (laps) => {
    const serialized = JSON.stringify({ ...cloneExample(), laps });

    expect(() => importCustomTrack(serialized)).toThrow(
      /Track file is incompatible or invalid/,
    );
  });

  it("rejects a future schema version without downgrading it", () => {
    const serialized = JSON.stringify({ ...cloneExample(), schemaVersion: 3 });

    expect(() => importCustomTrack(serialized)).toThrow(
      /newer schema version/,
    );
  });

  it("rejects route anchors on non-checkpoint modules", () => {
    const track = cloneExample();
    const start = track.modules.find((module) => module.moduleId === "start-grid");
    if (!start) throw new Error("Serialization fixture must contain a start grid.");
    start.routeAnchor = { lateralOffset: 2, elevation: 1 };

    expect(() => importCustomTrack(JSON.stringify(track))).toThrow(
      /Only checkpoint modules may define a route anchor/,
    );
  });

  it("rejects route anchors outside the bounded authored-course envelope", () => {
    const track = cloneExample();
    const checkpoint = track.modules.find((module) => module.moduleId === "checkpoint");
    if (!checkpoint) throw new Error("Serialization fixture must contain a checkpoint.");
    checkpoint.routeAnchor = { lateralOffset: 17, elevation: 13 };

    expect(() => importCustomTrack(JSON.stringify(track))).toThrow(
      /Track file is incompatible or invalid/,
    );
  });

  it("keeps version-1 modules strict instead of accepting route-anchor fields silently", () => {
    const legacy = legacyTrack();
    const modules = legacy.modules as Array<Record<string, unknown>>;
    const checkpoint = modules.find((module) => module.moduleId === "checkpoint");
    if (!checkpoint) throw new Error("Serialization fixture must contain a checkpoint.");
    checkpoint.routeAnchor = { lateralOffset: 2, elevation: 1 };

    expect(() => importCustomTrack(JSON.stringify(legacy))).toThrow(
      /Track file is incompatible or invalid/,
    );
  });

  it("rejects unknown interchange fields instead of silently stripping them", () => {
    const track = { ...cloneExample(), launchUrl: "https://invalid.example/track" };

    expect(() => importCustomTrack(JSON.stringify(track))).toThrow(
      /Track file is incompatible or invalid/,
    );
  });

  it("reports a safe human-readable reason for an external thumbnail", () => {
    const track = { ...cloneExample(), thumbnail: "https://invalid.example/track.png" };

    expect(() => importCustomTrack(JSON.stringify(track))).toThrow(
      "Track file is incompatible or invalid: Thumbnail must be an embedded image data URL.",
    );
  });

  it("rejects excessive nesting before JSON allocation", () => {
    let nested: unknown = "value";
    for (let depth = 0; depth < 21; depth += 1) nested = [nested];
    const track = { ...cloneExample(), nested };

    expect(() => importCustomTrack(JSON.stringify(track))).toThrow(
      "Track file exceeds the nesting safety limit.",
    );
  });

  it("rejects excessive item counts before JSON allocation", () => {
    const track = { ...cloneExample(), items: Array.from({ length: 10_100 }, () => 0) };

    expect(() => importCustomTrack(JSON.stringify(track))).toThrow(
      "Track file contains too many items.",
    );
  });

  it("rejects individual strings beyond the preflight limit", () => {
    const track = { ...cloneExample(), oversized: "x".repeat(350_001) };

    expect(() => importCustomTrack(JSON.stringify(track))).toThrow(
      "Track file contains a string beyond the safety limit.",
    );
  });

  it("rejects schema-valid data with a semantically incomplete route", () => {
    const track = cloneExample();
    track.modules = track.modules.filter((module) => module.moduleId !== "finish-arch");

    expect(() => importCustomTrack(JSON.stringify(track))).toThrow(
      "Track route is invalid: Place exactly one Finish Arch.",
    );
  });

  it("rejects schema-valid data with impossible collision overlap", () => {
    const track = cloneExample();
    const bump = track.modules.find((module) => module.moduleId === "bump-row");
    if (!bump) throw new Error("Serialization fixture must contain a bump row.");
    track.modules.push({
      id: "overlapping-ramp",
      moduleId: "ramp-medium",
      lane: bump.lane,
      gridPosition: bump.gridPosition + 2,
      rotation: 0,
      height: bump.height,
    });

    expect(() => importCustomTrack(JSON.stringify(track))).toThrow(
      /Track route is invalid: Medium Ramp \(overlapping-ramp\) overlaps Bump Row/,
    );
  });
});

describe("custom track recovery serialization", () => {
  it("tags cycles and structured-clone values that plain JSON cannot preserve", async () => {
    const sparse: unknown[] = [];
    sparse.length = 4;
    sparse[2] = "kept";
    const payload: Record<string, unknown> = {
      big: 123n,
      map: new Map<unknown, unknown>([["answer", 42n]]),
      set: new Set<unknown>(["present", undefined]),
      typed: new Uint16Array([1, 513]),
      sparse,
      blob: new Blob([new Uint8Array([1, 2, 3])], { type: "application/octet-stream" }),
    };
    payload.self = payload;

    const serialized = await exportCustomTrackRecovery({
      key: 7,
      name: "Damaged Circuit",
      reason: "Invalid route",
      payload,
      createdAt: 1_735_689_600_000,
      quarantined: true,
    });
    const recovery = JSON.parse(serialized) as {
      recoveryVersion: number;
      encoding: string;
      payload: { properties: [string, unknown][] };
    };
    const properties = Object.fromEntries(recovery.payload.properties) as Record<string, unknown>;

    expect(recovery).toMatchObject({
      recoveryVersion: 2,
      encoding: "rivet-ridge-rally-tagged-structured-clone-json-v1",
    });
    expect(properties.big).toEqual({ $type: "BigInt", value: "123" });
    expect(properties.self).toEqual({ $ref: "$.payload" });
    expect(properties.map).toEqual({
      $type: "Map",
      entries: [["answer", { $type: "BigInt", value: "42" }]],
    });
    expect(properties.set).toEqual({
      $type: "Set",
      values: ["present", { $type: "Undefined" }],
    });
    expect(properties.typed).toMatchObject({
      $type: "TypedArray",
      name: "Uint16Array",
      byteLength: 4,
      length: 2,
      buffer: { $type: "ArrayBuffer" },
    });
    expect(properties.sparse).toEqual({
      $type: "Array",
      length: 4,
      entries: [[2, "kept"]],
      properties: [],
    });
    expect(properties.blob).toEqual({
      $type: "Blob",
      mimeType: "application/octet-stream",
      bytesBase64: "AQID",
    });
  });

  it("rejects an oversized Blob from its size before reading its bytes", async () => {
    const blob = new Blob([new Uint8Array(1_000_001)]);
    const arrayBuffer = vi.spyOn(blob, "arrayBuffer");

    await expect(exportCustomTrackRecovery({
      key: 8,
      name: "Oversized binary",
      reason: "Invalid binary payload",
      payload: blob,
      createdAt: 1_735_689_600_000,
      quarantined: true,
    })).rejects.toThrow(/Recovery data contains a string beyond|output safety limit/);
    expect(arrayBuffer).not.toHaveBeenCalled();
  });

  it("rejects recovery payloads beyond the shared nesting limit", async () => {
    let payload: unknown = "end";
    for (let depth = 0; depth < 21; depth += 1) payload = { next: payload };

    await expect(exportCustomTrackRecovery({
      key: 9,
      name: "Deep recovery",
      reason: "Invalid nesting",
      payload,
      createdAt: 1_735_689_600_000,
      quarantined: true,
    })).rejects.toThrow("Recovery data exceeds the nesting safety limit.");
  });

  it("rejects oversized Map and Set payloads during lazy traversal", async () => {
    const largeMap = new Map<number, number>();
    for (let index = 0; index < 5_100; index += 1) largeMap.set(index, index);
    const largeSet = new Set<number>();
    for (let index = 0; index < 10_100; index += 1) largeSet.add(index);
    const recovery = (payload: unknown) => ({
      key: 10,
      name: "Large collection",
      reason: "Invalid collection",
      payload,
      createdAt: 1_735_689_600_000,
      quarantined: true,
    });

    await expect(exportCustomTrackRecovery(recovery(largeMap))).rejects.toThrow(
      "Recovery data contains too many items.",
    );
    await expect(exportCustomTrackRecovery(recovery(largeSet))).rejects.toThrow(
      "Recovery data contains too many items.",
    );
  });

  it("preserves cycles spanning Map and Set values", async () => {
    const map = new Map<string, unknown>();
    const set = new Set<unknown>();
    map.set("set", set);
    set.add(map);

    const serialized = await exportCustomTrackRecovery({
      key: 11,
      name: "Cyclic collections",
      reason: "Cycle preservation",
      payload: map,
      createdAt: 1_735_689_600_000,
      quarantined: true,
    });
    const recovery = JSON.parse(serialized) as {
      payload: { entries: [string, { values: unknown[] }][] };
    };

    expect(recovery.payload.entries[0]?.[1].values[0]).toEqual({ $ref: "$.payload" });
  });
});

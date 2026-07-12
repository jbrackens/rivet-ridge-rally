import { describe, expect, it } from "vitest";

import { EXAMPLE_TRACKS } from "../../editor/examples";
import {
  classifyPersistenceFailure,
  exportCustomTrack,
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

describe("custom track JSON serialization", () => {
  it("round-trips a valid track without losing data", () => {
    const original = cloneExample();

    const serialized = exportCustomTrack(original);
    const imported = importCustomTrack(serialized);

    expect(imported).toEqual(original);
    expect(imported).not.toBe(original);
    expect(serialized).toContain('\n  "schemaVersion": 1');
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

  it("rejects an incompatible schema version", () => {
    const serialized = JSON.stringify({ ...cloneExample(), schemaVersion: 2 });

    expect(() => importCustomTrack(serialized)).toThrow(
      /Track file is incompatible or invalid/,
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

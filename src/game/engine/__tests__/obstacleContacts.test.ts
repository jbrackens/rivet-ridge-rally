import { describe, expect, it } from "vitest";

import type {
  LaneIndex,
  TrackObstacle,
  TrackPlacementRotation,
} from "../../content/tracks";
import { resolveObstacleContacts } from "../obstacleContacts";

function obstacle(overrides: Partial<TrackObstacle> = {}): TrackObstacle {
  return {
    id: "contact-fixture",
    kind: "medium-ramp",
    distance: 100,
    lanes: [1],
    length: 10,
    ...overrides,
  };
}

function offsetBarrier(
  firstLane: 0 | 1 | 2,
  rotation: TrackPlacementRotation,
): TrackObstacle {
  const lateralCenter = [-3, 0, 3][firstLane] ?? 0;
  const sideways = rotation === 90 || rotation === 270;
  return obstacle({
    id: `offset-${firstLane}-${rotation}`,
    kind: "barrier",
    moduleId: "barrier-offset",
    lanes: [firstLane, (firstLane + 1) as LaneIndex],
    lateralPosition: lateralCenter,
    unrotatedWidth: 5.5,
    unrotatedLength: 5.72,
    width: sideways ? 5.72 : 5.5,
    length: sideways ? 5.5 : 5.72,
    rotation,
  });
}

describe("obstacle contact resolution", () => {
  it.each([
    ["medium-ramp", undefined],
    ["medium-ramp", "ramp-medium"],
    ["medium-ramp", "ramp-tabletop"],
    ["bump", "bump-single"],
  ] as const)("preserves one contact for %s / %s", (kind, moduleId) => {
    const parent = obstacle({
      kind,
      ...(moduleId === undefined ? {} : { moduleId }),
    });

    expect(resolveObstacleContacts(parent)).toEqual([{
      key: parent.id,
      parent,
      kind,
      distance: 100,
      length: 10,
      lanes: [1],
    }]);
  });

  it("matches short-barrier contact depth to the visible rail instead of its placement footprint", () => {
    for (const parent of [
      obstacle({ kind: "barrier", moduleId: "barrier-short", length: 10 }),
      obstacle({ kind: "barrier", length: 6 }),
      { id: "generic-barrier", kind: "barrier", distance: 100, lanes: [1] } as TrackObstacle,
    ]) {
      expect(resolveObstacleContacts(parent)).toEqual([{
        key: parent.id,
        parent,
        kind: "barrier",
        distance: 100,
        length: 0.5,
        lanes: [1],
      }]);
    }
  });

  it("uses the rotated visible rail width as a sideways short-barrier route depth", () => {
    const parent = obstacle({
      kind: "barrier",
      moduleId: "barrier-short",
      length: 2.75,
      unrotatedWidth: 2.75,
      unrotatedLength: 1.76,
      rotation: 90,
    });

    expect(resolveObstacleContacts(parent)[0]?.length).toBeCloseTo(2.75 * 0.92, 8);
  });

  it("uses one bounded fallback contact when a generic obstacle omits length", () => {
    const parent: TrackObstacle = {
      id: "contact-fixture",
      kind: "mud",
      distance: 100,
      lanes: [1],
    };

    expect(resolveObstacleContacts(parent)).toEqual([{
      key: parent.id,
      parent,
      kind: "mud",
      distance: 100,
      length: 8,
      lanes: [1],
    }]);
  });

  it("resolves every campaign or authored jump chain into three ordered ramp sections with dirt gaps", () => {
    for (const parent of [
      obstacle({ id: "campaign-chain", kind: "jump-chain", length: 100 }),
      obstacle({ id: "authored-chain", kind: "jump-chain", moduleId: "jump-chain", length: 20 }),
    ]) {
      const sections = resolveObstacleContacts(parent);
      expect(sections).toHaveLength(3);
      expect(sections.map(({ key }) => key)).toEqual([
        `${parent.id}:section-1`,
        `${parent.id}:section-2`,
        `${parent.id}:section-3`,
      ]);
      expect(sections.map(({ distance }) => distance)).toEqual([
        parent.distance - (parent.length ?? 8) * 0.31,
        parent.distance,
        parent.distance + (parent.length ?? 8) * 0.31,
      ]);

      const parentStart = parent.distance - (parent.length ?? 8) / 2;
      const parentEnd = parent.distance + (parent.length ?? 8) / 2;
      for (const section of sections) {
        expect(section.kind).toBe("jump-chain");
        expect(section.parent).toBe(parent);
        expect(section.distance - section.length / 2).toBeGreaterThan(parentStart);
        expect(section.distance + section.length / 2).toBeLessThan(parentEnd);
      }
      for (let index = 1; index < sections.length; index += 1) {
        const previous = sections[index - 1];
        const current = sections[index];
        if (!previous || !current) throw new Error("Expected ordered jump-chain contacts.");
        expect(current.distance - current.length / 2).toBeGreaterThan(
          previous.distance + previous.length / 2,
        );
      }
    }
  });

  it("distinguishes authored double jumps, bump rows, and their single-section variants", () => {
    const double = resolveObstacleContacts(obstacle({ moduleId: "jump-double" }));
    expect(double).toHaveLength(2);
    expect(double.map(({ distance, length }) => ({ distance, length }))).toEqual([
      { distance: 97, length: 3.2 },
      { distance: 103, length: 3.2 },
    ]);

    const bumpRow = resolveObstacleContacts(obstacle({
      kind: "bump",
      moduleId: "bump-row",
      length: 8,
    }));
    expect(bumpRow).toHaveLength(4);
    expect(bumpRow.map(({ distance, length }) => ({ distance, length }))).toEqual([
      { distance: 97, length: 2 },
      { distance: 99, length: 2 },
      { distance: 101, length: 2 },
      { distance: 103, length: 2 },
    ]);

    expect(resolveObstacleContacts(obstacle({ moduleId: "ramp-tabletop" }))).toHaveLength(1);
    expect(resolveObstacleContacts(obstacle({ kind: "bump", moduleId: "bump-single" }))).toHaveLength(1);
    expect(resolveObstacleContacts(obstacle({ kind: "barrier", moduleId: "barrier-short" }))).toHaveLength(1);
  });

  it("keeps sideways rhythm modules as one route footprint", () => {
    const contacts = resolveObstacleContacts(obstacle({
      kind: "jump-chain",
      moduleId: "jump-chain",
      rotation: 90,
      length: 5.5,
      unrotatedLength: 9.68,
    }));

    expect(contacts).toHaveLength(1);
    expect(contacts[0]?.key).toBe("contact-fixture");
    expect(contacts[0]?.length).toBe(5.5);
  });

  it("transforms both staggered barrier sections through every rotation and valid lane pair", () => {
    for (const firstLane of [0, 1, 2] as const) {
      for (const rotation of [0, 90, 180, 270] as const) {
        const parent = offsetBarrier(firstLane, rotation);
        const sections = resolveObstacleContacts(parent);
        const sideways = rotation === 90 || rotation === 270;
        const distanceOffset = sideways ? 5.5 * 0.22 : 5.72 * 0.27;
        const expectedLaneOrder = sideways
          ? [[firstLane], [firstLane + 1]]
          : [[firstLane + 1], [firstLane]];

        expect(sections).toHaveLength(2);
        expect(sections.map(({ distance }) => distance)).toEqual([
          100 - distanceOffset,
          100 + distanceOffset,
        ]);
        expect(sections.map(({ length }) => length)).toEqual(
          sideways ? [5.5 * 0.52, 5.5 * 0.52] : [0.72, 0.72],
        );
        const parentStart = parent.distance - (parent.length ?? 8) / 2;
        const parentEnd = parent.distance + (parent.length ?? 8) / 2;
        for (const section of sections) {
          expect(section.distance - section.length / 2).toBeGreaterThanOrEqual(parentStart);
          expect(section.distance + section.length / 2).toBeLessThanOrEqual(parentEnd);
        }
        expect(sections.map(({ lanes }) => lanes)).toEqual(expectedLaneOrder);
        expect(sections.every(({ kind, parent: source }) => (
          kind === "barrier" && source === parent
        ))).toBe(true);
      }
    }
  });

  it("falls back to the parent contact when an offset barrier lacks authored geometry", () => {
    const parent: TrackObstacle = {
      id: "contact-fixture",
      kind: "barrier",
      distance: 100,
      length: 10,
      moduleId: "barrier-offset",
      lanes: [0, 1],
    };

    expect(resolveObstacleContacts(parent)).toEqual([{
      key: parent.id,
      parent,
      kind: "barrier",
      distance: 100,
      length: 10,
      lanes: [0, 1],
    }]);
  });

  it("returns frozen deterministic sections with stable keys without mutating or freezing the parent", () => {
    const parent = obstacle({
      id: "stable-row",
      kind: "bump",
      moduleId: "bump-row",
      lanes: [2, 3],
      length: 12,
      rotation: 180,
      height: 2,
    });
    const before = structuredClone(parent);

    const first = resolveObstacleContacts(parent);
    const second = resolveObstacleContacts(parent);

    expect(first).toEqual(second);
    expect(first.map(({ key }) => key)).toEqual([
      "stable-row:section-1",
      "stable-row:section-2",
      "stable-row:section-3",
      "stable-row:section-4",
    ]);
    expect(Object.isFrozen(first)).toBe(true);
    expect(first.every((section) => Object.isFrozen(section) && Object.isFrozen(section.lanes))).toBe(true);
    expect(first[0]?.lanes).not.toBe(parent.lanes);
    expect(parent).toEqual(before);
    expect(Object.isFrozen(parent)).toBe(false);
  });
});

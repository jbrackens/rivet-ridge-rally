import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  FROZEN_DENSITY_DEFAULTS,
  FROZEN_READINESS,
  FROZEN_SCENE_INVENTORY,
  RACE_CANVAS_LABEL,
  frozenSceneContract,
} from "./lib/frozen-scene-inventory.mjs";

/**
 * The gate and the capture harness must agree about what scene a signed frame
 * was taken in.
 *
 * `e2e/visual-regression.spec.ts` asserted 41 canvas attributes;
 * `scripts/capture-baseline-candidates.mjs` — which produces the PNGs an owner
 * reviews and `promote-visual-baseline.mjs` copies into the spec's snapshot
 * directory — waited on four. These assertions exist so the two cannot drift
 * apart again by hand-editing one of them.
 */

const CAPTURE_PATH = new URL("./capture-baseline-candidates.mjs", import.meta.url);
const SPEC_PATH = new URL("../e2e/visual-regression.spec.ts", import.meta.url);

test("the contract covers the full authored scene, not just readiness", () => {
  assert.equal(FROZEN_READINESS.length, 4);
  assert.equal(frozenSceneContract().length, 37);
  assert.equal(FROZEN_READINESS.length + frozenSceneContract().length, 41);
});

test("every entry is a frozen attribute/value string pair", () => {
  for (const entry of [...FROZEN_READINESS, ...frozenSceneContract()]) {
    assert.equal(entry.length, 2, `${entry[0]} must be a pair`);
    assert.equal(typeof entry[0], "string");
    assert.equal(typeof entry[1], "string");
    assert.ok(entry[0].startsWith("data-"), `${entry[0]} must be a data attribute`);
    assert.ok(Object.isFrozen(entry), `${entry[0]} must be frozen`);
  }
});

test("no attribute is declared twice", () => {
  const names = [...FROZEN_READINESS, ...frozenSceneContract()].map(([name]) => name);
  assert.deepEqual(names, [...new Set(names)]);
});

test("readiness and inventory are disjoint", () => {
  const readiness = new Set(FROZEN_READINESS.map(([name]) => name));
  for (const [name] of FROZEN_SCENE_INVENTORY) {
    assert.ok(!readiness.has(name), `${name} is both a readiness gate and inventory`);
  }
});

test("the three density counts are overridable and default as shipped", () => {
  const shipped = new Map(frozenSceneContract());
  assert.equal(shipped.get("data-festival-pocket-count"), FROZEN_DENSITY_DEFAULTS.festivalPocketCount);
  assert.equal(shipped.get("data-festival-pocket-tier-count"), FROZEN_DENSITY_DEFAULTS.festivalPocketTierCount);
  assert.equal(shipped.get("data-course-edge-safety-block-count"), FROZEN_DENSITY_DEFAULTS.courseEdgeSafetyBlockCount);

  const denser = new Map(frozenSceneContract({ festivalPocketCount: "30" }));
  assert.equal(denser.get("data-festival-pocket-count"), "30");
  // An override must not disturb the rest of the table.
  assert.equal(denser.get("data-canyon-route-crowd-spectator-count"), "198");
});

test("both consumers read the shared table rather than their own copy", async () => {
  const [capture, spec] = await Promise.all([
    readFile(CAPTURE_PATH, "utf8"),
    readFile(SPEC_PATH, "utf8"),
  ]);

  for (const [label, source] of [["capture harness", capture], ["visual gate", spec]]) {
    assert.match(source, /frozen-scene-inventory\.mjs/, `${label} must import the shared table`);
    assert.match(source, /FROZEN_READINESS/, `${label} must wait on the readiness gates`);
    assert.match(source, /frozenSceneContract\(/, `${label} must wait on the scene contract`);
  }

  // The failure this whole file exists to prevent: a literal inventory list
  // re-appearing in either consumer.
  for (const [label, source] of [["capture harness", capture], ["visual gate", spec]]) {
    const literals = source.match(/"data-canyon-route-crowd-spectator-count"/g) ?? [];
    assert.equal(literals.length, 0, `${label} re-declares a scene attribute inline`);
  }
});

test("the canvas label is shared rather than respelled", async () => {
  const capture = await readFile(CAPTURE_PATH, "utf8");
  assert.equal(RACE_CANVAS_LABEL, "Live 3D race on Canyon Kickoff");
  assert.equal(
    (capture.match(/const RACE_CANVAS_LABEL\s*=/g) ?? []).length,
    0,
    "the capture harness must import the label, not redeclare it",
  );
});

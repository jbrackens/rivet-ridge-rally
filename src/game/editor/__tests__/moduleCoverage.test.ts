import { describe, expect, it } from "vitest";

import { EDITOR_MODULE_BY_ID } from "../modules";
import { obstacleKind, trackPieceKind } from "../toTrackDefinition";

/**
 * Every editor module must convert into something a race can contain.
 *
 * `customTrackToDefinition` classifies each placed module three ways: a track
 * piece, an obstacle, or one of the three race gates. A module matching none of
 * them hits `if (!kind) continue;` and is **dropped in silence** — no throw, no
 * warning, no validation error. The author places it, the editor draws it, the
 * validator accepts it, the track saves, and it is simply not there on the ride.
 *
 * That is a failure with no symptom, which is the kind worth a test rather than
 * a comment. This asserts the mapping is total, so adding a module without also
 * classifying it fails the build instead of shipping a piece of scenery that
 * exists everywhere except in the race.
 */

/** Placed by the author, consumed as race gates rather than as course content. */
const GATE_MODULE_IDS = new Set(["start-grid", "checkpoint", "finish-arch"]);

describe("editor module coverage", () => {
  const moduleIds = [...EDITOR_MODULE_BY_ID.keys()].sort();

  it("classifies every editor module as a gate, a track piece, or an obstacle", () => {
    const unclassified = moduleIds.filter((moduleId) => (
      !GATE_MODULE_IDS.has(moduleId)
      && trackPieceKind(moduleId) === null
      && obstacleKind(moduleId) === null
    ));

    expect(unclassified).toEqual([]);
  });

  it("classifies each module exactly one way", () => {
    const ambiguous = moduleIds.filter((moduleId) => {
      const claims = [
        GATE_MODULE_IDS.has(moduleId),
        trackPieceKind(moduleId) !== null,
        obstacleKind(moduleId) !== null,
      ].filter(Boolean).length;
      return claims > 1;
    });

    expect(ambiguous).toEqual([]);
  });

  it("still refuses an id no module declares", () => {
    // The classifiers are prefix-matched in places, so this guards the reverse
    // failure: a mapping broad enough to swallow anything would make the
    // coverage assertion above pass without meaning.
    expect(obstacleKind("not-a-module")).toBeNull();
    expect(trackPieceKind("not-a-module")).toBeNull();
  });

  it("covers the module library the editor actually ships", () => {
    // A floor rather than an exact count: a new module should not have to edit
    // this line, but a library that silently emptied should fail here.
    expect(moduleIds.length).toBeGreaterThanOrEqual(25);
  });
});

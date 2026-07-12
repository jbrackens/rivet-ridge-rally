import type { CustomTrackData, CustomTrackModule } from "../persistence/database";

function placement(moduleId: string, lane: 0 | 1 | 2 | 3, gridPosition: number): CustomTrackModule {
  return { id: `${moduleId}-${lane}-${gridPosition}`, moduleId, lane, gridPosition, rotation: 0, height: 0 };
}

const createdAt = 1_735_689_600_000;

export const EXAMPLE_TRACKS: readonly CustomTrackData[] = [
  {
    schemaVersion: 1,
    id: "example-cooling-canyon",
    name: "Cooling Canyon",
    laps: 2,
    difficultyEstimate: 2,
    createdAt,
    updatedAt: createdAt,
    modules: [
      placement("start-grid", 0, 0), placement("bump-row", 0, 18), placement("mud-wide", 2, 32),
      placement("checkpoint", 0, 48), placement("ramp-medium", 1, 60), placement("cooling-wide", 2, 78),
      placement("barrier-offset", 0, 96), placement("checkpoint", 0, 112), placement("jump-double", 1, 126),
      placement("finish-arch", 0, 148),
    ],
  },
  {
    schemaVersion: 1,
    id: "example-pine-rhythm",
    name: "Pine Rhythm",
    laps: 3,
    difficultyEstimate: 3,
    createdAt,
    updatedAt: createdAt,
    modules: [
      placement("start-grid", 0, 0), placement("bump-row", 0, 20), placement("checkpoint", 0, 42),
      placement("jump-chain", 1, 56), placement("barrier-offset", 0, 82), placement("cooling-single", 3, 98),
      placement("checkpoint", 0, 114), placement("ramp-large", 0, 132), placement("mud-wide", 2, 154),
      placement("finish-arch", 0, 176),
    ],
  },
  {
    schemaVersion: 1,
    id: "example-skyline-workshop",
    name: "Skyline Workshop",
    laps: 1,
    difficultyEstimate: 5,
    createdAt,
    updatedAt: createdAt,
    modules: [
      placement("start-grid", 0, 0), placement("ramp-tabletop", 0, 24), placement("checkpoint", 0, 52),
      placement("mud-wide", 0, 68), placement("cooling-wide", 2, 86), placement("jump-chain", 0, 104),
      placement("checkpoint", 0, 138), placement("barrier-offset", 1, 154), placement("sky-kicker", 0, 178),
      placement("finish-arch", 0, 220),
    ],
  },
] as const;

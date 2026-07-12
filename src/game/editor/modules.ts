export type EditorModuleCategory = "track" | "jumps" | "terrain" | "hazards" | "race";

export interface EditorModuleDefinition {
  readonly id: string;
  readonly name: string;
  readonly category: EditorModuleCategory;
  readonly length: number;
  readonly laneSpan: 1 | 2 | 3 | 4;
  readonly difficulty: number;
  readonly description: string;
}

export const EDITOR_MODULES: readonly EditorModuleDefinition[] = [
  { id: "straight-short", name: "Short Straight", category: "track", length: 20, laneSpan: 4, difficulty: 0, description: "Compact four-lane dirt segment." },
  { id: "straight-long", name: "Long Straight", category: "track", length: 40, laneSpan: 4, difficulty: 0, description: "Full-speed four-lane dirt segment." },
  { id: "curve-left", name: "Left Bend", category: "track", length: 36, laneSpan: 4, difficulty: 1, description: "Readable banked left curve." },
  { id: "curve-right", name: "Right Bend", category: "track", length: 36, laneSpan: 4, difficulty: 1, description: "Readable banked right curve." },
  { id: "bank-left", name: "Left Bank", category: "track", length: 32, laneSpan: 4, difficulty: 1, description: "Raised outside edge rewards a clean line." },
  { id: "bank-right", name: "Right Bank", category: "track", length: 32, laneSpan: 4, difficulty: 1, description: "Mirrored raised-edge curve." },
  { id: "ramp-small", name: "Small Ramp", category: "jumps", length: 12, laneSpan: 1, difficulty: 1, description: "Friendly first jump." },
  { id: "ramp-medium", name: "Medium Ramp", category: "jumps", length: 16, laneSpan: 1, difficulty: 2, description: "Versatile tactical ramp." },
  { id: "ramp-large", name: "Large Ramp", category: "jumps", length: 22, laneSpan: 2, difficulty: 3, description: "Long flight with a visible landing." },
  { id: "ramp-tabletop", name: "Tabletop", category: "jumps", length: 28, laneSpan: 2, difficulty: 2, description: "Broad top supports safe progression." },
  { id: "jump-double", name: "Double Jump", category: "jumps", length: 34, laneSpan: 2, difficulty: 3, description: "Commit to clear the center gap." },
  { id: "jump-chain", name: "Jump Chain", category: "jumps", length: 44, laneSpan: 2, difficulty: 4, description: "Three linked rhythm ramps." },
  { id: "sky-kicker", name: "Sky Kicker", category: "jumps", length: 38, laneSpan: 2, difficulty: 5, description: "High-risk festival super jump." },
  { id: "bump-single", name: "Trail Bump", category: "terrain", length: 8, laneSpan: 1, difficulty: 1, description: "Wheelie-friendly dirt mound." },
  { id: "bump-row", name: "Bump Row", category: "terrain", length: 24, laneSpan: 2, difficulty: 2, description: "A rhythmic set of small mounds." },
  { id: "mud-short", name: "Mud Patch", category: "terrain", length: 18, laneSpan: 1, difficulty: 1, description: "Slows riders who choose this lane." },
  { id: "mud-wide", name: "Wide Mud", category: "terrain", length: 26, laneSpan: 2, difficulty: 2, description: "Forces an early lane decision." },
  { id: "grass-cut", name: "Grass Edge", category: "terrain", length: 30, laneSpan: 1, difficulty: 1, description: "Soft boundary with a fair slowdown." },
  { id: "barrier-short", name: "Short Barrier", category: "hazards", length: 8, laneSpan: 1, difficulty: 2, description: "Hard lane blocker with clear markings." },
  { id: "barrier-offset", name: "Offset Barriers", category: "hazards", length: 26, laneSpan: 2, difficulty: 3, description: "Creates a readable slalom." },
  { id: "cooling-single", name: "Cooling Gate", category: "hazards", length: 10, laneSpan: 1, difficulty: 0, description: "Instantly sheds heat in one lane." },
  { id: "cooling-wide", name: "Wide Cooling Gate", category: "hazards", length: 10, laneSpan: 2, difficulty: 0, description: "A forgiving cooling opportunity." },
  { id: "start-grid", name: "Start Grid", category: "race", length: 18, laneSpan: 4, difficulty: 0, description: "Required start checkpoint." },
  { id: "checkpoint", name: "Checkpoint", category: "race", length: 6, laneSpan: 4, difficulty: 0, description: "Orders route validation and race progress." },
  { id: "finish-arch", name: "Finish Arch", category: "race", length: 12, laneSpan: 4, difficulty: 0, description: "Required final checkpoint." },
] as const;

export const EDITOR_MODULE_BY_ID = new Map(EDITOR_MODULES.map((module) => [module.id, module]));

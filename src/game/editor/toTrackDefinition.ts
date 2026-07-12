import {
  getTrack,
  type AuthoredPlacementTransform,
  type AuthoredRaceGate,
  type AuthoredTrackPiece,
  type AuthoredTrackPieceKind,
  type LaneIndex,
  type ObstacleKind,
  type TrackDefinition,
  type TrackObstacle,
} from "../content/tracks";
import type { CustomTrackData, CustomTrackModule } from "../persistence/database";
import { EDITOR_MODULE_BY_ID } from "./modules";

function obstacleKind(moduleId: string): ObstacleKind | null {
  if (moduleId === "ramp-small") return "small-ramp";
  if (["ramp-medium", "ramp-tabletop", "jump-double"].includes(moduleId)) return "medium-ramp";
  if (moduleId === "ramp-large") return "large-ramp";
  if (moduleId === "jump-chain") return "jump-chain";
  if (moduleId === "sky-kicker") return "super-jump";
  if (moduleId.startsWith("mud-")) return "mud";
  if (moduleId === "grass-cut") return "grass";
  if (moduleId.startsWith("cooling-")) return "cooling-gate";
  if (moduleId.startsWith("barrier-")) return "barrier";
  if (moduleId.startsWith("bump-")) return "bump";
  return null;
}

function trackPieceKind(moduleId: string): AuthoredTrackPieceKind | null {
  if (moduleId.startsWith("straight-")) return "straight";
  if (moduleId === "curve-left" || moduleId === "curve-right") return moduleId;
  if (moduleId === "bank-left" || moduleId === "bank-right") return moduleId;
  return null;
}

const LANE_CENTERS = [-4.5, -1.5, 1.5, 4.5] as const;

function rampImpulse(moduleId: string): number | undefined {
  if (moduleId === "ramp-small") return 6.4;
  if (moduleId === "ramp-medium") return 8.1;
  if (moduleId === "ramp-large") return 9.5;
  if (moduleId === "ramp-tabletop") return 7.6;
  if (moduleId === "jump-double") return 8.8;
  if (moduleId === "jump-chain") return 7.4;
  if (moduleId === "sky-kicker") return 11.2;
  return undefined;
}

function placementTransform(
  module: CustomTrackModule,
  startGridPosition: number,
): AuthoredPlacementTransform {
  const definition = EDITOR_MODULE_BY_ID.get(module.moduleId);
  if (!definition) throw new Error(`Unsupported editor module: ${module.moduleId}`);

  // Keep runtime placement/collision dimensions identical to the editor preview
  // and validator. A quarter-turn swaps the across-route and route extents.
  const baseWidth = Math.max(2.45, definition.laneSpan * 2.75);
  const baseLength = Math.max(2, definition.length * 0.22);
  const sideways = module.rotation === 90 || module.rotation === 270;
  const width = sideways ? baseLength : baseWidth;
  const length = sideways ? baseWidth : baseLength;
  const lateralPosition = LANE_CENTERS[module.lane] + (definition.laneSpan - 1) * 1.5;
  const minimumX = lateralPosition - width / 2;
  const maximumX = lateralPosition + width / 2;
  const lanes = LANE_CENTERS.flatMap((center, lane) => (
    center >= minimumX && center <= maximumX ? [lane as LaneIndex] : []
  ));

  return {
    id: module.id,
    moduleId: module.moduleId,
    distance: module.gridPosition - startGridPosition,
    sourceGridPosition: module.gridPosition,
    lanes: lanes.length > 0 ? lanes : [module.lane],
    lateralPosition,
    unrotatedWidth: baseWidth,
    unrotatedLength: baseLength,
    width,
    length,
    rotation: module.rotation,
    height: module.height,
  };
}

export function customTrackToDefinition(customTrack: CustomTrackData): TrackDefinition {
  const visualBase = getTrack("canyon-kickoff");
  const start = customTrack.modules.find((module) => module.moduleId === "start-grid");
  const finish = customTrack.modules.find((module) => module.moduleId === "finish-arch");
  const checkpoints = customTrack.modules
    .filter((module) => module.moduleId === "checkpoint")
    .sort((first, second) => first.gridPosition - second.gridPosition);
  if (!start || !finish || checkpoints.length === 0) {
    throw new Error("A custom race requires one start, one finish, and at least one checkpoint.");
  }

  const courseLength = finish.gridPosition - start.gridPosition;
  const obstacles: TrackObstacle[] = [];
  const trackPieces: AuthoredTrackPiece[] = [];

  for (const module of customTrack.modules) {
    const transform = placementTransform(module, start.gridPosition);
    const pieceKind = trackPieceKind(module.moduleId);
    if (pieceKind) {
      trackPieces.push({ ...transform, kind: pieceKind });
      continue;
    }
    const kind = obstacleKind(module.moduleId);
    if (!kind) continue;
    const definition = EDITOR_MODULE_BY_ID.get(module.moduleId);
    const impulse = rampImpulse(module.moduleId);
    obstacles.push({
      ...transform,
      kind,
      moduleId: module.moduleId,
      intensity: Math.min(1, (definition?.difficulty ?? 1) / 5),
      ...(impulse === undefined ? {} : { rampImpulse: impulse }),
    });
  }

  const gate = (
    module: CustomTrackModule,
    kind: AuthoredRaceGate["kind"],
    order: number,
  ): AuthoredRaceGate => ({
    ...placementTransform(module, start.gridPosition),
    kind,
    order,
  });

  return {
    ...visualBase,
    name: customTrack.name,
    tagline: "Built locally. Tested instantly.",
    theme: "Custom workshop course",
    skillFocus: `Editor difficulty ${customTrack.difficultyEstimate} / 5`,
    courseLength,
    soloTargetMs: Math.round((courseLength / 12.5) * customTrack.laps * 1_000),
    parTimeMs: Math.round((courseLength / 14.5) * customTrack.laps * 1_000),
    obstacles: obstacles.sort((first, second) => first.distance - second.distance),
    authoredCourse: {
      start: gate(start, "start", 0),
      checkpoints: checkpoints.map((checkpoint, index) => gate(checkpoint, "checkpoint", index + 1)),
      finish: gate(finish, "finish", checkpoints.length + 1),
      trackPieces: trackPieces.sort((first, second) => first.distance - second.distance),
    },
  };
}

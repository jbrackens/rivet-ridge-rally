import {
  getTrack,
  type AuthoredCenterlineAnchor,
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
import { validateCustomTrackRouteShape } from "./validation";

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
export const CUSTOM_TRACK_PRESENTATION_FALLBACK_LENGTH = 240;

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
  const starts = customTrack.modules.filter((module) => module.moduleId === "start-grid");
  const finishes = customTrack.modules.filter((module) => module.moduleId === "finish-arch");
  const start = starts[0];
  const finish = finishes[0];
  const checkpoints = customTrack.modules
    .filter((module) => module.moduleId === "checkpoint")
    .sort((first, second) => first.gridPosition - second.gridPosition);
  if (starts.length !== 1 || finishes.length !== 1 || !start || !finish || checkpoints.length === 0) {
    throw new Error("A custom race requires one start, one finish, and at least one checkpoint.");
  }
  if (customTrack.modules.some((module) => (
    module.routeAnchor !== undefined && module.moduleId !== "checkpoint"
  ))) {
    throw new Error("Only custom race checkpoints may define route anchors.");
  }

  const courseLength = finish.gridPosition - start.gridPosition;
  if (!Number.isFinite(courseLength) || courseLength <= 0) {
    throw new Error("A custom race finish must be after its start.");
  }
  let previousGatePosition = start.gridPosition;
  for (const checkpoint of checkpoints) {
    const routeAnchor = checkpoint.routeAnchor;
    if (!Number.isFinite(checkpoint.gridPosition)
      || checkpoint.gridPosition <= previousGatePosition
      || checkpoint.gridPosition >= finish.gridPosition
      || (routeAnchor !== undefined && (
        !Number.isFinite(routeAnchor.lateralOffset)
        || !Number.isFinite(routeAnchor.elevation)
      ))) {
      throw new Error("Custom race checkpoints must be uniquely ordered between start and finish.");
    }
    previousGatePosition = checkpoint.gridPosition;
  }
  const routeValidation = validateCustomTrackRouteShape(customTrack);
  if (!routeValidation.valid) {
    throw new Error(routeValidation.errors[0] ?? "Custom race route shaping is invalid.");
  }
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
  const centerline: AuthoredCenterlineAnchor[] = [
    { distance: 0, lateralOffset: 0, elevation: 0 },
    ...checkpoints.map((checkpoint) => ({
      distance: checkpoint.gridPosition - start.gridPosition,
      lateralOffset: checkpoint.routeAnchor?.lateralOffset ?? 0,
      elevation: checkpoint.routeAnchor?.elevation ?? 0,
    })),
    { distance: courseLength, lateralOffset: 0, elevation: 0 },
  ];

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
      centerline,
      trackPieces: trackPieces.sort((first, second) => first.distance - second.distance),
    },
  };
}

/**
 * Builds a renderer-only route definition for an in-progress editor draft.
 * Unlike the strict race conversion, this helper never throws: incomplete or
 * malformed drafts resolve to an authored all-zero centerline over a safe span.
 */
export function customTrackToPresentationDefinition(
  customTrack: CustomTrackData,
  fallbackLength = CUSTOM_TRACK_PRESENTATION_FALLBACK_LENGTH,
): TrackDefinition {
  try {
    return customTrackToDefinition(customTrack);
  } catch {
    const visualBase = getTrack("canyon-kickoff");
    const courseLength = Number.isFinite(fallbackLength) && fallbackLength > 0
      ? fallbackLength
      : CUSTOM_TRACK_PRESENTATION_FALLBACK_LENGTH;
    const fallbackGate = (
      kind: AuthoredRaceGate["kind"],
      distance: number,
      order: number,
    ): AuthoredRaceGate => ({
      id: `editor-preview-${kind}`,
      moduleId: kind === "start"
        ? "start-grid"
        : kind === "finish" ? "finish-arch" : "checkpoint",
      distance,
      sourceGridPosition: distance,
      lanes: [0, 1, 2, 3],
      lateralPosition: 0,
      unrotatedWidth: 13.3,
      unrotatedLength: 2,
      width: 13.3,
      length: 2,
      rotation: 0,
      height: 0,
      kind,
      order,
    });
    return {
      ...visualBase,
      courseLength,
      obstacles: [],
      authoredCourse: {
        start: fallbackGate("start", 0, 0),
        checkpoints: [fallbackGate("checkpoint", courseLength / 2, 1)],
        finish: fallbackGate("finish", courseLength, 2),
        centerline: [
          { distance: 0, lateralOffset: 0, elevation: 0 },
          { distance: courseLength / 2, lateralOffset: 0, elevation: 0 },
          { distance: courseLength, lateralOffset: 0, elevation: 0 },
        ],
        trackPieces: [],
      },
    };
  }
}

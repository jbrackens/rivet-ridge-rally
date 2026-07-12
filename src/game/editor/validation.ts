import { EDITOR_MODULE_BY_ID, type EditorModuleDefinition } from "./modules";
import type { CustomTrackData, CustomTrackModule } from "../persistence/database";

export interface TrackValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

interface CollisionFootprint {
  module: CustomTrackModule;
  definition: EditorModuleDefinition;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  minRoute: number;
  maxRoute: number;
}

const LANE_CENTERS = [-4.5, -1.5, 1.5, 4.5] as const;
const TRACK_HALF_WIDTH = 6;
const ROUTE_LIMIT = 20_000;
const OVERLAP_EPSILON = 0.01;

function sortedModules(modules: CustomTrackModule[]): CustomTrackModule[] {
  return [...modules].sort((a, b) => a.gridPosition - b.gridPosition);
}

function isRotation(value: number): value is CustomTrackModule["rotation"] {
  return value === 0 || value === 90 || value === 180 || value === 270;
}

function collisionFootprint(
  module: CustomTrackModule,
  definition: EditorModuleDefinition,
): CollisionFootprint {
  // These dimensions mirror the conservative boxes shown by EditorScene.
  // Rotating a placement swaps its across-lane and along-route extents.
  const baseWidth = Math.max(2.45, definition.laneSpan * 2.75);
  const baseLength = Math.max(2, definition.length * 0.22);
  const sideways = module.rotation === 90 || module.rotation === 270;
  const width = sideways ? baseLength : baseWidth;
  const routeLength = sideways ? baseWidth : baseLength;
  const centerX = LANE_CENTERS[module.lane] + (definition.laneSpan - 1) * 1.5;
  const height = 0.25 + definition.difficulty * 0.12;
  const centerY = module.height + 0.2;

  return {
    module,
    definition,
    minX: centerX - width / 2,
    maxX: centerX + width / 2,
    minY: centerY - height / 2,
    maxY: centerY + height / 2,
    minRoute: module.gridPosition - routeLength / 2,
    maxRoute: module.gridPosition + routeLength / 2,
  };
}

function intervalsOverlap(
  firstMin: number,
  firstMax: number,
  secondMin: number,
  secondMax: number,
): boolean {
  return Math.min(firstMax, secondMax) - Math.max(firstMin, secondMin) > OVERLAP_EPSILON;
}

function footprintsOverlap(first: CollisionFootprint, second: CollisionFootprint): boolean {
  return intervalsOverlap(first.minX, first.maxX, second.minX, second.maxX)
    && intervalsOverlap(first.minY, first.maxY, second.minY, second.maxY)
    && intervalsOverlap(first.minRoute, first.maxRoute, second.minRoute, second.maxRoute);
}

export function validateCustomTrack(track: CustomTrackData): TrackValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!Number.isInteger(track.laps) || track.laps < 1 || track.laps > 9) {
    errors.push("Choose a whole-number lap count from 1 through 9.");
  }
  if (!Number.isInteger(track.difficultyEstimate) || track.difficultyEstimate < 1 || track.difficultyEstimate > 5) {
    errors.push("Declare a whole-number difficulty estimate from 1 through 5.");
  }

  const starts = track.modules.filter((module) => module.moduleId === "start-grid");
  const finishes = track.modules.filter((module) => module.moduleId === "finish-arch");
  const checkpoints = sortedModules(track.modules.filter((module) => module.moduleId === "checkpoint"));

  if (starts.length !== 1) errors.push("Place exactly one Start Grid.");
  if (finishes.length !== 1) errors.push("Place exactly one Finish Arch.");
  if (checkpoints.length < 1) errors.push("Place at least one checkpoint between start and finish.");

  const start = starts[0];
  const finish = finishes[0];
  if (start && finish) {
    if (start.gridPosition >= finish.gridPosition) errors.push("The finish must come after the start.");
    if (checkpoints.some((checkpoint) => checkpoint.gridPosition <= start.gridPosition || checkpoint.gridPosition >= finish.gridPosition)) {
      errors.push("Every checkpoint must be ordered between the start and finish.");
    }
    if (checkpoints.some((checkpoint, index) => index > 0 && checkpoint.gridPosition === checkpoints[index - 1]?.gridPosition)) {
      errors.push("Checkpoints must use distinct route positions. Move the duplicate checkpoint forward or back.");
    }

    const routeMarkers = [start, ...checkpoints, finish].sort((a, b) => a.gridPosition - b.gridPosition);
    for (let index = 1; index < routeMarkers.length; index += 1) {
      const previous = routeMarkers[index - 1];
      const current = routeMarkers[index];
      if (previous && current && current.gridPosition - previous.gridPosition > 160) {
        errors.push(`Route gap from ${previous.moduleId} to ${current.moduleId} is too large to validate.`);
        break;
      }
    }
  }

  const seenIds = new Set<string>();
  const collisionFootprints: CollisionFootprint[] = [];
  for (const module of track.modules) {
    const definition = EDITOR_MODULE_BY_ID.get(module.moduleId);
    if (!definition) {
      errors.push(`Module “${module.moduleId}” is not supported by this version.`);
      continue;
    }

    if (seenIds.has(module.id)) {
      errors.push(`Module id “${module.id}” is duplicated. Delete or duplicate the affected placement again.`);
    }
    seenIds.add(module.id);

    const laneValid = Number.isInteger(module.lane) && module.lane >= 0 && module.lane <= 3;
    const routeValid = Number.isInteger(module.gridPosition) && module.gridPosition >= 0 && module.gridPosition <= ROUTE_LIMIT;
    const rotationValid = isRotation(module.rotation);
    const heightValid = Number.isFinite(module.height) && module.height >= -4 && module.height <= 40;
    if (!laneValid || !routeValid || !rotationValid || !heightValid) {
      errors.push(`${definition.name} (${module.id}) has invalid collision bounds. Use lanes 1–4, whole route positions from 0–${ROUTE_LIMIT} m, rotations of 0/90/180/270, and heights from -4 through 40.`);
      continue;
    }

    if (module.lane + definition.laneSpan > 4) {
      errors.push(`${definition.name} (${module.id}) has invalid collision bounds: its ${definition.laneSpan}-lane span leaves the four-lane track. Move it inward.`);
      continue;
    }

    const footprint = collisionFootprint(module, definition);
    if (footprint.minX < -TRACK_HALF_WIDTH || footprint.maxX > TRACK_HALF_WIDTH) {
      errors.push(`${definition.name} (${module.id}) has invalid collision bounds after rotation. Move it inward or change its rotation.`);
      continue;
    }
    if (definition.category !== "race" && (footprint.minRoute < 0 || footprint.maxRoute > ROUTE_LIMIT)) {
      errors.push(`${definition.name} (${module.id}) has invalid collision bounds outside the route. Move it farther inside the course.`);
      continue;
    }

    if (start && finish && definition.category !== "race"
      && (module.gridPosition <= start.gridPosition || module.gridPosition >= finish.gridPosition)) {
      errors.push(`${definition.name} (${module.id}) sits outside the start-to-finish route. Move it between the route markers.`);
    }

    // Start, checkpoint, and finish markers are non-solid triggers and may
    // intentionally occupy the same interval as a surface or obstacle.
    if (definition.category !== "race") collisionFootprints.push(footprint);
  }

  for (let index = 0; index < collisionFootprints.length; index += 1) {
    const current = collisionFootprints[index];
    if (!current) continue;
    for (let previousIndex = 0; previousIndex < index; previousIndex += 1) {
      const previous = collisionFootprints[previousIndex];
      if (!previous || !footprintsOverlap(current, previous)) continue;
      const nearPosition = Math.round((current.module.gridPosition + previous.module.gridPosition) / 2);
      errors.push(`${current.definition.name} (${current.module.id}) overlaps ${previous.definition.name} (${previous.module.id}) near ${nearPosition} m. Move one module to another lane, position, rotation, or height.`);
    }
  }

  if (track.modules.length > 160) warnings.push("Large track: test mobile performance before sharing the file.");
  if (!track.modules.some((module) => module.moduleId.startsWith("cooling-"))) warnings.push("No cooling gate is present; turbo routes may be punishing.");
  if (track.difficultyEstimate >= 4 && !track.modules.some((module) => module.moduleId === "sky-kicker")) warnings.push("High difficulty is declared without a mastery jump.");

  return { valid: errors.length === 0, errors: [...new Set(errors)], warnings: [...new Set(warnings)] };
}

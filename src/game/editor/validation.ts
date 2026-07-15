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
export const CUSTOM_TRACK_ROUTE_LIMIT = 20_000;
export const CUSTOM_TRACK_NAME_MAX_CHARS = 42;
export const CUSTOM_TRACK_MODULE_LIMIT = 500;
export const CUSTOM_TRACK_ROUTE_LATERAL_LIMIT = 16;
export const CUSTOM_TRACK_ROUTE_ELEVATION_LIMIT = 12;
export const CUSTOM_TRACK_ROUTE_MAX_YAW_DEGREES = 12;
export const CUSTOM_TRACK_ROUTE_MAX_GRADE_DEGREES = 9.5;
export const CUSTOM_TRACK_ROUTE_MIN_RADIUS = 24;
const OVERLAP_EPSILON = 0.01;
const QUINTIC_MAX_DERIVATIVE = 1.875;
const QUINTIC_MAX_SECOND_DERIVATIVE = 10 / Math.sqrt(3);
const MAX_ROUTE_YAW_RADIANS = CUSTOM_TRACK_ROUTE_MAX_YAW_DEGREES * Math.PI / 180;
const MAX_ELEVATION_DERIVATIVE = Math.sin(
  CUSTOM_TRACK_ROUTE_MAX_GRADE_DEGREES * Math.PI / 180,
);
const MAX_ROUTE_CURVATURE = 1 / CUSTOM_TRACK_ROUTE_MIN_RADIUS;

export interface PlacementValidationResult {
  valid: boolean;
  errors: string[];
}

interface RouteAnchor {
  readonly lateralOffset: number;
  readonly elevation: number;
}

function routeAnchor(module: CustomTrackModule): RouteAnchor {
  const anchored = module as CustomTrackModule & { readonly routeAnchor?: RouteAnchor };
  return anchored.routeAnchor ?? { lateralOffset: 0, elevation: 0 };
}

function routeAnchorError(module: CustomTrackModule): string | null {
  const anchored = module as CustomTrackModule & { readonly routeAnchor?: RouteAnchor };
  const anchor = anchored.routeAnchor;
  if (anchor === undefined) return null;
  if (module.moduleId !== "checkpoint") {
    return `${module.moduleId} (${module.id}) cannot shape the route. Route turn and rise belong only to checkpoints.`;
  }
  if (!Number.isFinite(anchor.lateralOffset)
    || anchor.lateralOffset < -CUSTOM_TRACK_ROUTE_LATERAL_LIMIT
    || anchor.lateralOffset > CUSTOM_TRACK_ROUTE_LATERAL_LIMIT
    || !Number.isFinite(anchor.elevation)
    || anchor.elevation < 0
    || anchor.elevation > CUSTOM_TRACK_ROUTE_ELEVATION_LIMIT) {
    return `Checkpoint (${module.id}) has an invalid route anchor. Keep Route turn within ±${CUSTOM_TRACK_ROUTE_LATERAL_LIMIT} m and Route rise from 0–${CUSTOM_TRACK_ROUTE_ELEVATION_LIMIT} m.`;
  }
  return null;
}

function routeShapeErrors(modules: readonly CustomTrackModule[]): string[] {
  const start = modules.find((module) => module.moduleId === "start-grid");
  const finish = modules.find((module) => module.moduleId === "finish-arch");
  if (!start || !finish || finish.gridPosition <= start.gridPosition) return [];
  const checkpoints = sortedModules(
    modules.filter((module) => module.moduleId === "checkpoint"),
  );
  if (checkpoints.some((checkpoint) => routeAnchorError(checkpoint) !== null)) return [];

  const markers = [start, ...checkpoints, finish].map((module) => ({
    module,
    anchor: module.moduleId === "checkpoint"
      ? routeAnchor(module)
      : { lateralOffset: 0, elevation: 0 },
  }));
  const errors: string[] = [];
  for (let index = 1; index < markers.length; index += 1) {
    const previous = markers[index - 1];
    const current = markers[index];
    if (!previous || !current) continue;
    const distance = current.module.gridPosition - previous.module.gridPosition;
    if (distance <= 0) continue;
    const lateralDelta = Math.abs(
      current.anchor.lateralOffset - previous.anchor.lateralOffset,
    );
    const elevationDelta = Math.abs(
      current.anchor.elevation - previous.anchor.elevation,
    );
    const lateralDerivative = QUINTIC_MAX_DERIVATIVE * lateralDelta / distance;
    const elevationDerivative = QUINTIC_MAX_DERIVATIVE * elevationDelta / distance;
    const combinedDerivativeSquared = lateralDerivative ** 2 + elevationDerivative ** 2;
    const longitudinalDerivative = Math.sqrt(Math.max(0, 1 - combinedDerivativeSquared));
    const yawRadians = Math.atan2(lateralDerivative, longitudinalDerivative);
    const lateralCurvature = QUINTIC_MAX_SECOND_DERIVATIVE * lateralDelta / distance ** 2;
    const elevationCurvature = QUINTIC_MAX_SECOND_DERIVATIVE * elevationDelta / distance ** 2;
    if (yawRadians > MAX_ROUTE_YAW_RADIANS
      || elevationDerivative > MAX_ELEVATION_DERIVATIVE
      || combinedDerivativeSquared >= 1
      || lateralCurvature > MAX_ROUTE_CURVATURE
      || elevationCurvature > MAX_ROUTE_CURVATURE) {
      errors.push(
        `Route segment ${previous.module.id} → ${current.module.id} turns or rises too sharply. Reduce Route turn/rise or move the checkpoints farther apart (max ${CUSTOM_TRACK_ROUTE_MAX_YAW_DEGREES}° turn, ${CUSTOM_TRACK_ROUTE_MAX_GRADE_DEGREES}° grade, ${CUSTOM_TRACK_ROUTE_MIN_RADIUS} m transition radius).`,
      );
    }
  }
  return errors;
}

export function validateCustomTrackRouteShape(
  track: Pick<CustomTrackData, "modules">,
): PlacementValidationResult {
  const errors = track.modules.flatMap((module) => {
    const error = routeAnchorError(module);
    return error ? [error] : [];
  });
  errors.push(...routeShapeErrors(track.modules));
  const uniqueErrors = [...new Set(errors)];
  return { valid: uniqueErrors.length === 0, errors: uniqueErrors };
}

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

function routeFootprintError(
  footprint: CollisionFootprint,
  startGridPosition: number,
  finishGridPosition: number,
): string | null {
  if (footprint.definition.category === "race"
    || (footprint.minRoute > startGridPosition && footprint.maxRoute < finishGridPosition)) {
    return null;
  }
  return `${footprint.definition.name} (${footprint.module.id}) extends outside the start-to-finish route. Move its full footprint between the route markers.`;
}

function legacyRouteCenterError(
  module: CustomTrackModule,
  definition: EditorModuleDefinition,
  startGridPosition: number,
  finishGridPosition: number,
): string | null {
  if (definition.category === "race"
    || (module.gridPosition > startGridPosition && module.gridPosition < finishGridPosition)) {
    return null;
  }
  return `${definition.name} (${module.id}) sits outside the start-to-finish route. Move it between the route markers.`;
}

function placementBoundsError(
  module: CustomTrackModule,
  definition: EditorModuleDefinition,
): string | null {
  const laneValid = Number.isInteger(module.lane) && module.lane >= 0 && module.lane <= 3;
  const routeValid = Number.isInteger(module.gridPosition)
    && module.gridPosition >= 0
    && module.gridPosition <= CUSTOM_TRACK_ROUTE_LIMIT;
  const rotationValid = isRotation(module.rotation);
  const heightValid = Number.isFinite(module.height) && module.height >= -4 && module.height <= 40;
  if (!laneValid || !routeValid || !rotationValid || !heightValid) {
    return `${definition.name} (${module.id}) has invalid collision bounds. Use lanes 1–4, whole route positions from 0–${CUSTOM_TRACK_ROUTE_LIMIT} m, rotations of 0/90/180/270, and heights from -4 through 40.`;
  }

  if (module.lane + definition.laneSpan > 4) {
    return `${definition.name} (${module.id}) has invalid collision bounds: its ${definition.laneSpan}-lane span leaves the four-lane track. Move it inward.`;
  }

  const footprint = collisionFootprint(module, definition);
  if (footprint.minX < -TRACK_HALF_WIDTH || footprint.maxX > TRACK_HALF_WIDTH) {
    return `${definition.name} (${module.id}) has invalid collision bounds after rotation. Move it inward or change its rotation.`;
  }
  if (definition.category !== "race"
    && (footprint.minRoute < 0 || footprint.maxRoute > CUSTOM_TRACK_ROUTE_LIMIT)) {
    return `${definition.name} (${module.id}) has invalid collision bounds outside the route. Move it farther inside the course.`;
  }

  return null;
}

export function validateCustomTrackPlacement(
  track: CustomTrackData,
  module: CustomTrackModule,
): PlacementValidationResult {
  const errors: string[] = [];
  const definition = EDITOR_MODULE_BY_ID.get(module.moduleId);
  if (!definition) {
    return {
      valid: false,
      errors: [`Module “${module.moduleId}” is not supported by this version.`],
    };
  }

  const replacingExisting = track.modules.some((candidate) => candidate.id === module.id);
  if (!replacingExisting && track.modules.length >= CUSTOM_TRACK_MODULE_LIMIT) {
    errors.push(`The track has reached the ${CUSTOM_TRACK_MODULE_LIMIT}-module safety limit.`);
  }

  const boundsError = placementBoundsError(module, definition);
  if (boundsError) errors.push(boundsError);
  const anchorError = routeAnchorError(module);
  if (anchorError) errors.push(anchorError);
  const footprint = !boundsError && definition.category !== "race"
    ? collisionFootprint(module, definition)
    : null;

  const otherModules = track.modules.filter((candidate) => candidate.id !== module.id);
  if (module.moduleId === "start-grid"
    && otherModules.some((candidate) => candidate.moduleId === "start-grid")) {
    errors.push("A Start Grid already exists. Select the existing grid instead.");
  }
  if (module.moduleId === "finish-arch"
    && otherModules.some((candidate) => candidate.moduleId === "finish-arch")) {
    errors.push("A Finish Arch already exists. Select the existing arch instead.");
  }
  if (module.moduleId === "checkpoint"
    && otherModules.some((candidate) => (
      candidate.moduleId === "checkpoint" && candidate.gridPosition === module.gridPosition
    ))) {
    errors.push("A checkpoint already uses this route position. Move the preview forward or back.");
  }

  const routeModules = [...otherModules, module];
  const start = routeModules.find((candidate) => candidate.moduleId === "start-grid");
  const finish = routeModules.find((candidate) => candidate.moduleId === "finish-arch");
  const checkpoints = routeModules.filter((candidate) => candidate.moduleId === "checkpoint");
  if (start && finish) {
    if (start.gridPosition >= finish.gridPosition) {
      errors.push("The finish must come after the start.");
    }
    if (module.moduleId === "checkpoint"
      && (module.gridPosition <= start.gridPosition || module.gridPosition >= finish.gridPosition)) {
      errors.push("Every checkpoint must be ordered between the start and finish.");
    }
    if ((module.moduleId === "start-grid" || module.moduleId === "finish-arch")
      && checkpoints.some((checkpoint) => (
        checkpoint.gridPosition <= start.gridPosition || checkpoint.gridPosition >= finish.gridPosition
      ))) {
      errors.push("Every checkpoint must be ordered between the start and finish.");
    }
    const routeError = footprint
      ? routeFootprintError(footprint, start.gridPosition, finish.gridPosition)
      : null;
    if (routeError) errors.push(routeError);
  }
  errors.push(...routeShapeErrors(routeModules));

  if (footprint) {
    for (const other of otherModules) {
      const otherDefinition = EDITOR_MODULE_BY_ID.get(other.moduleId);
      if (!otherDefinition || otherDefinition.category === "race") continue;
      if (placementBoundsError(other, otherDefinition)) continue;
      if (!footprintsOverlap(footprint, collisionFootprint(other, otherDefinition))) continue;
      const nearPosition = Math.round((module.gridPosition + other.gridPosition) / 2);
      errors.push(`${definition.name} (${module.id}) overlaps ${otherDefinition.name} (${other.id}) near ${nearPosition} m. Move one module to another lane, position, rotation, or height.`);
    }
  }

  const uniqueErrors = [...new Set(errors)];
  return { valid: uniqueErrors.length === 0, errors: uniqueErrors };
}

function validateCustomTrackWithContainment(
  track: CustomTrackData,
  containment: "full-footprint" | "legacy-center",
): TrackValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (typeof track.name !== "string" || track.name.trim().length === 0) {
    errors.push("Enter a track name.");
  } else if (track.name.trim().length > CUSTOM_TRACK_NAME_MAX_CHARS) {
    errors.push(`Keep the track name to ${CUSTOM_TRACK_NAME_MAX_CHARS} characters or fewer.`);
  }
  if (!Number.isInteger(track.laps) || track.laps < 1 || track.laps > 9) {
    errors.push("Choose a whole-number lap count from 1 through 9.");
  }
  if (!Number.isInteger(track.difficultyEstimate) || track.difficultyEstimate < 1 || track.difficultyEstimate > 5) {
    errors.push("Declare a whole-number difficulty estimate from 1 through 5.");
  }
  if (track.modules.length > CUSTOM_TRACK_MODULE_LIMIT) {
    errors.push(`Keep the track to ${CUSTOM_TRACK_MODULE_LIMIT} modules or fewer.`);
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

    const boundsError = placementBoundsError(module, definition);
    if (boundsError) {
      errors.push(boundsError);
      continue;
    }

    const anchorError = routeAnchorError(module);
    if (anchorError) errors.push(anchorError);

    const footprint = collisionFootprint(module, definition);

    const routeError = start && finish
      ? containment === "full-footprint"
        ? routeFootprintError(footprint, start.gridPosition, finish.gridPosition)
        : legacyRouteCenterError(
            module,
            definition,
            start.gridPosition,
            finish.gridPosition,
          )
      : null;
    if (routeError) errors.push(routeError);

    // Start, checkpoint, and finish markers are non-solid triggers and may
    // intentionally occupy the same interval as a surface or obstacle.
    if (definition.category !== "race") collisionFootprints.push(footprint);
  }

  errors.push(...routeShapeErrors(track.modules));

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

export function validateCustomTrack(track: CustomTrackData): TrackValidationResult {
  return validateCustomTrackWithContainment(track, "full-footprint");
}

/**
 * Applies the route-containment rule used by schema-v1 saves. It exists only
 * so a previously accepted local track remains visible and editable after the
 * stricter schema-v2 full-footprint boundary ships. Saving or Test Riding still
 * uses `validateCustomTrack` and therefore requires the current rule.
 */
export function validateLegacyCustomTrack(track: CustomTrackData): TrackValidationResult {
  return validateCustomTrackWithContainment(track, "legacy-center");
}

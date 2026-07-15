import type {
  LaneIndex,
  ObstacleKind,
  TrackObstacle,
  TrackPlacementRotation,
} from "../content/tracks";

const DEFAULT_CONTACT_LENGTH = 8;
const LANE_CENTERS = [-4.5, -1.5, 1.5, 4.5] as const;
const BARRIER_BLOCK_DEPTH = 0.72;
const BARRIER_BLOCK_WIDTH_RATIO = 0.52;
const BARRIER_LATERAL_OFFSET_RATIO = 0.22;
const BARRIER_ROUTE_OFFSET_RATIO = 0.27;
const LANE_INTERSECTION_EPSILON = 1e-9;

export interface ObstacleContactSection {
  readonly key: string;
  readonly parent: TrackObstacle;
  readonly kind: ObstacleKind;
  readonly distance: number;
  readonly length: number;
  readonly lanes: readonly LaneIndex[];
}

interface ContactSectionDraft {
  readonly distance: number;
  readonly length: number;
  readonly lanes: readonly LaneIndex[];
  readonly sourceIndex: number;
}

function resolvedParentLength(obstacle: TrackObstacle): number {
  return obstacle.length !== undefined
    && Number.isFinite(obstacle.length)
    && obstacle.length > 0
    ? obstacle.length
    : DEFAULT_CONTACT_LENGTH;
}

function boundedSectionLength(parentLength: number, requestedLength: number): number {
  return Math.min(
    parentLength,
    Number.isFinite(requestedLength) && requestedLength > 0
      ? requestedLength
      : parentLength,
  );
}

function freezeSections(
  obstacle: TrackObstacle,
  drafts: readonly ContactSectionDraft[],
): readonly ObstacleContactSection[] {
  const ordered = [...drafts].sort((first, second) => (
    first.distance - second.distance || first.sourceIndex - second.sourceIndex
  ));
  const multiple = ordered.length > 1;
  return Object.freeze(ordered.map((draft, index) => Object.freeze({
    key: multiple ? `${obstacle.id}:section-${index + 1}` : obstacle.id,
    parent: obstacle,
    kind: obstacle.kind,
    distance: draft.distance,
    length: draft.length,
    lanes: Object.freeze([...draft.lanes]),
  })));
}

function oneContact(obstacle: TrackObstacle): readonly ObstacleContactSection[] {
  const length = resolvedParentLength(obstacle);
  return freezeSections(obstacle, [{
    distance: obstacle.distance,
    length,
    lanes: obstacle.lanes,
    sourceIndex: 0,
  }]);
}

function splitAlongParent(
  obstacle: TrackObstacle,
  centerRatios: readonly number[],
  lengthRatio: number,
): readonly ObstacleContactSection[] {
  const parentLength = resolvedParentLength(obstacle);
  const sectionLength = boundedSectionLength(parentLength, parentLength * lengthRatio);
  return freezeSections(obstacle, centerRatios.map((centerRatio, sourceIndex) => ({
    distance: obstacle.distance + parentLength * centerRatio,
    length: sectionLength,
    lanes: obstacle.lanes,
    sourceIndex,
  })));
}

function rotateCardinal(
  x: number,
  z: number,
  rotation: TrackPlacementRotation,
): { x: number; z: number } {
  switch (rotation) {
    case 90: return { x: z, z: -x };
    case 180: return { x: -x, z: -z };
    case 270: return { x: -z, z: x };
    default: return { x, z };
  }
}

function lanesIntersectingSpan(center: number, width: number): readonly LaneIndex[] {
  const minimum = center - width / 2 - LANE_INTERSECTION_EPSILON;
  const maximum = center + width / 2 + LANE_INTERSECTION_EPSILON;
  return LANE_CENTERS.flatMap((laneCenter, lane) => (
    laneCenter >= minimum && laneCenter <= maximum ? [lane as LaneIndex] : []
  ));
}

function offsetBarrierContacts(obstacle: TrackObstacle): readonly ObstacleContactSection[] {
  const moduleWidth = obstacle.unrotatedWidth;
  const moduleLength = obstacle.unrotatedLength;
  const lateralCenter = obstacle.lateralPosition;
  if (moduleWidth === undefined
    || moduleLength === undefined
    || lateralCenter === undefined
    || !Number.isFinite(moduleWidth)
    || !Number.isFinite(moduleLength)
    || !Number.isFinite(lateralCenter)
    || moduleWidth <= 0
    || moduleLength <= 0) {
    return oneContact(obstacle);
  }

  const rotation = obstacle.rotation ?? 0;
  const sideways = rotation === 90 || rotation === 270;
  const parentLength = resolvedParentLength(obstacle);
  const localBlockWidth = moduleWidth * BARRIER_BLOCK_WIDTH_RATIO;
  const localBlockDepth = Math.min(BARRIER_BLOCK_DEPTH, moduleLength);
  const worldLateralWidth = sideways ? localBlockDepth : localBlockWidth;
  const worldRouteLength = sideways ? localBlockWidth : localBlockDepth;
  const sectionLength = boundedSectionLength(parentLength, worldRouteLength);
  const localCenters = [
    {
      x: -moduleWidth * BARRIER_LATERAL_OFFSET_RATIO,
      z: -moduleLength * BARRIER_ROUTE_OFFSET_RATIO,
    },
    {
      x: moduleWidth * BARRIER_LATERAL_OFFSET_RATIO,
      z: moduleLength * BARRIER_ROUTE_OFFSET_RATIO,
    },
  ] as const;

  return freezeSections(obstacle, localCenters.map((localCenter, sourceIndex) => {
    const rotated = rotateCardinal(localCenter.x, localCenter.z, rotation);
    return {
      distance: obstacle.distance - rotated.z,
      length: sectionLength,
      lanes: lanesIntersectingSpan(lateralCenter + rotated.x, worldLateralWidth),
      sourceIndex,
    };
  }));
}

/**
 * Expands one visual obstacle into deterministic scalar contact sections.
 * Sections never mutate or extend the saved obstacle shape: their lengths stay
 * inside the parent footprint and their parent reference retains shared policy.
 */
export function resolveObstacleContacts(
  obstacle: TrackObstacle,
): readonly ObstacleContactSection[] {
  const sideways = obstacle.rotation === 90 || obstacle.rotation === 270;
  if (sideways && obstacle.moduleId !== "barrier-offset") {
    return oneContact(obstacle);
  }
  if (obstacle.kind === "jump-chain") {
    return splitAlongParent(obstacle, [-0.31, 0, 0.31], 0.23);
  }
  if (obstacle.moduleId === "jump-double") {
    return splitAlongParent(obstacle, [-0.3, 0.3], 0.32);
  }
  if (obstacle.moduleId === "bump-row") {
    return splitAlongParent(obstacle, [-0.375, -0.125, 0.125, 0.375], 0.25);
  }
  if (obstacle.moduleId === "barrier-offset") {
    return offsetBarrierContacts(obstacle);
  }
  return oneContact(obstacle);
}

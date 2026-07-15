import * as THREE from "three";

import type {
  AuthoredCenterlineAnchor,
  TrackDefinition,
  TrackId,
  TrackObstacle,
} from "../content/tracks";

const DEFAULT_SAMPLE_SPACING = 2;
const LAP_END_STRAIGHT = 30;
const OBSTACLE_MARGIN = 10;
const MIN_BEND_LENGTH = 28;
const DEFAULT_UV_REPEAT_LENGTH = 30;
const PULSE_MAX_DERIVATIVE = (2 * Math.PI) / Math.sqrt(3);
const SMOOTHERSTEP_MAX_DERIVATIVE = 1.875;
const SMOOTHERSTEP_MAX_SECOND_DERIVATIVE = 10 / Math.sqrt(3);
const MAX_AUTHORED_YAW_RADIANS = THREE.MathUtils.degToRad(12);
const MAX_AUTHORED_GRADE_DERIVATIVE = Math.sin(THREE.MathUtils.degToRad(9.5));
const MAX_AUTHORED_SECOND_DERIVATIVE = 1 / 24;
const MAX_AUTHORED_CENTERLINE_ANCHORS = 502;
const AUTHORED_ENDPOINT_EPSILON = 1e-7;

interface CourseProfile {
  readonly maxYawRadians: number;
  readonly maxExcursion: number;
  readonly firstDirection: -1 | 1;
  readonly rhythm: readonly number[];
  readonly maxRise: number;
  readonly maxSlopeRadians: number;
  readonly gradeRhythm: readonly number[];
}

const COURSE_PROFILES = {
  "canyon-kickoff": {
    maxYawRadians: THREE.MathUtils.degToRad(10.5),
    maxExcursion: 10.5,
    firstDirection: -1,
    rhythm: [1, 0.78, 0.92, 0.7],
    maxRise: 3.8,
    maxSlopeRadians: THREE.MathUtils.degToRad(6.5),
    gradeRhythm: [0.72, 1, 0.82, 0.9],
  },
  "pine-run": {
    maxYawRadians: THREE.MathUtils.degToRad(9),
    maxExcursion: 9.5,
    firstDirection: 1,
    rhythm: [0.78, 1, 0.72, 0.9],
    maxRise: 4.4,
    maxSlopeRadians: THREE.MathUtils.degToRad(7),
    gradeRhythm: [0.84, 0.68, 1, 0.78],
  },
  "coastline-clash": {
    maxYawRadians: THREE.MathUtils.degToRad(12),
    maxExcursion: 12,
    firstDirection: -1,
    rhythm: [1, 0.82, 0.94, 0.74],
    maxRise: 5,
    maxSlopeRadians: THREE.MathUtils.degToRad(7.5),
    gradeRhythm: [0.72, 0.92, 0.78, 1],
  },
  "foundry-flight": {
    maxYawRadians: THREE.MathUtils.degToRad(10),
    maxExcursion: 10,
    firstDirection: 1,
    rhythm: [0.74, 0.92, 1, 0.8],
    maxRise: 5.8,
    maxSlopeRadians: THREE.MathUtils.degToRad(8),
    gradeRhythm: [0.66, 1, 0.78, 0.9],
  },
  "summit-showdown": {
    maxYawRadians: THREE.MathUtils.degToRad(11.5),
    maxExcursion: 11.5,
    firstDirection: -1,
    rhythm: [0.9, 0.76, 1, 0.84],
    maxRise: 7.5,
    maxSlopeRadians: THREE.MathUtils.degToRad(9.5),
    gradeRhythm: [1, 0.78, 0.92, 0.7],
  },
} as const satisfies Record<TrackId, CourseProfile>;

type CourseRouteTrack = Pick<
  TrackDefinition,
  "id" | "courseLength" | "obstacles" | "authoredCourse"
>;

interface DistanceInterval {
  readonly start: number;
  readonly end: number;
}

interface ProtectedCourseCorridor extends DistanceInterval {
  readonly centerZAtStart: number;
}

interface CourseBend extends DistanceInterval {
  readonly length: number;
  readonly direction: -1 | 1;
  readonly excursion: number;
}

interface CourseGradePulse extends DistanceInterval {
  readonly length: number;
  readonly rise: number;
}

interface MutableLateralSample {
  position: number;
  firstDerivative: number;
  secondDerivative: number;
}

interface AuthoredCenterlineValidation {
  readonly anchors: readonly AuthoredCenterlineAnchor[];
  readonly allZero: boolean;
}

interface MutableComponentSample {
  value: number;
  derivative: number;
}

interface MutableCoursePresentationOrientation {
  yaw: number;
  pitch: number;
  rightX: number;
  rightY: number;
  rightZ: number;
  forwardX: number;
  forwardY: number;
  forwardZ: number;
  upX: number;
  upY: number;
  upZ: number;
}

export interface CoursePresentationOrientation {
  readonly yaw: number;
  readonly pitch: number;
  readonly rightX: number;
  readonly rightY: number;
  readonly rightZ: number;
  readonly forwardX: number;
  readonly forwardY: number;
  readonly forwardZ: number;
  readonly upX: number;
  readonly upY: number;
  readonly upZ: number;
}

export interface CoursePresentationRouteOptions {
  /** Forces the exact straight/flat identity mapping for diagnostics or fallback rendering. */
  readonly identity?: boolean;
  /** Desired lookup spacing in scalar route metres. The actual spacing divides a lap evenly. */
  readonly sampleSpacing?: number;
}

export interface CourseRibbonGeometryOptions {
  readonly startProgress: number;
  readonly endProgress: number;
  readonly left: number;
  readonly right: number;
  readonly yOffset?: number;
  readonly uvRepeatLength?: number;
  readonly segmentLength?: number;
  readonly segmentVisible?: (
    segmentIndex: number,
    startProgress: number,
    endProgress: number,
  ) => boolean;
}

/**
 * Maps authoritative scalar progress onto a renderer-only campaign or authored centerline.
 * No gameplay rule reads this route. `sample()` is allocation-free; its return
 * object is reused and must be consumed before the next call.
 */
export class CoursePresentationRoute {
  readonly courseLength: number;
  readonly identity: boolean;
  readonly sampleSpacing: number;
  readonly lapAdvanceZ: number;

  private readonly segmentCount: number;
  private readonly centerX: Float64Array;
  private readonly centerY: Float64Array;
  private readonly centerZ: Float64Array;
  private readonly tangentX: Float64Array;
  private readonly tangentY: Float64Array;
  private readonly tangentZ: Float64Array;
  private readonly curvatureX: Float64Array;
  private readonly curvatureY: Float64Array;
  private readonly curvatureZ: Float64Array;
  private readonly authoredCenterline: readonly AuthoredCenterlineAnchor[] | null;
  private readonly authoredCenterZ: Float64Array | null;
  private readonly protectedCorridors: readonly ProtectedCourseCorridor[];
  private readonly authoredLateralSample: MutableLateralSample = {
    position: 0,
    firstDerivative: 0,
    secondDerivative: 0,
  };
  private readonly authoredGradeSample: MutableLateralSample = {
    position: 0,
    firstDerivative: 0,
    secondDerivative: 0,
  };
  private readonly componentSample: MutableComponentSample = { value: 0, derivative: 0 };
  private readonly orientation: MutableCoursePresentationOrientation = {
    yaw: 0,
    pitch: 0,
    rightX: 1,
    rightY: 0,
    rightZ: 0,
    forwardX: 0,
    forwardY: 0,
    forwardZ: -1,
    upX: 0,
    upY: 1,
    upZ: 0,
  };

  constructor(track: CourseRouteTrack, options: CoursePresentationRouteOptions = {}) {
    if (!Number.isFinite(track.courseLength) || track.courseLength <= 0) {
      throw new RangeError("Course presentation requires a positive finite course length.");
    }
    const requestedSpacing = options.sampleSpacing ?? DEFAULT_SAMPLE_SPACING;
    if (!Number.isFinite(requestedSpacing) || requestedSpacing <= 0) {
      throw new RangeError("Course presentation sample spacing must be positive and finite.");
    }

    this.courseLength = track.courseLength;
    this.segmentCount = Math.max(1, Math.ceil(track.courseLength / requestedSpacing));
    this.sampleSpacing = track.courseLength / this.segmentCount;
    const requestedIdentity = options.identity === true;
    const authoredValidation = track.authoredCourse
      ? validateAuthoredCenterline(track.authoredCourse.centerline, track.courseLength)
      : null;
    const authoredCenterline = !requestedIdentity
      && authoredValidation
      && !authoredValidation.allZero
      ? authoredValidation.anchors
      : null;
    const protectedIntervals = requestedIdentity || track.authoredCourse
      ? []
      : createProtectedIntervals(track.courseLength, track.obstacles);
    const bends = requestedIdentity || track.authoredCourse
      ? []
      : createBends(track, protectedIntervals);
    const gradePulses = requestedIdentity || track.authoredCourse
      ? []
      : createGradePulses(track, protectedIntervals);
    this.identity = requestedIdentity
      || (track.authoredCourse
        ? authoredCenterline === null
        : bends.length === 0 && gradePulses.length === 0);

    const sampleCount = this.segmentCount + 1;
    this.centerX = new Float64Array(sampleCount);
    this.centerY = new Float64Array(sampleCount);
    this.centerZ = new Float64Array(sampleCount);
    this.tangentX = new Float64Array(sampleCount);
    this.tangentY = new Float64Array(sampleCount);
    this.tangentZ = new Float64Array(sampleCount);
    this.curvatureX = new Float64Array(sampleCount);
    this.curvatureY = new Float64Array(sampleCount);
    this.curvatureZ = new Float64Array(sampleCount);
    this.authoredCenterline = authoredCenterline;
    this.authoredCenterZ = authoredCenterline
      ? createAuthoredCenterZ(authoredCenterline)
      : null;

    const lateral: MutableLateralSample = {
      position: 0,
      firstDerivative: 0,
      secondDerivative: 0,
    };
    const grade: MutableLateralSample = {
      position: 0,
      firstDerivative: 0,
      secondDerivative: 0,
    };
    for (let index = 0; index < sampleCount; index += 1) {
      const progress = Math.min(this.courseLength, index * this.sampleSpacing);
      if (authoredCenterline && this.authoredCenterZ) {
        const segmentIndex = findAuthoredSegmentIndex(authoredCenterline, progress);
        evaluateAuthoredCenterlineSegment(
          authoredCenterline[segmentIndex]!,
          authoredCenterline[segmentIndex + 1]!,
          progress,
          lateral,
          grade,
        );
        this.centerZ[index] = authoredCenterZAtProgress(
          authoredCenterline,
          this.authoredCenterZ,
          segmentIndex,
          progress,
        );
      } else {
        evaluateLateral(bends, progress, lateral);
        evaluateGrade(gradePulses, progress, grade);
      }
      const forwardZ = longitudinalSlope(
        lateral.firstDerivative,
        grade.firstDerivative,
      );
      this.centerX[index] = lateral.position;
      this.centerY[index] = grade.position;
      this.tangentX[index] = lateral.firstDerivative;
      this.tangentY[index] = grade.firstDerivative;
      this.tangentZ[index] = forwardZ;
      this.curvatureX[index] = lateral.secondDerivative;
      this.curvatureY[index] = grade.secondDerivative;
      this.curvatureZ[index] = longitudinalCurvature(
        lateral.firstDerivative,
        lateral.secondDerivative,
        grade.firstDerivative,
        grade.secondDerivative,
      );
      if (!authoredCenterline && index > 0) {
        const previousProgress = (index - 1) * this.sampleSpacing;
        this.centerZ[index] = (this.centerZ[index - 1] ?? 0)
          + integrateLongitudinalSlope(
            bends,
            gradePulses,
            previousProgress,
            progress,
          );
      }
    }
    const authoredLapAdvanceZ = this.authoredCenterZ
      ? this.authoredCenterZ[this.authoredCenterZ.length - 1]
      : undefined;
    this.lapAdvanceZ = authoredLapAdvanceZ
      ?? this.centerZ[this.segmentCount]
      ?? -this.courseLength;
    this.protectedCorridors = protectedIntervals.map(({ start, end }) => ({
      start,
      end,
      centerZAtStart: this.interpolateCenterZ(start),
    }));
  }

  sample(
    progress: number,
    lateral: number,
    elevation: number,
    outPosition: THREE.Vector3,
  ): CoursePresentationOrientation {
    if (this.identity || progress < 0) {
      outPosition.set(lateral, elevation, -progress);
      return this.setOrientation(0, 0, -1);
    }

    const lap = Math.floor(progress / this.courseLength);
    const localProgress = progress - lap * this.courseLength;
    if (this.authoredCenterline && this.authoredCenterZ) {
      const segmentIndex = findAuthoredSegmentIndex(this.authoredCenterline, localProgress);
      const segmentStart = this.authoredCenterline[segmentIndex];
      const segmentEnd = this.authoredCenterline[segmentIndex + 1];
      if (!segmentStart || !segmentEnd) {
        outPosition.set(lateral, elevation, -progress);
        return this.setOrientation(0, 0, -1);
      }
      evaluateAuthoredCenterlineSegment(
        segmentStart,
        segmentEnd,
        localProgress,
        this.authoredLateralSample,
        this.authoredGradeSample,
      );
      const centerZ = authoredCenterZAtProgress(
        this.authoredCenterline,
        this.authoredCenterZ,
        segmentIndex,
        localProgress,
      ) + lap * this.lapAdvanceZ;
      const orientation = this.setOrientation(
        this.authoredLateralSample.firstDerivative,
        this.authoredGradeSample.firstDerivative,
        longitudinalSlope(
          this.authoredLateralSample.firstDerivative,
          this.authoredGradeSample.firstDerivative,
        ),
      );
      outPosition.set(
        this.authoredLateralSample.position + orientation.rightX * lateral,
        this.authoredGradeSample.position + elevation,
        centerZ + orientation.rightZ * lateral,
      );
      return orientation;
    }
    const protectedCorridor = findInterval(this.protectedCorridors, localProgress);
    if (protectedCorridor) {
      outPosition.set(
        lateral,
        elevation,
        protectedCorridor.centerZAtStart
          - (localProgress - protectedCorridor.start)
          + lap * this.lapAdvanceZ,
      );
      return this.setOrientation(0, 0, -1);
    }
    const segmentIndex = Math.min(
      this.segmentCount - 1,
      Math.floor(localProgress / this.sampleSpacing),
    );
    const segmentStart = segmentIndex * this.sampleSpacing;
    const t = (localProgress - segmentStart) / this.sampleSpacing;

    interpolateQuintic(
      this.centerX,
      this.tangentX,
      this.curvatureX,
      segmentIndex,
      this.sampleSpacing,
      t,
      this.componentSample,
    );
    const centerX = this.componentSample.value;
    const forwardX = this.componentSample.derivative;
    interpolateQuintic(
      this.centerY,
      this.tangentY,
      this.curvatureY,
      segmentIndex,
      this.sampleSpacing,
      t,
      this.componentSample,
    );
    const centerY = this.componentSample.value;
    const forwardY = this.componentSample.derivative;
    interpolateQuintic(
      this.centerZ,
      this.tangentZ,
      this.curvatureZ,
      segmentIndex,
      this.sampleSpacing,
      t,
      this.componentSample,
    );
    const centerZ = this.componentSample.value + lap * this.lapAdvanceZ;
    const orientation = this.setOrientation(
      forwardX,
      forwardY,
      this.componentSample.derivative,
    );
    outPosition.set(
      centerX + orientation.rightX * lateral,
      centerY + elevation,
      centerZ + orientation.rightZ * lateral,
    );
    return orientation;
  }

  private setOrientation(
    forwardX: number,
    forwardY: number,
    forwardZ: number,
  ): CoursePresentationOrientation {
    const inverseLength = 1 / Math.max(
      1e-9,
      Math.hypot(forwardX, forwardY, forwardZ),
    );
    this.orientation.forwardX = forwardX * inverseLength;
    this.orientation.forwardY = forwardY * inverseLength;
    this.orientation.forwardZ = forwardZ * inverseLength;
    const inverseHorizontalLength = 1 / Math.max(
      1e-9,
      Math.hypot(this.orientation.forwardX, this.orientation.forwardZ),
    );
    this.orientation.rightX = -this.orientation.forwardZ * inverseHorizontalLength;
    this.orientation.rightY = 0;
    this.orientation.rightZ = this.orientation.forwardX * inverseHorizontalLength;
    this.orientation.upX = -this.orientation.rightZ * this.orientation.forwardY;
    this.orientation.upY = this.orientation.rightZ * this.orientation.forwardX
      - this.orientation.rightX * this.orientation.forwardZ;
    this.orientation.upZ = this.orientation.rightX * this.orientation.forwardY;
    this.orientation.yaw = Math.atan2(
      -this.orientation.forwardX,
      -this.orientation.forwardZ,
    );
    this.orientation.pitch = Math.atan2(
      this.orientation.forwardY,
      Math.hypot(this.orientation.forwardX, this.orientation.forwardZ),
    );
    return this.orientation;
  }

  private interpolateCenterZ(localProgress: number): number {
    const segmentIndex = Math.min(
      this.segmentCount - 1,
      Math.floor(localProgress / this.sampleSpacing),
    );
    const segmentStart = segmentIndex * this.sampleSpacing;
    const t = (localProgress - segmentStart) / this.sampleSpacing;
    interpolateQuintic(
      this.centerZ,
      this.tangentZ,
      this.curvatureZ,
      segmentIndex,
      this.sampleSpacing,
      t,
      this.componentSample,
    );
    return this.componentSample.value;
  }
}

/** Builds one draw-call-ready, route-normal ribbon with continuous route UVs. */
export function createCourseRibbonGeometry(
  route: CoursePresentationRoute,
  options: CourseRibbonGeometryOptions,
): THREE.BufferGeometry {
  const length = options.endProgress - options.startProgress;
  const segmentLength = options.segmentLength ?? route.sampleSpacing;
  const uvRepeatLength = options.uvRepeatLength ?? DEFAULT_UV_REPEAT_LENGTH;
  if (!Number.isFinite(length) || length <= 0) {
    throw new RangeError("Course ribbon end progress must be greater than start progress.");
  }
  if (!Number.isFinite(options.left) || !Number.isFinite(options.right)
    || options.left >= options.right) {
    throw new RangeError("Course ribbon lateral bounds must be finite and ordered.");
  }
  if (!Number.isFinite(segmentLength) || segmentLength <= 0
    || !Number.isFinite(uvRepeatLength) || uvRepeatLength <= 0) {
    throw new RangeError("Course ribbon segment and UV repeat lengths must be positive.");
  }

  const segmentCount = Math.max(1, Math.ceil(length / segmentLength));
  const actualSegmentLength = length / segmentCount;
  const yOffset = options.yOffset ?? 0;
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const startLeft = new THREE.Vector3();
  const startRight = new THREE.Vector3();
  const endLeft = new THREE.Vector3();
  const endRight = new THREE.Vector3();

  for (let index = 0; index < segmentCount; index += 1) {
    const startProgress = options.startProgress + index * actualSegmentLength;
    const endProgress = index === segmentCount - 1
      ? options.endProgress
      : startProgress + actualSegmentLength;
    if (options.segmentVisible && !options.segmentVisible(index, startProgress, endProgress)) {
      continue;
    }

    const startOrientation = route.sample(startProgress, options.left, yOffset, startLeft);
    const startUpX = startOrientation.upX;
    const startUpY = startOrientation.upY;
    const startUpZ = startOrientation.upZ;
    route.sample(startProgress, options.right, yOffset, startRight);
    const endOrientation = route.sample(endProgress, options.left, yOffset, endLeft);
    const endUpX = endOrientation.upX;
    const endUpY = endOrientation.upY;
    const endUpZ = endOrientation.upZ;
    route.sample(endProgress, options.right, yOffset, endRight);
    const vertexOffset = positions.length / 3;

    positions.push(
      startLeft.x, startLeft.y, startLeft.z,
      startRight.x, startRight.y, startRight.z,
      endLeft.x, endLeft.y, endLeft.z,
      endRight.x, endRight.y, endRight.z,
    );
    normals.push(
      startUpX, startUpY, startUpZ,
      startUpX, startUpY, startUpZ,
      endUpX, endUpY, endUpZ,
      endUpX, endUpY, endUpZ,
    );
    const startV = startProgress / uvRepeatLength;
    const endV = endProgress / uvRepeatLength;
    uvs.push(0, startV, 1, startV, 0, endV, 1, endV);
    indices.push(
      vertexOffset, vertexOffset + 1, vertexOffset + 3,
      vertexOffset, vertexOffset + 3, vertexOffset + 2,
    );
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  if (positions.length > 0) {
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
  }
  geometry.name = "campaign-course-ribbon";
  geometry.userData.presentationOnly = true;
  geometry.userData.progressModel = "scalar-arc-length";
  return geometry;
}

function validateAuthoredCenterline(
  value: unknown,
  courseLength: number,
): AuthoredCenterlineValidation | null {
  if (!Array.isArray(value)
    || value.length < 2
    || value.length > MAX_AUTHORED_CENTERLINE_ANCHORS) {
    return null;
  }

  const anchors: AuthoredCenterlineAnchor[] = [];
  for (const candidate of value) {
    if (!candidate || typeof candidate !== "object") return null;
    const distance = Reflect.get(candidate, "distance");
    const lateralOffset = Reflect.get(candidate, "lateralOffset");
    const elevation = Reflect.get(candidate, "elevation");
    if (typeof distance !== "number" || !Number.isFinite(distance)
      || typeof lateralOffset !== "number" || !Number.isFinite(lateralOffset)
      || typeof elevation !== "number" || !Number.isFinite(elevation)
      || Math.abs(lateralOffset) > 16
      || elevation < 0 || elevation > 12) {
      return null;
    }
    anchors.push({ distance, lateralOffset, elevation });
  }

  const first = anchors[0];
  const last = anchors[anchors.length - 1];
  const endpointTolerance = AUTHORED_ENDPOINT_EPSILON * Math.max(1, courseLength);
  if (!first || !last
    || Math.abs(first.distance) > endpointTolerance
    || Math.abs(last.distance - courseLength) > endpointTolerance
    || first.lateralOffset !== 0 || first.elevation !== 0
    || last.lateralOffset !== 0 || last.elevation !== 0) {
    return null;
  }
  anchors[0] = { ...first, distance: 0 };
  anchors[anchors.length - 1] = { ...last, distance: courseLength };

  for (let index = 1; index < anchors.length; index += 1) {
    const previous = anchors[index - 1];
    const current = anchors[index];
    if (!previous || !current) return null;
    const segmentLength = current.distance - previous.distance;
    if (!Number.isFinite(segmentLength) || segmentLength <= AUTHORED_ENDPOINT_EPSILON) {
      return null;
    }
    const lateralDelta = Math.abs(current.lateralOffset - previous.lateralOffset);
    const elevationDelta = Math.abs(current.elevation - previous.elevation);
    const lateralDerivative = SMOOTHERSTEP_MAX_DERIVATIVE
      * lateralDelta / segmentLength;
    const gradeDerivative = SMOOTHERSTEP_MAX_DERIVATIVE
      * elevationDelta / segmentLength;
    const combinedDerivativeSquared = lateralDerivative ** 2 + gradeDerivative ** 2;
    const longitudinalDerivative = Math.sqrt(Math.max(0, 1 - combinedDerivativeSquared));
    const yawRadians = Math.atan2(lateralDerivative, longitudinalDerivative);
    const lateralSecondDerivative = SMOOTHERSTEP_MAX_SECOND_DERIVATIVE
      * lateralDelta / (segmentLength * segmentLength);
    const gradeSecondDerivative = SMOOTHERSTEP_MAX_SECOND_DERIVATIVE
      * elevationDelta / (segmentLength * segmentLength);
    if (yawRadians > MAX_AUTHORED_YAW_RADIANS + 1e-9
      || gradeDerivative > MAX_AUTHORED_GRADE_DERIVATIVE + 1e-9
      || combinedDerivativeSquared >= 1 - 1e-9
      || lateralSecondDerivative > MAX_AUTHORED_SECOND_DERIVATIVE + 1e-9
      || gradeSecondDerivative > MAX_AUTHORED_SECOND_DERIVATIVE + 1e-9) {
      return null;
    }
  }

  return {
    anchors,
    allZero: anchors.every(({ lateralOffset, elevation }) => (
      lateralOffset === 0 && elevation === 0
    )),
  };
}

function findAuthoredSegmentIndex(
  anchors: readonly AuthoredCenterlineAnchor[],
  progress: number,
): number {
  let low = 0;
  let high = Math.max(0, anchors.length - 2);
  while (low < high) {
    const midpoint = Math.floor((low + high) / 2);
    const segmentEnd = anchors[midpoint + 1];
    if (segmentEnd && progress > segmentEnd.distance) low = midpoint + 1;
    else high = midpoint;
  }
  return low;
}

function evaluateAuthoredCenterlineSegment(
  start: AuthoredCenterlineAnchor,
  end: AuthoredCenterlineAnchor,
  progress: number,
  lateral: MutableLateralSample,
  grade: MutableLateralSample,
): void {
  const length = end.distance - start.distance;
  const t = THREE.MathUtils.clamp((progress - start.distance) / length, 0, 1);
  const t2 = t * t;
  const smootherstep = t2 * t * (t * (t * 6 - 15) + 10);
  const firstDerivative = 30 * t2 * (t - 1) * (t - 1) / length;
  const secondDerivative = 60 * t * (2 * t2 - 3 * t + 1) / (length * length);
  const lateralDelta = end.lateralOffset - start.lateralOffset;
  const elevationDelta = end.elevation - start.elevation;
  lateral.position = start.lateralOffset + lateralDelta * smootherstep;
  lateral.firstDerivative = lateralDelta * firstDerivative;
  lateral.secondDerivative = lateralDelta * secondDerivative;
  grade.position = start.elevation + elevationDelta * smootherstep;
  grade.firstDerivative = elevationDelta * firstDerivative;
  grade.secondDerivative = elevationDelta * secondDerivative;
}

function createAuthoredCenterZ(
  anchors: readonly AuthoredCenterlineAnchor[],
): Float64Array {
  const centerZ = new Float64Array(anchors.length);
  for (let index = 1; index < anchors.length; index += 1) {
    const start = anchors[index - 1];
    const end = anchors[index];
    if (!start || !end) continue;
    centerZ[index] = (centerZ[index - 1] ?? 0)
      + integrateAuthoredCenterlineSegment(start, end, start.distance, end.distance);
  }
  return centerZ;
}

function authoredCenterZAtProgress(
  anchors: readonly AuthoredCenterlineAnchor[],
  centerZ: Float64Array,
  segmentIndex: number,
  progress: number,
): number {
  const start = anchors[segmentIndex];
  const end = anchors[segmentIndex + 1];
  if (!start || !end) return -progress;
  return (centerZ[segmentIndex] ?? 0) + integrateAuthoredCenterlineSegment(
    start,
    end,
    start.distance,
    THREE.MathUtils.clamp(progress, start.distance, end.distance),
  );
}

function integrateAuthoredCenterlineSegment(
  start: AuthoredCenterlineAnchor,
  end: AuthoredCenterlineAnchor,
  integrationStart: number,
  integrationEnd: number,
): number {
  if (integrationEnd <= integrationStart) return 0;
  const midpoint = (integrationStart + integrationEnd) / 2;
  const halfLength = (integrationEnd - integrationStart) / 2;
  const nearOffset = halfLength * 0.5384693101056831;
  const farOffset = halfLength * 0.906179845938664;
  const value = 0.5688888888888889 * authoredLongitudinalSlopeAt(start, end, midpoint)
    + 0.47862867049936647 * (
      authoredLongitudinalSlopeAt(start, end, midpoint - nearOffset)
      + authoredLongitudinalSlopeAt(start, end, midpoint + nearOffset)
    )
    + 0.23692688505618908 * (
      authoredLongitudinalSlopeAt(start, end, midpoint - farOffset)
      + authoredLongitudinalSlopeAt(start, end, midpoint + farOffset)
    );
  return halfLength * value;
}

function authoredLongitudinalSlopeAt(
  start: AuthoredCenterlineAnchor,
  end: AuthoredCenterlineAnchor,
  progress: number,
): number {
  const segmentLength = end.distance - start.distance;
  const t = THREE.MathUtils.clamp(
    (progress - start.distance) / segmentLength,
    0,
    1,
  );
  const smootherstepDerivative = 30 * t * t * (t - 1) * (t - 1) / segmentLength;
  return longitudinalSlope(
    (end.lateralOffset - start.lateralOffset) * smootherstepDerivative,
    (end.elevation - start.elevation) * smootherstepDerivative,
  );
}

function createBends(
  track: CourseRouteTrack,
  protectedIntervals: readonly DistanceInterval[],
): CourseBend[] {
  const profile = COURSE_PROFILES[track.id];
  const bends: CourseBend[] = [];
  let cursor = 0;
  let bendIndex = 0;

  for (const interval of protectedIntervals) {
    const length = interval.start - cursor;
    if (length >= MIN_BEND_LENGTH) {
      const rhythm = profile.rhythm[bendIndex % profile.rhythm.length] ?? 1;
      const direction = (bendIndex % 2 === 0
        ? profile.firstDirection
        : -profile.firstDirection) as -1 | 1;
      const excursion = Math.min(
        profile.maxExcursion,
        length * Math.sin(profile.maxYawRadians) * rhythm / PULSE_MAX_DERIVATIVE,
      );
      bends.push({ start: cursor, end: interval.start, length, direction, excursion });
      bendIndex += 1;
    }
    cursor = Math.max(cursor, interval.end);
  }
  return bends;
}

function createGradePulses(
  track: CourseRouteTrack,
  protectedIntervals: readonly DistanceInterval[],
): CourseGradePulse[] {
  const profile = COURSE_PROFILES[track.id];
  const pulses: CourseGradePulse[] = [];
  let cursor = 0;
  let pulseIndex = 0;

  for (const interval of protectedIntervals) {
    const length = interval.start - cursor;
    if (length >= MIN_BEND_LENGTH) {
      const rhythm = profile.gradeRhythm[pulseIndex % profile.gradeRhythm.length] ?? 1;
      const slopeLimitedRise = length
        * Math.sin(profile.maxSlopeRadians)
        / PULSE_MAX_DERIVATIVE;
      const rise = Math.min(profile.maxRise, slopeLimitedRise) * rhythm;
      if (rise > 0) {
        pulses.push({ start: cursor, end: interval.start, length, rise });
        pulseIndex += 1;
      }
    }
    cursor = Math.max(cursor, interval.end);
  }
  return pulses;
}

function findInterval<T extends DistanceInterval>(
  intervals: readonly T[],
  progress: number,
): T | undefined {
  for (const interval of intervals) {
    if (progress >= interval.start && progress <= interval.end) return interval;
    if (progress < interval.start) return undefined;
  }
  return undefined;
}

function createProtectedIntervals(
  courseLength: number,
  obstacles: readonly TrackObstacle[],
): DistanceInterval[] {
  const intervals: DistanceInterval[] = [
    { start: 0, end: Math.min(courseLength, LAP_END_STRAIGHT) },
    { start: Math.max(0, courseLength - LAP_END_STRAIGHT), end: courseLength },
  ];
  for (const obstacle of obstacles) {
    const halfLength = Math.max(3.5, (obstacle.length ?? 8) / 2);
    intervals.push({
      start: Math.max(0, obstacle.distance - halfLength - OBSTACLE_MARGIN),
      end: Math.min(courseLength, obstacle.distance + halfLength + OBSTACLE_MARGIN),
    });
  }
  intervals.sort((first, second) => first.start - second.start);

  const merged: DistanceInterval[] = [];
  for (const interval of intervals) {
    const previous = merged[merged.length - 1];
    if (!previous || interval.start > previous.end) {
      merged.push(interval);
      continue;
    }
    merged[merged.length - 1] = {
      start: previous.start,
      end: Math.max(previous.end, interval.end),
    };
  }
  return merged;
}

function evaluateLateral(
  bends: readonly CourseBend[],
  progress: number,
  out: MutableLateralSample,
): void {
  const bend = findBend(bends, progress);
  if (!bend || progress <= bend.start || progress >= bend.end) {
    out.position = 0;
    out.firstDerivative = 0;
    out.secondDerivative = 0;
    return;
  }
  const t = (progress - bend.start) / bend.length;
  const sine = Math.sin(Math.PI * t);
  const cosine = Math.cos(Math.PI * t);
  const signedExcursion = bend.direction * bend.excursion;
  out.position = signedExcursion * sine * sine * sine;
  out.firstDerivative = signedExcursion
    * 3 * Math.PI * sine * sine * cosine / bend.length;
  out.secondDerivative = signedExcursion
    * 3 * Math.PI * Math.PI * sine * (2 - 3 * sine * sine)
    / (bend.length * bend.length);
}

function evaluateGrade(
  pulses: readonly CourseGradePulse[],
  progress: number,
  out: MutableLateralSample,
): void {
  const pulse = findGradePulse(pulses, progress);
  if (!pulse || progress <= pulse.start || progress >= pulse.end) {
    out.position = 0;
    out.firstDerivative = 0;
    out.secondDerivative = 0;
    return;
  }
  const t = (progress - pulse.start) / pulse.length;
  const sine = Math.sin(Math.PI * t);
  const cosine = Math.cos(Math.PI * t);
  out.position = pulse.rise * sine * sine * sine;
  out.firstDerivative = pulse.rise
    * 3 * Math.PI * sine * sine * cosine / pulse.length;
  out.secondDerivative = pulse.rise
    * 3 * Math.PI * Math.PI * sine * (2 - 3 * sine * sine)
    / (pulse.length * pulse.length);
}

function findBend(bends: readonly CourseBend[], progress: number): CourseBend | undefined {
  for (const bend of bends) {
    if (progress >= bend.start && progress <= bend.end) return bend;
    if (progress < bend.start) return undefined;
  }
  return undefined;
}

function findGradePulse(
  pulses: readonly CourseGradePulse[],
  progress: number,
): CourseGradePulse | undefined {
  for (const pulse of pulses) {
    if (progress >= pulse.start && progress <= pulse.end) return pulse;
    if (progress < pulse.start) return undefined;
  }
  return undefined;
}

function lateralSlope(bends: readonly CourseBend[], progress: number): number {
  const bend = findBend(bends, progress);
  if (!bend || progress <= bend.start || progress >= bend.end) return 0;
  const t = (progress - bend.start) / bend.length;
  const sine = Math.sin(Math.PI * t);
  return bend.direction * bend.excursion
    * 3 * Math.PI * sine * sine * Math.cos(Math.PI * t) / bend.length;
}

function gradeSlope(pulses: readonly CourseGradePulse[], progress: number): number {
  const pulse = findGradePulse(pulses, progress);
  if (!pulse || progress <= pulse.start || progress >= pulse.end) return 0;
  const t = (progress - pulse.start) / pulse.length;
  const sine = Math.sin(Math.PI * t);
  return pulse.rise
    * 3 * Math.PI * sine * sine * Math.cos(Math.PI * t) / pulse.length;
}

function longitudinalSlope(
  lateralFirstDerivative: number,
  gradeFirstDerivative: number,
): number {
  return -Math.sqrt(Math.max(
    1e-12,
    1
      - lateralFirstDerivative * lateralFirstDerivative
      - gradeFirstDerivative * gradeFirstDerivative,
  ));
}

function longitudinalCurvature(
  lateralFirstDerivative: number,
  lateralSecondDerivative: number,
  gradeFirstDerivative: number,
  gradeSecondDerivative: number,
): number {
  return (
    lateralFirstDerivative * lateralSecondDerivative
      + gradeFirstDerivative * gradeSecondDerivative
  ) / Math.max(
    1e-9,
    -longitudinalSlope(lateralFirstDerivative, gradeFirstDerivative),
  );
}

function integrateLongitudinalSlope(
  bends: readonly CourseBend[],
  gradePulses: readonly CourseGradePulse[],
  start: number,
  end: number,
): number {
  const midpoint = (start + end) / 2;
  const halfLength = (end - start) / 2;
  const nearOffset = halfLength * 0.5384693101056831;
  const farOffset = halfLength * 0.906179845938664;
  const slopeAt = (progress: number): number => longitudinalSlope(
    lateralSlope(bends, progress),
    gradeSlope(gradePulses, progress),
  );
  const value = 0.5688888888888889 * slopeAt(midpoint)
    + 0.47862867049936647 * (
      slopeAt(midpoint - nearOffset)
      + slopeAt(midpoint + nearOffset)
    )
    + 0.23692688505618908 * (
      slopeAt(midpoint - farOffset)
      + slopeAt(midpoint + farOffset)
    );
  return halfLength * value;
}

function interpolateQuintic(
  values: Float64Array,
  firstDerivatives: Float64Array,
  secondDerivatives: Float64Array,
  index: number,
  spacing: number,
  t: number,
  out: MutableComponentSample,
): void {
  const value0 = values[index] ?? 0;
  const value1 = values[index + 1] ?? value0;
  const first0 = (firstDerivatives[index] ?? 0) * spacing;
  const first1 = (firstDerivatives[index + 1] ?? 0) * spacing;
  const second0 = (secondDerivatives[index] ?? 0) * spacing * spacing;
  const second1 = (secondDerivatives[index + 1] ?? 0) * spacing * spacing;
  const c0 = value0;
  const c1 = first0;
  const c2 = second0 / 2;
  const remainingValue = value1 - c0 - c1 - c2;
  const remainingFirst = first1 - c1 - 2 * c2;
  const remainingSecond = second1 - 2 * c2;
  const c3 = 10 * remainingValue - 4 * remainingFirst + remainingSecond / 2;
  const c4 = -15 * remainingValue + 7 * remainingFirst - remainingSecond;
  const c5 = 6 * remainingValue - 3 * remainingFirst + remainingSecond / 2;
  const t2 = t * t;
  const t3 = t2 * t;
  const t4 = t3 * t;
  const t5 = t4 * t;
  out.value = c0 + c1 * t + c2 * t2 + c3 * t3 + c4 * t4 + c5 * t5;
  out.derivative = (c1 + 2 * c2 * t + 3 * c3 * t2 + 4 * c4 * t3 + 5 * c5 * t4)
    / spacing;
}

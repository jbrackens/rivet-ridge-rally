import * as THREE from "three";
import { describe, expect, it } from "vitest";

import {
  getTrack,
  type AuthoredCenterlineAnchor,
  type AuthoredRaceGate,
  type TrackDefinition,
} from "../../content/tracks";
import {
  CoursePresentationRoute,
  createCourseRibbonGeometry,
  type CoursePresentationOrientation,
} from "../CoursePresentationRoute";

function authoredGate(
  kind: AuthoredRaceGate["kind"],
  distance: number,
  order: number,
): AuthoredRaceGate {
  return {
    id: `test-${kind}`,
    moduleId: kind === "finish" ? "finish-arch" : "start-grid",
    distance,
    sourceGridPosition: distance,
    lanes: [0, 1, 2, 3],
    lateralPosition: 0,
    unrotatedWidth: 13.3,
    unrotatedLength: 6,
    width: 13.3,
    length: 6,
    rotation: 0,
    height: 0,
    kind,
    order,
  };
}

function customTrackDefinition(
  centerline: readonly AuthoredCenterlineAnchor[] = [
    { distance: 0, lateralOffset: 0, elevation: 0 },
    { distance: 60, lateralOffset: 0, elevation: 0 },
    { distance: 120, lateralOffset: 0, elevation: 0 },
  ],
): TrackDefinition {
  const base = getTrack("canyon-kickoff");
  return {
    ...base,
    courseLength: 120,
    obstacles: [],
    authoredCourse: {
      start: authoredGate("start", 0, 0),
      checkpoints: [authoredGate("checkpoint", 60, 1)],
      finish: authoredGate("finish", 120, 2),
      centerline,
      trackPieces: [],
    },
  };
}

function copyOrientation(
  orientation: CoursePresentationOrientation,
): CoursePresentationOrientation {
  return { ...orientation };
}

function expectOrthonormalFrame(orientation: CoursePresentationOrientation): void {
  const forward = new THREE.Vector3(
    orientation.forwardX,
    orientation.forwardY,
    orientation.forwardZ,
  );
  const right = new THREE.Vector3(
    orientation.rightX,
    orientation.rightY,
    orientation.rightZ,
  );
  const up = new THREE.Vector3(
    orientation.upX,
    orientation.upY,
    orientation.upZ,
  );
  const expectedUp = new THREE.Vector3().crossVectors(right, forward);

  expect(Object.values(orientation).every(Number.isFinite)).toBe(true);
  expect(forward.length()).toBeCloseTo(1, 10);
  expect(right.length()).toBeCloseTo(1, 10);
  expect(up.length()).toBeCloseTo(1, 10);
  expect(forward.dot(right)).toBeCloseTo(0, 10);
  expect(forward.dot(up)).toBeCloseTo(0, 10);
  expect(right.dot(up)).toBeCloseTo(0, 10);
  expect(expectedUp.distanceTo(up)).toBeLessThan(1e-10);
}

describe("CoursePresentationRoute", () => {
  it("maps authored custom courses exactly through the identity route", () => {
    const route = new CoursePresentationRoute(customTrackDefinition());
    const position = new THREE.Vector3();

    expect(route.identity).toBe(true);
    for (const progress of [-12, 0, 57.25, 133]) {
      const orientation = copyOrientation(route.sample(progress, 3.25, 1.4, position));
      expect(position.toArray()).toEqual([3.25, 1.4, -progress]);
      expect(orientation).toEqual({
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
      });
    }
  });

  it("passes through authored checkpoint anchors with a finite C2 scalar-arc-length route", () => {
    const anchorProgress = 57.25;
    const route = new CoursePresentationRoute(customTrackDefinition([
      { distance: 0, lateralOffset: 0, elevation: 0 },
      { distance: anchorProgress, lateralOffset: 4, elevation: 3 },
      { distance: 120, lateralOffset: 0, elevation: 0 },
    ]));
    const anchor = new THREE.Vector3();
    const before = new THREE.Vector3();
    const after = new THREE.Vector3();
    const beforeTwo = new THREE.Vector3();
    const afterTwo = new THREE.Vector3();
    const step = 0.1;

    expect(route.identity).toBe(false);
    const anchorOrientation = copyOrientation(route.sample(anchorProgress, 0, 0, anchor));
    route.sample(anchorProgress - step, 0, 0, before);
    route.sample(anchorProgress + step, 0, 0, after);
    route.sample(anchorProgress - step * 2, 0, 0, beforeTwo);
    route.sample(anchorProgress + step * 2, 0, 0, afterTwo);

    expect(anchor.x).toBeCloseTo(4, 12);
    expect(anchor.y).toBeCloseTo(3, 12);
    expect(anchorOrientation.forwardX).toBeCloseTo(0, 12);
    expect(anchorOrientation.forwardY).toBeCloseTo(0, 12);
    expect(anchorOrientation.forwardZ).toBeCloseTo(-1, 12);
    expectOrthonormalFrame(anchorOrientation);

    const leftSecondDerivative = anchor.clone()
      .addScaledVector(before, -2)
      .add(beforeTwo)
      .multiplyScalar(1 / (step * step));
    const rightSecondDerivative = afterTwo.clone()
      .addScaledVector(after, -2)
      .add(anchor)
      .multiplyScalar(1 / (step * step));
    expect(leftSecondDerivative.length()).toBeLessThan(0.002);
    expect(rightSecondDerivative.length()).toBeLessThan(0.002);
    expect(leftSecondDerivative.distanceTo(rightSecondDerivative)).toBeLessThan(0.004);

    let sampledLength = 0;
    const previous = new THREE.Vector3();
    const current = new THREE.Vector3();
    route.sample(0, 0, 0, previous);
    for (let progress = 0.25; progress <= 120; progress += 0.25) {
      const orientation = copyOrientation(route.sample(progress, 0, 0, current));
      expectOrthonormalFrame(orientation);
      sampledLength += current.distanceTo(previous);
      previous.copy(current);
    }
    expect(sampledLength).toBeCloseTo(120, 3);
  });

  it.each([
    [
      "malformed ordering",
      [
        { distance: 0, lateralOffset: 0, elevation: 0 },
        { distance: 60, lateralOffset: 2, elevation: 1 },
        { distance: 60, lateralOffset: -2, elevation: 1 },
        { distance: 120, lateralOffset: 0, elevation: 0 },
      ],
    ],
    [
      "excessive slope",
      [
        { distance: 0, lateralOffset: 0, elevation: 0 },
        { distance: 10, lateralOffset: 4, elevation: 0 },
        { distance: 120, lateralOffset: 0, elevation: 0 },
      ],
    ],
    [
      "excessive curvature",
      [
        { distance: 0, lateralOffset: 0, elevation: 0 },
        { distance: 7, lateralOffset: 0.4, elevation: 0 },
        { distance: 120, lateralOffset: 0, elevation: 0 },
      ],
    ],
    [
      "excessive grade transition",
      [
        { distance: 0, lateralOffset: 0, elevation: 0 },
        { distance: 7, lateralOffset: 0, elevation: 0.4 },
        { distance: 120, lateralOffset: 0, elevation: 0 },
      ],
    ],
    [
      "combined turn and grade yaw",
      [
        { distance: 0, lateralOffset: 0, elevation: 0 },
        { distance: 60, lateralOffset: 6.6, elevation: 5.25 },
        { distance: 120, lateralOffset: 0, elevation: 0 },
      ],
    ],
  ] as const)("falls back to exact identity for %s", (_label, centerline) => {
    const route = new CoursePresentationRoute(customTrackDefinition(centerline));
    const position = new THREE.Vector3();
    const orientation = copyOrientation(route.sample(37.25, -2.5, 1.25, position));

    expect(route.identity).toBe(true);
    expect(position.toArray()).toEqual([-2.5, 1.25, -37.25]);
    expect(orientation).toEqual({
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
    });
  });

  it("keeps position and finite orientation continuous across lap seams", () => {
    const track = getTrack("canyon-kickoff");
    const route = new CoursePresentationRoute(track);
    const before = new THREE.Vector3();
    const seam = new THREE.Vector3();
    const after = new THREE.Vector3();
    const farBefore = new THREE.Vector3();
    const farAfter = new THREE.Vector3();
    const offset = 0.25;

    route.sample(track.courseLength - offset * 2, 0, 2, farBefore);
    const beforeOrientation = copyOrientation(route.sample(
      track.courseLength - offset,
      0,
      2,
      before,
    ));
    const seamOrientation = copyOrientation(route.sample(track.courseLength, 0, 2, seam));
    const afterOrientation = copyOrientation(route.sample(
      track.courseLength + offset,
      0,
      2,
      after,
    ));
    route.sample(track.courseLength + offset * 2, 0, 2, farAfter);

    expect(before.x).toBeCloseTo(0, 10);
    expect(seam.x).toBeCloseTo(0, 10);
    expect(after.x).toBeCloseTo(0, 10);
    expect(seam.z).toBeCloseTo(route.lapAdvanceZ, 10);
    expect(after.z - before.z).toBeCloseTo(-offset * 2, 10);
    expect([before.y, seam.y, after.y]).toEqual([2, 2, 2]);

    for (const orientation of [beforeOrientation, seamOrientation, afterOrientation]) {
      expectOrthonormalFrame(orientation);
      expect(orientation.pitch).toBeCloseTo(0, 10);
    }

    const leftFirstDerivative = seam.clone().sub(before).multiplyScalar(1 / offset);
    const rightFirstDerivative = after.clone().sub(seam).multiplyScalar(1 / offset);
    expect(leftFirstDerivative.distanceTo(rightFirstDerivative)).toBeLessThan(1e-9);
    const leftSecondDerivative = seam.clone()
      .addScaledVector(before, -2)
      .add(farBefore)
      .multiplyScalar(1 / (offset * offset));
    const rightSecondDerivative = farAfter.clone()
      .addScaledVector(after, -2)
      .add(seam)
      .multiplyScalar(1 / (offset * offset));
    expect(leftSecondDerivative.length()).toBeLessThan(1e-9);
    expect(rightSecondDerivative.length()).toBeLessThan(1e-9);
    expect(leftSecondDerivative.distanceTo(rightSecondDerivative)).toBeLessThan(1e-9);
  });

  it("holds the full long-obstacle corridor straight through its safety margins", () => {
    const track = getTrack("canyon-kickoff");
    const route = new CoursePresentationRoute(track);
    const obstacle = track.obstacles.find(({ id }) => id === "ck-chain-1");
    if (!obstacle) throw new Error("Canyon jump chain fixture is missing.");
    const halfLength = (obstacle.length ?? 8) / 2;
    const corridorStart = obstacle.distance - halfLength - 10;
    const corridorEnd = obstacle.distance + halfLength + 10;
    const progressSamples = Array.from(
      { length: Math.round(corridorEnd - corridorStart) + 1 },
      (_, index) => corridorStart + index,
    );
    const position = new THREE.Vector3();
    let previousProgress: number | undefined;
    let previousZ: number | undefined;

    for (const progress of progressSamples) {
      const orientation = copyOrientation(route.sample(progress, 0, 0, position));
      expect(position.x).toBeCloseTo(0, 9);
      expect(position.y).toBeCloseTo(0, 9);
      expect(orientation.yaw).toBeCloseTo(0, 9);
      expect(orientation.pitch).toBeCloseTo(0, 9);
      expect(orientation.forwardX).toBeCloseTo(0, 9);
      expect(orientation.forwardY).toBeCloseTo(0, 9);
      expect(orientation.forwardZ).toBeCloseTo(-1, 9);
      expect(orientation.upX).toBeCloseTo(0, 9);
      expect(orientation.upY).toBeCloseTo(1, 9);
      expect(orientation.upZ).toBeCloseTo(0, 9);
      if (previousProgress !== undefined && previousZ !== undefined) {
        expect(position.z - previousZ).toBeCloseTo(-(progress - previousProgress), 10);
      }
      previousProgress = progress;
      previousZ = position.z;
    }
  });

  it("adds positive rolling grade outside protected corridors with Summit strongest", () => {
    const position = new THREE.Vector3();
    const maximumHeights = new Map<string, number>();

    for (const trackId of [
      "canyon-kickoff",
      "pine-run",
      "coastline-clash",
      "foundry-flight",
      "summit-showdown",
    ] as const) {
      const track = getTrack(trackId);
      const route = new CoursePresentationRoute(track);
      let minimumHeight = Number.POSITIVE_INFINITY;
      let maximumHeight = Number.NEGATIVE_INFINITY;
      for (let progress = 0; progress <= track.courseLength; progress += 1) {
        route.sample(progress, 0, 0, position);
        minimumHeight = Math.min(minimumHeight, position.y);
        maximumHeight = Math.max(maximumHeight, position.y);
      }
      expect(minimumHeight).toBeGreaterThanOrEqual(-1e-9);
      expect(maximumHeight).toBeGreaterThan(0.5);
      maximumHeights.set(trackId, maximumHeight);
    }

    expect(maximumHeights.get("summit-showdown") ?? 0).toBeGreaterThan(
      (maximumHeights.get("canyon-kickoff") ?? 0) + 1,
    );
  });

  it("returns a finite orthonormal 3D frame on the steepest sampled grade", () => {
    const track = getTrack("summit-showdown");
    const route = new CoursePresentationRoute(track);
    const position = new THREE.Vector3();
    let steepestOrientation = copyOrientation(route.sample(0, 0, 0, position));

    for (let progress = 1; progress < track.courseLength; progress += 1) {
      const orientation = copyOrientation(route.sample(progress, 0, 0, position));
      if (Math.abs(orientation.forwardY) > Math.abs(steepestOrientation.forwardY)) {
        steepestOrientation = orientation;
      }
    }

    expect(Math.abs(steepestOrientation.forwardY)).toBeGreaterThan(0.01);
    expect(Math.abs(steepestOrientation.pitch)).toBeGreaterThan(0.01);
    expect(Math.abs(steepestOrientation.pitch)).toBeLessThanOrEqual(
      THREE.MathUtils.degToRad(9.5) + 1e-3,
    );
    expectOrthonormalFrame(steepestOrientation);
  });

  it("offsets lanes along the sampled local right vector", () => {
    const route = new CoursePresentationRoute(getTrack("canyon-kickoff"));
    const center = new THREE.Vector3();
    const offsetPosition = new THREE.Vector3();
    const lateral = 3.25;
    const progress = 500;
    const centerOrientation = copyOrientation(route.sample(progress, 0, 0.75, center));
    const offsetOrientation = copyOrientation(route.sample(
      progress,
      lateral,
      0.75,
      offsetPosition,
    ));

    expect(Math.abs(centerOrientation.rightZ)).toBeGreaterThan(0.01);
    expect(offsetPosition.x - center.x).toBeCloseTo(centerOrientation.rightX * lateral, 10);
    expect(offsetPosition.z - center.z).toBeCloseTo(centerOrientation.rightZ * lateral, 10);
    expect(offsetPosition.distanceTo(center)).toBeCloseTo(lateral, 10);
    expect(offsetPosition.y).toBeCloseTo(center.y, 10);
    expect(offsetOrientation).toEqual(centerOrientation);
  });

  it("builds bounded, UV-mapped ribbons and honors segment visibility", () => {
    const route = new CoursePresentationRoute(customTrackDefinition());
    const geometry = createCourseRibbonGeometry(route, {
      startProgress: 0,
      endProgress: 20,
      left: -2,
      right: 3,
      yOffset: 0.15,
      uvRepeatLength: 10,
      segmentLength: 5,
      segmentVisible: (index) => index !== 1,
    });
    const positions = geometry.getAttribute("position");
    const uvs = geometry.getAttribute("uv");
    const vCoordinates = Array.from({ length: uvs.count }, (_, index) => uvs.getY(index));

    expect(geometry.name).toBe("campaign-course-ribbon");
    expect(geometry.userData.presentationOnly).toBe(true);
    expect(geometry.userData.progressModel).toBe("scalar-arc-length");
    expect(positions.count).toBe(12);
    expect(uvs.count).toBe(12);
    expect(geometry.index?.count).toBe(18);
    expect(geometry.boundingBox?.min.x).toBe(-2);
    expect(geometry.boundingBox?.min.y).toBeCloseTo(0.15, 6);
    expect(geometry.boundingBox?.min.z).toBe(-20);
    expect(geometry.boundingBox?.max.x).toBe(3);
    expect(geometry.boundingBox?.max.y).toBeCloseTo(0.15, 6);
    expect(geometry.boundingBox?.max.z).toBe(0);
    expect(Math.min(...vCoordinates)).toBe(0);
    expect(Math.max(...vCoordinates)).toBe(2);

    geometry.dispose();
  });

  it("builds graded ribbons with sampled bounds and unit surface normals", () => {
    const track = getTrack("summit-showdown");
    const route = new CoursePresentationRoute(track);
    const segmentLength = 2;
    const geometry = createCourseRibbonGeometry(route, {
      startProgress: 0,
      endProgress: track.courseLength,
      left: -6.65,
      right: 6.65,
      yOffset: 0.075,
      segmentLength,
    });
    const positions = geometry.getAttribute("position");
    const normals = geometry.getAttribute("normal");
    const expectedSegmentCount = Math.ceil(track.courseLength / segmentLength);
    let hasSlopedNormal = false;

    expect(positions.count).toBe(expectedSegmentCount * 4);
    expect(normals.count).toBe(positions.count);
    expect(geometry.index?.count).toBe(expectedSegmentCount * 6);
    expect(geometry.boundingBox?.min.y).toBeCloseTo(0.075, 5);
    expect(geometry.boundingBox?.max.y ?? 0).toBeGreaterThan(1);

    for (let index = 0; index < normals.count; index += 1) {
      const normal = new THREE.Vector3(
        normals.getX(index),
        normals.getY(index),
        normals.getZ(index),
      );
      expect(normal.toArray().every(Number.isFinite)).toBe(true);
      expect(normal.length()).toBeCloseTo(1, 5);
      expect(normal.y).toBeGreaterThan(0);
      hasSlopedNormal ||= Math.hypot(normal.x, normal.z) > 0.01;
    }
    expect(hasSlopedNormal).toBe(true);

    geometry.dispose();
  });
});

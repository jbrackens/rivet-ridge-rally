import * as THREE from "three";

import type {
  GameSettings,
  RaceClassificationEntry,
  RaceMode,
  RaceResult,
} from "../../app/types";
import {
  getTrack,
  type AuthoredPlacementTransform,
  type AuthoredRaceGate,
  type AuthoredTrackPiece,
  type LaneIndex,
  type TrackDefinition,
  type TrackObstacle,
} from "../content/tracks";
import { customTrackToDefinition } from "../editor/toTrackDefinition";
import type { CustomTrackData } from "../persistence/database";
import { AudioManager } from "../audio/AudioManager";
import {
  FESTIVAL_TRAIL_BIKE_URL,
  createCompressedAssetLoader,
  type CompressedAssetLoader,
} from "../assets/compressedAssetLoader";
import { InputManager, type InputDevice } from "../input/InputManager";
import { formatKeyCode } from "../input/keyLabels";
import {
  observeWebglContext,
  releaseWebglContext,
  startLifecycleResource,
  stopLifecycleResource,
} from "../qa/lifecycleDiagnostics";
import {
  FIXED_DT,
  LANE_POSITIONS,
  RaceSimulation,
  type BikePhase,
  type LaneChange,
  type LandingQuality,
  type SimulationEnvironment,
  type SimulationInput,
  type SimulationState,
} from "../simulation";
import {
  advanceAiRaceProgress,
  chooseAiLane,
  createAiSimulationOptions,
  getAiConsistency,
  getAiDifficultyProfile,
  getAiDriveControl,
  getAiLaneChange,
  getAiPitchControl,
  getObstaclePolicy,
  isRampObstacle,
  resolveRiderCollision,
  type AiBehavior,
  type AiDifficultyProfile,
  type AiObstaclePolicy,
} from "./aiRules";
import { parseQaVisualDistance } from "./qaVisualCapture";

const PLAYER_COLOR = 0x19b8b0;
const PLAYER_ACCENT = 0xf15f50;
const NAVY = 0x061c32;
const YELLOW = 0xf7cc3d;
const COOLING = 0x1ddfe6;
const MAX_DELTA_SECONDS = 0.1;
const MAX_AI_CLASSIFICATION_STEPS = 60 * 60 * 15;
const AI_FIELD = [
  { id: "copper-comet", name: "Copper Comet", color: 0xf2b134 },
  { id: "bluejay", name: "Bluejay", color: 0x5577d8 },
  { id: "night-spur", name: "Night Spur", color: 0x8e59b7 },
  { id: "greenline", name: "Greenline", color: 0x47a65b },
  { id: "ember-scout", name: "Ember Scout", color: 0xe57637 },
] as const;

export interface EngineHudState {
  position: number;
  fieldSize: number;
  lap: number;
  totalLaps: number;
  elapsedMs: number;
  targetMs: number;
  savedBestMs?: number | undefined;
  heat: number;
  overheated: boolean;
  bikePhase: BikePhase;
  lane: LaneIndex;
  pitch: number;
  wheelie: boolean;
  landing: LandingQuality;
  surface: SimulationState["bike"]["surface"];
  recoveryProgress: number;
  speed: number;
  caption: string;
  hint: string;
  inputDevice: InputDevice;
  fps: number;
  frameTimeMs: number;
  drawCalls: number;
  droppedSimulationMs: number;
  demonstrated: {
    coast: boolean;
    cooling: boolean;
    coolingRelease: boolean;
    laneChange: boolean;
    wheelie: boolean;
    airbornePitch: boolean;
    airbornePitchUp: boolean;
    airbornePitchDown: boolean;
    airborneNeutral: boolean;
    cleanLanding: boolean;
    hazardAvoided: boolean;
    mud: boolean;
    grass: boolean;
    crash: boolean;
    recovery: boolean;
  };
}

export interface GameEngineOptions {
  canvas: HTMLCanvasElement;
  trackId: TrackDefinition["id"];
  mode: RaceMode;
  settings: GameSettings;
  existingBestMs?: number | undefined;
  masteryLevel?: number | undefined;
  customTrack?: CustomTrackData | undefined;
  onHud: (state: EngineHudState) => void;
  onFinish: (result: RaceResult, replaySamples: Uint8Array) => void;
  onFatal: (message: string) => void;
}

interface AiRider {
  riderId: string;
  riderName: string;
  group: THREE.Group;
  behavior: AiBehavior;
  simulation: RaceSimulation;
  targetLane: LaneIndex;
  previousLaneCommand: LaneChange;
  routeTimerSeconds: number;
  recoveryDelaySeconds: number;
  lastObstacleKey: string;
  finishTimeMs?: number | undefined;
}

interface PerformanceWindow {
  elapsed: number;
  frames: number;
  frameTimeTotal: number;
  fps: number;
  frameTimeMs: number;
}

interface DustParticle {
  mesh: THREE.Mesh;
  life: number;
  drift: number;
}

interface ObstacleMaterials {
  dirt: THREE.MeshStandardMaterial;
  wood: THREE.MeshStandardMaterial;
  warning: THREE.MeshStandardMaterial;
}

interface WorldVisualProfile {
  background: number;
  fog: number;
  fogNear: number;
  fogFar: number;
  hemisphereSky: number;
  hemisphereGround: number;
  hemisphereIntensity: number;
  sun: number;
  sunIntensity: number;
  exposure: number;
  treeDensity: number;
  mesaDensity: number;
  terraceHeight: number;
}

interface CameraPresentationProfile {
  fov: number;
  height: number;
  trailingDistance: number;
  lookHeight: number;
  lookAhead: number;
  laneFollow: number;
  lookAtLaneFollow: number;
  playerScale: number;
}

const CAMERA_PRESENTATION_PROFILES = {
  desktop: {
    fov: 50,
    height: 7.4,
    trailingDistance: 9.1,
    lookHeight: 1,
    lookAhead: 20.5,
    laneFollow: 0.76,
    lookAtLaneFollow: 0.72,
    playerScale: 1.38,
  },
  portrait: {
    fov: 58,
    height: 8.5,
    trailingDistance: 9.8,
    lookHeight: 0.95,
    lookAhead: 18.5,
    laneFollow: 0.92,
    lookAtLaneFollow: 0.9,
    playerScale: 1.62,
  },
} as const satisfies Record<"desktop" | "portrait", CameraPresentationProfile>;

const WORLD_VISUAL_PROFILES = {
  "canyon-kickoff": {
    background: 0x5cbce7,
    fog: 0xe7c8a5,
    fogNear: 105,
    fogFar: 340,
    hemisphereSky: 0xe1f7ff,
    hemisphereGround: 0x6c3525,
    hemisphereIntensity: 1.65,
    sun: 0xffd6a0,
    sunIntensity: 3.45,
    exposure: 1.15,
    treeDensity: 1,
    mesaDensity: 2.05,
    terraceHeight: 1.55,
  },
  "pine-run": {
    background: 0x77c9de,
    fog: 0xc5d8c5,
    fogNear: 82,
    fogFar: 292,
    hemisphereSky: 0xe5fbff,
    hemisphereGround: 0x274431,
    hemisphereIntensity: 1.55,
    sun: 0xffdfb0,
    sunIntensity: 3.15,
    exposure: 1.13,
    treeDensity: 1.35,
    mesaDensity: 0.34,
    terraceHeight: 1,
  },
  "coastline-clash": {
    background: 0x55cbe4,
    fog: 0xdce9d6,
    fogNear: 100,
    fogFar: 340,
    hemisphereSky: 0xe8ffff,
    hemisphereGround: 0x54715e,
    hemisphereIntensity: 1.65,
    sun: 0xffe5b5,
    sunIntensity: 3.3,
    exposure: 1.17,
    treeDensity: 0.42,
    mesaDensity: 0.35,
    terraceHeight: 0.55,
  },
  "foundry-flight": {
    background: 0x6e9fac,
    fog: 0xb6a093,
    fogNear: 68,
    fogFar: 252,
    hemisphereSky: 0xdcecf1,
    hemisphereGround: 0x402d2a,
    hemisphereIntensity: 1.25,
    sun: 0xffbb78,
    sunIntensity: 3.6,
    exposure: 1.12,
    treeDensity: 0.16,
    mesaDensity: 0.12,
    terraceHeight: 0.78,
  },
  "summit-showdown": {
    background: 0x7887aa,
    fog: 0xaab0c6,
    fogNear: 66,
    fogFar: 272,
    hemisphereSky: 0xdbe9ff,
    hemisphereGround: 0x443e55,
    hemisphereIntensity: 1.35,
    sun: 0xffd49e,
    sunIntensity: 3,
    exposure: 1.08,
    treeDensity: 0.55,
    mesaDensity: 0.12,
    terraceHeight: 1.35,
  },
} as const satisfies Record<TrackDefinition["id"], WorldVisualProfile>;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function resolveQuality(setting: GameSettings["quality"]): Exclude<GameSettings["quality"], "auto"> {
  if (setting !== "auto") return setting;
  const navigatorWithMemory = navigator as Navigator & { deviceMemory?: number };
  const constrained = (navigatorWithMemory.deviceMemory ?? 8) <= 4
    || navigator.hardwareConcurrency <= 4
    || window.matchMedia("(pointer: coarse)").matches;
  if (constrained) return "low";
  return window.devicePixelRatio > 1.5 ? "medium" : "high";
}

const rendererByCanvas = new WeakMap<HTMLCanvasElement, THREE.WebGLRenderer>();

function acquireRenderer(
  canvas: HTMLCanvasElement,
  quality: Exclude<GameSettings["quality"], "auto">,
): THREE.WebGLRenderer {
  const retainedRenderer = rendererByCanvas.get(canvas);
  if (retainedRenderer) return retainedRenderer;
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: quality !== "low",
    alpha: false,
    powerPreference: "high-performance",
  });
  rendererByCanvas.set(canvas, renderer);
  return renderer;
}

function releaseRenderer(
  canvas: HTMLCanvasElement,
  renderer: THREE.WebGLRenderer,
  context: WebGLRenderingContext,
): void {
  if (rendererByCanvas.get(canvas) === renderer) rendererByCanvas.delete(canvas);
  renderer.dispose();
  renderer.forceContextLoss();
  releaseWebglContext(context);
}

function disposeObjectResources(
  root: THREE.Object3D,
  additionalTextures: readonly THREE.Texture[] = [],
): void {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>(additionalTextures);
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    geometries.add(object.geometry);
    const objectMaterials = Array.isArray(object.material) ? object.material : [object.material];
    objectMaterials.forEach((material) => materials.add(material));
  });
  for (const material of materials) {
    for (const value of Object.values(material)) {
      if (value instanceof THREE.Texture) textures.add(value);
    }
    material.dispose();
  }
  geometries.forEach((geometry) => geometry.dispose());
  textures.forEach((texture) => texture.dispose());
}

function disposeShadowRenderTargets(light: THREE.DirectionalLight | null): void {
  if (!light) return;
  light.shadow.dispose();
  light.shadow.map = null;
  light.shadow.mapPass = null;
}

function masteryTarget(baseTargetMs: number, masteryLevel: number): number {
  return Math.round(baseTargetMs * Math.max(0.8, 0.94 - masteryLevel * 0.025));
}

function makeMaterial(color: number, roughness = 0.78): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, roughness, metalness: 0.03, flatShading: true });
}

function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1_664_525 + 1_013_904_223) >>> 0;
    return state / 0xffffffff;
  };
}

const TERRAIN_MARK_BATCH_SIZE = 128;
// Five launch palettes, each with one grass and one dirt canvas.
const MAX_TERRAIN_CANVAS_CACHE_ENTRIES = 10;
const terrainCanvasCache = new Map<string, HTMLCanvasElement>();

function paintTerrainBaseDaubs(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  base: THREE.Color,
  mark: THREE.Color,
  random: () => number,
): void {
  // Broad translucent daubs break up flat tiling before the small surface marks.
  for (let index = 0; index < 180; index += 1) {
    const tone = base.clone().lerp(index % 3 === 0 ? mark : new THREE.Color(0xffffff), 0.08 + random() * 0.08);
    context.fillStyle = `#${tone.getHexString()}`;
    context.globalAlpha = 0.08 + random() * 0.12;
    context.beginPath();
    context.ellipse(
      random() * width,
      random() * height,
      4 + random() * 24,
      7 + random() * 36,
      random() * Math.PI,
      0,
      Math.PI * 2,
    );
    context.fill();
  }
}

function paintDirtMarks(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  random: () => number,
  count: number,
): void {
  for (let index = 0; index < count; index += 1) {
    const x = random() * width;
    const y = random() * height;
    context.lineWidth = 0.45 + random() * 1.4;
    context.beginPath();
    context.moveTo(x, y);
    context.lineTo(x + (random() - 0.5) * 9, y + 3 + random() * 13);
    context.stroke();
  }
}

function paintGrassMarks(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  random: () => number,
  count: number,
): void {
  for (let index = 0; index < count; index += 1) {
    const x = random() * width;
    const y = random() * height;
    context.fillRect(x, y, 1 + random() * 2.5, 3 + random() * 8);
  }
}

function paintDirtLanes(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  mark: THREE.Color,
): void {
  // Bake the four-lane hierarchy and paired wheel ruts into one texture so the
  // track reads clearly without adding one draw call per line or rut.
  const laneEdges = [0.025, 0.25, 0.5, 0.75, 0.975];
  context.lineCap = "round";
  for (const [index, ratio] of laneEdges.entries()) {
    context.strokeStyle = index === 0 || index === laneEdges.length - 1 ? "#f7c94b" : "#ead9ae";
    context.globalAlpha = index === 0 || index === laneEdges.length - 1 ? 0.86 : 0.58;
    context.lineWidth = index === 0 || index === laneEdges.length - 1 ? 5 : 2.5;
    context.beginPath();
    context.moveTo(width * ratio, 0);
    context.lineTo(width * ratio, height);
    context.stroke();
  }

  context.strokeStyle = `#${mark.clone().multiplyScalar(0.68).getHexString()}`;
  context.globalAlpha = 0.46;
  context.lineWidth = 6.5;
  for (const center of [0.1375, 0.375, 0.625, 0.8625]) {
    for (const offset of [-0.025, 0.025]) {
      context.beginPath();
      context.moveTo(width * (center + offset), 0);
      for (let y = 0; y <= height; y += 32) {
        const wobble = Math.sin(y * 0.033 + center * 19) * 2.2;
        context.lineTo(width * (center + offset) + wobble, y);
      }
      context.stroke();
    }

    context.globalAlpha = 0.3;
    context.lineWidth = 1.5;
    for (let y = 7; y < height; y += 17) {
      const wobble = Math.sin(y * 0.041 + center * 23) * 2.2;
      context.beginPath();
      context.moveTo(width * center - 7 + wobble, y);
      context.lineTo(width * center + 7 + wobble, y + 3);
      context.stroke();
    }
    context.globalAlpha = 0.46;
    context.lineWidth = 6.5;
  }
}

function createTerrainCanvas(
  baseColor: number,
  markColor: number,
  seed: number,
  kind: "dirt" | "grass",
): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = kind === "dirt" ? 512 : 256;
  canvas.height = 512;
  const context = canvas.getContext("2d");
  if (context) {
    const random = seededRandom(seed);
    const width = canvas.width;
    const height = canvas.height;
    const base = new THREE.Color(baseColor);
    const mark = new THREE.Color(markColor);
    context.fillStyle = `#${base.getHexString()}`;
    context.fillRect(0, 0, width, height);

    paintTerrainBaseDaubs(context, width, height, base, mark, random);

    context.strokeStyle = `#${mark.getHexString()}`;
    context.fillStyle = context.strokeStyle;
    context.globalAlpha = kind === "dirt" ? 0.3 : 0.23;
    const markCount = kind === "dirt" ? 1_100 : 760;
    // Small calls retain the dense deterministic pattern without presenting one
    // large hot loop to JavaScriptCore during the first terrain paint.
    for (let offset = 0; offset < markCount; offset += TERRAIN_MARK_BATCH_SIZE) {
      const count = Math.min(TERRAIN_MARK_BATCH_SIZE, markCount - offset);
      if (kind === "dirt") paintDirtMarks(context, width, height, random, count);
      else paintGrassMarks(context, width, height, random, count);
    }

    if (kind === "dirt") paintDirtLanes(context, width, height, mark);
    context.globalAlpha = 1;
  }
  return canvas;
}

function createTerrainTexture(
  baseColor: number,
  markColor: number,
  seed: number,
  kind: "dirt" | "grass",
): THREE.CanvasTexture {
  const cacheKey = `${kind}:${baseColor}:${markColor}:${seed}`;
  let canvas = terrainCanvasCache.get(cacheKey);
  if (!canvas) {
    canvas = createTerrainCanvas(baseColor, markColor, seed, kind);
    if (terrainCanvasCache.size >= MAX_TERRAIN_CANVAS_CACHE_ENTRIES) {
      const oldestKey = terrainCanvasCache.keys().next().value;
      if (oldestKey !== undefined) terrainCanvasCache.delete(oldestKey);
    }
    terrainCanvasCache.set(cacheKey, canvas);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  return texture;
}

function createRampGeometry(width: number, height: number, depth: number): THREE.BufferGeometry {
  const halfWidth = width / 2;
  const halfDepth = depth / 2;
  const positions = new Float32Array([
    -halfWidth, 0, halfDepth,
    halfWidth, 0, halfDepth,
    halfWidth, 0, -halfDepth,
    -halfWidth, 0, -halfDepth,
    -halfWidth, 0.035, halfDepth,
    halfWidth, 0.035, halfDepth,
    halfWidth, height, -halfDepth,
    -halfWidth, height, -halfDepth,
  ]);
  const indices = [
    0, 1, 5, 0, 5, 4,
    3, 7, 6, 3, 6, 2,
    0, 4, 7, 0, 7, 3,
    1, 2, 6, 1, 6, 5,
    4, 5, 6, 4, 6, 7,
    0, 3, 2, 0, 2, 1,
  ];
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function createCurvedCourseGeometry(
  width: number,
  length: number,
  direction: -1 | 1,
  bankHeight: number,
): THREE.BufferGeometry {
  const angle = 0.56;
  const radius = length / angle;
  const positions: number[] = [];
  const indices: number[] = [];
  for (let index = 0; index <= 10; index += 1) {
    const theta = -angle / 2 + (index / 10) * angle;
    const centerX = direction * radius * (1 - Math.cos(theta));
    const centerZ = radius * Math.sin(theta);
    const normalX = Math.cos(theta);
    const normalZ = -direction * Math.sin(theta);
    const leftHeight = bankHeight > 0 && direction > 0 ? bankHeight : 0;
    const rightHeight = bankHeight > 0 && direction < 0 ? bankHeight : 0;
    positions.push(
      centerX + normalX * width / 2,
      leftHeight,
      centerZ + normalZ * width / 2,
      centerX - normalX * width / 2,
      rightHeight,
      centerZ - normalZ * width / 2,
    );
    if (index < 10) {
      const left = index * 2;
      indices.push(left, left + 1, left + 2, left + 2, left + 1, left + 3);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function createCoolingGateGeometry(): THREE.ShapeGeometry {
  const shape = new THREE.Shape();
  shape.moveTo(-1.46, 0);
  shape.lineTo(-1.46, 1.72);
  shape.lineTo(-1.02, 2.46);
  shape.lineTo(1.02, 2.46);
  shape.lineTo(1.46, 1.72);
  shape.lineTo(1.46, 0);
  shape.closePath();
  const opening = new THREE.Path();
  opening.moveTo(-1.12, 0.27);
  opening.lineTo(1.12, 0.27);
  opening.lineTo(1.12, 1.58);
  opening.lineTo(0.78, 2.1);
  opening.lineTo(-0.78, 2.1);
  opening.lineTo(-1.12, 1.58);
  opening.closePath();
  shape.holes.push(opening);
  return new THREE.ShapeGeometry(shape);
}

function createCoolingSnowflake(): THREE.InstancedMesh {
  const snowflake = new THREE.InstancedMesh(
    new THREE.BoxGeometry(1, 0.075, 0.055),
    new THREE.MeshBasicMaterial({ color: 0xf8ffff, toneMapped: false }),
    15,
  );
  const matrix = new THREE.Matrix4();
  const rotation = new THREE.Quaternion();
  let instance = 0;

  for (const angle of [0, Math.PI / 3, (Math.PI * 2) / 3]) {
    rotation.setFromEuler(new THREE.Euler(0, 0, angle));
    matrix.compose(
      new THREE.Vector3(),
      rotation,
      new THREE.Vector3(1.12, 1, 1),
    );
    snowflake.setMatrixAt(instance, matrix);
    instance += 1;
  }

  for (let arm = 0; arm < 6; arm += 1) {
    const angle = arm * Math.PI / 3;
    const center = new THREE.Vector3(Math.cos(angle) * 0.38, Math.sin(angle) * 0.38, 0);
    for (const branchDirection of [-1, 1]) {
      rotation.setFromEuler(new THREE.Euler(0, 0, angle + branchDirection * 0.7));
      matrix.compose(center, rotation, new THREE.Vector3(0.3, 1, 1));
      snowflake.setMatrixAt(instance, matrix);
      instance += 1;
    }
  }

  snowflake.name = "cooling-gate-snowflake-cue";
  snowflake.instanceMatrix.needsUpdate = true;
  snowflake.castShadow = false;
  snowflake.receiveShadow = false;
  return snowflake;
}

function makeBox(
  width: number,
  height: number,
  depth: number,
  material: THREE.Material,
): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function setShadow(group: THREE.Object3D): void {
  group.traverse((object) => {
    if (object instanceof THREE.Mesh) {
      object.castShadow = true;
      object.receiveShadow = true;
    }
  });
}

function laneMatches(obstacle: TrackObstacle, lane: number): boolean {
  return obstacle.lanes.includes(lane as LaneIndex);
}

function scaleAuthoredTransform<T extends AuthoredPlacementTransform>(
  placement: T,
  scale: number,
): T {
  return {
    ...placement,
    distance: placement.distance * scale,
    length: Math.max(1, placement.length * scale),
    unrotatedLength: Math.max(1, placement.unrotatedLength * scale),
  } as T;
}

function qaTrack(track: TrackDefinition, mode: RaceMode): TrackDefinition {
  if (mode === "tutorial") {
    return {
      ...track,
      // Keep the guided obstacle sequence compact while leaving ample route
      // beyond it so the race finish cannot bypass the required quiz.
      courseLength: 1_200,
      soloTargetMs: 30_000,
      parTimeMs: 24_000,
      obstacles: [
        { id: "qa-cooling", kind: "cooling-gate", distance: 190, lanes: [0, 1, 2, 3], length: 18 },
        { id: "qa-bump", kind: "bump", distance: 240, lanes: [0, 1, 2, 3], length: 10 },
        { id: "qa-ramp", kind: "medium-ramp", distance: 280, lanes: [0, 1, 2, 3], length: 18, rampImpulse: 12 },
        { id: "qa-choice-barrier", kind: "barrier", distance: 380, lanes: [1, 2], length: 6 },
        { id: "qa-mud", kind: "mud", distance: 440, lanes: [0, 3], length: 30 },
        { id: "qa-grass", kind: "grass", distance: 500, lanes: [0, 1, 2, 3], length: 22 },
        { id: "qa-recovery-barrier", kind: "barrier", distance: 560, lanes: [0, 1, 2, 3], length: 6 },
      ],
    };
  }
  if (import.meta.env.VITE_QA_MODE !== "1") return track;
  if (!new URLSearchParams(window.location.search).has("qa-fast-race")) return track;
  const scale = 84 / track.courseLength;
  const authoredCourse = track.authoredCourse;
  return {
    ...track,
    courseLength: 84,
    soloTargetMs: 18_000,
    parTimeMs: 14_000,
    obstacles: track.obstacles.map((obstacle) => ({
      ...obstacle,
      distance: Math.max(6, obstacle.distance * scale),
      ...(obstacle.length === undefined ? {} : { length: Math.max(3, obstacle.length * scale) }),
      ...(obstacle.unrotatedLength === undefined
        ? {}
        : { unrotatedLength: Math.max(1, obstacle.unrotatedLength * scale) }),
    })),
    ...(authoredCourse
      ? {
          authoredCourse: {
            start: scaleAuthoredTransform(authoredCourse.start, scale),
            checkpoints: authoredCourse.checkpoints.map((checkpoint) => (
              scaleAuthoredTransform(checkpoint, scale)
            )),
            finish: scaleAuthoredTransform(authoredCourse.finish, scale),
            trackPieces: authoredCourse.trackPieces.map((piece) => (
              scaleAuthoredTransform(piece, scale)
            )),
          },
        }
      : {}),
  };
}

export class GameEngine {
  readonly input: InputManager;

  private readonly canvas: HTMLCanvasElement;
  private readonly track: TrackDefinition;
  private readonly visualProfile: WorldVisualProfile;
  private readonly mode: RaceMode;
  private settings: GameSettings;
  private quality: Exclude<GameSettings["quality"], "auto">;
  private readonly existingBestMs: number | undefined;
  private readonly targetMs: number;
  private readonly onHud: (state: EngineHudState) => void;
  private readonly onFinish: (result: RaceResult, replaySamples: Uint8Array) => void;
  private readonly onFatal: (message: string) => void;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(54, 1, 0.1, 420);
  private readonly simulation: RaceSimulation;
  private readonly audio: AudioManager;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly webglContext: WebGLRenderingContext;
  private readonly player: THREE.Group;
  private readonly compressedAssetLoader: CompressedAssetLoader;
  private readonly visualQualificationFreeze: boolean;
  private readonly aiRiders: AiRider[] = [];
  private readonly timer = new THREE.Timer();
  private readonly performanceWindow: PerformanceWindow = {
    elapsed: 0,
    frames: 0,
    frameTimeTotal: 0,
    fps: 0,
    frameTimeMs: 0,
  };
  private readonly cameraTarget = new THREE.Vector3();
  private readonly sunTarget = new THREE.Object3D();
  private readonly dustPool: DustParticle[] = [];
  private readonly ownedTextures: THREE.Texture[] = [];
  private readonly coolingSnowflakes: THREE.InstancedMesh[] = [];
  private sunLight: THREE.DirectionalLight | null = null;
  private highContrastTrackGuides: THREE.InstancedMesh | null = null;

  private animationFrame = 0;
  private resizeObserver: ResizeObserver | null = null;
  private running = false;
  private paused = false;
  private finished = false;
  private hudElapsed = 0;
  private lastBikePhase: BikePhase = "grounded";
  private lastLanding: LandingQuality = null;
  private lastHeatWarning = false;
  private lastOverheated = false;
  private lastObstacleKey = "";
  private readonly handledObstacleKeys = new Set<string>();
  private cameraShake = 0;
  private cameraInitialized = false;
  private readonly replayBytes: number[] = [];
  private lastReplayStep = -6;
  private dustCursor = 0;
  private dustAccumulator = 0;
  private droppedSimulationMs = 0;
  private disposed = false;
  private lifecycleActive = false;
  private contextLostListenerActive = false;
  private crashes = 0;
  private overheats = 0;
  private caption = "Engines ready";
  private captionUntil = 0;
  private hint = "W to ride · Shift for turbo · ← / → to change lanes";
  private readonly demonstrated = {
    coast: false,
    cooling: false,
    coolingRelease: false,
    laneChange: false,
    wheelie: false,
    airbornePitch: false,
    airbornePitchUp: false,
    airbornePitchDown: false,
    airborneNeutral: false,
    cleanLanding: false,
    hazardAvoided: false,
    mud: false,
    grass: false,
    crash: false,
    recovery: false,
  };

  constructor(options: GameEngineOptions) {
    this.canvas = options.canvas;
    this.visualQualificationFreeze = import.meta.env.VITE_QA_MODE === "1"
      && new URLSearchParams(window.location.search).has("qa-visual-freeze");
    this.canvas.dataset.bikeAsset = "loading";
    this.canvas.dataset.visualState = this.visualQualificationFreeze ? "loading" : "live";
    this.track = qaTrack(
      options.customTrack
        ? customTrackToDefinition(options.customTrack)
        : getTrack(options.trackId),
      options.mode,
    );
    this.visualProfile = WORLD_VISUAL_PROFILES[this.track.id];
    this.mode = options.mode;
    this.settings = options.settings;
    this.quality = resolveQuality(options.settings.quality);
    this.existingBestMs = options.existingBestMs;
    this.targetMs = options.mode === "mastery"
      ? masteryTarget(this.track.soloTargetMs, options.masteryLevel ?? 0)
      : this.track.soloTargetMs;
    this.onHud = options.onHud;
    this.onFinish = options.onFinish;
    this.onFatal = options.onFatal;
    this.simulation = new RaceSimulation({
      checkpointCount: this.track.authoredCourse?.checkpoints.length ?? 3,
      totalLaps: options.customTrack?.laps ?? 2,
      initialHeat: options.mode === "mastery" ? Math.min(65, 35 + (options.masteryLevel ?? 0) * 5) : 0,
      retroRecovery: options.settings.controls.retroRecovery,
      ...(options.mode === "tutorial" ? { wheelieCrashSeconds: 6 } : {}),
    });
    this.input = new InputManager(options.settings.controls);
    this.audio = new AudioManager(options.settings.audio);

    try {
      this.renderer = acquireRenderer(this.canvas, this.quality);
    } catch {
      throw new Error("WebGL could not be initialized on this browser or device.");
    }

    this.webglContext = this.renderer.getContext();
    let compressedAssetLoader: CompressedAssetLoader | null = null;
    try {
      this.renderer.outputColorSpace = THREE.SRGBColorSpace;
      this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
      this.renderer.toneMappingExposure = this.visualProfile.exposure;
      this.renderer.shadowMap.enabled = this.quality !== "low";
      this.renderer.shadowMap.type = THREE.PCFShadowMap;
      compressedAssetLoader = createCompressedAssetLoader(this.renderer);
      this.compressedAssetLoader = compressedAssetLoader;
      this.scene.background = new THREE.Color(this.visualProfile.background);
      this.scene.fog = new THREE.Fog(
        this.visualProfile.fog,
        this.visualProfile.fogNear,
        this.visualProfile.fogFar,
      );

      this.player = this.createBike(PLAYER_COLOR, PLAYER_ACCENT, true);
      this.player.scale.setScalar(1.3);
      this.scene.add(this.player);
      this.createWorld();
      this.createDustPool();
      this.createAiField();
      this.applyQaVisualDistance();
      this.applyRendererAccessibility();
      this.resize();
      startLifecycleResource("gameEngines");
      observeWebglContext(this.webglContext);
      this.lifecycleActive = true;
    } catch (error) {
      this.disposed = true;
      compressedAssetLoader?.dispose();
      this.audio.dispose();
      disposeObjectResources(this.scene, this.ownedTextures);
      disposeShadowRenderTargets(this.sunLight);
      releaseRenderer(this.canvas, this.renderer, this.webglContext);
      throw error;
    }
    void this.loadCompressedPlayerBike();
  }

  start(): void {
    if (this.running || this.disposed) return;
    this.running = true;
    this.input.connect();
    this.resizeObserver = new ResizeObserver(this.resize);
    this.resizeObserver.observe(this.canvas);
    this.canvas.addEventListener("webglcontextlost", this.handleContextLost);
    this.contextLostListenerActive = true;
    startLifecycleResource("contextLossListeners");
    window.addEventListener("pointerdown", this.unlockAudio, { once: true });
    window.addEventListener("keydown", this.unlockAudio, { once: true });
    this.timer.connect(document);
    this.timer.reset();
    this.animationFrame = requestAnimationFrame(this.frame);
    startLifecycleResource("engineRenderLoops");
  }

  setPaused(paused: boolean): void {
    if (this.disposed || this.paused === paused) return;
    this.paused = paused;
    this.audio.setPaused(paused);
    if (paused) this.input.suspend();
    else this.timer.reset();
  }

  updateSettings(settings: GameSettings): void {
    this.settings = settings;
    this.input.updateSettings(settings.controls);
    this.audio.updateSettings(settings.audio);
    this.applyRendererAccessibility();
    const quality = resolveQuality(settings.quality);
    if (quality !== this.quality) {
      this.quality = quality;
      this.renderer.shadowMap.enabled = quality !== "low";
      this.resize();
    }
  }

  private applyRendererAccessibility(): void {
    if (this.highContrastTrackGuides) {
      this.highContrastTrackGuides.visible = this.settings.accessibility.highContrast;
    }
    const visibleGuides = this.highContrastTrackGuides?.visible === true;
    const guideCount = this.highContrastTrackGuides?.count ?? 0;
    const coolingCueCount = this.coolingSnowflakes.filter((cue) => cue.parent !== null).length;
    this.canvas.dataset.highContrastTrackGuides = String(visibleGuides);
    this.canvas.dataset.trackGuideCount = String(guideCount);
    this.canvas.dataset.coolingSnowflakeCount = String(coolingCueCount);
    this.canvas.dataset.coolingCueShape = coolingCueCount > 0 ? "snowflake" : "none";
  }

  async unlockSound(): Promise<void> {
    await this.audio.unlock();
    this.audio.startEngine();
  }

  dispose({ retainRenderer = false }: { retainRenderer?: boolean } = {}): void {
    if (this.disposed) return;
    const wasRunning = this.running;
    this.disposed = true;
    this.running = false;
    cancelAnimationFrame(this.animationFrame);
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.input.disconnect();
    this.audio.dispose();
    this.compressedAssetLoader.dispose();
    this.timer.dispose();
    this.canvas.removeEventListener("webglcontextlost", this.handleContextLost);
    if (this.contextLostListenerActive) {
      this.contextLostListenerActive = false;
      stopLifecycleResource("contextLossListeners");
    }
    window.removeEventListener("pointerdown", this.unlockAudio);
    window.removeEventListener("keydown", this.unlockAudio);
    disposeObjectResources(this.scene, this.ownedTextures);
    disposeShadowRenderTargets(this.sunLight);
    if (!retainRenderer) {
      releaseRenderer(this.canvas, this.renderer, this.webglContext);
    } else {
      this.renderer.renderLists.dispose();
      this.renderer.state.reset();
    }
    if (wasRunning) stopLifecycleResource("engineRenderLoops");
    if (this.lifecycleActive) {
      this.lifecycleActive = false;
      stopLifecycleResource("gameEngines");
    }
  }

  private readonly unlockAudio = (): void => {
    void this.unlockSound();
  };

  private readonly handleContextLost = (event: Event): void => {
    event.preventDefault();
    this.onFatal("The graphics context was lost. Reload the race to recover.");
  };

  private async loadCompressedPlayerBike(): Promise<void> {
    try {
      if (import.meta.env.VITE_QA_MODE === "1" && new URLSearchParams(window.location.search).has("qa-asset-failure")) {
        throw new Error("QA asset failure");
      }
      const gltf = await this.compressedAssetLoader.load(FESTIVAL_TRAIL_BIKE_URL);
      if (this.disposed) {
        disposeObjectResources(gltf.scene);
        return;
      }
      const compressedBike = gltf.scene;
      compressedBike.name = "compressed-festival-trail-bike";
      compressedBike.position.y = -0.62;
      compressedBike.scale.setScalar(1.04);
      setShadow(compressedBike);
      const previousBike = this.player.userData.bikeVisual as THREE.Object3D | undefined;
      if (previousBike) previousBike.visible = false;
      this.player.add(compressedBike);
      this.player.userData.bikeVisual = compressedBike;
      const frontWheel = compressedBike.getObjectByName("FrontTire");
      const backWheel = compressedBike.getObjectByName("RearTire");
      if (frontWheel) this.player.userData.frontWheel = frontWheel;
      if (backWheel) this.player.userData.backWheel = backWheel;
      this.canvas.dataset.bikeAsset = "ready";
    } catch {
      if (this.disposed) return;
      this.canvas.dataset.bikeAsset = "fallback";
      this.caption = "Compressed bike unavailable — safe built-in model active";
      this.captionUntil = 6;
      this.emitHud(this.simulation.snapshot);
    }
  }

  private readonly resize = (): void => {
    const width = Math.max(1, this.canvas.clientWidth);
    const height = Math.max(1, this.canvas.clientHeight);
    const presentation = width < 680
      ? CAMERA_PRESENTATION_PROFILES.portrait
      : CAMERA_PRESENTATION_PROFILES.desktop;
    const qualityRatio = this.quality === "low" ? 1 : this.quality === "medium" ? 1.35 : 2;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, qualityRatio));
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.fov = presentation.fov;
    this.camera.updateProjectionMatrix();
    this.player.scale.setScalar(presentation.playerScale);
  };

  private readonly frame = (): void => {
    if (!this.running) return;
    const frameStart = performance.now();
    this.timer.update();
    const measuredDelta = this.timer.getDelta();
    if (
      !this.visualQualificationFreeze
      && !this.paused
      && !this.finished
      && Number.isFinite(measuredDelta)
      && measuredDelta > MAX_DELTA_SECONDS
    ) {
      this.droppedSimulationMs += (measuredDelta - MAX_DELTA_SECONDS) * 1_000;
    }
    const delta = Number.isFinite(measuredDelta)
      ? clamp(measuredDelta, 0, MAX_DELTA_SECONDS)
      : 0;

    if (!this.visualQualificationFreeze && !this.paused && !this.finished) {
      this.update(delta);
    }
    const renderDelta = this.visualQualificationFreeze ? 0 : delta;
    this.render(renderDelta);
    if (this.visualQualificationFreeze) {
      this.canvas.dataset.visualState = "frozen";
    } else {
      this.capturePerformance(delta, performance.now() - frameStart);
    }
    this.animationFrame = requestAnimationFrame(this.frame);
  };

  private update(delta: number): void {
    const input = this.input.sample();
    const before = this.simulation.snapshot;
    const environment = this.sampleEnvironment(before);
    const fixedSteps = this.simulation.advance(delta, input, environment);
    const state = this.simulation.snapshot;

    this.processTrackEvents(before, state);
    this.processBikeEvents(state);
    this.captureDemonstratedMechanics(before, state, input);
    this.updateAi(fixedSteps, state);
    if (this.simulation.snapshot.race.finished) this.finishRace();
    this.updateDust(delta, state);
    this.captureReplay(state);
    this.audio.updateEngine(state.bike.speed, input.turbo, state.bike.surface);
    this.hudElapsed += delta;
    if (this.hudElapsed >= 0.08) {
      this.hudElapsed = 0;
      this.emitHud(state);
    }
  }

  private render(delta: number): void {
    const state = this.simulation.snapshot;
    const bike = state.bike;
    const reducedMotion = this.settings.accessibility.reducedMotion;
    const wheelSpin = delta * bike.speed * 1.7;
    const localDistance = bike.forwardPosition % this.track.courseLength;
    const playerRouteHeight = this.authoredRouteHeight(localDistance, bike.lanePosition);

    this.player.position.set(bike.lanePosition, 0.72 + playerRouteHeight + bike.height, -bike.forwardPosition);
    this.player.rotation.x = bike.pitch;
    this.player.rotation.z = bike.phase === "crashed" ? -1.05 : 0;
    this.player.userData.frontWheel.rotation.x -= wheelSpin;
    this.player.userData.backWheel.rotation.x -= wheelSpin;

    for (const ai of this.aiRiders) {
      const bike = ai.simulation.snapshot.bike;
      const crashed = bike.phase === "crashed";
      const routeHeight = this.authoredRouteHeight(
        bike.forwardPosition % this.track.courseLength,
        bike.lanePosition,
      );
      ai.group.position.set(bike.lanePosition, 0.72 + routeHeight + bike.height, -bike.forwardPosition);
      ai.group.rotation.x = bike.pitch;
      ai.group.rotation.z = crashed ? -1.05 : 0;
      ai.group.visible = true;
      if (!crashed) {
        ai.group.userData.frontWheel.rotation.x -= delta * bike.speed * 1.7;
        ai.group.userData.backWheel.rotation.x -= delta * bike.speed * 1.7;
      }
    }

    const portrait = this.canvas.clientWidth < 680;
    const presentation = portrait
      ? CAMERA_PRESENTATION_PROFILES.portrait
      : CAMERA_PRESENTATION_PROFILES.desktop;
    const speedLift = reducedMotion ? 0 : clamp(bike.speed / 20, 0, 1) * 0.58;
    const targetCamera = this.cameraTarget.set(
      bike.lanePosition * presentation.laneFollow,
      presentation.height + playerRouteHeight + speedLift,
      -bike.forwardPosition + presentation.trailingDistance,
    );
    if (this.cameraShake > 0 && !this.settings.accessibility.reducedShake) {
      const pulse = Math.sin(state.timeSeconds * 91) * this.cameraShake;
      targetCamera.x += pulse * 0.55;
      targetCamera.y += Math.abs(pulse) * 0.28;
      this.cameraShake = Math.max(0, this.cameraShake - delta * 1.8);
    } else {
      this.cameraShake = 0;
    }
    if (!this.cameraInitialized) {
      this.camera.position.copy(targetCamera);
      this.cameraInitialized = true;
    } else {
      const cameraBlend = reducedMotion ? 1 : 1 - Math.exp(-delta * 6.5);
      this.camera.position.lerp(targetCamera, cameraBlend);
    }
    this.camera.lookAt(
      bike.lanePosition * presentation.lookAtLaneFollow,
      presentation.lookHeight + playerRouteHeight + bike.height * 0.2,
      -bike.forwardPosition - presentation.lookAhead,
    );
    if (this.sunLight) {
      this.sunLight.position.z = -bike.forwardPosition + 24;
      this.sunTarget.position.z = -bike.forwardPosition - 18;
      this.sunTarget.updateMatrixWorld();
    }
    this.renderer.render(this.scene, this.camera);
  }

  private authoredRouteHeight(localDistance: number, lateralPosition: number): number {
    const pieces = this.track.authoredCourse?.trackPieces;
    if (!pieces) return 0;
    const piece = pieces
      .filter((candidate) => (
        Math.abs(localDistance - candidate.distance) <= candidate.length / 2
        && Math.abs(lateralPosition - candidate.lateralPosition) <= candidate.width / 2
      ))
      .sort((first, second) => (
        Math.abs(localDistance - first.distance) - Math.abs(localDistance - second.distance)
      ))[0];
    if (!piece) return 0;
    if (piece.kind !== "bank-left" && piece.kind !== "bank-right") return piece.height;
    if (piece.rotation === 90 || piece.rotation === 270) return piece.height + 0.425;
    const direction = piece.kind === "bank-left" ? -1 : 1;
    const facing = piece.rotation === 180 ? -direction : direction;
    const across = clamp(
      (lateralPosition - piece.lateralPosition) / Math.max(0.01, piece.width / 2),
      -1,
      1,
    );
    return piece.height + (1 + facing * across) * 0.425;
  }

  private obstaclePolicy(obstacle?: TrackObstacle): AiObstaclePolicy {
    const policy = getObstaclePolicy(obstacle?.kind);
    if (!obstacle || !isRampObstacle(obstacle.kind)) return policy;
    if (obstacle.rotation === 180) {
      return {
        environment: { surface: "dirt" },
        avoidable: true,
        crashesOnContact: true,
        retainedSpeed: 1,
      };
    }
    if (obstacle.rotation === 90 || obstacle.rotation === 270) {
      return {
        environment: { surface: "dirt" },
        avoidable: false,
        crashesOnContact: false,
        retainedSpeed: 0.78,
      };
    }
    return obstacle.rampImpulse === undefined
      ? policy
      : { ...policy, environment: { surface: "ramp", rampImpulse: obstacle.rampImpulse } };
  }

  private sampleEnvironment(state: SimulationState): SimulationEnvironment {
    const local = state.bike.forwardPosition % this.track.courseLength;
    const obstacle = this.nearestObstacle(local, state.bike.lane, state.bike.height);
    if (!obstacle) return { surface: "dirt" };
    const key = `${Math.floor(state.bike.forwardPosition / this.track.courseLength)}:${obstacle.id}`;

    if (obstacle.kind === "cooling-gate" && key !== this.lastObstacleKey) {
      this.captionEvent("Cooling gate — heat dropped", "cooling");
      this.lastObstacleKey = key;
    }
    return this.obstaclePolicy(obstacle).environment;
  }

  private nearestObstacle(
    localDistance: number,
    lane: number,
    bikeHeight = 0,
  ): TrackObstacle | undefined {
    return this.track.obstacles.find((obstacle) => {
      if (!laneMatches(obstacle, lane)) return false;
      const halfLength = Math.max(3.5, (obstacle.length ?? 8) / 2);
      if (Math.abs(localDistance - obstacle.distance) > halfLength) return false;
      if (obstacle.height === undefined) return true;
      const routeHeight = this.authoredRouteHeight(localDistance, LANE_POSITIONS[lane as LaneIndex]);
      return Math.abs(routeHeight + bikeHeight - obstacle.height) <= 1.25;
    });
  }

  private processTrackEvents(before: SimulationState, state: SimulationState): void {
    const start = before.bike.forwardPosition;
    const end = state.bike.forwardPosition;
    const course = this.track.courseLength;
    const lapIndex = Math.floor(end / course);
    const lapStart = lapIndex * course;
    const checkpoints = this.track.authoredCourse?.checkpoints.map((checkpoint) => checkpoint.distance)
      ?? [course * 0.25, course * 0.5, course * 0.75];

    checkpoints.forEach((distance, index) => {
      const absolute = lapStart + distance;
      if (start < absolute && end >= absolute && this.simulation.markCheckpoint(index)) {
        this.captionEvent(`Checkpoint ${index + 1} of ${checkpoints.length}`, "checkpoint");
      }
    });

    const finishDistance = (Math.floor(start / course) + 1) * course;
    if (start < finishDistance && end >= finishDistance && this.simulation.crossFinishLine()) {
      const race = this.simulation.snapshot.race;
      if (!race.finished) {
        this.captionEvent("Lap complete — final lap", "crowd");
      }
    }

    for (const candidate of this.track.obstacles) {
      const absolute = lapStart + candidate.distance;
      if (
        start < absolute
        && end >= absolute
        && this.obstaclePolicy(candidate).crashesOnContact
        && !laneMatches(candidate, state.bike.lane)
      ) {
        this.demonstrated.hazardAvoided = true;
      }
    }

    const obstacle = this.nearestObstacle(end % course, state.bike.lane, state.bike.height);
    if (obstacle && state.bike.phase === "grounded") {
      const key = `${lapIndex}:${obstacle.id}`;
      const policy = this.obstaclePolicy(obstacle);
      if (!this.handledObstacleKeys.has(key) && policy.crashesOnContact) {
        this.handledObstacleKeys.add(key);
        this.simulation.forceCrash();
        this.captionEvent("Barrier hit — hold recover", "crash");
      } else if (!this.handledObstacleKeys.has(key) && policy.retainedSpeed < 1) {
        this.handledObstacleKeys.add(key);
        if (state.bike.wheelie) {
          this.captionEvent("Front wheel clear — bump speed held", "landing");
        } else {
          this.simulation.applySpeedPenalty(policy.retainedSpeed);
          this.captionEvent("Bump strike — wheelie next time", "rough-landing");
        }
      }
    }
  }

  private processBikeEvents(state: SimulationState): void {
    const { bike } = state;
    const previousPhase = this.lastBikePhase;
    if (bike.lastLanding && bike.lastLanding !== this.lastLanding) {
      this.captionEvent(
        bike.lastLanding === "clean" ? "Clean landing — speed held" : bike.lastLanding === "rough" ? "Rough landing — rebalance" : "Bad landing — hold recover",
        bike.lastLanding === "clean" ? "landing" : bike.lastLanding === "rough" ? "rough-landing" : "crash",
      );
      if (bike.lastLanding === "crash") this.crashes += 1;
    }
    this.lastLanding = bike.lastLanding;

    if (bike.phase === "crashed" && this.lastBikePhase !== "crashed" && bike.lastLanding !== "crash") {
      this.crashes += 1;
    }
    if (bike.phase === "crashed") this.demonstrated.crash = true;
    if (previousPhase === "recovering" && bike.phase === "grounded") {
      this.demonstrated.recovery = true;
    }
    this.lastBikePhase = bike.phase;

    const heatWarning = bike.heat >= 78 && !bike.overheated;
    if (heatWarning && !this.lastHeatWarning) {
      this.captionEvent("Heat critical — release turbo or find cyan", "overheat");
      void this.input.warnOverheat();
    }
    this.lastHeatWarning = heatWarning;

    if (bike.overheated && !this.lastOverheated) {
      this.overheats += 1;
      this.captionEvent("Overheated — controls return below the recovery mark", "overheat");
    }
    this.lastOverheated = bike.overheated;
  }

  private captureDemonstratedMechanics(
    before: SimulationState,
    state: SimulationState,
    input: SimulationInput,
  ): void {
    this.demonstrated.coast ||= before.bike.speed >= 5
      && !input.throttle
      && !input.turbo
      && state.bike.speed < before.bike.speed;
    this.demonstrated.coolingRelease ||= state.bike.surface === "cooling" && !input.turbo;

    if (state.bike.phase === "airborne") {
      this.demonstrated.airbornePitchUp ||= input.pitch > 0.1;
      this.demonstrated.airbornePitchDown ||= input.pitch < -0.1;
      this.demonstrated.airborneNeutral ||= Math.abs(input.pitch) <= 0.1
        && this.demonstrated.airbornePitchUp
        && this.demonstrated.airbornePitchDown;
    }
  }

  private updateAi(fixedSteps: number, state: SimulationState): void {
    const profile = getAiDifficultyProfile(this.settings.difficulty);
    for (let step = 0; step < fixedSteps; step += 1) {
      for (const [index, ai] of this.aiRiders.entries()) {
        this.stepAi(ai, index, profile, state);
      }
    }
    this.resolveAiCollisions(profile);
  }

  private stepAi(
    ai: AiRider,
    index: number,
    profile: AiDifficultyProfile,
    playerState: SimulationState,
  ): void {
    const beforeState = ai.simulation.snapshot;
    if (ai.finishTimeMs !== undefined || beforeState.race.finished) {
      ai.finishTimeMs ??= Math.round(beforeState.race.elapsedSeconds * 1_000);
      return;
    }
    const bike = beforeState.bike;
    const local = bike.forwardPosition % this.track.courseLength;
    const currentObstacle = this.nearestObstacle(local, bike.lane, bike.height);
    const currentPolicy = this.obstaclePolicy(currentObstacle);
    const aheadObstacle = this.track.obstacles.find((obstacle) => {
      const gap = obstacle.distance - local;
      return gap > 0 && gap < profile.obstacleLookahead && laneMatches(obstacle, bike.lane);
    });
    const aheadCooling = this.track.obstacles.find((obstacle) => {
      const gap = obstacle.distance - local;
      return obstacle.kind === "cooling-gate" && gap > 0 && gap < profile.coolingLookahead;
    });

    if (bike.phase !== "crashed" && bike.phase !== "recovering") {
      ai.routeTimerSeconds -= FIXED_DT;
      if (ai.routeTimerSeconds <= 0) {
        ai.routeTimerSeconds = profile.planningIntervalSeconds + index * 0.035;
        ai.targetLane = chooseAiLane({
          behavior: ai.behavior,
          currentLane: bike.lane,
          riderIndex: index,
          riderProgress: bike.forwardPosition,
          playerLane: playerState.bike.lane,
          playerProgress: playerState.bike.forwardPosition,
          heat: bike.heat,
          profile,
          aheadObstacle,
          aheadCooling,
        });
      }
    }

    const laneChange = getAiLaneChange(bike.lane, ai.targetLane, ai.previousLaneCommand);
    const consistency = getAiConsistency(profile, index);
    const drive = getAiDriveControl({
      speed: bike.speed,
      heat: bike.heat,
      overheated: bike.overheated,
      hasAheadObstacle: aheadObstacle !== undefined,
      consistency,
      profile,
    });
    const aheadGap = aheadObstacle ? aheadObstacle.distance - local : Number.POSITIVE_INFINITY;
    const preparingRamp = isRampObstacle(currentObstacle?.kind)
      || (isRampObstacle(aheadObstacle?.kind) && aheadGap < 8);
    const rawErrorIndex = (index * 7 + Math.floor(bike.forwardPosition / this.track.courseLength)) % 3;
    const errorIndex = (rawErrorIndex + 3) % 3;
    const errorSign = (errorIndex - 1) as -1 | 0 | 1;

    if (bike.phase === "crashed") {
      ai.recoveryDelaySeconds = Math.max(0, ai.recoveryDelaySeconds - FIXED_DT);
    }
    const command: SimulationInput = {
      throttle: drive.throttle,
      turbo: drive.turbo,
      laneChange,
      pitch: getAiPitchControl({
        phase: bike.phase,
        pitch: bike.pitch,
        preparingRamp,
        errorSign,
        profile,
      }),
      recover: bike.phase === "crashed" && ai.recoveryDelaySeconds <= 0,
    };

    ai.previousLaneCommand = laneChange;
    ai.simulation.advance(FIXED_DT, command, currentPolicy.environment);
    const afterState = ai.simulation.snapshot;
    const finishTimeMs = advanceAiRaceProgress(
      ai.simulation,
      this.track.courseLength,
      beforeState.bike.forwardPosition,
      afterState.bike.forwardPosition,
    );
    if (finishTimeMs !== undefined) ai.finishTimeMs = finishTimeMs;
    const after = afterState.bike;
    if (bike.phase !== "crashed" && after.phase === "crashed") {
      ai.recoveryDelaySeconds = profile.recoveryDelaySeconds;
    } else if (after.phase === "grounded" && bike.phase === "recovering") {
      ai.recoveryDelaySeconds = 0;
    }

    if (currentObstacle && bike.phase === "grounded") {
      const key = `${Math.floor(bike.forwardPosition / this.track.courseLength)}:${currentObstacle.id}`;
      if (key !== ai.lastObstacleKey) {
        ai.lastObstacleKey = key;
        if (currentPolicy.crashesOnContact) {
          this.crashAi(ai, profile);
        } else if (currentPolicy.retainedSpeed < 1 && !bike.wheelie) {
          ai.simulation.applySpeedPenalty(currentPolicy.retainedSpeed);
        }
      }
    }
  }

  private resolveAiCollisions(profile: AiDifficultyProfile): void {
    for (const ai of this.aiRiders) {
      if (ai.finishTimeMs !== undefined) continue;
      const player = this.simulation.snapshot.bike;
      const rival = ai.simulation.snapshot.bike;
      const outcome = resolveRiderCollision({
        sameLane: rival.lane === player.lane,
        gap: rival.forwardPosition - player.forwardPosition,
        playerSpeed: player.speed,
        aiSpeed: rival.speed,
        playerPhase: player.phase,
        aiPhase: rival.phase,
        behavior: ai.behavior,
      });
      if (outcome === "player-crashes") {
        this.simulation.forceCrash();
        this.captionEvent("Front wheel contact — you hit the rider ahead", "crash");
        return;
      }
      if (outcome === "pursuer-crashes") {
        this.crashAi(ai, profile, player.forwardPosition - 16);
        this.captionEvent("Rear-wheel defense — pursuer went down", "crowd");
      }
    }
  }

  private crashAi(
    ai: AiRider,
    profile: AiDifficultyProfile,
    relocation?: number,
  ): void {
    ai.simulation.forceCrash();
    if (relocation !== undefined) ai.simulation.relocate(relocation);
    ai.recoveryDelaySeconds = profile.recoveryDelaySeconds;
  }

  private emitHud(state: SimulationState): void {
    const playerProgress = state.bike.forwardPosition;
    const position = 1 + this.aiRiders.filter(
      (ai) => ai.simulation.snapshot.bike.forwardPosition > playerProgress,
    ).length;
    const now = state.timeSeconds;
    if (this.captionUntil < now) this.caption = "";
    const device = this.input.activeDevice;
    const keyBindings = this.settings.controls.keyBindings;
    const recoverPrompt = device === "gamepad"
      ? "Hold A to recover"
      : device === "touch"
        ? "Hold RIDE to recover"
        : `Hold ${formatKeyCode(keyBindings.recover ?? "Space")} to recover`;
    const ridingPrompt = device === "gamepad"
      ? "RT ride · LT turbo · left stick lanes / pitch · Start pause"
      : device === "touch"
        ? "RIDE + TURBO · arrows choose lane and pitch"
        : `${formatKeyCode(keyBindings.throttle ?? "KeyW")} ride · ${formatKeyCode(keyBindings.turbo ?? "ShiftLeft")} turbo · ${formatKeyCode(keyBindings.laneLeft ?? "ArrowLeft")} / ${formatKeyCode(keyBindings.laneRight ?? "ArrowRight")} lanes · ${formatKeyCode(keyBindings.pitchUp ?? "ArrowUp")} / ${formatKeyCode(keyBindings.pitchDown ?? "ArrowDown")} pitch`;
    this.hint = state.bike.phase === "crashed"
      ? recoverPrompt
      : state.bike.overheated
        ? "Coast until heat falls below the recovery marker"
        : state.bike.heat >= 78
          ? "Release turbo or line up a cyan cooling gate"
          : state.bike.phase === "airborne"
            ? "Pitch for a level two-wheel landing"
            : `${ridingPrompt} · turbo before ramps`;

    this.demonstrated.cooling ||= state.bike.surface === "cooling";
    this.demonstrated.laneChange ||= state.bike.lane !== 1;
    this.demonstrated.wheelie ||= state.bike.wheelie;
    this.demonstrated.airbornePitch ||= state.bike.phase === "airborne" && Math.abs(state.bike.pitch) >= 0.12;
    this.demonstrated.cleanLanding ||= state.bike.lastLanding === "clean";
    this.demonstrated.mud ||= state.bike.surface === "mud";
    this.demonstrated.grass ||= state.bike.surface === "grass";

    if (import.meta.env.VITE_QA_MODE === "1") {
      this.canvas.dataset.demonstratedMechanics = Object.entries(this.demonstrated)
        .filter(([, complete]) => complete)
        .map(([mechanic]) => mechanic)
        .join(" ");
    }

    this.onHud({
      position,
      fieldSize: this.aiRiders.length + 1,
      lap: state.race.lap,
      totalLaps: state.race.totalLaps,
      elapsedMs: state.race.elapsedSeconds * 1_000,
      targetMs: this.targetMs,
      savedBestMs: this.existingBestMs,
      heat: state.bike.heat,
      overheated: state.bike.overheated,
      bikePhase: state.bike.phase,
      lane: state.bike.lane,
      pitch: state.bike.pitch,
      wheelie: state.bike.wheelie,
      landing: state.bike.lastLanding,
      surface: state.bike.surface,
      recoveryProgress: state.bike.recoveryProgress,
      speed: state.bike.speed,
      caption: this.caption,
      hint: this.hint,
      inputDevice: device,
      fps: this.performanceWindow.fps,
      frameTimeMs: this.performanceWindow.frameTimeMs,
      drawCalls: this.renderer.info.render.calls,
      droppedSimulationMs: this.droppedSimulationMs,
      demonstrated: { ...this.demonstrated },
    });
  }

  private captionEvent(caption: string, cue: Parameters<AudioManager["play"]>[0]): void {
    this.caption = caption;
    this.captionUntil = this.simulation.snapshot.timeSeconds + 2.5;
    this.audio.play(cue);
    if (cue === "crash" && !this.settings.accessibility.reducedShake) {
      this.cameraShake = 0.34;
    }
  }

  private finishRace(): void {
    if (this.finished) return;
    this.finished = true;
    this.audio.play("finish");
    const state = this.simulation.snapshot;
    const elapsedMs = Math.round(state.race.elapsedSeconds * 1_000);
    if (!this.completeAiClassification(state)) {
      this.onFatal("The official field result could not be completed. Retry the race.");
      return;
    }
    const classification = this.buildClassification(elapsedMs);
    const playerClassification = classification.find((entry) => entry.isPlayer);
    const position = playerClassification?.position ?? 1;
    const targetGap = elapsedMs - this.targetMs;
    const coachingHint = this.crashes > 2
      ? "Level the bike before landing and hold recover after a crash."
      : this.overheats > 1
        ? "Use standard throttle between jumps and reserve turbo for ramps."
        : targetGap > 0
          ? "Choose a clean lane earlier so you can turbo through the jump chains."
          : "Strong line. Try a higher difficulty or the mastery modifier next.";
    const result: RaceResult = {
      mode: this.mode,
      trackId: this.track.id,
      finishTimeMs: elapsedMs,
      position,
      fieldSize: classification.length,
      checkpointCount: state.race.checkpointCount,
      lapTimesMs: state.race.lapTimes.map((time) => Math.round(time * 1_000)),
      splitTimesMs: state.race.splitTimes.map((time) => Math.round(time * 1_000)),
      targetMs: this.mode === "solo" || this.mode === "mastery" ? this.targetMs : undefined,
      personalBest: this.mode === "solo"
        && (this.existingBestMs === undefined || elapsedMs < this.existingBestMs),
      previousBestMs: this.mode === "solo" ? this.existingBestMs : undefined,
      bestTimeMs: this.mode === "solo"
        ? Math.min(this.existingBestMs ?? Number.POSITIVE_INFINITY, elapsedMs)
        : undefined,
      classification,
      crashes: this.crashes,
      overheats: this.overheats,
      coachingHint,
    };
    const replaySamples = new Uint8Array(this.replayBytes);
    window.setTimeout(() => this.onFinish(result, replaySamples), 650);
  }

  private completeAiClassification(playerState: SimulationState): boolean {
    if (this.aiRiders.length === 0) return true;
    const profile = getAiDifficultyProfile(this.settings.difficulty);
    let steps = 0;
    while (this.aiRiders.some((ai) => ai.finishTimeMs === undefined)) {
      for (const [index, ai] of this.aiRiders.entries()) {
        this.stepAi(ai, index, profile, playerState);
      }
      steps += 1;
      if (steps >= MAX_AI_CLASSIFICATION_STEPS) return false;
    }
    return true;
  }

  private buildClassification(playerFinishTimeMs: number): RaceClassificationEntry[] {
    const finishers = [
      {
        riderId: "player",
        riderName: "You",
        finishTimeMs: playerFinishTimeMs,
        isPlayer: true,
        gridOrder: 0,
      },
      ...this.aiRiders.map((ai, index) => ({
        riderId: ai.riderId,
        riderName: ai.riderName,
        finishTimeMs: ai.finishTimeMs ?? Number.POSITIVE_INFINITY,
        isPlayer: false,
        gridOrder: index + 1,
      })),
    ].sort((left, right) => left.finishTimeMs - right.finishTimeMs || left.gridOrder - right.gridOrder);

    return finishers.map((finisher, index) => ({
      riderId: finisher.riderId,
      riderName: finisher.riderName,
      position: index + 1,
      finishTimeMs: finisher.finishTimeMs,
      isPlayer: finisher.isPlayer,
    }));
  }

  private captureReplay(state: SimulationState): void {
    if (state.stepCount - this.lastReplayStep < 6) return;
    this.lastReplayStep = state.stepCount;
    const forward = clamp(Math.round(state.bike.forwardPosition * 2), 0, 65_535);
    const pitch = clamp(Math.round(((state.bike.pitch + Math.PI / 2) / Math.PI) * 255), 0, 255);
    this.replayBytes.push(
      forward & 0xff,
      (forward >> 8) & 0xff,
      state.bike.lane,
      clamp(Math.round(state.bike.speed * 10), 0, 255),
      clamp(Math.round(state.bike.heat * 2.55), 0, 255),
      pitch,
      clamp(Math.round(state.bike.height * 10), 0, 255),
    );
  }

  private capturePerformance(delta: number, frameTimeMs: number): void {
    const windowState = this.performanceWindow;
    windowState.elapsed += delta;
    windowState.frames += 1;
    windowState.frameTimeTotal += frameTimeMs;
    if (windowState.elapsed >= 1) {
      windowState.fps = Math.round(windowState.frames / windowState.elapsed);
      windowState.frameTimeMs = Number((windowState.frameTimeTotal / windowState.frames).toFixed(2));
      windowState.elapsed = 0;
      windowState.frames = 0;
      windowState.frameTimeTotal = 0;
    }
  }

  private createDustPool(): void {
    const count = this.quality === "low" ? 10 : this.quality === "medium" ? 16 : 24;
    const geometry = new THREE.DodecahedronGeometry(0.16, 0);
    const material = makeMaterial(this.track.palette.dirtDark, 1);
    for (let index = 0; index < count; index += 1) {
      const mesh = new THREE.Mesh(geometry, material);
      mesh.visible = false;
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      this.scene.add(mesh);
      this.dustPool.push({ mesh, life: 0, drift: 0 });
    }
  }

  private updateDust(delta: number, state: SimulationState): void {
    for (const particle of this.dustPool) {
      if (particle.life <= 0) continue;
      particle.life -= delta;
      if (particle.life <= 0) {
        particle.mesh.visible = false;
        continue;
      }
      particle.mesh.position.x += particle.drift * delta;
      particle.mesh.position.y += 0.42 * delta;
      const scale = 0.7 + (0.58 - particle.life) * 2.1;
      particle.mesh.scale.setScalar(scale);
    }

    if (
      this.settings.accessibility.reducedMotion
      || state.bike.phase !== "grounded"
      || state.bike.speed < 4
      || state.bike.surface === "cooling"
    ) return;
    this.dustAccumulator += delta;
    const interval = this.quality === "low" ? 0.16 : 0.09;
    if (this.dustAccumulator < interval) return;
    this.dustAccumulator %= interval;
    const particle = this.dustPool[this.dustCursor % this.dustPool.length];
    this.dustCursor += 1;
    if (!particle) return;
    const side = this.dustCursor % 2 === 0 ? -1 : 1;
    particle.life = 0.58;
    particle.drift = side * (0.25 + (this.dustCursor % 3) * 0.08);
    particle.mesh.scale.setScalar(0.7);
    particle.mesh.position.set(
      state.bike.lanePosition + side * 0.26,
      0.18 + this.authoredRouteHeight(
        state.bike.forwardPosition % this.track.courseLength,
        state.bike.lanePosition,
      ),
      -state.bike.forwardPosition + 0.85,
    );
    particle.mesh.visible = true;
  }

  private createWorld(): void {
    const palette = this.track.palette;
    const hemisphere = new THREE.HemisphereLight(
      this.visualProfile.hemisphereSky,
      this.visualProfile.hemisphereGround,
      this.visualProfile.hemisphereIntensity,
    );
    this.scene.add(hemisphere);
    const sun = new THREE.DirectionalLight(this.visualProfile.sun, this.visualProfile.sunIntensity);
    sun.position.set(-30, 42, 22);
    sun.target = this.sunTarget;
    sun.castShadow = this.quality !== "low";
    const shadowSize = this.quality === "high" ? 2_048 : 1_024;
    sun.shadow.mapSize.set(shadowSize, shadowSize);
    sun.shadow.camera.left = -30;
    sun.shadow.camera.right = 30;
    sun.shadow.camera.top = 38;
    sun.shadow.camera.bottom = -22;
    sun.shadow.camera.near = 1;
    sun.shadow.camera.far = 110;
    sun.shadow.bias = -0.00035;
    sun.shadow.normalBias = 0.025;
    this.sunLight = sun;
    this.scene.add(sun, this.sunTarget);

    const totalLaps = this.simulation.snapshot.race.totalLaps;
    const totalLength = this.track.courseLength * totalLaps + 120;
    const grassTexture = createTerrainTexture(palette.grass, 0x244a32, this.track.order * 719, "grass");
    grassTexture.repeat.set(6, Math.max(12, totalLength / 34));
    grassTexture.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
    const dirtTexture = createTerrainTexture(palette.dirt, palette.dirtDark, this.track.order * 1_237, "dirt");
    dirtTexture.repeat.set(1, Math.max(14, totalLength / 30));
    dirtTexture.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
    this.ownedTextures.push(grassTexture, dirtTexture);
    const grassMaterial = new THREE.MeshStandardMaterial({ map: grassTexture, color: 0xffffff, roughness: 0.98, metalness: 0 });
    const dirtMaterial = new THREE.MeshStandardMaterial({
      map: dirtTexture,
      bumpMap: dirtTexture,
      bumpScale: 0.082,
      color: 0xffffff,
      roughness: 0.91,
      metalness: 0,
    });
    const grass = makeBox(44, 0.22, totalLength, grassMaterial);
    grass.position.set(0, -0.22, -totalLength / 2 + 30);
    this.scene.add(grass);
    const dirt = makeBox(13.3, 0.26, totalLength, dirtMaterial);
    dirt.position.set(0, -0.06, -totalLength / 2 + 30);
    this.scene.add(dirt);

    const shoulderGeometry = new THREE.BoxGeometry(1.7, 0.3, totalLength);
    const shoulders = new THREE.InstancedMesh(shoulderGeometry, grassMaterial, 2);
    const shoulderMatrix = new THREE.Matrix4();
    shoulderMatrix.makeTranslation(-7.45, 0.02, -totalLength / 2 + 30);
    shoulders.setMatrixAt(0, shoulderMatrix);
    shoulderMatrix.makeTranslation(7.45, 0.02, -totalLength / 2 + 30);
    shoulders.setMatrixAt(1, shoulderMatrix);
    shoulders.receiveShadow = true;
    const bermSegmentDepth = this.quality === "low" ? 26 : this.quality === "medium" ? 18 : 12;
    const bermSegmentsPerLane = Math.ceil(totalLength / bermSegmentDepth);
    const laneRidges = new THREE.InstancedMesh(
      new THREE.BoxGeometry(1, 1, 1),
      grassMaterial,
      bermSegmentsPerLane * 3,
    );
    const bermRandom = seededRandom(this.track.order * 213_119);
    let bermIndex = 0;
    for (const x of [-3, 0, 3]) {
      for (let segment = 0; segment < bermSegmentsPerLane; segment += 1) {
        const depth = Math.min(bermSegmentDepth + 1.4, totalLength - segment * bermSegmentDepth);
        const widthScale = 0.82 + bermRandom() * 0.36;
        const heightScale = 0.8 + bermRandom() * 0.42;
        shoulderMatrix.compose(
          new THREE.Vector3(
            x + (bermRandom() - 0.5) * 0.12,
            0.07 * heightScale,
            30 - segment * bermSegmentDepth - depth / 2,
          ),
          new THREE.Quaternion().setFromEuler(new THREE.Euler(0, (bermRandom() - 0.5) * 0.025, 0)),
          new THREE.Vector3(0.22 * widthScale, 0.14 * heightScale, depth),
        );
        laneRidges.setMatrixAt(bermIndex, shoulderMatrix);
        bermIndex += 1;
      }
    }
    laneRidges.instanceMatrix.needsUpdate = true;
    laneRidges.receiveShadow = true;
    this.scene.add(shoulders, laneRidges);
    this.createTerracedCourseEdges(totalLength);
    this.createHighContrastTrackGuides(totalLength);

    const authoredCourse = this.track.authoredCourse;
    if (authoredCourse) this.createAuthoredGate(authoredCourse.start, 0);
    for (let lap = 0; lap < totalLaps; lap += 1) {
      if (authoredCourse) {
        for (const piece of authoredCourse.trackPieces) this.createAuthoredTrackPiece(piece, lap);
        for (const checkpoint of authoredCourse.checkpoints) this.createAuthoredGate(checkpoint, lap);
      }
      for (const obstacle of this.track.obstacles) this.createObstacle(obstacle, lap);
      if (authoredCourse) {
        this.createAuthoredGate(authoredCourse.finish, lap);
      } else {
        this.createFinishGate((lap + 1) * this.track.courseLength);
      }
    }
    this.createScenery(totalLength);
    this.createTrackEdgeDetail(totalLength);
    this.createSkyDecor(totalLength);
    this.createThemeDecor(totalLength);
    this.createFestivalDecor(totalLength);
  }

  private createTerracedCourseEdges(totalLength: number): void {
    const segmentDepth = this.quality === "low" ? 68 : this.quality === "medium" ? 50 : 38;
    const segmentCount = Math.ceil((totalLength + 50) / segmentDepth);
    const instanceCount = segmentCount * 2;
    const palette = this.track.palette;
    const shelfColor = this.track.id === "foundry-flight"
      ? new THREE.Color(palette.rock).lerp(new THREE.Color(0x59636a), 0.38).getHex()
      : new THREE.Color(palette.grass).lerp(new THREE.Color(palette.dirt), 0.12).getHex();
    const wallColor = new THREE.Color(palette.rock).offsetHSL(0, 0.01, -0.07).getHex();
    const capColor = new THREE.Color(palette.rock).offsetHSL(0.01, 0.02, 0.07).getHex();
    const shelves = new THREE.InstancedMesh(
      new THREE.BoxGeometry(4.8, 0.72, segmentDepth + 1.6),
      makeMaterial(0xffffff, 0.96),
      instanceCount,
    );
    const lowerSteps = new THREE.InstancedMesh(
      new THREE.BoxGeometry(4.6, 1.25, segmentDepth * 0.86),
      makeMaterial(0xffffff, 0.94),
      instanceCount,
    );
    const upperGeometry = this.track.id === "foundry-flight"
      ? new THREE.BoxGeometry(7.2, 2.8, segmentDepth * 0.68)
      : new THREE.CylinderGeometry(3.35, 4.25, 2.8, 6);
    const upperSteps = new THREE.InstancedMesh(
      upperGeometry,
      makeMaterial(0xffffff, 0.94),
      instanceCount,
    );
    const caps = new THREE.InstancedMesh(
      new THREE.CylinderGeometry(2.72, 3.25, 0.42, 6),
      makeMaterial(0xffffff, 0.92),
      instanceCount,
    );
    const matrix = new THREE.Matrix4();
    const rotation = new THREE.Quaternion();
    const random = seededRandom(this.track.order * 48_271);
    let instanceIndex = 0;

    for (let segment = 0; segment < segmentCount; segment += 1) {
      const z = 26 - segment * segmentDepth;
      for (const side of [-1, 1]) {
        const openWaterSide = this.track.id === "coastline-clash" && side > 0;
        if (openWaterSide) {
          const hiddenScale = new THREE.Vector3(0.001, 0.001, 0.001);
          matrix.compose(new THREE.Vector3(0, -8, z), rotation, hiddenScale);
          shelves.setMatrixAt(instanceIndex, matrix);
          lowerSteps.setMatrixAt(instanceIndex, matrix);
          upperSteps.setMatrixAt(instanceIndex, matrix);
          caps.setMatrixAt(instanceIndex, matrix);
          instanceIndex += 1;
          continue;
        }

        const height = this.visualProfile.terraceHeight * (0.84 + random() * 0.28);
        const lateralJitter = (random() - 0.5) * 1.4;
        const depthJitter = (random() - 0.5) * segmentDepth * 0.16;
        const depthScale = 0.86 + random() * 0.12;
        rotation.setFromEuler(new THREE.Euler(0, (random() - 0.5) * 0.08, 0));
        matrix.compose(
          new THREE.Vector3(side * (10.1 + lateralJitter * 0.35), 0.02 + height * 0.04, z),
          rotation,
          new THREE.Vector3(1, 0.9 + height * 0.1, depthScale),
        );
        shelves.setMatrixAt(instanceIndex, matrix);

        const lowerX = side * (12.9 + lateralJitter * 0.55);
        matrix.compose(
          new THREE.Vector3(lowerX, 0.45 + height * 0.3, z + depthJitter * 0.35),
          rotation,
          new THREE.Vector3(1, 0.82 + height * 0.18, depthScale),
        );
        lowerSteps.setMatrixAt(instanceIndex, matrix);

        const upperScaleY = 0.72 + height * 0.38;
        const upperDepthScale = this.track.id === "foundry-flight"
          ? depthScale
          : (segmentDepth * 0.68 * depthScale) / 8.5;
        rotation.setFromEuler(new THREE.Euler(0, (random() - 0.5) * 0.16, 0));
        matrix.compose(
          new THREE.Vector3(
            side * (17.15 + lateralJitter),
            1.5 + height * 0.62,
            z + depthJitter,
          ),
          rotation,
          new THREE.Vector3(1, upperScaleY, upperDepthScale),
        );
        upperSteps.setMatrixAt(instanceIndex, matrix);

        const upperTop = 1.5 + height * 0.62 + 1.4 * upperScaleY;
        const capDepthScale = (segmentDepth * 0.68 * depthScale) / 6.5;
        matrix.compose(
          new THREE.Vector3(
            side * (17.15 + lateralJitter),
            upperTop + 0.16,
            z + depthJitter,
          ),
          rotation,
          new THREE.Vector3(1, 1, capDepthScale),
        );
        caps.setMatrixAt(instanceIndex, matrix);
        const toneJitter = (random() - 0.5) * 0.09;
        shelves.setColorAt(instanceIndex, new THREE.Color(shelfColor).offsetHSL(0, 0.01, toneJitter * 0.45));
        lowerSteps.setColorAt(instanceIndex, new THREE.Color(wallColor).offsetHSL(0.006, 0.015, toneJitter));
        upperSteps.setColorAt(instanceIndex, new THREE.Color(wallColor).offsetHSL(-0.004, 0.01, toneJitter * 0.8));
        caps.setColorAt(instanceIndex, new THREE.Color(capColor).offsetHSL(0.004, 0.015, toneJitter * 0.55));
        instanceIndex += 1;
      }
    }

    shelves.instanceMatrix.needsUpdate = true;
    lowerSteps.instanceMatrix.needsUpdate = true;
    upperSteps.instanceMatrix.needsUpdate = true;
    caps.instanceMatrix.needsUpdate = true;
    if (shelves.instanceColor) shelves.instanceColor.needsUpdate = true;
    if (lowerSteps.instanceColor) lowerSteps.instanceColor.needsUpdate = true;
    if (upperSteps.instanceColor) upperSteps.instanceColor.needsUpdate = true;
    if (caps.instanceColor) caps.instanceColor.needsUpdate = true;
    shelves.receiveShadow = true;
    lowerSteps.receiveShadow = true;
    lowerSteps.castShadow = this.quality === "high";
    upperSteps.receiveShadow = true;
    upperSteps.castShadow = this.quality === "high";
    caps.receiveShadow = true;
    this.scene.add(shelves, lowerSteps, upperSteps, caps);
  }

  private createHighContrastTrackGuides(totalLength: number): void {
    const guides = new THREE.InstancedMesh(
      new THREE.BoxGeometry(1, 1, totalLength),
      new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }),
      5,
    );
    const matrix = new THREE.Matrix4();
    const rotation = new THREE.Quaternion();
    const centerZ = -totalLength / 2 + 30;
    for (const [index, x] of [-6.28, -3, 0, 3, 6.28].entries()) {
      const isTrackEdge = index === 0 || index === 4;
      matrix.compose(
        new THREE.Vector3(x, 0.11, centerZ),
        rotation,
        new THREE.Vector3(isTrackEdge ? 0.22 : 0.09, 0.04, 1),
      );
      guides.setMatrixAt(index, matrix);
      guides.setColorAt(index, new THREE.Color(isTrackEdge ? 0xffffff : YELLOW));
    }
    guides.name = "high-contrast-track-guides";
    guides.instanceMatrix.needsUpdate = true;
    if (guides.instanceColor) guides.instanceColor.needsUpdate = true;
    guides.castShadow = false;
    guides.receiveShadow = false;
    guides.renderOrder = 2;
    guides.visible = this.settings.accessibility.highContrast;
    this.highContrastTrackGuides = guides;
    this.scene.add(guides);
  }

  private createAuthoredTrackPiece(piece: AuthoredTrackPiece, lap: number): void {
    const group = new THREE.Group();
    const width = piece.unrotatedWidth;
    const length = piece.unrotatedLength;
    const dirt = makeMaterial(this.track.palette.dirtDark, 0.92);
    const accent = makeMaterial(this.track.palette.accent, 0.68);
    if (piece.kind === "straight") {
      group.add(makeBox(width, 0.26, length, dirt));
      for (let lane = 1; lane < 4; lane += 1) {
        const mark = makeBox(0.08, 0.035, length * 0.84, accent);
        mark.position.set(-width / 2 + (width / 4) * lane, 0.16, 0);
        group.add(mark);
      }
    } else {
      const direction = piece.kind.endsWith("left") ? -1 : 1;
      const bankHeight = piece.kind.startsWith("bank-") ? 0.85 : 0;
      group.add(new THREE.Mesh(
        createCurvedCourseGeometry(width, length, direction, bankHeight),
        dirt,
      ));
      const outsideX = direction < 0 ? width * 0.47 : -width * 0.47;
      for (let index = 0; index < 5; index += 1) {
        const rail = makeBox(0.36, 0.54 + bankHeight * 0.5, length / 6, accent);
        rail.position.set(outsideX, 0.28 + bankHeight * 0.2, -length / 2 + (index + 0.5) * length / 5);
        group.add(rail);
      }
    }
    group.position.set(
      piece.lateralPosition,
      piece.height + 0.08,
      -(lap * this.track.courseLength + piece.distance),
    );
    group.rotation.y = THREE.MathUtils.degToRad(piece.rotation);
    setShadow(group);
    this.scene.add(group);
  }

  private createAuthoredGate(gate: AuthoredRaceGate, lap: number): void {
    const group = new THREE.Group();
    const width = gate.unrotatedWidth;
    const height = gate.kind === "checkpoint" ? 3.25 : 3.8;
    const frameColor = gate.kind === "checkpoint" ? YELLOW : gate.kind === "start" ? COOLING : PLAYER_ACCENT;
    const frame = makeMaterial(NAVY, 0.45);
    const accent = makeMaterial(frameColor, 0.55);
    const left = makeBox(0.4, height, 0.52, frame);
    const right = left.clone();
    const top = makeBox(width, 0.46, 0.54, accent);
    left.position.set(-width / 2 + 0.22, height / 2, 0);
    right.position.set(width / 2 - 0.22, height / 2, 0);
    top.position.set(0, height, 0);
    group.add(left, right, top);

    const canvas = document.createElement("canvas");
    canvas.width = 512;
    canvas.height = 96;
    const context = canvas.getContext("2d");
    if (context) {
      context.fillStyle = "#061c32";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.fillStyle = gate.kind === "checkpoint" ? "#f7cc3d" : gate.kind === "start" ? "#1ddfe6" : "#f15f50";
      context.fillRect(0, 0, canvas.width, 12);
      context.fillRect(0, 84, canvas.width, 12);
      context.fillStyle = "#f5edda";
      context.font = "900 46px Arial Narrow, Arial, sans-serif";
      context.textAlign = "center";
      context.textBaseline = "middle";
      const label = gate.kind === "checkpoint"
        ? `CP ${gate.order} / ${this.track.authoredCourse?.checkpoints.length ?? 0}`
        : gate.kind === "start" ? "START" : "LAP GATE";
      context.fillText(label, 256, 49);
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    this.ownedTextures.push(texture);
    const sign = new THREE.Mesh(
      new THREE.PlaneGeometry(Math.max(2.4, width * 0.56), 0.94),
      new THREE.MeshBasicMaterial({ map: texture, toneMapped: false }),
    );
    sign.position.set(0, height, 0.3);
    group.add(sign);
    group.position.set(
      gate.lateralPosition,
      gate.height,
      -(lap * this.track.courseLength + gate.distance),
    );
    group.rotation.y = THREE.MathUtils.degToRad(gate.rotation);
    setShadow(group);
    this.scene.add(group);
  }

  private createObstacle(obstacle: TrackObstacle, lap: number): void {
    const z = -(lap * this.track.courseLength + obstacle.distance);
    const materials: ObstacleMaterials = {
      dirt: makeMaterial(this.track.palette.dirtDark),
      wood: makeMaterial(0xb8763f),
      warning: makeMaterial(YELLOW),
    };
    const authored = obstacle.lateralPosition !== undefined;
    const visualPlacements = authored
      ? [{ x: obstacle.lateralPosition ?? 0, width: obstacle.unrotatedWidth ?? obstacle.width ?? 2.45 }]
      : obstacle.lanes.map((lane) => ({ x: LANE_POSITIONS[lane], width: 2.45 }));
    const authoredVisualLength = obstacle.unrotatedLength ?? obstacle.length;

    for (const { x, width: visualWidth } of visualPlacements) {
      const mesh = this.createObstacleVisual(
        obstacle,
        x,
        visualWidth,
        z,
        authoredVisualLength,
        materials,
      );
      if (authored) {
        mesh.position.y += obstacle.height ?? 0;
        mesh.rotation.y += THREE.MathUtils.degToRad(obstacle.rotation ?? 0);
      }
      setShadow(mesh);
      this.scene.add(mesh);
    }
  }

  private createObstacleVisual(
    obstacle: TrackObstacle,
    x: number,
    visualWidth: number,
    z: number,
    visualLength: number | undefined,
    materials: ObstacleMaterials,
  ): THREE.Object3D {
    switch (obstacle.kind) {
      case "mud": return this.createMudVisual(x, visualWidth, z, visualLength);
      case "grass": return this.createGrassVisual(obstacle.id, x, visualWidth, z, visualLength);
      case "cooling-gate": return this.createCoolingGateVisual(x, visualWidth, z);
      case "barrier": return this.createBarrierVisual(x, visualWidth, z, materials.warning);
      case "bump": return this.createBumpVisual(x, visualWidth, z, visualLength, materials.dirt);
      case "bank": return this.createBankVisual(x, visualWidth, z, visualLength, materials.dirt);
      default: return this.createRampVisual(obstacle.kind, x, visualWidth, z, visualLength, materials);
    }
  }

  private createMudVisual(x: number, visualWidth: number, z: number, visualLength?: number): THREE.Group {
    const mud = new THREE.Group();
    const length = visualLength ?? 16;
    const mudMaterial = new THREE.MeshStandardMaterial({
      color: 0x442a27,
      roughness: 0.34,
      metalness: 0.06,
      flatShading: true,
    });
    const puddles = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 12, 7), mudMaterial, 3);
    const puddleMatrix = new THREE.Matrix4();
    for (let index = 0; index < 3; index += 1) {
      puddleMatrix.compose(
        new THREE.Vector3((index - 1) * 0.2, 0.035, (index - 1) * length * 0.29),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(0, index * 0.5, 0)),
        new THREE.Vector3(
          (1.16 - index * 0.06) * visualWidth / 2.45,
          0.075,
          length * 0.19,
        ),
      );
      puddles.setMatrixAt(index, puddleMatrix);
    }
    const ruts = new THREE.InstancedMesh(
      new THREE.BoxGeometry(0.13, 0.025, length * 0.82),
      makeMaterial(0x2f2422, 0.56),
      2,
    );
    puddleMatrix.makeTranslation(-0.46, 0.105, 0);
    ruts.setMatrixAt(0, puddleMatrix);
    puddleMatrix.makeTranslation(0.46, 0.105, 0);
    ruts.setMatrixAt(1, puddleMatrix);
    mud.add(puddles, ruts);
    mud.position.set(x, 0.09, z);
    return mud;
  }

  private createGrassVisual(
    obstacleId: string,
    x: number,
    visualWidth: number,
    z: number,
    visualLength?: number,
  ): THREE.Group {
    const patch = new THREE.Group();
    const length = visualLength ?? 20;
    const base = makeBox(visualWidth, 0.09, length, makeMaterial(this.track.palette.grass, 0.98));
    const tuftCount = this.quality === "low" ? 5 : 9;
    const tufts = new THREE.InstancedMesh(
      new THREE.ConeGeometry(0.12, 0.42, 4),
      makeMaterial(new THREE.Color(this.track.palette.grass).offsetHSL(0, 0.05, -0.1).getHex(), 0.96),
      tuftCount,
    );
    const tuftMatrix = new THREE.Matrix4();
    for (let index = 0; index < tuftCount; index += 1) {
      const random = seededRandom(obstacleId.length * 1_309 + Math.round(x * 97) + index * 17);
      tuftMatrix.makeTranslation(
        -visualWidth * 0.4 + random() * visualWidth * 0.8,
        0.24,
        -length / 2 + 1 + random() * Math.max(1, length - 2),
      );
      tufts.setMatrixAt(index, tuftMatrix);
    }
    patch.add(base, tufts);
    patch.position.set(x, 0.13, z);
    return patch;
  }

  private createCoolingGateVisual(x: number, visualWidth: number, z: number): THREE.Group {
    const gate = new THREE.Group();
    const geometry = createCoolingGateGeometry();
    const frame = new THREE.Mesh(geometry, makeMaterial(NAVY, 0.38));
    frame.scale.set(visualWidth / 2.64, 1.08, 1);
    frame.position.set(0, -0.035, -0.035);
    const glow = new THREE.Mesh(
      geometry,
      new THREE.MeshBasicMaterial({ color: COOLING, toneMapped: false }),
    );
    glow.scale.set(visualWidth / 2.64, 1.08, 1);
    glow.position.z = 0.045;
    const panel = new THREE.Mesh(
      new THREE.PlaneGeometry(Math.max(1.7, visualWidth * 0.78), 1.55),
      new THREE.MeshBasicMaterial({
        color: COOLING,
        transparent: true,
        opacity: 0.085,
        depthWrite: false,
        side: THREE.DoubleSide,
        toneMapped: false,
      }),
    );
    panel.position.set(0, 1.08, 0.02);
    const bases = new THREE.InstancedMesh(
      new THREE.BoxGeometry(0.52, 0.46, 0.62),
      makeMaterial(0x16344d, 0.42),
      2,
    );
    const baseMatrix = new THREE.Matrix4();
    baseMatrix.makeTranslation(-visualWidth / 2, 0.2, 0);
    bases.setMatrixAt(0, baseMatrix);
    baseMatrix.makeTranslation(visualWidth / 2, 0.2, 0);
    bases.setMatrixAt(1, baseMatrix);
    const snowflake = createCoolingSnowflake();
    snowflake.position.set(0, 1.16, 0.1);
    snowflake.scale.setScalar(Math.min(1, visualWidth / 2.45));
    gate.add(frame, glow, panel, bases, snowflake);
    this.coolingSnowflakes.push(snowflake);
    gate.position.set(x, 0.1, z);
    return gate;
  }

  private createBarrierVisual(
    x: number,
    visualWidth: number,
    z: number,
    warning: THREE.MeshStandardMaterial,
  ): THREE.Group {
    const barrier = new THREE.Group();
    const base = makeBox(visualWidth * 0.92, 0.76, 0.5, warning);
    const stripes = new THREE.InstancedMesh(
      new THREE.BoxGeometry(0.24, 0.7, 0.055),
      makeMaterial(0x172d3d, 0.62),
      3,
    );
    const stripeMatrix = new THREE.Matrix4();
    const stripeRotation = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, -0.34));
    for (const [stripeIndex, stripeX] of [-0.28, 0, 0.28].entries()) {
      stripeMatrix.compose(
        new THREE.Vector3(stripeX * visualWidth, 0, 0.28),
        stripeRotation,
        new THREE.Vector3(1, 1, 1),
      );
      stripes.setMatrixAt(stripeIndex, stripeMatrix);
    }
    const feet = new THREE.InstancedMesh(
      new THREE.BoxGeometry(0.4, 0.18, 0.88),
      makeMaterial(0x21384b, 0.72),
      2,
    );
    stripeMatrix.makeTranslation(-visualWidth * 0.31, -0.44, 0);
    feet.setMatrixAt(0, stripeMatrix);
    stripeMatrix.makeTranslation(visualWidth * 0.31, -0.44, 0);
    feet.setMatrixAt(1, stripeMatrix);
    barrier.add(base, stripes, feet);
    barrier.position.set(x, 0.52, z);
    return barrier;
  }

  private createBumpVisual(
    x: number,
    visualWidth: number,
    z: number,
    visualLength: number | undefined,
    material: THREE.MeshStandardMaterial,
  ): THREE.Mesh {
    const bump = new THREE.Mesh(
      new THREE.SphereGeometry(1.08, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2),
      material,
    );
    bump.scale.set(
      Math.max(1, visualWidth / 2.16),
      0.38,
      Math.max(1.5, (visualLength ?? 3.24) / 2.16),
    );
    bump.position.set(x, 0.03, z);
    return bump;
  }

  private createBankVisual(
    x: number,
    visualWidth: number,
    z: number,
    visualLength: number | undefined,
    material: THREE.MeshStandardMaterial,
  ): THREE.Mesh {
    const bank = makeBox(visualWidth, 0.32, visualLength ?? 32, material);
    bank.rotation.z = x < 0 ? -0.08 : 0.08;
    bank.position.set(x, 0.18, z);
    return bank;
  }

  private createRampVisual(
    kind: TrackObstacle["kind"],
    x: number,
    visualWidth: number,
    z: number,
    visualLength: number | undefined,
    materials: ObstacleMaterials,
  ): THREE.Group {
    const scale = kind === "small-ramp" ? 0.55 : kind === "medium-ramp" ? 0.78 : kind === "super-jump" ? 1.35 : 1;
    const height = 0.72 * scale;
    const depth = visualLength ?? 3.8 * scale;
    const ramp = new THREE.Mesh(createRampGeometry(visualWidth, height, depth), materials.wood);
    const angle = Math.atan2(height, depth);
    const topRotation = new THREE.Quaternion().setFromEuler(new THREE.Euler(-angle, 0, 0));
    const bands = new THREE.InstancedMesh(
      new THREE.BoxGeometry(visualWidth * 0.54, 0.045, 0.24),
      materials.warning,
      2,
    );
    const bandMatrix = new THREE.Matrix4();
    for (let index = 0; index < 2; index += 1) {
      const bandZ = depth * (0.07 - index * 0.2);
      const bandY = height * ((depth / 2 - bandZ) / depth) + 0.06;
      bandMatrix.compose(
        new THREE.Vector3(0, bandY, bandZ),
        topRotation,
        new THREE.Vector3(1, 1, 1),
      );
      bands.setMatrixAt(index, bandMatrix);
    }
    const edgeRails = new THREE.InstancedMesh(
      new THREE.BoxGeometry(0.1, 0.1, depth),
      makeMaterial(this.track.palette.accent, 0.45),
      2,
    );
    for (let index = 0; index < 2; index += 1) {
      bandMatrix.compose(
        new THREE.Vector3(
          index === 0 ? -visualWidth / 2 + 0.08 : visualWidth / 2 - 0.08,
          height / 2 + 0.05,
          0,
        ),
        topRotation,
        new THREE.Vector3(1, 1, 1),
      );
      edgeRails.setMatrixAt(index, bandMatrix);
    }
    const group = new THREE.Group();
    group.add(ramp, bands, edgeRails);
    group.position.set(x, 0.1, z);
    return group;
  }

  private createFinishGate(offset: number): void {
    const group = new THREE.Group();
    const postMaterial = makeMaterial(NAVY);
    const accent = makeMaterial(PLAYER_ACCENT);
    const left = makeBox(0.35, 4.6, 0.4, postMaterial);
    const right = left.clone();
    const top = makeBox(13.2, 0.45, 0.5, accent);
    left.position.set(-6.25, 2.25, 0);
    right.position.set(6.25, 2.25, 0);
    top.position.set(0, 4.35, 0);
    group.add(left, right, top);
    const canvas = document.createElement("canvas");
    canvas.width = 512;
    canvas.height = 96;
    const context = canvas.getContext("2d");
    if (context) {
      context.fillStyle = "#061c32";
      context.fillRect(0, 0, canvas.width, canvas.height);
      for (let index = 0; index < 16; index += 1) {
        context.fillStyle = index % 2 === 0 ? "#f5edda" : "#f15f50";
        context.fillRect(index * 32, 0, 32, 16);
        context.fillRect(index * 32, 80, 32, 16);
      }
      context.fillStyle = "#f5edda";
      context.font = "900 48px Arial Narrow, Arial, sans-serif";
      context.textAlign = "center";
      context.textBaseline = "middle";
      context.fillText("LAP GATE", 256, 49);
    }
    const signTexture = new THREE.CanvasTexture(canvas);
    signTexture.colorSpace = THREE.SRGBColorSpace;
    this.ownedTextures.push(signTexture);
    const sign = new THREE.Mesh(
      new THREE.PlaneGeometry(6.6, 1.24),
      new THREE.MeshBasicMaterial({ map: signTexture, toneMapped: false }),
    );
    sign.position.set(0, 4.36, 0.28);
    group.add(sign);
    group.position.z = -offset;
    this.scene.add(group);
  }

  private createTrackEdgeDetail(totalLength: number): void {
    this.createTrackEdgeBlocks();
    this.createTrackFence(totalLength);
    this.createTrackGroundClutter(totalLength);
  }

  private createTrackEdgeBlocks(): void {
    const totalLaps = this.simulation.snapshot.race.totalLaps;
    const blocksPerSide = this.quality === "low" ? 10 : this.quality === "medium" ? 14 : 18;
    const zoneCount = totalLaps + 1;
    const blockCount = zoneCount * blocksPerSide * 2;
    const blocks = new THREE.InstancedMesh(
      new THREE.BoxGeometry(1.35, 0.58, 4.05),
      makeMaterial(0xffffff, 0.74),
      blockCount,
    );
    const blockColors = [
      new THREE.Color(0xf3ead4),
      new THREE.Color(0xef604f),
      new THREE.Color(0x1fb7b6),
    ];
    const matrix = new THREE.Matrix4();
    let blockIndex = 0;
    for (let zone = 0; zone < zoneCount; zone += 1) {
      const zoneDistance = zone * this.track.courseLength;
      for (let index = 0; index < blocksPerSide; index += 1) {
        for (const side of [-1, 1]) {
          matrix.makeTranslation(
            side * 7.35,
            0.36,
            -(zoneDistance + 6 + index * 3.8),
          );
          blocks.setMatrixAt(blockIndex, matrix);
          blocks.setColorAt(
            blockIndex,
            blockColors[(index + zone + (side > 0 ? 1 : 0)) % blockColors.length] ?? new THREE.Color(0xf3ead4),
          );
          blockIndex += 1;
        }
      }
    }
    blocks.castShadow = this.quality !== "low";
    blocks.receiveShadow = true;
    this.scene.add(blocks);
  }

  private createTrackFence(totalLength: number): void {
    const matrix = new THREE.Matrix4();
    const fenceStep = this.quality === "low" ? 28 : 21;
    const fenceSegments = Math.ceil(totalLength / fenceStep);
    const fenceMaterial = makeMaterial(0x765039, 0.92);
    const posts = new THREE.InstancedMesh(
      new THREE.CylinderGeometry(0.12, 0.15, 1.9, 6),
      fenceMaterial,
      (fenceSegments + 1) * 2,
    );
    const rails = new THREE.InstancedMesh(
      new THREE.BoxGeometry(0.12, 0.12, fenceStep * 0.92),
      fenceMaterial,
      fenceSegments * 4,
    );
    let postIndex = 0;
    let railIndex = 0;
    for (let index = 0; index <= fenceSegments; index += 1) {
      const z = 20 - index * fenceStep;
      for (const side of [-1, 1]) {
        matrix.makeTranslation(side * 9.15, 0.92, z);
        posts.setMatrixAt(postIndex, matrix);
        postIndex += 1;
        if (index === fenceSegments) continue;
        for (const y of [0.72, 1.34]) {
          matrix.makeTranslation(side * 9.15, y, z - fenceStep / 2);
          rails.setMatrixAt(railIndex, matrix);
          railIndex += 1;
        }
      }
    }
    posts.castShadow = this.quality === "high";
    rails.castShadow = this.quality === "high";
    this.scene.add(posts, rails);
  }

  private createTrackGroundClutter(totalLength: number): void {
    const matrix = new THREE.Matrix4();
    const tuftCount = this.quality === "low" ? 64 : this.quality === "medium" ? 104 : 144;
    const tufts = new THREE.InstancedMesh(
      new THREE.ConeGeometry(0.16, 0.58, 5),
      makeMaterial(new THREE.Color(this.track.palette.grass).offsetHSL(0.015, 0.06, -0.09).getHex(), 0.98),
      tuftCount,
    );
    const tuftRandom = seededRandom(this.track.order * 99_991);
    for (let index = 0; index < tuftCount; index += 1) {
      const side = index % 2 === 0 ? -1 : 1;
      const scale = 0.55 + tuftRandom() * 0.85;
      matrix.compose(
        new THREE.Vector3(
          side * (6.95 + tuftRandom() * 4.35),
          0.24 * scale,
          18 - tuftRandom() * Math.max(40, totalLength - 20),
        ),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(0, tuftRandom() * Math.PI, 0)),
        new THREE.Vector3(scale, scale, scale),
      );
      tufts.setMatrixAt(index, matrix);
    }
    tufts.castShadow = this.quality === "high";

    const pebbleCount = this.quality === "low" ? 44 : this.quality === "medium" ? 70 : 96;
    const pebbles = new THREE.InstancedMesh(
      new THREE.DodecahedronGeometry(0.24, 0),
      makeMaterial(this.track.palette.rock, 0.94),
      pebbleCount,
    );
    const pebbleRandom = seededRandom(this.track.order * 70_771);
    for (let index = 0; index < pebbleCount; index += 1) {
      const side = index % 2 === 0 ? -1 : 1;
      const scale = 0.45 + pebbleRandom() * 1.25;
      matrix.compose(
        new THREE.Vector3(
          side * (6.85 + pebbleRandom() * 4.6),
          0.1 * scale,
          16 - pebbleRandom() * Math.max(40, totalLength - 20),
        ),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(pebbleRandom(), pebbleRandom() * Math.PI, 0)),
        new THREE.Vector3(scale * 1.4, scale * 0.72, scale),
      );
      pebbles.setMatrixAt(index, matrix);
    }
    pebbles.castShadow = this.quality !== "low";
    this.scene.add(tufts, pebbles);
  }

  private sceneryElevation(lateralPosition: number): number {
    if (this.track.id === "coastline-clash" && lateralPosition > 0) return 0;
    const lateralDistance = Math.abs(lateralPosition);
    if (lateralDistance >= 15) return 2.7 + this.visualProfile.terraceHeight * 0.68;
    if (lateralDistance >= 11.8) return 0.9 + this.visualProfile.terraceHeight * 0.38;
    return 0;
  }

  private createScenery(totalLength: number): void {
    const baseTreeCount = this.quality === "low" ? 42 : this.quality === "medium" ? 66 : 88;
    const treeCount = Math.max(4, Math.round(baseTreeCount * this.visualProfile.treeDensity));
    const foliageGeometry = new THREE.ConeGeometry(1.4, 3.5, 7);
    const upperFoliageGeometry = new THREE.ConeGeometry(1.02, 2.8, 7);
    const trunkGeometry = new THREE.CylinderGeometry(0.18, 0.27, 1.8, 7);
    const foliageColor = new THREE.Color(this.track.palette.grass).lerp(new THREE.Color(0x174f3a), 0.52).getHex();
    const foliage = new THREE.InstancedMesh(foliageGeometry, makeMaterial(foliageColor), treeCount);
    const upperFoliage = new THREE.InstancedMesh(
      upperFoliageGeometry,
      makeMaterial(new THREE.Color(foliageColor).offsetHSL(-0.01, 0.02, 0.035).getHex()),
      treeCount,
    );
    const trunks = new THREE.InstancedMesh(trunkGeometry, makeMaterial(0x7c4f32), treeCount);
    const matrix = new THREE.Matrix4();
    for (let index = 0; index < treeCount; index += 1) {
      const side = index % 2 === 0 ? -1 : 1;
      const z = -20 - (index / treeCount) * totalLength;
      const x = side * (11.2 + ((index * 37) % 12));
      const scale = 0.75 + ((index * 13) % 7) * 0.06;
      const terraceLift = this.sceneryElevation(x);
      matrix.compose(new THREE.Vector3(x, terraceLift + 2.55 * scale, z), new THREE.Quaternion(), new THREE.Vector3(scale, scale, scale));
      foliage.setMatrixAt(index, matrix);
      matrix.compose(new THREE.Vector3(x, terraceLift + 4.1 * scale, z), new THREE.Quaternion(), new THREE.Vector3(scale, scale, scale));
      upperFoliage.setMatrixAt(index, matrix);
      matrix.compose(new THREE.Vector3(x, terraceLift + 0.72 * scale, z), new THREE.Quaternion(), new THREE.Vector3(scale, scale, scale));
      trunks.setMatrixAt(index, matrix);
    }
    foliage.castShadow = this.quality !== "low";
    upperFoliage.castShadow = this.quality !== "low";
    trunks.castShadow = this.quality !== "low";
    this.scene.add(foliage, upperFoliage, trunks);

    const rockCount = this.quality === "low" ? 32 : this.quality === "medium" ? 50 : 68;
    const rocks = new THREE.InstancedMesh(new THREE.DodecahedronGeometry(0.85, 0), makeMaterial(this.track.palette.rock), rockCount);
    for (let index = 0; index < rockCount; index += 1) {
      const side = index % 2 === 0 ? -1 : 1;
      const z = -35 - (index / rockCount) * totalLength;
      const x = side * (12 + ((index * 29) % 9));
      const scale = 0.58 + ((index * 11) % 9) * 0.12;
      matrix.compose(
        new THREE.Vector3(x, 0.38 * scale, z),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(0, index * 0.7, 0)),
        new THREE.Vector3(scale * 1.5, scale, scale),
      );
      rocks.setMatrixAt(index, matrix);
    }
    rocks.castShadow = this.quality !== "low";
    this.scene.add(rocks);

    const baseMesaCount = this.quality === "low" ? 18 : this.quality === "medium" ? 26 : 34;
    const mesaCount = Math.max(4, Math.round(baseMesaCount * this.visualProfile.mesaDensity));
    const mesaMaterial = makeMaterial(this.track.palette.rock, 0.96);
    const capMaterial = makeMaterial(new THREE.Color(this.track.palette.rock).offsetHSL(0.01, 0.02, 0.08).getHex(), 0.94);
    const mesas = new THREE.InstancedMesh(new THREE.CylinderGeometry(2.7, 4.1, 6.5, 7), mesaMaterial, mesaCount);
    const mesaCaps = new THREE.InstancedMesh(new THREE.CylinderGeometry(2.55, 2.85, 1.1, 7), capMaterial, mesaCount);
    for (let index = 0; index < mesaCount; index += 1) {
      const side = index % 2 === 0 ? -1 : 1;
      const z = -15 - (index / mesaCount) * totalLength;
      const canyonSkyline = this.track.id === "canyon-kickoff";
      const x = side * ((canyonSkyline ? 18.5 : 25) + ((index * 19) % 13));
      const terraceLift = this.sceneryElevation(x);
      const width = 0.95 + (index % 4) * 0.22;
      const height = 0.78 + ((index * 7) % 6) * 0.13;
      const rotation = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, index * 0.47, 0));
      matrix.compose(
        new THREE.Vector3(x, terraceLift + 3.25 * height, z),
        rotation,
        new THREE.Vector3(width, height, width * (0.8 + (index % 3) * 0.12)),
      );
      mesas.setMatrixAt(index, matrix);
      matrix.compose(
        new THREE.Vector3(x, terraceLift + 6.5 * height + 0.5, z),
        rotation,
        new THREE.Vector3(width, 1, width * (0.8 + (index % 3) * 0.12)),
      );
      mesaCaps.setMatrixAt(index, matrix);
    }
    mesas.castShadow = this.quality !== "low";
    mesaCaps.castShadow = this.quality !== "low";
    this.scene.add(mesas, mesaCaps);
  }

  private createSkyDecor(totalLength: number): void {
    const cloudGroupCount = this.quality === "low" ? 14 : this.quality === "medium" ? 22 : 28;
    const cloudCount = cloudGroupCount * 3;
    const clouds = new THREE.InstancedMesh(
      new THREE.SphereGeometry(1.7, 8, 5),
      new THREE.MeshBasicMaterial({ color: 0xf8fbff, toneMapped: false }),
      cloudCount,
    );
    const matrix = new THREE.Matrix4();
    for (let index = 0; index < cloudCount; index += 1) {
      const groupIndex = Math.floor(index / 3);
      const partIndex = index % 3;
      const side = groupIndex % 2 === 0 ? -1 : 1;
      const z = -55 - (groupIndex / cloudGroupCount) * totalLength;
      const baseX = side * (17 + ((groupIndex * 23) % 17));
      const scale = 1.15 + ((groupIndex * 11) % 5) * 0.3;
      matrix.compose(
        new THREE.Vector3(
          baseX + (partIndex - 1) * scale * 1.7,
          18 + ((groupIndex * 7) % 8) + (partIndex === 1 ? scale * 0.45 : 0),
          z + (partIndex - 1) * 0.4,
        ),
        new THREE.Quaternion(),
        new THREE.Vector3(scale * 1.5, scale * 0.68, scale),
      );
      clouds.setMatrixAt(index, matrix);
    }
    clouds.castShadow = false;
    clouds.receiveShadow = false;
    this.scene.add(clouds);
  }

  private createThemeDecor(totalLength: number): void {
    switch (this.track.id) {
      case "coastline-clash": this.createCoastlineThemeDecor(totalLength); break;
      case "foundry-flight": this.createFoundryThemeDecor(totalLength); break;
      case "summit-showdown": this.createSummitThemeDecor(totalLength); break;
      case "pine-run": this.createPineThemeDecor(totalLength); break;
      default: this.createCanyonThemeDecor(totalLength);
    }
  }

  private createCoastlineThemeDecor(totalLength: number): void {
    const matrix = new THREE.Matrix4();
    const water = makeBox(
      30,
      0.12,
      totalLength,
      new THREE.MeshStandardMaterial({ color: 0x22a9cc, roughness: 0.22, metalness: 0.08 }),
    );
    water.position.set(30, -0.28, -totalLength / 2 + 30);
    water.castShadow = false;
    const boardwalk = makeBox(2.5, 0.22, totalLength, makeMaterial(0xb98252, 0.9));
    boardwalk.position.set(11.4, 0, -totalLength / 2 + 30);
    const hutCount = this.quality === "low" ? 10 : this.quality === "medium" ? 16 : 22;
    const huts = new THREE.InstancedMesh(
      new THREE.BoxGeometry(2.5, 1.45, 2.2),
      makeMaterial(0xffffff, 0.72),
      hutCount,
    );
    const hutRoofs = new THREE.InstancedMesh(
      new THREE.ConeGeometry(2.05, 1.1, 4),
      makeMaterial(0xffffff, 0.64),
      hutCount,
    );
    const hutColors = [new THREE.Color(0x2fb7b7), new THREE.Color(0xf26858), new THREE.Color(0xf5c84b)];
    for (let index = 0; index < hutCount; index += 1) {
      const x = 15.8 + (index % 2) * 3.2;
      const z = -80 - (index / hutCount) * totalLength;
      const terraceLift = this.sceneryElevation(x);
      matrix.compose(
        new THREE.Vector3(x, terraceLift + 0.76, z),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(0, index % 2 === 0 ? 0.08 : -0.08, 0)),
        new THREE.Vector3(1, 1, 1),
      );
      huts.setMatrixAt(index, matrix);
      huts.setColorAt(index, hutColors[index % hutColors.length] ?? new THREE.Color(0x2fb7b7));
      matrix.compose(
        new THREE.Vector3(x, terraceLift + 1.97, z),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(0, Math.PI / 4, 0)),
        new THREE.Vector3(1, 1, 1),
      );
      hutRoofs.setMatrixAt(index, matrix);
      hutRoofs.setColorAt(index, hutColors[(index + 1) % hutColors.length] ?? new THREE.Color(0xf26858));
    }
    huts.castShadow = this.quality !== "low";
    hutRoofs.castShadow = this.quality !== "low";
    this.scene.add(water, boardwalk, huts, hutRoofs);
  }

  private createFoundryThemeDecor(totalLength: number): void {
      const matrix = new THREE.Matrix4();
      const stackCount = this.quality === "low" ? 16 : 28;
      const stacks = new THREE.InstancedMesh(
        new THREE.CylinderGeometry(0.55, 0.8, 7.5, 8),
        new THREE.MeshStandardMaterial({ color: 0x50606a, roughness: 0.45, metalness: 0.55, flatShading: true }),
        stackCount,
      );
      for (let index = 0; index < stackCount; index += 1) {
        const side = index % 2 === 0 ? -1 : 1;
        const x = side * (15 + (index % 4) * 2.2);
        const terraceLift = this.sceneryElevation(x);
        matrix.compose(
          new THREE.Vector3(x, terraceLift + 3.55, -70 - (index / stackCount) * totalLength),
          new THREE.Quaternion(),
          new THREE.Vector3(1, 0.8 + (index % 3) * 0.16, 1),
        );
        stacks.setMatrixAt(index, matrix);
      }
      stacks.castShadow = this.quality !== "low";
      const buildingCount = this.quality === "low" ? 10 : 18;
      const buildings = new THREE.InstancedMesh(
        new THREE.BoxGeometry(4.8, 3.2, 5.5),
        new THREE.MeshStandardMaterial({ color: 0x657079, roughness: 0.56, metalness: 0.36, flatShading: true }),
        buildingCount,
      );
      const roofs = new THREE.InstancedMesh(
        new THREE.ConeGeometry(3.8, 1.5, 4),
        makeMaterial(0xb74838, 0.62),
        buildingCount,
      );
      for (let index = 0; index < buildingCount; index += 1) {
        const side = index % 2 === 0 ? -1 : 1;
        const x = side * (21 + (index % 3) * 3.6);
        const z = -42 - (index / buildingCount) * totalLength;
        const scale = 0.8 + (index % 4) * 0.1;
        const terraceLift = this.sceneryElevation(x);
        matrix.compose(
          new THREE.Vector3(x, terraceLift + 1.55 * scale, z),
          new THREE.Quaternion().setFromEuler(new THREE.Euler(0, Math.PI / 4 + side * 0.05, 0)),
          new THREE.Vector3(scale, scale, scale),
        );
        buildings.setMatrixAt(index, matrix);
        matrix.compose(
          new THREE.Vector3(x, terraceLift + 3.72 * scale, z),
          new THREE.Quaternion().setFromEuler(new THREE.Euler(0, Math.PI / 4, 0)),
          new THREE.Vector3(scale, scale, scale),
        );
        roofs.setMatrixAt(index, matrix);
      }
      const smokeCount = this.quality === "low" ? 16 : 30;
      const smoke = new THREE.InstancedMesh(
        new THREE.SphereGeometry(0.8, 7, 5),
        new THREE.MeshBasicMaterial({ color: 0xd9dedb, transparent: true, opacity: 0.6, depthWrite: false }),
        smokeCount,
      );
      for (let index = 0; index < smokeCount; index += 1) {
        const side = index % 2 === 0 ? -1 : 1;
        const scale = 0.75 + (index % 3) * 0.3;
        const x = side * (15 + (index % 4) * 2.2);
        const terraceLift = this.sceneryElevation(x);
        matrix.compose(
          new THREE.Vector3(x, terraceLift + 8.2 + (index % 3) * 1.2, -70 - (index / smokeCount) * totalLength),
          new THREE.Quaternion(),
          new THREE.Vector3(scale * 1.2, scale, scale),
        );
        smoke.setMatrixAt(index, matrix);
      }
      this.scene.add(stacks, buildings, roofs, smoke);
  }

  private createSummitThemeDecor(totalLength: number): void {
      const matrix = new THREE.Matrix4();
      const peakCount = this.quality === "low" ? 18 : 30;
      const rockPeaks = new THREE.InstancedMesh(
        new THREE.ConeGeometry(3.9, 8.5, 6),
        makeMaterial(0x6f7182, 0.95),
        peakCount,
      );
      const snowPeaks = new THREE.InstancedMesh(
        new THREE.ConeGeometry(2.05, 3.7, 6),
        makeMaterial(0xe9f4f7, 0.9),
        peakCount,
      );
      for (let index = 0; index < peakCount; index += 1) {
        const side = index % 2 === 0 ? -1 : 1;
        const x = side * (20 + (index % 5) * 3.2);
        const z = -55 - (index / peakCount) * totalLength;
        const scale = 0.82 + (index % 4) * 0.13;
        const terraceLift = this.sceneryElevation(x);
        matrix.compose(
          new THREE.Vector3(x, terraceLift + 4.2 * scale, z),
          new THREE.Quaternion().setFromEuler(new THREE.Euler(0, index * 0.29, 0)),
          new THREE.Vector3(scale, scale, scale),
        );
        rockPeaks.setMatrixAt(index, matrix);
        matrix.compose(
          new THREE.Vector3(x, terraceLift + 7.15 * scale, z),
          new THREE.Quaternion().setFromEuler(new THREE.Euler(0, index * 0.29, 0)),
          new THREE.Vector3(scale, scale, scale),
        );
        snowPeaks.setMatrixAt(index, matrix);
      }
      rockPeaks.castShadow = this.quality !== "low";
      this.scene.add(rockPeaks, snowPeaks);
  }

  private createPineThemeDecor(totalLength: number): void {
      const matrix = new THREE.Matrix4();
      const logCount = this.quality === "low" ? 18 : 32;
      const logs = new THREE.InstancedMesh(
        new THREE.CylinderGeometry(0.42, 0.42, 4.8, 8),
        makeMaterial(0x855532, 0.9),
        logCount,
      );
      const rotation = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, Math.PI / 2));
      for (let index = 0; index < logCount; index += 1) {
        const side = index % 2 === 0 ? -1 : 1;
        const x = side * (11 + (index % 3) * 1.2);
        const terraceLift = this.sceneryElevation(x);
        matrix.compose(
          new THREE.Vector3(x, terraceLift + 0.45 + (index % 2) * 0.5, -65 - (index / logCount) * totalLength),
          rotation,
          new THREE.Vector3(1, 1, 1),
        );
        logs.setMatrixAt(index, matrix);
      }
      const cabinCount = this.quality === "low" ? 8 : 14;
      const cabins = new THREE.InstancedMesh(
        new THREE.BoxGeometry(3.6, 2.1, 3.3),
        makeMaterial(0x825034, 0.94),
        cabinCount,
      );
      const cabinRoofs = new THREE.InstancedMesh(
        new THREE.ConeGeometry(3.1, 1.55, 4),
        makeMaterial(0x325447, 0.92),
        cabinCount,
      );
      for (let index = 0; index < cabinCount; index += 1) {
        const side = index % 2 === 0 ? -1 : 1;
        const x = side * (16 + (index % 3) * 2.8);
        const z = -110 - (index / cabinCount) * totalLength;
        const terraceLift = this.sceneryElevation(x);
        matrix.makeTranslation(x, terraceLift + 1.05, z);
        cabins.setMatrixAt(index, matrix);
        matrix.compose(
          new THREE.Vector3(x, terraceLift + 2.75, z),
          new THREE.Quaternion().setFromEuler(new THREE.Euler(0, Math.PI / 4, 0)),
          new THREE.Vector3(1, 1, 1),
        );
        cabinRoofs.setMatrixAt(index, matrix);
      }
      cabins.castShadow = this.quality !== "low";
      cabinRoofs.castShadow = this.quality !== "low";
      this.scene.add(logs, cabins, cabinRoofs);
  }

  private createCanyonThemeDecor(totalLength: number): void {
    const matrix = new THREE.Matrix4();
    const archMaterial = makeMaterial(this.track.palette.rock, 0.9);
    const arches = new THREE.InstancedMesh(
      new THREE.TorusGeometry(3.6, 0.95, 6, 12, Math.PI),
      archMaterial,
      5,
    );
    for (let index = 0; index < 5; index += 1) {
      const x = index % 2 === 0 ? -18 : 18;
      matrix.compose(
        new THREE.Vector3(
          x,
          this.sceneryElevation(x) + 2.4,
          -95 - index * Math.max(95, totalLength / 6),
        ),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, index % 2 === 0 ? 0.08 : -0.08)),
        new THREE.Vector3(1, 1, 1),
      );
      arches.setMatrixAt(index, matrix);
    }
    arches.instanceMatrix.needsUpdate = true;
    arches.castShadow = this.quality !== "low";
    this.scene.add(arches);
    const cactusCount = this.quality === "low" ? 14 : 24;
    const cacti = new THREE.InstancedMesh(
      new THREE.CylinderGeometry(0.3, 0.42, 3.1, 7),
      makeMaterial(0x3e7750, 0.96),
      cactusCount,
    );
    for (let index = 0; index < cactusCount; index += 1) {
      const side = index % 2 === 0 ? -1 : 1;
      const scale = 0.65 + (index % 5) * 0.12;
      const x = side * (12 + (index % 4) * 2.2);
      matrix.compose(
        new THREE.Vector3(x, this.sceneryElevation(x) + 1.5 * scale, -75 - (index / cactusCount) * totalLength),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(0, index * 0.55, 0)),
        new THREE.Vector3(scale, scale, scale),
      );
      cacti.setMatrixAt(index, matrix);
    }
    cacti.castShadow = this.quality !== "low";
    this.scene.add(cacti);
  }

  private createFestivalDecor(totalLength: number): void {
    const timber = makeMaterial(0x7f4e2e);
    const roofMaterial = makeMaterial(0x159ca2);
    this.createFestivalStands(timber, roofMaterial);
    this.createFestivalCrowd();
    this.createFestivalTents(timber);
    this.createFestivalBanners(totalLength);
    this.createFestivalRoutePockets(totalLength, timber);
    this.createFestivalBillboards(timber);
    this.createFestivalLandmark(timber, roofMaterial);
  }

  private createFestivalRoutePockets(
    totalLength: number,
    timber: THREE.MeshStandardMaterial,
  ): void {
    const spacing = this.quality === "low" ? 250 : this.quality === "medium" ? 180 : 135;
    const pocketCount = Math.max(4, Math.floor((totalLength - 150) / spacing));
    const peoplePerPocket = this.quality === "low" ? 4 : 6;
    const platforms = new THREE.InstancedMesh(
      new THREE.BoxGeometry(4.3, 0.34, 4.5),
      makeMaterial(0x875235, 0.9),
      pocketCount,
    );
    const canopies = new THREE.InstancedMesh(
      new THREE.ConeGeometry(2.55, 1.35, 4),
      makeMaterial(0xffffff, 0.68),
      pocketCount,
    );
    const posts = new THREE.InstancedMesh(
      new THREE.CylinderGeometry(0.08, 0.1, 3.7, 6),
      timber,
      pocketCount * 4,
    );
    const peopleCount = pocketCount * peoplePerPocket;
    const people = new THREE.InstancedMesh(
      new THREE.CapsuleGeometry(0.16, 0.42, 3, 6),
      makeMaterial(0xffffff, 0.8),
      peopleCount,
    );
    const heads = new THREE.InstancedMesh(
      new THREE.SphereGeometry(0.17, 7, 5),
      makeMaterial(0xffffff, 0.86),
      peopleCount,
    );
    const canopyColors = [new THREE.Color(0x18aaa8), new THREE.Color(0xef6354), new THREE.Color(0xf3c94b)];
    const peopleColors = [new THREE.Color(0xf0a33a), new THREE.Color(0x20b8b5), new THREE.Color(0xe65f53), new THREE.Color(0x466fba), new THREE.Color(0xf0dfc0)];
    const skinColors = [new THREE.Color(0xf2c18f), new THREE.Color(0xb87855), new THREE.Color(0x7f4c38), new THREE.Color(0xe0a877)];
    const random = seededRandom(this.track.order * 377_911);
    const matrix = new THREE.Matrix4();
    const rotation = new THREE.Quaternion();
    let postIndex = 0;
    let personIndex = 0;

    for (let pocket = 0; pocket < pocketCount; pocket += 1) {
      const side = (pocket + this.track.order) % 2 === 0 ? -1 : 1;
      const x = side * (11.85 + random() * 0.45);
      const z = -125 - pocket * spacing - (random() - 0.5) * 34;
      const elevation = this.sceneryElevation(x);
      rotation.setFromEuler(new THREE.Euler(0, side * (0.04 + random() * 0.035), 0));
      matrix.compose(
        new THREE.Vector3(x, elevation + 0.17, z),
        rotation,
        new THREE.Vector3(1, 1, 1),
      );
      platforms.setMatrixAt(pocket, matrix);
      matrix.compose(
        new THREE.Vector3(x, elevation + 4.05, z),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(0, Math.PI / 4, 0)),
        new THREE.Vector3(1, 1, 1),
      );
      canopies.setMatrixAt(pocket, matrix);
      canopies.setColorAt(pocket, canopyColors[pocket % canopyColors.length] ?? new THREE.Color(0x18aaa8));

      for (const xOffset of [-1.65, 1.65]) {
        for (const zOffset of [-1.65, 1.65]) {
          matrix.makeTranslation(x + xOffset, elevation + 1.95, z + zOffset);
          posts.setMatrixAt(postIndex, matrix);
          postIndex += 1;
        }
      }

      for (let person = 0; person < peoplePerPocket; person += 1) {
        const column = person % 3;
        const row = Math.floor(person / 3);
        const personX = x - side * (0.55 + row * 0.55);
        const personZ = z - 1.05 + column * 1.05;
        const bodyY = elevation + 0.82;
        matrix.makeTranslation(personX, bodyY, personZ);
        people.setMatrixAt(personIndex, matrix);
        people.setColorAt(personIndex, peopleColors[(person + pocket) % peopleColors.length] ?? new THREE.Color(0xf0a33a));
        matrix.makeTranslation(personX, bodyY + 0.47, personZ);
        heads.setMatrixAt(personIndex, matrix);
        heads.setColorAt(personIndex, skinColors[(person + pocket) % skinColors.length] ?? new THREE.Color(0xe0a877));
        personIndex += 1;
      }
    }

    platforms.castShadow = this.quality !== "low";
    platforms.receiveShadow = true;
    canopies.castShadow = this.quality !== "low";
    posts.castShadow = this.quality === "high";
    people.castShadow = this.quality === "high";
    heads.castShadow = this.quality === "high";
    this.scene.add(platforms, canopies, posts, people, heads);
  }

  private createFestivalStands(
    timber: THREE.MeshStandardMaterial,
    roofMaterial: THREE.MeshStandardMaterial,
  ): void {
    const matrix = new THREE.Matrix4();
    const stands = new THREE.InstancedMesh(new THREE.BoxGeometry(5.8, 0.38, 3.8), timber, 2);
    const standRoofs = new THREE.InstancedMesh(new THREE.BoxGeometry(6.2, 0.28, 4.25), roofMaterial, 2);
    const bleachers = new THREE.InstancedMesh(new THREE.BoxGeometry(5.2, 0.34, 0.78), timber, 6);
    const standPosts = new THREE.InstancedMesh(new THREE.BoxGeometry(0.18, 4.1, 0.18), timber, 8);
    let bleacherIndex = 0;
    let standPostIndex = 0;
    for (const side of [-1, 1]) {
      const standIndex = side < 0 ? 0 : 1;
      matrix.makeTranslation(side * 10.65, 1.15, -18);
      stands.setMatrixAt(standIndex, matrix);
      matrix.makeTranslation(side * 10.65, 4.25, -18);
      standRoofs.setMatrixAt(standIndex, matrix);
      standRoofs.setColorAt(standIndex, side < 0 ? new THREE.Color(0x159ca2) : new THREE.Color(0xef6254));
      for (let row = 0; row < 3; row += 1) {
        matrix.makeTranslation(side * 10.65, 1.35 + row * 0.34, -16.9 - row * 0.76);
        bleachers.setMatrixAt(bleacherIndex, matrix);
        bleacherIndex += 1;
      }
      for (const xOffset of [-2.5, 2.5]) {
        for (const zOffset of [-1.65, 1.65]) {
          matrix.makeTranslation(side * 10.65 + xOffset, 2.05, -18 + zOffset);
          standPosts.setMatrixAt(standPostIndex, matrix);
          standPostIndex += 1;
        }
      }
    }
    stands.castShadow = this.quality !== "low";
    standRoofs.castShadow = this.quality !== "low";
    bleachers.castShadow = this.quality !== "low";
    standPosts.castShadow = this.quality !== "low";
    this.scene.add(stands, standRoofs, bleachers, standPosts);
  }

  private createFestivalCrowd(): void {
    const matrix = new THREE.Matrix4();
    const peopleCount = this.quality === "low" ? 32 : this.quality === "medium" ? 56 : 80;
    const people = new THREE.InstancedMesh(
      new THREE.CapsuleGeometry(0.17, 0.46, 3, 6),
      makeMaterial(0xffffff),
      peopleCount,
    );
    const heads = new THREE.InstancedMesh(
      new THREE.SphereGeometry(0.18, 7, 5),
      makeMaterial(0xffffff, 0.86),
      peopleCount,
    );
    const peopleColors = [new THREE.Color(0xf0a33a), new THREE.Color(0x20b8b5), new THREE.Color(0xe65f53), new THREE.Color(0x466fba), new THREE.Color(0xf0dfc0)];
    const skinColors = [new THREE.Color(0xf2c18f), new THREE.Color(0xb87855), new THREE.Color(0x7f4c38), new THREE.Color(0xe0a877)];
    for (let index = 0; index < peopleCount; index += 1) {
      const side = index % 2 === 0 ? -1 : 1;
      const localIndex = Math.floor(index / 2);
      const column = localIndex % 7;
      const row = Math.floor(localIndex / 7) % 4;
      const x = side * 10.65 - 2.25 + column * 0.75;
      const z = -16.55 - row * 0.72;
      const bodyY = 1.82 + row * 0.32;
      matrix.makeTranslation(x, bodyY, z);
      people.setMatrixAt(index, matrix);
      people.setColorAt(index, peopleColors[index % peopleColors.length] ?? new THREE.Color(0xf0a33a));
      matrix.makeTranslation(x, bodyY + 0.5, z);
      heads.setMatrixAt(index, matrix);
      heads.setColorAt(index, skinColors[index % skinColors.length] ?? new THREE.Color(0xe0a877));
    }
    people.castShadow = this.quality !== "low";
    heads.castShadow = this.quality === "high";
    this.scene.add(people, heads);
  }

  private createFestivalTents(timber: THREE.MeshStandardMaterial): void {
    const matrix = new THREE.Matrix4();
    const tentCount = this.quality === "low" ? 3 : 5;
    const tentRoofs = new THREE.InstancedMesh(
      new THREE.ConeGeometry(2.35, 1.55, 4),
      makeMaterial(0xffffff, 0.66),
      tentCount,
    );
    const tentPosts = new THREE.InstancedMesh(
      new THREE.CylinderGeometry(0.07, 0.09, 2.25, 6),
      timber,
      tentCount * 4,
    );
    const tentColors = [new THREE.Color(0xf4c94c), new THREE.Color(0x1eb9b7), new THREE.Color(0xf06655)];
    const tentPositions = [
      new THREE.Vector3(-15, 0, -14),
      new THREE.Vector3(15, 0, -14),
      new THREE.Vector3(-15.5, 0, -55),
      new THREE.Vector3(15.5, 0, -58),
      new THREE.Vector3(-14.5, 0, -92),
    ];
    let tentPostIndex = 0;
    for (let index = 0; index < tentCount; index += 1) {
      const position = tentPositions[index] ?? new THREE.Vector3(15, 0, -92);
      matrix.compose(
        new THREE.Vector3(position.x, 3, position.z),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(0, Math.PI / 4, 0)),
        new THREE.Vector3(1, 1, 1),
      );
      tentRoofs.setMatrixAt(index, matrix);
      tentRoofs.setColorAt(index, tentColors[index % tentColors.length] ?? new THREE.Color(0xf4c94c));
      for (const xOffset of [-1.35, 1.35]) {
        for (const zOffset of [-1.35, 1.35]) {
          matrix.makeTranslation(position.x + xOffset, 1.15, position.z + zOffset);
          tentPosts.setMatrixAt(tentPostIndex, matrix);
          tentPostIndex += 1;
        }
      }
    }
    tentRoofs.castShadow = this.quality !== "low";
    tentPosts.castShadow = this.quality !== "low";
    this.scene.add(tentRoofs, tentPosts);
  }

  private createFestivalBanners(totalLength: number): void {
    const matrix = new THREE.Matrix4();
    const poleMaterial = makeMaterial(0x6f472d);
    const bannerDistances = [43, 96];
    const lapCount = this.simulation.snapshot.race.totalLaps;
    for (let lap = 1; lap <= lapCount; lap += 1) {
      bannerDistances.push(Math.min(totalLength - 25, lap * this.track.courseLength - 30));
    }
    const bannerPoles = new THREE.InstancedMesh(
      new THREE.CylinderGeometry(0.09, 0.12, 6.2, 6),
      poleMaterial,
      bannerDistances.length * 2,
    );
    const ropes = new THREE.InstancedMesh(
      new THREE.BoxGeometry(16.4, 0.05, 0.05),
      poleMaterial,
      bannerDistances.length,
    );
    const flagsPerLine = this.quality === "low" ? 9 : 13;
    const flags = new THREE.InstancedMesh(
      new THREE.ConeGeometry(0.29, 0.7, 3),
      makeMaterial(0xffffff, 0.7),
      bannerDistances.length * flagsPerLine,
    );
    const flagColors = [new THREE.Color(0xf15f50), new THREE.Color(0x22cfcc), new THREE.Color(0xffd23f)];
    let flagIndex = 0;
    for (const [lineIndex, distance] of bannerDistances.entries()) {
      for (const side of [-1, 1]) {
        matrix.makeTranslation(side * 8.2, 3.1, -distance);
        bannerPoles.setMatrixAt(lineIndex * 2 + (side > 0 ? 1 : 0), matrix);
      }
      matrix.makeTranslation(0, 5.5, -distance);
      ropes.setMatrixAt(lineIndex, matrix);
      for (let index = 0; index < flagsPerLine; index += 1) {
        const ratio = index / (flagsPerLine - 1);
        matrix.compose(
          new THREE.Vector3(-7.45 + ratio * 14.9, 5.15 - Math.sin(ratio * Math.PI) * 0.34, -distance),
          new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, Math.PI)),
          new THREE.Vector3(1, 1, 1),
        );
        flags.setMatrixAt(flagIndex, matrix);
        flags.setColorAt(flagIndex, flagColors[(index + lineIndex) % flagColors.length] ?? new THREE.Color(0xf15f50));
        flagIndex += 1;
      }
    }
    bannerPoles.castShadow = this.quality !== "low";
    flags.castShadow = this.quality === "high";
    this.scene.add(bannerPoles, ropes, flags);
  }

  private createFestivalBillboards(timber: THREE.MeshStandardMaterial): void {
    const matrix = new THREE.Matrix4();
    const signCanvas = document.createElement("canvas");
    signCanvas.width = 512;
    signCanvas.height = 256;
    const signContext = signCanvas.getContext("2d");
    if (signContext) {
      signContext.fillStyle = "#071d32";
      signContext.fillRect(0, 0, 512, 256);
      signContext.fillStyle = "#ef624f";
      signContext.fillRect(0, 0, 512, 18);
      signContext.fillRect(0, 238, 512, 18);
      signContext.fillStyle = "#f5edda";
      signContext.font = "900 66px Arial Narrow, Arial, sans-serif";
      signContext.textAlign = "center";
      signContext.textBaseline = "middle";
      signContext.fillText("RIVET RIDGE", 256, 92);
      signContext.fillStyle = "#f4ca42";
      signContext.font = "900 42px Arial Narrow, Arial, sans-serif";
      signContext.fillText(this.track.name.toUpperCase(), 256, 167, 460);
    }
    const signTexture = new THREE.CanvasTexture(signCanvas);
    signTexture.colorSpace = THREE.SRGBColorSpace;
    this.ownedTextures.push(signTexture);
    const billboardCount = this.quality === "low" ? 2 : 4;
    const billboards = new THREE.InstancedMesh(
      new THREE.PlaneGeometry(5.2, 2.6),
      new THREE.MeshBasicMaterial({ map: signTexture, side: THREE.DoubleSide, toneMapped: false }),
      billboardCount,
    );
    const billboardPosts = new THREE.InstancedMesh(
      new THREE.CylinderGeometry(0.11, 0.15, 6.2, 6),
      timber,
      billboardCount * 2,
    );
    for (let index = 0; index < billboardCount; index += 1) {
      const side = index % 2 === 0 ? -1 : 1;
      const z = -22 - Math.floor(index / 2) * 72;
      const x = side * 11.75;
      matrix.compose(
        new THREE.Vector3(x, 5.95, z),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(0, side * -0.2, 0)),
        new THREE.Vector3(1, 1, 1),
      );
      billboards.setMatrixAt(index, matrix);
      for (const postOffset of [-1.85, 1.85]) {
        matrix.makeTranslation(x + postOffset, 2.95, z + 0.08);
        billboardPosts.setMatrixAt(index * 2 + (postOffset > 0 ? 1 : 0), matrix);
      }
    }
    billboardPosts.castShadow = this.quality !== "low";
    this.scene.add(billboards, billboardPosts);
  }

  private createFestivalLandmark(
    timber: THREE.MeshStandardMaterial,
    roofMaterial: THREE.MeshStandardMaterial,
  ): void {
    const landmark = new THREE.LOD();
    landmark.name = "festival-signal-tower-lod";
    const detailedTower = new THREE.Group();
    const towerLegs = [-1, 1].map((side) => {
      const leg = makeBox(0.28, 7.5, 0.28, timber);
      leg.position.set(side * 1.05, 3.75, 0);
      leg.rotation.z = side * -0.08;
      return leg;
    });
    const signal = new THREE.Mesh(new THREE.OctahedronGeometry(1.35, 0), makeMaterial(YELLOW, 0.5));
    signal.position.y = 8.15;
    const crossbar = makeBox(3.4, 0.3, 0.3, roofMaterial);
    crossbar.position.y = 6.7;
    detailedTower.add(...towerLegs, signal, crossbar);
    setShadow(detailedTower);

    const distantTower = makeBox(2.6, 8.4, 1.2, roofMaterial);
    distantTower.position.y = 4.2;
    distantTower.castShadow = false;
    landmark.addLevel(detailedTower, 0);
    landmark.addLevel(distantTower, 95);
    landmark.position.set(15.5, 0, -68);
    this.scene.add(landmark);
  }

  private createAiField(): void {
    if (!(["rival", "mastery"] as RaceMode[]).includes(this.mode)) return;
    for (const [index, entrant] of AI_FIELD.entries()) {
      const group = this.createBike(entrant.color, index % 2 === 0 ? 0x13283d : 0xf3f0dc, false);
      const lane = (index % 4) as LaneIndex;
      const progress = index === 4 ? -11 : 5 + index * 4.6;
      this.scene.add(group);
      this.aiRiders.push({
        riderId: entrant.id,
        riderName: entrant.name,
        group,
        behavior: index === 4 ? "pursuer" : "route",
        simulation: new RaceSimulation(createAiSimulationOptions(lane, progress, index * 7)),
        targetLane: lane,
        previousLaneCommand: 0,
        routeTimerSeconds: index * 0.1,
        recoveryDelaySeconds: 0,
        lastObstacleKey: "",
      });
    }
  }

  private applyQaVisualDistance(): void {
    if (!this.visualQualificationFreeze || import.meta.env.VITE_QA_MODE !== "1") return;
    const distance = parseQaVisualDistance(window.location.search, this.track.courseLength);
    if (distance === undefined) return;

    this.simulation.relocate(distance);
    for (const ai of this.aiRiders) {
      const gridOffset = ai.simulation.snapshot.bike.forwardPosition;
      ai.simulation.relocate(distance + gridOffset);
    }
    this.canvas.dataset.visualDistance = String(distance);
    this.emitHud(this.simulation.snapshot);
  }

  private createBike(color: number, accentColor: number, player: boolean): THREE.Group {
    const group = new THREE.Group();
    const bodyMaterial = makeMaterial(color, 0.46);
    const accent = makeMaterial(accentColor, 0.5);
    const dark = makeMaterial(0x17212b, 0.72);
    const metal = new THREE.MeshStandardMaterial({ color: 0x7e8990, roughness: 0.35, metalness: 0.65, flatShading: true });
    const wheelMaterial = makeMaterial(0x161719, 0.98);

    const frontWheel = new THREE.Mesh(new THREE.CylinderGeometry(0.52, 0.52, 0.25, 14), wheelMaterial);
    const backWheel = frontWheel.clone();
    frontWheel.rotation.z = Math.PI / 2;
    backWheel.rotation.z = Math.PI / 2;
    frontWheel.position.set(0, -0.1, -0.92);
    backWheel.position.set(0, -0.1, 0.92);
    const body = makeBox(0.62, 0.38, 1.35, bodyMaterial);
    body.position.y = 0.34;
    body.rotation.x = -0.05;
    const tank = makeBox(0.76, 0.5, 0.75, accent);
    tank.position.set(0, 0.62, -0.25);
    tank.rotation.x = -0.1;
    const fork = makeBox(0.12, 1.08, 0.12, metal);
    fork.position.set(0, 0.42, -0.8);
    fork.rotation.x = -0.22;
    const handle = makeBox(1.0, 0.09, 0.09, metal);
    handle.position.set(0, 0.98, -0.64);

    const torso = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.31, 0.34, 4, 8),
      player ? bodyMaterial : accent,
    );
    torso.position.set(0, 1.23, 0.12);
    torso.rotation.x = 0.35;
    const helmet = new THREE.Mesh(new THREE.IcosahedronGeometry(0.34, 1), player ? accent : bodyMaterial);
    helmet.position.set(0, 1.74, -0.2);
    const visor = makeBox(0.42, 0.12, 0.18, dark);
    visor.position.set(0, 1.72, -0.45);
    const helmetPeak = makeBox(0.54, 0.07, 0.27, player ? bodyMaterial : accent);
    helmetPeak.position.set(0, 1.88, -0.34);
    helmetPeak.rotation.x = -0.16;
    const armLeft = new THREE.Mesh(new THREE.CapsuleGeometry(0.085, 0.39, 3, 6), bodyMaterial);
    const armRight = armLeft.clone();
    armLeft.position.set(-0.4, 1.28, -0.35);
    armRight.position.set(0.4, 1.28, -0.35);
    armLeft.rotation.x = armRight.rotation.x = 0.75;
    armLeft.rotation.z = -0.35;
    armRight.rotation.z = 0.35;
    const backPlate = makeBox(0.58, 0.52, 0.11, player ? makeMaterial(0xf3ead5, 0.72) : dark);
    backPlate.position.set(0, 1.32, 0.34);
    backPlate.rotation.x = 0.35;
    const backStripe = makeBox(0.4, 0.12, 0.14, player ? accent : bodyMaterial);
    backStripe.position.set(0, 1.15, 0.405);
    backStripe.rotation.x = 0.35;
    const numberBars = new THREE.InstancedMesh(
      new THREE.BoxGeometry(0.075, 0.25, 0.055),
      dark,
      2,
    );
    const numberMatrix = new THREE.Matrix4();
    const numberRotation = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.35, 0, 0));
    numberMatrix.compose(
      new THREE.Vector3(-0.075, 1.42, 0.43),
      numberRotation,
      new THREE.Vector3(1, 1, 1),
    );
    numberBars.setMatrixAt(0, numberMatrix);
    numberMatrix.compose(
      new THREE.Vector3(0.075, 1.42, 0.43),
      numberRotation,
      new THREE.Vector3(1, 1, 1),
    );
    numberBars.setMatrixAt(1, numberMatrix);
    const hips = makeBox(0.64, 0.3, 0.46, dark);
    hips.position.set(0, 0.88, 0.42);
    const leftLeg = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.11, 0.38, 3, 6),
      player ? bodyMaterial : accent,
    );
    const rightLeg = leftLeg.clone();
    leftLeg.position.set(-0.27, 0.72, 0.48);
    rightLeg.position.set(0.27, 0.72, 0.48);
    leftLeg.rotation.x = rightLeg.rotation.x = -0.62;
    leftLeg.rotation.z = -0.12;
    rightLeg.rotation.z = 0.12;
    const leftBoot = makeBox(0.24, 0.22, 0.52, dark);
    const rightBoot = leftBoot.clone();
    leftBoot.position.set(-0.29, 0.44, 0.28);
    rightBoot.position.set(0.29, 0.44, 0.28);

    const shoulderPads = new THREE.InstancedMesh(
      new THREE.IcosahedronGeometry(0.17, 0),
      accent,
      2,
    );
    const detailMatrix = new THREE.Matrix4();
    detailMatrix.compose(
      new THREE.Vector3(-0.37, 1.45, -0.02),
      new THREE.Quaternion(),
      new THREE.Vector3(1.35, 0.9, 1),
    );
    shoulderPads.setMatrixAt(0, detailMatrix);
    detailMatrix.compose(
      new THREE.Vector3(0.37, 1.45, -0.02),
      new THREE.Quaternion(),
      new THREE.Vector3(1.35, 0.9, 1),
    );
    shoulderPads.setMatrixAt(1, detailMatrix);

    const gloves = new THREE.InstancedMesh(new THREE.SphereGeometry(0.13, 7, 5), dark, 2);
    detailMatrix.makeTranslation(-0.48, 1.13, -0.58);
    gloves.setMatrixAt(0, detailMatrix);
    detailMatrix.makeTranslation(0.48, 1.13, -0.58);
    gloves.setMatrixAt(1, detailMatrix);

    const kneePads = new THREE.InstancedMesh(new THREE.BoxGeometry(0.24, 0.25, 0.13), dark, 2);
    detailMatrix.compose(
      new THREE.Vector3(-0.29, 0.7, 0.18),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.62, 0, -0.12)),
      new THREE.Vector3(1, 1, 1),
    );
    kneePads.setMatrixAt(0, detailMatrix);
    detailMatrix.compose(
      new THREE.Vector3(0.29, 0.7, 0.18),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.62, 0, 0.12)),
      new THREE.Vector3(1, 1, 1),
    );
    kneePads.setMatrixAt(1, detailMatrix);

    const bikeVisual = new THREE.Group();
    bikeVisual.name = "procedural-bike-fallback";
    bikeVisual.add(frontWheel, backWheel, body, tank, fork, handle);
    const riderVisual = new THREE.Group();
    riderVisual.name = player ? "player-rider" : "rival-rider";
    riderVisual.add(
      torso,
      helmet,
      visor,
      helmetPeak,
      armLeft,
      armRight,
      backPlate,
      backStripe,
      numberBars,
      hips,
      leftLeg,
      rightLeg,
      leftBoot,
      rightBoot,
      shoulderPads,
      gloves,
      kneePads,
    );
    group.add(bikeVisual, riderVisual);
    group.userData.frontWheel = frontWheel;
    group.userData.backWheel = backWheel;
    group.userData.bikeVisual = bikeVisual;
    setShadow(group);
    return group;
  }
}

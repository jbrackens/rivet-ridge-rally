import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

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
  resolveRiderPairCollision,
  type AiBehavior,
  type AiDifficultyProfile,
  type AiObstaclePolicy,
} from "./aiRules";
import {
  CoursePresentationRoute,
  createCourseRibbonGeometry,
} from "./CoursePresentationRoute";
import {
  resolveObstacleContacts,
  type ObstacleContactSection,
} from "./obstacleContacts";
import { parseQaVisualDistance } from "./qaVisualCapture";
import {
  resolveRiderSpeedTuck,
  resolveRiderSteeringRoll,
  usesPortraitRacePresentation,
} from "./racePresentation";
import {
  TutorialLessonGate,
  type TutorialLessonGateSnapshot,
  type TutorialLessonSignal,
} from "./tutorialLessonGate";

const PLAYER_COLOR = 0x19b8b0;
const PLAYER_ACCENT = 0xf15f50;
const NAVY = 0x061c32;
const YELLOW = 0xf7cc3d;
const COOLING = 0x1ddfe6;
const START_GRID_NUMBER_PROGRESS = 7;
const START_GRID_LINE_PROGRESS = 10.4;
const START_GRID_SEGMENTS = {
  a: { x: 0, forward: 0.78, width: 0.78, depth: 0.14 },
  b: { x: 0.43, forward: 0.39, width: 0.14, depth: 0.72 },
  c: { x: 0.43, forward: -0.39, width: 0.14, depth: 0.72 },
  d: { x: 0, forward: -0.78, width: 0.78, depth: 0.14 },
  e: { x: -0.43, forward: -0.39, width: 0.14, depth: 0.72 },
  f: { x: -0.43, forward: 0.39, width: 0.14, depth: 0.72 },
  g: { x: 0, forward: 0, width: 0.78, depth: 0.14 },
} as const;
type StartGridSegment = keyof typeof START_GRID_SEGMENTS;
const START_GRID_DIGITS: ReadonlyArray<readonly StartGridSegment[]> = [
  ["b", "c"],
  ["a", "b", "g", "e", "d"],
  ["a", "b", "g", "c", "d"],
  ["f", "g", "b", "c"],
];
const HIGH_CONTRAST_GUIDE_X = [-6.28, -3, 0, 3, 6.28] as const;
const AUTHORED_GUIDE_VISIBILITY_FLOOR = 0.087;
const WORLD_UP = new THREE.Vector3(0, 1, 0);
const WORLD_RIGHT = new THREE.Vector3(1, 0, 0);
const SHADOW_ORIENTATION = new THREE.Quaternion().setFromEuler(
  new THREE.Euler(-Math.PI / 2, 0, 0),
);
const MAX_DELTA_SECONDS = 0.1;
const FIXED_STEP_EPSILON = FIXED_DT * 1e-9;
const PLAYER_ASSET_READINESS_TIMEOUT_MS = 5_000;
const CANYON_PANORAMA_READINESS_TIMEOUT_MS = 5_000;
const CANYON_FESTIVAL_PANORAMA_URL = "/assets/art/canyon-festival-panorama.png";
const MAX_AI_CLASSIFICATION_STEPS = 60 * 60 * 15;
const MAX_REPLAY_BYTES = 512_000;
const AI_FIELD = [
  {
    id: "copper-comet",
    name: "Copper Comet",
    color: 0xf2b134,
    accentColor: 0x13283d,
    number: "17",
  },
  {
    id: "bluejay",
    name: "Bluejay",
    color: 0x5577d8,
    accentColor: 0xf2b134,
    number: "31",
  },
  {
    id: "night-spur",
    name: "Night Spur",
    color: 0x8e59b7,
    accentColor: 0xf3f0dc,
    number: "46",
  },
  {
    id: "greenline",
    name: "Greenline",
    color: 0x47a65b,
    accentColor: 0xf7cc3d,
    number: "58",
  },
  {
    id: "ember-scout",
    name: "Ember Scout",
    color: 0xe57637,
    accentColor: 0x19b8b0,
    number: "73",
  },
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
  tutorialLesson: TutorialLessonGateSnapshot;
  demonstrated: {
    rideAtUsableSpeed: boolean;
    coast: boolean;
    criticalHeatReached: boolean;
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
  tutorialEvents: {
    trainingBumpClearedInWheelie: boolean;
    choiceBarrierAvoided: boolean;
    grassSlowdownExperienced: boolean;
    grassReturnedToDirt: boolean;
    recoveryBarrierCrash: boolean;
    recoveryBarrierRecovered: boolean;
  };
}

export interface GameEngineOptions {
  canvas: HTMLCanvasElement;
  trackId: TrackDefinition["id"];
  mode: RaceMode;
  settings: GameSettings;
  initialInputDevice?: InputDevice | undefined;
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

interface RiderPoseRig {
  torso: THREE.Group;
  head: THREE.Group;
  leftArm: THREE.Group;
  rightArm: THREE.Group;
  leftLeg: THREE.Group;
  rightLeg: THREE.Group;
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
  driftX: number;
  driftZ: number;
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
    fov: 58,
    height: 7.2,
    trailingDistance: 9.2,
    lookHeight: -0.2,
    lookAhead: 21.5,
    laneFollow: 0.76,
    lookAtLaneFollow: 0.72,
    playerScale: 1.62,
  },
  portrait: {
    fov: 64,
    height: 8,
    trailingDistance: 9.5,
    lookHeight: -0.2,
    lookAhead: 19.5,
    laneFollow: 0.92,
    lookAtLaneFollow: 0.9,
    playerScale: 1.65,
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
    treeDensity: 1.75,
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
    treeDensity: 0.75,
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

function createCanyonCactusGeometry(): THREE.BufferGeometry {
  const parts = [
    new THREE.CylinderGeometry(0.3, 0.42, 3.1, 7),
    new THREE.CylinderGeometry(0.15, 0.2, 0.78, 6).rotateZ(Math.PI / 2).translate(-0.56, 0.25, 0),
    new THREE.CylinderGeometry(0.15, 0.19, 1.08, 6).translate(-0.92, 0.68, 0),
    new THREE.CylinderGeometry(0.15, 0.2, 0.78, 6).rotateZ(Math.PI / 2).translate(0.56, -0.34, 0),
    new THREE.CylinderGeometry(0.15, 0.19, 1.08, 6).translate(0.92, 0.18, 0),
  ];
  const geometry = mergeGeometries(parts, false);
  parts.forEach((part) => part.dispose());
  geometry.name = "branched-saguaro-cactus";
  return geometry;
}

function colorGeometry(
  geometry: THREE.BufferGeometry,
  colorValue: number,
): THREE.BufferGeometry {
  const vertexCount = geometry.getAttribute("position").count;
  const colors = new Float32Array(vertexCount * 3);
  const color = new THREE.Color(colorValue);
  for (let index = 0; index < vertexCount; index += 1) {
    colors[index * 3] = color.r;
    colors[index * 3 + 1] = color.g;
    colors[index * 3 + 2] = color.b;
  }
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  return geometry;
}

function createFestivalServiceClusterGeometry(): THREE.BufferGeometry {
  const parts = [
    colorGeometry(new THREE.BoxGeometry(0.95, 0.58, 0.72).translate(0.42, 0.29, 0), 0xef6354),
    colorGeometry(new THREE.BoxGeometry(0.72, 0.08, 0.76).translate(0.42, 0.42, 0.39), 0xf4e7cf),
    colorGeometry(new THREE.BoxGeometry(0.34, 0.68, 0.3).translate(1.18, 0.34, 0.08), 0x1aaaa8),
    colorGeometry(new THREE.BoxGeometry(0.2, 0.12, 0.12).translate(1.18, 0.71, 0.08), 0xf4e7cf),
    colorGeometry(
      new THREE.TorusGeometry(0.38, 0.12, 5, 8)
        .rotateX(Math.PI / 2)
        .translate(-0.65, 0.14, 0),
      0x1a222a,
    ),
    colorGeometry(
      new THREE.TorusGeometry(0.38, 0.12, 5, 8)
        .rotateX(Math.PI / 2)
        .translate(-0.65, 0.36, 0),
      0x1a222a,
    ),
  ];
  const geometry = mergeGeometries(parts, false);
  parts.forEach((part) => part.dispose());
  geometry.name = "festival-service-cluster";
  return geometry;
}

function createSummitFinaleEquipmentGeometry(): THREE.BufferGeometry {
  const parts = [
    colorGeometry(new THREE.BoxGeometry(0.9, 0.36, 0.78).translate(0, 0.18, 0), NAVY),
    colorGeometry(new THREE.CylinderGeometry(0.11, 0.15, 2.35, 6).translate(0, 1.45, 0), YELLOW),
    colorGeometry(new THREE.BoxGeometry(0.72, 0.48, 0.3).translate(0, 2.62, 0), 0xf5edda),
    colorGeometry(
      new THREE.CylinderGeometry(0.1, 0.14, 1.25, 6)
        .rotateZ(-Math.PI / 3)
        .translate(0.47, 2.02, 0),
      YELLOW,
    ),
    colorGeometry(new THREE.BoxGeometry(0.25, 0.62, 0.34).translate(-0.32, 0.65, 0), 0x1ddfe6),
  ];
  const geometry = mergeGeometries(parts, false);
  parts.forEach((part) => part.dispose());
  geometry.name = "summit-finale-equipment";
  return geometry;
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
const DIRT_HEIGHT_TEXTURE_SIZE = 512;
const DIRT_LANE_EDGE_RATIOS = [0.028, 0.2744, 0.5, 0.7256, 0.972] as const;
const DIRT_LANE_CENTER_RATIOS = [0.1617, 0.3872, 0.6128, 0.8383] as const;
let dirtHeightCanvasCache: HTMLCanvasElement | null = null;

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

function dirtRutWobble(y: number, height: number, center: number): number {
  const phase = center * Math.PI * 7;
  const cycle = (y / height) * Math.PI * 8;
  return Math.sin(cycle + phase) * 2.4 + Math.sin(cycle * 2 - phase) * 0.65;
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
  context.lineCap = "round";
  for (const [index, ratio] of DIRT_LANE_EDGE_RATIOS.entries()) {
    const outerEdge = index === 0 || index === DIRT_LANE_EDGE_RATIOS.length - 1;
    context.strokeStyle = outerEdge ? "#f7c94b" : "#ead9ae";
    context.globalAlpha = outerEdge ? 0.86 : 0.58;
    context.lineWidth = outerEdge ? 5 : 2.5;
    context.beginPath();
    context.moveTo(width * ratio, 0);
    context.lineTo(width * ratio, height);
    context.stroke();
  }

  context.strokeStyle = `#${mark.clone().multiplyScalar(0.68).getHexString()}`;
  context.globalAlpha = 0.46;
  context.lineWidth = 6.5;
  for (const center of DIRT_LANE_CENTER_RATIOS) {
    for (const offset of [-0.025, 0.025]) {
      context.beginPath();
      for (let y = 0; y <= height; y += 4) {
        const wobble = dirtRutWobble(y, height, center);
        const x = width * (center + offset) + wobble;
        if (y === 0) context.moveTo(x, y);
        else context.lineTo(x, y);
      }
      context.stroke();
    }

    context.globalAlpha = 0.3;
    context.lineWidth = 1.5;
    for (let y = 0; y < height; y += 16) {
      const wobble = dirtRutWobble(y, height, center);
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

function fillWrappedEllipse(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  x: number,
  y: number,
  radiusX: number,
  radiusY: number,
  rotation: number,
): void {
  const cos = Math.abs(Math.cos(rotation));
  const sin = Math.abs(Math.sin(rotation));
  const extentX = radiusX * cos + radiusY * sin;
  const extentY = radiusX * sin + radiusY * cos;
  const xOffsets = [0];
  const yOffsets = [0];
  if (x - extentX < 0) xOffsets.push(width);
  if (x + extentX > width) xOffsets.push(-width);
  if (y - extentY < 0) yOffsets.push(height);
  if (y + extentY > height) yOffsets.push(-height);
  for (const xOffset of xOffsets) {
    for (const yOffset of yOffsets) {
      context.beginPath();
      context.ellipse(x + xOffset, y + yOffset, radiusX, radiusY, rotation, 0, Math.PI * 2);
      context.fill();
    }
  }
}

function paintDirtHeightRuts(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
): void {
  context.lineCap = "round";
  for (const center of DIRT_LANE_CENTER_RATIOS) {
    for (const offset of [-0.025, 0.025]) {
      const rutX = width * (center + offset);
      context.strokeStyle = "#5d5d5d";
      context.globalAlpha = 0.62;
      context.lineWidth = 7;
      context.beginPath();
      for (let y = 0; y <= height; y += 4) {
        const wobble = dirtRutWobble(y, height, center);
        if (y === 0) context.moveTo(rutX + wobble, y);
        else context.lineTo(rutX + wobble, y);
      }
      context.stroke();

      context.strokeStyle = "#707070";
      context.globalAlpha = 0.78;
      context.lineWidth = 2;
      context.stroke();

      context.strokeStyle = "#686868";
      context.globalAlpha = 0.48;
      context.lineWidth = 1.25;
      for (let y = 0; y < height; y += 16) {
        const wobble = dirtRutWobble(y, height, center);
        context.beginPath();
        context.moveTo(rutX - 5 + wobble, y);
        context.lineTo(rutX + 5 + wobble, y + 2.5);
        context.stroke();
      }
    }
  }
}

function createDirtHeightCanvas(): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = DIRT_HEIGHT_TEXTURE_SIZE;
  canvas.height = DIRT_HEIGHT_TEXTURE_SIZE;
  const context = canvas.getContext("2d");
  if (!context) return canvas;

  const width = canvas.width;
  const height = canvas.height;
  const random = seededRandom(0x52_49_56_45);
  context.fillStyle = "#808080";
  context.fillRect(0, 0, width, height);

  // Broad compacted-soil forms stay close to mid-grey so the material catches
  // light without turning the flat gameplay surface into apparent terrain.
  for (let index = 0; index < 92; index += 1) {
    context.fillStyle = index % 3 === 0 ? "#929292" : "#747474";
    context.globalAlpha = 0.12 + random() * 0.12;
    fillWrappedEllipse(
      context,
      width,
      height,
      random() * width,
      random() * height,
      8 + random() * 34,
      14 + random() * 58,
      random() * Math.PI,
    );
  }

  paintDirtHeightRuts(context, width, height);

  // Small clods provide near-field breakup. Wrapped edge copies keep the map
  // seamless along the 30 m UV repeat used by the course ribbon.
  for (let index = 0; index < 320; index += 1) {
    context.fillStyle = index % 5 === 0 ? "#aaaaaa" : "#999999";
    context.globalAlpha = 0.28 + random() * 0.28;
    fillWrappedEllipse(
      context,
      width,
      height,
      random() * width,
      random() * height,
      0.8 + random() * 2.5,
      1.1 + random() * 4,
      random() * Math.PI,
    );
  }

  // Lane paint belongs only to the sRGB color map. Flatten the corresponding
  // strips here so bright paint can no longer become false raised geometry.
  context.strokeStyle = "#808080";
  context.globalAlpha = 0.92;
  for (const [index, ratio] of DIRT_LANE_EDGE_RATIOS.entries()) {
    context.lineWidth = index === 0 || index === DIRT_LANE_EDGE_RATIOS.length - 1 ? 4 : 2.5;
    context.beginPath();
    context.moveTo(width * ratio, 0);
    context.lineTo(width * ratio, height);
    context.stroke();
  }
  context.globalAlpha = 1;
  return canvas;
}

function createDirtHeightTexture(): THREE.CanvasTexture {
  dirtHeightCanvasCache ??= createDirtHeightCanvas();
  const texture = new THREE.CanvasTexture(dirtHeightCanvasCache);
  texture.name = "procedural-dirt-height";
  texture.colorSpace = THREE.NoColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  return texture;
}

function createSkyGradientTexture(
  skyColor: number,
  horizonColor: number,
  sunColor: number,
): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 512;
  const context = canvas.getContext("2d");
  if (context) {
    const sky = new THREE.Color(skyColor);
    const zenith = sky.clone().offsetHSL(-0.015, 0.06, -0.12);
    const highSky = sky.clone().offsetHSL(0, 0.035, 0.06);
    const horizon = new THREE.Color(horizonColor).lerp(sky, 0.55);
    const lowerHaze = new THREE.Color(horizonColor).lerp(sky, 0.68);
    const gradient = context.createLinearGradient(0, 0, 0, canvas.height);
    gradient.addColorStop(0, `#${zenith.getHexString()}`);
    gradient.addColorStop(0.56, `#${highSky.getHexString()}`);
    gradient.addColorStop(0.86, `#${horizon.getHexString()}`);
    gradient.addColorStop(1, `#${lowerHaze.getHexString()}`);
    context.fillStyle = gradient;
    context.fillRect(0, 0, canvas.width, canvas.height);

    const sun = new THREE.Color(sunColor).lerp(new THREE.Color(0xffffff), 0.34);
    const sunGlow = context.createRadialGradient(
      canvas.width * 0.76,
      canvas.height * 0.18,
      1,
      canvas.width * 0.76,
      canvas.height * 0.18,
      canvas.width * 0.54,
    );
    sunGlow.addColorStop(0, `#${sun.getHexString()}cc`);
    sunGlow.addColorStop(0.2, `#${sun.getHexString()}55`);
    sunGlow.addColorStop(1, "#ffffff00");
    context.fillStyle = sunGlow;
    context.fillRect(0, 0, canvas.width, canvas.height * 0.52);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  return texture;
}

function createSoftShadowTexture(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 64;
  const context = canvas.getContext("2d");
  if (context) {
    context.fillStyle = "#000000";
    context.fillRect(0, 0, canvas.width, canvas.height);
    const gradient = context.createRadialGradient(32, 32, 2, 32, 32, 31);
    gradient.addColorStop(0, "#ffffff");
    gradient.addColorStop(0.38, "#d8d8d8");
    gradient.addColorStop(0.72, "#555555");
    gradient.addColorStop(1, "#000000");
    context.fillStyle = gradient;
    context.fillRect(0, 0, canvas.width, canvas.height);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
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

type ObstacleProfilePoint = readonly [z: number, height: number];

function createObstacleProfileGeometry(
  width: number,
  profile: readonly ObstacleProfilePoint[],
): THREE.BufferGeometry {
  const positions: number[] = [];
  for (const [z, height] of profile) {
    positions.push(
      -width / 2, height, z,
      width / 2, height, z,
      -width / 2, 0, z,
      width / 2, 0, z,
    );
  }
  const indices: number[] = [];
  for (let index = 0; index < profile.length - 1; index += 1) {
    const start = index * 4;
    const next = start + 4;
    indices.push(
      start, start + 1, next,
      next, start + 1, next + 1,
      start + 2, next + 2, start,
      start, next + 2, next,
      start + 1, start + 3, next + 1,
      next + 1, start + 3, next + 3,
      start + 2, start + 3, next + 2,
      next + 2, start + 3, next + 3,
    );
  }
  const last = (profile.length - 1) * 4;
  indices.push(
    0, 2, 1,
    1, 2, 3,
    last, last + 1, last + 2,
    last + 1, last + 3, last + 2,
  );
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function createMergedObstacleProfileGeometry(
  width: number,
  sections: readonly {
    readonly profile: readonly ObstacleProfilePoint[];
    readonly offsetZ: number;
  }[],
): THREE.BufferGeometry {
  const parts = sections.map(({ profile, offsetZ }) => (
    createObstacleProfileGeometry(width, profile).translate(0, 0, offsetZ)
  ));
  const geometry = mergeGeometries(parts, false);
  parts.forEach((part) => part.dispose());
  return geometry;
}

function createLaneBermGeometry(): THREE.BufferGeometry {
  const positions = new Float32Array([
    -0.5, 0, 0.5,
    0.5, 0, 0.5,
    -0.5, 0, -0.5,
    0.5, 0, -0.5,
    -0.32, 1, 0.5,
    0.32, 1, 0.5,
    -0.32, 1, -0.5,
    0.32, 1, -0.5,
  ]);
  const uvs = new Float32Array([
    0, 0,
    1, 0,
    0, 1,
    1, 1,
    0.18, 0,
    0.82, 0,
    0.18, 1,
    0.82, 1,
  ]);
  const indices = [
    0, 1, 5, 0, 5, 4,
    2, 6, 7, 2, 7, 3,
    0, 4, 6, 0, 6, 2,
    1, 3, 7, 1, 7, 5,
    4, 5, 7, 4, 7, 6,
    0, 2, 3, 0, 3, 1,
  ];
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.name = "shallow-lane-berm";
  return geometry;
}

function createCoastlineWaterGeometry(
  route: CoursePresentationRoute,
  startProgress: number,
  endProgress: number,
  innerLateral: number,
  outerWorldX: number,
  elevation: number,
  segmentLength = 5,
): THREE.BufferGeometry {
  const length = endProgress - startProgress;
  const segmentCount = Math.max(1, Math.ceil(length / segmentLength));
  const positions = new Float32Array((segmentCount + 1) * 6);
  const uvs = new Float32Array((segmentCount + 1) * 4);
  const indices: number[] = [];
  const inner = new THREE.Vector3();
  const center = new THREE.Vector3();

  for (let index = 0; index <= segmentCount; index += 1) {
    const ratio = index / segmentCount;
    const progress = startProgress + length * ratio;
    route.sample(progress, innerLateral, elevation, inner);
    route.sample(progress, 0, elevation, center);
    const positionOffset = index * 6;
    positions.set([
      inner.x, inner.y, inner.z,
      outerWorldX, elevation, center.z,
    ], positionOffset);
    const uvOffset = index * 4;
    uvs.set([0, progress / 30, 1, progress / 30], uvOffset);
    if (index === segmentCount) continue;
    const vertex = index * 2;
    indices.push(
      vertex, vertex + 1, vertex + 3,
      vertex, vertex + 3, vertex + 2,
    );
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  geometry.name = "coastline-water-fill";
  geometry.userData.presentationOnly = true;
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

interface AuthoredGuideStripLayout {
  readonly lateralCenter: number;
  readonly guideWidth: number;
  readonly isTrackEdge: boolean;
}

function authoredGuideStripLayout(courseWidth: number): readonly AuthoredGuideStripLayout[] {
  const halfCourseWidth = Math.max(0.01, courseWidth / 2);
  const edgeWidth = Math.min(0.22, courseWidth * 0.08);
  const laneWidth = Math.min(0.09, courseWidth * 0.04);
  return [
    -halfCourseWidth + edgeWidth / 2,
    -courseWidth / 4,
    0,
    courseWidth / 4,
    halfCourseWidth - edgeWidth / 2,
  ].map((lateralCenter, index, centers): AuthoredGuideStripLayout => {
    const isTrackEdge = index === 0 || index === centers.length - 1;
    return { lateralCenter, guideWidth: isTrackEdge ? edgeWidth : laneWidth, isTrackEdge };
  });
}

function authoredGuideMaximumWorldHeight(piece: AuthoredTrackPiece, guideIndex: number): number {
  const courseWidth = piece.unrotatedWidth;
  const halfCourseWidth = Math.max(0.01, courseWidth / 2);
  const strip = authoredGuideStripLayout(courseWidth)[guideIndex];
  if (!strip) return Number.NEGATIVE_INFINITY;
  if (piece.kind === "straight") {
    return piece.height + 0.08 + (strip.isTrackEdge ? 0.142 : 0.1815);
  }
  const direction = piece.kind.endsWith("left") ? -1 : 1;
  const bankHeight = piece.kind.startsWith("bank-") ? 0.85 : 0;
  const leftHeight = bankHeight > 0 && direction > 0 ? bankHeight : 0;
  const rightHeight = bankHeight > 0 && direction < 0 ? bankHeight : 0;
  const halfGuideWidth = Math.min(strip.guideWidth / 2, halfCourseWidth);
  const surfaceHeight = (lateral: number): number => {
    const across = clamp((lateral + halfCourseWidth) / (halfCourseWidth * 2), 0, 1);
    return rightHeight + (leftHeight - rightHeight) * across + 0.022;
  };
  return piece.height + 0.08 + Math.max(
    surfaceHeight(strip.lateralCenter + halfGuideWidth),
    surfaceHeight(strip.lateralCenter - halfGuideWidth),
  );
}

function authoredQuarterTurnGuideWorldXSpan(
  piece: AuthoredTrackPiece,
  localGuideIndex: number,
): { min: number; max: number } | null {
  const courseWidth = piece.unrotatedWidth;
  const halfCourseWidth = Math.max(0.01, courseWidth / 2);
  const strip = authoredGuideStripLayout(courseWidth)[localGuideIndex];
  if (!strip || (piece.rotation !== 90 && piece.rotation !== 270)) return null;
  const halfGuideWidth = Math.min(strip.guideWidth / 2, halfCourseWidth);
  const left = clamp(strip.lateralCenter + halfGuideWidth, -halfCourseWidth, halfCourseWidth);
  const right = clamp(strip.lateralCenter - halfGuideWidth, -halfCourseWidth, halfCourseWidth);
  const direction = piece.kind.endsWith("left") ? -1 : 1;
  const length = piece.unrotatedLength;
  const angle = 0.56;
  const radius = length / angle;
  const sampleCount = piece.kind === "straight" ? 2 : 11;
  let minimum = Number.POSITIVE_INFINITY;
  let maximum = Number.NEGATIVE_INFINITY;
  for (let sample = 0; sample < sampleCount; sample += 1) {
    const progress = sample / (sampleCount - 1);
    const theta = piece.kind === "straight" ? 0 : -angle / 2 + progress * angle;
    const centerZ = piece.kind === "straight"
      ? -length * 0.47 + progress * length * 0.94
      : radius * Math.sin(theta);
    const normalZ = piece.kind === "straight" ? 0 : -direction * Math.sin(theta);
    for (const lateral of [left, right]) {
      const localZ = centerZ + normalZ * lateral;
      const worldX = piece.lateralPosition + (piece.rotation === 90 ? localZ : -localZ);
      minimum = Math.min(minimum, worldX);
      maximum = Math.max(maximum, worldX);
    }
  }
  return Number.isFinite(minimum) && Number.isFinite(maximum)
    ? { min: minimum, max: maximum }
    : null;
}

function authoredWorldGuideHasVisibleOverlay(
  piece: AuthoredTrackPiece,
  worldGuideIndex: number,
): boolean {
  if (piece.rotation === 0 || piece.rotation === 180) {
    const localGuideIndex = piece.rotation === 180 ? 4 - worldGuideIndex : worldGuideIndex;
    return authoredGuideMaximumWorldHeight(piece, localGuideIndex) > AUTHORED_GUIDE_VISIBILITY_FLOOR;
  }

  const worldGuideX = HIGH_CONTRAST_GUIDE_X[worldGuideIndex];
  if (worldGuideX === undefined) return false;
  const categoryGuideIndices = worldGuideIndex === 0 || worldGuideIndex === 4
    ? [0, 4]
    : [1, 2, 3];
  return categoryGuideIndices.some((localGuideIndex) => {
    if (authoredGuideMaximumWorldHeight(piece, localGuideIndex) <= AUTHORED_GUIDE_VISIBILITY_FLOOR) {
      return false;
    }
    const span = authoredQuarterTurnGuideWorldXSpan(piece, localGuideIndex);
    return span !== null && worldGuideX >= span.min - 0.11 && worldGuideX <= span.max + 0.11;
  });
}

function createAuthoredPieceGuideGeometry(
  piece: Pick<AuthoredTrackPiece, "kind" | "unrotatedWidth" | "unrotatedLength">,
): THREE.BufferGeometry {
  const courseWidth = piece.unrotatedWidth;
  const length = piece.unrotatedLength;
  const halfCourseWidth = Math.max(0.01, courseWidth / 2);
  const layout = authoredGuideStripLayout(courseWidth);
  const positions: number[] = [];
  const indices: number[] = [];
  const colors: number[] = [];
  const edgeColor = new THREE.Color(0xffffff);
  const laneColor = new THREE.Color(YELLOW);
  const direction = piece.kind.endsWith("left") ? -1 : 1;
  const bankHeight = piece.kind.startsWith("bank-") ? 0.85 : 0;
  const leftHeight = bankHeight > 0 && direction > 0 ? bankHeight : 0;
  const rightHeight = bankHeight > 0 && direction < 0 ? bankHeight : 0;
  const angle = 0.56;
  const radius = length / angle;

  for (const { lateralCenter, guideWidth, isTrackEdge } of layout) {
    const halfGuideWidth = Math.min(guideWidth / 2, halfCourseWidth);
    const firstVertex = positions.length / 3;
    const sampleCount = piece.kind === "straight" ? 2 : 11;
    for (let sample = 0; sample < sampleCount; sample += 1) {
      const progress = sample / (sampleCount - 1);
      const theta = piece.kind === "straight" ? 0 : -angle / 2 + progress * angle;
      const centerX = piece.kind === "straight" ? 0 : direction * radius * (1 - Math.cos(theta));
      const centerZ = piece.kind === "straight" ? -length * 0.47 + progress * length * 0.94 : radius * Math.sin(theta);
      const normalX = piece.kind === "straight" ? 1 : Math.cos(theta);
      const normalZ = piece.kind === "straight" ? 0 : -direction * Math.sin(theta);
      const left = clamp(lateralCenter + halfGuideWidth, -halfCourseWidth, halfCourseWidth);
      const right = clamp(lateralCenter - halfGuideWidth, -halfCourseWidth, halfCourseWidth);
      const surfaceHeight = (lateral: number): number => {
        if (piece.kind === "straight") return isTrackEdge ? 0.142 : 0.1815;
        const across = clamp((lateral + halfCourseWidth) / (halfCourseWidth * 2), 0, 1);
        return rightHeight + (leftHeight - rightHeight) * across + 0.022;
      };
      positions.push(
        centerX + normalX * left,
        surfaceHeight(left),
        centerZ + normalZ * left,
        centerX + normalX * right,
        surfaceHeight(right),
        centerZ + normalZ * right,
      );
      const color = isTrackEdge ? edgeColor : laneColor;
      colors.push(color.r, color.g, color.b, color.r, color.g, color.b);
      if (sample > 0) {
        const previous = firstVertex + (sample - 1) * 2;
        indices.push(previous, previous + 1, previous + 2, previous + 2, previous + 1, previous + 3);
      }
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

function createCourseGuideGapGeometry(
  route: CoursePresentationRoute,
  intervals: readonly { start: number; end: number }[],
  left: number,
  right: number,
  yOffset: number,
): THREE.BufferGeometry {
  const intervalGeometries = intervals.flatMap((interval) => (
    interval.end > interval.start
      ? [createCourseRibbonGeometry(route, {
          startProgress: interval.start,
          endProgress: interval.end,
          left,
          right,
          yOffset,
          segmentLength: 4,
        })]
      : []
  ));
  if (intervalGeometries.length === 0) return new THREE.BufferGeometry();
  const geometry = mergeGeometries(intervalGeometries, false);
  intervalGeometries.forEach((intervalGeometry) => intervalGeometry.dispose());
  geometry.name = "route-aware-high-contrast-guide-gaps";
  geometry.userData.presentationOnly = true;
  geometry.userData.progressModel = "scalar-arc-length";
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

function makeLimbSegment(
  start: THREE.Vector3,
  end: THREE.Vector3,
  radius: number,
  material: THREE.Material,
): THREE.Mesh {
  const direction = end.clone().sub(start);
  const length = direction.length();
  const segment = new THREE.Mesh(
    new THREE.CapsuleGeometry(radius, Math.max(0.02, length - radius * 2), 4, 8),
    material,
  );
  segment.position.copy(start).add(end).multiplyScalar(0.5);
  segment.quaternion.setFromUnitVectors(
    new THREE.Vector3(0, 1, 0),
    direction.normalize(),
  );
  return segment;
}

function setShadow(group: THREE.Object3D, castShadow = true): void {
  group.traverse((object) => {
    if (object instanceof THREE.Mesh) {
      object.castShadow = castShadow;
      object.receiveShadow = true;
    }
  });
}

const FOCAL_BIKE_SHADOW_CASTERS = new Set([
  "FrontTireRing",
  "RearTireRing",
  "FrontTreadRing",
  "RearTreadRing",
  "MainFrame",
  "Tank",
  "Seat",
  "RearFender",
  "FrontFender",
  "LeftSidePanel",
  "RightSidePanel",
  "RearNumberPanel",
  "ExhaustCanister",
]);

function setFocalBikeShadows(group: THREE.Object3D): void {
  group.traverse((object) => {
    if (object instanceof THREE.Mesh) {
      object.castShadow = FOCAL_BIKE_SHADOW_CASTERS.has(object.name);
      object.receiveShadow = true;
    }
  });
}

function laneMatches(obstacle: TrackObstacle, lane: number): boolean {
  return obstacle.lanes.includes(lane as LaneIndex);
}

function retainedSpeedForContact(
  contact: ObstacleContactSection,
  policy: AiObstaclePolicy,
): number {
  return contact.parent.moduleId === "bump-row"
    ? Math.pow(policy.retainedSpeed, 1 / 4)
    : policy.retainedSpeed;
}

function scaleAuthoredTransform<T extends AuthoredPlacementTransform>(
  placement: T,
  scale: number,
): T {
  const sideways = placement.rotation === 90 || placement.rotation === 270;
  return {
    ...placement,
    distance: placement.distance * scale,
    length: Math.max(1, placement.length * scale),
    unrotatedWidth: sideways
      ? Math.max(1, placement.unrotatedWidth * scale)
      : placement.unrotatedWidth,
    unrotatedLength: sideways
      ? placement.unrotatedLength
      : Math.max(1, placement.unrotatedLength * scale),
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
        { id: "qa-grass", kind: "grass", distance: 500, lanes: [0, 3], length: 22 },
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
      ...(obstacle.unrotatedWidth === undefined
        ? {}
        : {
            unrotatedWidth: obstacle.rotation === 90 || obstacle.rotation === 270
              ? Math.max(1, obstacle.unrotatedWidth * scale)
              : obstacle.unrotatedWidth,
          }),
      ...(obstacle.unrotatedLength === undefined
        ? {}
        : {
            unrotatedLength: obstacle.rotation === 90 || obstacle.rotation === 270
              ? obstacle.unrotatedLength
              : Math.max(1, obstacle.unrotatedLength * scale),
          }),
    })),
    ...(authoredCourse
      ? {
          authoredCourse: {
            start: scaleAuthoredTransform(authoredCourse.start, scale),
            checkpoints: authoredCourse.checkpoints.map((checkpoint) => (
              scaleAuthoredTransform(checkpoint, scale)
            )),
            finish: scaleAuthoredTransform(authoredCourse.finish, scale),
            centerline: authoredCourse.centerline.map((anchor) => ({
              distance: anchor.distance * scale,
              lateralOffset: anchor.lateralOffset * scale,
              elevation: anchor.elevation * scale,
            })),
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
  private environmentImageLoader: THREE.ImageBitmapLoader | null = null;
  private environmentTexture: THREE.Texture | null = null;
  private readonly visualQualificationFreeze: boolean;
  private preparation: Promise<void> = Promise.resolve();
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
  private readonly cameraLookTarget = new THREE.Vector3();
  private readonly sunTarget = new THREE.Object3D();
  private readonly courseRoute: CoursePresentationRoute;
  private readonly obstacleContacts: readonly ObstacleContactSection[];
  private readonly courseYaw = new THREE.Quaternion();
  private readonly coursePitch = new THREE.Quaternion();
  private readonly riderLocalRotation = new THREE.Quaternion();
  private readonly riderEuler = new THREE.Euler(0, 0, 0, "XYZ");
  private readonly staticMatrix = new THREE.Matrix4();
  private readonly staticPosition = new THREE.Vector3();
  private readonly staticScale = new THREE.Vector3();
  private readonly staticRotation = new THREE.Quaternion();
  private readonly playerShadow = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.MeshBasicMaterial({
      color: 0x3b241c,
      transparent: true,
      opacity: 0.3,
      alphaMap: createSoftShadowTexture(),
      depthWrite: false,
      toneMapped: false,
    }),
  );
  private readonly dustPool: DustParticle[] = [];
  private readonly ownedTextures: THREE.Texture[] = [];
  private readonly coolingSnowflakes: THREE.InstancedMesh[] = [];
  private sunLight: THREE.DirectionalLight | null = null;
  private highContrastTrackGuides: THREE.Group | null = null;

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
  private lastHudInputDevice: InputDevice = "keyboard";
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
  private tutorialRecoveryBarrierCrashPending = false;
  private readonly tutorialLessonGate = new TutorialLessonGate();
  private readonly demonstrated = {
    rideAtUsableSpeed: false,
    coast: false,
    criticalHeatReached: false,
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
  private readonly tutorialEvents = {
    trainingBumpClearedInWheelie: false,
    choiceBarrierAvoided: false,
    grassSlowdownExperienced: false,
    grassReturnedToDirt: false,
    recoveryBarrierCrash: false,
    recoveryBarrierRecovered: false,
  };

  constructor(options: GameEngineOptions) {
    this.canvas = options.canvas;
    this.visualQualificationFreeze = import.meta.env.VITE_QA_MODE === "1"
      && new URLSearchParams(window.location.search).has("qa-visual-freeze");
    this.canvas.dataset.bikeAsset = "loading";
    this.canvas.dataset.environmentAsset = "loading";
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
      totalLaps: options.mode === "tutorial" ? 1 : (options.customTrack?.laps ?? 2),
      initialHeat: options.mode === "mastery" ? Math.min(65, 35 + (options.masteryLevel ?? 0) * 5) : 0,
      retroRecovery: options.settings.controls.retroRecovery,
      ...(options.mode === "tutorial" ? { wheelieCrashSeconds: 6 } : {}),
    });
    this.courseRoute = new CoursePresentationRoute(this.track);
    this.obstacleContacts = Object.freeze(
      this.track.obstacles
        .flatMap((obstacle) => resolveObstacleContacts(obstacle))
        .sort((first, second) => first.distance - second.distance),
    );
    this.canvas.dataset.courseGradeStyle = this.track.authoredCourse
      ? this.courseRoute.identity ? "authored-flat" : "authored-checkpoint-c2"
      : "rolling-c2";
    this.canvas.dataset.obstacleContactCount = String(this.obstacleContacts.length);
    this.input = new InputManager(options.settings.controls, options.initialInputDevice);
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
      const skyTexture = createSkyGradientTexture(
        this.visualProfile.background,
        this.visualProfile.fog,
        this.visualProfile.sun,
      );
      this.scene.background = skyTexture;
      this.ownedTextures.push(skyTexture);
      this.scene.fog = new THREE.Fog(
        this.visualProfile.fog,
        this.visualProfile.fogNear,
        this.visualProfile.fogFar,
      );

      this.player = this.createBike(PLAYER_COLOR, PLAYER_ACCENT, true, "22");
      this.player.scale.setScalar(1.3);
      this.canvas.dataset.riderPoseStyle = "snapshot-driven-six-pivot";
      this.playerShadow.renderOrder = 2;
      this.scene.add(this.playerShadow, this.player);
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
    this.preparation = Promise.all([
      this.loadCompressedPlayerBike(),
      this.loadCanyonFestivalPanorama(),
    ]).then(() => undefined);
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
    window.addEventListener("pointerdown", this.unlockAudio);
    window.addEventListener("keydown", this.unlockAudio);
    this.timer.connect(document);
    this.timer.reset();
    this.emitHud(this.simulation.snapshot);
    this.animationFrame = requestAnimationFrame(this.frame);
    startLifecycleResource("engineRenderLoops");
  }

  whenReady(): Promise<void> {
    return this.preparation;
  }

  setPaused(paused: boolean): void {
    if (this.disposed || this.paused === paused) return;
    this.paused = paused;
    this.audio.setPaused(paused);
    if (paused) this.input.suspend();
    else this.timer.reset();
  }

  setTutorialLesson(lessonIndex: number | null): void {
    if (this.disposed || this.mode !== "tutorial") return;
    if (!this.tutorialLessonGate.activate(lessonIndex)) return;
    this.emitHud(this.simulation.snapshot);
  }

  /** Restarts the current tutorial route while preserving completed UI progress. */
  retryTutorialLesson(): boolean {
    const lesson = this.tutorialLessonGate.snapshot;
    if (
      this.disposed
      || this.mode !== "tutorial"
      || lesson.activeLessonIndex === null
      || lesson.complete
    ) return false;

    this.simulation.reset();
    this.tutorialLessonGate.resetActiveEvidence();
    this.input.suspend();
    this.timer.reset();

    this.finished = false;
    this.hudElapsed = 0;
    this.lastBikePhase = "grounded";
    this.lastLanding = null;
    this.lastHeatWarning = false;
    this.lastOverheated = false;
    this.lastObstacleKey = "";
    this.handledObstacleKeys.clear();
    this.cameraShake = 0;
    this.cameraInitialized = false;
    this.replayBytes.length = 0;
    this.lastReplayStep = -6;
    this.dustCursor = 0;
    this.dustAccumulator = 0;
    this.crashes = 0;
    this.overheats = 0;
    this.caption = "";
    this.captionUntil = 0;
    this.tutorialRecoveryBarrierCrashPending = false;
    for (const particle of this.dustPool) {
      particle.life = 0;
      particle.driftX = 0;
      particle.driftZ = 0;
      particle.mesh.visible = false;
    }

    const state = this.simulation.snapshot;
    this.audio.updateEngine(0, false, state.bike.surface);
    this.emitHud(state);
    return true;
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

  private observeTutorialLesson(signal: TutorialLessonSignal): void {
    if (this.mode !== "tutorial" || !this.tutorialLessonGate.observe(signal)) return;
    this.hudElapsed = 0.08;
    if (this.tutorialLessonGate.snapshot.complete && !this.paused) {
      // Freeze the lesson boundary atomically without discarding a held Ride
      // input that the next lesson may explicitly ask the player to release.
      this.paused = true;
      this.audio.setPaused(true);
    }
  }

  private applyRendererAccessibility(): void {
    if (this.highContrastTrackGuides) {
      this.highContrastTrackGuides.visible = this.settings.accessibility.highContrast;
    }
    const visibleGuides = this.highContrastTrackGuides?.visible === true;
    const guideCount = Number(this.highContrastTrackGuides?.userData.guideCount ?? 0);
    const coolingCueCount = this.coolingSnowflakes.filter((cue) => cue.parent !== null).length;
    this.canvas.dataset.highContrastTrackGuides = String(visibleGuides);
    this.canvas.dataset.trackGuideCount = String(guideCount);
    this.canvas.dataset.coolingSnowflakeCount = String(coolingCueCount);
    this.canvas.dataset.coolingCueShape = coolingCueCount > 0 ? "snowflake" : "none";
  }

  async unlockSound(): Promise<boolean> {
    const unlocked = await this.audio.unlock();
    if (!unlocked) return false;
    this.audio.startEngine();
    return true;
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
    this.environmentImageLoader?.abort();
    this.environmentImageLoader = null;
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
    void this.unlockSound().then((unlocked) => {
      if (!unlocked) return;
      window.removeEventListener("pointerdown", this.unlockAudio);
      window.removeEventListener("keydown", this.unlockAudio);
    });
  };

  private readonly handleContextLost = (event: Event): void => {
    event.preventDefault();
    this.onFatal("The graphics context was lost. Reload the race to recover.");
  };

  private async loadCompressedPlayerBike(): Promise<void> {
    const shouldFailForQa = import.meta.env.VITE_QA_MODE === "1"
      && new URLSearchParams(window.location.search).has("qa-asset-failure");
    const loadOutcome = (shouldFailForQa
      ? Promise.reject(new Error("QA asset failure"))
      : this.compressedAssetLoader.load(FESTIVAL_TRAIL_BIKE_URL)
    ).then(
      (gltf) => ({ kind: "loaded" as const, gltf }),
      () => ({ kind: "failed" as const }),
    );
    let deadlineTimer = 0;
    const deadline = new Promise<{ kind: "timeout" }>((resolve) => {
      deadlineTimer = window.setTimeout(
        () => resolve({ kind: "timeout" }),
        PLAYER_ASSET_READINESS_TIMEOUT_MS,
      );
    });
    const outcome = await Promise.race([loadOutcome, deadline]);
    window.clearTimeout(deadlineTimer);

    if (outcome.kind === "timeout") {
      // The built-in bike is already usable. Keep the race gate bounded and
      // abort this isolated loader before it can survive a restart. The late
      // handler remains defensive for browsers that settle during the abort.
      this.compressedAssetLoader.dispose();
      void loadOutcome.then((lateOutcome) => {
        if (lateOutcome.kind === "loaded") disposeObjectResources(lateOutcome.gltf.scene);
      });
      this.activateBuiltInBikeFallback("Bike load timed out — safe built-in model active");
      return;
    }
    if (outcome.kind === "failed") {
      this.activateBuiltInBikeFallback("Compressed bike unavailable — safe built-in model active");
      return;
    }
    if (this.disposed) {
      disposeObjectResources(outcome.gltf.scene);
      return;
    }
    const compressedBike = outcome.gltf.scene;
    compressedBike.name = "compressed-festival-trail-bike";
    compressedBike.position.y = -0.62;
    compressedBike.scale.setScalar(1.04);
    setFocalBikeShadows(compressedBike);
    const previousBike = this.player.userData.bikeVisual as THREE.Object3D | undefined;
    if (previousBike) previousBike.visible = false;
    this.player.add(compressedBike);
    this.player.userData.bikeVisual = compressedBike;
    const frontWheel = compressedBike.getObjectByName("FrontTire");
    const backWheel = compressedBike.getObjectByName("RearTire");
    if (frontWheel) this.player.userData.frontWheel = frontWheel;
    if (backWheel) this.player.userData.backWheel = backWheel;
    this.canvas.dataset.bikeAsset = "ready";
  }

  private async loadCanyonFestivalPanorama(): Promise<void> {
    if (this.track.id !== "canyon-kickoff" || this.track.authoredCourse !== undefined) {
      this.canvas.dataset.environmentAsset = "not-applicable";
      return;
    }
    if (typeof createImageBitmap !== "function") {
      this.activateEnvironmentFallback();
      return;
    }

    const shouldFailForQa = import.meta.env.VITE_QA_MODE === "1"
      && new URLSearchParams(window.location.search).has("qa-environment-failure");
    const bitmapOptions: ImageBitmapOptions = {
      imageOrientation: "flipY",
      premultiplyAlpha: "none",
      ...(this.quality === "low"
        ? { resizeWidth: 1_024, resizeHeight: 512, resizeQuality: "high" as const }
        : this.quality === "medium"
          ? { resizeWidth: 1_536, resizeHeight: 768, resizeQuality: "high" as const }
          : {}),
    };
    const loader = new THREE.ImageBitmapLoader().setOptions(bitmapOptions);
    this.environmentImageLoader = loader;
    const loadOutcome = (shouldFailForQa
      ? Promise.reject(new Error("QA environment failure"))
      : loader.loadAsync(CANYON_FESTIVAL_PANORAMA_URL)
    ).then(
      (bitmap) => ({ kind: "loaded" as const, bitmap }),
      () => ({ kind: "failed" as const }),
    );
    let deadlineTimer = 0;
    const deadline = new Promise<{ kind: "timeout" }>((resolve) => {
      deadlineTimer = window.setTimeout(
        () => resolve({ kind: "timeout" }),
        CANYON_PANORAMA_READINESS_TIMEOUT_MS,
      );
    });
    const outcome = await Promise.race([loadOutcome, deadline]);
    window.clearTimeout(deadlineTimer);

    if (outcome.kind === "timeout") {
      loader.abort();
      this.environmentImageLoader = null;
      void loadOutcome.then((lateOutcome) => {
        if (lateOutcome.kind === "loaded") lateOutcome.bitmap.close();
      });
      this.activateEnvironmentFallback();
      return;
    }
    this.environmentImageLoader = null;
    if (outcome.kind === "failed") {
      this.activateEnvironmentFallback();
      return;
    }
    if (this.disposed) {
      outcome.bitmap.close();
      return;
    }

    const bitmap = outcome.bitmap;
    let bitmapClosed = false;
    const texture = new THREE.Texture(bitmap);
    texture.name = "canyon-festival-panorama";
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.generateMipmaps = true;
    texture.needsUpdate = true;
    texture.addEventListener("dispose", () => {
      if (bitmapClosed) return;
      bitmapClosed = true;
      bitmap.close();
    });
    this.scene.background = texture;
    this.scene.backgroundIntensity = 0.9;
    this.environmentTexture = texture;
    this.updateEnvironmentTextureTransform();
    this.ownedTextures.push(texture);
    this.canvas.dataset.environmentAsset = "ready";
    this.canvas.dataset.environmentWidth = String(bitmap.width);
    this.canvas.dataset.environmentHeight = String(bitmap.height);
  }

  private activateEnvironmentFallback(): void {
    if (this.disposed) return;
    this.canvas.dataset.environmentAsset = "fallback";
    delete this.canvas.dataset.environmentWidth;
    delete this.canvas.dataset.environmentHeight;
  }

  private updateEnvironmentTextureTransform(): void {
    const texture = this.environmentTexture;
    const image = texture?.image as ImageBitmap | undefined;
    if (!texture || !image || image.width <= 0 || image.height <= 0) return;

    const viewportWidth = Math.max(1, this.canvas.clientWidth);
    const viewportHeight = Math.max(1, this.canvas.clientHeight);
    const viewportAspect = viewportWidth / viewportHeight;
    const imageAspect = image.width / image.height;

    texture.repeat.set(1, 1);
    texture.offset.set(0, 0);
    if (viewportAspect < imageAspect) {
      texture.repeat.x = viewportAspect / imageAspect;
      texture.offset.x = (1 - texture.repeat.x) / 2;
    } else if (viewportAspect > imageAspect) {
      texture.repeat.y = imageAspect / viewportAspect;
      texture.offset.y = (1 - texture.repeat.y) / 2;
    }
    texture.updateMatrix();
  }

  private activateBuiltInBikeFallback(caption: string): void {
    if (this.disposed) return;
    this.canvas.dataset.bikeAsset = "fallback";
    this.caption = caption;
    this.captionUntil = 6;
    this.emitHud(this.simulation.snapshot);
  }

  private readonly resize = (): void => {
    const width = Math.max(1, this.canvas.clientWidth);
    const height = Math.max(1, this.canvas.clientHeight);
    const presentation = usesPortraitRacePresentation(width, height)
      ? CAMERA_PRESENTATION_PROFILES.portrait
      : CAMERA_PRESENTATION_PROFILES.desktop;
    const qualityRatio = this.quality === "low" ? 1 : this.quality === "medium" ? 1.35 : 2;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, qualityRatio));
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.fov = presentation.fov;
    this.camera.updateProjectionMatrix();
    this.player.scale.setScalar(presentation.playerScale);
    this.updateEnvironmentTextureTransform();
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
    } else if (!this.visualQualificationFreeze && this.paused && !this.finished) {
      // Keep the pre-ride tutorial map responsive without advancing simulation.
      this.input.sample();
      if (this.input.activeDevice !== this.lastHudInputDevice) {
        this.emitHud(this.simulation.snapshot);
      }
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
    this.advanceRaceSimulation(delta, input);
    const state = this.simulation.snapshot;

    if (state.race.finished) this.finishRace();
    this.updateDust(delta, state);
    this.captureReplay(state);
    this.audio.updateEngine(state.bike.speed, input.turbo, state.bike.surface);
    this.hudElapsed += delta;
    if (this.hudElapsed >= 0.08) {
      this.hudElapsed = 0;
      this.emitHud(state);
    }
  }

  private advanceRaceSimulation(delta: number, input: SimulationInput): number {
    let remainingSeconds = delta;
    let fixedSteps = 0;

    while (remainingSeconds > 0) {
      const accumulatedSeconds = this.simulation.interpolationAlpha * FIXED_DT;
      const secondsToStep = Math.max(0, FIXED_DT - accumulatedSeconds);
      if (remainingSeconds + FIXED_STEP_EPSILON < secondsToStep) {
        this.simulation.advance(remainingSeconds, input);
        break;
      }

      const stepDelta = Math.min(remainingSeconds, secondsToStep);
      const before = this.simulation.snapshot;
      const environment = this.sampleEnvironment(before);
      const advancedSteps = this.simulation.advance(stepDelta, input, environment);
      remainingSeconds = Math.max(0, remainingSeconds - stepDelta);
      if (advancedSteps === 0) continue;

      const afterPlayerStep = this.simulation.snapshot;
      this.processTrackEvents(before, afterPlayerStep);
      const playerState = this.simulation.snapshot;
      this.processBikeEvents(playerState);
      this.captureDemonstratedMechanics(before, playerState, input);
      this.updateAi(playerState);
      fixedSteps += 1;

      if (playerState.race.finished || this.paused) break;
    }

    return fixedSteps;
  }

  private setRiderPresentation(
    rider: THREE.Object3D,
    progress: number,
    lateral: number,
    elevation: number,
    pitch: number,
    roll: number,
  ): void {
    const orientation = this.courseRoute.sample(progress, lateral, elevation, rider.position);
    this.courseYaw.setFromAxisAngle(WORLD_UP, orientation.yaw);
    this.riderEuler.set(pitch + orientation.pitch, 0, roll, "XYZ");
    this.riderLocalRotation.setFromEuler(this.riderEuler);
    rider.quaternion.copy(this.courseYaw).multiply(this.riderLocalRotation);
  }

  private setRiderPose(
    rider: THREE.Object3D,
    speed: number,
    progress: number,
    pitch: number,
    lean: number,
    height: number,
    crashed: boolean,
    reducedMotion: boolean,
  ): void {
    const riderVisual = rider.userData.riderVisual as THREE.Group | undefined;
    if (!riderVisual) return;
    const rig = rider.userData.riderPoseRig as RiderPoseRig | undefined;
    const speedFactor = clamp(speed / 22, 0, 1);
    const speedTuck = resolveRiderSpeedTuck(speed, crashed, reducedMotion);
    riderVisual.rotation.x = speedTuck * 0.28;
    riderVisual.position.y = crashed || reducedMotion
      ? 0
      : Math.sin(progress * 3.2) * 0.014 * speedFactor;
    if (!rig) return;

    if (crashed) {
      rig.torso.rotation.set(-0.18, 0.08, 0.34);
      rig.head.rotation.set(0.24, -0.18, 0.22);
      rig.leftArm.rotation.set(0.42, -0.08, 0.58);
      rig.rightArm.rotation.set(-0.18, 0.12, -0.46);
      rig.leftLeg.rotation.set(-0.32, 0.08, 0.24);
      rig.rightLeg.rotation.set(0.26, -0.08, -0.2);
      return;
    }

    if (reducedMotion) {
      rig.torso.rotation.set(0, 0, 0);
      rig.head.rotation.set(0, 0, 0);
      rig.leftArm.rotation.set(0, 0, 0);
      rig.rightArm.rotation.set(0, 0, 0);
      rig.leftLeg.rotation.set(0, 0, 0);
      rig.rightLeg.rotation.set(0, 0, 0);
      return;
    }

    const pitchPose = clamp(pitch, -0.55, 0.55);
    const leanPose = clamp(lean, -0.17, 0.17);
    const airborneFactor = clamp(height / 1.6, 0, 1);
    const groundCadence = Math.sin(progress * 2.7) * 0.018 * speedFactor * (1 - airborneFactor);
    const torsoPitch = speedTuck * 1.45 - pitchPose * 0.12 * airborneFactor;
    const armPitch = -torsoPitch * 0.7 - pitchPose * 0.16 * airborneFactor;
    const legPitch = speedFactor * 0.025 + airborneFactor * (0.08 + pitchPose * 0.16);

    rig.torso.rotation.set(torsoPitch, 0, leanPose * 0.46);
    rig.head.rotation.set(
      -torsoPitch * 0.62 + pitchPose * 0.18 * airborneFactor,
      0,
      -leanPose * 0.3,
    );
    rig.leftArm.rotation.set(armPitch - groundCadence, 0, leanPose * 0.24);
    rig.rightArm.rotation.set(armPitch + groundCadence, 0, leanPose * 0.24);
    rig.leftLeg.rotation.set(legPitch + groundCadence, 0, leanPose * 0.28);
    rig.rightLeg.rotation.set(legPitch - groundCadence, 0, leanPose * 0.28);
  }

  private addCourseAnchored(...objects: THREE.Object3D[]): void {
    for (const object of objects) this.applyCourseTransform(object);
    this.scene.add(...objects);
  }

  private addSurfaceCourseAnchored(...objects: THREE.Object3D[]): void {
    for (const object of objects) this.applyCourseTransform(object, true);
    this.scene.add(...objects);
  }

  private applyCourseTransform(object: THREE.Object3D, surfaceAligned = false): void {
    if (object instanceof THREE.InstancedMesh) {
      for (let index = 0; index < object.count; index += 1) {
        object.getMatrixAt(index, this.staticMatrix);
        this.staticMatrix.decompose(
          this.staticPosition,
          this.staticRotation,
          this.staticScale,
        );
        const progress = -this.staticPosition.z;
        const lateral = this.staticPosition.x;
        const elevation = this.staticPosition.y;
        const orientation = this.courseRoute.sample(
          progress,
          lateral,
          elevation,
          this.staticPosition,
        );
        this.courseYaw.setFromAxisAngle(WORLD_UP, orientation.yaw);
        if (surfaceAligned) {
          this.coursePitch.setFromAxisAngle(WORLD_RIGHT, orientation.pitch);
          this.staticRotation.premultiply(this.coursePitch);
        }
        this.staticRotation.premultiply(this.courseYaw);
        this.staticMatrix.compose(
          this.staticPosition,
          this.staticRotation,
          this.staticScale,
        );
        object.setMatrixAt(index, this.staticMatrix);
      }
      object.instanceMatrix.needsUpdate = true;
      object.computeBoundingBox();
      object.computeBoundingSphere();
      return;
    }

    const progress = -object.position.z;
    const lateral = object.position.x;
    const elevation = object.position.y;
    const orientation = this.courseRoute.sample(
      progress,
      lateral,
      elevation,
      object.position,
    );
    this.courseYaw.setFromAxisAngle(WORLD_UP, orientation.yaw);
    if (surfaceAligned) {
      this.coursePitch.setFromAxisAngle(WORLD_RIGHT, orientation.pitch);
      object.quaternion.premultiply(this.coursePitch);
    }
    object.quaternion.premultiply(this.courseYaw);
    object.updateMatrix();
    object.matrixWorldNeedsUpdate = true;
  }

  private render(delta: number): void {
    const state = this.simulation.snapshot;
    const bike = state.bike;
    const reducedMotion = this.settings.accessibility.reducedMotion;
    const wheelSpin = delta * bike.speed * 1.7;
    const localDistance = bike.forwardPosition % this.track.courseLength;
    const playerRouteHeight = this.authoredRouteHeight(localDistance, bike.lanePosition);
    const playerBaseY = 0.1 + 0.62 * this.player.scale.y;
    const playerCrashed = bike.phase === "crashed";
    const playerSteeringRoll = resolveRiderSteeringRoll(
      LANE_POSITIONS[bike.lane as LaneIndex],
      bike.lanePosition,
      playerCrashed,
      reducedMotion,
    );

    this.setRiderPose(
      this.player,
      bike.speed,
      bike.forwardPosition,
      bike.pitch,
      playerSteeringRoll,
      bike.height,
      playerCrashed,
      reducedMotion,
    );
    this.setRiderPresentation(
      this.player,
      bike.forwardPosition,
      bike.lanePosition,
      playerBaseY + playerRouteHeight + bike.height,
      bike.pitch,
      playerSteeringRoll,
    );
    const shadowOrientation = this.courseRoute.sample(
      bike.forwardPosition - 0.36,
      bike.lanePosition,
      0.095 + playerRouteHeight,
      this.playerShadow.position,
    );
    this.courseYaw.setFromAxisAngle(WORLD_UP, shadowOrientation.yaw);
    this.coursePitch.setFromAxisAngle(WORLD_RIGHT, shadowOrientation.pitch);
    this.playerShadow.quaternion
      .copy(this.courseYaw)
      .multiply(this.coursePitch)
      .multiply(SHADOW_ORIENTATION);
    this.playerShadow.scale.set(
      1.7 + clamp(bike.speed / 25, 0, 1) * 0.18,
      2.8,
      1,
    );
    const playerShadowMaterial = this.playerShadow.material as THREE.MeshBasicMaterial;
    playerShadowMaterial.opacity = 0.3 * clamp(1 - bike.height / 4.5, 0.1, 1);
    this.playerShadow.visible = bike.phase !== "crashed";
    this.player.userData.frontWheel.rotation.x -= wheelSpin;
    this.player.userData.backWheel.rotation.x -= wheelSpin;

    for (const ai of this.aiRiders) {
      const bike = ai.simulation.snapshot.bike;
      const crashed = bike.phase === "crashed";
      const steeringRoll = resolveRiderSteeringRoll(
        LANE_POSITIONS[bike.lane as LaneIndex],
        bike.lanePosition,
        crashed,
        reducedMotion,
      );
      const routeHeight = this.authoredRouteHeight(
        bike.forwardPosition % this.track.courseLength,
        bike.lanePosition,
      );
      this.setRiderPose(
        ai.group,
        bike.speed,
        bike.forwardPosition,
        bike.pitch,
        steeringRoll,
        bike.height,
        crashed,
        reducedMotion,
      );
      this.setRiderPresentation(
        ai.group,
        bike.forwardPosition,
        bike.lanePosition,
        0.72 + routeHeight + bike.height,
        bike.pitch,
        steeringRoll,
      );
      ai.group.visible = true;
      if (!crashed) {
        ai.group.userData.frontWheel.rotation.x -= delta * bike.speed * 1.7;
        ai.group.userData.backWheel.rotation.x -= delta * bike.speed * 1.7;
      }
    }

    const portrait = usesPortraitRacePresentation(
      this.canvas.clientWidth,
      this.canvas.clientHeight,
    );
    const presentation = portrait
      ? CAMERA_PRESENTATION_PROFILES.portrait
      : CAMERA_PRESENTATION_PROFILES.desktop;
    const speedLift = reducedMotion ? 0 : clamp(bike.speed / 20, 0, 1) * 0.58;
    const cameraOrientation = this.courseRoute.sample(
      bike.forwardPosition - presentation.trailingDistance,
      bike.lanePosition * presentation.laneFollow,
      presentation.height + playerRouteHeight + speedLift,
      this.cameraTarget,
    );
    const cameraRightX = cameraOrientation.rightX;
    const cameraRightZ = cameraOrientation.rightZ;
    const targetCamera = this.cameraTarget;
    if (this.cameraShake > 0 && !this.settings.accessibility.reducedShake) {
      const pulse = Math.sin(state.timeSeconds * 91) * this.cameraShake;
      targetCamera.x += cameraRightX * pulse * 0.55;
      targetCamera.z += cameraRightZ * pulse * 0.55;
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
    this.courseRoute.sample(
      bike.forwardPosition + presentation.lookAhead,
      bike.lanePosition * presentation.lookAtLaneFollow,
      presentation.lookHeight + playerRouteHeight + bike.height * 0.2,
      this.cameraLookTarget,
    );
    this.camera.lookAt(this.cameraLookTarget);
    if (this.sunLight) {
      this.courseRoute.sample(
        bike.forwardPosition - 24,
        -30,
        42,
        this.sunLight.position,
      );
      this.courseRoute.sample(
        bike.forwardPosition + 18,
        0,
        playerRouteHeight,
        this.sunTarget.position,
      );
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
    const contact = this.nearestObstacleContact(local, state.bike.lane, state.bike.height);
    if (!contact) return { surface: "dirt" };
    const key = `${Math.floor(state.bike.forwardPosition / this.track.courseLength)}:${contact.key}`;

    if (contact.kind === "cooling-gate" && key !== this.lastObstacleKey) {
      this.captionEvent("Cooling gate — heat dropped", "cooling");
      this.lastObstacleKey = key;
    }
    return this.obstaclePolicy(contact.parent).environment;
  }

  private nearestObstacleContact(
    localDistance: number,
    lane: number,
    bikeHeight = 0,
  ): ObstacleContactSection | undefined {
    return this.obstacleContacts.find((contact) => {
      if (!contact.lanes.includes(lane as LaneIndex)) return false;
      if (Math.abs(localDistance - contact.distance) > contact.length / 2) return false;
      if (contact.parent.height === undefined) return true;
      const routeHeight = this.authoredRouteHeight(localDistance, LANE_POSITIONS[lane as LaneIndex]);
      return Math.abs(routeHeight + bikeHeight - contact.parent.height) <= 1.25;
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

    for (const candidate of this.obstacleContacts) {
      const absolute = lapStart + candidate.distance;
      if (
        start < absolute
        && end >= absolute
        && this.obstaclePolicy(candidate.parent).crashesOnContact
        && !candidate.lanes.includes(state.bike.lane)
      ) {
        this.demonstrated.hazardAvoided = true;
        if (this.mode === "tutorial" && candidate.parent.id === "qa-choice-barrier") {
          this.tutorialEvents.choiceBarrierAvoided = true;
          this.observeTutorialLesson("choice-barrier-avoided");
        }
      }
    }

    const contact = this.nearestObstacleContact(end % course, state.bike.lane, state.bike.height);
    if (contact && state.bike.phase === "grounded") {
      const key = `${lapIndex}:${contact.key}`;
      const policy = this.obstaclePolicy(contact.parent);
      if (!this.handledObstacleKeys.has(key) && policy.crashesOnContact) {
        this.handledObstacleKeys.add(key);
        if (this.mode === "tutorial" && contact.parent.id === "qa-recovery-barrier") {
          this.tutorialEvents.recoveryBarrierCrash = true;
          this.tutorialRecoveryBarrierCrashPending = true;
          this.observeTutorialLesson("recovery-barrier-crash");
        }
        this.simulation.forceCrash("obstacle");
        this.captionEvent("Barrier hit — hold recover", "crash");
      } else if (!this.handledObstacleKeys.has(key) && policy.retainedSpeed < 1) {
        this.handledObstacleKeys.add(key);
        if (state.bike.wheelie) {
          if (this.mode === "tutorial" && contact.parent.id === "qa-bump") {
            this.tutorialEvents.trainingBumpClearedInWheelie = true;
            this.observeTutorialLesson("training-bump-wheelie");
          }
          this.captionEvent("Front wheel clear — bump speed held", "landing");
        } else {
          this.simulation.applySpeedPenalty(retainedSpeedForContact(contact, policy));
          this.captionEvent("Bump strike — wheelie next time", "rough-landing");
        }
      }
    }
  }

  private processBikeEvents(state: SimulationState): void {
    const { bike } = state;
    const previousPhase = this.lastBikePhase;
    const enteredCrash = bike.phase === "crashed" && previousPhase !== "crashed";
    const landingChanged = bike.lastLanding !== null && bike.lastLanding !== this.lastLanding;
    if (landingChanged) {
      this.captionEvent(
        bike.lastLanding === "clean" ? "Clean landing — speed held" : bike.lastLanding === "rough" ? "Rough landing — rebalance" : "Bad landing — hold recover",
        bike.lastLanding === "clean" ? "landing" : bike.lastLanding === "rough" ? "rough-landing" : "crash",
      );
      if (bike.lastLanding === "clean") this.observeTutorialLesson("clean-landing");
      if (bike.lastLanding === "crash") this.crashes += 1;
    }
    this.lastLanding = bike.lastLanding;

    if (enteredCrash && bike.crashCause === "wheelie-timeout") {
      this.captionEvent("Wheelie held too long — hold recover", "crash");
    }
    if (enteredCrash && !(landingChanged && bike.lastLanding === "crash")) {
      this.crashes += 1;
    }
    if (bike.phase === "crashed") this.demonstrated.crash = true;
    if (previousPhase === "recovering" && bike.phase === "grounded") {
      this.demonstrated.recovery = true;
      if (this.tutorialRecoveryBarrierCrashPending) {
        this.tutorialEvents.recoveryBarrierRecovered = true;
        this.tutorialRecoveryBarrierCrashPending = false;
        this.observeTutorialLesson("recovery-barrier-recovered");
      }
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
      this.captionEvent("Overheated — controls return at 35% heat", "overheat");
    }
    this.lastOverheated = bike.overheated;
  }

  private captureDemonstratedMechanics(
    before: SimulationState,
    state: SimulationState,
    input: SimulationInput,
  ): void {
    const rideAtUsableSpeed = input.throttle
      && state.bike.phase === "grounded"
      && state.bike.speed >= 5;
    const coast = before.bike.speed >= 5
      && !input.throttle
      && !input.turbo
      && state.bike.speed < before.bike.speed;
    const criticalHeatReached = before.bike.heat < 78 && state.bike.heat >= 78;
    const coolingRelease = before.bike.surface !== "cooling"
      && state.bike.surface === "cooling"
      && !input.turbo;
    const laneChanged = before.bike.lane !== state.bike.lane;
    const mudSlowdownExperienced = state.bike.phase === "grounded"
      && state.bike.surface === "mud"
      && state.bike.speed < before.bike.speed;

    this.demonstrated.rideAtUsableSpeed ||= rideAtUsableSpeed;
    this.demonstrated.coast ||= coast;
    this.demonstrated.criticalHeatReached ||= state.bike.heat >= 78;
    this.demonstrated.coolingRelease ||= state.bike.surface === "cooling" && !input.turbo;
    if (rideAtUsableSpeed) this.observeTutorialLesson("ride-at-usable-speed");
    if (coast) this.observeTutorialLesson("coast");
    if (criticalHeatReached) this.observeTutorialLesson("critical-heat-reached");
    if (coolingRelease) this.observeTutorialLesson("cooling-release");
    if (laneChanged) this.observeTutorialLesson("lane-change");
    if (mudSlowdownExperienced) this.observeTutorialLesson("mud-slowdown");

    if (this.mode === "tutorial") {
      const grassSlowdownExperienced = state.bike.phase === "grounded"
        && state.bike.surface === "grass"
        && state.bike.speed < before.bike.speed;
      this.tutorialEvents.grassSlowdownExperienced ||= grassSlowdownExperienced;
      const trainingGrass = this.track.obstacles.find((obstacle) => obstacle.id === "qa-grass");
      const localDistance = state.bike.forwardPosition % this.track.courseLength;
      const insideTrainingGrassLength = trainingGrass !== undefined
        && Math.abs(localDistance - trainingGrass.distance)
          <= Math.max(3.5, (trainingGrass.length ?? 8) / 2);
      const grassReturnedToDirt = this.tutorialEvents.grassSlowdownExperienced
        && before.bike.surface === "grass"
        && state.bike.surface === "dirt"
        && insideTrainingGrassLength
        && trainingGrass !== undefined
        && !laneMatches(trainingGrass, state.bike.lane);
      this.tutorialEvents.grassReturnedToDirt ||= grassReturnedToDirt;
      if (grassSlowdownExperienced) this.observeTutorialLesson("grass-slowdown");
      if (grassReturnedToDirt) this.observeTutorialLesson("grass-returned-to-dirt");
    }

    if (state.bike.phase === "airborne") {
      this.demonstrated.airbornePitchUp ||= input.pitch > 0.1;
      this.demonstrated.airbornePitchDown ||= input.pitch < -0.1;
      this.demonstrated.airborneNeutral ||= Math.abs(input.pitch) <= 0.1
        && this.demonstrated.airbornePitchUp
        && this.demonstrated.airbornePitchDown;
      if (input.pitch > 0.1) this.observeTutorialLesson("airborne-pitch-up");
      if (input.pitch < -0.1) this.observeTutorialLesson("airborne-pitch-down");
      if (Math.abs(input.pitch) <= 0.1) this.observeTutorialLesson("airborne-pitch-neutral");
    }
  }

  private updateAi(state: SimulationState): void {
    const profile = getAiDifficultyProfile(this.settings.difficulty);
    for (const [index, ai] of this.aiRiders.entries()) {
      this.stepAi(ai, index, profile, state);
    }
    this.resolveAiPairCollisions(profile, true);
    this.resolvePlayerAiCollisions(profile);
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
    const currentContact = this.nearestObstacleContact(local, bike.lane, bike.height);
    const currentPolicy = this.obstaclePolicy(currentContact?.parent);
    const aheadContact = this.obstacleContacts.find((contact) => {
      const gap = contact.distance - local;
      return gap > 0 && gap < profile.obstacleLookahead && contact.lanes.includes(bike.lane);
    });
    const aheadCooling = this.obstacleContacts.find((contact) => {
      const gap = contact.distance - local;
      return contact.kind === "cooling-gate" && gap > 0 && gap < profile.coolingLookahead;
    });
    const aheadPolicy = this.obstaclePolicy(aheadContact?.parent);
    const planningObstacle = aheadContact?.parent.moduleId === "barrier-offset"
      ? aheadContact.parent
      : aheadContact;

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
          aheadObstacle: planningObstacle,
          aheadObstacleAvoidable: aheadPolicy.avoidable,
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
      hasAheadObstacle: aheadContact !== undefined,
      consistency,
      profile,
    });
    const aheadGap = aheadContact ? aheadContact.distance - local : Number.POSITIVE_INFINITY;
    const preparingRamp = currentPolicy.environment.surface === "ramp"
      || (aheadPolicy.environment.surface === "ramp" && aheadGap < 8);
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

    if (currentContact && bike.phase === "grounded") {
      const key = `${Math.floor(bike.forwardPosition / this.track.courseLength)}:${currentContact.key}`;
      if (key !== ai.lastObstacleKey) {
        ai.lastObstacleKey = key;
        if (currentPolicy.crashesOnContact) {
          this.crashAi(ai, profile);
        } else if (currentPolicy.retainedSpeed < 1 && !bike.wheelie) {
          ai.simulation.applySpeedPenalty(retainedSpeedForContact(currentContact, currentPolicy));
        }
      }
    }
  }

  private resolvePlayerAiCollisions(profile: AiDifficultyProfile): void {
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
        this.simulation.forceCrash("rider-contact");
        this.captionEvent("Front wheel contact — you hit the rider ahead", "crash");
        break;
      }
      if (outcome === "pursuer-crashes") {
        this.crashAi(ai, profile, player.forwardPosition - 16);
        this.captionEvent("Rear-wheel defense — pursuer went down", "crowd");
      }
    }
  }

  private resolveAiPairCollisions(
    profile: AiDifficultyProfile,
    announce: boolean,
  ): void {
    for (let firstIndex = 0; firstIndex < this.aiRiders.length; firstIndex += 1) {
      const first = this.aiRiders[firstIndex];
      if (!first || first.finishTimeMs !== undefined) continue;
      for (let secondIndex = firstIndex + 1; secondIndex < this.aiRiders.length; secondIndex += 1) {
        const second = this.aiRiders[secondIndex];
        if (!second || second.finishTimeMs !== undefined) continue;
        const firstBike = first.simulation.snapshot.bike;
        const secondBike = second.simulation.snapshot.bike;
        const outcome = resolveRiderPairCollision({
          sameLane: firstBike.lane === secondBike.lane,
          gap: secondBike.forwardPosition - firstBike.forwardPosition,
          firstSpeed: firstBike.speed,
          secondSpeed: secondBike.speed,
          firstPhase: firstBike.phase,
          secondPhase: secondBike.phase,
        });
        if (outcome === "first-rider-crashes") {
          this.crashAi(first, profile);
          if (announce) {
            this.captionEvent(`Rival contact — ${first.riderName} went down`, "crowd");
          }
        } else if (outcome === "second-rider-crashes") {
          this.crashAi(second, profile);
          if (announce) {
            this.captionEvent(`Rival contact — ${second.riderName} went down`, "crowd");
          }
        }
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
    this.lastHudInputDevice = device;
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
        ? "Controls return when heat cools to 35%"
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
    const tutorialLesson = this.tutorialLessonGate.snapshot;

    if (this.mode === "tutorial") {
      this.canvas.dataset.tutorialLessonIndex = tutorialLesson.activeLessonIndex === null
        ? "none"
        : String(tutorialLesson.activeLessonIndex);
      this.canvas.dataset.tutorialLessonComplete = String(tutorialLesson.complete);
      this.canvas.dataset.tutorialLessonSignals = tutorialLesson.observedSignals.join(" ");
      this.canvas.dataset.tutorialForwardPosition = state.bike.forwardPosition.toFixed(1);
    }

    if (import.meta.env.VITE_QA_MODE === "1") {
      this.canvas.dataset.demonstratedMechanics = Object.entries(this.demonstrated)
        .filter(([, complete]) => complete)
        .map(([mechanic]) => mechanic)
        .join(" ");
      this.canvas.dataset.tutorialEvents = Object.entries(this.tutorialEvents)
        .filter(([, complete]) => complete)
        .map(([event]) => event)
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
      tutorialLesson,
      demonstrated: { ...this.demonstrated },
      tutorialEvents: { ...this.tutorialEvents },
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
      trackName: this.track.name,
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
    this.onFinish(result, replaySamples);
  }

  private completeAiClassification(playerState: SimulationState): boolean {
    if (this.aiRiders.length === 0) return true;
    const profile = getAiDifficultyProfile(this.settings.difficulty);
    let steps = 0;
    while (this.aiRiders.some((ai) => ai.finishTimeMs === undefined)) {
      for (const [index, ai] of this.aiRiders.entries()) {
        this.stepAi(ai, index, profile, playerState);
      }
      this.resolveAiPairCollisions(profile, false);
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
    if (this.replayBytes.length + 7 > MAX_REPLAY_BYTES) return;
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
      this.dustPool.push({ mesh, life: 0, driftX: 0, driftZ: 0 });
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
      particle.mesh.position.x += particle.driftX * delta;
      particle.mesh.position.z += particle.driftZ * delta;
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
    const drift = side * (0.25 + (this.dustCursor % 3) * 0.08);
    particle.mesh.scale.setScalar(0.7);
    const orientation = this.courseRoute.sample(
      state.bike.forwardPosition - 0.85,
      state.bike.lanePosition + side * 0.26,
      0.18 + this.authoredRouteHeight(
        state.bike.forwardPosition % this.track.courseLength,
        state.bike.lanePosition,
      ),
      particle.mesh.position,
    );
    particle.driftX = orientation.rightX * drift;
    particle.driftZ = orientation.rightZ * drift;
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
    const routeStart = -30;
    const routeEnd = totalLength - 30;
    const grassTexture = createTerrainTexture(palette.grass, 0x244a32, this.track.order * 719, "grass");
    grassTexture.repeat.set(6, 1);
    grassTexture.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
    const shoulderTexture = grassTexture.clone();
    shoulderTexture.repeat.set(1, 1);
    shoulderTexture.needsUpdate = true;
    const dirtTexture = createTerrainTexture(palette.dirt, palette.dirtDark, this.track.order * 1_237, "dirt");
    dirtTexture.repeat.set(1, 1);
    dirtTexture.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
    const dirtHeightTexture = createDirtHeightTexture();
    dirtHeightTexture.repeat.set(1, 1);
    dirtHeightTexture.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
    this.ownedTextures.push(grassTexture, shoulderTexture, dirtTexture, dirtHeightTexture);
    const grassMaterial = new THREE.MeshStandardMaterial({ map: grassTexture, color: 0xffffff, roughness: 0.98, metalness: 0 });
    const shoulderMaterial = new THREE.MeshStandardMaterial({
      map: shoulderTexture,
      color: 0xffffff,
      roughness: 0.98,
      metalness: 0,
    });
    const dirtMaterial = new THREE.MeshStandardMaterial({
      map: dirtTexture,
      bumpMap: dirtHeightTexture,
      bumpScale: 0.105,
      color: 0xffffff,
      roughness: 0.88,
      metalness: 0,
    });
    const grass = new THREE.Mesh(
      createCourseRibbonGeometry(this.courseRoute, {
        startProgress: routeStart,
        endProgress: routeEnd,
        left: -34,
        right: this.track.id === "coastline-clash" ? 14.1 : 34,
        yOffset: -0.11,
        segmentLength: 6,
      }),
      grassMaterial,
    );
    grass.name = "course-graded-ground";
    grass.receiveShadow = true;
    this.scene.add(grass);
    const shoulders = new THREE.Mesh(
      createCourseRibbonGeometry(this.courseRoute, {
        startProgress: routeStart,
        endProgress: routeEnd,
        left: -8.3,
        right: 8.3,
        yOffset: 0.025,
        segmentLength: 4,
      }),
      shoulderMaterial,
    );
    shoulders.name = "course-grass-shoulders";
    shoulders.receiveShadow = true;
    const dirt = new THREE.Mesh(
      createCourseRibbonGeometry(this.courseRoute, {
        startProgress: routeStart,
        endProgress: routeEnd,
        left: -6.65,
        right: 6.65,
        yOffset: 0.075,
        segmentLength: 4,
      }),
      dirtMaterial,
    );
    dirt.name = "course-dirt-ribbon";
    dirt.receiveShadow = true;
    this.scene.add(shoulders, dirt);

    const authoredCourse = this.track.authoredCourse;
    if (!authoredCourse) {
      const shoulderMatrix = new THREE.Matrix4();
      const bermSegmentDepth = this.quality === "low" ? 6 : this.quality === "medium" ? 5 : 4;
      const bermSegmentsPerLane = Math.ceil(totalLength / bermSegmentDepth);
      const laneRidges = new THREE.InstancedMesh(
        createLaneBermGeometry(),
        grassMaterial,
        bermSegmentsPerLane * 3,
      );
      const bermRandom = seededRandom(this.track.order * 213_119);
      let bermIndex = 0;
      for (const x of [-3, 0, 3]) {
        for (let segment = 0; segment < bermSegmentsPerLane; segment += 1) {
          const depth = Math.min(bermSegmentDepth + 0.8, totalLength - segment * bermSegmentDepth);
          const widthScale = 0.82 + bermRandom() * 0.36;
          const heightScale = 0.8 + bermRandom() * 0.42;
          shoulderMatrix.compose(
            new THREE.Vector3(
              x + (bermRandom() - 0.5) * 0.12,
              0.075,
              30 - segment * bermSegmentDepth - depth / 2,
            ),
            new THREE.Quaternion().setFromEuler(new THREE.Euler(0, (bermRandom() - 0.5) * 0.025, 0)),
            new THREE.Vector3(0.34 * widthScale, 0.12 * heightScale, depth),
          );
          laneRidges.setMatrixAt(bermIndex, shoulderMatrix);
          bermIndex += 1;
        }
      }
      laneRidges.instanceMatrix.needsUpdate = true;
      laneRidges.receiveShadow = true;
      laneRidges.castShadow = this.quality === "high";
      this.addSurfaceCourseAnchored(laneRidges);
    }
    this.createTerracedCourseEdges(totalLength);
    this.createHighContrastTrackGuides(totalLength);
    this.createStartGridPresentation();

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

  private createStartGridPresentation(): void {
    if (this.track.authoredCourse !== undefined) {
      this.canvas.dataset.startGridStyle = "authored-excluded";
      this.canvas.dataset.startGridStencilCount = "0";
      this.canvas.dataset.startGridBatchCount = "0";
      return;
    }

    const stencilMaterial = new THREE.MeshBasicMaterial({
      color: 0xf5edda,
      toneMapped: false,
      polygonOffset: true,
      polygonOffsetFactor: -4,
    });
    const stencilCount = START_GRID_DIGITS.reduce((count, digit) => count + digit.length, 0);
    const stencils = new THREE.InstancedMesh(
      new THREE.BoxGeometry(1, 0.025, 1),
      stencilMaterial,
      stencilCount,
    );
    const matrix = new THREE.Matrix4();
    let stencilIndex = 0;
    START_GRID_DIGITS.forEach((digit, laneIndex) => {
      const laneX = LANE_POSITIONS[laneIndex as LaneIndex];
      for (const segmentName of digit) {
        const segment = START_GRID_SEGMENTS[segmentName];
        matrix.compose(
          new THREE.Vector3(
            laneX + segment.x,
            0.105,
            -(START_GRID_NUMBER_PROGRESS + segment.forward),
          ),
          new THREE.Quaternion(),
          new THREE.Vector3(segment.width, 1, segment.depth),
        );
        stencils.setMatrixAt(stencilIndex, matrix);
        stencilIndex += 1;
      }
    });
    stencils.instanceMatrix.needsUpdate = true;
    stencils.renderOrder = 2;
    stencils.userData.presentationOnly = true;

    const lineTileCount = 16;
    const line = new THREE.InstancedMesh(
      new THREE.BoxGeometry(0.72, 0.025, 0.5),
      new THREE.MeshBasicMaterial({
        color: 0xf5edda,
        toneMapped: false,
        polygonOffset: true,
        polygonOffsetFactor: -4,
      }),
      lineTileCount,
    );
    const lineColors = [0xf5edda, PLAYER_ACCENT, PLAYER_COLOR] as const;
    for (let index = 0; index < lineTileCount; index += 1) {
      matrix.makeTranslation(-6 + index * 0.8, 0.105, -START_GRID_LINE_PROGRESS);
      line.setMatrixAt(index, matrix);
      line.setColorAt(
        index,
        new THREE.Color(lineColors[index % lineColors.length] ?? lineColors[0]),
      );
    }
    line.instanceMatrix.needsUpdate = true;
    if (line.instanceColor) line.instanceColor.needsUpdate = true;
    line.renderOrder = 2;
    line.userData.presentationOnly = true;

    this.canvas.dataset.startGridStyle = "numbered-four-lane";
    this.canvas.dataset.startGridStencilCount = String(START_GRID_DIGITS.length);
    this.canvas.dataset.startGridBatchCount = "2";
    this.addCourseAnchored(stencils, line);
  }

  private createTerracedCourseEdges(totalLength: number): void {
    const segmentDepth = this.quality === "low" ? 6 : this.quality === "medium" ? 5 : 4;
    const segmentCount = Math.ceil((totalLength + 50) / segmentDepth);
    const instanceCount = segmentCount * 2;
    const palette = this.track.palette;
    const shelfColor = this.track.id === "foundry-flight"
      ? new THREE.Color(palette.rock).lerp(new THREE.Color(0x59636a), 0.38).getHex()
      : new THREE.Color(palette.grass).lerp(new THREE.Color(palette.dirt), 0.12).getHex();
    const wallColor = new THREE.Color(palette.rock).offsetHSL(0, 0.01, -0.07).getHex();
    const capColor = this.track.id === "summit-showdown"
      ? 0xe2edf0
      : new THREE.Color(palette.rock).offsetHSL(0.01, 0.02, 0.07).getHex();
    const shelves = new THREE.InstancedMesh(
      new THREE.BoxGeometry(4.8, 0.72, segmentDepth + 0.8),
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
    this.addSurfaceCourseAnchored(shelves, lowerSteps);
    this.addCourseAnchored(upperSteps, caps);
  }

  private createHighContrastTrackGuides(totalLength: number): void {
    const guides = new THREE.Group();
    const authoredCourse = this.track.authoredCourse;
    const totalLaps = this.simulation.snapshot.race.totalLaps;
    const routeStart = -30;
    const routeEnd = totalLength - 30;
    const rawOccupiedIntervalsByGuide: Array<Array<{ start: number; end: number }>> = Array.from(
      { length: 5 },
      () => [],
    );
    if (authoredCourse) {
      for (let lap = 0; lap < totalLaps; lap += 1) {
        const lapStart = lap * this.track.courseLength;
        for (const piece of authoredCourse.trackPieces) {
          const rotatedCurvePadding = piece.kind !== "straight"
            && (piece.rotation === 90 || piece.rotation === 270) ? 0.4 : 0;
          const halfLength = piece.length / 2 + 0.08 + rotatedCurvePadding;
          for (let guideIndex = 0; guideIndex < 5; guideIndex += 1) {
            if (!authoredWorldGuideHasVisibleOverlay(piece, guideIndex)) continue;
            rawOccupiedIntervalsByGuide[guideIndex]?.push({
              start: lapStart + piece.distance - halfLength,
              end: lapStart + piece.distance + halfLength,
            });
          }
        }
      }
    }
    const visibleIntervalsByGuide = rawOccupiedIntervalsByGuide.map((rawIntervals) => {
      rawIntervals.sort((first, second) => first.start - second.start);
      const occupiedIntervals: Array<{ start: number; end: number }> = [];
      for (const interval of rawIntervals) {
        const start = Math.max(routeStart, interval.start);
        const end = Math.min(routeEnd, interval.end);
        if (end <= start) continue;
        const previous = occupiedIntervals[occupiedIntervals.length - 1];
        if (previous && start <= previous.end) previous.end = Math.max(previous.end, end);
        else occupiedIntervals.push({ start, end });
      }
      const visibleIntervals: Array<{ start: number; end: number }> = [];
      let visibleStart = routeStart;
      for (const interval of occupiedIntervals) {
        if (interval.start > visibleStart) visibleIntervals.push({ start: visibleStart, end: interval.start });
        visibleStart = Math.max(visibleStart, interval.end);
      }
      if (visibleStart < routeEnd) visibleIntervals.push({ start: visibleStart, end: routeEnd });
      return visibleIntervals;
    });
    const edgeMaterial = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      toneMapped: false,
      polygonOffset: true,
      polygonOffsetFactor: -1,
    });
    const laneMaterial = new THREE.MeshBasicMaterial({
      color: YELLOW,
      toneMapped: false,
      polygonOffset: true,
      polygonOffsetFactor: -1,
    });
    for (const [index, x] of HIGH_CONTRAST_GUIDE_X.entries()) {
      const isTrackEdge = index === 0 || index === 4;
      const width = isTrackEdge ? 0.22 : 0.09;
      const yOffset = isTrackEdge || authoredCourse ? 0.19 : 0.245;
      const guide = new THREE.Mesh(
        authoredCourse
          ? createCourseGuideGapGeometry(
              this.courseRoute,
              visibleIntervalsByGuide[index] ?? [{ start: routeStart, end: routeEnd }],
              x - width / 2,
              x + width / 2,
              yOffset,
            )
          : createCourseRibbonGeometry(this.courseRoute, {
              startProgress: routeStart,
              endProgress: routeEnd,
              left: x - width / 2,
              right: x + width / 2,
              yOffset,
              segmentLength: 4,
            }),
        isTrackEdge ? edgeMaterial : laneMaterial,
      );
      guide.name = isTrackEdge ? "high-contrast-track-edge" : "high-contrast-lane-guide";
      guide.castShadow = false;
      guide.receiveShadow = false;
      guide.renderOrder = 2;
      guides.add(guide);
    }

    let guideCount = 5;
    if (authoredCourse && authoredCourse.trackPieces.length > 0) {
      const authoredMaterial = new THREE.MeshBasicMaterial({
        vertexColors: true,
        toneMapped: false,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        side: THREE.DoubleSide,
      });
      const batches = new Map<
        string,
        { representative: AuthoredTrackPiece; placements: Array<{ piece: AuthoredTrackPiece; lap: number }> }
      >();
      for (const piece of authoredCourse.trackPieces) {
        const key = `${piece.kind}:${piece.unrotatedWidth}:${piece.unrotatedLength}`;
        const existing = batches.get(key);
        const batch = existing ?? { representative: piece, placements: [] };
        if (!existing) batches.set(key, batch);
        for (let lap = 0; lap < totalLaps; lap += 1) batch.placements.push({ piece, lap });
      }

      for (const [batchIndex, batch] of [...batches.values()].entries()) {
        const authoredGuides = new THREE.InstancedMesh(
          createAuthoredPieceGuideGeometry(batch.representative),
          authoredMaterial,
          batch.placements.length,
        );
        for (const [instanceIndex, placement] of batch.placements.entries()) {
          this.staticPosition.set(
            placement.piece.lateralPosition,
            placement.piece.height + 0.08,
            -(placement.lap * this.track.courseLength + placement.piece.distance),
          );
          this.staticRotation.setFromAxisAngle(
            WORLD_UP,
            THREE.MathUtils.degToRad(placement.piece.rotation),
          );
          this.staticScale.set(1, 1, 1);
          this.staticMatrix.compose(
            this.staticPosition,
            this.staticRotation,
            this.staticScale,
          );
          authoredGuides.setMatrixAt(instanceIndex, this.staticMatrix);
        }
        authoredGuides.name = `authored-high-contrast-guide-batch-${batchIndex + 1}`;
        authoredGuides.instanceMatrix.setUsage(THREE.StaticDrawUsage);
        authoredGuides.castShadow = false;
        authoredGuides.receiveShadow = false;
        authoredGuides.renderOrder = 3;
        this.applyCourseTransform(authoredGuides, true);
        guides.add(authoredGuides);
        guideCount += batch.placements.length * 5;
      }
    }
    guides.name = "high-contrast-track-guides";
    guides.userData.guideCount = guideCount;
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
    this.addSurfaceCourseAnchored(group);
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
      context.font = '900 46px "Ridge Display", sans-serif';
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
    this.addCourseAnchored(group);
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
      if (authored && obstacle.kind !== "barrier" && obstacle.kind !== "cooling-gate") {
        this.addSurfaceCourseAnchored(mesh);
      } else {
        this.addCourseAnchored(mesh);
      }
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
      case "barrier": return this.createBarrierVisual(
        obstacle,
        x,
        visualWidth,
        z,
        visualLength,
        materials.warning,
      );
      case "bump": return this.createBumpVisual(
        obstacle,
        x,
        visualWidth,
        z,
        visualLength,
        materials.dirt,
      );
      case "bank": return this.createBankVisual(x, visualWidth, z, visualLength, materials.dirt);
      default: return this.createRampVisual(obstacle, x, visualWidth, z, visualLength, materials);
    }
  }

  private createMudVisual(x: number, visualWidth: number, z: number, visualLength?: number): THREE.Group {
    const mud = new THREE.Group();
    const length = visualLength ?? 16;
    const mudMaterial = new THREE.MeshStandardMaterial({
      color: 0x744534,
      roughness: 0.5,
      metalness: 0.025,
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
      makeMaterial(0x513129, 0.64),
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
    const halo = new THREE.Mesh(
      geometry,
      new THREE.MeshBasicMaterial({
        color: 0x79ffff,
        transparent: true,
        opacity: 0.34,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
      }),
    );
    halo.scale.set(visualWidth / 2.64 * 1.09, 1.16, 1.08);
    halo.position.z = 0.075;
    const panel = new THREE.Mesh(
      new THREE.PlaneGeometry(Math.max(1.7, visualWidth * 0.78), 1.55),
      new THREE.MeshBasicMaterial({
        color: COOLING,
        transparent: true,
        opacity: 0.16,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
        toneMapped: false,
      }),
    );
    panel.position.set(0, 1.08, 0.02);
    const groundSpill = new THREE.Mesh(
      new THREE.PlaneGeometry(Math.max(2.2, visualWidth * 0.92), 2.5),
      new THREE.MeshBasicMaterial({
        color: COOLING,
        transparent: true,
        opacity: 0.18,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
        toneMapped: false,
      }),
    );
    groundSpill.rotation.x = -Math.PI / 2;
    groundSpill.position.set(0, 0.035, -0.18);
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
    gate.add(frame, glow, halo, panel, groundSpill, bases, snowflake);
    this.coolingSnowflakes.push(snowflake);
    gate.position.set(x, 0.1, z);
    return gate;
  }

  private createBarrierVisual(
    obstacle: TrackObstacle,
    x: number,
    visualWidth: number,
    z: number,
    visualLength: number | undefined,
    warning: THREE.MeshStandardMaterial,
  ): THREE.Group {
    const barrier = new THREE.Group();
    const offset = obstacle.moduleId === "barrier-offset";
    const length = visualLength ?? obstacle.length ?? 2.6;
    const blockDepth = offset ? Math.min(0.72, length) : 0.5;
    const blockWidth = offset ? visualWidth * 0.52 : visualWidth * 0.92;
    const blockers = offset
      ? [
          { x: -visualWidth * 0.22, z: -length * 0.27 },
          { x: visualWidth * 0.22, z: length * 0.27 },
        ]
      : [{ x: 0, z: 0 }];
    const bases = new THREE.InstancedMesh(
      new THREE.BoxGeometry(1, 0.76, 0.5),
      warning,
      blockers.length,
    );
    const stripes = new THREE.InstancedMesh(
      new THREE.BoxGeometry(Math.max(0.14, blockWidth * 0.1), 0.7, 0.055),
      makeMaterial(0x172d3d, 0.62),
      blockers.length * 3,
    );
    const stripeMatrix = new THREE.Matrix4();
    const stripeRotation = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, -0.34));
    const feet = new THREE.InstancedMesh(
      new THREE.BoxGeometry(0.4, 0.18, 0.88),
      makeMaterial(0x21384b, 0.72),
      blockers.length * 2,
    );
    let stripeIndex = 0;
    let footIndex = 0;
    for (const [blockerIndex, blocker] of blockers.entries()) {
      stripeMatrix.compose(
        new THREE.Vector3(blocker.x, offset ? -0.11 : 0, blocker.z),
        new THREE.Quaternion(),
        new THREE.Vector3(blockWidth, 1, blockDepth / 0.5),
      );
      bases.setMatrixAt(blockerIndex, stripeMatrix);
      for (const stripeRatio of [-0.28, 0, 0.28]) {
        stripeMatrix.compose(
          new THREE.Vector3(
            blocker.x + stripeRatio * blockWidth,
            offset ? -0.04 : 0,
            blocker.z + blockDepth / 2 + 0.03,
          ),
          stripeRotation,
          new THREE.Vector3(1, 1, 1),
        );
        stripes.setMatrixAt(stripeIndex, stripeMatrix);
        stripeIndex += 1;
      }
      for (const footSide of [-1, 1]) {
        stripeMatrix.makeTranslation(
          blocker.x + footSide * blockWidth * 0.31,
          -0.44,
          blocker.z,
        );
        feet.setMatrixAt(footIndex, stripeMatrix);
        footIndex += 1;
      }
    }
    barrier.add(bases, stripes, feet);
    barrier.position.set(x, 0.52, z);
    barrier.name = offset ? "barrier-offset-runtime" : "barrier-short-runtime";
    barrier.userData.visualSectionCount = blockers.length;
    return barrier;
  }

  private createBumpVisual(
    obstacle: TrackObstacle,
    x: number,
    visualWidth: number,
    z: number,
    visualLength: number | undefined,
    material: THREE.MeshStandardMaterial,
  ): THREE.Object3D {
    if (obstacle.moduleId === "bump-row" || obstacle.moduleId === "bump-single") {
      const row = obstacle.moduleId === "bump-row";
      const length = visualLength ?? obstacle.length ?? (row ? 5.28 : 1.76);
      const sectionLength = row ? length * 0.25 : length;
      const ratios: readonly number[] = row ? [-0.375, -0.125, 0.125, 0.375] : [0];
      const geometry = createMergedObstacleProfileGeometry(
        visualWidth,
        ratios.map((ratio, index) => {
          const profile: ObstacleProfilePoint[] = [];
          const height = row ? 0.52 + (index % 2) * 0.12 : 0.68;
          for (let step = 0; step <= 6; step += 1) {
            const progress = step / 6;
            profile.push([
              -sectionLength / 2 + progress * sectionLength,
              Math.sin(progress * Math.PI) * height,
            ]);
          }
          return { profile, offsetZ: -ratio * length };
        }),
      );
      geometry.name = row
        ? "bump-row-four-section-profile"
        : "bump-single-profile";
      const bump = new THREE.Mesh(geometry, material);
      bump.position.set(x, 0.04, z);
      bump.name = row ? "bump-row-runtime" : "bump-single-runtime";
      bump.userData.visualSectionCount = ratios.length;
      return bump;
    }
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
    bump.name = obstacle.moduleId === "bump-single"
      ? "bump-single-runtime"
      : "campaign-bump-runtime";
    bump.userData.visualSectionCount = 1;
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
    obstacle: TrackObstacle,
    x: number,
    visualWidth: number,
    z: number,
    visualLength: number | undefined,
    materials: ObstacleMaterials,
  ): THREE.Group {
    const group = new THREE.Group();
    const kind = obstacle.kind;
    const depth = visualLength ?? (
      kind === "small-ramp" ? 4.2
        : kind === "medium-ramp" ? 5.4
          : kind === "large-ramp" ? 7
            : kind === "super-jump" ? 9.4
              : 8
    );
    const rhythmRatios = obstacle.moduleId === "jump-double"
      ? [-0.3, 0.3] as const
      : kind === "jump-chain"
        ? [-0.31, 0, 0.31] as const
        : null;
    let height = obstacle.moduleId === "ramp-small" || kind === "small-ramp"
      ? 1.05
      : obstacle.moduleId === "ramp-medium" || kind === "medium-ramp"
        ? 1.75
        : obstacle.moduleId === "ramp-large" || kind === "large-ramp"
          ? 2.65
          : 3.8;
    let visualSectionCount = 1;

    if (rhythmRatios) {
      const sectionLengthRatio = obstacle.moduleId === "jump-double" ? 0.32 : 0.23;
      const sectionLength = depth * sectionLengthRatio;
      const campaignScale = obstacle.moduleId === undefined
        ? 1.1 + (obstacle.intensity ?? 0.5) * 0.5
        : 1;
      const sectionHeights = obstacle.moduleId === "jump-double"
        ? [1.45, 1.45]
        : [0.9, 1.18, 1.46].map((sectionHeight) => sectionHeight * campaignScale);
      const ramp = new THREE.Mesh(
        createMergedObstacleProfileGeometry(
          visualWidth,
          rhythmRatios.map((ratio, index) => ({
            profile: [
              [-sectionLength / 2, 0],
              [0, sectionHeights[index] ?? sectionHeights[0] ?? 1],
              [sectionLength / 2, 0],
            ] as readonly ObstacleProfilePoint[],
            offsetZ: -ratio * depth,
          })),
        ),
        materials.wood,
      );
      ramp.geometry.name = obstacle.moduleId === "jump-double"
        ? "double-jump-two-section-profile"
        : "jump-chain-three-section-profile";
      const bands = new THREE.InstancedMesh(
        new THREE.BoxGeometry(visualWidth * 0.78, 0.065, 0.13),
        materials.warning,
        rhythmRatios.length,
      );
      const bandMatrix = new THREE.Matrix4();
      for (const [index, ratio] of rhythmRatios.entries()) {
        bandMatrix.makeTranslation(
          0,
          (sectionHeights[index] ?? 1) + 0.07,
          -ratio * depth,
        );
        bands.setMatrixAt(index, bandMatrix);
      }
      group.add(ramp, bands);
      visualSectionCount = rhythmRatios.length;
    } else if (obstacle.moduleId === "ramp-tabletop") {
      height = 1.55;
      const ramp = new THREE.Mesh(
        createObstacleProfileGeometry(visualWidth, [
          [-depth / 2, 0],
          [-depth * 0.22, height],
          [depth * 0.22, height],
          [depth / 2, 0],
        ]),
        materials.wood,
      );
      const bands = new THREE.InstancedMesh(
        new THREE.BoxGeometry(visualWidth * 0.68, 0.055, 0.18),
        materials.warning,
        2,
      );
      const bandMatrix = new THREE.Matrix4();
      bandMatrix.makeTranslation(0, height + 0.05, -depth * 0.11);
      bands.setMatrixAt(0, bandMatrix);
      bandMatrix.makeTranslation(0, height + 0.05, depth * 0.11);
      bands.setMatrixAt(1, bandMatrix);
      group.add(ramp, bands);
    } else {
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
      group.add(ramp, bands, edgeRails);
    }

    if (obstacle.moduleId === "sky-kicker") {
      const pylons = new THREE.InstancedMesh(
        new THREE.BoxGeometry(0.42, 3.8, 0.58),
        makeMaterial(COOLING, 0.45),
        2,
      );
      const pylonMatrix = new THREE.Matrix4();
      for (const [index, side] of [-1, 1].entries()) {
        pylonMatrix.makeTranslation(side * (visualWidth / 2 + 0.26), 1.9, -depth * 0.3);
        pylons.setMatrixAt(index, pylonMatrix);
      }
      const signalBar = makeBox(visualWidth + 1.25, 0.38, 0.46, materials.warning);
      signalBar.position.set(0, 4.25, -depth * 0.3);
      group.add(pylons, signalBar);
    }

    group.position.set(x, 0.1, z);
    group.name = `${obstacle.moduleId ?? kind}-runtime`;
    group.userData.visualSectionCount = visualSectionCount;
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
      context.font = '900 48px "Ridge Display", sans-serif';
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
    this.addCourseAnchored(group);
  }

  private createTrackEdgeDetail(totalLength: number): void {
    this.createTrackEdgeBlocks(totalLength);
    this.createTrackFence(totalLength);
    this.createTrackGroundClutter(totalLength);
  }

  private createTrackEdgeBlocks(totalLength: number): void {
    if (this.track.authoredCourse !== undefined) {
      this.canvas.dataset.courseEdgeSafetyStyle = "authored-excluded";
      this.canvas.dataset.courseEdgeSafetyBatchCount = "0";
      this.canvas.dataset.courseEdgeSafetyBlockCount = "0";
      return;
    }

    const continuousCanyon = this.track.id === "canyon-kickoff";
    const totalLaps = this.simulation.snapshot.race.totalLaps;
    const blocksPerSide = this.quality === "low" ? 10 : this.quality === "medium" ? 14 : 18;
    const zoneCount = totalLaps + 1;
    const continuousSpan = this.quality === "low" ? 8 : this.quality === "medium" ? 6 : 4;
    const continuousOverlap = this.quality === "low" ? 0.32 : this.quality === "medium" ? 0.28 : 0.25;
    const continuousSegments = Math.ceil(totalLength / continuousSpan);
    const blockCount = continuousCanyon
      ? continuousSegments * 2
      : zoneCount * blocksPerSide * 2;
    const blocks = new THREE.InstancedMesh(
      new THREE.BoxGeometry(1.35, 0.58, 1),
      makeMaterial(0xffffff, 0.74),
      blockCount,
    );
    blocks.name = continuousCanyon
      ? "canyon-continuous-safety-wall"
      : "festival-safety-zones";
    const blockColors = [
      new THREE.Color(0xf3ead4),
      new THREE.Color(0xef604f),
      new THREE.Color(0x1fb7b6),
    ];
    const matrix = new THREE.Matrix4();
    const position = new THREE.Vector3();
    const rotation = new THREE.Quaternion();
    const scale = new THREE.Vector3(1, 1, 1);
    let blockIndex = 0;

    if (continuousCanyon) {
      for (let segment = 0; segment < continuousSegments; segment += 1) {
        const depth = Math.min(continuousSpan, totalLength - segment * continuousSpan);
        const z = 20 - segment * continuousSpan - depth / 2;
        for (const side of [-1, 1]) {
          position.set(side * 7.7, 0.36, z);
          scale.set(1, 1, depth + continuousOverlap);
          matrix.compose(position, rotation, scale);
          blocks.setMatrixAt(blockIndex, matrix);
          blocks.setColorAt(
            blockIndex,
            blockColors[(segment + (side > 0 ? 1 : 0)) % blockColors.length] ?? new THREE.Color(0xf3ead4),
          );
          blockIndex += 1;
        }
      }
    } else {
      for (let zone = 0; zone < zoneCount; zone += 1) {
        const zoneDistance = zone * this.track.courseLength;
        for (let index = 0; index < blocksPerSide; index += 1) {
          for (const side of [-1, 1]) {
            position.set(
              side * 7.35,
              0.36,
              -(zoneDistance + 6 + index * 3.8),
            );
            scale.set(1, 1, 4.05);
            matrix.compose(position, rotation, scale);
            blocks.setMatrixAt(blockIndex, matrix);
            blocks.setColorAt(
              blockIndex,
              blockColors[(index + zone + (side > 0 ? 1 : 0)) % blockColors.length] ?? new THREE.Color(0xf3ead4),
            );
            blockIndex += 1;
          }
        }
      }
    }

    if (blocks.instanceColor) blocks.instanceColor.needsUpdate = true;
    blocks.castShadow = continuousCanyon
      ? this.quality === "high"
      : this.quality !== "low";
    blocks.receiveShadow = true;
    blocks.userData.presentationOnly = true;
    this.canvas.dataset.courseEdgeSafetyStyle = continuousCanyon
      ? "continuous-canyon"
      : "festival-zones";
    this.canvas.dataset.courseEdgeSafetyBatchCount = "1";
    this.canvas.dataset.courseEdgeSafetyBlockCount = String(blockCount);
    this.addSurfaceCourseAnchored(blocks);
  }

  private createTrackFence(totalLength: number): void {
    const matrix = new THREE.Matrix4();
    const fenceStep = this.quality === "low" ? 6 : 5;
    const fenceSegments = Math.ceil(totalLength / fenceStep);
    const fenceMaterial = makeMaterial(0x765039, 0.92);
    const posts = new THREE.InstancedMesh(
      new THREE.CylinderGeometry(0.12, 0.15, 1.9, 6),
      fenceMaterial,
      (fenceSegments + 1) * 2,
    );
    const rails = new THREE.InstancedMesh(
      new THREE.BoxGeometry(0.12, 0.12, fenceStep + 0.8),
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
    this.addCourseAnchored(posts);
    this.addSurfaceCourseAnchored(rails);
  }

  private createTrackGroundClutter(totalLength: number): void {
    const matrix = new THREE.Matrix4();
    const minimumTuftCount = this.quality === "low" ? 64 : this.quality === "medium" ? 104 : 144;
    const maximumTuftCount = this.quality === "low" ? 96 : this.quality === "medium" ? 192 : 320;
    const tuftSpacing = this.quality === "low" ? 34 : this.quality === "medium" ? 17 : 10;
    const tuftCount = Math.min(
      maximumTuftCount,
      Math.max(minimumTuftCount, Math.ceil(totalLength / tuftSpacing)),
    );
    const tufts = new THREE.InstancedMesh(
      new THREE.ConeGeometry(0.16, 0.58, 5),
      makeMaterial(new THREE.Color(this.track.palette.grass).offsetHSL(0.015, 0.06, -0.09).getHex(), 0.98),
      tuftCount,
    );
      const tuftRandom = seededRandom(this.track.order * 99_991);
      for (let index = 0; index < tuftCount; index += 1) {
        const side = index % 2 === 0 ? -1 : 1;
        const scale = 0.55 + tuftRandom() * 0.85;
        const x = side * (12.2 + tuftRandom() * 3);
        matrix.compose(
          new THREE.Vector3(
            x,
            this.sceneryElevation(x) + 0.24 * scale,
            18 - tuftRandom() * Math.max(40, totalLength - 20),
        ),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(0, tuftRandom() * Math.PI, 0)),
        new THREE.Vector3(scale, scale, scale),
      );
      tufts.setMatrixAt(index, matrix);
    }
    tufts.castShadow = this.quality === "high";

    const minimumPebbleCount = this.quality === "low" ? 44 : this.quality === "medium" ? 70 : 96;
    const maximumPebbleCount = this.quality === "low" ? 72 : this.quality === "medium" ? 144 : 220;
    const pebbleSpacing = this.quality === "low" ? 46 : this.quality === "medium" ? 25 : 16;
    const pebbleCount = Math.min(
      maximumPebbleCount,
      Math.max(minimumPebbleCount, Math.ceil(totalLength / pebbleSpacing)),
    );
    const pebbles = new THREE.InstancedMesh(
      new THREE.DodecahedronGeometry(0.24, 0),
      makeMaterial(this.track.palette.rock, 0.94),
      pebbleCount,
    );
    const pebbleRandom = seededRandom(this.track.order * 70_771);
      for (let index = 0; index < pebbleCount; index += 1) {
        const side = index % 2 === 0 ? -1 : 1;
        const scale = 0.45 + pebbleRandom() * 1.25;
        const x = side * (12.15 + pebbleRandom() * 3.05);
        matrix.compose(
          new THREE.Vector3(
            x,
            this.sceneryElevation(x) + 0.1 * scale,
            16 - pebbleRandom() * Math.max(40, totalLength - 20),
        ),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(pebbleRandom(), pebbleRandom() * Math.PI, 0)),
        new THREE.Vector3(scale * 1.4, scale * 0.72, scale),
      );
      pebbles.setMatrixAt(index, matrix);
    }
    pebbles.castShadow = this.quality === "high";
    this.canvas.dataset.groundClutterStyle = "length-bounded-instanced";
    this.canvas.dataset.groundTuftCount = String(tuftCount);
    this.canvas.dataset.groundPebbleCount = String(pebbleCount);
    this.addCourseAnchored(tufts, pebbles);
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
    this.canvas.dataset.sceneryTreeCount = String(treeCount);
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
      const x = this.track.id === "pine-run"
        ? side * (9.8 + ((index * 37) % 7))
        : side * (11.2 + ((index * 37) % 12));
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
    this.addCourseAnchored(foliage, upperFoliage, trunks);

    const rockCount = this.quality === "low" ? 32 : this.quality === "medium" ? 50 : 68;
    this.canvas.dataset.sceneryRockCount = String(rockCount);
    const rocks = new THREE.InstancedMesh(new THREE.DodecahedronGeometry(0.85, 0), makeMaterial(this.track.palette.rock), rockCount);
    for (let index = 0; index < rockCount; index += 1) {
      const side = index % 2 === 0 ? -1 : 1;
      const z = -35 - (index / rockCount) * totalLength;
      const x = side * (12 + ((index * 29) % 9));
      const scale = 0.58 + ((index * 11) % 9) * 0.12;
      matrix.compose(
        new THREE.Vector3(x, this.sceneryElevation(x) + 0.38 * scale, z),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(0, index * 0.7, 0)),
        new THREE.Vector3(scale * 1.5, scale, scale),
      );
      rocks.setMatrixAt(index, matrix);
    }
    rocks.castShadow = this.quality !== "low";
    this.addCourseAnchored(rocks);

    if (this.track.id === "canyon-kickoff") {
      const baseMesaCount = this.quality === "low" ? 18 : this.quality === "medium" ? 26 : 34;
      const mesaCount = Math.max(4, Math.round(baseMesaCount * this.visualProfile.mesaDensity));
      const mesaMaterial = makeMaterial(this.track.palette.rock, 0.96);
      const capMaterial = makeMaterial(new THREE.Color(this.track.palette.rock).offsetHSL(0.01, 0.02, 0.08).getHex(), 0.94);
      const mesas = new THREE.InstancedMesh(new THREE.CylinderGeometry(2.7, 4.1, 6.5, 7), mesaMaterial, mesaCount);
      const mesaCaps = new THREE.InstancedMesh(new THREE.CylinderGeometry(2.55, 2.85, 1.1, 7), capMaterial, mesaCount);
      for (let index = 0; index < mesaCount; index += 1) {
        const side = index % 2 === 0 ? -1 : 1;
        const z = -15 - (index / mesaCount) * totalLength;
        const x = side * (18.5 + ((index * 19) % 13));
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
      this.addCourseAnchored(mesas, mesaCaps);
    }
  }

  private createSkyDecor(totalLength: number): void {
    const cloudGroupCount = this.quality === "low" ? 8 : this.quality === "medium" ? 12 : 16;
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
    const waterMaterial = new THREE.MeshStandardMaterial({
      color: 0x22a9cc,
      roughness: 0.22,
      metalness: 0.08,
    });
    const water = new THREE.Mesh(
      createCoastlineWaterGeometry(
        this.courseRoute,
        -30,
        totalLength - 30,
        14.2,
        90,
        0.012,
      ),
      waterMaterial,
    );
    water.name = "coastline-course-water";
    water.castShadow = false;
    const boardwalk = new THREE.Mesh(
      createCourseRibbonGeometry(this.courseRoute, {
        startProgress: -30,
        endProgress: totalLength - 30,
        left: 10.15,
        right: 12.65,
        yOffset: 0.07,
        segmentLength: 4,
      }),
      makeMaterial(0xb98252, 0.9),
    );
    boardwalk.name = "coastline-course-boardwalk";
    boardwalk.receiveShadow = true;
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
      const x = 13.2 + (index % 2) * 2.8;
      const z = -38 - (index / hutCount) * totalLength;
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
    this.scene.add(water, boardwalk);
    this.addCourseAnchored(huts, hutRoofs);
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
        const x = side * (12 + (index % 4) * 1.7);
        const terraceLift = this.sceneryElevation(x);
        matrix.compose(
          new THREE.Vector3(x, terraceLift + 3.55, -34 - (index / stackCount) * totalLength),
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
      const furnacePanels = new THREE.InstancedMesh(
        new THREE.BoxGeometry(0.16, 1.35, 2.1),
        new THREE.MeshStandardMaterial({
          color: 0xff7131,
          emissive: 0xc92d0c,
          emissiveIntensity: 1.35,
          roughness: 0.42,
          metalness: 0.08,
          flatShading: true,
        }),
        buildingCount,
      );
      for (let index = 0; index < buildingCount; index += 1) {
        const side = index % 2 === 0 ? -1 : 1;
        const x = side * (16 + (index % 3) * 2.8);
        const z = -26 - (index / buildingCount) * totalLength;
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
        matrix.compose(
          new THREE.Vector3(x - side * 3.75 * scale, terraceLift + 1.55 * scale, z),
          new THREE.Quaternion().setFromEuler(
            new THREE.Euler(0, Math.PI / 4 + side * 0.05, 0),
          ),
          new THREE.Vector3(scale, scale, scale),
        );
        furnacePanels.setMatrixAt(index, matrix);
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
        const x = side * (12 + (index % 4) * 1.7);
        const terraceLift = this.sceneryElevation(x);
        matrix.compose(
          new THREE.Vector3(x, terraceLift + 8.2 + (index % 3) * 1.2, -34 - (index / smokeCount) * totalLength),
          new THREE.Quaternion(),
          new THREE.Vector3(scale * 1.2, scale, scale),
        );
        smoke.setMatrixAt(index, matrix);
      }
      const gantryCount = this.quality === "low" ? 4 : 7;
      const gantryLegs = new THREE.InstancedMesh(
        new THREE.BoxGeometry(0.42, 6.2, 0.5),
        new THREE.MeshStandardMaterial({ color: 0x34434a, roughness: 0.52, metalness: 0.42, flatShading: true }),
        gantryCount * 2,
      );
      const gantryBars = new THREE.InstancedMesh(
        new THREE.BoxGeometry(16.2, 0.5, 0.62),
        makeMaterial(0xffffff, 0.58),
        gantryCount,
      );
      const fallbackGantryColor = new THREE.Color(COOLING);
      const gantryColors = [fallbackGantryColor, new THREE.Color(0xe56f37)];
      for (let index = 0; index < gantryCount; index += 1) {
        const z = -52 - index * Math.max(190, totalLength / gantryCount);
        for (const side of [-1, 1]) {
          matrix.makeTranslation(side * 7.85, 3.1, z);
          gantryLegs.setMatrixAt(index * 2 + (side > 0 ? 1 : 0), matrix);
        }
        matrix.makeTranslation(0, 6.1, z);
        gantryBars.setMatrixAt(index, matrix);
        gantryBars.setColorAt(
          index,
          gantryColors[index % gantryColors.length] ?? fallbackGantryColor,
        );
      }
      gantryLegs.castShadow = this.quality !== "low";
      gantryBars.castShadow = this.quality !== "low";
      furnacePanels.castShadow = false;
      furnacePanels.receiveShadow = false;
      furnacePanels.name = "foundry-opaque-furnace-panels";
      furnacePanels.userData.presentationOnly = true;
      gantryBars.name = "foundry-cyan-orange-gantry-bars";
      if (gantryBars.instanceColor) gantryBars.instanceColor.needsUpdate = true;
      this.canvas.dataset.foundryGantryStyle = "cyan-orange-safety";
      this.canvas.dataset.foundryGantryBarCount = String(gantryCount);
      this.canvas.dataset.foundryFurnacePanelStyle = "opaque-emissive";
      this.canvas.dataset.foundryFurnacePanelCount = String(buildingCount);
      this.canvas.dataset.foundryThemeBatchCount = "7";
      this.addCourseAnchored(
        stacks,
        buildings,
        roofs,
        furnacePanels,
        smoke,
        gantryLegs,
        gantryBars,
      );
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
        const x = side * (14 + (index % 5) * 2.4);
        const z = -34 - (index / peakCount) * totalLength;
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
      const finaleOffsets = this.quality === "low"
        ? [18]
        : this.quality === "medium"
          ? [-18, 92]
          : [-32, 58, 142];
      const totalLaps = this.simulation.snapshot.race.totalLaps;
      const finaleAnchor = this.track.obstacles.find((obstacle) => obstacle.kind === "super-jump")
        ?.distance ?? this.track.courseLength - 195;
      const finaleEquipmentCount = totalLaps * finaleOffsets.length * 2;
      const finaleEquipment = new THREE.InstancedMesh(
        createSummitFinaleEquipmentGeometry(),
        new THREE.MeshStandardMaterial({
          color: 0xffffff,
          vertexColors: true,
          roughness: 0.58,
          metalness: 0.18,
          flatShading: true,
        }),
        finaleEquipmentCount,
      );
      let equipmentIndex = 0;
      for (let lap = 0; lap < totalLaps; lap += 1) {
        for (const [station, offset] of finaleOffsets.entries()) {
          const distance = lap * this.track.courseLength + finaleAnchor + offset;
          for (const side of [-1, 1]) {
            const x = side * (13.1 + station * 0.4);
            matrix.compose(
              new THREE.Vector3(x, this.sceneryElevation(x) + 0.03, -distance),
              new THREE.Quaternion().setFromEuler(new THREE.Euler(0, side * -0.18, 0)),
              new THREE.Vector3(1, 1, 1),
            );
            finaleEquipment.setMatrixAt(equipmentIndex, matrix);
            equipmentIndex += 1;
          }
        }
      }
      rockPeaks.castShadow = this.quality !== "low";
      finaleEquipment.name = "summit-bilateral-finale-equipment";
      finaleEquipment.castShadow = false;
      finaleEquipment.receiveShadow = true;
      finaleEquipment.userData.presentationOnly = true;
      this.canvas.dataset.summitFinaleEquipmentStyle = "bilateral-yellow-service";
      this.canvas.dataset.summitFinaleEquipmentBatchCount = "1";
      this.canvas.dataset.summitFinaleEquipmentCount = String(finaleEquipmentCount);
      this.canvas.dataset.summitFinaleStationsPerLap = String(finaleOffsets.length * 2);
      this.addCourseAnchored(rockPeaks, snowPeaks, finaleEquipment);
  }

  private createPineThemeDecor(totalLength: number): void {
    const matrix = new THREE.Matrix4();
    const totalLaps = this.simulation.snapshot.race.totalLaps;
    const logCount = this.quality === "low" ? 18 : 32;
    const rootsPerLane = this.quality === "low" ? 1 : this.quality === "medium" ? 2 : 3;
    const pineBumps = this.track.obstacles.filter((obstacle) => obstacle.kind === "bump");
    const bumpLaneCount = pineBumps.reduce((count, obstacle) => count + obstacle.lanes.length, 0);
    const rootCount = bumpLaneCount * rootsPerLane * totalLaps;
    const markerCount = this.quality === "low" ? 10 : this.quality === "medium" ? 16 : 24;
    const logs = new THREE.InstancedMesh(
      new THREE.CylinderGeometry(0.42, 0.42, 4.8, 8),
      makeMaterial(0xffffff, 0.9),
      logCount + rootCount + markerCount,
    );
    const timberColor = new THREE.Color(0x855532);
    const fallbackRootColor = new THREE.Color(0x65402b);
    const rootColors = [fallbackRootColor, new THREE.Color(0x7b4c30)];
    const horizontalRotation = new THREE.Quaternion().setFromEuler(
      new THREE.Euler(0, 0, Math.PI / 2),
    );
    let logIndex = 0;
    for (let index = 0; index < logCount; index += 1) {
      const side = index % 2 === 0 ? -1 : 1;
      const x = side * (11 + (index % 3) * 1.2);
      const terraceLift = this.sceneryElevation(x);
      matrix.compose(
        new THREE.Vector3(x, terraceLift + 0.45 + (index % 2) * 0.5, -32 - (index / logCount) * totalLength),
        horizontalRotation,
        new THREE.Vector3(1, 1, 1),
      );
      logs.setMatrixAt(logIndex, matrix);
      logs.setColorAt(logIndex, timberColor);
      logIndex += 1;
    }
    for (let lap = 0; lap < totalLaps; lap += 1) {
      for (const obstacle of pineBumps) {
        for (const lane of obstacle.lanes) {
          for (let root = 0; root < rootsPerLane; root += 1) {
            const rootOffset = (root - (rootsPerLane - 1) / 2) * 0.68;
            matrix.compose(
              new THREE.Vector3(
                LANE_POSITIONS[lane],
                0.39,
                -(lap * this.track.courseLength + obstacle.distance) + rootOffset,
              ),
              new THREE.Quaternion().setFromEuler(
                new THREE.Euler(0, (root - 1) * 0.055, Math.PI / 2),
              ),
              new THREE.Vector3(0.22, 0.5, 0.22),
            );
            logs.setMatrixAt(logIndex, matrix);
            logs.setColorAt(
              logIndex,
              rootColors[(root + lane + lap) % rootColors.length] ?? fallbackRootColor,
            );
            logIndex += 1;
          }
        }
      }
    }
    const markerPlacements: Array<{ x: number; elevation: number; z: number }> = [];
    for (let marker = 0; marker < markerCount; marker += 1) {
      const side = marker % 2 === 0 ? -1 : 1;
      const x = side * (10.15 + (marker % 3) * 0.14);
      const z = -28 - ((marker + 0.5) / markerCount) * Math.max(40, totalLength - 56);
      const elevation = this.sceneryElevation(x);
      markerPlacements.push({ x, elevation, z });
      matrix.compose(
        new THREE.Vector3(x, elevation + 1.01, z),
        new THREE.Quaternion(),
        new THREE.Vector3(0.16, 0.42, 0.16),
      );
      logs.setMatrixAt(logIndex, matrix);
      logs.setColorAt(logIndex, timberColor);
      logIndex += 1;
    }
    logs.instanceMatrix.needsUpdate = true;
    if (logs.instanceColor) logs.instanceColor.needsUpdate = true;
    logs.name = "pine-logs-bump-roots-marker-posts";
    logs.userData.presentationOnly = true;

    const cabinCount = this.quality === "low" ? 8 : 14;
    const cabins = new THREE.InstancedMesh(
      new THREE.BoxGeometry(3.6, 2.1, 3.3),
      makeMaterial(0x825034, 0.94),
      cabinCount,
    );
    const cabinRoofs = new THREE.InstancedMesh(
      new THREE.ConeGeometry(3.1, 1.55, 4),
      makeMaterial(0xffffff, 0.92),
      cabinCount + markerCount,
    );
    const cabinRoofColor = new THREE.Color(0x325447);
    const trailMarkerColor = new THREE.Color(0xcc4038);
    for (let index = 0; index < cabinCount; index += 1) {
      const side = index % 2 === 0 ? -1 : 1;
      const x = side * (14 + (index % 3) * 2.4);
      const z = -48 - (index / cabinCount) * totalLength;
      const terraceLift = this.sceneryElevation(x);
      matrix.makeTranslation(x, terraceLift + 1.05, z);
      cabins.setMatrixAt(index, matrix);
      matrix.compose(
        new THREE.Vector3(x, terraceLift + 2.75, z),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(0, Math.PI / 4, 0)),
        new THREE.Vector3(1, 1, 1),
      );
      cabinRoofs.setMatrixAt(index, matrix);
      cabinRoofs.setColorAt(index, cabinRoofColor);
    }
    for (const [marker, placement] of markerPlacements.entries()) {
      matrix.compose(
        new THREE.Vector3(placement.x, placement.elevation + 2.15, placement.z),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(0, Math.PI / 4, 0)),
        new THREE.Vector3(0.13, 0.26, 0.13),
      );
      cabinRoofs.setMatrixAt(cabinCount + marker, matrix);
      cabinRoofs.setColorAt(cabinCount + marker, trailMarkerColor);
    }
    if (cabinRoofs.instanceColor) cabinRoofs.instanceColor.needsUpdate = true;
    cabinRoofs.name = "pine-cabin-roofs-and-red-trail-markers";
    cabins.castShadow = this.quality !== "low";
    cabinRoofs.castShadow = this.quality !== "low";
    this.canvas.dataset.pineRootStyle = "bump-aligned-batched";
    this.canvas.dataset.pineRootCount = String(rootCount);
    this.canvas.dataset.pineTrailMarkerStyle = "red-shoulder";
    this.canvas.dataset.pineTrailMarkerCount = String(markerCount);
    this.canvas.dataset.pineThemeBatchCount = "3";
    this.addCourseAnchored(logs, cabins, cabinRoofs);
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
    this.addCourseAnchored(arches);
    const cactusCount = this.quality === "low" ? 14 : 24;
    const cacti = new THREE.InstancedMesh(
      createCanyonCactusGeometry(),
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
    this.canvas.dataset.canyonCactusStyle = "branched-saguaro";
    this.canvas.dataset.canyonCactusBatchCount = "1";
    this.canvas.dataset.canyonCactusInstanceCount = String(cactusCount);
    this.addCourseAnchored(cacti);
  }

  private createFestivalDecor(totalLength: number): void {
    const timber = makeMaterial(0x7f4e2e);
    const roofMaterial = makeMaterial(0x159ca2);
    this.createFestivalStands(timber, roofMaterial);
    this.createFestivalCrowd();
    this.createFestivalServiceClusters();
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
    // Editor courses inherit Canyon's palette/id, so authored-course exclusion
    // keeps this campaign venue treatment out of custom curves and banks.
    const handcraftedCanyon = this.track.id === "canyon-kickoff"
      && this.track.authoredCourse === undefined;
    const spacing = handcraftedCanyon
      ? this.quality === "low" ? 230 : this.quality === "medium" ? 150 : 110
      : this.quality === "low" ? 250 : this.quality === "medium" ? 180 : 135;
    const routePocketCount = Math.max(4, Math.floor((totalLength - 150) / spacing));
    const random = seededRandom(this.track.order * 377_911);
    const routePockets = Array.from({ length: routePocketCount }, (_, pocket) => {
      const side: -1 | 1 = (pocket + this.track.order) % 2 === 0 ? -1 : 1;
      return {
        side,
        x: side * (11.85 + random() * 0.45),
        z: -125 - pocket * spacing - (random() - 0.5) * 34,
        rotationY: side * (0.04 + random() * 0.035),
        elevatedWatchtower: false,
      };
    });
    const canyonCoolingGates = handcraftedCanyon
      ? this.track.obstacles.filter((obstacle) => obstacle.kind === "cooling-gate").slice(0, 2)
      : [];
    const coolingGatePockets = canyonCoolingGates.flatMap((obstacle, gateIndex) => (
      ([-1, 1] as const).map((side) => ({
        side,
        x: side * (12.35 + gateIndex * 0.2),
        z: -(obstacle.distance + 12),
        rotationY: side * 0.06,
        elevatedWatchtower: true,
      }))
    ));
    const separatedRoutePockets = handcraftedCanyon
      ? routePockets.filter((routePocket) => coolingGatePockets.every((gatePocket) => (
        Math.hypot(routePocket.x - gatePocket.x, routePocket.z - gatePocket.z) >= 5.6
      )))
      : routePockets;
    const pocketPlacements = [...separatedRoutePockets, ...coolingGatePockets];
    const pocketCount = pocketPlacements.length;
    const peoplePerPocket = handcraftedCanyon
      ? this.quality === "low" ? 4 : this.quality === "medium" ? 8 : 10
      : this.quality === "low" ? 4 : 6;
    const watchtowerCount = coolingGatePockets.length;
    const watchtowerSpectatorsPerPocket = handcraftedCanyon
      ? this.quality === "low" ? 2 : this.quality === "medium" ? 3 : 4
      : 0;
    // Canyon's accepted concepts use raised, track-facing grandstands. Reuse
    // the existing platform batch for outward-rising rows without changing
    // other venues or editor-authored course presentation.
    const tierRowsPerPocket = handcraftedCanyon ? Math.ceil(peoplePerPocket / 3) : 0;
    const tierCount = pocketCount * tierRowsPerPocket;
    const platforms = new THREE.InstancedMesh(
      new THREE.BoxGeometry(1, 1, 1),
      makeMaterial(0x875235, 0.9),
      pocketCount + tierCount,
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
    const matrix = new THREE.Matrix4();
    const rotation = new THREE.Quaternion();
    const tierPosition = new THREE.Vector3();
    const personPosition = new THREE.Vector3();
    const postPosition = new THREE.Vector3();
    let postIndex = 0;
    let personIndex = 0;
    let platformIndex = 0;

    for (const [pocket, placement] of pocketPlacements.entries()) {
      const { side, x, z } = placement;
      const elevatedWatchtower = placement.elevatedWatchtower;
      const elevation = this.sceneryElevation(x);
      rotation.setFromEuler(new THREE.Euler(0, placement.rotationY, 0));
      matrix.compose(
        new THREE.Vector3(x, elevation + (elevatedWatchtower ? 2.72 : 0.17), z),
        rotation,
        new THREE.Vector3(4.3, 0.34, 4.5),
      );
      platforms.setMatrixAt(platformIndex, matrix);
      platformIndex += 1;
      for (let row = 0; row < tierRowsPerPocket; row += 1) {
        const tierHeight = (row + 1) * 0.18;
        const outwardOffset = 0.42 + row * 0.46;
        tierPosition
          .set(side * outwardOffset, 0, 0)
          .applyQuaternion(rotation);
        tierPosition.x += x;
        tierPosition.y += elevation + 0.34 + tierHeight / 2;
        tierPosition.z += z;
        matrix.compose(
          tierPosition,
          rotation,
          new THREE.Vector3(0.54, tierHeight, 3.35),
        );
        platforms.setMatrixAt(platformIndex, matrix);
        platformIndex += 1;
      }
      matrix.compose(
        new THREE.Vector3(x, elevation + (elevatedWatchtower ? 5.55 : 4.05), z),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(0, Math.PI / 4, 0)),
        new THREE.Vector3(1, 1, 1),
      );
      canopies.setMatrixAt(pocket, matrix);
      canopies.setColorAt(
        pocket,
        elevatedWatchtower
          ? canopyColors[side < 0 ? 0 : 1] ?? new THREE.Color(0x18aaa8)
          : canopyColors[pocket % canopyColors.length] ?? new THREE.Color(0x18aaa8),
      );

      for (const xOffset of [-1.65, 1.65]) {
        for (const zOffset of [-1.65, 1.65]) {
          if (elevatedWatchtower) {
            postPosition.set(xOffset, 0, zOffset).applyQuaternion(rotation);
            matrix.compose(
              new THREE.Vector3(
                x + postPosition.x,
                elevation + 2.55,
                z + postPosition.z,
              ),
              rotation,
              new THREE.Vector3(1, 5.1 / 3.7, 1),
            );
          } else {
            matrix.makeTranslation(x + xOffset, elevation + 1.95, z + zOffset);
          }
          posts.setMatrixAt(postIndex, matrix);
          postIndex += 1;
        }
      }

      for (let person = 0; person < peoplePerPocket; person += 1) {
        const onWatchtowerDeck = elevatedWatchtower
          && person < watchtowerSpectatorsPerPocket;
        const tierPerson = onWatchtowerDeck
          ? person
          : person - (elevatedWatchtower ? watchtowerSpectatorsPerPocket : 0);
        const column = tierPerson % 3;
        const row = Math.floor(tierPerson / 3);
        const columnOffset = -1.05 + column * 1.05;
        let bodyY: number;
        if (onWatchtowerDeck) {
          const deckColumn = person % 2;
          const deckRow = Math.floor(person / 2);
          personPosition
            .set((deckColumn - 0.5) * 1.25, 0, (deckRow - 0.5) * 0.9)
            .applyQuaternion(rotation);
          personPosition.x += x;
          personPosition.z += z;
          bodyY = elevation + 3.26;
        } else if (handcraftedCanyon) {
          personPosition
            .set(side * (0.42 + row * 0.46), 0, columnOffset)
            .applyQuaternion(rotation);
          personPosition.x += x;
          personPosition.z += z;
          bodyY = elevation + 0.89 + row * 0.18;
        } else {
          personPosition.set(x - side * (0.55 + row * 0.55), 0, z + columnOffset);
          bodyY = elevation + 0.82;
        }
        matrix.makeTranslation(personPosition.x, bodyY, personPosition.z);
        people.setMatrixAt(personIndex, matrix);
        people.setColorAt(personIndex, peopleColors[(person + pocket) % peopleColors.length] ?? new THREE.Color(0xf0a33a));
        matrix.makeTranslation(personPosition.x, bodyY + 0.47, personPosition.z);
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
    this.canvas.dataset.festivalPocketCount = String(pocketCount);
    this.canvas.dataset.festivalPocketStyle = handcraftedCanyon ? "tiered-canyon" : "flat";
    this.canvas.dataset.festivalPocketTierCount = String(tierCount);
    this.canvas.dataset.festivalPocketTierRows = String(tierRowsPerPocket);
    this.canvas.dataset.coolingGateVenuePocketCount = String(coolingGatePockets.length);
    this.canvas.dataset.coolingGateVenueStyle = coolingGatePockets.length > 0
      ? "bilateral"
      : "alternating-only";
    this.canvas.dataset.coolingGateWatchtowerCount = String(watchtowerCount);
    this.canvas.dataset.coolingGateWatchtowerStyle = watchtowerCount > 0
      ? "staffed-elevated"
      : "none";
    this.canvas.dataset.coolingGateWatchtowerSpectatorCount = String(
      watchtowerCount * watchtowerSpectatorsPerPocket,
    );
    this.addCourseAnchored(platforms, canopies, posts, people, heads);
  }

  private createFestivalStands(
    timber: THREE.MeshStandardMaterial,
    roofMaterial: THREE.MeshStandardMaterial,
  ): void {
    const matrix = new THREE.Matrix4();
    const rowCount = this.quality === "low" ? 4 : this.quality === "medium" ? 5 : 6;
    const standCenter = 19.4;
    const stands = new THREE.InstancedMesh(new THREE.BoxGeometry(7.8, 0.5, 5.2), timber, 2);
    const standRoofs = new THREE.InstancedMesh(new THREE.BoxGeometry(8.4, 0.3, 5.8), roofMaterial, 2);
    const bleachers = new THREE.InstancedMesh(
      new THREE.BoxGeometry(7.2, 0.34, 0.8),
      timber,
      rowCount * 2,
    );
    const standPosts = new THREE.InstancedMesh(new THREE.BoxGeometry(0.2, 4.7, 0.2), timber, 8);
    let bleacherIndex = 0;
    let standPostIndex = 0;
    for (const side of [-1, 1]) {
      const standIndex = side < 0 ? 0 : 1;
      const x = side * standCenter;
      const elevation = this.sceneryElevation(x);
      matrix.makeTranslation(x, elevation + 0.28, -18.8);
      stands.setMatrixAt(standIndex, matrix);
      matrix.makeTranslation(x, elevation + 5.1, -18.8);
      standRoofs.setMatrixAt(standIndex, matrix);
      standRoofs.setColorAt(standIndex, side < 0 ? new THREE.Color(0x159ca2) : new THREE.Color(0xef6254));
      for (let row = 0; row < rowCount; row += 1) {
        matrix.makeTranslation(x, elevation + 0.55 + row * 0.32, -16.5 - row * 0.78);
        bleachers.setMatrixAt(bleacherIndex, matrix);
        bleacherIndex += 1;
      }
      for (const xOffset of [-3.7, 3.7]) {
        for (const zOffset of [-2.35, 2.35]) {
          matrix.makeTranslation(x + xOffset, elevation + 2.45, -18.8 + zOffset);
          standPosts.setMatrixAt(standPostIndex, matrix);
          standPostIndex += 1;
        }
      }
    }
    stands.castShadow = this.quality !== "low";
    standRoofs.castShadow = this.quality !== "low";
    bleachers.castShadow = this.quality !== "low";
    standPosts.castShadow = this.quality !== "low";
    this.canvas.dataset.festivalStartStandStyle = "broadened-tiered";
    this.canvas.dataset.festivalStartStandCount = "2";
    this.canvas.dataset.festivalStartStandRowCount = String(rowCount);
    this.canvas.dataset.festivalStartBatchCount = "6";
    this.addCourseAnchored(stands, standRoofs, bleachers, standPosts);
  }

  private createFestivalCrowd(): void {
    const matrix = new THREE.Matrix4();
    const rowCount = this.quality === "low" ? 4 : this.quality === "medium" ? 5 : 6;
    const columnCount = this.quality === "low" ? 7 : this.quality === "medium" ? 9 : 11;
    const peopleCount = rowCount * columnCount * 2;
    const people = new THREE.InstancedMesh(
      new THREE.CapsuleGeometry(0.18, 0.5, 3, 6),
      makeMaterial(0xffffff),
      peopleCount,
    );
    const heads = new THREE.InstancedMesh(
      new THREE.SphereGeometry(0.19, 7, 5),
      makeMaterial(0xffffff, 0.86),
      peopleCount,
    );
    const peopleColors = [new THREE.Color(0xf0a33a), new THREE.Color(0x20b8b5), new THREE.Color(0xe65f53), new THREE.Color(0x466fba), new THREE.Color(0xf0dfc0)];
    const skinColors = [new THREE.Color(0xf2c18f), new THREE.Color(0xb87855), new THREE.Color(0x7f4c38), new THREE.Color(0xe0a877)];
    for (let index = 0; index < peopleCount; index += 1) {
      const localIndex = index % (rowCount * columnCount);
      const side = index < rowCount * columnCount ? -1 : 1;
      const column = localIndex % columnCount;
      const row = Math.floor(localIndex / columnCount);
      const standX = side * 19.4;
      const elevation = this.sceneryElevation(standX);
      const x = standX - 3.2 + column * (6.4 / Math.max(1, columnCount - 1));
      const z = -16.5 - row * 0.78;
      const bodyY = elevation + 1.03 + row * 0.32;
      matrix.makeTranslation(x, bodyY, z);
      people.setMatrixAt(index, matrix);
      people.setColorAt(index, peopleColors[index % peopleColors.length] ?? new THREE.Color(0xf0a33a));
      matrix.makeTranslation(x, bodyY + 0.53, z);
      heads.setMatrixAt(index, matrix);
      heads.setColorAt(index, skinColors[index % skinColors.length] ?? new THREE.Color(0xe0a877));
    }
    people.castShadow = this.quality === "high";
    heads.castShadow = this.quality === "high";
    this.canvas.dataset.festivalStartCrowdStyle = "broadened-tiered";
    this.canvas.dataset.festivalStartCrowdCount = String(peopleCount);
    this.addCourseAnchored(people, heads);
  }

  private createFestivalServiceClusters(): void {
    const clusterCount = this.quality === "low" ? 2 : this.quality === "medium" ? 4 : 6;
    const clusters = new THREE.InstancedMesh(
      createFestivalServiceClusterGeometry(),
      new THREE.MeshStandardMaterial({
        color: 0xffffff,
        vertexColors: true,
        roughness: 0.72,
        metalness: 0.06,
        flatShading: true,
      }),
      clusterCount,
    );
    const placements = [
      { x: -17, z: -27, rotationY: 0.18 },
      { x: 17, z: -31, rotationY: -0.18 },
      { x: -17.4, z: -59, rotationY: 0.24 },
      { x: 17.4, z: -63, rotationY: -0.24 },
      { x: -16.9, z: -92, rotationY: 0.14 },
      { x: 16.9, z: -96, rotationY: -0.14 },
    ] as const;
    const matrix = new THREE.Matrix4();
    for (let index = 0; index < clusterCount; index += 1) {
      const placement = placements[index];
      if (!placement) continue;
      matrix.compose(
        new THREE.Vector3(
          placement.x,
          this.sceneryElevation(placement.x) + 0.03,
          placement.z,
        ),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(0, placement.rotationY, 0)),
        new THREE.Vector3(1, 1, 1),
      );
      clusters.setMatrixAt(index, matrix);
    }
    clusters.name = "festival-service-clusters";
    clusters.castShadow = false;
    clusters.receiveShadow = true;
    clusters.userData.presentationOnly = true;
    this.canvas.dataset.festivalServiceClusterStyle = "tire-crate-can";
    this.canvas.dataset.festivalServiceClusterBatchCount = "1";
    this.canvas.dataset.festivalServiceClusterCount = String(clusterCount);
    this.addCourseAnchored(clusters);
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
    const firstObstacleDistance = this.track.obstacles[0]?.distance ?? 72;
    const secondObstacleDistance = this.track.obstacles[1]?.distance ?? 132;
    const tentPositions = [
      new THREE.Vector3(-17, 0, -14),
      new THREE.Vector3(17, 0, -14),
      new THREE.Vector3(-17.5, 0, -firstObstacleDistance),
      new THREE.Vector3(17.5, 0, -firstObstacleDistance),
      new THREE.Vector3(-17.5, 0, -secondObstacleDistance),
    ];
    let tentPostIndex = 0;
    for (let index = 0; index < tentCount; index += 1) {
      const position = tentPositions[index] ?? new THREE.Vector3(15, 0, -92);
      const elevation = this.sceneryElevation(position.x);
      matrix.compose(
        new THREE.Vector3(position.x, elevation + 3, position.z),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(0, Math.PI / 4, 0)),
        new THREE.Vector3(1, 1, 1),
      );
      tentRoofs.setMatrixAt(index, matrix);
      tentRoofs.setColorAt(index, tentColors[index % tentColors.length] ?? new THREE.Color(0xf4c94c));
      for (const xOffset of [-1.35, 1.35]) {
        for (const zOffset of [-1.35, 1.35]) {
          matrix.makeTranslation(
            position.x + xOffset,
            elevation + 1.15,
            position.z + zOffset,
          );
          tentPosts.setMatrixAt(tentPostIndex, matrix);
          tentPostIndex += 1;
        }
      }
    }
    tentRoofs.castShadow = this.quality !== "low";
    tentPosts.castShadow = this.quality !== "low";
    this.addCourseAnchored(tentRoofs, tentPosts);
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
    this.addCourseAnchored(bannerPoles, ropes, flags);
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
      signContext.font = '900 66px "Ridge Display", sans-serif';
      signContext.textAlign = "center";
      signContext.textBaseline = "middle";
      signContext.fillText("RIVET RIDGE", 256, 92);
      signContext.fillStyle = "#f4ca42";
      signContext.font = '900 42px "Ridge Display", sans-serif';
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
    this.addCourseAnchored(billboards, billboardPosts);
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
    landmark.position.set(15.5, this.sceneryElevation(15.5), -68);
    this.addCourseAnchored(landmark);
  }

  private createAiField(): void {
    if (!(["rival", "mastery"] as RaceMode[]).includes(this.mode)) return;
    for (const [index, entrant] of AI_FIELD.entries()) {
      const group = this.createBike(
        entrant.color,
        entrant.accentColor,
        false,
        entrant.number,
      );
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
    this.canvas.dataset.rivalBikeStyle = "shared-knobby-brake-panel-exhaust";
    this.canvas.dataset.rivalNumberSet = AI_FIELD.map((entrant) => entrant.number).join("-");
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

  private createBike(
    color: number,
    accentColor: number,
    player: boolean,
    riderNumber: string,
  ): THREE.Group {
    const group = new THREE.Group();
    const bodyMaterial = makeMaterial(color, 0.46);
    const accent = makeMaterial(accentColor, 0.5);
    const dark = makeMaterial(0x17212b, 0.72);
    const metal = new THREE.MeshStandardMaterial({ color: 0x7e8990, roughness: 0.35, metalness: 0.65, flatShading: true });
    const wheelMaterial = makeMaterial(0x161719, 0.98);
    const wheelRadius = player ? 0.47 : 0.52;
    const tireGeometry = new THREE.CylinderGeometry(wheelRadius, wheelRadius, 0.25, 14);
    const hubGeometry = new THREE.CylinderGeometry(0.14, 0.14, 0.32, 12);
    const brakeGeometry = new THREE.CylinderGeometry(0.27, 0.27, 0.035, 14);
    const treadGeometry = new THREE.BoxGeometry(0.3, 0.2, 0.1);

    const createFallbackWheel = (name: string, z: number): THREE.Group => {
      const assembly = new THREE.Group();
      assembly.name = name;
      assembly.position.set(0, -0.1, z);
      const tire = new THREE.Mesh(tireGeometry, wheelMaterial);
      tire.rotation.z = Math.PI / 2;
      const hub = new THREE.Mesh(hubGeometry, metal);
      hub.rotation.z = Math.PI / 2;
      const brakeDisc = new THREE.Mesh(brakeGeometry, metal);
      brakeDisc.name = `${name}-brake-disc`;
      brakeDisc.rotation.z = Math.PI / 2;
      brakeDisc.position.x = 0.155;
      const treads = new THREE.InstancedMesh(treadGeometry, wheelMaterial, 12);
      treads.name = `${name}-knobby-treads`;
      const treadMatrix = new THREE.Matrix4();
      const treadRadius = wheelRadius + 0.04;
      for (let index = 0; index < 12; index += 1) {
        const angle = (index / 12) * Math.PI * 2;
        treadMatrix.compose(
          new THREE.Vector3(0, Math.sin(angle) * treadRadius, Math.cos(angle) * treadRadius),
          new THREE.Quaternion().setFromEuler(new THREE.Euler(-angle, 0, 0)),
          new THREE.Vector3(1, 1, 1),
        );
        treads.setMatrixAt(index, treadMatrix);
      }
      treads.instanceMatrix.needsUpdate = true;
      assembly.add(tire, hub, brakeDisc, treads);
      return assembly;
    };
    const frontWheel = createFallbackWheel("fallback-front-wheel-assembly", -0.92);
    const backWheel = createFallbackWheel("fallback-rear-wheel-assembly", 0.92);
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
    const leftPanel = makeBox(0.13, 0.48, 0.86, accent);
    leftPanel.name = "left-side-panel";
    const rightPanel = leftPanel.clone();
    rightPanel.name = "right-side-panel";
    leftPanel.position.set(-0.39, 0.51, 0.12);
    rightPanel.position.set(0.39, 0.51, 0.12);
    leftPanel.rotation.x = -0.08;
    rightPanel.rotation.x = -0.08;
    const exhaust = makeLimbSegment(
      new THREE.Vector3(0.37, 0.35, 0.22),
      new THREE.Vector3(0.45, 0.39, 1.16),
      0.085,
      metal,
    );
    exhaust.name = "rear-right-exhaust";
    const exhaustTip = new THREE.Mesh(
      new THREE.CylinderGeometry(0.11, 0.085, 0.24, 10),
      dark,
    );
    exhaustTip.name = "rear-right-exhaust-tip";
    exhaustTip.position.set(0.45, 0.4, 1.26);
    exhaustTip.rotation.x = Math.PI / 2;
    const bikeDetailParts = [leftPanel, rightPanel, exhaust, exhaustTip];

    const riderBody = player ? bodyMaterial : accent;
    const riderAccent = player ? accent : bodyMaterial;
    const torso = new THREE.Mesh(
      new THREE.CylinderGeometry(0.36, 0.25, 0.62, 8, 1, false),
      riderBody,
    );
    torso.position.set(0, 1.27, 0.1);
    torso.rotation.x = 0.3;
    torso.scale.z = 0.72;
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.15, 0.17, 8), dark);
    neck.position.set(0, 1.59, -0.08);
    neck.rotation.x = 0.3;
    const helmet = new THREE.Mesh(new THREE.IcosahedronGeometry(0.34, 2), riderBody);
    helmet.position.set(0, 1.74, -0.2);
    helmet.scale.set(1, 1.03, 0.94);
    const visor = makeBox(0.42, 0.12, 0.18, dark);
    visor.position.set(0, 1.72, -0.45);
    const helmetPeak = makeBox(0.54, 0.07, 0.27, riderAccent);
    helmetPeak.position.set(0, 1.88, -0.34);
    helmetPeak.rotation.x = -0.16;
    const helmetStripe = makeBox(0.1, 0.51, 0.045, riderAccent);
    helmetStripe.position.set(0, 1.74, 0.125);
    const helmetBand = makeBox(0.55, 0.085, 0.05, riderAccent);
    helmetBand.position.set(0, 1.73, 0.13);

    const leftShoulder = new THREE.Vector3(-0.32, 1.48, 0.01);
    const rightShoulder = new THREE.Vector3(0.32, 1.48, 0.01);
    const leftElbow = new THREE.Vector3(-0.55, 1.3, 0.12);
    const rightElbow = new THREE.Vector3(0.55, 1.3, 0.12);
    const leftGrip = new THREE.Vector3(-0.48, 1.13, -0.58);
    const rightGrip = new THREE.Vector3(0.48, 1.13, -0.58);
    const leftUpperArm = makeLimbSegment(leftShoulder, leftElbow, 0.095, riderAccent);
    const rightUpperArm = makeLimbSegment(rightShoulder, rightElbow, 0.095, riderAccent);
    const leftLowerArm = makeLimbSegment(leftElbow, leftGrip, 0.078, riderBody);
    const rightLowerArm = makeLimbSegment(rightElbow, rightGrip, 0.078, riderBody);
    const backPlate = makeBox(0.54, 0.46, 0.075, player ? bodyMaterial : dark);
    backPlate.position.set(0, 1.31, 0.34);
    backPlate.rotation.x = 0.3;
    const backStripe = makeBox(0.44, 0.08, 0.09, riderAccent);
    backStripe.position.set(0, 1.13, 0.39);
    backStripe.rotation.x = 0.3;
    const numberCanvas = document.createElement("canvas");
    numberCanvas.width = 128;
    numberCanvas.height = 96;
    const numberContext = numberCanvas.getContext("2d");
    if (numberContext) {
      numberContext.font = '900 68px "Ridge Display", sans-serif';
      numberContext.textAlign = "center";
      numberContext.textBaseline = "middle";
      numberContext.strokeStyle = "#061c32";
      numberContext.lineWidth = 8;
      numberContext.lineJoin = "round";
      numberContext.strokeText(riderNumber, 64, 49);
      numberContext.fillStyle = "#f5edda";
      numberContext.fillText(riderNumber, 64, 49);
    }
    const numberTexture = new THREE.CanvasTexture(numberCanvas);
    numberTexture.colorSpace = THREE.SRGBColorSpace;
    this.ownedTextures.push(numberTexture);
    const numberMaterial = new THREE.MeshStandardMaterial({
      map: numberTexture,
      color: 0xffffff,
      roughness: 0.68,
      metalness: 0,
      transparent: true,
      alphaTest: 0.12,
    });
    const numberGeometry = new THREE.PlaneGeometry(0.56, 0.42);
    const jerseyNumber = new THREE.Mesh(numberGeometry, numberMaterial);
    jerseyNumber.name = `jersey-number-${riderNumber}`;
    jerseyNumber.position.set(0, 1.35, 0.52);
    jerseyNumber.rotation.x = 0.3;
    jerseyNumber.scale.x = 0.52 / 0.56;
    const rearNumberPlate = new THREE.Group();
    rearNumberPlate.name = `rear-number-plate-${riderNumber}`;
    const plateBacking = makeBox(0.64, 0.5, 0.08, dark);
    plateBacking.position.set(0, 0.57, 1.1);
    const plateNumber = new THREE.Mesh(numberGeometry, numberMaterial);
    plateNumber.name = `rear-number-${riderNumber}`;
    plateNumber.position.set(0, 0.57, 1.145);
    rearNumberPlate.add(plateBacking, plateNumber);
    const hips = makeBox(0.58, 0.26, 0.4, player ? bodyMaterial : dark);
    hips.position.set(0, 0.9, 0.39);
    const leftHip = new THREE.Vector3(-0.22, 0.91, 0.39);
    const rightHip = new THREE.Vector3(0.22, 0.91, 0.39);
    const leftKnee = new THREE.Vector3(-0.34, 0.68, 0.48);
    const rightKnee = new THREE.Vector3(0.34, 0.68, 0.48);
    const leftAnkle = new THREE.Vector3(-0.34, 0.48, 0.55);
    const rightAnkle = new THREE.Vector3(0.34, 0.48, 0.55);
    const leftUpperLeg = makeLimbSegment(leftHip, leftKnee, 0.115, riderBody);
    const rightUpperLeg = makeLimbSegment(rightHip, rightKnee, 0.115, riderBody);
    const leftLowerLeg = makeLimbSegment(leftKnee, leftAnkle, 0.095, riderBody);
    const rightLowerLeg = makeLimbSegment(rightKnee, rightAnkle, 0.095, riderBody);
    const leftBoot = makeBox(0.24, 0.22, 0.52, dark);
    const rightBoot = leftBoot.clone();
    leftBoot.position.set(-0.34, 0.43, 0.52);
    rightBoot.position.set(0.34, 0.43, 0.52);

    const shoulderPads = new THREE.InstancedMesh(
      new THREE.IcosahedronGeometry(0.17, 0),
      accent,
      2,
    );
    const detailMatrix = new THREE.Matrix4();
    detailMatrix.compose(
      new THREE.Vector3(-0.34, 1.47, -0.01),
      new THREE.Quaternion(),
      new THREE.Vector3(1.12, 0.78, 0.86),
    );
    shoulderPads.setMatrixAt(0, detailMatrix);
    detailMatrix.compose(
      new THREE.Vector3(0.34, 1.47, -0.01),
      new THREE.Quaternion(),
      new THREE.Vector3(1.12, 0.78, 0.86),
    );
    shoulderPads.setMatrixAt(1, detailMatrix);

    const gloveGeometry = new THREE.SphereGeometry(0.13, 7, 5);
    const leftGlove = new THREE.Mesh(gloveGeometry, dark);
    leftGlove.position.copy(leftGrip);
    const rightGlove = leftGlove.clone();
    rightGlove.position.copy(rightGrip);

    const kneePadGeometry = new THREE.BoxGeometry(0.24, 0.25, 0.13);
    const leftKneePad = new THREE.Mesh(kneePadGeometry, dark);
    leftKneePad.position.set(-0.29, 0.7, 0.18);
    leftKneePad.rotation.set(-0.62, 0, -0.12);
    const rightKneePad = leftKneePad.clone();
    rightKneePad.position.set(0.29, 0.7, 0.18);
    rightKneePad.rotation.set(-0.62, 0, 0.12);

    const bikeVisual = new THREE.Group();
    bikeVisual.name = "procedural-bike-fallback";
    bikeVisual.add(frontWheel, backWheel, body, tank, fork, handle, ...bikeDetailParts);
    bikeVisual.add(rearNumberPlate);

    const rootOrigin = new THREE.Vector3();
    const torsoOrigin = new THREE.Vector3(0, 1.02, 0.31);
    const createPosePivot = (
      name: string,
      origin: THREE.Vector3,
      parentOrigin: THREE.Vector3,
      objects: readonly THREE.Object3D[],
    ): THREE.Group => {
      const pivot = new THREE.Group();
      pivot.name = name;
      pivot.position.copy(origin).sub(parentOrigin);
      for (const object of objects) {
        object.position.sub(origin);
        pivot.add(object);
      }
      return pivot;
    };

    const torsoPivot = createPosePivot(
      "rider-torso-pivot",
      torsoOrigin,
      rootOrigin,
      [torso, backPlate, backStripe, shoulderPads, jerseyNumber],
    );
    const headPivot = createPosePivot(
      "rider-head-pivot",
      new THREE.Vector3(0, 1.59, -0.08),
      torsoOrigin,
      [neck, helmet, visor, helmetPeak, helmetStripe, helmetBand],
    );
    const leftArmPivot = createPosePivot(
      "rider-left-arm-pivot",
      leftShoulder,
      torsoOrigin,
      [leftUpperArm, leftLowerArm, leftGlove],
    );
    const rightArmPivot = createPosePivot(
      "rider-right-arm-pivot",
      rightShoulder,
      torsoOrigin,
      [rightUpperArm, rightLowerArm, rightGlove],
    );
    const leftLegPivot = createPosePivot(
      "rider-left-leg-pivot",
      leftHip,
      rootOrigin,
      [leftUpperLeg, leftLowerLeg, leftBoot, leftKneePad],
    );
    const rightLegPivot = createPosePivot(
      "rider-right-leg-pivot",
      rightHip,
      rootOrigin,
      [rightUpperLeg, rightLowerLeg, rightBoot, rightKneePad],
    );
    torsoPivot.add(headPivot, leftArmPivot, rightArmPivot);

    const riderVisual = new THREE.Group();
    riderVisual.name = player ? "player-rider" : "rival-rider";
    riderVisual.add(
      torsoPivot,
      hips,
      leftLegPivot,
      rightLegPivot,
    );
    group.add(bikeVisual, riderVisual);
    group.userData.frontWheel = frontWheel;
    group.userData.backWheel = backWheel;
    group.userData.bikeVisual = bikeVisual;
    group.userData.riderVisual = riderVisual;
    group.userData.riderPoseRig = {
      torso: torsoPivot,
      head: headPivot,
      leftArm: leftArmPivot,
      rightArm: rightArmPivot,
      leftLeg: leftLegPivot,
      rightLeg: rightLegPivot,
    } satisfies RiderPoseRig;
    group.userData.riderNumber = riderNumber;
    group.userData.bikeDetailStyle = "shared-knobby-brake-panel-exhaust";
    riderVisual.userData.posePivotCount = 6;
    setShadow(group);
    return group;
  }
}

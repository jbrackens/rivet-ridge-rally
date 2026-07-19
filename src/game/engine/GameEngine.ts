import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import type { GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

import type {
  GameSettings,
  RaceClassificationEntry,
  RaceMode,
  RaceReplayHandoff,
  RaceResult,
} from "../../app/types";
import {
  getMasteryTargetMs,
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
  CANYON_KIT_URL,
  HERO_BIKE_RIDER_URL,
  RIVAL_PACK_URL,
  createCompressedAssetLoader,
  type CompressedAssetLoader,
} from "../assets/compressedAssetLoader";
import { InputManager, type InputDevice } from "../input/InputManager";
import { formatKeyCode } from "../input/keyLabels";
import { ReplayRecorder } from "../replay/replayCodec";
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
  type BikeState,
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
  getObstacleContactOutcome,
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
  createResolvedRiderPose,
  resolveBikePresentationPitch,
  resolveHeldLaneChangePresentationRoll,
  RIDER_LANE_CHANGE_LEAN_HOLD_SECONDS,
  resolvePresentationRecoveryProgress,
  resolveRiderPose,
  resolveRiderPresentationRoll,
  type ResolvedRiderPose,
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
export const CRITICAL_HEAT_WARNING = 78;
const FRONT_WHEEL_CLEAR_PITCH = 0.18;
export const TUTORIAL_USABLE_SPEED = 5;
export const TUTORIAL_OBSTACLES = [
  // Keep the gate downstream of the Ride/coast/lane lead-in plus a cold
  // Turbo run to 78%, with dirt before the bump for the lesson handoff.
  { id: "qa-cooling", kind: "cooling-gate", distance: 250, lanes: [0, 1, 2, 3], length: 18 },
  { id: "qa-bump", kind: "bump", distance: 300, lanes: [0, 1, 2, 3], length: 10 },
  { id: "qa-ramp", kind: "medium-ramp", distance: 340, lanes: [0, 1, 2, 3], length: 18, rampImpulse: 12 },
  { id: "qa-choice-barrier", kind: "barrier", distance: 440, lanes: [1, 2], length: 6 },
  { id: "qa-mud", kind: "mud", distance: 500, lanes: [0, 3], length: 30 },
  { id: "qa-grass", kind: "grass", distance: 560, lanes: [0, 3], length: 22 },
  { id: "qa-recovery-barrier", kind: "barrier", distance: 620, lanes: [0, 1, 2, 3], length: 6 },
] as const satisfies readonly TrackObstacle[];
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
const PLAYER_ASSET_READINESS_TIMEOUT_MS = 12_000;
const HERO_ASSET_VERTICAL_OFFSET = -0.63;
const HERO_ASSET_SCENE_NAME = "RRR_HeroBikeRiderScene";
const HERO_ASSET_ROOT_NAME = "RRR_HeroBikeRider";
const HERO_ASSET_PARENT_BY_NAME = {
  RRR_HeroBikeRider: null,
  RRR_BikeVisual: HERO_ASSET_ROOT_NAME,
  Bike_ChassisShell: "RRR_BikeVisual",
  Bike_TankAndRadiator: "RRR_BikeVisual",
  Bike_Seat: "RRR_BikeVisual",
  Bike_RearFender: "RRR_BikeVisual",
  Bike_LeftSidePanel: "RRR_BikeVisual",
  Bike_RightSidePanel: "RRR_BikeVisual",
  Bike_Engine: "RRR_BikeVisual",
  Bike_Exhaust: "RRR_BikeVisual",
  Bike_ChainDrive: "RRR_BikeVisual",
  "bike-steering-pivot": "RRR_BikeVisual",
  Bike_Handlebar: "bike-steering-pivot",
  Bike_FrontFork: "bike-steering-pivot",
  Bike_FrontFender: "bike-steering-pivot",
  NumberPlate: "bike-steering-pivot",
  "bike-front-suspension-pivot": "bike-steering-pivot",
  FrontTire: "bike-front-suspension-pivot",
  FrontTireRing: "FrontTire",
  FrontTreadRing: "FrontTire",
  FrontHub: "FrontTire",
  FrontSpokes: "FrontTire",
  FrontBrakeDisc: "FrontTire",
  "bike-rear-suspension-pivot": "RRR_BikeVisual",
  Bike_Swingarm: "bike-rear-suspension-pivot",
  RearTire: "bike-rear-suspension-pivot",
  RearTireRing: "RearTire",
  RearTreadRing: "RearTire",
  RearHub: "RearTire",
  RearSpokes: "RearTire",
  RearBrakeDisc: "RearTire",
  RearNumberPanel: "RRR_BikeVisual",
  RearNumber22: "RearNumberPanel",
  "bike-seat-anchor": "RRR_BikeVisual",
  "bike-left-hand-anchor": "RRR_BikeVisual",
  "bike-right-hand-anchor": "RRR_BikeVisual",
  "bike-left-boot-anchor": "RRR_BikeVisual",
  "bike-right-boot-anchor": "RRR_BikeVisual",
  "player-rider": HERO_ASSET_ROOT_NAME,
  "rider-torso-pivot": "player-rider",
  Rider_Torso: "rider-torso-pivot",
  Rider_ChestArmor: "rider-torso-pivot",
  Rider_BackPlate: "rider-torso-pivot",
  JerseyNumber22: "Rider_BackPlate",
  "rider-head-pivot": "rider-torso-pivot",
  Rider_Head: "rider-head-pivot",
  Rider_Helmet: "rider-head-pivot",
  Rider_Visor: "rider-head-pivot",
  Rider_HelmetPeak: "rider-head-pivot",
  "rider-left-arm-pivot": "rider-torso-pivot",
  Rider_LeftArm: "rider-left-arm-pivot",
  "rider-right-arm-pivot": "rider-torso-pivot",
  Rider_RightArm: "rider-right-arm-pivot",
  Rider_Hips: "player-rider",
  "rider-left-leg-pivot": "player-rider",
  Rider_LeftLeg: "rider-left-leg-pivot",
  "rider-right-leg-pivot": "player-rider",
  Rider_RightLeg: "rider-right-leg-pivot",
} as const satisfies Record<string, string | null>;
const HERO_ASSET_REQUIRED_NODE_NAMES = Object.freeze(
  Object.keys(HERO_ASSET_PARENT_BY_NAME),
);
const HERO_ASSET_REQUIRED_NODE_NAME_SET = new Set(HERO_ASSET_REQUIRED_NODE_NAMES);
const HERO_ASSET_POSE_PIVOT_NAMES = [
  "rider-torso-pivot",
  "rider-head-pivot",
  "rider-left-arm-pivot",
  "rider-right-arm-pivot",
  "rider-left-leg-pivot",
  "rider-right-leg-pivot",
] as const;
const HERO_ASSET_NEUTRAL_HOOK_NAMES = [
  "bike-steering-pivot",
  "bike-front-suspension-pivot",
  "bike-rear-suspension-pivot",
  "FrontTire",
  "RearTire",
  ...HERO_ASSET_POSE_PIVOT_NAMES,
  "bike-seat-anchor",
  "bike-left-hand-anchor",
  "bike-right-hand-anchor",
  "bike-left-boot-anchor",
  "bike-right-boot-anchor",
] as const;
const HERO_ASSET_MATERIAL_SPECS = new Map<string, {
  roughness: readonly [number, number];
  metalness: readonly [number, number];
}>([
  ["RRR_PlasticTeal", { roughness: [0.48, 0.62], metalness: [0, 0] }],
  ["RRR_PlasticCoral", { roughness: [0.48, 0.62], metalness: [0, 0] }],
  ["RRR_PlateCream", { roughness: [0.58, 0.72], metalness: [0, 0] }],
  ["RRR_Rubber", { roughness: [0.86, 0.96], metalness: [0, 0] }],
  ["RRR_MetalDark", { roughness: [0.38, 0.62], metalness: [0.45, 0.85] }],
  ["RRR_MetalBright", { roughness: [0.25, 0.48], metalness: [0.65, 0.95] }],
  ["RRR_RiderFabric", { roughness: [0.76, 0.9], metalness: [0, 0] }],
  ["RRR_RiderArmor", { roughness: [0.5, 0.72], metalness: [0, 0] }],
  ["RRR_Visor", { roughness: [0.18, 0.32], metalness: [0.05, 0.18] }],
  ["RRR_NumberCream", { roughness: [0.62, 0.78], metalness: [0, 0] }],
]);
const HERO_ASSET_ALLOWED_MATERIAL_NAMES = new Set(HERO_ASSET_MATERIAL_SPECS.keys());
const HERO_ASSET_NUMBER_BUCKETS = [
  { name: "BikeStatic_NumberCream", parent: "RRR_BikeVisual" },
  { name: "RiderTorso_NumberCream", parent: "rider-torso-pivot" },
] as const;
const HERO_ASSET_MAX_NODES = 96;
const HERO_ASSET_MAX_MESH_BEARING_NODES = 28;
const HERO_ASSET_MAX_RENDER_PRIMITIVES = 28;
const HERO_ASSET_MAX_MATERIALS = 10;
const HERO_ASSET_MAX_TEXTURES = 3;
const HERO_ASSET_MAX_TRIANGLES = 70_000;
const HERO_ASSET_MAX_BIKE_TRIANGLES = 40_000;
const HERO_ASSET_MAX_RIDER_TRIANGLES = 30_000;
const HERO_ASSET_MAX_WHEEL_TRIANGLES = 18_000;
const HERO_ASSET_TRANSFORM_EPSILON = 1e-4;
const RIVAL_PACK_READINESS_TIMEOUT_MS = 5_000;
const RIVAL_PACK_VERTICAL_OFFSET = -0.62;
const RIVAL_PACK_SCENE_NAME = "RRR_RivalPackScene";
const RIVAL_PACK_ROOT_NAME = "RRR_RivalPackBase";
const RIVAL_PACK_PARENT_BY_NAME = {
  RRR_RivalPackBase: null,
  RRR_RivalBikeVisual: RIVAL_PACK_ROOT_NAME,
  BikeStatic_Primary: "RRR_RivalBikeVisual",
  BikeStatic_Accent: "RRR_RivalBikeVisual",
  BikeStatic_Hardware: "RRR_RivalBikeVisual",
  BikeStatic_NumberField: "RRR_RivalBikeVisual",
  "bike-steering-pivot": "RRR_RivalBikeVisual",
  "bike-front-suspension-pivot": "bike-steering-pivot",
  FrontTire: "bike-front-suspension-pivot",
  FrontWheel_Wheel: "FrontTire",
  "bike-rear-suspension-pivot": "RRR_RivalBikeVisual",
  RearTire: "bike-rear-suspension-pivot",
  RearWheel_Wheel: "RearTire",
  "rival-rider": RIVAL_PACK_ROOT_NAME,
  "rider-torso-pivot": "rival-rider",
  RivalTorso_Primary: "rider-torso-pivot",
  "rider-head-pivot": "rider-torso-pivot",
  RivalHead_Accent: "rider-head-pivot",
  "rider-left-arm-pivot": "rider-torso-pivot",
  RivalLeftArm_Accent: "rider-left-arm-pivot",
  "rider-right-arm-pivot": "rider-torso-pivot",
  RivalRightArm_Accent: "rider-right-arm-pivot",
  "rider-left-leg-pivot": "rival-rider",
  RivalLeftLeg_Primary: "rider-left-leg-pivot",
  "rider-right-leg-pivot": "rival-rider",
  RivalRightLeg_Primary: "rider-right-leg-pivot",
} as const satisfies Record<string, string | null>;
const RIVAL_PACK_REQUIRED_NODE_NAMES = Object.freeze(
  Object.keys(RIVAL_PACK_PARENT_BY_NAME),
);
const RIVAL_PACK_REQUIRED_NODE_NAME_SET = new Set(RIVAL_PACK_REQUIRED_NODE_NAMES);
const RIVAL_PACK_MATERIAL_NAMES = new Set([
  "RRR_RivalPrimary",
  "RRR_RivalAccent",
  "RRR_RivalHardware",
  "RRR_RivalWheel",
  "RRR_RivalNumberField",
]);
const RIVAL_PACK_MAX_NODES = 26;
const RIVAL_PACK_MAX_MESHES = 12;
const RIVAL_PACK_MAX_PRIMITIVES = 12;
const RIVAL_PACK_MIN_TRIANGLES = 15_000;
const RIVAL_PACK_MAX_TRIANGLES = 20_000;
const RIVAL_PACK_VARIANT_NUMBERS = ["17", "31", "46", "58", "73"] as const;
const CANYON_KIT_READINESS_TIMEOUT_MS = 12_000;
const CANYON_PANORAMA_READINESS_TIMEOUT_MS = 12_000;
const CANYON_FESTIVAL_PANORAMA_URL = "/assets/art/canyon-festival-panorama.png";
const MAX_AI_CLASSIFICATION_STEPS = 60 * 60 * 15;
const AI_CLASSIFICATION_STEPS_PER_FRAME = 30;
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
  onFinishStart?: (() => void) | undefined;
  onFinish: (result: RaceResult, replay: RaceReplayHandoff) => void;
  onFatal: (message: string) => void;
}

type FinishClassificationStatus = "pending" | "complete" | "exhausted";

interface FinishClassificationWork {
  readonly playerState: SimulationState;
  readonly profile: AiDifficultyProfile;
  ticks: number;
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
  torso: THREE.Object3D;
  head: THREE.Object3D;
  leftArm: THREE.Object3D;
  rightArm: THREE.Object3D;
  leftLeg: THREE.Object3D;
  rightLeg: THREE.Object3D;
}

interface RiderPoseMemory {
  previousPhase: BikePhase;
  previousLanding: LandingQuality;
  landingAgeSeconds: number;
  presentationRecoveryProgress: number;
  pose: ResolvedRiderPose;
}

interface WheelPoseMemory {
  frontWheel: THREE.Object3D;
  rearWheel: THREE.Object3D;
  frontRestPosition: THREE.Vector3;
  rearRestPosition: THREE.Vector3;
}

interface HeroBikeRiderNodes {
  root: THREE.Object3D;
  bike: THREE.Object3D;
  rider: THREE.Object3D;
  frontWheel: THREE.Object3D;
  rearWheel: THREE.Object3D;
  rig: RiderPoseRig;
  nodeCount: number;
  meshCount: number;
  primitiveCount: number;
  materialCount: number;
  textureCount: number;
  triangleCount: number;
  bikeTriangleCount: number;
  riderTriangleCount: number;
  wheelTriangleCount: number;
}

interface RivalPackNodes {
  root: THREE.Object3D;
  bike: THREE.Object3D;
  rider: THREE.Object3D;
  frontWheel: THREE.Object3D;
  rearWheel: THREE.Object3D;
  rig: RiderPoseRig;
  nodeCount: number;
  meshCount: number;
  primitiveCount: number;
  materialCount: number;
  textureCount: number;
  triangleCount: number;
  geometries: ReadonlySet<THREE.BufferGeometry>;
}

interface PreparedRivalVariant {
  root: THREE.Object3D;
  nodes: RivalPackNodes;
  numberTexture: THREE.CanvasTexture;
}

interface SerializedHeroScene {
  name?: unknown;
  nodes?: unknown;
}

interface SerializedHeroNode {
  name?: unknown;
}

interface SerializedHeroBuffer {
  uri?: unknown;
}

interface SerializedHeroImage {
  uri?: unknown;
  bufferView?: unknown;
  mimeType?: unknown;
}

interface SerializedHeroTexture {
  source?: unknown;
  extensions?: {
    KHR_texture_basisu?: {
      source?: unknown;
    } | undefined;
  } | undefined;
}

interface SerializedHeroMaterial {
  name?: unknown;
}

interface SerializedHeroAccessor {
  bufferView?: unknown;
  componentType?: unknown;
  normalized?: unknown;
  type?: unknown;
}

interface SerializedHeroBufferView {
  extensions?: {
    EXT_meshopt_compression?: unknown;
  } | undefined;
}

interface SerializedHeroPrimitive {
  attributes?: Record<string, unknown>;
  indices?: unknown;
  mode?: unknown;
  targets?: unknown[];
}

interface SerializedHeroMesh {
  primitives?: SerializedHeroPrimitive[];
}

interface SerializedHeroGltf {
  scenes?: SerializedHeroScene[];
  nodes?: SerializedHeroNode[];
  buffers?: SerializedHeroBuffer[];
  bufferViews?: SerializedHeroBufferView[];
  accessors?: SerializedHeroAccessor[];
  meshes?: SerializedHeroMesh[];
  images?: SerializedHeroImage[];
  textures?: SerializedHeroTexture[];
  materials?: SerializedHeroMaterial[];
  cameras?: unknown[];
  skins?: unknown[];
  animations?: unknown[];
  extensionsUsed?: unknown[];
  extensionsRequired?: unknown[];
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
  maxLife: number;
  baseScale: number;
  baseOpacity: number;
  driftX: number;
  driftY: number;
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
  lateralOffset: number;
  lookHeight: number;
  lookAhead: number;
  laneFollow: number;
  lookAtLaneFollow: number;
  playerScale: number;
}

const CAMERA_PRESENTATION_PROFILES = {
  desktop: {
    fov: 52,
    height: 5.15,
    trailingDistance: 8.85,
    lateralOffset: 1.78,
    lookHeight: -1.48,
    lookAhead: 19.2,
    laneFollow: 0.76,
    lookAtLaneFollow: 0.72,
    playerScale: 1.46,
  },
  portrait: {
    fov: 58,
    height: 5.7,
    trailingDistance: 8.3,
    lateralOffset: 0.9,
    lookHeight: -1.55,
    lookAhead: 16.4,
    laneFollow: 0.92,
    lookAtLaneFollow: 0.9,
    playerScale: 1.58,
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
    hemisphereIntensity: 1.12,
    sun: 0xffd6a0,
    sunIntensity: 3.7,
    exposure: 1.08,
    treeDensity: 1,
    mesaDensity: 2.05,
    terraceHeight: 0.95,
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
let gameEngineInstanceCounter = 0;

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

function disposeObjectMaterialResources(root: THREE.Object3D): void {
  const materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    const objectMaterials = Array.isArray(object.material) ? object.material : [object.material];
    objectMaterials.forEach((material) => materials.add(material));
  });
  for (const material of materials) {
    for (const value of Object.values(material)) {
      if (value instanceof THREE.Texture) textures.add(value);
    }
    material.dispose();
  }
  textures.forEach((texture) => texture.dispose());
}

function clearCanvasDatasetAttribute(canvas: HTMLCanvasElement, key: string): void {
  delete canvas.dataset[key];
  canvas.removeAttribute(`data-${key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`);
}

function disposeShadowRenderTargets(light: THREE.DirectionalLight | null): void {
  if (!light) return;
  light.shadow.dispose();
  light.shadow.map = null;
  light.shadow.mapPass = null;
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

function createCanyonAgaveGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [
    new THREE.CylinderGeometry(0.12, 0.18, 0.26, 6).translate(0, 0.13, 0),
  ];
  const leafRotations = [
    { yaw: 0, roll: -0.58, length: 1.15 },
    { yaw: Math.PI * 0.5, roll: -0.62, length: 0.96 },
    { yaw: Math.PI, roll: -0.54, length: 1.08 },
    { yaw: Math.PI * 1.5, roll: -0.66, length: 0.9 },
    { yaw: Math.PI * 0.25, roll: -0.82, length: 0.74 },
    { yaw: Math.PI * 1.25, roll: -0.76, length: 0.7 },
  ];
  for (const leaf of leafRotations) {
    const geometry = new THREE.ConeGeometry(0.16, leaf.length, 4)
      .rotateZ(leaf.roll)
      .rotateY(leaf.yaw)
      .translate(Math.sin(leaf.yaw) * 0.18, 0.25, Math.cos(leaf.yaw) * 0.18);
    parts.push(geometry);
  }
  const geometry = mergeGeometries(parts, false);
  parts.forEach((part) => part.dispose());
  geometry.name = "canyon-agave-cluster";
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

const FESTIVAL_SHOWCASE_CLEARANCE = 5.6;
const FESTIVAL_SHOWCASE_CLEARANCE_BUFFER = 0.4;

export interface FestivalPocketPlacement {
  readonly side: -1 | 1;
  readonly x: number;
  readonly z: number;
  readonly rotationY: number;
  readonly elevatedWatchtower: boolean;
}

export function resolveFestivalPocketPlacements(options: {
  readonly handcraftedCanyon: boolean;
  readonly quality: Exclude<GameSettings["quality"], "auto">;
  readonly totalLength: number;
  readonly trackOrder: number;
  readonly coolingGateDistances: readonly number[];
}): {
  readonly routePockets: readonly FestivalPocketPlacement[];
  readonly coolingGatePockets: readonly FestivalPocketPlacement[];
  readonly pocketPlacements: readonly FestivalPocketPlacement[];
} {
  const {
    handcraftedCanyon,
    quality,
    totalLength,
    trackOrder,
    coolingGateDistances,
  } = options;
    const spacing = handcraftedCanyon
    ? quality === "low" ? 230 : quality === "medium" ? 150 : 110
    : quality === "low" ? 250 : quality === "medium" ? 180 : 135;
  const routePocketCount = Math.max(4, Math.floor((totalLength - 150) / spacing));
  const random = seededRandom(trackOrder * 377_911);
  const routePockets: FestivalPocketPlacement[] = Array.from(
    { length: routePocketCount },
    (_, pocket) => {
      const side: -1 | 1 = (pocket + trackOrder) % 2 === 0 ? -1 : 1;
      return {
        side,
        x: side * (handcraftedCanyon ? 10.75 + random() * 0.35 : 11.85 + random() * 0.45),
        z: -125 - pocket * spacing - (random() - 0.5) * 34,
        rotationY: side * (0.04 + random() * 0.035),
        elevatedWatchtower: false,
      };
    },
  );
  const coolingGatePockets: FestivalPocketPlacement[] = handcraftedCanyon
    ? coolingGateDistances.slice(0, 2).flatMap((distance, gateIndex) => (
      ([-1, 1] as const).map((side) => ({
        side,
        x: side * (11.15 + gateIndex * 0.2),
        z: -(distance + 12),
        rotationY: side * 0.06,
        elevatedWatchtower: true,
      }))
    ))
    : [];
  const separatedRoutePockets = handcraftedCanyon
    ? routePockets.map((routePocket) => coolingGatePockets.reduce((adjustedPocket, gatePocket) => {
      const xGap = adjustedPocket.x - gatePocket.x;
      const zGap = adjustedPocket.z - gatePocket.z;
      if (Math.hypot(xGap, zGap) >= FESTIVAL_SHOWCASE_CLEARANCE) return adjustedPocket;

      // Preserve the planned crowd density while preventing a route stand
      // from intersecting the authored cooling-gate watchtower showcase.
      const requiredZGap = Math.sqrt(Math.max(
        0,
        FESTIVAL_SHOWCASE_CLEARANCE ** 2 - xGap ** 2,
      )) + FESTIVAL_SHOWCASE_CLEARANCE_BUFFER;
      return {
        ...adjustedPocket,
        z: gatePocket.z + (zGap >= 0 ? requiredZGap : -requiredZGap),
      };
    }, routePocket))
    : routePockets;

  return {
    routePockets: separatedRoutePockets,
    coolingGatePockets,
    pocketPlacements: [...separatedRoutePockets, ...coolingGatePockets],
  };
}

const TERRAIN_MARK_BATCH_SIZE = 128;
// Five launch palettes, each with one grass and one dirt canvas.
const MAX_TERRAIN_CANVAS_CACHE_ENTRIES = 10;
const terrainCanvasCache = new Map<string, HTMLCanvasElement>();
const DIRT_HEIGHT_TEXTURE_SIZE = 512;
const DIRT_TEXTURE_DETAIL_STYLE = "layered-rut-pebble-v3";
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

function paintDirtPebbleFlecks(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  base: THREE.Color,
  mark: THREE.Color,
  random: () => number,
): void {
  const lightPebble = base.clone().lerp(new THREE.Color(0xf7d09a), 0.42);
  const darkPebble = mark.clone().multiplyScalar(0.72);
  const redPebble = base.clone().lerp(new THREE.Color(0xb7442f), 0.35);
  for (let index = 0; index < 860; index += 1) {
    const color = index % 7 === 0
      ? lightPebble
      : index % 5 === 0
        ? redPebble
        : darkPebble;
    const x = random() * width;
    const y = random() * height;
    const radius = 0.45 + random() * (index % 7 === 0 ? 1.15 : 0.75);
    context.fillStyle = `#${color.getHexString()}`;
    context.globalAlpha = index % 7 === 0 ? 0.4 : 0.28;
    context.beginPath();
    context.ellipse(
      x,
      y,
      radius * (1.15 + random() * 1.4),
      radius * (0.55 + random() * 0.75),
      random() * Math.PI,
      0,
      Math.PI * 2,
    );
    context.fill();
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

  context.strokeStyle = `#${mark.clone().multiplyScalar(0.56).getHexString()}`;
  context.globalAlpha = 0.56;
  context.lineWidth = 8.2;
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

    context.globalAlpha = 0.36;
    context.lineWidth = 1.8;
    for (let y = 0; y < height; y += 16) {
      const wobble = dirtRutWobble(y, height, center);
      context.beginPath();
      context.moveTo(width * center - 7 + wobble, y);
      context.lineTo(width * center + 7 + wobble, y + 3);
      context.stroke();
    }
    context.globalAlpha = 0.56;
    context.lineWidth = 8.2;
  }

  context.globalCompositeOperation = "screen";
  context.strokeStyle = "#fff0bd";
  context.globalAlpha = 0.08;
  context.lineWidth = 1.8;
  for (const center of DIRT_LANE_CENTER_RATIOS) {
    for (const offset of [-0.044, 0.044]) {
      context.beginPath();
      for (let y = 0; y <= height; y += 6) {
        const wobble = dirtRutWobble(y, height, center) * 0.72;
        const x = width * (center + offset) + wobble;
        if (y === 0) context.moveTo(x, y);
        else context.lineTo(x, y);
      }
      context.stroke();
    }
  }
  context.globalCompositeOperation = "source-over";
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
    context.globalAlpha = kind === "dirt" ? 0.34 : 0.23;
    const markCount = kind === "dirt" ? 1_420 : 760;
    // Small calls retain the dense deterministic pattern without presenting one
    // large hot loop to JavaScriptCore during the first terrain paint.
    for (let offset = 0; offset < markCount; offset += TERRAIN_MARK_BATCH_SIZE) {
      const count = Math.min(TERRAIN_MARK_BATCH_SIZE, markCount - offset);
      if (kind === "dirt") paintDirtMarks(context, width, height, random, count);
      else paintGrassMarks(context, width, height, random, count);
    }

    if (kind === "dirt") {
      paintDirtPebbleFlecks(context, width, height, base, mark, random);
      paintDirtLanes(context, width, height, mark);
    }
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
      context.strokeStyle = "#565656";
      context.globalAlpha = 0.76;
      context.lineWidth = 8.5;
      context.beginPath();
      for (let y = 0; y <= height; y += 4) {
        const wobble = dirtRutWobble(y, height, center);
        if (y === 0) context.moveTo(rutX + wobble, y);
        else context.lineTo(rutX + wobble, y);
      }
      context.stroke();

      context.strokeStyle = "#6a6a6a";
      context.globalAlpha = 0.84;
      context.lineWidth = 2.4;
      context.stroke();

      context.strokeStyle = "#626262";
      context.globalAlpha = 0.56;
      context.lineWidth = 1.45;
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
  for (let index = 0; index < 560; index += 1) {
    context.fillStyle = index % 9 === 0
      ? "#b0b0b0"
      : index % 4 === 0
        ? "#969696"
        : "#8b8b8b";
    context.globalAlpha = 0.18 + random() * 0.24;
    fillWrappedEllipse(
      context,
      width,
      height,
      random() * width,
      random() * height,
      0.6 + random() * 2.1,
      0.9 + random() * 3.4,
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

function createSoftDustTexture(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 64;
  const context = canvas.getContext("2d");
  if (context) {
    const gradient = context.createRadialGradient(32, 32, 1, 32, 32, 31);
    gradient.addColorStop(0, "#ffffff");
    gradient.addColorStop(0.34, "#eeeeee");
    gradient.addColorStop(0.68, "#777777");
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

function setFocalBikeShadows(group: THREE.Object3D): void {
  group.traverse((object) => {
    if (object instanceof THREE.Mesh) {
      object.castShadow = true;
      object.receiveShadow = true;
    }
  });
}

function tuneFocalBikeMaterialResponse(
  group: THREE.Object3D,
  environmentMap: THREE.Texture | null,
): void {
  const tuned = new Set<THREE.MeshStandardMaterial>();
  group.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of materials) {
      if (!(material instanceof THREE.MeshStandardMaterial) || tuned.has(material)) continue;
      tuned.add(material);
      material.envMap = environmentMap;
      if (material.name === "RRR_PlasticTeal") {
        material.color.offsetHSL(0.01, 0.08, -0.055);
        material.roughness = Math.min(material.roughness + 0.04, 0.62);
      } else if (material.name === "RRR_PlasticCoral") {
        material.color.offsetHSL(-0.01, 0.07, -0.06);
        material.roughness = Math.min(material.roughness + 0.04, 0.62);
      } else if (material.name === "RRR_PlateCream" || material.name === "RRR_NumberCream") {
        material.color.multiplyScalar(0.82);
        material.roughness = Math.min(material.roughness + 0.04, material.name === "RRR_PlateCream" ? 0.72 : 0.78);
      } else if (material.name === "RRR_RiderFabric" || material.name === "RRR_RiderArmor") {
        material.color.offsetHSL(0, 0.04, -0.045);
      }
      material.envMapIntensity = material.name === "RRR_MetalBright"
        || material.name === "RRR_MetalDark"
        ? 1.72
        : material.name === "RRR_Visor"
          ? 1.55
          : material.name === "RRR_Rubber"
            ? 0.5
            : material.name === "RRR_PlasticTeal" || material.name === "RRR_PlasticCoral"
              ? 1.08
              : material.name === "RRR_RiderArmor"
                ? 0.98
                : 0.9;
      material.needsUpdate = true;
    }
  });
}

function heroKeyLightIntensity(quality: Exclude<GameSettings["quality"], "auto">): number {
  return quality === "high" ? 72 : quality === "medium" ? 44 : 0;
}

function heroRimLightIntensity(quality: Exclude<GameSettings["quality"], "auto">): number {
  return quality === "high" ? 34 : quality === "medium" ? 19 : 0;
}

function heroFillLightIntensity(quality: Exclude<GameSettings["quality"], "auto">): number {
  return quality === "high" ? 0.58 : quality === "medium" ? 0.36 : 0;
}

function assertHeroAsset(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Invalid hero bike/rider asset: ${message}`);
}

function hasFiniteTransform(object: THREE.Object3D): boolean {
  return [
    object.position.x,
    object.position.y,
    object.position.z,
    object.quaternion.x,
    object.quaternion.y,
    object.quaternion.z,
    object.quaternion.w,
    object.scale.x,
    object.scale.y,
    object.scale.z,
  ].every(Number.isFinite)
    && object.scale.x > 0
    && object.scale.y > 0
    && object.scale.z > 0;
}

function hasNeutralRotationAndScale(object: THREE.Object3D): boolean {
  const epsilon = HERO_ASSET_TRANSFORM_EPSILON;
  return Math.abs(object.quaternion.x) <= epsilon
    && Math.abs(object.quaternion.y) <= epsilon
    && Math.abs(object.quaternion.z) <= epsilon
    && Math.abs(Math.abs(object.quaternion.w) - 1) <= epsilon
    && Math.abs(object.scale.x - 1) <= epsilon
    && Math.abs(object.scale.y - 1) <= epsilon
    && Math.abs(object.scale.z - 1) <= epsilon;
}

function hasIdentityTransform(object: THREE.Object3D): boolean {
  const epsilon = HERO_ASSET_TRANSFORM_EPSILON;
  return Math.abs(object.position.x) <= epsilon
    && Math.abs(object.position.y) <= epsilon
    && Math.abs(object.position.z) <= epsilon
    && hasNeutralRotationAndScale(object);
}

function isRiderPoseRig(value: unknown): value is RiderPoseRig {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<RiderPoseRig>;
  return candidate.torso instanceof THREE.Object3D
    && candidate.head instanceof THREE.Object3D
    && candidate.leftArm instanceof THREE.Object3D
    && candidate.rightArm instanceof THREE.Object3D
    && candidate.leftLeg instanceof THREE.Object3D
    && candidate.rightLeg instanceof THREE.Object3D;
}

function validateHeroBikeRiderAsset(gltf: GLTF): HeroBikeRiderNodes {
  assertHeroAsset(gltf.scenes.length === 1, "exactly one scene is required");
  assertHeroAsset(gltf.scene === gltf.scenes[0], "the sole scene must be active");
  assertHeroAsset(gltf.scene.name === HERO_ASSET_SCENE_NAME, "the scene name is invalid");
  assertHeroAsset(gltf.animations.length === 0, "animations are not permitted");
  assertHeroAsset(gltf.cameras.length === 0, "cameras are not permitted");
  assertHeroAsset(hasIdentityTransform(gltf.scene), "the scene wrapper must be identity");

  const json = gltf.parser.json as SerializedHeroGltf;
  const serializedScenes = json.scenes ?? [];
  const serializedNodes = json.nodes ?? [];
  const serializedBuffers = json.buffers ?? [];
  const serializedBufferViews = json.bufferViews ?? [];
  const serializedAccessors = json.accessors ?? [];
  const serializedMeshes = json.meshes ?? [];
  const serializedImages = json.images ?? [];
  const serializedTextures = json.textures ?? [];
  const serializedMaterials = json.materials ?? [];
  const extensionsUsed = json.extensionsUsed ?? [];
  const extensionsRequired = json.extensionsRequired ?? [];

  assertHeroAsset(serializedScenes.length === 1, "serialized scene count is invalid");
  assertHeroAsset(
    serializedScenes[0]?.name === HERO_ASSET_SCENE_NAME,
    "serialized scene name is invalid",
  );
  assertHeroAsset(serializedNodes.length > 0, "serialized nodes are missing");
  assertHeroAsset(serializedNodes.length <= HERO_ASSET_MAX_NODES, "node budget exceeded");
  assertHeroAsset((json.cameras ?? []).length === 0, "serialized cameras are not permitted");
  assertHeroAsset((json.skins ?? []).length === 0, "skins are not permitted");
  assertHeroAsset((json.animations ?? []).length === 0, "serialized animations are not permitted");
  assertHeroAsset(
    serializedBuffers.every((buffer) => buffer.uri === undefined),
    "external buffers are not permitted",
  );
  assertHeroAsset(serializedImages.length <= HERO_ASSET_MAX_TEXTURES, "image budget exceeded");
  assertHeroAsset(serializedTextures.length <= HERO_ASSET_MAX_TEXTURES, "texture budget exceeded");
  for (const image of serializedImages) {
    assertHeroAsset(image.uri === undefined, "external images are not permitted");
    assertHeroAsset(Number.isInteger(image.bufferView), "images must be embedded in the GLB");
    assertHeroAsset(image.mimeType === "image/ktx2", "only embedded KTX2 images are permitted");
  }
  for (const texture of serializedTextures) {
    const basisSource = texture.extensions?.KHR_texture_basisu?.source;
    assertHeroAsset(texture.source === undefined, "fallback texture sources are not permitted");
    assertHeroAsset(
      Number.isInteger(basisSource)
        && Number(basisSource) >= 0
        && Number(basisSource) < serializedImages.length,
      "textures must reference an embedded KTX2 image",
    );
  }

  assertHeroAsset(
    extensionsUsed.every((extension) => typeof extension === "string"),
    "extension declarations are invalid",
  );
  const extensionNames = new Set(extensionsUsed as string[]);
  assertHeroAsset(
    extensionNames.has("EXT_meshopt_compression"),
    "Meshopt compression is required",
  );
  assertHeroAsset(
    !extensionNames.has("KHR_lights_punctual"),
    "punctual lights are not permitted",
  );
  assertHeroAsset(
    extensionsRequired.every((extension) => typeof extension === "string"),
    "required-extension declarations are invalid",
  );
  const expectedRequiredExtensions = [
    "EXT_meshopt_compression",
    "KHR_mesh_quantization",
    ...(serializedTextures.length > 0 ? ["KHR_texture_basisu"] : []),
  ].sort();
  assertHeroAsset(
    JSON.stringify([...(extensionsUsed as string[])].sort())
      === JSON.stringify(expectedRequiredExtensions),
    "used-extension set is invalid",
  );
  assertHeroAsset(
    JSON.stringify([...(extensionsRequired as string[])].sort())
      === JSON.stringify(expectedRequiredExtensions),
    "required-extension set is invalid",
  );
  if (serializedTextures.length > 0) {
    assertHeroAsset(
      extensionNames.has("KHR_texture_basisu"),
      "KTX2 textures must declare KHR_texture_basisu",
    );
  }

  assertHeroAsset(
    serializedMeshes.length > 0
      && serializedMeshes.length <= HERO_ASSET_MAX_MESH_BEARING_NODES,
    "serialized mesh budget is invalid",
  );
  for (const mesh of serializedMeshes) {
    assertHeroAsset(
      Array.isArray(mesh.primitives) && mesh.primitives.length > 0,
      "every serialized mesh must contain a triangle primitive",
    );
    for (const primitive of mesh.primitives) {
      assertHeroAsset(
        primitive.mode === undefined || primitive.mode === 4,
        "only serialized triangle primitives are permitted",
      );
      assertHeroAsset(
        primitive.targets === undefined
          || (Array.isArray(primitive.targets) && primitive.targets.length === 0),
        "morph targets are not permitted",
      );
      assertHeroAsset(
        primitive.attributes !== null
          && typeof primitive.attributes === "object"
          && !Array.isArray(primitive.attributes),
        "serialized primitive attributes are invalid",
      );
      assertHeroAsset(
        Object.keys(primitive.attributes).every(
          (semantic) => semantic === "POSITION"
            || semantic === "NORMAL"
            || semantic === "TANGENT"
            || semantic.startsWith("TEXCOORD_")
            || semantic.startsWith("COLOR_"),
        ),
        "serialized primitive attribute semantics are invalid",
      );
      const positionIndex = primitive.attributes.POSITION;
      const normalIndex = primitive.attributes.NORMAL;
      assertHeroAsset(
        Number.isInteger(positionIndex) && Number.isInteger(normalIndex),
        "every primitive requires POSITION and NORMAL accessors",
      );
      const accessorEntries = [
        ["indices", primitive.indices],
        ...Object.entries(primitive.attributes),
      ] as const;
      for (const [semantic, accessorIndex] of accessorEntries) {
        assertHeroAsset(Number.isInteger(accessorIndex), `${semantic} accessor index is invalid`);
        const accessor = serializedAccessors[Number(accessorIndex)];
        assertHeroAsset(accessor !== undefined, `${semantic} accessor is missing`);
        assertHeroAsset(
          Number.isInteger(accessor.bufferView),
          `${semantic} accessor must reference a buffer view`,
        );
        const bufferView = serializedBufferViews[Number(accessor.bufferView)];
        assertHeroAsset(bufferView !== undefined, `${semantic} buffer view is missing`);
        assertHeroAsset(
          bufferView.extensions?.EXT_meshopt_compression !== undefined,
          `${semantic} geometry must be covered by EXT_meshopt_compression`,
        );
      }

      const positionAccessor = serializedAccessors[Number(positionIndex)]!;
      const normalAccessor = serializedAccessors[Number(normalIndex)]!;
      assertHeroAsset(
        positionAccessor.type === "VEC3"
          && positionAccessor.componentType === 5122
          && positionAccessor.normalized === true,
        "POSITION accessors must use normalized signed-short quantization",
      );
      assertHeroAsset(
        normalAccessor.type === "VEC3"
          && normalAccessor.componentType === 5120
          && normalAccessor.normalized === true,
        "NORMAL accessors must use normalized signed-byte quantization",
      );
      const indexAccessor = serializedAccessors[Number(primitive.indices)]!;
      assertHeroAsset(
        indexAccessor.type === "SCALAR"
          && (indexAccessor.componentType === 5121
            || indexAccessor.componentType === 5123
            || indexAccessor.componentType === 5125),
        "index accessor component type is invalid",
      );
    }
  }

  const serializedNodeNames: string[] = [];
  for (const node of serializedNodes) {
    assertHeroAsset(
      typeof node.name === "string" && node.name.length > 0,
      "every exported node must have a stable name",
    );
    assertHeroAsset(!/\.\d{3}$/u.test(node.name), "Blender numeric node suffixes are prohibited");
    serializedNodeNames.push(node.name);
  }
  assertHeroAsset(
    new Set(serializedNodeNames).size === serializedNodeNames.length,
    "exported node names must be unique",
  );
  const sceneRootIndices = serializedScenes[0]?.nodes;
  assertHeroAsset(
    Array.isArray(sceneRootIndices)
      && sceneRootIndices.length === 1
      && Number.isInteger(sceneRootIndices[0]),
    "one serialized scene root is required",
  );
  assertHeroAsset(
    serializedNodes[Number(sceneRootIndices[0])]?.name === HERO_ASSET_ROOT_NAME,
    "the serialized scene root is invalid",
  );

  assertHeroAsset(
    serializedMaterials.length === HERO_ASSET_MATERIAL_SPECS.size
      && serializedMaterials.length <= HERO_ASSET_MAX_MATERIALS,
    "serialized material inventory is incomplete",
  );
  const serializedMaterialNames: string[] = [];
  for (const material of serializedMaterials) {
    assertHeroAsset(
      typeof material.name === "string" && HERO_ASSET_ALLOWED_MATERIAL_NAMES.has(material.name),
      "an unapproved material name is present",
    );
    serializedMaterialNames.push(material.name);
  }
  assertHeroAsset(
    new Set(serializedMaterialNames).size === serializedMaterialNames.length,
    "material names must be unique",
  );
  assertHeroAsset(
    [...HERO_ASSET_MATERIAL_SPECS.keys()].every(
      (name) => serializedMaterialNames.includes(name),
    ),
    "a required semantic material is missing",
  );

  const requiredMatches = new Map<string, THREE.Object3D[]>();
  let meshCount = 0;
  let primitiveCount = 0;
  let triangleCount = 0;
  const renderedTrianglesByObject = new Map<THREE.Object3D, number>();
  const materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();
  gltf.scene.traverse((object) => {
    assertHeroAsset(
      hasFiniteTransform(object),
      `${object.name || "unnamed node"} has an invalid transform`,
    );
    if (HERO_ASSET_REQUIRED_NODE_NAME_SET.has(object.name)) {
      const matches = requiredMatches.get(object.name) ?? [];
      matches.push(object);
      requiredMatches.set(object.name, matches);
    }
    assertHeroAsset(!(object instanceof THREE.Camera), "scene cameras are not permitted");
    assertHeroAsset(!(object instanceof THREE.Light), "scene lights are not permitted");
    assertHeroAsset(!(object instanceof THREE.Bone), "bones are not permitted");
    assertHeroAsset(!(object instanceof THREE.SkinnedMesh), "skinned meshes are not permitted");
    assertHeroAsset(
      !(object instanceof THREE.Line)
        && !(object instanceof THREE.Points)
        && !(object instanceof THREE.Sprite),
      "only triangle meshes are permitted",
    );
    if (!(object instanceof THREE.Mesh)) return;

    meshCount += 1;
    const position = object.geometry.getAttribute("position");
    const elementCount = object.geometry.index?.count ?? position?.count ?? 0;
    assertHeroAsset(
      elementCount > 0 && elementCount % 3 === 0,
      `${object.name} is not a triangle mesh`,
    );
    const instanceCount = object instanceof THREE.InstancedMesh ? object.count : 1;
    const renderedTriangles = (elementCount / 3) * instanceCount;
    triangleCount += renderedTriangles;
    renderedTrianglesByObject.set(object, renderedTriangles);
    const objectMaterials = Array.isArray(object.material) ? object.material : [object.material];
    assertHeroAsset(objectMaterials.length > 0, `${object.name} has no material`);
    primitiveCount += Array.isArray(object.material)
      ? Math.max(1, object.geometry.groups.length)
      : 1;
    for (const material of objectMaterials) materials.add(material);
  });

  assertHeroAsset(
    meshCount <= HERO_ASSET_MAX_MESH_BEARING_NODES,
    "mesh-bearing node budget exceeded",
  );
  assertHeroAsset(
    primitiveCount <= HERO_ASSET_MAX_RENDER_PRIMITIVES,
    "render primitive budget exceeded",
  );
  assertHeroAsset(triangleCount <= HERO_ASSET_MAX_TRIANGLES, "triangle budget exceeded");
  assertHeroAsset(materials.size <= HERO_ASSET_MAX_MATERIALS, "runtime material budget exceeded");
  for (const material of materials) {
    assertHeroAsset(
      material instanceof THREE.MeshStandardMaterial,
      `${material.name || "unnamed material"} is not a glTF PBR material`,
    );
    assertHeroAsset(
      HERO_ASSET_ALLOWED_MATERIAL_NAMES.has(material.name),
      `${material.name || "unnamed material"} is not approved`,
    );
    const response = HERO_ASSET_MATERIAL_SPECS.get(material.name);
    assertHeroAsset(response !== undefined, `${material.name} has no response contract`);
    assertHeroAsset(
      material.roughness >= response.roughness[0]
        && material.roughness <= response.roughness[1],
      `${material.name} roughness is outside its contract`,
    );
    assertHeroAsset(
      material.metalness >= response.metalness[0]
        && material.metalness <= response.metalness[1],
      `${material.name} metalness is outside its contract`,
    );
    assertHeroAsset(
      !material.transparent
        && material.opacity === 1
        && material.alphaTest === 0
        && material.depthWrite,
      `${material.name} must remain opaque`,
    );
    assertHeroAsset(
      material.emissive.toArray().every((channel) => Math.abs(channel) <= 1e-7),
      `${material.name} must remain non-emissive`,
    );
    for (const value of Object.values(material)) {
      if (value instanceof THREE.Texture) textures.add(value);
    }
  }
  assertHeroAsset(
    textures.size <= HERO_ASSET_MAX_TEXTURES,
    "runtime texture budget exceeded",
  );
  assertHeroAsset(
    materials.size === serializedMaterials.length,
    "serialized and decoded material counts do not match",
  );
  assertHeroAsset(
    textures.size === serializedTextures.length,
    "serialized and decoded texture counts do not match",
  );
  for (const texture of textures) {
    const image = texture.image as { width?: unknown; height?: unknown } | null;
    const width = image?.width;
    const height = image?.height;
    assertHeroAsset(
      typeof width === "number"
        && Number.isFinite(width)
        && width > 0
        && width <= 1024
        && typeof height === "number"
        && Number.isFinite(height)
        && height > 0
        && height <= 1024,
      "runtime texture dimensions are invalid",
    );
  }
  for (const bucket of HERO_ASSET_NUMBER_BUCKETS) {
    const object = gltf.scene.getObjectByName(bucket.name);
    assertHeroAsset(
      object instanceof THREE.Mesh && object.parent?.name === bucket.parent,
      `${bucket.name} number bucket is missing or misplaced`,
    );
    const bucketMaterials = Array.isArray(object.material) ? object.material : [object.material];
    assertHeroAsset(
      bucketMaterials.length === 1 && bucketMaterials[0]?.name === "RRR_NumberCream",
      `${bucket.name} must use only RRR_NumberCream`,
    );
  }

  const requiredNode = (name: string): THREE.Object3D => {
    const matches = requiredMatches.get(name);
    if (!matches || matches.length !== 1) {
      throw new Error(`Invalid hero bike/rider asset: ${name} must exist exactly once`);
    }
    return matches[0]!;
  };
  for (const [name, expectedParent] of Object.entries(HERO_ASSET_PARENT_BY_NAME)) {
    const object = requiredNode(name);
    const actualParent = object.parent === gltf.scene ? null : object.parent?.name ?? null;
    assertHeroAsset(
      actualParent === expectedParent,
      `${name} must be parented to ${expectedParent ?? "the scene"}`,
    );
  }

  const root = requiredNode(HERO_ASSET_ROOT_NAME);
  const bike = requiredNode("RRR_BikeVisual");
  const rider = requiredNode("player-rider");
  const frontWheel = requiredNode("FrontTire");
  const rearWheel = requiredNode("RearTire");
  const countSubtreeTriangles = (subtree: THREE.Object3D): number => {
    let total = 0;
    subtree.traverse((object) => {
      total += renderedTrianglesByObject.get(object) ?? 0;
    });
    return total;
  };
  const bikeTriangleCount = countSubtreeTriangles(bike);
  const riderTriangleCount = countSubtreeTriangles(rider);
  const wheelTriangleCount = countSubtreeTriangles(frontWheel) + countSubtreeTriangles(rearWheel);
  assertHeroAsset(
    bikeTriangleCount <= HERO_ASSET_MAX_BIKE_TRIANGLES,
    "bike triangle sub-budget exceeded",
  );
  assertHeroAsset(
    riderTriangleCount <= HERO_ASSET_MAX_RIDER_TRIANGLES,
    "rider triangle sub-budget exceeded",
  );
  assertHeroAsset(
    wheelTriangleCount <= HERO_ASSET_MAX_WHEEL_TRIANGLES,
    "wheel triangle sub-budget exceeded",
  );
  assertHeroAsset(
    gltf.scene.children.length === 1 && gltf.scene.children[0] === root,
    "the scene must contain one authored root",
  );
  assertHeroAsset(hasIdentityTransform(root), "the authored root must be identity");
  assertHeroAsset(hasIdentityTransform(bike), "the bike root must be identity");
  assertHeroAsset(hasIdentityTransform(rider), "the rider root must be identity");
  for (const name of HERO_ASSET_NEUTRAL_HOOK_NAMES) {
    assertHeroAsset(
      hasNeutralRotationAndScale(requiredNode(name)),
      `${name} must ship in its neutral rotation and scale`,
    );
  }
  assertHeroAsset(root.userData.asset_root === true, "root provenance marker is missing");
  assertHeroAsset(
    root.userData.asset_source === "Original project-authored Blender-native geometry",
    "root source-provenance marker is invalid",
  );
  assertHeroAsset(
    root.userData.reference === "docs/design/concepts/hero-bike-rider-production-reference.png",
    "root modeling-reference marker is invalid",
  );
  assertHeroAsset(
    root.userData.contract === "docs/design/HERO_BIKE_RIDER_VERTICAL_SLICE.md",
    "root asset-contract marker is invalid",
  );
  assertHeroAsset(root.userData.units === "meters", "root units must be meters");
  assertHeroAsset(root.userData.forward_axis === "+Y", "source forward-axis marker is invalid");
  assertHeroAsset(root.userData.up_axis === "+Z", "source up-axis marker is invalid");
  assertHeroAsset(
    root.userData.gameplay_authority === "presentation-only",
    "the asset must declare presentation-only authority",
  );
  assertHeroAsset(bike.userData.presentation_only === true, "bike authority marker is missing");
  assertHeroAsset(
    rider.userData.pose_pivot_count === HERO_ASSET_POSE_PIVOT_NAMES.length,
    "rider pose-pivot marker is invalid",
  );
  assertHeroAsset(frontWheel.userData.animated_axis === "+X", "front wheel spin axis is invalid");
  assertHeroAsset(rearWheel.userData.animated_axis === "+X", "rear wheel spin axis is invalid");

  gltf.scene.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(root, true);
  assertHeroAsset(!bounds.isEmpty(), "render bounds are empty");
  const size = bounds.getSize(new THREE.Vector3());
  const finiteBounds = [
    bounds.min.x,
    bounds.min.y,
    bounds.min.z,
    bounds.max.x,
    bounds.max.y,
    bounds.max.z,
    size.x,
    size.y,
    size.z,
  ].every(Number.isFinite);
  assertHeroAsset(finiteBounds, "render bounds are not finite");
  assertHeroAsset(
    bounds.min.y >= -0.011 && bounds.min.y <= 0.03,
    "tire contact plane is invalid",
  );
  assertHeroAsset(
    size.x >= 0.8 && size.x <= 3.5,
    "asset width is outside the meter-scale envelope",
  );
  assertHeroAsset(
    size.y >= 1.6 && size.y <= 3.8,
    "asset height is outside the meter-scale envelope",
  );
  assertHeroAsset(
    size.z >= 2 && size.z <= 5,
    "asset length is outside the meter-scale envelope",
  );

  const frontAxle = frontWheel.getWorldPosition(new THREE.Vector3());
  const rearAxle = rearWheel.getWorldPosition(new THREE.Vector3());
  const frontWheelBounds = new THREE.Box3().setFromObject(frontWheel, true);
  const rearWheelBounds = new THREE.Box3().setFromObject(rearWheel, true);
  const wheelbase = frontAxle.distanceTo(rearAxle);
  assertHeroAsset(
    Math.abs(frontAxle.x) <= 0.2 && Math.abs(rearAxle.x) <= 0.2,
    "wheel axles are off-center",
  );
  assertHeroAsset(frontAxle.z < rearAxle.z, "front and rear wheels are reversed");
  assertHeroAsset(wheelbase >= 1.4 && wheelbase <= 4, "wheelbase is outside the meter-scale envelope");
  assertHeroAsset(
    Math.abs((frontAxle.z + rearAxle.z) * 0.5) <= 0.02,
    "the asset root is not centered between wheel contact patches",
  );
  assertHeroAsset(
    frontWheelBounds.min.y >= -0.011
      && frontWheelBounds.min.y <= 0.02
      && rearWheelBounds.min.y >= -0.011
      && rearWheelBounds.min.y <= 0.02,
    "both wheel assemblies must contact the local ground plane",
  );
  assertHeroAsset(
    frontAxle.y >= 0.4
      && frontAxle.y <= 1
      && rearAxle.y >= 0.4
      && rearAxle.y <= 1
      && Math.abs(frontAxle.y - rearAxle.y) <= 0.15,
    "wheel axle heights are invalid",
  );

  const seatAnchor = requiredNode("bike-seat-anchor").getWorldPosition(new THREE.Vector3());
  const leftHandAnchor = requiredNode("bike-left-hand-anchor").getWorldPosition(new THREE.Vector3());
  const rightHandAnchor = requiredNode("bike-right-hand-anchor").getWorldPosition(new THREE.Vector3());
  const leftBootAnchor = requiredNode("bike-left-boot-anchor").getWorldPosition(new THREE.Vector3());
  const rightBootAnchor = requiredNode("bike-right-boot-anchor").getWorldPosition(new THREE.Vector3());
  assertHeroAsset(
    leftHandAnchor.x < -0.05
      && rightHandAnchor.x > 0.05
      && leftBootAnchor.x < -0.05
      && rightBootAnchor.x > 0.05,
    "left/right contact anchors are reversed",
  );
  assertHeroAsset(
    Math.abs(leftHandAnchor.x + rightHandAnchor.x) <= 0.1
      && Math.abs(leftHandAnchor.y - rightHandAnchor.y) <= 0.1
      && Math.abs(leftHandAnchor.z - rightHandAnchor.z) <= 0.1
      && Math.abs(leftBootAnchor.x + rightBootAnchor.x) <= 0.1
      && Math.abs(leftBootAnchor.y - rightBootAnchor.y) <= 0.1
      && Math.abs(leftBootAnchor.z - rightBootAnchor.z) <= 0.1
      && Math.abs(seatAnchor.x) <= 0.05,
    "paired contact anchors must remain symmetric",
  );
  assertHeroAsset(
    leftHandAnchor.y > leftBootAnchor.y + 0.3
      && rightHandAnchor.y > rightBootAnchor.y + 0.3
      && seatAnchor.y > Math.max(leftBootAnchor.y, rightBootAnchor.y),
    "contact-anchor heights are invalid",
  );
  assertHeroAsset(
    seatAnchor.z > frontAxle.z && seatAnchor.z < rearAxle.z,
    "seat anchor must remain between the wheel axles",
  );

  return {
    root,
    bike,
    rider,
    frontWheel,
    rearWheel,
    rig: {
      torso: requiredNode("rider-torso-pivot"),
      head: requiredNode("rider-head-pivot"),
      leftArm: requiredNode("rider-left-arm-pivot"),
      rightArm: requiredNode("rider-right-arm-pivot"),
      leftLeg: requiredNode("rider-left-leg-pivot"),
      rightLeg: requiredNode("rider-right-leg-pivot"),
    },
    nodeCount: serializedNodes.length,
    meshCount,
    primitiveCount,
    materialCount: materials.size,
    textureCount: textures.size,
    triangleCount,
    bikeTriangleCount,
    riderTriangleCount,
    wheelTriangleCount,
  };
}

function assertRivalPackAsset(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Invalid rival pack asset: ${message}`);
}

function validateRivalPackAsset(gltf: GLTF): RivalPackNodes {
  assertRivalPackAsset(gltf.scenes.length === 1, "exactly one scene is required");
  assertRivalPackAsset(gltf.scene === gltf.scenes[0], "the sole scene must be active");
  assertRivalPackAsset(gltf.scene.name === RIVAL_PACK_SCENE_NAME, "the scene name is invalid");
  assertRivalPackAsset(gltf.animations.length === 0, "animations are not permitted");
  assertRivalPackAsset(gltf.cameras.length === 0, "cameras are not permitted");
  assertRivalPackAsset(hasIdentityTransform(gltf.scene), "the scene wrapper must be identity");

  const json = gltf.parser.json as SerializedHeroGltf;
  const scenes = json.scenes ?? [];
  const nodes = json.nodes ?? [];
  const buffers = json.buffers ?? [];
  const bufferViews = json.bufferViews ?? [];
  const accessors = json.accessors ?? [];
  const meshes = json.meshes ?? [];
  const images = json.images ?? [];
  const textures = json.textures ?? [];
  const materials = json.materials ?? [];
  assertRivalPackAsset(scenes.length === 1 && scenes[0]?.name === RIVAL_PACK_SCENE_NAME, "serialized scene");
  assertRivalPackAsset(nodes.length === RIVAL_PACK_MAX_NODES, "serialized node count");
  assertRivalPackAsset(meshes.length >= 8 && meshes.length <= RIVAL_PACK_MAX_MESHES, "serialized mesh budget");
  assertRivalPackAsset(materials.length === RIVAL_PACK_MATERIAL_NAMES.size, "serialized material count");
  assertRivalPackAsset(images.length === 1 && textures.length === 1, "number-field texture inventory");
  assertRivalPackAsset(buffers.every((buffer) => buffer.uri === undefined), "external buffers are prohibited");
  assertRivalPackAsset(
    images[0]?.uri === undefined
      && Number.isInteger(images[0]?.bufferView)
      && images[0]?.mimeType === "image/png",
    "the number-field image must be one embedded PNG",
  );
  assertRivalPackAsset(
    Number.isInteger(textures[0]?.source) && textures[0]?.extensions?.KHR_texture_basisu === undefined,
    "the number-field texture source is invalid",
  );
  assertRivalPackAsset((json.cameras ?? []).length === 0, "serialized cameras are prohibited");
  assertRivalPackAsset((json.skins ?? []).length === 0, "skins are prohibited");
  assertRivalPackAsset((json.animations ?? []).length === 0, "serialized animations are prohibited");
  const expectedExtensions = ["EXT_meshopt_compression", "KHR_mesh_quantization"].sort();
  assertRivalPackAsset(
    JSON.stringify([...(json.extensionsUsed ?? [])].sort()) === JSON.stringify(expectedExtensions),
    "used-extension set is invalid",
  );
  assertRivalPackAsset(
    JSON.stringify([...(json.extensionsRequired ?? [])].sort()) === JSON.stringify(expectedExtensions),
    "required-extension set is invalid",
  );

  let serializedPrimitiveCount = 0;
  for (const mesh of meshes) {
    assertRivalPackAsset(Array.isArray(mesh.primitives) && mesh.primitives.length > 0, "empty serialized mesh");
    serializedPrimitiveCount += mesh.primitives.length;
    for (const primitive of mesh.primitives) {
      assertRivalPackAsset(primitive.mode === undefined || primitive.mode === 4, "only triangles are permitted");
      assertRivalPackAsset(
        primitive.targets === undefined
          || (Array.isArray(primitive.targets) && primitive.targets.length === 0),
        "morph targets are prohibited",
      );
      assertRivalPackAsset(
        primitive.attributes !== null
          && typeof primitive.attributes === "object"
          && Number.isInteger(primitive.attributes.POSITION)
          && Number.isInteger(primitive.attributes.NORMAL),
        "POSITION and NORMAL are required",
      );
      const accessorIndices = [primitive.indices, ...Object.values(primitive.attributes)];
      for (const accessorIndex of accessorIndices) {
        assertRivalPackAsset(Number.isInteger(accessorIndex), "primitive accessor index is invalid");
        const accessor = accessors[Number(accessorIndex)];
        assertRivalPackAsset(accessor && Number.isInteger(accessor.bufferView), "primitive accessor is missing");
        assertRivalPackAsset(
          bufferViews[Number(accessor.bufferView)]?.extensions?.EXT_meshopt_compression !== undefined,
          "all geometry must use Meshopt compression",
        );
      }
    }
  }
  assertRivalPackAsset(
    serializedPrimitiveCount >= 8 && serializedPrimitiveCount <= RIVAL_PACK_MAX_PRIMITIVES,
    "serialized primitive budget",
  );

  const serializedNodeNames = nodes.map((node) => node.name);
  assertRivalPackAsset(
    serializedNodeNames.every((name) => typeof name === "string" && name.length > 0 && !/\.\d{3}$/u.test(name)),
    "stable serialized node names are required",
  );
  assertRivalPackAsset(new Set(serializedNodeNames).size === serializedNodeNames.length, "node names must be unique");
  assertRivalPackAsset(
    JSON.stringify([...serializedNodeNames].sort()) === JSON.stringify([...RIVAL_PACK_REQUIRED_NODE_NAMES].sort()),
    "serialized node inventory is invalid",
  );
  const materialNames = materials.map((material) => material.name);
  assertRivalPackAsset(
    materialNames.every((name) => typeof name === "string" && RIVAL_PACK_MATERIAL_NAMES.has(name)),
    "an unapproved material is present",
  );
  assertRivalPackAsset(new Set(materialNames).size === RIVAL_PACK_MATERIAL_NAMES.size, "material names must be unique");

  const requiredMatches = new Map<string, THREE.Object3D[]>();
  const decodedMaterials = new Set<THREE.Material>();
  const decodedTextures = new Set<THREE.Texture>();
  const geometries = new Set<THREE.BufferGeometry>();
  let meshCount = 0;
  let primitiveCount = 0;
  let triangleCount = 0;
  gltf.scene.traverse((object) => {
    assertRivalPackAsset(hasFiniteTransform(object), `${object.name || "unnamed node"} transform`);
    if (RIVAL_PACK_REQUIRED_NODE_NAME_SET.has(object.name)) {
      const matches = requiredMatches.get(object.name) ?? [];
      matches.push(object);
      requiredMatches.set(object.name, matches);
    }
    assertRivalPackAsset(!(object instanceof THREE.Camera), "scene cameras are prohibited");
    assertRivalPackAsset(!(object instanceof THREE.Light), "scene lights are prohibited");
    assertRivalPackAsset(!(object instanceof THREE.Bone), "bones are prohibited");
    assertRivalPackAsset(!(object instanceof THREE.SkinnedMesh), "skinned meshes are prohibited");
    if (!(object instanceof THREE.Mesh)) return;
    meshCount += 1;
    geometries.add(object.geometry);
    const position = object.geometry.getAttribute("position");
    const elementCount = object.geometry.index?.count ?? position?.count ?? 0;
    assertRivalPackAsset(elementCount > 0 && elementCount % 3 === 0, `${object.name} triangle coverage`);
    triangleCount += elementCount / 3;
    const objectMaterials = Array.isArray(object.material) ? object.material : [object.material];
    primitiveCount += Array.isArray(object.material)
      ? Math.max(1, object.geometry.groups.length)
      : 1;
    for (const material of objectMaterials) {
      assertRivalPackAsset(material instanceof THREE.MeshStandardMaterial, `${object.name} PBR material`);
      assertRivalPackAsset(RIVAL_PACK_MATERIAL_NAMES.has(material.name), `${object.name} material name`);
      assertRivalPackAsset(
        !material.transparent && material.opacity === 1 && material.alphaTest === 0 && material.depthWrite,
        `${material.name} must remain opaque`,
      );
      decodedMaterials.add(material);
      for (const value of Object.values(material)) {
        if (value instanceof THREE.Texture) decodedTextures.add(value);
      }
    }
  });
  assertRivalPackAsset(meshCount >= 8 && meshCount <= RIVAL_PACK_MAX_MESHES, "decoded mesh budget");
  assertRivalPackAsset(primitiveCount >= 8 && primitiveCount <= RIVAL_PACK_MAX_PRIMITIVES, "decoded primitive budget");
  assertRivalPackAsset(
    triangleCount >= RIVAL_PACK_MIN_TRIANGLES && triangleCount <= RIVAL_PACK_MAX_TRIANGLES,
    "decoded triangle budget",
  );
  assertRivalPackAsset(decodedMaterials.size === RIVAL_PACK_MATERIAL_NAMES.size, "decoded material count");
  assertRivalPackAsset(decodedTextures.size === 1, "decoded texture count");

  const requiredNode = (name: string): THREE.Object3D => {
    const matches = requiredMatches.get(name) ?? [];
    assertRivalPackAsset(matches.length === 1, `${name} must resolve exactly once`);
    return matches[0]!;
  };
  for (const [name, expectedParent] of Object.entries(RIVAL_PACK_PARENT_BY_NAME)) {
    const node = requiredNode(name);
    if (expectedParent === null) {
      assertRivalPackAsset(node.parent === gltf.scene, `${name} scene parent`);
    } else {
      assertRivalPackAsset(node.parent === requiredNode(expectedParent), `${name} parent`);
    }
  }
  const root = requiredNode(RIVAL_PACK_ROOT_NAME);
  const bike = requiredNode("RRR_RivalBikeVisual");
  const rider = requiredNode("rival-rider");
  const frontWheel = requiredNode("FrontTire");
  const rearWheel = requiredNode("RearTire");
  const numberField = requiredNode("BikeStatic_NumberField");
  assertRivalPackAsset(numberField instanceof THREE.Mesh, "number field mesh");
  assertRivalPackAsset(
    numberField.geometry.getAttribute("uv")?.count === numberField.geometry.getAttribute("position")?.count,
    "number field UV coverage",
  );
  assertRivalPackAsset(hasIdentityTransform(root), "root transform");
  assertRivalPackAsset(hasIdentityTransform(bike), "bike transform");
  assertRivalPackAsset(hasIdentityTransform(rider), "rider transform");
  for (const name of [
    "bike-steering-pivot",
    "bike-front-suspension-pivot",
    "bike-rear-suspension-pivot",
    "FrontTire",
    "RearTire",
    ...HERO_ASSET_POSE_PIVOT_NAMES,
  ]) {
    assertRivalPackAsset(hasNeutralRotationAndScale(requiredNode(name)), `${name} neutral transform`);
  }
  assertRivalPackAsset(root.userData.asset_root === true, "root provenance marker");
  assertRivalPackAsset(
    root.userData.asset_source === "Original project-authored Blender-native geometry",
    "root source marker",
  );
  assertRivalPackAsset(root.userData.source_schema === "rrr-rival-pack-v1", "root schema");
  assertRivalPackAsset(root.userData.contract === "docs/design/RIVAL_PACK_VERTICAL_SLICE.md", "root contract marker");
  assertRivalPackAsset(root.userData.gameplay_authority === "presentation-only", "root gameplay authority");
  assertRivalPackAsset(root.userData.shared_geometry === true, "shared-geometry marker");
  assertRivalPackAsset(root.userData.variant_numbers === RIVAL_PACK_VARIANT_NUMBERS.join(","), "variant marker");
  assertRivalPackAsset(bike.userData.presentation_only === true, "bike authority marker");
  assertRivalPackAsset(rider.userData.pose_pivot_count === HERO_ASSET_POSE_PIVOT_NAMES.length, "pose-pivot marker");
  assertRivalPackAsset(frontWheel.userData.animated_axis === "+X", "front wheel axis");
  assertRivalPackAsset(rearWheel.userData.animated_axis === "+X", "rear wheel axis");

  gltf.scene.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(root, true);
  const size = bounds.getSize(new THREE.Vector3());
  assertRivalPackAsset(!bounds.isEmpty() && [size.x, size.y, size.z].every(Number.isFinite), "bounds");
  assertRivalPackAsset(bounds.min.y >= -0.011 && bounds.min.y <= 0.03, "ground contact");
  assertRivalPackAsset(size.x >= 0.8 && size.x <= 3.2, "width envelope");
  assertRivalPackAsset(size.y >= 1.6 && size.y <= 3.5, "height envelope");
  assertRivalPackAsset(size.z >= 2 && size.z <= 4.5, "length envelope");
  const frontAxle = frontWheel.getWorldPosition(new THREE.Vector3());
  const rearAxle = rearWheel.getWorldPosition(new THREE.Vector3());
  assertRivalPackAsset(frontAxle.z < rearAxle.z, "wheel order");
  assertRivalPackAsset(frontAxle.distanceTo(rearAxle) >= 1.8, "wheelbase");

  return {
    root,
    bike,
    rider,
    frontWheel,
    rearWheel,
    rig: {
      torso: requiredNode("rider-torso-pivot"),
      head: requiredNode("rider-head-pivot"),
      leftArm: requiredNode("rider-left-arm-pivot"),
      rightArm: requiredNode("rider-right-arm-pivot"),
      leftLeg: requiredNode("rider-left-leg-pivot"),
      rightLeg: requiredNode("rider-right-leg-pivot"),
    },
    nodeCount: nodes.length,
    meshCount,
    primitiveCount,
    materialCount: decodedMaterials.size,
    textureCount: decodedTextures.size,
    triangleCount,
    geometries,
  };
}

const RIVAL_DIGIT_SEGMENTS: Readonly<Record<string, string>> = {
  "0": "abcdef",
  "1": "bc",
  "2": "abdeg",
  "3": "abcdg",
  "4": "bcfg",
  "5": "acdfg",
  "6": "acdefg",
  "7": "abc",
  "8": "abcdefg",
  "9": "abcdfg",
};
const RIVAL_SEGMENT_RECTS: Readonly<Record<string, readonly [number, number, number, number]>> = {
  a: [7, 4, 23, 7],
  b: [26, 8, 30, 25],
  c: [26, 34, 30, 51],
  d: [7, 50, 23, 53],
  e: [3, 34, 7, 51],
  f: [3, 8, 7, 25],
  g: [7, 27, 23, 31],
};

function createRivalNumberTexture(
  number: string,
  primaryColor: number,
  accentColor: number,
): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 64;
  const context = canvas.getContext("2d");
  assertRivalPackAsset(context, "number-field canvas is unavailable");
  context.fillStyle = `#${new THREE.Color(primaryColor).getHexString()}`;
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = `#${new THREE.Color(accentColor).getHexString()}`;
  context.fillRect(0, 0, canvas.width, 4);
  context.fillRect(0, canvas.height - 4, canvas.width, 4);
  context.fillRect(0, 0, 4, canvas.height);
  context.fillRect(canvas.width - 4, 0, 4, canvas.height);
  context.fillStyle = "#fff0bd";
  for (const [digitIndex, digit] of [...number].entries()) {
    const xOffset = 31 + digitIndex * 36;
    for (const segment of RIVAL_DIGIT_SEGMENTS[digit] ?? "") {
      const rectangle = RIVAL_SEGMENT_RECTS[segment];
      if (!rectangle) continue;
      const [left, top, right, bottom] = rectangle;
      context.fillRect(xOffset + left, top + 3, right - left + 1, bottom - top + 1);
    }
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.name = `rival-number-field-${number}`;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.flipY = false;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

function resolveRivalPackClone(
  root: THREE.Object3D,
  source: RivalPackNodes,
): RivalPackNodes {
  const byName = new Map<string, THREE.Object3D>();
  const geometries = new Set<THREE.BufferGeometry>();
  let meshCount = 0;
  let primitiveCount = 0;
  let triangleCount = 0;
  const materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();
  root.traverse((object) => {
    assertRivalPackAsset(!byName.has(object.name), `duplicate cloned node ${object.name}`);
    byName.set(object.name, object);
    if (!(object instanceof THREE.Mesh)) return;
    meshCount += 1;
    geometries.add(object.geometry);
    assertRivalPackAsset(source.geometries.has(object.geometry), "clone did not retain shared geometry");
    const position = object.geometry.getAttribute("position");
    triangleCount += (object.geometry.index?.count ?? position?.count ?? 0) / 3;
    const objectMaterials = Array.isArray(object.material) ? object.material : [object.material];
    primitiveCount += Array.isArray(object.material)
      ? Math.max(1, object.geometry.groups.length)
      : 1;
    objectMaterials.forEach((material) => {
      materials.add(material);
      for (const value of Object.values(material)) {
        if (value instanceof THREE.Texture) textures.add(value);
      }
    });
  });
  const required = (name: string): THREE.Object3D => {
    const node = byName.get(name);
    assertRivalPackAsset(node, `cloned node ${name} is missing`);
    return node;
  };
  assertRivalPackAsset(byName.size === source.nodeCount, "cloned node count changed");
  return {
    root,
    bike: required("RRR_RivalBikeVisual"),
    rider: required("rival-rider"),
    frontWheel: required("FrontTire"),
    rearWheel: required("RearTire"),
    rig: {
      torso: required("rider-torso-pivot"),
      head: required("rider-head-pivot"),
      leftArm: required("rider-left-arm-pivot"),
      rightArm: required("rider-right-arm-pivot"),
      leftLeg: required("rider-left-leg-pivot"),
      rightLeg: required("rider-right-leg-pivot"),
    },
    nodeCount: byName.size,
    meshCount,
    primitiveCount,
    materialCount: materials.size,
    textureCount: textures.size,
    triangleCount,
    geometries,
  };
}

function prepareRivalVariant(
  source: RivalPackNodes,
  primaryColor: number,
  accentColor: number,
  number: string,
): PreparedRivalVariant {
  const root = source.root.clone(true);
  const numberTexture = createRivalNumberTexture(number, primaryColor, accentColor);
  const replacements = new Map<THREE.Material, THREE.MeshStandardMaterial>();
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    const replace = (material: THREE.Material): THREE.Material => {
      const existing = replacements.get(material);
      if (existing) return existing;
      assertRivalPackAsset(material instanceof THREE.MeshStandardMaterial, "variant material is not PBR");
      const replacement = material.clone();
      replacement.name = material.name;
      if (material.name === "RRR_RivalPrimary") replacement.color.setHex(primaryColor);
      if (material.name === "RRR_RivalAccent") replacement.color.setHex(accentColor);
      if (material.name === "RRR_RivalNumberField") {
        replacement.color.setHex(0xffffff);
        replacement.map = numberTexture;
      }
      replacement.needsUpdate = true;
      replacements.set(material, replacement);
      return replacement;
    };
    object.material = Array.isArray(object.material)
      ? object.material.map(replace)
      : replace(object.material);
  });
  assertRivalPackAsset(
    new Set([...replacements.keys()].map((material) => material.name)).size
      === RIVAL_PACK_MATERIAL_NAMES.size,
    "variant material inventory is incomplete",
  );
  const nodes = resolveRivalPackClone(root, source);
  assertRivalPackAsset(
    nodes.meshCount === source.meshCount
      && nodes.primitiveCount === source.primitiveCount
      && nodes.materialCount === RIVAL_PACK_MATERIAL_NAMES.size
      && nodes.textureCount === 1
      && nodes.triangleCount === source.triangleCount
      && nodes.geometries.size === source.geometries.size,
    "variant render metrics changed",
  );
  root.position.set(0, RIVAL_PACK_VERTICAL_OFFSET, 0);
  root.updateMatrix();
  setShadow(root);
  nodes.rider.userData.posePivotCount = HERO_ASSET_POSE_PIVOT_NAMES.length;
  return { root, nodes, numberTexture };
}

function laneMatches(obstacle: TrackObstacle, lane: number): boolean {
  return obstacle.lanes.includes(lane as LaneIndex);
}

interface ProceduralObstacleVisualSet {
  readonly obstacle: TrackObstacle;
  readonly lap: number;
  readonly visuals: THREE.Object3D[];
}

function obstacleVisualKey(obstacleId: string, lap: number): string {
  return `${lap}:${obstacleId}`;
}

function retainedSpeedForContact(
  contact: ObstacleContactSection,
  policy: AiObstaclePolicy,
): number {
  return contact.parent.moduleId === "bump-row"
    ? Math.pow(policy.retainedSpeed, 1 / 4)
    : policy.retainedSpeed;
}

function hasFrontWheelClearance(bike: Pick<BikeState, "wheelie" | "pitch">): boolean {
  return bike.wheelie || bike.pitch >= FRONT_WHEEL_CLEAR_PITCH;
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
      obstacles: TUTORIAL_OBSTACLES,
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
  private readonly onFinishStart: () => void;
  private readonly onFinish: (result: RaceResult, replay: RaceReplayHandoff) => void;
  private readonly onFatal: (message: string) => void;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(54, 1, 0.1, 420);
  private readonly simulation: RaceSimulation;
  private readonly audio: AudioManager;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly webglContext: WebGLRenderingContext;
  private readonly engineInstanceId: string;
  private readonly player: THREE.Group;
  private readonly compressedAssetLoader: CompressedAssetLoader;
  private rivalAssetLoader: CompressedAssetLoader | null = null;
  private canyonAssetLoader: CompressedAssetLoader | null = null;
  private environmentRenderTarget: THREE.WebGLRenderTarget | null = null;
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
  private readonly proceduralObstacleVisuals = new Map<string, ProceduralObstacleVisualSet>();
  private sunLight: THREE.DirectionalLight | null = null;
  private heroKeyLight: THREE.SpotLight | null = null;
  private heroRimLight: THREE.SpotLight | null = null;
  private heroFillLight: THREE.PointLight | null = null;
  private highContrastTrackGuides: THREE.Group | null = null;

  private animationFrame = 0;
  private resizeObserver: ResizeObserver | null = null;
  private running = false;
  private paused = false;
  private finished = false;
  private finishFinalized = false;
  private finishClassification: FinishClassificationWork | null = null;
  private hudElapsed = 0;
  private lastBikePhase: BikePhase = "grounded";
  private lastLanding: LandingQuality = null;
  private lastHeatWarning = false;
  private lastOverheated = false;
  private lastHudInputDevice: InputDevice = "keyboard";
  private readonly riderPoseMemory = new WeakMap<THREE.Object3D, RiderPoseMemory>();
  private readonly wheelPoseMemory = new WeakMap<THREE.Object3D, WheelPoseMemory>();
  private playerLaneChangeLeanDirection: LaneChange = 0;
  private playerLaneChangeLeanSeconds = 0;
  private lastObstacleKey = "";
  private readonly handledObstacleKeys = new Set<string>();
  private cameraShake = 0;
  private cameraInitialized = false;
  private readonly replayRecorder = new ReplayRecorder(MAX_REPLAY_BYTES);
  private dustCursor = 0;
  private dustAccumulator = 0;
  private dustEventBurstCount = 0;
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
    this.engineInstanceId = String(++gameEngineInstanceCounter);
    this.canvas.dataset.engineInstanceId = this.engineInstanceId;
    this.visualQualificationFreeze = import.meta.env.VITE_QA_MODE === "1"
      && new URLSearchParams(window.location.search).has("qa-visual-freeze");
    this.canvas.dataset.bikeAsset = "loading";
    delete this.canvas.dataset.bikeFallbackReason;
    this.clearHeroBikeMetrics();
    this.canvas.dataset.rivalPackAsset = (["rival", "mastery"] as RaceMode[]).includes(options.mode)
      ? "loading"
      : "not-applicable";
    delete this.canvas.dataset.rivalPackFallbackReason;
    this.clearRivalPackMetrics();
    this.clearEnvironmentMetrics();
    this.canvas.dataset.environmentAsset = "loading";
    this.canvas.dataset.visualState = this.visualQualificationFreeze ? "loading" : "live";
    this.track = qaTrack(
      options.customTrack
        ? customTrackToDefinition(options.customTrack)
        : getTrack(options.trackId),
      options.mode,
    );
    this.canvas.dataset.canyonKitAsset = this.usesAuthoredCanyonKit() ? "loading" : "not-applicable";
    this.clearCanyonKitMetrics();
    this.canvas.dataset.groundedDustStyle = "soft-speed-reactive-twin-wheel-plume";
    this.canvas.dataset.groundedDustBurstCount = "0";
    this.visualProfile = WORLD_VISUAL_PROFILES[this.track.id];
    this.mode = options.mode;
    this.settings = options.settings;
    this.quality = resolveQuality(options.settings.quality);
    this.existingBestMs = options.existingBestMs;
    this.targetMs = options.mode === "mastery"
      ? getMasteryTargetMs(this.track.soloTargetMs, options.masteryLevel ?? 0)
      : this.track.soloTargetMs;
    this.onHud = options.onHud;
    this.onFinishStart = options.onFinishStart ?? (() => undefined);
    this.onFinish = options.onFinish;
    this.onFatal = options.onFatal;
    this.simulation = new RaceSimulation({
      checkpointCount: this.track.authoredCourse?.checkpoints.length ?? 3,
      totalLaps: options.mode === "tutorial" ? 1 : (options.customTrack?.laps ?? 2),
      initialHeat: import.meta.env.VITE_QA_MODE === "1"
        && new URLSearchParams(window.location.search).has("qa-near-overheat")
        ? 99
        : options.mode === "mastery"
          ? Math.min(65, 35 + (options.masteryLevel ?? 0) * 5)
          : 0,
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
      this.createPbrEnvironment();
      compressedAssetLoader = createCompressedAssetLoader(this.renderer);
      this.compressedAssetLoader = compressedAssetLoader;
      if (this.usesAuthoredRivalPack()) {
        this.rivalAssetLoader = createCompressedAssetLoader(this.renderer, { workerLimit: 1 });
      }
      if (this.usesAuthoredCanyonKit()) {
        this.canyonAssetLoader = createCompressedAssetLoader(this.renderer, { workerLimit: 1 });
      }
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
      this.canvas.dataset.riderPoseStyle = "action-state-six-pivot";
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
      this.rivalAssetLoader?.dispose();
      this.rivalAssetLoader = null;
      this.canyonAssetLoader?.dispose();
      this.canyonAssetLoader = null;
      this.audio.dispose();
      disposeObjectResources(this.scene, this.ownedTextures);
      this.scene.environment = null;
      this.environmentRenderTarget?.dispose();
      this.environmentRenderTarget = null;
      disposeShadowRenderTargets(this.sunLight);
      releaseRenderer(this.canvas, this.renderer, this.webglContext);
      throw error;
    }
    this.preparation = Promise.all([
      this.loadCompressedPlayerBike(),
      this.loadCompressedRivalPack(),
      this.loadCanyonKit(),
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
    this.replayRecorder.capture(this.simulation.snapshot);
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
    this.finishFinalized = false;
    this.finishClassification = null;
    this.hudElapsed = 0;
    this.lastBikePhase = "grounded";
    this.lastLanding = null;
    this.lastHeatWarning = false;
    this.lastOverheated = false;
    this.lastObstacleKey = "";
    this.handledObstacleKeys.clear();
    this.cameraShake = 0;
    this.cameraInitialized = false;
    this.replayRecorder.reset();
    this.replayRecorder.capture(this.simulation.snapshot);
    this.dustCursor = 0;
    this.dustAccumulator = 0;
    this.dustEventBurstCount = 0;
    this.canvas.dataset.groundedDustBurstCount = "0";
    this.crashes = 0;
    this.overheats = 0;
    this.caption = "";
    this.captionUntil = 0;
    this.tutorialRecoveryBarrierCrashPending = false;
    for (const particle of this.dustPool) {
      particle.life = 0;
      particle.maxLife = 0.58;
      particle.baseScale = 0.7;
      particle.baseOpacity = 0.42;
      particle.driftX = 0;
      particle.driftY = 0.42;
      particle.driftZ = 0;
      const material = Array.isArray(particle.mesh.material) ? particle.mesh.material[0] : particle.mesh.material;
      if (material instanceof THREE.MeshBasicMaterial) material.opacity = 0;
      particle.mesh.visible = false;
    }

    const state = this.simulation.snapshot;
    this.audio.updateEngine(0, false, state.bike.surface);
    this.emitHud(state);
    return true;
  }

  updateSettings(settings: GameSettings): void {
    this.settings = settings;
    this.simulation.setRetroRecovery(settings.controls.retroRecovery);
    this.input.updateSettings(settings.controls);
    this.audio.updateSettings(settings.audio);
    this.applyRendererAccessibility();
    const quality = resolveQuality(settings.quality);
    if (quality !== this.quality) {
      this.quality = quality;
      this.renderer.shadowMap.enabled = quality !== "low";
      this.renderer.shadowMap.type = THREE.PCFShadowMap;
      if (this.heroKeyLight) {
        this.heroKeyLight.intensity = heroKeyLightIntensity(quality);
        this.heroKeyLight.visible = this.heroKeyLight.intensity > 0;
      }
      if (this.heroRimLight) {
        this.heroRimLight.intensity = heroRimLightIntensity(quality);
        this.heroRimLight.visible = this.heroRimLight.intensity > 0;
      }
      if (this.heroFillLight) {
        this.heroFillLight.intensity = heroFillLightIntensity(quality);
        this.heroFillLight.visible = this.heroFillLight.intensity > 0;
      }
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

  private createPbrEnvironment(): void {
    let roomEnvironment: RoomEnvironment | null = null;
    let pmremGenerator: THREE.PMREMGenerator | null = null;
    try {
      roomEnvironment = new RoomEnvironment();
      pmremGenerator = new THREE.PMREMGenerator(this.renderer);
      const size = this.quality === "low" ? 64 : this.quality === "medium" ? 128 : 256;
      this.environmentRenderTarget = pmremGenerator.fromScene(
        roomEnvironment,
        0.04,
        0.1,
        100,
        { size },
      );
      this.scene.environment = this.environmentRenderTarget.texture;
      this.scene.environmentIntensity = this.quality === "high" ? 0.58 : this.quality === "medium" ? 0.48 : 0.34;
      this.canvas.dataset.pbrEnvironment = "pmrem";
    } catch {
      this.scene.environment = null;
      this.environmentRenderTarget?.dispose();
      this.environmentRenderTarget = null;
      this.canvas.dataset.pbrEnvironment = "direct-light-fallback";
    } finally {
      roomEnvironment?.dispose();
      pmremGenerator?.dispose();
    }
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
    this.rivalAssetLoader?.dispose();
    this.rivalAssetLoader = null;
    this.canyonAssetLoader?.dispose();
    this.canyonAssetLoader = null;
    this.proceduralObstacleVisuals.clear();
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
    this.scene.environment = null;
    this.environmentRenderTarget?.dispose();
    this.environmentRenderTarget = null;
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

  private clearHeroBikeMetrics(): void {
    delete this.canvas.dataset.heroBikeRoot;
    delete this.canvas.dataset.heroBikeRootCount;
    delete this.canvas.dataset.heroBikePosePivotCount;
    delete this.canvas.dataset.heroBikeNodeCount;
    delete this.canvas.dataset.heroBikeMeshCount;
    delete this.canvas.dataset.heroBikePrimitiveCount;
    delete this.canvas.dataset.heroBikeMaterialCount;
    delete this.canvas.dataset.heroBikeTextureCount;
    delete this.canvas.dataset.heroBikeTriangleCount;
    delete this.canvas.dataset.heroBikeBikeTriangleCount;
    delete this.canvas.dataset.heroBikeRiderTriangleCount;
    delete this.canvas.dataset.heroBikeWheelTriangleCount;
    delete this.canvas.dataset.heroBikeGameplayAuthority;
    delete this.canvas.dataset.heroBikeVerticalOffset;
    delete this.canvas.dataset.heroBikeMaterialResponse;
    delete this.canvas.dataset.heroBikeShadowStyle;
  }

  private recordHeroBikeMetrics(nodes: HeroBikeRiderNodes): void {
    this.canvas.dataset.heroBikeRoot = nodes.root.name;
    this.canvas.dataset.heroBikeRootCount = "1";
    this.canvas.dataset.heroBikePosePivotCount = String(HERO_ASSET_POSE_PIVOT_NAMES.length);
    this.canvas.dataset.heroBikeNodeCount = String(nodes.nodeCount);
    this.canvas.dataset.heroBikeMeshCount = String(nodes.meshCount);
    this.canvas.dataset.heroBikePrimitiveCount = String(nodes.primitiveCount);
    this.canvas.dataset.heroBikeMaterialCount = String(nodes.materialCount);
    this.canvas.dataset.heroBikeTextureCount = String(nodes.textureCount);
    this.canvas.dataset.heroBikeTriangleCount = String(nodes.triangleCount);
    this.canvas.dataset.heroBikeBikeTriangleCount = String(nodes.bikeTriangleCount);
    this.canvas.dataset.heroBikeRiderTriangleCount = String(nodes.riderTriangleCount);
    this.canvas.dataset.heroBikeWheelTriangleCount = String(nodes.wheelTriangleCount);
    this.canvas.dataset.heroBikeGameplayAuthority = "presentation-only";
    this.canvas.dataset.heroBikeVerticalOffset = String(HERO_ASSET_VERTICAL_OFFSET);
    this.canvas.dataset.heroBikeMaterialResponse = "pmrem-three-point";
    this.canvas.dataset.heroBikeShadowStyle = this.quality === "low" ? "pcf-disabled-low" : "pcf-contact";
  }

  private installHeroBikeRider(
    source: THREE.Object3D,
    nodes: HeroBikeRiderNodes,
  ): boolean {
    const previousBike = this.player.userData.bikeVisual;
    const previousRider = this.player.userData.riderVisual;
    const previousFrontWheel = this.player.userData.frontWheel;
    const previousBackWheel = this.player.userData.backWheel;
    const previousRig = this.player.userData.riderPoseRig;
    if (
      !(previousBike instanceof THREE.Object3D)
      || !(previousRider instanceof THREE.Object3D)
      || !(previousFrontWheel instanceof THREE.Object3D)
      || !(previousBackWheel instanceof THREE.Object3D)
      || !isRiderPoseRig(previousRig)
    ) return false;

    const previousBikeVisible = previousBike.visible;
    const previousRiderVisible = previousRider.visible;
    let sourceAdded = false;
    try {
      source.position.set(0, HERO_ASSET_VERTICAL_OFFSET, 0);
      source.updateMatrix();
      setFocalBikeShadows(source);
      tuneFocalBikeMaterialResponse(source, this.scene.environment);
      this.player.add(source);
      sourceAdded = true;

      this.player.userData.bikeVisual = nodes.bike;
      this.player.userData.riderVisual = nodes.rider;
      this.player.userData.frontWheel = nodes.frontWheel;
      this.player.userData.backWheel = nodes.rearWheel;
      this.player.userData.riderPoseRig = nodes.rig;
      nodes.rider.userData.posePivotCount = HERO_ASSET_POSE_PIVOT_NAMES.length;

      previousBike.visible = false;
      previousRider.visible = false;
      this.recordHeroBikeMetrics(nodes);
      this.canvas.dataset.bikeAsset = "ready";
      delete this.canvas.dataset.bikeFallbackReason;
      return true;
    } catch {
      this.player.userData.bikeVisual = previousBike;
      this.player.userData.riderVisual = previousRider;
      this.player.userData.frontWheel = previousFrontWheel;
      this.player.userData.backWheel = previousBackWheel;
      this.player.userData.riderPoseRig = previousRig;
      previousBike.visible = previousBikeVisible;
      previousRider.visible = previousRiderVisible;
      if (sourceAdded) source.removeFromParent();
      source.position.set(0, 0, 0);
      source.updateMatrix();
      this.clearHeroBikeMetrics();
      return false;
    }
  }

  private settleLoadedHeroBike(gltf: GLTF): void {
    if (this.disposed) {
      this.compressedAssetLoader.dispose();
      disposeObjectResources(gltf.scene);
      return;
    }

    let installed = false;
    let fallbackReason = "install-failed";
    try {
      const nodes = validateHeroBikeRiderAsset(gltf);
      installed = this.installHeroBikeRider(gltf.scene, nodes);
    } catch (error) {
      fallbackReason = error instanceof Error
        ? `contract-invalid: ${error.message}`
        : "contract-invalid";
    }
    this.compressedAssetLoader.dispose();
    if (installed) {
      if (this.caption.includes("safe built-in model active")) {
        this.caption = "Authored bike ready";
        this.captionUntil = this.simulation.snapshot.timeSeconds + 2.5;
        this.emitHud(this.simulation.snapshot);
      }
      return;
    }
    disposeObjectResources(gltf.scene);
    this.activateBuiltInBikeFallback(
      "Compressed bike unavailable — safe built-in model active",
      fallbackReason,
    );
  }

  private async loadCompressedPlayerBike(): Promise<void> {
    const shouldFailForQa = import.meta.env.VITE_QA_MODE === "1"
      && new URLSearchParams(window.location.search).has("qa-asset-failure");
    const loadOutcome = (shouldFailForQa
      ? Promise.reject(new Error("QA asset failure"))
      : this.compressedAssetLoader.load(HERO_BIKE_RIDER_URL)
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
      void loadOutcome.then((lateOutcome) => {
        if (lateOutcome.kind === "loaded") {
          this.settleLoadedHeroBike(lateOutcome.gltf);
          return;
        }
        this.compressedAssetLoader.dispose();
      });
      this.activateBuiltInBikeFallback(
        "Bike load timed out — safe built-in model active",
        "timeout",
      );
      return;
    }
    if (outcome.kind === "failed") {
      this.compressedAssetLoader.dispose();
      this.activateBuiltInBikeFallback(
        "Compressed bike unavailable — safe built-in model active",
        "load-failed",
      );
      return;
    }
    this.settleLoadedHeroBike(outcome.gltf);
  }

  private usesAuthoredRivalPack(): boolean {
    return (["rival", "mastery"] as RaceMode[]).includes(this.mode);
  }

  private clearRivalPackMetrics(): void {
    delete this.canvas.dataset.rivalPackRoot;
    delete this.canvas.dataset.rivalPackCloneCount;
    delete this.canvas.dataset.rivalPackNodeCount;
    delete this.canvas.dataset.rivalPackMeshCount;
    delete this.canvas.dataset.rivalPackPrimitiveCount;
    delete this.canvas.dataset.rivalPackMaterialCount;
    delete this.canvas.dataset.rivalPackTextureCount;
    delete this.canvas.dataset.rivalPackTriangleCount;
    delete this.canvas.dataset.rivalPackSharedGeometryCount;
    delete this.canvas.dataset.rivalPackGeometryInstanceCount;
    delete this.canvas.dataset.rivalPackGameplayAuthority;
    delete this.canvas.dataset.rivalPackVerticalOffset;
  }

  private recordRivalPackMetrics(nodes: RivalPackNodes): void {
    this.canvas.dataset.rivalPackRoot = nodes.root.name;
    this.canvas.dataset.rivalPackCloneCount = String(this.aiRiders.length);
    this.canvas.dataset.rivalPackNodeCount = String(nodes.nodeCount);
    this.canvas.dataset.rivalPackMeshCount = String(nodes.meshCount);
    this.canvas.dataset.rivalPackPrimitiveCount = String(nodes.primitiveCount);
    this.canvas.dataset.rivalPackMaterialCount = String(nodes.materialCount);
    this.canvas.dataset.rivalPackTextureCount = String(nodes.textureCount);
    this.canvas.dataset.rivalPackTriangleCount = String(nodes.triangleCount);
    this.canvas.dataset.rivalPackSharedGeometryCount = String(nodes.geometries.size);
    this.canvas.dataset.rivalPackGeometryInstanceCount = String(
      nodes.geometries.size * this.aiRiders.length,
    );
    this.canvas.dataset.rivalPackGameplayAuthority = "presentation-only";
    this.canvas.dataset.rivalPackVerticalOffset = String(RIVAL_PACK_VERTICAL_OFFSET);
  }

  private activateBuiltInRivalFallback(reason: string): void {
    if (this.disposed || !this.usesAuthoredRivalPack()) return;
    this.canvas.dataset.rivalPackAsset = "fallback";
    this.canvas.dataset.rivalBikeStyle = "shared-knobby-brake-panel-exhaust";
    this.clearRivalPackMetrics();
    this.canvas.dataset.rivalPackFallbackReason = reason;
  }

  private installRivalPack(source: RivalPackNodes): boolean {
    if (this.aiRiders.length !== AI_FIELD.length) return false;
    const prepared: PreparedRivalVariant[] = [];
    const disposePrepared = (): void => {
      const materials = new Set<THREE.Material>();
      for (const variant of prepared) {
        variant.root.removeFromParent();
        variant.root.traverse((object) => {
          if (!(object instanceof THREE.Mesh)) return;
          const objectMaterials = Array.isArray(object.material)
            ? object.material
            : [object.material];
          objectMaterials.forEach((material) => materials.add(material));
        });
        variant.numberTexture.dispose();
      }
      materials.forEach((material) => material.dispose());
    };

    try {
      for (const entrant of AI_FIELD) {
        prepared.push(prepareRivalVariant(
          source,
          entrant.color,
          entrant.accentColor,
          entrant.number,
        ));
      }
    } catch {
      disposePrepared();
      return false;
    }

    const previous = this.aiRiders.map((ai) => ({
      bike: ai.group.userData.bikeVisual as unknown,
      rider: ai.group.userData.riderVisual as unknown,
      frontWheel: ai.group.userData.frontWheel as unknown,
      rearWheel: ai.group.userData.backWheel as unknown,
      rig: ai.group.userData.riderPoseRig as unknown,
      bikeVisible: (ai.group.userData.bikeVisual as THREE.Object3D | undefined)?.visible ?? true,
      riderVisible: (ai.group.userData.riderVisual as THREE.Object3D | undefined)?.visible ?? true,
      detailStyle: ai.group.userData.bikeDetailStyle as unknown,
    }));
    if (previous.some((entry) => (
      !(entry.bike instanceof THREE.Object3D)
      || !(entry.rider instanceof THREE.Object3D)
      || !(entry.frontWheel instanceof THREE.Object3D)
      || !(entry.rearWheel instanceof THREE.Object3D)
      || !isRiderPoseRig(entry.rig)
    ))) {
      disposePrepared();
      return false;
    }

    let installedCount = 0;
    try {
      for (const [index, ai] of this.aiRiders.entries()) {
        const variant = prepared[index]!;
        ai.group.add(variant.root);
        installedCount += 1;
        ai.group.userData.bikeVisual = variant.nodes.bike;
        ai.group.userData.riderVisual = variant.nodes.rider;
        ai.group.userData.frontWheel = variant.nodes.frontWheel;
        ai.group.userData.backWheel = variant.nodes.rearWheel;
        ai.group.userData.riderPoseRig = variant.nodes.rig;
        ai.group.userData.bikeDetailStyle = "authored-shared-rival-pack";
      }
      for (const entry of previous) {
        (entry.bike as THREE.Object3D).visible = false;
        (entry.rider as THREE.Object3D).visible = false;
      }
      this.ownedTextures.push(...prepared.map((variant) => variant.numberTexture));
      this.recordRivalPackMetrics(source);
      this.canvas.dataset.rivalPackAsset = "ready";
      delete this.canvas.dataset.rivalPackFallbackReason;
      this.canvas.dataset.rivalBikeStyle = "authored-shared-rival-pack";
      return true;
    } catch {
      for (const [index, ai] of this.aiRiders.entries()) {
        const entry = previous[index]!;
        ai.group.userData.bikeVisual = entry.bike;
        ai.group.userData.riderVisual = entry.rider;
        ai.group.userData.frontWheel = entry.frontWheel;
        ai.group.userData.backWheel = entry.rearWheel;
        ai.group.userData.riderPoseRig = entry.rig;
        ai.group.userData.bikeDetailStyle = entry.detailStyle;
        (entry.bike as THREE.Object3D).visible = entry.bikeVisible;
        (entry.rider as THREE.Object3D).visible = entry.riderVisible;
      }
      for (let index = 0; index < installedCount; index += 1) {
        prepared[index]?.root.removeFromParent();
      }
      disposePrepared();
      this.clearRivalPackMetrics();
      return false;
    }
  }

  private settleLoadedRivalPack(loader: CompressedAssetLoader, gltf: GLTF): void {
    if (this.disposed) {
      loader.dispose();
      if (this.rivalAssetLoader === loader) this.rivalAssetLoader = null;
      disposeObjectResources(gltf.scene);
      return;
    }

    let installed = false;
    let fallbackReason = "install-failed";
    try {
      installed = this.installRivalPack(validateRivalPackAsset(gltf));
    } catch (error) {
      fallbackReason = error instanceof Error
        ? `contract-invalid: ${error.message}`
        : "contract-invalid";
    }
    loader.dispose();
    if (this.rivalAssetLoader === loader) this.rivalAssetLoader = null;
    if (installed) {
      // The five variants retain the decoded BufferGeometry instances, but
      // every material and number texture has been replaced by an owned clone.
      disposeObjectMaterialResources(gltf.scene);
    } else {
      disposeObjectResources(gltf.scene);
      this.activateBuiltInRivalFallback(fallbackReason);
    }
  }

  private async loadCompressedRivalPack(): Promise<void> {
    const loader = this.rivalAssetLoader;
    if (!loader) return;
    const shouldFailForQa = import.meta.env.VITE_QA_MODE === "1"
      && new URLSearchParams(window.location.search).has("qa-rival-asset-failure");
    const loadOutcome = (shouldFailForQa
      ? Promise.reject(new Error("QA rival asset failure"))
      : loader.load(RIVAL_PACK_URL)
    ).then(
      (gltf) => ({ kind: "loaded" as const, gltf }),
      () => ({ kind: "failed" as const }),
    );
    let deadlineTimer = 0;
    const deadline = new Promise<{ kind: "timeout" }>((resolve) => {
      deadlineTimer = window.setTimeout(
        () => resolve({ kind: "timeout" }),
        RIVAL_PACK_READINESS_TIMEOUT_MS,
      );
    });
    const outcome = await Promise.race([loadOutcome, deadline]);
    window.clearTimeout(deadlineTimer);

    if (outcome.kind === "timeout") {
      this.activateBuiltInRivalFallback("timeout");
      void loadOutcome.then((lateOutcome) => {
        if (lateOutcome.kind === "loaded") {
          this.settleLoadedRivalPack(loader, lateOutcome.gltf);
          return;
        }
        loader.dispose();
        if (this.rivalAssetLoader === loader) this.rivalAssetLoader = null;
      });
      return;
    }
    if (outcome.kind === "failed") {
      loader.dispose();
      if (this.rivalAssetLoader === loader) this.rivalAssetLoader = null;
      this.activateBuiltInRivalFallback("load-failed");
      return;
    }
    this.settleLoadedRivalPack(loader, outcome.gltf);
  }

  private usesAuthoredCanyonKit(): boolean {
    return this.track.id === "canyon-kickoff" && this.track.authoredCourse === undefined;
  }

  private clearCanyonKitMetrics(): void {
    delete this.canvas.dataset.canyonKitRootCount;
    delete this.canvas.dataset.canyonKitPlacementCount;
    delete this.canvas.dataset.canyonKitMeshCount;
    delete this.canvas.dataset.canyonKitGameplayAuthority;
    delete this.canvas.dataset.canyonKitProceduralReplacementCount;
    delete this.canvas.dataset.canyonKitReplacedProceduralVisualCount;
    delete this.canvas.dataset.canyonKitRetainedCoolingCueCount;
    delete this.canvas.dataset.canyonKitCoolingGateStyle;
    delete this.canvas.dataset.canyonKitCoolingGateArchCount;
    delete this.canvas.dataset.canyonKitTabletopRole;
  }

  private activateCanyonKitFallback(): void {
    if (this.disposed) return;
    this.canvas.dataset.canyonKitAsset = "procedural-fallback";
    this.clearCanyonKitMetrics();
  }

  private async loadCanyonKit(): Promise<void> {
    if (!this.usesAuthoredCanyonKit()) {
      this.canvas.dataset.canyonKitAsset = "not-applicable";
      return;
    }
    const loader = this.canyonAssetLoader;
    if (!loader) {
      this.activateCanyonKitFallback();
      return;
    }
    const shouldFailForQa = import.meta.env.VITE_QA_MODE === "1"
      && new URLSearchParams(window.location.search).has("qa-canyon-asset-failure");
    const loadOutcome = (shouldFailForQa
      ? Promise.reject(new Error("QA Canyon asset failure"))
      : loader.load(CANYON_KIT_URL)
    ).then(
      (gltf) => ({ kind: "loaded" as const, gltf }),
      () => ({ kind: "failed" as const }),
    );
    let deadlineTimer = 0;
    const deadline = new Promise<{ kind: "timeout" }>((resolve) => {
      deadlineTimer = window.setTimeout(
        () => resolve({ kind: "timeout" }),
        CANYON_KIT_READINESS_TIMEOUT_MS,
      );
    });
    const outcome = await Promise.race([loadOutcome, deadline]);
    window.clearTimeout(deadlineTimer);

    if (this.disposed) {
      loader.dispose();
      if (this.canyonAssetLoader === loader) this.canyonAssetLoader = null;
      if (outcome.kind === "loaded") {
        disposeObjectResources(outcome.gltf.scene);
      } else if (outcome.kind === "timeout") {
        void loadOutcome.then((lateOutcome) => {
          if (lateOutcome.kind === "loaded") disposeObjectResources(lateOutcome.gltf.scene);
        });
      }
      return;
    }

    if (outcome.kind === "timeout") {
      loader.dispose();
      if (this.canyonAssetLoader === loader) this.canyonAssetLoader = null;
      void loadOutcome.then((lateOutcome) => {
        if (lateOutcome.kind === "loaded") disposeObjectResources(lateOutcome.gltf.scene);
      });
      this.activateCanyonKitFallback();
      return;
    }
    if (outcome.kind === "failed") {
      loader.dispose();
      if (this.canyonAssetLoader === loader) this.canyonAssetLoader = null;
      this.activateCanyonKitFallback();
      return;
    }

    let installed: boolean;
    try {
      installed = this.installCanyonKit(outcome.gltf.scene);
    } catch {
      installed = false;
    }
    loader.dispose();
    if (this.canyonAssetLoader === loader) this.canyonAssetLoader = null;
    if (!installed) {
      disposeObjectResources(outcome.gltf.scene);
      this.activateCanyonKitFallback();
      return;
    }
    this.canvas.dataset.canyonKitAsset = "ready";
  }

  private installCanyonKit(source: THREE.Group): boolean {
    const rootNames = [
      "CYN_CoolingGate_A",
      "CYN_WheelieBarrier_A",
      "CYN_TabletopRamp_A",
      "CYN_RockCluster_A",
      "CYN_Pine_A",
      "CYN_DesertPlants_A",
      "CYN_SpectatorStand_A",
      "CYN_FestivalTent_A",
      "CYN_Workshop_A",
      "CYN_MarshalTower_A",
      "CYN_ServiceProps_A",
    ] as const;
    const roots = new Map<string, THREE.Object3D>();
    for (const name of rootNames) {
      const asset = source.getObjectByName(name);
      if (!asset) return false;
      roots.set(name, asset);
    }

    interface Placement {
      readonly asset: typeof rootNames[number];
      readonly progress: number;
      readonly lateral: number;
      readonly elevation?: number;
      readonly rotationY?: number;
      readonly scale?: number | readonly [number, number, number];
      readonly replacementKey?: string;
    }
    const placements: Placement[] = [];
    const totalLaps = this.simulation.snapshot.race.totalLaps;
    const tabletopTarget = this.track.obstacles.find((obstacle) => obstacle.kind === "medium-ramp")
      ?? this.track.obstacles.find((obstacle) => obstacle.kind === "small-ramp")
      ?? this.track.obstacles.find((obstacle) => obstacle.kind === "large-ramp");
    for (let lap = 0; lap < totalLaps; lap += 1) {
      const lapProgress = lap * this.track.courseLength;
      for (const obstacle of this.track.obstacles) {
        const replacementKey = obstacleVisualKey(obstacle.id, lap);
        if (obstacle.kind === "cooling-gate") {
          for (const lane of obstacle.lanes) {
            placements.push({
              asset: "CYN_CoolingGate_A",
              progress: lapProgress + obstacle.distance,
              lateral: LANE_POSITIONS[lane],
              elevation: 0.02,
              scale: [0.58, 1, 1],
              replacementKey,
            });
          }
        } else if (obstacle.kind === "barrier") {
          for (const lane of obstacle.lanes) {
            placements.push({
              asset: "CYN_WheelieBarrier_A",
              progress: lapProgress + obstacle.distance,
              lateral: LANE_POSITIONS[lane],
              elevation: 0.02,
              scale: [2.45 / 3.8, 0.84, 0.84],
              replacementKey,
            });
          }
        }
      }
      if (tabletopTarget) {
        const lanePositions = tabletopTarget.lanes.map((lane) => LANE_POSITIONS[lane]);
        const minimum = Math.min(...lanePositions);
        const maximum = Math.max(...lanePositions);
        const visualWidth = maximum - minimum + 2.45;
        const visualLength = resolveObstacleContacts(tabletopTarget)[0]?.length ?? 8;
        const visualHeight = tabletopTarget.kind === "small-ramp" ? 1.05
          : tabletopTarget.kind === "medium-ramp" ? 1.75
            : 2.65;
        placements.push({
          asset: "CYN_TabletopRamp_A",
          progress: lapProgress + tabletopTarget.distance,
          lateral: (minimum + maximum) / 2,
          elevation: 0.02,
          scale: [visualWidth / 5.9, visualHeight / 1.55, visualLength / 8.35],
          replacementKey: obstacleVisualKey(tabletopTarget.id, lap),
        });
      }
    }

    const decorativePlacements: Placement[] = [
      { asset: "CYN_FestivalTent_A", progress: 36, lateral: 12.6, rotationY: Math.PI / 2, scale: 1.02 },
      { asset: "CYN_FestivalTent_A", progress: 48, lateral: -12.6, rotationY: -Math.PI / 2, scale: 0.98 },
      { asset: "CYN_SpectatorStand_A", progress: 54, lateral: 13.2, rotationY: Math.PI / 2, scale: 1.14 },
      { asset: "CYN_SpectatorStand_A", progress: 68, lateral: -13.2, rotationY: -Math.PI / 2, scale: 1.18 },
      { asset: "CYN_ServiceProps_A", progress: 86, lateral: 11.4, rotationY: Math.PI / 2, scale: 0.94 },
      { asset: "CYN_Workshop_A", progress: 270, lateral: 15.2, rotationY: Math.PI / 2, scale: 1.05 },
      { asset: "CYN_MarshalTower_A", progress: 360, lateral: -12.8, rotationY: -Math.PI / 2, scale: 0.92 },
      { asset: "CYN_ServiceProps_A", progress: 181, lateral: 11.8, rotationY: Math.PI / 2, scale: 0.88 },
      { asset: "CYN_RockCluster_A", progress: 110, lateral: -17.2, rotationY: 0.42, scale: 1.45 },
      { asset: "CYN_RockCluster_A", progress: 318, lateral: 16.4, rotationY: -0.28, scale: 1.12 },
      { asset: "CYN_DesertPlants_A", progress: 96, lateral: 12.2, rotationY: -0.25, scale: 0.86 },
      { asset: "CYN_DesertPlants_A", progress: 286, lateral: -13.4, rotationY: 0.38, scale: 1.04 },
    ];
    if (this.quality !== "low") {
      decorativePlacements.push(
        { asset: "CYN_SpectatorStand_A", progress: 484, lateral: 14.6, rotationY: Math.PI / 2, scale: 1.02 },
        { asset: "CYN_FestivalTent_A", progress: 612, lateral: -14.8, rotationY: -Math.PI / 2, scale: 0.9 },
        { asset: "CYN_MarshalTower_A", progress: 720, lateral: 12.9, rotationY: Math.PI / 2, scale: 0.88 },
      { asset: "CYN_RockCluster_A", progress: 548, lateral: -17.1, rotationY: 0.7, scale: 1.26 },
        { asset: "CYN_FestivalTent_A", progress: 532, lateral: 11.8, rotationY: Math.PI / 2, scale: 0.96 },
        { asset: "CYN_SpectatorStand_A", progress: 566, lateral: -17.2, rotationY: -Math.PI / 2, scale: 1.08 },
        { asset: "CYN_DesertPlants_A", progress: 586, lateral: 10.7, rotationY: -0.22, scale: 0.92 },
        { asset: "CYN_Pine_A", progress: 438, lateral: -18.2, rotationY: 0.15, scale: 1.05 },
      );
    }
    if (this.quality === "high") {
      decorativePlacements.push(
        { asset: "CYN_ServiceProps_A", progress: 604, lateral: -11.7, rotationY: -Math.PI / 2, scale: 0.82 },
        { asset: "CYN_RockCluster_A", progress: 824, lateral: 16.8, rotationY: -0.55, scale: 1.18 },
        { asset: "CYN_DesertPlants_A", progress: 1012, lateral: 13.9, rotationY: 0.22, scale: 0.92 },
      );
    }
    const structuralDecor = new Set<Placement["asset"]>([
      "CYN_SpectatorStand_A",
      "CYN_FestivalTent_A",
      "CYN_Workshop_A",
      "CYN_MarshalTower_A",
    ]);
    const festivalPocketPositions = resolveFestivalPocketPlacements({
      handcraftedCanyon: true,
      quality: this.quality,
      totalLength: this.track.courseLength * totalLaps + 120,
      trackOrder: this.track.order,
      coolingGateDistances: this.track.obstacles
        .filter((obstacle) => obstacle.kind === "cooling-gate")
        .map((obstacle) => obstacle.distance),
    }).pocketPlacements.map((pocket) => {
      const position = new THREE.Vector3();
      this.courseRoute.sample(-pocket.z, pocket.x, 0, position);
      return position;
    });
    const structuralPosition = new THREE.Vector3();
    for (let lap = 0; lap < totalLaps; lap += 1) {
      const lapProgress = lap * this.track.courseLength;
      for (const placement of decorativePlacements) {
        const progress = lapProgress + placement.progress;
        if (structuralDecor.has(placement.asset)) {
          this.courseRoute.sample(progress, placement.lateral, placement.elevation ?? 0, structuralPosition);
          if (festivalPocketPositions.some((pocket) => (
            structuralPosition.distanceTo(pocket) < FESTIVAL_SHOWCASE_CLEARANCE
          ))) return false;
        }
        placements.push({ ...placement, progress });
      }
    }

    const replacementKeys = new Set(
      placements.flatMap((placement) => placement.replacementKey ? [placement.replacementKey] : []),
    );
    const coolingGateArchCount = placements.filter(
      (placement) => placement.asset === "CYN_CoolingGate_A",
    ).length;
    for (const replacementKey of replacementKeys) {
      if ((this.proceduralObstacleVisuals.get(replacementKey)?.visuals.length ?? 0) === 0) return false;
    }

    const group = new THREE.Group();
    group.name = "authored-canyon-modular-kit";
    let meshCount = 0;
    for (const [index, placement] of placements.entries()) {
      const sourceRoot = roots.get(placement.asset);
      if (!sourceRoot) return false;
      const clone = sourceRoot.clone(true);
      clone.name = `${placement.asset}_Placement_${index + 1}`;
      clone.userData.replacesProceduralObstacle = placement.replacementKey ?? null;
      if (placement.asset === "CYN_CoolingGate_A") {
        // The former four-lane stretch turned this translucent volume into an
        // opaque wall. Lane-sized arches stay open and retain the separate,
        // shape-coded snowflake cue supplied by the gameplay visual.
        const coolingField = clone.getObjectByName("Gate_CoolingField");
        if (coolingField) coolingField.visible = false;
      }
      clone.position.set(
        placement.lateral,
        placement.elevation ?? 0,
        -placement.progress,
      );
      clone.rotation.y = placement.rotationY ?? 0;
      if (typeof placement.scale === "number") {
        clone.scale.setScalar(placement.scale);
      } else if (placement.scale) {
        clone.scale.set(...placement.scale);
      }
      clone.traverse((object) => {
        if (!(object instanceof THREE.Mesh)) return;
        meshCount += 1;
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        const transparent = materials.some((material) => material.transparent);
        object.castShadow = this.quality !== "low" && !transparent;
        object.receiveShadow = !transparent;
      });
      this.applyCourseTransform(clone);
      group.add(clone);
    }
    const visibilitySnapshot = new Map<THREE.Object3D, boolean>();
    let replacedProceduralVisualCount = 0;
    let retainedCoolingCueCount = 0;
    try {
      this.scene.add(group);
      for (const replacementKey of replacementKeys) {
        const visualSet = this.proceduralObstacleVisuals.get(replacementKey);
        if (!visualSet) continue;
        for (const visual of visualSet.visuals) {
          replacedProceduralVisualCount += 1;
          if (visualSet.obstacle.kind === "cooling-gate") {
            for (const child of visual.children) {
              visibilitySnapshot.set(child, child.visible);
              child.visible = child.name === "cooling-gate-snowflake-cue";
              if (child.visible) retainedCoolingCueCount += 1;
            }
          } else {
            visibilitySnapshot.set(visual, visual.visible);
            visual.visible = false;
          }
        }
      }
      this.canvas.dataset.canyonKitRootCount = String(rootNames.length);
      this.canvas.dataset.canyonKitPlacementCount = String(placements.length);
      this.canvas.dataset.canyonKitMeshCount = String(meshCount);
      this.canvas.dataset.canyonKitGameplayAuthority = "presentation-only";
      this.canvas.dataset.canyonKitProceduralReplacementCount = String(replacementKeys.size);
      this.canvas.dataset.canyonKitReplacedProceduralVisualCount = String(replacedProceduralVisualCount);
      this.canvas.dataset.canyonKitRetainedCoolingCueCount = String(retainedCoolingCueCount);
      this.canvas.dataset.canyonKitCoolingGateStyle = "per-lane-open-arch";
      this.canvas.dataset.canyonKitCoolingGateArchCount = String(coolingGateArchCount);
      this.canvas.dataset.canyonKitTabletopRole = "gameplay-ramp-shell";
      return true;
    } catch {
      for (const [object, visible] of visibilitySnapshot) object.visible = visible;
      group.removeFromParent();
      this.clearCanyonKitMetrics();
      return false;
    }
  }

  private async loadCanyonFestivalPanorama(): Promise<void> {
    if (this.track.id !== "canyon-kickoff" || this.track.authoredCourse !== undefined) {
      this.markEnvironmentNotApplicable();
      return;
    }
    if (typeof createImageBitmap !== "function") {
      this.activateEnvironmentFallback("unsupported", 0);
      return;
    }

    const loadStartedAt = performance.now();
    const elapsedLoadMs = () => Math.max(0, Math.round(performance.now() - loadStartedAt));
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
      this.activateEnvironmentFallback("timeout", elapsedLoadMs());
      void loadOutcome.then((lateOutcome) => {
        if (this.environmentImageLoader === loader) this.environmentImageLoader = null;
        if (lateOutcome.kind !== "loaded") return;
        this.activateEnvironmentBitmap(lateOutcome.bitmap, elapsedLoadMs());
      });
      return;
    }
    this.environmentImageLoader = null;
    if (outcome.kind === "failed") {
      this.activateEnvironmentFallback("load-failed", elapsedLoadMs());
      return;
    }
    if (this.disposed) {
      outcome.bitmap.close();
      return;
    }
    this.activateEnvironmentBitmap(outcome.bitmap, elapsedLoadMs());
  }

  private activateEnvironmentBitmap(bitmap: ImageBitmap, loadMs: number): void {
    if (this.disposed || !this.ownsCanvasDiagnostics()) {
      bitmap.close();
      return;
    }
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
    this.canvas.dataset.environmentLoadMs = String(loadMs);
    delete this.canvas.dataset.environmentFallbackReason;
    this.canvas.dataset.environmentWidth = String(bitmap.width);
    this.canvas.dataset.environmentHeight = String(bitmap.height);
  }

  private activateEnvironmentFallback(
    reason: "unsupported" | "load-failed" | "timeout",
    loadMs: number,
  ): void {
    if (this.disposed || !this.ownsCanvasDiagnostics()) return;
    this.canvas.dataset.environmentAsset = "fallback";
    this.canvas.dataset.environmentFallbackReason = reason;
    this.canvas.dataset.environmentLoadMs = String(loadMs);
    delete this.canvas.dataset.environmentWidth;
    delete this.canvas.dataset.environmentHeight;
  }

  private clearEnvironmentMetrics(): void {
    clearCanvasDatasetAttribute(this.canvas, "environmentFallbackReason");
    clearCanvasDatasetAttribute(this.canvas, "environmentLoadMs");
    clearCanvasDatasetAttribute(this.canvas, "environmentWidth");
    clearCanvasDatasetAttribute(this.canvas, "environmentHeight");
  }

  private markEnvironmentNotApplicable(): void {
    const clearIfCurrent = () => {
      if (this.disposed || !this.ownsCanvasDiagnostics()) return;
      this.clearEnvironmentMetrics();
      this.canvas.dataset.environmentAsset = "not-applicable";
    };
    clearIfCurrent();
    window.requestAnimationFrame(clearIfCurrent);
    window.setTimeout(clearIfCurrent, 0);
    window.setTimeout(clearIfCurrent, 120);
  }

  private ownsCanvasDiagnostics(): boolean {
    return this.canvas.dataset.engineInstanceId === this.engineInstanceId;
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
    // Canyon already has a production-painted skyline. Crop a small amount of
    // empty zenith so its layered mesas sit in the midground instead of hiding
    // entirely behind the route-following cut banks.
    texture.repeat.y *= 0.84;
    texture.updateMatrix();
  }

  private activateBuiltInBikeFallback(caption: string, reason: string): void {
    if (this.disposed) return;
    this.canvas.dataset.bikeAsset = "fallback";
    this.canvas.dataset.bikeFallbackReason = reason;
    this.clearHeroBikeMetrics();
    this.caption = caption;
    this.captionUntil = this.simulation.snapshot.timeSeconds + 6;
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

    if (!this.visualQualificationFreeze && this.finished && !this.finishFinalized) {
      this.continueFinishClassification();
    }
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
    if (
      input.laneChange !== 0
      && state.bike.phase === "grounded"
      && !this.settings.accessibility.reducedMotion
    ) {
      this.playerLaneChangeLeanDirection = input.laneChange;
      this.playerLaneChangeLeanSeconds = RIDER_LANE_CHANGE_LEAN_HOLD_SECONDS;
    }

    if (state.race.finished) this.finishRace();
    this.updateDust(delta, state);
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
      this.updateAi(this.simulation.snapshot);
      const playerState = this.simulation.snapshot;
      this.processBikeEvents(playerState);
      this.captureDemonstratedMechanics(before, playerState, input);
      const replayState = this.simulation.snapshot;
      if (replayState.race.finished) this.replayRecorder.finalize(replayState);
      else this.replayRecorder.capture(replayState);
      fixedSteps += 1;

      if (replayState.race.finished || this.paused) break;
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
    bike: SimulationState["bike"],
    lean: number,
    reducedMotion: boolean,
    delta: number,
  ): ResolvedRiderPose {
    let memory = this.riderPoseMemory.get(rider);
    if (!memory) {
      memory = {
        previousPhase: bike.phase,
        previousLanding: bike.lastLanding,
        landingAgeSeconds: Number.POSITIVE_INFINITY,
        presentationRecoveryProgress: 0,
        pose: createResolvedRiderPose(),
      };
      this.riderPoseMemory.set(rider, memory);
    }

    const landed = bike.phase === "grounded"
      && bike.lastLanding !== null
      && (
        memory.previousPhase === "airborne"
        || memory.previousLanding === null
      );
    if (landed) {
      memory.landingAgeSeconds = 0;
    } else if (Number.isFinite(memory.landingAgeSeconds)) {
      memory.landingAgeSeconds += delta;
    }
    if (bike.phase === "airborne") {
      memory.previousLanding = null;
      memory.landingAgeSeconds = Number.POSITIVE_INFINITY;
    } else {
      memory.previousLanding = bike.lastLanding;
    }
    if (bike.phase === "crashed" || bike.phase === "recovering") {
      memory.landingAgeSeconds = Number.POSITIVE_INFINITY;
    }
    memory.previousPhase = bike.phase;

    memory.presentationRecoveryProgress = resolvePresentationRecoveryProgress(
      bike.phase,
      bike.recoveryProgress,
      memory.presentationRecoveryProgress,
      delta,
    );

    const pose = resolveRiderPose({
      speed: bike.speed,
      progress: bike.forwardPosition,
      phase: bike.phase,
      pitch: bike.pitch,
      lean,
      height: bike.height,
      wheelie: bike.wheelie,
      recoveryProgress: memory.presentationRecoveryProgress,
      landingAgeSeconds: memory.landingAgeSeconds,
      lastLanding: bike.lastLanding,
      reducedMotion,
    }, memory.pose);
    const riderVisual = rider.userData.riderVisual as THREE.Object3D | undefined;
    if (!riderVisual) return pose;
    const rig = rider.userData.riderPoseRig as RiderPoseRig | undefined;
    riderVisual.rotation.set(
      pose.rootRotationX,
      pose.rootRotationY,
      pose.rootRotationZ,
    );
    riderVisual.position.set(
      pose.rootPositionX,
      pose.rootPositionY,
      pose.rootPositionZ,
    );
    if (rig) {
      rig.torso.rotation.set(...pose.rig.torso);
      rig.head.rotation.set(...pose.rig.head);
      rig.leftArm.rotation.set(...pose.rig.leftArm);
      rig.rightArm.rotation.set(...pose.rig.rightArm);
      rig.leftLeg.rotation.set(...pose.rig.leftLeg);
      rig.rightLeg.rotation.set(...pose.rig.rightLeg);
    }

    const frontWheel = rider.userData.frontWheel as THREE.Object3D | undefined;
    const rearWheel = rider.userData.backWheel as THREE.Object3D | undefined;
    if (frontWheel && rearWheel) {
      let wheelMemory = this.wheelPoseMemory.get(rider);
      if (
        !wheelMemory
        || wheelMemory.frontWheel !== frontWheel
        || wheelMemory.rearWheel !== rearWheel
      ) {
        wheelMemory = {
          frontWheel,
          rearWheel,
          frontRestPosition: frontWheel.position.clone(),
          rearRestPosition: rearWheel.position.clone(),
        };
        this.wheelPoseMemory.set(rider, wheelMemory);
      }
      frontWheel.position.copy(wheelMemory.frontRestPosition);
      rearWheel.position.copy(wheelMemory.rearRestPosition);
      frontWheel.position.y += pose.frontSuspensionCompression;
      rearWheel.position.y += pose.rearSuspensionCompression;
    }
    return pose;
  }

  private recordQaPlayerMotionSnapshot(
    bike: SimulationState["bike"],
    steeringRoll: number,
    presentationPitch: number,
    reducedMotion: boolean,
    pose: ResolvedRiderPose,
  ): void {
    const state = this.simulation.snapshot;
    const bikeVisual = this.player.userData.bikeVisual as THREE.Object3D;
    const riderVisual = this.player.userData.riderVisual as THREE.Object3D;
    const frontWheel = this.player.userData.frontWheel as THREE.Object3D;
    const rearWheel = this.player.userData.backWheel as THREE.Object3D;
    const rig = this.player.userData.riderPoseRig as RiderPoseRig;
    const round = (value: number) => Number(value.toFixed(4));
    const rotation = (object: THREE.Object3D) => [
      round(object.rotation.x),
      round(object.rotation.y),
      round(object.rotation.z),
    ];
    const landingAgeSeconds = this.riderPoseMemory.get(this.player)?.landingAgeSeconds;
    const steeringDirection = bike.phase === "crashed" || bike.phase === "recovering"
      ? "none"
      : steeringRoll > 0.02
        ? "left"
        : steeringRoll < -0.02
          ? "right"
          : "none";

    this.canvas.dataset.playerMotionSnapshot = JSON.stringify({
      asset: this.canvas.dataset.bikeAsset ?? "unknown",
      fallbackReason: this.canvas.dataset.bikeFallbackReason ?? null,
      trackId: this.track.id,
      mode: this.mode,
      courseLength: this.track.courseLength,
      stepCount: state.stepCount,
      timeSeconds: round(state.timeSeconds),
      phase: bike.phase,
      lane: bike.lane,
      lanePosition: round(bike.lanePosition),
      forwardPosition: round(bike.forwardPosition),
      speed: round(bike.speed),
      pitch: round(bike.pitch),
      presentationPitch: round(presentationPitch),
      height: round(bike.height),
      verticalVelocity: round(bike.verticalVelocity),
      wheelie: bike.wheelie,
      lastLanding: bike.lastLanding,
      crashCause: bike.crashCause,
      recoveryProgress: round(bike.recoveryProgress),
      inputDevice: this.input.activeDevice,
      steeringRoll: round(steeringRoll),
      presentationRoll: round(steeringRoll),
      steeringDirection,
      reducedMotion,
      actionState: pose.actionState,
      landingAgeSeconds: landingAgeSeconds !== undefined && Number.isFinite(landingAgeSeconds)
        ? round(landingAgeSeconds)
        : null,
      landingCompression: round(pose.landingCompression),
      suspensionCompression: {
        front: round(pose.frontSuspensionCompression),
        rear: round(pose.rearSuspensionCompression),
      },
      playerScale: round(this.player.scale.x),
      activeBikeName: bikeVisual.name,
      activeRiderName: riderVisual.name,
      wheelNames: {
        front: frontWheel.name,
        rear: rearWheel.name,
      },
      distinctWheelObjects: frontWheel !== rearWheel,
      wheelX: {
        front: round(frontWheel.rotation.x),
        rear: round(rearWheel.rotation.x),
      },
      riderRoot: {
        rotationX: round(riderVisual.rotation.x),
        rotationY: round(riderVisual.rotation.y),
        rotationZ: round(riderVisual.rotation.z),
        positionX: round(riderVisual.position.x),
        positionY: round(riderVisual.position.y),
        positionZ: round(riderVisual.position.z),
      },
      rig: {
        torso: rotation(rig.torso),
        head: rotation(rig.head),
        leftArm: rotation(rig.leftArm),
        rightArm: rotation(rig.rightArm),
        leftLeg: rotation(rig.leftLeg),
        rightLeg: rotation(rig.rightLeg),
      },
    });
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
    const basePlayerSteeringRoll = resolveRiderPresentationRoll(
      LANE_POSITIONS[bike.lane as LaneIndex],
      bike.lanePosition,
      bike.phase,
      bike.recoveryProgress,
      reducedMotion,
    );
    if (
      reducedMotion
      || bike.phase === "crashed"
      || bike.phase === "recovering"
      || this.playerLaneChangeLeanSeconds <= 0
    ) {
      this.playerLaneChangeLeanDirection = 0;
      this.playerLaneChangeLeanSeconds = 0;
    }
    const playerSteeringRoll = resolveHeldLaneChangePresentationRoll(
      basePlayerSteeringRoll,
      this.playerLaneChangeLeanDirection,
      this.playerLaneChangeLeanSeconds,
      bike.phase,
      reducedMotion,
    );
    this.playerLaneChangeLeanSeconds = Math.max(0, this.playerLaneChangeLeanSeconds - delta);
    if (this.playerLaneChangeLeanSeconds <= 0) this.playerLaneChangeLeanDirection = 0;

    const playerPose = this.setRiderPose(
      this.player,
      bike,
      playerSteeringRoll,
      reducedMotion,
      delta,
    );
    const playerPresentationPitch = resolveBikePresentationPitch(
      bike.phase,
      bike.pitch,
      bike.wheelie,
      playerPose.landingCompression,
      reducedMotion,
    );
    this.setRiderPresentation(
      this.player,
      bike.forwardPosition,
      bike.lanePosition,
      playerBaseY + playerRouteHeight + bike.height,
      playerPresentationPitch,
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
    const crashGrounding = bike.phase === "crashed" || bike.phase === "recovering";
    this.playerShadow.scale.set(
      (1.7 + clamp(bike.speed / 25, 0, 1) * 0.18) * (crashGrounding ? 1.55 : 1),
      2.8 * (crashGrounding ? 1.25 : 1),
      1,
    );
    const playerShadowMaterial = this.playerShadow.material as THREE.MeshBasicMaterial;
    playerShadowMaterial.opacity = 0.3
      * clamp(1 - bike.height / 4.5, 0.1, 1)
      * (crashGrounding ? 1.18 : 1);
    this.playerShadow.visible = true;
    this.player.userData.frontWheel.rotation.x -= wheelSpin;
    this.player.userData.backWheel.rotation.x -= wheelSpin;
    if (import.meta.env.VITE_QA_MODE === "1") {
      this.recordQaPlayerMotionSnapshot(
        bike,
        playerSteeringRoll,
        playerPresentationPitch,
        reducedMotion,
        playerPose,
      );
    }

    for (const ai of this.aiRiders) {
      const bike = ai.simulation.snapshot.bike;
      const crashed = bike.phase === "crashed";
      const steeringRoll = resolveRiderPresentationRoll(
        LANE_POSITIONS[bike.lane as LaneIndex],
        bike.lanePosition,
        bike.phase,
        bike.recoveryProgress,
        reducedMotion,
      );
      const routeHeight = this.authoredRouteHeight(
        bike.forwardPosition % this.track.courseLength,
        bike.lanePosition,
      );
      const aiPose = this.setRiderPose(
        ai.group,
        bike,
        steeringRoll,
        reducedMotion,
        delta,
      );
      const aiPresentationPitch = resolveBikePresentationPitch(
        bike.phase,
        bike.pitch,
        bike.wheelie,
        aiPose.landingCompression,
        reducedMotion,
      );
      this.setRiderPresentation(
        ai.group,
        bike.forwardPosition,
        bike.lanePosition,
        0.72 + routeHeight + bike.height,
        aiPresentationPitch,
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
      bike.lanePosition * presentation.laneFollow + presentation.lateralOffset,
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
    if (this.heroKeyLight) {
      this.courseRoute.sample(
        bike.forwardPosition - 3.5,
        bike.lanePosition + 5.5,
        8.5 + playerRouteHeight,
        this.heroKeyLight.position,
      );
    }
    if (this.heroRimLight) {
      this.courseRoute.sample(
        bike.forwardPosition + 4.2,
        bike.lanePosition - 4.8,
        5.8 + playerRouteHeight,
        this.heroRimLight.position,
      );
    }
    if (this.heroFillLight) {
      this.courseRoute.sample(
        bike.forwardPosition - 1.2,
        bike.lanePosition - 2.8,
        3.1 + playerRouteHeight,
        this.heroFillLight.position,
      );
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
      const outcome = getObstacleContactOutcome(
        contact.kind,
        policy,
        hasFrontWheelClearance(state.bike),
      );
      if (
        !this.handledObstacleKeys.has(key)
        && (policy.crashesOnContact || policy.retainedSpeed < 1)
      ) {
        this.handledObstacleKeys.add(key);
        if (outcome === "crash") {
          if (this.mode === "tutorial" && contact.parent.id === "qa-recovery-barrier") {
            this.tutorialEvents.recoveryBarrierCrash = true;
            this.tutorialRecoveryBarrierCrashPending = true;
            this.observeTutorialLesson("recovery-barrier-crash");
          }
          this.simulation.forceCrash("obstacle");
          this.captionEvent("Barrier hit — hold recover", "crash");
        } else if (outcome === "slowdown") {
          this.simulation.applySpeedPenalty(retainedSpeedForContact(contact, policy));
          if (contact.kind === "barrier") {
            this.demonstrated.hazardAvoided = true;
            if (this.mode === "tutorial" && contact.parent.id === "qa-choice-barrier") {
              this.tutorialEvents.choiceBarrierAvoided = true;
              this.observeTutorialLesson("choice-barrier-avoided");
            }
            this.captionEvent(
              this.mode === "tutorial" && contact.parent.id === "qa-recovery-barrier"
                ? "Barrier cleared — retry with front wheel down"
                : "Front wheel clear — barrier cost speed",
              "rough-landing",
            );
          } else {
            this.captionEvent("Bump strike — wheelie next time", "rough-landing");
          }
        } else {
          if (this.mode === "tutorial" && contact.parent.id === "qa-bump") {
            this.tutorialEvents.trainingBumpClearedInWheelie = true;
            this.observeTutorialLesson("training-bump-wheelie");
          }
          this.captionEvent("Front wheel clear — bump speed held", "landing");
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
      if (bike.lastLanding === "rough") this.emitContactDustBurst(state, "rough-landing");
      if (bike.lastLanding === "crash") this.crashes += 1;
    }
    this.lastLanding = bike.lastLanding;

    if (enteredCrash && bike.crashCause === "wheelie-timeout") {
      this.captionEvent("Wheelie held too long — hold recover", "crash");
    }
    if (enteredCrash && !(landingChanged && bike.lastLanding === "crash")) {
      this.crashes += 1;
    }
    if (enteredCrash) this.emitContactDustBurst(state, "crash");
    if (bike.phase === "crashed") this.demonstrated.crash = true;
    if (previousPhase === "recovering" && bike.phase === "grounded") {
      this.emitContactDustBurst(state, "recovery");
      this.demonstrated.recovery = true;
      if (this.tutorialRecoveryBarrierCrashPending) {
        this.tutorialEvents.recoveryBarrierRecovered = true;
        this.tutorialRecoveryBarrierCrashPending = false;
        this.observeTutorialLesson("recovery-barrier-recovered");
      }
    }
    this.lastBikePhase = bike.phase;

    const heatWarning = bike.heat >= CRITICAL_HEAT_WARNING && !bike.overheated;
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
      && state.bike.speed >= TUTORIAL_USABLE_SPEED;
    const coast = before.bike.speed >= TUTORIAL_USABLE_SPEED
      && !input.throttle
      && !input.turbo
      && state.bike.speed < before.bike.speed;
    const criticalHeatReached = before.bike.heat < CRITICAL_HEAT_WARNING
      && state.bike.heat >= CRITICAL_HEAT_WARNING;
    const coolingRelease = before.bike.surface !== "cooling"
      && state.bike.surface === "cooling"
      && !input.turbo;
    const laneChanged = before.bike.lane !== state.bike.lane;
    const mudSlowdownExperienced = state.bike.phase === "grounded"
      && state.bike.surface === "mud"
      && state.bike.speed < before.bike.speed;

    this.demonstrated.rideAtUsableSpeed ||= rideAtUsableSpeed;
    this.demonstrated.coast ||= coast;
    this.demonstrated.criticalHeatReached ||= state.bike.heat >= CRITICAL_HEAT_WARNING;
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

    const afterLocal = after.forwardPosition % this.track.courseLength;
    const afterContact = this.nearestObstacleContact(afterLocal, after.lane, after.height);
    const afterPolicy = this.obstaclePolicy(afterContact?.parent);
    if (afterContact && after.phase === "grounded") {
      const key = `${Math.floor(after.forwardPosition / this.track.courseLength)}:${afterContact.key}`;
      if (key !== ai.lastObstacleKey) {
        ai.lastObstacleKey = key;
        const outcome = getObstacleContactOutcome(
          afterContact.kind,
          afterPolicy,
          hasFrontWheelClearance(after),
        );
        if (outcome === "crash") {
          this.crashAi(ai, profile);
        } else if (outcome === "slowdown") {
          ai.simulation.applySpeedPenalty(retainedSpeedForContact(afterContact, afterPolicy));
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
        : state.bike.heat >= CRITICAL_HEAT_WARNING
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
    const state = this.simulation.snapshot;
    this.finishClassification = {
      playerState: state,
      profile: getAiDifficultyProfile(this.settings.difficulty),
      ticks: 0,
    };
    this.audio.play("finish");
    this.onFinishStart();
    this.continueFinishClassification(0);
  }

  private continueFinishClassification(
    tickBudget = AI_CLASSIFICATION_STEPS_PER_FRAME,
  ): void {
    const work = this.finishClassification;
    if (!work || this.finishFinalized) return;

    const status = this.advanceAiClassification(work, tickBudget);
    if (status === "pending") return;

    this.finishFinalized = true;
    this.finishClassification = null;
    if (status === "exhausted") {
      this.onFatal("The official field result could not be completed. Retry the race.");
      return;
    }
    this.deliverFinishResult(work.playerState);
  }

  private advanceAiClassification(
    work: FinishClassificationWork,
    tickBudget: number,
  ): FinishClassificationStatus {
    if (this.aiRiders.every((ai) => ai.finishTimeMs !== undefined)) return "complete";

    const remainingTicks = Math.max(0, MAX_AI_CLASSIFICATION_STEPS - work.ticks);
    const sliceTicks = Math.min(Math.max(0, Math.floor(tickBudget)), remainingTicks);
    for (let tick = 0; tick < sliceTicks; tick += 1) {
      for (const [index, ai] of this.aiRiders.entries()) {
        this.stepAi(ai, index, work.profile, work.playerState);
      }
      this.resolveAiPairCollisions(work.profile, false);
      work.ticks += 1;
      if (this.aiRiders.every((ai) => ai.finishTimeMs !== undefined)) return "complete";
    }

    return work.ticks >= MAX_AI_CLASSIFICATION_STEPS ? "exhausted" : "pending";
  }

  private deliverFinishResult(state: SimulationState): void {
    const elapsedMs = Math.round(state.race.elapsedSeconds * 1_000);
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
    const replayStatus = this.replayRecorder.status;
    if (!replayStatus.complete) {
      this.onFinish(result, {
        status: "unavailable",
        reason: replayStatus.failureReason ?? "incomplete",
      });
      return;
    }
    this.onFinish(result, {
      status: "complete",
      samples: this.replayRecorder.toUint8Array(),
    });
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
    const count = this.quality === "low" ? 12 : this.quality === "medium" ? 22 : 34;
    const geometry = new THREE.PlaneGeometry(0.64, 0.46);
    const dustTexture = createSoftDustTexture();
    this.ownedTextures.push(dustTexture);
    const dustColor = new THREE.Color(this.track.palette.dirtDark).offsetHSL(0.018, 0.02, 0.08).getHex();
    for (let index = 0; index < count; index += 1) {
      const material = new THREE.MeshBasicMaterial({
        color: dustColor,
        transparent: true,
        opacity: 0,
        alphaMap: dustTexture,
        depthWrite: false,
        side: THREE.DoubleSide,
        toneMapped: false,
      });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.visible = false;
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      mesh.renderOrder = 2;
      this.scene.add(mesh);
      this.dustPool.push({
        mesh,
        life: 0,
        maxLife: 0.58,
        baseScale: 0.7,
        baseOpacity: 0.42,
        driftX: 0,
        driftY: 0.42,
        driftZ: 0,
      });
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
      particle.mesh.position.y += particle.driftY * delta;
      const elapsed = Math.max(0, particle.maxLife - particle.life);
      const scale = particle.baseScale + elapsed * 2.1;
      particle.mesh.scale.setScalar(scale);
      const material = Array.isArray(particle.mesh.material) ? particle.mesh.material[0] : particle.mesh.material;
      if (material instanceof THREE.MeshBasicMaterial) {
        material.opacity = particle.baseOpacity * Math.pow(clamp(particle.life / particle.maxLife, 0, 1), 1.35);
      }
    }

    if (
      this.settings.accessibility.reducedMotion
      || state.bike.phase !== "grounded"
      || state.bike.speed < 4
      || state.bike.surface === "cooling"
    ) return;
    this.dustAccumulator += delta;
    const speedFactor = clamp((state.bike.speed - 4) / 18, 0.35, 1.15);
    const surfaceFactor = state.bike.surface === "mud" ? 1.22 : state.bike.surface === "grass" ? 0.68 : 1;
    const interval = (this.quality === "low" ? 0.14 : this.quality === "medium" ? 0.08 : 0.06)
      / clamp(speedFactor * surfaceFactor, 0.65, 1.35);
    if (this.dustAccumulator < interval) return;
    this.dustAccumulator %= interval;
    const emissions = this.quality === "low" ? 1 : 2;
    const baseSide = this.dustCursor % 2 === 0 ? -1 : 1;
    for (let index = 0; index < emissions; index += 1) {
      const particle = this.dustPool[this.dustCursor % this.dustPool.length];
      this.dustCursor += 1;
      if (!particle) continue;
      const side = emissions === 1 ? baseSide : index === 0 ? -1 : 1;
      const rearOffset = 0.92 + speedFactor * 0.42 + index * 0.1;
      const laneOffset = side * (0.28 + speedFactor * 0.1);
      const orientation = this.courseRoute.sample(
        state.bike.forwardPosition - rearOffset,
        state.bike.lanePosition + laneOffset,
        0.34 + this.authoredRouteHeight(
          state.bike.forwardPosition % this.track.courseLength,
          state.bike.lanePosition,
        ),
        particle.mesh.position,
      );
      const lateralDrift = side * (0.24 + speedFactor * 0.26);
      const rearDrift = -(0.22 + speedFactor * 0.34);
      particle.life = 0.62 + speedFactor * 0.16;
      particle.maxLife = particle.life;
      particle.baseScale = (0.76 + speedFactor * 0.34) * surfaceFactor;
      particle.baseOpacity = (0.34 + speedFactor * 0.12) * (state.bike.surface === "grass" ? 0.72 : 1);
      particle.mesh.scale.setScalar(particle.baseScale);
      const material = Array.isArray(particle.mesh.material) ? particle.mesh.material[0] : particle.mesh.material;
      if (material instanceof THREE.MeshBasicMaterial) material.opacity = particle.baseOpacity;
      particle.driftX = orientation.rightX * lateralDrift + orientation.forwardX * rearDrift;
      particle.driftY = 0.34 + speedFactor * 0.18;
      particle.driftZ = orientation.rightZ * lateralDrift + orientation.forwardZ * rearDrift;
      particle.mesh.visible = true;
    }
  }

  private emitContactDustBurst(
    state: SimulationState,
    kind: "rough-landing" | "crash" | "recovery",
  ): void {
    if (this.settings.accessibility.reducedMotion || this.dustPool.length === 0) return;
    const burstCount = kind === "crash"
      ? (this.quality === "low" ? 5 : this.quality === "medium" ? 8 : 11)
      : kind === "rough-landing"
        ? (this.quality === "low" ? 3 : this.quality === "medium" ? 5 : 7)
        : (this.quality === "low" ? 2 : this.quality === "medium" ? 3 : 4);
    const speedFactor = clamp(state.bike.speed / 22, 0.45, 1.15);
    const forwardBase = state.bike.forwardPosition - (kind === "crash" ? 1.15 : 0.8);
    const life = kind === "crash" ? 0.82 : kind === "rough-landing" ? 0.68 : 0.5;
    const baseScale = kind === "crash" ? 1.05 : kind === "rough-landing" ? 0.86 : 0.62;
    for (let index = 0; index < burstCount; index += 1) {
      const particle = this.dustPool[this.dustCursor % this.dustPool.length];
      this.dustCursor += 1;
      if (!particle) continue;
      const sideSign = index % 2 === 0 ? -1 : 1;
      const spreadStep = Math.floor(index / 2);
      const laneOffset = sideSign * (0.18 + spreadStep * 0.11);
      const forwardOffset = (index % 3) * 0.18;
      const orientation = this.courseRoute.sample(
        forwardBase - forwardOffset,
        state.bike.lanePosition + laneOffset,
        0.28 + this.authoredRouteHeight(
          state.bike.forwardPosition % this.track.courseLength,
          state.bike.lanePosition,
        ),
        particle.mesh.position,
      );
      const lateralDrift = sideSign * (0.44 + spreadStep * 0.12) * speedFactor;
      const rearDrift = -(0.35 + (index % 3) * 0.14) * speedFactor;
      particle.life = life;
      particle.maxLife = life;
      particle.baseScale = baseScale + spreadStep * 0.04;
      particle.baseOpacity = kind === "crash" ? 0.54 : kind === "rough-landing" ? 0.46 : 0.36;
      particle.driftX = orientation.rightX * lateralDrift + orientation.forwardX * rearDrift;
      particle.driftY = kind === "crash" ? 0.58 + (index % 4) * 0.05 : 0.44 + (index % 3) * 0.04;
      particle.driftZ = orientation.rightZ * lateralDrift + orientation.forwardZ * rearDrift;
      particle.mesh.scale.setScalar(particle.baseScale);
      const material = Array.isArray(particle.mesh.material) ? particle.mesh.material[0] : particle.mesh.material;
      if (material instanceof THREE.MeshBasicMaterial) material.opacity = particle.baseOpacity;
      particle.mesh.visible = true;
    }
    this.dustEventBurstCount += 1;
    this.canvas.dataset.groundedDustBurstCount = String(this.dustEventBurstCount);
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

    const heroKey = new THREE.SpotLight(
      0xc8edff,
      heroKeyLightIntensity(this.quality),
      28,
      Math.PI / 5,
      0.72,
      1.35,
    );
    heroKey.name = "hero-bike-cool-key";
    heroKey.castShadow = false;
    heroKey.target = this.player;
    heroKey.visible = heroKey.intensity > 0;
    this.heroKeyLight = heroKey;
    this.scene.add(heroKey);

    const heroRim = new THREE.SpotLight(
      0xffbd7a,
      heroRimLightIntensity(this.quality),
      24,
      Math.PI / 4.8,
      0.78,
      1.5,
    );
    heroRim.name = "hero-bike-warm-rim";
    heroRim.castShadow = false;
    heroRim.target = this.player;
    heroRim.visible = heroRim.intensity > 0;
    this.heroRimLight = heroRim;
    this.scene.add(heroRim);

    const heroFill = new THREE.PointLight(
      0x58f3ff,
      heroFillLightIntensity(this.quality),
      12,
      1.7,
    );
    heroFill.name = "hero-bike-cyan-fill";
    heroFill.visible = heroFill.intensity > 0;
    this.heroFillLight = heroFill;
    this.scene.add(heroFill);

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
      bumpScale: 0.135,
      color: 0xffffff,
      roughness: 0.94,
      metalness: 0,
    });
    this.canvas.dataset.dirtTextureDetailStyle = DIRT_TEXTURE_DETAIL_STYLE;
    this.canvas.dataset.dirtTextureResolution = `${dirtTexture.image?.width ?? 0}x${dirtTexture.image?.height ?? 0}`;
    this.canvas.dataset.dirtHeightTextureResolution = `${dirtHeightTexture.image?.width ?? 0}x${dirtHeightTexture.image?.height ?? 0}`;
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
    if (this.track.id !== "canyon-kickoff") this.createSkyDecor(totalLength);
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
    const visualKey = obstacleVisualKey(obstacle.id, lap);
    const visualSet: ProceduralObstacleVisualSet = {
      obstacle,
      lap,
      visuals: [],
    };
    this.proceduralObstacleVisuals.set(visualKey, visualSet);
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
      mesh.userData.proceduralObstacleVisual = true;
      mesh.userData.obstacleId = obstacle.id;
      mesh.userData.obstacleLap = lap;
      visualSet.visuals.push(mesh);
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
      new THREE.BoxGeometry(1.05, 0.46, 1),
      makeMaterial(0xffffff, 0.74),
      blockCount,
    );
    blocks.name = continuousCanyon
      ? "canyon-continuous-safety-wall"
      : "festival-safety-zones";
    const blockColors = continuousCanyon
      ? [new THREE.Color(0xf3ead4), new THREE.Color(0xd94c3d)]
      : [
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
          position.set(side * 7.45, 0.28, z);
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
        const z = -56 - (index / mesaCount) * totalLength;
        const x = side * (20.5 + ((index * 19) % 13));
        const terraceLift = this.sceneryElevation(x);
        const width = 0.88 + (index % 4) * 0.2;
        const height = 0.72 + ((index * 7) % 6) * 0.12;
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
    this.canvas.dataset.coastlineWaterStyle = "right-side-water-boardwalk";
    this.canvas.dataset.coastlineBoardwalkStyle = "route-following-planks";
    this.canvas.dataset.coastlineHutStyle = "colorful-boardwalk-huts";
    this.canvas.dataset.coastlineHutCount = String(hutCount);
    this.canvas.dataset.coastlineThemeBatchCount = "4";
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
    this.createCanyonShoulderDressing(totalLength);
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

  private createCanyonShoulderDressing(totalLength: number): void {
    if (this.track.authoredCourse !== undefined) {
      this.canvas.dataset.canyonShoulderDressingStyle = "authored-excluded";
      this.canvas.dataset.canyonShoulderShelfCount = "0";
      this.canvas.dataset.canyonShoulderRockCount = "0";
      this.canvas.dataset.canyonShoulderAgaveCount = "0";
      return;
    }

    const matrix = new THREE.Matrix4();
    const random = seededRandom(this.track.order * 811_721);
    const shoulderRibbonMaterial = makeMaterial(
      new THREE.Color(this.track.palette.rock).offsetHSL(0.01, 0.025, 0.015).getHex(),
      0.96,
    );
    const shoulderRibbons = [-1, 1].map((side) => {
      const ribbon = new THREE.Mesh(
        createCourseRibbonGeometry(this.courseRoute, {
          startProgress: -30,
          endProgress: totalLength - 30,
          left: side < 0 ? -7.05 : 6.05,
          right: side < 0 ? -6.05 : 7.05,
          yOffset: 0.018,
          segmentLength: 3,
        }),
        shoulderRibbonMaterial,
      );
      ribbon.name = side < 0
        ? "canyon-left-visible-cut-bank-ribbon"
        : "canyon-right-visible-cut-bank-ribbon";
      ribbon.receiveShadow = true;
      ribbon.userData.presentationOnly = true;
      return ribbon;
    });
    const shelfCount = this.quality === "low" ? 34 : this.quality === "medium" ? 54 : 78;
    const shelfMaterial = makeMaterial(
      new THREE.Color(this.track.palette.rock).offsetHSL(0.01, 0.03, -0.045).getHex(),
      0.94,
    );
    const shelves = new THREE.InstancedMesh(
      new THREE.BoxGeometry(1, 1, 1),
      shelfMaterial,
      shelfCount,
    );
    const shelfColors = [
      new THREE.Color(0xa64d33),
      new THREE.Color(0xc66742),
      new THREE.Color(0x7f392a),
      new THREE.Color(0xd27a4e),
    ];
    for (let index = 0; index < shelfCount; index += 1) {
      const side = index % 2 === 0 ? -1 : 1;
      const distance = 18 + ((index + 0.35) / shelfCount) * Math.max(60, totalLength - 34);
      const lateral = side * (7.9 + random() * 1.05);
      const scaleX = 0.8 + random() * 0.9;
      const scaleY = 0.36 + random() * 0.5;
      const scaleZ = 3.4 + random() * 6.4;
      matrix.compose(
        new THREE.Vector3(
          lateral,
          this.sceneryElevation(lateral) + scaleY * 0.5,
          -distance,
        ),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(0, side * (0.08 + random() * 0.18), 0)),
        new THREE.Vector3(scaleX, scaleY, scaleZ),
      );
      shelves.setMatrixAt(index, matrix);
      shelves.setColorAt(index, shelfColors[index % shelfColors.length] ?? new THREE.Color(0xa64d33));
    }
    if (shelves.instanceColor) shelves.instanceColor.needsUpdate = true;
    shelves.name = "canyon-route-following-cut-bank-shelves";
    shelves.userData.presentationOnly = true;
    shelves.castShadow = this.quality === "high";
    shelves.receiveShadow = true;

    const rockCount = this.quality === "low" ? 72 : this.quality === "medium" ? 124 : 184;
    const shoulderRocks = new THREE.InstancedMesh(
      new THREE.DodecahedronGeometry(0.34, 0),
      makeMaterial(new THREE.Color(this.track.palette.rock).offsetHSL(0, 0.02, 0.02).getHex(), 0.96),
      rockCount,
    );
    for (let index = 0; index < rockCount; index += 1) {
      const side = index % 2 === 0 ? -1 : 1;
      const distance = 12 + random() * Math.max(52, totalLength - 18);
      const lateral = side * (7.9 + random() * 1.8);
      const scale = 0.42 + random() * 1.2;
      matrix.compose(
        new THREE.Vector3(
          lateral,
          this.sceneryElevation(lateral) + 0.18 * scale,
          -distance,
        ),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(random() * 0.45, random() * Math.PI, random() * 0.2)),
        new THREE.Vector3(scale * (1.1 + random() * 1.25), scale * 0.58, scale),
      );
      shoulderRocks.setMatrixAt(index, matrix);
    }
    shoulderRocks.name = "canyon-shoulder-pebble-bands";
    shoulderRocks.userData.presentationOnly = true;
    shoulderRocks.castShadow = this.quality === "high";
    shoulderRocks.receiveShadow = true;

    const agaveCount = this.quality === "low" ? 20 : this.quality === "medium" ? 34 : 52;
    const agaves = new THREE.InstancedMesh(
      createCanyonAgaveGeometry(),
      makeMaterial(0x6d8b3a, 0.98),
      agaveCount,
    );
    for (let index = 0; index < agaveCount; index += 1) {
      const side = index % 2 === 0 ? -1 : 1;
      const distance = 24 + ((index + random()) / agaveCount) * Math.max(80, totalLength - 44);
      const lateral = side * (8.18 + random() * 1.95);
      const scale = 0.62 + random() * 0.72;
      matrix.compose(
        new THREE.Vector3(
          lateral,
          this.sceneryElevation(lateral) + 0.13 * scale,
          -distance,
        ),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(0, random() * Math.PI * 2, 0)),
        new THREE.Vector3(scale, scale, scale),
      );
      agaves.setMatrixAt(index, matrix);
    }
    agaves.name = "canyon-agave-route-clusters";
    agaves.userData.presentationOnly = true;
    agaves.castShadow = this.quality !== "low";
    agaves.receiveShadow = true;

    this.canvas.dataset.canyonShoulderDressingStyle = "route-following-cut-bank";
    this.canvas.dataset.canyonShoulderShelfCount = String(shelfCount);
    this.canvas.dataset.canyonShoulderRockCount = String(rockCount);
    this.canvas.dataset.canyonShoulderAgaveCount = String(agaveCount);
    this.canvas.dataset.canyonShoulderRibbonCount = String(shoulderRibbons.length);
    this.canvas.dataset.canyonShoulderDressingBatchCount = "4";
    this.scene.add(...shoulderRibbons);
    this.addSurfaceCourseAnchored(shelves, shoulderRocks, agaves);
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
    this.createCanyonRouteCrowdRails(totalLength, timber);
    this.createFestivalBillboards(timber);
    this.createFestivalLandmark(timber, roofMaterial);
  }

  private createCanyonRouteCrowdRails(
    totalLength: number,
    timber: THREE.MeshStandardMaterial,
  ): void {
    if (this.track.id !== "canyon-kickoff" || this.track.authoredCourse !== undefined) {
      delete this.canvas.dataset.canyonRouteCrowdStyle;
      delete this.canvas.dataset.canyonRouteCrowdGroupCount;
      delete this.canvas.dataset.canyonRouteCrowdSpectatorCount;
      delete this.canvas.dataset.canyonRouteCrowdTierCount;
      return;
    }
    const groupCount = this.quality === "low" ? 8 : this.quality === "medium" ? 14 : 22;
    const peoplePerGroup = this.quality === "low" ? 4 : this.quality === "medium" ? 7 : 9;
    const spectatorCount = groupCount * peoplePerGroup;
    const tierCount = groupCount * 2;
    const platforms = new THREE.InstancedMesh(
      new THREE.BoxGeometry(1, 1, 1),
      timber,
      tierCount,
    );
    const people = new THREE.InstancedMesh(
      new THREE.CapsuleGeometry(0.2, 0.6, 3, 6),
      makeMaterial(0xffffff, 0.82),
      spectatorCount,
    );
    const heads = new THREE.InstancedMesh(
      new THREE.SphereGeometry(0.2, 7, 5),
      makeMaterial(0xffffff, 0.86),
      spectatorCount,
    );
    const peopleColors = [
      new THREE.Color(0xf4c94b),
      new THREE.Color(0x1eb9b7),
      new THREE.Color(0xef6354),
      new THREE.Color(0x355fa8),
      new THREE.Color(0xf0dfc0),
    ];
    const skinColors = [
      new THREE.Color(0xf2c18f),
      new THREE.Color(0xb87855),
      new THREE.Color(0x7f4c38),
      new THREE.Color(0xe0a877),
    ];
    const matrix = new THREE.Matrix4();
    const rotation = new THREE.Quaternion();
    const localPosition = new THREE.Vector3();
    const random = seededRandom(0x43_52_57_44 + this.track.order);
    const usableLength = Math.max(220, totalLength - 130);
    let tierIndex = 0;
    let personIndex = 0;
    for (let group = 0; group < groupCount; group += 1) {
      const side: -1 | 1 = group % 2 === 0 ? -1 : 1;
      const progressRatio = group / Math.max(1, groupCount - 1);
      const distance = 82 + progressRatio * usableLength + (random() - 0.5) * 11;
      const x = side * (10.35 + (group % 3) * 0.28 + random() * 0.16);
      const elevation = this.sceneryElevation(x);
      const yaw = side < 0 ? 0.1 : -0.1;
      rotation.setFromEuler(new THREE.Euler(0, yaw, 0));
      for (let tier = 0; tier < 2; tier += 1) {
        matrix.compose(
          new THREE.Vector3(
            x + side * (0.18 + tier * 0.58),
            elevation + 0.45 + tier * 0.32,
            -distance + (tier - 0.5) * 0.22,
          ),
          rotation,
          new THREE.Vector3(3.2, 0.28 + tier * 0.1, 0.72),
        );
        platforms.setMatrixAt(tierIndex, matrix);
        tierIndex += 1;
      }
      for (let person = 0; person < peoplePerGroup; person += 1) {
        const column = person % 3;
        const row = Math.floor(person / 3);
        localPosition
          .set(
            side * (0.28 + row * 0.44),
            0,
            -0.78 + column * 0.78 + (random() - 0.5) * 0.12,
          )
          .applyQuaternion(rotation);
        const bodyY = elevation + 1.12 + row * 0.32;
        matrix.makeTranslation(x + localPosition.x, bodyY, -distance + localPosition.z);
        people.setMatrixAt(personIndex, matrix);
        people.setColorAt(
          personIndex,
          peopleColors[(person + group) % peopleColors.length] ?? new THREE.Color(0xf4c94b),
        );
        matrix.makeTranslation(x + localPosition.x, bodyY + 0.58, -distance + localPosition.z);
        heads.setMatrixAt(personIndex, matrix);
        heads.setColorAt(
          personIndex,
          skinColors[(person + group) % skinColors.length] ?? new THREE.Color(0xe0a877),
        );
        personIndex += 1;
      }
    }
    platforms.name = "canyon-route-crowd-rail-bleachers";
    people.name = "canyon-route-crowd-rail-people";
    heads.name = "canyon-route-crowd-rail-heads";
    platforms.castShadow = this.quality !== "low";
    people.castShadow = this.quality === "high";
    heads.castShadow = this.quality === "high";
    platforms.userData.presentationOnly = true;
    people.userData.presentationOnly = true;
    heads.userData.presentationOnly = true;
    this.canvas.dataset.canyonRouteCrowdStyle = "route-following-rail-bleachers-v2";
    this.canvas.dataset.canyonRouteCrowdGroupCount = String(groupCount);
    this.canvas.dataset.canyonRouteCrowdSpectatorCount = String(spectatorCount);
    this.canvas.dataset.canyonRouteCrowdTierCount = String(tierCount);
    this.addCourseAnchored(platforms, people, heads);
  }

  private createFestivalRoutePockets(
    totalLength: number,
    timber: THREE.MeshStandardMaterial,
  ): void {
    // Editor courses inherit Canyon's palette/id, so authored-course exclusion
    // keeps this campaign venue treatment out of custom curves and banks.
    const handcraftedCanyon = this.track.id === "canyon-kickoff"
      && this.track.authoredCourse === undefined;
    const { coolingGatePockets, pocketPlacements } = resolveFestivalPocketPlacements({
      handcraftedCanyon,
      quality: this.quality,
      totalLength,
      trackOrder: this.track.order,
      coolingGateDistances: this.track.obstacles
        .filter((obstacle) => obstacle.kind === "cooling-gate")
        .map((obstacle) => obstacle.distance),
    });
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
    const standCenter = 14.4;
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
      const standX = side * 14.4;
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
      { x: -12.2, z: -27, rotationY: 0.18 },
      { x: 12.2, z: -31, rotationY: -0.18 },
      { x: -12.8, z: -59, rotationY: 0.24 },
      { x: 12.8, z: -63, rotationY: -0.24 },
      { x: -13.2, z: -92, rotationY: 0.14 },
      { x: 13.2, z: -96, rotationY: -0.14 },
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
      new THREE.Vector3(-12.8, 0, -14),
      new THREE.Vector3(12.8, 0, -14),
      new THREE.Vector3(-13.2, 0, -firstObstacleDistance),
      new THREE.Vector3(13.2, 0, -firstObstacleDistance),
      new THREE.Vector3(-13.2, 0, -secondObstacleDistance),
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
    const bannerDistances = this.track.id === "canyon-kickoff"
      ? [43, 315, 535, 755, 975, 1_195]
      : [43, 96];
    const lapCount = this.simulation.snapshot.race.totalLaps;
    for (let lap = 1; lap <= lapCount; lap += 1) {
      bannerDistances.push(Math.min(totalLength - 25, lap * this.track.courseLength - 30));
    }
    const bannerPoles = new THREE.InstancedMesh(
      new THREE.CylinderGeometry(0.09, 0.12, 7.8, 6),
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
        matrix.makeTranslation(side * 8.2, 3.9, -distance);
        bannerPoles.setMatrixAt(lineIndex * 2 + (side > 0 ? 1 : 0), matrix);
      }
      matrix.makeTranslation(0, 7.2, -distance);
      ropes.setMatrixAt(lineIndex, matrix);
      for (let index = 0; index < flagsPerLine; index += 1) {
        const ratio = index / (flagsPerLine - 1);
        matrix.compose(
          new THREE.Vector3(-7.45 + ratio * 14.9, 6.85 - Math.sin(ratio * Math.PI) * 0.34, -distance),
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
    if (this.track.id === "canyon-kickoff" && this.track.authoredCourse === undefined) {
      this.createCanyonRouteSponsorBanners(totalLength, poleMaterial);
    } else {
      delete this.canvas.dataset.canyonRouteBannerStyle;
      delete this.canvas.dataset.canyonRouteBannerCount;
      delete this.canvas.dataset.canyonRouteBannerPoleCount;
      delete this.canvas.dataset.canyonRouteBannerTextureVariantCount;
    }
  }

  private createCanyonSponsorBannerMaterial(
    background: string,
    accent: string,
    mark: string,
    label: string,
  ): THREE.MeshBasicMaterial {
    const canvas = document.createElement("canvas");
    canvas.width = 256;
    canvas.height = 512;
    const context = canvas.getContext("2d");
    if (context) {
      context.fillStyle = background;
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.fillStyle = accent;
      context.fillRect(0, 0, canvas.width, 34);
      context.fillRect(0, canvas.height - 34, canvas.width, 34);
      context.globalAlpha = 0.22;
      context.fillStyle = "#ffffff";
      for (let stripe = -2; stripe < 6; stripe += 1) {
        context.beginPath();
        context.moveTo(stripe * 62, 512);
        context.lineTo(stripe * 62 + 34, 512);
        context.lineTo(stripe * 62 + 252, 0);
        context.lineTo(stripe * 62 + 218, 0);
        context.closePath();
        context.fill();
      }
      context.globalAlpha = 1;
      context.fillStyle = mark;
      context.beginPath();
      context.moveTo(150, 82);
      context.lineTo(91, 246);
      context.lineTo(136, 236);
      context.lineTo(103, 430);
      context.lineTo(178, 202);
      context.lineTo(131, 214);
      context.closePath();
      context.fill();
      context.strokeStyle = "#082035";
      context.globalAlpha = 0.36;
      context.lineWidth = 8;
      context.stroke();
      context.globalAlpha = 1;
      context.fillStyle = "#082035";
      context.font = '900 48px "Ridge Display", sans-serif';
      context.textAlign = "center";
      context.textBaseline = "middle";
      context.save();
      context.translate(128, 384);
      context.rotate(-Math.PI / 2);
      context.fillText(label, 0, 0, 310);
      context.restore();
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
    this.ownedTextures.push(texture);
    return new THREE.MeshBasicMaterial({
      map: texture,
      side: THREE.DoubleSide,
      toneMapped: false,
    });
  }

  private createCanyonRouteSponsorBanners(
    totalLength: number,
    poleMaterial: THREE.MeshStandardMaterial,
  ): void {
    const bannersPerSide = this.quality === "low" ? 12 : this.quality === "medium" ? 24 : 38;
    const bannerCount = bannersPerSide * 2;
    const bannerMaterials = [
      this.createCanyonSponsorBannerMaterial("#14b8b6", "#f6d64a", "#f15f50", "RIVET"),
      this.createCanyonSponsorBannerMaterial("#f15f50", "#18c3c1", "#ffe56d", "RIDGE"),
      this.createCanyonSponsorBannerMaterial("#f4cb43", "#083250", "#18c3c1", "RALLY"),
      this.createCanyonSponsorBannerMaterial("#0b7894", "#f15f50", "#f5edda", "BOOST"),
    ];
    const panelMeshes = bannerMaterials.map((material, index) => {
      const mesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1.55, 3.7), material, bannerCount);
      mesh.name = `canyon-route-sponsor-banner-panels-${index + 1}`;
      mesh.count = 0;
      return mesh;
    });
    const poles = new THREE.InstancedMesh(
      new THREE.CylinderGeometry(0.055, 0.075, 3.35, 6),
      poleMaterial,
      bannerCount,
    );
    const matrix = new THREE.Matrix4();
    const rotation = new THREE.Quaternion();
    const random = seededRandom(0x52_52_52 + this.track.order);
    const usableLength = Math.max(180, totalLength - 105);
    let bannerIndex = 0;
    const materialCounts = bannerMaterials.map(() => 0);
    for (const side of [-1, 1] as const) {
      for (let index = 0; index < bannersPerSide; index += 1) {
        const progressRatio = index / Math.max(1, bannersPerSide - 1);
        const distance = 58 + progressRatio * usableLength + (random() - 0.5) * 5.5;
        const x = side * (9.95 + (index % 3) * 0.26 + random() * 0.14);
        const baseY = this.sceneryElevation(x);
        // Keep the panels mostly broadside to the chase camera. The safety wall
        // still separates them from the lanes, but they now read as the concept's
        // repeated vertical sponsor flags instead of disappearing edge-on.
        const yaw = side * -0.16 + (random() - 0.5) * 0.08;
        rotation.setFromEuler(new THREE.Euler(0, yaw, side * (0.04 + random() * 0.05)));
        matrix.compose(
          new THREE.Vector3(x, baseY + 2.58, -distance),
          rotation,
          new THREE.Vector3(1, 1, 1),
        );
        const materialIndex = (index + (side > 0 ? 2 : 0)) % panelMeshes.length;
        const materialInstanceIndex = materialCounts[materialIndex] ?? 0;
        panelMeshes[materialIndex]?.setMatrixAt(materialInstanceIndex, matrix);
        materialCounts[materialIndex] = materialInstanceIndex + 1;
        matrix.compose(
          new THREE.Vector3(x + side * 0.08, baseY + 1.68, -distance),
          new THREE.Quaternion(),
          new THREE.Vector3(1, 1, 1),
        );
        poles.setMatrixAt(bannerIndex, matrix);
        bannerIndex += 1;
      }
    }
    for (const [index, panels] of panelMeshes.entries()) {
      panels.count = materialCounts[index] ?? 0;
      panels.castShadow = this.quality === "high";
      panels.userData.presentationOnly = true;
    }
    poles.name = "canyon-route-sponsor-banner-poles";
    poles.castShadow = this.quality !== "low";
    poles.userData.presentationOnly = true;
    this.canvas.dataset.canyonRouteBannerStyle = "route-following-textured-sponsor-v2";
    this.canvas.dataset.canyonRouteBannerCount = String(bannerCount);
    this.canvas.dataset.canyonRouteBannerPoleCount = String(bannerCount);
    this.canvas.dataset.canyonRouteBannerTextureVariantCount = String(bannerMaterials.length);
    this.addCourseAnchored(...panelMeshes, poles);
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

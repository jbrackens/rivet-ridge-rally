export const TRACK_IDS = [
  "canyon-kickoff",
  "pine-run",
  "coastline-clash",
  "foundry-flight",
  "summit-showdown",
] as const;

export type TrackId = (typeof TRACK_IDS)[number];
export type LaneIndex = 0 | 1 | 2 | 3;
export type TrackPlacementRotation = 0 | 90 | 180 | 270;

export type ObstacleKind =
  | "bump"
  | "small-ramp"
  | "medium-ramp"
  | "large-ramp"
  | "jump-chain"
  | "mud"
  | "grass"
  | "cooling-gate"
  | "barrier"
  | "bank"
  | "super-jump";

export interface TrackObstacle {
  readonly id: string;
  readonly kind: ObstacleKind;
  readonly distance: number;
  readonly lanes: readonly LaneIndex[];
  readonly length?: number;
  readonly intensity?: number;
  /** Editor-only source metadata is optional so handcrafted tracks stay compact. */
  readonly moduleId?: string;
  readonly lateralPosition?: number;
  readonly unrotatedWidth?: number;
  readonly unrotatedLength?: number;
  readonly width?: number;
  readonly rotation?: TrackPlacementRotation;
  readonly height?: number;
  readonly rampImpulse?: number;
}

export type AuthoredTrackPieceKind =
  | "straight"
  | "curve-left"
  | "curve-right"
  | "bank-left"
  | "bank-right";

export interface AuthoredPlacementTransform {
  readonly id: string;
  readonly moduleId: string;
  /** Distance from the authored start grid along the scalar race route. */
  readonly distance: number;
  readonly sourceGridPosition: number;
  readonly lanes: readonly LaneIndex[];
  readonly lateralPosition: number;
  /** Intrinsic module size before applying rotation; used to build the visual. */
  readonly unrotatedWidth: number;
  readonly unrotatedLength: number;
  /** Axis-aligned footprint after applying rotation; used by route semantics. */
  readonly width: number;
  readonly length: number;
  readonly rotation: TrackPlacementRotation;
  readonly height: number;
}

export interface AuthoredRaceGate extends AuthoredPlacementTransform {
  readonly kind: "start" | "checkpoint" | "finish";
  readonly order: number;
}

export interface AuthoredTrackPiece extends AuthoredPlacementTransform {
  readonly kind: AuthoredTrackPieceKind;
}

export interface AuthoredCenterlineAnchor {
  /** Distance from the authored start grid along the scalar race route. */
  readonly distance: number;
  /** Presentation-only offset across the route, in metres. */
  readonly lateralOffset: number;
  /** Presentation-only height above the scalar race route, in metres. */
  readonly elevation: number;
}

export interface AuthoredCourseDefinition {
  readonly start: AuthoredRaceGate;
  readonly checkpoints: readonly AuthoredRaceGate[];
  readonly finish: AuthoredRaceGate;
  readonly centerline: readonly AuthoredCenterlineAnchor[];
  readonly trackPieces: readonly AuthoredTrackPiece[];
}

export interface TrackPalette {
  readonly sky: number;
  readonly fog: number;
  readonly dirt: number;
  readonly dirtDark: number;
  readonly grass: number;
  readonly rock: number;
  readonly accent: number;
}

export interface TrackDefinition {
  readonly id: TrackId;
  readonly order: number;
  readonly name: string;
  readonly tagline: string;
  readonly theme: string;
  readonly skillFocus: string;
  readonly courseLength: number;
  readonly soloTargetMs: number;
  readonly parTimeMs: number;
  readonly palette: TrackPalette;
  readonly obstacles: readonly TrackObstacle[];
  readonly masteryModifier?: string;
  /** Present only for editor-built courses; handcrafted courses use their tuned fallback route. */
  readonly authoredCourse?: AuthoredCourseDefinition;
}

const allLanes = [0, 1, 2, 3] as const;

export const TRACKS: readonly TrackDefinition[] = [
  {
    id: "canyon-kickoff",
    order: 1,
    name: "Canyon Kickoff",
    tagline: "Find the line. Feel the lift.",
    theme: "Sunlit red-rock festival",
    skillFocus: "Lane choice, heat, and clean landings",
    courseLength: 1_260,
    soloTargetMs: 148_000,
    parTimeMs: 132_000,
    palette: {
      sky: 0x69c8f3,
      fog: 0xd8eff7,
      dirt: 0xa95d32,
      dirtDark: 0x6f3827,
      grass: 0x78a345,
      rock: 0xb94f32,
      accent: 0x22d5dc,
    },
    obstacles: [
      { id: "ck-bumps-1", kind: "bump", distance: 45, lanes: [0, 2], intensity: 0.35 },
      { id: "ck-mud-1", kind: "mud", distance: 90, lanes: [1], length: 26 },
      { id: "ck-cool-1", kind: "cooling-gate", distance: 138, lanes: allLanes, length: 18 },
      { id: "ck-ramp-1", kind: "small-ramp", distance: 195, lanes: [0, 1], intensity: 0.45 },
      { id: "ck-barrier-1", kind: "barrier", distance: 260, lanes: [2] },
      { id: "ck-chain-1", kind: "jump-chain", distance: 350, lanes: [1, 2], length: 74, intensity: 0.55 },
      { id: "ck-mud-2", kind: "mud", distance: 690, lanes: [0, 3], length: 42 },
      { id: "ck-grass-1", kind: "grass", distance: 730, lanes: [0], length: 34 },
      { id: "ck-ramp-2", kind: "medium-ramp", distance: 790, lanes: [2, 3], intensity: 0.6 },
      { id: "ck-cool-2", kind: "cooling-gate", distance: 895, lanes: [1, 2], length: 22 },
      { id: "ck-bumps-2", kind: "bump", distance: 995, lanes: [0, 1, 3], intensity: 0.5 },
      { id: "ck-large-1", kind: "large-ramp", distance: 1_100, lanes: [1, 2], intensity: 0.68 },
    ],
  },
  {
    id: "pine-run",
    order: 2,
    name: "Pine Run",
    tagline: "Thread the timber rhythm.",
    theme: "Alpine logging festival",
    skillFocus: "Wheelies, bumps, and quick lane transitions",
    courseLength: 1_380,
    soloTargetMs: 154_000,
    parTimeMs: 138_000,
    palette: {
      sky: 0x8ed7ef,
      fog: 0xd8f0e7,
      dirt: 0x8b5c3d,
      dirtDark: 0x4d382c,
      grass: 0x3f7d50,
      rock: 0x6c6c61,
      accent: 0xf5c84b,
    },
    obstacles: [
      { id: "pr-bumps-1", kind: "bump", distance: 95, lanes: allLanes, intensity: 0.5 },
      { id: "pr-barrier-1", kind: "barrier", distance: 210, lanes: [0, 2] },
      { id: "pr-ramp-1", kind: "small-ramp", distance: 300, lanes: [1, 3], intensity: 0.46 },
      { id: "pr-mud-1", kind: "mud", distance: 405, lanes: [2, 3], length: 48 },
      { id: "pr-cool-1", kind: "cooling-gate", distance: 520, lanes: [0, 1], length: 20 },
      { id: "pr-chain-1", kind: "jump-chain", distance: 610, lanes: [1, 2], length: 88, intensity: 0.62 },
      { id: "pr-barrier-2", kind: "barrier", distance: 760, lanes: [1, 3] },
      { id: "pr-bumps-2", kind: "bump", distance: 850, lanes: [0, 2], intensity: 0.58 },
      { id: "pr-grass-1", kind: "grass", distance: 900, lanes: [3], length: 38 },
      { id: "pr-bank-1", kind: "bank", distance: 950, lanes: allLanes, length: 70 },
      { id: "pr-cool-2", kind: "cooling-gate", distance: 1_075, lanes: [2, 3], length: 20 },
      { id: "pr-large-1", kind: "large-ramp", distance: 1_195, lanes: [0, 1, 2], intensity: 0.7 },
    ],
  },
  {
    id: "coastline-clash",
    order: 3,
    name: "Coastline Clash",
    tagline: "Commit before the tide turns.",
    theme: "Bright cliffside boardwalk",
    skillFocus: "Long jumps, cross-lane setup, and turbo timing",
    courseLength: 1_490,
    soloTargetMs: 160_000,
    parTimeMs: 144_000,
    palette: {
      sky: 0x66d5ee,
      fog: 0xdaf5f1,
      dirt: 0xb87845,
      dirtDark: 0x795039,
      grass: 0x5b9d6c,
      rock: 0xd28b66,
      accent: 0xff6658,
    },
    obstacles: [
      { id: "cc-mud-1", kind: "mud", distance: 115, lanes: [0, 1], length: 55 },
      { id: "cc-ramp-1", kind: "medium-ramp", distance: 245, lanes: [2, 3], intensity: 0.62 },
      { id: "cc-barrier-1", kind: "barrier", distance: 350, lanes: [1, 3] },
      { id: "cc-cool-1", kind: "cooling-gate", distance: 455, lanes: [0, 2], length: 22 },
      { id: "cc-large-1", kind: "large-ramp", distance: 580, lanes: [1, 2], intensity: 0.73 },
      { id: "cc-mud-2", kind: "mud", distance: 735, lanes: [0, 3], length: 64 },
      { id: "cc-bank-1", kind: "bank", distance: 835, lanes: allLanes, length: 90 },
      { id: "cc-grass-1", kind: "grass", distance: 910, lanes: [0], length: 42 },
      { id: "cc-chain-1", kind: "jump-chain", distance: 970, lanes: [0, 1, 2], length: 104, intensity: 0.7 },
      { id: "cc-cool-2", kind: "cooling-gate", distance: 1_145, lanes: [2, 3], length: 24 },
      { id: "cc-barrier-2", kind: "barrier", distance: 1_260, lanes: [0, 2] },
      { id: "cc-super-1", kind: "super-jump", distance: 1_355, lanes: [1, 3], intensity: 0.84 },
    ],
  },
  {
    id: "foundry-flight",
    order: 4,
    name: "Foundry Flight",
    tagline: "Ride the sparks, land the line.",
    theme: "Colorful reclaimed metalworks",
    skillFocus: "Technical jump chains, heat planning, and recovery",
    courseLength: 1_590,
    soloTargetMs: 166_000,
    parTimeMs: 150_000,
    palette: {
      sky: 0x7abed4,
      fog: 0xd3e2df,
      dirt: 0x84513b,
      dirtDark: 0x46322b,
      grass: 0x607b48,
      rock: 0x805747,
      accent: 0xff8147,
    },
    obstacles: [
      { id: "ff-bumps-1", kind: "bump", distance: 100, lanes: [0, 1, 3], intensity: 0.62 },
      { id: "ff-barrier-1", kind: "barrier", distance: 215, lanes: [1, 2] },
      { id: "ff-ramp-1", kind: "medium-ramp", distance: 330, lanes: [0, 3], intensity: 0.68 },
      { id: "ff-mud-1", kind: "mud", distance: 460, lanes: [1, 2], length: 70 },
      { id: "ff-cool-1", kind: "cooling-gate", distance: 575, lanes: [0, 3], length: 20 },
      { id: "ff-chain-1", kind: "jump-chain", distance: 690, lanes: [1, 2, 3], length: 120, intensity: 0.76 },
      { id: "ff-barrier-2", kind: "barrier", distance: 870, lanes: [0, 2] },
      { id: "ff-grass-1", kind: "grass", distance: 930, lanes: [3], length: 44 },
      { id: "ff-large-1", kind: "large-ramp", distance: 990, lanes: [1, 3], intensity: 0.78 },
      { id: "ff-cool-2", kind: "cooling-gate", distance: 1_125, lanes: [1, 2], length: 24 },
      { id: "ff-bank-1", kind: "bank", distance: 1_250, lanes: allLanes, length: 86 },
      { id: "ff-super-1", kind: "super-jump", distance: 1_410, lanes: [0, 2, 3], intensity: 0.88 },
    ],
  },
  {
    id: "summit-showdown",
    order: 5,
    name: "Summit Showdown",
    tagline: "Every line is a decision.",
    theme: "High-altitude festival finale",
    skillFocus: "Mastery of every system under pressure",
    courseLength: 1_720,
    soloTargetMs: 174_000,
    parTimeMs: 157_000,
    masteryModifier: "Hot Start: begin at 35% heat and chase a tighter target",
    palette: {
      sky: 0x98c9eb,
      fog: 0xe6eef4,
      dirt: 0x8c684e,
      dirtDark: 0x514338,
      grass: 0x61855a,
      rock: 0x7e7180,
      accent: 0xffd34d,
    },
    obstacles: [
      { id: "ss-bumps-1", kind: "bump", distance: 90, lanes: allLanes, intensity: 0.68 },
      { id: "ss-mud-1", kind: "mud", distance: 205, lanes: [0, 2], length: 58 },
      { id: "ss-ramp-1", kind: "medium-ramp", distance: 330, lanes: [1, 3], intensity: 0.7 },
      { id: "ss-barrier-1", kind: "barrier", distance: 455, lanes: [0, 3] },
      { id: "ss-cool-1", kind: "cooling-gate", distance: 570, lanes: [1, 2], length: 18 },
      { id: "ss-chain-1", kind: "jump-chain", distance: 680, lanes: [0, 1, 3], length: 126, intensity: 0.8 },
      { id: "ss-bank-1", kind: "bank", distance: 860, lanes: allLanes, length: 95 },
      { id: "ss-grass-1", kind: "grass", distance: 945, lanes: [0, 3], length: 46 },
      { id: "ss-large-1", kind: "large-ramp", distance: 1_010, lanes: [1, 2], intensity: 0.84 },
      { id: "ss-mud-2", kind: "mud", distance: 1_145, lanes: [0, 3], length: 74 },
      { id: "ss-cool-2", kind: "cooling-gate", distance: 1_275, lanes: [0, 2], length: 22 },
      { id: "ss-barrier-2", kind: "barrier", distance: 1_390, lanes: [1, 3] },
      { id: "ss-super-1", kind: "super-jump", distance: 1_525, lanes: [0, 1, 2], intensity: 0.94 },
    ],
  },
] as const;

export const TRACK_BY_ID = new Map(TRACKS.map((track) => [track.id, track]));

export function getTrack(trackId: TrackId): TrackDefinition {
  const track = TRACK_BY_ID.get(trackId);
  if (!track) {
    throw new Error(`Unknown track: ${trackId}`);
  }
  return track;
}

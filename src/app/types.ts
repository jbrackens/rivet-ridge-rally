import type { TrackId } from "../game/content/tracks";

export type AppScreen =
  | "boot"
  | "title"
  | "mode-select"
  | "track-select"
  | "tutorial"
  | "race"
  | "paused"
  | "results"
  | "editor"
  | "custom-library"
  | "settings"
  | "support";

export type RaceMode = "solo" | "rival" | "practice" | "tutorial" | "custom" | "mastery";
export type Difficulty = "rookie" | "rider" | "ace";
export type QualityLevel = "auto" | "low" | "medium" | "high";

export interface AccessibilitySettings {
  reducedMotion: boolean;
  reducedShake: boolean;
  highContrast: boolean;
  captions: boolean;
  colorblindSafe: boolean;
  uiScale: number;
}

export interface AudioSettings {
  master: number;
  music: number;
  sfx: number;
}

export interface ControlSettings {
  mirroredTouch: boolean;
  retroRecovery: boolean;
  vibration: boolean;
  keyBindings: Record<string, string>;
}

export interface GameSettings {
  quality: QualityLevel;
  difficulty: Difficulty;
  accessibility: AccessibilitySettings;
  audio: AudioSettings;
  controls: ControlSettings;
}

export interface TrackProgress {
  soloQualified: boolean;
  rivalUnlocked: boolean;
  bestSoloMs?: number | undefined;
  bestRivalPosition?: number | undefined;
  masteryLevel: number;
}

export interface CampaignProgress {
  version: 1;
  tutorialComplete: boolean;
  selectedTrackId: TrackId;
  tracks: Record<TrackId, TrackProgress>;
}

export interface MasteryGoal {
  tier: number;
  tierCount: number;
  targetMs: number;
  modifier: string;
  startingHeat: number;
  isMaxTierReplay: boolean;
}

export interface RaceClassificationEntry {
  riderId: string;
  riderName: string;
  position: number;
  finishTimeMs: number;
  isPlayer: boolean;
}

export interface RaceResult {
  mode: RaceMode;
  trackId: TrackId;
  finishTimeMs: number;
  position: number;
  fieldSize: number;
  checkpointCount: number;
  lapTimesMs: readonly number[];
  splitTimesMs: readonly number[];
  targetMs?: number | undefined;
  personalBest: boolean;
  previousBestMs?: number | undefined;
  bestTimeMs?: number | undefined;
  classification: readonly RaceClassificationEntry[];
  crashes: number;
  overheats: number;
  coachingHint: string;
  masteryGoal?: MasteryGoal | undefined;
  masteryGoalMet?: boolean | undefined;
}

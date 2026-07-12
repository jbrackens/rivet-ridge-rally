import Dexie, { type EntityTable, type Transaction } from "dexie";
import { z } from "zod";

import { TRACK_IDS, type TrackId } from "../content/tracks";
import { validateCustomTrack } from "../editor/validation";
import type {
  CampaignProgress,
  GameSettings,
  RaceResult,
  TrackProgress,
} from "../../app/types";

const DATABASE_NAME = "rivet-ridge-rally";
const ACTIVE_PROFILE_ID = "rider-01";
export const MAX_CUSTOM_TRACK_FILE_BYTES = 1_000_000;

export type PersistenceFailureReason = "unavailable" | "quota" | "upgrade" | "blocked" | "write";
export type PersistenceOperation = "load" | "settings" | "progress" | "custom-tracks" | "replay" | "recovery" | "retry";

export interface PersistenceFailure {
  reason: PersistenceFailureReason;
  operation: PersistenceOperation;
  occurredAt: number;
}

type PersistenceFailureListener = (failure: PersistenceFailure) => void;

const persistenceFailureListeners = new Set<PersistenceFailureListener>();

export function subscribePersistenceFailures(listener: PersistenceFailureListener): () => void {
  persistenceFailureListeners.add(listener);
  return () => persistenceFailureListeners.delete(listener);
}

function errorText(error: unknown): string {
  if (!(error instanceof Error)) return String(error).toLowerCase();
  const cause = error.cause instanceof Error ? `${error.cause.name} ${error.cause.message}` : "";
  return `${error.name} ${error.message} ${cause}`.toLowerCase();
}

export function classifyPersistenceFailure(
  error: unknown,
  operation: PersistenceOperation,
): PersistenceFailureReason {
  const text = errorText(error);
  if (text.includes("quota") || text.includes("disk full")) return "quota";
  if (text.includes("versionerror") || text.includes("upgrade")) return "upgrade";
  if (text.includes("blocked")) return "blocked";
  if (
    text.includes("missingapi")
    || text.includes("not supported")
    || text.includes("securityerror")
    || text.includes("openfailed")
    || text.includes("databaseclosed")
    || text.includes("invalidstateerror")
  ) return "unavailable";
  return operation === "load" ? "unavailable" : "write";
}

function publishPersistenceFailure(error: unknown, operation: PersistenceOperation): void {
  const failure: PersistenceFailure = {
    reason: classifyPersistenceFailure(error, operation),
    operation,
    occurredAt: Date.now(),
  };
  for (const listener of persistenceFailureListeners) listener(failure);
}

async function capturePersistenceFailure<T>(
  operation: PersistenceOperation,
  task: () => Promise<T>,
): Promise<T> {
  try {
    return await task();
  } catch (error) {
    publishPersistenceFailure(error, operation);
    throw error;
  }
}

interface SettingsRecord {
  id: string;
  schemaVersion: 1;
  value: GameSettings;
  updatedAt: number;
}

interface ProgressRecord {
  id: string;
  schemaVersion: 1;
  value: CampaignProgress;
  updatedAt: number;
}

export interface CustomTrackModule {
  id: string;
  moduleId: string;
  lane: 0 | 1 | 2 | 3;
  gridPosition: number;
  rotation: 0 | 90 | 180 | 270;
  height: number;
}

export interface CustomTrackData {
  schemaVersion: 1;
  id: string;
  name: string;
  laps: number;
  difficultyEstimate: number;
  modules: CustomTrackModule[];
  thumbnail?: string | undefined;
  createdAt: number;
  updatedAt: number;
}

interface ReplayRecord {
  id: string;
  schemaVersion: 1;
  trackId: TrackId | "custom";
  mode: RaceResult["mode"];
  result: RaceResult;
  samples: Uint8Array;
  createdAt: number;
}

interface QuarantineRecord {
  key?: number;
  kind: "settings" | "progress" | "custom-track" | "replay";
  reason: string;
  payload: unknown;
  createdAt: number;
}

interface LegacyVersionedRecord {
  schemaVersion?: 1;
  updatedAt?: number;
  createdAt?: number;
}

function ensureTimestamp(
  record: LegacyVersionedRecord,
  field: "updatedAt" | "createdAt",
  migratedAt: number,
): void {
  const value = record[field];
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    record[field] = migratedAt;
  }
}

async function migrateToVersion2(transaction: Transaction): Promise<void> {
  const migratedAt = Date.now();
  await Promise.all([
    transaction.table<LegacyVersionedRecord, string>("settings").toCollection().modify((record) => {
      ensureTimestamp(record, "updatedAt", migratedAt);
    }),
    transaction.table<LegacyVersionedRecord, string>("progress").toCollection().modify((record) => {
      ensureTimestamp(record, "updatedAt", migratedAt);
    }),
  ]);
}

async function migrateToVersion3(transaction: Transaction): Promise<void> {
  const migratedAt = Date.now();
  await Promise.all([
    ...["settings", "progress", "customTracks"].map((tableName) => (
      transaction.table<LegacyVersionedRecord, string>(tableName).toCollection().modify((record) => {
        if (record.schemaVersion === undefined) record.schemaVersion = 1;
        ensureTimestamp(record, "updatedAt", migratedAt);
      })
    )),
    transaction.table<LegacyVersionedRecord, string>("replays").toCollection().modify((record) => {
      if (record.schemaVersion === undefined) record.schemaVersion = 1;
      ensureTimestamp(record, "createdAt", migratedAt);
    }),
  ]);
}

const defaultTrackProgress = (): TrackProgress => ({
  soloQualified: false,
  rivalUnlocked: false,
  masteryLevel: 0,
});

export const DEFAULT_SETTINGS: GameSettings = {
  quality: "auto",
  difficulty: "rider",
  accessibility: {
    reducedMotion: false,
    reducedShake: false,
    highContrast: false,
    captions: true,
    colorblindSafe: true,
    uiScale: 1,
  },
  audio: {
    master: 0.8,
    music: 0.55,
    sfx: 0.8,
  },
  controls: {
    mirroredTouch: false,
    retroRecovery: false,
    vibration: true,
    keyBindings: {
      throttle: "KeyW",
      turbo: "ShiftLeft",
      laneLeft: "KeyA",
      laneRight: "KeyD",
      pitchUp: "ArrowUp",
      pitchDown: "ArrowDown",
      recover: "Space",
      pause: "Escape",
    },
  },
};

export function createDefaultProgress(): CampaignProgress {
  return {
    version: 1,
    tutorialComplete: false,
    selectedTrackId: TRACK_IDS[0],
    tracks: Object.fromEntries(
      TRACK_IDS.map((trackId) => [trackId, defaultTrackProgress()]),
    ) as Record<TrackId, TrackProgress>,
  };
}

const settingsSchema = z.object({
  quality: z.enum(["auto", "low", "medium", "high"]),
  difficulty: z.enum(["rookie", "rider", "ace"]),
  accessibility: z.object({
    reducedMotion: z.boolean(),
    reducedShake: z.boolean(),
    highContrast: z.boolean(),
    captions: z.boolean(),
    colorblindSafe: z.boolean(),
    uiScale: z.number().min(0.8).max(1.4),
  }),
  audio: z.object({
    master: z.number().min(0).max(1),
    music: z.number().min(0).max(1),
    sfx: z.number().min(0).max(1),
  }),
  controls: z.object({
    mirroredTouch: z.boolean(),
    retroRecovery: z.boolean(),
    vibration: z.boolean(),
    keyBindings: z.record(z.string(), z.string()),
  }),
});

const trackProgressSchema = z.object({
  soloQualified: z.boolean(),
  rivalUnlocked: z.boolean(),
  bestSoloMs: z.number().positive().optional(),
  bestRivalPosition: z.number().int().min(1).optional(),
  masteryLevel: z.number().int().min(0),
});

const progressSchema = z.object({
  version: z.literal(1),
  tutorialComplete: z.boolean(),
  selectedTrackId: z.enum(TRACK_IDS),
  tracks: z.record(z.enum(TRACK_IDS), trackProgressSchema),
});

const customTrackModuleSchema = z.object({
  id: z.string().min(1).max(80),
  moduleId: z.string().min(1).max(80),
  lane: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]),
  gridPosition: z.number().int().min(0).max(20_000),
  rotation: z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]),
  height: z.number().min(-4).max(40),
});

export const customTrackSchema = z.object({
  schemaVersion: z.literal(1),
  id: z.string().min(1).max(80),
  name: z.string().trim().min(1).max(42),
  laps: z.number().int().min(1).max(9),
  difficultyEstimate: z.number().int().min(1).max(5),
  modules: z.array(customTrackModuleSchema).min(3).max(500),
  thumbnail: z.string().max(300_000).refine(
    (value) => /^data:image\/(?:png|jpeg|webp);base64,[a-z0-9+/=]+$/i.test(value),
    "Thumbnail must be an embedded image data URL.",
  ).optional(),
  createdAt: z.number().int().positive(),
  updatedAt: z.number().int().positive(),
});

class GameDatabase extends Dexie {
  settings!: EntityTable<SettingsRecord, "id">;
  progress!: EntityTable<ProgressRecord, "id">;
  customTracks!: EntityTable<CustomTrackData, "id">;
  replays!: EntityTable<ReplayRecord, "id">;
  quarantine!: EntityTable<QuarantineRecord, "key">;

  constructor() {
    super(DATABASE_NAME);
    this.version(1).stores({
      settings: "id",
      progress: "id",
    });
    this.version(2).stores({
      settings: "id",
      progress: "id",
      customTracks: "id,name,updatedAt",
      replays: "id,trackId,createdAt",
    }).upgrade(migrateToVersion2);
    this.version(3).stores({
      settings: "id,schemaVersion,updatedAt",
      progress: "id,schemaVersion,updatedAt",
      customTracks: "id,schemaVersion,name,updatedAt",
      replays: "id,schemaVersion,trackId,createdAt",
      quarantine: "++key,kind,createdAt",
    }).upgrade(migrateToVersion3);
  }
}

export const gameDatabase = new GameDatabase();

async function quarantine(
  kind: QuarantineRecord["kind"],
  payload: unknown,
  reason: string,
): Promise<void> {
  try {
    await gameDatabase.quarantine.add({ kind, payload, reason, createdAt: Date.now() });
  } catch (error) {
    publishPersistenceFailure(error, "recovery");
    // A failed backup must not stop the player from reaching a clean save state.
  }
}

async function putSettingsRecord(settings: GameSettings): Promise<void> {
  const value = settingsSchema.parse(settings);
  await gameDatabase.settings.put({
    id: ACTIVE_PROFILE_ID,
    schemaVersion: 1,
    value,
    updatedAt: Date.now(),
  });
}

async function putProgressRecord(progress: CampaignProgress): Promise<void> {
  const value = progressSchema.parse(progress);
  await gameDatabase.progress.put({
    id: ACTIVE_PROFILE_ID,
    schemaVersion: 1,
    value,
    updatedAt: Date.now(),
  });
}

async function putProfileData(settings: GameSettings, progress: CampaignProgress): Promise<void> {
  await gameDatabase.transaction("rw", gameDatabase.settings, gameDatabase.progress, async () => {
    await Promise.all([putSettingsRecord(settings), putProgressRecord(progress)]);
  });
}

export async function loadGameData(): Promise<{
  settings: GameSettings;
  progress: CampaignProgress;
  recovered: boolean;
}> {
  return capturePersistenceFailure("load", async () => {
    const [settingsRecord, progressRecord] = await Promise.all([
      gameDatabase.settings.get(ACTIVE_PROFILE_ID),
      gameDatabase.progress.get(ACTIVE_PROFILE_ID),
    ]);
    let recovered = false;

    const parsedSettings = settingsSchema.safeParse(settingsRecord?.value);
    const settings = parsedSettings.success ? parsedSettings.data : DEFAULT_SETTINGS;
    if (settingsRecord && !parsedSettings.success) {
      recovered = true;
      await quarantine("settings", settingsRecord, parsedSettings.error.message);
    }

    const parsedProgress = progressSchema.safeParse(progressRecord?.value);
    const progress = parsedProgress.success ? parsedProgress.data : createDefaultProgress();
    if (progressRecord && !parsedProgress.success) {
      recovered = true;
      await quarantine("progress", progressRecord, parsedProgress.error.message);
    }

    if (!settingsRecord || !progressRecord || recovered) {
      await putProfileData(settings, progress);
    }

    return { settings, progress, recovered };
  });
}

export async function saveSettings(settings: GameSettings): Promise<void> {
  await capturePersistenceFailure("settings", () => putSettingsRecord(settings));
}

export async function saveProgress(progress: CampaignProgress): Promise<void> {
  await capturePersistenceFailure("progress", () => putProgressRecord(progress));
}

export async function retryPersistence(
  settings: GameSettings,
  progress: CampaignProgress,
): Promise<void> {
  await capturePersistenceFailure("retry", async () => {
    gameDatabase.close();
    await gameDatabase.open();
    await putProfileData(settings, progress);
  });
}

export async function listCustomTracks(): Promise<CustomTrackData[]> {
  return capturePersistenceFailure("custom-tracks", async () => {
    const records = await gameDatabase.customTracks.orderBy("updatedAt").reverse().toArray();
    const valid: CustomTrackData[] = [];
    for (const record of records) {
      const parsed = customTrackSchema.safeParse(record);
      const routeValidation = parsed.success ? validateCustomTrack(parsed.data) : null;
      if (parsed.success && routeValidation?.valid) {
        valid.push(parsed.data);
      } else {
        const reason = parsed.success
          ? routeValidation?.errors.join(" ") ?? "Custom track route is invalid."
          : parsed.error.message;
        await quarantine("custom-track", record, reason);
      }
    }
    return valid;
  });
}

export async function saveCustomTrack(track: CustomTrackData): Promise<void> {
  const parsed = customTrackSchema.parse(track);
  const validation = validateCustomTrack(parsed);
  if (!validation.valid) throw new Error(validation.errors[0] ?? "Custom track route is invalid.");
  await capturePersistenceFailure("custom-tracks", () => gameDatabase.customTracks.put(parsed).then(() => undefined));
}

export async function deleteCustomTrack(trackId: string): Promise<void> {
  await capturePersistenceFailure("custom-tracks", () => gameDatabase.customTracks.delete(trackId));
}

export function exportCustomTrack(track: CustomTrackData): string {
  const parsed = customTrackSchema.parse(track);
  const validation = validateCustomTrack(parsed);
  if (!validation.valid) throw new Error(validation.errors[0] ?? "Custom track route is invalid.");
  return JSON.stringify(parsed, null, 2);
}

export function importCustomTrack(serialized: string): CustomTrackData {
  if (new Blob([serialized]).size > MAX_CUSTOM_TRACK_FILE_BYTES) {
    throw new Error("Track file exceeds the 1 MB safety limit.");
  }
  let decoded: unknown;
  try {
    decoded = JSON.parse(serialized) as unknown;
  } catch {
    throw new Error("Track file is not valid JSON.");
  }
  const parsed = customTrackSchema.safeParse(decoded);
  if (!parsed.success) {
    throw new Error(`Track file is incompatible or invalid: ${parsed.error.issues[0]?.message ?? "unknown error"}`);
  }
  const validation = validateCustomTrack(parsed.data);
  if (!validation.valid) {
    throw new Error(`Track route is invalid: ${validation.errors[0] ?? "the route is not playable."}`);
  }
  return parsed.data;
}

export async function saveReplay(
  result: RaceResult,
  samples: Uint8Array,
): Promise<void> {
  const record: ReplayRecord = {
    id: crypto.randomUUID(),
    schemaVersion: 1,
    trackId: result.mode === "custom" ? "custom" : result.trackId,
    mode: result.mode,
    result,
    samples,
    createdAt: Date.now(),
  };
  await capturePersistenceFailure("replay", async () => {
    await gameDatabase.replays.put(record);

    const older = await gameDatabase.replays
      .where("trackId")
      .equals(result.trackId)
      .reverse()
      .sortBy("createdAt");
    await gameDatabase.replays.bulkDelete(older.slice(20).map((replay) => replay.id));
  });
}

import Dexie, { type EntityTable, type Transaction } from "dexie";
import { z } from "zod";

import { TRACK_IDS, type TrackId } from "../content/tracks";
import {
  CUSTOM_TRACK_MODULE_LIMIT,
  CUSTOM_TRACK_NAME_MAX_CHARS,
  validateCustomTrack,
  validateLegacyCustomTrack,
} from "../editor/validation";
import type {
  CampaignProgress,
  GameSettings,
  RaceResult,
  TrackProgress,
} from "../../app/types";

const DATABASE_NAME = "rivet-ridge-rally";
const ACTIVE_PROFILE_ID = "rider-01";
const CURRENT_PROFILE_SCHEMA_VERSION = 1;
const CURRENT_CUSTOM_TRACK_SCHEMA_VERSION = 2;
const BLOCKED_OPEN_GRACE_MS = 2_000;
const MAX_CUSTOM_TRACK_JSON_DEPTH = 20;
const MAX_CUSTOM_TRACK_JSON_ITEMS = 10_000;
const MAX_CUSTOM_TRACK_JSON_STRING_CHARS = 350_000;
export const MAX_CUSTOM_TRACK_FILE_BYTES = 1_000_000;
export const MAX_CUSTOM_TRACK_RECORDS = 100;
export const CUSTOM_TRACK_ROUTE_ANCHOR_LATERAL_LIMIT = 16;
export const CUSTOM_TRACK_ROUTE_ANCHOR_ELEVATION_LIMIT = 12;
const MAX_CUSTOM_TRACK_RECORD_BYTES = 750_000;
const MAX_CUSTOM_TRACK_TOTAL_BYTES = 25_000_000;
const MAX_QUARANTINE_RECORDS = 100;
const MAX_QUARANTINE_RECORD_BYTES = 1_000_000;
const MAX_QUARANTINE_TOTAL_BYTES = 10_000_000;
const MAX_REPLAY_SAMPLE_BYTES = 512_000;

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
  if (text.includes("blocked")) return "blocked";
  if (text.includes("versionerror") || text.includes("upgrade")) return "upgrade";
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
    await ensureDatabaseOpen();
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

interface ProfileData {
  settings: GameSettings;
  progress: CampaignProgress;
  recovered: boolean;
}

export interface RetryPersistenceOptions {
  preserveExistingProfile: boolean;
}

export interface CustomTrackModule {
  id: string;
  moduleId: string;
  lane: 0 | 1 | 2 | 3;
  gridPosition: number;
  rotation: 0 | 90 | 180 | 270;
  height: number;
  routeAnchor?: CustomTrackRouteAnchor | undefined;
}

export interface CustomTrackRouteAnchor {
  lateralOffset: number;
  elevation: number;
}

export interface CustomTrackData {
  schemaVersion: 2;
  id: string;
  name: string;
  laps: number;
  difficultyEstimate: number;
  modules: CustomTrackModule[];
  thumbnail?: string | undefined;
  createdAt: number;
  updatedAt: number;
}

type LegacyCustomTrackModule = Omit<CustomTrackModule, "routeAnchor">;

interface LegacyCustomTrackData {
  schemaVersion: 1;
  id: string;
  name: string;
  laps: number;
  difficultyEstimate: number;
  modules: LegacyCustomTrackModule[];
  thumbnail?: string | undefined;
  createdAt: number;
  updatedAt: number;
}

type StoredCustomTrackData = LegacyCustomTrackData | CustomTrackData;

export interface CustomTrackRecovery {
  key: number | null;
  name: string;
  reason: string;
  payload: unknown;
  createdAt: number;
  quarantined: boolean;
}

export interface CustomTrackLibrary {
  tracks: CustomTrackData[];
  recoveries: CustomTrackRecovery[];
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
  payloadBytes?: number;
  createdAt: number;
}

interface LegacyVersionedRecord {
  schemaVersion?: 1;
  updatedAt?: number;
  createdAt?: number;
}

interface LegacySettingsRecord extends LegacyVersionedRecord {
  value?: {
    controls?: {
      keyBindings?: Record<string, string>;
    };
  };
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

async function migrateToVersion4(transaction: Transaction): Promise<void> {
  const migratedAt = Date.now();
  await transaction.table<LegacySettingsRecord, string>("settings").toCollection().modify((record) => {
    const keyBindings = record.value?.controls?.keyBindings;
    if (keyBindings?.laneLeft !== "KeyA" || keyBindings.laneRight !== "KeyD") return;
    for (const [action, code] of Object.entries(keyBindings)) {
      if (action === "laneLeft" || action === "laneRight") continue;
      if (code === "ArrowLeft") keyBindings[action] = "KeyA";
      if (code === "ArrowRight") keyBindings[action] = "KeyD";
    }
    keyBindings.laneLeft = "ArrowLeft";
    keyBindings.laneRight = "ArrowRight";
    record.updatedAt = migratedAt;
  });
}

async function migrateToVersion5(transaction: Transaction): Promise<void> {
  await transaction
    .table<Record<string, unknown>, string>("customTracks")
    .toCollection()
    .modify((record) => {
      const parsed = legacyCustomTrackSchema.safeParse(record);
      if (!parsed.success) return;
      const normalized = normalizeLegacyCustomTrack(parsed.data);
      // Tracks that passed the former center-only route boundary but need a
      // full-footprint repair remain stored as v1. The library normalizes them
      // in memory so the owner can edit them; only current-valid rows are
      // upgraded in place and may be saved/exported as v2 unchanged.
      if (!validateCustomTrack(normalized).valid) return;
      // Preserve the exact stored payload and timestamps. Only the record's
      // declared schema changes; route anchors remain absent and therefore flat.
      record.schemaVersion = CURRENT_CUSTOM_TRACK_SCHEMA_VERSION;
    });
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
      laneLeft: "ArrowLeft",
      laneRight: "ArrowRight",
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

const REQUIRED_KEY_BINDING_ACTIONS = [
  "throttle",
  "turbo",
  "laneLeft",
  "laneRight",
  "pitchUp",
  "pitchDown",
  "recover",
  "pause",
] as const;

const keyCodeSchema = z.string().trim().min(1).max(64);

const keyBindingsSchema = z
  .object({
    throttle: keyCodeSchema,
    turbo: keyCodeSchema,
    laneLeft: keyCodeSchema,
    laneRight: keyCodeSchema,
    pitchUp: keyCodeSchema,
    pitchDown: keyCodeSchema,
    recover: keyCodeSchema,
    pause: keyCodeSchema,
  })
  .strict()
  .refine(
    (bindings) => {
      const values = REQUIRED_KEY_BINDING_ACTIONS.map((action) => bindings[action]);
      return new Set(values).size === values.length;
    },
    { message: "Required control bindings must be unique." },
  );

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
  }).strict(),
  audio: z.object({
    master: z.number().min(0).max(1),
    music: z.number().min(0).max(1),
    sfx: z.number().min(0).max(1),
  }).strict(),
  controls: z.object({
    mirroredTouch: z.boolean(),
    retroRecovery: z.boolean(),
    vibration: z.boolean(),
    keyBindings: keyBindingsSchema,
  }).strict(),
}).strict();

const bestSoloLapTimesSchema = z.array(z.number().int().positive()).max(9);
const bestSoloSplitTimesSchema = z.array(z.number().int().positive()).max(64);

const trackProgressSchema = z.object({
  soloQualified: z.boolean(),
  rivalUnlocked: z.boolean(),
  bestSoloMs: z.number().positive().optional(),
  bestSoloLapTimesMs: bestSoloLapTimesSchema.optional(),
  bestSoloSplitTimesMs: bestSoloSplitTimesSchema.optional(),
  bestRivalPosition: z.number().int().min(1).optional(),
  masteryLevel: z.number().int().min(0),
}).strict();

const progressSchema = z.object({
  version: z.literal(1),
  tutorialComplete: z.boolean(),
  selectedTrackId: z.enum(TRACK_IDS),
  tracks: z.record(z.enum(TRACK_IDS), trackProgressSchema),
}).strict();

const settingsRecordSchema = z.object({
  id: z.literal(ACTIVE_PROFILE_ID),
  schemaVersion: z.literal(CURRENT_PROFILE_SCHEMA_VERSION),
  value: settingsSchema,
  updatedAt: z.number().int().positive(),
}).strict();

const progressRecordSchema = z.object({
  id: z.literal(ACTIVE_PROFILE_ID),
  schemaVersion: z.literal(CURRENT_PROFILE_SCHEMA_VERSION),
  value: progressSchema,
  updatedAt: z.number().int().positive(),
}).strict();

const legacyCustomTrackModuleSchema = z.object({
  id: z.string().min(1).max(80),
  moduleId: z.string().min(1).max(80),
  lane: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]),
  gridPosition: z.number().int().min(0).max(20_000),
  rotation: z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]),
  height: z.number().min(-4).max(40),
}).strict();

const customTrackRouteAnchorSchema = z.object({
  lateralOffset: z.number()
    .min(-CUSTOM_TRACK_ROUTE_ANCHOR_LATERAL_LIMIT)
    .max(CUSTOM_TRACK_ROUTE_ANCHOR_LATERAL_LIMIT),
  elevation: z.number().min(0).max(CUSTOM_TRACK_ROUTE_ANCHOR_ELEVATION_LIMIT),
}).strict();

const customTrackModuleSchema = legacyCustomTrackModuleSchema.extend({
  routeAnchor: customTrackRouteAnchorSchema.optional(),
}).strict().superRefine((module, context) => {
  if (module.routeAnchor !== undefined && module.moduleId !== "checkpoint") {
    context.addIssue({
      code: "custom",
      path: ["routeAnchor"],
      message: "Only checkpoint modules may define a route anchor.",
    });
  }
});

const customTrackThumbnailSchema = z.string().max(300_000).refine(
  (value) => /^data:image\/(?:png|jpeg|webp);base64,[a-z0-9+/=]+$/i.test(value),
  "Thumbnail must be an embedded image data URL.",
);

const legacyCustomTrackSchema = z.object({
  schemaVersion: z.literal(1),
  id: z.string().min(1).max(80),
  name: z.string().trim().min(1).max(CUSTOM_TRACK_NAME_MAX_CHARS),
  laps: z.number().int().min(1).max(9),
  difficultyEstimate: z.number().int().min(1).max(5),
  modules: z.array(legacyCustomTrackModuleSchema).min(3).max(CUSTOM_TRACK_MODULE_LIMIT),
  thumbnail: customTrackThumbnailSchema.optional(),
  createdAt: z.number().int().positive(),
  updatedAt: z.number().int().positive(),
}).strict();

export const customTrackSchema = z.object({
  schemaVersion: z.literal(CURRENT_CUSTOM_TRACK_SCHEMA_VERSION),
  id: z.string().min(1).max(80),
  name: z.string().trim().min(1).max(CUSTOM_TRACK_NAME_MAX_CHARS),
  laps: z.number().int().min(1).max(9),
  difficultyEstimate: z.number().int().min(1).max(5),
  modules: z.array(customTrackModuleSchema).min(3).max(CUSTOM_TRACK_MODULE_LIMIT),
  thumbnail: customTrackThumbnailSchema.optional(),
  createdAt: z.number().int().positive(),
  updatedAt: z.number().int().positive(),
}).strict();

function normalizeLegacyCustomTrack(track: LegacyCustomTrackData): CustomTrackData {
  return {
    ...track,
    schemaVersion: CURRENT_CUSTOM_TRACK_SCHEMA_VERSION,
  };
}

type CustomTrackParseResult =
  | { success: true; track: CustomTrackData }
  | { success: false; reason: string };

function parseCustomTrackRecord(record: unknown): CustomTrackParseResult {
  const current = customTrackSchema.safeParse(record);
  if (current.success) return { success: true, track: current.data };

  const legacy = legacyCustomTrackSchema.safeParse(record);
  if (legacy.success) {
    return { success: true, track: normalizeLegacyCustomTrack(legacy.data) };
  }

  const schemaVersion = record && typeof record === "object"
    ? Reflect.get(record, "schemaVersion")
    : undefined;
  const error = schemaVersion === 1 ? legacy.error : current.error;
  return { success: false, reason: error.message };
}

class GameDatabase extends Dexie {
  settings!: EntityTable<SettingsRecord, "id">;
  progress!: EntityTable<ProgressRecord, "id">;
  customTracks!: EntityTable<StoredCustomTrackData, "id">;
  replays!: EntityTable<ReplayRecord, "id">;
  quarantine!: EntityTable<QuarantineRecord, "key">;

  constructor() {
    super(DATABASE_NAME, { autoOpen: false });
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
    this.version(4).stores({
      settings: "id,schemaVersion,updatedAt",
      progress: "id,schemaVersion,updatedAt",
      customTracks: "id,schemaVersion,name,updatedAt",
      replays: "id,schemaVersion,trackId,createdAt",
      quarantine: "++key,kind,createdAt",
    }).upgrade(migrateToVersion4);
    this.version(5).stores({
      settings: "id,schemaVersion,updatedAt",
      progress: "id,schemaVersion,updatedAt",
      customTracks: "id,schemaVersion,name,updatedAt",
      replays: "id,schemaVersion,trackId,createdAt",
      quarantine: "++key,kind,createdAt",
    }).upgrade(migrateToVersion5);
  }
}

export const gameDatabase = new GameDatabase();

let databaseOpenPromise: Promise<void> | null = null;

function blockedDatabaseError(): Error {
  const error = new Error("Database access is blocked by another open RIVET RIDGE RALLY tab.");
  error.name = "BlockedError";
  return error;
}

function storageLimitError(message: string): Error {
  const error = new Error(message);
  error.name = "QuotaExceededError";
  return error;
}

async function ensureDatabaseOpen(): Promise<void> {
  if (gameDatabase.isOpen()) return;
  if (databaseOpenPromise) return databaseOpenPromise;

  const opening = new Promise<void>((resolve, reject) => {
    let settled = false;
    let blockedTimer: ReturnType<typeof setTimeout> | undefined;

    const cleanup = () => {
      if (blockedTimer !== undefined) clearTimeout(blockedTimer);
      gameDatabase.on.blocked.unsubscribe(onBlocked);
    };
    const settle = (callback: () => void) => {
      if (settled) return;
      settled = true;
      cleanup();
      callback();
    };
    const onBlocked = () => {
      if (blockedTimer !== undefined) return;
      blockedTimer = setTimeout(() => {
        gameDatabase.close();
        settle(() => reject(blockedDatabaseError()));
      }, BLOCKED_OPEN_GRACE_MS);
    };

    gameDatabase.on.blocked.subscribe(onBlocked);
    void gameDatabase.open().then(
      () => settle(resolve),
      (error: unknown) => settle(() => reject(error)),
    );
  });

  const wrappedOpening = opening.finally(() => {
    if (databaseOpenPromise === wrappedOpening) databaseOpenPromise = null;
  });
  databaseOpenPromise = wrappedOpening;
  return wrappedOpening;
}

async function quarantineProfileRecord(
  kind: "settings" | "progress",
  payload: unknown,
  reason: string,
): Promise<boolean> {
  try {
    const payloadBytes = await Dexie.waitFor(recoveryPayloadByteLength(payload));
    await addQuarantineRecord(kind, payload, reason, payloadBytes);
    return true;
  } catch (error) {
    publishPersistenceFailure(error, "recovery");
    return false;
  }
}

async function addQuarantineRecord(
  kind: QuarantineRecord["kind"],
  payload: unknown,
  reason: string,
  payloadBytes: number,
): Promise<void> {
  if (!Number.isSafeInteger(payloadBytes) || payloadBytes < 0) {
    throw storageLimitError("The damaged record could not be measured safely and was left in place.");
  }
  if (payloadBytes > MAX_QUARANTINE_RECORD_BYTES) {
    throw storageLimitError("The damaged record exceeds the 1 MB recovery-record safety limit and was left in place.");
  }
  const records = await gameDatabase.quarantine.toArray();
  if (records.length >= MAX_QUARANTINE_RECORDS) {
    throw storageLimitError("Recovery storage limit reached. Export and remove an older track recovery before retrying.");
  }
  let storedBytes = 0;
  for (const record of records) {
    const measuredBytes = record.payloadBytes;
    // Version-3 rows and corrupt byte counts cannot be trusted. Reserve the
    // full per-record allowance so aggregate accounting always fails closed.
    const recordBytes = typeof measuredBytes === "number"
      && Number.isSafeInteger(measuredBytes)
      && measuredBytes >= 0
      && measuredBytes <= MAX_QUARANTINE_RECORD_BYTES
      ? measuredBytes
      : MAX_QUARANTINE_RECORD_BYTES;
    if (recordBytes > MAX_QUARANTINE_TOTAL_BYTES - storedBytes) {
      throw storageLimitError("Recovery storage has reached its 10 MB safety limit. Export and remove an older track recovery before retrying.");
    }
    storedBytes += recordBytes;
  }
  if (payloadBytes > MAX_QUARANTINE_TOTAL_BYTES - storedBytes) {
    throw storageLimitError("Recovery storage has reached its 10 MB safety limit. Export and remove an older track recovery before retrying.");
  }
  await gameDatabase.quarantine.add({ kind, payload, reason, payloadBytes, createdAt: Date.now() });
}

function isFutureProfileRecord(record: unknown): boolean {
  if (!record || typeof record !== "object") return false;
  const schemaVersion = Reflect.get(record, "schemaVersion");
  return typeof schemaVersion === "number" && schemaVersion > CURRENT_PROFILE_SCHEMA_VERSION;
}

function isFutureCustomTrackRecord(record: unknown): boolean {
  if (!record || typeof record !== "object") return false;
  const schemaVersion = Reflect.get(record, "schemaVersion");
  return typeof schemaVersion === "number"
    && schemaVersion > CURRENT_CUSTOM_TRACK_SCHEMA_VERSION;
}

function incompatibleProfileError(kind: "settings" | "progress"): Error {
  const error = new Error(`Saved ${kind} use a newer schema version and cannot be overwritten by this build.`);
  error.name = "VersionError";
  return error;
}

function incompatibleCustomTrackError(): Error {
  const error = new Error("Saved custom tracks use a newer schema version and cannot be overwritten by this build.");
  error.name = "VersionError";
  return error;
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

async function readProfileData(
  fallbackSettings: GameSettings,
  fallbackProgress: CampaignProgress,
): Promise<ProfileData> {
  return gameDatabase.transaction(
    "rw",
    gameDatabase.settings,
    gameDatabase.progress,
    gameDatabase.quarantine,
    async () => {
      const [rawSettingsRecord, rawProgressRecord] = await Promise.all([
        gameDatabase.settings.get(ACTIVE_PROFILE_ID),
        gameDatabase.progress.get(ACTIVE_PROFILE_ID),
      ]);
      if (isFutureProfileRecord(rawSettingsRecord)) throw incompatibleProfileError("settings");
      if (isFutureProfileRecord(rawProgressRecord)) throw incompatibleProfileError("progress");

      const parsedSettingsRecord = settingsRecordSchema.safeParse(rawSettingsRecord);
      const parsedProgressRecord = progressRecordSchema.safeParse(rawProgressRecord);
      const hasSettingsRecord = rawSettingsRecord !== undefined;
      const hasProgressRecord = rawProgressRecord !== undefined;
      const settings = parsedSettingsRecord.success ? parsedSettingsRecord.data.value : fallbackSettings;
      const progress = parsedProgressRecord.success ? parsedProgressRecord.data.value : fallbackProgress;
      let recovered = false;

      if (hasSettingsRecord && !parsedSettingsRecord.success) {
        recovered = true;
        const preserved = await quarantineProfileRecord(
          "settings",
          rawSettingsRecord,
          parsedSettingsRecord.error.message,
        );
        if (!preserved) throw new Error("Invalid settings could not be preserved for recovery.");
      }
      if (!parsedSettingsRecord.success) await putSettingsRecord(settings);

      if (hasProgressRecord && !parsedProgressRecord.success) {
        recovered = true;
        const preserved = await quarantineProfileRecord(
          "progress",
          rawProgressRecord,
          parsedProgressRecord.error.message,
        );
        if (!preserved) throw new Error("Invalid progress could not be preserved for recovery.");
      }
      if (!parsedProgressRecord.success) await putProgressRecord(progress);

      return { settings, progress, recovered };
    },
  );
}

export async function loadGameData(): Promise<ProfileData> {
  return capturePersistenceFailure("load", () => (
    readProfileData(DEFAULT_SETTINGS, createDefaultProgress())
  ));
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
  options: RetryPersistenceOptions = { preserveExistingProfile: false },
): Promise<ProfileData> {
  return capturePersistenceFailure("retry", async () => {
    gameDatabase.close();
    await ensureDatabaseOpen();
    if (options.preserveExistingProfile) {
      return readProfileData(settings, progress);
    }
    await putProfileData(settings, progress);
    return { settings, progress, recovered: false };
  });
}

function recoveryName(payload: unknown): string {
  if (!payload || typeof payload !== "object") return "Recovered track data";
  const name = Reflect.get(payload, "name");
  return typeof name === "string" && name.trim() ? name.trim().slice(0, 80) : "Recovered track data";
}

function toCustomTrackRecovery(record: QuarantineRecord): CustomTrackRecovery | null {
  if (record.kind !== "custom-track" || typeof record.key !== "number") return null;
  return {
    key: record.key,
    name: recoveryName(record.payload),
    reason: record.reason,
    payload: record.payload,
    createdAt: record.createdAt,
    quarantined: true,
  };
}

type CustomTrackRecordInspection =
  | { valid: true; track: CustomTrackData }
  | { valid: false; reason: string };

function inspectCustomTrackRecord(record: unknown): CustomTrackRecordInspection {
  if (isFutureCustomTrackRecord(record)) throw incompatibleCustomTrackError();
  const isLegacy = record !== null
    && typeof record === "object"
    && Reflect.get(record, "schemaVersion") === 1;
  const parsed = parseCustomTrackRecord(record);
  if (!parsed.success) return { valid: false, reason: parsed.reason };
  const routeValidation = isLegacy
    ? validateLegacyCustomTrack(parsed.track)
    : validateCustomTrack(parsed.track);
  if (!routeValidation.valid) {
    return {
      valid: false,
      reason: routeValidation.errors.join(" ") || "Custom track route is invalid.",
    };
  }
  return { valid: true, track: parsed.track };
}

export async function listCustomTracks(): Promise<CustomTrackLibrary> {
  return capturePersistenceFailure("custom-tracks", async () => {
    // Enumerate the object store rather than its updatedAt index. IndexedDB omits
    // records with missing/invalid index keys, and those are exactly the corrupt
    // records that must be preserved and disclosed instead of disappearing.
    const records = await gameDatabase.customTracks.toArray();
    const tracks: CustomTrackData[] = [];
    const unpreservedRecoveries: CustomTrackRecovery[] = [];
    for (const record of records) {
      const inspection = inspectCustomTrackRecord(record);
      if (inspection.valid) {
        tracks.push(inspection.track);
      } else {
        let recoveryPayload: unknown = record;
        let recoveryReason = inspection.reason;
        try {
          // The scan can be stale if another tab saves this ID. Re-read under the
          // writer transaction before preserving or deleting the current value.
          const outcome = await gameDatabase.transaction(
            "rw",
            gameDatabase.customTracks,
            gameDatabase.quarantine,
            async () => {
              const currentRecord = await gameDatabase.customTracks.get(record.id);
              if (currentRecord === undefined) return { kind: "missing" } as const;

              const currentInspection = inspectCustomTrackRecord(currentRecord);
              if (currentInspection.valid) {
                return { kind: "valid", track: currentInspection.track } as const;
              }

              recoveryPayload = currentRecord;
              recoveryReason = currentInspection.reason;
              const payloadBytes = await Dexie.waitFor(recoveryPayloadByteLength(currentRecord));
              await addQuarantineRecord(
                "custom-track",
                currentRecord,
                currentInspection.reason,
                payloadBytes,
              );
              await gameDatabase.customTracks.delete(currentRecord.id);
              return { kind: "quarantined" } as const;
            },
          );
          if (outcome.kind === "valid") tracks.push(outcome.track);
        } catch (error) {
          publishPersistenceFailure(error, "recovery");
          unpreservedRecoveries.push({
            key: null,
            name: recoveryName(recoveryPayload),
            reason: recoveryReason,
            payload: recoveryPayload,
            createdAt: Date.now(),
            quarantined: false,
          });
        }
      }
    }
    tracks.sort((left, right) => right.updatedAt - left.updatedAt);
    const quarantinedRecoveries = (await gameDatabase.quarantine
      .where("kind")
      .equals("custom-track")
      .reverse()
      .sortBy("createdAt"))
      .map(toCustomTrackRecovery)
      .filter((recovery): recovery is CustomTrackRecovery => recovery !== null);
    return { tracks, recoveries: [...unpreservedRecoveries, ...quarantinedRecoveries] };
  });
}

export async function saveCustomTrack(track: CustomTrackData): Promise<void> {
  const parsed = customTrackSchema.parse(track);
  const validation = validateCustomTrack(parsed);
  if (!validation.valid) throw new Error(validation.errors[0] ?? "Custom track route is invalid.");
  const recordBytes = new Blob([JSON.stringify(parsed)]).size;
  if (recordBytes > MAX_CUSTOM_TRACK_RECORD_BYTES) {
    throw storageLimitError("Track data exceeds the 750 KB local-record safety limit.");
  }
  await capturePersistenceFailure("custom-tracks", () => gameDatabase.transaction(
    "rw",
    gameDatabase.customTracks,
    async () => {
      const existing = await gameDatabase.customTracks.get(parsed.id);
      if (isFutureCustomTrackRecord(existing)) throw incompatibleCustomTrackError();
      if (!existing && await gameDatabase.customTracks.count() >= MAX_CUSTOM_TRACK_RECORDS) {
        throw storageLimitError(`Track library limit reached. Export or delete a track before adding more than ${MAX_CUSTOM_TRACK_RECORDS}.`);
      }
      const records = await gameDatabase.customTracks.toArray();
      let storedBytes = 0;
      for (const storedRecord of records) {
        if (storedRecord.id === parsed.id) continue;
        let storedRecordBytes: number;
        try {
          const serialized = JSON.stringify(storedRecord);
          if (typeof serialized !== "string") throw new Error("Record did not serialize to JSON.");
          storedRecordBytes = new Blob([serialized]).size;
        } catch {
          throw storageLimitError("An existing track record could not be measured safely. Recover or remove it before saving another track.");
        }
        if (!Number.isSafeInteger(storedRecordBytes) || storedRecordBytes < 0) {
          throw storageLimitError("An existing track record could not be measured safely. Recover or remove it before saving another track.");
        }
        if (storedRecordBytes > MAX_CUSTOM_TRACK_TOTAL_BYTES - storedBytes) {
          throw storageLimitError("Track library has reached its 25 MB safety limit. Export or delete a track before saving another copy.");
        }
        storedBytes += storedRecordBytes;
      }
      if (recordBytes > MAX_CUSTOM_TRACK_TOTAL_BYTES - storedBytes) {
        throw storageLimitError("Track library has reached its 25 MB safety limit. Export or delete a track before saving another copy.");
      }
      await gameDatabase.customTracks.put(parsed);
    },
  ));
}

export async function deleteCustomTrack(trackId: string): Promise<void> {
  await capturePersistenceFailure("custom-tracks", () => gameDatabase.customTracks.delete(trackId));
}

export async function deleteCustomTrackRecovery(key: number): Promise<void> {
  await capturePersistenceFailure("recovery", () => gameDatabase.transaction(
    "rw",
    gameDatabase.quarantine,
    async () => {
      const record = await gameDatabase.quarantine.get(key);
      if (!record || record.kind !== "custom-track") {
        throw new Error("The selected track recovery is no longer available.");
      }
      await gameDatabase.quarantine.delete(key);
    },
  ));
}

export function exportCustomTrack(track: CustomTrackData): string {
  const parsed = customTrackSchema.parse(track);
  const validation = validateCustomTrack(parsed);
  if (!validation.valid) throw new Error(validation.errors[0] ?? "Custom track route is invalid.");
  return JSON.stringify(parsed, null, 2);
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

function recoveryPath(path: string, key: string | number): string {
  return typeof key === "number" ? `${path}[${key}]` : `${path}[${JSON.stringify(key)}]`;
}

function recoveryEncodingError(message: string): Error {
  const error = new Error(message);
  error.name = "DataError";
  return error;
}

function jsonStringByteLength(value: string, maximumBytes: number): number {
  let bytes = 2;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code === 0x22 || code === 0x5c) bytes += 2;
    else if (code <= 0x1f) bytes += [0x08, 0x09, 0x0a, 0x0c, 0x0d].includes(code) ? 2 : 6;
    else if (code <= 0x7f) bytes += 1;
    else if (code <= 0x7ff) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4;
        index += 1;
      } else {
        bytes += 6;
      }
    } else if (code >= 0xdc00 && code <= 0xdfff) bytes += 6;
    else bytes += 3;
    if (bytes > maximumBytes) return bytes;
  }
  return bytes;
}

class RecoveryEncodingBudget {
  private nodes = 0;
  private bytes = 0;
  private readonly maximumOutputBytes: number;

  constructor(maximumOutputBytes: number) {
    this.maximumOutputBytes = maximumOutputBytes;
  }

  get outputBytes(): number {
    return this.bytes;
  }

  visit(depth: number, path: string): void {
    if (depth > MAX_CUSTOM_TRACK_JSON_DEPTH) {
      throw recoveryEncodingError("Recovery data exceeds the nesting safety limit.");
    }
    this.nodes += 1;
    if (this.nodes > MAX_CUSTOM_TRACK_JSON_ITEMS) {
      throw recoveryEncodingError("Recovery data contains too many items.");
    }
    this.assertString(path);
  }

  assertString(value: string): void {
    if (value.length > MAX_CUSTOM_TRACK_JSON_STRING_CHARS) {
      throw recoveryEncodingError("Recovery data contains a string beyond the safety limit.");
    }
  }

  beginObject(): void {
    this.charge(2);
  }

  objectProperty(index: number, name: string): void {
    if (index > 0) this.charge(1);
    this.writeString(name);
    this.charge(1);
  }

  beginArray(): void {
    this.charge(2);
  }

  arrayItem(index: number): void {
    if (index > 0) this.charge(1);
  }

  writeString(value: string): void {
    this.assertString(value);
    const remaining = this.maximumOutputBytes - this.bytes;
    this.charge(jsonStringByteLength(value, remaining));
  }

  writeNumber(value: number): void {
    const serialized = Number.isFinite(value) ? JSON.stringify(value) : "null";
    this.charge(serialized.length);
  }

  writeLiteral(value: "null" | "true" | "false"): void {
    this.charge(value.length);
  }

  reserveBase64(byteLength: number): number {
    if (!Number.isSafeInteger(byteLength) || byteLength < 0) {
      throw recoveryEncodingError("Recovery binary data could not be measured safely.");
    }
    const encodedLength = Math.ceil(byteLength / 3) * 4;
    if (!Number.isSafeInteger(encodedLength)) {
      throw recoveryEncodingError("Recovery binary data could not be measured safely.");
    }
    if (encodedLength > MAX_CUSTOM_TRACK_JSON_STRING_CHARS) {
      throw recoveryEncodingError("Recovery data contains a string beyond the safety limit.");
    }
    this.charge(encodedLength + 2);
    return encodedLength;
  }

  private charge(bytes: number): void {
    if (!Number.isSafeInteger(bytes) || bytes < 0) {
      throw recoveryEncodingError("Recovery output could not be measured safely.");
    }
    if (bytes > this.maximumOutputBytes - this.bytes) {
      throw recoveryEncodingError("Recovery data exceeds the 1 MB output safety limit.");
    }
    this.bytes += bytes;
  }
}

type EncodedProperty = readonly [string, () => unknown | Promise<unknown>];

async function encodeRecoveryObject(
  budget: RecoveryEncodingBudget,
  properties: readonly EncodedProperty[],
): Promise<Record<string, unknown>> {
  budget.beginObject();
  const encoded: Record<string, unknown> = {};
  for (const [index, [name, encode]] of properties.entries()) {
    budget.objectProperty(index, name);
    encoded[name] = await encode();
  }
  return encoded;
}

function encodeRecoveryString(budget: RecoveryEncodingBudget, value: string): string {
  budget.writeString(value);
  return value;
}

function encodeRecoveryNumber(budget: RecoveryEncodingBudget, value: number): number {
  budget.writeNumber(value);
  return value;
}

async function encodeBlobBase64(
  blob: Blob,
  budget: RecoveryEncodingBudget,
): Promise<string> {
  const expectedLength = budget.reserveBase64(blob.size);
  const buffer = await blob.arrayBuffer();
  if (buffer.byteLength !== blob.size) {
    throw recoveryEncodingError("Recovery binary data changed while it was being read.");
  }
  const encoded = bytesToBase64(new Uint8Array(buffer));
  if (encoded.length !== expectedLength) {
    throw recoveryEncodingError("Recovery binary data could not be measured safely.");
  }
  return encoded;
}

function encodeBufferBase64(
  buffer: ArrayBuffer | SharedArrayBuffer,
  budget: RecoveryEncodingBudget,
): string {
  const expectedLength = budget.reserveBase64(buffer.byteLength);
  const encoded = bytesToBase64(new Uint8Array(buffer));
  if (encoded.length !== expectedLength) {
    throw recoveryEncodingError("Recovery binary data could not be measured safely.");
  }
  return encoded;
}

async function encodeRecoveryValue(
  value: unknown,
  seen: Map<object, string>,
  path: string,
  budget: RecoveryEncodingBudget,
  depth: number,
): Promise<unknown> {
  budget.visit(depth, path);
  if (value === null) {
    budget.writeLiteral("null");
    return null;
  }
  if (typeof value === "string") return encodeRecoveryString(budget, value);
  if (typeof value === "boolean") {
    budget.writeLiteral(value ? "true" : "false");
    return value;
  }
  if (typeof value === "undefined") {
    return encodeRecoveryObject(budget, [["$type", () => encodeRecoveryString(budget, "Undefined")]]);
  }
  if (typeof value === "bigint") {
    const decimal = value.toString();
    return encodeRecoveryObject(budget, [
      ["$type", () => encodeRecoveryString(budget, "BigInt")],
      ["value", () => encodeRecoveryString(budget, decimal)],
    ]);
  }
  if (typeof value === "number") {
    const special = Number.isNaN(value)
      ? "NaN"
      : value === Infinity
        ? "Infinity"
        : value === -Infinity
          ? "-Infinity"
          : Object.is(value, -0)
            ? "-0"
            : null;
    if (special !== null) {
      return encodeRecoveryObject(budget, [
        ["$type", () => encodeRecoveryString(budget, "Number")],
        ["value", () => encodeRecoveryString(budget, special)],
      ]);
    }
    budget.writeNumber(value);
    return value;
  }
  if (typeof value === "symbol" || typeof value === "function") {
    const description = String(value);
    return encodeRecoveryObject(budget, [
      ["$type", () => encodeRecoveryString(budget, "Unsupported")],
      ["valueType", () => encodeRecoveryString(budget, typeof value)],
      ["description", () => encodeRecoveryString(budget, description)],
    ]);
  }

  const existingPath = seen.get(value);
  if (existingPath) {
    return encodeRecoveryObject(budget, [["$ref", () => encodeRecoveryString(budget, existingPath)]]);
  }
  seen.set(value, path);

  if (value instanceof Date) {
    const dateValue = Number.isNaN(value.getTime()) ? null : value.toISOString();
    return encodeRecoveryObject(budget, [
      ["$type", () => encodeRecoveryString(budget, "Date")],
      ["value", () => {
        if (dateValue === null) {
          budget.writeLiteral("null");
          return null;
        }
        return encodeRecoveryString(budget, dateValue);
      }],
    ]);
  }
  if (value instanceof RegExp) {
    return encodeRecoveryObject(budget, [
      ["$type", () => encodeRecoveryString(budget, "RegExp")],
      ["source", () => encodeRecoveryString(budget, value.source)],
      ["flags", () => encodeRecoveryString(budget, value.flags)],
      ["lastIndex", () => encodeRecoveryNumber(budget, value.lastIndex)],
    ]);
  }
  if (typeof URL !== "undefined" && value instanceof URL) {
    return encodeRecoveryObject(budget, [
      ["$type", () => encodeRecoveryString(budget, "URL")],
      ["value", () => encodeRecoveryString(budget, value.href)],
    ]);
  }
  if (typeof File !== "undefined" && value instanceof File) {
    return encodeRecoveryObject(budget, [
      ["$type", () => encodeRecoveryString(budget, "File")],
      ["name", () => encodeRecoveryString(budget, value.name)],
      ["mimeType", () => encodeRecoveryString(budget, value.type)],
      ["lastModified", () => encodeRecoveryNumber(budget, value.lastModified)],
      ["bytesBase64", () => encodeBlobBase64(value, budget)],
    ]);
  }
  if (typeof Blob !== "undefined" && value instanceof Blob) {
    return encodeRecoveryObject(budget, [
      ["$type", () => encodeRecoveryString(budget, "Blob")],
      ["mimeType", () => encodeRecoveryString(budget, value.type)],
      ["bytesBase64", () => encodeBlobBase64(value, budget)],
    ]);
  }
  if (value instanceof ArrayBuffer) {
    return encodeRecoveryObject(budget, [
      ["$type", () => encodeRecoveryString(budget, "ArrayBuffer")],
      ["bytesBase64", () => encodeBufferBase64(value, budget)],
    ]);
  }
  if (typeof SharedArrayBuffer !== "undefined" && value instanceof SharedArrayBuffer) {
    return encodeRecoveryObject(budget, [
      ["$type", () => encodeRecoveryString(budget, "SharedArrayBuffer")],
      ["bytesBase64", () => encodeBufferBase64(value, budget)],
    ]);
  }
  if (ArrayBuffer.isView(value)) {
    const length = "length" in value && typeof value.length === "number" ? value.length : undefined;
    const viewProperties: EncodedProperty[] = [
      ["$type", () => encodeRecoveryString(budget, value instanceof DataView ? "DataView" : "TypedArray")],
      ["name", () => encodeRecoveryString(budget, value.constructor.name)],
      ["byteOffset", () => encodeRecoveryNumber(budget, value.byteOffset)],
      ["byteLength", () => encodeRecoveryNumber(budget, value.byteLength)],
    ];
    if (length !== undefined) {
      viewProperties.push(["length", () => encodeRecoveryNumber(budget, length)]);
    }
    viewProperties.push([
      "buffer",
      () => encodeRecoveryValue(value.buffer, seen, `${path}.buffer`, budget, depth + 1),
    ]);
    return encodeRecoveryObject(budget, viewProperties);
  }
  if (value instanceof Map) {
    return encodeRecoveryObject(budget, [
      ["$type", () => encodeRecoveryString(budget, "Map")],
      ["entries", async () => {
        budget.beginArray();
        const entries: unknown[] = [];
        let index = 0;
        for (const [key, entryValue] of value.entries()) {
          budget.arrayItem(index);
          budget.beginArray();
          budget.arrayItem(0);
          const encodedKey = await encodeRecoveryValue(key, seen, `${path}.entries[${index}][0]`, budget, depth + 1);
          budget.arrayItem(1);
          const encodedValue = await encodeRecoveryValue(entryValue, seen, `${path}.entries[${index}][1]`, budget, depth + 1);
          entries.push([encodedKey, encodedValue]);
          index += 1;
        }
        return entries;
      }],
    ]);
  }
  if (value instanceof Set) {
    return encodeRecoveryObject(budget, [
      ["$type", () => encodeRecoveryString(budget, "Set")],
      ["values", async () => {
        budget.beginArray();
        const values: unknown[] = [];
        let index = 0;
        for (const entry of value.values()) {
          budget.arrayItem(index);
          values.push(await encodeRecoveryValue(entry, seen, `${path}.values[${index}]`, budget, depth + 1));
          index += 1;
        }
        return values;
      }],
    ]);
  }
  if (Array.isArray(value)) {
    const entries: unknown[] = [];
    const properties: unknown[] = [];
    budget.beginObject();
    budget.objectProperty(0, "$type");
    encodeRecoveryString(budget, "Array");
    budget.objectProperty(1, "length");
    encodeRecoveryNumber(budget, value.length);
    budget.objectProperty(2, "entries");
    budget.beginArray();
    budget.objectProperty(3, "properties");
    budget.beginArray();
    let entryIndex = 0;
    let propertyIndex = 0;
    for (const key in value) {
      if (!Object.hasOwn(value, key)) continue;
      const numericIndex = /^(?:0|[1-9]\d*)$/.test(key) && Number(key) < value.length
        ? Number(key)
        : null;
      const output = numericIndex === null ? properties : entries;
      const outputIndex = numericIndex === null ? propertyIndex++ : entryIndex++;
      budget.arrayItem(outputIndex);
      budget.beginArray();
      budget.arrayItem(0);
      if (numericIndex === null) encodeRecoveryString(budget, key);
      else encodeRecoveryNumber(budget, numericIndex);
      budget.arrayItem(1);
      output.push([
        numericIndex ?? key,
        await encodeRecoveryValue(Reflect.get(value, key), seen, recoveryPath(path, numericIndex ?? key), budget, depth + 1),
      ]);
    }
    return { $type: "Array", length: value.length, entries, properties };
  }

  const properties: unknown[] = [];
  const isError = value instanceof Error;
  const tag = Object.prototype.toString.call(value);
  const constructorName = typeof value.constructor?.name === "string" ? value.constructor.name : null;
  budget.beginObject();
  let objectPropertyIndex = 0;
  budget.objectProperty(objectPropertyIndex++, "$type");
  encodeRecoveryString(budget, isError ? "Error" : "Object");
  budget.objectProperty(objectPropertyIndex++, "tag");
  encodeRecoveryString(budget, tag);
  budget.objectProperty(objectPropertyIndex++, "constructor");
  if (constructorName === null) budget.writeLiteral("null");
  else encodeRecoveryString(budget, constructorName);
  if (isError) {
    budget.objectProperty(objectPropertyIndex++, "name");
    encodeRecoveryString(budget, value.name);
    budget.objectProperty(objectPropertyIndex++, "message");
    encodeRecoveryString(budget, value.message);
    budget.objectProperty(objectPropertyIndex++, "stack");
    if (value.stack === undefined) budget.writeLiteral("null");
    else encodeRecoveryString(budget, value.stack);
    budget.objectProperty(objectPropertyIndex++, "cause");
  }
  const cause = isError
    ? await encodeRecoveryValue(value.cause, seen, `${path}.cause`, budget, depth + 1)
    : undefined;
  budget.objectProperty(objectPropertyIndex, "properties");
  budget.beginArray();
  let propertyIndex = 0;
  for (const key in value) {
    if (!Object.hasOwn(value, key)) continue;
    budget.arrayItem(propertyIndex);
    budget.beginArray();
    budget.arrayItem(0);
    encodeRecoveryString(budget, key);
    budget.arrayItem(1);
    let propertyValue: unknown;
    try {
      propertyValue = Reflect.get(value, key);
    } catch (error) {
      budget.visit(depth + 1, recoveryPath(path, key));
      const message = error instanceof Error ? error.message : String(error);
      properties.push([key, await encodeRecoveryObject(budget, [
        ["$type", () => encodeRecoveryString(budget, "UnreadableProperty")],
        ["message", () => encodeRecoveryString(budget, message)],
      ])]);
      propertyIndex += 1;
      continue;
    }
    properties.push([
      key,
      await encodeRecoveryValue(propertyValue, seen, recoveryPath(path, key), budget, depth + 1),
    ]);
    propertyIndex += 1;
  }
  return {
    $type: isError ? "Error" : "Object",
    tag,
    constructor: constructorName,
    ...(isError
      ? {
          name: value.name,
          message: value.message,
          stack: value.stack ?? null,
          cause,
        }
      : {}),
    properties,
  };
}

async function recoveryPayloadByteLength(payload: unknown): Promise<number> {
  const budget = new RecoveryEncodingBudget(MAX_QUARANTINE_RECORD_BYTES);
  await encodeRecoveryValue(payload, new Map<object, string>(), "$.payload", budget, 1);
  return budget.outputBytes;
}

export async function exportCustomTrackRecovery(recovery: CustomTrackRecovery): Promise<string> {
  const budget = new RecoveryEncodingBudget(MAX_CUSTOM_TRACK_FILE_BYTES);
  budget.beginObject();
  budget.objectProperty(0, "recoveryVersion");
  encodeRecoveryNumber(budget, 2);
  budget.objectProperty(1, "encoding");
  encodeRecoveryString(budget, "rivet-ridge-rally-tagged-structured-clone-json-v1");
  budget.objectProperty(2, "reason");
  encodeRecoveryString(budget, recovery.reason);
  budget.objectProperty(3, "preservedInQuarantine");
  budget.writeLiteral(recovery.quarantined ? "true" : "false");
  budget.objectProperty(4, "recoveredAt");
  encodeRecoveryNumber(budget, recovery.createdAt);
  budget.objectProperty(5, "payload");
  const payload = await encodeRecoveryValue(
    recovery.payload,
    new Map<object, string>(),
    "$.payload",
    budget,
    1,
  );
  return JSON.stringify({
    recoveryVersion: 2,
    encoding: "rivet-ridge-rally-tagged-structured-clone-json-v1",
    reason: recovery.reason,
    preservedInQuarantine: recovery.quarantined,
    recoveredAt: recovery.createdAt,
    payload,
  });
}

function preflightCustomTrackJson(serialized: string): void {
  let depth = 0;
  let itemCount = 0;
  let stringChars = 0;
  let inString = false;
  let escaped = false;

  for (const character of serialized) {
    if (inString) {
      if (escaped) {
        escaped = false;
        stringChars += 1;
      } else if (character === "\\") {
        escaped = true;
      } else if (character === '"') {
        inString = false;
      } else {
        stringChars += 1;
      }
      if (stringChars > MAX_CUSTOM_TRACK_JSON_STRING_CHARS) {
        throw new Error("Track file contains a string beyond the safety limit.");
      }
      continue;
    }

    if (character === '"') {
      inString = true;
      stringChars = 0;
    } else if (character === "{" || character === "[") {
      depth += 1;
      itemCount += 1;
      if (depth > MAX_CUSTOM_TRACK_JSON_DEPTH) {
        throw new Error("Track file exceeds the nesting safety limit.");
      }
    } else if (character === "}" || character === "]") {
      depth -= 1;
    } else if (character === "," || character === ":") {
      itemCount += 1;
    }
    if (itemCount > MAX_CUSTOM_TRACK_JSON_ITEMS) {
      throw new Error("Track file contains too many items.");
    }
  }
}

export function importCustomTrack(serialized: string): CustomTrackData {
  if (new Blob([serialized]).size > MAX_CUSTOM_TRACK_FILE_BYTES) {
    throw new Error("Track file exceeds the 1 MB safety limit.");
  }
  preflightCustomTrackJson(serialized);
  let decoded: unknown;
  try {
    decoded = JSON.parse(serialized) as unknown;
  } catch {
    throw new Error("Track file is not valid JSON.");
  }
  if (isFutureCustomTrackRecord(decoded)) throw incompatibleCustomTrackError();
  const isLegacy = decoded !== null
    && typeof decoded === "object"
    && Reflect.get(decoded, "schemaVersion") === 1;
  const parsed = parseCustomTrackRecord(decoded);
  if (!parsed.success) {
    throw new Error(`Track file is incompatible or invalid: ${parsed.reason}`);
  }
  const validation = isLegacy
    ? validateLegacyCustomTrack(parsed.track)
    : validateCustomTrack(parsed.track);
  if (!validation.valid) {
    throw new Error(`Track route is invalid: ${validation.errors[0] ?? "the route is not playable."}`);
  }
  return parsed.track;
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
    if (samples.byteLength > MAX_REPLAY_SAMPLE_BYTES) {
      throw storageLimitError("Replay exceeds the 512 KB local-storage safety limit and was not saved.");
    }
    await gameDatabase.transaction("rw", gameDatabase.replays, async () => {
      await gameDatabase.replays.put(record);

      const older = await gameDatabase.replays
        .where("trackId")
        .equals(record.trackId)
        .reverse()
        .sortBy("createdAt");
      await gameDatabase.replays.bulkDelete(older.slice(20).map((replay) => replay.id));
    });
  });
}

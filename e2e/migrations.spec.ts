import { expect, test, type Page } from "@playwright/test";

const BASE_URL = "http://127.0.0.1:4173";
const DATABASE_NAME = "rivet-ridge-rally";
const PROFILE_ID = "rider-01";

const LEGACY_SETTINGS = {
  quality: "high",
  difficulty: "ace",
  accessibility: {
    reducedMotion: true,
    reducedShake: true,
    highContrast: true,
    captions: true,
    colorblindSafe: true,
    uiScale: 1.2,
  },
  audio: { master: 0.65, music: 0.4, sfx: 0.7 },
  controls: {
    mirroredTouch: true,
    retroRecovery: false,
    vibration: false,
    keyBindings: {
      throttle: "KeyI",
      turbo: "KeyO",
      laneLeft: "KeyJ",
      laneRight: "KeyL",
      pitchUp: "ArrowUp",
      pitchDown: "ArrowDown",
      recover: "Space",
      pause: "Escape",
    },
  },
} as const;

const LEGACY_DEFAULT_LANE_SETTINGS = {
  ...LEGACY_SETTINGS,
  controls: {
    ...LEGACY_SETTINGS.controls,
    keyBindings: {
      ...LEGACY_SETTINGS.controls.keyBindings,
      laneLeft: "KeyA",
      laneRight: "KeyD",
    },
  },
} as const;

const MIGRATED_DEFAULT_LANE_SETTINGS = {
  ...LEGACY_DEFAULT_LANE_SETTINGS,
  controls: {
    ...LEGACY_DEFAULT_LANE_SETTINGS.controls,
    keyBindings: {
      ...LEGACY_DEFAULT_LANE_SETTINGS.controls.keyBindings,
      laneLeft: "ArrowLeft",
      laneRight: "ArrowRight",
    },
  },
} as const;

const LEGACY_PROGRESS = {
  version: 1,
  tutorialComplete: true,
  selectedTrackId: "coastline-clash",
  tracks: {
    "canyon-kickoff": {
      soloQualified: true,
      rivalUnlocked: true,
      bestSoloMs: 121_234,
      bestRivalPosition: 1,
      masteryLevel: 0,
    },
    "pine-run": {
      soloQualified: true,
      rivalUnlocked: true,
      bestSoloMs: 132_345,
      bestRivalPosition: 2,
      masteryLevel: 0,
    },
    "coastline-clash": {
      soloQualified: true,
      rivalUnlocked: true,
      bestSoloMs: 143_456,
      masteryLevel: 0,
    },
    "foundry-flight": {
      soloQualified: false,
      rivalUnlocked: false,
      masteryLevel: 0,
    },
    "summit-showdown": {
      soloQualified: false,
      rivalUnlocked: false,
      masteryLevel: 0,
    },
  },
} as const;

const V2_UPDATED_AT = 1_720_000_000_000;
const V2_CREATED_AT = 1_719_999_000_000;

const LEGACY_CUSTOM_TRACK = {
  id: "legacy-v2-mesa",
  name: "V2 Migration Mesa",
  laps: 4,
  difficultyEstimate: 3,
  modules: [
    { id: "legacy-start", moduleId: "start-grid", lane: 0, gridPosition: 0, rotation: 0, height: 0 },
    { id: "legacy-checkpoint", moduleId: "checkpoint", lane: 0, gridPosition: 120, rotation: 0, height: 0 },
    { id: "legacy-finish", moduleId: "finish-arch", lane: 0, gridPosition: 260, rotation: 0, height: 0 },
  ],
  createdAt: V2_CREATED_AT,
  updatedAt: V2_UPDATED_AT,
} as const;

const LEGACY_REPLAY = {
  id: "legacy-v2-replay",
  trackId: "canyon-kickoff",
  mode: "solo",
  result: {
    mode: "solo",
    trackId: "canyon-kickoff",
    finishTimeMs: 123_456,
    position: 1,
    fieldSize: 1,
    lapTimesMs: [60_000, 63_456],
    splitTimesMs: [30_000, 60_000, 92_000, 123_456],
    targetMs: 148_000,
    personalBest: true,
    crashes: 0,
    overheats: 1,
    coachingHint: "Legacy replay migration fixture.",
  },
  samples: [7, 14, 21, 28],
  createdAt: V2_CREATED_AT,
} as const;

interface LegacyFixture {
  logicalVersion: 1 | 2 | 3;
  settingsRecord: Record<string, unknown>;
  progressRecord: Record<string, unknown>;
  customTrack?: Record<string, unknown>;
  replay?: Omit<Record<string, unknown>, "samples"> & { samples: readonly number[] };
}

interface DatabaseSnapshot {
  nativeVersion: number;
  stores: string[];
  indexes: Record<string, string[]>;
  settings: Record<string, unknown> | undefined;
  progress: Record<string, unknown> | undefined;
  customTrack: Record<string, unknown> | undefined;
  replay: (Record<string, unknown> & { samples: number[] }) | undefined;
  customTrackCount: number;
  replayCount: number;
  quarantineCount: number;
}

const runtimeFailures = new WeakMap<Page, string[]>();

test.beforeEach(async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "IndexedDB migration gate runs once in Chromium");
  const failures: string[] = [];
  runtimeFailures.set(page, failures);
  page.on("console", (message) => {
    if (message.type() === "error") failures.push(`console: ${message.text()}`);
  });
  page.on("pageerror", (error) => failures.push(`pageerror: ${error.message}`));
  page.on("requestfailed", (request) => {
    failures.push(`requestfailed: ${request.method()} ${request.url()} — ${request.failure()?.errorText ?? "unknown"}`);
  });
  page.on("response", (response) => {
    if (response.status() >= 400) failures.push(`response: ${response.status()} ${response.url()}`);
  });
});

test.afterEach(async ({ page }) => {
  const failures = runtimeFailures.get(page);
  if (failures) expect(failures).toEqual([]);
});

async function seedLegacyDatabase(page: Page, fixture: LegacyFixture): Promise<DatabaseSnapshot> {
  // Dexie multiplies logical schema versions by ten in native IndexedDB.
  await page.route(`${BASE_URL}/`, (route) => route.fulfill({
    contentType: "text/html",
    body: "<!doctype html><html><body>Migration fixture shell</body></html>",
  }), { times: 1 });
  await page.goto("/");

  await page.evaluate(async ({ databaseName, input }) => {
    const waitForRequest = <T>(request: IDBRequest<T>) => new Promise<T>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
      if ("onblocked" in request) {
        (request as unknown as IDBOpenDBRequest).onblocked = () => reject(new Error("IndexedDB request was blocked."));
      }
    });

    await waitForRequest(indexedDB.deleteDatabase(databaseName));
    const request = indexedDB.open(databaseName, input.logicalVersion * 10);
    request.onupgradeneeded = () => {
      const database = request.result;
      const settings = database.createObjectStore("settings", { keyPath: "id" });
      const progress = database.createObjectStore("progress", { keyPath: "id" });
      if (input.logicalVersion === 3) {
        settings.createIndex("schemaVersion", "schemaVersion");
        settings.createIndex("updatedAt", "updatedAt");
        progress.createIndex("schemaVersion", "schemaVersion");
        progress.createIndex("updatedAt", "updatedAt");
      }
      settings.put(input.settingsRecord);
      progress.put(input.progressRecord);

      if (input.logicalVersion >= 2) {
        const customTracks = database.createObjectStore("customTracks", { keyPath: "id" });
        if (input.logicalVersion === 3) customTracks.createIndex("schemaVersion", "schemaVersion");
        customTracks.createIndex("name", "name");
        customTracks.createIndex("updatedAt", "updatedAt");
        if (input.customTrack) customTracks.put(input.customTrack);

        const replays = database.createObjectStore("replays", { keyPath: "id" });
        if (input.logicalVersion === 3) replays.createIndex("schemaVersion", "schemaVersion");
        replays.createIndex("trackId", "trackId");
        replays.createIndex("createdAt", "createdAt");
        if (input.replay) replays.put({ ...input.replay, samples: new Uint8Array(input.replay.samples) });
      }

      if (input.logicalVersion === 3) {
        const quarantine = database.createObjectStore("quarantine", { keyPath: "key", autoIncrement: true });
        quarantine.createIndex("kind", "kind");
        quarantine.createIndex("createdAt", "createdAt");
      }
    };
    const database = await waitForRequest(request);
    database.close();
  }, { databaseName: DATABASE_NAME, input: fixture });

  return readDatabase(page);
}

async function readDatabase(page: Page): Promise<DatabaseSnapshot> {
  return page.evaluate(async ({ databaseName, profileId, customTrackId, replayId }) => {
    const waitForRequest = <T>(request: IDBRequest<T>) => new Promise<T>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
      if ("onblocked" in request) {
        (request as unknown as IDBOpenDBRequest).onblocked = () => reject(new Error("IndexedDB request was blocked."));
      }
    });
    const database = await waitForRequest(indexedDB.open(databaseName));
    const stores = Array.from(database.objectStoreNames);
    const transaction = database.transaction(stores, "readonly");
    const indexes = Object.fromEntries(stores.map((name) => [
      name,
      Array.from(transaction.objectStore(name).indexNames),
    ]));
    const get = (store: string, key: IDBValidKey) => (
      stores.includes(store)
        ? waitForRequest(transaction.objectStore(store).get(key))
        : Promise.resolve(undefined)
    );
    const count = (store: string) => (
      stores.includes(store)
        ? waitForRequest(transaction.objectStore(store).count())
        : Promise.resolve(0)
    );
    const [settings, progress, customTrack, replayRecord, customTrackCount, replayCount, quarantineCount] = await Promise.all([
      get("settings", profileId),
      get("progress", profileId),
      get("customTracks", customTrackId),
      get("replays", replayId),
      count("customTracks"),
      count("replays"),
      count("quarantine"),
    ]);
    database.close();

    const replay = replayRecord as (Record<string, unknown> & { samples?: Uint8Array }) | undefined;
    return {
      nativeVersion: database.version,
      stores,
      indexes,
      settings,
      progress,
      customTrack,
      replay: replay ? { ...replay, samples: Array.from(replay.samples ?? []) } : undefined,
      customTrackCount,
      replayCount,
      quarantineCount,
    };
  }, {
    databaseName: DATABASE_NAME,
    profileId: PROFILE_ID,
    customTrackId: LEGACY_CUSTOM_TRACK.id,
    replayId: LEGACY_REPLAY.id,
  });
}

test("a fresh v4 profile stores and labels arrow lane defaults", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Skip training" })).toBeVisible({ timeout: 15_000 });
  await page.getByRole("button", { name: "Skip training" }).click();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "play", exact: true }).click();

  const bindings = page.getByLabel("Keyboard bindings");
  await expect(bindings.locator("div").filter({ hasText: /^lane Left/ }).getByRole("button")).toHaveText("← Left");
  await expect(bindings.locator("div").filter({ hasText: /^lane Right/ }).getByRole("button")).toHaveText("→ Right");

  const snapshot = await readDatabase(page);
  expect(snapshot.nativeVersion).toBe(40);
  expect(snapshot.settings).toMatchObject({
    value: { controls: { keyBindings: { laneLeft: "ArrowLeft", laneRight: "ArrowRight" } } },
  });
});

test("a native v1 profile runs through the v4 migration and preserves custom controls", async ({ page }) => {
  const before = await seedLegacyDatabase(page, {
    logicalVersion: 1,
    settingsRecord: { id: PROFILE_ID, value: LEGACY_SETTINGS },
    progressRecord: { id: PROFILE_ID, value: LEGACY_PROGRESS },
  });
  expect(before.nativeVersion).toBe(10);
  expect(before.stores).toEqual(["progress", "settings"]);
  expect(before.settings).not.toHaveProperty("schemaVersion");
  expect(before.settings).not.toHaveProperty("updatedAt");
  expect(before.progress).not.toHaveProperty("schemaVersion");
  expect(before.progress).not.toHaveProperty("updatedAt");

  await page.goto("/");
  await expect(page.getByRole("button", { name: "Ride", exact: true })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole("button", { name: "Skip training" })).toHaveCount(0);
  await expect(page.locator("html")).toHaveAttribute("data-high-contrast", "true");
  await page.getByRole("button", { name: "Ride", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Coastline Clash" })).toBeVisible();

  const after = await readDatabase(page);
  expect(after.nativeVersion).toBe(40);
  expect(after.stores).toEqual(["customTracks", "progress", "quarantine", "replays", "settings"]);
  expect(after.indexes).toEqual({
    customTracks: ["name", "schemaVersion", "updatedAt"],
    progress: ["schemaVersion", "updatedAt"],
    quarantine: ["createdAt", "kind"],
    replays: ["createdAt", "schemaVersion", "trackId"],
    settings: ["schemaVersion", "updatedAt"],
  });
  expect(after.settings).toMatchObject({ id: PROFILE_ID, schemaVersion: 1, value: LEGACY_SETTINGS });
  expect(after.progress).toMatchObject({ id: PROFILE_ID, schemaVersion: 1, value: LEGACY_PROGRESS });
  expect((after.settings?.updatedAt as number) > 0).toBe(true);
  expect((after.progress?.updatedAt as number) > 0).toBe(true);
  expect(after.customTrackCount).toBe(0);
  expect(after.replayCount).toBe(0);
  expect(after.quarantineCount).toBe(0);
});

test("a native v2 profile upgrades to v4 without losing its track, replay, or custom controls", async ({ page }) => {
  const before = await seedLegacyDatabase(page, {
    logicalVersion: 2,
    settingsRecord: { id: PROFILE_ID, value: LEGACY_SETTINGS, updatedAt: V2_UPDATED_AT },
    progressRecord: { id: PROFILE_ID, value: LEGACY_PROGRESS, updatedAt: V2_UPDATED_AT },
    customTrack: LEGACY_CUSTOM_TRACK,
    replay: LEGACY_REPLAY,
  });
  expect(before.nativeVersion).toBe(20);
  expect(before.stores).toEqual(["customTracks", "progress", "replays", "settings"]);
  expect(before.customTrack).not.toHaveProperty("schemaVersion");
  expect(before.replay).not.toHaveProperty("schemaVersion");

  await page.goto("/");
  await expect(page.getByRole("button", { name: "Ride", exact: true })).toBeVisible({ timeout: 15_000 });
  await page.getByRole("button", { name: "Track Builder", exact: true }).click();
  await expect(page.getByLabel(/Interactive 3D track build camera/)).toBeVisible();
  await page.getByRole("button", { name: "Library", exact: true }).click();
  await expect(page.getByText(LEGACY_CUSTOM_TRACK.name, { exact: true })).toBeVisible();

  const after = await readDatabase(page);
  expect(after.nativeVersion).toBe(40);
  expect(after.stores).toEqual(["customTracks", "progress", "quarantine", "replays", "settings"]);
  expect(after.settings).toEqual({
    id: PROFILE_ID,
    schemaVersion: 1,
    value: LEGACY_SETTINGS,
    updatedAt: V2_UPDATED_AT,
  });
  expect(after.progress).toEqual({
    id: PROFILE_ID,
    schemaVersion: 1,
    value: LEGACY_PROGRESS,
    updatedAt: V2_UPDATED_AT,
  });
  expect(after.customTrack).toEqual({ ...LEGACY_CUSTOM_TRACK, schemaVersion: 1 });
  expect(after.replay).toEqual({ ...LEGACY_REPLAY, schemaVersion: 1, samples: [...LEGACY_REPLAY.samples] });
  expect(after.customTrackCount).toBe(1);
  expect(after.replayCount).toBe(1);
  expect(after.quarantineCount).toBe(0);
});

test("a native v3 profile migrates only the exact legacy A and D lane pair", async ({ page }) => {
  const before = await seedLegacyDatabase(page, {
    logicalVersion: 3,
    settingsRecord: {
      id: PROFILE_ID,
      schemaVersion: 1,
      value: LEGACY_DEFAULT_LANE_SETTINGS,
      updatedAt: V2_UPDATED_AT,
    },
    progressRecord: {
      id: PROFILE_ID,
      schemaVersion: 1,
      value: LEGACY_PROGRESS,
      updatedAt: V2_UPDATED_AT,
    },
  });
  expect(before.nativeVersion).toBe(30);
  expect(before.settings).toMatchObject({
    value: { controls: { keyBindings: { laneLeft: "KeyA", laneRight: "KeyD" } } },
  });

  await page.goto("/");
  await expect(page.getByRole("button", { name: "Ride", exact: true })).toBeVisible({ timeout: 15_000 });

  const after = await readDatabase(page);
  expect(after.nativeVersion).toBe(40);
  expect(after.settings).toEqual({
    id: PROFILE_ID,
    schemaVersion: 1,
    value: MIGRATED_DEFAULT_LANE_SETTINGS,
    updatedAt: expect.any(Number),
  });
  expect(after.settings?.updatedAt as number).toBeGreaterThan(V2_UPDATED_AT);
  expect(after.progress).toEqual({
    id: PROFILE_ID,
    schemaVersion: 1,
    value: LEGACY_PROGRESS,
    updatedAt: V2_UPDATED_AT,
  });
  expect(after.customTrackCount).toBe(0);
  expect(after.replayCount).toBe(0);
  expect(after.quarantineCount).toBe(0);
});

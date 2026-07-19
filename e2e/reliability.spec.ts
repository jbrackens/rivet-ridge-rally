import { expect, test, type Locator, type Page } from "@playwright/test";

async function expectHeroBikeReady(canvas: Locator): Promise<void> {
  await expect(canvas).toHaveAttribute("data-bike-asset", "ready", { timeout: 20_000 });
  await expect(canvas).not.toHaveAttribute("data-bike-fallback-reason", /.+/);
  await expect(canvas).toHaveAttribute("data-hero-bike-root", "RRR_HeroBikeRider");
  await expect(canvas).toHaveAttribute("data-hero-bike-root-count", "1");
  await expect(canvas).toHaveAttribute("data-hero-bike-pose-pivot-count", "6");
  await expect(canvas).toHaveAttribute("data-hero-bike-node-count", "88");
  await expect(canvas).toHaveAttribute("data-hero-bike-mesh-count", "28");
  await expect(canvas).toHaveAttribute("data-hero-bike-primitive-count", "28");
  await expect(canvas).toHaveAttribute("data-hero-bike-material-count", "10");
  await expect(canvas).toHaveAttribute("data-hero-bike-texture-count", "0");
  await expect(canvas).toHaveAttribute("data-hero-bike-triangle-count", "49780");
  await expect(canvas).toHaveAttribute("data-hero-bike-bike-triangle-count", "39912");
  await expect(canvas).toHaveAttribute("data-hero-bike-rider-triangle-count", "9868");
  await expect(canvas).toHaveAttribute("data-hero-bike-wheel-triangle-count", "14284");
  await expect(canvas).toHaveAttribute("data-hero-bike-gameplay-authority", "presentation-only");
  await expect(canvas).toHaveAttribute("data-hero-bike-vertical-offset", "-0.63");
  await expect(canvas).toHaveAttribute("data-hero-bike-material-response", "pmrem-three-point");
  await expect(canvas).toHaveAttribute("data-hero-bike-shadow-style", /^(pcf-contact|pcf-disabled-low)$/);
}

async function expectNoCanvasAttributes(canvas: Locator, attributes: readonly string[]): Promise<void> {
  await expect.poll(
    async () => canvas.evaluate((element, names) => (
      names.filter((name) => element.hasAttribute(name))
    ), attributes),
    { message: `${attributes.join(", ")} should be absent`, timeout: 20_000 },
  ).toEqual([]);
}

async function expectHeroBikeDiagnosticsCleared(canvas: Locator): Promise<void> {
  for (const attribute of [
    "data-hero-bike-root",
    "data-hero-bike-root-count",
    "data-hero-bike-pose-pivot-count",
    "data-hero-bike-node-count",
    "data-hero-bike-mesh-count",
    "data-hero-bike-primitive-count",
    "data-hero-bike-material-count",
    "data-hero-bike-texture-count",
    "data-hero-bike-triangle-count",
    "data-hero-bike-bike-triangle-count",
    "data-hero-bike-rider-triangle-count",
    "data-hero-bike-wheel-triangle-count",
    "data-hero-bike-gameplay-authority",
    "data-hero-bike-vertical-offset",
    "data-hero-bike-material-response",
    "data-hero-bike-shadow-style",
  ]) {
    await expect(canvas).not.toHaveAttribute(attribute, /.+/);
  }
}

function observeUnexpectedFailures(
  page: Page,
  allowedRequestFailure: (request: import("@playwright/test").Request) => boolean = () => false,
): () => void {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  const requestFailures: string[] = [];
  const httpFailures: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("requestfailed", (request) => {
    if (allowedRequestFailure(request)) return;
    requestFailures.push(`${request.method()} ${request.url()} ${request.failure()?.errorText ?? "failed"}`);
  });
  page.on("response", (response) => {
    if (response.status() >= 400) httpFailures.push(`${response.status()} ${response.url()}`);
  });
  return () => {
    expect(consoleErrors, "unexpected console errors").toEqual([]);
    expect(pageErrors, "unexpected page errors").toEqual([]);
    expect(requestFailures, "unexpected failed requests").toEqual([]);
    expect(httpFailures, "unexpected HTTP failures").toEqual([]);
  };
}

test("unsupported WebGL presents recovery and menu paths instead of crashing", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "Unsupported-renderer gate runs once in Chromium");
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function getContext(
      contextId: string,
      ...options: unknown[]
    ) {
      if (["webgl", "webgl2", "experimental-webgl"].includes(contextId)) return null;
      return original.call(this, contextId as "2d", ...options as []) as RenderingContext | null;
    } as typeof HTMLCanvasElement.prototype.getContext;
  });

  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Race interrupted" })).toBeVisible();
  await expect(page.getByText(/WebGL could not be initialized/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Reload race" })).toBeVisible();
  await page.getByRole("button", { name: "Return to menu" }).click();
  await expect(page.getByRole("button", { name: "Ride", exact: true })).toBeVisible();
});

test.describe("production asset network fallbacks", () => {
  test.use({ serviceWorkers: "block" });

  test("the authored Canyon kit replaces every Rider School gameplay shell while retaining cooling cues", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "chromium", "Canyon replacement diagnostics run once in Chromium");
    test.setTimeout(180_000);
    await page.goto("/");
    const canvas = page.locator("canvas[aria-label='Live 3D race on Canyon Kickoff']");
    await expect(canvas).toBeAttached({ timeout: 20_000 });
    await expectHeroBikeReady(canvas);
    await expect(canvas).toHaveAttribute("data-environment-asset", "ready", { timeout: 15_000 });
    await expect(canvas).not.toHaveAttribute("data-environment-fallback-reason", /.+/);
    await expect(canvas).toHaveAttribute("data-environment-load-ms", /^\d+$/);
    await expect(canvas).toHaveAttribute("data-canyon-kit-asset", "ready", { timeout: 15_000 });
    await expect(canvas).toHaveAttribute("data-canyon-kit-root-count", "11");
    await expect(canvas).toHaveAttribute("data-canyon-kit-gameplay-authority", "presentation-only");
    await expect(canvas).toHaveAttribute("data-canyon-kit-procedural-replacement-count", "4");
    await expect(canvas).toHaveAttribute("data-canyon-kit-replaced-procedural-visual-count", "14");
    await expect(canvas).toHaveAttribute("data-canyon-kit-retained-cooling-cue-count", "4");
    await expect(canvas).toHaveAttribute("data-canyon-kit-cooling-gate-style", "per-lane-open-arch");
    await expect(canvas).toHaveAttribute("data-canyon-kit-cooling-gate-arch-count", "4");
    await expect(canvas).toHaveAttribute("data-canyon-kit-tabletop-role", "gameplay-ramp-shell");

    await page.evaluate(() => window.__RRR_QA__?.startTrack("canyon-kickoff", "practice"));
    const twoLapCanvas = page.locator("canvas[aria-label='Live 3D race on Canyon Kickoff']");
    await expect(twoLapCanvas).toBeAttached({ timeout: 20_000 });
    await expect(twoLapCanvas).toHaveAttribute("data-canyon-kit-asset", "ready", { timeout: 10_000 });
    await expect(twoLapCanvas).toHaveAttribute("data-canyon-kit-procedural-replacement-count", "8");
    await expect(twoLapCanvas).toHaveAttribute("data-canyon-kit-replaced-procedural-visual-count", "18");
    await expect(twoLapCanvas).toHaveAttribute("data-canyon-kit-retained-cooling-cue-count", "12");
    await expect(twoLapCanvas).toHaveAttribute("data-canyon-kit-cooling-gate-style", "per-lane-open-arch");
    await expect(twoLapCanvas).toHaveAttribute("data-canyon-kit-cooling-gate-arch-count", "12");

    await page.evaluate(() => window.__RRR_QA__?.startTrack("pine-run", "practice"));
    const reusedCanvas = page.locator("canvas[aria-label='Live 3D race on Pine Run']");
    await expect(reusedCanvas).toBeAttached({ timeout: 20_000 });
    await expect(reusedCanvas).toHaveAttribute("data-environment-asset", "not-applicable");
    await expectNoCanvasAttributes(reusedCanvas, [
      "data-environment-fallback-reason",
      "data-environment-load-ms",
      "data-environment-width",
      "data-environment-height",
    ]);
  });

  test("a failed canyon panorama request keeps the tutorial playable", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "chromium", "Environment fallback gate runs once in Chromium");
    const panoramaRequests: string[] = [];
    await page.route("**/assets/art/canyon-festival-panorama.png", async (route) => {
      panoramaRequests.push(route.request().url());
      await route.abort("failed");
    });

    await page.goto("/");
    const canvas = page.getByLabel("Live 3D race on Canyon Kickoff");
    await expect(canvas).toBeVisible({ timeout: 15_000 });
    await expect(canvas).toHaveAttribute("data-environment-asset", "fallback", { timeout: 10_000 });
    await expect(canvas).toHaveAttribute("data-environment-fallback-reason", "load-failed");
    await expect(canvas).toHaveAttribute("data-environment-load-ms", /^\d+$/);
    expect(panoramaRequests).toEqual([
      new URL("/assets/art/canyon-festival-panorama.png", page.url()).href,
    ]);

    await page.getByRole("button", { name: "Start lesson 1" }).click();
    await page.keyboard.down("w");
    await expect(page.getByRole("heading", { name: "Coast to slow" })).toBeVisible({ timeout: 10_000 });
    await page.keyboard.up("w");
  });

  test("a panorama that misses the race deadline upgrades the generated fallback when it arrives", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "chromium", "Late environment upgrade runs once in Chromium");
    test.setTimeout(45_000);
    await page.route("**/assets/art/canyon-festival-panorama.png", async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 6_200));
      await route.continue();
    });

    await page.goto("/");
    const canvas = page.getByLabel("Live 3D race on Canyon Kickoff");
    await expect(canvas).toBeVisible({ timeout: 15_000 });
    await expect(canvas).toHaveAttribute("data-environment-asset", "fallback", { timeout: 12_000 });
    await expect(canvas).toHaveAttribute("data-environment-fallback-reason", "timeout");
    await expect(canvas).toHaveAttribute("data-environment-asset", "ready", { timeout: 15_000 });
    await expect(canvas).not.toHaveAttribute("data-environment-fallback-reason", /.+/);
    await expect(canvas).toHaveAttribute("data-environment-width", /^\d+$/);
    await expect(canvas).toHaveAttribute("data-environment-height", /^\d+$/);
  });

  test("a failed same-origin compressed model request keeps the playable fallback", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "chromium", "Asset fallback gate runs once in Chromium");
    const modelRequests: string[] = [];
    await page.route("**/assets/3d/hero-bike-rider.glb", async (route) => {
      modelRequests.push(route.request().url());
      await route.abort("failed");
    });

    await page.goto("/");
    const canvas = page.getByLabel("Live 3D race on Canyon Kickoff");
    await expect(canvas).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText("Compressed bike unavailable — safe built-in model active")).toBeVisible({ timeout: 10_000 });
    await expect(canvas).toHaveAttribute("data-bike-asset", "fallback");
    await expect(canvas).toHaveAttribute("data-bike-fallback-reason", "load-failed");
    await expectHeroBikeDiagnosticsCleared(canvas);
    expect(modelRequests).toEqual([
      new URL("/assets/3d/hero-bike-rider.glb", page.url()).href,
    ]);

    await page.getByRole("button", { name: "Start lesson 1" }).click();
    await page.keyboard.down("w");
    await expect(page.getByRole("heading", { name: "Coast to slow" })).toBeVisible({ timeout: 10_000 });
    await page.keyboard.up("w");
  });

  test("a decoded model with an invalid hero contract keeps the playable fallback", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "chromium", "Malformed asset fallback gate runs once in Chromium");
    await page.route("**/assets/3d/hero-bike-rider.glb", async (route) => {
      const response = await route.fetch();
      const body = Buffer.from(await response.body());
      const requiredName = Buffer.from('"FrontTire"');
      const invalidName = Buffer.from('"FrontTyre"');
      const nameOffset = body.indexOf(requiredName);
      expect(nameOffset, "fixture must contain the required FrontTire node name").toBeGreaterThan(-1);
      invalidName.copy(body, nameOffset);
      await route.fulfill({ response, body });
    });

    await page.goto("/");
    const canvas = page.getByLabel("Live 3D race on Canyon Kickoff");
    await expect(canvas).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText("Compressed bike unavailable — safe built-in model active")).toBeVisible({ timeout: 10_000 });
    await expect(canvas).toHaveAttribute("data-bike-asset", "fallback");
    await expect(canvas).toHaveAttribute("data-bike-fallback-reason", /contract-invalid:/);
    await expectHeroBikeDiagnosticsCleared(canvas);

    await page.getByRole("button", { name: "Start lesson 1" }).click();
    await page.keyboard.down("w");
    await expect(page.getByRole("heading", { name: "Coast to slow" })).toBeVisible({ timeout: 10_000 });
    await page.keyboard.up("w");
  });

  test("a failed Canyon kit request keeps procedural scenery and the bike loader independent", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "chromium", "Canyon asset fallback gate runs once in Chromium");
    const canyonRequests: string[] = [];
    await page.route("**/assets/canyon/canyon-kit.glb", async (route) => {
      canyonRequests.push(route.request().url());
      await route.abort("failed");
    });

    await page.goto("/");
    const canvas = page.getByLabel("Live 3D race on Canyon Kickoff");
    await expect(canvas).toHaveAttribute("data-canyon-kit-asset", "procedural-fallback", { timeout: 10_000 });
    await expectHeroBikeReady(canvas);
    await expect(canvas).not.toHaveAttribute("data-canyon-kit-root-count", /.+/);
    await expect(canvas).not.toHaveAttribute("data-canyon-kit-procedural-replacement-count", /.+/);
    expect(canyonRequests).toEqual([
      new URL("/assets/canyon/canyon-kit.glb", page.url()).href,
    ]);

    await page.getByRole("button", { name: "Start lesson 1" }).click();
    await page.keyboard.down("w");
    await expect(page.getByRole("heading", { name: "Coast to slow" })).toBeVisible({ timeout: 10_000 });
    await page.keyboard.up("w");
  });

  test("a stalled compressed model request reaches the fallback and starts the race", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "chromium", "Asset deadline gate runs once in Chromium");
    test.setTimeout(90_000);
    let abortedModelRequests = 0;
    const assertCleanRuntime = observeUnexpectedFailures(page);
    page.on("requestfailed", (request) => {
      if (request.url().endsWith("/assets/3d/hero-bike-rider.glb")) abortedModelRequests += 1;
    });
    await page.goto("/?qa-fast-race=1");
    const canvas = page.getByLabel("Live 3D race on Canyon Kickoff");
    await expectHeroBikeReady(canvas);
    await page.evaluate(() => {
      type BikeAssetSnapshot = {
        asset: string;
        reason: string | null;
        heroRoot: string | null;
        gatePhase: string | null;
      };
      const instrumentedWindow = window as typeof window & {
        __RRR_BIKE_ASSET_STATES__?: BikeAssetSnapshot[];
      };
      const states: BikeAssetSnapshot[] = [];
      instrumentedWindow.__RRR_BIKE_ASSET_STATES__ = states;
      const capture = () => {
        const current = document.querySelector<HTMLCanvasElement>(".game-canvas");
        const gate = document.querySelector<HTMLElement>(".game-shell");
        const asset = current?.dataset.bikeAsset;
        if (!current || !asset) return;
        const snapshot: BikeAssetSnapshot = {
          asset,
          reason: current.dataset.bikeFallbackReason ?? null,
          heroRoot: current.dataset.heroBikeRoot ?? null,
          gatePhase: gate?.dataset.raceGatePhase ?? null,
        };
        const previous = states.at(-1);
        if (previous?.asset === snapshot.asset && previous.gatePhase === snapshot.gatePhase) return;
        states.push(snapshot);
      };
      const observer = new MutationObserver(capture);
      observer.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ["data-bike-asset", "data-race-gate-phase"],
        childList: true,
        subtree: true,
      });
      capture();
    });

    // Install the stall only after the tutorial model has settled, so the
    // observed abort belongs to the subsequent Practice engine deadline.
    await page.route("**/assets/3d/hero-bike-rider.glb", async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 13_250));
      await route.continue().catch(() => undefined);
    });

    await page.getByRole("button", { name: "Skip training" }).click();
    await page.getByRole("button", { name: "Ride", exact: true }).click();
    await page.getByRole("button", { name: /^03 Practice/ }).click();

    // The fallback and Go signal are both intentionally transient. Observe the
    // durable gate state here, then assert the ordered asset transitions below.
    await expect(page.locator(".game-shell")).toHaveAttribute("data-race-gate-phase", "racing", {
      timeout: 30_000,
    });
    await expectHeroBikeReady(canvas);
    const assetStates = await page.evaluate(() => (
      (window as typeof window & {
        __RRR_BIKE_ASSET_STATES__?: Array<{
          asset: string;
          reason: string | null;
          heroRoot: string | null;
          gatePhase: string | null;
        }>;
      }).__RRR_BIKE_ASSET_STATES__ ?? []
    ));
    const loadingIndex = assetStates.findIndex(({ asset }) => asset === "loading");
    const fallbackIndex = assetStates.findIndex(
      ({ asset }, index) => index > loadingIndex && asset === "fallback",
    );
    const readyIndex = assetStates.findIndex(
      ({ asset }, index) => index > fallbackIndex && asset === "ready",
    );
    const countdownIndex = assetStates.findIndex(
      ({ gatePhase }, index) => index > loadingIndex && gatePhase === "countdown",
    );
    expect(loadingIndex).toBeGreaterThan(-1);
    expect(fallbackIndex).toBeGreaterThan(loadingIndex);
    expect(readyIndex).toBeGreaterThan(fallbackIndex);
    expect(countdownIndex).toBeGreaterThan(fallbackIndex);
    expect(assetStates[fallbackIndex]).toEqual({
      asset: "fallback",
      reason: "timeout",
      heroRoot: null,
      gatePhase: "loading",
    });
    expect(abortedModelRequests).toBe(0);
    assertCleanRuntime();
  });
});

test("corrupt local progress is quarantined and replaced with a safe profile", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "IndexedDB recovery gate runs once in Chromium");
  await page.goto("/");
  await page.getByRole("button", { name: "Skip training" }).click();
  await page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("rivet-ridge-rally");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction("progress", "readwrite");
      transaction.objectStore("progress").put({
        id: "rider-01",
        schemaVersion: 1,
        value: { damaged: true },
        updatedAt: Date.now(),
      });
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
    database.close();
  });

  await page.reload();
  await page.getByRole("button", { name: "Skip training" }).click();
  await expect(page.getByRole("status")).toHaveText("A damaged local save was recovered safely.");
  const quarantineCount = await page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("rivet-ridge-rally");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const count = await new Promise<number>((resolve, reject) => {
      const request = database.transaction("quarantine", "readonly").objectStore("quarantine").count();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    database.close();
    return count;
  });
  expect(quarantineCount).toBeGreaterThan(0);
});

test("unavailable IndexedDB discloses session mode while a race remains playable", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "IndexedDB failure gate runs once in Chromium");
  const assertCleanRuntime = observeUnexpectedFailures(page);
  await page.addInitScript(() => {
    Object.defineProperty(window, "indexedDB", {
      configurable: true,
      value: undefined,
    });
  });

  await page.goto("/?qa-fast-race=1");
  await expect(page.getByRole("heading", { name: "Rider school" })).toBeVisible({ timeout: 15_000 });
  const tutorialNotice = page.getByRole("alert");
  await expect(tutorialNotice).toContainText("Device saving unavailable");
  await expect(tutorialNotice).toContainText("Rider School remains playable in session mode");
  await expect(page.getByRole("button", { name: "Skip training" })).toBeVisible();
  await page.getByRole("button", { name: "Skip training" }).click();

  await expect(page.getByRole("button", { name: "Ride", exact: true })).toBeVisible();
  const notice = page.getByRole("alert");
  await expect(notice.getByRole("heading", { name: "Device saving unavailable" })).toBeVisible();
  await expect(notice).toContainText("new progress and settings may disappear");
  await expect(notice.getByRole("button", { name: "Retry device saving" })).toBeVisible();

  await notice.getByRole("button", { name: "Recovery steps" }).click();
  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
  await expect(page.getByRole("alert")).toContainText("Export accessible custom tracks first");
  await expect(page.getByRole("alert")).toContainText("reset site data only as a last resort");
  await page.getByRole("button", { name: "Done" }).click();

  await page.getByRole("button", { name: "Ride", exact: true }).click();
  await page.getByRole("button", { name: /^03 Practice/ }).click();
  await expect(page.getByLabel("Live 3D race on Canyon Kickoff")).toBeVisible();
  assertCleanRuntime();
});

test("session-mode Track Builder restores its unsaved draft and history after Test Ride", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "IndexedDB editor fallback runs once in Chromium");
  test.setTimeout(90_000);
  const assertCleanRuntime = observeUnexpectedFailures(page);
  await page.addInitScript(() => {
    Object.defineProperty(window, "indexedDB", {
      configurable: true,
      value: undefined,
    });
  });

  await page.goto("/");
  await page.getByRole("button", { name: "Skip training" }).click();
  await page.getByRole("button", { name: "Track Builder", exact: true }).click();
  const persistenceNotice = page.getByRole("alert");
  await expect(persistenceNotice).toContainText("Editing and test rides still work this session");
  await expect(persistenceNotice).toContainText("Use Export for a valid draft");

  await page.getByRole("button", { name: "terrain", exact: true }).click();
  const mudPatch = page.getByRole("button", { name: /^Mud Patch/ });
  await mudPatch.click();
  await page.getByRole("button", { name: "Place selected module at route view" }).click();
  await page.getByLabel("Track name").fill("Session Workshop");
  await expect(page.getByText("2 / 50 actions", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Test Ride", exact: true }).click();
  const race = page.getByLabel("Live 3D race on Session Workshop");
  await expect(race).toBeVisible();
  await expect(page.locator(".game-shell")).toHaveAttribute("data-race-gate-phase", "racing", { timeout: 15_000 });
  await race.press("Escape");
  await page.getByRole("button", { name: "Return to Track Builder", exact: true }).click();

  await expect(page.getByLabel("Track name")).toHaveValue("Session Workshop");
  await expect(page.getByText("4 modules", { exact: true })).toBeVisible();
  await expect(page.getByText("2 / 50 actions", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "terrain", exact: true })).toHaveClass(/active/);
  await expect(page.getByRole("button", { name: /^Mud Patch/ })).toHaveClass(/active/);
  await expect(page.getByRole("spinbutton", { name: "Lane", exact: true })).toBeVisible();
  await expect(page.getByRole("alert")).toContainText(
    "The exact “Session Workshop” snapshot is still held in this tab",
  );
  await expect(page.getByRole("alert")).toContainText(
    "export it before closing the tab",
  );
  await expect(page.getByRole("button", { name: "Retry track saving" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Export", exact: true })).toBeVisible();
  assertCleanRuntime();
});

test("quota write failure stays visible and retry flushes session settings", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "IndexedDB failure gate runs once in Chromium");
  const assertCleanRuntime = observeUnexpectedFailures(page);
  await page.addInitScript(() => {
    const originalPut = IDBObjectStore.prototype.put;
    Object.defineProperty(IDBObjectStore.prototype, "put", {
      configurable: true,
      value(this: IDBObjectStore, ...args: unknown[]) {
        const controlledWindow = window as typeof window & { __rrrFailPersistenceWrites?: boolean };
        if (controlledWindow.__rrrFailPersistenceWrites) {
          throw new DOMException("QA storage quota reached.", "QuotaExceededError");
        }
        return Reflect.apply(originalPut, this, args) as IDBRequest<IDBValidKey>;
      },
    });
  });

  await page.goto("/");
  await page.getByRole("button", { name: "Skip training" }).click();
  await expect(page.getByRole("button", { name: "Settings" })).toBeVisible();
  await page.evaluate(() => {
    (window as typeof window & { __rrrFailPersistenceWrites?: boolean }).__rrrFailPersistenceWrites = true;
  });

  await page.getByRole("button", { name: "Settings" }).click();
  await page.getByLabel("High contrast").check();
  await expect(page.locator("html")).toHaveAttribute("data-high-contrast", "true");
  await expect(page.getByRole("alert").getByRole("heading", { name: "Device storage is full" })).toBeVisible();
  await expect(page.getByText("Changes remain active for this session while device saving recovers.")).toBeVisible();
  await page.getByRole("button", { name: "Done" }).click();

  await page.getByRole("button", { name: "Track Builder", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Use Export for a valid draft");
  await expect(page.getByRole("button", { name: "Export", exact: true })).toBeVisible();
  await page.evaluate(() => {
    (window as typeof window & { __rrrFailPersistenceWrites?: boolean }).__rrrFailPersistenceWrites = false;
  });
  await page.getByRole("alert").getByRole("button", { name: "Retry device saving" }).click();
  await expect(page.getByRole("alert")).toHaveCount(0);

  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.locator(".editor-status output")).toHaveText("Track saved locally.");
  await page.getByRole("button", { name: "Back to festival menu" }).click();
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-high-contrast", "true");
  assertCleanRuntime();
});

test("newer-version open failure preserves seeded data and shows upgrade recovery guidance", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "IndexedDB failure gate runs once in Chromium");
  const assertCleanRuntime = observeUnexpectedFailures(page);
  await page.route("http://127.0.0.1:4173/", (route) => route.fulfill({
    contentType: "text/html",
    body: "<!doctype html><html><body>Persistence preservation fixture</body></html>",
  }), { times: 1 });
  await page.goto("/");

  const seed = await page.evaluate(async () => {
    const waitForRequest = <T>(request: IDBRequest<T>) => new Promise<T>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
      if ("onblocked" in request) {
        (request as unknown as IDBOpenDBRequest).onblocked = () => reject(new Error("IndexedDB request was blocked."));
      }
    });
    const databaseName = "rivet-ridge-rally";
    const record = {
      id: "future-save-probe",
      payload: "owner data must survive an older app open",
      updatedAt: 1_720_000_000_000,
    };

    await waitForRequest(indexedDB.deleteDatabase(databaseName));
    const openRequest = indexedDB.open(databaseName, 40);
    openRequest.onupgradeneeded = () => {
      openRequest.result.createObjectStore("futureData", { keyPath: "id" }).put(record);
    };
    const database = await waitForRequest(openRequest);
    const snapshot = {
      version: database.version,
      stores: Array.from(database.objectStoreNames),
      record,
    };
    database.close();
    return snapshot;
  });
  expect(seed).toEqual({
    version: 40,
    stores: ["futureData"],
    record: {
      id: "future-save-probe",
      payload: "owner data must survive an older app open",
      updatedAt: 1_720_000_000_000,
    },
  });

  await page.addInitScript(() => {
    const originalOpen = IDBFactory.prototype.open;
    IDBFactory.prototype.open = function open(name: string, version?: number): IDBOpenDBRequest {
      if (name === "rivet-ridge-rally") {
        throw new DOMException("A newer local schema requires an application upgrade.", "VersionError");
      }
      return version === undefined
        ? originalOpen.call(this, name)
        : originalOpen.call(this, name, version);
    };
    Object.defineProperty(window, "__RRR_RESTORE_IDB_OPEN__", {
      configurable: true,
      value() {
        IDBFactory.prototype.open = originalOpen;
      },
    });
  });

  await page.goto("/");
  const skipTraining = page.getByRole("button", { name: "Skip training" });
  const ride = page.getByRole("button", { name: "Ride", exact: true });
  await expect(skipTraining.or(ride)).toBeVisible({ timeout: 15_000 });
  if (await skipTraining.isVisible()) await skipTraining.click();
  await expect(ride).toBeVisible();
  const notice = page.getByRole("alert");
  await expect(notice.getByRole("heading", { name: "Save upgrade needs attention" })).toBeVisible();
  await expect(notice).toContainText("Existing data has not been deleted");
  await notice.getByRole("button", { name: "Recovery steps" }).click();
  await expect(page.getByRole("alert")).toContainText("reset site data only as a last resort");

  const preserved = await page.evaluate(async () => {
    (window as typeof window & { __RRR_RESTORE_IDB_OPEN__?: () => void }).__RRR_RESTORE_IDB_OPEN__?.();
    const waitForRequest = <T>(request: IDBRequest<T>) => new Promise<T>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const database = await waitForRequest(indexedDB.open("rivet-ridge-rally"));
    const record = await waitForRequest(
      database.transaction("futureData", "readonly").objectStore("futureData").get("future-save-probe"),
    );
    const snapshot = {
      version: database.version,
      stores: Array.from(database.objectStoreNames),
      record,
    };
    database.close();
    return snapshot;
  });
  expect(preserved).toEqual(seed);
  assertCleanRuntime();
});

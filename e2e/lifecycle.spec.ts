import { expect, test, type Page } from "@playwright/test";

import type { LifecycleDiagnostics } from "../src/game/qa/lifecycleDiagnostics";

interface IndexedDbProbeSnapshot {
  active: number;
  opened: number;
  closed: number;
}

function desktopLifecycleProject(projectName: string): boolean {
  return projectName === "chromium" || projectName === "webkit";
}

function observeLifecycleFailures(page: Page): () => void {
  const failures: string[] = [];
  page.on("console", (message) => {
    const text = message.text();
    if (message.type() === "error" || /too many active webgl contexts|oldest context will be lost/i.test(text)) {
      failures.push(`console ${message.type()}: ${text}`);
    }
  });
  page.on("pageerror", (error) => failures.push(`pageerror: ${error.message}`));
  page.on("requestfailed", (request) => {
    failures.push(`requestfailed: ${request.method()} ${request.url()} — ${request.failure()?.errorText ?? "unknown"}`);
  });
  page.on("response", (response) => {
    if (response.status() >= 400) failures.push(`response: ${response.status()} ${response.url()}`);
  });
  return () => expect(failures, "lifecycle runtime failures").toEqual([]);
}

async function installVisibilityControl(page: Page): Promise<void> {
  await page.addInitScript(() => {
    let hidden = false;
    Object.defineProperties(document, {
      hidden: { configurable: true, get: () => hidden },
      visibilityState: { configurable: true, get: () => hidden ? "hidden" : "visible" },
    });
    Object.defineProperty(window, "__RRR_SET_HIDDEN__", {
      configurable: true,
      value(value: boolean) {
        hidden = value;
        document.dispatchEvent(new Event("visibilitychange"));
      },
    });
  });
}

async function installIndexedDbProbe(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const knownDatabases = new WeakSet<IDBDatabase>();
    const closedDatabases = new WeakSet<IDBDatabase>();
    const state = { active: 0, opened: 0, closed: 0 };
    const originalOpen = IDBFactory.prototype.open;
    const originalClose = IDBDatabase.prototype.close;

    IDBFactory.prototype.open = function open(name: string, version?: number): IDBOpenDBRequest {
      const request = version === undefined
        ? originalOpen.call(this, name)
        : originalOpen.call(this, name, version);
      request.addEventListener("success", () => {
        const database = request.result;
        if (knownDatabases.has(database)) return;
        knownDatabases.add(database);
        state.active += 1;
        state.opened += 1;
      }, { once: true });
      return request;
    };

    IDBDatabase.prototype.close = function close(): void {
      if (knownDatabases.has(this) && !closedDatabases.has(this)) {
        closedDatabases.add(this);
        state.active = Math.max(0, state.active - 1);
        state.closed += 1;
      }
      originalClose.call(this);
    };

    Object.defineProperty(window, "__RRR_IDB_PROBE__", {
      configurable: true,
      value: {
        snapshot: () => ({ ...state }),
      },
    });
  });
}

async function lifecycle(page: Page): Promise<LifecycleDiagnostics> {
  const snapshot = await page.evaluate(() => window.__RRR_QA__?.lifecycle());
  if (!snapshot) throw new Error("QA lifecycle diagnostics are unavailable.");
  return snapshot;
}

async function indexedDbProbe(page: Page): Promise<IndexedDbProbeSnapshot> {
  return page.evaluate(() => {
    const probe = (window as typeof window & {
      __RRR_IDB_PROBE__?: { snapshot: () => IndexedDbProbeSnapshot };
    }).__RRR_IDB_PROBE__;
    if (!probe) throw new Error("IndexedDB lifecycle probe is unavailable.");
    return probe.snapshot();
  });
}

async function setSyntheticVisibility(page: Page, hidden: boolean): Promise<void> {
  await page.evaluate((nextHidden) => {
    const setHidden = (window as typeof window & {
      __RRR_SET_HIDDEN__?: (value: boolean) => void;
    }).__RRR_SET_HIDDEN__;
    if (!setHidden) throw new Error("Visibility control is unavailable.");
    setHidden(nextHidden);
  }, hidden);
}

async function startPractice(page: Page, path = "/?qa-fast-race=1"): Promise<void> {
  await page.goto(path);
  const skip = page.getByRole("button", { name: "Skip training" });
  await expect(skip).toBeVisible({ timeout: 15_000 });
  await skip.click();
  await page.getByRole("button", { name: "Ride", exact: true }).click();
  await page.getByRole("button", { name: /Practice/ }).click();
  await expect(page.getByLabel("Live 3D race on Canyon Kickoff")).toBeVisible();
  await expect(page.locator(".game-shell")).toHaveAttribute(
    "data-race-gate-phase",
    "racing",
    { timeout: 15_000 },
  );
  await expect.poll(async () => (await lifecycle(page)).active.gameEngines).toBe(1);
  await expect.poll(() => page.getByLabel("Performance metrics").textContent()).toMatch(/[1-9]\d* draws/);
}

function displayedTimeMs(value: string): number {
  const [minutes = "0", remainder = "0"] = value.split(":");
  const [seconds = "0", hundredths = "0"] = remainder.split(".");
  return Number(minutes) * 60_000 + Number(seconds) * 1_000 + Number(hundredths) * 10;
}

async function raceTimeMs(page: Page): Promise<number> {
  return displayedTimeMs(await page.locator(".timing-block > strong").innerText());
}

async function finishFastRace(page: Page): Promise<void> {
  await page.keyboard.down("w");
  await page.keyboard.down("Space");
  for (let cycle = 0; cycle < 14; cycle += 1) {
    await page.keyboard.down("Shift");
    await page.waitForTimeout(520);
    await page.keyboard.up("Shift");
    if (await page.getByRole("button", { name: "Retry now" }).isVisible()) break;
    await page.waitForTimeout(620);
    if (await page.getByRole("button", { name: "Retry now" }).isVisible()) break;
  }
  await page.keyboard.up("w");
  await page.keyboard.up("Space");
  await page.keyboard.up("Shift");
  await expect(page.getByRole("button", { name: "Retry now" })).toBeVisible({ timeout: 15_000 });
}

test("tutorial rebuild retains its canvas renderer and tutorial exit releases it", async ({ page }, testInfo) => {
  test.skip(!desktopLifecycleProject(testInfo.project.name), "Desktop Chromium/WebKit lifecycle gate");
  await page.goto("/?qa-fast-race=1");
  await expect(page.getByRole("button", { name: "Skip training" })).toBeVisible({ timeout: 15_000 });
  await expect.poll(async () => (await lifecycle(page)).active.gameEngines).toBe(1);
  const baseline = await lifecycle(page);

  await page.evaluate(() => window.__RRR_QA__?.unlockCampaign());
  await expect.poll(async () => {
    const snapshot = await lifecycle(page);
    return {
      engineStarts: snapshot.started.gameEngines,
      contexts: snapshot.active.webglContexts,
      contextStarts: snapshot.started.webglContexts,
      contextStops: snapshot.stopped.webglContexts,
    };
  }).toEqual({
    engineStarts: baseline.started.gameEngines + 1,
    contexts: 1,
    contextStarts: baseline.started.webglContexts,
    contextStops: baseline.stopped.webglContexts,
  });

  await page.evaluate(() => window.__RRR_QA__?.startTrack("canyon-kickoff", "practice"));
  await expect(page.getByLabel("Live 3D race on Canyon Kickoff")).toBeVisible();
  await expect.poll(async () => {
    const snapshot = await lifecycle(page);
    return {
      contexts: snapshot.active.webglContexts,
      contextStarts: snapshot.started.webglContexts,
      contextStops: snapshot.stopped.webglContexts,
    };
  }).toEqual({
    contexts: 1,
    contextStarts: baseline.started.webglContexts + 1,
    contextStops: baseline.stopped.webglContexts + 1,
  });
});

test("fatal race cleanup releases its detached renderer exactly once", async ({ page }, testInfo) => {
  test.skip(!desktopLifecycleProject(testInfo.project.name), "Desktop Chromium/WebKit lifecycle gate");
  await startPractice(page);
  const baseline = await lifecycle(page);

  await page.getByLabel("Live 3D race on Canyon Kickoff").evaluate((canvas) => {
    canvas.dispatchEvent(new Event("webglcontextlost", { cancelable: true }));
  });
  await expect(page.getByRole("heading", { name: "Race paused at the gate" })).toBeVisible();
  await expect.poll(async () => {
    const snapshot = await lifecycle(page);
    return {
      engines: snapshot.active.gameEngines,
      contexts: snapshot.active.webglContexts,
      loops: snapshot.active.engineRenderLoops,
      contextStops: snapshot.stopped.webglContexts,
    };
  }).toEqual({
    engines: 0,
    contexts: 0,
    loops: 0,
    contextStops: baseline.stopped.webglContexts + 1,
  });

  await page.getByRole("button", { name: "Return to menu" }).click();
  await expect.poll(async () => (await lifecycle(page)).stopped.webglContexts).toBe(
    baseline.stopped.webglContexts + 1,
  );
});

test("visibility loss pauses and safely suspends simulation, held input, and race audio", async ({ page }, testInfo) => {
  test.skip(!desktopLifecycleProject(testInfo.project.name), "Desktop Chromium/WebKit lifecycle gate");
  test.setTimeout(90_000);
  await installVisibilityControl(page);
  const assertNoFailures = observeLifecycleFailures(page);
  await startPractice(page);

  const before = await lifecycle(page);
  await page.keyboard.down("w");
  await expect.poll(async () => (await lifecycle(page)).gauges.heldInputs).toBe(1);
  await expect.poll(async () => (await lifecycle(page)).active.audioIntervals).toBe(1);
  await expect.poll(() => raceTimeMs(page)).toBeGreaterThan(200);

  await setSyntheticVisibility(page, true);
  await expect(page.getByRole("dialog", { name: "Race paused" })).toBeVisible();
  await page.evaluate(() => window.dispatchEvent(new KeyboardEvent("keydown", {
    bubbles: true,
    code: "Escape",
    repeat: true,
  })));
  await expect(page.getByRole("dialog", { name: "Race paused" })).toBeVisible();
  await expect(page.locator(".game-shell")).toHaveAttribute("data-paused", "true");
  await expect.poll(async () => {
    const snapshot = await lifecycle(page);
    return {
      heldInputs: snapshot.gauges.heldInputs,
      inputSuspensions: snapshot.events.inputSuspensions,
      pausedAudioManagers: snapshot.active.pausedAudioManagers,
      audioIntervals: snapshot.active.audioIntervals,
    };
  }).toEqual({
    heldInputs: 0,
    inputSuspensions: before.events.inputSuspensions + 1,
    pausedAudioManagers: 1,
    audioIntervals: 0,
  });

  const pausedAt = await raceTimeMs(page);
  await page.waitForTimeout(450);
  expect(await raceTimeMs(page)).toBe(pausedAt);

  await setSyntheticVisibility(page, false);
  await expect(page.getByRole("dialog", { name: "Race paused" })).toBeVisible();
  await page.waitForTimeout(250);
  expect(await raceTimeMs(page)).toBe(pausedAt);

  await page.getByRole("button", { name: "Resume", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Race paused" })).toHaveCount(0);
  await expect.poll(async () => (await lifecycle(page)).active.pausedAudioManagers).toBe(0);
  await expect.poll(async () => (await lifecycle(page)).active.audioIntervals).toBe(1);
  await expect.poll(() => raceTimeMs(page)).toBeGreaterThan(pausedAt);
  await page.keyboard.up("w");
  assertNoFailures();
});

test("device-storage recovery in paused Settings preserves the live race attempt", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "IndexedDB recovery lifecycle gate runs once in Chromium");
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
  const assertNoFailures = observeLifecycleFailures(page);
  await startPractice(page);
  await expect.poll(() => raceTimeMs(page)).toBeGreaterThan(200);
  const beforeRecovery = await lifecycle(page);

  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.evaluate(() => {
    (window as typeof window & { __rrrFailPersistenceWrites?: boolean }).__rrrFailPersistenceWrites = true;
  });
  await page.getByLabel("High contrast").check();
  await expect(page.getByRole("alert").getByRole("heading", { name: "Device storage is full" })).toBeVisible();

  await page.evaluate(() => {
    (window as typeof window & { __rrrFailPersistenceWrites?: boolean }).__rrrFailPersistenceWrites = false;
  });
  await page.getByRole("alert").getByRole("button", { name: "Retry device saving" }).click();
  await expect(page.getByRole("alert")).toHaveCount(0);
  const afterRecovery = await lifecycle(page);
  expect({
    gameEngineStarts: afterRecovery.started.gameEngines,
    gameEngines: afterRecovery.active.gameEngines,
    webglContexts: afterRecovery.active.webglContexts,
    engineRenderLoops: afterRecovery.active.engineRenderLoops,
  }).toEqual({
    gameEngineStarts: beforeRecovery.started.gameEngines,
    gameEngines: 1,
    webglContexts: 1,
    engineRenderLoops: 1,
  });

  await page.getByRole("button", { name: "Done", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Race paused" })).toBeVisible();
  const pausedAt = await raceTimeMs(page);
  await page.getByRole("button", { name: "Resume", exact: true }).click();
  await expect.poll(() => raceTimeMs(page)).toBeGreaterThan(pausedAt);
  assertNoFailures();
});

test("visibility loss pauses the tutorial and defers a cleared lesson", async ({ page }, testInfo) => {
  test.skip(!desktopLifecycleProject(testInfo.project.name), "Desktop Chromium/WebKit lifecycle gate");
  await installVisibilityControl(page);
  const assertNoFailures = observeLifecycleFailures(page);
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Rider school" })).toBeVisible({ timeout: 15_000 });
  await page.getByRole("button", { name: "Start lesson 1" }).click();

  await page.keyboard.down("w");
  await expect(page.getByText("Lesson cleared", { exact: true })).toBeVisible({ timeout: 10_000 });
  await setSyntheticVisibility(page, true);
  await page.keyboard.up("w");

  await expect(page.getByRole("dialog", { name: "Training paused" })).toBeVisible();
  await expect(page.locator(".game-shell")).toHaveAttribute("data-paused", "true");
  await page.waitForTimeout(700);
  await setSyntheticVisibility(page, false);
  await expect(page.getByRole("dialog", { name: "Training paused" })).toBeVisible();

  await page.getByRole("button", { name: "Resume lesson" }).click();
  await expect(page.getByRole("heading", { name: "Ride and read the HUD" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Coast to slow" })).toBeVisible({ timeout: 2_000 });
  assertNoFailures();
});

test("twenty immediate restarts reuse one WebGL context and retain one engine lifecycle", async ({ page }, testInfo) => {
  test.skip(!desktopLifecycleProject(testInfo.project.name), "Desktop Chromium/WebKit lifecycle gate");
  test.setTimeout(180_000);
  await installIndexedDbProbe(page);
  const assertNoFailures = observeLifecycleFailures(page);
  await startPractice(page);

  await expect.poll(async () => (await indexedDbProbe(page)).active).toBe(1);
  const baseline = await lifecycle(page);
  const baselineDatabase = await indexedDbProbe(page);
  expect({
    gameEngines: baseline.active.gameEngines,
    webglContexts: baseline.active.webglContexts,
    engineRenderLoops: baseline.active.engineRenderLoops,
    inputListenerGroups: baseline.active.inputListenerGroups,
    contextLossListeners: baseline.active.contextLossListeners,
    visibilityListenerGroups: baseline.active.visibilityListenerGroups,
    pausePollLoops: baseline.active.pausePollLoops,
  }).toEqual({
    gameEngines: 1,
    webglContexts: 1,
    engineRenderLoops: 1,
    inputListenerGroups: 1,
    contextLossListeners: 1,
    visibilityListenerGroups: 1,
    pausePollLoops: 1,
  });

  for (let restart = 1; restart <= 20; restart += 1) {
    await test.step(`restart ${restart} of 20`, async () => {
      await expect(page.locator(".game-shell")).toHaveAttribute(
        "data-race-gate-phase",
        "racing",
        { timeout: 15_000 },
      );
      await page.keyboard.press("Escape");
      await expect(page.getByRole("dialog", { name: "Race paused" })).toBeVisible();
      await page.getByRole("button", { name: "Restart now" }).click();
      await expect(page.getByRole("dialog", { name: "Race paused" })).toHaveCount(0);
      await expect(page.locator(".timing-block > strong")).toHaveText(/^00:00\./);
      await expect.poll(async () => {
        const snapshot = await lifecycle(page);
        return {
          gameEngineStarts: snapshot.started.gameEngines,
          gameEngines: snapshot.active.gameEngines,
          webglContexts: snapshot.active.webglContexts,
          engineRenderLoops: snapshot.active.engineRenderLoops,
          inputListenerGroups: snapshot.active.inputListenerGroups,
          contextLossListeners: snapshot.active.contextLossListeners,
          visibilityListenerGroups: snapshot.active.visibilityListenerGroups,
          pausePollLoops: snapshot.active.pausePollLoops,
          audioContexts: snapshot.active.audioContexts,
          audioIntervals: snapshot.active.audioIntervals,
        };
      }).toEqual({
        gameEngineStarts: baseline.started.gameEngines + restart,
        gameEngines: 1,
        webglContexts: 1,
        engineRenderLoops: 1,
        inputListenerGroups: 1,
        contextLossListeners: 1,
        visibilityListenerGroups: 1,
        pausePollLoops: 1,
        audioContexts: baseline.active.audioContexts,
        audioIntervals: baseline.active.audioIntervals,
      });
    });
  }

  const finalSnapshot = await lifecycle(page);
  for (const resource of [
    "gameEngines",
    "webglContexts",
    "engineRenderLoops",
    "inputListenerGroups",
    "contextLossListeners",
    "visibilityListenerGroups",
    "pausePollLoops",
    "audioContexts",
    "audioIntervals",
  ] as const) {
    expect(
      finalSnapshot.started[resource] - finalSnapshot.stopped[resource],
      `${resource} start/stop balance`,
    ).toBe(finalSnapshot.active[resource]);
  }
  expect(finalSnapshot.started.webglContexts).toBe(baseline.started.webglContexts);
  expect(finalSnapshot.stopped.webglContexts).toBe(baseline.stopped.webglContexts);
  expect(await indexedDbProbe(page)).toEqual(baselineDatabase);
  assertNoFailures();
});

test("six results retries release each unmounted WebGL context before starting the next race", async ({ page }, testInfo) => {
  test.skip(!desktopLifecycleProject(testInfo.project.name), "Desktop Chromium/WebKit lifecycle gate");
  test.setTimeout(180_000);
  const assertNoFailures = observeLifecycleFailures(page);
  await startPractice(page);

  const baseline = await lifecycle(page);
  for (let race = 1; race <= 6; race += 1) {
    await test.step(`finish and retry race ${race} of 6`, async () => {
      await finishFastRace(page);
      await expect.poll(async () => {
        const snapshot = await lifecycle(page);
        return {
          gameEngines: snapshot.active.gameEngines,
          webglContexts: snapshot.active.webglContexts,
          engineRenderLoops: snapshot.active.engineRenderLoops,
          contextStops: snapshot.stopped.webglContexts,
        };
      }).toEqual({
        gameEngines: 0,
        webglContexts: 0,
        engineRenderLoops: 0,
        contextStops: baseline.stopped.webglContexts + race,
      });

      await page.getByRole("button", { name: "Retry now" }).click();
      await expect(page.getByLabel("Live 3D race on Canyon Kickoff")).toBeVisible();
      await expect.poll(async () => {
        const snapshot = await lifecycle(page);
        return {
          gameEngines: snapshot.active.gameEngines,
          webglContexts: snapshot.active.webglContexts,
          engineRenderLoops: snapshot.active.engineRenderLoops,
          contextStarts: snapshot.started.webglContexts,
        };
      }).toEqual({
        gameEngines: 1,
        webglContexts: 1,
        engineRenderLoops: 1,
        contextStarts: baseline.started.webglContexts + race,
      });
    });
  }

  assertNoFailures();
});

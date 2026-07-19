import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

async function completeOnboarding(page: import("@playwright/test").Page, fastRace = true): Promise<void> {
  await page.goto(fastRace ? "/?qa-fast-race=1" : "/");
  const skip = page.getByRole("button", { name: "Skip training" });
  await expect(skip).toBeVisible({ timeout: 15_000 });
  await skip.click();
  await expect(page.getByRole("button", { name: "Ride", exact: true })).toBeVisible();
}

async function finishFastKeyboardRace(page: import("@playwright/test").Page): Promise<void> {
  const retryButton = page.getByRole("button", { name: "Retry now" });
  await page.locator(".game-canvas").focus();
  try {
    await page.keyboard.down("w");
    await page.keyboard.down("Space");
    for (let cycle = 0; cycle < 30; cycle += 1) {
      await page.keyboard.down("Shift");
      await page.waitForTimeout(520);
      await page.keyboard.up("Shift");
      if (await retryButton.isVisible()) break;
      await page.waitForTimeout(620);
      if (await retryButton.isVisible()) break;
    }
    await expect(retryButton).toBeVisible({ timeout: 45_000 });
  } finally {
    await page.keyboard.up("w");
    await page.keyboard.up("Space");
    await page.keyboard.up("Shift");
  }
}

async function finishFastTouchRace(page: import("@playwright/test").Page): Promise<void> {
  const retryButton = page.getByRole("button", { name: "Retry now" });
  const ride = page.locator('button[data-control="ride"]');
  const turbo = page.locator('button[data-control="turbo"]');
  await expect(page.locator(".game-shell")).toHaveAttribute(
    "data-race-gate-phase",
    "racing",
    { timeout: 30_000 },
  );
  try {
    await ride.dispatchEvent("pointerdown", {
      pointerId: 11,
      pointerType: "touch",
      isPrimary: true,
    });
    for (let cycle = 0; cycle < 30; cycle += 1) {
      await turbo.dispatchEvent("pointerdown", {
        pointerId: 12,
        pointerType: "touch",
        isPrimary: false,
      });
      await page.waitForTimeout(520);
      // Results can replace the race DOM while Turbo is held. Check the
      // completion condition before trying to release a now-detached control.
      if (await retryButton.isVisible()) break;
      try {
        await turbo.dispatchEvent("pointerup", {
          pointerId: 12,
          pointerType: "touch",
          isPrimary: false,
        }, { timeout: 1_000 });
      } catch (error) {
        if (!(await retryButton.isVisible())) throw error;
        break;
      }
      if (await retryButton.isVisible()) break;
      await page.waitForTimeout(620);
      if (await retryButton.isVisible()) break;
    }
    await expect(retryButton).toBeVisible({ timeout: 45_000 });
  } finally {
    if (await turbo.isVisible().catch(() => false)) {
      await turbo.dispatchEvent("pointerup", {
        pointerId: 12,
        pointerType: "touch",
        isPrimary: false,
      });
    }
    if (await ride.isVisible().catch(() => false)) {
      await ride.dispatchEvent("pointerup", {
        pointerId: 11,
        pointerType: "touch",
        isPrimary: true,
      });
    }
  }
}

async function expectReachableResultsAtViewport(
  page: import("@playwright/test").Page,
  viewport: { name: string; width: number; height: number },
): Promise<void> {
  await page.setViewportSize({ width: viewport.width, height: viewport.height });
  await page.locator(".results-screen").evaluate((element) => {
    element.scrollTo({ top: 0, left: 0 });
  });

  const headerAtTop = await page.evaluate(() => {
    const results = document.querySelector<HTMLElement>(".results-screen");
    const header = document.querySelector<HTMLElement>(".results-screen header");
    if (!results || !header) return null;
    const resultsRect = results.getBoundingClientRect();
    const headerRect = header.getBoundingClientRect();
    const style = getComputedStyle(results);
    return {
      alignContent: style.alignContent,
      overflowY: style.overflowY,
      scrollTop: results.scrollTop,
      scrollHeight: results.scrollHeight,
      clientHeight: results.clientHeight,
      headerTop: headerRect.top,
      headerBottom: headerRect.bottom,
      viewportTop: resultsRect.top,
      viewportBottom: resultsRect.bottom,
      documentOverflowX: document.documentElement.scrollWidth - window.innerWidth,
    };
  });

  expect(headerAtTop, `${viewport.name} result layout metrics`).not.toBeNull();
  expect(headerAtTop?.alignContent, `${viewport.name} safe grid alignment`).toContain("safe");
  expect(headerAtTop?.overflowY, `${viewport.name} vertical overflow handling`).toBe("auto");
  expect(headerAtTop?.scrollTop, `${viewport.name} starts at top`).toBe(0);
  expect(headerAtTop?.headerTop, `${viewport.name} header top reachable`).toBeGreaterThanOrEqual(
    headerAtTop?.viewportTop ?? 0,
  );
  expect(headerAtTop?.headerTop, `${viewport.name} header starts within viewport`).toBeLessThan(
    headerAtTop?.viewportBottom ?? viewport.height,
  );
  expect(headerAtTop?.documentOverflowX, `${viewport.name} no horizontal overflow`).toBeLessThanOrEqual(1);

  await page.locator(".results-screen").evaluate((element) => {
    element.scrollTo({ top: element.scrollHeight, left: 0 });
  });
  await expect(page.getByRole("button", { name: "Retry now" }), `${viewport.name} retry action reachable`).toBeVisible();
}

test("slow race prep shows an animated loading gate before countdown", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "Single-browser race-gate timing contract");
  test.setTimeout(60_000);
  let delayedHeroAsset = false;
  await page.route("**/assets/3d/hero-bike-rider.glb", async (route) => {
    delayedHeroAsset = true;
    await new Promise((resolve) => setTimeout(resolve, 650));
    await route.continue();
  });
  await completeOnboarding(page);

  await page.getByRole("button", { name: "Ride", exact: true }).click();
  await page.getByRole("button", { name: /Practice/ }).click();

  const gate = page.locator(".race-start-gate");
  await expect(gate).toHaveAttribute("data-gate-mode", "loading", { timeout: 10_000 });
  await expect(gate).toHaveAccessibleName("Loading Canyon Kickoff race");
  await expect(gate.locator(".race-loading-track")).toBeVisible();
  await expect(gate.locator(".race-loading-track span")).toBeVisible();

  await expect(gate).toHaveAttribute("data-gate-mode", "countdown", { timeout: 10_000 });
  await expect(gate.locator(".race-loading-track")).toHaveCount(0);
  await expect(page.locator(".game-shell")).toHaveAttribute("data-race-gate-phase", "racing", { timeout: 10_000 });
  expect(delayedHeroAsset).toBe(true);
});

test("fresh load completes a keyboard race, saves onboarding, and retries", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name.startsWith("mobile") || testInfo.project.name.startsWith("tablet"), "Desktop keyboard journey");
  test.setTimeout(240_000);
  await completeOnboarding(page);

  const accessibility = await new AxeBuilder({ page }).analyze();
  expect(accessibility.violations).toEqual([]);

  await page.getByRole("button", { name: "Ride", exact: true }).click();
  await page.getByRole("button", { name: /Practice/ }).click();
  await expect(page.getByLabel("Live 3D race on Canyon Kickoff")).toBeVisible();
  await expect(page.locator(".timing-block > strong")).toHaveText("00:00.00");
  await expect(page.locator(".game-shell")).toHaveAttribute("data-race-gate-phase", "racing", { timeout: 15_000 });
  const raceOverlayStack = await page.evaluate(() => {
    const pause = document.createElement("section");
    const gate = document.createElement("section");
    pause.className = "pause-overlay";
    gate.className = "race-start-gate go-signal";
    document.body.append(pause, gate);
    const result = {
      pause: Number(getComputedStyle(pause).zIndex),
      gate: Number(getComputedStyle(gate).zIndex),
    };
    pause.remove();
    gate.remove();
    return result;
  });
  expect(raceOverlayStack.pause).toBeGreaterThan(raceOverlayStack.gate);
  const pauseButton = page.getByRole("button", { name: "Pause race" });
  await expect(pauseButton).toBeVisible();
  const desktopHudGeometry = await page.evaluate(() => {
    const box = (selector: string) => {
      const element = document.querySelector<HTMLElement>(selector);
      if (!element) return null;
      const rect = element.getBoundingClientRect();
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    };
    return {
      pause: box(".pause-button"),
      target: box(".target-hud"),
      timing: box(".timing-block"),
    };
  });
  expect(desktopHudGeometry.pause).not.toBeNull();
  expect(desktopHudGeometry.target).not.toBeNull();
  expect(desktopHudGeometry.timing).not.toBeNull();
  expect(desktopHudGeometry.pause?.width).toBeGreaterThanOrEqual(44);
  expect(desktopHudGeometry.pause?.height).toBeGreaterThanOrEqual(44);
  const rectanglesOverlap = (
    first: NonNullable<typeof desktopHudGeometry.pause>,
    second: NonNullable<typeof desktopHudGeometry.pause>,
  ) => first.x < second.x + second.width
    && first.x + first.width > second.x
    && first.y < second.y + second.height
    && first.y + first.height > second.y;
  expect(rectanglesOverlap(desktopHudGeometry.pause!, desktopHudGeometry.target!)).toBe(false);
  expect(rectanglesOverlap(desktopHudGeometry.pause!, desktopHudGeometry.timing!)).toBe(false);
  await expect.poll(() => page.locator(".timing-block > strong").evaluate((element) => getComputedStyle(element).fontVariantNumeric)).toContain("tabular-nums");
  await expect.poll(() => page.locator(".timing-block span b").evaluate((element) => getComputedStyle(element).fontVariantNumeric)).toContain("tabular-nums");
  await expect.poll(() => page.locator(".target-hud > strong").evaluate((element) => getComputedStyle(element).fontVariantNumeric)).toContain("tabular-nums");

  await finishFastKeyboardRace(page);
  await expect(page.getByText("Lap 1", { exact: true })).toBeVisible();
  await expect(page.getByText("Lap 2", { exact: true })).toBeVisible();
  await expectReachableResultsAtViewport(page, { name: "compact desktop", width: 1280, height: 600 });
  await expectReachableResultsAtViewport(page, { name: "phone landscape", width: 844, height: 390 });

  await page.setViewportSize({ width: 1280, height: 720 });
  await page.getByRole("button", { name: "Retry now" }).click();
  await expect(page.getByLabel("Live 3D race on Canyon Kickoff")).toBeVisible();
  await expect(page.locator(".game-shell")).toHaveAttribute(
    "data-race-gate-phase",
    "racing",
    { timeout: 15_000 },
  );
  await page.getByLabel("Live 3D race on Canyon Kickoff").press("Escape");
  await expect(page.getByRole("dialog", { name: "Race paused" })).toBeVisible();
  await page.getByRole("button", { name: "Restart now" }).click();
  await expect(page.getByLabel("Live 3D race on Canyon Kickoff")).toBeVisible();
  await expect(page.locator(".timing-block > strong")).toHaveText(/^00:00\./);

  await page.reload();
  await expect(page.getByRole("button", { name: "Ride", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Skip training" })).toHaveCount(0);
});

test("title screen matches the approved visual baseline", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name.startsWith("mobile") || testInfo.project.name.startsWith("tablet"), "Desktop keyboard journey");
  test.setTimeout(60_000);
  await completeOnboarding(page);

  const accessibility = await new AxeBuilder({ page }).analyze();
  expect(accessibility.violations).toEqual([]);
  await expect(page).toHaveScreenshot("title-screen.png", {
    animations: "disabled",
    maxDiffPixelRatio: 0.02,
  });
});

test("track builder places, validates, saves, reloads, and test-rides a local track", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name.startsWith("mobile") || testInfo.project.name.startsWith("tablet"), "Desktop editor journey");
  await completeOnboarding(page);
  await page.getByRole("button", { name: "Track Builder", exact: true }).click();
  await expect(page.getByLabel(/Interactive 3D track build camera/)).toBeVisible();
  await expect(page.getByText("3 modules", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Place selected module at route view" }).click();
  await expect(page.getByText("4 modules", { exact: true })).toBeVisible();
  await expect(page.getByText("1 / 50 actions", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.locator(".editor-status output")).toHaveText("Track saved locally.");
  await page.getByRole("button", { name: "Library", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Local tracks" })).toBeVisible();
  await expect(page.getByText("Cooling Canyon", { exact: true })).toBeVisible();
  await expect(page.getByText("Pine Rhythm", { exact: true })).toBeVisible();
  await expect(page.getByText("Skyline Workshop", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Close local track library" }).click();
  await page.getByRole("button", { name: "Test Ride", exact: true }).click();
  await expect(page.getByLabel("Live 3D race on Canyon Workshop")).toBeVisible();
});

test("phone and tablet layouts complete a race with labeled touch controls", async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.startsWith("mobile") && !testInfo.project.name.startsWith("tablet"), "Touch-device journey");
  test.setTimeout(300_000);
  await completeOnboarding(page);
  await page.getByRole("button", { name: "Ride", exact: true }).click();
  await page.getByRole("button", { name: /Practice/ }).click();

  await expect(page.getByRole("button", { name: "Move one lane left" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Move one lane right" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Pitch front wheel up" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Pitch front wheel down" })).toBeVisible();
  const ride = page.getByRole("button", { name: "Ride", exact: true });
  await expect(ride).toBeVisible();
  const turbo = page.getByRole("button", { name: "Turbo", exact: true });
  await expect(turbo).toBeVisible();
  const touchControls = page.getByLabel("Touch race controls");
  await expect(touchControls).toHaveAttribute("data-touch-icon-set", "rally-pictograms-v1");
  await expect(touchControls.locator("[data-touch-icon]")).toHaveCount(6);
  for (const control of ["lane-left", "lane-right", "pitch-up", "pitch-down", "ride", "turbo"]) {
    const button = touchControls.locator(`button[data-control="${control}"]`);
    await expect(button.locator(`[data-touch-icon="${control}"]`)).toHaveCount(1);
    await expect(button.locator("svg")).toHaveAttribute("focusable", "false");
  }
  await expect(ride).toHaveAttribute("data-control", "ride");
  await expect(turbo).toHaveAttribute("data-control", "turbo");
  await expect(ride.locator(".touch-control-label")).toHaveText("Ride");
  await expect(turbo.locator(".touch-control-label")).toHaveText("Turbo");
  await expect(page.getByRole("button", { name: "Pause race" })).toBeVisible();
  await finishFastTouchRace(page);
  await expect(page.getByText("Lap 1", { exact: true })).toBeVisible();
  await expect(page.getByText("Lap 2", { exact: true })).toBeVisible();
});

test("all five launch tracks load and complete two laps", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "Single-browser content completion gate");
  test.setTimeout(2_100_000);
  await completeOnboarding(page, false);

  for (const trackId of [
    "canyon-kickoff",
    "pine-run",
    "coastline-clash",
    "foundry-flight",
    "summit-showdown",
  ]) {
    await page.evaluate((id) => window.__RRR_QA__?.startTrack(id, "practice"), trackId);
    await expect(page.getByLabel(/Live 3D race on/)).toBeVisible();
    await page.keyboard.down("w");
    await page.keyboard.down("Space");
    await expect(
      page.getByRole("button", { name: "Retry now" }),
      `${trackId} should complete both production-distance laps`,
    ).toBeVisible({ timeout: 360_000 });
    await page.keyboard.up("w");
    await page.keyboard.up("Space");
    await expect(page.getByText("Lap 1", { exact: true })).toBeVisible();
    await expect(page.getByText("Lap 2", { exact: true })).toBeVisible();
  }
});

test("production shell reloads from its service-worker cache while offline", async ({ page, context }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "Single-browser offline gate");
  test.setTimeout(90_000);
  await completeOnboarding(page);
  await page.waitForFunction(
    () => document.documentElement.dataset.offlineReady === "true",
    undefined,
    { timeout: 20_000 },
  );
  const cacheSnapshot = await page.evaluate(async () => {
    const names = await caches.keys();
    const entries = await Promise.all(names.map(async (name) => ({
      name,
      urls: (await (await caches.open(name)).keys()).map((request) => request.url),
    })));
    return {
      controller: navigator.serviceWorker.controller?.scriptURL,
      offlineCache: document.documentElement.dataset.offlineCache,
      entries,
    };
  });
  const currentCache = cacheSnapshot.entries.find((entry) => entry.name === "rivet-ridge-rally-shell-v35");
  expect(cacheSnapshot.controller).toContain("/sw.js");
  expect(cacheSnapshot.offlineCache).toBe("rivet-ridge-rally-shell-v35");
  expect(currentCache).toBeDefined();
  const cachedUrls = currentCache?.urls ?? [];
  expect(cachedUrls.some((url) => /\/assets\/index-[^/]+\.js$/.test(url))).toBe(true);
  expect(cachedUrls.some((url) => /\/assets\/index-[^/]+\.css$/.test(url))).toBe(true);
  expect(cachedUrls.some((url) => /\/assets\/GameView-[^/]+\.js$/.test(url))).toBe(true);
  expect(cachedUrls.some((url) => /\/assets\/TrackEditorScreen-[^/]+\.js$/.test(url))).toBe(true);
  expect(cachedUrls.some((url) => url.endsWith("/assets/3d/hero-bike-rider.glb"))).toBe(true);
  expect(cachedUrls.some((url) => url.endsWith("/assets/rivals/rival-pack.glb"))).toBe(true);
  expect(cachedUrls.some((url) => url.endsWith("/assets/canyon/canyon-kit.glb"))).toBe(true);
  expect(cachedUrls.some((url) => url.endsWith("/assets/art/canyon-festival-panorama.png"))).toBe(true);
  await context.setOffline(true);
  await expect(page.getByRole("status")).toContainText("cached races remain available");
  await page.reload();
  await expect(page.getByRole("button", { name: "Ride", exact: true })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole("status")).toContainText("cached races remain available");
  // Synthetic scope: this proves immediate page-side invalidation followed by
  // preparation under the current controller. Real worker install/activation
  // and generation-transition coverage remains a separate gate.
  const invalidatedSynchronously = await page.evaluate(() => {
    navigator.serviceWorker.dispatchEvent(new Event("controllerchange"));
    return document.documentElement.dataset.offlineCache === undefined
      && document.documentElement.dataset.offlineReady === undefined;
  });
  expect(invalidatedSynchronously).toBe(true);
  await page.waitForFunction(
    () => document.documentElement.dataset.offlineReady === "true",
    undefined,
    { timeout: 20_000 },
  );
  await expect(page.getByRole("status")).toContainText("cached races remain available");
  // Deferred coverage: a reconnect signal retries preparation whenever the
  // current generation is not marked ready, even if an earlier attempt ran.
  await page.evaluate(() => {
    delete document.documentElement.dataset.offlineCache;
    delete document.documentElement.dataset.offlineReady;
    window.dispatchEvent(new Event("rivet-ridge-rally:offline-readiness-change"));
    window.dispatchEvent(new Event("online"));
  });
  await page.waitForFunction(
    () => document.documentElement.dataset.offlineReady === "true",
    undefined,
    { timeout: 20_000 },
  );
  await expect(page.getByRole("status")).toContainText("cached races remain available");
  await page.getByRole("button", { name: "Ride", exact: true }).click();
  await page.getByRole("button", { name: /Practice/ }).click();
  const offlineCanvas = page.locator(".game-canvas");
  await expect(offlineCanvas).toBeVisible({ timeout: 15_000 });
  await expect(offlineCanvas).toHaveAttribute("data-bike-asset", "ready", { timeout: 15_000 });
  await expect(offlineCanvas).toHaveAttribute("data-canyon-kit-asset", "ready", { timeout: 15_000 });
  await expect(offlineCanvas).toHaveAttribute("data-environment-asset", "ready", { timeout: 20_000 });
  await expect(page.locator(".game-shell")).toHaveAttribute("data-race-gate-phase", "racing", { timeout: 20_000 });
  await expect(page.getByText("Compressed bike unavailable — safe built-in model active")).toHaveCount(0);
  await context.setOffline(false);
});

import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

async function completeOnboarding(page: import("@playwright/test").Page, fastRace = true): Promise<void> {
  await page.goto(fastRace ? "/?qa-fast-race=1" : "/");
  const skip = page.getByRole("button", { name: "Skip training" });
  await expect(skip).toBeVisible({ timeout: 15_000 });
  await skip.click();
  await expect(page.getByRole("button", { name: "Ride", exact: true })).toBeVisible();
}

test("fresh load completes a keyboard race, saves onboarding, and retries", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name.startsWith("mobile") || testInfo.project.name.startsWith("tablet"), "Desktop keyboard journey");
  test.setTimeout(60_000);
  await completeOnboarding(page);

  const accessibility = await new AxeBuilder({ page }).analyze();
  expect(accessibility.violations).toEqual([]);
  await expect(page).toHaveScreenshot("title-screen.png", {
    animations: "disabled",
    maxDiffPixelRatio: 0.02,
  });

  await page.getByRole("button", { name: "Ride", exact: true }).click();
  await page.getByRole("button", { name: /Practice/ }).click();
  await expect(page.getByLabel("Live 3D race on Canyon Kickoff")).toBeVisible();

  await page.keyboard.down("w");
  await expect(page.getByRole("button", { name: "Retry now" })).toBeVisible({ timeout: 30_000 });
  await page.keyboard.up("w");
  await expect(page.getByText("Lap 1", { exact: true })).toBeVisible();
  await expect(page.getByText("Lap 2", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Retry now" }).click();
  await expect(page.getByLabel("Live 3D race on Canyon Kickoff")).toBeVisible();
  await page.getByLabel("Live 3D race on Canyon Kickoff").press("Escape");
  await expect(page.getByRole("dialog", { name: "Race paused" })).toBeVisible();
  await page.getByRole("button", { name: "Restart now" }).click();
  await expect(page.getByLabel("Live 3D race on Canyon Kickoff")).toBeVisible();
  await expect(page.locator(".timing-block > strong")).toHaveText(/^00:00\./);

  await page.reload();
  await expect(page.getByRole("button", { name: "Ride", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Skip training" })).toHaveCount(0);
});

test("track builder places, validates, saves, reloads, and test-rides a local track", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name.startsWith("mobile") || testInfo.project.name.startsWith("tablet"), "Desktop editor journey");
  await completeOnboarding(page);
  await page.getByRole("button", { name: "Track Builder", exact: true }).click();
  await expect(page.getByLabel(/Interactive 3D track build camera/)).toBeVisible();
  await expect(page.getByText("3 modules", { exact: true })).toBeVisible();

  await page.getByLabel(/Interactive 3D track build camera/).click({ position: { x: 430, y: 330 } });
  await expect(page.getByText("4 modules", { exact: true })).toBeVisible();
  await expect(page.getByText("1 / 50 actions", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("Track saved locally.");
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
  test.setTimeout(60_000);
  await completeOnboarding(page);
  await page.getByRole("button", { name: "Ride", exact: true }).click();
  await page.getByRole("button", { name: /Practice/ }).click();

  await expect(page.getByRole("button", { name: "Move one lane left" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Move one lane right" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Pitch front wheel up" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Pitch front wheel down" })).toBeVisible();
  const ride = page.getByRole("button", { name: "Ride", exact: true });
  await expect(ride).toBeVisible();
  await expect(page.getByRole("button", { name: "Turbo", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Pause race" })).toBeVisible();
  await ride.dispatchEvent("pointerdown", { pointerId: 11, pointerType: "touch", isPrimary: true });
  await expect(page.getByRole("button", { name: "Retry now" })).toBeVisible({ timeout: 30_000 });
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
    return { controller: navigator.serviceWorker.controller?.scriptURL, entries };
  });
  const cachedUrls = cacheSnapshot.entries.flatMap((entry) => entry.urls);
  expect(cacheSnapshot.controller).toContain("/sw.js");
  expect(cachedUrls.some((url) => /\/assets\/index-[^/]+\.js$/.test(url))).toBe(true);
  expect(cachedUrls.some((url) => /\/assets\/index-[^/]+\.css$/.test(url))).toBe(true);
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole("button", { name: "Ride", exact: true })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole("status")).toContainText("Offline mode");
  await page.getByRole("button", { name: "Ride", exact: true }).click();
  await page.getByRole("button", { name: /Practice/ }).click();
  await expect(page.getByLabel("Live 3D race on Canyon Kickoff")).toBeVisible();
  await page.waitForTimeout(2_000);
  await expect(page.getByText("Compressed bike unavailable — safe built-in model active")).toHaveCount(0);
  await context.setOffline(false);
});

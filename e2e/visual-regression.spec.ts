import { expect, test } from "@playwright/test";

function collectErrors(page: import("@playwright/test").Page): string[] {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  return errors;
}

async function waitForStableFonts(page: import("@playwright/test").Page): Promise<void> {
  await page.evaluate(async () => {
    await Promise.all([
      document.fonts.load('700 16px "Ridge Display"'),
      document.fonts.load('900 16px "Ridge Display"'),
    ]);
    if (
      !document.fonts.check('700 16px "Ridge Display"')
      || !document.fonts.check('900 16px "Ridge Display"')
    ) throw new Error("Bundled Ridge Display font did not load.");
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  });
}

async function openFrozenRace(
  page: import("@playwright/test").Page,
  options: {
    expectedFestivalPocketCount?: string;
    expectedFestivalTierCount?: string;
    expectedSafetyBlockCount?: string;
    highContrast?: boolean;
    initialPath?: string;
    uiScale?: string;
  } = {},
): Promise<import("@playwright/test").Locator> {
  await page.goto(options.initialPath ?? "/?qa-fast-race=1&qa-visual-freeze=1");
  await waitForStableFonts(page);
  await page.getByRole("button", { name: "Skip training" }).click();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  if (options.highContrast) await page.getByRole("checkbox", { name: /^High contrast/ }).check();
  if (options.uiScale) await page.getByRole("slider", { name: /^UI scale/ }).fill(options.uiScale);
  await page.getByRole("button", { name: "play", exact: true }).click();
  await page.getByLabel("Quality").selectOption("high");
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await page.getByRole("button", { name: "Ride", exact: true }).click();
  await page.getByRole("button", { name: /Practice/ }).click();
  const raceCanvas = page.getByLabel("Live 3D race on Canyon Kickoff");
  await expect(raceCanvas).toBeVisible();
  await expect(raceCanvas).toHaveAttribute("data-visual-state", "frozen");
  await expect(raceCanvas).toHaveAttribute("data-bike-asset", "ready", { timeout: 15_000 });
  await expect(raceCanvas).toHaveAttribute("data-cooling-gate-venue-pocket-count", "4");
  await expect(raceCanvas).toHaveAttribute("data-cooling-gate-venue-style", "bilateral");
  await expect(raceCanvas).toHaveAttribute("data-cooling-gate-watchtower-count", "4");
  await expect(raceCanvas).toHaveAttribute(
    "data-cooling-gate-watchtower-style",
    "staffed-elevated",
  );
  await expect(raceCanvas).toHaveAttribute(
    "data-cooling-gate-watchtower-spectator-count",
    "16",
  );
  await expect(raceCanvas).toHaveAttribute("data-festival-pocket-style", "tiered-canyon");
  await expect(raceCanvas).toHaveAttribute(
    "data-festival-pocket-count",
    options.expectedFestivalPocketCount ?? "8",
  );
  await expect(raceCanvas).toHaveAttribute(
    "data-festival-pocket-tier-count",
    options.expectedFestivalTierCount ?? "32",
  );
  await expect(raceCanvas).toHaveAttribute("data-festival-pocket-tier-rows", "4");
  await expect(raceCanvas).toHaveAttribute("data-course-edge-safety-style", "continuous-canyon");
  await expect(raceCanvas).toHaveAttribute("data-course-edge-safety-batch-count", "1");
  await expect(raceCanvas).toHaveAttribute(
    "data-course-edge-safety-block-count",
    options.expectedSafetyBlockCount ?? "144",
  );
  await expect(raceCanvas).toHaveAttribute("data-start-grid-style", "numbered-four-lane");
  await expect(raceCanvas).toHaveAttribute("data-start-grid-stencil-count", "4");
  await expect(raceCanvas).toHaveAttribute("data-start-grid-batch-count", "2");
  await expect(raceCanvas).toHaveAttribute("data-canyon-cactus-style", "branched-saguaro");
  await expect(raceCanvas).toHaveAttribute("data-canyon-cactus-batch-count", "1");
  await expect(raceCanvas).toHaveAttribute("data-canyon-cactus-instance-count", "24");
  await expect(page.locator(".game-shell")).toHaveAttribute(
    "data-race-gate-phase",
    "racing",
    { timeout: 15_000 },
  );
  await waitForStableFonts(page);
  return raceCanvas;
}

test("desktop race retains its accepted production composition", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "Single-renderer visual baseline");
  const errors = collectErrors(page);
  await openFrozenRace(page);
  await expect(page).toHaveScreenshot("race-screen.png", {
    animations: "disabled",
    maxDiffPixelRatio: 0.02,
  });
  expect(errors).toEqual([]);
});

test("production Canyon bend retains a readable shared course presentation", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "Single-renderer curved-course qualification");
  const errors = collectErrors(page);
  const raceCanvas = await openFrozenRace(page, {
    expectedFestivalPocketCount: "26",
    expectedFestivalTierCount: "104",
    expectedSafetyBlockCount: "1320",
    initialPath: "/?qa-visual-freeze=1&qa-visual-distance=500",
  });
  await expect(raceCanvas).toHaveAttribute("data-visual-distance", "500");
  await expect(raceCanvas).toHaveAttribute("data-track-guide-count", "5");
  await expect(page).toHaveScreenshot("race-curved-course-canyon.png", {
    animations: "disabled",
    maxDiffPixelRatio: 0.02,
  });
  expect(errors).toEqual([]);
});

test("editor retains its accepted production composition", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "Single-renderer visual baseline");
  const errors = collectErrors(page);
  await page.goto("/");
  await page.getByRole("button", { name: "Skip training" }).click();
  await page.getByRole("button", { name: "Track Builder", exact: true }).click();
  await expect(page.getByLabel(/Interactive 3D track build camera/)).toBeVisible();
  await waitForStableFonts(page);
  await expect(page).toHaveScreenshot("editor-screen.png", {
    animations: "disabled",
    maxDiffPixelRatio: 0.02,
  });
  expect(errors).toEqual([]);
});

test("portrait race retains its accepted touch composition", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile-chrome", "Single mobile visual baseline");
  const errors = collectErrors(page);
  await openFrozenRace(page);
  await expect(page.getByLabel("Touch race controls")).toBeVisible();
  await expect(page).toHaveScreenshot("race-mobile.png", {
    animations: "disabled",
    maxDiffPixelRatio: 0.02,
  });
  expect(errors).toEqual([]);
});

test("high-contrast scaled HUD retains readable hierarchy", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "Single-renderer accessibility baseline");
  const errors = collectErrors(page);
  await openFrozenRace(page, { highContrast: true, uiScale: "1.2" });
  await expect(page).toHaveScreenshot("race-high-contrast.png", {
    animations: "disabled",
    maxDiffPixelRatio: 0.02,
  });
  expect(errors).toEqual([]);
});

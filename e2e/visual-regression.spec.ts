import {
  FROZEN_READINESS,
  frozenSceneContract,
} from "../scripts/lib/frozen-scene-inventory.mjs";
import { expect, test } from "@playwright/test";

test.beforeEach(({ browserName }, testInfo) => {
  testInfo.setTimeout(90_000);
  expect(
    testInfo.config.updateSnapshots,
    `Visual qualification in ${browserName} must never create or replace checked-in baselines.`,
  ).toBe("none");
});

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
  // Visual qualification must use the production-length route. The fast-race
  // hook compresses gameplay distances while authored Canyon decor deliberately
  // remains at production coordinates, so that hybrid is not a valid art frame.
  await page.goto(options.initialPath ?? "/?qa-visual-freeze=1");
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
  // The scene contract lives in scripts/lib/frozen-scene-inventory.mjs so this
  // gate and the capture script that produces the frames an owner signs cannot
  // drift apart. It used to be 41 assertions here against four waits there.
  for (const [attribute, value] of FROZEN_READINESS) {
    await expect(raceCanvas).toHaveAttribute(attribute, value, { timeout: 15_000 });
  }
  for (const [attribute, value] of frozenSceneContract({
    ...(options.expectedFestivalPocketCount === undefined
      ? {} : { festivalPocketCount: options.expectedFestivalPocketCount }),
    ...(options.expectedFestivalTierCount === undefined
      ? {} : { festivalPocketTierCount: options.expectedFestivalTierCount }),
    ...(options.expectedSafetyBlockCount === undefined
      ? {} : { courseEdgeSafetyBlockCount: options.expectedSafetyBlockCount }),
  })) {
    await expect(raceCanvas).toHaveAttribute(attribute, value);
  }
  await expect(page.locator(".game-shell")).toHaveAttribute(
    "data-race-gate-phase",
    "racing",
    { timeout: 15_000 },
  );
  await waitForStableFonts(page);
  return raceCanvas;
}

test("desktop race matches its checked-in visual baseline", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "Single-renderer visual baseline");
  const errors = collectErrors(page);
  await openFrozenRace(page);
  await expect(page).toHaveScreenshot("race-screen.png", {
    animations: "disabled",
    maxDiffPixelRatio: 0.02,
    timeout: 20_000,
  });
  expect(errors).toEqual([]);
});

test("production Canyon bend matches its checked-in visual baseline", async ({ page }, testInfo) => {
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
    timeout: 20_000,
  });
  expect(errors).toEqual([]);
});

test("editor matches its checked-in visual baseline", async ({ page }, testInfo) => {
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
    timeout: 20_000,
  });
  expect(errors).toEqual([]);
});

test("portrait race matches its checked-in visual baseline", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile-chrome", "Single mobile visual baseline");
  const errors = collectErrors(page);
  await openFrozenRace(page);
  await expect(page.getByLabel("Touch race controls")).toBeVisible();
  await expect(page).toHaveScreenshot("race-mobile.png", {
    animations: "disabled",
    maxDiffPixelRatio: 0.02,
    timeout: 20_000,
  });
  expect(errors).toEqual([]);
});

test("high-contrast scaled HUD matches its checked-in visual baseline", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "Single-renderer accessibility baseline");
  const errors = collectErrors(page);
  await openFrozenRace(page, { highContrast: true, uiScale: "1.2" });
  await expect(page).toHaveScreenshot("race-high-contrast.png", {
    animations: "disabled",
    maxDiffPixelRatio: 0.02,
    timeout: 20_000,
  });
  expect(errors).toEqual([]);
});

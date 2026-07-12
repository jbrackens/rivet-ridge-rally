import { expect, test } from "@playwright/test";

test("race and editor retain their accepted production composition", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "Single-renderer visual baseline");
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));

  await page.goto("/");
  await page.getByRole("button", { name: "Skip training" }).click();
  await page.getByRole("button", { name: "Ride", exact: true }).click();
  await page.getByRole("button", { name: /Practice/ }).click();
  const raceCanvas = page.getByLabel("Live 3D race on Canyon Kickoff");
  await expect(raceCanvas).toBeVisible();
  await page.waitForTimeout(2_000);
  await raceCanvas.press("Escape");
  await expect(page.getByRole("dialog", { name: "Race paused" })).toBeVisible();
  const pauseMask = await page.addStyleTag({ content: ".pause-overlay { display: none !important; }" });
  await expect(page).toHaveScreenshot("race-screen.png", {
    animations: "disabled",
    maxDiffPixelRatio: 0.02,
  });
  await pauseMask.evaluate((element) => element.remove());
  await page.getByRole("button", { name: "Festival menu" }).click();

  await page.getByRole("button", { name: "Track Builder", exact: true }).click();
  await expect(page.getByLabel(/Interactive 3D track build camera/)).toBeVisible();
  await page.waitForTimeout(500);
  await expect(page).toHaveScreenshot("editor-screen.png", {
    animations: "disabled",
    maxDiffPixelRatio: 0.02,
  });
  expect(errors).toEqual([]);
});

test("portrait race retains its accepted touch composition", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile-chrome", "Single mobile visual baseline");
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));

  await page.goto("/");
  await page.getByRole("button", { name: "Skip training" }).click();
  await page.getByRole("button", { name: "Ride", exact: true }).click();
  await page.getByRole("button", { name: /Practice/ }).click();
  await expect(page.getByLabel("Live 3D race on Canyon Kickoff")).toBeVisible();
  await expect(page.getByLabel("Touch race controls")).toBeVisible();
  await page.waitForTimeout(2_000);
  await expect(page).toHaveScreenshot("race-mobile.png", {
    animations: "disabled",
    maxDiffPixelRatio: 0.02,
  });
  expect(errors).toEqual([]);
});

test("high-contrast scaled HUD retains readable hierarchy", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "Single-renderer accessibility baseline");
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));

  await page.goto("/?qa-fast-race=1");
  await page.getByRole("button", { name: "Skip training" }).click();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("checkbox", { name: /^High contrast/ }).check();
  await page.getByRole("slider", { name: /^UI scale/ }).fill("1.2");
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await page.getByRole("button", { name: "Ride", exact: true }).click();
  await page.getByRole("button", { name: /Practice/ }).click();
  await expect(page.getByLabel("Live 3D race on Canyon Kickoff")).toBeVisible();
  await page.waitForTimeout(2_000);
  await expect(page).toHaveScreenshot("race-high-contrast.png", {
    animations: "disabled",
    maxDiffPixelRatio: 0.02,
  });
  expect(errors).toEqual([]);
});

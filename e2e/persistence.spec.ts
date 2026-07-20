import { chromium, expect, test, type BrowserContext, type Page } from "@playwright/test";

const BASE_URL = `http://127.0.0.1:${process.env.RRR_PLAYWRIGHT_PORT ?? "4173"}`;

async function openPersistentProfile(userDataDir: string): Promise<BrowserContext> {
  return chromium.launchPersistentContext(userDataDir, {
    args: ["--mute-audio"],
    baseURL: BASE_URL,
    headless: true,
    viewport: { width: 1280, height: 720 },
  });
}

async function finishFastKeyboardRace(page: Page): Promise<void> {
  const retryButton = page.getByRole("button", { name: "Retry now" });
  await expect(page.locator(".game-shell")).toHaveAttribute(
    "data-race-gate-phase",
    "racing",
    { timeout: 30_000 },
  );
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

test("campaign progress, settings, and a custom track survive a browser restart", async ({ browserName }, testInfo) => {
  test.skip(browserName !== "chromium" || testInfo.project.name !== "chromium", "Persistent Chromium profile gate");
  test.setTimeout(240_000);
  const profilePath = testInfo.outputPath("rider-profile");

  const firstContext = await openPersistentProfile(profilePath);
  const firstPage = firstContext.pages()[0] ?? await firstContext.newPage();
  await firstPage.goto("/?qa-fast-race=1");
  await firstPage.getByRole("button", { name: "Skip training" }).click();

  await firstPage.getByRole("button", { name: "Settings" }).click();
  await firstPage.getByLabel("High contrast").check();
  await firstPage.getByRole("button", { name: "Done" }).click();

  await firstPage.getByRole("button", { name: "Ride", exact: true }).click();
  await firstPage.getByRole("button", { name: /^01 Solo Challenge/ }).click();
  await finishFastKeyboardRace(firstPage);
  await firstPage.getByRole("button", { name: "Festival menu" }).click();

  await firstPage.getByRole("button", { name: "Track Builder", exact: true }).click();
  await firstPage.getByRole("button", { name: "Save", exact: true }).click();
  await expect(firstPage.locator(".editor-status output")).toHaveText("Track saved locally.");
  await firstContext.close();

  const secondContext = await openPersistentProfile(profilePath);
  const secondPage = secondContext.pages()[0] ?? await secondContext.newPage();
  await secondPage.goto("/");
  await expect(secondPage.getByRole("button", { name: "Ride", exact: true })).toBeVisible();
  await expect(secondPage.getByRole("button", { name: "Skip training" })).toHaveCount(0);
  await expect(secondPage.locator("html")).toHaveAttribute("data-high-contrast", "true");

  await secondPage.getByRole("button", { name: "Ride", exact: true }).click();
  await expect(secondPage.getByRole("button", { name: /^02 Rival Main Race/ })).toBeEnabled();
  await expect(secondPage.getByText(/Solo best · (?!No run)/)).toBeVisible();
  await secondPage.getByRole("button", { name: "Back", exact: true }).click();

  await secondPage.getByRole("button", { name: "Track Builder", exact: true }).click();
  await secondPage.getByRole("button", { name: "Library", exact: true }).click();
  await expect(secondPage.getByText("Canyon Workshop", { exact: true })).toBeVisible();
  await secondContext.close();
});

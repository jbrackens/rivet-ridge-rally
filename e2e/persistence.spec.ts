import { chromium, expect, test, type BrowserContext } from "@playwright/test";

const BASE_URL = "http://127.0.0.1:4173";

async function openPersistentProfile(userDataDir: string): Promise<BrowserContext> {
  return chromium.launchPersistentContext(userDataDir, {
    baseURL: BASE_URL,
    headless: true,
    viewport: { width: 1280, height: 720 },
  });
}

test("campaign progress, settings, and a custom track survive a browser restart", async ({ browserName }, testInfo) => {
  test.skip(browserName !== "chromium" || testInfo.project.name !== "chromium", "Persistent Chromium profile gate");
  test.setTimeout(90_000);
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
  await firstPage.keyboard.down("w");
  await expect(firstPage.getByRole("button", { name: "Retry now" })).toBeVisible({ timeout: 30_000 });
  await firstPage.keyboard.up("w");
  await firstPage.getByRole("button", { name: "Festival menu" }).click();

  await firstPage.getByRole("button", { name: "Track Builder", exact: true }).click();
  await firstPage.getByRole("button", { name: "Save", exact: true }).click();
  await expect(firstPage.getByRole("status")).toHaveText("Track saved locally.");
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

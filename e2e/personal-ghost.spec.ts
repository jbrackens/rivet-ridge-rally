import { expect, test, type Page } from "@playwright/test";

/**
 * The ghost is the replay log folded back into a rider: a finished run is
 * stored, and the next run on the same course replays it alongside the player
 * with a live split delta.
 *
 * This journey is the only place the whole chain is exercised end to end —
 * record, store, retrieve, decode, place, compare. The unit suite covers the
 * fold and the load in isolation; neither can prove the engine actually
 * retrieves and draws one.
 */

async function onboard(page: Page): Promise<void> {
  await page.goto("/?qa-fast-race=1");
  const skip = page.getByRole("button", { name: "Skip training" });
  await expect(skip).toBeVisible({ timeout: 30_000 });
  await skip.click();
  await expect(page.getByRole("button", { name: "Ride", exact: true })).toBeVisible();
}

async function startTrack(page: Page, trackId: string, raceMode: string): Promise<void> {
  await page.evaluate(
    ({ nextTrackId, nextRaceMode }) => {
      if (!window.__RRR_QA__) throw new Error("The ghost journey requires a VITE_QA_MODE=1 build.");
      window.__RRR_QA__.startTrack(nextTrackId, nextRaceMode);
    },
    { nextTrackId: trackId, nextRaceMode: raceMode },
  );
  await expect(page.locator("canvas.game-canvas")).toBeVisible({ timeout: 30_000 });
}

async function rideUntilResults(page: Page): Promise<void> {
  await page.keyboard.down("w");
  await page.keyboard.down("Space");
  const retry = page.getByRole("button", { name: "Retry now" });
  try {
    for (let cycle = 0; cycle < 55; cycle += 1) {
      await page.keyboard.down("Shift");
      await page.waitForTimeout(520);
      await page.keyboard.up("Shift");
      if (await retry.isVisible()) break;
      await page.waitForTimeout(620);
      if (await retry.isVisible()) break;
    }
  } finally {
    await page.keyboard.up("w");
    await page.keyboard.up("Space");
    await page.keyboard.up("Shift");
  }
  await expect(retry).toBeVisible({ timeout: 20_000 });
}

test.beforeEach(async ({ browserName }, testInfo) => {
  test.skip(
    browserName !== "chromium" || testInfo.project.name !== "chromium",
    "The ghost journey records a full race and runs once in Chromium",
  );
});

test.describe("personal ghost", () => {
  // Each case rides at least one production-length race to completion, and the
  // first rides two back to back. The suite-wide 120 s budget is written for
  // single-journey specs and is simply the wrong scale here.
  test.describe.configure({ timeout: 300_000 });

  test("a finished run becomes the ghost of the next run on the same course", async ({ page }) => {
    await onboard(page);

    const canvas = page.locator("canvas.game-canvas");

    // First run on a course with nothing stored: the engine must resolve the
    // course, find no run, and race anyway.
    await startTrack(page, "canyon-kickoff", "practice");
    await expect(canvas).toHaveAttribute("data-ghost", "none", { timeout: 30_000 });
    await expect(page.locator(".ghost-delta")).toHaveCount(0);
    await rideUntilResults(page);

    // Second run on the same course now has a stored best to replay.
    await startTrack(page, "canyon-kickoff", "practice");
    await expect(canvas).toHaveAttribute("data-ghost", "ready", { timeout: 30_000 });

    const finishMs = await canvas.getAttribute("data-ghost-finish-ms");
    expect(Number(finishMs)).toBeGreaterThan(0);

    // The delta appears and is signed once the race is actually running.
    const delta = page.locator(".ghost-delta");
    await expect(delta).toBeVisible();
    await page.keyboard.down("w");
    await page.waitForTimeout(3_000);
    await page.keyboard.up("w");
    await expect(delta).toHaveAttribute("data-ghost-delta", /ahead|behind|none/);
    expect((await delta.textContent())?.trim()).toMatch(/Ghost\s*[+-]\d+\.\d{2}|Ghost\s*--\.--/);
  });

  test("a ghost recorded on one course never appears on another", async ({ page }) => {
    await onboard(page);
    const canvas = page.locator("canvas.game-canvas");

    await startTrack(page, "canyon-kickoff", "practice");
    await rideUntilResults(page);

    // Practice is unlocked on every launch track, so a different course must
    // still report no ghost even though one is now stored.
    await startTrack(page, "pine-run", "practice");
    await expect(canvas).toHaveAttribute("data-ghost", "none", { timeout: 30_000 });
  });
});

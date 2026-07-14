import { expect, test } from "@playwright/test";

async function onboard(page: import("@playwright/test").Page): Promise<void> {
  await page.goto("/?qa-fast-race=1");
  await page.getByRole("button", { name: "Skip training" }).click();
}

async function unlockCampaign(page: import("@playwright/test").Page): Promise<void> {
  await page.evaluate(() => {
    if (!window.__RRR_QA__) throw new Error("Campaign qualification requires a VITE_QA_MODE=1 build.");
    window.__RRR_QA__.unlockCampaign();
  });
}

function displayedTimeMs(value: string): number {
  const [minutes = "0", remainder = "0"] = value.split(":");
  const [seconds = "0", hundredths = "0"] = remainder.split(".");
  return Number(minutes) * 60_000 + Number(seconds) * 1_000 + Number(hundredths) * 10;
}

const LAUNCH_TRACKS = [
  { id: "canyon-kickoff", name: "Canyon Kickoff" },
  { id: "pine-run", name: "Pine Run" },
  { id: "coastline-clash", name: "Coastline Clash" },
  { id: "foundry-flight", name: "Foundry Flight" },
  { id: "summit-showdown", name: "Summit Showdown" },
] as const;

type LaunchMode = "practice" | "solo" | "rival" | "mastery";

async function startTrack(
  page: import("@playwright/test").Page,
  trackId: string,
  raceMode: LaunchMode,
): Promise<void> {
  await page.evaluate(
    ({ nextTrackId, nextRaceMode }) => {
      if (!window.__RRR_QA__) throw new Error("Campaign qualification requires a VITE_QA_MODE=1 build.");
      window.__RRR_QA__.startTrack(nextTrackId, nextRaceMode);
    },
    { nextTrackId: trackId, nextRaceMode: raceMode },
  );
}

async function attachRaceHealth(
  page: import("@playwright/test").Page,
  testInfo: import("@playwright/test").TestInfo,
): Promise<void> {
  const snapshot = await page.evaluate(() => ({
    capturedAt: new Date().toISOString(),
    visibilityState: document.visibilityState,
    title: document.title,
    url: window.location.href,
    qaApiPresent: Boolean(window.__RRR_QA__),
    lifecycle: window.__RRR_QA__?.lifecycle() ?? null,
    raceClock: document.querySelector(".timer-block strong")?.textContent ?? null,
    pauseDialogVisible: Boolean(document.querySelector('.pause-overlay[role="dialog"]')),
    resultsVisible: Boolean(document.querySelector(".results-screen")),
  }));
  await testInfo.attach("race-health.json", {
    body: JSON.stringify(snapshot, null, 2),
    contentType: "application/json",
  });
}

async function rideUntilResults(
  page: import("@playwright/test").Page,
  chooseSummitSafeLane = false,
): Promise<void> {
  await page.keyboard.down("w");
  await page.keyboard.down("Space");
  for (let cycle = 0; cycle < 14; cycle += 1) {
    if (chooseSummitSafeLane && cycle === 2) await page.keyboard.press("ArrowRight");
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

test.beforeEach(async ({ browserName }, testInfo) => {
  test.skip(browserName !== "chromium" || testInfo.project.name !== "chromium", "Campaign mode matrix runs once in Chromium");
});

const modesByTrack = (trackId: string): readonly LaunchMode[] => trackId === "summit-showdown"
  ? ["practice", "solo", "rival", "mastery"]
  : ["practice", "solo", "rival"];

test.describe("launch track and mode matrix", () => {
  for (const track of LAUNCH_TRACKS) {
    for (const mode of modesByTrack(track.id)) {
      test(`${track.name} completes ${mode}`, async ({ page }, testInfo) => {
        test.setTimeout(90_000);
        await onboard(page);
        await unlockCampaign(page);

        try {
          await startTrack(page, track.id, mode);
          await expect(page.getByLabel(`Live 3D race on ${track.name}`)).toBeVisible();
          const accessibleMode = mode === "practice" ? "Practice" : mode === "solo" ? "Solo" : mode;
          await expect(page.getByRole("heading", { name: `${track.name} ${accessibleMode} race` })).toBeVisible();

          if (mode === "practice") {
            await expect(page.locator(".position-block > strong")).toHaveText("Practice");
            await expect(page.locator(".target-hud > strong")).toHaveText("Free ride");
          } else if (mode === "solo") {
            await expect(page.locator(".position-block > strong")).toHaveText("Solo");
            await expect(page.locator(".target-hud small")).toContainText("Saved best");
          } else {
            await expect(page.locator(".position-block > span")).toHaveText("Position");
            await expect(page.locator(".position-block > strong")).toHaveText(/[1-6] \/ 6/);
          }

          await rideUntilResults(page, track.id === "summit-showdown");
          await expect(page.getByText("Lap 1", { exact: true })).toBeVisible();
          await expect(page.getByText("Lap 2", { exact: true })).toBeVisible();
          await expect(page.getByText("Crashes", { exact: true })).toBeVisible();
          await expect(page.getByText("Overheats", { exact: true })).toBeVisible();

          if (mode === "practice") {
            await expect(page.locator(".result-grid > div").filter({ hasText: "Target gap" })).toContainText("Free ride");
          } else if (mode === "solo") {
            await expect(page.getByText("Saved best before run", { exact: true })).toBeVisible();
            await expect(page.getByText("Best time", { exact: true })).toBeVisible();
          } else {
            const classification = page.getByRole("table", { name: "Official 6-rider classification" });
            await expect(classification.locator("tbody tr")).toHaveCount(6);
            if (mode === "mastery") {
              await expect(page.locator(".results-screen header > p")).toContainText("Summit Mastery");
            }
          }
        } catch (error) {
          await attachRaceHealth(page, testInfo);
          throw error;
        }
      });
    }
  }
});

test("Solo qualification unlocks Rival and Rival completes with a six-rider field", async ({ page }) => {
  test.setTimeout(60_000);
  await onboard(page);
  await page.getByRole("button", { name: "Ride", exact: true }).click();
  await page.getByRole("button", { name: /^01 Solo Challenge/ }).click();
  await expect(page.locator(".target-hud small")).toHaveText("Saved best No time");
  await rideUntilResults(page);
  await expect(page.getByRole("heading", { name: "Target cleared" })).toBeVisible();
  await expect(page.getByText("Final time", { exact: true })).toBeVisible();
  await expect(page.getByText("Saved best before run", { exact: true })).toBeVisible();
  await expect(page.getByText("No prior time", { exact: true })).toBeVisible();
  await expect(page.getByText("Best time", { exact: true })).toBeVisible();
  await expect(page.getByText("New personal best", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "Change mode" }).click();

  const rival = page.getByRole("button", { name: /^02 Rival Main Race/ });
  await expect(rival).toBeEnabled();
  await rival.click();
  await expect(page.locator(".position-block > span")).toHaveText("Position");
  await expect(page.locator(".position-block > strong")).toHaveText(/[1-6] \/ 6/);
  await rideUntilResults(page);
  await expect(page.locator(".results-screen header > p")).toContainText(/Position \d \/ 6/);
  const classification = page.getByRole("table", { name: "Official 6-rider classification" });
  const rows = classification.locator("tbody tr");
  await expect(rows).toHaveCount(6);
  await expect(rows.locator(".classification-position")).toHaveText(["1", "2", "3", "4", "5", "6"]);
  const finishTimes = await rows.locator(".classification-time").allTextContents();
  expect(finishTimes).toHaveLength(6);
  expect(finishTimes.every((time) => /^\d{2}:\d{2}\.\d{2}$/.test(time))).toBe(true);
  const classifiedTimesMs = finishTimes.map(displayedTimeMs);
  expect(classifiedTimesMs).toEqual([...classifiedTimesMs].sort((left, right) => left - right));
  const playerRow = classification.locator('tbody tr[data-player="true"]');
  await expect(playerRow).toHaveCount(1);
  const playerPosition = await playerRow.locator(".classification-position").textContent();
  await expect(page.locator(".results-screen header > p")).toContainText(`Position ${playerPosition} / 6`);
  await expect(page.getByText("Crashes", { exact: true })).toBeVisible();
  await expect(page.getByText("Overheats", { exact: true })).toBeVisible();
});

test("Summit Mastery clears a tier, escalates its goal, and increases hot-start heat", async ({ page }) => {
  test.setTimeout(60_000);
  await onboard(page);
  await unlockCampaign(page);
  await page.getByRole("button", { name: /^Summit Showdown/ }).click();
  await page.getByRole("button", { name: "Ride", exact: true }).click();
  const mastery = page.getByRole("button", { name: /^04 Summit Mastery/ });
  await expect(mastery).toBeEnabled();
  await expect(mastery).toContainText("Tier 1");
  await expect(mastery).toContainText("35% heat");
  await mastery.click();
  await expect(page.locator(".position-block > span")).toHaveText("Position");
  await expect.poll(async () => Number(await page.getByRole("meter").getAttribute("aria-valuenow"))).toBeGreaterThan(25);
  await rideUntilResults(page, true);
  await expect(page.getByRole("heading", { name: "Mastery tier cleared" })).toBeVisible();
  await page.getByRole("button", { name: "Change mode" }).click();
  await expect(page.getByRole("button", { name: /^04 Summit Mastery/ })).toContainText("Tier 2");
  await expect(page.getByRole("button", { name: /^04 Summit Mastery/ })).toContainText("40% heat");
});

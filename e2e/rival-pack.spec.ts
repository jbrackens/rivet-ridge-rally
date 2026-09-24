import { expect, test, type Locator } from "@playwright/test";

const RIVAL_DIAGNOSTICS = [
  "data-rival-pack-root",
  "data-rival-pack-clone-count",
  "data-rival-pack-node-count",
  "data-rival-pack-mesh-count",
  "data-rival-pack-primitive-count",
  "data-rival-pack-material-count",
  "data-rival-pack-texture-count",
  "data-rival-pack-triangle-count",
  "data-rival-pack-shared-geometry-count",
  "data-rival-pack-geometry-instance-count",
  "data-rival-pack-gameplay-authority",
  "data-rival-pack-vertical-offset",
] as const;

async function startRivalRace(page: import("@playwright/test").Page): Promise<Locator> {
  const skip = page.getByRole("button", { name: "Skip training" });
  await expect(skip).toBeVisible({ timeout: 15_000 });
  await skip.click();
  await expect(page.getByRole("button", { name: "Ride", exact: true })).toBeVisible();
  await page.waitForFunction(() => Boolean(window.__RRR_QA__), undefined, { timeout: 15_000 });
  await page.evaluate(() => {
    if (!window.__RRR_QA__) throw new Error("Rival qualification requires a VITE_QA_MODE=1 build.");
    window.__RRR_QA__.unlockCampaign();
    window.__RRR_QA__.startTrack("canyon-kickoff", "rival");
  });
  const canvas = page.getByLabel("Live 3D race on Canyon Kickoff");
  await expect(canvas).toBeVisible({ timeout: 15_000 });
  return canvas;
}

test.describe("shared authored rival pack", () => {
  test.use({ serviceWorkers: "block" });

  test("loads one authored base and presents five shared-geometry numbered variants", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "chromium", "Rival asset diagnostics run once in Chromium");
    test.setTimeout(90_000);
    await page.goto("/?qa-fast-race=1");
    const canvas = await startRivalRace(page);

    await expect.poll(async () => {
      const asset = await canvas.getAttribute("data-rival-pack-asset");
      const reason = await canvas.getAttribute("data-rival-pack-fallback-reason");
      return reason ? `${asset}: ${reason}` : asset;
    }, { timeout: 20_000 }).toBe("ready");
    await expect(canvas).toHaveAttribute("data-rival-pack-root", "RRR_RivalPackBase");
    await expect(canvas).toHaveAttribute("data-rival-pack-clone-count", "5");
    await expect(canvas).toHaveAttribute("data-rival-pack-node-count", "26");
    await expect(canvas).toHaveAttribute("data-rival-pack-mesh-count", "12");
    await expect(canvas).toHaveAttribute("data-rival-pack-primitive-count", "12");
    await expect(canvas).toHaveAttribute("data-rival-pack-material-count", "5");
    await expect(canvas).toHaveAttribute("data-rival-pack-texture-count", "1");
    await expect(canvas).toHaveAttribute("data-rival-pack-triangle-count", "19588");
    await expect(canvas).toHaveAttribute("data-rival-pack-shared-geometry-count", "12");
    await expect(canvas).toHaveAttribute("data-rival-pack-geometry-instance-count", "60");
    await expect(canvas).toHaveAttribute("data-rival-pack-gameplay-authority", "presentation-only");
    await expect(canvas).toHaveAttribute("data-rival-pack-vertical-offset", "-0.62");
    await expect(canvas).toHaveAttribute("data-rival-bike-style", "authored-shared-rival-pack");
    await expect(canvas).toHaveAttribute("data-rival-number-set", "17-31-46-58-73");
    await expect(page.locator(".game-shell")).toHaveAttribute("data-race-gate-phase", "racing", {
      timeout: 10_000,
    });
  });

  test("a failed rival request leaves the complete procedural field playable", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "chromium", "Rival fallback diagnostics run once in Chromium");
    const requests: string[] = [];
    await page.route("**/assets/rivals/rival-pack.glb", async (route) => {
      requests.push(route.request().url());
      await route.abort("failed");
    });
    await page.goto("/?qa-fast-race=1");
    const canvas = await startRivalRace(page);

    await expect(canvas).toHaveAttribute("data-rival-pack-asset", "fallback", { timeout: 10_000 });
    await expect(canvas).toHaveAttribute("data-rival-pack-fallback-reason", "load-failed");
    await expect(canvas).toHaveAttribute(
      "data-rival-bike-style",
      "shared-knobby-brake-panel-exhaust",
    );
    await expect(canvas).toHaveAttribute("data-rival-number-set", "17-31-46-58-73");
    for (const attribute of RIVAL_DIAGNOSTICS) {
      await expect(canvas).not.toHaveAttribute(attribute, /.+/);
    }
    expect(requests).toEqual([
      new URL("/assets/rivals/rival-pack.glb", page.url()).href,
    ]);
    await expect(page.locator(".game-shell")).toHaveAttribute("data-race-gate-phase", "racing", {
      timeout: 10_000,
    });
  });
});

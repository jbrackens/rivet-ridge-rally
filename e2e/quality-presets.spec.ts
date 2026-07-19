import { expect, test } from "@playwright/test";

test("Auto, Low, Medium, and High renderer presets all start a clean race", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "Single-renderer quality gate");
  test.setTimeout(90_000);
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("requestfailed", (request) => errors.push(`${request.failure()?.errorText ?? "request failed"}: ${request.url()}`));

  await page.goto("/?qa-fast-race=1");
  await page.getByRole("button", { name: "Skip training" }).click();
  const expectedSafetyBlocks = new Map([
    ["low", "72"],
    ["medium", "96"],
    ["high", "144"],
  ]);
  const expectedGrandstandRows = new Map([
    ["low", "2"],
    ["medium", "3"],
    ["high", "4"],
  ]);
  const expectedGrandstandTiers = new Map([
    ["low", "16"],
    ["medium", "24"],
    ["high", "32"],
  ]);
  const expectedWatchtowerSpectators = new Map([
    ["low", "8"],
    ["medium", "12"],
    ["high", "16"],
  ]);
  for (const preset of ["Auto", "Low", "Medium", "High"]) {
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await page.getByRole("button", { name: "play", exact: true }).click();
    await page.getByLabel("Quality").selectOption(preset.toLowerCase());
    await page.getByRole("button", { name: "Done", exact: true }).click();
    await page.getByRole("button", { name: "Ride", exact: true }).click();
    await page.getByRole("button", { name: /Practice/ }).click();
    const canvas = page.getByLabel("Live 3D race on Canyon Kickoff");
    await expect(canvas, preset).toBeVisible();
    await expect(canvas, preset).toHaveAttribute("data-festival-pocket-style", "tiered-canyon");
    await expect(canvas, preset).toHaveAttribute("data-festival-pocket-count", "8");
    await expect(canvas, preset).toHaveAttribute("data-cooling-gate-watchtower-count", "4");
    await expect(canvas, preset).toHaveAttribute(
      "data-cooling-gate-watchtower-style",
      "staffed-elevated",
    );
    const expectedWatchtowerSpectatorCount = expectedWatchtowerSpectators.get(
      preset.toLowerCase(),
    );
    await expect(canvas, preset).toHaveAttribute(
      "data-cooling-gate-watchtower-spectator-count",
      expectedWatchtowerSpectatorCount ?? /^(8|12|16)$/,
    );
    const expectedTierRows = expectedGrandstandRows.get(preset.toLowerCase());
    if (expectedTierRows) {
      await expect(canvas, preset).toHaveAttribute("data-festival-pocket-tier-rows", expectedTierRows);
    }
    const expectedTierCount = expectedGrandstandTiers.get(preset.toLowerCase());
    if (expectedTierCount) {
      await expect(canvas, preset).toHaveAttribute("data-festival-pocket-tier-count", expectedTierCount);
    } else {
      await expect(canvas, preset).toHaveAttribute("data-festival-pocket-tier-count", /^[1-9]\d*$/);
    }
    await expect(canvas, preset).toHaveAttribute("data-course-edge-safety-style", "continuous-canyon");
    await expect(canvas, preset).toHaveAttribute("data-course-edge-safety-batch-count", "1");
    await expect(canvas, preset).toHaveAttribute("data-canyon-cactus-style", "branched-saguaro");
    await expect(canvas, preset).toHaveAttribute("data-canyon-cactus-batch-count", "1");
    await expect(canvas, preset).toHaveAttribute(
      "data-canyon-cactus-instance-count",
      preset === "Low" ? "14" : /^(14|24)$/,
    );
    const expectedBlockCount = expectedSafetyBlocks.get(preset.toLowerCase());
    if (expectedBlockCount) {
      await expect(canvas, preset).toHaveAttribute("data-course-edge-safety-block-count", expectedBlockCount);
    }
    await expect.poll(async () => {
      const text = await page.getByLabel("Performance metrics").textContent();
      return Number(/· (\d+) draws/.exec(text ?? "")?.[1] ?? 0);
    }).toBeGreaterThan(0);
    await expect(page.locator(".game-shell")).toHaveAttribute(
      "data-race-gate-phase",
      "racing",
      { timeout: 15_000 },
    );
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Festival menu" }).click();
  }
  expect(errors).toEqual([]);
});

test("all five launch tracks expose distinct venue signature diagnostics", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "Single-browser five-track visual identity gate");
  test.setTimeout(180_000);
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("requestfailed", (request) => errors.push(`${request.failure()?.errorText ?? "request failed"}: ${request.url()}`));

  await page.goto("/?qa-fast-race=1");
  await page.getByRole("button", { name: "Skip training" }).click();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "play", exact: true }).click();
  await page.getByLabel("Quality").selectOption("high");
  await page.getByRole("button", { name: "Done", exact: true }).click();

  const tracks = [
    {
      id: "canyon-kickoff",
      label: "Canyon Kickoff",
      assertions: async (canvas: ReturnType<typeof page.getByLabel>) => {
        await expect(canvas).toHaveAttribute("data-canyon-cactus-style", "branched-saguaro");
        await expect(canvas).toHaveAttribute("data-canyon-shoulder-dressing-style", "route-following-cut-bank");
        await expect(canvas).toHaveAttribute("data-canyon-route-crowd-style", "route-following-rail-bleachers-v2");
        await expect(canvas).toHaveAttribute("data-canyon-route-banner-style", "route-following-textured-sponsor-v2");
      },
    },
    {
      id: "pine-run",
      label: "Pine Run",
      assertions: async (canvas: ReturnType<typeof page.getByLabel>) => {
        await expect(canvas).toHaveAttribute("data-pine-root-style", "bump-aligned-batched");
        await expect(canvas).toHaveAttribute("data-pine-root-count", /^[1-9]\d*$/);
        await expect(canvas).toHaveAttribute("data-pine-trail-marker-style", "red-shoulder");
        await expect(canvas).toHaveAttribute("data-pine-trail-marker-count", "24");
      },
    },
    {
      id: "coastline-clash",
      label: "Coastline Clash",
      assertions: async (canvas: ReturnType<typeof page.getByLabel>) => {
        await expect(canvas).toHaveAttribute("data-coastline-water-style", "right-side-water-boardwalk");
        await expect(canvas).toHaveAttribute("data-coastline-boardwalk-style", "route-following-planks");
        await expect(canvas).toHaveAttribute("data-coastline-hut-style", "colorful-boardwalk-huts");
        await expect(canvas).toHaveAttribute("data-coastline-hut-count", "22");
      },
    },
    {
      id: "foundry-flight",
      label: "Foundry Flight",
      assertions: async (canvas: ReturnType<typeof page.getByLabel>) => {
        await expect(canvas).toHaveAttribute("data-foundry-gantry-style", "cyan-orange-safety");
        await expect(canvas).toHaveAttribute("data-foundry-gantry-bar-count", "7");
        await expect(canvas).toHaveAttribute("data-foundry-furnace-panel-style", "opaque-emissive");
        await expect(canvas).toHaveAttribute("data-foundry-furnace-panel-count", "18");
      },
    },
    {
      id: "summit-showdown",
      label: "Summit Showdown",
      assertions: async (canvas: ReturnType<typeof page.getByLabel>) => {
        await expect(canvas).toHaveAttribute("data-summit-finale-equipment-style", "bilateral-yellow-service");
        await expect(canvas).toHaveAttribute("data-summit-finale-equipment-batch-count", "1");
        await expect(canvas).toHaveAttribute("data-summit-finale-equipment-count", "12");
        await expect(canvas).toHaveAttribute("data-summit-finale-stations-per-lap", "6");
      },
    },
  ] as const;

  for (const track of tracks) {
    await page.evaluate((id) => {
      if (!window.__RRR_QA__) throw new Error("Five-track visual identity check requires QA mode.");
      window.__RRR_QA__.startTrack(id, "practice");
    }, track.id);
    const canvas = page.getByLabel(`Live 3D race on ${track.label}`);
    await expect(canvas).toBeVisible({ timeout: 20_000 });
    await expect(page.locator(".game-shell")).toHaveAttribute(
      "data-race-gate-phase",
      "racing",
      { timeout: 20_000 },
    );
    await expect(canvas).toHaveAttribute("data-dirt-texture-detail-style", "layered-rut-pebble-v2");
    await expect(canvas).toHaveAttribute("data-festival-start-stand-style", "broadened-tiered");
    await track.assertions(canvas);
  }

  expect(errors).toEqual([]);
});

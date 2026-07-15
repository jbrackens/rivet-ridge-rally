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

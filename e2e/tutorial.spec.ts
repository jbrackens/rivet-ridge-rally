import { expect, test } from "@playwright/test";

test("a new rider completes the comprehensive tutorial without skipping", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "Interactive tutorial gate runs once in Chromium");
  test.setTimeout(120_000);
  const startedAt = Date.now();

  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Rider school" })).toBeVisible();
  await expect(page.getByLabel("Current controls")).toContainText("← Left / → Right");
  await expect(page.getByLabel("Current controls")).toContainText("↑ Up / ↓ Down");
  await expect(page.getByText("Pause freezes the lesson", { exact: false })).toBeVisible();

  await page.getByRole("button", { name: "Start lesson 1" }).click();
  await expect(page.getByRole("heading", { name: "Ride and read the HUD" })).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Training paused" })).toBeVisible();
  await page.getByRole("button", { name: "Restart training" }).click();
  await expect(page.getByRole("heading", { name: "Ride and read the HUD" })).toBeVisible();

  const canvas = page.getByLabel("Live 3D race on Canyon Kickoff");
  await page.keyboard.down("w");
  await expect(page.getByRole("heading", { name: "Coast to slow" })).toBeVisible({ timeout: 10_000 });
  await page.keyboard.up("w");
  await expect(page.getByRole("heading", { name: "Choose a lane" })).toBeVisible({ timeout: 10_000 });

  await page.keyboard.press("ArrowLeft");
  await expect(page.getByRole("heading", { name: "Turbo and heat" })).toBeVisible({ timeout: 10_000 });
  await page.keyboard.down("w");
  await page.keyboard.down("Shift");
  await expect(page.locator(".caption-cue")).toContainText("Heat critical", { timeout: 10_000 });
  await expect(page.getByRole("heading", { name: "Cool the bike" })).toBeVisible({ timeout: 10_000 });
  await page.keyboard.up("Shift");
  await expect(canvas).toHaveAttribute("data-demonstrated-mechanics", /coolingRelease/, { timeout: 20_000 });

  await expect(page.getByRole("heading", { name: "Wheelie the bump" })).toBeVisible({ timeout: 20_000 });
  await page.keyboard.down("ArrowUp");
  await expect(page.getByRole("heading", { name: "Shape the jump" })).toBeVisible({ timeout: 10_000 });
  await expect(canvas).toHaveAttribute("data-demonstrated-mechanics", /airbornePitchUp/, { timeout: 20_000 });
  await page.keyboard.up("ArrowUp");
  await page.keyboard.down("ArrowDown");
  await expect(canvas).toHaveAttribute("data-demonstrated-mechanics", /airbornePitchDown/, { timeout: 10_000 });
  await page.keyboard.up("ArrowDown");
  await expect(canvas).toHaveAttribute("data-demonstrated-mechanics", /airborneNeutral/, { timeout: 10_000 });

  await expect(page.getByRole("heading", { name: "Land both wheels" })).toBeVisible({ timeout: 10_000 });
  await expect(page.getByRole("heading", { name: "Read the barrier" })).toBeVisible({ timeout: 20_000 });
  await expect(canvas).toHaveAttribute("data-demonstrated-mechanics", /hazardAvoided/, { timeout: 20_000 });
  await expect(page.getByRole("heading", { name: "Mud slowdown" })).toBeVisible({ timeout: 10_000 });
  await expect(page.getByRole("heading", { name: "Track edges" })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole("heading", { name: "Crash and recover" })).toBeVisible({ timeout: 20_000 });
  await expect(canvas).toHaveAttribute("data-demonstrated-mechanics", /crash/, { timeout: 20_000 });

  await page.keyboard.down("Space");
  await expect(page.getByRole("heading", { name: "Rival contact" })).toBeVisible({ timeout: 15_000 });
  await page.keyboard.up("Space");
  await page.keyboard.up("w");
  await expect(canvas).toHaveAttribute(
    "data-demonstrated-mechanics",
    /coast.*cooling.*coolingRelease.*laneChange.*wheelie.*airbornePitch.*airbornePitchUp.*airbornePitchDown.*airborneNeutral.*cleanLanding.*hazardAvoided.*mud.*grass.*crash.*recovery/,
  );

  await page.getByRole("button", { name: "Rider ahead crashes" }).click();
  await expect(page.getByRole("alert")).toContainText("hits from behind crashes");
  await page.getByRole("button", { name: "I crash" }).click();
  await expect(page.getByRole("heading", { name: "Rear-wheel defense" })).toBeVisible();
  await page.getByRole("button", { name: "I crash" }).click();
  await expect(page.getByRole("alert")).toContainText("pursuer");
  await page.getByRole("button", { name: "Pursuer crashes" }).click();
  await expect(page.getByRole("heading", { name: "Race fair, ride bold" })).toBeVisible();
  expect(Date.now() - startedAt).toBeLessThan(180_000);
  await page.getByRole("button", { name: "Enter the festival" }).click();
  await expect(page.getByRole("button", { name: "Ride", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Rider School", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Rider school" })).toBeVisible();
});

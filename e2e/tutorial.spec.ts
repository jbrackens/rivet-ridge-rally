import { expect, test } from "@playwright/test";

test("a new rider demonstrates every tutorial mechanic without skipping", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "Interactive tutorial gate runs once in Chromium");
  test.setTimeout(90_000);
  const startedAt = Date.now();

  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Ride" })).toBeVisible();
  await page.keyboard.down("w");
  await page.keyboard.down("Space");

  await expect(page.getByRole("heading", { name: "Turbo and heat" })).toBeVisible({ timeout: 10_000 });
  await page.keyboard.down("Shift");
  await expect(page.locator(".caption-cue")).toContainText("Heat critical", { timeout: 10_000 });
  await expect(page.getByRole("heading", { name: "Cooling gates" })).toBeVisible({ timeout: 10_000 });
  await page.keyboard.up("Shift");
  await expect(page.getByRole("heading", { name: "Choose a lane" })).toBeVisible({ timeout: 20_000 });

  await page.keyboard.press("a");
  await expect(page.getByRole("heading", { name: "Wheelie the bump" })).toBeVisible({ timeout: 20_000 });
  await page.keyboard.down("ArrowUp");
  await expect(page.getByRole("heading", { name: "Air control" })).toBeVisible({ timeout: 20_000 });
  const canvas = page.getByLabel("Live 3D race on Canyon Kickoff");
  await expect(canvas).toHaveAttribute("data-demonstrated-mechanics", /airbornePitch/, { timeout: 20_000 });
  await page.keyboard.up("ArrowUp");
  await expect(page.getByRole("heading", { name: "Clean landing" })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole("heading", { name: "Mud slowdown" })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole("heading", { name: "Track edges" })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole("heading", { name: "Rival contact" })).toBeVisible({ timeout: 25_000 });
  await expect(canvas).toHaveAttribute(
    "data-demonstrated-mechanics",
    /cooling.*laneChange.*wheelie.*airbornePitch.*cleanLanding.*mud.*grass/,
  );

  await page.keyboard.up("w");
  await page.keyboard.up("Space");
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
});

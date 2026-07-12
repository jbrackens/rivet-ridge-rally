import { expect, test, type Page } from "@playwright/test";

import { EXAMPLE_TRACKS } from "../src/game/editor/examples";
import { EDITOR_MODULES } from "../src/game/editor/modules";

const consoleErrors = new WeakMap<Page, string[]>();

async function openEditor(page: Page): Promise<void> {
  await page.goto("/");
  const skip = page.getByRole("button", { name: "Skip training" });
  await expect(skip).toBeVisible({ timeout: 15_000 });
  await skip.click();
  await page.getByRole("button", { name: "Track Builder", exact: true }).click();
  await expect(page.getByLabel(/Interactive 3D track build camera/)).toBeVisible();
  await expect(page.getByText("3 modules", { exact: true })).toBeVisible();
}

function filePayload(name: string, value: unknown) {
  return {
    name,
    mimeType: "application/json",
    buffer: Buffer.from(typeof value === "string" ? value : JSON.stringify(value)),
  };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function allModuleTrack() {
  const now = Date.now();
  const nonRaceModules = EDITOR_MODULES.filter((module) => module.category !== "race");
  const modules = nonRaceModules.map((module, index) => ({
    id: `all-${module.id}`,
    moduleId: module.id,
    lane: (module.laneSpan === 4 ? 0 : index % (5 - module.laneSpan)) as 0 | 1 | 2 | 3,
    gridPosition: (index + 1) * 30,
    rotation: (index % 3 === 0 ? 180 : 0) as 0 | 180,
    height: index % 4 === 0 ? 0.5 : 0,
  }));
  modules.push(
    { id: "all-start", moduleId: "start-grid", lane: 0, gridPosition: 0, rotation: 0, height: 0 },
    ...[145, 285, 425, 565, 705].map((gridPosition, index) => ({
      id: `all-checkpoint-${index}`,
      moduleId: "checkpoint",
      lane: 0 as const,
      gridPosition,
      rotation: ([0, 90, 180, 270, 0] as const)[index] ?? 0,
      height: index % 3 === 0 ? 0.5 : 0,
    })),
    { id: "all-finish", moduleId: "finish-arch", lane: 0, gridPosition: 820, rotation: 180, height: 1 },
  );
  return {
    schemaVersion: 1,
    id: "all-modules-circuit",
    name: "All Modules Circuit",
    laps: 2,
    difficultyEstimate: 5,
    modules,
    createdAt: now,
    updatedAt: now,
  };
}

test.beforeEach(async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "Editor RC1 matrix runs once in Chromium");
  const errors: string[] = [];
  consoleErrors.set(page, errors);
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  await openEditor(page);
});

test.afterEach(async ({ page }) => {
  const errors = consoleErrors.get(page);
  if (errors) expect(errors).toEqual([]);
});

test("all 25 editor modules can be selected, placed, and removed", async ({ page }) => {
  test.setTimeout(120_000);
  expect(EDITOR_MODULES).toHaveLength(25);
  const canvas = page.getByLabel(/Interactive 3D track build camera/);

  for (const module of EDITOR_MODULES) {
    await page.getByRole("button", { name: module.category, exact: true }).click();
    const moduleButton = page.locator(".module-rail").getByRole("button", {
      name: new RegExp(`^${escapeRegExp(module.name)}(?:\\s|$)`),
    });
    await moduleButton.click();
    await expect(moduleButton).toHaveClass(/active/);

    await canvas.click({ position: { x: 430, y: 330 } });
    await expect(page.getByText("4 modules", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Delete", exact: true }).click();
    await expect(page.getByText("3 modules", { exact: true })).toBeVisible();
  }
});

test("orbiting and zooming the 3D build camera never places a module", async ({ page }) => {
  const canvas = page.getByLabel(/Interactive 3D track build camera/);
  const bounds = await canvas.boundingBox();
  if (!bounds) throw new Error("Editor canvas bounds are required.");
  await page.mouse.move(bounds.x + bounds.width * 0.45, bounds.y + bounds.height * 0.5);
  await page.mouse.down();
  await page.mouse.move(bounds.x + bounds.width * 0.7, bounds.y + bounds.height * 0.5, { steps: 8 });
  await page.mouse.up();
  await canvas.hover();
  await page.mouse.wheel(0, 240);
  await expect(page.getByText("3 modules", { exact: true })).toBeVisible();
  await expect(page.getByText("0 / 50 actions", { exact: true })).toBeVisible();
});

test("undo and redo preserve the full 50-action history", async ({ page }) => {
  test.setTimeout(120_000);
  const trackName = page.getByLabel("Track name");
  const undo = page.getByRole("button", { name: "Undo" });
  const redo = page.getByRole("button", { name: "Redo" });

  for (let action = 1; action <= 50; action += 1) {
    await trackName.fill(`History ${String(action).padStart(2, "0")}`);
  }
  await expect(page.getByText("50 / 50 actions", { exact: true })).toBeVisible();

  for (let action = 0; action < 50; action += 1) {
    await undo.evaluate((button: HTMLButtonElement) => button.click());
  }
  await expect(undo).toBeDisabled();
  await expect(trackName).toHaveValue("Canyon Workshop");
  await expect(page.getByText("0 / 50 actions", { exact: true })).toBeVisible();

  for (let action = 0; action < 50; action += 1) {
    await redo.evaluate((button: HTMLButtonElement) => button.click());
  }
  await expect(redo).toBeDisabled();
  await expect(trackName).toHaveValue("History 50");
  await expect(page.getByText("50 / 50 actions", { exact: true })).toBeVisible();
});

test("duplicate, rename, thumbnail, and confirmed clear-all work as one editor flow", async ({ page }) => {
  const canvas = page.getByLabel(/Interactive 3D track build camera/);
  await canvas.click({ position: { x: 430, y: 330 } });
  await expect(page.getByText("4 modules", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Duplicate", exact: true }).click();
  await expect(page.getByText("5 modules", { exact: true })).toBeVisible();

  const name = `Thumbnail Circuit ${Date.now()}`;
  await page.getByLabel("Track name").fill(name);
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.locator("footer.editor-status output")).toHaveText("Track saved locally.");
  await page.getByRole("button", { name: "Library", exact: true }).click();
  const saved = page.locator(".library-drawer article").filter({ hasText: name });
  await expect(saved).toBeVisible();
  await expect(saved.locator("img")).toHaveAttribute("src", /^data:image\/(?:png|jpeg|webp);base64,/);
  await page.getByRole("button", { name: "Close local track library" }).click();

  page.once("dialog", (dialog) => void dialog.dismiss());
  await page.getByRole("button", { name: "Clear all…" }).click();
  await expect(page.getByText("5 modules", { exact: true })).toBeVisible();
  page.once("dialog", (dialog) => void dialog.accept());
  await page.getByRole("button", { name: "Clear all…" }).click();
  await expect(page.getByText("0 modules", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(page.getByText("5 modules", { exact: true })).toBeVisible();
});

test("lap values one through nine start races with the selected lap contract", async ({ page }) => {
  test.setTimeout(90_000);
  const laps = page.getByLabel("Laps");

  for (let value = 1; value <= 9; value += 1) {
    await laps.fill(String(value));
    await expect(laps).toHaveValue(String(value));
    await page.getByRole("button", { name: "Test Ride", exact: true }).click();
    const canvas = page.getByLabel("Live 3D race on Canyon Workshop");
    await expect(canvas).toBeVisible();
    await expect(page.locator(".timing-block")).toContainText(`Lap 1 / ${value}`);
    await canvas.press("Escape");
    await page.getByRole("button", { name: "Festival menu", exact: true }).click();
    await page.getByRole("button", { name: "Track Builder", exact: true }).click();
  }
});

test("narrow editor keeps Save and Test Ride reachable", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const save = page.getByRole("button", { name: "Save", exact: true });
  const testRide = page.getByRole("button", { name: "Test Ride", exact: true });
  await expect(save).toBeVisible();
  await expect(testRide).toBeVisible();
  const testRideBox = await testRide.boundingBox();
  expect(testRideBox).not.toBeNull();
  expect((testRideBox?.x ?? 0) + (testRideBox?.width ?? 391)).toBeLessThanOrEqual(390);
});

test("invalid tracks show actionable errors and block save and export", async ({ page }) => {
  page.once("dialog", (dialog) => void dialog.accept());
  await page.getByRole("button", { name: "Clear all…" }).click();

  await expect(page.getByText("Place exactly one Start Grid.", { exact: true })).toBeVisible();
  await expect(page.getByText("Place exactly one Finish Arch.", { exact: true })).toBeVisible();
  await expect(page.getByText("Place at least one checkpoint between start and finish.", { exact: true })).toBeVisible();
  await expect(page.getByText("! 3 validation issues", { exact: true })).toBeVisible();

  const status = page.locator("footer.editor-status output");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(status).toHaveText("Place exactly one Start Grid.");
  await page.getByRole("button", { name: "Export", exact: true }).click();
  await expect(status).toHaveText("Place exactly one Start Grid.");
});

test("a valid track saves, survives reload, and exports safe JSON", async ({ page }) => {
  const trackName = `RC1 Editor ${Date.now()}`;
  await page.getByLabel("Track name").fill(trackName);
  await page.getByLabel("Laps").fill("7");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.locator("footer.editor-status output")).toHaveText("Track saved locally.");

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export", exact: true }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe(
    `${trackName.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.rrr-track.json`,
  );
  await expect(page.locator("footer.editor-status output")).toHaveText("Safe JSON export created.");

  await page.reload();
  await expect(page.getByRole("button", { name: "Track Builder", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Track Builder", exact: true }).click();
  await page.getByRole("button", { name: "Library", exact: true }).click();
  const savedTrack = page.locator(".library-drawer article").filter({ hasText: trackName });
  await expect(savedTrack).toBeVisible();
  await savedTrack.getByRole("button", { name: "Open", exact: true }).click();
  await expect(page.getByLabel("Track name")).toHaveValue(trackName);
  await expect(page.getByLabel("Laps")).toHaveValue("7");
});

test("a valid saved circuit containing every module completes its authored gates and laps", async ({ page }) => {
  test.setTimeout(120_000);
  await page.locator('input[type="file"]').setInputFiles(filePayload("all-modules.json", allModuleTrack()));
  await expect(page.locator("footer.editor-status output")).toHaveText("Track imported as a safe local copy.");
  await expect(page.getByText("✓ Route complete", { exact: true }).first()).toBeVisible();
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.locator("footer.editor-status output")).toHaveText("Track saved locally.");

  await page.reload();
  await page.getByRole("button", { name: "Track Builder", exact: true }).click();
  await page.getByRole("button", { name: "Library", exact: true }).click();
  const savedTrack = page.locator(".library-drawer article").filter({ hasText: "All Modules Circuit Copy" });
  await expect(savedTrack).toBeVisible();
  await savedTrack.getByRole("button", { name: "Open", exact: true }).click();
  await expect(page.getByText(`${allModuleTrack().modules.length} modules`, { exact: true })).toBeVisible();
  await page.evaluate(() => window.history.replaceState(null, "", "/?qa-fast-race=1"));
  await page.getByRole("button", { name: "Test Ride", exact: true }).click();
  await expect(page.getByLabel("Live 3D race on All Modules Circuit Copy")).toBeVisible();
  await page.keyboard.down("w");
  await page.keyboard.down("Space");
  await expect(page.locator(".caption-cue")).toContainText("Checkpoint 5 of 5", { timeout: 45_000 });
  await expect(page.getByRole("button", { name: "Retry now" })).toBeVisible({ timeout: 45_000 });
  await page.keyboard.up("w");
  await page.keyboard.up("Space");
  await expect(page.getByText("Lap 1", { exact: true })).toBeVisible();
  await expect(page.getByText("Lap 2", { exact: true })).toBeVisible();
  const splits = page.locator(".split-breakdown li");
  await expect(splits).toHaveCount(10);
  await expect(splits.nth(4)).toContainText("Lap 1 · CP 5");
  await expect(splits.nth(5)).toContainText("Lap 2 · CP 1");
  await expect(splits.nth(9)).toContainText("Lap 2 · CP 5");
});

test("all three bundled editor examples complete test rides", async ({ page }) => {
  test.setTimeout(180_000);
  await page.goto("/?qa-fast-race=1");
  await page.getByRole("button", { name: "Track Builder", exact: true }).click();

  for (const example of EXAMPLE_TRACKS) {
    await page.getByRole("button", { name: "Library", exact: true }).click();
    const card = page.locator(".library-drawer article").filter({ hasText: example.name });
    await expect(card).toBeVisible();
    await card.getByRole("button", { name: "Open", exact: true }).click();
    await page.getByRole("button", { name: "Test Ride", exact: true }).click();
    await expect(page.getByLabel(`Live 3D race on ${example.name}`)).toBeVisible();
    await page.keyboard.down("w");
    await page.keyboard.down("Space");
    await expect(page.getByRole("button", { name: "Retry now" })).toBeVisible({ timeout: 40_000 });
    await page.keyboard.up("w");
    await page.keyboard.up("Space");
    await page.getByRole("button", { name: "Festival menu" }).click();
    await page.getByRole("button", { name: "Track Builder", exact: true }).click();
  }
});

test("UI import rejects corrupt, oversized, incompatible, invalid, and external-thumbnail files", async ({ page }) => {
  const input = page.locator('input[type="file"]');
  const status = page.locator("footer.editor-status output");
  const example = EXAMPLE_TRACKS[0];
  if (!example) throw new Error("An editor example is required for import fixtures.");

  await input.setInputFiles(filePayload("corrupt.json", '{"schemaVersion":'));
  await expect(status).toHaveText("Track file is not valid JSON.");

  await input.setInputFiles({
    name: "oversized.json",
    mimeType: "application/json",
    buffer: Buffer.alloc(1_000_001, "x"),
  });
  await expect(status).toHaveText("Track file exceeds the 1 MB safety limit.");

  await input.setInputFiles(filePayload("incompatible.json", {
    ...example,
    schemaVersion: 2,
  }));
  await expect(status).toContainText("Track file is incompatible or invalid:");

  await input.setInputFiles(filePayload("laps-status-reset.json", '{"schemaVersion":'));
  await expect(status).toHaveText("Track file is not valid JSON.");
  await input.setInputFiles(filePayload("invalid-laps.json", {
    ...example,
    laps: 0,
  }));
  await expect(status).toContainText("Track file is incompatible or invalid:");

  await input.setInputFiles(filePayload("incomplete-route.json", {
    ...example,
    modules: example.modules.filter((module) => module.moduleId !== "finish-arch"),
  }));
  await expect(status).toHaveText("Track route is invalid: Place exactly one Finish Arch.");

  const bump = example.modules.find((module) => module.moduleId === "bump-row");
  if (!bump) throw new Error("The import fixture requires a bump row.");
  await input.setInputFiles(filePayload("overlapping-route.json", {
    ...example,
    modules: [...example.modules, { ...bump, id: "evil-overlap", moduleId: "ramp-medium", gridPosition: bump.gridPosition + 2 }],
  }));
  await expect(status).toContainText("Track route is invalid:");
  await expect(status).toContainText("overlaps");

  await input.setInputFiles(filePayload("status-reset.json", '{"schemaVersion":'));
  await expect(status).toHaveText("Track file is not valid JSON.");
  await input.setInputFiles(filePayload("external-thumbnail.json", {
    ...example,
    thumbnail: "https://attacker.invalid/tracker.png",
  }));
  await expect(status).toHaveText(
    "Track file is incompatible or invalid: Thumbnail must be an embedded image data URL.",
  );
});

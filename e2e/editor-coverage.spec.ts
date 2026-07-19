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
    schemaVersion: 2,
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
  const placedModule = page.getByLabel("Placed module");
  const finishOption = placedModule.locator("option").filter({ hasText: "Finish Arch · lane 1 · 96 m" });
  const finishId = await finishOption.getAttribute("value");
  if (!finishId) throw new Error("The default finish option is required.");
  await placedModule.selectOption(finishId);
  await page.getByLabel("Position", { exact: true }).fill("300");
  await page.getByLabel("Route view position").fill("160");

  for (const module of EDITOR_MODULES) {
    await page.getByRole("button", { name: module.category, exact: true }).click();
    const moduleButton = page.locator(".module-rail").getByRole("button", {
      name: new RegExp(`^${escapeRegExp(module.name)}(?:\\s|$)`),
    });
    await moduleButton.click();
    await expect(moduleButton).toHaveClass(/active/);

    if (module.category === "race") {
      const existingOption = placedModule.locator("option").filter({ hasText: module.name });
      const existingId = await existingOption.getAttribute("value");
      if (!existingId) throw new Error(`The existing ${module.name} option is required.`);
      await placedModule.selectOption(existingId);
      await page.getByRole("button", { name: "Delete", exact: true }).click();
      await expect(page.getByText("2 modules", { exact: true })).toBeVisible();
      await page.getByLabel("Route view position").fill(
        module.id === "start-grid" ? "0" : module.id === "checkpoint" ? "160" : "300",
      );
      await page.getByRole("button", { name: "Place selected module at route view" }).click();
      await expect(page.getByText("3 modules", { exact: true })).toBeVisible();
      await page.getByRole("button", { name: "Delete", exact: true }).click();
      await expect(page.getByText("2 modules", { exact: true })).toBeVisible();
      const undo = page.getByRole("button", { name: "Undo", exact: true });
      await undo.click();
      await undo.click();
      await undo.click();
      await expect(page.getByText("3 modules", { exact: true })).toBeVisible();
      continue;
    }

    await page.getByRole("button", { name: "Place selected module at route view" }).click();
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

test("placed modules can be selected, edited, and focused across the full route bounds", async ({ page }) => {
  const placedModule = page.getByLabel("Placed module");
  const checkpointOption = placedModule.locator("option").filter({ hasText: "Checkpoint · lane 1 · 48 m" });
  const checkpointId = await checkpointOption.getAttribute("value");
  if (!checkpointId) throw new Error("The default checkpoint option is required.");

  await placedModule.selectOption(checkpointId);
  await expect(page.getByLabel("Position", { exact: true })).toHaveValue("48");
  const canvas = page.getByLabel(/Interactive 3D track build camera/);
  await expect(canvas).toHaveAttribute("data-route-view-position", "48");

  await page.getByLabel("Position", { exact: true }).fill("52");
  await expect(canvas).toHaveAttribute("data-route-view-position", "52");
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(page.getByText("2 modules", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(page.getByText("3 modules", { exact: true })).toBeVisible();

  const routeView = page.getByLabel("Route view position");
  await expect(routeView).toHaveAttribute("max", "20000");
  await routeView.fill("20000");
  await expect(canvas).toHaveAttribute("data-route-view-position", "20000");
  await expect(canvas).toHaveAttribute("data-route-guide-range", /^\d+-20000$/);
  await expect(page.locator(".editor-route-navigation output")).toContainText("20,000 m / 20,000 m");
  await expect(page.locator(".editor-route-navigation output")).toContainText("Authored 0–96 m");

  await page.getByRole("button", { name: "Fit route", exact: true }).click();
  await expect(canvas).toHaveAttribute("data-route-view-mode", "overview");
});

test("checkpoint route controls are bounded, undoable, and checkpoint-only", async ({ page }) => {
  const placedModule = page.getByLabel("Placed module");
  const checkpointOption = placedModule.locator("option").filter({ hasText: "Checkpoint · lane 1 · 48 m" });
  const checkpointId = await checkpointOption.getAttribute("value");
  if (!checkpointId) throw new Error("The default checkpoint option is required.");
  await placedModule.selectOption(checkpointId);

  const routeTurn = page.getByLabel("Route turn");
  const routeRise = page.getByLabel("Route rise");
  await expect(routeTurn).toHaveAttribute("min", "-16");
  await expect(routeTurn).toHaveAttribute("max", "16");
  await expect(routeRise).toHaveAttribute("min", "0");
  await expect(routeRise).toHaveAttribute("max", "12");
  await expect(routeTurn).toHaveValue("-3");
  await expect(routeRise).toHaveValue("2");

  await routeTurn.fill("24");
  await expect(routeTurn).toHaveValue("16");
  await routeRise.fill("20");
  await expect(routeRise).toHaveValue("12");

  const undo = page.getByRole("button", { name: "Undo" });
  await undo.click();
  await expect(routeTurn).toHaveValue("16");
  await expect(routeRise).toHaveValue("2");
  await undo.click();
  await expect(routeTurn).toHaveValue("-3");

  const redo = page.getByRole("button", { name: "Redo" });
  await redo.click();
  await expect(routeTurn).toHaveValue("16");
  await expect(routeRise).toHaveValue("2");
  await redo.click();
  await expect(routeRise).toHaveValue("12");

  const startOption = placedModule.locator("option").filter({ hasText: "Start Grid · lane 1 · 0 m" });
  const startId = await startOption.getAttribute("value");
  if (!startId) throw new Error("The default start-grid option is required.");
  await placedModule.selectOption(startId);
  await expect(page.getByLabel("Route turn")).toHaveCount(0);
  await expect(page.getByLabel("Route rise")).toHaveCount(0);
});

test("concept-style inspector steppers update selected module and race settings", async ({ page }) => {
  const placedModule = page.getByLabel("Placed module");
  const checkpointOption = placedModule.locator("option").filter({ hasText: "Checkpoint · lane 1 · 48 m" });
  const checkpointId = await checkpointOption.getAttribute("value");
  if (!checkpointId) throw new Error("The default checkpoint option is required.");
  await placedModule.selectOption(checkpointId);

  await expect(page.getByRole("status", { name: "Selected module lane" })).toHaveText("Lane 1");
  await page.getByRole("button", { name: "Move selected module right one lane" }).click();
  await expect(page.getByRole("status", { name: "Selected module lane" })).toHaveText("Lane 2");
  await expect(page.getByLabel("Lane", { exact: true })).toHaveValue("2");

  await expect(page.getByRole("status", { name: "Selected module rotation" })).toHaveText("0°");
  await page.getByRole("button", { name: "Rotate selected module clockwise" }).click();
  await expect(page.getByRole("status", { name: "Selected module rotation" })).toHaveText("90°");
  await expect(page.locator(".editor-inspector label").filter({ hasText: /^Rotation/ }).locator("select")).toHaveValue("90");

  await expect(page.getByRole("status", { name: "Selected module height" })).toHaveText("0 m");
  await page.getByRole("button", { name: "Raise selected module height" }).click();
  await expect(page.getByRole("status", { name: "Selected module height" })).toHaveText("0.5 m");
  await expect(page.locator(".editor-inspector label").filter({ hasText: /^Height/ }).locator("input")).toHaveValue("0.5");

  await expect(page.getByRole("status", { name: "Track lap count" })).toHaveText("2 laps");
  await page.getByRole("button", { name: "Increase laps" }).click();
  await expect(page.getByRole("status", { name: "Track lap count" })).toHaveText("3 laps");
  await expect(page.getByLabel("Laps", { exact: true })).toHaveValue("3");
  await expect(page.getByText("4 / 50 actions", { exact: true })).toBeVisible();
});

test("pointer placement preview announces valid and invalid candidates without color alone", async ({ page }) => {
  const canvas = page.getByLabel(/Interactive 3D track build camera/);
  const bounds = await canvas.boundingBox();
  if (!bounds) throw new Error("Editor canvas bounds are required.");
  const preview = page.locator(".editor-placement-preview");
  const routeSamples = [
    [0.48, 0.37],
    [0.51, 0.45],
    [0.54, 0.55],
    [0.57, 0.64],
    [0.6, 0.72],
  ] as const;
  let pointer: { x: number; y: number } | null = null;
  for (const [xRatio, yRatio] of routeSamples) {
    const candidate = { x: bounds.x + bounds.width * xRatio, y: bounds.y + bounds.height * yRatio };
    await page.mouse.move(candidate.x, candidate.y);
    await page.waitForTimeout(100);
    const previewText = await preview.count() > 0 ? await preview.textContent() : null;
    if (previewText?.includes("✓ Valid placement")) {
      pointer = candidate;
      break;
    }
  }
  if (!pointer) throw new Error("The overview route must expose an empty valid pointer-placement segment.");
  await expect(page.getByText("✓ Valid placement", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "race", exact: true }).click();
  await page.locator(".module-rail").getByRole("button", { name: /^Start Grid(?:\s|$)/ }).click();
  await page.mouse.move(pointer.x + 1, pointer.y);
  await expect(page.getByText("! Invalid placement", { exact: true })).toBeVisible();
  await expect(page.locator(".editor-placement-preview")).toContainText("Start Grid");
  await page.mouse.click(pointer.x + 1, pointer.y);
  await expect(page.getByText("3 modules", { exact: true })).toBeVisible();
});

test("keyboard placement rejects invalid candidates and commits valid ones", async ({ page }) => {
  test.setTimeout(60_000);
  await page.getByRole("button", { name: "race", exact: true }).click();
  await page.locator(".module-rail").getByRole("button", { name: /^Start Grid(?:\s|$)/ }).click();
  const place = page.getByRole("button", { name: "Place selected module at route view", exact: true });
  await place.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByText("3 modules", { exact: true })).toBeVisible();
  await expect(page.locator(".editor-status output")).toContainText("already exists");

  await page.getByRole("button", { name: "jumps", exact: true }).click();
  await page.locator(".module-rail").getByRole("button", { name: /^Medium Ramp(?:\s|$)/ }).click();
  await page.getByLabel("Route view position").fill("72");
  await page.getByLabel("New module lane").selectOption("1");
  await place.focus();
  await page.keyboard.press("Enter");

  await expect(page.getByText("4 modules", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Placed module").locator("option").filter({ hasText: "Medium Ramp · lane 2 · 72 m" })).toHaveCount(1);
  await expect(page.locator(".editor-status output")).toContainText("Medium Ramp placed in lane 2 at 72 m.");
});

test("damaged local tracks missing an index key are preserved and available as portable recovery packages", async ({ page }) => {
  await page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("rivet-ridge-rally");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction("customTracks", "readwrite");
      transaction.objectStore("customTracks").put({
        schemaVersion: 1,
        id: "damaged-circuit",
        name: "Damaged Circuit",
        laps: 2,
        difficultyEstimate: 2,
        modules: [],
        createdAt: Date.now(),
      });
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
    database.close();
  });

  await page.getByRole("button", { name: "Back to festival menu" }).click();
  await page.getByRole("button", { name: "Track Builder", exact: true }).click();
  await page.getByRole("button", { name: "Library", exact: true }).click();

  const recovery = page.getByLabel("Recovered track data");
  await expect(recovery).toContainText("Damaged Circuit");
  await expect(recovery).toContainText("Preserved in local quarantine");
  const downloadPromise = page.waitForEvent("download");
  await recovery.getByRole("button", { name: "Download recovery package" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("damaged-circuit.recovery.json");

  const preservation = await page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("rivet-ridge-rally");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const result = await new Promise<{ active: boolean; quarantined: number }>((resolve, reject) => {
      const transaction = database.transaction(["customTracks", "quarantine"], "readonly");
      const activeRequest = transaction.objectStore("customTracks").get("damaged-circuit");
      const quarantineRequest = transaction.objectStore("quarantine").index("kind").count("custom-track");
      transaction.oncomplete = () => resolve({
        active: activeRequest.result !== undefined,
        quarantined: quarantineRequest.result,
      });
      transaction.onerror = () => reject(transaction.error);
    });
    database.close();
    return result;
  });
  expect(preservation).toEqual({ active: false, quarantined: 1 });
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
  page.on("dialog", (dialog) => {
    throw new Error(`Native dialog should not open for editor clear-all: ${dialog.message()}`);
  });
  await page.getByRole("button", { name: "Place selected module at route view" }).click();
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

  await page.getByRole("button", { name: "Clear all…" }).click();
  let confirmDialog = page.getByRole("dialog", { name: "Clear every placed module?" });
  await expect(confirmDialog).toBeVisible();
  await expect(confirmDialog).toContainText("editor undo stack");
  await expect(confirmDialog.getByRole("button", { name: "Clear all", exact: true })).toBeFocused();
  await confirmDialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(confirmDialog).toHaveCount(0);
  await expect(page.getByText("5 modules", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Clear all…" }).click();
  confirmDialog = page.getByRole("dialog", { name: "Clear every placed module?" });
  await expect(confirmDialog).toBeVisible();
  await confirmDialog.getByRole("button", { name: "Clear all", exact: true }).click();
  await expect(page.getByText("0 modules", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(page.getByText("5 modules", { exact: true })).toBeVisible();
});

test("saved-track deletion requires explicit irreversible-loss confirmation", async ({ page }) => {
  page.on("dialog", (dialog) => {
    throw new Error(`Native dialog should not open for saved-track deletion: ${dialog.message()}`);
  });
  const name = `Delete Guard ${Date.now()}`;
  await page.getByLabel("Track name").fill(name);
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.locator("footer.editor-status output")).toHaveText("Track saved locally.");
  await page.getByRole("button", { name: "Library", exact: true }).click();
  const saved = page.locator(".library-drawer article").filter({ hasText: name });
  const remove = saved.getByRole("button", { name: `Delete ${name}…`, exact: true });

  await remove.click();
  let confirmDialog = page.getByRole("dialog", { name: `Delete “${name}”?` });
  await expect(confirmDialog).toBeVisible();
  await expect(confirmDialog).toContainText("Export it first");
  await expect(confirmDialog).toContainText("cannot be undone");
  await expect(confirmDialog.getByRole("button", { name: "Delete track", exact: true })).toBeFocused();
  await confirmDialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(confirmDialog).toHaveCount(0);
  await expect(saved).toBeVisible();

  await remove.click();
  confirmDialog = page.getByRole("dialog", { name: `Delete “${name}”?` });
  await expect(confirmDialog).toBeVisible();
  await confirmDialog.getByRole("button", { name: "Delete track", exact: true }).click();
  await expect(saved).toHaveCount(0);
  await expect(page.locator("footer.editor-status output")).toContainText("was removed from this device");
});

test("lap values one through nine start races with the selected lap contract", async ({ page }) => {
  test.setTimeout(90_000);
  const laps = page.getByLabel("Laps");

  for (let value = 1; value <= 9; value += 1) {
    await laps.fill(String(value));
    await expect(laps).toHaveValue(String(value));
    await page.getByRole("button", { name: "Test Ride", exact: true }).click();
    await expect(page.locator(".game-canvas")).toBeVisible({ timeout: 15_000 });
    await expect(page.locator(".timing-block")).toContainText(`Lap 1 / ${value}`);
    await page.evaluate(() => window.__RRR_QA__?.openEditor());
    await expect(page.getByLabel(/Interactive 3D track build camera/)).toBeVisible();
  }
});

test("Rider School ignores the previous editor Test Ride course", async ({ page }) => {
  test.setTimeout(60_000);
  await page.getByRole("button", { name: "Test Ride", exact: true }).click();
  const customRace = page.getByLabel("Live 3D race on Canyon Workshop");
  await expect(customRace).toBeVisible();
  await expect(customRace).toHaveAttribute("data-environment-asset", "not-applicable");
  await expect(customRace).not.toHaveAttribute("data-environment-fallback-reason", /.+/);
  await expect(customRace).not.toHaveAttribute("data-environment-load-ms", /.+/);
  await expect(customRace).not.toHaveAttribute("data-environment-width", /.+/);
  await expect(customRace).not.toHaveAttribute("data-environment-height", /.+/);
  await expect(customRace).toHaveAttribute("data-cooling-gate-venue-pocket-count", "0");
  await expect(customRace).toHaveAttribute("data-cooling-gate-venue-style", "alternating-only");
  await expect(customRace).toHaveAttribute("data-cooling-gate-watchtower-count", "0");
  await expect(customRace).toHaveAttribute("data-cooling-gate-watchtower-style", "none");
  await expect(customRace).toHaveAttribute("data-cooling-gate-watchtower-spectator-count", "0");
  await expect(customRace).toHaveAttribute("data-festival-pocket-style", "flat");
  await expect(customRace).toHaveAttribute("data-festival-pocket-tier-count", "0");
  await expect(customRace).toHaveAttribute("data-festival-pocket-tier-rows", "0");
  await expect(customRace).toHaveAttribute("data-course-edge-safety-style", "authored-excluded");
  await expect(customRace).toHaveAttribute("data-start-grid-style", "authored-excluded");
  await expect(customRace).toHaveAttribute("data-start-grid-stencil-count", "0");
  await expect(customRace).toHaveAttribute("data-start-grid-batch-count", "0");
  await expect(customRace).toHaveAttribute("data-course-edge-safety-batch-count", "0");
  await expect(customRace).toHaveAttribute("data-course-edge-safety-block-count", "0");
  await expect(page.locator(".game-shell")).toHaveAttribute("data-race-gate-phase", "racing", { timeout: 15_000 });
  await customRace.press("Escape");
  await page.getByRole("button", { name: "Festival menu", exact: true }).click();

  await page.getByRole("button", { name: "Rider School", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Rider school" })).toBeVisible();
  const tutorialRace = page.getByLabel("Live 3D race on Canyon Kickoff");
  await expect(tutorialRace).toBeVisible();
  await expect(tutorialRace).toHaveAttribute("data-cooling-gate-venue-pocket-count", "2");
  await expect(tutorialRace).toHaveAttribute("data-cooling-gate-venue-style", "bilateral");
  await expect(tutorialRace).toHaveAttribute("data-cooling-gate-watchtower-count", "2");
  await expect(tutorialRace).toHaveAttribute(
    "data-cooling-gate-watchtower-style",
    "staffed-elevated",
  );
  await expect(tutorialRace).toHaveAttribute(
    "data-cooling-gate-watchtower-spectator-count",
    /^(4|6|8)$/,
  );
  await expect(tutorialRace).toHaveAttribute("data-festival-pocket-style", "tiered-canyon");
  await expect(tutorialRace).toHaveAttribute("data-festival-pocket-tier-count", /^[1-9]\d*$/);
  await expect(tutorialRace).toHaveAttribute("data-festival-pocket-tier-rows", /^[2-4]$/);
  await expect(tutorialRace).toHaveAttribute("data-course-edge-safety-style", "continuous-canyon");
  await expect(tutorialRace).toHaveAttribute("data-start-grid-style", "numbered-four-lane");
  await expect(tutorialRace).toHaveAttribute("data-start-grid-stencil-count", "4");
  await expect(tutorialRace).toHaveAttribute("data-start-grid-batch-count", "2");
  await expect(tutorialRace).toHaveAttribute("data-course-edge-safety-batch-count", "1");
  await expect(page.getByLabel("Live 3D race on Canyon Workshop")).toHaveCount(0);
});

test("narrow editor keeps its complete authoring and recovery controls reachable", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  for (const name of ["Save", "Test Ride", "Export", "Import"]) {
    await expect(page.getByRole("button", { name, exact: true })).toBeVisible();
  }
  await expect(page.getByLabel("Placed module")).toBeVisible();
  await expect(page.getByLabel("Laps")).toBeVisible();
  await expect(page.getByRole("button", { name: "Clear all…" })).toBeVisible();
  await expect(page.locator(".validation-panel").getByText("✓ Route complete", { exact: true })).toBeVisible();
  await expect(page.locator(".editor-status output")).toBeVisible();
  const testRide = page.getByRole("button", { name: "Test Ride", exact: true });
  const testRideBox = await testRide.boundingBox();
  expect(testRideBox).not.toBeNull();
  expect((testRideBox?.x ?? 0) + (testRideBox?.width ?? 391)).toBeLessThanOrEqual(390);
});

test("invalid tracks show actionable errors and block save and export", async ({ page }) => {
  page.on("dialog", (dialog) => {
    throw new Error(`Native dialog should not open for invalid-track clear-all: ${dialog.message()}`);
  });
  await page.getByRole("button", { name: "Clear all…" }).click();
  const confirmDialog = page.getByRole("dialog", { name: "Clear every placed module?" });
  await expect(confirmDialog).toBeVisible();
  await confirmDialog.getByRole("button", { name: "Clear all", exact: true }).click();

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

test("import keeps a maximum-length source name valid when creating its local copy", async ({ page }) => {
  const example = EXAMPLE_TRACKS[0];
  if (!example) throw new Error("An editor example is required for the name-boundary fixture.");
  const sourceName = "R".repeat(42);

  await page.locator('input[type="file"]').setInputFiles(filePayload("maximum-name.json", {
    ...example,
    name: sourceName,
  }));

  await expect(page.locator("footer.editor-status output")).toHaveText("Track imported as a safe local copy.");
  await expect(page.getByLabel("Track name")).toHaveValue(`${"R".repeat(37)} Copy`);
  await expect(page.getByText("✓ Route complete", { exact: true }).first()).toBeVisible();
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.locator("footer.editor-status output")).toHaveText("Track saved locally.");
});

test("a valid saved circuit containing every module completes its authored gates and laps", async ({ page }) => {
  test.setTimeout(180_000);
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
  await expect(page.locator(".game-canvas")).toBeVisible({ timeout: 15_000 });
  await expect(page.locator(".game-shell")).toHaveAttribute("data-race-gate-phase", "racing", { timeout: 20_000 });
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
  await page.getByRole("button", { name: "Return to Track Builder", exact: true }).click();
  await expect(page.getByLabel("Track name")).toHaveValue("All Modules Circuit Copy");
  await expect(page.getByText(`${allModuleTrack().modules.length} modules`, { exact: true })).toBeVisible();
});

test("all three bundled editor examples complete test rides", async ({ page }) => {
  test.setTimeout(300_000);
  await page.goto("/?qa-fast-race=1");
  await page.getByRole("button", { name: "Track Builder", exact: true }).click();

  for (const example of EXAMPLE_TRACKS) {
    await page.getByRole("button", { name: "Library", exact: true }).click();
    const card = page.locator(".library-drawer article").filter({ hasText: example.name });
    await expect(card).toBeVisible();
    await card.getByRole("button", { name: "Open", exact: true }).click();
    await page.getByRole("button", { name: "Test Ride", exact: true }).click();
    await expect(page.locator(".game-canvas")).toBeVisible({ timeout: 15_000 });
    await expect(page.locator(".game-shell")).toHaveAttribute("data-race-gate-phase", "racing", { timeout: 20_000 });
    await page.keyboard.down("w");
    await page.keyboard.down("Space");
    await expect(page.getByRole("button", { name: "Retry now" })).toBeVisible({ timeout: 75_000 });
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
    schemaVersion: 3,
  }));
  await expect(status).toHaveText(
    "Saved custom tracks use a newer schema version and cannot be overwritten by this build.",
  );

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

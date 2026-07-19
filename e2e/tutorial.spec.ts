import { expect, test } from "@playwright/test";

async function expectRiderSchoolReady(page: import("@playwright/test").Page): Promise<void> {
  await expect(page.getByRole("heading", { name: "Rider school" })).toBeVisible({
    timeout: 15_000,
  });
}

async function useLowTutorialQuality(page: import("@playwright/test").Page): Promise<void> {
  await page.getByRole("button", { name: "Settings and controls" }).click();
  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
  await page.getByRole("button", { name: "play", exact: true }).click();
  await page.locator("label.select-row", { hasText: "Quality" }).locator("select").selectOption("low");
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await expectRiderSchoolReady(page);
}

function displayedTimeMs(value: string): number {
  const [minutes = "0", remainder = "0"] = value.split(":");
  const [seconds = "0", hundredths = "0"] = remainder.split(".");
  return Number(minutes) * 60_000 + Number(seconds) * 1_000 + Number(hundredths) * 10;
}

test("the paused tutorial intro adapts to touch before movement", async ({ page }, testInfo) => {
  test.skip(
    !["mobile-chrome", "tablet-chrome"].includes(testInfo.project.name),
    "Touch intro gate runs in phone and wide-tablet projects",
  );

  await page.goto("/");
  await expectRiderSchoolReady(page);
  await expect(page.getByLabel("Current controls")).toContainText("RIDE");
  await expect(page.getByLabel("Current controls")).toContainText("← / → rocker");
  await expect(page.locator(".input-device")).toHaveText("Touch controls");
});

test("the paused tutorial intro adapts to gamepad before movement", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "Synthetic gamepad intro gate runs once in Chromium");
  await page.addInitScript(() => {
    const buttons = Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 }));
    const pad = {
      axes: [0, 0, 0, 0],
      buttons,
      connected: true,
      id: "QA standard gamepad",
      index: 0,
      mapping: "standard",
      timestamp: 1,
      vibrationActuator: null,
    };
    Object.defineProperty(navigator, "getGamepads", { configurable: true, value: () => [pad] });
    Object.defineProperty(window, "__QA_GAMEPAD_BUTTONS__", { value: buttons });
  });

  await page.goto("/");
  await expectRiderSchoolReady(page);
  await page.evaluate(() => {
    const buttons = (window as Window & { __QA_GAMEPAD_BUTTONS__: Array<{ pressed: boolean; touched: boolean; value: number }> }).__QA_GAMEPAD_BUTTONS__;
    if (buttons[0]) Object.assign(buttons[0], { pressed: true, touched: true, value: 1 });
  });
  await expect(page.getByLabel("Current controls")).toContainText("A / RT");
  await expect(page.getByLabel("Current controls")).toContainText("D-pad or left stick");
  await expect(page.locator(".input-device")).toHaveText("Gamepad controls");
});

test("Rider School Settings preserves the intro and paused lesson session", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "Tutorial Settings lifecycle gate runs once in Chromium");
  test.setTimeout(120_000);

  await page.goto("/");
  await expectRiderSchoolReady(page);
  const canvas = page.getByLabel("Live 3D race on Canyon Kickoff");
  const clock = page.locator(".timing-block > strong");
  const introSettings = page.getByRole("button", { name: "Settings and controls" });
  await canvas.evaluate((element) => element.setAttribute("data-e2e-tutorial-session", "preserved"));

  await introSettings.click();
  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
  await expect(page.locator(".game-shell")).toHaveAttribute("inert", "");
  await expect(page.locator(".game-shell")).toHaveAttribute("aria-hidden", "true");
  await page.getByRole("button", { name: "play", exact: true }).click();
  const recoverBinding = page.getByRole("button", { name: "Remap Recover, currently Space" });
  await recoverBinding.click();
  await page.keyboard.press("r");
  await page.getByRole("button", { name: "Done", exact: true }).click();

  await expectRiderSchoolReady(page);
  await expect(introSettings).toBeFocused();
  await expect(page.getByLabel("Current controls")).toContainText("Hold R");
  await expect(clock).toHaveText("00:00.00");
  await expect(canvas).toHaveAttribute("data-e2e-tutorial-session", "preserved");

  await page.getByRole("button", { name: "Start lesson 1" }).click();
  await canvas.focus();
  await page.keyboard.down("w");
  await expect(clock).not.toHaveText("00:00.00");
  await page.keyboard.up("w");
  await page.keyboard.press("Escape");
  const pauseDialog = page.getByRole("dialog", { name: "Training paused" });
  await expect(pauseDialog).toBeVisible();
  const pausedTime = await clock.textContent();
  const pausedPosition = await canvas.getAttribute("data-tutorial-forward-position");

  await pauseDialog.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
  await expect(page.locator(".game-shell")).toHaveAttribute("inert", "");
  await page.getByRole("button", { name: "Done", exact: true }).click();

  await expect(pauseDialog).toBeVisible();
  await expect(pauseDialog.getByRole("button", { name: "Resume lesson" })).toBeFocused();
  await expect(clock).toHaveText(pausedTime ?? "");
  await expect(canvas).toHaveAttribute("data-tutorial-forward-position", pausedPosition ?? "");
  await expect(canvas).toHaveAttribute("data-e2e-tutorial-session", "preserved");
});

test("a later lesson requires fresh evidence after it becomes active", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "Lesson-boundary regression runs once in Chromium");
  test.setTimeout(120_000);

  await page.goto("/");
  await expectRiderSchoolReady(page);
  await useLowTutorialQuality(page);
  await page.getByRole("button", { name: "Start lesson 1" }).click();
  const canvas = page.getByLabel("Live 3D race on Canyon Kickoff");
  await canvas.focus();

  await page.keyboard.press("ArrowLeft");
  await expect(canvas).toHaveAttribute("data-demonstrated-mechanics", /laneChange/);
  await page.keyboard.down("w");
  await page.keyboard.down("Shift");
  await expect(page.getByRole("heading", { name: "Coast to slow" })).toBeVisible({ timeout: 10_000 });
  await expect(page.locator(".tutorial-control")).toHaveText("Release W and Left Shift");
  await page.keyboard.up("w");
  await page.waitForTimeout(750);
  await expect(page.getByRole("heading", { name: "Coast to slow" })).toBeVisible();
  await page.keyboard.up("Shift");
  await expect(page.getByRole("heading", { name: "Choose a lane" })).toBeVisible({ timeout: 10_000 });
  await expect(canvas).toHaveAttribute("data-tutorial-lesson-index", "2");
  await expect(canvas).toHaveAttribute("data-tutorial-lesson-complete", "false");

  await page.waitForTimeout(750);
  await expect(page.getByRole("heading", { name: "Choose a lane" })).toBeVisible();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("heading", { name: "Turbo and heat" })).toBeVisible({ timeout: 10_000 });
});

test("a missed one-shot obstacle can retry the active lesson without losing earlier credit", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "Tutorial retry regression runs once in Chromium");
  test.setTimeout(300_000);

  await page.goto("/");
  await expectRiderSchoolReady(page);
  await page.getByRole("button", { name: "Skip training" }).click();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "play", exact: true }).click();
  await page.locator("label.select-row", { hasText: "Quality" }).locator("select").selectOption("low");
  const bindings = page.getByLabel("Keyboard bindings");
  const recoverBinding = bindings.locator("div").filter({ hasText: /^recover/ }).getByRole("button");
  const pauseBinding = bindings.locator("div").filter({ hasText: /^pause/ }).getByRole("button");
  await recoverBinding.click();
  await page.keyboard.press("r");
  await pauseBinding.click();
  await page.keyboard.press("Space");
  await expect(pauseBinding).toHaveText("Space");
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await page.getByRole("button", { name: "Rider School", exact: true }).click();
  await page.getByRole("button", { name: "Start lesson 1" }).click();
  const canvas = page.getByLabel("Live 3D race on Canyon Kickoff");
  await canvas.focus();

  await page.keyboard.down("w");
  await expect(page.getByRole("heading", { name: "Coast to slow" })).toBeVisible({ timeout: 10_000 });
  await page.keyboard.up("w");
  await expect(page.getByRole("heading", { name: "Choose a lane" })).toBeVisible({ timeout: 10_000 });
  await page.keyboard.press("ArrowLeft");
  await expect(page.getByRole("heading", { name: "Turbo and heat" })).toBeVisible({ timeout: 10_000 });
  await page.keyboard.down("w");
  await page.keyboard.down("Shift");
  await expect(page.locator(".tutorial-card > .tutorial-caption-cue")).toContainText("Heat critical", { timeout: 40_000 });
  await page.keyboard.up("Shift");
  await expect(page.getByRole("heading", { name: "Cool the bike" })).toBeVisible({ timeout: 10_000 });
  await expect(page.getByRole("heading", { name: "Wheelie the bump" })).toBeVisible({ timeout: 20_000 });

  // Later checkpoint/landing cues can replace the brief bump caption; crossing
  // the obstacle without its clear event is the durable missed-lesson proof.
  await expect.poll(
    async () => Number(await canvas.getAttribute("data-tutorial-forward-position")),
    { timeout: 20_000 },
  ).toBeGreaterThan(310);
  await page.keyboard.up("w");
  await expect(page.getByRole("heading", { name: "Wheelie the bump" })).toBeVisible();
  await expect(canvas).not.toHaveAttribute("data-tutorial-events", /trainingBumpClearedInWheelie/);
  for (let lesson = 1; lesson <= 5; lesson += 1) {
    await expect(page.getByRole("listitem", { name: `Lesson ${lesson}: completed` })).toHaveText("✓");
  }
  await expect(page.getByRole("listitem", { name: "Lesson 6: current" }).locator("[data-ui-icon='play']")).toBeVisible();

  const retryLesson = page.getByRole("button", { name: "Retry this lesson" });
  const timeBeforeRetry = displayedTimeMs(
    await page.locator(".timing-block > strong").innerText(),
  );
  await retryLesson.focus();
  await page.keyboard.press("Space");
  await expect(page.locator(".tutorial-notice")).toContainText("Earlier lesson credit is preserved");
  const timeAfterRetry = displayedTimeMs(
    await page.locator(".timing-block > strong").innerText(),
  );
  expect(timeAfterRetry).toBeLessThan(3_000);
  expect(timeAfterRetry).toBeLessThan(timeBeforeRetry);
  await expect(canvas).toHaveAttribute("data-tutorial-forward-position", "0.0");
  await expect(canvas).toHaveAttribute("data-tutorial-lesson-index", "5");
  await expect(canvas).toHaveAttribute("data-tutorial-lesson-signals", "");
  for (let lesson = 1; lesson <= 5; lesson += 1) {
    await expect(page.getByRole("listitem", { name: `Lesson ${lesson}: completed` })).toHaveText("✓");
  }

  await canvas.focus();
  await page.keyboard.down("w");
  await expect.poll(async () => Number(await canvas.getAttribute("data-tutorial-forward-position")), {
    timeout: 90_000,
  }).toBeGreaterThan(260);
  await page.keyboard.down("ArrowUp");
  await expect(canvas).toHaveAttribute("data-tutorial-events", /trainingBumpClearedInWheelie/, { timeout: 20_000 });
  await expect(page.getByRole("heading", { name: "Shape the jump" })).toBeVisible({ timeout: 10_000 });
  await page.keyboard.up("ArrowUp");
  await page.keyboard.up("w");
});

test("a new rider completes the comprehensive tutorial without skipping", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "Interactive tutorial gate runs once in Chromium");
  test.setTimeout(300_000);

  await page.goto("/");
  await expectRiderSchoolReady(page);
  await useLowTutorialQuality(page);
  await expect(page.getByText("12 lessons + 2 contact drills", { exact: false })).toBeVisible();
  await expect(page.getByLabel("Current controls")).toContainText("← Left / → Right");
  await expect(page.getByLabel("Current controls")).toContainText("↑ Up / ↓ Down");
  await expect(page.getByText("Pause freezes the lesson", { exact: false })).toBeVisible();
  await expect(page.locator(".timing-block > strong")).toHaveText("00:00.00");
  await page.waitForTimeout(600);
  await expect(page.locator(".timing-block > strong")).toHaveText("00:00.00");

  await page.getByRole("button", { name: "Start lesson 1" }).click();
  await expect(page.getByRole("heading", { name: "Ride and read the HUD" })).toBeVisible();
  await expect(page.locator(".timing-block")).toContainText("Lap 1 / 1");
  await expect(page.getByRole("listitem", { name: "Lesson 1: current" }).locator("[data-ui-icon='play']")).toBeVisible();
  await expect(page.getByRole("button", { name: "Enter the festival" })).toHaveCount(0);

  const canvas = page.getByLabel("Live 3D race on Canyon Kickoff");
  await canvas.focus();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Training paused" })).toBeVisible();
  await page.evaluate(() => window.dispatchEvent(new KeyboardEvent("keydown", {
    bubbles: true,
    code: "Escape",
    repeat: true,
  })));
  await expect(page.getByRole("dialog", { name: "Training paused" })).toBeVisible();
  await expect(page.locator(".game-surface")).toHaveAttribute("inert", "");
  await expect(page.locator(".game-surface")).toHaveAttribute("aria-hidden", "true");
  await expect(page.getByRole("button", { name: "Resume lesson" })).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(page.getByRole("button", { name: "Skip training and return to festival" })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "Resume lesson" })).toBeFocused();
  await page.getByRole("button", { name: "Restart training" }).click();
  await expect(page.getByRole("heading", { name: "Ride and read the HUD" })).toBeVisible();
  await expect(page.locator(".game-surface")).not.toHaveAttribute("inert", "");
  await expect(canvas).toBeFocused();

  await page.keyboard.down("Shift");
  await page.waitForTimeout(500);
  await expect(page.getByRole("heading", { name: "Ride and read the HUD" })).toBeVisible();
  await page.keyboard.up("Shift");
  await page.keyboard.down("w");
  await page.keyboard.down("ArrowUp");
  await expect(page.getByRole("heading", { name: "Coast to slow" })).toBeVisible({ timeout: 10_000 });
  await expect(canvas).toHaveAttribute("data-demonstrated-mechanics", /wheelie/, { timeout: 10_000 });
  await expect(page.getByRole("listitem", { name: "Lesson 1: completed" })).toHaveText("✓");
  await expect(page.getByRole("listitem", { name: "Lesson 2: current" }).locator("[data-ui-icon='play']")).toBeVisible();
  await page.keyboard.up("ArrowUp");
  await expect(canvas).toHaveAttribute("data-tutorial-lesson-index", "1");
  await expect(canvas).toHaveAttribute("data-tutorial-lesson-complete", "false");
  await page.waitForTimeout(700);
  await expect(page.getByRole("heading", { name: "Coast to slow" })).toBeVisible();
  await expect(canvas).toHaveAttribute("data-tutorial-lesson-complete", "false");
  await page.keyboard.up("w");
  await expect(page.getByRole("heading", { name: "Choose a lane" })).toBeVisible({ timeout: 10_000 });

  await page.keyboard.press("ArrowLeft");
  await expect(page.getByRole("heading", { name: "Turbo and heat" })).toBeVisible({ timeout: 10_000 });
  await page.keyboard.down("w");
  await page.keyboard.down("Shift");
  await expect(page.locator(".tutorial-card > .tutorial-caption-cue")).toContainText("Heat critical", { timeout: 40_000 });
  await page.keyboard.up("Shift");
  await expect(canvas).toHaveAttribute("data-demonstrated-mechanics", /criticalHeatReached/);
  await expect(page.getByRole("heading", { name: "Cool the bike" })).toBeVisible({ timeout: 10_000 });
  await expect(page.locator(".heat-meter")).not.toHaveClass(/overheated/);
  await expect(canvas).toHaveAttribute("data-demonstrated-mechanics", /coolingRelease/, { timeout: 20_000 });

  await expect(page.getByRole("heading", { name: "Wheelie the bump" })).toBeVisible({ timeout: 20_000 });
  await expect(canvas).not.toHaveAttribute("data-tutorial-events", /trainingBumpClearedInWheelie/);
  await page.waitForTimeout(700);
  await expect(page.getByRole("heading", { name: "Wheelie the bump" })).toBeVisible();
  await page.keyboard.down("ArrowUp");
  await expect(canvas).toHaveAttribute("data-tutorial-lesson-complete", "true", { timeout: 20_000 });
  await expect(page.locator(".tutorial-card > .tutorial-caption-cue")).toContainText(
    "Front wheel clear",
  );
  await expect(page.getByRole("heading", { name: "Shape the jump" })).toBeVisible({ timeout: 10_000 });
  await expect(canvas).toHaveAttribute("data-demonstrated-mechanics", /airbornePitchUp/, { timeout: 20_000 });
  await page.keyboard.up("ArrowUp");
  await page.keyboard.down("ArrowDown");
  await expect(canvas).toHaveAttribute("data-demonstrated-mechanics", /airbornePitchDown/, { timeout: 10_000 });
  await page.keyboard.up("ArrowDown");
  await expect(canvas).toHaveAttribute("data-demonstrated-mechanics", /airborneNeutral/, { timeout: 10_000 });

  await expect(page.getByRole("heading", { name: "Land both wheels" })).toBeVisible({ timeout: 10_000 });
  await expect(page.getByRole("heading", { name: "Read or clear the barrier" })).toBeVisible({ timeout: 20_000 });
  await expect(canvas).toHaveAttribute("data-tutorial-events", /choiceBarrierAvoided/, { timeout: 20_000 });
  await expect(page.getByRole("heading", { name: "Mud slowdown" })).toBeVisible({ timeout: 10_000 });
  await expect(page.getByRole("heading", { name: "Track edges" })).toBeVisible({ timeout: 20_000 });
  await expect(canvas).toHaveAttribute("data-tutorial-events", /grassSlowdownExperienced/, { timeout: 30_000 });
  await expect(canvas).not.toHaveAttribute("data-tutorial-events", /grassReturnedToDirt/);
  await page.waitForTimeout(600);
  await expect(page.getByRole("heading", { name: "Track edges" })).toBeVisible();
  await expect(canvas).not.toHaveAttribute("data-tutorial-events", /grassReturnedToDirt/);
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("heading", { name: "Crash and recover" })).toBeVisible({ timeout: 20_000 });
  await expect(canvas).toHaveAttribute("data-tutorial-events", /grassReturnedToDirt/);
  await expect(canvas).toHaveAttribute("data-demonstrated-mechanics", /crash/, { timeout: 40_000 });
  await expect(canvas).toHaveAttribute("data-tutorial-events", /recoveryBarrierCrash/, { timeout: 40_000 });
  await expect(canvas).not.toHaveAttribute("data-tutorial-events", /recoveryBarrierRecovered/);

  await page.keyboard.down("Shift");
  await page.keyboard.down("Space");
  await expect(page.getByRole("heading", { name: "Rival contact" })).toBeVisible({ timeout: 15_000 });
  const contactProgress = page.getByRole("list", { name: /Contact rule progress/ });
  await expect(contactProgress.getByRole("listitem", { name: "Contact drill 1: current" }).locator("[data-ui-icon='play']")).toBeVisible();
  await expect(contactProgress.getByRole("listitem", { name: "Contact drill 2: not started" })).toHaveText("2");
  await expect(canvas).toHaveAttribute("data-tutorial-events", /recoveryBarrierRecovered/);
  const drillPosition = await canvas.getAttribute("data-tutorial-forward-position");
  const drillTime = await page.locator(".timing-block > strong").textContent();
  await page.waitForTimeout(1_200);
  await expect(canvas).toHaveAttribute("data-tutorial-forward-position", drillPosition ?? "");
  await expect(page.locator(".timing-block > strong")).toHaveText(drillTime ?? "");
  await expect(canvas).toHaveAttribute(
    "data-demonstrated-mechanics",
    /rideAtUsableSpeed.*coast.*cooling.*coolingRelease.*laneChange.*wheelie.*airbornePitch.*airbornePitchUp.*airbornePitchDown.*airborneNeutral.*cleanLanding.*hazardAvoided.*mud.*grass.*crash.*recovery/,
  );

  await page.getByRole("button", { name: "Rider ahead crashes" }).click();
  await expect(page.getByRole("alert")).toContainText("hits from behind crashes");
  await page.getByRole("button", { name: "I crash" }).click();
  await expect(page.getByRole("heading", { name: "Rear-wheel defense" })).toBeVisible();
  await expect(contactProgress.getByRole("listitem", { name: "Contact drill 1: completed" })).toHaveText("✓");
  await expect(contactProgress.getByRole("listitem", { name: "Contact drill 2: current" }).locator("[data-ui-icon='play']")).toBeVisible();
  await page.getByRole("button", { name: "I crash" }).click();
  await expect(page.getByRole("alert")).toContainText("pursuer");
  await page.getByRole("button", { name: "Pursuer crashes" }).click();
  await expect(page.getByRole("heading", { name: "Race fair, ride bold" })).toBeVisible();
  await expect(contactProgress.getByRole("listitem", { name: "Contact drill 1: completed" })).toHaveText("✓");
  await expect(contactProgress.getByRole("listitem", { name: "Contact drill 2: completed" })).toHaveText("✓");
  const recapPosition = await canvas.getAttribute("data-tutorial-forward-position");
  const recapTime = await page.locator(".timing-block > strong").textContent();
  await page.waitForTimeout(1_200);
  await expect(canvas).toHaveAttribute("data-tutorial-forward-position", recapPosition ?? "");
  await expect(page.locator(".timing-block > strong")).toHaveText(recapTime ?? "");
  await page.keyboard.up("Space");
  await page.keyboard.up("Shift");
  await page.keyboard.up("w");
  const controlRecap = page.getByLabel("Control recap");
  await expect(controlRecap).toContainText("W");
  await expect(controlRecap).toContainText("Shift");
  await expect(controlRecap).toContainText("← Left / → Right");
  await expect(controlRecap).toContainText("↑ Up / ↓ Down");
  await expect(controlRecap).toContainText("Space");
  await expect(controlRecap).toContainText("Esc");
  expect(displayedTimeMs(recapTime ?? "99:59.99")).toBeLessThan(180_000);
  await page.getByRole("button", { name: "Enter the festival" }).click();
  await expect(page.getByRole("button", { name: "Ride", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Rider School", exact: true }).click();
  await expectRiderSchoolReady(page);
});

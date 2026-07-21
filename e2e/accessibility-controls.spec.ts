import { expect, test, type Locator, type Page } from "@playwright/test";

async function completeOnboarding(page: Page, initialPath = "/?qa-fast-race=1"): Promise<void> {
  await page.goto(initialPath);
  const titleScreen = page.locator(".title-screen");
  const ride = titleScreen.getByRole("button", { name: "Ride", exact: true });
  const skip = page.getByRole("button", { name: "Skip training" });
  await expect(ride.or(skip).first()).toBeVisible({ timeout: 15_000 });
  if (await ride.isVisible().catch(() => false)) return;
  await skip.click();
  await expect(ride).toBeVisible();
}

async function clearFocus(page: Page): Promise<void> {
  await page.evaluate(() => {
    let sentinel = document.querySelector<HTMLButtonElement>("[data-qa-focus-start]");
    if (!sentinel) {
      sentinel = document.createElement("button");
      sentinel.dataset.qaFocusStart = "true";
      sentinel.tabIndex = 0;
      sentinel.style.cssText = "position:fixed;width:1px;height:1px;opacity:0;pointer-events:none";
      document.body.prepend(sentinel);
    }
    sentinel.focus({ preventScroll: true });
  });
}

async function finishRaceWithPulsedTurbo(page: Page, rideKey = "w", turboKey = "Shift", pitchKey = "Space"): Promise<void> {
  const retryButton = page.getByRole("button", { name: "Retry now" });
  await page.keyboard.down(rideKey);
  await page.keyboard.down(pitchKey);
  try {
    for (let cycle = 0; cycle < 30; cycle += 1) {
      await page.keyboard.down(turboKey);
      await page.waitForTimeout(520);
      await page.keyboard.up(turboKey);
      if (await retryButton.isVisible()) break;
      await page.waitForTimeout(620);
      if (await retryButton.isVisible()) break;
    }
    await expect(retryButton).toBeVisible({ timeout: 75_000 });
  } finally {
    await page.keyboard.up(rideKey);
    await page.keyboard.up(turboKey);
    await page.keyboard.up(pitchKey);
  }
}

async function tabTo(target: Locator, pressTab: () => Promise<void>): Promise<void> {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    await pressTab();
    if (await target.evaluate((element) => element === document.activeElement)) return;
  }
  await expect(target).toBeFocused();
}

async function expectedSettingsReachedIndexedDb(page: Page): Promise<boolean> {
  return page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("rivet-ridge-rally");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const record = await new Promise<{
      value?: {
        accessibility?: {
          reducedMotion?: boolean;
          reducedShake?: boolean;
          highContrast?: boolean;
          captions?: boolean;
          uiScale?: number;
        };
        audio?: { master?: number; music?: number; sfx?: number };
      };
    } | undefined>((resolve, reject) => {
      const request = database
        .transaction("settings", "readonly")
        .objectStore("settings")
        .get("rider-01");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    database.close();
    return record?.value?.accessibility?.reducedMotion === true
      && record.value.accessibility.reducedShake === true
      && record.value.accessibility.highContrast === true
      && record.value.accessibility.captions === false
      && record.value.accessibility.uiScale === 1.4
      && record.value.audio?.master === 0.35
      && record.value.audio.music === 0.25
      && record.value.audio.sfx === 0.65;
  });
}

async function contrastRatioFor(locator: Locator, background = "#061a2e"): Promise<number> {
  return locator.evaluate((element, backgroundColor) => {
    const parseRgb = (value: string) => {
      if (value.startsWith("#")) {
        const hex = value.slice(1);
        const expanded = hex.length === 3
          ? hex.split("").map((part) => `${part}${part}`).join("")
          : hex;
        return [
          Number.parseInt(expanded.slice(0, 2), 16),
          Number.parseInt(expanded.slice(2, 4), 16),
          Number.parseInt(expanded.slice(4, 6), 16),
        ];
      }
      const match = /rgba?\(([^)]+)\)/.exec(value);
      if (!match) return [0, 0, 0];
      return match[1].split(",").slice(0, 3).map((part) => Number.parseFloat(part.trim()));
    };
    const luminance = ([red, green, blue]: number[]) => {
      const channels = [red, green, blue].map((channel) => {
        const normalized = channel / 255;
        return normalized <= 0.03928
          ? normalized / 12.92
          : ((normalized + 0.055) / 1.055) ** 2.4;
      });
      return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
    };
    const foreground = luminance(parseRgb(getComputedStyle(element).color));
    const backdrop = luminance(parseRgb(backgroundColor));
    return (Math.max(foreground, backdrop) + 0.05) / (Math.min(foreground, backdrop) + 0.05);
  }, background);
}

test("keyboard-only menus reach a race and Escape freezes then resumes it", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name.startsWith("mobile") || testInfo.project.name.startsWith("tablet"), "Desktop keyboard journey");
  test.setTimeout(120_000);
  await completeOnboarding(page);
  const pressTab = () => page.keyboard.press(testInfo.project.name === "webkit" ? "Alt+Tab" : "Tab");
  const pressReverseTab = () => page.keyboard.press(testInfo.project.name === "webkit" ? "Alt+Shift+Tab" : "Shift+Tab");

  await clearFocus(page);
  await tabTo(page.getByRole("button", { name: "Ride", exact: true }), pressTab);
  await expect(page.getByRole("button", { name: "Ride", exact: true })).toBeFocused();
  await pressTab();
  await expect(page.getByRole("button", { name: "Track Builder", exact: true })).toBeFocused();
  await pressTab();
  await expect(page.getByRole("button", { name: "Rider School", exact: true })).toBeFocused();
  await pressTab();
  await expect(page.getByRole("button", { name: "Settings", exact: true })).toBeFocused();
  await page.keyboard.press("Enter");

  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
  await clearFocus(page);
  await tabTo(page.getByRole("button", { name: "Close settings" }), pressTab);
  await expect(page.getByRole("button", { name: "Close settings" })).toBeFocused();
  await page.keyboard.press("Enter");

  await clearFocus(page);
  const supportLink = page.getByRole("button", { name: "Support · Privacy · Accessibility", exact: true });
  await tabTo(supportLink, pressTab);
  await expect(supportLink).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "Support & privacy", exact: true })).toBeVisible();
  await clearFocus(page);
  const supportBack = page.getByRole("button", { name: "Back to main menu", exact: true });
  await tabTo(supportBack, pressTab);
  await expect(supportBack).toBeFocused();
  await page.keyboard.press("Enter");

  await clearFocus(page);
  await tabTo(page.getByRole("button", { name: "Ride", exact: true }), pressTab);
  await expect(page.getByRole("button", { name: "Ride", exact: true })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "Canyon Kickoff" })).toBeVisible();

  await clearFocus(page);
  await tabTo(page.getByRole("button", { name: "Back to main menu" }), pressTab);
  await expect(page.getByRole("button", { name: "Back to main menu" })).toBeFocused();
  await pressTab();
  await expect(page.getByRole("button", { name: /^01 Solo Challenge/ })).toBeFocused();
  await pressTab();
  await expect(page.getByRole("button", { name: /Practice/ })).toBeFocused();
  await page.keyboard.press("Enter");

  const canvas = page.getByLabel("Live 3D race on Canyon Kickoff");
  await expect(canvas).toBeVisible();
  await expect(page.locator(".game-shell")).toHaveAttribute(
    "data-race-gate-phase",
    "racing",
    { timeout: 15_000 },
  );
  const clock = page.locator(".timing-block > strong");
  await expect(clock).not.toHaveText("00:00.00");
  await canvas.focus();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Race paused" })).toBeVisible();
  const resume = page.getByRole("button", { name: "Resume", exact: true });
  await expect(resume).toBeFocused();
  await pressReverseTab();
  await expect(page.getByRole("button", { name: "Festival menu" })).toBeFocused();
  await pressTab();
  await expect(resume).toBeFocused();
  await expect(page.locator(".game-shell")).toHaveAttribute("data-paused", "true");
  const frozenTime = await clock.textContent();
  expect(frozenTime).not.toBeNull();
  await page.waitForTimeout(250);
  await expect(clock).toHaveText(frozenTime ?? "");

  await page
    .getByRole("button", { name: "Settings", exact: true })
    .or(page.getByRole("button", { name: "Settings and controls", exact: true }))
    .click();
  await page.getByRole("button", { name: "audio", exact: true }).click();
  await page.getByRole("slider", { name: "master volume" }).fill("0.4");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Race paused" })).toBeVisible();
  await expect(resume).toBeFocused();
  await expect(clock).toHaveText(frozenTime ?? "");

  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Race paused" })).toHaveCount(0);
  await expect(canvas).toBeFocused();
  await expect(page.locator(".game-shell")).toHaveAttribute("data-paused", "false");
  await expect.poll(() => clock.textContent()).not.toBe(frozenTime);
});

test("keyboard remapping rejects conflicts and the accepted binding completes a race", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "Single-browser remapping gate");
  test.setTimeout(120_000);
  await completeOnboarding(page);
  await page
    .getByRole("button", { name: "Settings", exact: true })
    .or(page.getByRole("button", { name: "Settings and controls", exact: true }))
    .click();
  await page.getByRole("button", { name: "play", exact: true }).click();

  const bindings = page.getByLabel("Keyboard bindings");
  const throttle = bindings.locator("div").filter({ hasText: /^throttle/ }).getByRole("button");
  const turbo = bindings.locator("div").filter({ hasText: /^turbo/ }).getByRole("button");
  const pause = bindings.locator("div").filter({ hasText: /^pause/ }).getByRole("button");
  await expect(throttle).toHaveAccessibleName("Remap Ride, currently W");
  await expect(turbo).toHaveAccessibleName("Remap Turbo, currently Left Shift");
  await expect(pause).toHaveAccessibleName("Remap Pause, currently Esc");
  await expect(bindings.getByRole("button", { name: /^Remap Lane left, currently/ })).toBeVisible();
  await throttle.click();
  await expect(throttle).toHaveAccessibleName("Choose a key for Ride");
  await throttle.press("Tab");
  await expect(page.getByRole("alert")).toHaveText("Tab is reserved for menu, browser, or system controls. Choose another key.");
  await expect(throttle).toHaveText("Press a key…");
  await expect(throttle).toBeFocused();
  await throttle.press("q");
  await expect(throttle).toHaveText("Q");
  await expect(throttle).toHaveAccessibleName("Remap Ride, currently Q");

  await turbo.click();
  await turbo.press("q");
  await expect(page.getByRole("alert")).toHaveText("Q is already assigned to Ride. Choose another key.");
  await expect(turbo).toHaveText("Press a key…");
  await turbo.press("e");
  await expect(turbo).toHaveText("E");
  await pause.click();
  await pause.press("p");
  await expect(pause).toHaveText("P");

  await page.getByRole("button", { name: "Done", exact: true }).click();
  await page.getByRole("button", { name: "Ride", exact: true }).click();
  await page.getByRole("button", { name: /Practice/ }).click();
  await expect(page.locator(".game-shell")).toHaveAttribute(
    "data-race-gate-phase",
    "racing",
    { timeout: 15_000 },
  );
  await page.getByLabel("Live 3D race on Canyon Kickoff").focus();
  await page.keyboard.press("p");
  await expect(page.getByRole("dialog", { name: "Race paused" })).toBeVisible();
  await page.keyboard.press("p");
  await expect(page.getByRole("dialog", { name: "Race paused" })).toHaveCount(0);
  await page.keyboard.down("q");
  await page.keyboard.down("e");
  await page.keyboard.down("Space");
  await expect(page.getByRole("button", { name: "Retry now" })).toBeVisible({ timeout: 75_000 });
  await page.keyboard.up("q");
  await page.keyboard.up("e");
  await page.keyboard.up("Space");
});

test("accessibility and volume controls apply immediately and persist", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name.startsWith("mobile") || testInfo.project.name.startsWith("tablet"), "Desktop settings coverage");
  await completeOnboarding(page);
  await page.getByRole("button", { name: "Settings", exact: true }).click();

  const reducedMotion = page.getByRole("checkbox", { name: /^Reduced motion/ });
  const reducedMotionTrack = reducedMotion.locator("xpath=following-sibling::*[contains(@class, 'toggle-track')]");
  const reducedMotionHitArea = await reducedMotion.boundingBox();
  expect(reducedMotionHitArea).not.toBeNull();
  expect(reducedMotionHitArea?.width).toBeGreaterThanOrEqual(44);
  expect(reducedMotionHitArea?.height).toBeGreaterThanOrEqual(44);
  await reducedMotion.focus();
  await page.keyboard.press(testInfo.project.name === "webkit" ? "Alt+Tab" : "Tab");
  await page.keyboard.press(testInfo.project.name === "webkit" ? "Alt+Shift+Tab" : "Shift+Tab");
  await expect(reducedMotion).toBeFocused();
  await expect.poll(() => reducedMotionTrack.evaluate((element) => getComputedStyle(element).outlineStyle)).toBe("solid");
  await expect.poll(() => reducedMotionTrack.evaluate((element) => getComputedStyle(element).outlineWidth)).toBe("3px");
  await reducedMotion.check();
  await page.getByRole("checkbox", { name: /^Reduced screen shake/ }).check();
  await page.getByRole("checkbox", { name: /^High contrast/ }).check();
  await page.getByRole("checkbox", { name: /^Gameplay captions/ }).uncheck();
  await page.getByRole("slider", { name: /^UI scale/ }).fill("1.4");

  const root = page.locator("html");
  await expect(root).toHaveAttribute("data-reduced-motion", "true");
  await expect(root).toHaveAttribute("data-high-contrast", "true");
  await expect(page.getByRole("checkbox", { name: /^Reduced screen shake/ })).toBeChecked();
  await expect(page.getByRole("checkbox", { name: /^Gameplay captions/ })).not.toBeChecked();
  await expect(page.getByText("140%", { exact: true })).toBeVisible();
  await expect.poll(() => root.evaluate((element) => element.style.getPropertyValue("--ui-scale"))).toBe("1.4");
  await expect.poll(() => root.evaluate((element) => getComputedStyle(element).getPropertyValue("--navy").trim())).toBe("#001322");

  await page.getByRole("button", { name: "audio", exact: true }).click();
  await page.getByRole("slider", { name: "master volume" }).fill("0.35");
  await page.getByRole("slider", { name: "music volume" }).fill("0.25");
  await page.getByRole("slider", { name: "sfx volume" }).fill("0.65");
  await expect(page.getByRole("slider", { name: "master volume" })).toHaveValue("0.35");
  await expect(page.getByRole("slider", { name: "music volume" })).toHaveValue("0.25");
  await expect(page.getByRole("slider", { name: "sfx volume" })).toHaveValue("0.65");
  await expect(page.getByText("35%", { exact: true })).toBeVisible();
  await expect(page.getByText("25%", { exact: true })).toBeVisible();
  await expect(page.getByText("65%", { exact: true })).toBeVisible();

  await expect.poll(() => expectedSettingsReachedIndexedDb(page)).toBe(true);
  await page.reload();
  await expect(page.getByRole("button", { name: "Ride", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(page.getByRole("checkbox", { name: /^Reduced motion/ })).toBeChecked();
  await expect(page.getByRole("checkbox", { name: /^Reduced screen shake/ })).toBeChecked();
  await expect(page.getByRole("checkbox", { name: /^High contrast/ })).toBeChecked();
  await expect(page.getByRole("checkbox", { name: /^Gameplay captions/ })).not.toBeChecked();
  await expect(page.getByRole("slider", { name: /^UI scale/ })).toHaveValue("1.4");
  await page.getByRole("button", { name: "audio", exact: true }).click();
  await expect(page.getByRole("slider", { name: "master volume" })).toHaveValue("0.35");
  await expect(page.getByRole("slider", { name: "music volume" })).toHaveValue("0.25");
  await expect(page.getByRole("slider", { name: "sfx volume" })).toHaveValue("0.65");
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await page.setViewportSize({ width: 360, height: 640 });
  await expect(page.getByRole("button", { name: "Ride", exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1);
});

test("locked progression instructions remain readable instead of globally dimmed", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "Single-browser locked-copy contrast gate");
  await completeOnboarding(page);

  const lockedCampaignStop = page.locator(".campaign-stop.locked").first();
  await expect(lockedCampaignStop).toBeVisible();
  await expect(lockedCampaignStop).toBeDisabled();
  const lockedCampaignInstruction = lockedCampaignStop.locator("small");
  await expect(lockedCampaignInstruction).toHaveText("Finish third to unlock");
  await expect.poll(() => lockedCampaignStop.evaluate((element) => getComputedStyle(element).opacity)).toBe("1");
  await expect.poll(() => lockedCampaignStop.evaluate((element) => getComputedStyle(element).filter)).toBe("none");
  await expect.poll(() => lockedCampaignInstruction.evaluate((element) => getComputedStyle(element).opacity)).toBe("1");
  await expect(await contrastRatioFor(lockedCampaignInstruction)).toBeGreaterThanOrEqual(4.5);

  await page.getByRole("button", { name: "Ride", exact: true }).click();
  const lockedRivalMode = page.locator(".mode-row.locked").filter({ hasText: "Rival Main Race" });
  await expect(lockedRivalMode).toBeVisible();
  await expect(lockedRivalMode).toBeDisabled();
  const lockedRivalInstruction = lockedRivalMode.locator(".mode-copy small");
  await expect(lockedRivalInstruction).toHaveText("Beat the Solo Challenge target to unlock.");
  await expect.poll(() => lockedRivalMode.evaluate((element) => getComputedStyle(element).opacity)).toBe("1");
  await expect.poll(() => lockedRivalMode.evaluate((element) => getComputedStyle(element).filter)).toBe("none");
  await expect(await contrastRatioFor(lockedRivalInstruction, "#102842")).toBeGreaterThanOrEqual(4.5);
});

test("captions and critical race state have visible non-color labels", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "Single-browser semantic race gate");
  test.setTimeout(60_000);
  await completeOnboarding(page, "/?qa-fast-race=1&qa-near-overheat=1");
  await page.getByRole("button", { name: "Ride", exact: true }).click();
  await page.getByRole("button", { name: /Practice/ }).click();

  const heat = page.getByRole("meter", { name: /^Heat \d+ percent/ });
  await expect(heat).toBeVisible();
  await expect(heat.getByText("Heat", { exact: true })).toBeVisible();
  await expect.poll(() => heat.locator(".heat-track").evaluate((element) => (
    getComputedStyle(element).getPropertyValue("--heat-warning-threshold").trim()
  ))).toBe("78%");
  await expect(page.getByText("Run", { exact: true })).toBeVisible();
  await expect(page.getByText("Practice", { exact: true })).toBeVisible();
  await expect(page.getByText(/Lap\s+1\s+\/\s+2/)).toBeVisible();
  await expect(page.getByText("Target", { exact: true })).toBeVisible();
  await expect(page.getByText("Free ride", { exact: true })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("data-colorblind-safe", "true");
  await expect.poll(() => page.locator(".heat-track > span").evaluate((element) => getComputedStyle(element).backgroundImage)).toContain("repeating-linear-gradient");

  await page.evaluate(() => {
    for (const code of ["KeyW", "ShiftLeft", "Space"]) {
      window.dispatchEvent(new KeyboardEvent("keydown", { code, bubbles: true, cancelable: true }));
    }
  });
  await expect.poll(() => heat.evaluate((element) => Number(element.getAttribute("aria-valuenow")))).toBeGreaterThanOrEqual(78);
  await expect(heat).toHaveAccessibleName(/Heat \d+ percent/);
  await expect(page.locator(".caption-cue")).toContainText(/Heat critical|Overheated/);
  await expect(page.locator(".race-hint")).toHaveText(
    /Release turbo or line up a cyan cooling gate|Release throttle and coast until controls return|Controls return when heat cools to 35%/,
  );
  await page.evaluate(() => {
    for (const code of ["KeyW", "ShiftLeft", "Space"]) {
      window.dispatchEvent(new KeyboardEvent("keyup", { code, bubbles: true, cancelable: true }));
    }
  });
});

test("renderer accessibility cues toggle live and fixed-step caps report dropped time", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "Single-browser renderer accessibility gate");
  test.setTimeout(75_000);
  const runtimeErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") runtimeErrors.push(`console: ${message.text()}`);
  });
  page.on("pageerror", (error) => runtimeErrors.push(`pageerror: ${error.message}`));
  await completeOnboarding(page);
  await page.getByRole("button", { name: "Ride", exact: true }).click();
  await page.getByRole("button", { name: /Practice/ }).click();

  const canvas = page.getByLabel("Live 3D race on Canyon Kickoff");
  await expect(canvas).toHaveAttribute("data-high-contrast-track-guides", "false");
  await expect(canvas).toHaveAttribute("data-track-guide-count", "5");
  await expect(canvas).toHaveAttribute("data-cooling-cue-shape", "snowflake");
  await expect.poll(async () => Number(await canvas.getAttribute("data-cooling-snowflake-count"))).toBeGreaterThan(0);
  await expect(page.locator(".game-shell")).toHaveAttribute(
    "data-race-gate-phase",
    "racing",
    { timeout: 15_000 },
  );

  await canvas.focus();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("checkbox", { name: /^High contrast/ }).check();
  await expect(canvas).toHaveAttribute("data-high-contrast-track-guides", "true");
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await page.getByRole("button", { name: "Resume", exact: true }).click();

  const performanceOutput = page.getByLabel("Performance metrics");
  await expect.poll(() => performanceOutput.textContent()).toMatch(/\d+ draws · \d+ ms dropped/);
  await page.evaluate(() => {
    const deadline = performance.now() + 180;
    let spin = 0;
    while (performance.now() < deadline) spin += 1;
    return spin;
  });
  await expect.poll(async () => {
    const match = /(\d+) ms dropped/.exec(await performanceOutput.textContent() ?? "");
    return Number(match?.[1] ?? 0);
  }).toBeGreaterThan(0);
  expect(runtimeErrors).toEqual([]);
});

test("mirrored touch controls swap sides without losing accessible labels", async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.startsWith("mobile") && !testInfo.project.name.startsWith("tablet"), "Touch-device journey");
  test.setTimeout(60_000);
  await completeOnboarding(page);
  const settings = page
    .getByRole("button", { name: "Settings", exact: true })
    .or(page.getByRole("button", { name: "Settings and controls", exact: true }));
  await expect(settings).toBeVisible({ timeout: 30_000 });
  await settings.click();
  await page.getByRole("button", { name: "play", exact: true }).click();
  await page.getByRole("checkbox", { name: /^Mirror touch controls/ }).check();
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await page.getByRole("button", { name: "Rider School", exact: true }).click();
  await page.getByRole("button", { name: "Start lesson 1", exact: true }).click();

  const controls = page.getByLabel("Touch race controls");
  await expect(controls).toBeVisible();
  await expect(controls).toHaveClass(/mirrored/);
  await expect(controls).toHaveAttribute("data-touch-icon-set", "rally-pictograms-v1");
  await expect(controls.locator("[data-touch-icon]")).toHaveCount(6);
  await expect(controls.locator("[data-touch-icon] svg[aria-hidden='true']")).toHaveCount(6);
  await expect.poll(() => controls.evaluate((element) => getComputedStyle(element).flexDirection)).toBe("row-reverse");
  await expect(page.getByRole("button", { name: "Move one lane left" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Move one lane right" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Pitch front wheel up" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Pitch front wheel down" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Ride", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Turbo", exact: true })).toBeVisible();

  const steeringBox = await page.locator(".touch-steering").boundingBox();
  const throttleBox = await page.locator(".touch-throttle").boundingBox();
  expect(steeringBox).not.toBeNull();
  expect(throttleBox).not.toBeNull();
  expect(steeringBox?.x ?? 0).toBeGreaterThan(throttleBox?.x ?? Number.POSITIVE_INFINITY);
});

test("320px through 780px race HUD and controls remain separated at 140% UI scale", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "Single-browser narrow geometry gate");
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 320, height: 640 });
  await completeOnboarding(page);
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("slider", { name: /^UI scale/ }).fill("1.4");
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await page.getByRole("button", { name: "Ride", exact: true }).click();
  await page.getByRole("button", { name: /Practice/ }).click();
  await expect(page.locator(".game-shell")).toHaveAttribute(
    "data-race-gate-phase",
    "racing",
    { timeout: 15_000 },
  );

  const assertSeparated = async () => {
    const geometry = await page.evaluate(() => {
      const bounds = (selector: string) => {
        const element = document.querySelector<HTMLElement>(selector);
        if (!element) return null;
        const { x, y, width, height } = element.getBoundingClientRect();
        return width > 0 && height > 0 ? { x, y, width, height } : null;
      };
      const fontSize = (selector: string) => {
        const element = document.querySelector<HTMLElement>(selector);
        return element ? Number.parseFloat(getComputedStyle(element).fontSize) : 0;
      };
      return {
        viewport: { width: window.innerWidth, height: window.innerHeight },
        steering: bounds(".touch-steering"),
        throttle: bounds(".touch-throttle"),
        heat: bounds(".heat-meter"),
        position: bounds(".position-block"),
        timing: bounds(".timing-block"),
        pause: bounds(".pause-button"),
        target: bounds(".target-hud"),
        runFontSize: fontSize(".position-block strong"),
        timingFontSize: fontSize(".timing-block strong"),
        targetFontSize: fontSize(".target-hud strong"),
        touchButtons: Array.from(document.querySelectorAll<HTMLElement>(".touch-controls button")).map((element) => {
          const { width, height } = element.getBoundingClientRect();
          return { width, height };
        }),
      };
    });
    const { viewport, steering, throttle, heat, position, timing, pause, target } = geometry;
    expect(steering).not.toBeNull();
    expect(throttle).not.toBeNull();
    expect(heat).not.toBeNull();
    expect(position).not.toBeNull();
    expect(timing).not.toBeNull();
    expect(pause).not.toBeNull();
    expect(target).not.toBeNull();
    for (const bounds of [steering, throttle, heat, position, timing, pause, target]) {
      expect(bounds?.x ?? -1).toBeGreaterThanOrEqual(0);
      expect((bounds?.x ?? 0) + (bounds?.width ?? viewport.width + 1)).toBeLessThanOrEqual(viewport.width);
      expect(bounds?.y ?? -1).toBeGreaterThanOrEqual(0);
      expect((bounds?.y ?? 0) + (bounds?.height ?? viewport.height + 1)).toBeLessThanOrEqual(viewport.height);
    }
    const overlaps = (first: NonNullable<typeof steering>, second: NonNullable<typeof steering>) => !(
      first.x + first.width <= second.x
      || second.x + second.width <= first.x
      || first.y + first.height <= second.y
      || second.y + second.height <= first.y
    );
    expect(overlaps(steering!, heat!)).toBe(false);
    expect(overlaps(throttle!, heat!)).toBe(false);
    expect(overlaps(position!, timing!)).toBe(false);
    expect(overlaps(timing!, pause!)).toBe(false);
    expect(overlaps(timing!, target!)).toBe(false);
    if (viewport.width === 320) {
      expect(geometry.runFontSize).toBeGreaterThanOrEqual(15);
      expect(geometry.timingFontSize).toBeGreaterThanOrEqual(33);
      expect(geometry.targetFontSize).toBeGreaterThanOrEqual(18);
    }
    expect(geometry.touchButtons).toHaveLength(6);
    for (const button of geometry.touchButtons) {
      expect(button.width).toBeGreaterThanOrEqual(44);
      expect(button.height).toBeGreaterThanOrEqual(44);
    }
  };

  for (const width of [320, 621, 780]) {
    await page.setViewportSize({ width, height: 640 });
    await assertSeparated();
  }
  await page.getByRole("button", { name: "Pause race" }).click();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "play", exact: true }).click();
  await page.getByRole("checkbox", { name: /^Mirror touch controls/ }).check();
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await page.getByRole("button", { name: "Resume", exact: true }).click();
  await expect(page.getByLabel("Touch race controls")).toHaveClass(/mirrored/);
  for (const width of [320, 621, 780]) {
    await page.setViewportSize({ width, height: 640 });
    await assertSeparated();
  }
});

test("short-phone pause dialog stays safe, scrollable, and touch operable at 140% UI scale", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "Single-browser pause geometry gate");
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 320, height: 568 });
  await completeOnboarding(page);
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("slider", { name: /^UI scale/ }).fill("1.4");
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await page.getByRole("button", { name: "Ride", exact: true }).click();
  await page.getByRole("button", { name: /Practice/ }).click();
  await expect(page.locator(".game-shell")).toHaveAttribute(
    "data-race-gate-phase",
    "racing",
    { timeout: 15_000 },
  );
  await page.getByRole("button", { name: "Pause race" }).click();

  const dialog = page.getByRole("dialog", { name: "Race paused" });
  await expect(dialog).toBeVisible();
  const geometry = await dialog.evaluate((element) => {
    const bounds = element.getBoundingClientRect();
    return {
      top: bounds.top,
      right: bounds.right,
      bottom: bounds.bottom,
      left: bounds.left,
      overflowY: getComputedStyle(element).overflowY,
      buttonHeights: Array.from(element.querySelectorAll("button")).map((button) => button.getBoundingClientRect().height),
    };
  });
  expect(geometry.top).toBeGreaterThanOrEqual(0);
  expect(geometry.left).toBeGreaterThanOrEqual(0);
  expect(geometry.right).toBeLessThanOrEqual(320);
  expect(geometry.bottom).toBeLessThanOrEqual(568);
  expect(geometry.overflowY).toBe("auto");
  expect(geometry.buttonHeights).toHaveLength(5);
  for (const height of geometry.buttonHeights) expect(height).toBeGreaterThanOrEqual(44);
});

test("short-phone tutorial retains a touch-scrollable action area at 140% UI scale", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "Single-browser tutorial geometry gate");
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 320, height: 568 });
  await page.goto("/?qa-fast-race=1");
  const tutorial = page.getByLabel("Rider school lesson");
  await expect(tutorial).toBeVisible({ timeout: 15_000 });
  await page.locator("html").evaluate((element) => element.style.setProperty("--ui-scale", "1.4"));

  const geometry = await tutorial.evaluate((element) => {
    const bounds = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    element.scrollTop = element.scrollHeight;
    return {
      top: bounds.top,
      bottom: bounds.bottom,
      height: bounds.height,
      clientHeight: element.clientHeight,
      scrollHeight: element.scrollHeight,
      scrollTop: element.scrollTop,
      touchAction: style.touchAction,
      overscrollBehavior: style.overscrollBehavior,
    };
  });
  expect(geometry.top).toBeGreaterThanOrEqual(0);
  expect(geometry.bottom).toBeLessThanOrEqual(568);
  expect(geometry.height).toBeGreaterThanOrEqual(128);
  expect(geometry.scrollHeight).toBeGreaterThan(geometry.clientHeight);
  expect(geometry.scrollTop).toBeGreaterThan(0);
  expect(geometry.touchAction).toBe("pan-y");
  expect(geometry.overscrollBehavior).toBe("contain");
  const startLesson = tutorial.getByRole("button", { name: "Start lesson 1" });
  await startLesson.scrollIntoViewIfNeeded();
  await expect(startLesson).toBeVisible();
  await startLesson.click();

  const lessonProgress = tutorial.getByRole("list", { name: /Lesson progress/ });
  await lessonProgress.scrollIntoViewIfNeeded();
  await expect(lessonProgress).toBeVisible();
  await expect(lessonProgress.getByRole("listitem")).toHaveCount(12);
  const progressGeometry = await lessonProgress.evaluate((element) => {
    return {
      clientWidth: element.clientWidth,
      scrollWidth: element.scrollWidth,
      markers: Array.from(element.children, (marker) => ({
        clientWidth: marker.clientWidth,
        scrollWidth: marker.scrollWidth,
      })),
    };
  });
  expect(progressGeometry.scrollWidth).toBeLessThanOrEqual(progressGeometry.clientWidth);
  expect(progressGeometry.markers.every((marker) => (
    marker.clientWidth >= 12
    && marker.scrollWidth <= marker.clientWidth
  ))).toBe(true);
  for (const actionName of ["Retry this lesson", "Skip training"]) {
    const action = tutorial.getByRole("button", { name: actionName, exact: true });
    await action.scrollIntoViewIfNeeded();
    await expect(action).toBeVisible();
    const bounds = await action.boundingBox();
    expect(bounds?.width ?? 0).toBeGreaterThanOrEqual(44);
    expect(bounds?.height ?? 0).toBeGreaterThanOrEqual(44);
  }
});

test("tutorial lesson updates use one concise live status region", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "Single-browser assistive text gate");
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto("/?qa-fast-race=1");
  const tutorial = page.getByLabel("Rider school lesson");
  await expect(tutorial).toBeVisible({ timeout: 15_000 });
  await expect(tutorial, "tutorial card should not re-announce every render").not.toHaveAttribute("aria-live");

  const lessonStatus = tutorial.locator(".sr-only[role='status']");
  await expect(lessonStatus).toHaveAttribute("aria-live", "polite");
  await expect(lessonStatus).toHaveAttribute("aria-atomic", "true");
  await expect(lessonStatus).toHaveText("Rider School intro. Twelve lessons and two contact drills.");

  await tutorial.getByRole("button", { name: "Start lesson 1" }).click();
  await expect(lessonStatus).toHaveText(/Lesson 1 of 12: Ride and read the HUD\. active\./);
  await expect(lessonStatus).toContainText("Hold W");
});

test("settings and editor selector buttons expose their selected state", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "Single-browser accessibility semantics gate");
  await page.setViewportSize({ width: 1280, height: 720 });
  await completeOnboarding(page);

  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(page.getByRole("button", { name: "accessibility", pressed: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "audio", pressed: false })).toBeVisible();
  await page.getByRole("button", { name: "audio", pressed: false }).click();
  await expect(page.getByRole("button", { name: "accessibility", pressed: false })).toBeVisible();
  await expect(page.getByRole("button", { name: "audio", pressed: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "play", pressed: false })).toBeVisible();
  await page.getByRole("button", { name: "Done", exact: true }).click();

  await page.getByRole("button", { name: "Track Builder", exact: true }).click();
  await expect(page.getByLabel(/Interactive 3D track build camera/)).toBeVisible();
  const trackCategory = page.locator(".module-categories button", { hasText: "track" });
  const jumpsCategory = page.locator(".module-categories button", { hasText: "jumps" });
  await trackCategory.click();
  await expect(trackCategory).toHaveAttribute("aria-pressed", "true");
  await expect(jumpsCategory).toHaveAttribute("aria-pressed", "false");
  const shortStraight = page.locator(".module-rail button", { hasText: "Short Straight" });
  await shortStraight.click();
  await expect(shortStraight).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".module-rail button", { hasText: "Long Straight" })).toHaveAttribute("aria-pressed", "false");
  await jumpsCategory.click();
  await expect(trackCategory).toHaveAttribute("aria-pressed", "false");
  await expect(jumpsCategory).toHaveAttribute("aria-pressed", "true");
  const mediumRamp = page.locator(".module-rail button", { hasText: "Medium Ramp" });
  await expect(mediumRamp).toHaveAttribute("aria-pressed", "false");
  await mediumRamp.click();
  await expect(mediumRamp).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".module-rail button", { hasText: "Small Ramp" })).toHaveAttribute("aria-pressed", "false");
});

test("chunk loading screens announce the destination instead of stale boot status", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "Single-browser Suspense fallback copy gate");
  let delayedTrackBuilder = false;
  await page.route(/\/assets\/TrackEditorScreen-.*\.js$/, async (route) => {
    delayedTrackBuilder = true;
    await new Promise((resolve) => setTimeout(resolve, 650));
    await route.continue();
  });

  await completeOnboarding(page);
  await page.getByRole("button", { name: "Track Builder", exact: true }).click();
  await expect(page.locator(".boot-screen")).toContainText("Opening Track Builder…");
  await expect(page.locator(".boot-screen")).not.toContainText("Preparing the paddock…");
  await expect(page.getByLabel(/Interactive 3D track build camera/)).toBeVisible();
  expect(delayedTrackBuilder).toBe(true);
});

test("icon-only controls use authored SVG icons instead of platform text glyphs", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "Single-browser authored icon gate");
  test.setTimeout(60_000);
  await completeOnboarding(page);

  await page.getByRole("button", { name: "Ride", exact: true }).click();
  await expect(page.getByRole("button", { name: "Back to main menu" }).locator("[data-ui-icon='back']")).toBeVisible();
  await page.getByRole("button", { name: "Back to main menu" }).click();

  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(page.getByRole("button", { name: "Close settings" }).locator("[data-ui-icon='back']")).toBeVisible();
  await page.getByRole("button", { name: "Close settings" }).click();

  await page.getByRole("button", { name: "Track Builder", exact: true }).click();
  await expect(page.getByRole("button", { name: "Back to festival menu" }).locator("[data-ui-icon='back']")).toBeVisible();
  await expect(page.getByRole("button", { name: "Undo" }).locator("[data-ui-icon='undo']")).toBeVisible();
  await expect(page.getByRole("button", { name: "Redo" }).locator("[data-ui-icon='redo']")).toBeVisible();
  await page.getByRole("button", { name: "Library" }).click();
  await expect(page.getByRole("button", { name: "Close local track library" }).locator("[data-ui-icon='close']")).toBeVisible();
  await page.getByRole("button", { name: "Close local track library" }).click();
  await page.getByRole("button", { name: "Back to festival menu" }).click();

  await page.getByRole("button", { name: "Ride", exact: true }).click();
  await page.getByRole("button", { name: /Practice/ }).click();
  await expect(page.locator(".game-shell")).toHaveAttribute(
    "data-race-gate-phase",
    "racing",
    { timeout: 15_000 },
  );
  const pauseRace = page.getByRole("button", { name: "Pause race" });
  await expect(pauseRace.locator("[data-ui-icon='pause']")).toBeVisible();
  await pauseRace.click();
  const resume = page.getByRole("button", { name: "Resume", exact: true });
  await expect(resume).toBeFocused();
});

test("screen swaps and race settings overlay use reduced-motion-safe transitions", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "Single-browser motion contract");
  test.setTimeout(75_000);

  await completeOnboarding(page);
  await page.getByRole("button", { name: "Ride", exact: true }).click();
  await expect(page.locator(".screen-surface[data-screen-surface='mode-select']")).toBeVisible();
  await expect.poll(() => page.locator(".screen-surface").evaluate((element) => getComputedStyle(element).animationName)).toBe("screen-surface-enter");
  await page.getByRole("button", { name: /Practice/ }).click();
  await expect(page.locator(".game-shell")).toHaveAttribute(
    "data-race-gate-phase",
    "racing",
    { timeout: 15_000 },
  );
  await page.getByRole("button", { name: "Pause race" }).click();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  const overlay = page.locator(".race-settings-overlay");
  await expect(overlay).toBeVisible();
  await expect.poll(() => overlay.evaluate((element) => getComputedStyle(element).animationName)).toBe("settings-overlay-fade");
  await expect.poll(() => overlay.locator(".settings-screen").evaluate((element) => getComputedStyle(element).animationName)).toBe("settings-overlay-panel");
  await page.locator("html").evaluate((element) => { element.dataset.reducedMotion = "true"; });
  await expect.poll(() => overlay.evaluate((element) => getComputedStyle(element).animationName)).toBe("none");
  await expect.poll(() => overlay.locator(".settings-screen").evaluate((element) => getComputedStyle(element).animationName)).toBe("none");

  const reducedPage = await page.context().newPage();
  await reducedPage.emulateMedia({ reducedMotion: "reduce" });
  await completeOnboarding(reducedPage);
  await reducedPage.getByRole("button", { name: "Ride", exact: true }).click();
  await expect(reducedPage.locator(".screen-surface[data-screen-surface='mode-select']")).toBeVisible();
  await expect.poll(() => reducedPage.locator(".screen-surface").evaluate((element) => getComputedStyle(element).animationName)).toBe("none");
  await reducedPage.close();
});

test("campaign taglines stay readable on touch tablets without hover", async ({ page }, testInfo) => {
  test.skip(
    !["chromium", "tablet-chrome"].includes(testInfo.project.name),
    "Desktop and tablet-touch hover contract",
  );
  await page.setViewportSize({ width: 1024, height: 768 });
  await completeOnboarding(page);
  await page.evaluate(() => {
    if (!window.__RRR_QA__) throw new Error("Campaign tagline check requires a VITE_QA_MODE=1 build.");
    window.__RRR_QA__.unlockCampaign();
  });

  const inactiveUnlockedTagline = page.locator(".campaign-stop:not(.active):not(.locked)").first().locator("small");
  await expect(inactiveUnlockedTagline).toHaveText(/Find the line\. Feel the lift\./i);
  await clearFocus(page);
  await page.mouse.move(1, 1);
  await page.waitForTimeout(220);

  const hoverContract = await inactiveUnlockedTagline.evaluate((element) => ({
    opacity: getComputedStyle(element).opacity,
    hoverFine: matchMedia("(hover: hover) and (pointer: fine)").matches,
  }));

  if (testInfo.project.name === "tablet-chrome") {
    expect(hoverContract.hoverFine, "tablet project should emulate coarse touch").toBe(false);
    expect(hoverContract.opacity, "tablet touch tagline stays readable").toBe("1");
  } else {
    expect(hoverContract.hoverFine, "desktop project should use hover reveal").toBe(true);
    expect(Number(hoverContract.opacity), "desktop inactive tagline waits for hover/focus").toBeLessThanOrEqual(0.05);
  }
});

test("primary menus fit 16:9, ultrawide, tablet, and narrow viewports", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "Single-browser responsive geometry gate");
  await page.setViewportSize({ width: 1280, height: 720 });
  await completeOnboarding(page);
  const titleFirstPaintContract = await page.evaluate(() => {
    const titlePreload = document.querySelector<HTMLLinkElement>(
      'link[rel="preload"][as="image"][href="/assets/art/title-background.png"]',
    );
    const fontDisplays = Array.from(document.styleSheets)
      .flatMap((sheet) => Array.from(sheet.cssRules))
      .filter((rule): rule is CSSFontFaceRule => rule instanceof CSSFontFaceRule
        && rule.style.getPropertyValue("font-family").includes("Ridge Display"))
      .map((rule) => ({
        family: rule.style.getPropertyValue("font-family"),
        weight: rule.style.getPropertyValue("font-weight"),
        display: rule.style.getPropertyValue("font-display"),
      }));
    const fontPreloads = Array.from(document.querySelectorAll<HTMLLinkElement>(
      'link[rel="preload"][as="font"]',
    )).map((link) => ({ href: link.href, fetchPriority: link.fetchPriority }));
    const preloadOrder = Array.from(document.querySelectorAll<HTMLLinkElement>('link[rel="preload"]'))
      .map((link) => link.as);
    const menuSkyStyle = getComputedStyle(document.querySelector<HTMLElement>(".menu-sky")!);
    return {
      titlePreload: titlePreload
        ? {
            as: titlePreload.as,
            type: titlePreload.type,
            fetchPriority: titlePreload.fetchPriority,
          }
        : null,
      fontPreloads,
      preloadOrder,
      fontDisplays,
      menuSkyBackgroundImage: menuSkyStyle.backgroundImage,
      menuSkyBackgroundSize: menuSkyStyle.backgroundSize,
    };
  });
  // Fonts must outrank the 2MB backdrop: with font-display: optional, losing
  // the fetch race pins fallback type for the whole session, so the fonts
  // preload first at high priority and the image demotes to auto.
  expect(titleFirstPaintContract.titlePreload).toEqual({
    as: "image",
    type: "image/png",
    fetchPriority: "auto",
  });
  expect(titleFirstPaintContract.fontPreloads).toHaveLength(2);
  for (const fontPreload of titleFirstPaintContract.fontPreloads) {
    expect(fontPreload.fetchPriority, `${fontPreload.href} preloads at high priority`).toBe("high");
  }
  expect(titleFirstPaintContract.preloadOrder.indexOf("font")).toBeLessThan(
    titleFirstPaintContract.preloadOrder.indexOf("image"),
  );
  expect(titleFirstPaintContract.fontDisplays).toEqual(expect.arrayContaining([
    expect.objectContaining({ weight: "700", display: "optional" }),
    expect.objectContaining({ weight: "900", display: "optional" }),
  ]));
  expect(titleFirstPaintContract.menuSkyBackgroundImage).toContain('url("http://127.0.0.1:');
  expect(titleFirstPaintContract.menuSkyBackgroundImage).toContain("/assets/art/title-background.png");
  expect(titleFirstPaintContract.menuSkyBackgroundImage).toContain("radial-gradient");
  expect(titleFirstPaintContract.menuSkyBackgroundImage).toContain("linear-gradient");
  expect(titleFirstPaintContract.menuSkyBackgroundSize).toContain("cover");

  for (const viewport of [
    { name: "16:9", width: 1280, height: 720 },
    { name: "ultrawide", width: 1920, height: 800 },
    { name: "tablet", width: 1024, height: 768 },
    { name: "narrow", width: 360, height: 640 },
  ]) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.reload();
    const ride = page.getByRole("button", { name: "Ride", exact: true });
    await expect(ride, `${viewport.name} Ride button`).toBeVisible();

    const overflow = await page.evaluate(() => Math.max(
      document.documentElement.scrollWidth,
      document.body.scrollWidth,
    ) - window.innerWidth);
    expect(overflow, `${viewport.name} global horizontal overflow`).toBeLessThanOrEqual(1);
    if (viewport.name === "narrow") {
      const campaignRailMetrics = await page.evaluate(() => {
        const rail = document.querySelector<HTMLElement>(".campaign-rail");
        const firstStop = document.querySelector<HTMLElement>(".campaign-stop:first-of-type");
        const lastStop = document.querySelector<HTMLElement>(".campaign-stop:last-of-type");
        if (!rail || !firstStop || !lastStop) return null;
        rail.scrollLeft = 0;
        const firstAtStart = firstStop.getBoundingClientRect();
        rail.scrollLeft = rail.scrollWidth;
        const lastAfterScroll = lastStop.getBoundingClientRect();
        return {
          clientWidth: rail.clientWidth,
          scrollWidth: rail.scrollWidth,
          scrollLeft: rail.scrollLeft,
          firstStartX: firstAtStart.x,
          firstStartRight: firstAtStart.right,
          lastEndX: lastAfterScroll.x,
          lastEndRight: lastAfterScroll.right,
          documentOverflow: Math.max(
            document.documentElement.scrollWidth,
            document.body.scrollWidth,
          ) - window.innerWidth,
        };
      });
      expect(campaignRailMetrics, "narrow campaign rail metrics").not.toBeNull();
      expect(campaignRailMetrics?.documentOverflow, "narrow document stays fixed").toBeLessThanOrEqual(1);
      expect(campaignRailMetrics?.scrollWidth, "narrow campaign rail owns horizontal scroll").toBeGreaterThan(
        campaignRailMetrics?.clientWidth ?? viewport.width,
      );
      expect(campaignRailMetrics?.firstStartX, "narrow first campaign stop starts in viewport").toBeGreaterThanOrEqual(0);
      expect(campaignRailMetrics?.firstStartRight, "narrow first campaign stop is initially reachable").toBeLessThanOrEqual(viewport.width);
      expect(campaignRailMetrics?.lastEndX, "narrow final campaign stop becomes reachable").toBeGreaterThanOrEqual(0);
      expect(campaignRailMetrics?.lastEndRight, "narrow final campaign stop fits after rail scroll").toBeLessThanOrEqual(viewport.width);
    }

    const rideBox = await ride.boundingBox();
    expect(rideBox, `${viewport.name} Ride bounds`).not.toBeNull();
    expect(rideBox?.x ?? -1, `${viewport.name} Ride left edge`).toBeGreaterThanOrEqual(0);
    expect((rideBox?.x ?? 0) + (rideBox?.width ?? viewport.width + 1), `${viewport.name} Ride right edge`).toBeLessThanOrEqual(viewport.width);

    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
    await expect(page.getByRole("button", { name: "accessibility", exact: true })).toBeVisible();
    const settingsOverflow = await page.evaluate(() => Math.max(
      document.documentElement.scrollWidth,
      document.body.scrollWidth,
    ) - window.innerWidth);
    expect(settingsOverflow, `${viewport.name} settings horizontal overflow`).toBeLessThanOrEqual(1);
    await page.getByRole("button", { name: "Done", exact: true }).click();

    await page.getByRole("button", { name: "Support · Privacy · Accessibility", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Support & privacy", exact: true }), `${viewport.name} support heading`).toBeVisible();
    for (const heading of ["Support", "Privacy", "Accessibility", "About"]) {
      await expect(page.getByRole("heading", { name: heading, exact: true }), `${viewport.name} ${heading}`).toBeVisible();
    }
    const supportOverflow = await page.evaluate(() => Math.max(
      document.documentElement.scrollWidth,
      document.body.scrollWidth,
    ) - window.innerWidth);
    expect(supportOverflow, `${viewport.name} support horizontal overflow`).toBeLessThanOrEqual(1);
    const supportBack = page.getByRole("button", { name: "Back to main menu", exact: true });
    await expect(supportBack, `${viewport.name} support back`).toBeVisible();
    const supportBackBox = await supportBack.boundingBox();
    expect(supportBackBox, `${viewport.name} support back bounds`).not.toBeNull();
    expect((supportBackBox?.x ?? 0) + (supportBackBox?.width ?? viewport.width + 1), `${viewport.name} support back right edge`).toBeLessThanOrEqual(viewport.width);
    await supportBack.click();
  }
});

test("race, results, and editor controls fit every required responsive layout", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "Single-browser responsive surface gate");
  test.setTimeout(480_000);
  await completeOnboarding(page);

  for (const viewport of [
    { name: "16:9", width: 1280, height: 720 },
    { name: "ultrawide", width: 1920, height: 800 },
    { name: "tablet", width: 1024, height: 768 },
    { name: "narrow", width: 360, height: 640 },
  ]) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.getByRole("button", { name: "Ride", exact: true }).click();
    await page.getByRole("button", { name: /Practice/ }).click();
    const canvas = page.getByLabel("Live 3D race on Canyon Kickoff");
    await expect(canvas, `${viewport.name} race canvas`).toBeVisible();
    await expect(page.locator(".race-hud"), `${viewport.name} race HUD`).toBeVisible();
    const raceOverflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(raceOverflow, `${viewport.name} race overflow`).toBeLessThanOrEqual(1);

    await finishRaceWithPulsedTurbo(page);
    const retryBox = await page.getByRole("button", { name: "Retry now" }).boundingBox();
    expect(retryBox, `${viewport.name} retry bounds`).not.toBeNull();
    expect((retryBox?.x ?? 0) + (retryBox?.width ?? viewport.width + 1), `${viewport.name} retry right edge`).toBeLessThanOrEqual(viewport.width);

    await page.getByRole("button", { name: "Festival menu" }).click();
    await page.getByRole("button", { name: "Track Builder", exact: true }).click();
    await expect(page.getByLabel(/Interactive 3D track build camera/), `${viewport.name} editor`).toBeVisible();
    for (const name of ["Save", "Test Ride", "Export", "Import"]) {
      const control = page.getByRole("button", { name, exact: true });
      await expect(control, `${viewport.name} ${name}`).toBeVisible();
      const bounds = await control.boundingBox();
      expect(bounds, `${viewport.name} ${name} bounds`).not.toBeNull();
      expect((bounds?.x ?? 0) + (bounds?.width ?? viewport.width + 1), `${viewport.name} ${name} right edge`).toBeLessThanOrEqual(viewport.width);
    }
    await expect(page.getByLabel("Placed module"), `${viewport.name} placed-module selector`).toBeVisible();
    await expect(page.getByRole("spinbutton", { name: "Laps" }), `${viewport.name} laps control`).toBeVisible();
    await expect(page.getByRole("button", { name: "Place selected module at route view", exact: true }), `${viewport.name} keyboard placement`).toBeVisible();
    await expect(page.locator(".editor-status output"), `${viewport.name} editor notice`).toBeVisible();
    await page.getByRole("button", { name: "Back to festival menu" }).click();
  }
});

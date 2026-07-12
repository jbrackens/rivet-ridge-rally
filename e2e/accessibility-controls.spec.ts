import { expect, test, type Locator, type Page } from "@playwright/test";

async function completeOnboarding(page: Page): Promise<void> {
  await page.goto("/?qa-fast-race=1");
  const skip = page.getByRole("button", { name: "Skip training" });
  await expect(skip).toBeVisible({ timeout: 15_000 });
  await skip.click();
  await expect(page.getByRole("button", { name: "Ride", exact: true })).toBeVisible();
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

async function tabTo(target: Locator, pressTab: () => Promise<void>): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
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

test("keyboard-only menus reach a race and Escape freezes then resumes it", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name.startsWith("mobile") || testInfo.project.name.startsWith("tablet"), "Desktop keyboard journey");
  test.setTimeout(60_000);
  await completeOnboarding(page);
  const pressTab = () => page.keyboard.press(testInfo.project.name === "webkit" ? "Alt+Tab" : "Tab");

  await clearFocus(page);
  await tabTo(page.getByRole("button", { name: "Ride", exact: true }), pressTab);
  await expect(page.getByRole("button", { name: "Ride", exact: true })).toBeFocused();
  await pressTab();
  await expect(page.getByRole("button", { name: "Track Builder", exact: true })).toBeFocused();
  await pressTab();
  await expect(page.getByRole("button", { name: "Settings", exact: true })).toBeFocused();
  await page.keyboard.press("Enter");

  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
  await clearFocus(page);
  await tabTo(page.getByRole("button", { name: "Close settings" }), pressTab);
  await expect(page.getByRole("button", { name: "Close settings" })).toBeFocused();
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

  await expect(page.getByLabel("Live 3D race on Canyon Kickoff")).toBeVisible();
  const clock = page.locator(".timing-block > strong");
  await expect(clock).not.toHaveText("00:00.00");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Race paused" })).toBeVisible();
  await expect(page.locator(".game-shell")).toHaveAttribute("data-paused", "true");
  const frozenTime = await clock.textContent();
  expect(frozenTime).not.toBeNull();
  await page.waitForTimeout(250);
  await expect(clock).toHaveText(frozenTime ?? "");

  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "audio", exact: true }).click();
  await page.getByRole("slider", { name: "master volume" }).fill("0.4");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Race paused" })).toBeVisible();
  await expect(clock).toHaveText(frozenTime ?? "");

  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Race paused" })).toHaveCount(0);
  await expect(page.locator(".game-shell")).toHaveAttribute("data-paused", "false");
  await expect.poll(() => clock.textContent()).not.toBe(frozenTime);
});

test("keyboard remapping rejects conflicts and the accepted binding completes a race", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "Single-browser remapping gate");
  test.setTimeout(60_000);
  await completeOnboarding(page);
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "play", exact: true }).click();

  const bindings = page.getByLabel("Keyboard bindings");
  const throttle = bindings.locator("div").filter({ hasText: /^throttle/ }).getByRole("button");
  const turbo = bindings.locator("div").filter({ hasText: /^turbo/ }).getByRole("button");
  const pause = bindings.locator("div").filter({ hasText: /^pause/ }).getByRole("button");
  await throttle.click();
  await throttle.press("q");
  await expect(throttle).toHaveText("Q");

  await turbo.click();
  await turbo.press("q");
  await expect(page.getByRole("alert")).toHaveText("Q is already assigned to throttle. Choose another key.");
  await expect(turbo).toHaveText("Press a key…");
  await turbo.press("e");
  await expect(turbo).toHaveText("E");
  await pause.click();
  await pause.press("p");
  await expect(pause).toHaveText("P");

  await page.getByRole("button", { name: "Done", exact: true }).click();
  await page.getByRole("button", { name: "Ride", exact: true }).click();
  await page.getByRole("button", { name: /Practice/ }).click();
  await page.keyboard.press("p");
  await expect(page.getByRole("dialog", { name: "Race paused" })).toBeVisible();
  await page.keyboard.press("p");
  await expect(page.getByRole("dialog", { name: "Race paused" })).toHaveCount(0);
  await page.keyboard.down("q");
  await page.keyboard.down("Space");
  await expect(page.getByRole("button", { name: "Retry now" })).toBeVisible({ timeout: 30_000 });
  await page.keyboard.up("q");
  await page.keyboard.up("Space");
});

test("accessibility and volume controls apply immediately and persist", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name.startsWith("mobile") || testInfo.project.name.startsWith("tablet"), "Desktop settings coverage");
  await completeOnboarding(page);
  await page.getByRole("button", { name: "Settings", exact: true }).click();

  await page.getByRole("checkbox", { name: /^Reduced motion/ }).check();
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

test("captions and critical race state have visible non-color labels", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "Single-browser semantic race gate");
  await completeOnboarding(page);
  await page.getByRole("button", { name: "Ride", exact: true }).click();
  await page.getByRole("button", { name: /Practice/ }).click();

  const heat = page.getByRole("meter", { name: /^Heat \d+ percent/ });
  await expect(heat).toBeVisible();
  await expect(heat.getByText("Heat", { exact: true })).toBeVisible();
  await expect(page.getByText("Run", { exact: true })).toBeVisible();
  await expect(page.getByText("Practice", { exact: true })).toBeVisible();
  await expect(page.getByText(/Lap\s+1\s+\/\s+2/)).toBeVisible();
  await expect(page.getByText("Target", { exact: true })).toBeVisible();
  await expect(page.getByText("Free ride", { exact: true })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("data-colorblind-safe", "true");
  await expect.poll(() => page.locator(".heat-track > span").evaluate((element) => getComputedStyle(element).backgroundImage)).toContain("repeating-linear-gradient");

  await page.keyboard.down("w");
  await page.keyboard.down("Shift");
  await page.keyboard.down("Space");
  await expect(page.locator(".caption-cue")).toContainText(
    /Checkpoint|Cooling|landing|Barrier|Heat|Overheated/,
    { timeout: 10_000 },
  );
  await page.keyboard.up("w");
  await page.keyboard.up("Shift");
  await page.keyboard.up("Space");
});

test("renderer accessibility cues toggle live and fixed-step caps report dropped time", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "Single-browser renderer accessibility gate");
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
  await completeOnboarding(page);
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "play", exact: true }).click();
  await page.getByRole("checkbox", { name: /^Mirror touch controls/ }).check();
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await page.getByRole("button", { name: "Ride", exact: true }).click();
  await page.getByRole("button", { name: /Practice/ }).click();

  const controls = page.getByLabel("Touch race controls");
  await expect(controls).toBeVisible();
  await expect(controls).toHaveClass(/mirrored/);
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

  await page.getByRole("button", { name: "Pause race" }).click();
  await expect(page.getByRole("dialog", { name: "Race paused" })).toBeVisible();
  await page.getByRole("button", { name: "Resume", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Race paused" })).toHaveCount(0);
});

test("primary menus fit 16:9, ultrawide, tablet, and narrow viewports", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "Single-browser responsive geometry gate");
  await page.setViewportSize({ width: 1280, height: 720 });
  await completeOnboarding(page);

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
  }
});

test("race, results, and editor controls fit every required responsive layout", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "Single-browser responsive surface gate");
  test.setTimeout(180_000);
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

    await page.keyboard.down("w");
    await page.keyboard.down("Space");
    await expect(page.getByRole("button", { name: "Retry now" }), `${viewport.name} results`).toBeVisible({ timeout: 30_000 });
    await page.keyboard.up("w");
    await page.keyboard.up("Space");
    const retryBox = await page.getByRole("button", { name: "Retry now" }).boundingBox();
    expect(retryBox, `${viewport.name} retry bounds`).not.toBeNull();
    expect((retryBox?.x ?? 0) + (retryBox?.width ?? viewport.width + 1), `${viewport.name} retry right edge`).toBeLessThanOrEqual(viewport.width);

    await page.getByRole("button", { name: "Festival menu" }).click();
    await page.getByRole("button", { name: "Track Builder", exact: true }).click();
    await expect(page.getByLabel(/Interactive 3D track build camera/), `${viewport.name} editor`).toBeVisible();
    for (const name of ["Save", "Test Ride"]) {
      const control = page.getByRole("button", { name, exact: true });
      await expect(control, `${viewport.name} ${name}`).toBeVisible();
      const bounds = await control.boundingBox();
      expect(bounds, `${viewport.name} ${name} bounds`).not.toBeNull();
      expect((bounds?.x ?? 0) + (bounds?.width ?? viewport.width + 1), `${viewport.name} ${name} right edge`).toBeLessThanOrEqual(viewport.width);
    }
    await page.getByRole("button", { name: "Back to festival menu" }).click();
  }
});

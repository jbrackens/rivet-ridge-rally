import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

async function finishFastKeyboardRace(page: Page): Promise<void> {
  const retryButton = page.getByRole("button", { name: "Retry now" });
  await expect(page.locator(".game-shell")).toHaveAttribute(
    "data-race-gate-phase",
    "racing",
    { timeout: 30_000 },
  );
  await page.locator(".game-canvas").focus();
  try {
    await page.keyboard.down("w");
    await page.keyboard.down("Space");
    for (let cycle = 0; cycle < 30; cycle += 1) {
      await page.keyboard.down("Shift");
      await page.waitForTimeout(520);
      await page.keyboard.up("Shift");
      if (await retryButton.isVisible()) break;
      await page.waitForTimeout(620);
      if (await retryButton.isVisible()) break;
    }
    await expect(retryButton).toBeVisible({ timeout: 45_000 });
  } finally {
    await page.keyboard.up("w");
    await page.keyboard.up("Space");
    await page.keyboard.up("Shift");
  }
}

test("required surfaces stay free of browser, request, and axe failures", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name.startsWith("mobile") || testInfo.project.name.startsWith("tablet"), "Desktop browser release gate");
  test.setTimeout(420_000);
  const failures: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") failures.push(`console: ${message.text()}`);
  });
  page.on("pageerror", (error) => failures.push(`pageerror: ${error.message}`));
  page.on("requestfailed", (request) => failures.push(`requestfailed: ${request.method()} ${request.url()} — ${request.failure()?.errorText ?? "unknown"}`));
  page.on("response", (response) => {
    if (response.status() >= 400) failures.push(`response: ${response.status()} ${response.url()}`);
  });

  const assertAxe = async (surface: string) => {
    // Let the screen entrance animation settle first. `.screen-surface` fades
    // opacity from .01 to 1 over 180 ms, and axe samples *computed* colours: a
    // mid-fade frame reports the teal step labels as 4.03:1 against the card,
    // which is the blended value, not the settled one. Accessibility
    // conformance is a property of the settled UI, so wait for it.
    await page.evaluate(async () => {
      const finite = document.getAnimations().filter((animation) => (
        animation.effect?.getComputedTiming().iterations !== Infinity
      ));
      await Promise.all(finite.map((animation) => animation.finished.catch(() => undefined)));
    });
    const result = await new AxeBuilder({ page }).analyze();
    expect(result.violations, `${surface} axe violations`).toEqual([]);
  };

  await page.goto("/?qa-fast-race=1");
  const skip = page.getByRole("button", { name: "Skip training" });
  await expect(skip).toBeVisible({ timeout: 15_000 });
  // Rider School is the first surface a new player ever sees, and it was not
  // covered by this gate. Scan it before skipping past it.
  await assertAxe("rider school intro");
  await skip.click();
  await assertAxe("title");

  await page.getByRole("button", { name: "Support · Privacy · Accessibility", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Support & privacy", exact: true })).toBeVisible();
  await assertAxe("support and privacy");
  await page.getByRole("button", { name: "Back to main menu", exact: true }).click();

  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await assertAxe("settings");
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await page.getByRole("button", { name: "Ride", exact: true }).click();
  await assertAxe("mode selection");

  await page.getByRole("button", { name: /Practice/ }).click();
  await expect(page.getByLabel("Live 3D race on Canyon Kickoff")).toBeVisible();
  await assertAxe("race HUD");

  // A modal pause dialog is a classic accessibility risk -- focus containment,
  // labelling and inert background chrome all have to hold. Scan it live.
  //
  // Wait for the racing phase first: the canvas becomes visible during loading and
  // countdown, and Escape does not open the pause dialog before the race actually
  // starts. `lifecycle.spec.ts` gates on the same attribute.
  await expect(page.locator(".game-shell")).toHaveAttribute(
    "data-race-gate-phase",
    "racing",
    { timeout: 30_000 },
  );
  await page.getByLabel("Live 3D race on Canyon Kickoff").focus();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Race paused" })).toBeVisible();
  await assertAxe("paused race dialog");

  // High contrast is itself an accessibility feature, so it must not introduce
  // accessibility violations of its own. Toggle it from the paused Settings and
  // scan the live HUD it produces.
  await page.getByRole("dialog", { name: "Race paused" })
    .getByRole("button", { name: "Settings", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
  await page.getByRole("button", { name: "accessibility", exact: true }).click();
  await page.getByRole("checkbox", { name: /^High contrast/ }).check();
  await assertAxe("settings with high contrast");
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Race paused" })).toBeVisible();
  await page.getByRole("dialog", { name: "Race paused" })
    .getByRole("button", { name: /^Resume/ }).click();
  await expect(page.locator("html")).toHaveAttribute("data-high-contrast", "true");
  await assertAxe("race HUD in high contrast");

  await finishFastKeyboardRace(page);
  await assertAxe("results");

  await page.getByRole("button", { name: "Festival menu" }).click();
  await page.getByRole("button", { name: "Track Builder", exact: true }).click();
  await expect(page.getByLabel(/Interactive 3D track build camera/)).toBeVisible();
  await assertAxe("track builder");
  expect(failures).toEqual([]);
});

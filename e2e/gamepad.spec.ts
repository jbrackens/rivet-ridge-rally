import { expect, test } from "@playwright/test";

test("standard-layout gamepad input completes a browser race", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "Synthetic standard-pad gate runs once in Chromium");
  test.setTimeout(45_000);
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

  await page.goto("/?qa-fast-race=1");
  await page.getByRole("button", { name: "Skip training" }).click();
  await page.getByRole("button", { name: "Ride", exact: true }).click();
  await page.getByRole("button", { name: /Practice/ }).click();
  await page.evaluate(() => {
    const buttons = (window as Window & { __QA_GAMEPAD_BUTTONS__: Array<{ pressed: boolean; touched: boolean; value: number }> }).__QA_GAMEPAD_BUTTONS__;
    if (buttons[9]) Object.assign(buttons[9], { pressed: true, touched: true, value: 1 });
  });
  await expect(page.getByRole("dialog", { name: "Race paused" })).toBeVisible();
  await page.evaluate(() => {
    const buttons = (window as Window & { __QA_GAMEPAD_BUTTONS__: Array<{ pressed: boolean; touched: boolean; value: number }> }).__QA_GAMEPAD_BUTTONS__;
    if (buttons[9]) Object.assign(buttons[9], { pressed: false, touched: false, value: 0 });
  });
  await page.waitForTimeout(100);
  await page.evaluate(() => {
    const buttons = (window as Window & { __QA_GAMEPAD_BUTTONS__: Array<{ pressed: boolean; touched: boolean; value: number }> }).__QA_GAMEPAD_BUTTONS__;
    if (buttons[9]) Object.assign(buttons[9], { pressed: true, touched: true, value: 1 });
  });
  await expect(page.getByRole("dialog", { name: "Race paused" })).toHaveCount(0);
  await page.evaluate(() => {
    const buttons = (window as Window & { __QA_GAMEPAD_BUTTONS__: Array<{ pressed: boolean; touched: boolean; value: number }> }).__QA_GAMEPAD_BUTTONS__;
    if (buttons[9]) Object.assign(buttons[9], { pressed: false, touched: false, value: 0 });
    if (buttons[0]) Object.assign(buttons[0], { pressed: true, touched: true, value: 1 });
  });

  await expect(page.getByText("Gamepad controls", { exact: true })).toBeVisible({ timeout: 10_000 });
  await expect(page.locator(".race-hint")).toContainText("Start pause");
  await expect(page.getByRole("button", { name: "Retry now" })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("Lap 1", { exact: true })).toBeVisible();
  await expect(page.getByText("Lap 2", { exact: true })).toBeVisible();
});

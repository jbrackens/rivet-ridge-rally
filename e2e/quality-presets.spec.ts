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
  for (const preset of ["Auto", "Low", "Medium", "High"]) {
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await page.getByRole("button", { name: "play", exact: true }).click();
    await page.getByLabel("Quality").selectOption(preset.toLowerCase());
    await page.getByRole("button", { name: "Done", exact: true }).click();
    await page.getByRole("button", { name: "Ride", exact: true }).click();
    await page.getByRole("button", { name: /Practice/ }).click();
    await expect(page.getByLabel("Live 3D race on Canyon Kickoff"), preset).toBeVisible();
    await expect.poll(async () => {
      const text = await page.getByLabel("Performance metrics").textContent();
      return Number(/· (\d+) draws/.exec(text ?? "")?.[1] ?? 0);
    }).toBeGreaterThan(0);
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Festival menu" }).click();
  }
  expect(errors).toEqual([]);
});

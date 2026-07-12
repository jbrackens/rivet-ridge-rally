import process from "node:process";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";

import {
  readOption,
  writeJson,
} from "./performance/common.mjs";

const DEFAULT_PRODUCTION_URL = "http://127.0.0.1:4173";
const argumentsList = process.argv.slice(2);
const baseURL = readOption(argumentsList, "base-url", DEFAULT_PRODUCTION_URL);
const output = readOption(argumentsList, "output", "artifacts/production-smoke/chrome-smoke.json");
const screenshotDirectory = readOption(argumentsList, "screenshots-dir", "artifacts/production-smoke");
const knownReadPixelsWarning = /GPU stall due to ReadPixels/;
const consoleMessages = [];
const failedRequests = [];
const httpErrors = [];
const steps = [];

async function requireOne(locator, label) {
  await locator.waitFor({ state: "visible", timeout: 15_000 });
  const count = await locator.count();
  if (count !== 1) throw new Error(`${label}: expected one element, found ${count}.`);
  return locator;
}

const browser = await chromium.launch({ channel: "chrome", headless: true });
const browserVersion = browser.version();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();

page.on("console", (message) => {
  if (["error", "warning"].includes(message.type())) {
    consoleMessages.push({ type: message.type(), text: message.text() });
  }
});
page.on("pageerror", (error) => consoleMessages.push({ type: "pageerror", text: error.message }));
page.on("requestfailed", (request) => failedRequests.push({
  method: request.method(),
  resourceType: request.resourceType(),
  url: request.url(),
  errorText: request.failure()?.errorText ?? "unknown",
}));
page.on("response", (response) => {
  if (response.status() >= 400) httpErrors.push({ status: response.status(), url: response.url() });
});

let smokeError = null;
let runtime = null;
let serviceWorkerControlled = false;
let offlineReloadPassed = false;

try {
  await mkdir(screenshotDirectory, { recursive: true });
  const response = await page.goto(baseURL, { waitUntil: "load", timeout: 30_000 });
  if (!response?.ok()) throw new Error(`Production shell returned HTTP ${response?.status() ?? "unknown"}.`);
  await page.waitForFunction(() => Array.from(document.querySelectorAll("button")).some((button) =>
    ["Ride", "Skip training"].includes(button.textContent?.trim() ?? "")), undefined, { timeout: 20_000 });
  const skipTraining = page.getByRole("button", { name: "Skip training", exact: true });
  if (await skipTraining.isVisible().catch(() => false)) await skipTraining.click();
  const ride = await requireOne(page.getByRole("button", { name: "Ride", exact: true }), "Title Ride button");
  await ride.waitFor({ state: "visible", timeout: 15_000 });
  runtime = await page.evaluate(() => ({
    title: document.title,
    qaApiPresent: Object.prototype.hasOwnProperty.call(window, "__RRR_QA__"),
    versionPresent: (document.body.textContent ?? "").includes("v1.0.0-rc.1"),
  }));
  if (runtime.title !== "Rivet Ridge Rally" || runtime.qaApiPresent || !runtime.versionPresent) {
    throw new Error("Production title, version, or QA-marker contract failed.");
  }
  steps.push("boot-and-version");

  await ride.click();
  const practice = await requireOne(
    page.getByRole("button", { name: /^03 Practice/ }),
    "Practice mode button",
  );
  await practice.click();
  const raceCanvas = await requireOne(page.getByLabel("Live 3D race on Canyon Kickoff"), "Race canvas");
  await raceCanvas.waitFor({ state: "visible", timeout: 20_000 });
  await raceCanvas.press("Escape");
  const pauseDialog = await requireOne(page.getByRole("dialog", { name: "Race paused" }), "Pause dialog");
  await pauseDialog.waitFor({ state: "visible", timeout: 5_000 });
  await (await requireOne(page.getByRole("button", { name: "Restart now", exact: true }), "Restart button")).click();
  await pauseDialog.waitFor({ state: "hidden", timeout: 5_000 });
  await page.screenshot({ path: `${screenshotDirectory}/chrome-race.png` });
  steps.push("race-start-and-restart");

  await raceCanvas.press("Escape");
  await (await requireOne(page.getByRole("button", { name: "Festival menu", exact: true }), "Festival menu button")).click();
  await (await requireOne(page.getByRole("button", { name: "Track Builder", exact: true }), "Track Builder button")).click();
  const editorCanvas = await requireOne(
    page.getByLabel(/Interactive 3D track build camera/),
    "Editor canvas",
  );
  await editorCanvas.waitFor({ state: "visible", timeout: 20_000 });
  await page.screenshot({ path: `${screenshotDirectory}/chrome-editor.png` });
  steps.push("editor-open");

  await (await requireOne(page.getByRole("button", { name: "Back to festival menu", exact: true }), "Editor back button")).click();
  await (await requireOne(page.getByRole("button", { name: "Ride", exact: true }), "Returned title Ride button")).waitFor({ state: "visible" });
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
  await page.reload({ waitUntil: "load" });
  await (await requireOne(page.getByRole("button", { name: "Ride", exact: true }), "Controlled title Ride button")).waitFor({ state: "visible" });
  serviceWorkerControlled = await page.evaluate(() => Boolean(navigator.serviceWorker.controller));
  if (!serviceWorkerControlled) throw new Error("Production service worker did not control the reloaded shell.");
  await context.setOffline(true);
  await page.reload({ waitUntil: "load" });
  await (await requireOne(page.getByRole("button", { name: "Ride", exact: true }), "Offline title Ride button")).waitFor({ state: "visible", timeout: 15_000 });
  offlineReloadPassed = true;
  await page.screenshot({ path: `${screenshotDirectory}/chrome-offline-title.png` });
  steps.push("offline-service-worker-reload");
} catch (error) {
  smokeError = {
    name: error instanceof Error ? error.name : "Error",
    message: error instanceof Error ? error.message : String(error),
  };
} finally {
  await context.setOffline(false).catch(() => undefined);
  await context.close();
  await browser.close();
}

const knownDiagnostics = consoleMessages.filter((message) =>
  message.type === "warning" && knownReadPixelsWarning.test(message.text));
const unexpectedConsoleMessages = consoleMessages.filter((message) => !knownDiagnostics.includes(message));
const passed = smokeError === null
  && failedRequests.length === 0
  && httpErrors.length === 0
  && unexpectedConsoleMessages.length === 0
  && serviceWorkerControlled
  && offlineReloadPassed;
const evidence = {
  schemaVersion: 1,
  kind: "production-smoke",
  createdAt: new Date().toISOString(),
  baseURL,
  browser: { name: "Google Chrome", version: browserVersion, headless: true },
  runtime,
  steps,
  serviceWorkerControlled,
  offlineReloadPassed,
  network: { failedRequests, httpErrors },
  console: { all: consoleMessages, knownDiagnostics, unexpected: unexpectedConsoleMessages },
  screenshots: ["chrome-race.png", "chrome-editor.png", "chrome-offline-title.png"],
  smokeError,
  status: passed ? "PASS" : "FAIL",
};

const outputPath = await writeJson(output, evidence);
console.log(JSON.stringify({ outputPath, status: evidence.status, browser: evidence.browser, steps, smokeError }, null, 2));
if (!passed) process.exitCode = 1;

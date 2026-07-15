import process from "node:process";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { chromium } from "playwright";

import {
  REPO_ROOT,
  readOption,
} from "./performance/common.mjs";
import {
  loadFormat2ReleaseManifest,
  normalizeProductionBaseURL,
  verifyServedRelease,
  withDeadline,
} from "./production-smoke-support.mjs";
import {
  aggregateScreenshotEvidence,
  createScreenshotEvidence,
  prepareEvidenceDirectory,
  prepareEvidenceRoot,
  promoteEvidenceBundle,
  verifyServedReleaseAfterJourney,
  waitForRaceGateRacing,
  waitForRestartedRaceGate,
  validateScreenshotFileName,
} from "./production-smoke-flow.mjs";

const DEFAULT_PRODUCTION_URL = "http://127.0.0.1:4173";
const DEFAULT_RELEASE_MANIFEST = "artifacts/release-manifest.json";
const SERVICE_WORKER_READY_TIMEOUT_MS = 20_000;
const EXPECTED_OFFLINE_CACHE_NAME = "rivet-ridge-rally-shell-v30";
const argumentsList = process.argv.slice(2);
const baseURL = normalizeProductionBaseURL(
  readOption(argumentsList, "base-url", DEFAULT_PRODUCTION_URL),
);
const manifestReference = readOption(argumentsList, "manifest", DEFAULT_RELEASE_MANIFEST);
const output = readOption(argumentsList, "output", "artifacts/production-smoke/chrome-smoke.json");
const screenshotDirectory = readOption(argumentsList, "screenshots-dir", "artifacts/production-smoke");
const requestedOutputPath = resolve(REPO_ROOT, output);
const artifactRoot = resolve(REPO_ROOT, screenshotDirectory);
const allowedArtifactRoot = resolve(REPO_ROOT, "artifacts/production-smoke");
if (artifactRoot !== allowedArtifactRoot) {
  throw new Error("Production smoke evidence must stay under artifacts/production-smoke.");
}
if (dirname(requestedOutputPath) !== artifactRoot) {
  throw new Error("Production smoke --output and --screenshots-dir must use the same directory so one evidence bundle can be promoted atomically.");
}
const evidenceFileName = basename(requestedOutputPath);
if (!evidenceFileName.endsWith(".json")) {
  throw new Error("Production smoke --output must name a JSON file.");
}
const runStartedAt = new Date();
const runId = `${runStartedAt.toISOString().replaceAll(":", "-")}-${randomUUID()}`;
const stagingDirectory = join(artifactRoot, ".staging", runId);
const knownReadPixelsWarning = /GPU stall due to ReadPixels/;
const consoleMessages = [];
const failedRequests = [];
const httpErrors = [];
const steps = [];
const screenshots = [];

async function requireOne(locator, label) {
  await locator.waitFor({ state: "visible", timeout: 15_000 });
  const count = await locator.count();
  if (count !== 1) throw new Error(`${label}: expected one element, found ${count}.`);
  return locator;
}

async function waitForServiceWorkerReady(page) {
  await withDeadline(
    page.evaluate(() => navigator.serviceWorker.ready.then(() => true)),
    SERVICE_WORKER_READY_TIMEOUT_MS,
    "Production service worker did not become ready before the deadline.",
  );
}

async function waitForOfflineReadiness(page) {
  await page.waitForFunction((expectedCacheName) => (
    document.documentElement.dataset.offlineReady === "true"
    && document.documentElement.dataset.offlineCache === expectedCacheName
    && Boolean(navigator.serviceWorker.controller)
  ), EXPECTED_OFFLINE_CACHE_NAME, { timeout: SERVICE_WORKER_READY_TIMEOUT_MS });
}

async function captureScreenshot(page, fileName) {
  const safeFileName = validateScreenshotFileName(fileName);
  const screenshotPath = join(stagingDirectory, safeFileName);
  await page.screenshot({ path: screenshotPath });
  screenshots.push(createScreenshotEvidence(safeFileName, await readFile(screenshotPath)));
}

function asSmokeError(error) {
  return {
    name: error instanceof Error ? error.name : "Error",
    message: error instanceof Error ? error.message : String(error),
  };
}

await prepareEvidenceRoot(REPO_ROOT, artifactRoot);
await prepareEvidenceDirectory(REPO_ROOT, dirname(stagingDirectory));
await mkdir(stagingDirectory);

let browser = null;
let browserVersion = null;
let context = null;
let smokeError = null;
let runtime = null;
let releaseArtifact = null;
let candidateManifestSha256 = null;
let serviceWorkerControlled = false;
let offlineCacheName = null;
let offlineReloadPassed = false;
let offlinePracticeRacePassed = false;
let loadedManifest = null;

try {
  loadedManifest = await loadFormat2ReleaseManifest(manifestReference);
  candidateManifestSha256 = loadedManifest.manifestSha256;
  releaseArtifact = {
    format: loadedManifest.manifest.format,
    product: loadedManifest.manifest.product,
    version: loadedManifest.manifest.version,
    source: loadedManifest.manifest.source,
    toolchain: loadedManifest.manifest.toolchain,
    build: loadedManifest.manifest.build,
    manifestSha256: loadedManifest.manifestSha256,
    aggregateSha256: loadedManifest.manifest.aggregateSha256,
    fileCount: loadedManifest.manifest.fileCount,
    totalBytes: loadedManifest.manifest.totalBytes,
    servedBefore: null,
    servedAfter: null,
  };
  releaseArtifact.servedBefore = await verifyServedRelease(loadedManifest.manifest, baseURL);
  steps.push("format-2-artifact-binding");

  browser = await chromium.launch({ channel: "chrome", headless: true });
  browserVersion = browser.version();
  context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
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

  const response = await page.goto(baseURL, { waitUntil: "load", timeout: 30_000 });
  if (!response?.ok()) throw new Error(`Production shell returned HTTP ${response?.status() ?? "unknown"}.`);
  if (new URL(response.url()).origin !== new URL(baseURL).origin) {
    throw new Error("Production shell navigation left the dedicated origin.");
  }
  await page.waitForFunction(() => Array.from(document.querySelectorAll("button")).some((button) =>
    ["Ride", "Skip training"].includes(button.textContent?.trim() ?? "")), undefined, { timeout: 20_000 });
  const skipTraining = page.getByRole("button", { name: "Skip training", exact: true });
  if (await skipTraining.isVisible().catch(() => false)) await skipTraining.click();
  const ride = await requireOne(page.getByRole("button", { name: "Ride", exact: true }), "Title Ride button");
  await ride.waitFor({ state: "visible", timeout: 15_000 });
  runtime = await page.evaluate((expectedVersion) => ({
    title: document.title,
    qaApiPresent: Object.prototype.hasOwnProperty.call(window, "__RRR_QA__"),
    versionPresent: (document.body.textContent ?? "").includes(`v${expectedVersion}`),
    build: window.__RRR_BUILD__ ?? null,
  }), releaseArtifact.version);
  if (
    runtime.title !== "Rivet Ridge Rally"
    || runtime.qaApiPresent
    || !runtime.versionPresent
    || runtime.build?.commit !== releaseArtifact.source.commit
    || runtime.build?.dirty !== false
  ) {
    throw new Error("Production title, version, QA-marker, or source-commit binding contract failed.");
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
  await waitForRaceGateRacing(page);
  await raceCanvas.press("Escape");
  const pauseDialog = await requireOne(page.getByRole("dialog", { name: "Race paused" }), "Pause dialog");
  await pauseDialog.waitFor({ state: "visible", timeout: 5_000 });
  await (await requireOne(page.getByRole("button", { name: "Restart now", exact: true }), "Restart button")).click();
  await pauseDialog.waitFor({ state: "hidden", timeout: 5_000 });
  await waitForRestartedRaceGate(page);
  await captureScreenshot(page, "chrome-race.png");
  steps.push("race-start-and-restart");

  await raceCanvas.press("Escape");
  await (await requireOne(page.getByRole("button", { name: "Festival menu", exact: true }), "Festival menu button")).click();
  await (await requireOne(page.getByRole("button", { name: "Track Builder", exact: true }), "Track Builder button")).click();
  const editorCanvas = await requireOne(
    page.getByLabel(/Interactive 3D track build camera/),
    "Editor canvas",
  );
  await editorCanvas.waitFor({ state: "visible", timeout: 20_000 });
  await captureScreenshot(page, "chrome-editor.png");
  steps.push("editor-open");

  await (await requireOne(page.getByRole("button", { name: "Back to festival menu", exact: true }), "Editor back button")).click();
  await (await requireOne(page.getByRole("button", { name: "Ride", exact: true }), "Returned title Ride button")).waitFor({ state: "visible" });
  await waitForServiceWorkerReady(page);
  await page.reload({ waitUntil: "load" });
  await (await requireOne(page.getByRole("button", { name: "Ride", exact: true }), "Controlled title Ride button")).waitFor({ state: "visible" });
  serviceWorkerControlled = await page.evaluate(() => Boolean(navigator.serviceWorker.controller));
  if (!serviceWorkerControlled) throw new Error("Production service worker did not control the reloaded shell.");
  await waitForOfflineReadiness(page);
  offlineCacheName = await page.evaluate(() => document.documentElement.dataset.offlineCache ?? null);
  await context.setOffline(true);
  await page.reload({ waitUntil: "load" });
  await (await requireOne(page.getByRole("button", { name: "Ride", exact: true }), "Offline title Ride button")).waitFor({ state: "visible", timeout: 15_000 });
  await waitForOfflineReadiness(page);
  offlineReloadPassed = true;
  await captureScreenshot(page, "chrome-offline-title.png");
  steps.push("offline-service-worker-reload");

  await (await requireOne(page.getByRole("button", { name: "Ride", exact: true }), "Offline Ride button")).click();
  await (await requireOne(page.getByRole("button", { name: /^03 Practice/ }), "Offline Practice mode button")).click();
  const offlineRaceCanvas = await requireOne(
    page.getByLabel("Live 3D race on Canyon Kickoff"),
    "Offline Practice race canvas",
  );
  await offlineRaceCanvas.waitFor({ state: "visible", timeout: 20_000 });
  await waitForRaceGateRacing(page);
  offlinePracticeRacePassed = true;
  await captureScreenshot(page, "chrome-offline-race.png");
  steps.push("offline-cached-practice-race");

  releaseArtifact.servedAfter = await verifyServedReleaseAfterJourney(
    loadedManifest.manifest,
    baseURL,
    releaseArtifact.servedBefore,
  );
  steps.push("post-journey-format-2-artifact-binding");
} catch (error) {
  smokeError = asSmokeError(error);
} finally {
  if (context) {
    await context.setOffline(false).catch(() => undefined);
    await context.close().catch((error) => {
      if (smokeError === null) smokeError = asSmokeError(error);
    });
  }
  if (browser) {
    await browser.close().catch((error) => {
      if (smokeError === null) smokeError = asSmokeError(error);
    });
  }
}

const knownDiagnostics = consoleMessages.filter((message) =>
  message.type === "warning" && knownReadPixelsWarning.test(message.text));
const unexpectedConsoleMessages = consoleMessages.filter((message) => !knownDiagnostics.includes(message));
const passed = smokeError === null
  && releaseArtifact?.servedBefore?.verified === true
  && releaseArtifact?.servedAfter?.verified === true
  && failedRequests.length === 0
  && httpErrors.length === 0
  && unexpectedConsoleMessages.length === 0
  && serviceWorkerControlled
  && offlineCacheName === EXPECTED_OFFLINE_CACHE_NAME
  && offlineReloadPassed
  && offlinePracticeRacePassed;
const evidence = {
  schemaVersion: 4,
  kind: "production-smoke",
  createdAt: new Date().toISOString(),
  run: {
    id: runId,
    startedAt: runStartedAt.toISOString(),
    candidateManifestSha256,
  },
  baseURL,
  releaseArtifact,
  browser: { name: "Google Chrome", version: browserVersion, headless: true },
  runtime,
  steps,
  serviceWorkerControlled,
  offlineCacheName,
  offlineReloadPassed,
  offlinePracticeRacePassed,
  network: { failedRequests, httpErrors },
  console: { all: consoleMessages, knownDiagnostics, unexpected: unexpectedConsoleMessages },
  screenshots,
  screenshotAggregateSha256: aggregateScreenshotEvidence(screenshots),
  smokeError,
  status: passed ? "PASS" : "FAIL",
};

const candidateDirectory = candidateManifestSha256 ?? "unbound";
const bundleDirectory = join(artifactRoot, "candidates", candidateDirectory, "runs", runId);
const stagedOutputPath = join(stagingDirectory, evidenceFileName);
await writeFile(stagedOutputPath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
await prepareEvidenceDirectory(REPO_ROOT, dirname(bundleDirectory));
await promoteEvidenceBundle(stagingDirectory, bundleDirectory);
const outputPath = join(bundleDirectory, evidenceFileName);
console.log(JSON.stringify({
  bundleDirectory,
  outputPath,
  status: evidence.status,
  browser: evidence.browser,
  steps,
  smokeError,
}, null, 2));
if (!passed) process.exitCode = 1;

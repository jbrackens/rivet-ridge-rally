import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import process from "node:process";
import { promisify } from "node:util";

import { chromium } from "playwright";

import {
  DEFAULT_BASE_URL,
  REPO_ROOT,
  readOption,
  writeJson,
} from "./performance/common.mjs";

const TRACKS = [
  { id: "canyon-kickoff", name: "Canyon Kickoff", midcourseDistance: 650 },
  { id: "pine-run", name: "Pine Run", midcourseDistance: 720 },
  { id: "coastline-clash", name: "Coastline Clash", midcourseDistance: 790 },
  { id: "foundry-flight", name: "Foundry Flight", midcourseDistance: 825 },
  { id: "summit-showdown", name: "Summit Showdown", midcourseDistance: 900 },
];
const VIEWPORT = { width: 1280, height: 720 };
const argumentsList = process.argv.slice(2);
const baseURL = readOption(argumentsList, "base-url", DEFAULT_BASE_URL);
const outputDirectory = readOption(
  argumentsList,
  "output-dir",
  "artifacts/visual-review/rc2-five-track-controlled",
);
const execFileAsync = promisify(execFile);

function sha256(contents) {
  return createHash("sha256").update(contents).digest("hex");
}

async function readSourceIdentity() {
  const [commitResult, statusResult] = await Promise.allSettled([
    execFileAsync("git", ["rev-parse", "--verify", "HEAD"], { cwd: REPO_ROOT }),
    execFileAsync("git", ["status", "--porcelain"], { cwd: REPO_ROOT }),
  ]);
  return {
    commit: commitResult.status === "fulfilled" ? commitResult.value.stdout.trim() || null : null,
    worktreeDirty: statusResult.status !== "fulfilled" || statusResult.value.stdout.trim().length > 0,
  };
}

async function verifyServedBuild() {
  const indexResponse = await fetch(baseURL, {
    cache: "no-store",
    signal: AbortSignal.timeout(5_000),
  }).catch(() => null);
  if (!indexResponse?.ok) {
    throw new Error(`QA preview is not reachable at ${baseURL}. Start the QA build preview first.`);
  }

  const servedIndex = Buffer.from(await indexResponse.arrayBuffer());
  const localIndex = await readFile(resolve(REPO_ROOT, "dist/index.html"));
  if (sha256(servedIndex) !== sha256(localIndex)) {
    throw new Error("The QA preview index does not match the current dist build.");
  }

  const indexHtml = servedIndex.toString("utf8");
  const resourcePaths = [...indexHtml.matchAll(/(?:src|href)="(\/[^"#?]+)"/g)]
    .map((match) => match[1])
    .filter((path) => path !== undefined);
  const resources = [];
  for (const resourcePath of [...new Set(resourcePaths)].toSorted()) {
    const [servedResponse, localContents] = await Promise.all([
      fetch(new URL(resourcePath, baseURL), {
        cache: "no-store",
        signal: AbortSignal.timeout(5_000),
      }),
      readFile(resolve(REPO_ROOT, "dist", resourcePath.slice(1))),
    ]);
    if (!servedResponse.ok) throw new Error(`QA preview returned HTTP ${servedResponse.status} for ${resourcePath}.`);
    const servedContents = Buffer.from(await servedResponse.arrayBuffer());
    const servedSha256 = sha256(servedContents);
    const localSha256 = sha256(localContents);
    if (servedSha256 !== localSha256) {
      throw new Error(`QA preview resource does not match dist: ${resourcePath}.`);
    }
    resources.push({ path: resourcePath, bytes: localContents.byteLength, sha256: localSha256 });
  }

  return {
    index: { bytes: localIndex.byteLength, sha256: sha256(localIndex) },
    resources,
  };
}

function attachDiagnostics(page) {
  const consoleMessages = [];
  const failedRequests = [];
  const httpErrors = [];
  page.on("console", (message) => {
    if (["error", "warning"].includes(message.type())) {
      consoleMessages.push({ type: message.type(), text: message.text() });
    }
  });
  page.on("pageerror", (error) => {
    consoleMessages.push({ type: "pageerror", text: error.message });
  });
  page.on("requestfailed", (request) => {
    failedRequests.push({
      method: request.method(),
      resourceType: request.resourceType(),
      url: request.url(),
      errorText: request.failure()?.errorText ?? "unknown",
    });
  });
  page.on("response", (response) => {
    if (response.status() >= 400) httpErrors.push({ status: response.status(), url: response.url() });
  });
  return { consoleMessages, failedRequests, httpErrors };
}

async function waitForShell(page) {
  await page.waitForFunction(() => (
    Boolean(window.__RRR_QA__)
    && Array.from(document.querySelectorAll("button")).some((button) => (
      ["Ride", "Skip training"].includes(button.textContent?.trim() ?? "")
    ))
  ), undefined, { timeout: 20_000 });
  const skipTraining = page.getByRole("button", { name: "Skip training", exact: true });
  if (await skipTraining.isVisible().catch(() => false)) await skipTraining.click();
  await page.getByRole("button", { name: "Ride", exact: true }).waitFor({ state: "visible" });
}

async function selectHighQuality(page) {
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "play", exact: true }).click();
  const quality = page.getByLabel("Quality");
  await quality.selectOption("high");
  if (await quality.inputValue() !== "high") throw new Error("High quality was not selected.");
  await page.getByRole("button", { name: "Done", exact: true }).click();
}

async function waitForFrozenRace(page, track, distance) {
  const canvas = page.getByLabel(`Live 3D race on ${track.name}`);
  await canvas.waitFor({ state: "visible", timeout: 20_000 });
  await page.waitForFunction(({ accessibleName, expectedDistance }) => {
    const candidate = Array.from(document.querySelectorAll("canvas")).find(
      (element) => element.getAttribute("aria-label") === accessibleName,
    );
    return candidate instanceof HTMLCanvasElement
      && candidate.dataset.visualState === "frozen"
      && candidate.dataset.bikeAsset === "ready"
      && Number(candidate.dataset.visualDistance) === expectedDistance;
  }, {
    accessibleName: `Live 3D race on ${track.name}`,
    expectedDistance: distance,
  }, { timeout: 20_000 });
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise((resolveFrame) => requestAnimationFrame(() => (
      requestAnimationFrame(() => resolveFrame())
    )));
  });
  return canvas;
}

async function capture(browser, entry) {
  const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1 });
  const page = await context.newPage();
  const diagnostics = attachDiagnostics(page);
  const relativePath = `${entry.phase}/${entry.track.id}-${entry.mode}-1280x720.png`;
  const absolutePath = resolve(REPO_ROOT, outputDirectory, relativePath);
  let screenshotHash = null;
  let error = null;
  let readiness = null;

  try {
    const target = new URL(baseURL);
    target.searchParams.set("qa-visual-freeze", "1");
    target.searchParams.set("qa-visual-distance", String(entry.distance));
    const response = await page.goto(target.href, { waitUntil: "load", timeout: 30_000 });
    if (!response?.ok()) throw new Error(`QA shell returned HTTP ${response?.status() ?? "unknown"}.`);
    await waitForShell(page);
    await selectHighQuality(page);
    await page.evaluate(({ trackId, mode }) => {
      if (!window.__RRR_QA__) throw new Error("VITE_QA_MODE=1 capture API is unavailable.");
      window.__RRR_QA__.unlockCampaign();
      window.__RRR_QA__.startTrack(trackId, mode);
    }, { trackId: entry.track.id, mode: entry.mode });
    const canvas = await waitForFrozenRace(page, entry.track, entry.distance);
    readiness = await canvas.evaluate((element) => ({
      visualState: element.dataset.visualState ?? null,
      bikeAsset: element.dataset.bikeAsset ?? null,
      visualDistance: Number(element.dataset.visualDistance),
      ariaLabel: element.getAttribute("aria-label"),
    }));
    await mkdir(resolve(REPO_ROOT, outputDirectory, entry.phase), { recursive: true });
    await page.screenshot({ path: absolutePath, animations: "disabled" });
    screenshotHash = sha256(await readFile(absolutePath));
  } catch (captureError) {
    error = captureError instanceof Error
      ? { name: captureError.name, message: captureError.message }
      : { name: "Error", message: String(captureError) };
  } finally {
    await context.close();
  }

  const consoleErrors = diagnostics.consoleMessages.filter((message) => message.type !== "warning");
  const status = error === null
    && screenshotHash !== null
    && consoleErrors.length === 0
    && diagnostics.failedRequests.length === 0
    && diagnostics.httpErrors.length === 0
    ? "PASS"
    : "FAIL";
  return {
    trackId: entry.track.id,
    trackName: entry.track.name,
    phase: entry.phase,
    mode: entry.mode,
    distance: entry.distance,
    file: relativePath,
    sha256: screenshotHash,
    readiness,
    diagnostics: {
      consoleMessages: diagnostics.consoleMessages,
      failedRequests: diagnostics.failedRequests,
      httpErrors: diagnostics.httpErrors,
    },
    error,
    status,
  };
}

const packageJson = JSON.parse(await readFile(resolve(REPO_ROOT, "package.json"), "utf8"));
const source = await readSourceIdentity();
const servedBuild = await verifyServedBuild();

const browser = await chromium.launch({ headless: true });
const browserVersion = browser.version();
const matrix = [
  ...TRACKS.map((track) => ({ track, phase: "start", mode: "practice", distance: 0 })),
  ...TRACKS.map((track) => ({
    track,
    phase: "midcourse",
    mode: "rival",
    distance: track.midcourseDistance,
  })),
];
const captures = [];
try {
  for (const entry of matrix) captures.push(await capture(browser, entry));
} finally {
  await browser.close();
}

const passed = captures.every((captureResult) => captureResult.status === "PASS");
const manifest = {
  schemaVersion: 1,
  kind: "five-track-controlled-visual-review",
  createdAt: new Date().toISOString(),
  appVersion: packageJson.version,
  source,
  servedBuild,
  qaBuildRequired: true,
  baseURL,
  browser: { name: "Chromium", version: browserVersion, headless: true },
  viewport: { ...VIEWPORT, deviceScaleFactor: 1 },
  quality: "high",
  productionCourseScale: true,
  captures,
  status: passed ? "PASS" : "FAIL",
};
await writeJson(`${outputDirectory}/manifest.json`, manifest);
console.log(JSON.stringify({
  outputDirectory,
  status: manifest.status,
  captures: captures.map(({ file, sha256: hash, status }) => ({ file, sha256: hash, status })),
}, null, 2));
if (!passed) process.exitCode = 1;

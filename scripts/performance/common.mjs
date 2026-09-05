import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { readdir, readFile, stat, mkdir, writeFile } from "node:fs/promises";
import { cpus, release as osRelease, totalmem, type as osType, version as osVersion } from "node:os";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { gzipSync } from "node:zlib";
import { performance as nodePerformance } from "node:perf_hooks";

const SCRIPT_DIRECTORY = dirname(fileURLToPath(import.meta.url));

export const REPO_ROOT = resolve(SCRIPT_DIRECTORY, "../..");
export const DEFAULT_BASE_URL = "http://127.0.0.1:4373";
export const MAXIMUM_FRAME_WORK_SAMPLES = 4_096;
export const PERFORMANCE_EVIDENCE_ROOT = "artifacts/candidate-evidence";
const execFileAsync = promisify(execFile);

function sha256(contents) {
  return createHash("sha256").update(contents).digest("hex");
}

function normalizeCandidateBaseURL(value) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("Performance candidate base URL is invalid.");
  }
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("Performance candidate base URL must use HTTP or HTTPS.");
  }
  if (parsed.username || parsed.password) {
    throw new Error("Performance candidate base URL must not contain credentials.");
  }
  if (parsed.pathname !== "/" || parsed.search || parsed.hash) {
    throw new Error("Performance candidate base URL must be the root of a dedicated origin.");
  }
  return parsed.href;
}

export function readOption(argumentsList, name, fallback) {
  const index = argumentsList.indexOf(`--${name}`);
  if (index < 0) return fallback;
  const value = argumentsList[index + 1];
  if (value === undefined || value.startsWith("--")) {
    throw new Error(`--${name} requires a value.`);
  }
  return value;
}

export function readPositiveNumber(argumentsList, name, fallback) {
  const value = Number(readOption(argumentsList, name, String(fallback)));
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`--${name} must be a positive number.`);
  }
  return value;
}

export function hasFlag(argumentsList, name) {
  return argumentsList.includes(`--${name}`);
}

export function round(value, digits = 2) {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  const factor = 10 ** digits;
  const rounded = Math.round(value * factor) / factor;
  return Object.is(rounded, -0) ? 0 : rounded;
}

export function summarize(values) {
  const sorted = values.filter(Number.isFinite).toSorted((left, right) => left - right);
  if (sorted.length === 0) return { samples: 0, min: null, mean: null, p95: null, max: null };
  const total = sorted.reduce((sum, value) => sum + value, 0);
  const percentileIndex = Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1);
  return {
    samples: sorted.length,
    min: round(sorted[0]),
    mean: round(total / sorted.length),
    p95: round(sorted[percentileIndex]),
    max: round(sorted.at(-1)),
  };
}

export function rawFrameRate(samples) {
  if (!Array.isArray(samples) || samples.length < 2) return null;
  const firstTimestamp = samples[0]?.frameTimestampMs;
  const lastTimestamp = samples.at(-1)?.frameTimestampMs;
  const coverageMs = lastTimestamp - firstTimestamp;
  if (!Number.isFinite(coverageMs) || coverageMs <= 0) return null;
  return round((samples.length - 1) / (coverageMs / 1_000));
}

export async function assertServer(baseURL) {
  let response;
  try {
    response = await fetch(baseURL, { signal: AbortSignal.timeout(5_000) });
  } catch (error) {
    throw new Error(`Performance server is not reachable at ${baseURL}. Start the product preview on port 4373 first.`, { cause: error });
  }
  if (!response.ok) throw new Error(`Performance server returned HTTP ${response.status} at ${baseURL}.`);
}

function assertCandidateEvidencePath(candidatePath, label) {
  if (
    typeof candidatePath !== "string"
    || candidatePath.length === 0
    || isAbsolute(candidatePath)
    || candidatePath.includes("\\")
  ) {
    throw new Error(`${label} must be a repository-relative path.`);
  }
  const segments = candidatePath.split("/");
  if (segments.some((segment) => segment.length === 0 || segment === "." || segment === "..")) {
    throw new Error(`${label} must be canonical.`);
  }
  if (!candidatePath.startsWith(`${PERFORMANCE_EVIDENCE_ROOT}/`)) {
    throw new Error(
      `${label} must be under ${PERFORMANCE_EVIDENCE_ROOT}/.`,
    );
  }
  return resolve(REPO_ROOT, candidatePath);
}

export function assertPerformanceEvidenceOutputPath(outputPath) {
  const absolutePath = assertCandidateEvidencePath(outputPath, "Performance evidence output");
  if (!outputPath.endsWith(".json")) {
    throw new Error("Performance evidence output must be a JSON file.");
  }
  return absolutePath;
}

export function assertPerformanceEvidenceDirectoryPath(directoryPath) {
  return assertCandidateEvidencePath(directoryPath, "Performance screenshot directory");
}

export async function writeJson(outputPath, value) {
  const absolutePath = assertPerformanceEvidenceOutputPath(outputPath);
  await mkdir(dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  return absolutePath;
}

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const absolutePath = resolve(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walk(absolutePath));
    else if (entry.isFile()) files.push(absolutePath);
  }
  return files;
}

export async function builtAssetEvidence() {
  const distDirectory = resolve(REPO_ROOT, "dist");
  const files = (await walk(distDirectory)).toSorted();
  const evidence = [];
  for (const absolutePath of files) {
    const [fileStat, contents] = await Promise.all([stat(absolutePath), readFile(absolutePath)]);
    const gzipContents = gzipSync(contents, { level: 9 });
    evidence.push({
      path: relative(distDirectory, absolutePath).split(sep).join("/"),
      bytes: fileStat.size,
      gzipBytes: gzipContents.byteLength,
      gzipSha256: sha256(gzipContents),
      sha256: sha256(contents),
    });
  }
  const aggregate = createHash("sha256");
  for (const record of evidence) aggregate.update(`${record.sha256}  ${record.path}\n`);
  return {
    directory: "dist",
    fileCount: evidence.length,
    totalBytes: evidence.reduce((sum, file) => sum + file.bytes, 0),
    totalGzipBytes: evidence.reduce((sum, file) => sum + file.gzipBytes, 0),
    aggregateSha256: aggregate.digest("hex"),
    files: evidence,
  };
}

async function git(argumentsList) {
  const { stdout } = await execFileAsync("git", argumentsList, {
    cwd: REPO_ROOT,
    encoding: "utf8",
    maxBuffer: 4 * 1024 * 1024,
  });
  return stdout.trim();
}

export async function sourceIdentityEvidence() {
  const packageJson = JSON.parse(await readFile(resolve(REPO_ROOT, "package.json"), "utf8"));
  const [commit, statusText, tagsText] = await Promise.all([
    git(["rev-parse", "HEAD^{commit}"]),
    git(["status", "--porcelain=v1", "--untracked-files=all"]),
    git(["tag", "--points-at", "HEAD"]),
  ]);
  const tagsAtCommit = tagsText ? tagsText.split("\n").filter(Boolean).toSorted() : [];
  const expectedTag = `v${packageJson.version}`;
  const expectedTagAtCommit = tagsAtCommit.includes(expectedTag);
  const expectedTagObjectType = expectedTagAtCommit
    ? await git(["cat-file", "-t", `refs/tags/${expectedTag}`])
    : null;
  const dirtyEntries = statusText ? statusText.split("\n").filter(Boolean) : [];
  return {
    commit,
    packageVersion: packageJson.version,
    expectedTag,
    tagsAtCommit,
    expectedTagAtCommit,
    expectedTagObjectType,
    expectedTagAnnotated: expectedTagObjectType === "tag",
    dirty: dirtyEntries.length > 0,
    dirtyEntryCount: dirtyEntries.length,
  };
}

export async function verifyServedBuild(
  localBuild,
  baseURL,
  { fetchImpl = globalThis.fetch, timeoutMs = 15_000 } = {},
) {
  if (!localBuild || !Array.isArray(localBuild.files) || localBuild.files.length === 0) {
    throw new Error("Performance candidate local build inventory is unavailable.");
  }
  if (typeof fetchImpl !== "function") throw new Error("Performance candidate fetch implementation is unavailable.");
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error("Performance candidate fetch timeout is invalid.");
  const normalizedBaseURL = normalizeCandidateBaseURL(baseURL);
  const rootURL = new URL(normalizedBaseURL);
  const files = await Promise.all(localBuild.files.map(async (record) => {
    const target = new URL(record.path, rootURL);
    let response;
    try {
      response = await fetchImpl(target, {
        cache: "no-store",
        redirect: "follow",
        headers: { "cache-control": "no-cache", pragma: "no-cache" },
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch {
      throw new Error(`Performance candidate file is not reachable: ${record.path}`);
    }
    if (!response.ok) {
      throw new Error(`Performance candidate returned HTTP ${response.status}: ${record.path}`);
    }
    const finalURL = new URL(response.url || target.href);
    if (finalURL.origin !== rootURL.origin) {
      throw new Error(`Performance candidate file left the dedicated origin: ${record.path}`);
    }
    const contents = Buffer.from(await response.arrayBuffer());
    const actualSha256 = sha256(contents);
    const gzipContents = gzipSync(contents, { level: 9 });
    const actualGzipSha256 = sha256(gzipContents);
    if (
      contents.length !== record.bytes
      || actualSha256 !== record.sha256
      || gzipContents.length !== record.gzipBytes
      || actualGzipSha256 !== record.gzipSha256
    ) {
      throw new Error(`Served performance candidate differs from local dist: ${record.path}`);
    }
    return {
      path: record.path,
      bytes: contents.length,
      gzipBytes: gzipContents.length,
      gzipSha256: actualGzipSha256,
      sha256: actualSha256,
    };
  }));

  const aggregate = createHash("sha256");
  for (const record of files) aggregate.update(`${record.sha256}  ${record.path}\n`);
  const aggregateSha256 = aggregate.digest("hex");
  if (aggregateSha256 !== localBuild.aggregateSha256) {
    throw new Error("Served performance candidate aggregate differs from local dist.");
  }

  const indexRecord = localBuild.files.find((record) => record.path === "index.html");
  if (!indexRecord) throw new Error("Performance candidate local build has no index.html.");
  const entrypointResponse = await fetchImpl(rootURL, {
    cache: "no-store",
    redirect: "follow",
    headers: { "cache-control": "no-cache", pragma: "no-cache" },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!entrypointResponse.ok) {
    throw new Error(`Performance candidate entrypoint returned HTTP ${entrypointResponse.status}.`);
  }
  const finalEntrypointURL = new URL(entrypointResponse.url || normalizedBaseURL);
  if (finalEntrypointURL.origin !== rootURL.origin) {
    throw new Error("Performance candidate entrypoint left the dedicated origin.");
  }
  const entrypointContents = Buffer.from(await entrypointResponse.arrayBuffer());
  const entrypointSha256 = sha256(entrypointContents);
  if (entrypointContents.length !== indexRecord.bytes || entrypointSha256 !== indexRecord.sha256) {
    throw new Error("Served performance candidate entrypoint differs from local dist/index.html.");
  }

  return {
    verified: true,
    baseURL: normalizedBaseURL,
    origin: rootURL.origin,
    fileCount: files.length,
    totalBytes: files.reduce((sum, record) => sum + record.bytes, 0),
    totalGzipBytes: files.reduce((sum, record) => sum + record.gzipBytes, 0),
    aggregateSha256,
    entrypoint: {
      requestedURL: normalizedBaseURL,
      finalURL: finalEntrypointURL.href,
      bytes: entrypointContents.length,
      sha256: entrypointSha256,
    },
    files,
  };
}

export function hostEvidence() {
  const processors = cpus();
  return {
    node: process.version,
    platform: process.platform,
    architecture: process.arch,
    os: { type: osType(), release: osRelease(), version: osVersion() },
    cpu: { model: processors[0]?.model ?? null, logicalCores: processors.length },
    totalMemoryBytes: totalmem(),
  };
}

export async function browserDeviceEvidence(page) {
  return page.evaluate(() => {
    const canvas = document.createElement("canvas");
    const gl = canvas.getContext("webgl2") ?? canvas.getContext("webgl");
    const debugInfo = gl?.getExtension("WEBGL_debug_renderer_info") ?? null;
    return {
      userAgent: navigator.userAgent,
      browserPlatform: navigator.platform,
      languages: [...navigator.languages],
      hardwareConcurrency: navigator.hardwareConcurrency ?? null,
      deviceMemoryGiB: navigator.deviceMemory ?? null,
      viewport: { width: window.innerWidth, height: window.innerHeight },
      screen: {
        width: window.screen.width,
        height: window.screen.height,
        colorDepth: window.screen.colorDepth,
        pixelDepth: window.screen.pixelDepth,
      },
      devicePixelRatio: window.devicePixelRatio,
      pointer: {
        coarse: matchMedia("(pointer: coarse)").matches,
        hover: matchMedia("(hover: hover)").matches,
      },
      webgl: gl ? {
        version: gl.getParameter(gl.VERSION),
        shadingLanguageVersion: gl.getParameter(gl.SHADING_LANGUAGE_VERSION),
        vendor: debugInfo ? gl.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR),
        renderer: debugInfo ? gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
      } : null,
    };
  });
}

export function collectPageMessages(page) {
  const messages = [];
  page.on("console", (message) => {
    if (["error", "warning"].includes(message.type())) {
      messages.push({ type: message.type(), text: message.text() });
    }
  });
  page.on("pageerror", (error) => messages.push({ type: "pageerror", text: error.message }));
  return messages;
}

export function collectNetworkFailures(page, startedAt = nodePerformance.now()) {
  const failedRequests = [];
  const httpErrorResponses = [];
  page.on("requestfailed", (request) => {
    failedRequests.push({
      elapsedMs: Math.round(nodePerformance.now() - startedAt),
      method: request.method(),
      resourceType: request.resourceType(),
      url: request.url(),
      errorText: request.failure()?.errorText ?? "unknown",
    });
  });
  page.on("response", (response) => {
    if (response.status() < 400) return;
    const request = response.request();
    httpErrorResponses.push({
      elapsedMs: Math.round(nodePerformance.now() - startedAt),
      method: request.method(),
      resourceType: request.resourceType(),
      url: response.url(),
      status: response.status(),
      statusText: response.statusText(),
    });
  });
  return { failedRequests, httpErrorResponses };
}

async function waitForInitialTitleAction(page) {
  await page.waitForFunction(() => Array.from(document.querySelectorAll("button")).some((button) =>
    ["Ride", "Skip training"].includes(button.textContent?.trim() ?? "")), undefined, { timeout: 20_000 });
}

async function completeTitleEntry(page) {
  const skip = page.getByRole("button", { name: "Skip training", exact: true });
  if (await skip.isVisible()) await skip.click();
  await page.getByRole("button", { name: "Ride", exact: true }).waitFor({ state: "visible", timeout: 15_000 });
}

async function waitForTitleReady(page) {
  await waitForInitialTitleAction(page);
  await completeTitleEntry(page);
}

async function installFrameWorkCapture(page) {
  await page.addInitScript(({ maximumSamples }) => {
    const originalRequestAnimationFrame = window.requestAnimationFrame.bind(window);
    const roundValue = (value) => Math.round(value * 1_000) / 1_000;
    let active = false;
    let startedAt = 0;
    let samples = [];
    let overflowed = false;
    let visibilityLost = false;
    let currentFrameTimestampMs = null;
    let currentFrameWorkMs = 0;
    let currentCallbackCount = 0;
    let racingClockActive = false;
    let racingClockLastState = false;
    let racingClockLastAt = 0;
    let racingClockStartedAt = 0;
    let racingClockDurationMs = 0;
    let racingClockVisibilityLost = false;
    let racingClockTransitions = [];
    let racingClockOverflowed = false;
    const maximumRacingClockTransitions = 1_024;

    const resetCurrentFrame = () => {
      currentFrameTimestampMs = null;
      currentFrameWorkMs = 0;
      currentCallbackCount = 0;
    };
    const flushCurrentFrame = () => {
      if (currentFrameTimestampMs === null || currentCallbackCount === 0) return;
      if (samples.length < maximumSamples) {
        samples.push({
          elapsedMs: roundValue(currentFrameTimestampMs - startedAt),
          frameTimestampMs: roundValue(currentFrameTimestampMs),
          frameWorkMs: roundValue(currentFrameWorkMs),
          callbackCount: currentCallbackCount,
        });
      } else {
        overflowed = true;
      }
      resetCurrentFrame();
    };

    window.requestAnimationFrame = (callback) => originalRequestAnimationFrame((timestamp) => {
      if (!active) return callback(timestamp);
      if (currentFrameTimestampMs !== null && timestamp !== currentFrameTimestampMs) {
        flushCurrentFrame();
      }
      if (currentFrameTimestampMs === null) currentFrameTimestampMs = timestamp;
      const callbackStartedAt = performance.now();
      try {
        return callback(timestamp);
      } finally {
        currentFrameWorkMs += performance.now() - callbackStartedAt;
        currentCallbackCount += 1;
      }
    });
    document.addEventListener("visibilitychange", () => {
      if (active && document.visibilityState !== "visible") visibilityLost = true;
      if (racingClockActive && document.visibilityState !== "visible") racingClockVisibilityLost = true;
    });
    const syncRacingClock = (now = performance.now()) => {
      if (!racingClockActive) return;
      if (racingClockLastState) racingClockDurationMs += now - racingClockLastAt;
      const nextState = Boolean(document.querySelector('.game-shell[data-race-gate-phase="racing"]'));
      if (nextState !== racingClockLastState) {
        if (racingClockTransitions.length < maximumRacingClockTransitions) {
          racingClockTransitions.push({
            elapsedMs: roundValue(now - racingClockStartedAt),
            racing: nextState,
          });
        } else {
          racingClockOverflowed = true;
        }
      }
      racingClockLastAt = now;
      racingClockLastState = nextState;
    };
    const observeRaceGate = () => {
      const root = document.documentElement;
      if (!root) return;
      new MutationObserver(() => syncRacingClock()).observe(root, {
        attributes: true,
        attributeFilter: ["data-race-gate-phase"],
        childList: true,
        subtree: true,
      });
    };
    if (document.documentElement) observeRaceGate();
    else document.addEventListener("DOMContentLoaded", observeRaceGate, { once: true });

    Object.defineProperty(window, "__RRR_PERF_CAPTURE__", {
      configurable: false,
      enumerable: false,
      writable: false,
      value: Object.freeze({
        apiVersion: 1,
        begin() {
          active = false;
          samples = [];
          overflowed = false;
          visibilityLost = document.visibilityState !== "visible";
          resetCurrentFrame();
          startedAt = performance.now();
          active = true;
          return { apiVersion: 1, maximumSamples };
        },
        end() {
          if (!active) throw new Error("Frame-work capture is not active.");
          active = false;
          flushCurrentFrame();
          return {
            apiVersion: 1,
            method: "pre-navigation-request-animation-frame-callback-work",
            scope: "synchronous-requestAnimationFrame-callback-cpu-work-only-excludes-style-layout-paint-gpu-and-microtasks",
            measuredDurationMs: roundValue(performance.now() - startedAt),
            maximumSamples,
            overflowed,
            visibilityLost,
            samples: samples.map((sample) => ({ ...sample })),
          };
        },
        beginRacingClock() {
          racingClockActive = false;
          racingClockDurationMs = 0;
          racingClockVisibilityLost = document.visibilityState !== "visible";
          racingClockTransitions = [];
          racingClockOverflowed = false;
          racingClockStartedAt = performance.now();
          racingClockLastAt = racingClockStartedAt;
          racingClockLastState = Boolean(document.querySelector('.game-shell[data-race-gate-phase="racing"]'));
          racingClockTransitions.push({ elapsedMs: 0, racing: racingClockLastState });
          racingClockActive = true;
        },
        readRacingClock() {
          syncRacingClock();
          return {
            durationMs: roundValue(racingClockDurationMs),
            visibilityLost: racingClockVisibilityLost,
          };
        },
        endRacingClock() {
          const endedAt = performance.now();
          syncRacingClock(endedAt);
          racingClockActive = false;
          return {
            apiVersion: 1,
            method: "mutation-observed-game-shell-racing-gate",
            measuredDurationMs: roundValue(endedAt - racingClockStartedAt),
            durationMs: roundValue(racingClockDurationMs),
            maximumTransitions: maximumRacingClockTransitions,
            overflowed: racingClockOverflowed,
            visibilityLost: racingClockVisibilityLost,
            transitionCount: racingClockTransitions.length,
            transitions: racingClockTransitions.map((transition) => ({ ...transition })),
          };
        },
      }),
    });
  }, { maximumSamples: MAXIMUM_FRAME_WORK_SAMPLES });
}

async function prepareRivalProgress(page) {
  const setup = await page.evaluate(async () => {
    const expectedTrackIds = [
      "canyon-kickoff",
      "pine-run",
      "coastline-clash",
      "foundry-flight",
      "summit-showdown",
    ];
    const exactKeys = (value, keys) => value !== null
      && typeof value === "object"
      && !Array.isArray(value)
      && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort());
    const database = await new Promise((resolveDatabase, rejectDatabase) => {
      const request = indexedDB.open("rivet-ridge-rally");
      request.onsuccess = () => resolveDatabase(request.result);
      request.onerror = () => rejectDatabase(request.error ?? new Error("Performance progress database could not be opened."));
    });
    try {
      if (database.version !== 60 || !database.objectStoreNames.contains("progress")) {
        throw new Error("Performance progress database identity does not match the product schema.");
      }
      const readProgressRecord = () => new Promise((resolveRecord, rejectRecord) => {
        const transaction = database.transaction("progress", "readonly");
        const request = transaction.objectStore("progress").get("rider-01");
        request.onsuccess = () => resolveRecord(request.result);
        request.onerror = () => rejectRecord(request.error ?? new Error("Performance progress record could not be read."));
      });
      let record;
      const settleDeadline = performance.now() + 5_000;
      while (performance.now() < settleDeadline) {
        record = await readProgressRecord();
        if (record?.value?.tutorialComplete === true) break;
        await new Promise((resolveWait) => setTimeout(resolveWait, 50));
      }
      if (
        !record
        || record.id !== "rider-01"
        || record.schemaVersion !== 1
        || !Number.isSafeInteger(record.updatedAt)
        || record.updatedAt <= 0
        || !exactKeys(record, ["id", "schemaVersion", "updatedAt", "value"])
        || !exactKeys(record.value, ["version", "tutorialComplete", "selectedTrackId", "tracks"])
        || record.value.version !== 1
        || record.value.tutorialComplete !== true
        || record.value.selectedTrackId !== "canyon-kickoff"
        || !exactKeys(record.value.tracks, expectedTrackIds)
      ) {
        throw new Error("Performance progress record does not match the product schema.");
      }
      for (const trackId of expectedTrackIds) {
        const progress = record.value.tracks[trackId];
        if (
          !exactKeys(progress, ["soloQualified", "rivalUnlocked", "masteryLevel"])
          || typeof progress.soloQualified !== "boolean"
          || typeof progress.rivalUnlocked !== "boolean"
          || !Number.isSafeInteger(progress.masteryLevel)
          || progress.masteryLevel < 0
        ) {
          throw new Error(`Performance progress track record is not canonical: ${trackId}.`);
        }
      }
      const next = structuredClone(record);
      next.value.tutorialComplete = true;
      next.value.selectedTrackId = "canyon-kickoff";
      next.value.tracks["canyon-kickoff"] = {
        ...next.value.tracks["canyon-kickoff"],
        soloQualified: true,
        rivalUnlocked: true,
        bestSoloMs: 190_000,
      };
      next.updatedAt = Date.now();
      const transaction = database.transaction("progress", "readwrite");
      const completed = new Promise((resolveTransaction, rejectTransaction) => {
        transaction.oncomplete = () => resolveTransaction();
        transaction.onabort = () => rejectTransaction(transaction.error ?? new Error("Performance progress transaction was aborted."));
        transaction.onerror = () => rejectTransaction(transaction.error ?? new Error("Performance progress transaction failed."));
      });
      transaction.objectStore("progress").put(next);
      await completed;
      return {
        method: "native-indexeddb-progress-record",
        database: "rivet-ridge-rally",
        nativeIndexedDbVersion: database.version,
        profileId: "rider-01",
        trackId: "canyon-kickoff",
        expectedTrackIds,
        bestSoloMs: 190_000,
        rivalUnlocked: true,
      };
    } finally {
      database.close();
    }
  });

  await page.reload({ waitUntil: "load", timeout: 30_000 });
  await waitForTitleReady(page);
  await page.getByRole("button", { name: "Ride", exact: true }).click();
  const rival = page.getByRole("button", { name: /Rival Main Race/ });
  await rival.waitFor({ state: "visible", timeout: 10_000 });
  if (!await rival.isEnabled()) throw new Error("Persisted Rival setup was not accepted by the public mode screen.");
  await page.getByRole("button", { name: "Back to main menu", exact: true }).click();
  await page.getByRole("button", { name: "Ride", exact: true }).waitFor({ state: "visible", timeout: 10_000 });
  return { ...setup, verifiedViaPublicUi: true };
}

export async function openShell(page, baseURL) {
  const target = new URL(baseURL);
  await installFrameWorkCapture(page);
  const startedAt = nodePerformance.now();
  const response = await page.goto(target.href, { waitUntil: "load", timeout: 30_000 });
  if (!response?.ok()) {
    throw new Error(`Performance shell returned HTTP ${response?.status() ?? "unknown"}.`);
  }
  if (new URL(response.url()).origin !== target.origin) {
    throw new Error("Performance shell navigation left the dedicated origin.");
  }
  await waitForInitialTitleAction(page);
  const shellReadyMs = round(nodePerformance.now() - startedAt);
  const timing = await navigationEvidence(page);
  await completeTitleEntry(page);
  const progressSetup = await prepareRivalProgress(page);
  return {
    status: response?.status() ?? null,
    shellReadyMs,
    progressSetup,
    timing,
  };
}

export async function setExplicitQuality(page, quality) {
  if (!["low", "medium", "high"].includes(quality)) {
    throw new Error("Performance quality must be low, medium, or high; auto is not admissible evidence.");
  }
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("heading", { name: "Settings", exact: true }).waitFor({ state: "visible", timeout: 10_000 });
  await page.getByRole("button", { name: "play", exact: true }).click();
  const qualitySelect = page.locator("label.select-row", { hasText: "Quality" }).locator("select");
  await qualitySelect.selectOption(quality);
  const selected = await qualitySelect.inputValue();
  if (selected !== quality) throw new Error(`Performance quality did not persist in the active session: ${selected}.`);
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await page.getByRole("button", { name: "Ride", exact: true }).waitFor({ state: "visible", timeout: 10_000 });
  return {
    requested: quality,
    selected,
    effective: quality,
    effectiveDerivation: "explicit-non-auto-renderer-preset",
  };
}

export async function navigationEvidence(page) {
  return page.evaluate(() => {
    const navigation = performance.getEntriesByType("navigation")[0];
    if (!(navigation instanceof PerformanceNavigationTiming)) return null;
    return {
      durationMs: Math.round(navigation.duration * 100) / 100,
      domInteractiveMs: Math.round(navigation.domInteractive * 100) / 100,
      domContentLoadedMs: Math.round(navigation.domContentLoadedEventEnd * 100) / 100,
      loadEventMs: Math.round(navigation.loadEventEnd * 100) / 100,
      responseEndMs: Math.round(navigation.responseEnd * 100) / 100,
      transferSizeBytes: navigation.transferSize,
      encodedBodyBytes: navigation.encodedBodySize,
      decodedBodyBytes: navigation.decodedBodySize,
    };
  });
}

export async function resourceEvidence(page) {
  return page.evaluate(() => {
    const resources = performance.getEntriesByType("resource")
      .filter((entry) => entry instanceof PerformanceResourceTiming)
      .map((entry) => {
        const resource = entry;
        return {
          path: new URL(resource.name, window.location.href).pathname,
          initiatorType: resource.initiatorType,
          durationMs: Math.round(resource.duration * 100) / 100,
          transferSizeBytes: resource.transferSize,
          encodedBodyBytes: resource.encodedBodySize,
          decodedBodyBytes: resource.decodedBodySize,
        };
      });
    return {
      requestCount: resources.length,
      transferSizeBytes: resources.reduce((sum, resource) => sum + resource.transferSizeBytes, 0),
      encodedBodyBytes: resources.reduce((sum, resource) => sum + resource.encodedBodyBytes, 0),
      decodedBodyBytes: resources.reduce((sum, resource) => sum + resource.decodedBodyBytes, 0),
      resources,
    };
  });
}

export async function createPerformanceSession(context, page) {
  const session = await context.newCDPSession(page);
  await session.send("Performance.enable");
  return session;
}

export async function heapEvidence(session) {
  try {
    const response = await session.send("Performance.getMetrics");
    const metrics = new Map(response.metrics.map((metric) => [metric.name, metric.value]));
    const used = metrics.get("JSHeapUsedSize");
    const total = metrics.get("JSHeapTotalSize");
    return {
      available: used !== undefined,
      usedBytes: used === undefined ? null : Math.round(used),
      totalBytes: total === undefined ? null : Math.round(total),
    };
  } catch (error) {
    return { available: false, usedBytes: null, totalBytes: null, error: error instanceof Error ? error.message : String(error) };
  }
}

export function parseHud(text) {
  const match = /([\d.]+|--) FPS · ([\d.]+|--) ms · (\d+) draws(?: · ([\d.]+) ms dropped)?/.exec(text ?? "");
  if (!match) return null;
  return {
    fps: match[1] === "--" ? null : Number(match[1]),
    frameTimeMs: match[2] === "--" ? null : Number(match[2]),
    drawCalls: Number(match[3]),
    droppedSimulationMs: match[4] === undefined ? null : Number(match[4]),
  };
}

export async function waitForRaceReady(page, timeout = 20_000) {
  const raceCanvas = page.getByLabel(/Live 3D race on/);
  await raceCanvas.waitFor({ state: "visible", timeout });
  await page.locator('.game-shell[data-race-gate-phase="racing"]').waitFor({ state: "attached", timeout });
  await page.waitForFunction((expectedRoot) => {
    const canvas = document.querySelector(".game-canvas");
    return canvas instanceof HTMLCanvasElement
      && canvas.dataset.bikeAsset === "ready"
      && canvas.dataset.heroBikeRoot === expectedRoot
      && !canvas.hasAttribute("data-bike-fallback-reason");
  }, "RRR_HeroBikeRider", { timeout });
  await page.waitForFunction(() => {
    const output = document.querySelector('[aria-label="Performance metrics"]');
    const match = /([\d.]+|--) FPS · ([\d.]+|--) ms · (\d+) draws/.exec(output?.textContent ?? "");
    return match !== null && Number(match[3]) > 0;
  }, undefined, { timeout });
  const authoredHero = await raceCanvas.evaluate((canvas) => ({
    bikeAsset: canvas.dataset.bikeAsset ?? null,
    fallbackReason: canvas.dataset.bikeFallbackReason ?? null,
    root: canvas.dataset.heroBikeRoot ?? null,
  }));
  if (
    authoredHero.bikeAsset !== "ready"
    || authoredHero.root !== "RRR_HeroBikeRider"
    || authoredHero.fallbackReason !== null
  ) {
    throw new Error("Race readiness lost the authored hero asset before evidence capture.");
  }
  return authoredHero;
}

export async function startProductRace(page, mode = "practice") {
  const modeNames = {
    practice: /^03 Practice/,
    rival: /^02 Rival Main Race/,
    solo: /^01 Solo Challenge/,
  };
  const modeName = modeNames[mode];
  if (!modeName) throw new Error(`Unsupported performance race mode: ${mode}.`);
  await page.getByRole("button", { name: "Ride", exact: true }).click();
  const modeButton = page.getByRole("button", { name: modeName });
  await modeButton.waitFor({ state: "visible", timeout: 10_000 });
  if (!await modeButton.isEnabled()) throw new Error(`Performance race mode is locked: ${mode}.`);
  const startedAt = nodePerformance.now();
  await modeButton.click();
  await page.locator(
    '.game-shell[data-race-gate-phase="countdown"], .game-shell[data-race-gate-phase="racing"]',
  ).waitFor({ state: "attached", timeout: 20_000 });
  const firstRaceLoadMs = round(nodePerformance.now() - startedAt);
  await waitForRaceReady(page);
  return firstRaceLoadMs;
}

export async function renderingEvidence(page, sampleSeconds) {
  const output = page.getByLabel("Performance metrics");
  await page.waitForFunction(() => /^\d+(?:\.\d+)? FPS/.test(document.querySelector('[aria-label="Performance metrics"]')?.textContent ?? ""), undefined, { timeout: 10_000 });
  const samples = [];
  await page.evaluate(() => {
    if (!window.__RRR_PERF_CAPTURE__) throw new Error("Pre-navigation frame-work capture is unavailable.");
    window.__RRR_PERF_CAPTURE__.begin();
  });
  const deadline = nodePerformance.now() + sampleSeconds * 1_000;
  let capture;
  try {
    while (nodePerformance.now() < deadline) {
      const parsed = parseHud(await output.textContent().catch(() => null));
      if (parsed?.fps !== null && parsed?.frameTimeMs !== null) {
        samples.push({ elapsedMs: round(sampleSeconds * 1_000 - Math.max(0, deadline - nodePerformance.now())), ...parsed });
      }
      const remainingMs = deadline - nodePerformance.now();
      if (remainingMs > 0) await page.waitForTimeout(Math.min(400, remainingMs));
    }
  } finally {
    capture = await page.evaluate(() => window.__RRR_PERF_CAPTURE__.end());
  }
  const frameSamples = capture.samples;
  return {
    durationMs: round(sampleSeconds * 1_000),
    sampleCount: samples.length,
    fps: summarize(samples.map((sample) => sample.fps)),
    frameTimeMs: summarize(samples.map((sample) => sample.frameTimeMs)),
    drawCalls: summarize(samples.map((sample) => sample.drawCalls)),
    samples,
    frameWork: {
      apiVersion: capture.apiVersion,
      method: capture.method,
      scope: capture.scope,
      measuredDurationMs: capture.measuredDurationMs,
      maximumSamples: capture.maximumSamples,
      overflowed: capture.overflowed,
      visibilityLost: capture.visibilityLost,
      sampleCount: frameSamples.length,
      meanFps: rawFrameRate(frameSamples),
      frameWorkMs: summarize(frameSamples.map((sample) => sample.frameWorkMs)),
      samples: frameSamples,
    },
  };
}

export async function measureRestart(page) {
  const startedAt = nodePerformance.now();
  const completed = page.getByRole("button", { name: "Retry now" });
  if (await completed.isVisible().catch(() => false)) {
    await completed.click();
  } else {
    await page.keyboard.press("Escape");
    await page.getByRole("dialog", { name: "Race paused" }).waitFor({ state: "visible", timeout: 5_000 });
    await page.getByRole("button", { name: "Restart now", exact: true }).click();
  }
  await page.locator(
    '.game-shell[data-race-gate-phase="loading"], .game-shell[data-race-gate-phase="countdown"]',
  ).waitFor({ state: "attached", timeout: 15_000 });
  await waitForRaceReady(page);
  return round(nodePerformance.now() - startedAt);
}

export async function returnToTitleFromRace(page) {
  const completed = page.getByRole("button", { name: "Retry now" });
  if (await completed.isVisible().catch(() => false)) {
    await page.getByRole("button", { name: "Festival menu" }).click();
    await waitForTitleReady(page);
    return;
  }
  await page.keyboard.press("Escape");
  await page.getByRole("dialog", { name: "Race paused" }).waitFor({ state: "visible", timeout: 5_000 });
  await page.getByRole("button", { name: "Festival menu" }).click();
  await waitForTitleReady(page);
}

export async function measureEditor(page) {
  const openStartedAt = nodePerformance.now();
  await page.getByRole("button", { name: "Track Builder", exact: true }).click();
  await page.getByLabel(/Interactive 3D track build camera/).waitFor({ state: "visible", timeout: 20_000 });
  await page.evaluate(() => new Promise((resolveFrame) => requestAnimationFrame(() => requestAnimationFrame(resolveFrame))));
  const openMs = round(nodePerformance.now() - openStartedAt);

  const testRide = page.locator("button.test-ride");
  const controlVisible = await testRide.isVisible();
  const testPlayStartedAt = nodePerformance.now();
  if (controlVisible) await testRide.click();
  else await testRide.evaluate((button) => button.click());
  await waitForRaceReady(page);
  return {
    openMs,
    testPlayMs: round(nodePerformance.now() - testPlayStartedAt),
    testRideControlVisible: controlVisible,
    testRideInvocation: controlVisible ? "visible-control" : "dom-click-hidden-control",
  };
}

export async function measureInputResponsiveness(page, code) {
  if (!["ArrowLeft", "ArrowRight"].includes(code)) {
    throw new Error(`Unsupported lane input ${code}.`);
  }
  await page.evaluate((expectedCode) => {
    window.__RRR_PERF_INPUT__ = null;
    const listener = (event) => {
      if (event.code !== expectedCode) return;
      window.removeEventListener("keydown", listener, true);
      const receivedAt = performance.now();
      const dispatchDelayMs = Math.max(0, receivedAt - event.timeStamp);
      requestAnimationFrame(() => {
        window.__RRR_PERF_INPUT__ = {
          dispatchDelayMs,
          keydownToFrameMs: performance.now() - receivedAt,
        };
      });
    };
    window.addEventListener("keydown", listener, true);
  }, code);
  await page.keyboard.press(code, { delay: 100 });
  await page.waitForFunction(() => window.__RRR_PERF_INPUT__ !== null, undefined, { timeout: 2_000 });
  return page.evaluate(() => {
    const sample = window.__RRR_PERF_INPUT__;
    window.__RRR_PERF_INPUT__ = null;
    return sample;
  });
}

export { nodePerformance };

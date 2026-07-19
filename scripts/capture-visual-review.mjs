import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, writeFile } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import process from "node:process";
import { isDeepStrictEqual } from "node:util";
import { gzipSync } from "node:zlib";

import { chromium } from "playwright";

import {
  REPO_ROOT,
  readOption,
  sourceIdentityEvidence,
  verifyServedBuild,
} from "./performance/common.mjs";
import {
  loadVisualCandidate,
  startVisualCandidateServer,
} from "./visual-candidate-support.mjs";

const TRACKS = [
  { id: "canyon-kickoff", name: "Canyon Kickoff", midcourseDistance: 650 },
  { id: "pine-run", name: "Pine Run", midcourseDistance: 720 },
  { id: "coastline-clash", name: "Coastline Clash", midcourseDistance: 790 },
  { id: "foundry-flight", name: "Foundry Flight", midcourseDistance: 825 },
  { id: "summit-showdown", name: "Summit Showdown", midcourseDistance: 900 },
];
const VIEWPORT = { width: 1280, height: 720 };
const argumentsList = process.argv.slice(2);
const serverPort = Number(readOption(argumentsList, "port", "4373"));
if (!Number.isSafeInteger(serverPort) || serverPort <= 0 || serverPort > 65_535) {
  throw new Error("--port must be an integer from 1 through 65535.");
}
const requestedOutputDirectory = readOption(
  argumentsList,
  "output-dir",
  "artifacts/visual-review/rc2-five-track-controlled",
);

function canonicalOutputDirectory(value) {
  if (
    typeof value !== "string"
    || value.length === 0
    || isAbsolute(value)
    || /[\\\u0000-\u001f\u007f]/u.test(value)
  ) throw new Error("--output-dir must be a canonical repository-relative path.");
  const segments = value.split("/");
  if (
    segments.length !== 3
    || segments[0] !== "artifacts"
    || segments[1] !== "visual-review"
    || !/^[a-z0-9][a-z0-9._-]*$/iu.test(segments[2])
    || segments.some((segment) => segment === "." || segment === "..")
  ) {
    throw new Error("--output-dir must be a direct child of artifacts/visual-review/.");
  }
  return value;
}

const outputDirectory = canonicalOutputDirectory(requestedOutputDirectory);
const outputRoot = resolve(REPO_ROOT, outputDirectory);
const artifactsRoot = resolve(REPO_ROOT, "artifacts");
const visualReviewRoot = resolve(artifactsRoot, "visual-review");
if (relative(REPO_ROOT, outputRoot).split(sep).join("/") !== outputDirectory) {
  throw new Error("--output-dir escapes the repository.");
}

async function lstatOrNull(pathname) {
  return lstat(pathname).catch((error) => {
    if (error?.code === "ENOENT") return null;
    throw error;
  });
}

async function requireRealDirectory(pathname, label) {
  const entry = await lstat(pathname);
  if (!entry.isDirectory() || entry.isSymbolicLink()) {
    throw new Error(`${label} must be a real directory.`);
  }
}

async function prepareFreshOutputBundle(phases) {
  await requireRealDirectory(REPO_ROOT, "Repository root");
  for (const [pathname, label] of [
    [artifactsRoot, "artifacts"],
    [visualReviewRoot, "artifacts/visual-review"],
  ]) {
    if (await lstatOrNull(pathname) === null) await mkdir(pathname, { recursive: false });
    await requireRealDirectory(pathname, label);
  }
  if (await lstatOrNull(outputRoot) !== null) {
    throw new Error(`Visual review output already exists: ${outputDirectory}`);
  }
  await mkdir(outputRoot, { recursive: false });
  await requireRealDirectory(outputRoot, "Visual review output root");
  for (const phase of [...new Set(phases)].toSorted()) {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(phase)) {
      throw new Error(`Visual review phase is not canonical: ${phase}`);
    }
    const phaseDirectory = resolve(outputRoot, phase);
    await mkdir(phaseDirectory, { recursive: false });
    await requireRealDirectory(phaseDirectory, `Visual review phase ${phase}`);
  }
}

async function assertSafeOutputRoot() {
  await requireRealDirectory(REPO_ROOT, "Repository root");
  await requireRealDirectory(artifactsRoot, "artifacts");
  await requireRealDirectory(visualReviewRoot, "artifacts/visual-review");
  await requireRealDirectory(outputRoot, "Visual review output root");
}

async function assertSafeOutputPhase(phase) {
  await assertSafeOutputRoot();
  await requireRealDirectory(resolve(outputRoot, phase), `Visual review phase ${phase}`);
}

function sha256(contents) {
  return createHash("sha256").update(contents).digest("hex");
}

function asCandidateError(stage, error) {
  return {
    stage,
    name: error instanceof Error ? error.name : "Error",
    message: error instanceof Error ? error.message : String(error),
  };
}

async function collectCandidateEvidence(candidate, key, errors, stage, collect) {
  try {
    candidate[key] = await collect();
  } catch (error) {
    errors.push(asCandidateError(stage, error));
  }
}

function responseManifestPath(urlValue, navigationURL, candidateFiles) {
  let url;
  try {
    url = new URL(urlValue);
  } catch {
    return null;
  }
  if (url.origin !== navigationURL.origin) return null;
  if (url.pathname.includes("%")) return null;
  if (url.pathname === "/" || url.pathname === "/index.html") {
    if (url.search !== navigationURL.search) return null;
    return "index.html";
  }
  if (url.search || url.hash) return null;
  let manifestPath;
  try {
    manifestPath = decodeURIComponent(url.pathname.slice(1));
  } catch {
    return null;
  }
  return candidateFiles.has(manifestPath) ? manifestPath : null;
}

function visualCandidateRequestURL(input) {
  const target = new URL(input);
  if (target.pathname === "/" || target.pathname === "/index.html") {
    target.searchParams.set("qa-visual-freeze", "1");
    target.searchParams.set("qa-visual-distance", "0");
  }
  return target;
}

async function verifyVisualCandidateServedBuild(inventory, server) {
  const evidence = await verifyServedBuild(inventory, server.baseURL, {
    fetchImpl: (input, init) => fetch(visualCandidateRequestURL(input), init),
  });
  return {
    ...evidence,
    entrypoint: {
      ...evidence.entrypoint,
      requestedURL: visualCandidateRequestURL(server.baseURL).href,
    },
  };
}

function createBrowserResponseAudit(page, candidate, navigationURL) {
  const candidateFiles = new Map(candidate.manifest.files.map((record) => [record.path, record]));
  const pending = new Set();
  const sameOriginRequests = new Set();
  const completedRequests = new Set();
  const failedRequests = new Set();
  const occurrences = [];
  const unexpectedResponses = [];
  const recordUnexpected = (kind, details) => {
    unexpectedResponses.push({ kind, ...details });
  };
  const onRequest = (request) => {
    let url;
    try {
      url = new URL(request.url());
    } catch {
      recordUnexpected("invalid-request-url", { requestedURL: request.url() });
      return;
    }
    if (!["http:", "https:"].includes(url.protocol)) return;
    if (url.origin !== navigationURL.origin) {
      recordUnexpected("cross-origin-request", { requestedURL: request.url() });
    } else {
      sameOriginRequests.add(request);
    }
    if (request.method() !== "GET") {
      recordUnexpected("unexpected-request-method", {
        method: request.method(),
        requestedURL: request.url(),
      });
    }
    if (request.redirectedFrom()) {
      recordUnexpected("redirected-request", {
        redirectedFrom: request.redirectedFrom()?.url() ?? null,
        requestedURL: request.url(),
      });
    }
  };
  const onRequestFailed = (request) => {
    failedRequests.add(request);
    recordUnexpected("failed-request", {
      requestedURL: request.url(),
      errorText: request.failure()?.errorText ?? "unknown",
    });
  };
  const onResponse = (response) => {
    const operation = (async () => {
      const request = response.request();
      const requestedURL = request.url();
      const finalURL = response.url();
      let finalOrigin = null;
      try {
        finalOrigin = new URL(finalURL).origin;
      } catch {
        recordUnexpected("invalid-response-url", {
          requestedURL,
          finalURL,
          status: response.status(),
        });
        return;
      }
      let actual = null;
      let bodyError = null;
      if (finalOrigin === navigationURL.origin) {
        completedRequests.add(request);
        try {
          const contents = await response.body();
          const gzipContents = gzipSync(contents, { level: 9 });
          actual = {
            bytes: contents.byteLength,
            gzipBytes: gzipContents.byteLength,
            gzipSha256: sha256(gzipContents),
            sha256: sha256(contents),
          };
        } catch (error) {
          bodyError = error instanceof Error ? error.message : String(error);
        }
      }
      const requestedManifestPath = responseManifestPath(requestedURL, navigationURL, candidateFiles);
      const finalManifestPath = responseManifestPath(finalURL, navigationURL, candidateFiles);
      if (!requestedManifestPath || requestedManifestPath !== finalManifestPath) {
        recordUnexpected("unmapped-or-substituted-response", {
          requestedURL,
          finalURL,
          status: response.status(),
          actual,
          bodyError,
        });
        return;
      }
      if (request.redirectedFrom() || requestedURL !== finalURL) {
        recordUnexpected("redirected-response", {
          requestedURL,
          finalURL,
          status: response.status(),
          actual,
          bodyError,
        });
        return;
      }
      if (response.status() !== 200) {
        recordUnexpected("unexpected-response-status", {
          manifestPath: finalManifestPath,
          requestedURL,
          finalURL,
          status: response.status(),
          actual,
          bodyError,
        });
        return;
      }
      const fromServiceWorker = response.fromServiceWorker();
      if (fromServiceWorker) {
        recordUnexpected("service-worker-response", {
          manifestPath: finalManifestPath,
          requestedURL,
          finalURL,
          status: response.status(),
          actual,
          bodyError,
        });
        return;
      }
      const candidateHeader = await response.headerValue("x-rrr-visual-candidate");
      if (candidateHeader !== candidate.manifestSha256) {
        recordUnexpected("candidate-header-mismatch", {
          manifestPath: finalManifestPath,
          requestedURL,
          finalURL,
          status: response.status(),
          actual: candidateHeader,
          expected: candidate.manifestSha256,
          responseBody: actual,
          bodyError,
        });
        return;
      }
      if (!actual) {
        recordUnexpected("response-body-unavailable", {
          manifestPath: finalManifestPath,
          requestedURL,
          finalURL,
          status: response.status(),
          message: bodyError ?? "unknown",
        });
        return;
      }
      const expected = candidateFiles.get(finalManifestPath);
      if (
        expected?.type !== "file"
        || actual.bytes !== expected.bytes
        || actual.gzipBytes !== expected.gzipBytes
        || actual.gzipSha256 !== expected.gzipSha256
        || actual.sha256 !== expected.sha256
      ) {
        recordUnexpected("response-body-mismatch", {
          manifestPath: finalManifestPath,
          requestedURL,
          finalURL,
          status: response.status(),
          actual,
          expected: expected ?? null,
        });
        return;
      }
      occurrences.push({
        manifestPath: finalManifestPath,
        requestedURL,
        finalURL,
        status: response.status(),
        fromServiceWorker,
        ...actual,
      });
    })().catch((error) => {
      recordUnexpected("response-audit-error", {
        requestedURL: response.request().url(),
        finalURL: response.url(),
        message: error instanceof Error ? error.message : String(error),
      });
    });
    pending.add(operation);
    void operation.finally(() => pending.delete(operation));
  };
  page.on("request", onRequest);
  page.on("requestfailed", onRequestFailed);
  page.on("response", onResponse);
  return {
    async finalize() {
      while (pending.size > 0) await Promise.allSettled([...pending]);
      for (const request of sameOriginRequests) {
        if (!completedRequests.has(request) && !failedRequests.has(request)) {
          recordUnexpected("unsettled-request", { requestedURL: request.url() });
        }
      }
      page.off("request", onRequest);
      page.off("requestfailed", onRequestFailed);
      page.off("response", onResponse);
      const sortedOccurrences = occurrences.toSorted((left, right) => (
        left.manifestPath.localeCompare(right.manifestPath, "en")
        || left.requestedURL.localeCompare(right.requestedURL, "en")
        || left.finalURL.localeCompare(right.finalURL, "en")
      ));
      const files = [];
      for (const occurrence of sortedOccurrences) {
        if (files.at(-1)?.path !== occurrence.manifestPath) {
          files.push({
            path: occurrence.manifestPath,
            bytes: occurrence.bytes,
            gzipBytes: occurrence.gzipBytes,
            gzipSha256: occurrence.gzipSha256,
            sha256: occurrence.sha256,
          });
        }
      }
      const finalOriginBound = unexpectedResponses.every((entry) => (
        !["cross-origin-request", "invalid-request-url", "redirected-request", "redirected-response"]
          .includes(entry.kind)
      ));
      const responseBodiesBound = sortedOccurrences.length > 0
        && unexpectedResponses.length === 0;
      const status = finalOriginBound && responseBodiesBound ? "PASS" : "FAIL";
      return {
        status,
        candidateAggregateSha256: candidate.manifest.aggregateSha256,
        serviceWorkersBlocked: true,
        cacheDisabled: true,
        finalOriginBound,
        responseBodiesBound,
        unexpectedResponses,
        occurrences: sortedOccurrences,
        files,
        requestCount: sameOriginRequests.size,
      };
    },
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
  const highContrast = page.getByRole("checkbox", { name: /^High contrast/ });
  if (await highContrast.isChecked()) await highContrast.uncheck();
  await page.getByRole("slider", { name: /^UI scale/ }).fill("1");
  await page.getByRole("button", { name: "play", exact: true }).click();
  const quality = page.getByLabel("Quality");
  await quality.selectOption("high");
  if (await quality.inputValue() !== "high") throw new Error("High quality was not selected.");
  await page.getByRole("button", { name: "Done", exact: true }).click();
}

async function waitForFrozenRace(page, track, mode, distance) {
  const canvas = page.getByLabel(`Live 3D race on ${track.name}`);
  await canvas.waitFor({ state: "visible", timeout: 20_000 });
  await page.waitForFunction(({
    accessibleName,
    expectedDistance,
    expectsCanyonAssets,
    expectsRivalPack,
  }) => {
    const candidate = Array.from(document.querySelectorAll("canvas")).find(
      (element) => element.getAttribute("aria-label") === accessibleName,
    );
    return candidate instanceof HTMLCanvasElement
      && candidate.dataset.visualState === "frozen"
      && candidate.dataset.bikeAsset === "ready"
      && Number(candidate.dataset.visualDistance) === expectedDistance
      && (!expectsRivalPack || candidate.dataset.rivalPackAsset === "ready")
      && (!expectsCanyonAssets || (
        candidate.dataset.canyonKitAsset === "ready"
        && candidate.dataset.environmentAsset === "ready"
      ));
  }, {
    accessibleName: `Live 3D race on ${track.name}`,
    expectedDistance: distance,
    expectsCanyonAssets: track.id === "canyon-kickoff",
    expectsRivalPack: mode === "rival",
  }, { timeout: 20_000 });
  await page.evaluate(async () => {
    const ridgeDisplayFaces = [
      '700 1em "Ridge Display"',
      '900 1em "Ridge Display"',
    ];
    await Promise.all(ridgeDisplayFaces.map((face) => document.fonts.load(face)));
    await document.fonts.ready;
    if (ridgeDisplayFaces.some((face) => !document.fonts.check(face))) {
      throw new Error("Ridge Display 700 and 900 must both be loaded before visual capture.");
    }
    await new Promise((resolveFrame) => requestAnimationFrame(() => (
      requestAnimationFrame(() => resolveFrame())
    )));
  });
  return canvas;
}

function expectedRaceHeading(track, mode) {
  const runLabel = mode === "practice" ? "Practice" : mode === "solo" ? "Solo" : mode;
  return `${track.name} ${runLabel} race`;
}

async function capture(browser, entry, candidate, baseURL) {
  const context = await browser.newContext({
    viewport: VIEWPORT,
    deviceScaleFactor: 1,
    serviceWorkers: "block",
    extraHTTPHeaders: { "Cache-Control": "no-cache", Pragma: "no-cache" },
  });
  const page = await context.newPage();
  const cdpSession = await context.newCDPSession(page);
  await cdpSession.send("Network.enable");
  await cdpSession.send("Network.setCacheDisabled", { cacheDisabled: true });
  await cdpSession.send("Network.setBypassServiceWorker", { bypass: true });
  const diagnostics = attachDiagnostics(page);
  const relativePath = `${entry.phase}/${entry.track.id}-${entry.mode}-1280x720.png`;
  const absolutePath = resolve(outputRoot, relativePath);
  if (relative(outputRoot, absolutePath).split(sep).join("/") !== relativePath) {
    throw new Error(`Visual capture path escaped the fresh output bundle: ${relativePath}`);
  }
  let screenshotHash = null;
  let screenshotBytes = null;
  let error = null;
  let readiness = null;
  let responseSet = null;
  let responseAudit = null;
  let state = null;

  try {
    const target = new URL(baseURL);
    target.searchParams.set("qa-visual-freeze", "1");
    target.searchParams.set("qa-visual-distance", String(entry.distance));
    responseAudit = createBrowserResponseAudit(page, candidate, target);
    const response = await page.goto(target.href, { waitUntil: "load", timeout: 30_000 });
    if (!response?.ok()) throw new Error(`QA shell returned HTTP ${response?.status() ?? "unknown"}.`);
    if (response.url() !== target.href) throw new Error("QA shell navigation was redirected or substituted.");
    await waitForShell(page);
    await selectHighQuality(page);
    await page.evaluate(({ trackId, mode }) => {
      if (!window.__RRR_QA__) throw new Error("VITE_QA_MODE=1 capture API is unavailable.");
      window.__RRR_QA__.unlockCampaign();
      window.__RRR_QA__.startTrack(trackId, mode);
    }, { trackId: entry.track.id, mode: entry.mode });
    const canvas = await waitForFrozenRace(page, entry.track, entry.mode, entry.distance);
    const observed = await page.evaluate(() => {
      const root = document.documentElement;
      const queryParameters = new URLSearchParams(window.location.search);
      const uiScaleStyle = root.style.getPropertyValue("--ui-scale").trim();
      return {
        state: {
          query: window.location.search,
          fastRace: queryParameters.has("qa-fast-race"),
          highContrast: root.dataset.highContrast === "true",
          uiScale: Number(uiScaleStyle),
        },
        highContrastDataset: root.dataset.highContrast ?? null,
        uiScaleStyle,
        raceHeading: document.querySelector("main.game-shell h1.sr-only")?.textContent?.trim()
          ?? null,
      };
    });
    const expectedHeading = expectedRaceHeading(entry.track, entry.mode);
    if (
      observed.state.query !== target.search
      || observed.state.fastRace !== false
      || observed.state.highContrast !== false
      || observed.state.uiScale !== 1
      || observed.highContrastDataset !== "false"
      || observed.uiScaleStyle !== "1"
      || observed.raceHeading !== expectedHeading
    ) {
      throw new Error(
        `Observed visual state does not match ${expectedHeading}: ${JSON.stringify(observed)}`,
      );
    }
    state = observed.state;
    readiness = await canvas.evaluate((element) => ({
      visualState: element.dataset.visualState ?? null,
      bikeAsset: element.dataset.bikeAsset ?? null,
      rivalPackAsset: element.dataset.rivalPackAsset ?? null,
      canyonKitAsset: element.dataset.canyonKitAsset ?? null,
      environmentAsset: element.dataset.environmentAsset ?? null,
      canyonKitRootCount: element.dataset.canyonKitRootCount ?? null,
      canyonKitPlacementCount: element.dataset.canyonKitPlacementCount ?? null,
      canyonKitMeshCount: element.dataset.canyonKitMeshCount ?? null,
      canyonKitGameplayAuthority: element.dataset.canyonKitGameplayAuthority ?? null,
      canyonKitProceduralReplacementCount:
        element.dataset.canyonKitProceduralReplacementCount ?? null,
      canyonKitReplacedProceduralVisualCount:
        element.dataset.canyonKitReplacedProceduralVisualCount ?? null,
      canyonKitRetainedCoolingCueCount:
        element.dataset.canyonKitRetainedCoolingCueCount ?? null,
      canyonKitTabletopRole: element.dataset.canyonKitTabletopRole ?? null,
      visualDistance: Number(element.dataset.visualDistance),
      ariaLabel: element.getAttribute("aria-label"),
      runtimeBuild: window.__RRR_BUILD__
        ? { commit: window.__RRR_BUILD__.commit, dirty: window.__RRR_BUILD__.dirty }
        : null,
    }));
    readiness.raceHeading = observed.raceHeading;
    const screenshotContents = await page.screenshot({ animations: "disabled" });
    await assertSafeOutputPhase(entry.phase);
    await writeFile(absolutePath, screenshotContents, { flag: "wx" });
    screenshotBytes = screenshotContents.byteLength;
    screenshotHash = sha256(screenshotContents);
  } catch (captureError) {
    error = captureError instanceof Error
      ? { name: captureError.name, message: captureError.message }
      : { name: "Error", message: String(captureError) };
  } finally {
    if (responseAudit) {
      responseSet = await responseAudit.finalize();
      if (responseSet.status !== "PASS" && error === null) {
        error = {
          name: "VisualResponseBindingError",
          message: "Chromium responses were not exactly bound to the visual QA candidate.",
        };
      }
    }
    await cdpSession.detach().catch(() => undefined);
    await context.close();
  }

  const status = error === null
    && screenshotHash !== null
    && diagnostics.consoleMessages.length === 0
    && diagnostics.failedRequests.length === 0
    && diagnostics.httpErrors.length === 0
    && responseSet?.status === "PASS"
    ? "PASS"
    : "FAIL";
  return {
    trackId: entry.track.id,
    trackName: entry.track.name,
    phase: entry.phase,
    project: "chromium",
    mode: entry.mode,
    distance: entry.distance,
    quality: "high",
    viewport: { ...VIEWPORT, deviceScaleFactor: 1 },
    state,
    file: relativePath,
    bytes: screenshotBytes,
    sha256: screenshotHash,
    readiness,
    responseSet,
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
const matrix = [
  ...TRACKS.map((track) => ({ track, phase: "start", mode: "practice", distance: 0 })),
  ...TRACKS.map((track) => ({
    track,
    phase: "midcourse",
    mode: "rival",
    distance: track.midcourseDistance,
  })),
  {
    track: TRACKS[0],
    phase: "curved-baseline-candidate",
    mode: "practice",
    distance: 500,
  },
];
const candidateBefore = await loadVisualCandidate();
await prepareFreshOutputBundle(matrix.map((entry) => entry.phase));
const candidate = {
  manifest: {
    path: candidateBefore.manifestReference,
    sha256: candidateBefore.manifestSha256,
    kind: candidateBefore.manifest.kind,
    format: candidateBefore.manifest.format,
    sourceCommit: candidateBefore.manifest.source.commit,
    aggregateSha256: candidateBefore.manifest.aggregateSha256,
    fileCount: candidateBefore.manifest.fileCount,
    totalBytes: candidateBefore.manifest.totalBytes,
    totalGzipBytes: candidateBefore.manifest.totalGzipBytes,
  },
  sourceBefore: null,
  sourceAfter: null,
  localBuildBefore: candidateBefore.inventory,
  localBuildAfter: null,
  servedBefore: null,
  servedAfter: null,
};
const candidateErrors = [];
await collectCandidateEvidence(
  candidate,
  "sourceBefore",
  candidateErrors,
  "source-identity-before",
  () => sourceIdentityEvidence(),
);
const captures = [];
let browser = null;
let browserVersion = null;
let server = null;
let baseURL = null;
try {
  try {
    server = await startVisualCandidateServer(candidateBefore, serverPort);
    baseURL = server.baseURL;
  } catch (error) {
    candidateErrors.push(asCandidateError("dedicated-candidate-server", error));
  }
  if (server) {
    await collectCandidateEvidence(
      candidate,
      "servedBefore",
      candidateErrors,
      "served-build-inventory-before",
      () => verifyVisualCandidateServedBuild(candidateBefore.inventory, server),
    );
  }

  if (candidateErrors.length === 0 && server) {
    try {
      browser = await chromium.launch({ headless: true, args: ["--mute-audio"] });
      browserVersion = browser.version();
      for (const entry of matrix) {
        captures.push(await capture(browser, entry, candidateBefore, server.baseURL));
      }
    } catch (error) {
      candidateErrors.push(asCandidateError("browser-orchestration", error));
    } finally {
      if (browser) {
        await browser.close().catch((error) => {
          candidateErrors.push(asCandidateError("browser-close", error));
        });
      }
    }
  }

  let candidateAfter = null;
  try {
    candidateAfter = await loadVisualCandidate();
    candidate.localBuildAfter = candidateAfter.inventory;
    if (
      candidateAfter.manifestSha256 !== candidateBefore.manifestSha256
      || !isDeepStrictEqual(candidateAfter.manifest, candidateBefore.manifest)
    ) {
      candidateErrors.push(asCandidateError(
        "candidate-manifest-after",
        new Error("Visual QA candidate manifest changed during capture."),
      ));
    }
  } catch (error) {
    candidateErrors.push(asCandidateError("local-build-inventory-after", error));
  }
  if (server && candidateAfter) {
    await collectCandidateEvidence(
      candidate,
      "servedAfter",
      candidateErrors,
      "served-build-inventory-after",
      () => verifyVisualCandidateServedBuild(candidateAfter.inventory, server),
    );
  }
  await collectCandidateEvidence(
    candidate,
    "sourceAfter",
    candidateErrors,
    "source-identity-after",
    () => sourceIdentityEvidence(),
  );
} finally {
  if (server) {
    await server.close().catch((error) => {
      candidateErrors.push(asCandidateError("dedicated-candidate-server-close", error));
    });
  }
}

const capturesComplete = captures.length === matrix.length;
const capturesPassed = capturesComplete
  && captures.every((captureResult) => captureResult.status === "PASS");
const rivalAssetsReady = capturesComplete
  && captures
    .filter((captureResult) => captureResult.mode === "rival")
    .every((captureResult) => captureResult.readiness?.rivalPackAsset === "ready");
const sourceClean = candidate.sourceBefore?.dirty === false
  && candidate.sourceAfter?.dirty === false;
const sourceStable = candidate.sourceBefore !== null
  && candidate.sourceAfter !== null
  && isDeepStrictEqual(candidate.sourceBefore, candidate.sourceAfter);
const sourceMatchesCandidate = candidate.sourceBefore?.commit === candidate.manifest.sourceCommit
  && candidate.sourceAfter?.commit === candidate.manifest.sourceCommit;
const localBuildStable = candidate.localBuildBefore !== null
  && candidate.localBuildAfter !== null
  && isDeepStrictEqual(candidate.localBuildBefore, candidate.localBuildAfter);
const servedBuildStable = candidate.servedBefore !== null
  && candidate.servedAfter !== null
  && isDeepStrictEqual(candidate.servedBefore, candidate.servedAfter);
const verificationEntrypointURL = server
  ? visualCandidateRequestURL(server.baseURL).href
  : null;
const servedBuildLoopbackBound = server !== null
  && server.protocol === "http:"
  && server.host === "127.0.0.1"
  && server.port === serverPort
  && server.baseURL === baseURL
  && server.origin === (baseURL ? new URL(baseURL).origin : null)
  && [candidate.servedBefore, candidate.servedAfter].every((evidence) => (
    evidence?.baseURL === server.baseURL
    && evidence.origin === server.origin
    && evidence.entrypoint?.requestedURL === verificationEntrypointURL
    && evidence.entrypoint.finalURL === verificationEntrypointURL
  ));
const runtimeSourceBound = capturesComplete
  && captures.every((captureResult) => (
    captureResult.readiness?.runtimeBuild?.commit === candidate.manifest.sourceCommit
    && captureResult.readiness.runtimeBuild.dirty === false
  ));
const browserResponsesBound = capturesComplete
  && captures.every((captureResult) => (
    captureResult.responseSet?.status === "PASS"
    && captureResult.responseSet.candidateAggregateSha256 === candidate.manifest.aggregateSha256
    && captureResult.responseSet.serviceWorkersBlocked === true
    && captureResult.responseSet.cacheDisabled === true
    && captureResult.responseSet.finalOriginBound === true
    && captureResult.responseSet.responseBodiesBound === true
    && captureResult.responseSet.unexpectedResponses.length === 0
  ));
const candidateChecks = [
  {
    id: "source-clean-before-and-after",
    passed: sourceClean,
    actual: {
      before: candidate.sourceBefore?.dirty ?? null,
      after: candidate.sourceAfter?.dirty ?? null,
    },
  },
  {
    id: "source-identity-stable",
    passed: sourceStable,
    actual: {
      before: candidate.sourceBefore?.commit ?? null,
      after: candidate.sourceAfter?.commit ?? null,
    },
  },
  {
    id: "source-matches-clean-qa-candidate",
    passed: sourceMatchesCandidate,
    actual: {
      candidate: candidate.manifest.sourceCommit,
      before: candidate.sourceBefore?.commit ?? null,
      after: candidate.sourceAfter?.commit ?? null,
    },
  },
  {
    id: "candidate-version-matches-package",
    passed: candidateBefore.manifest.version === packageJson.version,
    actual: {
      candidate: candidateBefore.manifest.version,
      package: packageJson.version,
    },
  },
  {
    id: "local-build-inventory-stable",
    passed: localBuildStable,
    actual: {
      before: candidate.localBuildBefore?.aggregateSha256 ?? null,
      after: candidate.localBuildAfter?.aggregateSha256 ?? null,
    },
  },
  {
    id: "served-build-inventory-stable",
    passed: servedBuildStable,
    actual: {
      before: candidate.servedBefore?.aggregateSha256 ?? null,
      after: candidate.servedAfter?.aggregateSha256 ?? null,
    },
  },
  {
    id: "served-build-dedicated-loopback-bound",
    passed: servedBuildLoopbackBound,
    actual: {
      server: server ? {
        protocol: server.protocol,
        host: server.host,
        port: server.port,
        origin: server.origin,
        baseURL: server.baseURL,
      } : null,
      verificationEntrypointURL,
      before: candidate.servedBefore?.entrypoint ?? null,
      after: candidate.servedAfter?.entrypoint ?? null,
    },
  },
  {
    id: "runtime-source-commit-bound",
    passed: runtimeSourceBound,
    actual: {
      sourceCommit: candidate.manifest.sourceCommit,
      runtimeBuilds: captures.map((captureResult) => captureResult.readiness?.runtimeBuild ?? null),
    },
  },
  {
    id: "browser-response-bodies-manifest-bound",
    passed: browserResponsesBound,
    actual: captures.map((captureResult) => ({
      file: captureResult.file,
      responseStatus: captureResult.responseSet?.status ?? null,
      occurrenceCount: captureResult.responseSet?.occurrences.length ?? 0,
      unexpectedResponseCount: captureResult.responseSet?.unexpectedResponses.length ?? 0,
    })),
  },
  {
    id: "complete-capture-matrix",
    passed: capturesComplete,
    actual: { expected: matrix.length, captured: captures.length },
  },
  {
    id: "rival-assets-ready",
    passed: rivalAssetsReady,
    actual: captures
      .filter((captureResult) => captureResult.mode === "rival")
      .map((captureResult) => ({
        trackId: captureResult.trackId,
        rivalPackAsset: captureResult.readiness?.rivalPackAsset ?? null,
      })),
  },
];
const passed = candidateErrors.length === 0
  && capturesPassed
  && candidateChecks.every((check) => check.passed);
const manifest = {
  schemaVersion: 3,
  kind: "five-track-controlled-visual-review",
  createdAt: new Date().toISOString(),
  appVersion: packageJson.version,
  candidate: {
    ...candidate,
    checks: candidateChecks,
    errors: candidateErrors,
  },
  qaBuildRequired: true,
  baseURL,
  server: {
    baseURL,
    origin: server?.origin ?? null,
    protocol: server?.protocol ?? null,
    host: server?.host ?? null,
    port: server?.port ?? null,
    verificationEntrypointURL,
    dedicatedLoopback: servedBuildLoopbackBound,
    candidateManifestSha256: candidate.manifest.sha256,
  },
  browser: {
    name: "Chromium",
    version: browserVersion,
    platform: process.platform,
    headless: true,
    serviceWorkers: "block",
    cache: "disabled",
  },
  viewport: { ...VIEWPORT, deviceScaleFactor: 1 },
  quality: "high",
  productionCourseScale: true,
  captures,
  status: passed ? "PASS" : "FAIL",
};
await assertSafeOutputRoot();
await writeFile(
  resolve(outputRoot, "manifest.json"),
  `${JSON.stringify(manifest, null, 2)}\n`,
  { flag: "wx" },
);
console.log(JSON.stringify({
  outputDirectory,
  status: manifest.status,
  candidateChecks,
  candidateErrors,
  captures: captures.map(({ file, bytes, sha256: hash, status }) => ({
    file,
    bytes,
    sha256: hash,
    status,
  })),
}, null, 2));
if (!passed) process.exitCode = 1;

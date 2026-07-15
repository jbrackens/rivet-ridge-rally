import { mkdir } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";
import process from "node:process";
import { chromium } from "playwright";

import {
  DEFAULT_BASE_URL,
  REPO_ROOT,
  browserDeviceEvidence,
  builtAssetEvidence,
  collectNetworkFailures,
  collectPageMessages,
  createPerformanceSession,
  finishQaRace,
  hasFlag,
  heapEvidence,
  hostEvidence,
  measureEditor,
  measureRestart,
  navigationEvidence,
  nodePerformance,
  openShell,
  readOption,
  readPositiveNumber,
  renderingEvidence,
  resourceEvidence,
  returnToTitleFromRace,
  setExplicitQuality,
  sourceIdentityEvidence,
  startQaRace,
  verifyServedBuild,
  writeJson,
} from "./common.mjs";

const KNOWN_DIAGNOSTIC_WARNING = /GPU stall due to ReadPixels/;
const COMPRESSED_BUNDLE_BUDGET_BYTES = 12_000_000;
const DESKTOP_FPS_FLOOR = 58;
const DESKTOP_FRAME_WORK_P95_BUDGET_MS = 16.67;
const MOBILE_FPS_FLOOR = 30;
const MOBILE_FRAME_WORK_P95_BUDGET_MS = 33.33;
const argumentsList = process.argv.slice(2);

if (hasFlag(argumentsList, "help")) {
  console.log(`Usage: npm run perf:measure -- [options]\n\nOptions:\n  --base-url URL          QA preview URL (default ${DEFAULT_BASE_URL})\n  --output PATH           JSON output relative to the repository\n  --sample-seconds N      Rendering sample duration per viewport (default 5)\n  --quality LEVEL         Force low, medium, or high for both profiles\n  --screenshots-dir PATH  Optional screenshot directory\n  --headed                Run visible Chromium; required for release PASS\n  --help                   Show this help`);
  process.exit(0);
}

const baseURL = readOption(argumentsList, "base-url", process.env.PERF_BASE_URL ?? DEFAULT_BASE_URL);
const output = readOption(argumentsList, "output", "artifacts/performance/latest-measurement.json");
const sampleSeconds = readPositiveNumber(argumentsList, "sample-seconds", 5);
const qualityOverride = readOption(argumentsList, "quality", "");
const screenshotsOption = readOption(argumentsList, "screenshots-dir", "");
const screenshotsDirectory = screenshotsOption ? resolve(REPO_ROOT, screenshotsOption) : null;
const headed = hasFlag(argumentsList, "headed");
if (qualityOverride && !["low", "medium", "high"].includes(qualityOverride)) {
  throw new Error("--quality must be low, medium, or high; auto is not admissible evidence.");
}

const measurementStartedAt = nodePerformance.now();
if (screenshotsDirectory) await mkdir(screenshotsDirectory, { recursive: true });

const profiles = [
  {
    name: "desktop-1920x1080",
    scope: "representative-local-desktop",
    quality: qualityOverride || "high",
    context: { viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 },
  },
  {
    name: "mobile-390x844",
    scope: "emulated-mobile-local-technical-floor-not-physical-device-proof",
    quality: qualityOverride || "low",
    context: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true },
  },
];

const evidence = {
  schemaVersion: 2,
  kind: "performance-measurement",
  createdAt: new Date().toISOString(),
  baseURL,
  browser: { name: "chromium", version: null, headless: !headed },
  host: hostEvidence(),
  configuration: {
    sampleSeconds,
    qaModeRequired: true,
    qualityPolicy: qualityOverride
      ? { type: "explicit-override", value: qualityOverride }
      : { type: "explicit-per-profile", desktop: "high", mobile: "low" },
    releaseRequiresHeaded: true,
    budgets: {
      compressedBundleBytesExclusive: COMPRESSED_BUNDLE_BUDGET_BYTES,
      desktop: {
        targetFps: 60,
        acceptanceFloorMeanFps: DESKTOP_FPS_FLOOR,
        frameWorkP95MsInclusive: DESKTOP_FRAME_WORK_P95_BUDGET_MS,
      },
      emulatedMobile: {
        targetFps: 30,
        acceptanceFloorMeanFps: MOBILE_FPS_FLOOR,
        frameWorkP95MsInclusive: MOBILE_FRAME_WORK_P95_BUDGET_MS,
        physicalDeviceProof: false,
      },
    },
  },
  candidate: {
    source: null,
    localBuild: null,
    servedBefore: null,
    servedAfter: null,
  },
  harnessErrors: [],
  profiles: [],
  consoleSummary: null,
  automatedGate: null,
  status: "FAIL",
};

function recordHarnessError(stage, error, profile = null) {
  evidence.harnessErrors.push({
    stage,
    profile,
    name: error instanceof Error ? error.name : "Error",
    message: (error instanceof Error ? error.message : String(error)).replaceAll(process.cwd(), "<repository>"),
  });
}

try {
  evidence.candidate.source = await sourceIdentityEvidence();
} catch (error) {
  recordHarnessError("source-identity", error);
}
try {
  evidence.candidate.localBuild = await builtAssetEvidence();
} catch (error) {
  recordHarnessError("local-build-inventory", error);
}
if (evidence.candidate.localBuild) {
  try {
    evidence.candidate.servedBefore = await verifyServedBuild(evidence.candidate.localBuild, baseURL);
  } catch (error) {
    recordHarnessError("served-candidate-before", error);
  }
}

let browser = null;
if (evidence.harnessErrors.length === 0) {
  try {
    browser = await chromium.launch({
      headless: !headed,
      args: ["--enable-precise-memory-info"],
    });
    evidence.browser.version = browser.version();

    for (const profile of profiles) {
      let context = null;
      let session = null;
      const profileEvidence = {
        name: profile.name,
        scope: profile.scope,
        viewport: profile.context.viewport,
        deviceScaleFactor: profile.context.deviceScaleFactor,
        quality: { requested: profile.quality, selected: null, effective: null },
        device: null,
        runtime: null,
        navigation: null,
        firstRaceLoadMs: null,
        restartMs: null,
        editor: null,
        rendering: null,
        stress: null,
        heaps: [],
        network: { shell: null, completeFlow: null, failedRequests: [], httpErrorResponses: [] },
        consoleMessages: [],
        screenshot: null,
        error: null,
        completed: false,
      };
      evidence.profiles.push(profileEvidence);

      try {
        context = await browser.newContext(profile.context);
        const page = await context.newPage();
        profileEvidence.consoleMessages = collectPageMessages(page);
        const networkFailures = collectNetworkFailures(page, measurementStartedAt);
        profileEvidence.network.failedRequests = networkFailures.failedRequests;
        profileEvidence.network.httpErrorResponses = networkFailures.httpErrorResponses;
        session = await createPerformanceSession(context, page);

        profileEvidence.navigation = {
          ...await openShell(page, baseURL),
          timing: await navigationEvidence(page),
        };
        profileEvidence.quality = await setExplicitQuality(page, profile.quality);
        profileEvidence.device = await browserDeviceEvidence(page);
        profileEvidence.runtime = await page.evaluate((expectedVersion) => ({
          title: document.title,
          qaApiPresent: Object.prototype.hasOwnProperty.call(window, "__RRR_QA__"),
          versionPresent: (document.body.textContent ?? "").includes(`v${expectedVersion}`),
          build: window.__RRR_BUILD__ ?? null,
        }), evidence.candidate.source.packageVersion);
        profileEvidence.network.shell = await resourceEvidence(page);
        profileEvidence.heaps.push({ stage: "shell", ...await heapEvidence(session) });

        profileEvidence.firstRaceLoadMs = await startQaRace(page);
        profileEvidence.heaps.push({ stage: "first-race-ready", ...await heapEvidence(session) });
        await page.keyboard.down("w");
        await page.keyboard.down("Space");
        try {
          profileEvidence.rendering = await renderingEvidence(page, sampleSeconds);
          profileEvidence.heaps.push({ stage: "after-render-sample", ...await heapEvidence(session) });
          await finishQaRace(page);
        } finally {
          await page.keyboard.up("w").catch(() => undefined);
          await page.keyboard.up("Space").catch(() => undefined);
        }

        profileEvidence.restartMs = await measureRestart(page);
        profileEvidence.heaps.push({ stage: "after-restart", ...await heapEvidence(session) });
        await returnToTitleFromRace(page);
        await startQaRace(page, "rival");
        await page.keyboard.press("ArrowRight");
        await page.keyboard.down("w");
        await page.keyboard.down("Shift");
        await page.keyboard.down("Space");
        try {
          profileEvidence.stress = await renderingEvidence(page, sampleSeconds);
          profileEvidence.heaps.push({ stage: "rival-ai-jump-crash-stress", ...await heapEvidence(session) });
        } finally {
          await page.keyboard.up("w").catch(() => undefined);
          await page.keyboard.up("Shift").catch(() => undefined);
          await page.keyboard.up("Space").catch(() => undefined);
        }
        await returnToTitleFromRace(page);
        profileEvidence.editor = await measureEditor(page);
        profileEvidence.heaps.push({ stage: "editor-test-play", ...await heapEvidence(session) });
        profileEvidence.network.completeFlow = await resourceEvidence(page);

        if (screenshotsDirectory) {
          const screenshotPath = resolve(screenshotsDirectory, `${profile.name}.png`);
          await page.screenshot({ path: screenshotPath });
          profileEvidence.screenshot = relative(REPO_ROOT, screenshotPath).split(sep).join("/");
        }
        profileEvidence.completed = true;
      } catch (error) {
        profileEvidence.error = {
          name: error instanceof Error ? error.name : "Error",
          message: error instanceof Error ? error.message : String(error),
        };
        recordHarnessError("profile-flow", error, profile.name);
      } finally {
        if (session) {
          await session.detach().catch((error) => recordHarnessError("session-detach", error, profile.name));
        }
        if (context) {
          await context.close().catch((error) => recordHarnessError("context-close", error, profile.name));
        }
      }
    }
  } catch (error) {
    recordHarnessError("browser-orchestration", error);
  } finally {
    if (browser) await browser.close().catch((error) => recordHarnessError("browser-close", error));
  }
}

if (evidence.candidate.localBuild && evidence.candidate.servedBefore) {
  try {
    evidence.candidate.servedAfter = await verifyServedBuild(evidence.candidate.localBuild, baseURL);
  } catch (error) {
    recordHarnessError("served-candidate-after", error);
  }
}

const allMessages = evidence.profiles.flatMap((profile) => profile.consoleMessages);
const knownDiagnosticWarnings = allMessages.filter((message) =>
  message.type === "warning" && KNOWN_DIAGNOSTIC_WARNING.test(message.text));
const unexpectedMessages = allMessages.filter((message) => !knownDiagnosticWarnings.includes(message));
const failedRequests = evidence.profiles.flatMap((profile) => profile.network.failedRequests);
const httpErrorResponses = evidence.profiles.flatMap((profile) => profile.network.httpErrorResponses);
const desktopProfile = evidence.profiles.find((profile) => profile.name === "desktop-1920x1080");
const mobileProfile = evidence.profiles.find((profile) => profile.name === "mobile-390x844");
evidence.consoleSummary = {
  total: allMessages.length,
  knownDiagnosticWarnings: knownDiagnosticWarnings.length,
  unexpected: unexpectedMessages.length,
  unexpectedMessages,
};

const criteria = [
  { id: "headed-release-measurement", passed: headed, required: true, actual: headed },
  { id: "no-harness-error", passed: evidence.harnessErrors.length === 0, actual: evidence.harnessErrors.length },
  { id: "source-identity-recorded", passed: Boolean(evidence.candidate.source?.commit), actual: evidence.candidate.source?.commit ?? null },
  { id: "source-worktree-clean", passed: evidence.candidate.source?.dirty === false, actual: evidence.candidate.source?.dirty ?? null },
  { id: "served-candidate-verified-before", passed: evidence.candidate.servedBefore?.verified === true, actual: evidence.candidate.servedBefore?.verified ?? false },
  { id: "served-candidate-verified-after", passed: evidence.candidate.servedAfter?.verified === true, actual: evidence.candidate.servedAfter?.verified ?? false },
  {
    id: "served-candidate-stable",
    passed: Boolean(evidence.candidate.servedBefore?.aggregateSha256)
      && evidence.candidate.servedBefore.aggregateSha256 === evidence.candidate.servedAfter?.aggregateSha256,
    actual: {
      before: evidence.candidate.servedBefore?.aggregateSha256 ?? null,
      after: evidence.candidate.servedAfter?.aggregateSha256 ?? null,
    },
  },
  { id: "all-profiles-completed", passed: evidence.profiles.length === profiles.length && evidence.profiles.every((profile) => profile.completed), actual: evidence.profiles.filter((profile) => profile.completed).length },
  { id: "explicit-quality-applied", passed: evidence.profiles.length === profiles.length && evidence.profiles.every((profile) => profile.quality.effective === profile.quality.requested && profile.quality.effective !== "auto"), actual: evidence.profiles.map((profile) => ({ name: profile.name, ...profile.quality })) },
  { id: "qa-runtime-identity", passed: evidence.profiles.length === profiles.length && evidence.profiles.every((profile) => profile.runtime?.title === "Rivet Ridge Rally" && profile.runtime?.qaApiPresent === true && profile.runtime?.versionPresent === true), actual: evidence.profiles.map((profile) => ({ name: profile.name, runtime: profile.runtime })) },
  { id: "runtime-source-commit-binding", passed: Boolean(evidence.candidate.source?.commit) && evidence.profiles.length === profiles.length && evidence.profiles.every((profile) => profile.runtime?.build?.commit === evidence.candidate.source.commit && profile.runtime?.build?.dirty === false), actual: { sourceCommit: evidence.candidate.source?.commit ?? null, profiles: evidence.profiles.map((profile) => ({ name: profile.name, build: profile.runtime?.build ?? null })) } },
  { id: "no-failed-requests", passed: failedRequests.length === 0, actual: failedRequests.length },
  { id: "no-http-error-responses", passed: httpErrorResponses.length === 0, actual: httpErrorResponses.length },
  { id: "no-unexpected-console-or-page-messages", passed: unexpectedMessages.length === 0, actual: unexpectedMessages.length },
  { id: "rendering-samples-complete", passed: evidence.profiles.length === profiles.length && evidence.profiles.every((profile) => (profile.rendering?.sampleCount ?? 0) > 0 && (profile.stress?.sampleCount ?? 0) > 0), actual: evidence.profiles.map((profile) => ({ name: profile.name, normal: profile.rendering?.sampleCount ?? 0, stress: profile.stress?.sampleCount ?? 0 })) },
  { id: "heap-samples-complete", passed: evidence.profiles.length === profiles.length && evidence.profiles.every((profile) => profile.heaps.length > 0 && profile.heaps.every((heap) => heap.available)), actual: evidence.profiles.map((profile) => ({ name: profile.name, expected: profile.heaps.length, available: profile.heaps.filter((heap) => heap.available).length })) },
  { id: "editor-test-ride-visible", passed: evidence.profiles.length === profiles.length && evidence.profiles.every((profile) => profile.editor?.testRideControlVisible === true), actual: evidence.profiles.map((profile) => ({ name: profile.name, visible: profile.editor?.testRideControlVisible ?? false })) },
  {
    id: "compressed-bundle-under-12mb",
    passed: Number.isFinite(evidence.candidate.localBuild?.totalGzipBytes)
      && evidence.candidate.localBuild.totalGzipBytes < COMPRESSED_BUNDLE_BUDGET_BYTES,
    requiredExclusiveBytes: COMPRESSED_BUNDLE_BUDGET_BYTES,
    actualBytes: evidence.candidate.localBuild?.totalGzipBytes ?? null,
  },
  {
    id: "desktop-normal-performance-budget",
    passed: (desktopProfile?.rendering?.fps.mean ?? -Infinity) >= DESKTOP_FPS_FLOOR
      && (desktopProfile?.rendering?.frameTimeMs.p95 ?? Infinity) <= DESKTOP_FRAME_WORK_P95_BUDGET_MS,
    required: { meanFpsAtLeast: DESKTOP_FPS_FLOOR, frameWorkP95MsAtMost: DESKTOP_FRAME_WORK_P95_BUDGET_MS },
    actual: { meanFps: desktopProfile?.rendering?.fps.mean ?? null, frameWorkP95Ms: desktopProfile?.rendering?.frameTimeMs.p95 ?? null },
  },
  {
    id: "desktop-stress-performance-budget",
    passed: (desktopProfile?.stress?.fps.mean ?? -Infinity) >= DESKTOP_FPS_FLOOR
      && (desktopProfile?.stress?.frameTimeMs.p95 ?? Infinity) <= DESKTOP_FRAME_WORK_P95_BUDGET_MS,
    required: { meanFpsAtLeast: DESKTOP_FPS_FLOOR, frameWorkP95MsAtMost: DESKTOP_FRAME_WORK_P95_BUDGET_MS },
    actual: { meanFps: desktopProfile?.stress?.fps.mean ?? null, frameWorkP95Ms: desktopProfile?.stress?.frameTimeMs.p95 ?? null },
  },
  {
    id: "emulated-mobile-normal-technical-floor",
    passed: (mobileProfile?.rendering?.fps.mean ?? -Infinity) >= MOBILE_FPS_FLOOR
      && (mobileProfile?.rendering?.frameTimeMs.p95 ?? Infinity) <= MOBILE_FRAME_WORK_P95_BUDGET_MS,
    required: { meanFpsAtLeast: MOBILE_FPS_FLOOR, frameWorkP95MsAtMost: MOBILE_FRAME_WORK_P95_BUDGET_MS },
    actual: { meanFps: mobileProfile?.rendering?.fps.mean ?? null, frameWorkP95Ms: mobileProfile?.rendering?.frameTimeMs.p95 ?? null, physicalDeviceProof: false },
  },
  {
    id: "emulated-mobile-stress-technical-floor",
    passed: (mobileProfile?.stress?.fps.mean ?? -Infinity) >= MOBILE_FPS_FLOOR
      && (mobileProfile?.stress?.frameTimeMs.p95 ?? Infinity) <= MOBILE_FRAME_WORK_P95_BUDGET_MS,
    required: { meanFpsAtLeast: MOBILE_FPS_FLOOR, frameWorkP95MsAtMost: MOBILE_FRAME_WORK_P95_BUDGET_MS },
    actual: { meanFps: mobileProfile?.stress?.fps.mean ?? null, frameWorkP95Ms: mobileProfile?.stress?.frameTimeMs.p95 ?? null, physicalDeviceProof: false },
  },
];
const failedCriteria = criteria.filter((criterion) => !criterion.passed);
evidence.durationMs = Math.round(nodePerformance.now() - measurementStartedAt);
evidence.automatedGate = {
  status: failedCriteria.length === 0 ? "PASS" : "FAIL",
  criteria,
  failedCriteria: failedCriteria.map((criterion) => criterion.id),
  manualBudgetReviewRequired: true,
  mobileEvidenceScope: "emulated/local technical floor; physical-device acceptance remains required",
};
evidence.status = evidence.automatedGate.status;

const outputPath = await writeJson(output, evidence);
console.log(JSON.stringify({
  outputPath,
  status: evidence.status,
  failedCriteria: evidence.automatedGate.failedCriteria,
  profiles: evidence.profiles.map((profile) => ({
    name: profile.name,
    quality: profile.quality,
    firstRaceLoadMs: profile.firstRaceLoadMs,
    fpsMean: profile.rendering?.fps.mean,
    frameTimeP95Ms: profile.rendering?.frameTimeMs.p95,
    drawCallsMax: profile.rendering?.drawCalls.max,
    restartMs: profile.restartMs,
    editorOpenMs: profile.editor?.openMs,
    editorTestPlayMs: profile.editor?.testPlayMs,
  })),
}, null, 2));
if (evidence.status !== "PASS") process.exitCode = 1;

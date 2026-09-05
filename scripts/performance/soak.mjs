import process from "node:process";
import { chromium } from "playwright";

import { validateSoakEvidence } from "../release-attestation.mjs";
import { loadFormat2ReleaseManifest } from "../production-smoke-support.mjs";
import {
  DEFAULT_BASE_URL,
  assertPerformanceEvidenceOutputPath,
  browserDeviceEvidence,
  builtAssetEvidence,
  collectPageMessages,
  createPerformanceSession,
  hasFlag,
  heapEvidence,
  hostEvidence,
  measureInputResponsiveness,
  measureRestart,
  nodePerformance,
  openShell,
  parseHud,
  readOption,
  readPositiveNumber,
  returnToTitleFromRace,
  round,
  setExplicitQuality,
  sourceIdentityEvidence,
  startProductRace,
  summarize,
  verifyServedBuild,
  writeJson,
} from "./common.mjs";

const RELEASE_MINIMUM_DURATION_MS = 30 * 60_000;
// Production Rival races are intentionally unmodified. This retains a bounded
// stuck-race detector while allowing a complete real-time race on slower hosts.
const ATTEMPT_TIMEOUT_MS = 12 * 60_000;
const KNOWN_DIAGNOSTIC_WARNING = /GPU stall due to ReadPixels/;
const SOFTWARE_WEBGL_RENDERER = /(?:SwiftShader|llvmpipe|software rasterizer)/iu;

function trend(points) {
  const finitePoints = points.filter((point) => Number.isFinite(point.elapsedMs) && Number.isFinite(point.value));
  if (finitePoints.length === 0) {
    return {
      samples: 0,
      windowSamples: 0,
      firstWindowMean: null,
      lastWindowMean: null,
      changeBetweenWindows: null,
      linearRatePerMinute: null,
    };
  }

  const windowSamples = Math.max(1, Math.ceil(finitePoints.length * 0.2));
  const mean = (values) => values.reduce((sum, value) => sum + value, 0) / values.length;
  const firstWindowMean = mean(finitePoints.slice(0, windowSamples).map((point) => point.value));
  const lastWindowMean = mean(finitePoints.slice(-windowSamples).map((point) => point.value));
  const firstElapsedMs = finitePoints[0].elapsedMs;
  const elapsedMean = mean(finitePoints.map((point) => point.elapsedMs - firstElapsedMs));
  const valueMean = mean(finitePoints.map((point) => point.value));
  const covariance = finitePoints.reduce((sum, point) =>
    sum + ((point.elapsedMs - firstElapsedMs) - elapsedMean) * (point.value - valueMean), 0);
  const elapsedVariance = finitePoints.reduce((sum, point) =>
    sum + ((point.elapsedMs - firstElapsedMs) - elapsedMean) ** 2, 0);

  return {
    samples: finitePoints.length,
    windowSamples,
    firstWindowMean: round(firstWindowMean),
    lastWindowMean: round(lastWindowMean),
    changeBetweenWindows: round(lastWindowMean - firstWindowMean),
    linearRatePerMinute: elapsedVariance === 0 ? null : round((covariance / elapsedVariance) * 60_000),
  };
}

const argumentsList = process.argv.slice(2);

if (hasFlag(argumentsList, "help")) {
  console.log(`Usage: npm run perf:soak -- [options]\n\nOptions:\n  --base-url URL           Product preview URL (default ${DEFAULT_BASE_URL})\n  --manifest PATH          Format-2 release manifest (default artifacts/release-manifest.json)\n  --output PATH            JSON output under artifacts/candidate-evidence/\n  --minutes N              Soak duration, fractional values allowed (default 30)\n  --sample-interval N      Seconds between samples (default 5)\n  --profile desktop|mobile Viewport profile (default desktop)\n  --mode rival|practice    Race workload; Rival requires --headed (default rival)\n  --quality LEVEL          Force low, medium, or high (default high desktop, low mobile)\n  --headed                 Run visible hardware-backed Chromium (required for Rival)\n  --help                    Show this help`);
  process.exit(0);
}

const baseURL = readOption(argumentsList, "base-url", process.env.PERF_BASE_URL ?? DEFAULT_BASE_URL);
const manifestReference = readOption(argumentsList, "manifest", "artifacts/release-manifest.json");
const output = readOption(
  argumentsList,
  "output",
  "artifacts/candidate-evidence/diagnostic/performance/latest-soak.json",
);
assertPerformanceEvidenceOutputPath(output);
const minutes = readPositiveNumber(argumentsList, "minutes", 30);
const sampleIntervalSeconds = readPositiveNumber(argumentsList, "sample-interval", 5);
const profileName = readOption(argumentsList, "profile", "desktop");
const mode = readOption(argumentsList, "mode", "rival");
const headed = hasFlag(argumentsList, "headed");
if (!["desktop", "mobile"].includes(profileName)) throw new Error("--profile must be desktop or mobile.");
if (!["rival", "practice"].includes(mode)) throw new Error("--mode must be rival or practice.");
if (mode === "rival" && !headed) {
  throw new Error("Rival release soak requires --headed hardware-backed Chromium.");
}
const quality = readOption(argumentsList, "quality", profileName === "mobile" ? "low" : "high");
if (!["low", "medium", "high"].includes(quality)) {
  throw new Error("--quality must be low, medium, or high; auto is not admissible evidence.");
}

let releaseManifest = null;
let releaseManifestError = null;
try {
  ({ manifest: releaseManifest } = await loadFormat2ReleaseManifest(manifestReference));
} catch (error) {
  releaseManifestError = error;
}

const contextOptions = profileName === "mobile"
  ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true }
  : { viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 };
const configuredDurationMs = minutes * 60_000;
const runStartedAt = new Date().toISOString();
const startedAt = nodePerformance.now();
let browser = null;
let browserVersion = null;
let context = null;
let page = null;
let session = null;
let consoleMessages = [];
const failedRequests = [];
const httpErrorResponses = [];
const harnessErrors = [];
const samples = [];
const restartTimesMs = [];
const droppedSimulationAttempts = [];
const completedRaceEvidence = [];
let completedRaces = 0;
let timedOutRaces = 0;
let workloadStartedAt = null;
let workloadEndedAt = null;
let activeRacingDurationMs = 0;
let racingClockActive = false;
let racingClockVisibilityLost = false;
let racingClockEvidence = null;
let harnessStage = "server-check";
let activeAttempt = 0;
let activeAttemptStartedAt = null;
let activeAttemptMaxDroppedSimulationMs = null;
let activeAttemptSampleCount = 0;
let cumulativeDroppedSimulationMs = 0;
let device = null;
let qualityEvidence = { requested: quality, selected: null, effective: null };
let runtime = null;
let setup = null;
const candidate = {
  source: null,
  localBuild: null,
  servedBefore: null,
  servedAfter: null,
};

function recordHarnessError(stage, error) {
  const message = error instanceof Error ? error.message : String(error);
  harnessErrors.push({
    stage,
    elapsedMs: Math.round(nodePerformance.now() - startedAt),
    name: error instanceof Error ? error.name : "Error",
    message: message.replaceAll(process.cwd(), "<repository>"),
  });
}

function beginAttempt() {
  activeAttempt += 1;
  activeAttemptStartedAt = nodePerformance.now();
  activeAttemptMaxDroppedSimulationMs = null;
  activeAttemptSampleCount = 0;
}

function observeDroppedSimulation(hud) {
  const value = hud?.droppedSimulationMs;
  if (Number.isFinite(value)) {
    activeAttemptMaxDroppedSimulationMs = Math.max(activeAttemptMaxDroppedSimulationMs ?? 0, value);
    activeAttemptSampleCount += 1;
  }
  return cumulativeDroppedSimulationMs + (activeAttemptMaxDroppedSimulationMs ?? 0);
}

async function finalizeAttempt(outcome) {
  if (activeAttemptStartedAt === null || page === null) return;
  const hud = parseHud(await page.getByLabel("Performance metrics").textContent({ timeout: 250 }).catch(() => null));
  observeDroppedSimulation(hud);
  const maxObservedDroppedSimulationMs = activeAttemptMaxDroppedSimulationMs;
  cumulativeDroppedSimulationMs += maxObservedDroppedSimulationMs ?? 0;
  droppedSimulationAttempts.push({
    attempt: activeAttempt,
    outcome,
    elapsedMs: Math.round(nodePerformance.now() - startedAt),
    durationMs: Math.round(nodePerformance.now() - activeAttemptStartedAt),
    samples: activeAttemptSampleCount,
    maxObservedDroppedSimulationMs,
    cumulativeDroppedSimulationMs,
  });
  activeAttemptStartedAt = null;
  activeAttemptMaxDroppedSimulationMs = null;
  activeAttemptSampleCount = 0;
}

async function captureCompletedRace(page, attempt, selectedMode) {
  const results = page.locator(".results-screen");
  await results.waitFor({ state: "visible", timeout: 5_000 });
  const retry = page.getByRole("button", { name: "Retry now" });
  await retry.waitFor({ state: "visible", timeout: 5_000 });
  const breakdown = page.getByLabel("Race breakdown");
  await breakdown.waitFor({ state: "visible", timeout: 5_000 });
  const breakdownRecords = await breakdown.locator(":scope > div").evaluateAll((rows) => rows.map((row) => ({
    label: row.querySelector(":scope > span")?.textContent?.trim() ?? "",
    value: row.querySelector(":scope > strong")?.textContent?.trim() ?? "",
  })));
  const breakdownLabels = breakdownRecords.map((record) => record.label);
  const lapTimes = breakdownRecords
    .filter((record) => /^Lap \d+$/u.test(record.label))
    .map((record) => record.value);
  const crashes = Number(breakdownRecords.find((record) => record.label === "Crashes")?.value);
  const overheats = Number(breakdownRecords.find((record) => record.label === "Overheats")?.value);
  const finalTime = (await page.locator(".final-time").innerText()).trim();
  const positionLabel = selectedMode === "rival"
    ? (await results.locator("header > p").innerText()).trim()
    : null;
  const classification = selectedMode === "rival"
    ? page.getByRole("table", { name: "Official 6-rider classification" })
    : null;
  if (classification) await classification.waitFor({ state: "visible", timeout: 5_000 });
  return {
    attempt,
    mode: selectedMode,
    resultVisible: true,
    retryVisible: await retry.isVisible(),
    fatalScreenVisible: await page.locator(".fatal-screen").isVisible().catch(() => false),
    finalTime,
    breakdownLabels,
    lapTimes,
    crashes,
    overheats,
    positionLabel,
    classificationLabel: classification ? await classification.getAttribute("aria-label") : null,
    classificationRows: classification ? await classification.locator("tbody > tr").count() : 0,
  };
}

try {
  harnessStage = "source-identity";
  candidate.source = await sourceIdentityEvidence();
  harnessStage = "local-build-inventory";
  candidate.localBuild = await builtAssetEvidence();
  harnessStage = "served-candidate-before";
  candidate.servedBefore = await verifyServedBuild(candidate.localBuild, baseURL);
  harnessStage = "browser-launch";
  browser = await chromium.launch({
    headless: !headed,
    args: ["--enable-precise-memory-info", "--mute-audio"],
  });
  browserVersion = browser.version();
  harnessStage = "context-create";
  context = await browser.newContext(contextOptions);
  harnessStage = "page-create";
  page = await context.newPage();
  consoleMessages = collectPageMessages(page);
  harnessStage = "performance-session-create";
  session = await createPerformanceSession(context, page);
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

  harnessStage = "shell-open";
  setup = (await openShell(page, baseURL)).progressSetup;
  harnessStage = "quality-selection";
  qualityEvidence = await setExplicitQuality(page, quality);
  harnessStage = "device-evidence";
  device = await browserDeviceEvidence(page);
  if (mode === "rival" && SOFTWARE_WEBGL_RENDERER.test(`${device.webgl?.vendor ?? ""} ${device.webgl?.renderer ?? ""}`)) {
    throw new Error(`Rival release soak requires hardware-backed WebGL; received ${device.webgl?.renderer ?? "unknown renderer"}.`);
  }
  runtime = await page.evaluate((expectedVersion) => {
    const versionPresent = (document.body.textContent ?? "").includes(`v${expectedVersion}`);
    return {
      title: document.title,
      qaApiPresent: Object.prototype.hasOwnProperty.call(window, "__RRR_QA__"),
      productPerformanceApiPresent: Object.prototype.hasOwnProperty.call(window, "__RRR_PERFORMANCE__"),
      performanceCaptureHarnessPresent: Object.prototype.hasOwnProperty.call(window, "__RRR_PERF_CAPTURE__"),
      version: versionPresent ? expectedVersion : null,
      versionPresent,
      build: window.__RRR_BUILD__ ?? null,
    };
  }, candidate.source.packageVersion);
  harnessStage = "initial-race-start";
  await startProductRace(page, mode);
  workloadStartedAt = nodePerformance.now();
  await page.evaluate(() => window.__RRR_PERF_CAPTURE__.beginRacingClock());
  racingClockActive = true;
  beginAttempt();
  harnessStage = "race-workload";

  while (activeRacingDurationMs < configuredDurationMs) {
    await page.getByLabel("Live 3D race on Canyon Kickoff").focus();
    await page.keyboard.press("ArrowRight", { delay: 100 });
    await page.keyboard.press("ArrowRight", { delay: 100 });
    await page.keyboard.down("w");
    await page.keyboard.down("Space");
    const raceDeadline = nodePerformance.now() + ATTEMPT_TIMEOUT_MS;
    let nextSampleAt = nodePerformance.now();
    let nextTurboAt = nodePerformance.now();
    let turboReleaseAt = null;
    let completed = false;
    let qualificationComplete = false;

    try {
      while (nodePerformance.now() < raceDeadline) {
        const now = nodePerformance.now();
        if (turboReleaseAt !== null && now >= turboReleaseAt) {
          await page.keyboard.up("Shift");
          turboReleaseAt = null;
          nextTurboAt = now + 620;
        } else if (turboReleaseAt === null && now >= nextTurboAt) {
          await page.keyboard.down("Shift");
          turboReleaseAt = now + 520;
        }
        const racingClock = await page.evaluate(() => window.__RRR_PERF_CAPTURE__.readRacingClock());
        activeRacingDurationMs = racingClock.durationMs;
        racingClockVisibilityLost ||= racingClock.visibilityLost;
        if (activeRacingDurationMs >= configuredDurationMs) {
          qualificationComplete = true;
          break;
        }
        if (await page.getByRole("button", { name: "Retry now" }).isVisible().catch(() => false)) {
          completed = true;
          break;
        }
        if (nodePerformance.now() >= nextSampleAt) {
          if (turboReleaseAt !== null) {
            await page.keyboard.up("Shift");
            turboReleaseAt = null;
            nextTurboAt = nodePerformance.now() + 620;
          }
          const hud = parseHud(await page.getByLabel("Performance metrics").textContent().catch(() => null));
          const heap = await heapEvidence(session);
          const input = await measureInputResponsiveness(page, "ArrowLeft").catch((error) => ({ error: error instanceof Error ? error.message : String(error) }));
          await page.keyboard.press("ArrowRight", { delay: 100 });
          const cumulativeDroppedMs = observeDroppedSimulation(hud);
          samples.push({
            elapsedMs: Math.round(nodePerformance.now() - startedAt),
            race: completedRaces + 1,
            attempt: activeAttempt,
            hud,
            cumulativeDroppedSimulationMs: cumulativeDroppedMs,
            heap,
            input,
          });
          nextSampleAt += sampleIntervalSeconds * 1_000;
        }
        await page.waitForTimeout(250);
      }
    } finally {
      await page.keyboard.up("w").catch(() => undefined);
      await page.keyboard.up("Space").catch(() => undefined);
      await page.keyboard.up("Shift").catch(() => undefined);
    }

    if (qualificationComplete) break;
    if (!completed) {
      timedOutRaces += 1;
      await finalizeAttempt("timed-out");
      harnessStage = "timeout-recovery";
      await returnToTitleFromRace(page);
      await startProductRace(page, mode);
      beginAttempt();
      harnessStage = "race-workload";
      continue;
    }

    completedRaceEvidence.push(await captureCompletedRace(page, activeAttempt, mode));
    completedRaces += 1;
    await finalizeAttempt("completed");
    harnessStage = "race-restart";
    restartTimesMs.push(await measureRestart(page));
    beginAttempt();
    harnessStage = "race-workload";
  }
  await finalizeAttempt("deadline");
  const finalRacingClock = await page.evaluate(() => window.__RRR_PERF_CAPTURE__.endRacingClock());
  racingClockEvidence = finalRacingClock;
  activeRacingDurationMs = finalRacingClock.durationMs;
  racingClockVisibilityLost ||= finalRacingClock.visibilityLost;
  racingClockActive = false;
  workloadEndedAt = nodePerformance.now();
} catch (error) {
  recordHarnessError(harnessStage, error);
  try {
    await finalizeAttempt("harness-error");
  } catch (finalizationError) {
    recordHarnessError("attempt-finalization", finalizationError);
  }
} finally {
  if (workloadStartedAt !== null && workloadEndedAt === null) workloadEndedAt = nodePerformance.now();
  if (racingClockActive && page !== null) {
    try {
      const finalRacingClock = await page.evaluate(() => window.__RRR_PERF_CAPTURE__.endRacingClock());
      racingClockEvidence = finalRacingClock;
      activeRacingDurationMs = finalRacingClock.durationMs;
      racingClockVisibilityLost ||= finalRacingClock.visibilityLost;
      racingClockActive = false;
    } catch (error) {
      recordHarnessError("racing-clock-finalization", error);
    }
  }
  if (candidate.localBuild !== null && candidate.servedBefore !== null) {
    try {
      candidate.servedAfter = await verifyServedBuild(candidate.localBuild, baseURL);
    } catch (error) {
      recordHarnessError("served-candidate-after", error);
    }
  }
  if (session !== null) {
    try {
      await session.detach();
    } catch (error) {
      recordHarnessError("session-detach", error);
    }
  }
  if (context !== null) {
    try {
      await context.close();
    } catch (error) {
      recordHarnessError("context-close", error);
    }
  }
  if (browser !== null) {
    try {
      await browser.close();
    } catch (error) {
      recordHarnessError("browser-close", error);
    }
  }
}

const heapSamples = samples.map((sample) => sample.heap.usedBytes).filter((value) => Number.isFinite(value));
const inputSamples = samples
  .map((sample) => sample.input.keydownToFrameMs)
  .filter((value) => Number.isFinite(value));
const dispatchSamples = samples
  .map((sample) => sample.input.dispatchDelayMs)
  .filter((value) => Number.isFinite(value));
const droppedSimulationSamples = samples
  .map((sample) => sample.hud?.droppedSimulationMs)
  .filter((value) => Number.isFinite(value));
const cumulativeDroppedSimulationSamples = samples
  .map((sample) => sample.cumulativeDroppedSimulationMs)
  .filter((value) => Number.isFinite(value));
const cumulativeDroppedSimulationIsMonotonic = cumulativeDroppedSimulationSamples
  .every((value, index) => index === 0 || value >= cumulativeDroppedSimulationSamples[index - 1]);
const actualDurationMs = Math.round(nodePerformance.now() - startedAt);
const wallWorkloadDurationMs = workloadStartedAt === null
  ? 0
  : Math.round((workloadEndedAt ?? nodePerformance.now()) - workloadStartedAt);
const workloadDurationMs = Math.round(activeRacingDurationMs);
const knownDiagnosticWarnings = consoleMessages.filter((message) =>
  message.type === "warning" && KNOWN_DIAGNOSTIC_WARNING.test(message.text));
const unexpectedConsoleMessages = consoleMessages.filter((message) =>
  !knownDiagnosticWarnings.includes(message));
const diagnosticCriteria = [
  { id: "no-harness-error", passed: harnessErrors.length === 0, actual: harnessErrors.length },
  { id: "source-identity-recorded", passed: Boolean(candidate.source?.commit), actual: candidate.source?.commit ?? null },
  { id: "source-worktree-clean", passed: candidate.source?.dirty === false, actual: candidate.source?.dirty ?? null },
  { id: "served-candidate-verified-before", passed: candidate.servedBefore?.verified === true, actual: candidate.servedBefore?.verified ?? false },
  { id: "served-candidate-verified-after", passed: candidate.servedAfter?.verified === true, actual: candidate.servedAfter?.verified ?? false },
  {
    id: "served-candidate-stable",
    passed: Boolean(candidate.servedBefore?.aggregateSha256)
      && candidate.servedBefore.aggregateSha256 === candidate.servedAfter?.aggregateSha256,
    actual: {
      before: candidate.servedBefore?.aggregateSha256 ?? null,
      after: candidate.servedAfter?.aggregateSha256 ?? null,
    },
  },
  { id: "explicit-quality-applied", passed: qualityEvidence.effective === quality && qualityEvidence.effective !== "auto", actual: qualityEvidence },
  { id: "production-runtime-identity", passed: runtime?.title === "Rivet Ridge Rally" && runtime?.qaApiPresent === false && runtime?.productPerformanceApiPresent === false && runtime?.performanceCaptureHarnessPresent === true && runtime?.versionPresent === true, actual: runtime },
  { id: "runtime-source-commit-binding", passed: Boolean(candidate.source?.commit) && runtime?.build?.commit === candidate.source.commit && runtime?.build?.dirty === false, actual: { sourceCommit: candidate.source?.commit ?? null, runtimeBuild: runtime?.build ?? null } },
  {
    id: "configured-duration-completed",
    passed: workloadDurationMs >= configuredDurationMs,
    requiredMs: configuredDurationMs,
    actualMs: workloadDurationMs,
  },
  { id: "racing-gate-clock-complete", passed: racingClockEvidence?.overflowed === false && racingClockEvidence?.transitions?.[0]?.elapsedMs === 0 && racingClockEvidence?.transitions?.[0]?.racing === true && racingClockVisibilityLost === false, actual: { transitionCount: racingClockEvidence?.transitionCount ?? 0, initialState: racingClockEvidence?.transitions?.[0] ?? null, overflowed: racingClockEvidence?.overflowed ?? null, visibilityLost: racingClockVisibilityLost } },
  { id: "race-completed", passed: completedRaces > 0, actual: completedRaces },
  { id: "no-race-timeouts", passed: timedOutRaces === 0, actual: timedOutRaces },
  { id: "no-failed-requests", passed: failedRequests.length === 0, actual: failedRequests.length },
  { id: "no-http-error-responses", passed: httpErrorResponses.length === 0, actual: httpErrorResponses.length },
  {
    id: "no-unexpected-console-or-page-messages",
    passed: unexpectedConsoleMessages.length === 0,
    actual: unexpectedConsoleMessages.length,
  },
  {
    id: "memory-samples-complete",
    passed: samples.length > 0 && heapSamples.length === samples.length,
    actual: { expected: samples.length, received: heapSamples.length },
  },
  {
    id: "input-samples-complete",
    passed: samples.length > 0 && inputSamples.length === samples.length && dispatchSamples.length === samples.length,
    actual: { expected: samples.length, keydownToFrame: inputSamples.length, dispatchDelay: dispatchSamples.length },
  },
  {
    id: "fixed-step-samples-complete",
    passed: samples.length > 0 && droppedSimulationSamples.length === samples.length,
    actual: { expected: samples.length, received: droppedSimulationSamples.length },
  },
  {
    id: "cumulative-fixed-step-telemetry-monotonic",
    passed: cumulativeDroppedSimulationSamples.length === samples.length && cumulativeDroppedSimulationIsMonotonic,
    actual: {
      expected: samples.length,
      received: cumulativeDroppedSimulationSamples.length,
      monotonic: cumulativeDroppedSimulationIsMonotonic,
    },
  },
];
const releaseOnlyCriteria = [
  { id: "rival-release-workload", passed: mode === "rival", required: "rival", actual: mode },
  {
    id: "minimum-30-minute-active-duration",
    passed: workloadDurationMs >= RELEASE_MINIMUM_DURATION_MS,
    requiredMs: RELEASE_MINIMUM_DURATION_MS,
    actualMs: workloadDurationMs,
  },
];
const releaseCriteria = [...diagnosticCriteria, ...releaseOnlyCriteria];
const failedDiagnosticCriteria = diagnosticCriteria.filter((criterion) => !criterion.passed);
const failedReleaseCriteria = releaseCriteria.filter((criterion) => !criterion.passed);
const completedAt = new Date().toISOString();
const evidence = {
  schemaVersion: 4,
  kind: "performance-soak",
  startedAt: runStartedAt,
  completedAt,
  createdAt: completedAt,
  baseURL,
  browser: { name: "chromium", version: browserVersion, headless: !headed },
  host: hostEvidence(),
  device,
  runtime,
  setup,
  candidate,
  configuration: {
    minutes,
    configuredDurationMs,
    workloadDurationBasis: "mutation-observed-game-shell-racing-gate",
    sampleIntervalSeconds,
    attemptTimeoutMs: ATTEMPT_TIMEOUT_MS,
    profile: profileName,
    mode,
    qualification: mode === "rival" ? "release" : "diagnostic",
    controlPolicy: {
      throttle: "held-KeyW",
      recovery: "held-Space-recovery-only",
      turboPulseTargetMs: 520,
      turboCoastTargetMs: 620,
      lane: "right-edge-restored-after-ArrowLeft-input-probe",
    },
    quality: qualityEvidence,
    viewport: contextOptions.viewport,
    emulation: {
      hasTouch: contextOptions.hasTouch ?? false,
      isMobile: contextOptions.isMobile ?? false,
    },
  },
  actualDurationMs,
  workloadDurationMs,
  wallWorkloadDurationMs,
  racingClock: racingClockEvidence,
  harnessError: harnessErrors[0] ?? null,
  harnessErrors,
  completedRaces,
  completedRaceEvidence,
  timedOutRaces,
  restartTimesMs,
  restartSummaryMs: summarize(restartTimesMs),
  memory: {
    samples: heapSamples.length,
    firstUsedBytes: heapSamples[0] ?? null,
    lastUsedBytes: heapSamples.at(-1) ?? null,
    growthBytes: heapSamples.length > 1 ? heapSamples.at(-1) - heapSamples[0] : null,
    usedBytes: summarize(heapSamples),
    trend: trend(samples.map((sample) => ({ elapsedMs: sample.elapsedMs, value: sample.heap.usedBytes }))),
  },
  inputResponsiveness: {
    dispatchDelayMs: summarize(dispatchSamples),
    keydownToFrameMs: summarize(inputSamples),
    dispatchDelayTrend: trend(samples.map((sample) => ({ elapsedMs: sample.elapsedMs, value: sample.input.dispatchDelayMs }))),
    keydownToFrameTrend: trend(samples.map((sample) => ({ elapsedMs: sample.elapsedMs, value: sample.input.keydownToFrameMs }))),
  },
  fixedStepTiming: {
    droppedSimulationMs: summarize(droppedSimulationSamples),
    maxAccumulatedDroppedMs: droppedSimulationSamples.length > 0
      ? Math.max(...droppedSimulationSamples)
      : null,
    cumulativeDroppedSimulationMs: {
      startMs: 0,
      endMs: cumulativeDroppedSimulationMs,
      growthMs: cumulativeDroppedSimulationMs,
      samples: summarize(cumulativeDroppedSimulationSamples),
      firstSampleMs: cumulativeDroppedSimulationSamples[0] ?? null,
      lastSampleMs: cumulativeDroppedSimulationSamples.at(-1) ?? null,
      growthAcrossSamplesMs: cumulativeDroppedSimulationSamples.length > 1
        ? cumulativeDroppedSimulationSamples.at(-1) - cumulativeDroppedSimulationSamples[0]
        : null,
      finalObservedMs: cumulativeDroppedSimulationMs,
      observedRatePerMinute: workloadDurationMs > 0
        ? round(cumulativeDroppedSimulationMs / (workloadDurationMs / 60_000))
        : null,
      trend: trend(samples.map((sample) => ({ elapsedMs: sample.elapsedMs, value: sample.cumulativeDroppedSimulationMs }))),
    },
    attempts: droppedSimulationAttempts,
    perAttemptMaxDroppedSimulationMs: summarize(droppedSimulationAttempts
      .map((attempt) => attempt.maxObservedDroppedSimulationMs)
      .filter((value) => Number.isFinite(value))),
    perAttemptTrend: trend(droppedSimulationAttempts.map((attempt) => ({
      elapsedMs: attempt.elapsedMs,
      value: attempt.maxObservedDroppedSimulationMs,
    }))),
  },
  network: {
    failedRequestCount: failedRequests.length,
    httpErrorResponseCount: httpErrorResponses.length,
    failedRequests,
    httpErrorResponses,
  },
  consoleSummary: {
    total: consoleMessages.length,
    knownDiagnosticWarnings: knownDiagnosticWarnings.length,
    unexpected: unexpectedConsoleMessages.length,
    unexpectedMessages: unexpectedConsoleMessages,
  },
  diagnosticGate: {
    status: failedDiagnosticCriteria.length === 0 ? "PASS" : "FAIL",
    criteria: diagnosticCriteria,
    failedCriteria: failedDiagnosticCriteria.map((criterion) => criterion.id),
  },
  releaseGate: {
    status: mode === "practice"
      ? "DIAGNOSTIC"
      : failedReleaseCriteria.length === 0 ? "PASS" : "FAIL",
    criteria: releaseCriteria,
    failedCriteria: failedReleaseCriteria.map((criterion) => criterion.id),
    manualTrendReviewRequired: [
      "memory.trend",
      "inputResponsiveness.dispatchDelayTrend",
      "inputResponsiveness.keydownToFrameTrend",
      "fixedStepTiming.cumulativeDroppedSimulationMs.trend",
    ],
  },
  status: mode === "practice"
    ? failedDiagnosticCriteria.length === 0 ? "DIAGNOSTIC" : "FAIL"
    : failedReleaseCriteria.length === 0 ? "PASS" : "FAIL",
  samples,
  consoleMessages,
};

function refreshSoakGates() {
  const harnessCriterion = diagnosticCriteria.find((criterion) => criterion.id === "no-harness-error");
  harnessCriterion.passed = harnessErrors.length === 0;
  harnessCriterion.actual = harnessErrors.length;
  const currentDiagnosticFailures = diagnosticCriteria.filter((criterion) => !criterion.passed);
  const currentReleaseFailures = releaseCriteria.filter((criterion) => !criterion.passed);
  evidence.harnessError = harnessErrors[0] ?? null;
  evidence.diagnosticGate.status = currentDiagnosticFailures.length === 0 ? "PASS" : "FAIL";
  evidence.diagnosticGate.failedCriteria = currentDiagnosticFailures.map((criterion) => criterion.id);
  evidence.releaseGate.status = mode === "practice"
    ? "DIAGNOSTIC"
    : currentReleaseFailures.length === 0 ? "PASS" : "FAIL";
  evidence.releaseGate.failedCriteria = currentReleaseFailures.map((criterion) => criterion.id);
  evidence.status = mode === "practice"
    ? currentDiagnosticFailures.length === 0 ? "DIAGNOSTIC" : "FAIL"
    : currentReleaseFailures.length === 0 ? "PASS" : "FAIL";
  return { currentDiagnosticFailures, currentReleaseFailures };
}

let { currentReleaseFailures } = refreshSoakGates();
if (mode === "rival" && currentReleaseFailures.length === 0) {
  try {
    if (releaseManifest === null) {
      throw releaseManifestError ?? new Error("Format-2 release manifest validation did not complete.");
    }
    validateSoakEvidence(
      evidence,
      { commit: releaseManifest.source.commit, tag: releaseManifest.source.tag },
      releaseManifest.version,
      releaseManifest,
    );
  } catch (error) {
    recordHarnessError("release-contract-validation", error);
    ({ currentReleaseFailures } = refreshSoakGates());
  }
}

const outputPath = await writeJson(output, evidence);
const releaseContractError = harnessErrors.find((error) => error.stage === "release-contract-validation") ?? null;
console.log(JSON.stringify({
  outputPath,
  actualDurationMs: evidence.actualDurationMs,
  completedRaces,
  samples: samples.length,
  memoryGrowthBytes: evidence.memory.growthBytes,
  inputFrameP95Ms: evidence.inputResponsiveness.keydownToFrameMs.p95,
  maxAccumulatedDroppedSimulationMs: evidence.fixedStepTiming.maxAccumulatedDroppedMs,
  cumulativeDroppedSimulationMs: evidence.fixedStepTiming.cumulativeDroppedSimulationMs.finalObservedMs,
  failedRequests: evidence.network.failedRequestCount,
  httpErrorResponses: evidence.network.httpErrorResponseCount,
  harnessError: evidence.harnessError,
  releaseContractError,
  harnessErrors,
  status: evidence.status,
  releaseGate: evidence.releaseGate.status,
  diagnosticGate: evidence.diagnosticGate.status,
  failedReleaseCriteria: evidence.releaseGate.failedCriteria,
}, null, 2));
if (
  evidence.diagnosticGate.status !== "PASS"
  || (mode === "rival" && evidence.releaseGate.status !== "PASS")
) process.exitCode = 1;

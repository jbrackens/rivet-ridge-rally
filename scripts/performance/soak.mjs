import process from "node:process";
import { chromium } from "playwright";

import {
  DEFAULT_BASE_URL,
  assertServer,
  collectPageMessages,
  createPerformanceSession,
  hasFlag,
  heapEvidence,
  measureInputResponsiveness,
  measureRestart,
  nodePerformance,
  openShell,
  parseHud,
  readOption,
  readPositiveNumber,
  round,
  startQaRace,
  summarize,
  writeJson,
} from "./common.mjs";

const RELEASE_MINIMUM_DURATION_MS = 30 * 60_000;
// QA-fast Rival races average about 32 seconds. This allows instrumentation and
// headless scheduling stalls while retaining a bounded stuck-race detector.
const ATTEMPT_TIMEOUT_MS = 90_000;
const KNOWN_DIAGNOSTIC_WARNING = /GPU stall due to ReadPixels/;

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
  console.log(`Usage: npm run perf:soak -- [options]\n\nOptions:\n  --base-url URL           QA preview URL (default ${DEFAULT_BASE_URL})\n  --output PATH            JSON output relative to the repository\n  --minutes N              Soak duration, fractional values allowed (default 30)\n  --sample-interval N      Seconds between samples (default 5)\n  --profile desktop|mobile Viewport profile (default desktop)\n  --mode rival|practice    Race workload (default rival)\n  --headed                 Run a visible Chromium window for hardware evidence\n  --help                    Show this help`);
  process.exit(0);
}

const baseURL = readOption(argumentsList, "base-url", process.env.PERF_BASE_URL ?? DEFAULT_BASE_URL);
const output = readOption(argumentsList, "output", "artifacts/performance/latest-soak.json");
const minutes = readPositiveNumber(argumentsList, "minutes", 30);
const sampleIntervalSeconds = readPositiveNumber(argumentsList, "sample-interval", 5);
const profileName = readOption(argumentsList, "profile", "desktop");
const mode = readOption(argumentsList, "mode", "rival");
const headed = hasFlag(argumentsList, "headed");
if (!["desktop", "mobile"].includes(profileName)) throw new Error("--profile must be desktop or mobile.");
if (!["rival", "practice"].includes(mode)) throw new Error("--mode must be rival or practice.");

const contextOptions = profileName === "mobile"
  ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true }
  : { viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 };
const configuredDurationMs = minutes * 60_000;
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
let completedRaces = 0;
let timedOutRaces = 0;
let direction = "a";
let workloadStartedAt = null;
let workloadEndedAt = null;
let harnessStage = "server-check";
let activeAttempt = 0;
let activeAttemptStartedAt = null;
let activeAttemptMaxDroppedSimulationMs = null;
let activeAttemptSampleCount = 0;
let cumulativeDroppedSimulationMs = 0;

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

try {
  await assertServer(baseURL);
  harnessStage = "browser-launch";
  browser = await chromium.launch({ headless: !headed, args: ["--enable-precise-memory-info"] });
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
  await openShell(page, baseURL);
  harnessStage = "initial-race-start";
  await startQaRace(page, mode);
  workloadStartedAt = nodePerformance.now();
  const deadline = workloadStartedAt + configuredDurationMs;
  beginAttempt();
  harnessStage = "race-workload";

  while (nodePerformance.now() < deadline) {
    await page.keyboard.down("w");
    await page.keyboard.down("Space");
    const raceDeadline = Math.min(deadline, nodePerformance.now() + ATTEMPT_TIMEOUT_MS);
    let nextSampleAt = nodePerformance.now();
    let completed = false;

    try {
      while (nodePerformance.now() < raceDeadline) {
        if (await page.getByRole("button", { name: "Retry now" }).isVisible().catch(() => false)) {
          completed = true;
          break;
        }
        if (nodePerformance.now() >= nextSampleAt) {
          const hud = parseHud(await page.getByLabel("Performance metrics").textContent().catch(() => null));
          const heap = await heapEvidence(session);
          const input = await measureInputResponsiveness(page, direction).catch((error) => ({ error: error instanceof Error ? error.message : String(error) }));
          direction = direction === "a" ? "d" : "a";
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
    }

    if (!completed) {
      if (nodePerformance.now() >= deadline) break;
      timedOutRaces += 1;
      await finalizeAttempt("timed-out");
      harnessStage = "timeout-recovery";
      await startQaRace(page, mode);
      beginAttempt();
      harnessStage = "race-workload";
      continue;
    }

    completedRaces += 1;
    await finalizeAttempt("completed");
    if (nodePerformance.now() >= deadline) break;
    harnessStage = "race-restart";
    restartTimesMs.push(await measureRestart(page));
    beginAttempt();
    harnessStage = "race-workload";
  }
  await finalizeAttempt("deadline");
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
const workloadDurationMs = workloadStartedAt === null
  ? 0
  : Math.round((workloadEndedAt ?? nodePerformance.now()) - workloadStartedAt);
const knownDiagnosticWarnings = consoleMessages.filter((message) =>
  message.type === "warning" && KNOWN_DIAGNOSTIC_WARNING.test(message.text));
const unexpectedConsoleMessages = consoleMessages.filter((message) =>
  !knownDiagnosticWarnings.includes(message));
const releaseCriteria = [
  { id: "no-harness-error", passed: harnessErrors.length === 0, actual: harnessErrors.length },
  {
    id: "minimum-active-duration",
    passed: workloadDurationMs >= RELEASE_MINIMUM_DURATION_MS,
    requiredMs: RELEASE_MINIMUM_DURATION_MS,
    actualMs: workloadDurationMs,
  },
  {
    id: "configured-duration-completed",
    passed: workloadDurationMs >= configuredDurationMs,
    requiredMs: configuredDurationMs,
    actualMs: workloadDurationMs,
  },
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
const failedReleaseCriteria = releaseCriteria.filter((criterion) => !criterion.passed);
const evidence = {
  schemaVersion: 1,
  kind: "performance-soak",
  createdAt: new Date().toISOString(),
  baseURL,
  browser: { name: "chromium", version: browserVersion, headless: !headed },
  host: { node: process.version, platform: process.platform, architecture: process.arch },
  configuration: {
    minutes,
    configuredDurationMs,
    sampleIntervalSeconds,
    attemptTimeoutMs: ATTEMPT_TIMEOUT_MS,
    profile: profileName,
    mode,
    viewport: contextOptions.viewport,
  },
  actualDurationMs,
  workloadDurationMs,
  harnessError: harnessErrors[0] ?? null,
  harnessErrors,
  completedRaces,
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
  releaseGate: {
    status: failedReleaseCriteria.length === 0 ? "PASS" : "FAIL",
    criteria: releaseCriteria,
    failedCriteria: failedReleaseCriteria.map((criterion) => criterion.id),
    manualTrendReviewRequired: [
      "memory.trend",
      "inputResponsiveness.dispatchDelayTrend",
      "inputResponsiveness.keydownToFrameTrend",
      "fixedStepTiming.cumulativeDroppedSimulationMs.trend",
    ],
  },
  samples,
  consoleMessages,
};

const outputPath = await writeJson(output, evidence);
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
  releaseGate: evidence.releaseGate.status,
  failedReleaseCriteria: evidence.releaseGate.failedCriteria,
}, null, 2));
if (evidence.releaseGate.status !== "PASS") process.exitCode = 1;

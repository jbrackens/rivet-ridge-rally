import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { deflateSync, gzipSync } from "node:zlib";

import {
  validatePerformanceEvidence,
  validateReleaseAttestation,
  validateSoakEvidence,
  verifyReleaseAttestation,
} from "./release-attestation.mjs";
import {
  assertPerformanceEvidenceDirectoryPath,
  assertPerformanceEvidenceOutputPath,
} from "./performance/common.mjs";

const PRODUCT_COMMIT = "a".repeat(40);
const PRODUCT_TAG_OBJECT = "b".repeat(40);
const ROLLBACK_COMMIT = "c".repeat(40);
const ROLLBACK_TAG_OBJECT = "d".repeat(40);
const EVIDENCE_COMMIT = "e".repeat(40);
const ATTESTATION_TAG_OBJECT = "f".repeat(40);
const VERSION = "1.0.0-rc.2";
const PRODUCT_TAG = `v${VERSION}`;
const ROLLBACK_TAG = "v1.0.0-rc.1";
const ATTESTATION_PATH = `artifacts/release-attestations/${PRODUCT_TAG}.json`;
const ROLLBACK_ARCHIVE_BYTES = 1_234_567;
const ROLLBACK_ARCHIVE_SHA256 = "7".repeat(64);
const ROLLBACK_STAGED_BASE_URL = "https://staging.rivet-ridge.example/";
const VISUAL_CAPTURE_COMMIT = "9".repeat(40);
const VISUAL_BASELINE_APPROVAL_PATH = "docs/design/RACE_CURVED_CANYON_BASELINE_APPROVAL.json";
const VISUAL_BASELINE_PATH = "e2e/visual-regression.spec.ts-snapshots/race-curved-course-canyon-chromium-darwin.png";
const VISUAL_CAPTURE_PATH = "curved-baseline-candidate/canyon-kickoff-practice-1280x720.png";

const PERFORMANCE_CRITERIA = [
  "all-profiles-completed",
  "authored-hero-measured",
  "compressed-bundle-under-12mb",
  "desktop-normal-performance-budget",
  "desktop-stress-performance-budget",
  "editor-test-ride-visible",
  "emulated-mobile-normal-technical-floor",
  "emulated-mobile-stress-technical-floor",
  "explicit-quality-applied",
  "headed-release-measurement",
  "heap-samples-complete",
  "no-failed-requests",
  "no-harness-error",
  "no-http-error-responses",
  "no-unexpected-console-or-page-messages",
  "production-runtime-identity",
  "rendering-samples-complete",
  "runtime-source-commit-binding",
  "served-candidate-stable",
  "served-candidate-verified-after",
  "served-candidate-verified-before",
  "source-identity-recorded",
  "source-worktree-clean",
];

const SOAK_CRITERIA = [
  "configured-duration-completed",
  "cumulative-fixed-step-telemetry-monotonic",
  "explicit-quality-applied",
  "fixed-step-samples-complete",
  "input-samples-complete",
  "memory-samples-complete",
  "minimum-30-minute-active-duration",
  "no-failed-requests",
  "no-harness-error",
  "no-http-error-responses",
  "no-race-timeouts",
  "no-unexpected-console-or-page-messages",
  "production-runtime-identity",
  "racing-gate-clock-complete",
  "race-completed",
  "rival-release-workload",
  "runtime-source-commit-binding",
  "served-candidate-stable",
  "served-candidate-verified-after",
  "served-candidate-verified-before",
  "source-identity-recorded",
  "source-worktree-clean",
];

const SOAK_DIAGNOSTIC_CRITERIA = SOAK_CRITERIA.filter((id) => ![
  "minimum-30-minute-active-duration",
  "rival-release-workload",
].includes(id));

const SOAK_TREND_REVIEW_PATHS = [
  "memory.trend",
  "inputResponsiveness.dispatchDelayTrend",
  "inputResponsiveness.keydownToFrameTrend",
  "fixedStepTiming.cumulativeDroppedSimulationMs.trend",
];

const APPROVAL_SCOPES = {
  qa: "release-qualification",
  accessibility: "release-accessibility",
  legal: "release-rights-privacy-and-trade-dress",
};

const MANDATORY_QA_CHECKS = {
  accessibility: ["npx playwright test e2e/core-flow.spec.ts e2e/accessibility-controls.spec.ts"],
  assets: ["npm run assets:verify"],
  browser: ["npm run test:e2e"],
  dependencyAudit: ["npm run audit"],
  lint: ["npm run lint"],
  persistence: [
    "npx vitest run src/game/persistence",
    "npx playwright test e2e/migrations.spec.ts",
  ],
  reliability: ["npx playwright test e2e/reliability.spec.ts"],
  typecheck: ["npm run typecheck"],
  unit: ["npm test"],
  visual: ["npx playwright test e2e/visual-regression.spec.ts"],
};

const CRC_TABLE = new Uint32Array(256);
for (let index = 0; index < CRC_TABLE.length; index += 1) {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    value = (value & 1) === 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }
  CRC_TABLE[index] = value >>> 0;
}

function sha256(contents) {
  return createHash("sha256").update(contents).digest("hex");
}

function crc32(bytes) {
  let value = 0xffffffff;
  for (const byte of bytes) value = CRC_TABLE[(value ^ byte) & 0xff] ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
}

function pngChunk(type, payload) {
  const typeBytes = Buffer.from(type, "ascii");
  const header = Buffer.alloc(8);
  header.writeUInt32BE(payload.length, 0);
  typeBytes.copy(header, 4);
  const trailer = Buffer.alloc(4);
  trailer.writeUInt32BE(crc32(Buffer.concat([typeBytes, payload])), 0);
  return Buffer.concat([header, payload, trailer]);
}

function createFixturePng(width = 320, height = 180) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const rowBytes = width * 4 + 1;
  const pixels = Buffer.alloc(rowBytes * height);
  for (let row = 0; row < height; row += 1) {
    const offset = row * rowBytes;
    pixels[offset] = 0;
    for (let column = 0; column < width; column += 1) {
      const pixel = offset + 1 + column * 4;
      pixels[pixel] = 24;
      pixels[pixel + 1] = 42;
      pixels[pixel + 2] = 54;
      pixels[pixel + 3] = 255;
    }
  }
  return Buffer.concat([
    Buffer.from("89504e470d0a1a0a", "hex"),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", deflateSync(pixels)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

const FIXTURE_PNG = createFixturePng();
const VISUAL_FIXTURE_PNG = createFixturePng(1_280, 720);

function aggregate(records) {
  const hash = createHash("sha256");
  for (const record of records) hash.update(`${record.sha256}  ${record.path}\n`);
  return hash.digest("hex");
}

function fileRecord(filePath, contents) {
  const buffer = Buffer.isBuffer(contents) ? contents : Buffer.from(contents);
  return { path: filePath, bytes: buffer.length, sha256: sha256(buffer) };
}

function manifestRecord(filePath, contents) {
  const buffer = Buffer.isBuffer(contents) ? contents : Buffer.from(contents);
  const gzipContents = gzipSync(buffer, { level: 9 });
  return {
    ...fileRecord(filePath, buffer),
    gzipBytes: gzipContents.length,
    gzipSha256: sha256(gzipContents),
  };
}

async function writeFixtureFile(root, filePath, value) {
  const contents = Buffer.isBuffer(value)
    ? value
    : Buffer.from(typeof value === "string" ? value : `${JSON.stringify(value, null, 2)}\n`);
  await mkdir(path.dirname(path.join(root, filePath)), { recursive: true });
  await writeFile(path.join(root, filePath), contents);
  return fileRecord(filePath, contents);
}

function manifestFiles(suffix = "current") {
  return [
    manifestRecord("THIRD_PARTY_NOTICES.txt", `notices-${suffix}\n`),
    manifestRecord("index.html", `<title>Rivet Ridge Rally ${suffix}</title>\n`),
    manifestRecord("sw.js", `// worker-${suffix}\n`),
  ];
}

function releaseManifest({
  version = VERSION,
  commit = PRODUCT_COMMIT,
  tag = PRODUCT_TAG,
  tagObject = PRODUCT_TAG_OBJECT,
  suffix = "current",
} = {}) {
  const files = manifestFiles(suffix);
  return {
    product: "RIVET RIDGE RALLY",
    version,
    format: 2,
    source: { commit, tag, tagObject, tagObjectType: "tag" },
    toolchain: {
      node: "26.4.0",
      nodeExecutableSha256: "1".repeat(64),
      npm: "11.17.0",
      npmCliSha256: "2".repeat(64),
      npmPackage: {
        treeFormat: 1,
        name: "npm",
        version: "11.17.0",
        cliRelativePath: "bin/npm-cli.js",
        packageJsonSha256: "4".repeat(64),
        directoryCount: 100,
        regularFileCount: 1_900,
        symlinkCount: 9,
        totalRegularFileBytes: 12_345_678,
        treeSha256: "5".repeat(64),
      },
      platform: "darwin",
      arch: "arm64",
      packageLockSha256: "3".repeat(64),
    },
    build: {
      source: "detached-clean-git-worktree",
      installCommand: "npm ci --no-audit --no-fund",
      buildCommand: "npm run build",
      viteQaMode: "0",
      npmConfig: "isolated-empty-user-and-global",
      installScripts: "enabled",
    },
    compression: { algorithm: "gzip", level: 9 },
    totalBytes: files.reduce((sum, record) => sum + record.bytes, 0),
    totalGzipBytes: files.reduce((sum, record) => sum + record.gzipBytes, 0),
    fileCount: files.length,
    aggregateSha256: aggregate(files),
    files,
  };
}

function sourceIdentity() {
  return {
    commit: PRODUCT_COMMIT,
    packageVersion: VERSION,
    expectedTag: PRODUCT_TAG,
    tagsAtCommit: [PRODUCT_TAG],
    expectedTagAtCommit: true,
    expectedTagObjectType: "tag",
    expectedTagAnnotated: true,
    dirty: false,
    dirtyEntryCount: 0,
  };
}

function servedEvidence(manifest, baseURL) {
  const indexRecord = manifest.files.find((record) => record.path === "index.html");
  return {
    verified: true,
    baseURL,
    origin: new URL(baseURL).origin,
    fileCount: manifest.fileCount,
    totalBytes: manifest.totalBytes,
    totalGzipBytes: manifest.totalGzipBytes,
    aggregateSha256: manifest.aggregateSha256,
    entrypoint: {
      requestedURL: baseURL,
      finalURL: baseURL,
      bytes: indexRecord.bytes,
      sha256: indexRecord.sha256,
    },
    files: manifest.files.map((record) => ({ ...record })),
  };
}

function performanceCandidate(manifest, baseURL) {
  const files = manifest.files.map((record) => ({ ...record }));
  const localBuild = {
    directory: "dist",
    fileCount: files.length,
    totalBytes: files.reduce((sum, record) => sum + record.bytes, 0),
    totalGzipBytes: files.reduce((sum, record) => sum + record.gzipBytes, 0),
    aggregateSha256: manifest.aggregateSha256,
    files,
  };
  const served = servedEvidence(manifest, baseURL);
  return {
    source: sourceIdentity(),
    localBuild,
    servedBefore: { ...served },
    servedAfter: { ...served },
  };
}

function passingGate(ids) {
  return {
    status: "PASS",
    criteria: ids.map((id) => {
      if (id === "compressed-bundle-under-12mb") {
        return { id, passed: true, requiredExclusiveBytes: 12_000_000, actualBytes: 1_000 };
      }
      if (["configured-duration-completed", "minimum-30-minute-active-duration"].includes(id)) {
        return { id, passed: true, requiredMs: 1_800_000, actualMs: 1_800_001 };
      }
      if (id === "headed-release-measurement") {
        return { id, passed: true, required: true, actual: true };
      }
      if (id.endsWith("performance-budget") || id.endsWith("technical-floor")) {
        return { id, passed: true, required: {}, actual: {} };
      }
      if (id === "rival-release-workload") {
        return { id, passed: true, required: "rival", actual: "rival" };
      }
      return { id, passed: true, actual: true };
    }),
    failedCriteria: [],
  };
}

function performanceQuality(quality) {
  return {
    requested: quality,
    selected: quality,
    effective: quality,
    effectiveDerivation: "explicit-non-auto-renderer-preset",
  };
}

function hostEvidence() {
  return {
    node: "v26.4.0",
    platform: "darwin",
    architecture: "arm64",
    os: { type: "Darwin", release: "25.5.0", version: "macOS 26.5" },
    cpu: { model: "Fixture CPU", logicalCores: 8 },
    totalMemoryBytes: 16_000_000_000,
  };
}

function deviceEvidence(viewport, devicePixelRatio) {
  return {
    userAgent: "Fixture Chromium",
    browserPlatform: "MacIntel",
    languages: ["en-US"],
    hardwareConcurrency: 8,
    deviceMemoryGiB: 8,
    viewport,
    screen: { width: viewport.width, height: viewport.height, colorDepth: 24, pixelDepth: 24 },
    devicePixelRatio,
    pointer: { coarse: false, hover: true },
    webgl: {
      version: "WebGL 2.0",
      shadingLanguageVersion: "WebGL GLSL ES 3.00",
      vendor: "Fixture Vendor",
      renderer: "Fixture Renderer",
    },
  };
}

function navigationTiming() {
  return {
    durationMs: 100,
    domInteractiveMs: 50,
    domContentLoadedMs: 75,
    loadEventMs: 100,
    responseEndMs: 25,
    transferSizeBytes: 1_000,
    encodedBodyBytes: 900,
    decodedBodyBytes: 1_100,
  };
}

function resourceEvidence() {
  return {
    requestCount: 0,
    transferSizeBytes: 0,
    encodedBodyBytes: 0,
    decodedBodyBytes: 0,
    resources: [],
  };
}

function roundMetric(value, digits = 2) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function summarizeMetric(values) {
  const sorted = values.toSorted((left, right) => left - right);
  const percentileIndex = Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1);
  return {
    samples: sorted.length,
    min: roundMetric(sorted[0]),
    mean: roundMetric(sorted.reduce((sum, value) => sum + value, 0) / sorted.length),
    p95: roundMetric(sorted[percentileIndex]),
    max: roundMetric(sorted.at(-1)),
  };
}

function trendMetric(points) {
  const windowSamples = Math.max(1, Math.ceil(points.length * 0.2));
  const mean = (values) => values.reduce((sum, value) => sum + value, 0) / values.length;
  const firstWindowMean = mean(points.slice(0, windowSamples).map((point) => point.value));
  const lastWindowMean = mean(points.slice(-windowSamples).map((point) => point.value));
  const firstElapsedMs = points[0].elapsedMs;
  const elapsedMean = mean(points.map((point) => point.elapsedMs - firstElapsedMs));
  const valueMean = mean(points.map((point) => point.value));
  const covariance = points.reduce((sum, point) => (
    sum + ((point.elapsedMs - firstElapsedMs) - elapsedMean) * (point.value - valueMean)
  ), 0);
  const elapsedVariance = points.reduce((sum, point) => (
    sum + ((point.elapsedMs - firstElapsedMs) - elapsedMean) ** 2
  ), 0);
  return {
    samples: points.length,
    windowSamples,
    firstWindowMean: roundMetric(firstWindowMean),
    lastWindowMean: roundMetric(lastWindowMean),
    changeBetweenWindows: roundMetric(lastWindowMean - firstWindowMean),
    linearRatePerMinute: elapsedVariance === 0 ? null : roundMetric((covariance / elapsedVariance) * 60_000),
  };
}

function profileMetric(meanFps, frameWorkP95Ms) {
  const samples = Array.from({ length: 6 }, (_, index) => ({
    elapsedMs: index * 1_000,
    fps: meanFps,
    frameTimeMs: frameWorkP95Ms,
    drawCalls: 100,
    droppedSimulationMs: 0,
  }));
  const frameSamples = Array.from({ length: meanFps * 5 + 1 }, (_, index) => {
    const elapsedMs = roundMetric(index * (1_000 / meanFps), 3);
    return {
      elapsedMs,
      frameTimestampMs: roundMetric(1_000 + elapsedMs, 3),
      frameWorkMs: frameWorkP95Ms,
      callbackCount: 1,
    };
  });
  return {
    durationMs: 5_000,
    sampleCount: samples.length,
    fps: summarizeMetric(samples.map((sample) => sample.fps)),
    frameTimeMs: summarizeMetric(samples.map((sample) => sample.frameTimeMs)),
    drawCalls: summarizeMetric(samples.map((sample) => sample.drawCalls)),
    samples,
    frameWork: {
      apiVersion: 1,
      method: "pre-navigation-request-animation-frame-callback-work",
      scope: "synchronous-requestAnimationFrame-callback-cpu-work-only-excludes-style-layout-paint-gpu-and-microtasks",
      measuredDurationMs: 5_000,
      maximumSamples: 4_096,
      overflowed: false,
      visibilityLost: false,
      sampleCount: frameSamples.length,
      meanFps,
      frameWorkMs: summarizeMetric(frameSamples.map((sample) => sample.frameWorkMs)),
      samples: frameSamples,
    },
  };
}

function performanceSetup() {
  return {
    method: "native-indexeddb-progress-record",
    database: "rivet-ridge-rally",
    nativeIndexedDbVersion: 60,
    profileId: "rider-01",
    trackId: "canyon-kickoff",
    expectedTrackIds: [
      "canyon-kickoff",
      "pine-run",
      "coastline-clash",
      "foundry-flight",
      "summit-showdown",
    ],
    bestSoloMs: 190_000,
    rivalUnlocked: true,
    verifiedViaPublicUi: true,
  };
}

function performanceProfile(name) {
  const desktop = name === "desktop-1920x1080";
  const quality = desktop ? "high" : "low";
  const scope = desktop
    ? "representative-local-desktop"
    : "emulated-mobile-local-technical-floor-not-physical-device-proof";
  const viewport = desktop ? { width: 1_920, height: 1_080 } : { width: 390, height: 844 };
  const deviceScaleFactor = desktop ? 1 : 2;
  const emulation = { hasTouch: !desktop, isMobile: !desktop };
  return {
    name,
    scope,
    viewport,
    deviceScaleFactor,
    emulation,
    authoredHero: {
      bikeAsset: "ready",
      fallbackReason: null,
      root: "RRR_HeroBikeRider",
    },
    completed: true,
    error: null,
    quality: performanceQuality(quality),
    device: deviceEvidence(viewport, deviceScaleFactor),
    runtime: {
      title: "Rivet Ridge Rally",
      qaApiPresent: false,
      productPerformanceApiPresent: false,
      performanceCaptureHarnessPresent: true,
      version: VERSION,
      versionPresent: true,
      build: { commit: PRODUCT_COMMIT, dirty: false },
    },
    navigation: {
      status: 200,
      shellReadyMs: 500,
      progressSetup: performanceSetup(),
      timing: navigationTiming(),
    },
    firstRaceLoadMs: 4_000,
    restartMs: 3_500,
    editor: {
      openMs: 500,
      testPlayMs: 4_000,
      testRideControlVisible: true,
      testRideInvocation: "visible-control",
    },
    rendering: profileMetric(desktop ? 60 : 32, desktop ? 15 : 30),
    stress: profileMetric(desktop ? 59 : 31, desktop ? 16 : 32),
    stressProof: {
      method: "public-ui-canyon-rival-timed-wheelie",
      trackId: "canyon-kickoff",
      mode: "rival",
      lane: "lane-2-after-one-ArrowRight",
      wheelieKey: "ArrowUp",
      cue: "Front wheel clear — bump speed held",
      cueDeadlineMs: 5_000,
      driveStartedMs: 300,
      wheelieArmOffsetMs: 2_800,
      raceElapsedMs: 3_980,
      raceGatePhase: "racing",
      recoveryPromptVisible: false,
    },
    heaps: [
      "shell",
      "first-race-ready",
      "after-render-sample",
      "after-restart",
      "rival-wheelie-obstacle-stress",
      "editor-test-play",
    ].map((stage, index) => ({
      stage,
      available: true,
      usedBytes: 1_000_000 + index * 1_000,
      totalBytes: 2_000_000,
    })),
    network: {
      shell: resourceEvidence(),
      completeFlow: resourceEvidence(),
      failedRequests: [],
      httpErrorResponses: [],
    },
    consoleMessages: [],
    screenshot: null,
  };
}

function performanceEvidence(manifest) {
  const baseURL = "http://127.0.0.1:4373/";
  return {
    schemaVersion: 4,
    kind: "performance-measurement",
    startedAt: "2026-07-16T11:59:00.000Z",
    completedAt: "2026-07-16T12:00:00.000Z",
    createdAt: "2026-07-16T12:00:00.000Z",
    status: "PASS",
    baseURL,
    browser: { name: "chromium", version: "150.0.0.0", headless: false },
    host: hostEvidence(),
    configuration: {
      sampleSeconds: 5,
      productBuildRequired: true,
      qualityPolicy: { type: "explicit-per-profile", desktop: "high", mobile: "low" },
      releaseRequiresHeaded: true,
      budgets: {
        compressedBundleBytesExclusive: 12_000_000,
        desktop: { targetFps: 60, acceptanceFloorMeanFps: 58, frameWorkP95MsInclusive: 16.67 },
        emulatedMobile: {
          targetFps: 30,
          acceptanceFloorMeanFps: 30,
          frameWorkP95MsInclusive: 33.33,
          physicalDeviceProof: false,
        },
      },
    },
    candidate: performanceCandidate(manifest, baseURL),
    harnessErrors: [],
    consoleSummary: {
      total: 0,
      knownDiagnosticWarnings: 0,
      unexpected: 0,
      unexpectedMessages: [],
    },
    profiles: [performanceProfile("desktop-1920x1080"), performanceProfile("mobile-390x844")],
    automatedGate: {
      ...passingGate(PERFORMANCE_CRITERIA),
      manualBudgetReviewRequired: true,
      mobileEvidenceScope: "emulated/local technical floor; physical-device acceptance remains required",
    },
    durationMs: 60_000,
  };
}

function soakEvidence(manifest) {
  const baseURL = "http://127.0.0.1:4373/";
  const samples = Array.from({ length: 181 }, (_, index) => {
    const elapsedMs = 10_000 + index * 10_000;
    const attempt = elapsedMs <= 610_000 ? 1 : elapsedMs <= 1_230_000 ? 2 : 3;
    return {
      elapsedMs,
      race: attempt,
      attempt,
      hud: { fps: 60, frameTimeMs: 16, drawCalls: 100, droppedSimulationMs: 0 },
      cumulativeDroppedSimulationMs: 0,
      heap: { available: true, usedBytes: 1_000_000 + index * 100, totalBytes: 2_000_000 },
      input: { dispatchDelayMs: 2 + (index % 2), keydownToFrameMs: 8 + (index % 2) },
    };
  });
  const heapValues = samples.map((sample) => sample.heap.usedBytes);
  const dispatchValues = samples.map((sample) => sample.input.dispatchDelayMs);
  const inputValues = samples.map((sample) => sample.input.keydownToFrameMs);
  const droppedValues = samples.map((sample) => sample.hud.droppedSimulationMs);
  const cumulativeValues = samples.map((sample) => sample.cumulativeDroppedSimulationMs);
  const points = (values) => samples.map((sample, index) => ({ elapsedMs: sample.elapsedMs, value: values[index] }));
  const finalObservedMs = cumulativeValues.at(-1);
  const attempts = [
    {
      attempt: 1,
      outcome: "completed",
      elapsedMs: 620_000,
      durationMs: 600_000,
      samples: 62,
      maxObservedDroppedSimulationMs: 0,
      cumulativeDroppedSimulationMs: 0,
    },
    {
      attempt: 2,
      outcome: "completed",
      elapsedMs: 1_240_000,
      durationMs: 600_000,
      samples: 63,
      maxObservedDroppedSimulationMs: 0,
      cumulativeDroppedSimulationMs: 0,
    },
    {
      attempt: 3,
      outcome: "deadline",
      elapsedMs: 1_850_000,
      durationMs: 590_000,
      samples: 59,
      maxObservedDroppedSimulationMs: 0,
      cumulativeDroppedSimulationMs: 0,
    },
  ];
  const restartTimesMs = [3_500, 3_600];
  return {
    schemaVersion: 4,
    kind: "performance-soak",
    startedAt: "2026-07-16T11:30:00.000Z",
    completedAt: "2026-07-16T12:01:00.000Z",
    createdAt: "2026-07-16T12:01:00.000Z",
    status: "PASS",
    baseURL,
    browser: { name: "chromium", version: "150.0.0.0", headless: false },
    host: hostEvidence(),
    device: deviceEvidence({ width: 1_920, height: 1_080 }, 1),
    configuration: {
      minutes: 30,
      configuredDurationMs: 1_800_000,
      workloadDurationBasis: "mutation-observed-game-shell-racing-gate",
      sampleIntervalSeconds: 5,
      attemptTimeoutMs: 12 * 60_000,
      profile: "desktop",
      viewport: { width: 1_920, height: 1_080 },
      emulation: { hasTouch: false, isMobile: false },
      mode: "rival",
      qualification: "release",
      controlPolicy: {
        throttle: "held-KeyW",
        recovery: "held-Space-recovery-only",
        turboPulseTargetMs: 520,
        turboCoastTargetMs: 620,
        lane: "right-edge-restored-after-ArrowLeft-input-probe",
      },
      quality: performanceQuality("high"),
    },
    actualDurationMs: 1_860_000,
    workloadDurationMs: 1_800_001,
    wallWorkloadDurationMs: 1_860_000,
    racingClock: {
      apiVersion: 1,
      method: "mutation-observed-game-shell-racing-gate",
      measuredDurationMs: 1_860_000,
      durationMs: 1_800_001,
      maximumTransitions: 1_024,
      overflowed: false,
      visibilityLost: false,
      transitionCount: 5,
      transitions: [
        { elapsedMs: 0, racing: true },
        { elapsedMs: 600_000, racing: false },
        { elapsedMs: 620_000, racing: true },
        { elapsedMs: 1_220_000, racing: false },
        { elapsedMs: 1_259_999, racing: true },
      ],
    },
    completedRaces: 2,
    completedRaceEvidence: [
      {
        attempt: 1,
        mode: "rival",
        resultVisible: true,
        retryVisible: true,
        fatalScreenVisible: false,
        finalTime: "02:37.13",
        breakdownLabels: ["Lap 1", "Lap 2", "Target gap", "Crashes", "Overheats"],
        lapTimes: ["01:19.55", "01:17.58"],
        crashes: 0,
        overheats: 0,
        positionLabel: "POSITION 1 / 6",
        classificationLabel: "Official 6-rider classification",
        classificationRows: 6,
      },
      {
        attempt: 2,
        mode: "rival",
        resultVisible: true,
        retryVisible: true,
        fatalScreenVisible: false,
        finalTime: "02:38.04",
        breakdownLabels: ["Lap 1", "Lap 2", "Target gap", "Crashes", "Overheats"],
        lapTimes: ["01:19.80", "01:18.24"],
        crashes: 1,
        overheats: 0,
        positionLabel: "Position 2 / 6",
        classificationLabel: "Official 6-rider classification",
        classificationRows: 6,
      },
    ],
    timedOutRaces: 0,
    harnessError: null,
    harnessErrors: [],
    runtime: {
      title: "Rivet Ridge Rally",
      qaApiPresent: false,
      productPerformanceApiPresent: false,
      performanceCaptureHarnessPresent: true,
      version: VERSION,
      versionPresent: true,
      build: { commit: PRODUCT_COMMIT, dirty: false },
    },
    setup: performanceSetup(),
    candidate: performanceCandidate(manifest, baseURL),
    restartTimesMs,
    restartSummaryMs: summarizeMetric(restartTimesMs),
    network: {
      failedRequestCount: 0,
      httpErrorResponseCount: 0,
      failedRequests: [],
      httpErrorResponses: [],
    },
    consoleSummary: {
      total: 0,
      knownDiagnosticWarnings: 0,
      unexpected: 0,
      unexpectedMessages: [],
    },
    samples,
    memory: {
      samples: samples.length,
      firstUsedBytes: heapValues[0],
      lastUsedBytes: heapValues.at(-1),
      growthBytes: heapValues.at(-1) - heapValues[0],
      usedBytes: summarizeMetric(heapValues),
      trend: trendMetric(points(heapValues)),
    },
    inputResponsiveness: {
      dispatchDelayMs: summarizeMetric(dispatchValues),
      keydownToFrameMs: summarizeMetric(inputValues),
      dispatchDelayTrend: trendMetric(points(dispatchValues)),
      keydownToFrameTrend: trendMetric(points(inputValues)),
    },
    fixedStepTiming: {
      droppedSimulationMs: summarizeMetric(droppedValues),
      maxAccumulatedDroppedMs: Math.max(...droppedValues),
      cumulativeDroppedSimulationMs: {
        startMs: 0,
        endMs: finalObservedMs,
        growthMs: finalObservedMs,
        samples: summarizeMetric(cumulativeValues),
        firstSampleMs: cumulativeValues[0],
        lastSampleMs: cumulativeValues.at(-1),
        growthAcrossSamplesMs: cumulativeValues.at(-1) - cumulativeValues[0],
        finalObservedMs,
        observedRatePerMinute: roundMetric(finalObservedMs / (1_800_001 / 60_000)),
        trend: trendMetric(points(cumulativeValues)),
      },
      attempts,
      perAttemptMaxDroppedSimulationMs: summarizeMetric(attempts.map((attempt) => attempt.maxObservedDroppedSimulationMs)),
      perAttemptTrend: trendMetric(attempts.map((attempt) => ({
        elapsedMs: attempt.elapsedMs,
        value: attempt.maxObservedDroppedSimulationMs,
      }))),
    },
    diagnosticGate: passingGate(SOAK_DIAGNOSTIC_CRITERIA),
    releaseGate: {
      ...passingGate(SOAK_CRITERIA),
      manualTrendReviewRequired: [...SOAK_TREND_REVIEW_PATHS],
    },
    consoleMessages: [],
  };
}

function smokeEvidence(manifest, manifestReference, screenshots) {
  const baseURL = "http://127.0.0.1:4173/";
  const served = servedEvidence(manifest, baseURL);
  return {
    schemaVersion: 5,
    kind: "production-smoke",
    createdAt: "2026-07-16T12:02:00.000Z",
    run: {
      id: "fixture-run",
      startedAt: "2026-07-16T12:01:30.000Z",
      candidateManifestSha256: manifestReference.sha256,
    },
    baseURL,
    browser: {
      name: "Google Chrome",
      channel: "chrome",
      version: "150.0.0.0",
      headless: true,
      viewport: { width: 1_440, height: 900 },
    },
    releaseArtifact: {
      format: manifest.format,
      product: manifest.product,
      version: VERSION,
      source: manifest.source,
      toolchain: manifest.toolchain,
      build: manifest.build,
      manifestSha256: manifestReference.sha256,
      aggregateSha256: manifest.aggregateSha256,
      fileCount: manifest.fileCount,
      totalBytes: manifest.totalBytes,
      totalGzipBytes: manifest.totalGzipBytes,
      compression: manifest.compression,
      servedBefore: served,
      servedAfter: served,
    },
    runtime: {
      title: "Rivet Ridge Rally",
      version: VERSION,
      versionPresent: true,
      qaApiPresent: false,
      build: { commit: PRODUCT_COMMIT, dirty: false },
    },
    steps: [
      "format-2-artifact-binding",
      "boot-and-version",
      "race-start-and-restart",
      "editor-open",
      "offline-service-worker-reload",
      "offline-cached-practice-race",
      "post-journey-format-2-artifact-binding",
    ],
    serviceWorkerControlled: true,
    offlineCacheName: "rivet-ridge-rally-shell-v35",
    offlineReloadPassed: true,
    offlinePracticeRacePassed: true,
    network: { failedRequests: [], httpErrors: [] },
    console: { unexpected: [] },
    screenshots,
    screenshotAggregateSha256: aggregate([...screenshots].toSorted((left, right) => left.path.localeCompare(right.path))),
    smokeError: null,
    status: "PASS",
  };
}

function approvalFields(role, manifest, approvedAt) {
  return {
    status: "APPROVED",
    role,
    scope: APPROVAL_SCOPES[role],
    productTag: PRODUCT_TAG,
    productCommit: PRODUCT_COMMIT,
    manifestAggregateSha256: manifest.aggregateSha256,
    approvedBy: `${role} owner`,
    approvedAt,
  };
}

function approvalEvidence(role, manifest, decision, supportingEvidence) {
  const roleDecision = role === "qa"
    ? { status: "PASS", openP0: 0, openP1: 0 }
    : role === "accessibility"
      ? { status: "PASS", unresolvedMandatory: 0 }
      : {
          status: "PASS",
          commercialUseCleared: true,
          assetInventoryCleared: true,
          trademarkTradeDressCleared: true,
          privacyCleared: true,
          productLicenseCleared: true,
        };
  return {
    schemaVersion: 1,
    kind: "release-approval",
    product: "RIVET RIDGE RALLY",
    version: VERSION,
    ...decision,
    decision: roleDecision,
    supportingEvidence,
  };
}

function embeddedDocumentReference(filePath, document, extra = {}) {
  const contents = Buffer.from(`${JSON.stringify(document, null, 2)}\n`);
  return {
    path: filePath,
    bytes: contents.byteLength,
    sha256: sha256(contents),
    ...extra,
    document,
  };
}

const VISUAL_BASE_URL = "http://127.0.0.1:4373/";
const VISUAL_TRACKS = [
  { id: "canyon-kickoff", name: "Canyon Kickoff", midcourseDistance: 650 },
  { id: "pine-run", name: "Pine Run", midcourseDistance: 720 },
  { id: "coastline-clash", name: "Coastline Clash", midcourseDistance: 790 },
  { id: "foundry-flight", name: "Foundry Flight", midcourseDistance: 825 },
  { id: "summit-showdown", name: "Summit Showdown", midcourseDistance: 900 },
];

function untypedVisualRecord(record) {
  return {
    path: record.path,
    bytes: record.bytes,
    gzipBytes: record.gzipBytes,
    gzipSha256: record.gzipSha256,
    sha256: record.sha256,
  };
}

function visualCandidateManifest() {
  const files = [
    "THIRD_PARTY_NOTICES.txt",
    "assets/3d/hero-bike-rider.glb",
    "assets/art/canyon-festival-panorama.png",
    "assets/canyon/canyon-kit.glb",
    "assets/fonts/barlow-condensed-700-latin.woff2",
    "assets/fonts/barlow-condensed-900-latin.woff2",
    "assets/index-fixture.css",
    "assets/index-fixture.js",
    "assets/rivals/rival-pack.glb",
    "index.html",
    "sw.js",
  ].toSorted().map((filePath) => ({
    ...manifestRecord(filePath, Buffer.from(`visual fixture ${filePath}\n`)),
    type: "file",
  }));
  return {
    format: 1,
    kind: "visual-qa-candidate",
    product: "RIVET RIDGE RALLY",
    version: VERSION,
    source: {
      commit: VISUAL_CAPTURE_COMMIT,
      expectedVersionTag: PRODUCT_TAG,
      expectedVersionTagAtCommit: false,
      expectedVersionTagObject: null,
      expectedVersionTagObjectType: null,
      tagsAtCommit: [],
    },
    toolchain: {
      node: "26.4.0",
      nodeExecutableSha256: "1".repeat(64),
      npm: "11.17.0",
      npmCliSha256: "2".repeat(64),
      npmPackage: {
        treeFormat: 1,
        name: "npm",
        version: "11.17.0",
        cliRelativePath: "bin/npm-cli.js",
        packageJsonSha256: "4".repeat(64),
        directoryCount: 100,
        regularFileCount: 1_900,
        symlinkCount: 9,
        totalRegularFileBytes: 12_345_678,
        treeSha256: "5".repeat(64),
      },
      platform: "darwin",
      arch: "arm64",
      packageLockSha256: "3".repeat(64),
    },
    build: {
      source: "detached-clean-git-worktree",
      installCommand: "npm ci --no-audit --no-fund",
      buildCommand: "npm run build",
      viteQaMode: "1",
      npmConfig: "isolated-empty-user-and-global",
      installScripts: "enabled",
    },
    compression: { algorithm: "gzip", level: 9 },
    fileCount: files.length,
    totalBytes: files.reduce((sum, record) => sum + record.bytes, 0),
    totalGzipBytes: files.reduce((sum, record) => sum + record.gzipBytes, 0),
    aggregateSha256: aggregate(files),
    files,
  };
}

function visualInventory(candidateManifest) {
  return {
    directory: "dist",
    fileCount: candidateManifest.fileCount,
    totalBytes: candidateManifest.totalBytes,
    totalGzipBytes: candidateManifest.totalGzipBytes,
    aggregateSha256: candidateManifest.aggregateSha256,
    files: candidateManifest.files,
  };
}

function visualSourceIdentity() {
  return {
    commit: VISUAL_CAPTURE_COMMIT,
    dirty: false,
    dirtyEntryCount: 0,
    expectedTag: PRODUCT_TAG,
    expectedTagAnnotated: false,
    expectedTagAtCommit: false,
    expectedTagObjectType: null,
    packageVersion: VERSION,
    tagsAtCommit: [],
  };
}

function visualFreezeUrl(distance) {
  return `${VISUAL_BASE_URL}?qa-visual-freeze=1&qa-visual-distance=${distance}`;
}

function visualServedBuild(candidateManifest) {
  const files = candidateManifest.files.map(untypedVisualRecord);
  const indexRecord = files.find((record) => record.path === "index.html");
  return {
    verified: true,
    baseURL: VISUAL_BASE_URL,
    origin: "http://127.0.0.1:4373",
    entrypoint: {
      requestedURL: visualFreezeUrl(0),
      finalURL: visualFreezeUrl(0),
      bytes: indexRecord.bytes,
      sha256: indexRecord.sha256,
    },
    fileCount: candidateManifest.fileCount,
    totalBytes: candidateManifest.totalBytes,
    totalGzipBytes: candidateManifest.totalGzipBytes,
    aggregateSha256: candidateManifest.aggregateSha256,
    files,
  };
}

function visualResponseSet(candidateManifest, entry) {
  const recordByPath = new Map(candidateManifest.files.map((record) => [record.path, record]));
  const paths = [
    "index.html",
    "assets/3d/hero-bike-rider.glb",
    "assets/fonts/barlow-condensed-700-latin.woff2",
    "assets/fonts/barlow-condensed-900-latin.woff2",
    "assets/index-fixture.css",
    "assets/index-fixture.js",
    ...(entry.track.id === "canyon-kickoff"
      ? ["assets/canyon/canyon-kit.glb", "assets/art/canyon-festival-panorama.png"]
      : []),
    ...(entry.mode === "rival" ? ["assets/rivals/rival-pack.glb"] : []),
  ].toSorted();
  const occurrences = paths.map((filePath) => {
    const record = recordByPath.get(filePath);
    const url = filePath === "index.html"
      ? visualFreezeUrl(entry.distance)
      : `${VISUAL_BASE_URL}${filePath}`;
    return {
      manifestPath: filePath,
      requestedURL: url,
      finalURL: url,
      status: 200,
      fromServiceWorker: false,
      bytes: record.bytes,
      gzipBytes: record.gzipBytes,
      gzipSha256: record.gzipSha256,
      sha256: record.sha256,
    };
  });
  return {
    status: "PASS",
    candidateAggregateSha256: candidateManifest.aggregateSha256,
    serviceWorkersBlocked: true,
    cacheDisabled: true,
    finalOriginBound: true,
    responseBodiesBound: true,
    unexpectedResponses: [],
    occurrences,
    files: occurrences.map((record) => ({
      path: record.manifestPath,
      bytes: record.bytes,
      gzipBytes: record.gzipBytes,
      gzipSha256: record.gzipSha256,
      sha256: record.sha256,
    })),
    requestCount: occurrences.length,
  };
}

function visualReadiness(entry) {
  const isCanyon = entry.track.id === "canyon-kickoff";
  return {
    visualState: "frozen",
    bikeAsset: "ready",
    rivalPackAsset: entry.mode === "rival" ? "ready" : "not-applicable",
    canyonKitAsset: isCanyon ? "ready" : "not-applicable",
    environmentAsset: isCanyon ? "ready" : "not-applicable",
    canyonKitRootCount: isCanyon ? "11" : null,
    canyonKitPlacementCount: isCanyon ? "42" : null,
    canyonKitMeshCount: isCanyon ? "62" : null,
    canyonKitGameplayAuthority: isCanyon ? "presentation-only" : null,
    canyonKitProceduralReplacementCount: isCanyon ? "8" : null,
    canyonKitReplacedProceduralVisualCount: isCanyon ? "18" : null,
    canyonKitRetainedCoolingCueCount: isCanyon ? "12" : null,
    canyonKitTabletopRole: isCanyon ? "gameplay-ramp-shell" : null,
    visualDistance: entry.distance,
    ariaLabel: `Live 3D race on ${entry.track.name}`,
    raceHeading: `${entry.track.name} ${entry.mode === "practice" ? "Practice" : entry.mode} race`,
    runtimeBuild: { commit: VISUAL_CAPTURE_COMMIT, dirty: false },
  };
}

function visualCaptureManifest(candidateManifest, candidateReference, baseline) {
  const matrix = [
    ...VISUAL_TRACKS.map((track) => ({ track, phase: "start", mode: "practice", distance: 0 })),
    ...VISUAL_TRACKS.map((track) => ({
      track,
      phase: "midcourse",
      mode: "rival",
      distance: track.midcourseDistance,
    })),
    { track: VISUAL_TRACKS[0], phase: "curved-baseline-candidate", mode: "practice", distance: 500 },
  ];
  const captures = matrix.map((entry, index) => {
    const file = `${entry.phase}/${entry.track.id}-${entry.mode}-1280x720.png`;
    return {
      trackId: entry.track.id,
      trackName: entry.track.name,
      phase: entry.phase,
      project: "chromium",
      mode: entry.mode,
      distance: entry.distance,
      quality: "high",
      viewport: { width: 1_280, height: 720, deviceScaleFactor: 1 },
      state: {
        query: `?qa-visual-freeze=1&qa-visual-distance=${entry.distance}`,
        fastRace: false,
        highContrast: false,
        uiScale: 1,
      },
      file,
      bytes: file === VISUAL_CAPTURE_PATH ? baseline.bytes : index + 1,
      sha256: file === VISUAL_CAPTURE_PATH ? baseline.sha256 : sha256(Buffer.from(file)),
      readiness: visualReadiness(entry),
      responseSet: visualResponseSet(candidateManifest, entry),
      diagnostics: { consoleMessages: [], failedRequests: [], httpErrors: [] },
      error: null,
      status: "PASS",
    };
  });
  const source = visualSourceIdentity();
  const inventory = visualInventory(candidateManifest);
  const served = visualServedBuild(candidateManifest);
  const manifestProjection = {
    path: candidateReference.path,
    sha256: candidateReference.sha256,
    kind: candidateManifest.kind,
    format: candidateManifest.format,
    sourceCommit: VISUAL_CAPTURE_COMMIT,
    aggregateSha256: candidateManifest.aggregateSha256,
    fileCount: candidateManifest.fileCount,
    totalBytes: candidateManifest.totalBytes,
    totalGzipBytes: candidateManifest.totalGzipBytes,
  };
  const checks = [
    { id: "source-clean-before-and-after", passed: true, actual: { before: false, after: false } },
    { id: "source-identity-stable", passed: true, actual: { before: VISUAL_CAPTURE_COMMIT, after: VISUAL_CAPTURE_COMMIT } },
    { id: "source-matches-clean-qa-candidate", passed: true, actual: { candidate: VISUAL_CAPTURE_COMMIT, before: VISUAL_CAPTURE_COMMIT, after: VISUAL_CAPTURE_COMMIT } },
    { id: "candidate-version-matches-package", passed: true, actual: { candidate: VERSION, package: VERSION } },
    { id: "local-build-inventory-stable", passed: true, actual: { before: candidateManifest.aggregateSha256, after: candidateManifest.aggregateSha256 } },
    { id: "served-build-inventory-stable", passed: true, actual: { before: candidateManifest.aggregateSha256, after: candidateManifest.aggregateSha256 } },
    { id: "served-build-dedicated-loopback-bound", passed: true, actual: { baseURL: VISUAL_BASE_URL } },
    { id: "runtime-source-commit-bound", passed: true, actual: { sourceCommit: VISUAL_CAPTURE_COMMIT } },
    { id: "browser-response-bodies-manifest-bound", passed: true, actual: { captureCount: captures.length } },
    { id: "complete-capture-matrix", passed: true, actual: { expected: matrix.length, captured: captures.length } },
    { id: "rival-assets-ready", passed: true, actual: { captureCount: 5 } },
  ];
  return {
    schemaVersion: 3,
    kind: "five-track-controlled-visual-review",
    createdAt: "2026-07-16T12:01:00.000Z",
    appVersion: VERSION,
    candidate: {
      manifest: manifestProjection,
      sourceBefore: source,
      sourceAfter: source,
      localBuildBefore: inventory,
      localBuildAfter: inventory,
      servedBefore: served,
      servedAfter: served,
      checks,
      errors: [],
    },
    qaBuildRequired: true,
    baseURL: VISUAL_BASE_URL,
    server: {
      baseURL: VISUAL_BASE_URL,
      origin: "http://127.0.0.1:4373",
      protocol: "http:",
      host: "127.0.0.1",
      port: 4_373,
      verificationEntrypointURL: visualFreezeUrl(0),
      dedicatedLoopback: true,
      candidateManifestSha256: candidateReference.sha256,
    },
    browser: {
      name: "Chromium",
      version: "fixture",
      platform: "darwin",
      headless: true,
      serviceWorkers: "block",
      cache: "disabled",
    },
    viewport: { width: 1_280, height: 720, deviceScaleFactor: 1 },
    quality: "high",
    productionCourseScale: true,
    captures,
    status: "PASS",
  };
}

function visualBaselineApprovalRecord() {
  const baseline = {
    path: VISUAL_BASELINE_PATH,
    bytes: VISUAL_FIXTURE_PNG.byteLength,
    sha256: sha256(VISUAL_FIXTURE_PNG),
  };
  const candidateManifest = visualCandidateManifest();
  const candidateManifestReference = embeddedDocumentReference(
    "artifacts/candidate-evidence/visual/current/manifest.json",
    candidateManifest,
    { aggregateSha256: candidateManifest.aggregateSha256 },
  );
  const captureManifest = visualCaptureManifest(candidateManifest, candidateManifestReference, baseline);
  const captureManifestReference = embeddedDocumentReference(
    "artifacts/visual-review/approved-run/manifest.json",
    captureManifest,
  );
  const approvedCapture = captureManifest.captures.find((capture) => capture.file === VISUAL_CAPTURE_PATH);
  return {
    schemaVersion: 2,
    kind: "rivet-ridge-rally-visual-baseline-approval-record",
    authentication: "external-manual-trust-boundary",
    ownerApproval: {
      schemaVersion: 1,
      kind: "rivet-ridge-rally-visual-baseline-owner-approval",
      authentication: "external-manual-trust-boundary",
      decision: "ACCEPT",
      approvedAt: "2026-07-16T12:01:15.000Z",
      reviewer: { name: "Alex Rivera", role: "product-owner" },
      statement: "I reviewed the exact Canyon Practice 500 capture against the approved concept art and accept it as the checked-in visual regression baseline.",
      candidate: {
        commit: VISUAL_CAPTURE_COMMIT,
        aggregateSha256: candidateManifest.aggregateSha256,
        captureManifestSha256: captureManifestReference.sha256,
      },
      screenshot: {
        path: VISUAL_CAPTURE_PATH,
        bytes: baseline.bytes,
        sha256: baseline.sha256,
        project: "chromium",
        mode: "practice",
        trackId: "canyon-kickoff",
        distance: 500,
        quality: "high",
        viewport: { width: 1_280, height: 720, deviceScaleFactor: 1 },
        readiness: {
          visualState: approvedCapture.readiness.visualState,
          bikeAsset: approvedCapture.readiness.bikeAsset,
          canyonKitAsset: approvedCapture.readiness.canyonKitAsset,
          environmentAsset: approvedCapture.readiness.environmentAsset,
          visualDistance: approvedCapture.readiness.visualDistance,
          ariaLabel: approvedCapture.readiness.ariaLabel,
          runtimeBuild: approvedCapture.readiness.runtimeBuild,
        },
      },
    },
    evidence: {
      captureManifest: captureManifestReference,
      candidateManifest: candidateManifestReference,
    },
    promotedBaseline: baseline,
  };
}

function qaReportContents(manifest, {
  overallStatus = "PASS",
  releaseDecision = "READY",
  markerOverrides = {},
} = {}) {
  const marker = {
    schemaVersion: 1,
    kind: "release-qa-readiness",
    product: "RIVET RIDGE RALLY",
    version: VERSION,
    status: "READY",
    productTag: PRODUCT_TAG,
    productCommit: PRODUCT_COMMIT,
    manifestAggregateSha256: manifest.aggregateSha256,
    openP0: 0,
    openP1: 0,
    ...markerOverrides,
  };
  return `# QA\n\n**Overall code-owned QA status:** ${overallStatus}\n\n**Release decision:** ${releaseDecision}\n\n<!-- release-qa-readiness ${JSON.stringify(marker)} -->\n`;
}

function launchReadinessContents(manifest, {
  decisionHeading = "READY",
  codeOwnedStatus = "PASS",
  commercialStatus = "READY",
  finalStatus = "READY",
  markerOverrides = {},
} = {}) {
  const marker = {
    schemaVersion: 1,
    kind: "release-launch-readiness",
    product: "RIVET RIDGE RALLY",
    version: VERSION,
    status: "READY",
    productTag: PRODUCT_TAG,
    productCommit: PRODUCT_COMMIT,
    manifestAggregateSha256: manifest.aggregateSha256,
    openP0: 0,
    openP1: 0,
    ...markerOverrides,
  };
  return `# RIVET RIDGE RALLY — Launch Readiness\n\n# ${decisionHeading}\n\n**Code-owned gate status:** ${codeOwnedStatus}\n\n**Commercial readiness status:** ${commercialStatus}\n\n**Current final status: ${finalStatus}.**\n\n<!-- release-launch-readiness ${JSON.stringify(marker)} -->\n`;
}

function rollbackRetrievalEvidence(previousManifest, manifestReference, locator) {
  return {
    schemaVersion: 1,
    kind: "rollback-retrieval",
    product: "RIVET RIDGE RALLY",
    version: ROLLBACK_TAG.slice(1),
    status: "PASS",
    releaseTag: ROLLBACK_TAG,
    releaseCommit: ROLLBACK_COMMIT,
    releaseTagObject: ROLLBACK_TAG_OBJECT,
    artifactLocator: locator,
    artifactManifestSha256: manifestReference.sha256,
    artifactAggregateSha256: previousManifest.aggregateSha256,
    archiveBytes: ROLLBACK_ARCHIVE_BYTES,
    archiveSha256: ROLLBACK_ARCHIVE_SHA256,
    retrievedBy: "Release operator",
    retrievedAt: "2026-07-16T12:05:00.000Z",
  };
}

function rollbackDataSafetyEvidence(previousManifest) {
  return {
    schemaVersion: 1,
    kind: "rollback-data-safety",
    product: "RIVET RIDGE RALLY",
    version: ROLLBACK_TAG.slice(1),
    status: "PASS",
    releaseTag: ROLLBACK_TAG,
    releaseCommit: ROLLBACK_COMMIT,
    releaseTagObject: ROLLBACK_TAG_OBJECT,
    artifactAggregateSha256: previousManifest.aggregateSha256,
    stagedBaseURL: ROLLBACK_STAGED_BASE_URL,
    sourceNativeIndexedDbVersion: 60,
    rollbackNativeIndexedDbVersion: 30,
    outcome: "non-destructive-incompatibility",
    siteDataCleared: false,
    destructiveRecoveryUsed: false,
    localSaveReadPassed: false,
    incompatibilityMessageVisible: true,
    progressRecordsBefore: 1,
    progressRecordsAfter: 1,
    customTracksBefore: 2,
    customTracksAfter: 2,
    replaysBefore: 3,
    replaysAfter: 3,
    snapshotSha256Before: "9".repeat(64),
    snapshotSha256After: "9".repeat(64),
    testedBy: "Release operator",
    testedAt: "2026-07-16T12:06:00.000Z",
  };
}

function rollbackSmokeEvidence(previousManifest, manifestReference, locator, dataSafetyReference) {
  return {
    schemaVersion: 1,
    kind: "rollback-smoke",
    product: "RIVET RIDGE RALLY",
    version: ROLLBACK_TAG.slice(1),
    status: "PASS",
    releaseTag: ROLLBACK_TAG,
    releaseCommit: ROLLBACK_COMMIT,
    releaseTagObject: ROLLBACK_TAG_OBJECT,
    artifactLocator: locator,
    artifactManifestSha256: manifestReference.sha256,
    artifactAggregateSha256: previousManifest.aggregateSha256,
    archiveBytes: ROLLBACK_ARCHIVE_BYTES,
    archiveSha256: ROLLBACK_ARCHIVE_SHA256,
    stagedBaseURL: ROLLBACK_STAGED_BASE_URL,
    servedBefore: servedEvidence(previousManifest, ROLLBACK_STAGED_BASE_URL),
    servedAfter: servedEvidence(previousManifest, ROLLBACK_STAGED_BASE_URL),
    dataSafetyEvidence: dataSafetyReference,
    steps: [
      "artifact-retrieved",
      "database-precondition-native-v60",
      "format-2-manifest-validated",
      "boot-and-version",
      "local-save-read-or-nondestructive-block",
      "progress-track-replay-preservation",
      "race-start-and-restart",
      "offline-service-worker-reload",
    ],
    network: { failedRequests: [], httpErrors: [] },
    console: { unexpected: [] },
    smokeError: null,
    testedBy: "Release operator",
    testedAt: "2026-07-16T12:06:00.000Z",
  };
}

function fakeGit(overrides = {}) {
  return async (argumentsList) => {
    const command = argumentsList.join(" ");
    if (command in overrides) {
      const override = overrides[command];
      if (override instanceof Error) throw override;
      return override;
    }
    if (command === "status --porcelain=v1 --untracked-files=all") return "";
    if (command.startsWith("ls-files --error-unmatch -- ")) return command.slice("ls-files --error-unmatch -- ".length);
    if (command === "rev-parse HEAD^{commit}") return EVIDENCE_COMMIT;
    if (command === `merge-base --is-ancestor ${PRODUCT_COMMIT} ${EVIDENCE_COMMIT}`) return "";
    if (command === `diff --name-only -z --diff-filter=AM ${PRODUCT_COMMIT}..${EVIDENCE_COMMIT} --`) return `${ATTESTATION_PATH}\0`;
    if (command === `diff --name-only -z --diff-filter=CDRTUXB ${PRODUCT_COMMIT}..${EVIDENCE_COMMIT} --`) return "";
    if (command === `merge-base --is-ancestor ${VISUAL_CAPTURE_COMMIT} ${PRODUCT_COMMIT}`) return "";
    if (command === `diff --name-only -z --diff-filter=AM ${VISUAL_CAPTURE_COMMIT}..${PRODUCT_COMMIT} --`) {
      return `${VISUAL_BASELINE_APPROVAL_PATH}\0${VISUAL_BASELINE_PATH}\0`;
    }
    if (command === `diff --name-only -z --diff-filter=CDRTUXB ${VISUAL_CAPTURE_COMMIT}..${PRODUCT_COMMIT} --`) return "";
    if (command === `rev-parse refs/tags/attestation/${PRODUCT_TAG}`) return ATTESTATION_TAG_OBJECT;
    if (command === `cat-file -t ${ATTESTATION_TAG_OBJECT}`) return "tag";
    if (command === `rev-parse ${ATTESTATION_TAG_OBJECT}^{commit}`) return EVIDENCE_COMMIT;
    if (command === `rev-parse refs/tags/${PRODUCT_TAG}`) return PRODUCT_TAG_OBJECT;
    if (command === `cat-file -t ${PRODUCT_TAG_OBJECT}`) return "tag";
    if (command === `rev-parse ${PRODUCT_TAG_OBJECT}^{commit}`) return PRODUCT_COMMIT;
    if (command === `rev-parse refs/tags/${ROLLBACK_TAG}`) return ROLLBACK_TAG_OBJECT;
    if (command === `cat-file -t ${ROLLBACK_TAG_OBJECT}`) return "tag";
    if (command === `rev-parse ${ROLLBACK_TAG_OBJECT}^{commit}`) return ROLLBACK_COMMIT;
    throw new Error(`Unexpected Git command: ${command}`);
  };
}

async function buildFixture() {
  const root = await mkdtemp(path.join(tmpdir(), "rrr-attestation-test-"));
  const manifest = releaseManifest();
  const manifestReference = await writeFixtureFile(
    root,
    `artifacts/history/release-manifest-${VERSION}-format-2.json`,
    manifest,
  );
  const evidenceRoot = `artifacts/release-attestations/${PRODUCT_TAG}-evidence`;
  const performancePath = `${evidenceRoot}/performance/headed-measurement.json`;
  const soakPath = `${evidenceRoot}/performance/30m-soak.json`;
  const smokeDirectory = `artifacts/production-smoke/candidates/${manifestReference.sha256}/runs/fixture`;
  const performanceReference = await writeFixtureFile(root, performancePath, performanceEvidence(manifest));
  const soakReference = await writeFixtureFile(root, soakPath, soakEvidence(manifest));
  const qaCheckReferences = {};
  for (const [check, requiredCommands] of Object.entries(MANDATORY_QA_CHECKS)) {
    const commands = [];
    for (const [index, command] of requiredCommands.entries()) {
      const output = await writeFixtureFile(
        root,
        `${evidenceRoot}/qa/logs/${check}-${index + 1}.txt`,
        `${command}\nexitCode=0\nstatus=PASS\n`,
      );
      commands.push({
        command,
        startedAt: "2026-07-16T11:50:00.000Z",
        completedAt: "2026-07-16T11:55:00.000Z",
        exitCode: 0,
        status: "PASS",
        output,
      });
    }
    qaCheckReferences[check] = await writeFixtureFile(
      root,
      `${evidenceRoot}/qa/${check}.json`,
      {
        schemaVersion: 1,
        kind: "release-qa-check",
        product: "RIVET RIDGE RALLY",
        version: VERSION,
        status: "PASS",
        check,
        productTag: PRODUCT_TAG,
        productCommit: PRODUCT_COMMIT,
        manifestAggregateSha256: manifest.aggregateSha256,
        createdAt: "2026-07-16T11:56:00.000Z",
        commands,
      },
    );
  }

  const screenshotNames = [
    "chrome-editor.png",
    "chrome-offline-race.png",
    "chrome-offline-title.png",
    "chrome-race.png",
  ];
  const screenshotRecords = [];
  for (const name of screenshotNames) {
    const reference = await writeFixtureFile(root, `${smokeDirectory}/${name}`, FIXTURE_PNG);
    screenshotRecords.push({ path: name, bytes: reference.bytes, sha256: reference.sha256 });
  }
  const smokePath = `${smokeDirectory}/chrome-smoke.json`;
  const smokeReference = await writeFixtureFile(
    root,
    smokePath,
    smokeEvidence(manifest, manifestReference, screenshotRecords),
  );

  const qaSupport = await writeFixtureFile(
    root,
    "QA_REPORT.md",
    qaReportContents(manifest),
  );
  const launchReadinessSupport = await writeFixtureFile(
    root,
    "LAUNCH_READINESS.md",
    launchReadinessContents(manifest),
  );
  const visualBaselineSupport = await writeFixtureFile(
    root,
    VISUAL_BASELINE_PATH,
    VISUAL_FIXTURE_PNG,
  );
  const visualApprovalSupport = await writeFixtureFile(
    root,
    VISUAL_BASELINE_APPROVAL_PATH,
    visualBaselineApprovalRecord(),
  );
  const accessibilitySupport = await writeFixtureFile(
    root,
    `${evidenceRoot}/approvals/support/accessibility-review.md`,
    "Accessibility review passed.\n",
  );
  const legalSupport = await writeFixtureFile(
    root,
    `${evidenceRoot}/approvals/support/legal-review.md`,
    "Legal review passed.\n",
  );
  const approvalDecisions = {
    qa: approvalFields("qa", manifest, "2026-07-16T12:03:00.000Z"),
    accessibility: approvalFields("accessibility", manifest, "2026-07-16T12:04:00.000Z"),
    legal: approvalFields("legal", manifest, "2026-07-16T12:05:00.000Z"),
  };
  const approvalRecords = {
    qa: approvalEvidence(
      "qa",
      manifest,
      approvalDecisions.qa,
      [qaSupport, launchReadinessSupport, visualApprovalSupport, visualBaselineSupport],
    ),
    accessibility: approvalEvidence("accessibility", manifest, approvalDecisions.accessibility, [accessibilitySupport]),
    legal: approvalEvidence("legal", manifest, approvalDecisions.legal, [legalSupport]),
  };
  const approvalReferences = {};
  for (const role of Object.keys(approvalRecords)) {
    approvalReferences[role] = await writeFixtureFile(
      root,
      `${evidenceRoot}/approvals/${role}.json`,
      approvalRecords[role],
    );
  }

  const previousManifest = releaseManifest({
    version: ROLLBACK_TAG.slice(1),
    commit: ROLLBACK_COMMIT,
    tag: ROLLBACK_TAG,
    tagObject: ROLLBACK_TAG_OBJECT,
    suffix: "rollback",
  });
  const rollbackManifestPath = `artifacts/history/release-manifest-${ROLLBACK_TAG.slice(1)}-format-2.json`;
  const rollbackManifestReference = await writeFixtureFile(root, rollbackManifestPath, previousManifest);
  const locator = `s3://release-archive/rivet-ridge-rally/sha256/${previousManifest.aggregateSha256}/bundle.tar.zst`;
  const retrievalPath = `${evidenceRoot}/rollback/retrieval.json`;
  const rollbackSmokePath = `${evidenceRoot}/rollback/smoke.json`;
  const rollbackDataSafetyPath = `${evidenceRoot}/rollback/data-safety.json`;
  const retrievalReference = await writeFixtureFile(
    root,
    retrievalPath,
    rollbackRetrievalEvidence(previousManifest, rollbackManifestReference, locator),
  );
  const rollbackDataSafetyReference = await writeFixtureFile(
    root,
    rollbackDataSafetyPath,
    rollbackDataSafetyEvidence(previousManifest),
  );
  const rollbackSmokeReference = await writeFixtureFile(
    root,
    rollbackSmokePath,
    rollbackSmokeEvidence(previousManifest, rollbackManifestReference, locator, rollbackDataSafetyReference),
  );

  const attestation = {
    schemaVersion: 3,
    kind: "release-attestation",
    product: "RIVET RIDGE RALLY",
    version: VERSION,
    createdAt: "2026-07-16T13:00:00.000Z",
    productRelease: {
      tag: PRODUCT_TAG,
      commit: PRODUCT_COMMIT,
      tagObject: PRODUCT_TAG_OBJECT,
      manifest: { ...manifestReference, aggregateSha256: manifest.aggregateSha256 },
    },
    evidence: {
      headedPerformance: performanceReference,
      soak: soakReference,
      productionSmoke: smokeReference,
      qaChecks: qaCheckReferences,
    },
    approvals: Object.fromEntries(Object.keys(approvalDecisions).map((role) => [
      role,
      { ...approvalDecisions[role], evidence: approvalReferences[role] },
    ])),
    rollback: {
      status: "VERIFIED",
      releaseTag: ROLLBACK_TAG,
      releaseCommit: ROLLBACK_COMMIT,
      releaseTagObject: ROLLBACK_TAG_OBJECT,
      artifactLocator: locator,
      artifactAggregateSha256: previousManifest.aggregateSha256,
      archiveBytes: ROLLBACK_ARCHIVE_BYTES,
      archiveSha256: ROLLBACK_ARCHIVE_SHA256,
      artifactManifest: rollbackManifestReference,
      retrievalEvidence: retrievalReference,
      smokeEvidence: rollbackSmokeReference,
      verifiedBy: "Release operator",
      verifiedAt: "2026-07-16T12:07:00.000Z",
    },
  };
  await writeFixtureFile(root, ATTESTATION_PATH, attestation);

  return {
    root,
    manifest,
    previousManifest,
    attestation,
    attestationPath: ATTESTATION_PATH,
    approvalRecords,
    rollbackDataSafetyReference,
    paths: {
      performancePath,
      soakPath,
      smokePath,
      smokeDirectory,
      rollbackManifestPath,
      retrievalPath,
      rollbackSmokePath,
      rollbackDataSafetyPath,
    },
    async writeAttestation() {
      await writeFixtureFile(root, ATTESTATION_PATH, attestation);
    },
    async replaceEvidence(field, filePath, value) {
      attestation.evidence[field] = await writeFixtureFile(root, filePath, value);
      await this.writeAttestation();
    },
    async replaceApprovalRecord(role, value) {
      approvalRecords[role] = value;
      attestation.approvals[role].evidence = await writeFixtureFile(
        root,
        `${evidenceRoot}/approvals/${role}.json`,
        value,
      );
      await this.writeAttestation();
    },
    async setApprovalField(role, field, value) {
      attestation.approvals[role][field] = value;
      approvalRecords[role][field] = value;
      await this.replaceApprovalRecord(role, approvalRecords[role]);
    },
    async replaceQaReport(contents) {
      const reference = await writeFixtureFile(root, "QA_REPORT.md", contents);
      approvalRecords.qa.supportingEvidence = approvalRecords.qa.supportingEvidence.map((entry) =>
        entry.path === "QA_REPORT.md" ? reference : entry);
      await this.replaceApprovalRecord("qa", approvalRecords.qa);
    },
    async replaceLaunchReadiness(contents) {
      const reference = await writeFixtureFile(root, "LAUNCH_READINESS.md", contents);
      approvalRecords.qa.supportingEvidence = approvalRecords.qa.supportingEvidence.map((entry) =>
        entry.path === "LAUNCH_READINESS.md" ? reference : entry);
      await this.replaceApprovalRecord("qa", approvalRecords.qa);
    },
    async replaceRollbackEvidence(field, filePath, value) {
      attestation.rollback[field] = await writeFixtureFile(root, filePath, value);
      await this.writeAttestation();
    },
  };
}

test("producer-facing release validation rejects nonqualifying settings and unsafe output paths", () => {
  const manifest = releaseManifest();
  const productRelease = { commit: PRODUCT_COMMIT, tag: PRODUCT_TAG };
  const serializedSoakEvidence = () => JSON.parse(JSON.stringify(soakEvidence(manifest)));
  assert.doesNotThrow(() => validatePerformanceEvidence(
    performanceEvidence(manifest),
    productRelease,
    VERSION,
    manifest,
  ));
  assert.doesNotThrow(() => validateSoakEvidence(
    serializedSoakEvidence(),
    productRelease,
    VERSION,
    manifest,
  ));

  const shortPerformance = performanceEvidence(manifest);
  shortPerformance.configuration.sampleSeconds = 4;
  assert.throws(
    () => validatePerformanceEvidence(shortPerformance, productRelease, VERSION, manifest),
    /sample duration does not match/u,
  );
  const overriddenPerformance = performanceEvidence(manifest);
  overriddenPerformance.configuration.qualityPolicy = { type: "explicit-override", value: "high" };
  assert.throws(
    () => validatePerformanceEvidence(overriddenPerformance, productRelease, VERSION, manifest),
    /qualityPolicy does not match/u,
  );
  const sparseSoak = serializedSoakEvidence();
  sparseSoak.configuration.sampleIntervalSeconds = 31;
  assert.throws(
    () => validateSoakEvidence(sparseSoak, productRelease, VERSION, manifest),
    /sampleIntervalSeconds/u,
  );
  const wrongQualitySoak = serializedSoakEvidence();
  wrongQualitySoak.configuration.quality = performanceQuality("medium");
  assert.throws(
    () => validateSoakEvidence(wrongQualitySoak, productRelease, VERSION, manifest),
    /quality does not match/u,
  );
  const headlessSoak = serializedSoakEvidence();
  headlessSoak.browser.headless = true;
  assert.throws(
    () => validateSoakEvidence(headlessSoak, productRelease, VERSION, manifest),
    /headed Chromium build/u,
  );
  const softwareRenderedSoak = serializedSoakEvidence();
  softwareRenderedSoak.device.webgl.renderer = "ANGLE (Google, Vulkan, SwiftShader Device)";
  assert.throws(
    () => validateSoakEvidence(softwareRenderedSoak, productRelease, VERSION, manifest),
    /hardware-backed WebGL/u,
  );

  assert.match(
    assertPerformanceEvidenceOutputPath(
      `artifacts/candidate-evidence/${PRODUCT_COMMIT}/performance/headed-measurement.json`,
    ),
    /artifacts\/candidate-evidence\/.+\/headed-measurement\.json$/u,
  );
  assert.match(
    assertPerformanceEvidenceDirectoryPath("artifacts/candidate-evidence/diagnostic/performance/screenshots"),
    /artifacts\/candidate-evidence\/diagnostic\/performance\/screenshots$/u,
  );
  for (const unsafePath of [
    "artifacts/performance/latest-measurement.json",
    "/tmp/performance.json",
    "artifacts/candidate-evidence/../performance.json",
    "artifacts/candidate-evidence\\performance.json",
    "artifacts/candidate-evidence-other/performance.json",
    "artifacts/candidate-evidence/diagnostic/performance.txt",
  ]) {
    assert.throws(() => assertPerformanceEvidenceOutputPath(unsafePath));
  }
});

test("accepts one clean annotated product/evidence chain with passing mandatory evidence", async (context) => {
  const fixture = await buildFixture();
  context.after(() => rm(fixture.root, { recursive: true, force: true }));

  const result = await verifyReleaseAttestation(fixture.attestationPath, {
    root: fixture.root,
    git: fakeGit(),
  });

  assert.equal(result.version, VERSION);
  assert.equal(result.productCommit, PRODUCT_COMMIT);
  assert.equal(result.rollbackTag, ROLLBACK_TAG);
  assert.equal(result.evidenceCommit, EVIDENCE_COMMIT);
});

test("schema rejects unknown fields", () => {
  const minimal = {
    schemaVersion: 3,
    kind: "release-attestation",
    product: "RIVET RIDGE RALLY",
    version: VERSION,
    createdAt: "2026-07-16T13:00:00.000Z",
    productRelease: {},
    evidence: {},
    approvals: {},
    rollback: {},
    unexpected: true,
  };
  assert.throws(() => validateReleaseAttestation(minimal), /root keys must be exactly/);
});

test("schema rejects a pending human decision", async (context) => {
  const fixture = await buildFixture();
  context.after(() => rm(fixture.root, { recursive: true, force: true }));
  fixture.attestation.approvals.legal.status = "PENDING";

  assert.throws(
    () => validateReleaseAttestation(fixture.attestation),
    /approvals.legal.status must be APPROVED/,
  );
});

test("rejects evidence bytes changed after attestation", async (context) => {
  const fixture = await buildFixture();
  context.after(() => rm(fixture.root, { recursive: true, force: true }));
  await writeFile(path.join(fixture.root, fixture.paths.performancePath), "tampered\n");

  await assert.rejects(
    verifyReleaseAttestation(fixture.attestationPath, { root: fixture.root, git: fakeGit() }),
    /headed performance evidence byte count does not match/,
  );
});

test("rejects a hash-updated but headless performance record", async (context) => {
  const fixture = await buildFixture();
  context.after(() => rm(fixture.root, { recursive: true, force: true }));
  const evidence = performanceEvidence(fixture.manifest);
  evidence.browser.headless = true;
  await fixture.replaceEvidence("headedPerformance", fixture.paths.performancePath, evidence);

  await assert.rejects(
    verifyReleaseAttestation(fixture.attestationPath, { root: fixture.root, git: fakeGit() }),
    /headed performance must identify a headed Chromium build/,
  );
});

test("rejects performance evidence with missing restart timing", async (context) => {
  const fixture = await buildFixture();
  context.after(() => rm(fixture.root, { recursive: true, force: true }));
  const evidence = performanceEvidence(fixture.manifest);
  delete evidence.profiles[0].restartMs;
  await fixture.replaceEvidence("headedPerformance", fixture.paths.performancePath, evidence);

  await assert.rejects(
    verifyReleaseAttestation(fixture.attestationPath, { root: fixture.root, git: fakeGit() }),
    /headed performance profile desktop-1920x1080 keys must be exactly/,
  );
});

test("rejects performance evidence measured with a hero fallback", async (context) => {
  const fixture = await buildFixture();
  context.after(() => rm(fixture.root, { recursive: true, force: true }));
  const evidence = performanceEvidence(fixture.manifest);
  evidence.profiles[0].authoredHero.bikeAsset = "fallback";
  evidence.profiles[0].authoredHero.fallbackReason = "load-failed";
  evidence.profiles[0].authoredHero.root = null;
  await fixture.replaceEvidence("headedPerformance", fixture.paths.performancePath, evidence);

  await assert.rejects(
    verifyReleaseAttestation(fixture.attestationPath, { root: fixture.root, git: fakeGit() }),
    /authoredHero does not prove the authored hero was ready without fallback/,
  );
});

test("rejects performance duration that disagrees with completion chronology", async (context) => {
  const fixture = await buildFixture();
  context.after(() => rm(fixture.root, { recursive: true, force: true }));
  const evidence = performanceEvidence(fixture.manifest);
  evidence.durationMs = 1;
  await fixture.replaceEvidence("headedPerformance", fixture.paths.performancePath, evidence);

  await assert.rejects(
    verifyReleaseAttestation(fixture.attestationPath, { root: fixture.root, git: fakeGit() }),
    /headed performance durationMs does not match the recorded start\/completion chronology/,
  );
});

test("rejects unknown fields in schema-4 performance evidence", async (context) => {
  const fixture = await buildFixture();
  context.after(() => rm(fixture.root, { recursive: true, force: true }));
  const evidence = performanceEvidence(fixture.manifest);
  evidence.unattested = true;
  await fixture.replaceEvidence("headedPerformance", fixture.paths.performancePath, evidence);

  await assert.rejects(
    verifyReleaseAttestation(fixture.attestationPath, { root: fixture.root, git: fakeGit() }),
    /headed performance evidence keys must be exactly/,
  );
});

test("rejects performance and soak records that agree with each other but not the manifest", async (context) => {
  const fixture = await buildFixture();
  context.after(() => rm(fixture.root, { recursive: true, force: true }));
  const unboundAggregate = "4".repeat(64);
  for (const [field, filePath, evidence] of [
    ["headedPerformance", fixture.paths.performancePath, performanceEvidence(fixture.manifest)],
    ["soak", fixture.paths.soakPath, soakEvidence(fixture.manifest)],
  ]) {
    evidence.candidate.localBuild.aggregateSha256 = unboundAggregate;
    evidence.candidate.servedBefore.aggregateSha256 = unboundAggregate;
    evidence.candidate.servedAfter.aggregateSha256 = unboundAggregate;
    await fixture.replaceEvidence(field, filePath, evidence);
  }

  await assert.rejects(
    verifyReleaseAttestation(fixture.attestationPath, { root: fixture.root, git: fakeGit() }),
    /aggregate does not match the release manifest/,
  );
});

test("rejects a performance gzip record that is not bound to the release manifest", async (context) => {
  const fixture = await buildFixture();
  context.after(() => rm(fixture.root, { recursive: true, force: true }));
  const evidence = performanceEvidence(fixture.manifest);
  evidence.candidate.localBuild.files[0].gzipSha256 = "8".repeat(64);
  await fixture.replaceEvidence("headedPerformance", fixture.paths.performancePath, evidence);

  await assert.rejects(
    verifyReleaseAttestation(fixture.attestationPath, { root: fixture.root, git: fakeGit() }),
    /does not match the release manifest for THIRD_PARTY_NOTICES\.txt/,
  );
});

test("rejects a passing render summary that does not match its raw samples", async (context) => {
  const fixture = await buildFixture();
  context.after(() => rm(fixture.root, { recursive: true, force: true }));
  const evidence = performanceEvidence(fixture.manifest);
  evidence.profiles[0].rendering.fps.mean = 99;
  await fixture.replaceEvidence("headedPerformance", fixture.paths.performancePath, evidence);

  await assert.rejects(
    verifyReleaseAttestation(fixture.attestationPath, { root: fixture.root, git: fakeGit() }),
    /rendering\.fps does not match recomputed evidence/,
  );
});

test("rejects a named mobile profile recorded at the desktop viewport", async (context) => {
  const fixture = await buildFixture();
  context.after(() => rm(fixture.root, { recursive: true, force: true }));
  const evidence = performanceEvidence(fixture.manifest);
  evidence.profiles[1].viewport = { width: 1_920, height: 1_080 };
  await fixture.replaceEvidence("headedPerformance", fixture.paths.performancePath, evidence);

  await assert.rejects(
    verifyReleaseAttestation(fixture.attestationPath, { root: fixture.root, git: fakeGit() }),
    /mobile-390x844\.viewport does not match recomputed evidence/,
  );
});

test("rejects a performance profile whose selected quality does not match its identity", async (context) => {
  const fixture = await buildFixture();
  context.after(() => rm(fixture.root, { recursive: true, force: true }));
  const evidence = performanceEvidence(fixture.manifest);
  evidence.profiles[1].quality.selected = "medium";
  await fixture.replaceEvidence("headedPerformance", fixture.paths.performancePath, evidence);

  await assert.rejects(
    verifyReleaseAttestation(fixture.attestationPath, { root: fixture.root, git: fakeGit() }),
    /mobile-390x844\.quality does not match the required explicit quality/,
  );
});

test("rejects passing-labelled performance evidence whose measured FPS misses the fixed threshold", async (context) => {
  const fixture = await buildFixture();
  context.after(() => rm(fixture.root, { recursive: true, force: true }));
  const evidence = performanceEvidence(fixture.manifest);
  const frameWork = evidence.profiles[0].rendering.frameWork;
  const originalLastFrame = frameWork.samples.at(-1);
  frameWork.samples = frameWork.samples.filter((_, index) => index % 2 === 0);
  if (frameWork.samples.at(-1).elapsedMs !== 5_000) {
    frameWork.samples.push(originalLastFrame);
  }
  frameWork.sampleCount = frameWork.samples.length;
  frameWork.meanFps = roundMetric(
    (frameWork.samples.length - 1)
      / ((frameWork.samples.at(-1).frameTimestampMs - frameWork.samples[0].frameTimestampMs) / 1_000),
  );
  frameWork.frameWorkMs = summarizeMetric(frameWork.samples.map((sample) => sample.frameWorkMs));
  await fixture.replaceEvidence("headedPerformance", fixture.paths.performancePath, evidence);

  await assert.rejects(
    verifyReleaseAttestation(fixture.attestationPath, { root: fixture.root, git: fakeGit() }),
    /recomputed raw meanFps is below its minimum/,
  );
});

test("rejects duplicate performance profiles even when every criterion says PASS", async (context) => {
  const fixture = await buildFixture();
  context.after(() => rm(fixture.root, { recursive: true, force: true }));
  const evidence = performanceEvidence(fixture.manifest);
  evidence.profiles[1] = structuredClone(evidence.profiles[0]);
  await fixture.replaceEvidence("headedPerformance", fixture.paths.performancePath, evidence);

  await assert.rejects(
    verifyReleaseAttestation(fixture.attestationPath, { root: fixture.root, git: fakeGit() }),
    /profile set does not match the release contract/,
  );
});

test("rejects a passing-labelled soak shorter than 30 active minutes", async (context) => {
  const fixture = await buildFixture();
  context.after(() => rm(fixture.root, { recursive: true, force: true }));
  const evidence = soakEvidence(fixture.manifest);
  evidence.workloadDurationMs = 1_799_999;
  evidence.racingClock.durationMs = 1_799_999;
  evidence.racingClock.transitions.at(-1).elapsedMs = 1_260_001;
  await fixture.replaceEvidence("soak", fixture.paths.soakPath, evidence);

  await assert.rejects(
    verifyReleaseAttestation(fixture.attestationPath, { root: fixture.root, git: fakeGit() }),
    /soak active workload is under 30 minutes/,
  );
});

test("rejects soak restart summaries that do not recompute from raw timings", async (context) => {
  const fixture = await buildFixture();
  context.after(() => rm(fixture.root, { recursive: true, force: true }));
  const evidence = soakEvidence(fixture.manifest);
  evidence.restartSummaryMs.mean += 1;
  await fixture.replaceEvidence("soak", fixture.paths.soakPath, evidence);

  await assert.rejects(
    verifyReleaseAttestation(fixture.attestationPath, { root: fixture.root, git: fakeGit() }),
    /soak restartSummaryMs does not match recomputed evidence/,
  );
});

test("rejects soak evidence with missing fixed-step attempt records", async (context) => {
  const fixture = await buildFixture();
  context.after(() => rm(fixture.root, { recursive: true, force: true }));
  const evidence = soakEvidence(fixture.manifest);
  evidence.fixedStepTiming.attempts.pop();
  await fixture.replaceEvidence("soak", fixture.paths.soakPath, evidence);

  await assert.rejects(
    verifyReleaseAttestation(fixture.attestationPath, { root: fixture.root, git: fakeGit() }),
    /soak fixedStepTiming\.attempts must contain each completed race and one terminal deadline attempt/,
  );
});

test("rejects soak evidence without its diagnostic gate", async (context) => {
  const fixture = await buildFixture();
  context.after(() => rm(fixture.root, { recursive: true, force: true }));
  const evidence = soakEvidence(fixture.manifest);
  delete evidence.diagnosticGate;
  await fixture.replaceEvidence("soak", fixture.paths.soakPath, evidence);

  await assert.rejects(
    verifyReleaseAttestation(fixture.attestationPath, { root: fixture.root, git: fakeGit() }),
    /soak evidence keys must be exactly/,
  );
});

test("rejects a soak whose racing clock begins outside the racing state", async (context) => {
  const fixture = await buildFixture();
  context.after(() => rm(fixture.root, { recursive: true, force: true }));
  const evidence = soakEvidence(fixture.manifest);
  evidence.racingClock.transitions[0].racing = false;
  await fixture.replaceEvidence("soak", fixture.paths.soakPath, evidence);

  await assert.rejects(
    verifyReleaseAttestation(fixture.attestationPath, { root: fixture.root, git: fakeGit() }),
    /soak racingClock first transition must begin in racing state/,
  );
});

test("rejects coercible string soak durations", async (context) => {
  const fixture = await buildFixture();
  context.after(() => rm(fixture.root, { recursive: true, force: true }));
  const evidence = soakEvidence(fixture.manifest);
  evidence.configuration.minutes = "30";
  await fixture.replaceEvidence("soak", fixture.paths.soakPath, evidence);

  await assert.rejects(
    verifyReleaseAttestation(fixture.attestationPath, { root: fixture.root, git: fakeGit() }),
    /soak configuration\.minutes must be a finite number/,
  );
});

test("rejects asserted 30-minute soak duration with a sparse measured sample set", async (context) => {
  const fixture = await buildFixture();
  context.after(() => rm(fixture.root, { recursive: true, force: true }));
  const evidence = soakEvidence(fixture.manifest);
  evidence.samples = [evidence.samples[0], evidence.samples.at(-1)];
  await fixture.replaceEvidence("soak", fixture.paths.soakPath, evidence);

  await assert.rejects(
    verifyReleaseAttestation(fixture.attestationPath, { root: fixture.root, git: fakeGit() }),
    /measured samples do not meet the duration\/cadence minimum/,
  );
});

test("rejects a soak profile whose touch/mobile emulation does not match its identity", async (context) => {
  const fixture = await buildFixture();
  context.after(() => rm(fixture.root, { recursive: true, force: true }));
  const evidence = soakEvidence(fixture.manifest);
  evidence.configuration.emulation = { hasTouch: true, isMobile: true };
  await fixture.replaceEvidence("soak", fixture.paths.soakPath, evidence);

  await assert.rejects(
    verifyReleaseAttestation(fixture.attestationPath, { root: fixture.root, git: fakeGit() }),
    /soak configuration\.emulation does not match recomputed evidence/,
  );
});

test("rejects soak summaries that do not recompute from raw samples", async (context) => {
  const fixture = await buildFixture();
  context.after(() => rm(fixture.root, { recursive: true, force: true }));
  const evidence = soakEvidence(fixture.manifest);
  evidence.memory.growthBytes += 1;
  await fixture.replaceEvidence("soak", fixture.paths.soakPath, evidence);

  await assert.rejects(
    verifyReleaseAttestation(fixture.attestationPath, { root: fixture.root, git: fakeGit() }),
    /memory\.growthBytes does not match raw samples/,
  );
});

test("rejects a missing mandatory candidate-bound QA check", async (context) => {
  const fixture = await buildFixture();
  context.after(() => rm(fixture.root, { recursive: true, force: true }));
  delete fixture.attestation.evidence.qaChecks.visual;

  assert.throws(
    () => validateReleaseAttestation(fixture.attestation),
    /evidence\.qaChecks keys must be exactly/,
  );
});

test("rejects a mandatory QA record that substitutes another command", async (context) => {
  const fixture = await buildFixture();
  context.after(() => rm(fixture.root, { recursive: true, force: true }));
  const reference = fixture.attestation.evidence.qaChecks.lint;
  const record = JSON.parse(await readFile(path.join(fixture.root, reference.path), "utf8"));
  record.commands[0].command = "true";
  fixture.attestation.evidence.qaChecks.lint = await writeFixtureFile(fixture.root, reference.path, record);
  await fixture.writeAttestation();

  await assert.rejects(
    verifyReleaseAttestation(fixture.attestationPath, { root: fixture.root, git: fakeGit() }),
    /mandatory QA check lint\.commands\[0\]\.command does not match the required command/,
  );
});

test("rejects a QA approval that predates mandatory evidence", async (context) => {
  const fixture = await buildFixture();
  context.after(() => rm(fixture.root, { recursive: true, force: true }));
  await fixture.setApprovalField("qa", "approvedAt", "2026-07-16T12:01:20.000Z");

  await assert.rejects(
    verifyReleaseAttestation(fixture.attestationPath, { root: fixture.root, git: fakeGit() }),
    /QA approval predates the mandatory automated evidence/,
  );
});

test("rejects a QA approval issued after smoke start but before smoke completion", async (context) => {
  const fixture = await buildFixture();
  context.after(() => rm(fixture.root, { recursive: true, force: true }));
  await fixture.setApprovalField("qa", "approvedAt", "2026-07-16T12:01:45.000Z");

  await assert.rejects(
    verifyReleaseAttestation(fixture.attestationPath, { root: fixture.root, git: fakeGit() }),
    /QA approval predates the mandatory automated evidence/,
  );
});

for (const [role, label] of [
  ["accessibility", "Accessibility"],
  ["legal", "Legal"],
]) {
  test(`rejects a ${role} approval that predates completed mandatory evidence`, async (context) => {
    const fixture = await buildFixture();
    context.after(() => rm(fixture.root, { recursive: true, force: true }));
    await fixture.setApprovalField(role, "approvedAt", "2026-07-16T12:01:45.000Z");

    await assert.rejects(
      verifyReleaseAttestation(fixture.attestationPath, { root: fixture.root, git: fakeGit() }),
      new RegExp(`${label} approval predates the mandatory automated evidence`),
    );
  });
}

test("rejects a hash-valid approval record bound to another candidate commit", async (context) => {
  const fixture = await buildFixture();
  context.after(() => rm(fixture.root, { recursive: true, force: true }));
  const record = structuredClone(fixture.approvalRecords.accessibility);
  record.productCommit = "9".repeat(40);
  await fixture.replaceApprovalRecord("accessibility", record);

  await assert.rejects(
    verifyReleaseAttestation(fixture.attestationPath, { root: fixture.root, git: fakeGit() }),
    /accessibility approval evidence\.productCommit does not match the attestation decision/,
  );
});

test("rejects a QA approval whose exact decision retains an open P1", async (context) => {
  const fixture = await buildFixture();
  context.after(() => rm(fixture.root, { recursive: true, force: true }));
  const record = structuredClone(fixture.approvalRecords.qa);
  record.decision.openP1 = 1;
  await fixture.replaceApprovalRecord("qa", record);

  await assert.rejects(
    verifyReleaseAttestation(fixture.attestationPath, { root: fixture.root, git: fakeGit() }),
    /qa approval evidence\.decision must report PASS with zero open P0 and P1 defects/,
  );
});

test("rejects an accessibility approval with unresolved mandatory findings", async (context) => {
  const fixture = await buildFixture();
  context.after(() => rm(fixture.root, { recursive: true, force: true }));
  const record = structuredClone(fixture.approvalRecords.accessibility);
  record.decision.unresolvedMandatory = 1;
  await fixture.replaceApprovalRecord("accessibility", record);

  await assert.rejects(
    verifyReleaseAttestation(fixture.attestationPath, { root: fixture.root, git: fakeGit() }),
    /accessibility approval evidence\.decision must report PASS with zero unresolved mandatory findings/,
  );
});

test("rejects a legal approval without explicit privacy clearance", async (context) => {
  const fixture = await buildFixture();
  context.after(() => rm(fixture.root, { recursive: true, force: true }));
  const record = structuredClone(fixture.approvalRecords.legal);
  record.decision.privacyCleared = false;
  await fixture.replaceApprovalRecord("legal", record);

  await assert.rejects(
    verifyReleaseAttestation(fixture.attestationPath, { root: fixture.root, git: fakeGit() }),
    /legal approval evidence\.decision\.privacyCleared must be true/,
  );
});

test("rejects QA approval when the bound report still says NOT READY", async (context) => {
  const fixture = await buildFixture();
  context.after(() => rm(fixture.root, { recursive: true, force: true }));
  await fixture.replaceQaReport(qaReportContents(fixture.manifest, { releaseDecision: "NOT READY" }));

  await assert.rejects(
    verifyReleaseAttestation(fixture.attestationPath, { root: fixture.root, git: fakeGit() }),
    /QA_REPORT\.md must contain one current release decision of READY/,
  );
});

test("rejects a READY QA report marker bound to another candidate", async (context) => {
  const fixture = await buildFixture();
  context.after(() => rm(fixture.root, { recursive: true, force: true }));
  await fixture.replaceQaReport(qaReportContents(fixture.manifest, {
    markerOverrides: { productCommit: "9".repeat(40) },
  }));

  await assert.rejects(
    verifyReleaseAttestation(fixture.attestationPath, { root: fixture.root, git: fakeGit() }),
    /QA_REPORT\.md release-qa-readiness marker does not match the approved candidate/,
  );
});

test("rejects QA approval that does not hash-bind launch readiness", async (context) => {
  const fixture = await buildFixture();
  context.after(() => rm(fixture.root, { recursive: true, force: true }));
  const record = structuredClone(fixture.approvalRecords.qa);
  record.supportingEvidence = record.supportingEvidence.filter((entry) => entry.path !== "LAUNCH_READINESS.md");
  await fixture.replaceApprovalRecord("qa", record);

  await assert.rejects(
    verifyReleaseAttestation(fixture.attestationPath, { root: fixture.root, git: fakeGit() }),
    /QA approval evidence must bind LAUNCH_READINESS\.md/,
  );
});

for (const [missingPath, expectedError] of [
  [VISUAL_BASELINE_APPROVAL_PATH, /QA approval evidence must bind the canonical visual baseline approval record/],
  [VISUAL_BASELINE_PATH, /QA approval evidence must bind the promoted Canyon visual baseline/],
]) {
  test(`rejects QA approval that omits ${missingPath}`, async (context) => {
    const fixture = await buildFixture();
    context.after(() => rm(fixture.root, { recursive: true, force: true }));
    const record = structuredClone(fixture.approvalRecords.qa);
    record.supportingEvidence = record.supportingEvidence.filter((entry) => entry.path !== missingPath);
    await fixture.replaceApprovalRecord("qa", record);

    await assert.rejects(
      verifyReleaseAttestation(fixture.attestationPath, { root: fixture.root, git: fakeGit() }),
      expectedError,
    );
  });
}

test("rejects a visual approval record whose promoted hash differs from the owner-approved capture", async (context) => {
  const fixture = await buildFixture();
  context.after(() => rm(fixture.root, { recursive: true, force: true }));
  const visualRecord = visualBaselineApprovalRecord();
  visualRecord.promotedBaseline.sha256 = "0".repeat(64);
  const visualReference = await writeFixtureFile(fixture.root, VISUAL_BASELINE_APPROVAL_PATH, visualRecord);
  const qaRecord = structuredClone(fixture.approvalRecords.qa);
  qaRecord.supportingEvidence = qaRecord.supportingEvidence.map((entry) =>
    entry.path === VISUAL_BASELINE_APPROVAL_PATH ? visualReference : entry);
  await fixture.replaceApprovalRecord("qa", qaRecord);

  await assert.rejects(
    verifyReleaseAttestation(fixture.attestationPath, { root: fixture.root, git: fakeGit() }),
    /ownerApproval screenshot does not match the promoted baseline/,
  );
});

test("rejects a visual approval record with an incomplete controlled capture matrix", async (context) => {
  const fixture = await buildFixture();
  context.after(() => rm(fixture.root, { recursive: true, force: true }));
  const visualRecord = visualBaselineApprovalRecord();
  visualRecord.evidence.captureManifest.document.captures.pop();
  visualRecord.evidence.captureManifest = embeddedDocumentReference(
    visualRecord.evidence.captureManifest.path,
    visualRecord.evidence.captureManifest.document,
  );
  visualRecord.ownerApproval.candidate.captureManifestSha256 = visualRecord.evidence.captureManifest.sha256;
  const visualReference = await writeFixtureFile(fixture.root, VISUAL_BASELINE_APPROVAL_PATH, visualRecord);
  const qaRecord = structuredClone(fixture.approvalRecords.qa);
  qaRecord.supportingEvidence = qaRecord.supportingEvidence.map((entry) =>
    entry.path === VISUAL_BASELINE_APPROVAL_PATH ? visualReference : entry);
  await fixture.replaceApprovalRecord("qa", qaRecord);

  await assert.rejects(
    verifyReleaseAttestation(fixture.attestationPath, { root: fixture.root, git: fakeGit() }),
    /capture manifest must contain the exact 11-entry matrix/,
  );
});

test("rejects a generic visual owner attribution", async (context) => {
  const fixture = await buildFixture();
  context.after(() => rm(fixture.root, { recursive: true, force: true }));
  const visualRecord = visualBaselineApprovalRecord();
  visualRecord.ownerApproval.reviewer.name = "Product Owner";
  const visualReference = await writeFixtureFile(fixture.root, VISUAL_BASELINE_APPROVAL_PATH, visualRecord);
  const qaRecord = structuredClone(fixture.approvalRecords.qa);
  qaRecord.supportingEvidence = qaRecord.supportingEvidence.map((entry) =>
    entry.path === VISUAL_BASELINE_APPROVAL_PATH ? visualReference : entry);
  await fixture.replaceApprovalRecord("qa", qaRecord);

  await assert.rejects(
    verifyReleaseAttestation(fixture.attestationPath, { root: fixture.root, git: fakeGit() }),
    /owner approval reviewer\.name is a placeholder/,
  );
});

test("rejects visual owner attribution with surrounding whitespace", async (context) => {
  const fixture = await buildFixture();
  context.after(() => rm(fixture.root, { recursive: true, force: true }));
  const visualRecord = visualBaselineApprovalRecord();
  visualRecord.ownerApproval.reviewer.name = " Alex Rivera ";
  const visualReference = await writeFixtureFile(fixture.root, VISUAL_BASELINE_APPROVAL_PATH, visualRecord);
  const qaRecord = structuredClone(fixture.approvalRecords.qa);
  qaRecord.supportingEvidence = qaRecord.supportingEvidence.map((entry) =>
    entry.path === VISUAL_BASELINE_APPROVAL_PATH ? visualReference : entry);
  await fixture.replaceApprovalRecord("qa", qaRecord);

  await assert.rejects(
    verifyReleaseAttestation(fixture.attestationPath, { root: fixture.root, git: fakeGit() }),
    /owner approval reviewer\.name must not contain surrounding whitespace/,
  );
});

test("rejects product source changes after the owner-reviewed visual candidate", async (context) => {
  const fixture = await buildFixture();
  context.after(() => rm(fixture.root, { recursive: true, force: true }));
  const command = `diff --name-only -z --diff-filter=AM ${VISUAL_CAPTURE_COMMIT}..${PRODUCT_COMMIT} --`;

  await assert.rejects(
    verifyReleaseAttestation(fixture.attestationPath, {
      root: fixture.root,
      git: fakeGit({
        [command]: `${VISUAL_BASELINE_APPROVAL_PATH}\0${VISUAL_BASELINE_PATH}\0src/main.tsx\0`,
      }),
    }),
    /product release must differ from the owner-reviewed visual candidate only by the canonical approval record and promoted baseline/,
  );
});

test("rejects evidence-commit changes to the product-bound visual baseline", async (context) => {
  const fixture = await buildFixture();
  context.after(() => rm(fixture.root, { recursive: true, force: true }));
  const command = `diff --name-only -z --diff-filter=AM ${PRODUCT_COMMIT}..${EVIDENCE_COMMIT} --`;

  await assert.rejects(
    verifyReleaseAttestation(fixture.attestationPath, {
      root: fixture.root,
      git: fakeGit({ [command]: `${ATTESTATION_PATH}\0${VISUAL_BASELINE_PATH}\0` }),
    }),
    /evidence commit changed a non-evidence path: e2e\/visual-regression\.spec\.ts-snapshots\/race-curved-course-canyon-chromium-darwin\.png/,
  );
});

test("rejects QA approval when bound launch readiness still says NOT READY", async (context) => {
  const fixture = await buildFixture();
  context.after(() => rm(fixture.root, { recursive: true, force: true }));
  await fixture.replaceLaunchReadiness(launchReadinessContents(fixture.manifest, {
    decisionHeading: "NOT READY",
    codeOwnedStatus: "UNVERIFIED",
    commercialStatus: "NOT READY",
    finalStatus: "NOT READY",
  }));

  await assert.rejects(
    verifyReleaseAttestation(fixture.attestationPath, { root: fixture.root, git: fakeGit() }),
    /LAUNCH_READINESS\.md must contain one current # READY decision heading/,
  );
});

test("rejects a READY launch marker bound to another candidate", async (context) => {
  const fixture = await buildFixture();
  context.after(() => rm(fixture.root, { recursive: true, force: true }));
  await fixture.replaceLaunchReadiness(launchReadinessContents(fixture.manifest, {
    markerOverrides: { manifestAggregateSha256: "9".repeat(64) },
  }));

  await assert.rejects(
    verifyReleaseAttestation(fixture.attestationPath, { root: fixture.root, git: fakeGit() }),
    /LAUNCH_READINESS\.md release-launch-readiness marker does not match the approved candidate/,
  );
});

test("rejects a moved product tag", async (context) => {
  const fixture = await buildFixture();
  context.after(() => rm(fixture.root, { recursive: true, force: true }));
  const movedObject = "9".repeat(40);

  await assert.rejects(
    verifyReleaseAttestation(fixture.attestationPath, {
      root: fixture.root,
      git: fakeGit({ [`rev-parse refs/tags/${PRODUCT_TAG}`]: movedObject }),
    }),
    /product release tag object does not match/,
  );
});

test("rejects an incomplete production-smoke screenshot bundle", async (context) => {
  const fixture = await buildFixture();
  context.after(() => rm(fixture.root, { recursive: true, force: true }));
  const smoke = JSON.parse(await readFile(path.join(fixture.root, fixture.paths.smokePath), "utf8"));
  smoke.screenshots.pop();
  smoke.screenshotAggregateSha256 = aggregate([...smoke.screenshots].toSorted((left, right) => left.path.localeCompare(right.path)));
  await fixture.replaceEvidence("productionSmoke", fixture.paths.smokePath, smoke);

  await assert.rejects(
    verifyReleaseAttestation(fixture.attestationPath, { root: fixture.root, git: fakeGit() }),
    /production smoke screenshot set is incomplete/,
  );
});

test("rejects production smoke whose completion predates its start", async (context) => {
  const fixture = await buildFixture();
  context.after(() => rm(fixture.root, { recursive: true, force: true }));
  const smoke = JSON.parse(await readFile(path.join(fixture.root, fixture.paths.smokePath), "utf8"));
  smoke.run.startedAt = "2026-07-16T12:02:01.000Z";
  await fixture.replaceEvidence("productionSmoke", fixture.paths.smokePath, smoke);

  await assert.rejects(
    verifyReleaseAttestation(fixture.attestationPath, { root: fixture.root, git: fakeGit() }),
    /production smoke completion predates its start/,
  );
});

test("rejects production smoke bound to the wrong service-worker cache generation", async (context) => {
  const fixture = await buildFixture();
  context.after(() => rm(fixture.root, { recursive: true, force: true }));
  const smoke = JSON.parse(await readFile(path.join(fixture.root, fixture.paths.smokePath), "utf8"));
  smoke.offlineCacheName = "rivet-ridge-rally-shell-v33";
  await fixture.replaceEvidence("productionSmoke", fixture.paths.smokePath, smoke);

  await assert.rejects(
    verifyReleaseAttestation(fixture.attestationPath, { root: fixture.root, git: fakeGit() }),
    /offline cache identity does not match the release contract/,
  );
});

test("rejects production smoke with an incomplete served-file inventory", async (context) => {
  const fixture = await buildFixture();
  context.after(() => rm(fixture.root, { recursive: true, force: true }));
  const smoke = JSON.parse(await readFile(path.join(fixture.root, fixture.paths.smokePath), "utf8"));
  smoke.releaseArtifact.servedAfter.files.pop();
  await fixture.replaceEvidence("productionSmoke", fixture.paths.smokePath, smoke);

  await assert.rejects(
    verifyReleaseAttestation(fixture.attestationPath, { root: fixture.root, git: fakeGit() }),
    /servedAfter\.files is incomplete/,
  );
});

test("rejects hash-matched screenshot placeholders that are not real PNG images", async (context) => {
  const fixture = await buildFixture();
  context.after(() => rm(fixture.root, { recursive: true, force: true }));
  const name = "chrome-editor.png";
  const replacement = await writeFixtureFile(
    fixture.root,
    `${fixture.paths.smokeDirectory}/${name}`,
    "png placeholder\n",
  );
  const smoke = JSON.parse(await readFile(path.join(fixture.root, fixture.paths.smokePath), "utf8"));
  const record = smoke.screenshots.find((entry) => entry.path === name);
  record.bytes = replacement.bytes;
  record.sha256 = replacement.sha256;
  smoke.screenshotAggregateSha256 = aggregate([...smoke.screenshots].toSorted((left, right) => left.path.localeCompare(right.path)));
  await fixture.replaceEvidence("productionSmoke", fixture.paths.smokePath, smoke);

  await assert.rejects(
    verifyReleaseAttestation(fixture.attestationPath, { root: fixture.root, git: fakeGit() }),
    /production smoke screenshot chrome-editor\.png is too short to be a complete PNG/,
  );
});

test("rejects a source-unbound format-1 rollback manifest", async (context) => {
  const fixture = await buildFixture();
  context.after(() => rm(fixture.root, { recursive: true, force: true }));
  const sourceUnbound = {
    product: "RIVET RIDGE RALLY",
    version: ROLLBACK_TAG.slice(1),
    format: 1,
    totalBytes: fixture.previousManifest.totalBytes,
    fileCount: fixture.previousManifest.fileCount,
    aggregateSha256: fixture.previousManifest.aggregateSha256,
    files: fixture.previousManifest.files,
  };
  fixture.attestation.rollback.artifactManifest = await writeFixtureFile(
    fixture.root,
    fixture.paths.rollbackManifestPath,
    sourceUnbound,
  );
  await fixture.writeAttestation();

  await assert.rejects(
    verifyReleaseAttestation(fixture.attestationPath, { root: fixture.root, git: fakeGit() }),
    /format must be 2/,
  );
});

test("schema rejects a rollback locator that is not content-addressed", async (context) => {
  const fixture = await buildFixture();
  context.after(() => rm(fixture.root, { recursive: true, force: true }));
  fixture.attestation.rollback.artifactLocator = "s3://release-archive/rivet-ridge-rally/latest/bundle.tar.zst";

  assert.throws(
    () => validateReleaseAttestation(fixture.attestation),
    /must end with canonical \/sha256\/<artifactAggregateSha256>\/bundle\.tar\.zst/,
  );
});

test("schema rejects a moving rollback alias even when the canonical hash suffix is present", async (context) => {
  const fixture = await buildFixture();
  context.after(() => rm(fixture.root, { recursive: true, force: true }));
  fixture.attestation.rollback.artifactLocator = `s3://release-archive/rivet-ridge-rally/latest/sha256/${fixture.previousManifest.aggregateSha256}/bundle.tar.zst`;

  assert.throws(
    () => validateReleaseAttestation(fixture.attestation),
    /rollback\.artifactLocator must not contain a moving release alias/,
  );
});

test("schema rejects a rollback locator with a noncanonical trailing slash", async (context) => {
  const fixture = await buildFixture();
  context.after(() => rm(fixture.root, { recursive: true, force: true }));
  fixture.attestation.rollback.artifactLocator = `${fixture.attestation.rollback.artifactLocator}/`;

  assert.throws(
    () => validateReleaseAttestation(fixture.attestation),
    /must end with canonical \/sha256\/<artifactAggregateSha256>\/bundle\.tar\.zst/,
  );
});

test("schema rejects a credential-bearing rollback locator even when content-addressed", async (context) => {
  const fixture = await buildFixture();
  context.after(() => rm(fixture.root, { recursive: true, force: true }));
  fixture.attestation.rollback.artifactLocator = `https://operator:secret@example.com/sha256/${fixture.previousManifest.aggregateSha256}/bundle.tar.zst`;

  assert.throws(
    () => validateReleaseAttestation(fixture.attestation),
    /rollback\.artifactLocator must not contain credentials/,
  );
});

test("rejects rollback retrieval evidence bound to another source commit", async (context) => {
  const fixture = await buildFixture();
  context.after(() => rm(fixture.root, { recursive: true, force: true }));
  const evidence = rollbackRetrievalEvidence(
    fixture.previousManifest,
    fixture.attestation.rollback.artifactManifest,
    fixture.attestation.rollback.artifactLocator,
  );
  evidence.releaseCommit = "9".repeat(40);
  await fixture.replaceRollbackEvidence("retrievalEvidence", fixture.paths.retrievalPath, evidence);

  await assert.rejects(
    verifyReleaseAttestation(fixture.attestationPath, { root: fixture.root, git: fakeGit() }),
    /rollback retrieval evidence\.releaseCommit does not match the rollback release/,
  );
});

test("rejects rollback retrieval evidence with another archive SHA-256", async (context) => {
  const fixture = await buildFixture();
  context.after(() => rm(fixture.root, { recursive: true, force: true }));
  const evidence = rollbackRetrievalEvidence(
    fixture.previousManifest,
    fixture.attestation.rollback.artifactManifest,
    fixture.attestation.rollback.artifactLocator,
  );
  evidence.archiveSha256 = "8".repeat(64);
  await fixture.replaceRollbackEvidence("retrievalEvidence", fixture.paths.retrievalPath, evidence);

  await assert.rejects(
    verifyReleaseAttestation(fixture.attestationPath, { root: fixture.root, git: fakeGit() }),
    /rollback retrieval evidence\.archiveSha256 does not match the rollback release/,
  );
});

test("rejects rollback smoke evidence with an incomplete staged journey", async (context) => {
  const fixture = await buildFixture();
  context.after(() => rm(fixture.root, { recursive: true, force: true }));
  const evidence = rollbackSmokeEvidence(
    fixture.previousManifest,
    fixture.attestation.rollback.artifactManifest,
    fixture.attestation.rollback.artifactLocator,
    fixture.rollbackDataSafetyReference,
  );
  evidence.steps.pop();
  await fixture.replaceRollbackEvidence("smokeEvidence", fixture.paths.rollbackSmokePath, evidence);

  await assert.rejects(
    verifyReleaseAttestation(fixture.attestationPath, { root: fixture.root, git: fakeGit() }),
    /rollback smoke evidence step set is incomplete/,
  );
});

test("rejects rollback smoke evidence with another archive byte count", async (context) => {
  const fixture = await buildFixture();
  context.after(() => rm(fixture.root, { recursive: true, force: true }));
  const evidence = rollbackSmokeEvidence(
    fixture.previousManifest,
    fixture.attestation.rollback.artifactManifest,
    fixture.attestation.rollback.artifactLocator,
    fixture.rollbackDataSafetyReference,
  );
  evidence.archiveBytes += 1;
  await fixture.replaceRollbackEvidence("smokeEvidence", fixture.paths.rollbackSmokePath, evidence);

  await assert.rejects(
    verifyReleaseAttestation(fixture.attestationPath, { root: fixture.root, git: fakeGit() }),
    /rollback smoke evidence\.archiveBytes does not match the rollback release/,
  );
});

test("rejects rollback smoke evidence with substituted served bytes", async (context) => {
  const fixture = await buildFixture();
  context.after(() => rm(fixture.root, { recursive: true, force: true }));
  const evidence = rollbackSmokeEvidence(
    fixture.previousManifest,
    fixture.attestation.rollback.artifactManifest,
    fixture.attestation.rollback.artifactLocator,
    fixture.rollbackDataSafetyReference,
  );
  evidence.servedAfter.files[0].sha256 = "8".repeat(64);
  await fixture.replaceRollbackEvidence("smokeEvidence", fixture.paths.rollbackSmokePath, evidence);

  await assert.rejects(
    verifyReleaseAttestation(fixture.attestationPath, { root: fixture.root, git: fakeGit() }),
    /rollback smoke evidence\.servedAfter\.files does not match the release manifest for/,
  );
});

test("rejects rollback smoke served inventory from another root URL", async (context) => {
  const fixture = await buildFixture();
  context.after(() => rm(fixture.root, { recursive: true, force: true }));
  const evidence = rollbackSmokeEvidence(
    fixture.previousManifest,
    fixture.attestation.rollback.artifactManifest,
    fixture.attestation.rollback.artifactLocator,
    fixture.rollbackDataSafetyReference,
  );
  evidence.servedAfter = servedEvidence(
    fixture.previousManifest,
    "https://rollback-substitute.rivet-ridge.example/",
  );
  await fixture.replaceRollbackEvidence("smokeEvidence", fixture.paths.rollbackSmokePath, evidence);

  await assert.rejects(
    verifyReleaseAttestation(fixture.attestationPath, { root: fixture.root, git: fakeGit() }),
    /rollback smoke evidence\.servedAfter\.baseURL does not match the evidence root URL/,
  );
});

test("rejects rollback evidence that clears site data to bypass the version downgrade", async (context) => {
  const fixture = await buildFixture();
  context.after(() => rm(fixture.root, { recursive: true, force: true }));
  const dataSafety = JSON.parse(
    await readFile(path.join(fixture.root, fixture.paths.rollbackDataSafetyPath), "utf8"),
  );
  dataSafety.siteDataCleared = true;
  const dataSafetyReference = await writeFixtureFile(
    fixture.root,
    fixture.paths.rollbackDataSafetyPath,
    dataSafety,
  );
  const smoke = rollbackSmokeEvidence(
    fixture.previousManifest,
    fixture.attestation.rollback.artifactManifest,
    fixture.attestation.rollback.artifactLocator,
    dataSafetyReference,
  );
  await fixture.replaceRollbackEvidence("smokeEvidence", fixture.paths.rollbackSmokePath, smoke);

  await assert.rejects(
    verifyReleaseAttestation(fixture.attestationPath, { root: fixture.root, git: fakeGit() }),
    /rollback data-safety evidence used destructive recovery/,
  );
});

test("rejects rollback data-safety evidence that tests native version 50 instead of the tagged predecessor", async (context) => {
  const fixture = await buildFixture();
  context.after(() => rm(fixture.root, { recursive: true, force: true }));
  const dataSafety = JSON.parse(
    await readFile(path.join(fixture.root, fixture.paths.rollbackDataSafetyPath), "utf8"),
  );
  dataSafety.rollbackNativeIndexedDbVersion = 50;
  const dataSafetyReference = await writeFixtureFile(
    fixture.root,
    fixture.paths.rollbackDataSafetyPath,
    dataSafety,
  );
  const smoke = rollbackSmokeEvidence(
    fixture.previousManifest,
    fixture.attestation.rollback.artifactManifest,
    fixture.attestation.rollback.artifactLocator,
    dataSafetyReference,
  );
  await fixture.replaceRollbackEvidence("smokeEvidence", fixture.paths.rollbackSmokePath, smoke);

  await assert.rejects(
    verifyReleaseAttestation(fixture.attestationPath, { root: fixture.root, git: fakeGit() }),
    /rollback data-safety evidence must exercise the native version-30 predecessor/,
  );
});

test("rejects vacuous rollback data-safety evidence with no persisted records", async (context) => {
  const fixture = await buildFixture();
  context.after(() => rm(fixture.root, { recursive: true, force: true }));
  const dataSafety = JSON.parse(
    await readFile(path.join(fixture.root, fixture.paths.rollbackDataSafetyPath), "utf8"),
  );
  for (const field of [
    "progressRecordsBefore",
    "progressRecordsAfter",
    "customTracksBefore",
    "customTracksAfter",
    "replaysBefore",
    "replaysAfter",
  ]) {
    dataSafety[field] = 0;
  }
  const dataSafetyReference = await writeFixtureFile(
    fixture.root,
    fixture.paths.rollbackDataSafetyPath,
    dataSafety,
  );
  const smoke = rollbackSmokeEvidence(
    fixture.previousManifest,
    fixture.attestation.rollback.artifactManifest,
    fixture.attestation.rollback.artifactLocator,
    dataSafetyReference,
  );
  await fixture.replaceRollbackEvidence("smokeEvidence", fixture.paths.rollbackSmokePath, smoke);

  await assert.rejects(
    verifyReleaseAttestation(fixture.attestationPath, { root: fixture.root, git: fakeGit() }),
    /rollback data-safety evidence\.progressRecordsBefore must seed at least one persisted record/,
  );
});

test("rejects an evidence commit that is not descended from the product release", async (context) => {
  const fixture = await buildFixture();
  context.after(() => rm(fixture.root, { recursive: true, force: true }));
  const command = `merge-base --is-ancestor ${PRODUCT_COMMIT} ${EVIDENCE_COMMIT}`;

  await assert.rejects(
    verifyReleaseAttestation(fixture.attestationPath, {
      root: fixture.root,
      git: fakeGit({ [command]: new Error("not an ancestor") }),
    }),
    /product release commit must be an ancestor of the evidence commit/,
  );
});

test("rejects product-source changes in the evidence-only commit", async (context) => {
  const fixture = await buildFixture();
  context.after(() => rm(fixture.root, { recursive: true, force: true }));
  const command = `diff --name-only -z --diff-filter=AM ${PRODUCT_COMMIT}..${EVIDENCE_COMMIT} --`;

  await assert.rejects(
    verifyReleaseAttestation(fixture.attestationPath, {
      root: fixture.root,
      git: fakeGit({ [command]: `${ATTESTATION_PATH}\0src/main.tsx\0` }),
    }),
    /evidence commit changed a non-evidence path: src\/main\.tsx/,
  );
});

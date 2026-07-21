import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { isDeepStrictEqual, promisify } from "node:util";

import { inspectPngIntegrity } from "./lib/png-integrity.mjs";
import {
  validateVisualCaptureManifest,
  validateVisualOwnerApproval,
} from "./promote-visual-baseline.mjs";
import { validateFormat2ReleaseManifest } from "./production-smoke-support.mjs";
import { validateVisualCandidateManifest } from "./visual-candidate-support.mjs";

const SCRIPT_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
export const REPOSITORY_ROOT = path.resolve(SCRIPT_DIRECTORY, "..");
export const RELEASE_ATTESTATION_SCHEMA_VERSION = 3;

const execFileAsync = promisify(execFile);
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const GIT_OBJECT_PATTERN = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const VERSION_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const MINIMUM_SOAK_DURATION_MS = 30 * 60 * 1_000;
const MAXIMUM_RELEASE_SOAK_SAMPLE_INTERVAL_SECONDS = 30;
const SOAK_SAMPLE_WINDOW_TOLERANCE_INTERVALS = 2;
const PERFORMANCE_SAMPLE_SECONDS = 5;
const RENDER_SAMPLE_MAXIMUM_GAP_MS = 1_000;
const RENDER_SAMPLE_ENDPOINT_TOLERANCE_MS = 250;
const MAXIMUM_FRAME_WORK_SAMPLES = 4_096;
const MAXIMUM_RACING_CLOCK_TRANSITIONS = 1_024;
const PRODUCTION_RIVAL_ATTEMPT_TIMEOUT_MS = 12 * 60_000;
const PERFORMANCE_EXPECTED_TRACK_IDS = [
  "canyon-kickoff",
  "pine-run",
  "coastline-clash",
  "foundry-flight",
  "summit-showdown",
];
const EXPECTED_OFFLINE_CACHE_NAME = "rivet-ridge-rally-shell-v35";
const VISUAL_BASELINE_APPROVAL_PATH = "docs/design/RACE_CURVED_CANYON_BASELINE_APPROVAL.json";
const VISUAL_BASELINE_PATH = "e2e/visual-regression.spec.ts-snapshots/race-curved-course-canyon-chromium-darwin.png";
const VISUAL_APPROVAL_AUTHENTICATION = "external-manual-trust-boundary";
const PERFORMANCE_BUDGETS = Object.freeze({
  compressedBundleBytesExclusive: 12_000_000,
  desktop: Object.freeze({ meanFpsAtLeast: 58, frameWorkP95MsAtMost: 16.67, quality: "high" }),
  mobile: Object.freeze({ meanFpsAtLeast: 30, frameWorkP95MsAtMost: 33.33, quality: "low" }),
});
const PERFORMANCE_PROFILES = Object.freeze({
  "desktop-1920x1080": Object.freeze({
    ...PERFORMANCE_BUDGETS.desktop,
    scope: "representative-local-desktop",
    viewport: Object.freeze({ width: 1_920, height: 1_080 }),
    deviceScaleFactor: 1,
    emulation: Object.freeze({ hasTouch: false, isMobile: false }),
  }),
  "mobile-390x844": Object.freeze({
    ...PERFORMANCE_BUDGETS.mobile,
    scope: "emulated-mobile-local-technical-floor-not-physical-device-proof",
    viewport: Object.freeze({ width: 390, height: 844 }),
    deviceScaleFactor: 2,
    emulation: Object.freeze({ hasTouch: true, isMobile: true }),
  }),
});
const SOAK_PROFILES = Object.freeze({
  desktop: Object.freeze({
    viewport: Object.freeze({ width: 1_920, height: 1_080 }),
    deviceScaleFactor: 1,
    emulation: Object.freeze({ hasTouch: false, isMobile: false }),
    quality: "high",
  }),
  mobile: Object.freeze({
    viewport: Object.freeze({ width: 390, height: 844 }),
    deviceScaleFactor: 2,
    emulation: Object.freeze({ hasTouch: true, isMobile: true }),
    quality: "low",
  }),
});
const MANDATORY_QA_CHECKS = Object.freeze({
  accessibility: Object.freeze([
    "npx playwright test e2e/core-flow.spec.ts e2e/accessibility-controls.spec.ts",
  ]),
  assets: Object.freeze(["npm run assets:verify"]),
  browser: Object.freeze(["npm run test:e2e"]),
  dependencyAudit: Object.freeze(["npm run audit"]),
  lint: Object.freeze(["npm run lint"]),
  persistence: Object.freeze([
    "npx vitest run src/game/persistence",
    "npx playwright test e2e/migrations.spec.ts",
  ]),
  reliability: Object.freeze(["npx playwright test e2e/reliability.spec.ts"]),
  typecheck: Object.freeze(["npm run typecheck"]),
  unit: Object.freeze(["npm test"]),
  visual: Object.freeze(["npx playwright test e2e/visual-regression.spec.ts"]),
});
const APPROVAL_SCOPES = Object.freeze({
  qa: "release-qualification",
  accessibility: "release-accessibility",
  legal: "release-rights-privacy-and-trade-dress",
});
const ROLLBACK_SMOKE_STEPS = [
  "artifact-retrieved",
  "database-precondition-native-v60",
  "format-2-manifest-validated",
  "boot-and-version",
  "local-save-read-or-nondestructive-block",
  "progress-track-replay-preservation",
  "race-start-and-restart",
  "offline-service-worker-reload",
].toSorted();
const SOAK_TREND_REVIEW_PATHS = [
  "memory.trend",
  "inputResponsiveness.dispatchDelayTrend",
  "inputResponsiveness.keydownToFrameTrend",
  "fixedStepTiming.cumulativeDroppedSimulationMs.trend",
];

const KNOWN_PERFORMANCE_DIAGNOSTIC_WARNING = /GPU stall due to ReadPixels/;
const PERFORMANCE_DURATION_CLOCK_TOLERANCE_MS = 1_000;
const PERFORMANCE_HEAP_STAGES = [
  "after-render-sample",
  "after-restart",
  "editor-test-play",
  "first-race-ready",
  "rival-wheelie-obstacle-stress",
  "shell",
].toSorted();

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
].toSorted();

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
].toSorted();

const SOAK_DIAGNOSTIC_CRITERIA = SOAK_CRITERIA.filter((id) => ![
  "minimum-30-minute-active-duration",
  "rival-release-workload",
].includes(id));

const PERFORMANCE_CRITERION_KEYS = Object.freeze(Object.fromEntries(PERFORMANCE_CRITERIA.map((id) => {
  if (id === "compressed-bundle-under-12mb") {
    return [id, ["actualBytes", "id", "passed", "requiredExclusiveBytes"]];
  }
  if (id === "headed-release-measurement" || id.endsWith("performance-budget") || id.endsWith("technical-floor")) {
    return [id, ["actual", "id", "passed", "required"]];
  }
  return [id, ["actual", "id", "passed"]];
})));

const SOAK_CRITERION_KEYS = Object.freeze(Object.fromEntries(SOAK_CRITERIA.map((id) => {
  if (["configured-duration-completed", "minimum-30-minute-active-duration"].includes(id)) {
    return [id, ["actualMs", "id", "passed", "requiredMs"]];
  }
  if (id === "rival-release-workload") {
    return [id, ["actual", "id", "passed", "required"]];
  }
  return [id, ["actual", "id", "passed"]];
})));

const REQUIRED_SMOKE_STEPS = [
  "format-2-artifact-binding",
  "boot-and-version",
  "race-start-and-restart",
  "editor-open",
  "offline-service-worker-reload",
  "offline-cached-practice-race",
  "post-journey-format-2-artifact-binding",
].toSorted();

const REQUIRED_SMOKE_SCREENSHOTS = [
  "chrome-editor.png",
  "chrome-offline-race.png",
  "chrome-offline-title.png",
  "chrome-race.png",
].toSorted();

function invalid(message) {
  throw new Error(`Release attestation is invalid: ${message}`);
}

function sha256(contents) {
  return createHash("sha256").update(contents).digest("hex");
}

function requireCondition(condition, message) {
  if (!condition) invalid(message);
}

function requireObject(value, label) {
  requireCondition(
    value !== null
      && typeof value === "object"
      && !Array.isArray(value)
      && [Object.prototype, null].includes(Object.getPrototypeOf(value)),
    `${label} must be an object`,
  );
  return value;
}

function requireExactKeys(value, keys, label) {
  const actual = Object.keys(requireObject(value, label)).toSorted();
  const expected = [...keys].toSorted();
  requireCondition(
    JSON.stringify(actual) === JSON.stringify(expected),
    `${label} keys must be exactly: ${expected.join(", ")}`,
  );
}

function requireBoundedString(value, label, maximumLength = 256) {
  requireCondition(typeof value === "string", `${label} must be a string`);
  requireCondition(value.length > 0 && value.length <= maximumLength, `${label} length is invalid`);
  requireCondition(value === value.trim(), `${label} must not have surrounding whitespace`);
  requireCondition(!/[\u0000-\u001f\u007f]/.test(value), `${label} contains control characters`);
  return value;
}

function requireSha256(value, label) {
  requireCondition(SHA256_PATTERN.test(value ?? ""), `${label} must be a lowercase SHA-256`);
  return value;
}

function requireGitObject(value, label) {
  requireCondition(GIT_OBJECT_PATTERN.test(value ?? ""), `${label} must be a lowercase Git object ID`);
  return value;
}

function requireTimestamp(value, label) {
  requireCondition(typeof value === "string", `${label} must be an ISO-8601 timestamp`);
  const parsed = new Date(value);
  requireCondition(!Number.isNaN(parsed.valueOf()) && parsed.toISOString() === value, `${label} must be a canonical UTC timestamp`);
  return value;
}

function requireFiniteNumber(
  value,
  label,
  { minimum = -Infinity, maximum = Infinity, exclusiveMaximum = Infinity } = {},
) {
  requireCondition(Number.isFinite(value), `${label} must be a finite number`);
  requireCondition(value >= minimum, `${label} is below its minimum`);
  requireCondition(value <= maximum, `${label} exceeds its maximum`);
  requireCondition(value < exclusiveMaximum, `${label} is not below its exclusive maximum`);
  return value;
}

function requirePositiveInteger(value, label) {
  requireCondition(Number.isSafeInteger(value) && value > 0, `${label} must be a positive safe integer`);
  return value;
}

function roundMetric(value, digits = 2) {
  if (!Number.isFinite(value)) return null;
  const factor = 10 ** digits;
  const rounded = Math.round(value * factor) / factor;
  return Object.is(rounded, -0) ? 0 : rounded;
}

function summarizeMetric(values) {
  const sorted = values.filter(Number.isFinite).toSorted((left, right) => left - right);
  if (sorted.length === 0) return { samples: 0, min: null, mean: null, p95: null, max: null };
  const total = sorted.reduce((sum, value) => sum + value, 0);
  const percentileIndex = Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1);
  return {
    samples: sorted.length,
    min: roundMetric(sorted[0]),
    mean: roundMetric(total / sorted.length),
    p95: roundMetric(sorted[percentileIndex]),
    max: roundMetric(sorted.at(-1)),
  };
}

function rawFrameRateMetric(samples) {
  if (!Array.isArray(samples) || samples.length < 2) return null;
  const coverageMs = samples.at(-1).frameTimestampMs - samples[0].frameTimestampMs;
  if (!Number.isFinite(coverageMs) || coverageMs <= 0) return null;
  return roundMetric((samples.length - 1) / (coverageMs / 1_000));
}

function trendMetric(points) {
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
  const covariance = finitePoints.reduce((sum, point) => (
    sum + ((point.elapsedMs - firstElapsedMs) - elapsedMean) * (point.value - valueMean)
  ), 0);
  const elapsedVariance = finitePoints.reduce((sum, point) => (
    sum + ((point.elapsedMs - firstElapsedMs) - elapsedMean) ** 2
  ), 0);
  return {
    samples: finitePoints.length,
    windowSamples,
    firstWindowMean: roundMetric(firstWindowMean),
    lastWindowMean: roundMetric(lastWindowMean),
    changeBetweenWindows: roundMetric(lastWindowMean - firstWindowMean),
    linearRatePerMinute: elapsedVariance === 0
      ? null
      : roundMetric((covariance / elapsedVariance) * 60_000),
  };
}

function requireExactJson(value, expected, label) {
  requireCondition(isDeepStrictEqual(value, expected), `${label} does not match recomputed evidence`);
}

function validateRootUrl(value, label) {
  const url = requireBoundedString(value, label, 2_048);
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    invalid(`${label} must be an absolute URL`);
  }
  requireCondition(["http:", "https:"].includes(parsed.protocol), `${label} must use HTTP or HTTPS`);
  requireCondition(!parsed.username && !parsed.password, `${label} must not contain credentials`);
  requireCondition(parsed.pathname === "/" && !parsed.search && !parsed.hash, `${label} must be a dedicated-origin root URL`);
  return parsed;
}

function validateRelativePath(value, label) {
  requireBoundedString(value, label, 1_024);
  requireCondition(!path.posix.isAbsolute(value), `${label} must be repository-relative`);
  requireCondition(!value.includes("\\"), `${label} must use forward slashes`);
  const segments = value.split("/");
  requireCondition(
    segments.every((segment) => segment.length > 0 && segment !== "." && segment !== ".."),
    `${label} must be canonical`,
  );
  return value;
}

function validateFileReference(value, label) {
  requireExactKeys(value, ["path", "bytes", "sha256"], label);
  validateRelativePath(value.path, `${label}.path`);
  requireCondition(Number.isSafeInteger(value.bytes) && value.bytes > 0, `${label}.bytes must be a positive safe integer`);
  requireSha256(value.sha256, `${label}.sha256`);
  return value;
}

function validateApproval(value, role, productRelease) {
  const label = `approvals.${role}`;
  requireExactKeys(
    value,
    [
      "approvedAt",
      "approvedBy",
      "evidence",
      "manifestAggregateSha256",
      "productCommit",
      "productTag",
      "role",
      "scope",
      "status",
    ],
    label,
  );
  requireCondition(value.status === "APPROVED", `${label}.status must be APPROVED`);
  requireCondition(value.role === role, `${label}.role must be ${role}`);
  requireCondition(value.scope === APPROVAL_SCOPES[role], `${label}.scope does not match the required decision scope`);
  requireCondition(value.productTag === productRelease.tag, `${label}.productTag does not match the product release`);
  requireCondition(value.productCommit === productRelease.commit, `${label}.productCommit does not match the product release`);
  requireCondition(
    value.manifestAggregateSha256 === productRelease.manifest.aggregateSha256,
    `${label}.manifestAggregateSha256 does not match the product release`,
  );
  requireBoundedString(value.approvedBy, `${label}.approvedBy`, 200);
  requireTimestamp(value.approvedAt, `${label}.approvedAt`);
  validateFileReference(value.evidence, `${label}.evidence`);
  requireCondition(
    value.evidence.path === `artifacts/release-attestations/${productRelease.tag}-evidence/approvals/${role}.json`,
    `${label}.evidence.path does not match the canonical candidate-bound approval path`,
  );
  return value;
}

function validateImmutableArtifactLocator(value, expectedAggregate, label) {
  const locator = requireBoundedString(value, label, 2_048);
  let parsed;
  try {
    parsed = new URL(locator);
  } catch {
    invalid(`${label} must be an absolute archive URL`);
  }
  requireCondition(["https:", "s3:", "gs:"].includes(parsed.protocol), `${label} must use https, s3, or gs`);
  requireCondition(!parsed.username && !parsed.password, `${label} must not contain credentials`);
  requireCondition(!parsed.search && !parsed.hash, `${label} must not contain a query or fragment`);
  requireCondition(parsed.hostname.length > 0, `${label} must contain an archive host`);
  const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  requireCondition(
    host !== "localhost"
      && host !== "::1"
      && host !== "0.0.0.0"
      && !host.endsWith(".localhost")
      && !host.endsWith(".local")
      && !host.endsWith(".internal")
      && !/^127(?:\.\d{1,3}){3}$/.test(host)
      && !/^10(?:\.\d{1,3}){3}$/.test(host)
      && !/^192\.168(?:\.\d{1,3}){2}$/.test(host)
      && !/^169\.254(?:\.\d{1,3}){2}$/.test(host)
      && !/^172\.(?:1[6-9]|2\d|3[01])(?:\.\d{1,3}){2}$/.test(host)
      && !/^100\.(?:6[4-9]|[7-9]\d|1[01]\d|12[0-7])(?:\.\d{1,3}){2}$/.test(host)
      && !/^(?:fc|fd|fe[89ab])[0-9a-f:]*$/i.test(host),
    `${label} must not use a local or private host`,
  );
  let decodedPathname;
  try {
    decodedPathname = decodeURIComponent(parsed.pathname);
  } catch {
    invalid(`${label} path must use valid URL encoding`);
  }
  const pathSegments = decodedPathname.split("/").filter(Boolean);
  requireCondition(
    decodedPathname.endsWith(`/sha256/${expectedAggregate}/bundle.tar.zst`),
    `${label} must end with canonical /sha256/<artifactAggregateSha256>/bundle.tar.zst`,
  );
  requireCondition(
    !pathSegments.some((segment) => ["current", "latest", "prod", "production", "stable"].includes(segment.toLowerCase())),
    `${label} must not contain a moving release alias`,
  );
  return locator;
}

export function validateReleaseAttestation(value) {
  requireExactKeys(
    value,
    ["approvals", "createdAt", "evidence", "kind", "product", "productRelease", "rollback", "schemaVersion", "version"],
    "root",
  );
  requireCondition(value.schemaVersion === RELEASE_ATTESTATION_SCHEMA_VERSION, `schemaVersion must be ${RELEASE_ATTESTATION_SCHEMA_VERSION}`);
  requireCondition(value.kind === "release-attestation", "kind must be release-attestation");
  requireCondition(value.product === "RIVET RIDGE RALLY", "product identity does not match");
  requireCondition(typeof value.version === "string" && VERSION_PATTERN.test(value.version), "version is invalid");
  requireTimestamp(value.createdAt, "createdAt");

  requireExactKeys(value.productRelease, ["commit", "manifest", "tag", "tagObject"], "productRelease");
  requireCondition(value.productRelease.tag === `v${value.version}`, "productRelease.tag does not match version");
  requireGitObject(value.productRelease.commit, "productRelease.commit");
  requireGitObject(value.productRelease.tagObject, "productRelease.tagObject");
  requireExactKeys(value.productRelease.manifest, ["aggregateSha256", "bytes", "path", "sha256"], "productRelease.manifest");
  validateRelativePath(value.productRelease.manifest.path, "productRelease.manifest.path");
  requireCondition(
    Number.isSafeInteger(value.productRelease.manifest.bytes) && value.productRelease.manifest.bytes > 0,
    "productRelease.manifest.bytes must be a positive safe integer",
  );
  requireSha256(value.productRelease.manifest.sha256, "productRelease.manifest.sha256");
  requireSha256(value.productRelease.manifest.aggregateSha256, "productRelease.manifest.aggregateSha256");
  requireCondition(
    value.productRelease.manifest.path === `artifacts/history/release-manifest-${value.version}-format-2.json`,
    "productRelease.manifest.path does not match the canonical format-2 archive path",
  );

  requireExactKeys(value.evidence, ["headedPerformance", "productionSmoke", "qaChecks", "soak"], "evidence");
  validateFileReference(value.evidence.headedPerformance, "evidence.headedPerformance");
  validateFileReference(value.evidence.soak, "evidence.soak");
  validateFileReference(value.evidence.productionSmoke, "evidence.productionSmoke");
  requireExactKeys(value.evidence.qaChecks, Object.keys(MANDATORY_QA_CHECKS), "evidence.qaChecks");
  const evidenceRoot = `artifacts/release-attestations/${value.productRelease.tag}-evidence`;
  requireCondition(
    value.evidence.headedPerformance.path === `${evidenceRoot}/performance/headed-measurement.json`,
    "evidence.headedPerformance.path does not match the canonical path",
  );
  requireCondition(
    value.evidence.soak.path === `${evidenceRoot}/performance/30m-soak.json`,
    "evidence.soak.path does not match the canonical path",
  );
  requireCondition(
    value.evidence.productionSmoke.path.startsWith(
      `artifacts/production-smoke/candidates/${value.productRelease.manifest.sha256}/runs/`,
    ) && value.evidence.productionSmoke.path.endsWith("/chrome-smoke.json"),
    "evidence.productionSmoke.path does not match its manifest-keyed bundle",
  );
  for (const [name, reference] of Object.entries(value.evidence.qaChecks)) {
    validateFileReference(reference, `evidence.qaChecks.${name}`);
    requireCondition(
      reference.path === `${evidenceRoot}/qa/${name}.json`,
      `evidence.qaChecks.${name}.path does not match the canonical candidate-bound path`,
    );
  }

  requireExactKeys(value.approvals, ["accessibility", "legal", "qa"], "approvals");
  validateApproval(value.approvals.qa, "qa", value.productRelease);
  validateApproval(value.approvals.accessibility, "accessibility", value.productRelease);
  validateApproval(value.approvals.legal, "legal", value.productRelease);

  requireExactKeys(
    value.rollback,
    [
      "artifactAggregateSha256",
      "archiveBytes",
      "archiveSha256",
      "artifactLocator",
      "artifactManifest",
      "releaseCommit",
      "releaseTag",
      "releaseTagObject",
      "retrievalEvidence",
      "smokeEvidence",
      "status",
      "verifiedAt",
      "verifiedBy",
    ],
    "rollback",
  );
  requireCondition(value.rollback.status === "VERIFIED", "rollback.status must be VERIFIED");
  requireBoundedString(value.rollback.releaseTag, "rollback.releaseTag", 200);
  requireCondition(/^v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(value.rollback.releaseTag), "rollback.releaseTag is invalid");
  requireCondition(value.rollback.releaseTag !== value.productRelease.tag, "rollback release must differ from product release");
  requireGitObject(value.rollback.releaseCommit, "rollback.releaseCommit");
  requireGitObject(value.rollback.releaseTagObject, "rollback.releaseTagObject");
  requireSha256(value.rollback.artifactAggregateSha256, "rollback.artifactAggregateSha256");
  requirePositiveInteger(value.rollback.archiveBytes, "rollback.archiveBytes");
  requireSha256(value.rollback.archiveSha256, "rollback.archiveSha256");
  validateImmutableArtifactLocator(
    value.rollback.artifactLocator,
    value.rollback.artifactAggregateSha256,
    "rollback.artifactLocator",
  );
  requireBoundedString(value.rollback.verifiedBy, "rollback.verifiedBy", 200);
  requireTimestamp(value.rollback.verifiedAt, "rollback.verifiedAt");
  validateFileReference(value.rollback.artifactManifest, "rollback.artifactManifest");
  validateFileReference(value.rollback.retrievalEvidence, "rollback.retrievalEvidence");
  validateFileReference(value.rollback.smokeEvidence, "rollback.smokeEvidence");
  requireCondition(
    value.rollback.artifactManifest.path === `artifacts/history/release-manifest-${value.rollback.releaseTag.slice(1)}-format-2.json`,
    "rollback.artifactManifest.path does not match the canonical format-2 archive path",
  );
  requireCondition(
    value.rollback.retrievalEvidence.path === `${evidenceRoot}/rollback/retrieval.json`,
    "rollback.retrievalEvidence.path does not match the canonical path",
  );
  requireCondition(
    value.rollback.smokeEvidence.path === `${evidenceRoot}/rollback/smoke.json`,
    "rollback.smokeEvidence.path does not match the canonical path",
  );

  const attestationTime = Date.parse(value.createdAt);
  for (const [name, approval] of Object.entries(value.approvals)) {
    requireCondition(Date.parse(approval.approvedAt) <= attestationTime, `approvals.${name}.approvedAt is after createdAt`);
  }
  requireCondition(Date.parse(value.rollback.verifiedAt) <= attestationTime, "rollback.verifiedAt is after createdAt");

  return value;
}

async function defaultGit(argumentsList, root) {
  try {
    const result = await execFileAsync("git", argumentsList, {
      cwd: root,
      encoding: "utf8",
      maxBuffer: 4 * 1024 * 1024,
    });
    return result.stdout.trim();
  } catch {
    invalid(`Git command failed: git ${argumentsList.join(" ")}`);
  }
}

function isContainedPath(parent, child) {
  const relative = path.relative(parent, child);
  return relative === ""
    || (!path.isAbsolute(relative) && relative !== ".." && !relative.startsWith(`..${path.sep}`));
}

async function assertNoSymlinkAncestors(root, absolute, label) {
  requireCondition(isContainedPath(root, absolute), `${label} escaped the repository`);
  let current = root;
  const rootEntry = await lstat(root);
  requireCondition(!rootEntry.isSymbolicLink(), "repository root must not be a symbolic link");
  for (const segment of path.relative(root, absolute).split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    let entry;
    try {
      entry = await lstat(current);
    } catch {
      invalid(`${label} is not readable`);
    }
    requireCondition(!entry.isSymbolicLink(), `${label} must not traverse symbolic links`);
  }
}

function normalizeInputPath(root, input, label) {
  requireCondition(typeof input === "string" && input.length > 0, `${label} is missing`);
  const absolute = path.resolve(root, input);
  requireCondition(isContainedPath(root, absolute), `${label} escaped the repository`);
  const relative = path.relative(root, absolute).split(path.sep).join("/");
  validateRelativePath(relative, label);
  return { absolute, relative };
}

async function requireTracked(relative, git, root, label) {
  try {
    await git(["ls-files", "--error-unmatch", "--", relative], root);
  } catch {
    invalid(`${label} must be tracked by Git`);
  }
}

async function loadVerifiedFile(reference, label, { root, git }) {
  const absolute = path.resolve(root, ...reference.path.split("/"));
  await assertNoSymlinkAncestors(root, absolute, label);
  const entry = await lstat(absolute);
  requireCondition(entry.isFile(), `${label} must be a regular file`);
  const contents = await readFile(absolute);
  requireCondition(contents.length === reference.bytes, `${label} byte count does not match`);
  requireCondition(sha256(contents) === reference.sha256, `${label} SHA-256 does not match`);
  await requireTracked(reference.path, git, root, label);
  return { absolute, contents };
}

function parseJson(contents, label) {
  try {
    return JSON.parse(contents.toString("utf8"));
  } catch {
    invalid(`${label} is not valid JSON`);
  }
}

async function verifyAnnotatedTag(tag, expectedObject, expectedCommit, label, git, root) {
  const reference = `refs/tags/${tag}`;
  const tagObject = await git(["rev-parse", reference], root);
  requireCondition(GIT_OBJECT_PATTERN.test(tagObject) && tagObject === expectedObject, `${label} object does not match`);
  const objectType = await git(["cat-file", "-t", tagObject], root);
  requireCondition(objectType === "tag", `${label} must be annotated`);
  const commit = await git(["rev-parse", `${tagObject}^{commit}`], root);
  requireCondition(GIT_OBJECT_PATTERN.test(commit) && commit === expectedCommit, `${label} commit does not match`);
}

function requirePassingCriteria(gate, expectedIds, label, { exactKeys = null, criterionKeys = null } = {}) {
  if (exactKeys !== null) requireExactKeys(gate, exactKeys, label);
  else requireObject(gate, label);
  requireCondition(gate.status === "PASS", `${label}.status must be PASS`);
  requireCondition(Array.isArray(gate.criteria), `${label}.criteria must be an array`);
  requireCondition(Array.isArray(gate.failedCriteria) && gate.failedCriteria.length === 0, `${label}.failedCriteria must be empty`);
  const ids = [];
  for (const criterion of gate.criteria) {
    requireObject(criterion, `${label}.criteria[]`);
    requireCondition(typeof criterion.id === "string", `${label} criterion ID is missing`);
    if (criterionKeys !== null) {
      const keys = criterionKeys[criterion.id];
      requireCondition(keys !== undefined, `${label} contains an unknown criterion: ${criterion.id}`);
      requireExactKeys(criterion, keys, `${label}.criteria[${criterion.id}]`);
    }
    requireCondition(criterion.passed === true, `${label} criterion did not pass: ${criterion.id}`);
    ids.push(criterion.id);
  }
  requireCondition(new Set(ids).size === ids.length, `${label} has duplicate criterion IDs`);
  requireCondition(
    JSON.stringify(ids.toSorted()) === JSON.stringify(expectedIds),
    `${label} criterion set does not match schema v${RELEASE_ATTESTATION_SCHEMA_VERSION}`,
  );
}

function validateRecordedDuration(value, startedAt, completedAt, label) {
  requireCondition(Number.isSafeInteger(value) && value > 0, `${label} must be a positive safe integer`);
  const timestampDurationMs = Date.parse(completedAt) - Date.parse(startedAt);
  requireCondition(
    Math.abs(value - timestampDurationMs) <= PERFORMANCE_DURATION_CLOCK_TOLERANCE_MS,
    `${label} does not match the recorded start/completion chronology`,
  );
  return value;
}

function validateQualityEvidence(value, expectedQuality, label) {
  requireExactKeys(value, ["effective", "effectiveDerivation", "requested", "selected"], label);
  requireCondition(
    value.requested === expectedQuality
      && value.selected === expectedQuality
      && value.effective === expectedQuality,
    `${label} does not match the required explicit quality`,
  );
  requireCondition(
    value.effectiveDerivation === "explicit-non-auto-renderer-preset",
    `${label}.effectiveDerivation does not match the performance harness`,
  );
}

function validateRuntimeEvidence(value, productRelease, version, label) {
  requireExactKeys(value, [
    "build",
    "performanceCaptureHarnessPresent",
    "productPerformanceApiPresent",
    "qaApiPresent",
    "title",
    "version",
    "versionPresent",
  ], label);
  requireExactKeys(value.build, ["commit", "dirty"], `${label}.build`);
  requireCondition(
    value.build.commit === productRelease.commit && value.build.dirty === false,
    `${label}.build does not match the product release`,
  );
  requireCondition(
    value.title === "Rivet Ridge Rally"
      && value.qaApiPresent === false
      && value.productPerformanceApiPresent === false
      && value.performanceCaptureHarnessPresent === true
      && value.versionPresent === true
      && value.version === version,
    `${label} identity is incomplete`,
  );
}

function validateAuthoredHeroEvidence(value, label) {
  requireExactKeys(value, ["bikeAsset", "fallbackReason", "root"], label);
  requireCondition(
    value.bikeAsset === "ready"
      && value.root === "RRR_HeroBikeRider"
      && value.fallbackReason === null,
    `${label} does not prove the authored hero was ready without fallback`,
  );
}

function validateConsoleMessages(value, label) {
  requireCondition(Array.isArray(value), `${label} must be an array`);
  for (const message of value) {
    requireExactKeys(message, ["text", "type"], `${label}[]`);
    requireCondition(["error", "pageerror", "warning"].includes(message.type), `${label}[].type is invalid`);
    requireBoundedString(message.text, `${label}[].text`, 16_384);
  }
  return value;
}

function validateConsoleSummary(value, messages, label) {
  requireExactKeys(value, [
    "knownDiagnosticWarnings",
    "total",
    "unexpected",
    "unexpectedMessages",
  ], label);
  const knownDiagnosticWarnings = messages.filter((message) => (
    message.type === "warning" && KNOWN_PERFORMANCE_DIAGNOSTIC_WARNING.test(message.text)
  ));
  const unexpectedMessages = messages.filter((message) => !knownDiagnosticWarnings.includes(message));
  requireCondition(value.total === messages.length, `${label}.total does not match raw messages`);
  requireCondition(
    value.knownDiagnosticWarnings === knownDiagnosticWarnings.length,
    `${label}.knownDiagnosticWarnings does not match raw messages`,
  );
  requireCondition(value.unexpected === unexpectedMessages.length, `${label}.unexpected does not match raw messages`);
  requireExactJson(value.unexpectedMessages, unexpectedMessages, `${label}.unexpectedMessages`);
  requireCondition(unexpectedMessages.length === 0, `${label} contains unexpected console or page messages`);
}

function validateCandidateBuild(localBuild, manifest, label) {
  requireExactKeys(localBuild, [
    "aggregateSha256",
    "directory",
    "fileCount",
    "files",
    "totalBytes",
    "totalGzipBytes",
  ], label);
  requireCondition(localBuild.directory === "dist", `${label}.directory must be dist`);
  requireSha256(localBuild.aggregateSha256, `${label}.aggregateSha256`);
  requireCondition(localBuild.aggregateSha256 === manifest.aggregateSha256, `${label} aggregate does not match the release manifest`);
  requireCondition(Array.isArray(localBuild.files), `${label}.files must be an array`);
  requireCondition(localBuild.files.length === manifest.files.length, `${label}.files does not match the release manifest`);
  requireCondition(localBuild.fileCount === localBuild.files.length, `${label}.fileCount does not match its inventory`);
  requireCondition(localBuild.totalBytes === manifest.totalBytes, `${label}.totalBytes does not match the release manifest`);
  requireCondition(
    localBuild.totalGzipBytes === manifest.totalGzipBytes,
    `${label}.totalGzipBytes does not match the release manifest`,
  );
  requireFiniteNumber(
    manifest.totalGzipBytes,
    "release manifest totalGzipBytes",
    { minimum: 0, exclusiveMaximum: PERFORMANCE_BUDGETS.compressedBundleBytesExclusive },
  );

  const localByPath = new Map();
  let totalBytes = 0;
  let totalGzipBytes = 0;
  for (const record of localBuild.files) {
    requireExactKeys(record, ["bytes", "gzipBytes", "gzipSha256", "path", "sha256"], `${label}.files[]`);
    validateRelativePath(record.path, `${label}.files[].path`);
    requireCondition(!localByPath.has(record.path), `${label} duplicates ${record.path}`);
    requireCondition(Number.isSafeInteger(record.bytes) && record.bytes >= 0, `${label} has an invalid byte count for ${record.path}`);
    requireCondition(Number.isSafeInteger(record.gzipBytes) && record.gzipBytes >= 0, `${label} has an invalid gzip byte count for ${record.path}`);
    requireSha256(record.gzipSha256, `${label} ${record.path} gzip SHA-256`);
    requireSha256(record.sha256, `${label} ${record.path} SHA-256`);
    localByPath.set(record.path, record);
    totalBytes += record.bytes;
    totalGzipBytes += record.gzipBytes;
  }
  requireCondition(totalBytes === localBuild.totalBytes, `${label}.totalBytes is internally inconsistent`);
  requireCondition(totalGzipBytes === localBuild.totalGzipBytes, `${label}.totalGzipBytes is internally inconsistent`);
  for (const manifestRecord of manifest.files) {
    const localRecord = localByPath.get(manifestRecord.path);
    requireCondition(localRecord !== undefined, `${label} is missing ${manifestRecord.path}`);
    requireCondition(
      localRecord.bytes === manifestRecord.bytes
        && localRecord.sha256 === manifestRecord.sha256
        && localRecord.gzipBytes === manifestRecord.gzipBytes
        && localRecord.gzipSha256 === manifestRecord.gzipSha256,
      `${label} does not match the release manifest for ${manifestRecord.path}`,
    );
  }
}

function validateServedInventory(value, manifest, expectedBaseURL, label) {
  requireExactKeys(value, [
    "aggregateSha256",
    "baseURL",
    "entrypoint",
    "fileCount",
    "files",
    "origin",
    "totalBytes",
    "totalGzipBytes",
    "verified",
  ], label);
  requireCondition(value.verified === true, `${label} was not verified`);
  const baseURL = validateRootUrl(value.baseURL, `${label}.baseURL`);
  const expectedURL = validateRootUrl(expectedBaseURL, `${label} expected baseURL`);
  requireCondition(baseURL.href === expectedURL.href, `${label}.baseURL does not match the evidence root URL`);
  requireCondition(value.origin === expectedURL.origin, `${label}.origin does not match the evidence root URL`);
  requireCondition(value.fileCount === manifest.fileCount, `${label}.fileCount does not match the release manifest`);
  requireCondition(value.totalBytes === manifest.totalBytes, `${label}.totalBytes does not match the release manifest`);
  requireCondition(value.totalGzipBytes === manifest.totalGzipBytes, `${label}.totalGzipBytes does not match the release manifest`);
  requireCondition(value.aggregateSha256 === manifest.aggregateSha256, `${label}.aggregateSha256 does not match the release manifest`);
  requireCondition(Array.isArray(value.files) && value.files.length === manifest.files.length, `${label}.files is incomplete`);
  const servedByPath = new Map();
  for (const record of value.files) {
    requireExactKeys(record, ["bytes", "gzipBytes", "gzipSha256", "path", "sha256"], `${label}.files[]`);
    validateRelativePath(record.path, `${label}.files[].path`);
    requireCondition(!servedByPath.has(record.path), `${label}.files duplicates ${record.path}`);
    servedByPath.set(record.path, record);
  }
  for (const manifestRecord of manifest.files) {
    const servedRecord = servedByPath.get(manifestRecord.path);
    requireCondition(servedRecord !== undefined, `${label}.files is missing ${manifestRecord.path}`);
    requireCondition(
      servedRecord.bytes === manifestRecord.bytes
        && servedRecord.sha256 === manifestRecord.sha256
        && servedRecord.gzipBytes === manifestRecord.gzipBytes
        && servedRecord.gzipSha256 === manifestRecord.gzipSha256,
      `${label}.files does not match the release manifest for ${manifestRecord.path}`,
    );
  }
  const indexRecord = manifest.files.find((record) => record.path === "index.html");
  requireExactKeys(value.entrypoint, ["bytes", "finalURL", "requestedURL", "sha256"], `${label}.entrypoint`);
  requireCondition(value.entrypoint.requestedURL === expectedURL.href, `${label}.entrypoint.requestedURL does not match`);
  const finalURL = validateRootUrl(value.entrypoint.finalURL, `${label}.entrypoint.finalURL`);
  requireCondition(finalURL.origin === expectedURL.origin, `${label}.entrypoint.finalURL left the dedicated origin`);
  requireCondition(
    indexRecord !== undefined
      && value.entrypoint.bytes === indexRecord.bytes
      && value.entrypoint.sha256 === indexRecord.sha256,
    `${label}.entrypoint does not match manifest index.html`,
  );
}

function validatePerformanceCandidate(candidate, productRelease, version, manifest, baseURL, label) {
  requireExactKeys(candidate, ["localBuild", "servedAfter", "servedBefore", "source"], `${label}.candidate`);
  requireExactKeys(candidate.source, [
    "commit",
    "dirty",
    "dirtyEntryCount",
    "expectedTag",
    "expectedTagAnnotated",
    "expectedTagAtCommit",
    "expectedTagObjectType",
    "packageVersion",
    "tagsAtCommit",
  ], `${label}.candidate.source`);
  requireCondition(candidate.source.commit === productRelease.commit, `${label} source commit does not match product release`);
  requireCondition(candidate.source.packageVersion === version, `${label} package version does not match`);
  requireCondition(candidate.source.expectedTag === productRelease.tag, `${label} expected tag does not match`);
  requireCondition(candidate.source.expectedTagAtCommit === true, `${label} release tag was not present at the source commit`);
  requireCondition(candidate.source.expectedTagObjectType === "tag", `${label} release tag was not annotated`);
  requireCondition(candidate.source.expectedTagAnnotated === true, `${label} release tag annotation was not recorded`);
  requireCondition(
    Array.isArray(candidate.source.tagsAtCommit)
      && candidate.source.tagsAtCommit.includes(productRelease.tag)
      && new Set(candidate.source.tagsAtCommit).size === candidate.source.tagsAtCommit.length,
    `${label} tags-at-commit evidence is incomplete`,
  );
  requireCondition(candidate.source.dirty === false && candidate.source.dirtyEntryCount === 0, `${label} source was dirty`);
  validateCandidateBuild(candidate.localBuild, manifest, `${label}.candidate.localBuild`);
  for (const phase of ["servedBefore", "servedAfter"]) {
    validateServedInventory(candidate[phase], manifest, baseURL, `${label}.candidate.${phase}`);
  }
  return candidate.localBuild.aggregateSha256;
}

function validatePerformanceSetup(value, label) {
  requireExactKeys(value, [
    "bestSoloMs",
    "database",
    "expectedTrackIds",
    "method",
    "nativeIndexedDbVersion",
    "profileId",
    "rivalUnlocked",
    "trackId",
    "verifiedViaPublicUi",
  ], label);
  requireCondition(value.method === "native-indexeddb-progress-record", `${label}.method does not match`);
  requireCondition(value.database === "rivet-ridge-rally", `${label}.database does not match`);
  requireCondition(value.nativeIndexedDbVersion === 60, `${label}.nativeIndexedDbVersion must be 60`);
  requireCondition(value.profileId === "rider-01", `${label}.profileId does not match`);
  requireCondition(value.trackId === "canyon-kickoff", `${label}.trackId does not match`);
  requireCondition(value.bestSoloMs === 190_000, `${label}.bestSoloMs does not match the qualifying target`);
  requireCondition(value.rivalUnlocked === true, `${label}.rivalUnlocked must be true`);
  requireCondition(value.verifiedViaPublicUi === true, `${label}.verifiedViaPublicUi must be true`);
  requireExactJson(value.expectedTrackIds, PERFORMANCE_EXPECTED_TRACK_IDS, `${label}.expectedTrackIds`);
}

function validateProfileMetric(metric, budget, label) {
  requireExactKeys(metric, [
    "drawCalls",
    "durationMs",
    "fps",
    "frameTimeMs",
    "frameWork",
    "sampleCount",
    "samples",
  ], label);
  requireCondition(metric.durationMs === PERFORMANCE_SAMPLE_SECONDS * 1_000, `${label}.durationMs does not match the release contract`);
  requireCondition(Array.isArray(metric.samples), `${label}.samples must be an array`);
  const minimumSamples = Math.max(2, Math.floor(metric.durationMs / RENDER_SAMPLE_MAXIMUM_GAP_MS));
  requireCondition(metric.samples.length >= minimumSamples, `${label}.samples does not meet the release minimum`);
  requireCondition(metric.sampleCount === metric.samples.length, `${label}.sampleCount does not match raw samples`);
  let priorElapsedMs = -1;
  for (const sample of metric.samples) {
    requireExactKeys(sample, [
      "drawCalls",
      "droppedSimulationMs",
      "elapsedMs",
      "fps",
      "frameTimeMs",
    ], `${label}.samples[]`);
    requireFiniteNumber(sample.elapsedMs, `${label}.samples[].elapsedMs`, { minimum: 0, maximum: metric.durationMs });
    requireCondition(sample.elapsedMs > priorElapsedMs, `${label}.samples elapsedMs must strictly increase`);
    if (priorElapsedMs >= 0) {
      requireCondition(
        sample.elapsedMs - priorElapsedMs <= RENDER_SAMPLE_MAXIMUM_GAP_MS,
        `${label}.samples exceed the maximum sampling gap`,
      );
    }
    priorElapsedMs = sample.elapsedMs;
    requireFiniteNumber(sample.fps, `${label}.samples[].fps`, { minimum: Number.EPSILON });
    requireFiniteNumber(sample.frameTimeMs, `${label}.samples[].frameTimeMs`, { minimum: 0 });
    requireCondition(Number.isSafeInteger(sample.drawCalls) && sample.drawCalls >= 0, `${label}.samples[].drawCalls must be a non-negative safe integer`);
    if (sample.droppedSimulationMs !== null) {
      requireFiniteNumber(sample.droppedSimulationMs, `${label}.samples[].droppedSimulationMs`, { minimum: 0 });
    }
  }
  requireCondition(
    metric.samples.at(-1).elapsedMs - metric.samples[0].elapsedMs >= metric.durationMs - RENDER_SAMPLE_MAXIMUM_GAP_MS,
    `${label}.samples do not cover the configured rendering window`,
  );
  const recomputedFps = summarizeMetric(metric.samples.map((sample) => sample.fps));
  const recomputedFrameTime = summarizeMetric(metric.samples.map((sample) => sample.frameTimeMs));
  const recomputedDrawCalls = summarizeMetric(metric.samples.map((sample) => sample.drawCalls));
  requireExactJson(metric.fps, recomputedFps, `${label}.fps`);
  requireExactJson(metric.frameTimeMs, recomputedFrameTime, `${label}.frameTimeMs`);
  requireExactJson(metric.drawCalls, recomputedDrawCalls, `${label}.drawCalls`);

  const frameWork = requireObject(metric.frameWork, `${label}.frameWork`);
  requireExactKeys(frameWork, [
    "apiVersion",
    "frameWorkMs",
    "maximumSamples",
    "meanFps",
    "measuredDurationMs",
    "method",
    "overflowed",
    "sampleCount",
    "samples",
    "scope",
    "visibilityLost",
  ], `${label}.frameWork`);
  requireCondition(frameWork.apiVersion === 1, `${label}.frameWork.apiVersion must be 1`);
  requireCondition(
    frameWork.method === "pre-navigation-request-animation-frame-callback-work",
    `${label}.frameWork.method does not match the capture contract`,
  );
  requireCondition(
    frameWork.scope === "synchronous-requestAnimationFrame-callback-cpu-work-only-excludes-style-layout-paint-gpu-and-microtasks",
    `${label}.frameWork.scope does not match the capture contract`,
  );
  requireCondition(frameWork.maximumSamples === MAXIMUM_FRAME_WORK_SAMPLES, `${label}.frameWork.maximumSamples does not match`);
  requireCondition(frameWork.overflowed === false, `${label}.frameWork overflowed`);
  requireCondition(frameWork.visibilityLost === false, `${label}.frameWork lost page visibility`);
  requireFiniteNumber(frameWork.measuredDurationMs, `${label}.frameWork.measuredDurationMs`, {
    minimum: metric.durationMs,
    maximum: metric.durationMs + RENDER_SAMPLE_MAXIMUM_GAP_MS,
  });
  requireCondition(Array.isArray(frameWork.samples), `${label}.frameWork.samples must be an array`);
  requireCondition(frameWork.samples.length >= 2, `${label}.frameWork.samples must contain at least two raw frames`);
  requireCondition(frameWork.samples.length <= MAXIMUM_FRAME_WORK_SAMPLES, `${label}.frameWork.samples exceeds its bound`);
  requireCondition(frameWork.sampleCount === frameWork.samples.length, `${label}.frameWork.sampleCount does not match raw samples`);
  let priorFrameTimestampMs = -1;
  let priorFrameElapsedMs = -1;
  for (const sample of frameWork.samples) {
    requireExactKeys(sample, ["callbackCount", "elapsedMs", "frameTimestampMs", "frameWorkMs"], `${label}.frameWork.samples[]`);
    requireFiniteNumber(sample.elapsedMs, `${label}.frameWork.samples[].elapsedMs`, {
      minimum: 0,
      maximum: frameWork.measuredDurationMs,
    });
    requireFiniteNumber(sample.frameTimestampMs, `${label}.frameWork.samples[].frameTimestampMs`, { minimum: 0 });
    requireFiniteNumber(sample.frameWorkMs, `${label}.frameWork.samples[].frameWorkMs`, { minimum: 0 });
    requireCondition(Number.isSafeInteger(sample.callbackCount) && sample.callbackCount > 0, `${label}.frameWork.samples[].callbackCount must be a positive safe integer`);
    requireCondition(sample.elapsedMs > priorFrameElapsedMs, `${label}.frameWork elapsedMs must strictly increase`);
    requireCondition(sample.frameTimestampMs > priorFrameTimestampMs, `${label}.frameWork frameTimestampMs must strictly increase`);
    if (priorFrameTimestampMs >= 0) {
      const timestampGap = sample.frameTimestampMs - priorFrameTimestampMs;
      const elapsedGap = sample.elapsedMs - priorFrameElapsedMs;
      requireCondition(timestampGap <= RENDER_SAMPLE_MAXIMUM_GAP_MS, `${label}.frameWork timestamp gap exceeds the maximum`);
      requireCondition(Math.abs(timestampGap - elapsedGap) <= 0.01, `${label}.frameWork timestamp and elapsed deltas diverge`);
    }
    priorFrameTimestampMs = sample.frameTimestampMs;
    priorFrameElapsedMs = sample.elapsedMs;
  }
  requireCondition(frameWork.samples[0].elapsedMs <= RENDER_SAMPLE_ENDPOINT_TOLERANCE_MS, `${label}.frameWork starts too late`);
  requireCondition(
    frameWork.measuredDurationMs - frameWork.samples.at(-1).elapsedMs <= RENDER_SAMPLE_ENDPOINT_TOLERANCE_MS,
    `${label}.frameWork ends too early`,
  );
  requireCondition(
    frameWork.samples.at(-1).frameTimestampMs - frameWork.samples[0].frameTimestampMs
      >= frameWork.measuredDurationMs - (2 * RENDER_SAMPLE_ENDPOINT_TOLERANCE_MS),
    `${label}.frameWork does not cover the five-second measurement window`,
  );
  const recomputedFrameWork = summarizeMetric(frameWork.samples.map((sample) => sample.frameWorkMs));
  const recomputedRawFps = rawFrameRateMetric(frameWork.samples);
  requireExactJson(frameWork.frameWorkMs, recomputedFrameWork, `${label}.frameWork.frameWorkMs`);
  requireCondition(frameWork.meanFps === recomputedRawFps, `${label}.frameWork.meanFps does not match raw timestamps`);
  requireFiniteNumber(recomputedRawFps, `${label} recomputed raw meanFps`, { minimum: budget.meanFpsAtLeast });
  requireFiniteNumber(recomputedFrameWork.p95, `${label} recomputed frameWorkMs.p95`, {
    minimum: 0,
    maximum: budget.frameWorkP95MsAtMost,
  });
}

function validatePerformanceConfiguration(configuration) {
  requireExactKeys(configuration, [
    "budgets",
    "productBuildRequired",
    "qualityPolicy",
    "releaseRequiresHeaded",
    "sampleSeconds",
  ], "headed performance configuration");
  requireCondition(configuration.sampleSeconds === PERFORMANCE_SAMPLE_SECONDS, "headed performance sample duration does not match the release contract");
  requireCondition(configuration.productBuildRequired === true, "headed performance product-build requirement is missing");
  requireCondition(configuration.releaseRequiresHeaded === true, "headed performance release policy is missing");
  requireExactJson(configuration.qualityPolicy, {
    type: "explicit-per-profile",
    desktop: "high",
    mobile: "low",
  }, "headed performance configuration.qualityPolicy");
  requireExactKeys(
    configuration.budgets,
    ["compressedBundleBytesExclusive", "desktop", "emulatedMobile"],
    "headed performance configuration.budgets",
  );
  requireCondition(
    configuration.budgets.compressedBundleBytesExclusive === PERFORMANCE_BUDGETS.compressedBundleBytesExclusive,
    "headed performance compressed-bundle budget does not match the release contract",
  );
  for (const [name, key] of [["desktop", "desktop"], ["emulatedMobile", "mobile"]]) {
    const recorded = requireObject(configuration.budgets[name], `headed performance configuration.budgets.${name}`);
    const required = PERFORMANCE_BUDGETS[key];
    requireExactKeys(
      recorded,
      name === "desktop"
        ? ["acceptanceFloorMeanFps", "frameWorkP95MsInclusive", "targetFps"]
        : ["acceptanceFloorMeanFps", "frameWorkP95MsInclusive", "physicalDeviceProof", "targetFps"],
      `headed performance configuration.budgets.${name}`,
    );
    requireCondition(
      recorded.acceptanceFloorMeanFps === required.meanFpsAtLeast
        && recorded.frameWorkP95MsInclusive === required.frameWorkP95MsAtMost,
      `headed performance ${name} budget does not match the release contract`,
    );
    requireCondition(recorded.targetFps === (name === "desktop" ? 60 : 30), `headed performance ${name} target FPS does not match`);
    if (name === "emulatedMobile") {
      requireCondition(recorded.physicalDeviceProof === false, "headed performance mobile physical-device scope is invalid");
    }
  }
}

export function validatePerformanceEvidence(value, productRelease, version, manifest) {
  requireExactKeys(value, [
    "automatedGate",
    "baseURL",
    "browser",
    "candidate",
    "completedAt",
    "configuration",
    "consoleSummary",
    "createdAt",
    "durationMs",
    "harnessErrors",
    "host",
    "kind",
    "profiles",
    "schemaVersion",
    "startedAt",
    "status",
  ], "headed performance evidence");
  requireCondition(value.schemaVersion === 4, "headed performance schemaVersion must be 4");
  requireCondition(value.kind === "performance-measurement", "headed performance kind does not match");
  requireCondition(value.status === "PASS", "headed performance status must be PASS");
  requireTimestamp(value.startedAt, "headed performance startedAt");
  requireTimestamp(value.completedAt, "headed performance completedAt");
  requireTimestamp(value.createdAt, "headed performance createdAt");
  requireCondition(Date.parse(value.startedAt) <= Date.parse(value.completedAt), "headed performance completed before it started");
  requireCondition(value.createdAt === value.completedAt, "headed performance createdAt must equal completedAt");
  validateRecordedDuration(value.durationMs, value.startedAt, value.completedAt, "headed performance durationMs");
  validateRootUrl(value.baseURL, "headed performance baseURL");
  requireExactKeys(value.browser, ["headless", "name", "version"], "headed performance browser");
  requireCondition(
    value.browser.name === "chromium"
      && typeof value.browser.version === "string"
      && value.browser.version.length > 0
      && value.browser.headless === false,
    "headed performance must identify a headed Chromium build",
  );
  requireObject(value.host, "headed performance host");
  requireBoundedString(value.host.node, "headed performance host.node");
  requireBoundedString(value.host.platform, "headed performance host.platform");
  requireBoundedString(value.host.architecture, "headed performance host.architecture");
  validatePerformanceConfiguration(value.configuration);
  requireCondition(Array.isArray(value.harnessErrors) && value.harnessErrors.length === 0, "headed performance contains harness errors");
  const aggregate = validatePerformanceCandidate(value.candidate, productRelease, version, manifest, value.baseURL, "headed performance");
  requirePassingCriteria(value.automatedGate, PERFORMANCE_CRITERIA, "headed performance automatedGate", {
    exactKeys: ["criteria", "failedCriteria", "manualBudgetReviewRequired", "mobileEvidenceScope", "status"],
    criterionKeys: PERFORMANCE_CRITERION_KEYS,
  });
  requireCondition(value.automatedGate.manualBudgetReviewRequired === true, "headed performance manual budget review flag is missing");
  requireCondition(
    value.automatedGate.mobileEvidenceScope === "emulated/local technical floor; physical-device acceptance remains required",
    "headed performance mobile evidence scope does not match",
  );
  requireCondition(Array.isArray(value.profiles) && value.profiles.length === 2, "headed performance must contain two profiles");
  const profileNames = value.profiles.map((profile) => profile?.name);
  requireCondition(
    new Set(profileNames).size === profileNames.length
      && JSON.stringify(profileNames.toSorted()) === JSON.stringify(Object.keys(PERFORMANCE_PROFILES).toSorted()),
    "headed performance profile set does not match the release contract",
  );
  const allConsoleMessages = [];
  for (const profile of value.profiles) {
    const label = `headed performance profile ${profile.name}`;
    const budget = PERFORMANCE_PROFILES[profile.name];
    requireExactKeys(profile, [
      "authoredHero",
      "completed",
      "consoleMessages",
      "device",
      "deviceScaleFactor",
      "editor",
      "emulation",
      "error",
      "firstRaceLoadMs",
      "heaps",
      "name",
      "navigation",
      "network",
      "quality",
      "rendering",
      "restartMs",
      "scope",
      "screenshot",
      "stress",
      "stressProof",
      "runtime",
      "viewport",
    ], label);
    requireCondition(profile.completed === true && profile.error === null, `${label} did not complete successfully`);
    requireCondition(profile.scope === budget.scope, `${label}.scope does not match the profile contract`);
    requireExactJson(profile.viewport, budget.viewport, `${label}.viewport`);
    requireCondition(profile.deviceScaleFactor === budget.deviceScaleFactor, `${label}.deviceScaleFactor does not match the profile contract`);
    requireExactJson(profile.emulation, budget.emulation, `${label}.emulation`);
    validateQualityEvidence(profile.quality, budget.quality, `${label}.quality`);
    validateAuthoredHeroEvidence(profile.authoredHero, `${label}.authoredHero`);
    validateRuntimeEvidence(profile.runtime, productRelease, version, `${label}.runtime`);
    requireFiniteNumber(profile.firstRaceLoadMs, `${label}.firstRaceLoadMs`, {
      minimum: Number.EPSILON,
      maximum: value.durationMs,
    });
    requireFiniteNumber(profile.restartMs, `${label}.restartMs`, {
      minimum: Number.EPSILON,
      maximum: value.durationMs,
    });
    requireExactKeys(profile.stressProof, [
      "cue",
      "cueDeadlineMs",
      "driveStartedMs",
      "lane",
      "method",
      "mode",
      "raceElapsedMs",
      "raceGatePhase",
      "recoveryPromptVisible",
      "trackId",
      "wheelieArmOffsetMs",
      "wheelieKey",
    ], `${label}.stressProof`);
    requireCondition(
      profile.stressProof.method === "public-ui-canyon-rival-timed-wheelie"
        && profile.stressProof.trackId === "canyon-kickoff"
        && profile.stressProof.mode === "rival"
        && profile.stressProof.lane === "lane-2-after-one-ArrowRight"
        && profile.stressProof.wheelieKey === "ArrowUp"
        && profile.stressProof.cue === "Front wheel clear — bump speed held"
        && profile.stressProof.cueDeadlineMs === 5_000
        && profile.stressProof.wheelieArmOffsetMs === 2_800
        && profile.stressProof.raceGatePhase === "racing"
        && profile.stressProof.recoveryPromptVisible === false,
      `${label}.stressProof does not identify the controlled Rival obstacle workload`,
    );
    requireFiniteNumber(profile.stressProof.raceElapsedMs, `${label}.stressProof.raceElapsedMs`, {
      minimum: 3_150,
      maximum: profile.stressProof.cueDeadlineMs,
    });
    requireFiniteNumber(profile.stressProof.driveStartedMs, `${label}.stressProof.driveStartedMs`, {
      minimum: 0,
      maximum: 1_500,
    });
    requireCondition(
      profile.stressProof.raceElapsedMs >= profile.stressProof.driveStartedMs + profile.stressProof.wheelieArmOffsetMs,
      `${label}.stressProof wheelie cue predates its timed drive setup`,
    );
    requireObject(profile.device, `${label}.device`);
    requireExactJson(profile.device.viewport, budget.viewport, `${label}.device.viewport`);
    requireCondition(profile.device.devicePixelRatio === budget.deviceScaleFactor, `${label}.device.devicePixelRatio does not match the profile contract`);
    requireExactKeys(
      profile.network,
      ["completeFlow", "failedRequests", "httpErrorResponses", "shell"],
      `${label}.network`,
    );
    requireCondition(
      Array.isArray(profile.network.failedRequests)
        && profile.network.failedRequests.length === 0
        && Array.isArray(profile.network.httpErrorResponses)
        && profile.network.httpErrorResponses.length === 0,
      `${label} contains request failures`,
    );
    requireCondition(Array.isArray(profile.heaps) && profile.heaps.length === PERFORMANCE_HEAP_STAGES.length, `${label} heap samples are incomplete`);
    for (const heap of profile.heaps) {
      requireExactKeys(heap, ["available", "stage", "totalBytes", "usedBytes"], `${label}.heaps[]`);
      requireCondition(typeof heap.stage === "string", `${label}.heaps[].stage is invalid`);
      requireFiniteNumber(heap.usedBytes, `${label}.heaps[].usedBytes`, { minimum: 0 });
      requireFiniteNumber(heap.totalBytes, `${label}.heaps[].totalBytes`, { minimum: heap.usedBytes });
    }
    requireCondition(
      JSON.stringify(profile.heaps.map((heap) => heap.stage).toSorted()) === JSON.stringify(PERFORMANCE_HEAP_STAGES),
      `${label} heap stage set does not match the measurement journey`,
    );
    requireCondition(profile.heaps.every((heap) => heap?.available === true), `${label} has unavailable heap samples`);
    requireExactKeys(
      profile.editor,
      ["openMs", "testPlayMs", "testRideControlVisible", "testRideInvocation"],
      `${label}.editor`,
    );
    requireFiniteNumber(profile.editor.openMs, `${label}.editor.openMs`, { minimum: Number.EPSILON, maximum: value.durationMs });
    requireFiniteNumber(profile.editor.testPlayMs, `${label}.editor.testPlayMs`, { minimum: Number.EPSILON, maximum: value.durationMs });
    requireCondition(profile.editor.testRideControlVisible === true, `${label} did not expose Test Ride`);
    requireCondition(profile.editor.testRideInvocation === "visible-control", `${label} did not invoke the visible Test Ride control`);
    requireExactKeys(profile.navigation, ["progressSetup", "shellReadyMs", "status", "timing"], `${label}.navigation`);
    requireCondition(Number.isSafeInteger(profile.navigation.status) && profile.navigation.status >= 200 && profile.navigation.status < 300, `${label}.navigation.status is not successful`);
    requireFiniteNumber(profile.navigation.shellReadyMs, `${label}.navigation.shellReadyMs`, { minimum: 0, maximum: value.durationMs });
    requireObject(profile.navigation.timing, `${label}.navigation.timing`);
    validatePerformanceSetup(profile.navigation.progressSetup, `${label}.navigation.progressSetup`);
    validateConsoleMessages(profile.consoleMessages, `${label}.consoleMessages`);
    allConsoleMessages.push(...profile.consoleMessages);
    if (profile.screenshot !== null) validateRelativePath(profile.screenshot, `${label}.screenshot`);
    validateProfileMetric(profile.rendering, budget, `${label}.rendering`);
    validateProfileMetric(profile.stress, budget, `${label}.stress`);
  }
  validateConsoleSummary(value.consoleSummary, allConsoleMessages, "headed performance consoleSummary");
  return { aggregate, createdAt: value.createdAt, completedAt: value.completedAt };
}

export function validateSoakEvidence(value, productRelease, version, manifest) {
  requireExactKeys(value, [
    "actualDurationMs",
    "baseURL",
    "browser",
    "candidate",
    "completedAt",
    "completedRaces",
    "completedRaceEvidence",
    "configuration",
    "consoleMessages",
    "consoleSummary",
    "createdAt",
    "device",
    "diagnosticGate",
    "fixedStepTiming",
    "harnessError",
    "harnessErrors",
    "host",
    "inputResponsiveness",
    "kind",
    "memory",
    "network",
    "racingClock",
    "releaseGate",
    "restartSummaryMs",
    "restartTimesMs",
    "runtime",
    "samples",
    "schemaVersion",
    "setup",
    "startedAt",
    "status",
    "timedOutRaces",
    "wallWorkloadDurationMs",
    "workloadDurationMs",
  ], "soak evidence");
  requireCondition(value.schemaVersion === 4, "soak schemaVersion must be 4");
  requireCondition(value.kind === "performance-soak", "soak kind does not match");
  requireCondition(value.status === "PASS", "soak status must be PASS");
  requireTimestamp(value.startedAt, "soak startedAt");
  requireTimestamp(value.completedAt, "soak completedAt");
  requireTimestamp(value.createdAt, "soak createdAt");
  requireCondition(Date.parse(value.startedAt) <= Date.parse(value.completedAt), "soak completed before it started");
  requireCondition(value.createdAt === value.completedAt, "soak createdAt must equal completedAt");
  validateRecordedDuration(value.actualDurationMs, value.startedAt, value.completedAt, "soak actualDurationMs");
  validateRootUrl(value.baseURL, "soak baseURL");
  requireExactKeys(value.browser, ["headless", "name", "version"], "soak browser");
  requireCondition(
    value.browser.name === "chromium"
      && typeof value.browser.version === "string"
      && value.browser.version.length > 0
      && value.browser.headless === false,
    "soak must identify a headed Chromium build",
  );
  requireObject(value.host, "soak host");
  requireBoundedString(value.host.node, "soak host.node");
  requireBoundedString(value.host.platform, "soak host.platform");
  requireBoundedString(value.host.architecture, "soak host.architecture");
  requireExactKeys(value.configuration, [
    "attemptTimeoutMs",
    "configuredDurationMs",
    "controlPolicy",
    "emulation",
    "minutes",
    "mode",
    "profile",
    "qualification",
    "quality",
    "sampleIntervalSeconds",
    "viewport",
    "workloadDurationBasis",
  ], "soak configuration");
  requireExactJson(value.configuration.controlPolicy, {
    throttle: "held-KeyW",
    recovery: "held-Space-recovery-only",
    turboPulseTargetMs: 520,
    turboCoastTargetMs: 620,
    lane: "right-edge-restored-after-ArrowLeft-input-probe",
  }, "soak configuration.controlPolicy");
  requireCondition(value.configuration.mode === "rival", "soak must use Rival mode");
  requireCondition(value.configuration.qualification === "release", "soak must be a release qualification");
  requireCondition(
    value.configuration.workloadDurationBasis === "mutation-observed-game-shell-racing-gate",
    "soak workload duration basis does not match the racing-gate contract",
  );
  requireFiniteNumber(value.configuration.minutes, "soak configuration.minutes", { minimum: 30, maximum: 24 * 60 });
  requireCondition(
    Number.isSafeInteger(value.configuration.configuredDurationMs),
    "soak configuration.configuredDurationMs must be a safe integer",
  );
  requireCondition(
    value.configuration.configuredDurationMs === value.configuration.minutes * 60_000,
    "soak configured duration does not match its minutes",
  );
  requireCondition(
    value.configuration.attemptTimeoutMs === PRODUCTION_RIVAL_ATTEMPT_TIMEOUT_MS,
    "soak attempt timeout does not match the full-production Rival contract",
  );
  requireFiniteNumber(
    value.configuration.sampleIntervalSeconds,
    "soak configuration.sampleIntervalSeconds",
    { minimum: Number.EPSILON, maximum: MAXIMUM_RELEASE_SOAK_SAMPLE_INTERVAL_SECONDS },
  );
  const soakProfile = SOAK_PROFILES[value.configuration.profile];
  requireCondition(soakProfile !== undefined, "soak configuration.profile does not match the release contract");
  requireExactJson(value.configuration.viewport, soakProfile.viewport, "soak configuration.viewport");
  requireExactJson(value.configuration.emulation, soakProfile.emulation, "soak configuration.emulation");
  requireObject(value.device, "soak device");
  requireExactJson(value.device.viewport, soakProfile.viewport, "soak device.viewport");
  requireCondition(value.device.devicePixelRatio === soakProfile.deviceScaleFactor, "soak device.devicePixelRatio does not match its profile");
  const soakWebgl = requireObject(value.device.webgl, "soak device.webgl");
  requireBoundedString(soakWebgl.vendor, "soak device.webgl.vendor");
  requireBoundedString(soakWebgl.renderer, "soak device.webgl.renderer");
  requireCondition(
    !/(?:SwiftShader|llvmpipe|software rasterizer)/iu.test(`${soakWebgl.vendor} ${soakWebgl.renderer}`),
    "soak must use hardware-backed WebGL",
  );
  requireCondition(Number.isSafeInteger(value.workloadDurationMs), "soak workloadDurationMs must be a safe integer");
  requireCondition(Number.isSafeInteger(value.wallWorkloadDurationMs), "soak wallWorkloadDurationMs must be a safe integer");
  requireCondition(value.wallWorkloadDurationMs >= value.workloadDurationMs, "soak wall workload is shorter than active racing time");
  requireCondition(value.actualDurationMs >= value.wallWorkloadDurationMs, "soak total duration is shorter than its wall workload");
  requireExactKeys(value.racingClock, [
    "apiVersion",
    "durationMs",
    "maximumTransitions",
    "measuredDurationMs",
    "method",
    "overflowed",
    "transitionCount",
    "transitions",
    "visibilityLost",
  ], "soak racingClock");
  requireCondition(value.racingClock.apiVersion === 1, "soak racingClock.apiVersion must be 1");
  requireCondition(value.racingClock.method === "mutation-observed-game-shell-racing-gate", "soak racingClock.method does not match");
  requireCondition(value.racingClock.maximumTransitions === MAXIMUM_RACING_CLOCK_TRANSITIONS, "soak racingClock.maximumTransitions does not match");
  requireCondition(value.racingClock.overflowed === false, "soak racingClock overflowed");
  requireCondition(value.racingClock.visibilityLost === false, "soak racingClock lost page visibility");
  requireFiniteNumber(value.racingClock.measuredDurationMs, "soak racingClock.measuredDurationMs", { minimum: value.workloadDurationMs });
  requireCondition(
    Math.abs(value.wallWorkloadDurationMs - value.racingClock.measuredDurationMs) <= 1_000,
    "soak racingClock measured duration does not match wall workload duration",
  );
  requireCondition(Array.isArray(value.racingClock.transitions) && value.racingClock.transitions.length > 0, "soak racingClock.transitions must be non-empty");
  requireCondition(value.racingClock.transitions.length <= MAXIMUM_RACING_CLOCK_TRANSITIONS, "soak racingClock.transitions exceeds its bound");
  requireCondition(value.racingClock.transitionCount === value.racingClock.transitions.length, "soak racingClock.transitionCount does not match raw transitions");
  let previousTransitionElapsedMs = -1;
  let previousRacingState = null;
  let recomputedRacingDurationMs = 0;
  for (const [index, transition] of value.racingClock.transitions.entries()) {
    requireExactKeys(transition, ["elapsedMs", "racing"], "soak racingClock.transitions[]");
    requireFiniteNumber(transition.elapsedMs, "soak racingClock.transitions[].elapsedMs", {
      minimum: 0,
      maximum: value.racingClock.measuredDurationMs,
    });
    requireCondition(typeof transition.racing === "boolean", "soak racingClock.transitions[].racing must be boolean");
    if (index === 0) {
      requireCondition(transition.elapsedMs === 0, "soak racingClock first transition must start at zero");
      requireCondition(transition.racing === true, "soak racingClock first transition must begin in racing state");
    } else {
      requireCondition(transition.elapsedMs > previousTransitionElapsedMs, "soak racingClock transition times must strictly increase");
      requireCondition(transition.racing !== previousRacingState, "soak racingClock transitions must alternate state");
      if (previousRacingState) recomputedRacingDurationMs += transition.elapsedMs - previousTransitionElapsedMs;
    }
    previousTransitionElapsedMs = transition.elapsedMs;
    previousRacingState = transition.racing;
  }
  if (previousRacingState) {
    recomputedRacingDurationMs += value.racingClock.measuredDurationMs - previousTransitionElapsedMs;
  }
  requireCondition(
    Math.abs(value.racingClock.durationMs - roundMetric(recomputedRacingDurationMs, 3)) <= 0.1,
    "soak racingClock.durationMs does not match raw transitions",
  );
  requireCondition(Math.round(value.racingClock.durationMs) === value.workloadDurationMs, "soak racingClock duration does not match active workload");
  requireCondition(value.configuration.configuredDurationMs >= MINIMUM_SOAK_DURATION_MS, "soak configured duration is under 30 minutes");
  requireCondition(value.workloadDurationMs >= MINIMUM_SOAK_DURATION_MS, "soak active workload is under 30 minutes");
  requireCondition(value.workloadDurationMs >= value.configuration.configuredDurationMs, "soak did not complete its configured duration");
  requireCondition(Number.isSafeInteger(value.completedRaces) && value.completedRaces >= 2, "soak completed fewer than two races");
  requireCondition(
    Array.isArray(value.completedRaceEvidence)
      && value.completedRaceEvidence.length === value.completedRaces,
    "soak completedRaceEvidence must prove every completed race",
  );
  for (const [index, completion] of value.completedRaceEvidence.entries()) {
    requireExactKeys(completion, [
      "attempt",
      "breakdownLabels",
      "classificationLabel",
      "classificationRows",
      "crashes",
      "fatalScreenVisible",
      "finalTime",
      "lapTimes",
      "mode",
      "overheats",
      "positionLabel",
      "resultVisible",
      "retryVisible",
    ], "soak completedRaceEvidence[]");
    requireCondition(completion.attempt === index + 1, "soak completed-race attempts must be contiguous");
    requireCondition(
      completion.mode === "rival"
        && completion.resultVisible === true
        && completion.retryVisible === true
        && completion.fatalScreenVisible === false,
      "soak completedRaceEvidence does not prove a public Rival result",
    );
    requireCondition(
      /^\d+:\d{2}\.\d{2}$/u.test(completion.finalTime),
      "soak completedRaceEvidence final time is invalid",
    );
    requireExactJson(
      completion.breakdownLabels,
      ["Lap 1", "Lap 2", "Target gap", "Crashes", "Overheats"],
      "soak completedRaceEvidence breakdown labels",
    );
    requireCondition(
      Array.isArray(completion.lapTimes)
        && completion.lapTimes.length === 2
        && completion.lapTimes.every((lapTime) => /^\d+:\d{2}\.\d{2}$/u.test(lapTime)),
      "soak completedRaceEvidence lap times are incomplete",
    );
    requireCondition(
      Number.isSafeInteger(completion.crashes)
        && completion.crashes >= 0
        && Number.isSafeInteger(completion.overheats)
        && completion.overheats >= 0,
      "soak completedRaceEvidence crash/overheat counts are invalid",
    );
    requireCondition(
      /^(?:Position|POSITION) [1-6] \/ 6$/u.test(completion.positionLabel)
        && completion.classificationLabel === "Official 6-rider classification"
        && completion.classificationRows === 6,
      "soak completedRaceEvidence classification is incomplete",
    );
  }
  requireCondition(value.timedOutRaces === 0, "soak contains timed-out races");
  requireCondition(value.harnessError === null, "soak contains a harness error");
  requireCondition(Array.isArray(value.harnessErrors) && value.harnessErrors.length === 0, "soak contains harness errors");
  requireCondition(Array.isArray(value.restartTimesMs), "soak restartTimesMs must be an array");
  requireCondition(
    value.restartTimesMs.length === value.completedRaces,
    "soak restartTimesMs must contain one public restart timing per completed race",
  );
  for (const restartMs of value.restartTimesMs) {
    requireFiniteNumber(restartMs, "soak restartTimesMs[]", {
      minimum: Number.EPSILON,
      maximum: value.actualDurationMs,
    });
  }
  requireExactJson(value.restartSummaryMs, summarizeMetric(value.restartTimesMs), "soak restartSummaryMs");
  validateQualityEvidence(value.configuration.quality, soakProfile.quality, "soak configuration.quality");
  validateRuntimeEvidence(value.runtime, productRelease, version, "soak runtime");
  validatePerformanceSetup(value.setup, "soak setup");
  const aggregate = validatePerformanceCandidate(value.candidate, productRelease, version, manifest, value.baseURL, "soak");
  requireExactKeys(value.network, [
    "failedRequestCount",
    "failedRequests",
    "httpErrorResponseCount",
    "httpErrorResponses",
  ], "soak network");
  requireCondition(
    value.network.failedRequestCount === 0
      && value.network.httpErrorResponseCount === 0
      && Array.isArray(value.network.failedRequests)
      && value.network.failedRequests.length === 0
      && Array.isArray(value.network.httpErrorResponses)
      && value.network.httpErrorResponses.length === 0,
    "soak contains request failures",
  );
  validateConsoleMessages(value.consoleMessages, "soak consoleMessages");
  validateConsoleSummary(value.consoleSummary, value.consoleMessages, "soak consoleSummary");
  const sampleIntervalMs = value.configuration.sampleIntervalSeconds * 1_000;
  const maximumSampleGapMs = sampleIntervalMs * SOAK_SAMPLE_WINDOW_TOLERANCE_INTERVALS;
  const minimumSamples = Math.max(
    2,
    Math.floor(value.configuration.configuredDurationMs / maximumSampleGapMs),
  );
  requireCondition(
    Array.isArray(value.samples) && value.samples.length >= minimumSamples,
    "soak measured samples do not meet the duration/cadence minimum",
  );
  let priorCumulative = -Infinity;
  let priorElapsedMs = -1;
  for (const sample of value.samples) {
    requireExactKeys(sample, [
      "attempt",
      "cumulativeDroppedSimulationMs",
      "elapsedMs",
      "heap",
      "hud",
      "input",
      "race",
    ], "soak samples[]");
    requireCondition(Number.isSafeInteger(sample?.elapsedMs) && sample.elapsedMs >= 0, "soak sample elapsedMs must be a non-negative safe integer");
    requireCondition(sample.elapsedMs <= value.actualDurationMs, "soak sample elapsedMs exceeds the recorded run duration");
    requireCondition(sample.elapsedMs > priorElapsedMs, "soak sample elapsedMs values must strictly increase");
    if (priorElapsedMs >= 0) {
      requireCondition(
        sample.elapsedMs - priorElapsedMs <= maximumSampleGapMs,
        "soak sample cadence exceeds two configured intervals",
      );
    }
    priorElapsedMs = sample.elapsedMs;
    requireCondition(Number.isSafeInteger(sample.race) && sample.race > 0, "soak sample race must be a positive safe integer");
    requireCondition(Number.isSafeInteger(sample.attempt) && sample.attempt > 0, "soak sample attempt must be a positive safe integer");
    requireCondition(sample.race === sample.attempt, "soak sample race/attempt identity is inconsistent with a zero-timeout run");
    requireExactKeys(sample.heap, ["available", "totalBytes", "usedBytes"], "soak sample heap");
    requireCondition(sample.heap.available === true, "soak sample heap is unavailable");
    requireFiniteNumber(sample?.heap?.usedBytes, "soak sample heap.usedBytes", { minimum: 0 });
    requireFiniteNumber(sample.heap.totalBytes, "soak sample heap.totalBytes", { minimum: sample.heap.usedBytes });
    requireExactKeys(sample.input, ["dispatchDelayMs", "keydownToFrameMs"], "soak sample input");
    requireFiniteNumber(sample?.input?.dispatchDelayMs, "soak sample input.dispatchDelayMs", { minimum: 0 });
    requireFiniteNumber(sample?.input?.keydownToFrameMs, "soak sample input.keydownToFrameMs", { minimum: 0 });
    requireExactKeys(sample.hud, ["drawCalls", "droppedSimulationMs", "fps", "frameTimeMs"], "soak sample hud");
    requireFiniteNumber(sample.hud.fps, "soak sample hud.fps", { minimum: Number.EPSILON });
    requireFiniteNumber(sample.hud.frameTimeMs, "soak sample hud.frameTimeMs", { minimum: 0 });
    requireCondition(Number.isSafeInteger(sample.hud.drawCalls) && sample.hud.drawCalls >= 0, "soak sample hud.drawCalls must be a non-negative safe integer");
    requireFiniteNumber(sample?.hud?.droppedSimulationMs, "soak sample hud.droppedSimulationMs", { minimum: 0 });
    const cumulative = requireFiniteNumber(
      sample?.cumulativeDroppedSimulationMs,
      "soak sample cumulativeDroppedSimulationMs",
      { minimum: 0 },
    );
    requireCondition(cumulative >= priorCumulative, "soak cumulative fixed-step telemetry is not monotonic");
    priorCumulative = cumulative;
  }
  const sampledWindowMs = value.samples.at(-1).elapsedMs - value.samples[0].elapsedMs;
  const samplingToleranceMs = value.configuration.sampleIntervalSeconds
    * 1_000
    * SOAK_SAMPLE_WINDOW_TOLERANCE_INTERVALS;
  requireCondition(
    sampledWindowMs >= value.configuration.configuredDurationMs - samplingToleranceMs,
    "soak measured sample window does not cover the configured duration within two sample intervals",
  );
  const heapValues = value.samples.map((sample) => sample.heap.usedBytes);
  const dispatchValues = value.samples.map((sample) => sample.input.dispatchDelayMs);
  const inputValues = value.samples.map((sample) => sample.input.keydownToFrameMs);
  const droppedValues = value.samples.map((sample) => sample.hud.droppedSimulationMs);
  const cumulativeValues = value.samples.map((sample) => sample.cumulativeDroppedSimulationMs);
  const elapsedPoints = (values) => value.samples.map((sample, index) => ({
    elapsedMs: sample.elapsedMs,
    value: values[index],
  }));
  requireExactKeys(value.memory, [
    "firstUsedBytes",
    "growthBytes",
    "lastUsedBytes",
    "samples",
    "trend",
    "usedBytes",
  ], "soak memory");
  requireCondition(value.memory.samples === value.samples.length, "soak memory sample count does not match measured samples");
  requireCondition(value.memory.firstUsedBytes === heapValues[0], "soak memory.firstUsedBytes does not match raw samples");
  requireCondition(value.memory.lastUsedBytes === heapValues.at(-1), "soak memory.lastUsedBytes does not match raw samples");
  requireCondition(value.memory.growthBytes === heapValues.at(-1) - heapValues[0], "soak memory.growthBytes does not match raw samples");
  requireExactJson(value.memory.usedBytes, summarizeMetric(heapValues), "soak memory.usedBytes");
  requireExactJson(value.memory.trend, trendMetric(elapsedPoints(heapValues)), "soak memory.trend");
  requireExactKeys(value.inputResponsiveness, [
    "dispatchDelayMs",
    "dispatchDelayTrend",
    "keydownToFrameMs",
    "keydownToFrameTrend",
  ], "soak inputResponsiveness");
  requireExactJson(value.inputResponsiveness.dispatchDelayMs, summarizeMetric(dispatchValues), "soak inputResponsiveness.dispatchDelayMs");
  requireExactJson(value.inputResponsiveness.keydownToFrameMs, summarizeMetric(inputValues), "soak inputResponsiveness.keydownToFrameMs");
  requireExactJson(value.inputResponsiveness.dispatchDelayTrend, trendMetric(elapsedPoints(dispatchValues)), "soak inputResponsiveness.dispatchDelayTrend");
  requireExactJson(value.inputResponsiveness.keydownToFrameTrend, trendMetric(elapsedPoints(inputValues)), "soak inputResponsiveness.keydownToFrameTrend");
  requireExactKeys(value.fixedStepTiming, [
    "attempts",
    "cumulativeDroppedSimulationMs",
    "droppedSimulationMs",
    "maxAccumulatedDroppedMs",
    "perAttemptMaxDroppedSimulationMs",
    "perAttemptTrend",
  ], "soak fixedStepTiming");
  requireExactJson(value.fixedStepTiming.droppedSimulationMs, summarizeMetric(droppedValues), "soak fixedStepTiming.droppedSimulationMs");
  requireCondition(value.fixedStepTiming.maxAccumulatedDroppedMs === Math.max(...droppedValues), "soak fixedStepTiming.maxAccumulatedDroppedMs does not match raw samples");
  const cumulative = value.fixedStepTiming.cumulativeDroppedSimulationMs;
  requireExactKeys(cumulative, [
    "endMs",
    "finalObservedMs",
    "firstSampleMs",
    "growthAcrossSamplesMs",
    "growthMs",
    "lastSampleMs",
    "observedRatePerMinute",
    "samples",
    "startMs",
    "trend",
  ], "soak fixedStepTiming.cumulativeDroppedSimulationMs");
  requireExactJson(cumulative.samples, summarizeMetric(cumulativeValues), "soak fixedStepTiming.cumulativeDroppedSimulationMs.samples");
  requireCondition(cumulative.firstSampleMs === cumulativeValues[0], "soak cumulative firstSampleMs does not match raw samples");
  requireCondition(cumulative.lastSampleMs === cumulativeValues.at(-1), "soak cumulative lastSampleMs does not match raw samples");
  requireCondition(
    cumulative.growthAcrossSamplesMs === cumulativeValues.at(-1) - cumulativeValues[0],
    "soak cumulative growthAcrossSamplesMs does not match raw samples",
  );
  requireExactJson(cumulative.trend, trendMetric(elapsedPoints(cumulativeValues)), "soak fixedStepTiming.cumulativeDroppedSimulationMs.trend");
  requireCondition(
    cumulative.startMs === 0
      && cumulative.endMs === cumulative.finalObservedMs
      && cumulative.growthMs === cumulative.finalObservedMs
      && cumulative.finalObservedMs >= cumulativeValues.at(-1),
    "soak cumulative final telemetry is inconsistent",
  );
  requireCondition(
    cumulative.observedRatePerMinute === roundMetric(cumulative.finalObservedMs / (value.workloadDurationMs / 60_000)),
    "soak cumulative observedRatePerMinute does not match final telemetry",
  );
  requireCondition(Array.isArray(value.fixedStepTiming.attempts), "soak fixedStepTiming.attempts must be an array");
  requireCondition(
    value.fixedStepTiming.attempts.length === value.completedRaces + 1,
    "soak fixedStepTiming.attempts must contain each completed race and one terminal deadline attempt",
  );
  let priorAttemptElapsedMs = -1;
  let priorAttemptCumulativeMs = 0;
  for (const [index, attempt] of value.fixedStepTiming.attempts.entries()) {
    requireExactKeys(attempt, [
      "attempt",
      "cumulativeDroppedSimulationMs",
      "durationMs",
      "elapsedMs",
      "maxObservedDroppedSimulationMs",
      "outcome",
      "samples",
    ], "soak fixedStepTiming.attempts[]");
    requireCondition(attempt.attempt === index + 1, "soak fixed-step attempts must be contiguously numbered");
    requireCondition(
      attempt.outcome === (index === value.fixedStepTiming.attempts.length - 1 ? "deadline" : "completed"),
      "soak fixed-step attempt outcomes do not match the zero-timeout completion journey",
    );
    requireCondition(Number.isSafeInteger(attempt.elapsedMs) && attempt.elapsedMs > priorAttemptElapsedMs, "soak fixed-step attempt elapsedMs values must strictly increase");
    requireCondition(attempt.elapsedMs <= value.actualDurationMs, "soak fixed-step attempt elapsedMs exceeds the run duration");
    requireCondition(Number.isSafeInteger(attempt.durationMs) && attempt.durationMs > 0 && attempt.durationMs <= attempt.elapsedMs, "soak fixed-step attempt durationMs is invalid");
    requireCondition(Number.isSafeInteger(attempt.samples) && attempt.samples >= 0, "soak fixed-step attempt samples is invalid");
    const rawAttemptSamples = value.samples.filter((sample) => sample.attempt === attempt.attempt);
    const attemptLowerBoundMs = index === 0 ? 0 : value.fixedStepTiming.attempts[index - 1].elapsedMs;
    requireCondition(
      rawAttemptSamples.every((sample) => sample.elapsedMs >= attemptLowerBoundMs && sample.elapsedMs <= attempt.elapsedMs),
      "soak raw samples fall outside their recorded fixed-step attempt",
    );
    requireCondition(attempt.samples >= rawAttemptSamples.length, "soak fixed-step attempt sample count is below its raw sample count");
    requireFiniteNumber(attempt.maxObservedDroppedSimulationMs, "soak fixed-step attempt maxObservedDroppedSimulationMs", { minimum: 0 });
    const rawAttemptMaximum = Math.max(...rawAttemptSamples.map((sample) => sample.hud.droppedSimulationMs), 0);
    requireCondition(
      attempt.maxObservedDroppedSimulationMs >= rawAttemptMaximum,
      "soak fixed-step attempt maximum is below its raw HUD samples",
    );
    requireCondition(
      attempt.cumulativeDroppedSimulationMs === priorAttemptCumulativeMs + attempt.maxObservedDroppedSimulationMs,
      "soak fixed-step attempt cumulative telemetry does not recompute",
    );
    priorAttemptElapsedMs = attempt.elapsedMs;
    priorAttemptCumulativeMs = attempt.cumulativeDroppedSimulationMs;
  }
  requireCondition(
    value.samples.every((sample) => sample.attempt <= value.fixedStepTiming.attempts.length),
    "soak samples refer to an unknown fixed-step attempt",
  );
  requireCondition(
    priorAttemptCumulativeMs === cumulative.finalObservedMs,
    "soak per-attempt cumulative telemetry does not match final telemetry",
  );
  const finiteAttemptMaximums = value.fixedStepTiming.attempts
    .map((attempt) => attempt.maxObservedDroppedSimulationMs)
    .filter(Number.isFinite);
  requireExactJson(
    value.fixedStepTiming.perAttemptMaxDroppedSimulationMs,
    summarizeMetric(finiteAttemptMaximums),
    "soak fixedStepTiming.perAttemptMaxDroppedSimulationMs",
  );
  requireExactJson(
    value.fixedStepTiming.perAttemptTrend,
    trendMetric(value.fixedStepTiming.attempts.map((attempt) => ({
      elapsedMs: attempt.elapsedMs,
      value: attempt.maxObservedDroppedSimulationMs,
    }))),
    "soak fixedStepTiming.perAttemptTrend",
  );
  requirePassingCriteria(value.diagnosticGate, SOAK_DIAGNOSTIC_CRITERIA, "soak diagnosticGate", {
    exactKeys: ["criteria", "failedCriteria", "status"],
    criterionKeys: SOAK_CRITERION_KEYS,
  });
  requirePassingCriteria(value.releaseGate, SOAK_CRITERIA, "soak releaseGate", {
    exactKeys: ["criteria", "failedCriteria", "manualTrendReviewRequired", "status"],
    criterionKeys: SOAK_CRITERION_KEYS,
  });
  requireCondition(
    JSON.stringify(value.releaseGate.manualTrendReviewRequired) === JSON.stringify(SOAK_TREND_REVIEW_PATHS),
    "soak manual trend-review scope does not match the release contract",
  );
  return { aggregate, createdAt: value.createdAt, completedAt: value.completedAt };
}

function screenshotAggregate(records) {
  const aggregate = createHash("sha256");
  for (const record of [...records].toSorted((left, right) => left.path.localeCompare(right.path))) {
    aggregate.update(`${record.sha256}  ${record.path}\n`);
  }
  return aggregate.digest("hex");
}

async function validateSmokeEvidence(value, smokeReference, manifest, manifestSha256, productRelease, context) {
  requireObject(value, "production smoke evidence");
  requireCondition(value.schemaVersion === 5, "production smoke schemaVersion must be 5");
  requireCondition(value.kind === "production-smoke", "production smoke kind does not match");
  requireCondition(value.status === "PASS" && value.smokeError === null, "production smoke status must be PASS without an error");
  requireTimestamp(value.createdAt, "production smoke createdAt");
  validateRootUrl(value.baseURL, "production smoke baseURL");
  requireBoundedString(value.run?.id, "production smoke run.id");
  requireTimestamp(value.run?.startedAt, "production smoke run.startedAt");
  requireCondition(
    Date.parse(value.run.startedAt) <= Date.parse(value.createdAt),
    "production smoke completion predates its start",
  );
  requireCondition(value.run?.candidateManifestSha256 === manifestSha256, "production smoke run is not bound to the manifest file");
  requireObject(value.browser, "production smoke browser");
  requireCondition(
    value.browser.name === "Google Chrome"
      && value.browser.channel === "chrome"
      && typeof value.browser.version === "string"
      && value.browser.version.length > 0
      && value.browser.headless === true,
    "production smoke must identify installed Google Chrome",
  );
  requireExactJson(value.browser.viewport, { width: 1_440, height: 900 }, "production smoke browser.viewport");
  requireObject(value.releaseArtifact, "production smoke releaseArtifact");
  requireCondition(
    value.releaseArtifact.format === manifest.format && value.releaseArtifact.product === manifest.product,
    "production smoke format/product identity does not match the manifest",
  );
  requireExactJson(value.releaseArtifact.toolchain, manifest.toolchain, "production smoke toolchain identity");
  requireExactJson(value.releaseArtifact.build, manifest.build, "production smoke build identity");
  requireCondition(value.releaseArtifact.manifestSha256 === manifestSha256, "production smoke manifest SHA-256 does not match");
  requireCondition(value.releaseArtifact.aggregateSha256 === manifest.aggregateSha256, "production smoke aggregate does not match the manifest");
  requireCondition(value.releaseArtifact.version === manifest.version, "production smoke version does not match the manifest");
  requireCondition(value.releaseArtifact.fileCount === manifest.fileCount, "production smoke file count does not match the manifest");
  requireCondition(value.releaseArtifact.totalBytes === manifest.totalBytes, "production smoke total bytes do not match the manifest");
  requireCondition(value.releaseArtifact.totalGzipBytes === manifest.totalGzipBytes, "production smoke gzip bytes do not match the manifest");
  requireExactJson(value.releaseArtifact.compression, manifest.compression, "production smoke compression identity");
  requireCondition(value.releaseArtifact.source?.commit === productRelease.commit, "production smoke source commit does not match");
  requireCondition(value.releaseArtifact.source?.tag === productRelease.tag, "production smoke source tag does not match");
  requireCondition(value.releaseArtifact.source?.tagObject === productRelease.tagObject, "production smoke tag object does not match");
  for (const phase of ["servedBefore", "servedAfter"]) {
    validateServedInventory(
      value.releaseArtifact[phase],
      manifest,
      value.baseURL,
      `production smoke releaseArtifact.${phase}`,
    );
  }
  requireCondition(
    value.runtime?.build?.commit === productRelease.commit && value.runtime?.build?.dirty === false,
    "production smoke runtime build does not match the product release",
  );
  requireCondition(
    value.runtime?.title === "Rivet Ridge Rally"
      && value.runtime?.version === manifest.version
      && value.runtime?.versionPresent === true
      && value.runtime?.qaApiPresent === false,
    "production smoke runtime title/version/QA identity is incomplete",
  );
  requireCondition(value.serviceWorkerControlled === true, "production smoke service worker was not controlling");
  requireCondition(value.offlineCacheName === EXPECTED_OFFLINE_CACHE_NAME, "production smoke offline cache identity does not match the release contract");
  requireCondition(value.offlineReloadPassed === true, "production smoke offline reload did not pass");
  requireCondition(value.offlinePracticeRacePassed === true, "production smoke cached Practice race did not pass");
  requireCondition(Array.isArray(value.network?.failedRequests) && value.network.failedRequests.length === 0, "production smoke has failed requests");
  requireCondition(Array.isArray(value.network?.httpErrors) && value.network.httpErrors.length === 0, "production smoke has HTTP errors");
  requireCondition(Array.isArray(value.console?.unexpected) && value.console.unexpected.length === 0, "production smoke has unexpected console messages");
  requireCondition(
    Array.isArray(value.steps) && JSON.stringify([...new Set(value.steps)].toSorted()) === JSON.stringify(REQUIRED_SMOKE_STEPS),
    "production smoke step set is incomplete",
  );
  requireCondition(Array.isArray(value.screenshots), "production smoke screenshots are missing");
  const screenshotNames = [];
  const screenshotPaths = [];
  for (const record of value.screenshots) {
    validateFileReference(record, "production smoke screenshot");
    requireCondition(!record.path.includes("/"), "production smoke screenshot path must be local to its bundle");
    screenshotNames.push(record.path);
    const reference = {
      ...record,
      path: path.posix.join(path.posix.dirname(smokeReference.path), record.path),
    };
    const screenshotFile = await loadVerifiedFile(reference, `production smoke screenshot ${record.path}`, context);
    const png = inspectPngIntegrity(screenshotFile.contents, `production smoke screenshot ${record.path}`);
    requireCondition(
      png.width >= 320 && png.height >= 180,
      `production smoke screenshot ${record.path} is below the minimum evidence dimensions`,
    );
    screenshotPaths.push(reference.path);
  }
  requireCondition(new Set(screenshotNames).size === screenshotNames.length, "production smoke screenshot paths are duplicated");
  requireCondition(
    JSON.stringify(screenshotNames.toSorted()) === JSON.stringify(REQUIRED_SMOKE_SCREENSHOTS),
    "production smoke screenshot set is incomplete",
  );
  requireCondition(value.screenshotAggregateSha256 === screenshotAggregate(value.screenshots), "production smoke screenshot aggregate does not match");
  return { completedAt: value.createdAt, screenshotPaths };
}

function validateQaCheckEvidence(value, check, productRelease, version, manifest) {
  const label = `mandatory QA check ${check}`;
  requireExactKeys(
    value,
    [
      "check",
      "commands",
      "createdAt",
      "kind",
      "manifestAggregateSha256",
      "product",
      "productCommit",
      "productTag",
      "schemaVersion",
      "status",
      "version",
    ],
    label,
  );
  requireCondition(value.schemaVersion === 1 && value.kind === "release-qa-check", `${label} schema identity does not match`);
  requireCondition(value.status === "PASS", `${label}.status must be PASS`);
  requireCondition(value.check === check, `${label}.check does not match its attestation key`);
  requireCondition(value.product === "RIVET RIDGE RALLY" && value.version === version, `${label} product identity does not match`);
  requireCondition(value.productTag === productRelease.tag, `${label}.productTag does not match`);
  requireCondition(value.productCommit === productRelease.commit, `${label}.productCommit does not match`);
  requireCondition(value.manifestAggregateSha256 === manifest.aggregateSha256, `${label}.manifestAggregateSha256 does not match`);
  requireTimestamp(value.createdAt, `${label}.createdAt`);
  const expectedCommands = MANDATORY_QA_CHECKS[check];
  requireCondition(Array.isArray(value.commands) && value.commands.length === expectedCommands.length, `${label}.commands is incomplete`);
  const outputReferences = [];
  let latestCompletedAt = -Infinity;
  for (const [index, command] of value.commands.entries()) {
    const commandLabel = `${label}.commands[${index}]`;
    requireExactKeys(command, ["command", "completedAt", "exitCode", "output", "startedAt", "status"], commandLabel);
    requireCondition(command.command === expectedCommands[index], `${commandLabel}.command does not match the required command`);
    requireCondition(command.status === "PASS" && command.exitCode === 0, `${commandLabel} did not pass with exit code zero`);
    requireTimestamp(command.startedAt, `${commandLabel}.startedAt`);
    requireTimestamp(command.completedAt, `${commandLabel}.completedAt`);
    requireCondition(Date.parse(command.startedAt) <= Date.parse(command.completedAt), `${commandLabel} completed before it started`);
    validateFileReference(command.output, `${commandLabel}.output`);
    requireCondition(
      command.output.path === `artifacts/release-attestations/${productRelease.tag}-evidence/qa/logs/${check}-${index + 1}.txt`,
      `${commandLabel}.output.path is not canonical`,
    );
    outputReferences.push(command.output);
    latestCompletedAt = Math.max(latestCompletedAt, Date.parse(command.completedAt));
  }
  requireCondition(Date.parse(value.createdAt) >= latestCompletedAt, `${label}.createdAt predates a command result`);
  return { completedAt: value.createdAt, outputReferences };
}

function validateApprovalEvidence(value, role, approval, attestation) {
  const label = `${role} approval evidence`;
  requireExactKeys(
    value,
    [
      "approvedAt",
      "approvedBy",
      "decision",
      "kind",
      "manifestAggregateSha256",
      "product",
      "productCommit",
      "productTag",
      "role",
      "schemaVersion",
      "scope",
      "status",
      "supportingEvidence",
      "version",
    ],
    label,
  );
  requireCondition(value.schemaVersion === 1 && value.kind === "release-approval", `${label} schema identity does not match`);
  requireCondition(value.product === attestation.product && value.version === attestation.version, `${label} product identity does not match`);
  for (const field of [
    "approvedAt",
    "approvedBy",
    "manifestAggregateSha256",
    "productCommit",
    "productTag",
    "role",
    "scope",
    "status",
  ]) {
    requireCondition(value[field] === approval[field], `${label}.${field} does not match the attestation decision`);
  }
  if (role === "qa") {
    requireExactKeys(value.decision, ["openP0", "openP1", "status"], `${label}.decision`);
    requireCondition(
      value.decision.status === "PASS" && value.decision.openP0 === 0 && value.decision.openP1 === 0,
      `${label}.decision must report PASS with zero open P0 and P1 defects`,
    );
  } else if (role === "accessibility") {
    requireExactKeys(value.decision, ["status", "unresolvedMandatory"], `${label}.decision`);
    requireCondition(
      value.decision.status === "PASS" && value.decision.unresolvedMandatory === 0,
      `${label}.decision must report PASS with zero unresolved mandatory findings`,
    );
  } else {
    requireExactKeys(
      value.decision,
      [
        "assetInventoryCleared",
        "commercialUseCleared",
        "privacyCleared",
        "productLicenseCleared",
        "status",
        "trademarkTradeDressCleared",
      ],
      `${label}.decision`,
    );
    requireCondition(value.decision.status === "PASS", `${label}.decision.status must be PASS`);
    for (const field of [
      "assetInventoryCleared",
      "commercialUseCleared",
      "privacyCleared",
      "productLicenseCleared",
      "trademarkTradeDressCleared",
    ]) {
      requireCondition(value.decision[field] === true, `${label}.decision.${field} must be true`);
    }
  }
  requireCondition(Array.isArray(value.supportingEvidence) && value.supportingEvidence.length > 0, `${label}.supportingEvidence must not be empty`);
  const paths = new Set();
  const supportRoot = `artifacts/release-attestations/${approval.productTag}-evidence/approvals/support/`;
  for (const reference of value.supportingEvidence) {
    validateFileReference(reference, `${label}.supportingEvidence[]`);
    requireCondition(!paths.has(reference.path), `${label} duplicates supporting evidence ${reference.path}`);
    requireCondition(reference.path !== approval.evidence.path, `${label} must not cite itself`);
    requireCondition(
      reference.path === "QA_REPORT.md"
        || reference.path === "LAUNCH_READINESS.md"
        || reference.path === VISUAL_BASELINE_APPROVAL_PATH
        || reference.path === VISUAL_BASELINE_PATH
        || reference.path.startsWith(supportRoot),
      `${label} supporting evidence must be a canonical report/visual record or live under the candidate approval-support directory`,
    );
    paths.add(reference.path);
  }
  if (role === "qa") {
    requireCondition(paths.has("QA_REPORT.md"), "QA approval evidence must bind QA_REPORT.md");
    requireCondition(paths.has("LAUNCH_READINESS.md"), "QA approval evidence must bind LAUNCH_READINESS.md");
    requireCondition(paths.has(VISUAL_BASELINE_APPROVAL_PATH), "QA approval evidence must bind the canonical visual baseline approval record");
    requireCondition(paths.has(VISUAL_BASELINE_PATH), "QA approval evidence must bind the promoted Canyon visual baseline");
  }
  return value.supportingEvidence;
}

function validateEmbeddedVisualDocument(value, expectedPath, label, { aggregate = false } = {}) {
  requireExactKeys(value, ["bytes", "document", "path", "sha256", ...(aggregate ? ["aggregateSha256"] : [])], label);
  requireCondition(value.path === expectedPath, `${label}.path is not canonical`);
  requireCondition(Number.isSafeInteger(value.bytes) && value.bytes > 0, `${label}.bytes must be positive`);
  requireSha256(value.sha256, `${label}.sha256`);
  requireObject(value.document, `${label}.document`);
  const canonical = Buffer.from(`${JSON.stringify(value.document, null, 2)}\n`);
  requireCondition(canonical.byteLength === value.bytes, `${label}.bytes does not match its embedded document`);
  requireCondition(sha256(canonical) === value.sha256, `${label}.sha256 does not match its embedded document`);
  return value.document;
}

function validateVisualBaselineApprovalRecord(value, expectedVersion) {
  const label = "visual baseline approval record";
  requireExactKeys(value, ["authentication", "evidence", "kind", "ownerApproval", "promotedBaseline", "schemaVersion"], label);
  requireCondition(
    value.schemaVersion === 2
      && value.kind === "rivet-ridge-rally-visual-baseline-approval-record"
      && value.authentication === VISUAL_APPROVAL_AUTHENTICATION,
    `${label} schema identity does not match`,
  );

  requireExactKeys(value.promotedBaseline, ["bytes", "path", "sha256"], `${label}.promotedBaseline`);
  requireCondition(value.promotedBaseline.path === VISUAL_BASELINE_PATH, `${label}.promotedBaseline.path is not canonical`);
  requireCondition(
    Number.isSafeInteger(value.promotedBaseline.bytes) && value.promotedBaseline.bytes > 0,
    `${label}.promotedBaseline.bytes must be positive`,
  );
  requireSha256(value.promotedBaseline.sha256, `${label}.promotedBaseline.sha256`);

  requireObject(value.ownerApproval, `${label}.ownerApproval`);
  const { approval: validatedOwnerApproval } = validateVisualOwnerApproval(
    value.ownerApproval,
    { enforceFreshness: false },
  );
  requireExactKeys(
    value.ownerApproval,
    ["approvedAt", "authentication", "candidate", "decision", "kind", "reviewer", "schemaVersion", "screenshot", "statement"],
    `${label}.ownerApproval`,
  );
  requireCondition(
    value.ownerApproval.schemaVersion === 1
      && value.ownerApproval.kind === "rivet-ridge-rally-visual-baseline-owner-approval"
      && value.ownerApproval.authentication === VISUAL_APPROVAL_AUTHENTICATION
      && value.ownerApproval.decision === "ACCEPT",
    `${label}.ownerApproval does not record explicit external acceptance`,
  );
  requireTimestamp(value.ownerApproval.approvedAt, `${label}.ownerApproval.approvedAt`);
  requireCondition(
    value.ownerApproval.statement === "I reviewed the exact Canyon Practice 500 capture against the approved concept art and accept it as the checked-in visual regression baseline.",
    `${label}.ownerApproval.statement does not record the required acceptance`,
  );
  requireExactKeys(value.ownerApproval.reviewer, ["name", "role"], `${label}.ownerApproval.reviewer`);
  requireBoundedString(value.ownerApproval.reviewer.name, `${label}.ownerApproval.reviewer.name`, 120);
  requireCondition(value.ownerApproval.reviewer.role === "product-owner", `${label}.ownerApproval.reviewer.role is invalid`);
  requireObject(value.ownerApproval.candidate, `${label}.ownerApproval.candidate`);
  requireExactKeys(
    value.ownerApproval.candidate,
    ["aggregateSha256", "captureManifestSha256", "commit"],
    `${label}.ownerApproval.candidate`,
  );
  requireGitObject(value.ownerApproval.candidate.commit, `${label}.ownerApproval.candidate.commit`);
  requireSha256(value.ownerApproval.candidate.aggregateSha256, `${label}.ownerApproval.candidate.aggregateSha256`);
  requireSha256(value.ownerApproval.candidate.captureManifestSha256, `${label}.ownerApproval.candidate.captureManifestSha256`);
  requireObject(value.ownerApproval.screenshot, `${label}.ownerApproval.screenshot`);
  requireExactKeys(
    value.ownerApproval.screenshot,
    ["bytes", "distance", "mode", "path", "project", "quality", "readiness", "sha256", "trackId", "viewport"],
    `${label}.ownerApproval.screenshot`,
  );
  requireCondition(
    value.ownerApproval.screenshot.bytes === value.promotedBaseline.bytes
      && value.ownerApproval.screenshot.sha256 === value.promotedBaseline.sha256,
    `${label}.ownerApproval screenshot does not match the promoted baseline`,
  );
  requireCondition(
    value.ownerApproval.screenshot.path === "curved-baseline-candidate/canyon-kickoff-practice-1280x720.png"
      && value.ownerApproval.screenshot.project === "chromium"
      && value.ownerApproval.screenshot.mode === "practice"
      && value.ownerApproval.screenshot.trackId === "canyon-kickoff"
      && value.ownerApproval.screenshot.distance === 500
      && value.ownerApproval.screenshot.quality === "high",
    `${label}.ownerApproval screenshot identity is invalid`,
  );
  requireCondition(
    isDeepStrictEqual(value.ownerApproval.screenshot.viewport, { width: 1_280, height: 720, deviceScaleFactor: 1 }),
    `${label}.ownerApproval screenshot viewport is invalid`,
  );
  requireExactKeys(
    value.ownerApproval.screenshot.readiness,
    ["ariaLabel", "bikeAsset", "canyonKitAsset", "environmentAsset", "runtimeBuild", "visualDistance", "visualState"],
    `${label}.ownerApproval.screenshot.readiness`,
  );
  requireExactKeys(
    value.ownerApproval.screenshot.readiness.runtimeBuild,
    ["commit", "dirty"],
    `${label}.ownerApproval.screenshot.readiness.runtimeBuild`,
  );
  requireCondition(
    value.ownerApproval.screenshot.readiness.visualState === "frozen"
      && value.ownerApproval.screenshot.readiness.bikeAsset === "ready"
      && value.ownerApproval.screenshot.readiness.canyonKitAsset === "ready"
      && value.ownerApproval.screenshot.readiness.environmentAsset === "ready"
      && value.ownerApproval.screenshot.readiness.visualDistance === 500
      && value.ownerApproval.screenshot.readiness.ariaLabel === "Live 3D race on Canyon Kickoff"
      && value.ownerApproval.screenshot.readiness.runtimeBuild.commit === value.ownerApproval.candidate.commit
      && value.ownerApproval.screenshot.readiness.runtimeBuild.dirty === false,
    `${label}.ownerApproval screenshot readiness is invalid`,
  );

  requireExactKeys(value.evidence, ["candidateManifest", "captureManifest"], `${label}.evidence`);
  const captureManifest = validateEmbeddedVisualDocument(
    value.evidence.captureManifest,
    value.evidence.captureManifest.path,
    `${label}.evidence.captureManifest`,
  );
  requireCondition(
    /^artifacts\/visual-review\/[a-z0-9][a-z0-9._-]*\/manifest\.json$/iu.test(value.evidence.captureManifest.path),
    `${label}.evidence.captureManifest.path is not canonical`,
  );
  const candidateManifest = validateVisualCandidateManifest(validateEmbeddedVisualDocument(
    value.evidence.candidateManifest,
    "artifacts/candidate-evidence/visual/current/manifest.json",
    `${label}.evidence.candidateManifest`,
    { aggregate: true },
  ));
  requireSha256(value.evidence.candidateManifest.aggregateSha256, `${label}.evidence.candidateManifest.aggregateSha256`);
  requireCondition(
    candidateManifest.kind === "visual-qa-candidate"
      && candidateManifest.format === 1
      && candidateManifest.source?.commit === value.ownerApproval.candidate.commit
      && candidateManifest.aggregateSha256 === value.ownerApproval.candidate.aggregateSha256
      && candidateManifest.aggregateSha256 === value.evidence.candidateManifest.aggregateSha256,
    `${label} candidate manifest is not bound to the owner-approved QA candidate`,
  );
  requireCondition(
    captureManifest.schemaVersion === 3
      && captureManifest.kind === "five-track-controlled-visual-review"
      && captureManifest.status === "PASS"
      && captureManifest.candidate?.manifest?.sourceCommit === value.ownerApproval.candidate.commit
      && captureManifest.candidate?.manifest?.aggregateSha256 === value.ownerApproval.candidate.aggregateSha256
      && value.evidence.captureManifest.sha256 === value.ownerApproval.candidate.captureManifestSha256,
    `${label} capture manifest is not bound to the owner-approved QA candidate`,
  );
  requireCondition(candidateManifest.version === expectedVersion, `${label} candidate version does not match the release`);
  const candidateRecords = candidateManifest.files.map((record) => ({
    path: record.path,
    bytes: record.bytes,
    gzipBytes: record.gzipBytes,
    gzipSha256: record.gzipSha256,
    sha256: record.sha256,
  }));
  const approvedCapture = validateVisualCaptureManifest(
    captureManifest,
    validatedOwnerApproval,
    {
      aggregateSha256: candidateManifest.aggregateSha256,
      fileCount: candidateManifest.fileCount,
      totalBytes: candidateManifest.totalBytes,
      totalGzipBytes: candidateManifest.totalGzipBytes,
      records: candidateRecords,
      recordByPath: new Map(candidateRecords.map((record) => [record.path, record])),
    },
    candidateManifest,
    {
      path: value.evidence.candidateManifest.path,
      sha256: value.evidence.candidateManifest.sha256,
    },
    expectedVersion,
  );
  requireCondition(
    approvedCapture.status === "PASS"
      && approvedCapture.bytes === value.promotedBaseline.bytes
      && approvedCapture.sha256 === value.promotedBaseline.sha256,
    `${label} owner-approved capture does not match the promoted baseline`,
  );
  return {
    approvedAt: value.ownerApproval.approvedAt,
    candidateCommit: value.ownerApproval.candidate.commit,
    promotedBaseline: value.promotedBaseline,
  };
}

function validateQaReport(contents, approval, attestation) {
  const text = contents.toString("utf8");
  const statusLines = text.match(/^\*\*Overall code-owned QA status:\*\* .+$/gmu) ?? [];
  requireCondition(
    statusLines.length === 1 && statusLines[0] === "**Overall code-owned QA status:** PASS",
    "QA_REPORT.md must contain one current code-owned QA status of PASS",
  );
  const decisionLines = text.match(/^\*\*Release decision:\*\* .+$/gmu) ?? [];
  requireCondition(
    decisionLines.length === 1 && decisionLines[0] === "**Release decision:** READY",
    "QA_REPORT.md must contain one current release decision of READY",
  );
  const markerPrefix = "<!-- release-qa-readiness ";
  const markerLines = text
    .split("\n")
    .filter((line) => line.startsWith(markerPrefix) && line.endsWith(" -->"));
  requireCondition(markerLines.length === 1, "QA_REPORT.md must contain one candidate-bound release-qa-readiness marker");
  let marker;
  try {
    marker = JSON.parse(markerLines[0].slice(markerPrefix.length, -4));
  } catch {
    invalid("QA_REPORT.md release-qa-readiness marker must contain valid JSON");
  }
  requireExactKeys(
    marker,
    [
      "kind",
      "manifestAggregateSha256",
      "openP0",
      "openP1",
      "product",
      "productCommit",
      "productTag",
      "schemaVersion",
      "status",
      "version",
    ],
    "QA_REPORT.md release-qa-readiness marker",
  );
  requireCondition(
    marker.schemaVersion === 1
      && marker.kind === "release-qa-readiness"
      && marker.status === "READY"
      && marker.openP0 === 0
      && marker.openP1 === 0,
    "QA_REPORT.md release-qa-readiness marker must report READY with zero open P0 and P1 defects",
  );
  requireCondition(
    marker.product === attestation.product
      && marker.version === attestation.version
      && marker.productTag === approval.productTag
      && marker.productCommit === approval.productCommit
      && marker.manifestAggregateSha256 === approval.manifestAggregateSha256,
    "QA_REPORT.md release-qa-readiness marker does not match the approved candidate",
  );
}

function validateLaunchReadiness(contents, approval, attestation) {
  const text = contents.toString("utf8");
  const decisionHeadings = text.match(/^# (?:NOT READY|READY)$/gmu) ?? [];
  requireCondition(
    decisionHeadings.length === 1 && decisionHeadings[0] === "# READY",
    "LAUNCH_READINESS.md must contain one current # READY decision heading",
  );
  const codeOwnedStatusLines = text.match(/^\*\*Code-owned gate status:\*\* .+$/gmu) ?? [];
  requireCondition(
    codeOwnedStatusLines.length === 1 && codeOwnedStatusLines[0] === "**Code-owned gate status:** PASS",
    "LAUNCH_READINESS.md must contain one current code-owned gate status of PASS",
  );
  const commercialStatusLines = text.match(/^\*\*Commercial readiness status:\*\* .+$/gmu) ?? [];
  requireCondition(
    commercialStatusLines.length === 1 && commercialStatusLines[0] === "**Commercial readiness status:** READY",
    "LAUNCH_READINESS.md must contain one current commercial readiness status of READY",
  );
  const finalStatusLines = text.match(/^\*\*Current final status: .+\*\*$/gmu) ?? [];
  requireCondition(
    finalStatusLines.length === 1 && finalStatusLines[0] === "**Current final status: READY.**",
    "LAUNCH_READINESS.md must contain one current final status of READY",
  );
  const markerPrefix = "<!-- release-launch-readiness ";
  const markerLines = text
    .split("\n")
    .filter((line) => line.startsWith(markerPrefix) && line.endsWith(" -->"));
  requireCondition(
    markerLines.length === 1,
    "LAUNCH_READINESS.md must contain one candidate-bound release-launch-readiness marker",
  );
  let marker;
  try {
    marker = JSON.parse(markerLines[0].slice(markerPrefix.length, -4));
  } catch {
    invalid("LAUNCH_READINESS.md release-launch-readiness marker must contain valid JSON");
  }
  requireExactKeys(
    marker,
    [
      "kind",
      "manifestAggregateSha256",
      "openP0",
      "openP1",
      "product",
      "productCommit",
      "productTag",
      "schemaVersion",
      "status",
      "version",
    ],
    "LAUNCH_READINESS.md release-launch-readiness marker",
  );
  requireCondition(
    marker.schemaVersion === 1
      && marker.kind === "release-launch-readiness"
      && marker.status === "READY"
      && marker.openP0 === 0
      && marker.openP1 === 0,
    "LAUNCH_READINESS.md release-launch-readiness marker must report READY with zero open P0 and P1 defects",
  );
  requireCondition(
    marker.product === attestation.product
      && marker.version === attestation.version
      && marker.productTag === approval.productTag
      && marker.productCommit === approval.productCommit
      && marker.manifestAggregateSha256 === approval.manifestAggregateSha256,
    "LAUNCH_READINESS.md release-launch-readiness marker does not match the approved candidate",
  );
}

function validateRollbackManifest(value, rollback) {
  const manifest = validateFormat2ReleaseManifest(value);
  requireCondition(manifest.version === rollback.releaseTag.slice(1), "rollback artifact manifest version does not match its tag");
  requireCondition(manifest.source.tag === rollback.releaseTag, "rollback artifact manifest tag does not match");
  requireCondition(manifest.source.commit === rollback.releaseCommit, "rollback artifact manifest commit does not match");
  requireCondition(manifest.source.tagObject === rollback.releaseTagObject, "rollback artifact manifest tag object does not match");
  requireCondition(manifest.aggregateSha256 === rollback.artifactAggregateSha256, "rollback artifact aggregate does not match the attestation");
  return manifest;
}

function validateRollbackRetrievalEvidence(value, rollback, manifestSha256, manifest) {
  const label = "rollback retrieval evidence";
  requireExactKeys(
    value,
    [
      "artifactAggregateSha256",
      "artifactLocator",
      "artifactManifestSha256",
      "archiveBytes",
      "archiveSha256",
      "kind",
      "product",
      "releaseCommit",
      "releaseTag",
      "releaseTagObject",
      "retrievedAt",
      "retrievedBy",
      "schemaVersion",
      "status",
      "version",
    ],
    label,
  );
  requireCondition(value.schemaVersion === 1 && value.kind === "rollback-retrieval", `${label} schema identity does not match`);
  requireCondition(value.status === "PASS" && value.product === "RIVET RIDGE RALLY", `${label} must report PASS for this product`);
  requireCondition(value.version === rollback.releaseTag.slice(1), `${label} version does not match`);
  for (const field of [
    "artifactAggregateSha256",
    "artifactLocator",
    "archiveBytes",
    "archiveSha256",
    "releaseCommit",
    "releaseTag",
    "releaseTagObject",
  ]) {
    requireCondition(value[field] === rollback[field], `${label}.${field} does not match the rollback release`);
  }
  requireCondition(
    value.artifactAggregateSha256 === manifest.aggregateSha256,
    `${label}.artifactAggregateSha256 does not match the validated predecessor manifest`,
  );
  requireCondition(value.artifactManifestSha256 === manifestSha256, `${label}.artifactManifestSha256 does not match`);
  requireBoundedString(value.retrievedBy, `${label}.retrievedBy`, 200);
  requireTimestamp(value.retrievedAt, `${label}.retrievedAt`);
  return value;
}

function validateRollbackSmokeEvidence(value, rollback, manifestSha256, productTag, manifest) {
  const label = "rollback smoke evidence";
  requireExactKeys(
    value,
    [
      "artifactAggregateSha256",
      "artifactLocator",
      "artifactManifestSha256",
      "archiveBytes",
      "archiveSha256",
      "console",
      "dataSafetyEvidence",
      "kind",
      "network",
      "product",
      "releaseCommit",
      "releaseTag",
      "releaseTagObject",
      "schemaVersion",
      "servedAfter",
      "servedBefore",
      "smokeError",
      "stagedBaseURL",
      "status",
      "steps",
      "testedAt",
      "testedBy",
      "version",
    ],
    label,
  );
  requireCondition(value.schemaVersion === 1 && value.kind === "rollback-smoke", `${label} schema identity does not match`);
  requireCondition(
    value.status === "PASS" && value.smokeError === null && value.product === "RIVET RIDGE RALLY",
    `${label} must report PASS without an error for this product`,
  );
  requireCondition(value.version === rollback.releaseTag.slice(1), `${label} version does not match`);
  for (const field of [
    "artifactAggregateSha256",
    "artifactLocator",
    "archiveBytes",
    "archiveSha256",
    "releaseCommit",
    "releaseTag",
    "releaseTagObject",
  ]) {
    requireCondition(value[field] === rollback[field], `${label}.${field} does not match the rollback release`);
  }
  requireCondition(value.artifactManifestSha256 === manifestSha256, `${label}.artifactManifestSha256 does not match`);
  const stagedBaseURL = validateRootUrl(value.stagedBaseURL, `${label}.stagedBaseURL`);
  for (const phase of ["servedBefore", "servedAfter"]) {
    validateServedInventory(
      value[phase],
      manifest,
      stagedBaseURL.href,
      `${label}.${phase}`,
    );
  }
  validateFileReference(value.dataSafetyEvidence, `${label}.dataSafetyEvidence`);
  requireCondition(
    value.dataSafetyEvidence.path === `artifacts/release-attestations/${productTag}-evidence/rollback/data-safety.json`,
    `${label}.dataSafetyEvidence.path is not canonical`,
  );
  requireCondition(
    Array.isArray(value.steps)
      && new Set(value.steps).size === value.steps.length
      && JSON.stringify(value.steps.toSorted()) === JSON.stringify(ROLLBACK_SMOKE_STEPS),
    `${label} step set is incomplete`,
  );
  requireExactKeys(value.network, ["failedRequests", "httpErrors"], `${label}.network`);
  requireCondition(
    Array.isArray(value.network?.failedRequests)
      && value.network.failedRequests.length === 0
      && Array.isArray(value.network?.httpErrors)
      && value.network.httpErrors.length === 0,
    `${label} contains request failures`,
  );
  requireExactKeys(value.console, ["unexpected"], `${label}.console`);
  requireCondition(
    Array.isArray(value.console?.unexpected) && value.console.unexpected.length === 0,
    `${label} contains unexpected console messages`,
  );
  requireBoundedString(value.testedBy, `${label}.testedBy`, 200);
  requireTimestamp(value.testedAt, `${label}.testedAt`);
  return value;
}

function validateRollbackDataSafetyEvidence(value, rollback, smoke) {
  const label = "rollback data-safety evidence";
  requireExactKeys(
    value,
    [
      "artifactAggregateSha256",
      "customTracksAfter",
      "customTracksBefore",
      "destructiveRecoveryUsed",
      "incompatibilityMessageVisible",
      "kind",
      "localSaveReadPassed",
      "outcome",
      "product",
      "progressRecordsAfter",
      "progressRecordsBefore",
      "releaseCommit",
      "releaseTag",
      "releaseTagObject",
      "replaysAfter",
      "replaysBefore",
      "rollbackNativeIndexedDbVersion",
      "schemaVersion",
      "siteDataCleared",
      "snapshotSha256After",
      "snapshotSha256Before",
      "sourceNativeIndexedDbVersion",
      "stagedBaseURL",
      "status",
      "testedAt",
      "testedBy",
      "version",
    ],
    label,
  );
  requireCondition(value.schemaVersion === 1 && value.kind === "rollback-data-safety", `${label} schema identity does not match`);
  requireCondition(value.status === "PASS" && value.product === "RIVET RIDGE RALLY", `${label} must report PASS for this product`);
  requireCondition(value.version === rollback.releaseTag.slice(1), `${label} version does not match`);
  for (const field of ["artifactAggregateSha256", "releaseCommit", "releaseTag", "releaseTagObject"]) {
    requireCondition(value[field] === rollback[field], `${label}.${field} does not match the rollback release`);
  }
  validateRootUrl(value.stagedBaseURL, `${label}.stagedBaseURL`);
  requireCondition(
    value.stagedBaseURL === smoke.stagedBaseURL,
    `${label}.stagedBaseURL does not match rollback smoke`,
  );
  requireCondition(value.sourceNativeIndexedDbVersion === 60, `${label} must begin with a database opened by native version 60`);
  requireCondition(value.rollbackNativeIndexedDbVersion === 30, `${label} must exercise the native version-30 predecessor`);
  requireCondition(
    ["safe-read", "non-destructive-incompatibility"].includes(value.outcome),
    `${label}.outcome must prove safe read or non-destructive incompatibility`,
  );
  requireCondition(value.siteDataCleared === false && value.destructiveRecoveryUsed === false, `${label} used destructive recovery`);
  if (value.outcome === "safe-read") {
    requireCondition(value.localSaveReadPassed === true && value.incompatibilityMessageVisible === false, `${label} safe-read result is inconsistent`);
  } else {
    requireCondition(value.localSaveReadPassed === false && value.incompatibilityMessageVisible === true, `${label} incompatibility result is not safely surfaced`);
  }
  for (const field of [
    "progressRecordsBefore",
    "progressRecordsAfter",
    "customTracksBefore",
    "customTracksAfter",
    "replaysBefore",
    "replaysAfter",
  ]) {
    requireCondition(Number.isSafeInteger(value[field]) && value[field] >= 0, `${label}.${field} must be a non-negative safe integer`);
  }
  for (const field of ["progressRecordsBefore", "customTracksBefore", "replaysBefore"]) {
    requireCondition(value[field] >= 1, `${label}.${field} must seed at least one persisted record`);
  }
  requireCondition(value.progressRecordsAfter === value.progressRecordsBefore, `${label} changed progress records`);
  requireCondition(value.customTracksAfter === value.customTracksBefore, `${label} changed custom tracks`);
  requireCondition(value.replaysAfter === value.replaysBefore, `${label} changed replays`);
  requireSha256(value.snapshotSha256Before, `${label}.snapshotSha256Before`);
  requireCondition(value.snapshotSha256After === value.snapshotSha256Before, `${label} changed the persisted-data snapshot`);
  requireBoundedString(value.testedBy, `${label}.testedBy`, 200);
  requireTimestamp(value.testedAt, `${label}.testedAt`);
  requireCondition(value.testedBy === smoke.testedBy && value.testedAt === smoke.testedAt, `${label} operator/time does not match rollback smoke`);
  return value;
}

function parseGitPathList(value, label) {
  if (value.length === 0) return [];
  const paths = value.includes("\0") ? value.split("\0").filter(Boolean) : value.split("\n").filter(Boolean);
  for (const changedPath of paths) validateRelativePath(changedPath, label);
  return paths;
}

async function inspectEvidenceCommit(productCommit, evidenceCommit, attestationPath, git, root) {
  try {
    await git(["merge-base", "--is-ancestor", productCommit, evidenceCommit], root);
  } catch {
    invalid("product release commit must be an ancestor of the evidence commit");
  }
  const range = `${productCommit}..${evidenceCommit}`;
  const changed = parseGitPathList(
    await git(["diff", "--name-only", "-z", "--diff-filter=AM", range, "--"], root),
    "evidence commit changed path",
  );
  const unsupported = parseGitPathList(
    await git(["diff", "--name-only", "-z", "--diff-filter=CDRTUXB", range, "--"], root),
    "evidence commit unsupported change path",
  );
  requireCondition(unsupported.length === 0, "evidence commit must not copy, delete, rename, or contain unresolved paths");
  requireCondition(changed.includes(attestationPath), "evidence commit must add or modify the attestation record");
  return changed;
}

async function inspectVisualPromotionCommit(candidateCommit, productCommit, git, root) {
  try {
    await git(["merge-base", "--is-ancestor", candidateCommit, productCommit], root);
  } catch {
    invalid("owner-reviewed visual candidate commit must be an ancestor of the product release commit");
  }
  const range = `${candidateCommit}..${productCommit}`;
  const changed = parseGitPathList(
    await git(["diff", "--name-only", "-z", "--diff-filter=AM", range, "--"], root),
    "visual promotion changed path",
  );
  const unsupported = parseGitPathList(
    await git(["diff", "--name-only", "-z", "--diff-filter=CDRTUXB", range, "--"], root),
    "visual promotion unsupported change path",
  );
  requireCondition(unsupported.length === 0, "visual promotion must not copy, delete, rename, or contain unresolved paths");
  const expectedPaths = [VISUAL_BASELINE_APPROVAL_PATH, VISUAL_BASELINE_PATH].toSorted();
  requireCondition(
    isDeepStrictEqual([...new Set(changed)].toSorted(), expectedPaths),
    "product release must differ from the owner-reviewed visual candidate only by the canonical approval record and promoted baseline",
  );
}

function validateEvidenceOnlyPaths(changedPaths, permittedPaths) {
  for (const changedPath of changedPaths) {
    requireCondition(permittedPaths.has(changedPath), `evidence commit changed a non-evidence path: ${changedPath}`);
  }
}

export async function verifyReleaseAttestation(
  attestationReference,
  { root = REPOSITORY_ROOT, git = defaultGit } = {},
) {
  const repositoryRoot = path.resolve(root);
  const attestationPath = normalizeInputPath(repositoryRoot, attestationReference, "attestation path");
  await assertNoSymlinkAncestors(repositoryRoot, attestationPath.absolute, "attestation path");
  const attestationEntry = await lstat(attestationPath.absolute);
  requireCondition(attestationEntry.isFile(), "attestation path must be a regular file");
  const attestationContents = await readFile(attestationPath.absolute);
  const attestation = validateReleaseAttestation(parseJson(attestationContents, "attestation"));

  const status = await git(["status", "--porcelain=v1", "--untracked-files=all"], repositoryRoot);
  requireCondition(status.length === 0, "attestation checkout must be clean");
  await requireTracked(attestationPath.relative, git, repositoryRoot, "attestation");
  const head = await git(["rev-parse", "HEAD^{commit}"], repositoryRoot);
  requireGitObject(head, "evidence commit");
  const attestationTag = `attestation/${attestation.productRelease.tag}`;
  const attestationTagObject = await git(["rev-parse", `refs/tags/${attestationTag}`], repositoryRoot);
  requireGitObject(attestationTagObject, "attestation tag object");
  requireCondition(await git(["cat-file", "-t", attestationTagObject], repositoryRoot) === "tag", "attestation tag must be annotated");
  requireCondition(await git(["rev-parse", `${attestationTagObject}^{commit}`], repositoryRoot) === head, "attestation tag must point to the evidence commit");
  const evidenceCommitPaths = await inspectEvidenceCommit(
    attestation.productRelease.commit,
    head,
    attestationPath.relative,
    git,
    repositoryRoot,
  );

  await verifyAnnotatedTag(
    attestation.productRelease.tag,
    attestation.productRelease.tagObject,
    attestation.productRelease.commit,
    "product release tag",
    git,
    repositoryRoot,
  );
  await verifyAnnotatedTag(
    attestation.rollback.releaseTag,
    attestation.rollback.releaseTagObject,
    attestation.rollback.releaseCommit,
    "rollback release tag",
    git,
    repositoryRoot,
  );

  const context = { root: repositoryRoot, git };
  const manifestReference = {
    path: attestation.productRelease.manifest.path,
    bytes: attestation.productRelease.manifest.bytes,
    sha256: attestation.productRelease.manifest.sha256,
  };
  const manifestFile = await loadVerifiedFile(manifestReference, "product release manifest", context);
  const manifest = validateFormat2ReleaseManifest(parseJson(manifestFile.contents, "product release manifest"));
  requireCondition(manifest.version === attestation.version, "manifest version does not match attestation");
  requireCondition(manifest.source.commit === attestation.productRelease.commit, "manifest commit does not match attestation");
  requireCondition(manifest.source.tag === attestation.productRelease.tag, "manifest tag does not match attestation");
  requireCondition(manifest.source.tagObject === attestation.productRelease.tagObject, "manifest tag object does not match attestation");
  requireCondition(manifest.aggregateSha256 === attestation.productRelease.manifest.aggregateSha256, "manifest aggregate does not match attestation");

  const performanceFile = await loadVerifiedFile(attestation.evidence.headedPerformance, "headed performance evidence", context);
  const performance = validatePerformanceEvidence(
    parseJson(performanceFile.contents, "headed performance evidence"),
    attestation.productRelease,
    attestation.version,
    manifest,
  );
  const soakFile = await loadVerifiedFile(attestation.evidence.soak, "soak evidence", context);
  const soak = validateSoakEvidence(
    parseJson(soakFile.contents, "soak evidence"),
    attestation.productRelease,
    attestation.version,
    manifest,
  );
  requireCondition(performance.aggregate === soak.aggregate, "performance and soak do not qualify the same QA candidate bytes");
  requireCondition(performance.aggregate === manifest.aggregateSha256, "performance and soak do not qualify the product manifest bytes");

  const smokeFile = await loadVerifiedFile(attestation.evidence.productionSmoke, "production smoke evidence", context);
  const smoke = await validateSmokeEvidence(
    parseJson(smokeFile.contents, "production smoke evidence"),
    attestation.evidence.productionSmoke,
    manifest,
    attestation.productRelease.manifest.sha256,
    attestation.productRelease,
    context,
  );

  const qaCheckPaths = [];
  const qaCheckCompletedTimes = [];
  for (const [check, reference] of Object.entries(attestation.evidence.qaChecks)) {
    const checkFile = await loadVerifiedFile(reference, `mandatory QA check ${check}`, context);
    const validatedCheck = validateQaCheckEvidence(
      parseJson(checkFile.contents, `mandatory QA check ${check}`),
      check,
      attestation.productRelease,
      attestation.version,
      manifest,
    );
    qaCheckPaths.push(reference.path);
    qaCheckCompletedTimes.push(Date.parse(validatedCheck.completedAt));
    for (const outputReference of validatedCheck.outputReferences) {
      await loadVerifiedFile(outputReference, `mandatory QA check ${check} command output`, context);
      qaCheckPaths.push(outputReference.path);
    }
  }

  const approvalSupportingPaths = [];
  for (const [name, approval] of Object.entries(attestation.approvals)) {
    const approvalFile = await loadVerifiedFile(approval.evidence, `${name} approval evidence`, context);
    const supportingEvidence = validateApprovalEvidence(
      parseJson(approvalFile.contents, `${name} approval evidence`),
      name,
      approval,
      attestation,
    );
    let visualApprovalRecord = null;
    let visualBaselineContents = null;
    for (const reference of supportingEvidence) {
      const supportingFile = await loadVerifiedFile(reference, `${name} approval supporting evidence`, context);
      if (name === "qa" && reference.path === "QA_REPORT.md") {
        validateQaReport(supportingFile.contents, approval, attestation);
      }
      if (name === "qa" && reference.path === "LAUNCH_READINESS.md") {
        validateLaunchReadiness(supportingFile.contents, approval, attestation);
      }
      if (name === "qa" && reference.path === VISUAL_BASELINE_APPROVAL_PATH) {
        visualApprovalRecord = validateVisualBaselineApprovalRecord(
          parseJson(supportingFile.contents, "visual baseline approval record"),
          attestation.version,
        );
      }
      if (name === "qa" && reference.path === VISUAL_BASELINE_PATH) {
        inspectPngIntegrity(supportingFile.contents, "promoted Canyon visual baseline", {
          width: 1_280,
          height: 720,
        });
        visualBaselineContents = supportingFile.contents;
      }
      if (![VISUAL_BASELINE_APPROVAL_PATH, VISUAL_BASELINE_PATH].includes(reference.path)) {
        approvalSupportingPaths.push(reference.path);
      }
    }
    if (name === "qa") {
      requireCondition(visualApprovalRecord !== null, "QA approval is missing a valid visual baseline approval record");
      requireCondition(visualBaselineContents !== null, "QA approval is missing the promoted Canyon visual baseline");
      requireCondition(
        visualBaselineContents.byteLength === visualApprovalRecord.promotedBaseline.bytes
          && sha256(visualBaselineContents) === visualApprovalRecord.promotedBaseline.sha256,
        "promoted Canyon visual baseline does not match its approval record",
      );
      requireCondition(
        Date.parse(visualApprovalRecord.approvedAt) <= Date.parse(approval.approvedAt),
        "QA approval predates the owner-approved visual baseline",
      );
      await inspectVisualPromotionCommit(
        visualApprovalRecord.candidateCommit,
        attestation.productRelease.commit,
        git,
        repositoryRoot,
      );
    }
  }
  const latestAutomatedEvidence = Math.max(
    Date.parse(performance.completedAt),
    Date.parse(soak.completedAt),
    Date.parse(smoke.completedAt),
    ...qaCheckCompletedTimes,
  );
  for (const [role, label] of [
    ["qa", "QA"],
    ["accessibility", "Accessibility"],
    ["legal", "Legal"],
  ]) {
    requireCondition(
      Date.parse(attestation.approvals[role].approvedAt) >= latestAutomatedEvidence,
      `${label} approval predates the mandatory automated evidence`,
    );
  }

  const rollbackManifestFile = await loadVerifiedFile(attestation.rollback.artifactManifest, "rollback artifact manifest", context);
  const rollbackManifest = validateRollbackManifest(
    parseJson(rollbackManifestFile.contents, "rollback artifact manifest"),
    attestation.rollback,
  );
  const retrievalFile = await loadVerifiedFile(attestation.rollback.retrievalEvidence, "rollback retrieval evidence", context);
  const retrieval = validateRollbackRetrievalEvidence(
    parseJson(retrievalFile.contents, "rollback retrieval evidence"),
    attestation.rollback,
    attestation.rollback.artifactManifest.sha256,
    rollbackManifest,
  );
  const rollbackSmokeFile = await loadVerifiedFile(attestation.rollback.smokeEvidence, "rollback smoke evidence", context);
  const rollbackSmoke = validateRollbackSmokeEvidence(
    parseJson(rollbackSmokeFile.contents, "rollback smoke evidence"),
    attestation.rollback,
    attestation.rollback.artifactManifest.sha256,
    attestation.productRelease.tag,
    rollbackManifest,
  );
  const rollbackDataSafetyFile = await loadVerifiedFile(
    rollbackSmoke.dataSafetyEvidence,
    "rollback data-safety evidence",
    context,
  );
  validateRollbackDataSafetyEvidence(
    parseJson(rollbackDataSafetyFile.contents, "rollback data-safety evidence"),
    attestation.rollback,
    rollbackSmoke,
  );
  requireCondition(Date.parse(retrieval.retrievedAt) <= Date.parse(rollbackSmoke.testedAt), "rollback smoke predates artifact retrieval");
  requireCondition(Date.parse(rollbackSmoke.testedAt) <= Date.parse(attestation.rollback.verifiedAt), "rollback verification predates rollback smoke");
  requireCondition(attestation.rollback.verifiedBy === rollbackSmoke.testedBy, "rollback verifier does not match the staged-smoke operator");

  const permittedEvidencePaths = new Set([
    attestationPath.relative,
    manifestReference.path,
    attestation.evidence.headedPerformance.path,
    attestation.evidence.soak.path,
    attestation.evidence.productionSmoke.path,
    ...qaCheckPaths,
    ...smoke.screenshotPaths,
    ...Object.values(attestation.approvals).map((approval) => approval.evidence.path),
    ...approvalSupportingPaths,
    attestation.rollback.artifactManifest.path,
    attestation.rollback.retrievalEvidence.path,
    attestation.rollback.smokeEvidence.path,
    rollbackSmoke.dataSafetyEvidence.path,
  ]);
  validateEvidenceOnlyPaths(evidenceCommitPaths, permittedEvidencePaths);

  return {
    schemaVersion: attestation.schemaVersion,
    product: attestation.product,
    version: attestation.version,
    productTag: attestation.productRelease.tag,
    productCommit: attestation.productRelease.commit,
    manifestSha256: attestation.productRelease.manifest.sha256,
    manifestAggregateSha256: attestation.productRelease.manifest.aggregateSha256,
    qaCandidateAggregateSha256: performance.aggregate,
    rollbackTag: attestation.rollback.releaseTag,
    evidenceCommit: head,
    attestationTag,
  };
}

function usage() {
  return "Usage: npm run release:attestation:verify -- --attestation PATH";
}

async function main() {
  const argumentsList = process.argv.slice(2);
  if (argumentsList.length === 1 && argumentsList[0] === "--help") {
    console.log(usage());
    return;
  }
  if (argumentsList.length !== 2 || argumentsList[0] !== "--attestation" || !argumentsList[1]) {
    throw new Error(usage());
  }
  const result = await verifyReleaseAttestation(argumentsList[1]);
  console.log(JSON.stringify({ status: "PASS", ...result }, null, 2));
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : null;
if (invokedPath === import.meta.url) await main();

import { execFile } from "node:child_process";
import { constants as fsConstants } from "node:fs";
import { copyFile, lstat, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual, promisify } from "node:util";

import { inspectPngIntegrity } from "./lib/png-integrity.mjs";
import {
  loadVisualCandidate,
  VISUAL_CANDIDATE_MANIFEST,
} from "./visual-candidate-support.mjs";

const SCRIPT_DIRECTORY = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIRECTORY, "..");
const TARGET_PATH = "e2e/visual-regression.spec.ts-snapshots/race-curved-course-canyon-chromium-darwin.png";
const APPROVAL_RECORD_PATH = "docs/design/RACE_CURVED_CANYON_BASELINE_APPROVAL.json";
const APPROVAL_KIND = "rivet-ridge-rally-visual-baseline-owner-approval";
const APPROVAL_STATEMENT = "I reviewed the exact Canyon Practice 500 capture against the approved concept art and accept it as the checked-in visual regression baseline.";
const CAPTURE_KIND = "five-track-controlled-visual-review";
const APPROVAL_AUTHENTICATION = "external-manual-trust-boundary";
const APPROVAL_FRESHNESS_MS = 24 * 60 * 60 * 1_000;
const TRACKS = Object.freeze([
  { id: "canyon-kickoff", name: "Canyon Kickoff", midcourseDistance: 650 },
  { id: "pine-run", name: "Pine Run", midcourseDistance: 720 },
  { id: "coastline-clash", name: "Coastline Clash", midcourseDistance: 790 },
  { id: "foundry-flight", name: "Foundry Flight", midcourseDistance: 825 },
  { id: "summit-showdown", name: "Summit Showdown", midcourseDistance: 900 },
]);
const EXPECTED_MATRIX = Object.freeze([
  ...TRACKS.map((track) => ({ track, phase: "start", mode: "practice", distance: 0 })),
  ...TRACKS.map((track) => ({ track, phase: "midcourse", mode: "rival", distance: track.midcourseDistance })),
  { track: TRACKS[0], phase: "curved-baseline-candidate", mode: "practice", distance: 500 },
]);
const REQUIRED_CHECKS = Object.freeze([
  "source-clean-before-and-after",
  "source-identity-stable",
  "source-matches-clean-qa-candidate",
  "candidate-version-matches-package",
  "local-build-inventory-stable",
  "served-build-inventory-stable",
  "runtime-source-commit-bound",
  "complete-capture-matrix",
  "browser-response-bodies-manifest-bound",
  "rival-assets-ready",
]);
const REQUIRED_COMMON_RESPONSE_PATHS = Object.freeze([
  "index.html",
  "assets/3d/hero-bike-rider.glb",
  "assets/fonts/barlow-condensed-700-latin.woff2",
  "assets/fonts/barlow-condensed-900-latin.woff2",
]);
const REQUIRED_CANYON_RESPONSE_PATHS = Object.freeze([
  "assets/canyon/canyon-kit.glb",
  "assets/art/canyon-festival-panorama.png",
]);
const REQUIRED_RIVAL_RESPONSE_PATHS = Object.freeze([
  "assets/rivals/rival-pack.glb",
]);
const SHA256_PATTERN = /^[0-9a-f]{64}$/u;
const GIT_OBJECT_PATTERN = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;
const PLACEHOLDER_REVIEWER_PATTERN = /^(?:anonymous|example|john doe|jane doe|name|n\/a|none|owner|placeholder|product owner|real reviewer name|reviewer|tbd|test|todo|unknown|your name)$/iu;
const execFileAsync = promisify(execFile);

function fail(message) {
  throw new Error(`Visual baseline promotion failed: ${message}`);
}

function requireCondition(condition, message) {
  if (!condition) fail(message);
}

function sha256(contents) {
  return createHash("sha256").update(contents).digest("hex");
}

function exactKeys(value, expectedKeys, label) {
  requireCondition(value !== null && typeof value === "object" && !Array.isArray(value), `${label} must be an object`);
  const actual = Object.keys(value).toSorted();
  const expected = [...expectedKeys].toSorted();
  requireCondition(JSON.stringify(actual) === JSON.stringify(expected), `${label} keys do not match the schema`);
}

function requireSha(value, label) {
  requireCondition(SHA256_PATTERN.test(value ?? ""), `${label} must be a lowercase SHA-256`);
}

function validateRelativePath(value, label) {
  requireCondition(typeof value === "string" && value.length > 0, `${label} is missing`);
  requireCondition(!isAbsolute(value) && !value.startsWith("/") && !value.includes("\\"), `${label} must be a relative POSIX path`);
  const segments = value.split("/");
  requireCondition(segments.every((segment) => segment && segment !== "." && segment !== ".."), `${label} is not canonical`);
  return value;
}

function isContainedPath(parent, child) {
  const childRelativePath = relative(parent, child);
  return childRelativePath === ""
    || (!isAbsolute(childRelativePath)
      && childRelativePath !== ".."
      && !childRelativePath.startsWith(`..${sep}`));
}

async function assertRepoPathHasNoSymlinks(absolutePath, label) {
  requireCondition(isContainedPath(REPO_ROOT, absolutePath), `${label} escapes the repository`);
  const relativePath = relative(REPO_ROOT, absolutePath);
  let current = REPO_ROOT;
  for (const segment of relativePath.split(sep).filter(Boolean)) {
    current = resolve(current, segment);
    const entry = await lstat(current).catch(() => null);
    if (entry === null) break;
    requireCondition(!entry.isSymbolicLink(), `${label} must not traverse symbolic links`);
  }
}

async function readRegularFile(absolutePath, label, { insideRepo = false } = {}) {
  if (insideRepo) await assertRepoPathHasNoSymlinks(absolutePath, label);
  const entry = await lstat(absolutePath).catch(() => null);
  requireCondition(entry?.isFile() === true && !entry.isSymbolicLink(), `${label} must be a regular file`);
  return readFile(absolutePath);
}

function parseJson(contents, label) {
  try {
    return JSON.parse(contents.toString("utf8"));
  } catch {
    fail(`${label} must contain valid JSON`);
  }
}

function parseArguments(argumentsList) {
  const values = new Map();
  for (let index = 0; index < argumentsList.length; index += 2) {
    const name = argumentsList[index];
    const value = argumentsList[index + 1];
    requireCondition(["--approval", "--capture-manifest"].includes(name), `unknown argument: ${name ?? "<missing>"}`);
    requireCondition(value && !value.startsWith("--"), `${name} requires a path`);
    requireCondition(!values.has(name), `${name} may be supplied only once`);
    values.set(name, value);
  }
  requireCondition(values.size === 2, "usage: npm run visual:promote:canyon -- --approval /external/approval.json --capture-manifest artifacts/visual-review/<run>/manifest.json");
  return {
    approvalPath: resolve(process.cwd(), values.get("--approval")),
    captureManifestPath: resolve(process.cwd(), values.get("--capture-manifest")),
  };
}

async function git(argumentsList) {
  const result = await execFileAsync("git", argumentsList, {
    cwd: REPO_ROOT,
    encoding: "utf8",
    maxBuffer: 4 * 1024 * 1024,
  }).catch(() => null);
  requireCondition(result !== null, `Git command failed: git ${argumentsList.join(" ")}`);
  return result.stdout.trim();
}

function validateTimestamp(value, label) {
  requireCondition(typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value), `${label} must be a canonical UTC timestamp`);
  const milliseconds = Date.parse(value);
  requireCondition(Number.isFinite(milliseconds) && new Date(milliseconds).toISOString() === value, `${label} is invalid`);
  requireCondition(milliseconds <= Date.now(), `${label} cannot be in the future`);
  return milliseconds;
}

function validateReadiness(value, commit, label) {
  exactKeys(value, [
    "ariaLabel",
    "bikeAsset",
    "canyonKitAsset",
    "environmentAsset",
    "runtimeBuild",
    "visualDistance",
    "visualState",
  ], label);
  exactKeys(value.runtimeBuild, ["commit", "dirty"], `${label}.runtimeBuild`);
  requireCondition(value.visualState === "frozen", `${label}.visualState must be frozen`);
  requireCondition(value.bikeAsset === "ready", `${label}.bikeAsset must be ready`);
  requireCondition(value.canyonKitAsset === "ready", `${label}.canyonKitAsset must be ready`);
  requireCondition(value.environmentAsset === "ready", `${label}.environmentAsset must be ready`);
  requireCondition(value.visualDistance === 500, `${label}.visualDistance must be 500`);
  requireCondition(value.ariaLabel === "Live 3D race on Canyon Kickoff", `${label}.ariaLabel does not match Canyon Kickoff`);
  requireCondition(value.runtimeBuild.commit === commit && value.runtimeBuild.dirty === false, `${label}.runtimeBuild is not bound to the clean capture commit`);
  return value;
}

export function validateVisualOwnerApproval(value, { enforceFreshness = true } = {}) {
  exactKeys(value, [
    "approvedAt",
    "authentication",
    "candidate",
    "decision",
    "kind",
    "reviewer",
    "schemaVersion",
    "screenshot",
    "statement",
  ], "owner approval");
  requireCondition(value.schemaVersion === 1 && value.kind === APPROVAL_KIND, "owner approval schema identity does not match");
  requireCondition(
    value.authentication === APPROVAL_AUTHENTICATION,
    `owner approval authentication must be ${APPROVAL_AUTHENTICATION}`,
  );
  requireCondition(value.decision === "ACCEPT", "owner approval decision must be ACCEPT");
  requireCondition(value.statement === APPROVAL_STATEMENT, "owner approval statement does not match the required explicit acceptance");
  const approvedAt = validateTimestamp(value.approvedAt, "owner approval approvedAt");
  if (enforceFreshness) {
    requireCondition(Date.now() - approvedAt <= APPROVAL_FRESHNESS_MS, "owner approval is older than the 24-hour promotion window");
  }

  exactKeys(value.reviewer, ["name", "role"], "owner approval reviewer");
  const reviewerName = typeof value.reviewer.name === "string" ? value.reviewer.name.trim() : "";
  requireCondition(reviewerName.length >= 3 && reviewerName.length <= 120, "owner approval reviewer.name must contain a non-placeholder attribution");
  requireCondition(value.reviewer.name === reviewerName, "owner approval reviewer.name must not contain surrounding whitespace");
  requireCondition(!/[\u0000-\u001f\u007f]/u.test(reviewerName), "owner approval reviewer.name must not contain control characters");
  requireCondition(!PLACEHOLDER_REVIEWER_PATTERN.test(reviewerName), "owner approval reviewer.name is a placeholder");
  requireCondition(value.reviewer.role === "product-owner", "owner approval reviewer.role must be product-owner");

  exactKeys(value.candidate, ["aggregateSha256", "captureManifestSha256", "commit"], "owner approval candidate");
  requireCondition(GIT_OBJECT_PATTERN.test(value.candidate.commit ?? ""), "owner approval candidate.commit is invalid");
  requireSha(value.candidate.aggregateSha256, "owner approval candidate.aggregateSha256");
  requireSha(value.candidate.captureManifestSha256, "owner approval candidate.captureManifestSha256");

  exactKeys(value.screenshot, [
    "bytes",
    "distance",
    "mode",
    "path",
    "project",
    "quality",
    "readiness",
    "sha256",
    "trackId",
    "viewport",
  ], "owner approval screenshot");
  validateRelativePath(value.screenshot.path, "owner approval screenshot.path");
  requireCondition(Number.isSafeInteger(value.screenshot.bytes) && value.screenshot.bytes > 0, "owner approval screenshot.bytes is invalid");
  requireSha(value.screenshot.sha256, "owner approval screenshot.sha256");
  requireCondition(value.screenshot.project === "chromium", "owner approval screenshot.project must be chromium");
  requireCondition(value.screenshot.mode === "practice", "owner approval screenshot.mode must be practice");
  requireCondition(value.screenshot.trackId === "canyon-kickoff", "owner approval screenshot.trackId must be canyon-kickoff");
  requireCondition(value.screenshot.distance === 500, "owner approval screenshot.distance must be 500");
  requireCondition(value.screenshot.quality === "high", "owner approval screenshot.quality must be high");
  exactKeys(value.screenshot.viewport, ["deviceScaleFactor", "height", "width"], "owner approval screenshot.viewport");
  requireCondition(
    value.screenshot.viewport.width === 1280
      && value.screenshot.viewport.height === 720
      && value.screenshot.viewport.deviceScaleFactor === 1,
    "owner approval screenshot.viewport must be 1280x720 at device scale factor 1",
  );
  validateReadiness(value.screenshot.readiness, value.candidate.commit, "owner approval screenshot.readiness");
  return { approval: value, approvedAt };
}

function validateFileRecord(record, label, { typed = false } = {}) {
  exactKeys(
    record,
    typed
      ? ["bytes", "gzipBytes", "gzipSha256", "path", "sha256", "type"]
      : ["bytes", "gzipBytes", "gzipSha256", "path", "sha256"],
    label,
  );
  if (typed) requireCondition(record.type === "file", `${label}.type must be file`);
  validateRelativePath(record.path, `${label}.path`);
  requireCondition(Number.isSafeInteger(record.bytes) && record.bytes >= 0, `${label}.bytes is invalid`);
  requireCondition(Number.isSafeInteger(record.gzipBytes) && record.gzipBytes >= 0, `${label}.gzipBytes is invalid`);
  requireSha(record.sha256, `${label}.sha256`);
  requireSha(record.gzipSha256, `${label}.gzipSha256`);
  return {
    path: record.path,
    bytes: record.bytes,
    gzipBytes: record.gzipBytes,
    gzipSha256: record.gzipSha256,
    sha256: record.sha256,
  };
}

function validateInventory(value, label) {
  exactKeys(value, [
    "aggregateSha256",
    "directory",
    "fileCount",
    "files",
    "totalBytes",
    "totalGzipBytes",
  ], label);
  requireCondition(value.directory === "dist", `${label}.directory must be dist`);
  requireCondition(Array.isArray(value.files) && value.files.length > 0, `${label}.files must be non-empty`);
  requireCondition(Number.isSafeInteger(value.fileCount) && value.fileCount === value.files.length, `${label}.fileCount does not match`);
  requireCondition(Number.isSafeInteger(value.totalBytes) && value.totalBytes >= 0, `${label}.totalBytes is invalid`);
  requireCondition(Number.isSafeInteger(value.totalGzipBytes) && value.totalGzipBytes >= 0, `${label}.totalGzipBytes is invalid`);
  requireSha(value.aggregateSha256, `${label}.aggregateSha256`);
  const records = value.files.map((record, index) => (
    validateFileRecord(record, `${label}.files[${index}]`, { typed: true })
  ));
  const paths = records.map((record) => record.path);
  requireCondition(new Set(paths).size === paths.length, `${label}.files contains duplicate paths`);
  requireCondition(JSON.stringify(paths) === JSON.stringify(paths.toSorted()), `${label}.files must use canonical path order`);
  requireCondition(records.reduce((sum, record) => sum + record.bytes, 0) === value.totalBytes, `${label}.totalBytes does not match its files`);
  requireCondition(records.reduce((sum, record) => sum + record.gzipBytes, 0) === value.totalGzipBytes, `${label}.totalGzipBytes does not match its files`);
  const aggregate = createHash("sha256");
  for (const record of records) aggregate.update(`${record.sha256}  ${record.path}\n`);
  requireCondition(aggregate.digest("hex") === value.aggregateSha256, `${label}.aggregateSha256 does not match its files`);
  return records;
}

function sameFileRecords(left, right) {
  return isDeepStrictEqual(left, right);
}

function requireInventoryMatchesCandidate(value, candidate, label) {
  const records = validateInventory(value, label);
  requireCondition(value.aggregateSha256 === candidate.aggregateSha256, `${label}.aggregateSha256 does not match the QA candidate`);
  requireCondition(value.fileCount === candidate.fileCount, `${label}.fileCount does not match the QA candidate`);
  requireCondition(value.totalBytes === candidate.totalBytes, `${label}.totalBytes does not match the QA candidate`);
  requireCondition(value.totalGzipBytes === candidate.totalGzipBytes, `${label}.totalGzipBytes does not match the QA candidate`);
  requireCondition(sameFileRecords(records, candidate.records), `${label}.files do not match the QA candidate`);
  return records;
}

function validateSourceIdentity(value, candidateManifest, label) {
  exactKeys(value, [
    "commit",
    "dirty",
    "dirtyEntryCount",
    "expectedTag",
    "expectedTagAnnotated",
    "expectedTagAtCommit",
    "expectedTagObjectType",
    "packageVersion",
    "tagsAtCommit",
  ], label);
  requireCondition(value.commit === candidateManifest.source.commit, `${label}.commit does not match the QA candidate`);
  requireCondition(value.packageVersion === candidateManifest.version, `${label}.packageVersion does not match the QA candidate`);
  requireCondition(value.expectedTag === candidateManifest.source.expectedVersionTag, `${label}.expectedTag does not match the QA candidate`);
  requireCondition(
    Array.isArray(value.tagsAtCommit)
      && isDeepStrictEqual(value.tagsAtCommit, [...new Set(value.tagsAtCommit)].toSorted())
      && isDeepStrictEqual(value.tagsAtCommit, candidateManifest.source.tagsAtCommit),
    `${label}.tagsAtCommit does not match the sorted QA-candidate tag set`,
  );
  requireCondition(
    value.expectedTagAtCommit === candidateManifest.source.expectedVersionTagAtCommit,
    `${label}.expectedTagAtCommit does not match the QA candidate`,
  );
  requireCondition(
    value.expectedTagAtCommit === false
      && candidateManifest.source.expectedVersionTagAtCommit === false,
    `${label} must precede the expected product tag`,
  );
  requireCondition(
    value.expectedTagObjectType === candidateManifest.source.expectedVersionTagObjectType,
    `${label}.expectedTagObjectType does not match the QA candidate`,
  );
  requireCondition(
    value.expectedTagAnnotated === (value.expectedTagObjectType === "tag"),
    `${label}.expectedTagAnnotated is inconsistent`,
  );
  requireCondition(
    value.expectedTagAnnotated === false && value.expectedTagObjectType === null,
    `${label} must not carry expected product-tag metadata`,
  );
  requireCondition(value.dirty === false && value.dirtyEntryCount === 0, `${label} is not clean`);
}

function validateChecks(value) {
  requireCondition(Array.isArray(value), "capture manifest candidate.checks must be an array");
  const ids = value.map((check) => check?.id);
  requireCondition(new Set(ids).size === ids.length, "capture manifest candidate.checks contains duplicate ids");
  for (const id of REQUIRED_CHECKS) {
    const check = value.find((candidate) => candidate?.id === id);
    requireCondition(check?.passed === true, `capture manifest check did not pass: ${id}`);
  }
}

function readinessProjection(value) {
  return {
    visualState: value?.visualState,
    bikeAsset: value?.bikeAsset,
    canyonKitAsset: value?.canyonKitAsset,
    environmentAsset: value?.environmentAsset,
    visualDistance: value?.visualDistance,
    ariaLabel: value?.ariaLabel,
    runtimeBuild: value?.runtimeBuild,
  };
}

function normalizeLoopbackRoot(value, label) {
  requireCondition(typeof value === "string", `${label} must be a URL string`);
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    fail(`${label} is not a valid URL`);
  }
  requireCondition(parsed.protocol === "http:", `${label} must use HTTP`);
  requireCondition(parsed.hostname === "127.0.0.1", `${label} must use the numeric loopback host 127.0.0.1`);
  requireCondition(/^\d{1,5}$/u.test(parsed.port), `${label} must include an explicit non-default port`);
  const port = Number(parsed.port);
  requireCondition(Number.isSafeInteger(port) && port > 0 && port <= 65_535, `${label} port is invalid`);
  requireCondition(parsed.username === "" && parsed.password === "", `${label} must not contain credentials`);
  requireCondition(parsed.pathname === "/" && parsed.search === "" && parsed.hash === "", `${label} must be a dedicated origin root`);
  requireCondition(parsed.href === value, `${label} must use its canonical root URL spelling`);
  return { baseURL: parsed.href, origin: parsed.origin, port };
}

function visualFreezeURL(baseURL, distance) {
  const target = new URL(baseURL);
  target.searchParams.set("qa-visual-freeze", "1");
  target.searchParams.set("qa-visual-distance", String(distance));
  return target.href;
}

function manifestPathFromResponseURL(value, expectedOrigin, expectedDistance, label) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    fail(`${label} is not a valid URL`);
  }
  requireCondition(parsed.origin === expectedOrigin, `${label} left the dedicated origin`);
  requireCondition(parsed.protocol === "http:", `${label} must use HTTP`);
  requireCondition(parsed.username === "" && parsed.password === "", `${label} must not contain credentials`);
  requireCondition(parsed.hash === "", `${label} must not contain a fragment`);
  requireCondition(!parsed.pathname.includes("%"), `${label} must not use an encoded path`);
  if (parsed.pathname === "/" || parsed.pathname === "/index.html") {
    requireCondition(
      parsed.search === `?qa-visual-freeze=1&qa-visual-distance=${expectedDistance}`,
      `${label} must use only the exact visual-freeze query for distance ${expectedDistance}`,
    );
    return "index.html";
  }
  requireCondition(parsed.search === "", `${label} asset URL must not contain a query`);
  return validateRelativePath(parsed.pathname.slice(1), `${label} manifest path`);
}

function validateResponseSet(value, candidate, server, expectedCapture, label) {
  exactKeys(value, [
    "cacheDisabled",
    "candidateAggregateSha256",
    "files",
    "finalOriginBound",
    "occurrences",
    "requestCount",
    "responseBodiesBound",
    "serviceWorkersBlocked",
    "status",
    "unexpectedResponses",
  ], label);
  requireCondition(value.status === "PASS", `${label}.status must be PASS`);
  requireCondition(value.candidateAggregateSha256 === candidate.aggregateSha256, `${label}.candidateAggregateSha256 does not match`);
  requireCondition(value.serviceWorkersBlocked === true, `${label}.serviceWorkersBlocked must be true`);
  requireCondition(value.cacheDisabled === true, `${label}.cacheDisabled must be true`);
  requireCondition(value.finalOriginBound === true, `${label}.finalOriginBound must be true`);
  requireCondition(value.responseBodiesBound === true, `${label}.responseBodiesBound must be true`);
  requireCondition(Array.isArray(value.unexpectedResponses) && value.unexpectedResponses.length === 0, `${label}.unexpectedResponses must be empty`);
  requireCondition(Array.isArray(value.occurrences) && value.occurrences.length > 0, `${label}.occurrences must be non-empty`);
  requireCondition(Array.isArray(value.files) && value.files.length > 0, `${label}.files must be non-empty`);
  requireCondition(
    Number.isSafeInteger(value.requestCount)
      && value.requestCount > 0
      && value.requestCount === value.occurrences.length,
    `${label}.requestCount must equal the positive occurrence count`,
  );
  const expectedOccurrenceOrder = value.occurrences.toSorted((left, right) => (
    String(left?.manifestPath).localeCompare(String(right?.manifestPath), "en")
      || String(left?.requestedURL).localeCompare(String(right?.requestedURL), "en")
      || String(left?.finalURL).localeCompare(String(right?.finalURL), "en")
  ));
  requireCondition(isDeepStrictEqual(value.occurrences, expectedOccurrenceOrder), `${label}.occurrences must use canonical order`);
  const collapsed = new Map();
  for (const [index, occurrence] of value.occurrences.entries()) {
    const occurrenceLabel = `${label}.occurrences[${index}]`;
    exactKeys(occurrence, [
      "bytes",
      "finalURL",
      "fromServiceWorker",
      "gzipBytes",
      "gzipSha256",
      "manifestPath",
      "requestedURL",
      "sha256",
      "status",
    ], occurrenceLabel);
    validateRelativePath(occurrence.manifestPath, `${occurrenceLabel}.manifestPath`);
    requireCondition(occurrence.status === 200, `${occurrenceLabel}.status must be 200`);
    requireCondition(occurrence.fromServiceWorker === false, `${occurrenceLabel} came from a service worker`);
    const requestedManifestPath = manifestPathFromResponseURL(
      occurrence.requestedURL,
      server.origin,
      expectedCapture.distance,
      `${occurrenceLabel}.requestedURL`,
    );
    const finalManifestPath = manifestPathFromResponseURL(
      occurrence.finalURL,
      server.origin,
      expectedCapture.distance,
      `${occurrenceLabel}.finalURL`,
    );
    requireCondition(occurrence.requestedURL === occurrence.finalURL, `${occurrenceLabel} redirected before capture`);
    requireCondition(requestedManifestPath === finalManifestPath, `${occurrenceLabel} requested and final paths differ`);
    requireCondition(occurrence.manifestPath === requestedManifestPath, `${occurrenceLabel}.manifestPath was not derived from its URL`);
    const expected = candidate.recordByPath.get(occurrence.manifestPath);
    requireCondition(expected !== undefined, `${occurrenceLabel} is not present in the QA candidate manifest`);
    const actual = validateFileRecord({
      path: occurrence.manifestPath,
      bytes: occurrence.bytes,
      gzipBytes: occurrence.gzipBytes,
      gzipSha256: occurrence.gzipSha256,
      sha256: occurrence.sha256,
    }, `${occurrenceLabel} response body`);
    requireCondition(sameFileRecords([actual], [expected]), `${occurrenceLabel} bytes do not match the QA candidate manifest`);
    const previous = collapsed.get(actual.path);
    requireCondition(previous === undefined || sameFileRecords([previous], [actual]), `${occurrenceLabel} disagrees with an earlier occurrence`);
    collapsed.set(actual.path, actual);
  }
  const files = value.files.map((record, index) => validateFileRecord(record, `${label}.files[${index}]`));
  const filePaths = files.map((record) => record.path);
  requireCondition(new Set(filePaths).size === filePaths.length, `${label}.files contains duplicate paths`);
  requireCondition(isDeepStrictEqual(filePaths, filePaths.toSorted()), `${label}.files must use canonical path order`);
  const sortedCollapsed = [...collapsed.values()].toSorted((left, right) => left.path.localeCompare(right.path, "en"));
  requireCondition(sameFileRecords(files, sortedCollapsed), `${label}.files is not the exact collapsed occurrence inventory`);
  const requiredPaths = [
    ...REQUIRED_COMMON_RESPONSE_PATHS,
    ...(expectedCapture.track.id === "canyon-kickoff" ? REQUIRED_CANYON_RESPONSE_PATHS : []),
    ...(expectedCapture.mode === "rival" ? REQUIRED_RIVAL_RESPONSE_PATHS : []),
  ];
  for (const requiredPath of requiredPaths) {
    requireCondition(collapsed.has(requiredPath), `${label} did not bind required response ${requiredPath}`);
  }
  requireCondition([...collapsed.keys()].some((path) => /^assets\/index-[^/]+\.js$/u.test(path)), `${label} did not bind the application JavaScript response`);
  requireCondition([...collapsed.keys()].some((path) => /^assets\/index-[^/]+\.css$/u.test(path)), `${label} did not bind the application CSS response`);
}

function validateViewport(value, label) {
  exactKeys(value, ["deviceScaleFactor", "height", "width"], label);
  requireCondition(
    value.width === 1280 && value.height === 720 && value.deviceScaleFactor === 1,
    `${label} must be 1280x720 at device scale factor 1`,
  );
}

function validateBrowser(value) {
  exactKeys(value, [
    "cache",
    "headless",
    "name",
    "platform",
    "serviceWorkers",
    "version",
  ], "capture manifest browser");
  requireCondition(value.name === "Chromium", "capture browser name must be Chromium");
  requireCondition(typeof value.version === "string" && value.version.length > 0, "capture browser version is missing");
  requireCondition(value.platform === "darwin", "capture browser platform must be darwin");
  requireCondition(value.headless === true, "capture browser must be headless");
  requireCondition(value.serviceWorkers === "block", "capture browser must block service workers");
  requireCondition(value.cache === "disabled", "capture browser cache must be disabled");
}

function validateServer(value, topLevelBaseURL, candidateManifestSha256) {
  exactKeys(value, [
    "baseURL",
    "candidateManifestSha256",
    "dedicatedLoopback",
    "host",
    "origin",
    "port",
    "protocol",
    "verificationEntrypointURL",
  ], "capture manifest server");
  const normalized = normalizeLoopbackRoot(topLevelBaseURL, "capture manifest baseURL");
  requireCondition(value.baseURL === normalized.baseURL, "capture server baseURL does not match the top-level baseURL");
  requireCondition(value.origin === normalized.origin, "capture server origin does not match its baseURL");
  requireCondition(value.protocol === "http:", "capture server protocol must be http:");
  requireCondition(value.host === "127.0.0.1", "capture server host must be 127.0.0.1");
  requireCondition(value.port === normalized.port, "capture server port does not match its baseURL");
  requireCondition(value.dedicatedLoopback === true, "capture server must be dedicated loopback");
  requireCondition(
    value.candidateManifestSha256 === candidateManifestSha256,
    "capture server candidate-manifest SHA-256 does not match the re-inventoried candidate",
  );
  requireCondition(
    value.verificationEntrypointURL === visualFreezeURL(normalized.baseURL, 0),
    "capture server verification entrypoint must be the exact root distance-0 freeze URL",
  );
  return { ...normalized, verificationEntrypointURL: value.verificationEntrypointURL };
}

function validateServedBuild(value, candidate, server, label) {
  exactKeys(value, [
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
  requireCondition(value.verified === true, `${label}.verified must be true`);
  requireCondition(value.baseURL === server.baseURL, `${label}.baseURL does not match the dedicated root`);
  requireCondition(value.origin === server.origin, `${label}.origin does not match the dedicated root`);
  normalizeLoopbackRoot(value.baseURL, `${label}.baseURL`);
  requireCondition(Array.isArray(value.files) && value.files.length > 0, `${label}.files must be non-empty`);
  const records = value.files.map((record, index) => validateFileRecord(record, `${label}.files[${index}]`));
  const paths = records.map((record) => record.path);
  requireCondition(new Set(paths).size === paths.length, `${label}.files contains duplicate paths`);
  requireCondition(isDeepStrictEqual(paths, paths.toSorted()), `${label}.files must use canonical path order`);
  requireCondition(value.fileCount === records.length, `${label}.fileCount does not match its files`);
  requireCondition(value.totalBytes === records.reduce((sum, record) => sum + record.bytes, 0), `${label}.totalBytes does not match its files`);
  requireCondition(value.totalGzipBytes === records.reduce((sum, record) => sum + record.gzipBytes, 0), `${label}.totalGzipBytes does not match its files`);
  const aggregate = createHash("sha256");
  for (const record of records) aggregate.update(`${record.sha256}  ${record.path}\n`);
  requireCondition(value.aggregateSha256 === aggregate.digest("hex"), `${label}.aggregateSha256 does not match its files`);
  requireCondition(value.aggregateSha256 === candidate.aggregateSha256, `${label}.aggregateSha256 does not match the QA candidate`);
  requireCondition(value.fileCount === candidate.fileCount, `${label}.fileCount does not match the QA candidate`);
  requireCondition(value.totalBytes === candidate.totalBytes, `${label}.totalBytes does not match the QA candidate`);
  requireCondition(value.totalGzipBytes === candidate.totalGzipBytes, `${label}.totalGzipBytes does not match the QA candidate`);
  requireCondition(sameFileRecords(records, candidate.records), `${label}.files do not match the QA candidate`);
  exactKeys(value.entrypoint, ["bytes", "finalURL", "requestedURL", "sha256"], `${label}.entrypoint`);
  requireCondition(
    value.entrypoint.requestedURL === server.verificationEntrypointURL
      && value.entrypoint.finalURL === server.verificationEntrypointURL,
    `${label}.entrypoint must remain on the exact distance-0 dedicated root`,
  );
  requireCondition(
    manifestPathFromResponseURL(value.entrypoint.requestedURL, server.origin, 0, `${label}.entrypoint.requestedURL`) === "index.html"
      && manifestPathFromResponseURL(value.entrypoint.finalURL, server.origin, 0, `${label}.entrypoint.finalURL`) === "index.html",
    `${label}.entrypoint did not resolve to candidate index.html`,
  );
  const indexRecord = candidate.recordByPath.get("index.html");
  requireCondition(indexRecord !== undefined, "QA candidate is missing index.html");
  requireCondition(
    value.entrypoint.bytes === indexRecord.bytes && value.entrypoint.sha256 === indexRecord.sha256,
    `${label}.entrypoint bytes do not match candidate index.html`,
  );
  return records;
}

function expectedRaceHeading(expectedCapture) {
  const mode = expectedCapture.mode === "practice" ? "Practice" : expectedCapture.mode;
  return `${expectedCapture.track.name} ${mode} race`;
}

function validateCaptureReadiness(value, expectedCapture, commit, label) {
  exactKeys(value, [
    "ariaLabel",
    "bikeAsset",
    "canyonKitAsset",
    "canyonKitGameplayAuthority",
    "canyonKitMeshCount",
    "canyonKitPlacementCount",
    "canyonKitProceduralReplacementCount",
    "canyonKitReplacedProceduralVisualCount",
    "canyonKitRetainedCoolingCueCount",
    "canyonKitRootCount",
    "canyonKitTabletopRole",
    "environmentAsset",
    "raceHeading",
    "rivalPackAsset",
    "runtimeBuild",
    "visualDistance",
    "visualState",
  ], label);
  exactKeys(value.runtimeBuild, ["commit", "dirty"], `${label}.runtimeBuild`);
  requireCondition(value.runtimeBuild.commit === commit && value.runtimeBuild.dirty === false, `${label}.runtimeBuild is not bound to the clean capture commit`);
  requireCondition(value.visualState === "frozen", `${label}.visualState must be frozen`);
  requireCondition(value.bikeAsset === "ready", `${label}.bikeAsset must be ready`);
  requireCondition(value.visualDistance === expectedCapture.distance, `${label}.visualDistance does not match the matrix distance`);
  requireCondition(value.ariaLabel === `Live 3D race on ${expectedCapture.track.name}`, `${label}.ariaLabel does not match the matrix track`);
  requireCondition(value.raceHeading === expectedRaceHeading(expectedCapture), `${label}.raceHeading does not match the matrix track and mode`);
  requireCondition(
    value.rivalPackAsset === (expectedCapture.mode === "rival" ? "ready" : "not-applicable"),
    `${label}.rivalPackAsset does not match the matrix mode`,
  );
  const canyonMetrics = [
    "canyonKitGameplayAuthority",
    "canyonKitMeshCount",
    "canyonKitPlacementCount",
    "canyonKitProceduralReplacementCount",
    "canyonKitReplacedProceduralVisualCount",
    "canyonKitRetainedCoolingCueCount",
    "canyonKitRootCount",
    "canyonKitTabletopRole",
  ];
  if (expectedCapture.track.id === "canyon-kickoff") {
    requireCondition(value.canyonKitAsset === "ready", `${label}.canyonKitAsset must be ready`);
    requireCondition(value.environmentAsset === "ready", `${label}.environmentAsset must be ready`);
    requireCondition(value.canyonKitRootCount === "11", `${label}.canyonKitRootCount must be 11`);
    requireCondition(/^\d+$/u.test(value.canyonKitPlacementCount ?? "") && Number(value.canyonKitPlacementCount) > 0, `${label}.canyonKitPlacementCount must be positive`);
    requireCondition(/^\d+$/u.test(value.canyonKitMeshCount ?? "") && Number(value.canyonKitMeshCount) > 0, `${label}.canyonKitMeshCount must be positive`);
    requireCondition(value.canyonKitGameplayAuthority === "presentation-only", `${label}.canyonKitGameplayAuthority is invalid`);
    requireCondition(value.canyonKitProceduralReplacementCount === "8", `${label}.canyonKitProceduralReplacementCount must be 8`);
    requireCondition(value.canyonKitReplacedProceduralVisualCount === "18", `${label}.canyonKitReplacedProceduralVisualCount must be 18`);
    requireCondition(value.canyonKitRetainedCoolingCueCount === "12", `${label}.canyonKitRetainedCoolingCueCount must be 12`);
    requireCondition(value.canyonKitTabletopRole === "gameplay-ramp-shell", `${label}.canyonKitTabletopRole is invalid`);
  } else {
    requireCondition(value.canyonKitAsset === "not-applicable", `${label}.canyonKitAsset must be not-applicable`);
    requireCondition(value.environmentAsset === "not-applicable", `${label}.environmentAsset must be not-applicable`);
    requireCondition(canyonMetrics.every((key) => value[key] === null), `${label} contains Canyon-only readiness metrics`);
  }
}

function captureMatrixKey(value) {
  return `${value?.trackId}|${value?.phase}|${value?.mode}|${value?.distance}`;
}

export function validateVisualCaptureManifest(
  value,
  approval,
  candidate,
  candidateManifestDocument,
  candidateReference,
  packageVersion,
) {
  exactKeys(value, [
    "appVersion",
    "baseURL",
    "browser",
    "candidate",
    "captures",
    "createdAt",
    "kind",
    "productionCourseScale",
    "qaBuildRequired",
    "quality",
    "schemaVersion",
    "server",
    "status",
    "viewport",
  ], "capture manifest");
  requireCondition(value.schemaVersion === 3 && value.kind === CAPTURE_KIND, "capture manifest schema identity does not match");
  requireCondition(value.status === "PASS", "capture manifest status must be PASS");
  const createdAt = validateTimestamp(value.createdAt, "capture manifest createdAt");
  requireCondition(createdAt <= Date.parse(approval.approvedAt), "owner approval predates the capture manifest");
  requireCondition(value.appVersion === packageVersion, "capture manifest appVersion does not match package.json");
  requireCondition(value.appVersion === candidateManifestDocument.version, "capture manifest appVersion does not match the QA candidate");
  requireCondition(value.qaBuildRequired === true, "capture manifest qaBuildRequired must be true");
  requireCondition(value.quality === "high", "capture manifest quality must be high");
  requireCondition(value.productionCourseScale === true, "capture manifest productionCourseScale must be true");
  validateViewport(value.viewport, "capture manifest viewport");
  validateBrowser(value.browser);
  const server = validateServer(value.server, value.baseURL, candidateReference.sha256);

  exactKeys(value.candidate, [
    "checks",
    "errors",
    "localBuildAfter",
    "localBuildBefore",
    "manifest",
    "servedAfter",
    "servedBefore",
    "sourceAfter",
    "sourceBefore",
  ], "capture manifest candidate");
  requireCondition(Array.isArray(value.candidate.errors) && value.candidate.errors.length === 0, "capture manifest candidate.errors must be empty");
  exactKeys(value.candidate.manifest, [
    "aggregateSha256",
    "fileCount",
    "format",
    "kind",
    "path",
    "sha256",
    "sourceCommit",
    "totalBytes",
    "totalGzipBytes",
  ], "capture manifest candidate.manifest");
  requireCondition(value.candidate.manifest.path === candidateReference.path, "capture candidate-manifest path is inconsistent");
  requireCondition(value.candidate.manifest.sha256 === candidateReference.sha256, "capture candidate-manifest SHA-256 is inconsistent");
  requireCondition(value.candidate.manifest.kind === "visual-qa-candidate" && value.candidate.manifest.format === 1, "capture candidate-manifest schema identity is inconsistent");
  requireCondition(value.candidate.manifest.sourceCommit === approval.candidate.commit, "capture candidate source commit does not match approval");
  requireCondition(value.candidate.manifest.sourceCommit === candidateManifestDocument.source.commit, "capture candidate source commit does not match the re-inventoried candidate");
  requireCondition(value.candidate.manifest.aggregateSha256 === candidate.aggregateSha256, "capture candidate aggregate does not match");
  requireCondition(value.candidate.manifest.fileCount === candidate.fileCount, "capture candidate file count does not match");
  requireCondition(value.candidate.manifest.totalBytes === candidate.totalBytes, "capture candidate byte count does not match");
  requireCondition(value.candidate.manifest.totalGzipBytes === candidate.totalGzipBytes, "capture candidate gzip byte count does not match");
  validateSourceIdentity(value.candidate.sourceBefore, candidateManifestDocument, "capture manifest sourceBefore");
  validateSourceIdentity(value.candidate.sourceAfter, candidateManifestDocument, "capture manifest sourceAfter");
  requireCondition(isDeepStrictEqual(value.candidate.sourceBefore, value.candidate.sourceAfter), "capture source identity changed during capture");
  const localBefore = requireInventoryMatchesCandidate(value.candidate.localBuildBefore, candidate, "capture manifest localBuildBefore");
  const localAfter = requireInventoryMatchesCandidate(value.candidate.localBuildAfter, candidate, "capture manifest localBuildAfter");
  requireCondition(sameFileRecords(localBefore, localAfter), "local QA build changed during capture");
  const servedBefore = validateServedBuild(value.candidate.servedBefore, candidate, server, "capture manifest servedBefore");
  const servedAfter = validateServedBuild(value.candidate.servedAfter, candidate, server, "capture manifest servedAfter");
  requireCondition(sameFileRecords(servedBefore, servedAfter), "served QA build changed during capture");
  requireCondition(isDeepStrictEqual(value.candidate.servedBefore, value.candidate.servedAfter), "served evidence changed during capture");
  validateChecks(value.candidate.checks);

  requireCondition(Array.isArray(value.captures) && value.captures.length === EXPECTED_MATRIX.length, "capture manifest must contain the exact 11-entry matrix");
  const expectedByKey = new Map(EXPECTED_MATRIX.map((expected) => [captureMatrixKey({
    trackId: expected.track.id,
    phase: expected.phase,
    mode: expected.mode,
    distance: expected.distance,
  }), expected]));
  const seenKeys = new Set();
  let baselineCapture = null;
  for (const [index, capture] of value.captures.entries()) {
    const label = `capture manifest captures[${index}]`;
    exactKeys(capture, [
      "bytes",
      "diagnostics",
      "distance",
      "error",
      "file",
      "mode",
      "phase",
      "project",
      "quality",
      "readiness",
      "responseSet",
      "sha256",
      "state",
      "status",
      "trackId",
      "trackName",
      "viewport",
    ], label);
    const key = captureMatrixKey(capture);
    const expected = expectedByKey.get(key);
    requireCondition(expected !== undefined, `${label} is outside the fixed capture matrix`);
    requireCondition(!seenKeys.has(key), `${label} duplicates a fixed capture-matrix entry`);
    seenKeys.add(key);
    requireCondition(capture.trackName === expected.track.name, `${label}.trackName does not match the matrix`);
    requireCondition(capture.project === "chromium", `${label}.project must be chromium`);
    requireCondition(capture.quality === "high", `${label}.quality must be high`);
    requireCondition(capture.status === "PASS", `${label}.status must be PASS`);
    requireCondition(capture.error === null, `${label}.error must be null`);
    exactKeys(capture.diagnostics, ["consoleMessages", "failedRequests", "httpErrors"], `${label}.diagnostics`);
    requireCondition(
      Object.values(capture.diagnostics).every((entries) => Array.isArray(entries) && entries.length === 0),
      `${label}.diagnostics must contain only empty arrays`,
    );
    exactKeys(capture.state, ["fastRace", "highContrast", "query", "uiScale"], `${label}.state`);
    requireCondition(
      capture.state.query === `?qa-visual-freeze=1&qa-visual-distance=${expected.distance}`
        && capture.state.fastRace === false
        && capture.state.highContrast === false
        && capture.state.uiScale === 1,
      `${label}.state does not match the normal frozen visual contract`,
    );
    validateViewport(capture.viewport, `${label}.viewport`);
    requireCondition(isDeepStrictEqual(capture.viewport, value.viewport), `${label}.viewport differs from the top-level viewport`);
    const expectedFile = `${expected.phase}/${expected.track.id}-${expected.mode}-1280x720.png`;
    requireCondition(capture.file === expectedFile, `${label}.file does not match the fixed capture path`);
    validateRelativePath(capture.file, `${label}.file`);
    requireCondition(Number.isSafeInteger(capture.bytes) && capture.bytes > 0, `${label}.bytes is invalid`);
    requireSha(capture.sha256, `${label}.sha256`);
    validateCaptureReadiness(capture.readiness, expected, approval.candidate.commit, `${label}.readiness`);
    validateResponseSet(capture.responseSet, candidate, server, expected, `${label}.responseSet`);
    if (expected.phase === "curved-baseline-candidate") baselineCapture = capture;
  }
  requireCondition(seenKeys.size === EXPECTED_MATRIX.length, "capture manifest is missing a fixed capture-matrix entry");
  requireCondition(baselineCapture !== null, "capture manifest is missing the Canyon Practice 500 baseline candidate");

  const readiness = readinessProjection(baselineCapture.readiness);
  validateReadiness(readiness, approval.candidate.commit, "Canyon Practice 500 readiness");
  requireCondition(baselineCapture.file === approval.screenshot.path, "approved screenshot path does not match capture manifest");
  requireCondition(baselineCapture.bytes === approval.screenshot.bytes, "approved screenshot bytes do not match capture manifest");
  requireCondition(baselineCapture.sha256 === approval.screenshot.sha256, "approved screenshot SHA-256 does not match capture manifest");
  requireCondition(isDeepStrictEqual(baselineCapture.viewport, approval.screenshot.viewport), "approved viewport does not match capture manifest");
  requireCondition(baselineCapture.project === approval.screenshot.project, "approved project does not match capture manifest");
  requireCondition(baselineCapture.mode === approval.screenshot.mode, "approved mode does not match capture manifest");
  requireCondition(baselineCapture.trackId === approval.screenshot.trackId, "approved track does not match capture manifest");
  requireCondition(baselineCapture.distance === approval.screenshot.distance, "approved distance does not match capture manifest");
  requireCondition(baselineCapture.quality === approval.screenshot.quality, "approved quality does not match capture manifest");
  requireCondition(isDeepStrictEqual(readiness, approval.screenshot.readiness), "approved readiness does not match capture manifest");
  return baselineCapture;
}

async function validateCaptureFiles(captureManifest, captureManifestRealPath) {
  const captureBundleDirectory = dirname(captureManifestRealPath);
  const seenPaths = new Set();
  const seenRealPaths = new Set();
  const seenFileIdentities = new Set();
  const seenHashes = new Set();
  const verifiedFiles = new Map();
  for (const [index, capture] of captureManifest.captures.entries()) {
    const label = `capture manifest captures[${index}] screenshot`;
    requireCondition(!seenPaths.has(capture.file), `${label} duplicates screenshot path ${capture.file}`);
    seenPaths.add(capture.file);
    const absolutePath = resolve(captureBundleDirectory, capture.file);
    requireCondition(isContainedPath(captureBundleDirectory, absolutePath), `${label} escapes the capture bundle`);
    requireCondition(
      relative(captureBundleDirectory, absolutePath).split(sep).join("/") === capture.file,
      `${label} path is not canonical within the capture bundle`,
    );
    await assertRepoPathHasNoSymlinks(absolutePath, label);
    const entry = await lstat(absolutePath).catch(() => null);
    requireCondition(entry?.isFile() === true && !entry.isSymbolicLink(), `${label} must be a regular file`);
    const screenshotRealPath = await realpath(absolutePath).catch(() => null);
    requireCondition(screenshotRealPath === absolutePath, `${label} must not resolve through an alias or symbolic link`);
    requireCondition(isContainedPath(captureBundleDirectory, screenshotRealPath), `${label} real path escapes the capture bundle`);
    requireCondition(!seenRealPaths.has(screenshotRealPath), `${label} aliases another capture screenshot`);
    seenRealPaths.add(screenshotRealPath);
    const fileIdentity = `${entry.dev}:${entry.ino}`;
    requireCondition(!seenFileIdentities.has(fileIdentity), `${label} is a hard link to another capture screenshot`);
    seenFileIdentities.add(fileIdentity);
    const contents = await readRegularFile(absolutePath, label, { insideRepo: true });
    requireCondition(contents.byteLength > 0 && contents.byteLength === capture.bytes, `${label} byte count does not match the capture manifest`);
    const hash = sha256(contents);
    requireCondition(hash === capture.sha256, `${label} SHA-256 does not match the capture manifest`);
    requireCondition(!seenHashes.has(hash), `${label} duplicates another capture screenshot's bytes`);
    seenHashes.add(hash);
    inspectPngIntegrity(contents, label, {
      width: capture.viewport.width,
      height: capture.viewport.height,
    });
    verifiedFiles.set(capture.file, { absolutePath, contents });
  }
  requireCondition(
    verifiedFiles.size === EXPECTED_MATRIX.length,
    "capture bundle does not contain one verified screenshot for every fixed matrix entry",
  );
  return verifiedFiles;
}

async function assertAbsent(absolutePath, label) {
  const entry = await lstat(absolutePath).catch((error) => {
    if (error?.code === "ENOENT") return null;
    throw error;
  });
  requireCondition(entry === null, `${label} already exists`);
}

async function main() {
  requireCondition(process.platform === "darwin", "the fixed baseline target is darwin-specific");
  const { approvalPath, captureManifestPath } = parseArguments(process.argv.slice(2));
  const repositoryRealPath = await realpath(REPO_ROOT);
  const approvalRealPath = await realpath(approvalPath).catch(() => null);
  requireCondition(approvalRealPath !== null && !isContainedPath(repositoryRealPath, approvalRealPath), "--approval must identify an external owner-authored file outside the repository");
  const approvalContents = await readRegularFile(approvalRealPath, "external owner approval");
  const { approval, approvedAt } = validateVisualOwnerApproval(parseJson(approvalContents, "external owner approval"));

  const captureManifestRealPath = await realpath(captureManifestPath).catch(() => null);
  requireCondition(captureManifestRealPath !== null && isContainedPath(repositoryRealPath, captureManifestRealPath), "--capture-manifest must stay inside the repository");
  const captureManifestRepoPath = relative(REPO_ROOT, captureManifestRealPath).split(sep).join("/");
  requireCondition(
    /^artifacts\/visual-review\/[a-z0-9][a-z0-9._-]*\/manifest\.json$/iu.test(captureManifestRepoPath),
    "--capture-manifest must be a direct visual-review bundle manifest",
  );
  const captureManifestContents = await readRegularFile(captureManifestRealPath, "capture manifest", { insideRepo: true });
  requireCondition(sha256(captureManifestContents) === approval.candidate.captureManifestSha256, "capture manifest SHA-256 does not match owner approval");
  const captureManifest = parseJson(captureManifestContents, "capture manifest");

  const loadedCandidate = await loadVisualCandidate();
  requireCondition(
    loadedCandidate.manifestReference === VISUAL_CANDIDATE_MANIFEST,
    `QA candidate loader did not return ${VISUAL_CANDIDATE_MANIFEST}`,
  );
  const candidateManifestContents = await readRegularFile(
    loadedCandidate.manifestPath,
    "re-inventoried QA candidate manifest",
    { insideRepo: true },
  );
  requireCondition(
    sha256(candidateManifestContents) === loadedCandidate.manifestSha256,
    "re-inventoried QA candidate manifest SHA-256 is inconsistent",
  );
  requireCondition(
    loadedCandidate.manifest.source.commit === approval.candidate.commit,
    "re-inventoried QA candidate source commit does not match approval",
  );
  requireCondition(
    loadedCandidate.manifest.aggregateSha256 === approval.candidate.aggregateSha256,
    "re-inventoried QA candidate aggregate does not match approval",
  );
  const packageJsonContents = await readRegularFile(resolve(REPO_ROOT, "package.json"), "package.json", { insideRepo: true });
  const packageJson = parseJson(packageJsonContents, "package.json");
  requireCondition(
    typeof packageJson.version === "string" && packageJson.version === loadedCandidate.manifest.version,
    "re-inventoried QA candidate version does not match package.json",
  );
  const candidateRecords = validateInventory(loadedCandidate.inventory, "re-inventoried QA candidate distribution");
  const candidate = {
    aggregateSha256: loadedCandidate.inventory.aggregateSha256,
    fileCount: loadedCandidate.inventory.fileCount,
    totalBytes: loadedCandidate.inventory.totalBytes,
    totalGzipBytes: loadedCandidate.inventory.totalGzipBytes,
    records: candidateRecords,
    recordByPath: new Map(candidateRecords.map((record) => [record.path, record])),
  };
  for (const requiredPath of [
    "THIRD_PARTY_NOTICES.txt",
    "index.html",
    "sw.js",
    ...REQUIRED_COMMON_RESPONSE_PATHS,
    ...REQUIRED_CANYON_RESPONSE_PATHS,
    ...REQUIRED_RIVAL_RESPONSE_PATHS,
  ]) {
    requireCondition(candidate.recordByPath.has(requiredPath), `re-inventoried QA candidate is missing ${requiredPath}`);
  }
  const capture = validateVisualCaptureManifest(
    captureManifest,
    approval,
    candidate,
    loadedCandidate.manifest,
    { path: loadedCandidate.manifestReference, sha256: loadedCandidate.manifestSha256 },
    packageJson.version,
  );
  const verifiedCaptureFiles = await validateCaptureFiles(captureManifest, captureManifestRealPath);
  const approvedScreenshot = verifiedCaptureFiles.get(capture.file);
  requireCondition(approvedScreenshot !== undefined, "approved Canyon screenshot was not verified with the complete capture matrix");
  const { absolutePath: screenshotPath, contents: screenshotContents } = approvedScreenshot;
  requireCondition(screenshotContents.byteLength === capture.bytes, "approved screenshot byte count does not match capture manifest");
  requireCondition(sha256(screenshotContents) === capture.sha256, "approved screenshot SHA-256 does not match capture manifest");

  const headCommit = await git(["rev-parse", "HEAD^{commit}"]);
  requireCondition(headCommit === approval.candidate.commit, "HEAD is not the exact approved capture commit");
  const sourceStatus = await git(["status", "--porcelain=v1", "--untracked-files=all"]);
  requireCondition(sourceStatus === "", "source must be clean before baseline promotion");

  const targetPath = resolve(REPO_ROOT, TARGET_PATH);
  const approvalRecordPath = resolve(REPO_ROOT, APPROVAL_RECORD_PATH);
  await assertRepoPathHasNoSymlinks(dirname(targetPath), "baseline target parent");
  await assertRepoPathHasNoSymlinks(dirname(approvalRecordPath), "approval-record parent");
  await assertAbsent(targetPath, "Canyon baseline target");
  await assertAbsent(approvalRecordPath, "canonical approval record");

  const canonicalRecord = {
    schemaVersion: 2,
    kind: "rivet-ridge-rally-visual-baseline-approval-record",
    authentication: APPROVAL_AUTHENTICATION,
    ownerApproval: approval,
    evidence: {
      captureManifest: {
        path: captureManifestRepoPath,
        bytes: captureManifestContents.byteLength,
        sha256: sha256(captureManifestContents),
        document: captureManifest,
      },
      candidateManifest: {
        path: loadedCandidate.manifestReference,
        bytes: candidateManifestContents.byteLength,
        sha256: sha256(candidateManifestContents),
        aggregateSha256: candidate.aggregateSha256,
        document: loadedCandidate.manifest,
      },
    },
    promotedBaseline: {
      path: TARGET_PATH,
      bytes: screenshotContents.byteLength,
      sha256: sha256(screenshotContents),
    },
  };
  const canonicalRecordContents = Buffer.from(`${JSON.stringify(canonicalRecord, null, 2)}\n`);

  let wroteBaseline = false;
  let wroteApproval = false;
  try {
    requireCondition(Date.now() - approvedAt <= APPROVAL_FRESHNESS_MS, "owner approval expired before output mutation");
    await writeFile(approvalRecordPath, canonicalRecordContents, { flag: "wx" });
    wroteApproval = true;
    await copyFile(screenshotPath, targetPath, fsConstants.COPYFILE_EXCL);
    wroteBaseline = true;
    const [writtenBaseline, writtenApproval] = await Promise.all([
      readRegularFile(targetPath, "promoted Canyon baseline", { insideRepo: true }),
      readRegularFile(approvalRecordPath, "canonical approval record", { insideRepo: true }),
    ]);
    requireCondition(sha256(writtenBaseline) === capture.sha256, "promoted baseline verification failed");
    requireCondition(sha256(writtenApproval) === sha256(canonicalRecordContents), "canonical approval-record verification failed");
    const changedPaths = (await git(["status", "--porcelain=v1", "-z", "--untracked-files=all"]))
      .split("\0")
      .filter(Boolean)
      .map((entry) => ({ status: entry.slice(0, 2), path: entry.slice(3) }));
    requireCondition(changedPaths.length === 2, "promotion changed more than its two fixed outputs");
    requireCondition(changedPaths.every((entry) => entry.status === "??"), "promotion modified an existing tracked path");
    requireCondition(
      JSON.stringify(changedPaths.map((entry) => entry.path).toSorted())
        === JSON.stringify([TARGET_PATH, APPROVAL_RECORD_PATH].toSorted()),
      "promotion changed a path outside its two fixed outputs",
    );
  } catch (error) {
    if (wroteBaseline) await rm(targetPath, { force: true }).catch(() => undefined);
    if (wroteApproval) await rm(approvalRecordPath, { force: true }).catch(() => undefined);
    throw error;
  }

  console.log(`Promoted ${TARGET_PATH}`);
  console.log(`Recorded ${APPROVAL_RECORD_PATH}`);
  console.log("Commit only the promoted baseline and approval record, then tag and rerun the non-mutating visual suite.");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();

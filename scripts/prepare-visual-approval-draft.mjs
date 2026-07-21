import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const SCRIPT_DIRECTORY = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIRECTORY, "..");
const APPROVAL_KIND = "rivet-ridge-rally-visual-baseline-owner-approval";
const APPROVAL_AUTHENTICATION = "external-manual-trust-boundary";
const APPROVAL_STATEMENT = "I reviewed the exact Canyon Practice 500 capture against the approved concept art and accept it as the checked-in visual regression baseline.";
const CAPTURE_KIND = "five-track-controlled-visual-review";
const BASELINE_FILE = "curved-baseline-candidate/canyon-kickoff-practice-1280x720.png";
const SHA256_PATTERN = /^[0-9a-f]{64}$/u;
const COMMIT_PATTERN = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;

function fail(message) {
  throw new Error(`Visual approval draft failed: ${message}`);
}

function requireCondition(condition, message) {
  if (!condition) fail(message);
}

function sha256(contents) {
  return createHash("sha256").update(contents).digest("hex");
}

function parseArguments(argumentsList) {
  const values = new Map();
  for (let index = 0; index < argumentsList.length; index += 2) {
    const name = argumentsList[index];
    const value = argumentsList[index + 1];
    requireCondition(["--capture-manifest", "--output"].includes(name), `unknown argument: ${name ?? "<missing>"}`);
    requireCondition(value && !value.startsWith("--"), `${name} requires a path`);
    requireCondition(!values.has(name), `${name} may be supplied only once`);
    values.set(name, value);
  }
  requireCondition(values.size === 2, "usage: npm run visual:approval:draft -- --capture-manifest artifacts/visual-review/<run>/manifest.json --output /external/canyon-owner-approval.draft.json");
  return {
    captureManifestPath: resolve(process.cwd(), values.get("--capture-manifest")),
    outputPath: resolve(process.cwd(), values.get("--output")),
  };
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

async function readRegularRepoFile(absolutePath, label) {
  await assertRepoPathHasNoSymlinks(absolutePath, label);
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

function exactKeys(value, expectedKeys, label) {
  requireCondition(value !== null && typeof value === "object" && !Array.isArray(value), `${label} must be an object`);
  const actual = Object.keys(value).toSorted();
  const expected = [...expectedKeys].toSorted();
  requireCondition(JSON.stringify(actual) === JSON.stringify(expected), `${label} keys do not match`);
}

function validateViewport(value, label) {
  exactKeys(value, ["deviceScaleFactor", "height", "width"], label);
  requireCondition(
    value.width === 1280 && value.height === 720 && value.deviceScaleFactor === 1,
    `${label} must be 1280x720 at device scale factor 1`,
  );
}

function approvalReadinessFromCapture(value, commit) {
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
  ], "baseline capture readiness");
  exactKeys(value.runtimeBuild, ["commit", "dirty"], "baseline capture readiness.runtimeBuild");
  requireCondition(value.visualState === "frozen", "baseline capture visualState must be frozen");
  requireCondition(value.bikeAsset === "ready", "baseline capture bikeAsset must be ready");
  requireCondition(value.canyonKitAsset === "ready", "baseline capture canyonKitAsset must be ready");
  requireCondition(value.environmentAsset === "ready", "baseline capture environmentAsset must be ready");
  requireCondition(value.visualDistance === 500, "baseline capture visualDistance must be 500");
  requireCondition(value.ariaLabel === "Live 3D race on Canyon Kickoff", "baseline capture ariaLabel does not match Canyon Kickoff");
  requireCondition(value.runtimeBuild.commit === commit && value.runtimeBuild.dirty === false, "baseline capture runtimeBuild is not cleanly source-bound");
  return {
    visualState: value.visualState,
    bikeAsset: value.bikeAsset,
    canyonKitAsset: value.canyonKitAsset,
    environmentAsset: value.environmentAsset,
    visualDistance: value.visualDistance,
    ariaLabel: value.ariaLabel,
    runtimeBuild: value.runtimeBuild,
  };
}

function validateCaptureManifest(value) {
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
  requireCondition(value.qaBuildRequired === true, "capture manifest must be QA-candidate bound");
  requireCondition(value.quality === "high", "capture manifest quality must be high");
  requireCondition(value.productionCourseScale === true, "capture manifest must use production course scale");
  validateViewport(value.viewport, "capture manifest viewport");
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
  requireCondition(value.candidate.manifest.kind === "visual-qa-candidate", "candidate manifest kind must be visual-qa-candidate");
  requireCondition(value.candidate.manifest.format === 1, "candidate manifest format must be 1");
  requireCondition(COMMIT_PATTERN.test(value.candidate.manifest.sourceCommit ?? ""), "candidate source commit is invalid");
  requireCondition(SHA256_PATTERN.test(value.candidate.manifest.aggregateSha256 ?? ""), "candidate aggregate SHA-256 is invalid");
  requireCondition(SHA256_PATTERN.test(value.candidate.manifest.sha256 ?? ""), "candidate manifest SHA-256 is invalid");
  requireCondition(Array.isArray(value.captures) && value.captures.length === 11, "capture manifest must contain the 11-entry review matrix");
  const baselineCapture = value.captures.find((capture) => (
    capture?.file === BASELINE_FILE
      && capture.phase === "curved-baseline-candidate"
      && capture.trackId === "canyon-kickoff"
      && capture.mode === "practice"
      && capture.distance === 500
  ));
  requireCondition(baselineCapture !== undefined, "capture manifest is missing the Canyon Practice 500 baseline candidate");
  requireCondition(baselineCapture.status === "PASS" && baselineCapture.error === null, "baseline capture must be PASS with no error");
  requireCondition(baselineCapture.project === "chromium", "baseline capture project must be chromium");
  requireCondition(baselineCapture.quality === "high", "baseline capture quality must be high");
  validateViewport(baselineCapture.viewport, "baseline capture viewport");
  requireCondition(Number.isSafeInteger(baselineCapture.bytes) && baselineCapture.bytes > 0, "baseline capture bytes are invalid");
  requireCondition(SHA256_PATTERN.test(baselineCapture.sha256 ?? ""), "baseline capture SHA-256 is invalid");
  const readiness = approvalReadinessFromCapture(
    baselineCapture.readiness,
    value.candidate.manifest.sourceCommit,
  );
  return { baselineCapture, readiness };
}

async function main() {
  const { captureManifestPath, outputPath } = parseArguments(process.argv.slice(2));
  const repositoryRealPath = await realpath(REPO_ROOT);
  const captureManifestRealPath = await realpath(captureManifestPath).catch(() => null);
  requireCondition(captureManifestRealPath !== null && isContainedPath(repositoryRealPath, captureManifestRealPath), "--capture-manifest must stay inside the repository");
  const outputParent = await realpath(dirname(outputPath)).catch(() => null);
  requireCondition(outputParent !== null, "--output parent directory must already exist");
  requireCondition(!isContainedPath(repositoryRealPath, outputPath), "--output must be outside the repository so the owner-authored decision is not mistaken for committed evidence");

  const captureManifestContents = await readRegularRepoFile(captureManifestRealPath, "capture manifest");
  const captureManifest = parseJson(captureManifestContents, "capture manifest");
  const { baselineCapture, readiness } = validateCaptureManifest(captureManifest);
  const captureManifestSha256 = sha256(captureManifestContents);

  const draft = {
    schemaVersion: 1,
    kind: APPROVAL_KIND,
    authentication: APPROVAL_AUTHENTICATION,
    decision: "PENDING_OWNER_REVIEW",
    approvedAt: "REPLACE_WITH_CURRENT_UTC_TIMESTAMP_AFTER_REVIEW",
    reviewer: { name: "REPLACE_WITH_REAL_PRODUCT_OWNER_NAME", role: "product-owner" },
    statement: APPROVAL_STATEMENT,
    candidate: {
      commit: captureManifest.candidate.manifest.sourceCommit,
      aggregateSha256: captureManifest.candidate.manifest.aggregateSha256,
      captureManifestSha256,
    },
    screenshot: {
      path: baselineCapture.file,
      bytes: baselineCapture.bytes,
      sha256: baselineCapture.sha256,
      project: baselineCapture.project,
      viewport: baselineCapture.viewport,
      mode: baselineCapture.mode,
      trackId: baselineCapture.trackId,
      distance: baselineCapture.distance,
      quality: baselineCapture.quality,
      readiness,
    },
  };

  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(draft, null, 2)}\n`, { flag: "wx" });
  console.log(`Wrote non-acceptance visual approval draft: ${outputPath}`);
  console.log("Owner review is still required; this draft is intentionally rejected by the promotion tool until decision, timestamp, and reviewer are owner-authored.");
  console.log("Required owner edits after review: set decision=ACCEPT, set approvedAt to the current UTC timestamp, set reviewer.name to the real product-owner name, and do not change candidate or screenshot hash fields.");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();

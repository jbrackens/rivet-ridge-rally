import { createHash } from "node:crypto";
import { lstat, mkdir, realpath, rename } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, sep } from "node:path";

import { verifyServedRelease } from "./production-smoke-support.mjs";

const SCREENSHOT_FILE_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*\.png$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;

function isContainedPath(parent, child) {
  const childRelativePath = relative(parent, child);
  return childRelativePath === ""
    || (!isAbsolute(childRelativePath)
      && childRelativePath !== ".."
      && !childRelativePath.startsWith(`..${sep}`));
}

export async function assertPathHasNoSymlinkAncestors(
  parent,
  child,
  { lstatImpl = lstat } = {},
) {
  if (!isContainedPath(parent, child)) {
    throw new Error("Production smoke evidence path escaped its repository root.");
  }
  const parentEntry = await lstatImpl(parent);
  if (parentEntry.isSymbolicLink()) {
    throw new Error("Production smoke evidence paths must not traverse symbolic links.");
  }
  const childRelativePath = relative(parent, child);
  let current = parent;
  for (const segment of childRelativePath.split(sep).filter(Boolean)) {
    current = join(current, segment);
    try {
      const entry = await lstatImpl(current);
      if (entry.isSymbolicLink()) {
        throw new Error("Production smoke evidence paths must not traverse symbolic links.");
      }
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return;
      throw error;
    }
  }
}

export async function prepareEvidenceDirectory(
  repositoryRoot,
  directory,
  {
    lstatImpl = lstat,
    mkdirImpl = mkdir,
  } = {},
) {
  await assertPathHasNoSymlinkAncestors(repositoryRoot, directory, { lstatImpl });
  await mkdirImpl(directory, { recursive: true });
  await assertPathHasNoSymlinkAncestors(repositoryRoot, directory, { lstatImpl });
  return directory;
}

export async function prepareEvidenceRoot(
  repositoryRoot,
  artifactRoot,
  {
    lstatImpl = lstat,
    mkdirImpl = mkdir,
    realpathImpl = realpath,
  } = {},
) {
  await prepareEvidenceDirectory(repositoryRoot, artifactRoot, { lstatImpl, mkdirImpl });
  const repositoryRealPath = await realpathImpl(repositoryRoot);
  const artifactRealPath = await realpathImpl(artifactRoot);
  if (!isContainedPath(repositoryRealPath, artifactRealPath)) {
    throw new Error("Production smoke evidence root resolves outside the repository.");
  }
  return { repositoryRealPath, artifactRealPath };
}

export function validateScreenshotFileName(fileName) {
  if (typeof fileName !== "string" || !SCREENSHOT_FILE_NAME_PATTERN.test(fileName)) {
    throw new Error("Production smoke screenshot name is unsafe.");
  }
  return fileName;
}

export function createScreenshotEvidence(fileName, contents) {
  validateScreenshotFileName(fileName);
  if (!(contents instanceof Uint8Array) || contents.byteLength === 0) {
    throw new Error(`Production smoke screenshot is empty: ${fileName}`);
  }
  return {
    path: fileName,
    bytes: contents.byteLength,
    sha256: createHash("sha256").update(contents).digest("hex"),
  };
}

export function aggregateScreenshotEvidence(records) {
  if (!Array.isArray(records)) {
    throw new Error("Production smoke screenshot evidence must be an array.");
  }
  const paths = new Set();
  for (const record of records) {
    if (
      record === null
      || typeof record !== "object"
      || typeof record.path !== "string"
      || !SCREENSHOT_FILE_NAME_PATTERN.test(record.path)
      || !Number.isSafeInteger(record.bytes)
      || record.bytes <= 0
      || !SHA256_PATTERN.test(record.sha256 ?? "")
    ) {
      throw new Error("Production smoke screenshot evidence is invalid.");
    }
    if (paths.has(record.path)) {
      throw new Error(`Production smoke screenshot path is duplicated: ${record.path}`);
    }
    paths.add(record.path);
  }
  const aggregate = createHash("sha256");
  for (const record of records.toSorted((left, right) => (
    left.path < right.path ? -1 : left.path > right.path ? 1 : 0
  ))) {
    aggregate.update(`${record.sha256}  ${record.path}\n`);
  }
  return aggregate.digest("hex");
}

export async function waitForRaceGateRacing(page, timeoutMs = 20_000) {
  await page.locator('[data-race-gate-phase="racing"]').waitFor({
    state: "attached",
    timeout: timeoutMs,
  });
}

export async function waitForRestartedRaceGate(page, {
  transitionTimeoutMs = 15_000,
  racingTimeoutMs = 20_000,
} = {}) {
  await page.locator('[data-race-gate-phase="loading"], [data-race-gate-phase="countdown"]').waitFor({
    state: "attached",
    timeout: transitionTimeoutMs,
  });
  await waitForRaceGateRacing(page, racingTimeoutMs);
}

export async function promoteEvidenceBundle(
  stagingDirectory,
  bundleDirectory,
  { mkdirImpl = mkdir, renameImpl = rename } = {},
) {
  await mkdirImpl(dirname(bundleDirectory), { recursive: true });
  await renameImpl(stagingDirectory, bundleDirectory);
  return bundleDirectory;
}

export async function verifyServedReleaseAfterJourney(
  manifest,
  baseURL,
  servedBefore,
  { verifyImpl = verifyServedRelease } = {},
) {
  if (servedBefore?.verified !== true) {
    throw new Error("Production smoke cannot reverify an unbound pre-journey candidate.");
  }
  const servedAfter = await verifyImpl(manifest, baseURL);
  const stable = servedAfter?.verified === true
    && servedAfter.aggregateSha256 === servedBefore.aggregateSha256
    && servedAfter.fileCount === servedBefore.fileCount
    && servedAfter.totalBytes === servedBefore.totalBytes
    && servedAfter.totalGzipBytes === servedBefore.totalGzipBytes
    && servedAfter.entrypoint?.sha256 === servedBefore.entrypoint?.sha256;
  if (!stable) {
    throw new Error("Production smoke served candidate changed during the browser journey.");
  }
  return servedAfter;
}

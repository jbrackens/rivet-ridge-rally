import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { gzipSync } from "node:zlib";

import { REPO_ROOT } from "./performance/common.mjs";

const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const GIT_OBJECT_PATTERN = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;

function sha256(contents) {
  return createHash("sha256").update(contents).digest("hex");
}

export function withDeadline(promise, timeoutMs, message) {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return Promise.reject(new Error("Production smoke deadline is invalid."));
  }
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(message)), timeoutMs);
    Promise.resolve(promise).then(
      (value) => {
        clearTimeout(timeout);
        resolve(value);
      },
      (error) => {
        clearTimeout(timeout);
        reject(error);
      },
    );
  });
}

function requireManifest(condition, message) {
  if (!condition) throw new Error(`Production smoke manifest is invalid: ${message}`);
}

function requireExactManifestKeys(value, keys, label) {
  requireManifest(
    value !== null
      && typeof value === "object"
      && !Array.isArray(value)
      && Object.keys(value).length === keys.length
      && keys.every((key) => Object.hasOwn(value, key)),
    `${label} fields do not match the release schema`,
  );
}

function validateNpmPackageProvenance(value, npmVersion) {
  requireExactManifestKeys(value, [
    "treeFormat",
    "name",
    "version",
    "cliRelativePath",
    "packageJsonSha256",
    "directoryCount",
    "regularFileCount",
    "symlinkCount",
    "totalRegularFileBytes",
    "treeSha256",
  ], "npmPackage");
  requireManifest(value.treeFormat === 1, "npm package tree format must be 1");
  requireManifest(value.name === "npm", "npm package name is invalid");
  requireManifest(value.version === npmVersion, "npm package version does not match npm");
  requireManifest(value.cliRelativePath === "bin/npm-cli.js", "npm package CLI path is invalid");
  requireManifest(SHA256_PATTERN.test(value.packageJsonSha256), "npm package.json SHA-256 is invalid");
  requireManifest(
    Number.isSafeInteger(value.directoryCount) && value.directoryCount > 0,
    "npm package directory count is invalid",
  );
  requireManifest(
    Number.isSafeInteger(value.regularFileCount) && value.regularFileCount > 0,
    "npm package regular-file count is invalid",
  );
  requireManifest(
    Number.isSafeInteger(value.symlinkCount) && value.symlinkCount >= 0,
    "npm package symbolic-link count is invalid",
  );
  requireManifest(
    Number.isSafeInteger(value.totalRegularFileBytes) && value.totalRegularFileBytes > 0,
    "npm package byte count is invalid",
  );
  requireManifest(SHA256_PATTERN.test(value.treeSha256), "npm package tree SHA-256 is invalid");
}

function validateReleasePath(value) {
  requireManifest(typeof value === "string" && value.length > 0, "file path is missing");
  requireManifest(!value.startsWith("/"), `file path must be relative: ${value}`);
  requireManifest(!value.includes("\\"), `file path must use forward slashes: ${value}`);
  const segments = value.split("/");
  requireManifest(
    segments.every((segment) => segment.length > 0 && segment !== "." && segment !== ".."),
    `file path is not canonical: ${value}`,
  );
}

export function validateFormat2ReleaseManifest(value) {
  requireManifest(value !== null && typeof value === "object" && !Array.isArray(value), "root must be an object");
  requireManifest(value.format === 2, "format must be 2");
  requireManifest(value.product === "RIVET RIDGE RALLY", "product identity does not match");
  requireManifest(typeof value.version === "string" && value.version.length > 0, "version is missing");
  requireManifest(value.source !== null && typeof value.source === "object", "source identity is missing");
  requireManifest(GIT_OBJECT_PATTERN.test(value.source.commit ?? ""), "source commit is invalid");
  requireManifest(value.source.tag === `v${value.version}`, "source tag does not match the version");
  requireManifest(GIT_OBJECT_PATTERN.test(value.source.tagObject ?? ""), "annotated tag object is invalid");
  requireManifest(value.source.tagObjectType === "tag", "source tag object is not annotated");
  requireManifest(value.toolchain !== null && typeof value.toolchain === "object", "toolchain identity is missing");
  requireManifest(typeof value.toolchain.node === "string" && value.toolchain.node.length > 0, "Node identity is missing");
  requireManifest(
    SHA256_PATTERN.test(value.toolchain.nodeExecutableSha256 ?? ""),
    "Node executable SHA-256 is invalid",
  );
  requireManifest(typeof value.toolchain.npm === "string" && value.toolchain.npm.length > 0, "npm identity is missing");
  requireManifest(SHA256_PATTERN.test(value.toolchain.npmCliSha256 ?? ""), "npm CLI SHA-256 is invalid");
  validateNpmPackageProvenance(value.toolchain.npmPackage, value.toolchain.npm);
  requireManifest(SHA256_PATTERN.test(value.toolchain.packageLockSha256 ?? ""), "package-lock SHA-256 is invalid");
  requireManifest(typeof value.toolchain.platform === "string" && value.toolchain.platform.length > 0, "platform is missing");
  requireManifest(typeof value.toolchain.arch === "string" && value.toolchain.arch.length > 0, "architecture is missing");
  requireManifest(value.build !== null && typeof value.build === "object", "build provenance is missing");
  requireManifest(value.build.source === "detached-clean-git-worktree", "build source is invalid");
  requireManifest(value.build.installCommand === "npm ci --no-audit --no-fund", "install command is invalid");
  requireManifest(value.build.buildCommand === "npm run build", "build command is invalid");
  requireManifest(value.build.viteQaMode === "0", "build is not the non-QA candidate");
  requireManifest(value.build.npmConfig === "isolated-empty-user-and-global", "npm config provenance is invalid");
  requireManifest(value.build.installScripts === "enabled", "install-script provenance is invalid");
  requireManifest(value.compression?.algorithm === "gzip", "compression algorithm must be gzip");
  requireManifest(value.compression?.level === 9, "compression level must be 9");
  requireManifest(SHA256_PATTERN.test(value.aggregateSha256 ?? ""), "aggregate SHA-256 is invalid");
  requireManifest(Array.isArray(value.files) && value.files.length > 0, "file list is empty");
  requireManifest(Number.isSafeInteger(value.fileCount), "file count is invalid");
  requireManifest(Number.isSafeInteger(value.totalBytes) && value.totalBytes >= 0, "total byte count is invalid");
  requireManifest(Number.isSafeInteger(value.totalGzipBytes) && value.totalGzipBytes >= 0, "total gzip byte count is invalid");

  const paths = new Set();
  let totalBytes = 0;
  let totalGzipBytes = 0;
  const aggregate = createHash("sha256");
  for (const record of value.files) {
    requireManifest(record !== null && typeof record === "object", "file record must be an object");
    validateReleasePath(record.path);
    requireManifest(!paths.has(record.path), `duplicate file path: ${record.path}`);
    requireManifest(Number.isSafeInteger(record.bytes) && record.bytes >= 0, `invalid byte count: ${record.path}`);
    requireManifest(Number.isSafeInteger(record.gzipBytes) && record.gzipBytes >= 0, `invalid gzip byte count: ${record.path}`);
    requireManifest(SHA256_PATTERN.test(record.gzipSha256 ?? ""), `invalid gzip SHA-256: ${record.path}`);
    requireManifest(SHA256_PATTERN.test(record.sha256 ?? ""), `invalid SHA-256: ${record.path}`);
    paths.add(record.path);
    totalBytes += record.bytes;
    totalGzipBytes += record.gzipBytes;
    aggregate.update(`${record.sha256}  ${record.path}\n`);
  }

  requireManifest(value.fileCount === value.files.length, "file count does not match the file list");
  requireManifest(totalBytes === value.totalBytes, "total byte count does not match the file list");
  requireManifest(totalGzipBytes === value.totalGzipBytes, "total gzip byte count does not match the file list");
  requireManifest(
    aggregate.digest("hex") === value.aggregateSha256,
    "aggregate SHA-256 does not match the file list",
  );
  requireManifest(paths.has("THIRD_PARTY_NOTICES.txt"), "third-party notices are missing");
  requireManifest(paths.has("index.html"), "index.html is missing");
  requireManifest(paths.has("sw.js"), "service worker is missing");

  return value;
}

export async function loadFormat2ReleaseManifest(reference) {
  let contents;
  try {
    contents = await readFile(resolve(REPO_ROOT, reference));
  } catch {
    throw new Error("Production smoke requires a readable format-2 release manifest.");
  }

  let parsed;
  try {
    parsed = JSON.parse(contents.toString("utf8"));
  } catch {
    throw new Error("Production smoke requires valid JSON in the format-2 release manifest.");
  }

  return {
    manifest: validateFormat2ReleaseManifest(parsed),
    manifestSha256: sha256(contents),
  };
}

export function normalizeProductionBaseURL(value) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("Production smoke base URL is invalid.");
  }
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("Production smoke base URL must use HTTP or HTTPS.");
  }
  if (parsed.username || parsed.password) {
    throw new Error("Production smoke base URL must not contain credentials.");
  }
  if (parsed.pathname !== "/" || parsed.search || parsed.hash) {
    throw new Error("Production smoke base URL must be the root of a dedicated origin.");
  }
  return parsed.href;
}

export async function verifyServedRelease(
  manifest,
  baseURL,
  { fetchImpl = globalThis.fetch, timeoutMs = 15_000 } = {},
) {
  validateFormat2ReleaseManifest(manifest);
  const normalizedBaseURL = normalizeProductionBaseURL(baseURL);
  const rootURL = new URL(normalizedBaseURL);
  if (typeof fetchImpl !== "function") throw new Error("Production smoke fetch implementation is unavailable.");
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error("Production smoke fetch timeout is invalid.");

  const files = await Promise.all(manifest.files.map(async (record) => {
    const target = new URL(record.path, rootURL);
    let response;
    try {
      response = await fetchImpl(target, {
        cache: "no-store",
        redirect: "follow",
        headers: {
          "cache-control": "no-cache",
          pragma: "no-cache",
        },
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch {
      throw new Error(`Production smoke could not fetch served release file: ${record.path}`);
    }
    if (!response.ok) {
      throw new Error(`Production smoke received HTTP ${response.status} for release file: ${record.path}`);
    }
    if (response.url) {
      const finalURL = new URL(response.url);
      if (finalURL.origin !== rootURL.origin) {
        throw new Error(`Production smoke release file left the dedicated origin: ${record.path}`);
      }
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
      throw new Error(`Production smoke served bytes do not match the release manifest: ${record.path}`);
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
  if (aggregateSha256 !== manifest.aggregateSha256) {
    throw new Error("Production smoke served aggregate does not match the release manifest.");
  }

  const indexRecord = manifest.files.find((record) => record.path === "index.html");
  let entrypointResponse;
  try {
    entrypointResponse = await fetchImpl(rootURL, {
      cache: "no-store",
      redirect: "follow",
      headers: {
        "cache-control": "no-cache",
        pragma: "no-cache",
      },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    throw new Error("Production smoke could not fetch the served release entrypoint.");
  }
  if (!entrypointResponse.ok) {
    throw new Error(`Production smoke received HTTP ${entrypointResponse.status} for the release entrypoint.`);
  }
  const finalEntrypointURL = new URL(entrypointResponse.url || normalizedBaseURL);
  if (finalEntrypointURL.origin !== rootURL.origin) {
    throw new Error("Production smoke release entrypoint left the dedicated origin.");
  }
  const entrypointContents = Buffer.from(await entrypointResponse.arrayBuffer());
  const entrypointSha256 = sha256(entrypointContents);
  if (
    !indexRecord
    || entrypointContents.length !== indexRecord.bytes
    || entrypointSha256 !== indexRecord.sha256
  ) {
    throw new Error("Production smoke served entrypoint does not match release manifest index.html.");
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

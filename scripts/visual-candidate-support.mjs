import { createHash } from "node:crypto";
import { lstat, readFile, readdir } from "node:fs/promises";
import { createServer } from "node:http";
import { dirname, relative, resolve, sep } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { gzipSync } from "node:zlib";

import { REPO_ROOT } from "./performance/common.mjs";
import { assertGzipToolchainMatch } from "./lib/gzip-toolchain.mjs";

export const VISUAL_CANDIDATE_MANIFEST = "artifacts/candidate-evidence/visual/current/manifest.json";
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const COMMIT_PATTERN = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;

export function sha256(contents) {
  return createHash("sha256").update(contents).digest("hex");
}

function requireCandidate(condition, message) {
  if (!condition) throw new Error(`Visual QA candidate is invalid: ${message}`);
}

function requireExactKeys(value, keys, label) {
  requireCandidate(
    value !== null
      && typeof value === "object"
      && !Array.isArray(value)
      && isDeepStrictEqual(Object.keys(value).toSorted(), [...keys].toSorted()),
    `${label} fields do not match the visual QA schema`,
  );
}

function canonicalRelativePath(value) {
  if (
    typeof value !== "string"
    || value.length === 0
    || /[\\%?#\u0000-\u001f\u007f]/.test(value)
  ) return null;
  const segments = value.split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === "..")) return null;
  return value.startsWith("/") ? null : value;
}

function validateNpmPackageProvenance(value, npmVersion) {
  requireExactKeys(value, [
    "cliRelativePath",
    "directoryCount",
    "name",
    "packageJsonSha256",
    "regularFileCount",
    "symlinkCount",
    "totalRegularFileBytes",
    "treeFormat",
    "treeSha256",
    "version",
  ], "toolchain.npmPackage");
  requireCandidate(value.treeFormat === 1, "npm package tree format is not 1");
  requireCandidate(value.name === "npm", "npm package name is invalid");
  requireCandidate(value.version === npmVersion, "npm package version does not match npm");
  requireCandidate(value.cliRelativePath === "bin/npm-cli.js", "npm package CLI path is invalid");
  requireCandidate(SHA256_PATTERN.test(value.packageJsonSha256), "npm package.json SHA-256 is invalid");
  requireCandidate(
    Number.isSafeInteger(value.directoryCount) && value.directoryCount > 0,
    "npm package directory count is invalid",
  );
  requireCandidate(
    Number.isSafeInteger(value.regularFileCount) && value.regularFileCount > 0,
    "npm package regular-file count is invalid",
  );
  requireCandidate(
    Number.isSafeInteger(value.symlinkCount) && value.symlinkCount >= 0,
    "npm package symbolic-link count is invalid",
  );
  requireCandidate(
    Number.isSafeInteger(value.totalRegularFileBytes) && value.totalRegularFileBytes > 0,
    "npm package byte count is invalid",
  );
  requireCandidate(SHA256_PATTERN.test(value.treeSha256), "npm package tree SHA-256 is invalid");
}

async function assertNoSymlinkAncestors(parent, child) {
  const childRelative = relative(parent, child);
  requireCandidate(
    childRelative === ""
      || (!childRelative.startsWith(`..${sep}`) && childRelative !== ".."),
    "manifest path escaped the repository",
  );
  let current = parent;
  for (const segment of childRelative.split(sep).filter(Boolean)) {
    current = resolve(current, segment);
    const entry = await lstat(current);
    requireCandidate(!entry.isSymbolicLink(), `symbolic-link path component: ${current}`);
  }
}

async function walkRegularFiles(directory, base = directory) {
  const directoryStat = await lstat(directory);
  requireCandidate(directoryStat.isDirectory(), "distribution root is not a directory");
  requireCandidate(!directoryStat.isSymbolicLink(), "distribution root is a symbolic link");
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries.toSorted((left, right) => {
    if (left.name < right.name) return -1;
    if (left.name > right.name) return 1;
    return 0;
  })) {
    const absolutePath = resolve(directory, entry.name);
    const entryStat = await lstat(absolutePath);
    if (entryStat.isDirectory()) files.push(...await walkRegularFiles(absolutePath, base));
    else if (entryStat.isFile()) files.push(absolutePath);
    else throw new Error(`Visual QA candidate contains a non-regular entry: ${relative(base, absolutePath)}`);
  }
  return files;
}

export async function inventoryVisualDistribution(directory) {
  const absolutePaths = await walkRegularFiles(directory);
  const files = [];
  for (const absolutePath of absolutePaths) {
    const contents = await readFile(absolutePath);
    const gzipContents = gzipSync(contents, { level: 9 });
    files.push({
      path: relative(directory, absolutePath).split(sep).join("/"),
      type: "file",
      bytes: contents.byteLength,
      gzipBytes: gzipContents.byteLength,
      gzipSha256: sha256(gzipContents),
      sha256: sha256(contents),
    });
  }
  files.sort((left, right) => {
    if (left.path < right.path) return -1;
    if (left.path > right.path) return 1;
    return 0;
  });
  const aggregate = createHash("sha256");
  for (const record of files) aggregate.update(`${record.sha256}  ${record.path}\n`);
  return {
    directory: "dist",
    fileCount: files.length,
    totalBytes: files.reduce((sum, record) => sum + record.bytes, 0),
    totalGzipBytes: files.reduce((sum, record) => sum + record.gzipBytes, 0),
    aggregateSha256: aggregate.digest("hex"),
    files,
  };
}

export function validateVisualCandidateManifest(manifest) {
  requireExactKeys(manifest, [
    "aggregateSha256",
    "build",
    "compression",
    "fileCount",
    "files",
    "format",
    "kind",
    "product",
    "source",
    "toolchain",
    "totalBytes",
    "totalGzipBytes",
    "version",
  ], "manifest");
  requireCandidate(manifest.kind === "visual-qa-candidate", "kind is not visual-qa-candidate");
  requireCandidate(manifest.format === 1, "format is not 1");
  requireCandidate(manifest.product === "RIVET RIDGE RALLY", "product identity does not match");
  requireCandidate(typeof manifest.version === "string" && manifest.version.length > 0, "version is missing");
  requireExactKeys(manifest.source, [
    "commit",
    "expectedVersionTag",
    "expectedVersionTagAtCommit",
    "expectedVersionTagObject",
    "expectedVersionTagObjectType",
    "tagsAtCommit",
  ], "source");
  requireCandidate(COMMIT_PATTERN.test(manifest.source.commit), "source commit is invalid");
  requireCandidate(manifest.source.expectedVersionTag === `v${manifest.version}`, "expected version tag does not match version");
  requireCandidate(
    Array.isArray(manifest.source.tagsAtCommit)
      && manifest.source.tagsAtCommit.every((tag) => typeof tag === "string" && tag.length > 0)
      && isDeepStrictEqual(manifest.source.tagsAtCommit, [...new Set(manifest.source.tagsAtCommit)].toSorted()),
    "tagsAtCommit is not a sorted unique string list",
  );
  requireCandidate(
    manifest.source.expectedVersionTagAtCommit
      === manifest.source.tagsAtCommit.includes(manifest.source.expectedVersionTag),
    "expected version tag presence is inconsistent",
  );
  requireCandidate(
    manifest.source.expectedVersionTagAtCommit === false
      && manifest.source.expectedVersionTagObject === null
      && manifest.source.expectedVersionTagObjectType === null,
    "visual QA source must precede the expected version tag",
  );
  requireExactKeys(manifest.toolchain, [
    "arch",
    "node",
    "nodeExecutableSha256",
    "npm",
    "npmCliSha256",
    "npmPackage",
    "packageLockSha256",
    "platform",
  ], "toolchain");
  requireCandidate(typeof manifest.toolchain.node === "string" && manifest.toolchain.node.length > 0, "Node version is missing");
  requireCandidate(typeof manifest.toolchain.npm === "string" && manifest.toolchain.npm.length > 0, "npm version is missing");
  requireCandidate(SHA256_PATTERN.test(manifest.toolchain.nodeExecutableSha256), "Node executable SHA-256 is invalid");
  requireCandidate(SHA256_PATTERN.test(manifest.toolchain.npmCliSha256), "npm CLI SHA-256 is invalid");
  validateNpmPackageProvenance(manifest.toolchain.npmPackage, manifest.toolchain.npm);
  requireCandidate(SHA256_PATTERN.test(manifest.toolchain.packageLockSha256), "package-lock SHA-256 is invalid");
  requireExactKeys(manifest.build, [
    "buildCommand",
    "installCommand",
    "installScripts",
    "npmConfig",
    "source",
    "viteQaMode",
  ], "build");
  requireCandidate(manifest.build.source === "detached-clean-git-worktree", "build source is not isolated");
  requireCandidate(manifest.build.installCommand === "npm ci --no-audit --no-fund", "install command is invalid");
  requireCandidate(manifest.build.buildCommand === "npm run build", "build command is invalid");
  requireCandidate(manifest.build.viteQaMode === "1", "build is not a QA build");
  requireCandidate(manifest.build.npmConfig === "isolated-empty-user-and-global", "npm config is not isolated");
  requireCandidate(manifest.build.installScripts === "enabled", "install scripts state is invalid");
  requireExactKeys(manifest.compression, ["algorithm", "level"], "compression");
  requireCandidate(
    manifest.compression.algorithm === "gzip" && manifest.compression.level === 9,
    "compression contract does not match deterministic gzip level 9",
  );
  requireCandidate(Array.isArray(manifest.files) && manifest.files.length > 0, "file inventory is empty");
  let totalBytes = 0;
  let totalGzipBytes = 0;
  let previousPath = null;
  const aggregate = createHash("sha256");
  for (const record of manifest.files) {
    requireExactKeys(record, ["bytes", "gzipBytes", "gzipSha256", "path", "sha256", "type"], "files[]");
    requireCandidate(canonicalRelativePath(record.path) === record.path, `invalid file path: ${record.path}`);
    requireCandidate(previousPath === null || previousPath < record.path, "file paths are not strictly sorted and unique");
    requireCandidate(record.type === "file", `non-file manifest record: ${record.path}`);
    requireCandidate(Number.isSafeInteger(record.bytes) && record.bytes >= 0, `invalid bytes: ${record.path}`);
    requireCandidate(Number.isSafeInteger(record.gzipBytes) && record.gzipBytes >= 0, `invalid gzip bytes: ${record.path}`);
    requireCandidate(SHA256_PATTERN.test(record.sha256), `invalid SHA-256: ${record.path}`);
    requireCandidate(SHA256_PATTERN.test(record.gzipSha256), `invalid gzip SHA-256: ${record.path}`);
    totalBytes += record.bytes;
    totalGzipBytes += record.gzipBytes;
    aggregate.update(`${record.sha256}  ${record.path}\n`);
    previousPath = record.path;
  }
  requireCandidate(manifest.fileCount === manifest.files.length, "fileCount does not match files");
  requireCandidate(manifest.totalBytes === totalBytes, "totalBytes does not match files");
  requireCandidate(manifest.totalGzipBytes === totalGzipBytes, "totalGzipBytes does not match files");
  requireCandidate(manifest.aggregateSha256 === aggregate.digest("hex"), "aggregate SHA-256 does not match files");
  return manifest;
}

export async function loadVisualCandidate() {
  const manifestPath = resolve(REPO_ROOT, VISUAL_CANDIDATE_MANIFEST);
  await assertNoSymlinkAncestors(REPO_ROOT, manifestPath);
  const manifestStat = await lstat(manifestPath);
  requireCandidate(manifestStat.isFile() && !manifestStat.isSymbolicLink(), "manifest is not a regular file");
  const manifestContents = await readFile(manifestPath);
  let parsed;
  try {
    parsed = JSON.parse(manifestContents.toString("utf8"));
  } catch {
    throw new Error("Visual QA candidate manifest is not valid JSON");
  }
  const manifest = validateVisualCandidateManifest(parsed);
  const distDirectory = resolve(dirname(manifestPath), "dist");
  await assertNoSymlinkAncestors(REPO_ROOT, distDirectory);
  const inventory = await inventoryVisualDistribution(distDirectory);
  const expectedInventory = {
    directory: "dist",
    fileCount: manifest.fileCount,
    totalBytes: manifest.totalBytes,
    totalGzipBytes: manifest.totalGzipBytes,
    aggregateSha256: manifest.aggregateSha256,
    files: manifest.files,
  };
  requireCandidate(
    isDeepStrictEqual(inventory, expectedInventory),
    "on-disk distribution does not exactly match the manifest",
  );
  return {
    manifest,
    manifestPath,
    manifestReference: VISUAL_CANDIDATE_MANIFEST,
    manifestSha256: sha256(manifestContents),
    distDirectory,
    inventory,
  };
}

function mapRequestToCandidatePath(requestUrl, candidateFiles) {
  if (requestUrl.pathname.includes("%")) return null;
  const pathname = decodeURIComponent(requestUrl.pathname);
  if (pathname === "/" || pathname === "/index.html") {
    const queryEntries = [...requestUrl.searchParams.entries()].toSorted(
      ([leftKey, leftValue], [rightKey, rightValue]) => (
        leftKey.localeCompare(rightKey, "en") || leftValue.localeCompare(rightValue, "en")
      ),
    );
    const distanceValue = requestUrl.searchParams.get("qa-visual-distance");
    const distance = Number(distanceValue);
    if (
      JSON.stringify(queryEntries) !== JSON.stringify([
        ["qa-visual-distance", distanceValue],
        ["qa-visual-freeze", "1"],
      ])
      || !/^(?:0|[1-9][0-9]*)$/u.test(distanceValue ?? "")
      || !Number.isSafeInteger(distance)
    ) return null;
    return "index.html";
  }
  if (requestUrl.search || requestUrl.hash) return null;
  const candidatePath = pathname.slice(1);
  return canonicalRelativePath(candidatePath) && candidateFiles.has(candidatePath)
    ? candidatePath
    : null;
}

function contentType(pathname) {
  const extension = pathname.slice(pathname.lastIndexOf(".")).toLowerCase();
  return {
    ".css": "text/css; charset=utf-8",
    ".glb": "model/gltf-binary",
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".ktx2": "image/ktx2",
    ".png": "image/png",
    ".svg": "image/svg+xml",
    ".txt": "text/plain; charset=utf-8",
    ".wasm": "application/wasm",
    ".woff2": "font/woff2",
  }[extension] ?? "application/octet-stream";
}

export async function startVisualCandidateServer(candidate, port = 4_373) {
  requireCandidate(Number.isSafeInteger(port) && port > 0 && port <= 65_535, "server port is invalid");
  const host = "127.0.0.1";
  const baseURL = `http://${host}:${port}/`;
  const origin = new URL(baseURL).origin;
  assertGzipToolchainMatch(candidate.manifest.toolchain.node, "Visual candidate server");
  const candidateFiles = new Map(candidate.manifest.files.map((record) => [record.path, record]));
  const server = createServer(async (request, response) => {
    try {
      if (!["GET", "HEAD"].includes(request.method ?? "")) {
        response.writeHead(405, { Allow: "GET, HEAD", "Cache-Control": "no-store" });
        response.end();
        return;
      }
      if (request.headers.host !== new URL(baseURL).host) {
        response.writeHead(421, { "Cache-Control": "no-store" });
        response.end();
        return;
      }
      const requestUrl = new URL(request.url ?? "/", baseURL);
      if (requestUrl.origin !== origin || requestUrl.username || requestUrl.password) {
        response.writeHead(400, { "Cache-Control": "no-store" });
        response.end();
        return;
      }
      const candidatePath = mapRequestToCandidatePath(requestUrl, candidateFiles);
      const record = candidatePath ? candidateFiles.get(candidatePath) : null;
      if (!record) {
        response.writeHead(404, { "Cache-Control": "no-store" });
        response.end();
        return;
      }
      const contents = await readFile(resolve(candidate.distDirectory, candidatePath));
      const gzipContents = gzipSync(contents, { level: 9 });
      if (
        contents.byteLength !== record.bytes
        || sha256(contents) !== record.sha256
        || gzipContents.byteLength !== record.gzipBytes
        || sha256(gzipContents) !== record.gzipSha256
      ) {
        response.writeHead(500, { "Cache-Control": "no-store" });
        response.end();
        return;
      }
      response.writeHead(200, {
        "Cache-Control": "no-store, no-cache, must-revalidate",
        "Content-Length": String(contents.byteLength),
        "Content-Type": contentType(candidatePath),
        "X-RRR-Visual-Candidate": candidate.manifestSha256,
      });
      response.end(request.method === "HEAD" ? undefined : contents);
    } catch {
      if (!response.headersSent) response.writeHead(500, { "Cache-Control": "no-store" });
      response.end();
    }
  });
  await new Promise((resolveListen, rejectListen) => {
    const onError = (error) => rejectListen(error);
    server.once("error", onError);
    server.listen(port, host, () => {
      server.off("error", onError);
      resolveListen();
    });
  });
  return {
    baseURL,
    origin,
    protocol: "http:",
    host,
    port,
    close: () => new Promise((resolveClose, rejectClose) => {
      server.close((error) => (error ? rejectClose(error) : resolveClose()));
    }),
  };
}

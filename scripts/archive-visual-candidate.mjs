// Archives the frozen visual QA candidate before it can be destroyed.
//
// `npm run visual:candidate` calls removeRootOutputs(), which performs
// rm(visualCandidateRoot, { recursive: true, force: true }). The candidate lives under
// artifacts/candidate-evidence/, which is git-ignored, so re-freezing permanently destroys
// the previous candidate's bytes with no way to recover them from version control.
//
// This script must therefore run, and pass, before any re-freeze. It:
//
//   1. verifies the on-disk candidate exactly matches its own manifest,
//   2. copies every file into an immutable, named archive directory,
//   3. re-reads the archive and proves it is byte-exact against the source,
//   4. writes a committed integrity record to artifacts/history/.
//
// Only the integrity record is committed, matching the existing artifacts/history/
// convention of preserving manifests rather than payloads. The archived bytes stay on
// disk. Off-machine durability of the archive is an operator responsibility and is NOT
// satisfied by running this script.

import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { copyFile, lstat, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import process from "node:process";
import { promisify } from "node:util";

const run = promisify(execFile);

const REPO_ROOT = resolve(import.meta.dirname, "..");
const CANDIDATE_ROOT = join(REPO_ROOT, "artifacts/candidate-evidence/visual/current");
const CANDIDATE_MANIFEST = join(CANDIDATE_ROOT, "manifest.json");
const ARCHIVE_PARENT = join(REPO_ROOT, "artifacts/candidate-evidence/visual/archive");
const HISTORY_DIR = join(REPO_ROOT, "artifacts/history");

function fail(message) {
  throw new Error(`Visual candidate archive failed: ${message}`);
}

function require(condition, message) {
  if (!condition) fail(message);
}

function sha256(contents) {
  return createHash("sha256").update(contents).digest("hex");
}

// Refuse to follow symlinks anywhere in the tree. An archive that can be redirected is not
// an archive; the other release scripts apply the same rule to their own roots.
async function assertRealDirectory(path, label) {
  const entry = await lstat(path).catch(() => null);
  require(entry !== null, `${label} does not exist: ${relative(REPO_ROOT, path)}`);
  require(entry.isDirectory(), `${label} is not a directory`);
  require(!entry.isSymbolicLink(), `${label} is a symbolic link`);
}

async function collectFiles(root, prefix = "") {
  const found = [];
  for (const entry of await readdir(join(root, prefix), { withFileTypes: true })) {
    const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
    require(!entry.isSymbolicLink(), `archive source contains a symbolic link: ${relativePath}`);
    if (entry.isDirectory()) {
      found.push(...await collectFiles(root, relativePath));
      continue;
    }
    require(entry.isFile(), `archive source contains a non-regular file: ${relativePath}`);
    const contents = await readFile(join(root, relativePath));
    found.push({ path: relativePath, bytes: contents.byteLength, sha256: sha256(contents) });
  }
  return found.sort((left, right) => (left.path < right.path ? -1 : 1));
}

async function currentCommit() {
  const { stdout } = await run("git", ["rev-parse", "HEAD"], { cwd: REPO_ROOT });
  return stdout.trim();
}

async function workingTreeDirty() {
  const { stdout } = await run("git", ["status", "--porcelain"], { cwd: REPO_ROOT });
  return stdout.trim().length > 0;
}

await assertRealDirectory(CANDIDATE_ROOT, "Visual candidate root");

const manifestContents = await readFile(CANDIDATE_MANIFEST);
const manifest = JSON.parse(manifestContents.toString("utf8"));
require(manifest.kind === "visual-qa-candidate", `unexpected manifest kind: ${manifest.kind}`);

const sourceFiles = await collectFiles(CANDIDATE_ROOT);

// The candidate lays out as current/manifest.json plus current/dist/**, and the manifest
// records payload paths relative to dist/, so the prefix is stripped before comparison.
const DIST_PREFIX = "dist/";
const payload = sourceFiles
  .filter((file) => file.path !== "manifest.json")
  .map((file) => {
    require(
      file.path.startsWith(DIST_PREFIX),
      `candidate payload file sits outside dist/: ${file.path}`,
    );
    return { ...file, manifestPath: file.path.slice(DIST_PREFIX.length) };
  });

// Step 1 -- the candidate must match its own manifest before it is worth archiving.
require(
  payload.length === manifest.fileCount,
  `candidate has ${payload.length} payload files but its manifest declares ${manifest.fileCount}`,
);
const declared = new Map(manifest.files.map((file) => [file.path, file]));
for (const file of payload) {
  const expected = declared.get(file.manifestPath);
  require(expected !== undefined, `candidate contains a file absent from its manifest: ${file.manifestPath}`);
  require(
    expected.sha256 === file.sha256 && expected.bytes === file.bytes,
    `candidate file does not match its manifest: ${file.manifestPath}`,
  );
}
for (const path of declared.keys()) {
  require(
    payload.some((file) => file.manifestPath === path),
    `manifest declares a file missing from the candidate: ${path}`,
  );
}
const totalBytes = payload.reduce((sum, file) => sum + file.bytes, 0);
require(
  totalBytes === manifest.totalBytes,
  `candidate totals ${totalBytes} bytes but its manifest declares ${manifest.totalBytes}`,
);

const commit = await currentCommit();
const dirty = await workingTreeDirty();
const label = `visual-candidate-${manifest.version}-${manifest.aggregateSha256.slice(0, 12)}`;
const archiveRoot = join(ARCHIVE_PARENT, label);

// An existing archive is never overwritten -- that is the whole point of the script.
const existing = await lstat(archiveRoot).catch(() => null);
require(existing === null, `archive already exists and will not be overwritten: ${relative(REPO_ROOT, archiveRoot)}`);

// Step 2 -- copy every file, directories first.
await mkdir(archiveRoot, { recursive: true });
for (const file of sourceFiles) {
  const target = join(archiveRoot, ...file.path.split("/"));
  await mkdir(dirname(target), { recursive: true });
  await copyFile(join(CANDIDATE_ROOT, ...file.path.split("/")), target);
}

// Step 3 -- prove the archive is byte-exact by re-reading it, not by trusting copyFile.
const archivedFiles = await collectFiles(archiveRoot);
require(
  archivedFiles.length === sourceFiles.length,
  `archive holds ${archivedFiles.length} files but the source had ${sourceFiles.length}`,
);
for (const [index, archived] of archivedFiles.entries()) {
  const source = sourceFiles[index];
  require(archived.path === source.path, `archive path mismatch: ${archived.path} vs ${source.path}`);
  require(
    archived.sha256 === source.sha256 && archived.bytes === source.bytes,
    `archive is not byte-exact for ${archived.path}`,
  );
}

// Step 4 -- the committed integrity record.
const record = {
  kind: "visual-qa-candidate-archive",
  format: 1,
  archivedAt: new Date().toISOString(),
  reason: "Preserve the frozen visual QA candidate before npm run visual:candidate destroys it.",
  candidate: {
    product: manifest.product,
    version: manifest.version,
    kind: manifest.kind,
    aggregateSha256: manifest.aggregateSha256,
    fileCount: manifest.fileCount,
    totalBytes: manifest.totalBytes,
    manifestSha256: sha256(manifestContents),
    manifestBytes: manifestContents.byteLength,
  },
  archive: {
    path: relative(REPO_ROOT, archiveRoot).split(sep).join("/"),
    fileCount: archivedFiles.length,
    totalBytes: archivedFiles.reduce((sum, file) => sum + file.bytes, 0),
    verifiedByteExact: true,
  },
  archivedFromRepositoryState: {
    commit,
    dirty,
    note: dirty
      ? "Repository had uncommitted changes when the archive was taken. The archive records candidate bytes, which are independent of the working tree, but this state is disclosed rather than hidden."
      : "Clean working tree at archive time.",
  },
  durability: {
    committedToGit: false,
    note: "artifacts/candidate-evidence/ is git-ignored, so the archived bytes are NOT in version control. Only this record is. Off-machine durability remains an operator responsibility and is not satisfied by this script.",
  },
  files: archivedFiles,
};

await mkdir(HISTORY_DIR, { recursive: true });
const recordPath = join(HISTORY_DIR, `${label}-archive.json`);
require(
  (await lstat(recordPath).catch(() => null)) === null,
  `integrity record already exists and will not be overwritten: ${relative(REPO_ROOT, recordPath)}`,
);
await writeFile(recordPath, `${JSON.stringify(record, null, 2)}\n`);

console.log(`Archived ${archivedFiles.length} files (${record.archive.totalBytes} bytes), verified byte-exact.`);
console.log(`Archive:          ${record.archive.path}`);
console.log(`Integrity record: ${relative(REPO_ROOT, recordPath)}`);
console.log(`Candidate:        ${manifest.version} aggregate ${manifest.aggregateSha256}`);
console.log("The archived bytes are NOT committed. Off-machine durability is still an operator task.");

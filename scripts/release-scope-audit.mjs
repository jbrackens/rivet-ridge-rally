import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TEXT_DECODER = new TextDecoder("latin1", { fatal: false });

const TRACKED_RELEASE_PREFIXES = Object.freeze([
  "src/",
  "public/",
]);
const TRACKED_RELEASE_FILES = Object.freeze([
  "index.html",
  "package.json",
  "package-lock.json",
  "vite.config.ts",
  "tsconfig.app.json",
  "tsconfig.json",
  "tsconfig.node.json",
]);
const OPTIONAL_UNTRACKED_RELEASE_ROOTS = Object.freeze(["dist"]);
// Vite copies all of publicDir into the build, so untracked files under public/
// ship too — walk it unconditionally instead of trusting `git ls-files` alone.
const ALWAYS_WALKED_SHIP_ROOTS = Object.freeze(["public"]);

const PROHIBITED_PRODUCT_MARKS = Object.freeze([
  { label: "Excitebike", pattern: /excite\s*bike|excitebike/iu },
  { label: "Nintendo", pattern: /nintendo/iu },
  { label: "Roblox", pattern: /roblox/iu },
]);
const FORBIDDEN_LOCAL_PATH_PATTERNS = Object.freeze([
  { label: "absolute macOS user path", pattern: /\/Users\/[A-Za-z0-9._-]+/u },
  { label: "absolute local file URL", pattern: /file:\/\/\/(?:Users|home|opt|tmp|var\/folders|C:\/Users)\//iu },
  { label: "retired local workspace name", pattern: /Excitebike 2026/iu },
]);
const SECRET_PATTERNS = Object.freeze([
  { label: "GitHub token ghp_", pattern: /ghp_[A-Za-z0-9]{36}/u },
  { label: "GitHub fine-grained token github_pat_", pattern: /github_pat_[A-Za-z0-9_]{80,}/u },
  { label: "OpenAI project token sk-proj-", pattern: /sk-proj-[A-Za-z0-9_-]{20,}/u },
  { label: "OpenAI service-account token sk-svcacct-", pattern: /sk-svcacct-[A-Za-z0-9_-]{20,}/u },
  { label: "Slack bot token xoxb-", pattern: /xoxb-[A-Za-z0-9-]{20,}/u },
  { label: "Slack user token xoxp-", pattern: /xoxp-[A-Za-z0-9-]{20,}/u },
  { label: "Stripe live secret sk_live_", pattern: /sk_live_[A-Za-z0-9]{20,}/u },
  { label: "Stripe restricted live key rk_live_", pattern: /rk_live_[A-Za-z0-9]{20,}/u },
  { label: "GitLab personal access token glpat-", pattern: /glpat-[A-Za-z0-9_-]{20,}/u },
  { label: "AWS access key ID", pattern: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/u },
  { label: "PEM private key block", pattern: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP |ENCRYPTED )?PRIVATE KEY(?: BLOCK)?-----/u },
  { label: "npm access token npm_", pattern: /\bnpm_[A-Za-z0-9]{36}\b/u },
  { label: "Anthropic API key sk-ant-", pattern: /sk-ant-[A-Za-z0-9_-]{20,}/u },
  { label: "OpenAI legacy secret sk-", pattern: /\bsk-[A-Za-z0-9]{40,}\b/u },
  { label: "JWT-like bearer value", pattern: /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{10,}\b/u },
  { label: "Google API key AIza", pattern: /\bAIza[0-9A-Za-z_-]{35}\b/u },
]);
const TRACKER_PATTERNS = Object.freeze([
  { label: "Google Analytics", pattern: /google-analytics\.com|googletagmanager\.com|gtag\(/iu },
  { label: "Meta Pixel", pattern: /connect\.facebook\.net|fbq\(/iu },
  { label: "Segment", pattern: /cdn\.segment\.com|analytics\.track\(/iu },
  { label: "Amplitude", pattern: /api\.amplitude\.com|amplitude\.com\/analytics/iu },
  { label: "Mixpanel", pattern: /api\.mixpanel\.com|mixpanel\.track/iu },
  { label: "PostHog", pattern: /app\.posthog\.com|posthog\.capture/iu },
]);

function comparePath(left, right) {
  return left.localeCompare(right, "en");
}

function isTrackedReleaseFile(relativePath) {
  return TRACKED_RELEASE_FILES.includes(relativePath)
    || TRACKED_RELEASE_PREFIXES.some((prefix) => relativePath.startsWith(prefix));
}

async function gitTrackedFiles(root = REPO_ROOT) {
  const { stdout } = await execFileAsync(
    "git",
    ["ls-files", "-z", "--", ...TRACKED_RELEASE_FILES, ...TRACKED_RELEASE_PREFIXES],
    { cwd: root, encoding: "buffer", maxBuffer: 32 * 1024 * 1024 },
  );
  return stdout.toString("utf8")
    .split("\0")
    .filter(Boolean)
    .filter(isTrackedReleaseFile)
    .toSorted(comparePath);
}

async function walkRegularFiles(root, relativeRoot) {
  const files = [];
  const absoluteRoot = path.join(root, relativeRoot);
  let rootStat;
  try {
    rootStat = await lstat(absoluteRoot);
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return files;
    throw error;
  }
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
    throw new Error(`Release scope audit failed: ${relativeRoot} must be a real directory`);
  }

  async function visit(absolute) {
    const entries = await readdir(absolute, { withFileTypes: true });
    for (const entry of entries.toSorted((left, right) => comparePath(left.name, right.name))) {
      const child = path.join(absolute, entry.name);
      const childRelative = path.relative(root, child).split(path.sep).join("/");
      if (entry.isSymbolicLink()) {
        throw new Error(`Release scope audit failed: symlink is not allowed in release scope: ${childRelative}`);
      }
      if (entry.isDirectory()) {
        await visit(child);
      } else if (entry.isFile()) {
        files.push(childRelative);
      }
    }
  }

  await visit(absoluteRoot);
  return files;
}

export async function collectReleaseScopeFiles(root = REPO_ROOT) {
  const tracked = await gitTrackedFiles(root);
  const walked = (await Promise.all(
    [...ALWAYS_WALKED_SHIP_ROOTS, ...OPTIONAL_UNTRACKED_RELEASE_ROOTS]
      .map((relativeRoot) => walkRegularFiles(root, relativeRoot)),
  )).flat();
  return [...new Set([...tracked, ...walked])].toSorted(comparePath);
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

// A detected secret must never be reproduced verbatim in the report — audit
// output lands in CI logs and retained evidence bundles on a public repo.
function redactSecret(value) {
  const digest = sha256(value).slice(0, 12);
  return `${value.slice(0, 5)}… [redacted ${value.length} chars, sha256:${digest}]`;
}

function findPatternMatches(text, patterns, relativePath, channel, { redact = false } = {}) {
  const findings = [];
  for (const { label, pattern } of patterns) {
    const match = pattern.exec(text);
    if (match) {
      findings.push({
        channel,
        path: relativePath,
        label,
        match: redact ? redactSecret(match[0]) : match[0],
      });
    }
  }
  return findings;
}

export async function auditReleaseScope({ root = REPO_ROOT } = {}) {
  const files = await collectReleaseScopeFiles(root);
  const findings = [];
  let totalBytes = 0;
  const aggregate = createHash("sha256");

  for (const relativePath of files) {
    findings.push(
      ...findPatternMatches(relativePath, PROHIBITED_PRODUCT_MARKS, relativePath, "path"),
      ...findPatternMatches(relativePath, FORBIDDEN_LOCAL_PATH_PATTERNS, relativePath, "path"),
      ...findPatternMatches(relativePath, SECRET_PATTERNS, relativePath, "path", { redact: true }),
    );

    const absolutePath = path.join(root, relativePath);
    const metadata = await lstat(absolutePath);
    if (!metadata.isFile() || metadata.isSymbolicLink()) {
      throw new Error(`Release scope audit failed: ${relativePath} must be a regular file`);
    }
    const bytes = await readFile(absolutePath);
    totalBytes += bytes.byteLength;
    const fileSha256 = sha256(bytes);
    aggregate.update(`${fileSha256}  ${relativePath}\n`);
    const text = TEXT_DECODER.decode(bytes);
    findings.push(
      ...findPatternMatches(text, PROHIBITED_PRODUCT_MARKS, relativePath, "content"),
      ...findPatternMatches(text, FORBIDDEN_LOCAL_PATH_PATTERNS, relativePath, "content"),
      ...findPatternMatches(text, SECRET_PATTERNS, relativePath, "content", { redact: true }),
      ...findPatternMatches(text, TRACKER_PATTERNS, relativePath, "content"),
    );
  }

  return {
    schemaVersion: 1,
    kind: "release-scope-audit",
    status: findings.length === 0 ? "PASS" : "FAIL",
    scope: {
      trackedPrefixes: [...TRACKED_RELEASE_PREFIXES],
      trackedFiles: [...TRACKED_RELEASE_FILES],
      alwaysWalkedShipRoots: [...ALWAYS_WALKED_SHIP_ROOTS],
      optionalUntrackedRoots: [...OPTIONAL_UNTRACKED_RELEASE_ROOTS],
    },
    fileCount: files.length,
    totalBytes,
    aggregateSha256: aggregate.digest("hex"),
    findings,
  };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = await auditReleaseScope();
  console.log(JSON.stringify(result, null, 2));
  if (result.status !== "PASS") process.exitCode = 1;
}

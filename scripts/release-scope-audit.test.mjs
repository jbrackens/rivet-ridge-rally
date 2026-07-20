import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";

import {
  auditReleaseScope,
  collectReleaseScopeFiles,
} from "./release-scope-audit.mjs";

const execFileAsync = promisify(execFile);

async function fixtureRepository(files) {
  const root = await mkdtemp(path.join(tmpdir(), "rrr-release-scope-audit-"));
  await execFileAsync("git", ["init"], { cwd: root });
  await execFileAsync("git", ["config", "user.email", "agent@example.invalid"], { cwd: root });
  await execFileAsync("git", ["config", "user.name", "Agent"], { cwd: root });
  for (const [relativePath, contents] of Object.entries(files)) {
    const absolutePath = path.join(root, relativePath);
    await mkdir(path.dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, contents);
  }
  await execFileAsync("git", ["add", "."], { cwd: root });
  await execFileAsync("git", ["commit", "-m", "fixture"], { cwd: root });
  return root;
}

test("collects tracked shipped files and optional current dist files", async () => {
  const root = await fixtureRepository({
    "index.html": "<!doctype html><title>Rivet Ridge Rally</title>",
    "src/main.ts": "console.log('RIVET RIDGE RALLY');",
    "public/assets/icons/app-icon.svg": "<svg />",
    "scripts/fixture.test.mjs": "const fake = 'ghp_' + 'A'.repeat(36);",
    "QA_REPORT.md": "Docs may mention Roblox as an external legal boundary.",
  });
  await mkdir(path.join(root, "dist/assets"), { recursive: true });
  await writeFile(path.join(root, "dist/index.html"), "<!doctype html><title>Rivet Ridge Rally</title>");
  await writeFile(path.join(root, "dist/assets/index.js"), "console.log('clean');");

  const files = await collectReleaseScopeFiles(root);

  assert.deepEqual(files, [
    "dist/assets/index.js",
    "dist/index.html",
    "index.html",
    "public/assets/icons/app-icon.svg",
    "src/main.ts",
  ]);
});

test("passes a clean release scope without scanning docs or test fixtures", async () => {
  const root = await fixtureRepository({
    "package.json": "{\"name\":\"rivet-ridge-rally\"}\n",
    "src/main.ts": "export const title = 'RIVET RIDGE RALLY';\n",
    "public/manifest.webmanifest": "{\"name\":\"RIVET RIDGE RALLY\"}\n",
    "scripts/release-manifest.test.mjs": "const fake = 'ghp_' + 'A'.repeat(36);\n",
    "ASSET_LICENSES.md": "Historical legal docs mention Nintendo only as an excluded mark.\n",
  });

  const result = await auditReleaseScope({ root });

  assert.equal(result.status, "PASS");
  assert.equal(result.findings.length, 0);
  assert.equal(result.fileCount, 3);
  assert.match(result.aggregateSha256, /^[0-9a-f]{64}$/u);
});

test("scans untracked files under public/ even when dist is absent", async () => {
  const root = await fixtureRepository({
    "src/main.ts": "export const ok = 1;\n",
  });
  await mkdir(path.join(root, "public"), { recursive: true });
  await writeFile(path.join(root, "public/notes.txt"), `token ghp_${"A".repeat(36)}\n`);

  const result = await auditReleaseScope({ root });

  assert.equal(result.status, "FAIL");
  assert.equal(result.findings.length, 1);
  assert.equal(result.findings[0].label, "GitHub token ghp_");
  assert.equal(result.findings[0].path, "public/notes.txt");
});

test("catches AWS, PEM, npm, Anthropic, legacy OpenAI, JWT, and Google shapes and redacts every match", async () => {
  const root = await fixtureRepository({
    "src/config.ts": [
      "export const aws = 'AKIAIOSFODNN7EXAMPLE';",
      "export const pem = '-----BEGIN OPENSSH PRIVATE KEY-----';",
      `export const npmToken = 'npm_${"a".repeat(36)}';`,
      `export const anthropic = 'sk-ant-${"a".repeat(24)}';`,
      `export const legacyOpenAi = 'sk-${"b".repeat(44)}';`,
      `export const jwt = 'eyJ${"a".repeat(10)}.eyJ${"b".repeat(10)}.${"c".repeat(12)}';`,
      `export const google = 'AIza${"D".repeat(35)}';`,
    ].join("\n"),
  });

  const result = await auditReleaseScope({ root });

  assert.equal(result.status, "FAIL");
  assert.deepEqual(
    result.findings.map(({ label }) => label).toSorted(),
    [
      "AWS access key ID",
      "PEM private key block",
      "npm access token npm_",
      "Anthropic API key sk-ant-",
      "OpenAI legacy secret sk-",
      "JWT-like bearer value",
      "Google API key AIza",
    ].toSorted(),
  );
  for (const finding of result.findings) {
    assert.match(
      finding.match,
      /\[redacted \d+ chars, sha256:[0-9a-f]{12}\]$/u,
      `${finding.label} match must be redacted, got: ${finding.match}`,
    );
    assert.ok(!finding.match.includes("a".repeat(20)), `${finding.label} must not echo the raw secret`);
    assert.ok(!finding.match.includes("IOSFODNN7EXAMPLE"), `${finding.label} must not echo the raw AWS key`);
  }
});

test("fails on prohibited product marks, local paths, trackers, and live secret shapes", async () => {
  const root = await fixtureRepository({
    "src/main.ts": [
      "export const bad = 'Roblox-style shipped label';",
      "export const path = '/Users/john/Documents/Excitebike 2026';",
      "export const analytics = 'https://www.googletagmanager.com/gtag/js';",
      `export const token = 'ghp_${"A".repeat(36)}';`,
    ].join("\n"),
  });

  const result = await auditReleaseScope({ root });

  assert.equal(result.status, "FAIL");
  assert.deepEqual(
    result.findings.map(({ label }) => label).toSorted(),
    [
      "Excitebike",
      "GitHub token ghp_",
      "Google Analytics",
      "Roblox",
      "absolute macOS user path",
      "retired local workspace name",
    ].toSorted(),
  );
});

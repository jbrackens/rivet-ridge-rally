import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  aggregateScreenshotEvidence,
  createScreenshotEvidence,
  prepareEvidenceDirectory,
  prepareEvidenceRoot,
  promoteEvidenceBundle,
  verifyServedReleaseAfterJourney,
  waitForRaceGateRacing,
  waitForRestartedRaceGate,
} from "./production-smoke-flow.mjs";

test("rejects a symlinked evidence ancestor before creating files outside the repository", {
  skip: process.platform === "win32",
}, async () => {
  const temporaryRoot = await mkdtemp(join(tmpdir(), "rrr-production-smoke-"));
  try {
    const repositoryRoot = join(temporaryRoot, "repository");
    const outsideRoot = join(temporaryRoot, "outside");
    const sentinelPath = join(outsideRoot, "sentinel.txt");
    await mkdir(repositoryRoot);
    await mkdir(outsideRoot);
    await writeFile(sentinelPath, "outside sentinel", "utf8");
    await symlink(outsideRoot, join(repositoryRoot, "artifacts"), "dir");

    await assert.rejects(
      prepareEvidenceRoot(repositoryRoot, join(repositoryRoot, "artifacts", "production-smoke")),
      /evidence paths must not traverse symbolic links/,
    );

    assert.equal(await readFile(sentinelPath, "utf8"), "outside sentinel");
    await assert.rejects(
      lstat(join(outsideRoot, "production-smoke")),
      { code: "ENOENT" },
    );
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test("rejects an evidence-root anchor replaced by a symlink after preparation", {
  skip: process.platform === "win32",
}, async () => {
  const temporaryRoot = await mkdtemp(join(tmpdir(), "rrr-production-smoke-swap-"));
  try {
    const repositoryRoot = join(temporaryRoot, "repository");
    const artifactRoot = join(repositoryRoot, "artifacts", "production-smoke");
    const outsideRoot = join(temporaryRoot, "outside");
    const sentinelPath = join(outsideRoot, "sentinel.txt");
    await mkdir(repositoryRoot);
    await mkdir(outsideRoot);
    await writeFile(sentinelPath, "outside sentinel", "utf8");
    await prepareEvidenceRoot(repositoryRoot, artifactRoot);
    await rm(artifactRoot, { recursive: true });
    await symlink(outsideRoot, artifactRoot, "dir");

    await assert.rejects(
      prepareEvidenceDirectory(repositoryRoot, join(artifactRoot, ".staging")),
      /evidence paths must not traverse symbolic links/,
    );

    assert.equal(await readFile(sentinelPath, "utf8"), "outside sentinel");
    await assert.rejects(
      lstat(join(outsideRoot, ".staging")),
      { code: "ENOENT" },
    );
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test("records screenshot bytes and SHA-256 under safe names with a deterministic aggregate", () => {
  const race = createScreenshotEvidence("chrome-race.png", Buffer.from("race screenshot"));
  const editor = createScreenshotEvidence("chrome-editor.png", Buffer.from("editor screenshot"));

  assert.deepEqual(race, {
    path: "chrome-race.png",
    bytes: 15,
    sha256: createHash("sha256").update("race screenshot").digest("hex"),
  });
  assert.equal(
    aggregateScreenshotEvidence([race, editor]),
    aggregateScreenshotEvidence([editor, race]),
  );
});

test("rejects unsafe, empty, duplicate, or malformed screenshot evidence", () => {
  for (const fileName of ["../race.png", "nested/race.png", "nested\\race.png", ".png", "race.jpg"]) {
    assert.throws(
      () => createScreenshotEvidence(fileName, Buffer.from("screenshot")),
      /screenshot name is unsafe/,
    );
  }
  assert.throws(
    () => createScreenshotEvidence("race.png", Buffer.alloc(0)),
    /screenshot is empty/,
  );
  const record = createScreenshotEvidence("race.png", Buffer.from("screenshot"));
  assert.throws(
    () => aggregateScreenshotEvidence([record, record]),
    /screenshot path is duplicated/,
  );
  assert.throws(
    () => aggregateScreenshotEvidence([{ ...record, bytes: 0 }]),
    /screenshot evidence is invalid/,
  );
});

function fixturePage(observations) {
  return {
    locator(selector) {
      return {
        async waitFor(options) {
          observations.push({ selector, options });
        },
      };
    },
  };
}

test("waits for a racing gate and observes a restart transition before racing resumes", async () => {
  const observations = [];
  const page = fixturePage(observations);

  await waitForRaceGateRacing(page, 321);
  await waitForRestartedRaceGate(page, { transitionTimeoutMs: 654, racingTimeoutMs: 987 });

  assert.deepEqual(observations, [
    {
      selector: '[data-race-gate-phase="racing"]',
      options: { state: "attached", timeout: 321 },
    },
    {
      selector: '[data-race-gate-phase="loading"], [data-race-gate-phase="countdown"]',
      options: { state: "attached", timeout: 654 },
    },
    {
      selector: '[data-race-gate-phase="racing"]',
      options: { state: "attached", timeout: 987 },
    },
  ]);
});

test("creates the candidate parent before atomically promoting a completed staging bundle", async () => {
  const operations = [];
  const staging = "/evidence/.staging/run-1";
  const destination = "/evidence/candidates/manifest/runs/run-1";

  const promoted = await promoteEvidenceBundle(staging, destination, {
    mkdirImpl: async (path, options) => operations.push({ operation: "mkdir", path, options }),
    renameImpl: async (from, to) => operations.push({ operation: "rename", from, to }),
  });

  assert.equal(promoted, destination);
  assert.deepEqual(operations, [
    {
      operation: "mkdir",
      path: "/evidence/candidates/manifest/runs",
      options: { recursive: true },
    },
    { operation: "rename", from: staging, to: destination },
  ]);
});

test("reverifies served release bytes after the journey and rejects identity drift", async () => {
  const before = {
    verified: true,
    aggregateSha256: "a".repeat(64),
    fileCount: 4,
    totalBytes: 123,
    totalGzipBytes: 87,
    entrypoint: { sha256: "b".repeat(64) },
  };
  let calls = 0;
  const stable = await verifyServedReleaseAfterJourney({}, "https://rally.example/", before, {
    verifyImpl: async () => {
      calls += 1;
      return structuredClone(before);
    },
  });
  assert.equal(calls, 1);
  assert.deepEqual(stable, before);

  await assert.rejects(
    verifyServedReleaseAfterJourney({}, "https://rally.example/", before, {
      verifyImpl: async () => ({
        ...before,
        aggregateSha256: "c".repeat(64),
      }),
    }),
    /served candidate changed during the browser journey/,
  );
});

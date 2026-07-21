import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { gzipSync } from "node:zlib";

import {
  normalizeProductionBaseURL,
  validateFormat2ReleaseManifest,
  verifyServedRelease,
  withDeadline,
} from "./production-smoke-support.mjs";

function sha256(contents) {
  return createHash("sha256").update(contents).digest("hex");
}

function fixtureManifest(contentsByPath) {
  const files = [...contentsByPath.entries()]
    .map(([path, contents]) => {
      const gzipContents = gzipSync(contents, { level: 9 });
      return {
        path,
        bytes: contents.length,
        gzipBytes: gzipContents.length,
        gzipSha256: sha256(gzipContents),
        sha256: sha256(contents),
      };
    })
    .toSorted((left, right) => left.path.localeCompare(right.path));
  const aggregate = createHash("sha256");
  for (const record of files) aggregate.update(`${record.sha256}  ${record.path}\n`);
  return {
    product: "RIVET RIDGE RALLY",
    version: "1.0.0-rc.2",
    format: 2,
    source: {
      commit: "a".repeat(40),
      tag: "v1.0.0-rc.2",
      tagObject: "b".repeat(40),
      tagObjectType: "tag",
    },
    toolchain: {
      node: process.versions.node,
      nodeExecutableSha256: "e".repeat(64),
      npm: "11.17.0",
      npmCliSha256: "c".repeat(64),
      npmPackage: {
        treeFormat: 1,
        name: "npm",
        version: "11.17.0",
        cliRelativePath: "bin/npm-cli.js",
        packageJsonSha256: "a".repeat(64),
        directoryCount: 12,
        regularFileCount: 42,
        symlinkCount: 2,
        totalRegularFileBytes: 123_456,
        treeSha256: "b".repeat(64),
      },
      platform: "darwin",
      arch: "arm64",
      packageLockSha256: "d".repeat(64),
    },
    build: {
      source: "detached-clean-git-worktree",
      installCommand: "npm ci --no-audit --no-fund",
      buildCommand: "npm run build",
      viteQaMode: "0",
      npmConfig: "isolated-empty-user-and-global",
      installScripts: "enabled",
    },
    compression: { algorithm: "gzip", level: 9 },
    totalBytes: files.reduce((sum, record) => sum + record.bytes, 0),
    totalGzipBytes: files.reduce((sum, record) => sum + record.gzipBytes, 0),
    fileCount: files.length,
    aggregateSha256: aggregate.digest("hex"),
    files,
  };
}

function fixtureContents() {
  return new Map([
    ["THIRD_PARTY_NOTICES.txt", Buffer.from("Fixture notices.\n")],
    ["assets/index-fixture.js", Buffer.from("console.log('fixture');\n")],
    ["index.html", Buffer.from("<!doctype html><title>Fixture</title>\n")],
    ["sw.js", Buffer.from("// fixture worker\n")],
  ]);
}

function fixtureFetch(contentsByPath, requests) {
  return async (input, options) => {
    const url = new URL(input);
    const path = decodeURIComponent(url.pathname.slice(1));
    requests.push({ path, options });
    const contents = path === ""
      ? (contentsByPath.get("") ?? contentsByPath.get("index.html"))
      : contentsByPath.get(path);
    if (!contents) {
      return {
        ok: false,
        status: 404,
        url: url.href,
        arrayBuffer: async () => new ArrayBuffer(0),
      };
    }
    return {
      ok: true,
      status: 200,
      url: url.href,
      arrayBuffer: async () => contents.buffer.slice(
        contents.byteOffset,
        contents.byteOffset + contents.byteLength,
      ),
    };
  };
}

test("binds every served production file to a valid format-2 manifest", async () => {
  const contents = fixtureContents();
  const manifest = fixtureManifest(contents);
  const requests = [];

  const evidence = await verifyServedRelease(manifest, "https://rally.example/", {
    fetchImpl: fixtureFetch(contents, requests),
    timeoutMs: 1_000,
  });

  assert.equal(evidence.verified, true);
  assert.equal(evidence.fileCount, manifest.fileCount);
  assert.equal(evidence.totalBytes, manifest.totalBytes);
  assert.equal(evidence.totalGzipBytes, manifest.totalGzipBytes);
  assert.equal(evidence.aggregateSha256, manifest.aggregateSha256);
  assert.equal(evidence.baseURL, "https://rally.example/");
  assert.equal(evidence.entrypoint.requestedURL, "https://rally.example/");
  assert.equal(evidence.entrypoint.finalURL, "https://rally.example/");
  assert.equal(evidence.entrypoint.sha256, manifest.files.find(({ path }) => path === "index.html").sha256);
  assert.deepEqual(
    requests.map(({ path }) => path),
    [...manifest.files.map(({ path }) => path), ""],
  );
  for (const request of requests) {
    assert.equal(request.options.cache, "no-store");
    assert.equal(request.options.redirect, "follow");
    assert.equal(request.options.headers["cache-control"], "no-cache");
    assert.equal(request.options.headers.pragma, "no-cache");
    assert.ok(request.options.signal instanceof AbortSignal);
  }
});

test("fails when a served file differs from the manifest", async () => {
  const expected = fixtureContents();
  const manifest = fixtureManifest(expected);
  const served = new Map(expected);
  served.set("sw.js", Buffer.from("// different worker\n"));

  await assert.rejects(
    verifyServedRelease(manifest, "https://rally.example/", {
      fetchImpl: fixtureFetch(served, []),
      timeoutMs: 1_000,
    }),
    /served bytes do not match the release manifest: sw\.js/,
  );
});

test("fails when the served root differs from manifest index.html or leaves the origin", async () => {
  const expected = fixtureContents();
  const manifest = fixtureManifest(expected);
  const mismatchedRoot = new Map(expected);
  mismatchedRoot.set("", Buffer.from("<!doctype html><title>Different root</title>\n"));

  await assert.rejects(
    verifyServedRelease(manifest, "https://rally.example/", {
      fetchImpl: fixtureFetch(mismatchedRoot, []),
      timeoutMs: 1_000,
    }),
    /served entrypoint does not match release manifest index\.html/,
  );

  const requests = [];
  const sameOriginFetch = fixtureFetch(expected, requests);
  await assert.rejects(
    verifyServedRelease(manifest, "https://rally.example/", {
      fetchImpl: async (input, options) => {
        const response = await sameOriginFetch(input, options);
        if (new URL(input).pathname !== "/") return response;
        return { ...response, url: "https://elsewhere.example/" };
      },
      timeoutMs: 1_000,
    }),
    /release entrypoint left the dedicated origin/,
  );
});

test("normalizes a root URL and rejects embedded credentials", () => {
  assert.equal(normalizeProductionBaseURL("https://rally.example"), "https://rally.example/");
  assert.throws(
    () => normalizeProductionBaseURL("https://operator:secret@rally.example/"),
    /must not contain credentials/,
  );
});

test("rejects unsafe paths and internally inconsistent manifest aggregates", () => {
  const contents = fixtureContents();
  const manifest = fixtureManifest(contents);
  const unsafe = structuredClone(manifest);
  unsafe.files[0].path = "../THIRD_PARTY_NOTICES.txt";
  assert.throws(() => validateFormat2ReleaseManifest(unsafe), /file path is not canonical/);

  const inconsistent = structuredClone(manifest);
  inconsistent.aggregateSha256 = "0".repeat(64);
  assert.throws(() => validateFormat2ReleaseManifest(inconsistent), /aggregate SHA-256 does not match/);

  const inconsistentGzip = structuredClone(manifest);
  inconsistentGzip.files[0].gzipBytes += 1;
  assert.throws(() => validateFormat2ReleaseManifest(inconsistentGzip), /total gzip byte count does not match/);

  const missingNodeIdentity = structuredClone(manifest);
  delete missingNodeIdentity.toolchain.nodeExecutableSha256;
  assert.throws(() => validateFormat2ReleaseManifest(missingNodeIdentity), /Node executable SHA-256 is invalid/);

  const missingNpmTree = structuredClone(manifest);
  delete missingNpmTree.toolchain.npmPackage;
  assert.throws(() => validateFormat2ReleaseManifest(missingNpmTree), /npmPackage fields do not match/);

  const mismatchedNpmTreeVersion = structuredClone(manifest);
  mismatchedNpmTreeVersion.toolchain.npmPackage.version = "11.16.0";
  assert.throws(() => validateFormat2ReleaseManifest(mismatchedNpmTreeVersion), /npm package version does not match npm/);
});

test("refuses gzip re-verification under a different Node than the manifest toolchain", async () => {
  const manifest = fixtureManifest(fixtureContents());
  const foreignToolchain = structuredClone(manifest);
  foreignToolchain.toolchain.node = "1.0.0";
  await assert.rejects(
    verifyServedRelease(foreignToolchain, "http://127.0.0.1:9/", { fetchImpl: () => { throw new Error("must not fetch"); } }),
    /gzip re-verification requires the manifest toolchain Node 1\.0\.0/,
  );
});

test("bounds an unsettled production-smoke operation", async () => {
  await assert.rejects(
    withDeadline(new Promise(() => undefined), 10, "service worker readiness deadline"),
    /service worker readiness deadline/,
  );
});

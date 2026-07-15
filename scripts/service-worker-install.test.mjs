import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const WORKER_SOURCE = await readFile(new URL("../public/sw.js", import.meta.url), "utf8");
const ORIGIN = "https://rally.example";

function mockResponse(url, body, status = 200) {
  return {
    body,
    ok: status >= 200 && status < 300,
    status,
    url: new URL(url, ORIGIN).href,
    clone: () => mockResponse(url, body, status),
    text: async () => body,
  };
}

function createInstallHarness({ failedURL = null } = {}) {
  const listeners = new Map();
  const deletedCacheNames = [];
  const fetches = [];
  const openedCacheNames = [];
  const puts = [];
  let skipWaitingCalls = 0;
  const bodies = new Map([
    ["/index.html", '<link rel="stylesheet" href="/assets/index-current.css"><script src="/assets/index-current.js"></script><link rel="icon" href="/assets/icons/app-icon.svg">'],
  ]);
  const cache = {
    put: async (url, response) => {
      puts.push({ url, response });
    },
    match: async () => undefined,
  };
  const context = vm.createContext({
    AbortSignal,
    Promise,
    Response,
    Set,
    URL,
    caches: {
      delete: async (name) => {
        deletedCacheNames.push(name);
        return true;
      },
      keys: async () => [],
      open: async (name) => {
        openedCacheNames.push(name);
        return cache;
      },
    },
    fetch: async (url, options) => {
      const response = mockResponse(
        url,
        bodies.get(url) ?? `fixture:${url}`,
        url === failedURL ? 404 : 200,
      );
      fetches.push({ url, options, response });
      return response;
    },
    self: {
      location: { origin: ORIGIN },
      clients: { claim: async () => undefined },
      addEventListener: (type, listener) => listeners.set(type, listener),
      skipWaiting: async () => {
        skipWaitingCalls += 1;
      },
    },
  });
  vm.runInContext(WORKER_SOURCE, context, { filename: "public/sw.js" });
  return {
    deletedCacheNames,
    fetches,
    listeners,
    openedCacheNames,
    puts,
    skipWaitingCalls: () => skipWaitingCalls,
  };
}

async function runInstall(harness) {
  let installPromise;
  harness.listeners.get("install")({
    waitUntil: (promise) => {
      installPromise = promise;
    },
  });
  assert.equal(typeof installPromise?.then, "function");
  await installPromise;
}

test("installs only freshly reloaded, validated core and discovered assets", async () => {
  const harness = createInstallHarness();
  await runInstall(harness);

  assert.ok(harness.fetches.length > 0);
  assert.deepEqual(harness.openedCacheNames, ["rivet-ridge-rally-shell-v30"]);
  assert.deepEqual(harness.deletedCacheNames, []);
  assert.ok(harness.fetches.every(({ options }) => options?.cache === "reload"));
  assert.equal(harness.fetches.filter(({ url }) => url === "/").length, 0);
  assert.equal(harness.fetches.filter(({ url }) => url === "/index.html").length, 1);
  assert.equal(harness.fetches.filter(({ url }) => url === "/assets/icons/app-icon.svg").length, 1);
  assert.ok(harness.fetches.some(({ url }) => url === "/assets/index-current.js"));
  assert.ok(harness.fetches.some(({ url }) => url === "/assets/index-current.css"));

  const fetchedIndex = harness.fetches.find(({ url }) => url === "/index.html");
  const storedIndex = harness.puts.find(({ url }) => url === "/index.html");
  const storedRoot = harness.puts.find(({ url }) => url === "/");
  assert.equal(storedIndex?.response, fetchedIndex?.response);
  assert.equal(storedRoot?.response.body, fetchedIndex?.response.body);
  assert.deepEqual(
    harness.puts.map(({ url }) => url).toSorted(),
    ["/", ...harness.fetches.map(({ url }) => url)].toSorted(),
  );
  assert.equal(harness.skipWaitingCalls(), 1);
});

test("fails installation before activation when any fresh core response is not successful", async () => {
  const harness = createInstallHarness({ failedURL: "/assets/3d/festival-trail-bike.glb" });
  await assert.rejects(runInstall(harness), /Could not cache \/assets\/3d\/festival-trail-bike\.glb/);
  assert.deepEqual(harness.openedCacheNames, []);
  assert.deepEqual(harness.deletedCacheNames, ["rivet-ridge-rally-shell-v30"]);
  assert.equal(harness.skipWaitingCalls(), 0);
});

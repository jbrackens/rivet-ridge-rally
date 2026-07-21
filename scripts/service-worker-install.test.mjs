import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const WORKER_SOURCE = await readFile(new URL("../public/sw.js", import.meta.url), "utf8");
const ORIGIN = "https://rally.example";

function mockResponse(url, body, status = 200, headers = {}) {
  const normalizedHeaders = new Map(
    Object.entries(headers).map(([name, value]) => [name.toLowerCase(), value]),
  );
  return {
    body,
    ok: status >= 200 && status < 300,
    status,
    url: new URL(url, ORIGIN).href,
    headers: { get: (name) => normalizedHeaders.get(name.toLowerCase()) ?? null },
    clone: () => mockResponse(url, body, status, headers),
    text: async () => body,
  };
}

function requestURL(request) {
  return typeof request === "string" ? request : request.url;
}

function cacheKey(request) {
  return new URL(requestURL(request), ORIGIN).href;
}

function createWorkerHarness({ failedURL = null, resolveFetch = null, matches = new Map() } = {}) {
  const listeners = new Map();
  const deletedCacheNames = [];
  const fetches = [];
  const openedCacheNames = [];
  const matchCalls = [];
  const puts = [];
  let skipWaitingCalls = 0;
  const cacheEntries = new Map(
    [...matches].map(([request, response]) => [cacheKey(request), response]),
  );
  const bodies = new Map([
    ["/index.html", '<link rel="stylesheet" href="/assets/index-current.css"><script src="/assets/index-current.js"></script><link rel="icon" href="/assets/icons/app-icon.svg">'],
  ]);
  const cache = {
    put: async (url, response) => {
      puts.push({ url, response });
      cacheEntries.set(cacheKey(url), response);
    },
    match: async (request, options) => {
      matchCalls.push({ request, options });
      return cacheEntries.get(cacheKey(request));
    },
    keys: async () => [...cacheEntries.keys()].map((url) => ({ url })),
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
    fetch: async (request, options) => {
      const url = requestURL(request);
      const response = resolveFetch?.(url, options) ?? mockResponse(
        url,
        bodies.get(url) ?? `fixture:${url}`,
        url === failedURL ? 404 : 200,
      );
      fetches.push({ request, url, options, response });
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
    matchCalls,
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

async function runMessage(harness, data) {
  let messagePromise;
  const replies = [];
  harness.listeners.get("message")({
    data,
    ports: [{ postMessage: (value) => replies.push(value) }],
    waitUntil: (promise) => {
      messagePromise = promise;
    },
  });
  assert.equal(typeof messagePromise?.then, "function");
  await messagePromise;
  return replies.at(-1);
}

async function runFetch(harness, request) {
  let responsePromise;
  const background = [];
  harness.listeners.get("fetch")({
    request,
    respondWith: (promise) => {
      responsePromise = Promise.resolve(promise);
    },
    waitUntil: (promise) => background.push(promise),
  });
  if (!responsePromise) return { handled: false, response: undefined };
  const response = await responsePromise;
  await Promise.all(background);
  return { handled: true, response };
}

test("installs only freshly reloaded, validated core and discovered assets", async () => {
  const harness = createWorkerHarness();
  await runInstall(harness);

  assert.ok(harness.fetches.length > 0);
  assert.deepEqual(harness.openedCacheNames, ["rivet-ridge-rally-shell-v35"]);
  assert.deepEqual(harness.deletedCacheNames, []);
  assert.ok(harness.fetches.every(({ options }) => options?.cache === "reload"));
  assert.equal(harness.fetches.filter(({ url }) => url === "/").length, 0);
  assert.equal(harness.fetches.filter(({ url }) => url === "/index.html").length, 1);
  assert.equal(harness.fetches.filter(({ url }) => url === "/assets/icons/app-icon.svg").length, 1);
  assert.equal(harness.fetches.filter(({ url }) => url === "/assets/icons/app-icon-192.png").length, 1);
  assert.equal(harness.fetches.filter(({ url }) => url === "/assets/icons/app-icon-512.png").length, 1);
  assert.equal(harness.fetches.filter(({ url }) => url === "/assets/icons/app-icon-maskable-512.png").length, 1);
  assert.equal(harness.fetches.filter(({ url }) => url === "/assets/icons/apple-touch-icon-180.png").length, 1);
  assert.equal(harness.fetches.filter(({ url }) => url === "/assets/3d/hero-bike-rider.glb").length, 1);
  assert.equal(harness.fetches.filter(({ url }) => url === "/assets/rivals/rival-pack.glb").length, 1);
  assert.equal(harness.fetches.filter(({ url }) => url === "/assets/canyon/canyon-kit.glb").length, 1);
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
  const harness = createWorkerHarness({ failedURL: "/assets/3d/hero-bike-rider.glb" });
  await assert.rejects(runInstall(harness), /Could not cache \/assets\/3d\/hero-bike-rider\.glb/);
  assert.deepEqual(harness.openedCacheNames, []);
  assert.deepEqual(harness.deletedCacheNames, ["rivet-ridge-rally-shell-v35"]);
  assert.equal(harness.skipWaitingCalls(), 0);
});

test("fails installation when a core request resolves to a cross-origin response", async () => {
  const harness = createWorkerHarness({
    resolveFetch: (url) => url === "/assets/3d/hero-bike-rider.glb"
      ? mockResponse("https://cdn.example/hero-bike-rider.glb", "redirected")
      : mockResponse(url, url === "/index.html" ? "<main>shell</main>" : `fixture:${url}`),
  });
  await assert.rejects(runInstall(harness), /Could not cache \/assets\/3d\/hero-bike-rider\.glb/);
  assert.deepEqual(harness.deletedCacheNames, ["rivet-ridge-rally-shell-v35"]);
  assert.equal(harness.skipWaitingCalls(), 0);
});

test("fails installation when a fresh core response forbids storage", async () => {
  const harness = createWorkerHarness({
    resolveFetch: (url) => mockResponse(
      url,
      url === "/index.html" ? "<main>shell</main>" : `fixture:${url}`,
      200,
      url === "/assets/3d/hero-bike-rider.glb" ? { "Cache-Control": "public, no-store" } : {},
    ),
  });
  await assert.rejects(runInstall(harness), /Could not cache \/assets\/3d\/hero-bike-rider\.glb/);
  assert.deepEqual(harness.deletedCacheNames, ["rivet-ridge-rally-shell-v35"]);
  assert.equal(harness.skipWaitingCalls(), 0);
});

test("installs an ordinary Vary response and matches it safely while offline", async () => {
  const variedURL = "/assets/3d/hero-bike-rider.glb";
  const harness = createWorkerHarness({
    resolveFetch: (url) => mockResponse(
      url,
      url === "/index.html" ? "<main>shell</main>" : `fixture:${url}`,
      200,
      url === variedURL ? { Vary: "Accept-Encoding" } : {},
    ),
  });
  await runInstall(harness);

  const result = await runFetch(harness, {
    method: "GET",
    mode: "cors",
    url: `${ORIGIN}${variedURL}`,
  });
  assert.equal(result.handled, true);
  assert.equal(result.response?.headers.get("vary"), "Accept-Encoding");
  assert.ok(harness.matchCalls.some(({ request, options }) => (
    requestURL(request) === `${ORIGIN}${variedURL}` && options?.ignoreVary === true
  )));
});

test("fails installation when a fresh core response has Vary star", async () => {
  const harness = createWorkerHarness({
    resolveFetch: (url) => mockResponse(
      url,
      url === "/index.html" ? "<main>shell</main>" : `fixture:${url}`,
      200,
      url === "/assets/3d/hero-bike-rider.glb" ? { Vary: "*" } : {},
    ),
  });
  await assert.rejects(runInstall(harness), /Could not cache \/assets\/3d\/hero-bike-rider\.glb/);
  assert.deepEqual(harness.deletedCacheNames, ["rivet-ridge-rally-shell-v35"]);
  assert.equal(harness.skipWaitingCalls(), 0);
});

test("fails installation before cache creation when the complete shell exceeds its entry cap", async () => {
  const oversizedIndex = Array.from(
    { length: 192 },
    (_, index) => `<script src="/assets/install-overflow-${index}.js"></script>`,
  ).join("");
  const harness = createWorkerHarness({
    resolveFetch: (url) => mockResponse(
      url,
      url === "/index.html" ? oversizedIndex : `fixture:${url}`,
    ),
  });
  await assert.rejects(runInstall(harness), /Install cache exceeds 192 entries/);
  assert.deepEqual(harness.openedCacheNames, []);
  assert.deepEqual(harness.deletedCacheNames, ["rivet-ridge-rally-shell-v35"]);
  assert.equal(harness.skipWaitingCalls(), 0);
  assert.ok(harness.fetches.every(({ url }) => !url.includes("install-overflow-")));
});

test("falls back to the cached shell when navigation resolves with a same-origin 5xx", async () => {
  const cachedShell = mockResponse("/index.html", "cached shell");
  const harness = createWorkerHarness({
    matches: new Map([["/index.html", cachedShell]]),
    resolveFetch: (url) => mockResponse(url, "origin unavailable", 503),
  });
  const result = await runFetch(harness, {
    method: "GET",
    mode: "navigate",
    url: `${ORIGIN}/outage`,
  });
  assert.equal(result.handled, true);
  assert.equal(result.response, cachedShell);
});

test("returns a same-origin 4xx navigation response without masking it", async () => {
  const cachedShell = mockResponse("/index.html", "cached shell");
  const notFound = mockResponse("/missing", "not found", 404);
  const harness = createWorkerHarness({
    matches: new Map([["/index.html", cachedShell]]),
    resolveFetch: () => notFound,
  });
  const result = await runFetch(harness, {
    method: "GET",
    mode: "navigate",
    url: `${ORIGIN}/missing`,
  });
  assert.equal(result.handled, true);
  assert.equal(result.response, notFound);
});

test("falls back to the cached shell when navigation fetch rejects", async () => {
  const cachedShell = mockResponse("/index.html", "cached shell");
  const harness = createWorkerHarness({
    matches: new Map([["/index.html", cachedShell]]),
    resolveFetch: () => {
      throw new Error("network unavailable");
    },
  });
  const result = await runFetch(harness, {
    method: "GET",
    mode: "navigate",
    url: `${ORIGIN}/offline`,
  });
  assert.equal(result.handled, true);
  assert.equal(result.response, cachedShell);
});

test("falls back to the cached shell when navigation resolves cross-origin", async () => {
  const cachedShell = mockResponse("/index.html", "cached shell");
  const harness = createWorkerHarness({
    matches: new Map([["/index.html", cachedShell]]),
    resolveFetch: () => mockResponse("https://login.example/session", "redirected"),
  });
  const result = await runFetch(harness, {
    method: "GET",
    mode: "navigate",
    url: `${ORIGIN}/private`,
  });
  assert.equal(result.handled, true);
  assert.equal(result.response, cachedShell);
});

test("runtime warming rejects cross-origin final responses and does not claim readiness", async () => {
  const runtimeURL = `${ORIGIN}/assets/runtime-current.js`;
  const harness = createWorkerHarness({
    resolveFetch: () => mockResponse("https://cdn.example/runtime-current.js", "redirected"),
  });
  const reply = await runMessage(harness, {
    type: "CACHE_RUNTIME_RESOURCES",
    urls: [runtimeURL],
  });
  assert.equal(reply?.cacheName, "rivet-ridge-rally-shell-v35");
  assert.equal(reply?.ok, false);
  assert.equal(reply?.failed, 1);
  assert.deepEqual(harness.puts, []);
});

test("runtime warming rejects Vary star responses", async () => {
  const runtimeURL = `${ORIGIN}/assets/runtime-current.js`;
  const harness = createWorkerHarness({
    resolveFetch: (url) => mockResponse(url, "variant", 200, { Vary: "*" }),
  });
  const reply = await runMessage(harness, {
    type: "CACHE_RUNTIME_RESOURCES",
    urls: [runtimeURL],
  });
  assert.equal(reply?.cacheName, "rivet-ridge-rally-shell-v35");
  assert.equal(reply?.ok, false);
  assert.equal(reply?.failed, 1);
  assert.deepEqual(harness.puts, []);
});

test("runtime warming rejects a same-origin final URL outside the static allowlist", async () => {
  const runtimeURL = `${ORIGIN}/assets/runtime-current.js`;
  const redirected = mockResponse(`${ORIGIN}/api/profile`, "private response");
  const harness = createWorkerHarness({ resolveFetch: () => redirected });
  const reply = await runMessage(harness, {
    type: "CACHE_RUNTIME_RESOURCES",
    urls: [runtimeURL],
  });
  assert.equal(reply?.cacheName, "rivet-ridge-rally-shell-v35");
  assert.equal(reply?.ok, false);
  assert.equal(reply?.failed, 1);

  const result = await runFetch(harness, {
    method: "GET",
    mode: "cors",
    url: runtimeURL,
  });
  assert.equal(result.handled, true);
  assert.equal(result.response, redirected);
  assert.deepEqual(harness.puts, []);
});

test("runtime cache growth is capped across batches and generic misses", async () => {
  const cachedShell = mockResponse("/index.html", "cached shell");
  const matches = new Map([
    ["/index.html", cachedShell],
    ...Array.from({ length: 190 }, (_, index) => {
      const url = `/assets/cached-${index}.js`;
      return [url, mockResponse(url, `cached:${index}`)];
    }),
  ]);
  const harness = createWorkerHarness({
    matches,
    resolveFetch: (url) => {
      if (url === `${ORIGIN}/offline`) throw new Error("network unavailable");
      return mockResponse(url, `fresh:${url}`);
    },
  });

  const firstReply = await runMessage(harness, {
    type: "CACHE_RUNTIME_RESOURCES",
    urls: [`${ORIGIN}/assets/runtime-191.js`],
  });
  assert.equal(firstReply?.ok, true);
  const secondReply = await runMessage(harness, {
    type: "CACHE_RUNTIME_RESOURCES",
    urls: [`${ORIGIN}/assets/runtime-192.js`],
  });
  assert.equal(secondReply?.ok, false);
  assert.equal(secondReply?.failed, 1);

  const genericResponse = await runFetch(harness, {
    method: "GET",
    mode: "cors",
    url: `${ORIGIN}/assets/generic-overflow.js`,
  });
  assert.equal(genericResponse.handled, true);
  assert.equal(genericResponse.response?.body, `fresh:${ORIGIN}/assets/generic-overflow.js`);
  assert.equal(harness.puts.length, 1);

  const offlineNavigation = await runFetch(harness, {
    method: "GET",
    mode: "navigate",
    url: `${ORIGIN}/offline`,
  });
  assert.equal(offlineNavigation.response, cachedShell);
});

test("generic cache fill returns but does not retain a cross-origin final response", async () => {
  const redirected = mockResponse("https://cdn.example/runtime-current.js", "redirected");
  const harness = createWorkerHarness({ resolveFetch: () => redirected });
  const result = await runFetch(harness, {
    method: "GET",
    mode: "cors",
    url: `${ORIGIN}/assets/runtime-current.js`,
  });
  assert.equal(result.handled, true);
  assert.equal(result.response, redirected);
  assert.deepEqual(harness.puts, []);
});

test("runtime caching rejects non-static paths and generic fetch leaves them untouched", async () => {
  const harness = createWorkerHarness();
  const reply = await runMessage(harness, {
    type: "CACHE_RUNTIME_RESOURCES",
    urls: [`${ORIGIN}/api/profile`],
  });
  assert.equal(reply?.cacheName, "rivet-ridge-rally-shell-v35");
  assert.equal(reply?.ok, false);
  assert.equal(reply?.failed, 1);
  const result = await runFetch(harness, {
    method: "GET",
    mode: "cors",
    url: `${ORIGIN}/api/profile`,
  });
  assert.equal(result.handled, false);
  assert.deepEqual(harness.fetches, []);
  assert.deepEqual(harness.puts, []);
});

test("runtime caching rejects oversized batches before fetching", async () => {
  const harness = createWorkerHarness();
  const reply = await runMessage(harness, {
    type: "CACHE_RUNTIME_RESOURCES",
    urls: Array.from({ length: 129 }, (_, index) => `${ORIGIN}/assets/runtime-${index}.js`),
  });
  assert.equal(reply?.cacheName, "rivet-ridge-rally-shell-v35");
  assert.equal(reply?.ok, false);
  assert.equal(reply?.failed, 129);
  assert.deepEqual(harness.fetches, []);
  assert.deepEqual(harness.puts, []);
});

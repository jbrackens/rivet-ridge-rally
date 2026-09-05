/* global caches, self */

const CACHE_PREFIX = "rivet-ridge-rally-";
const CACHE_NAME = `${CACHE_PREFIX}shell-v35`;
const TRANSITION_CACHE_COUNT = 1;
const MAX_RUNTIME_RESOURCES = 128;
const MAX_CACHE_ENTRIES = 192;
const INDEX_URL = "/index.html";
const INDEX_CACHE_KEYS = ["/", INDEX_URL];
const CORE_ASSETS = [
  "/manifest.webmanifest",
  "/assets/icons/app-icon.svg",
  "/assets/icons/app-icon-192.png",
  "/assets/icons/app-icon-512.png",
  "/assets/icons/app-icon-maskable-512.png",
  "/assets/icons/apple-touch-icon-180.png",
  "/assets/art/title-background.png",
  "/assets/art/canyon-festival-panorama.png",
  "/assets/fonts/barlow-condensed-700-latin.woff2",
  "/assets/fonts/barlow-condensed-900-latin.woff2",
  "/assets/3d/hero-bike-rider.glb",
  "/assets/rivals/rival-pack.glb",
  "/assets/canyon/canyon-kit.glb",
  "/assets/transcoders/basis/basis_transcoder.js",
  "/assets/transcoders/basis/basis_transcoder.wasm",
];

function isSameOriginResponse(response) {
  try {
    return new URL(response.url).origin === self.location.origin;
  } catch {
    return false;
  }
}

function isCacheableSameOriginResponse(response) {
  if (!response.ok) return false;
  let responseURL;
  try {
    responseURL = new URL(response.url);
  } catch {
    return false;
  }
  if (!isRuntimeCacheableURL(responseURL)) return false;
  const cacheControl = response.headers?.get?.("cache-control") ?? "";
  const vary = response.headers?.get?.("vary") ?? "";
  const forbidsStorage = cacheControl.split(",")
    .some((directive) => directive.trim().toLowerCase() === "no-store");
  const variesArbitrarily = vary.split(",").some((name) => name.trim() === "*");
  return !forbidsStorage && !variesArbitrarily;
}

function isRuntimeCacheableURL(url) {
  return url.origin === self.location.origin
    && !url.username
    && !url.password
    && !url.search
    && !url.hash
    && (
      INDEX_CACHE_KEYS.includes(url.pathname)
      || url.pathname === "/manifest.webmanifest"
      || url.pathname.startsWith("/assets/")
    );
}

function normalizeRuntimeResourceURLs(values) {
  if (values.length === 0) throw new Error("Runtime cache request is empty");
  if (values.length > MAX_RUNTIME_RESOURCES) {
    throw new Error(`Runtime cache request exceeds ${MAX_RUNTIME_RESOURCES} resources`);
  }
  return [...new Set(values.map((value) => {
    if (typeof value !== "string") throw new Error("Runtime cache URL must be a string");
    const url = new URL(value, self.location.origin);
    if (!isRuntimeCacheableURL(url)) throw new Error(`Runtime cache URL is not allowed: ${value}`);
    return url.href;
  }))];
}

function staticRequestURL(request) {
  try {
    const value = typeof request === "string" ? request : request.url;
    const url = new URL(value, self.location.origin);
    return isRuntimeCacheableURL(url) ? url : null;
  } catch {
    return null;
  }
}

async function matchStaticResource(cache, request) {
  if (!staticRequestURL(request)) return undefined;
  return cache.match(request, { ignoreVary: true });
}

let runtimeCacheWrite = Promise.resolve();

function putBoundedRuntimeResponse(cache, request, response) {
  const write = runtimeCacheWrite.then(async () => {
    if (!(await matchStaticResource(cache, request))) {
      const entries = await cache.keys();
      if (entries.length >= MAX_CACHE_ENTRIES) {
        throw new Error(`Runtime cache is limited to ${MAX_CACHE_ENTRIES} entries`);
      }
    }
    await cache.put(request, response);
  });
  runtimeCacheWrite = write.catch(() => undefined);
  return write;
}

async function fetchFreshAsset(url) {
  const response = await fetch(url, { cache: "reload" });
  if (!isCacheableSameOriginResponse(response)) throw new Error(`Could not cache ${url}`);
  return response;
}

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    try {
      const [indexResponse, coreResponses] = await Promise.all([
        fetchFreshAsset(INDEX_URL),
        Promise.all(CORE_ASSETS.map(async (url) => ({
          url,
          response: await fetchFreshAsset(url),
        }))),
      ]);
      const html = await indexResponse.clone().text();
      const buildAssets = [...html.matchAll(/(?:src|href)="([^"#]+)"/g)]
        .map((match) => match[1])
        .filter((url) => url?.startsWith("/assets/"));
      const coreAssetSet = new Set([...INDEX_CACHE_KEYS, ...CORE_ASSETS]);
      const discoveredAssetURLs = [...new Set(buildAssets)]
        .filter((url) => !coreAssetSet.has(url));
      if (coreAssetSet.size + discoveredAssetURLs.length > MAX_CACHE_ENTRIES) {
        throw new Error(`Install cache exceeds ${MAX_CACHE_ENTRIES} entries`);
      }
      const discoveredResponses = await Promise.all(discoveredAssetURLs
        .map(async (url) => ({
          url,
          response: await fetchFreshAsset(url),
        })));
      const indexCacheResponses = [
        { url: "/", response: indexResponse.clone() },
        { url: INDEX_URL, response: indexResponse },
      ];
      const cache = await caches.open(CACHE_NAME);
      await Promise.all([...indexCacheResponses, ...coreResponses, ...discoveredResponses]
        .map(({ url, response }) => cache.put(url, response)));
      await self.skipWaiting();
    } catch (error) {
      await caches.delete(CACHE_NAME);
      throw error;
    }
  })());
});

function cacheGeneration(cacheName) {
  const match = /shell-v(\d+)$/.exec(cacheName);
  return match ? Number(match[1]) : -1;
}

function newestPreviousCacheNames(keys) {
  return keys
    .filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME)
    .sort((first, second) => cacheGeneration(second) - cacheGeneration(first))
    .slice(0, TRANSITION_CACHE_COUNT);
}

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    const retained = new Set([CACHE_NAME, ...newestPreviousCacheNames(keys)]);
    await Promise.all(keys
      .filter((key) => key.startsWith(CACHE_PREFIX) && !retained.has(key))
      .map((key) => caches.delete(key)));
    await self.clients.claim();
  })());
});

async function matchCurrentThenPrevious(request) {
  if (!staticRequestURL(request)) return undefined;
  const currentCache = await caches.open(CACHE_NAME);
  const currentResponse = await matchStaticResource(currentCache, request);
  if (currentResponse) return currentResponse;

  const previousNames = newestPreviousCacheNames(await caches.keys());
  for (const cacheName of previousNames) {
    const response = await matchStaticResource(await caches.open(cacheName), request);
    if (response) return response;
  }
  return undefined;
}

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") {
    event.waitUntil(self.skipWaiting());
    return;
  }
  if (event.data?.type !== "CACHE_RUNTIME_RESOURCES" || !Array.isArray(event.data.urls)) return;

  event.waitUntil((async () => {
    let failed;
    try {
      const cache = await caches.open(CACHE_NAME);
      const urls = normalizeRuntimeResourceURLs(event.data.urls);

      const outcomes = await Promise.allSettled(urls.map(async (url) => {
        try {
          const response = await fetch(url, { cache: "reload" });
          if (!isCacheableSameOriginResponse(response)) throw new Error(`Could not cache ${url}`);
          await putBoundedRuntimeResponse(cache, url, response);
        } catch (error) {
          if (!(await matchStaticResource(cache, url))) throw error;
        }
      }));
      failed = outcomes.filter((outcome) => outcome.status === "rejected").length;
    } catch {
      failed = Math.max(1, event.data.urls.length);
    }
    event.ports[0]?.postMessage({ cacheName: CACHE_NAME, ok: failed === 0, failed });
  })());
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    event.respondWith(
      (async () => {
        try {
          const response = await fetch(request);
          const isServerFailure = response.status >= 500 && response.status <= 599;
          if (isSameOriginResponse(response) && !isServerFailure) return response;
        } catch {
          // Fall through to the last complete app shell.
        }
        return (await matchCurrentThenPrevious(INDEX_URL)) ?? Response.error();
      })(),
    );
    return;
  }

  if (!isRuntimeCacheableURL(url)) return;

  event.respondWith(
    matchCurrentThenPrevious(request).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((response) => {
        if (isCacheableSameOriginResponse(response)) {
          const copy = response.clone();
          event.waitUntil(
            caches.open(CACHE_NAME)
              .then((cache) => putBoundedRuntimeResponse(cache, request, copy))
              .catch(() => undefined),
          );
        }
        return response;
      });
    }),
  );
});

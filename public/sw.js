/* global caches, self */

const CACHE_PREFIX = "rivet-ridge-rally-";
const CACHE_NAME = `${CACHE_PREFIX}shell-v30`;
const TRANSITION_CACHE_COUNT = 1;
const INDEX_URL = "/index.html";
const INDEX_CACHE_KEYS = ["/", INDEX_URL];
const CORE_ASSETS = [
  "/manifest.webmanifest",
  "/assets/icons/app-icon.svg",
  "/assets/art/title-background.png",
  "/assets/art/canyon-festival-panorama.png",
  "/assets/fonts/barlow-condensed-700-latin.woff2",
  "/assets/fonts/barlow-condensed-900-latin.woff2",
  "/assets/3d/festival-trail-bike.glb",
  "/assets/transcoders/basis/basis_transcoder.js",
  "/assets/transcoders/basis/basis_transcoder.wasm",
];

async function fetchFreshAsset(url) {
  const response = await fetch(url, { cache: "reload" });
  if (!response.ok) throw new Error(`Could not cache ${url}`);
  if (new URL(response.url).origin !== self.location.origin) {
    throw new Error(`Could not cache cross-origin response for ${url}`);
  }
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
      const discoveredResponses = await Promise.all([...new Set(buildAssets)]
        .filter((url) => !coreAssetSet.has(url))
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

async function matchCurrentThenPrevious(request, options) {
  const currentCache = await caches.open(CACHE_NAME);
  const currentResponse = await currentCache.match(request, options);
  if (currentResponse) return currentResponse;

  const previousNames = newestPreviousCacheNames(await caches.keys());
  for (const cacheName of previousNames) {
    const response = await (await caches.open(cacheName)).match(request, options);
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
    let failed = 1;
    try {
      const cache = await caches.open(CACHE_NAME);
      const urls = [...new Set(event.data.urls)]
        .map((value) => {
          try {
            return new URL(value, self.location.origin);
          } catch {
            return null;
          }
        })
        .filter((url) => url?.origin === self.location.origin)
        .map((url) => url.href);

      const outcomes = await Promise.allSettled(urls.map(async (url) => {
        try {
          const response = await fetch(url, { cache: "reload" });
          if (!response.ok) throw new Error(`Could not cache ${url}`);
          await cache.put(url, response);
        } catch (error) {
          if (!(await cache.match(url, { ignoreVary: true }))) throw error;
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
      fetch(request).catch(async () => (
        (await matchCurrentThenPrevious("/index.html", { ignoreVary: true })) ?? Response.error()
      )),
    );
    return;
  }

  event.respondWith(
    matchCurrentThenPrevious(request, { ignoreVary: true }).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((response) => {
        if (response.ok) {
          const copy = response.clone();
          event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.put(request, copy)));
        }
        return response;
      });
    }),
  );
});

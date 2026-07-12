/* global caches, self */

const CACHE_PREFIX = "rivet-ridge-rally-";
const CACHE_NAME = `${CACHE_PREFIX}shell-v7`;
const CORE_ASSETS = [
  "/",
  "/index.html",
  "/manifest.webmanifest",
  "/assets/icons/app-icon.svg",
  "/assets/art/title-background.png",
  "/assets/3d/festival-trail-bike.glb",
  "/assets/transcoders/basis/basis_transcoder.js",
  "/assets/transcoders/basis/basis_transcoder.wasm",
];

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await cache.addAll(CORE_ASSETS);
    const html = await (await fetch("/index.html", { cache: "reload" })).text();
    const buildAssets = [...html.matchAll(/(?:src|href)="([^"#]+)"/g)]
      .map((match) => match[1])
      .filter((url) => url?.startsWith("/assets/"));
    await cache.addAll([...new Set(buildAssets)]);
  })());
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys
        .filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME)
        .map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("message", (event) => {
  if (event.data?.type !== "CACHE_RUNTIME_RESOURCES" || !Array.isArray(event.data.urls)) return;

  event.waitUntil((async () => {
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
      const response = await fetch(url, { cache: "reload" });
      if (!response.ok) throw new Error(`Could not cache ${url}`);
      await cache.put(url, response);
    }));
    const failed = outcomes.filter((outcome) => outcome.status === "rejected").length;
    event.ports[0]?.postMessage({ ok: failed === 0, failed });
  })());
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(async () => (await caches.match("/index.html", { ignoreVary: true })) ?? Response.error()),
    );
    return;
  }

  event.respondWith(
    caches.match(request, { ignoreVary: true }).then((cached) => {
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

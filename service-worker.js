const CACHE_NAME = "pgcs-portal-v2";
const BASE_URL = new URL("./", self.location.href);
const APP_FILES = [
  "",
  "index.html",
  "style.css",
  "data.js",
  "assets.js",
  "app.js",
  "manifest.json",
  "Pictures/PGCS-21_Logo.png",
  "Pictures/Letter_Head.png",
  "Pictures/pgcs-app-192.png",
  "Pictures/pgcs-app-512.png"
].map(path => new URL(path, BASE_URL).href);

self.addEventListener("install", event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(APP_FILES)));
  self.skipWaiting();
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key.startsWith("pgcs-portal-") && key !== CACHE_NAME).map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", event => {
  if (event.request.method !== "GET") return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(event.request);
    const refresh = fetch(event.request).then(response => {
      if (response.ok || response.type === "opaque") {
        event.waitUntil(cache.put(event.request, response.clone()));
      }
      return response;
    });
    if (cached) {
      event.waitUntil(refresh.catch(() => {}));
      return cached;
    }
    return refresh;
  })());
});

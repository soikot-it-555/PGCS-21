const CACHE_NAME = "pgcs-portal-v6";
const BASE_URL = new URL("./", self.location.href);
const APP_FILES = [
  "",
  "index.html",
  "style.css",
  "data.js",
  "db.js",
  "assets.js",
  "app.js",
  "finance.js",
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
  if (new URL(event.request.url).hostname.endsWith(".supabase.co")) return; // Database ডেটা কখনো cache নয়
  // Network-first: নতুন ফাইল সবসময় আগে আসবে; অফলাইনে থাকলে cache থেকে দেখাবে
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    try {
      const response = await fetch(event.request, { cache: "no-cache" });
      if (response.ok) event.waitUntil(cache.put(event.request, response.clone()));
      return response;
    } catch (e) {
      const cached = await cache.match(event.request);
      if (cached) return cached;
      throw e;
    }
  })());
});

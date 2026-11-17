const CACHE_NAME = "pgcs-portal-v12";
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
  "admin-ext.js",
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
  const u = new URL(event.request.url);
  if (u.hostname.endsWith(".supabase.co") || u.hostname.endsWith(".supabase.in")) return; // Database / Storage / Realtime কখনো cache নয়
  if (event.request.headers.has("range") || u.protocol === "chrome-extension:") return;
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

// service-worker.js
const CACHE_NAME = 'meshwarak-v999';
const ASSETS = [
  "./",
  "./index.html",
  "./login.html",
  "./passenger.html",
  "./driver.html",
  "./styles.css",
  "./auth.js",
  "./passenger.js",
  "./driver.js",
  "./firebase-init.js",
  "./firestore-api.js",
  "./map-kit.js",
  "./egypt-locations.js",
  "./pwa.js",
  "./notify.js",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./manifest.webmanifest"
];

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await cache.addAll(ASSETS);
    self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.map(k => k !== CACHE_NAME ? caches.delete(k) : Promise.resolve()));
    self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // Only cache same-origin GET requests
  if (req.method !== "GET" || url.origin !== self.location.origin) return;

  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(req);
    if (cached) return cached;

    try {
      const fresh = await fetch(req);
      // cache static files
      if (fresh.ok && (url.pathname.endsWith(".js") || url.pathname.endsWith(".css") || url.pathname.endsWith(".html") || url.pathname.endsWith(".png") || url.pathname.endsWith(".webmanifest"))) {
        cache.put(req, fresh.clone());
      }
      return fresh;
    } catch (e) {
      // fallback
      return cached || Response.error();
    }
  })());
});

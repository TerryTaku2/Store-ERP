// Service worker for the installed PWA shell.
//
// Strategy: stale-while-revalidate for same-origin static assets (HTML/CSS/JS/
// icons) so repeat launches are instant, while every /api/* request always goes
// straight to the network — this is a live business app, a cached stock count
// or sales total would be actively wrong, not just stale. Cross-origin requests
// (the Chart.js / html5-qrcode CDN scripts) are left completely untouched.
const STATIC_CACHE = "ttech-static-v1";

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(STATIC_CACHE).then((cache) => cache.add("/offline.html")));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== STATIC_CACHE).map((k) => caches.delete(k))))
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return;

  event.respondWith(
    caches.open(STATIC_CACHE).then(async (cache) => {
      const cached = await cache.match(request);
      const networkFetch = fetch(request)
        .then((response) => {
          if (response.ok) cache.put(request, response.clone());
          return response;
        })
        .catch(() => null);

      if (cached) {
        // Update the cache for next time, but don't make this load wait on it.
        networkFetch;
        return cached;
      }

      const fresh = await networkFetch;
      if (fresh) return fresh;

      if (request.mode === "navigate") {
        return cache.match("/offline.html");
      }
      return new Response("", { status: 504, statusText: "Offline" });
    })
  );
});

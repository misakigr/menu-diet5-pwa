// Offline application shell.
//
// Only the static shell is cached here. Snapshot responses are never stored by
// the service worker: they carry the device access key in the request URL and
// belong in the versioned IndexedDB cache the app manages itself.

const SHELL_VERSION = "phase19-shell-v1";
const SHELL_ASSETS = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./styles/app.css",
  "./js/app.js",
  "./js/api.js",
  "./js/config.js",
  "./js/format.js",
  "./js/pairing.js",
  "./js/router.js",
  "./js/storage.js",
  "./js/store.js",
  "./js/views.js",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/maskable-192.png",
  "./icons/maskable-512.png",
  "./icons/apple-touch-icon.png"
];

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(SHELL_VERSION)
      .then(cache => cache.addAll(SHELL_ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(key => key !== SHELL_VERSION).map(key => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", event => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  // Never touch the snapshot API or any other cross-origin request.
  if (url.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then(response => {
          const copy = response.clone();
          caches.open(SHELL_VERSION).then(cache => cache.put("./index.html", copy));
          return response;
        })
        .catch(() => caches.match("./index.html", {ignoreSearch: true})
          .then(cached => cached || caches.match("./")))
    );
    return;
  }

  event.respondWith(
    caches.match(request).then(cached => {
      if (cached) return cached;
      return fetch(request).then(response => {
        if (response && response.ok && response.type === "basic") {
          const copy = response.clone();
          caches.open(SHELL_VERSION).then(cache => cache.put(request, copy));
        }
        return response;
      });
    })
  );
});

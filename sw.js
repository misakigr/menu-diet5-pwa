// Offline application shell.
//
// Only the static shell is cached here. Snapshot responses are never stored by
// the service worker: they carry the device access key in the request URL and
// belong in the versioned IndexedDB cache the app manages itself.

const SHELL_VERSION = "menu-diet5-shell-v2.0.1-91de97f1f1ca46f8";
const SHELL_ASSETS = [
  "./",
  "./icons/apple-touch-icon.png",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/maskable-192.png",
  "./icons/maskable-512.png",
  "./index.html",
  "./js/api.js",
  "./js/app.js",
  "./js/checklist.js",
  "./js/config.js",
  "./js/format.js",
  "./js/pairing.js",
  "./js/release.js",
  "./js/router.js",
  "./js/storage.js",
  "./js/store.js",
  "./js/views.js",
  "./manifest.webmanifest",
  "./release.json",
  "./styles/app.css"
];

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(SHELL_VERSION)
      .then(cache => cache.addAll(SHELL_ASSETS.map(asset =>
        new Request(new URL(asset, self.location.href), {cache: "reload"}))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(key => key !== SHELL_VERSION &&
          (/^phase(?:18|19)-shell-v\d+$/.test(key) || key.startsWith("menu-diet5-shell-"))).map(key => caches.delete(key))
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
  const base = new URL("./", self.location.href);
  if (!url.pathname.startsWith(base.pathname)) return;
  const asset = "./" + url.pathname.slice(base.pathname.length);
  if (request.mode !== "navigate" && (!SHELL_ASSETS.includes(asset) || url.search)) return;

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then(response => {
          if (!response.ok) throw new Error("navigation_failed");
          const copy = response.clone();
          caches.open(SHELL_VERSION).then(cache => cache.put("./index.html", copy));
          return response;
        })
        .catch(() => caches.open(SHELL_VERSION).then(cache => cache.match("./index.html"))
          .then(cached => cached || caches.open(SHELL_VERSION).then(cache => cache.match("./"))))
    );
    return;
  }

  event.respondWith(
    caches.open(SHELL_VERSION).then(cache => cache.match(request)).then(cached => {
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

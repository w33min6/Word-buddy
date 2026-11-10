/* Word Buddy service worker: opens fast, works offline after first use.
   App files are served from the cache and refreshed in the background,
   so an update shows up the next time the app is opened.
   To publish an update, change VERSION below. */
const VERSION = "wb-2026-11-10-3";
const SHELL = ["./", "index.html", "app.js", "prep.js", "manifest.webmanifest",
  "icon-192.png", "icon-512.png", "apple-touch-icon.png"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION && k !== "wb-cdn").map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  // English dictionary: network first, fall back to the last answer we saw
  if (url.hostname === "api.dictionaryapi.dev") {
    e.respondWith(fetch(req).then(res => {
      if (res.ok || res.status === 404) { const copy = res.clone(); caches.open("wb-cdn").then(c => c.put(req, copy)); }
      return res;
    }).catch(() => caches.match(req).then(r => r || Response.error())));
    return;
  }
  // version-pinned libraries and fonts: cache first, they never change
  if (/^(cdn\.jsdelivr\.net|fonts\.googleapis\.com|fonts\.gstatic\.com)$/.test(url.hostname)) {
    e.respondWith(caches.open("wb-cdn").then(c => c.match(req).then(hit => hit || fetch(req).then(res => {
      if (res.ok || res.type === "opaque") c.put(req, res.clone());
      return res;
    }))));
    return;
  }
  // our own files: serve the cached copy now, refresh it in the background
  if (url.origin === self.location.origin) {
    e.respondWith(caches.open(VERSION).then(c => c.match(req, { ignoreSearch: true }).then(hit => {
      const fresh = fetch(req).then(res => { if (res.ok) c.put(req, res.clone()); return res; }).catch(() => hit);
      if (hit) { e.waitUntil(fresh.catch(() => {})); return hit; }
      return fresh;
    })));
  }
});

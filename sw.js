// Electrosparkzz service worker. One worker for the whole site (scope /).
// Bump VERSION when the precache list or caching rules change; old caches are deleted on activate.
const VERSION = 'es-v2';
const RUNTIME = `${VERSION}-runtime`;
const MAX_RUNTIME_ENTRIES = 500; // map tiles and models are cached as they are used, capped here

const PRECACHE = [
  '/',
  '/offline.html',
  '/manifest.webmanifest',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/icon-maskable-512.png',
  '/assets/favicon.svg',
  '/book.html',
  '/book.js',
  '/styles.css',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(VERSION).then((cache) =>
      // addAll would fail the whole install if one file is missing, so add each one separately
      Promise.allSettled(PRECACHE.map((url) => cache.add(url)))
    ).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION && k !== RUNTIME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', (event) => {
  if (event.data === 'skipWaiting') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // Only cache GET requests from this site. Realtime, weather and other third-party calls go straight to the network.
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;
  // Video and audio range requests are not cacheable as whole files.
  if (req.headers.has('range')) return;

  if (req.mode === 'navigate') {
    event.respondWith(networkFirstPage(req));
    return;
  }
  event.respondWith(staleWhileRevalidate(req));
});

async function networkFirstPage(req) {
  const cache = await caches.open(RUNTIME);
  try {
    const res = await fetch(req);
    if (res.ok) cache.put(req, res.clone());
    return res;
  } catch {
    return (await cache.match(req))
      || (await caches.match(req))
      || (await caches.match('/offline.html'));
  }
}

async function staleWhileRevalidate(req) {
  const cache = await caches.open(RUNTIME);
  const cached = await cache.match(req) || await caches.match(req);
  const network = fetch(req).then((res) => {
    if (res.ok && res.type === 'basic') {
      cache.put(req, res.clone()).then(() => trim(cache));
    }
    return res;
  }).catch(() => null);
  if (cached) return cached;
  const res = await network;
  return res || Response.error();
}

async function trim(cache) {
  const keys = await cache.keys();
  if (keys.length <= MAX_RUNTIME_ENTRIES) return;
  await Promise.all(keys.slice(0, keys.length - MAX_RUNTIME_ENTRIES).map((k) => cache.delete(k)));
}

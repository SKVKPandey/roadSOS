/* service-worker.js - roadSOS PWA worker
 *
 * Strategy:
 *  - Precache the app shell on install (CSS, JS, icons, manifest, offline page).
 *  - HTML pages: network-first, fall back to cache, then to /offline.
 *  - /api/v1/regions/* : stale-while-revalidate. The whole MVP is built
 *      around cached region bundles; serving stale data while we refresh
 *      in the background is exactly what we want.
 *  - Other /api/* : network-only (geocode must be fresh, never cached).
 *  - Same-origin static assets + cross-origin (fonts, OSM): SWR.
 *
 * Bump CACHE_VERSION whenever shell assets change.
 */

const CACHE_VERSION = 'v2';
const SHELL_CACHE   = 'roadsos-shell-' + CACHE_VERSION;
const RUNTIME_CACHE = 'roadsos-runtime-' + CACHE_VERSION;
const REGION_CACHE  = 'roadsos-regions-' + CACHE_VERSION;

const SHELL_ASSETS = [
  '/',
  '/services',
  '/services/nearby',
  '/map',
  '/profile',
  '/offline',
  '/static/css/main.css',
  '/static/css/_tokens.css',
  '/static/css/_reset.css',
  '/static/css/_base.css',
  '/static/css/_utilities.css',
  '/static/css/components/button.css',
  '/static/js/main.js',
  '/static/js/core/api.js',
  '/static/js/core/state.js',
  '/static/js/core/idb.js',
  '/static/js/core/trauma-centers.js',
  '/static/js/core/medical-card.js',
  '/static/js/core/emergency-numbers.js',
  '/api/v1/emergency-numbers/all',
  '/static/manifest.webmanifest',
  '/static/icons/icon-192.png',
  '/static/icons/icon-512.png',
  '/static/icons/apple-touch-icon.png',
  '/static/icons/favicon.svg'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) =>
      Promise.all(
        SHELL_ASSETS.map((url) =>
          cache.add(new Request(url, { cache: 'reload' })).catch((err) => {
            console.warn('[SW] precache miss:', url, err && err.message);
          })
        )
      )
    ).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((k) => ![SHELL_CACHE, RUNTIME_CACHE, REGION_CACHE].includes(k))
          .map((k) => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // 1) Region lookups: stale-while-revalidate (separate cache bucket so we
  //    can purge it independently when TTLs need a hard reset).
  if (url.pathname.startsWith('/api/v1/regions/')) {
    event.respondWith(staleWhileRevalidate(req, REGION_CACHE));
    return;
  }

  // 2) Other API calls (geocode, future POSTs): never cache.
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(req).catch(() => new Response(
        JSON.stringify({ error: 'offline' }),
        { status: 503, headers: { 'Content-Type': 'application/json' } }
      ))
    );
    return;
  }

  // 3) Cross-origin assets (fonts, OSM tiles, etc.).
  if (url.origin !== self.location.origin) {
    event.respondWith(staleWhileRevalidate(req, RUNTIME_CACHE));
    return;
  }

  // 4) HTML navigation requests.
  if (req.mode === 'navigate' || (req.headers.get('accept') || '').includes('text/html')) {
    event.respondWith(networkFirst(req));
    return;
  }

  // 5) Same-origin static assets.
  event.respondWith(staleWhileRevalidate(req, RUNTIME_CACHE));
});

async function networkFirst(req) {
  try {
    const fresh = await fetch(req);
    if (fresh && fresh.ok) {
      const copy = fresh.clone();
      caches.open(RUNTIME_CACHE).then((c) => c.put(req, copy));
    }
    return fresh;
  } catch (e) {
    const cached = await caches.match(req);
    if (cached) return cached;
    const offline = await caches.match('/offline');
    if (offline) return offline;
    return new Response('Offline', { status: 503, headers: { 'Content-Type': 'text/plain' } });
  }
}

async function staleWhileRevalidate(req, cacheName) {
  const cache = await caches.open(cacheName || RUNTIME_CACHE);
  const cached = await cache.match(req);
  const networkPromise = fetch(req).then((resp) => {
    if (resp && resp.ok) cache.put(req, resp.clone());
    return resp;
  }).catch(() => null);
  return cached || networkPromise || new Response('', { status: 504 });
}

self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
  if (event.data === 'CLEAR_REGIONS') {
    caches.delete(REGION_CACHE);
  }
});

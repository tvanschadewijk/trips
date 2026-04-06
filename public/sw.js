// Our Trips — Service Worker
// Caches trip pages, assets, and images for offline viewing

const CACHE_VERSION = 'v1';
const STATIC_CACHE = `ourtrips-static-${CACHE_VERSION}`;
const TRIP_CACHE = `ourtrips-trips-${CACHE_VERSION}`;
const IMAGE_CACHE = `ourtrips-images-${CACHE_VERSION}`;
const FONT_CACHE = `ourtrips-fonts-${CACHE_VERSION}`;

// Max items per cache to prevent unbounded growth
const MAX_TRIP_ENTRIES = 50;
const MAX_IMAGE_ENTRIES = 200;

// Static assets to precache on install
const PRECACHE_URLS = [
  '/offline.html',
];

// ─── Install ─────────────────────────────────────────────────────────
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) => cache.addAll(PRECACHE_URLS))
  );
  // Activate immediately, don't wait for old SW to finish
  self.skipWaiting();
});

// ─── Activate ────────────────────────────────────────────────────────
self.addEventListener('activate', (event) => {
  // Clean up old caches from previous versions
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => {
            // Delete caches from old versions
            if (key.startsWith('ourtrips-') && !key.endsWith(CACHE_VERSION)) {
              return true;
            }
            return false;
          })
          .map((key) => caches.delete(key))
      )
    )
  );
  // Take control of all pages immediately
  self.clients.claim();
});

// ─── Fetch Strategy Router ──────────────────────────────────────────
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Only handle GET requests
  if (request.method !== 'GET') return;

  // Skip API routes (except trip page HTML), auth, and admin routes
  if (url.pathname.startsWith('/api/') ||
      url.pathname.startsWith('/auth/') ||
      url.pathname.startsWith('/login') ||
      url.pathname.startsWith('/connect') ||
      url.pathname.startsWith('/dashboard')) {
    return;
  }

  // Route to appropriate strategy
  if (isTripPage(url)) {
    event.respondWith(networkFirstWithCache(request, TRIP_CACHE, MAX_TRIP_ENTRIES));
  } else if (isImage(url)) {
    event.respondWith(cacheFirstWithNetwork(request, IMAGE_CACHE, MAX_IMAGE_ENTRIES));
  } else if (isFont(url)) {
    event.respondWith(cacheFirstWithNetwork(request, FONT_CACHE));
  } else if (isStaticAsset(url)) {
    event.respondWith(staleWhileRevalidate(request, STATIC_CACHE));
  } else if (isNavigationRequest(request)) {
    event.respondWith(networkFirstWithOfflineFallback(request));
  }
});

// ─── URL Matchers ───────────────────────────────────────────────────
function isTripPage(url) {
  return url.pathname.startsWith('/t/');
}

function isImage(url) {
  return (
    url.hostname === 'images.unsplash.com' ||
    url.pathname.match(/\.(jpg|jpeg|png|gif|webp|avif|svg)$/i)
  );
}

function isFont(url) {
  return (
    url.hostname === 'fonts.googleapis.com' ||
    url.hostname === 'fonts.gstatic.com'
  );
}

function isStaticAsset(url) {
  return (
    url.pathname.startsWith('/_next/static/') ||
    url.pathname.startsWith('/_next/image') ||
    url.pathname.match(/\.(js|css|woff2?|ttf|eot)$/i)
  );
}

function isNavigationRequest(request) {
  return request.mode === 'navigate';
}

// ─── Caching Strategies ─────────────────────────────────────────────

/**
 * Network-first: Try network, fall back to cache.
 * Best for trip pages — always show latest data but work offline.
 */
async function networkFirstWithCache(request, cacheName, maxEntries) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(cacheName);
      cache.put(request, response.clone());
      if (maxEntries) trimCache(cacheName, maxEntries);
    }
    return response;
  } catch {
    const cached = await caches.match(request);
    if (cached) return cached;
    // If this is a navigation request, show offline page
    if (request.mode === 'navigate') {
      return caches.match('/offline.html');
    }
    return new Response('Offline', { status: 503, statusText: 'Offline' });
  }
}

/**
 * Cache-first: Serve from cache, fetch in background to update.
 * Best for images and fonts — rarely change, expensive to re-download.
 */
async function cacheFirstWithNetwork(request, cacheName, maxEntries) {
  const cached = await caches.match(request);
  if (cached) return cached;

  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(cacheName);
      cache.put(request, response.clone());
      if (maxEntries) trimCache(cacheName, maxEntries);
    }
    return response;
  } catch {
    return new Response('', { status: 503 });
  }
}

/**
 * Stale-while-revalidate: Serve cached immediately, update in background.
 * Best for JS/CSS bundles — fast load + eventual freshness.
 */
async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);

  const fetchPromise = fetch(request)
    .then((response) => {
      if (response.ok) {
        cache.put(request, response.clone());
      }
      return response;
    })
    .catch(() => cached);

  return cached || fetchPromise;
}

/**
 * Network-first with offline fallback page.
 * For general navigation requests.
 */
async function networkFirstWithOfflineFallback(request) {
  try {
    return await fetch(request);
  } catch {
    const cached = await caches.match(request);
    if (cached) return cached;
    return caches.match('/offline.html');
  }
}

// ─── Cache Maintenance ──────────────────────────────────────────────
async function trimCache(cacheName, maxEntries) {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  if (keys.length > maxEntries) {
    // Delete oldest entries (FIFO)
    const toDelete = keys.slice(0, keys.length - maxEntries);
    await Promise.all(toDelete.map((key) => cache.delete(key)));
  }
}

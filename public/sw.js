// OurTrips — Service Worker
// Caches trip pages, assets, and images for offline viewing.
// v3: timeout-race for trip navigation, offline fallback for all navigations,
// editorial offline.html with a dynamic saved-trips list.

const CACHE_VERSION = 'v3';
const STATIC_CACHE = `ourtrips-static-${CACHE_VERSION}`;
const TRIP_CACHE = `ourtrips-trips-${CACHE_VERSION}`;
const TRIP_DATA_CACHE = `ourtrips-trip-data-${CACHE_VERSION}`;
const IMAGE_CACHE = `ourtrips-images-${CACHE_VERSION}`;
const FONT_CACHE = `ourtrips-fonts-${CACHE_VERSION}`;

const MAX_TRIP_ENTRIES = 50;
const MAX_IMAGE_ENTRIES = 200;
const NAV_TIMEOUT_MS = 2500;

const PRECACHE_URLS = ['/offline.html'];

// ─── Install ────────────────────────────────────────────────────────────
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) => cache.addAll(PRECACHE_URLS))
  );
  self.skipWaiting();
});

// ─── Activate ───────────────────────────────────────────────────────────
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key.startsWith('ourtrips-') && !key.endsWith(CACHE_VERSION))
          .map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

// ─── Message handler — used by the explicit download button ─────────────
self.addEventListener('message', (event) => {
  const data = event.data;
  if (!data || typeof data !== 'object') return;

  if (data.type === 'cache-trip-assets' && Array.isArray(data.urls)) {
    event.waitUntil(cacheAssets(data.urls).then((result) => {
      try { event.ports[0]?.postMessage(result); } catch {}
    }));
  } else if (data.type === 'remove-trip' && typeof data.shareId === 'string') {
    event.waitUntil(removeTrip(data.shareId).then(() => {
      try { event.ports[0]?.postMessage({ ok: true }); } catch {}
    }));
  } else if (data.type === 'list-cached-trips') {
    event.waitUntil(listCachedTrips().then((shareIds) => {
      try { event.ports[0]?.postMessage({ shareIds }); } catch {}
    }));
  }
});

async function cacheAssets(urls) {
  let ok = 0;
  let failed = 0;
  for (const url of urls) {
    try {
      const u = new URL(url, self.location.origin);
      let cacheName;
      if (u.pathname.startsWith('/api/trip-data/')) cacheName = TRIP_DATA_CACHE;
      else if (u.pathname.startsWith('/t/')) cacheName = TRIP_CACHE;
      else if (isImageUrl(u)) cacheName = IMAGE_CACHE;
      else if (isFontUrl(u)) cacheName = FONT_CACHE;
      else cacheName = STATIC_CACHE;
      const cache = await caches.open(cacheName);
      const response = await fetch(url, { credentials: 'same-origin' });
      if (response.ok || response.type === 'opaque') {
        await cache.put(url, response.clone());
        ok++;
      } else {
        failed++;
      }
    } catch {
      failed++;
    }
  }
  return { ok, failed };
}

async function removeTrip(shareId) {
  const tripCache = await caches.open(TRIP_CACHE);
  const dataCache = await caches.open(TRIP_DATA_CACHE);
  const tripKeys = await tripCache.keys();
  const dataKeys = await dataCache.keys();
  await Promise.all([
    ...tripKeys
      .filter((req) => new URL(req.url).pathname === `/t/${shareId}`)
      .map((req) => tripCache.delete(req)),
    ...dataKeys
      .filter((req) => new URL(req.url).pathname === `/api/trip-data/${shareId}`)
      .map((req) => dataCache.delete(req)),
  ]);
}

async function listCachedTrips() {
  const tripCache = await caches.open(TRIP_CACHE);
  const keys = await tripCache.keys();
  const ids = new Set();
  for (const req of keys) {
    const m = new URL(req.url).pathname.match(/^\/t\/([^/]+)$/);
    if (m) ids.add(m[1]);
  }
  return Array.from(ids);
}

// ─── Fetch Strategy Router ──────────────────────────────────────────────
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  if (request.method !== 'GET') return;

  // Navigations get our offline-aware behavior across the board.
  if (isNavigationRequest(request)) {
    if (isTripPage(url)) {
      event.respondWith(navigationNetworkFirstRaceCache(request, TRIP_CACHE, MAX_TRIP_ENTRIES));
    } else {
      event.respondWith(navigationNetworkFirstWithOfflineFallback(request));
    }
    return;
  }

  // For non-navigation: skip auth/admin/dashboard data (auth-scoped), let
  // them go to network. We don't want to serve cached PII to the wrong user.
  if (url.pathname.startsWith('/auth/') ||
      url.pathname.startsWith('/api/admin/') ||
      url.pathname.startsWith('/api/chat')) {
    return;
  }

  // Trip JSON data — networkFirst with cache for offline reads.
  if (url.pathname.startsWith('/api/trip-data/')) {
    event.respondWith(networkFirstData(request, TRIP_DATA_CACHE));
    return;
  }

  // Other API endpoints we don't manage.
  if (url.pathname.startsWith('/api/')) return;

  if (isImageUrl(url)) {
    event.respondWith(cacheFirstWithNetwork(request, IMAGE_CACHE, MAX_IMAGE_ENTRIES));
    return;
  }
  if (isFontUrl(url)) {
    event.respondWith(cacheFirstWithNetwork(request, FONT_CACHE));
    return;
  }
  if (isStaticAsset(url)) {
    event.respondWith(staleWhileRevalidate(request, STATIC_CACHE));
    return;
  }
});

// ─── URL Matchers ───────────────────────────────────────────────────────
function isTripPage(url) {
  return /^\/t\/[^/]+$/.test(url.pathname);
}

function isImageUrl(url) {
  return (
    url.hostname === 'images.unsplash.com' ||
    /\.(jpg|jpeg|png|gif|webp|avif|svg)$/i.test(url.pathname)
  );
}

function isFontUrl(url) {
  return (
    url.hostname === 'fonts.googleapis.com' ||
    url.hostname === 'fonts.gstatic.com'
  );
}

function isStaticAsset(url) {
  return (
    url.pathname.startsWith('/_next/static/') ||
    url.pathname.startsWith('/_next/image') ||
    /\.(js|css|woff2?|ttf|eot)$/i.test(url.pathname)
  );
}

function isNavigationRequest(request) {
  return request.mode === 'navigate';
}

// ─── Caching Strategies ─────────────────────────────────────────────────

/**
 * For trip page navigations: race the network against the cached HTML with
 * a hard timeout. If the network beats the timeout, return network and
 * update cache. If it doesn't, return cache immediately and let the
 * network update happen in the background. This is what fixes the
 * "stuck on Loading the page" symptom on slow connections.
 */
async function navigationNetworkFirstRaceCache(request, cacheName, maxEntries) {
  const cache = await caches.open(cacheName);
  const cachedPromise = cache.match(request);

  const networkPromise = fetch(request)
    .then((response) => {
      if (response && response.ok) {
        cache.put(request, response.clone());
        if (maxEntries) trimCache(cacheName, maxEntries);
      }
      return response;
    })
    .catch(() => null);

  const cached = await cachedPromise;

  if (cached) {
    // Race: network if it returns within timeout, otherwise cached. We don't
    // abort the network request — it keeps running and updates cache for next time.
    const timeoutPromise = new Promise((resolve) => setTimeout(() => resolve(null), NAV_TIMEOUT_MS));
    const winner = await Promise.race([networkPromise, timeoutPromise]);
    return (winner && winner.ok) ? winner : cached;
  }

  // No cache — must wait for network.
  const fresh = await networkPromise;
  if (fresh) return fresh;
  return caches.match('/offline.html');
}

/**
 * For non-trip navigations (dashboard, login, etc.): try network, fall
 * back to offline.html. Never serve cached HTML for these — they're
 * auth-scoped and we don't want a stale dashboard for a different user.
 */
async function navigationNetworkFirstWithOfflineFallback(request) {
  try {
    return await fetch(request);
  } catch {
    return caches.match('/offline.html');
  }
}

/**
 * Network-first for JSON data. Cache successes, fall back to cached on
 * failure. Used by /api/trips/* — the explicit Download button writes
 * here so a saved trip can rehydrate from local storage even if the
 * server is unreachable.
 */
async function networkFirstData(request, cacheName) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(cacheName);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = await caches.match(request);
    if (cached) return cached;
    return new Response(JSON.stringify({ error: 'offline' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

async function cacheFirstWithNetwork(request, cacheName, maxEntries) {
  const cached = await caches.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response.ok || response.type === 'opaque') {
      const cache = await caches.open(cacheName);
      cache.put(request, response.clone());
      if (maxEntries) trimCache(cacheName, maxEntries);
    }
    return response;
  } catch {
    return new Response('', { status: 503 });
  }
}

async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  const fetchPromise = fetch(request)
    .then((response) => {
      if (response.ok) cache.put(request, response.clone());
      return response;
    })
    .catch(() => cached);
  return cached || fetchPromise;
}

async function trimCache(cacheName, maxEntries) {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  if (keys.length > maxEntries) {
    const toDelete = keys.slice(0, keys.length - maxEntries);
    await Promise.all(toDelete.map((key) => cache.delete(key)));
  }
}

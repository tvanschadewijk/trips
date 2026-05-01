# Offline test plan — OurTrips

This document covers manual and automated testing for the offline experience landed across phases 1–5.

## Setup

1. Build and serve a production build:

   ```sh
   npm run build && npm run start
   ```

2. Open Chrome / Safari / Firefox at `http://localhost:3000`.
3. Sign in and open at least two trips while online so the service worker has cached HTML, JSON, hero images, and bundle assets.

DevTools panels you'll use:

- **Application → Service Workers** — confirm `sw.js` is `activated and is running`. Use **Update on reload** while developing.
- **Application → Cache Storage** — should show four `ourtrips-*-v3` caches.
- **Application → Local Storage → ourtrips:offline-manifest:v1** — list of explicitly downloaded trips.
- **Network → Throttling → Offline / Slow 3G** — for offline + slow simulations.

---

## Manual checklist

### A. Service worker lifecycle

- [ ] Cold install: clear site data → reload → SW registers, `STATIC_CACHE` contains `/offline.html`.
- [ ] Update: change `CACHE_VERSION` in `public/sw.js`, reload twice → old caches deleted on activate, new ones populated.
- [ ] Multi-tab: open two tabs, kill SW from devtools → next reload re-registers without errors.

### B. Caching while online

- [ ] Visit `/t/<shareId>` → `TRIP_CACHE` contains the HTML response.
- [ ] Visit `/t/<shareId>` → `TRIP_DATA_CACHE` contains `/api/trip-data/<shareId>` JSON (prewarm).
- [ ] Hero image (Unsplash) loads → present in `IMAGE_CACHE`.
- [ ] Visit 51 trips → `TRIP_CACHE` trims FIFO to 50.

### C. Offline trip viewing — happy path

- [ ] Visit `/t/<shareId>` while online → toggle Offline → reload `/t/<shareId>`. Cached HTML serves immediately. **Cover renders. Title + paper card + dates visible.** No spinner.
- [ ] Visit `/t/<shareId>` online → close tab → toggle Offline → open new tab → navigate to `/t/<shareId>`. Same expectation.
- [ ] **Slow 3G:** with Slow 3G throttling, reload `/t/<shareId>`. Cached version serves within 2.5 s; network update happens in the background.

### D. Offline trip viewing — sad paths

- [ ] Visit `/t/<never-seen>` while offline → `/offline.html` renders with the saved-trips list. Trip is *not* in the list.
- [ ] Click a saved trip from `/offline.html` → opens correctly.
- [ ] Empty manifest + offline → empty-state copy explains how to save.

### E. Explicit download

- [ ] Open trip online → tap download icon in nav top-right → button shows spinner, then check.
- [ ] `Cache Storage → ourtrips-images-v3` contains hero + day images.
- [ ] `localStorage.ourtrips:offline-manifest:v1` contains entry with `shareId`, name, savedAt.
- [ ] Tap check → confirm dialog → tap **Remove** → entry gone from manifest, `IMAGE_CACHE` and `TRIP_CACHE` for this trip cleared.
- [ ] Re-download after removal → works.

### F. Offline-aware navigation

- [ ] Dashboard online → all trips visible.
- [ ] Toggle Offline on dashboard → terracotta-wash banner appears, `Showing trips you've saved`. Only manifest trips render.
- [ ] Settings menu offline: **Sign out** disabled (greyed), **Analytics** hidden.
- [ ] Tap a saved-offline card while offline → trip opens.
- [ ] Tap a non-saved card while offline → wait, actually those are filtered out, so it shouldn't be tappable. Confirm.
- [ ] Tap logo/`/` on a trip while offline → routes to `/offline.html`, not stuck.
- [ ] `Edit with chat` panel hidden offline.

### G. Indicators & toasts

- [ ] Toggle online → offline → small terracotta toast appears at top: "You're offline — saved trips still work".
- [ ] Toggle offline → online → small black toast appears: "Back online".
- [ ] Toasts auto-dismiss within ~2.4 s.

### H. Status-bar / safe-area

- [ ] iPhone Safari (or DevTools "iPhone 14 Pro" emulation): the notch area is warm paper, continuous with the nav bar.
- [ ] No dark stripe above the nav.

### I. Cache invalidation

- [ ] Bump `CACHE_VERSION` and reload → old caches deleted, new ones populated.
- [ ] Trip mutated server-side → next online visit gets fresh HTML; cached version updated.

---

## Automated tests (Playwright)

The skeleton specs live under `tests/offline/`. To run them, install Playwright once:

```sh
npm install --save-dev @playwright/test
npx playwright install
```

Then:

```sh
npx playwright test
```

The specs use Playwright's `context.setOffline(true)` and route mocking to simulate offline / slow-network conditions. They're scaffolds — fill in real share IDs and login flow per your environment.

---

## Debug overlay

Append `?debug=offline` to any URL to mount a small fixed-position panel showing:

- `navigator.onLine` (live)
- Service worker controller status
- Number of entries in each `ourtrips-*` cache
- Number of trips in the offline manifest

The overlay is gated to the query param, never bundled or shipped to users who don't add it.

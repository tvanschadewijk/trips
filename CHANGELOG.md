# Changelog

All notable changes to OurTrips are documented here.

## [Unreleased] - 2026-05-18

### Added
- Desktop preview and trip media upgrades across the landing page, dashboard, demo flow, preview surfaces, trip image routes, and travel-skills assets (`a94f969`).
- A public itineraries catalogue and supporting explorer UI at [`src/app/itineraries/page.tsx`](/Users/thijsvanschadewijk/.codex/worktrees/6b10/Trips/src/app/itineraries/page.tsx) and [`src/components/itineraries/ItinerariesExplorer.tsx`](/Users/thijsvanschadewijk/.codex/worktrees/6b10/Trips/src/components/itineraries/ItinerariesExplorer.tsx) (`bd6fc9f`).

### Changed
- Improved universal trip cover prompting and added a labeled Scotland portrait cover for generated trip imagery (`e10d701`, `7f17dea`, `564e5fb`).
- Hid public catalogue trips from personal trip lists and clone flows to keep owner views separate from showcase content (`e846dc9`).
- Refined itineraries catalogue styling and restored page presentation after the initial rollout (`d9dc5b5`, `eca95a1`).

### Fixed
- Favicon build decoding in [`src/app/favicon.ico`](/Users/thijsvanschadewijk/.codex/worktrees/6b10/Trips/src/app/favicon.ico) and related trip-image prompt handling (`d8191b0`).
- Journal contrast in [`src/styles/blog.css`](/Users/thijsvanschadewijk/.codex/worktrees/6b10/Trips/src/styles/blog.css) (`89764df`).
- Public itinerary deployment pathing, images, and preview depth (`9e8b02d`, `78b602e`, `e87a830`).

## [0.1.0] - 2026-05-05

### Added
- App versioning driven from `package.json`, surfaced in the dashboard, and wired for release-please automation (`eb548dc`).
- Release workflows for conventional commits and automated release PR generation in [`.github/workflows/conventional-commits.yml`](/Users/thijsvanschadewijk/.codex/worktrees/6b10/Trips/.github/workflows/conventional-commits.yml) and [`.github/workflows/release-please.yml`](/Users/thijsvanschadewijk/.codex/worktrees/6b10/Trips/.github/workflows/release-please.yml) (`580be4b`).
- Rich trip detail cards, markdown-aware trip editing, and trip-chat improvements for hotel policy research, WebSearch, booking deeplinks, and owner-wide chat access (`cbbf113`, `61bc377`, `b2abbfe`, `4f56752`, `0f7e627`).

### Changed
- Reworked the in-trip "Ask your travel expert" entry point across cover, day slides, and panel layout for better vertical fit and clearer positioning (`17a76f8`, `b849368`, `0775747`, `6468ff3`, `ac8823d`, `7633a7f`, `a45f893`, `e4a9f94`).

### Fixed
- Production typecheck issues in trip chat and accommodation markdown sync notes (`ba6eae8`, `f9b2f2a`).

# Changelog

Selected product updates for OurTrips.

## Unreleased

## 2026-06-24 - 0.2.1 - Stripe setup automation

### Added
- Added an idempotent Stripe setup script for creating or reusing the OurTrips product, subscription prices, and webhook endpoint from a sandbox secret key.
- Documented the automated Stripe setup path and configurable billing amounts.

## 2026-06-23 - 0.2.0 - Stripe billing and early adopter plan

### Added
- Added Stripe Checkout, billing portal, and webhook routes for OurTrips subscriptions.
- Added a free-plan limit of three trips with server-side enforcement before new trip creation.
- Added a first-500 early adopter reservation flow for the three-year €29.95 founder deal.
- Added dashboard billing surfaces that show free-trip progress, early adopter availability, and upgrade options.
- Documented the monetization plan, Stripe setup, and subtle in-product promotion strategy.

## 2026-06-23 - 0.1.2 - Chat thread routing fix

### Fixed
- Fixed Ask Travel Agent replies so submitting from a visible conversation always continues that conversation, even if the trip preview context changes while the chat sheet is open.
- Prevented typed drafts and in-flight replies from being silently carried into a newly started chat thread.

## 2026-06-23 - 0.1.1 - Codex-managed release bumps

### Improved
- Replaced Release Please with a Codex-managed versioning flow that bumps `package.json`, `package-lock.json`, and `CHANGELOG.md` in the shipping commit.
- Added CI release guards so production-impacting changes must include an increased app version and a changelog entry before Cloudflare deploys from `main`.

## 2026-06-23 - Native trip creation and portable-guide messaging

### Added
- Repositioned the homepage around collecting messy travel information, planning with anticipation, and carrying a day-by-day guide on the road.
- Added new journal articles for the native OurTrips planning flow, day-by-day access, information collection, and the built-in travel agent.

### Improved
- Made in-app trip creation the primary story so travelers no longer need Claude, Cowork, Codex, or the connector to begin.
- Reframed the guide page so the connector is an optional external-agent path instead of the default setup.
- Updated journal metadata, article calls to action, and connector authorization copy to match the new product direction.

## 2026-06-18 — Cloudflare hardening and trip chat feedback

### Added
- Added visible trip chat progress states and centered the travel-agent entry point so chat feels clearer while responses are in flight.

### Improved
- Hardened the Cloudflare release path with cleaner Tailwind/PostCSS install behavior and build compatibility across the frontend and chat backend.
- Refined trip overview maps so flight-only home access legs stay hidden by default, with a full-journey toggle when those legs are available.

### Fixed
- Fixed OAuth-required agent flows so the product now tells travelers to reconnect or sign in instead of retrying connector calls indefinitely.
- Fixed chat input so pressing Enter submits messages reliably.
- Fixed cases where undefined trip notes could leak into trip previews.
- Fixed the post-release backend type mismatch in `src/lib/trip-service.ts` that broke the first chat-backend deploy after the Cloudflare hardening pass.

## 2026-06-16 — Agent knowledge routing and booking-intent fixes

### Added
- Added a routed agent knowledge system with filesystem-backed travel playbooks, tool-use context, and country-specific restaurant reservation guidance.

### Improved
- Improved trip chat so booked-hotel facts, restaurant research requests, reservation-channel requests, and date changes are tracked deterministically before the agent responds.

### Fixed
- Fixed booking-link behavior so OpenTable links only appear when support is directly verified for the exact venue.
- Fixed the Cloudflare production build so public Supabase and Google Maps configuration is available at build time, restoring the intended login experience.

## 2026-06-15 — Cloudflare production rollout

### Added
- Moved production deploys to Cloudflare with dedicated frontend and chat-backend GitHub Actions, OpenNext/Wrangler configuration, and build-time generated blog and changelog content.
- Added a trip logistics ledger and admin logistics view for auditing itinerary dates, nights, and route shape.

### Improved
- Required deeper cascade review after hotel changes that can shift the route base or downstream day planning.
- Tightened route-point contracts so trip maps use explicit `label`, `lat`, and `lng` data more consistently.
- Disabled Vercel Git deployments so Cloudflare is the only production release path.

### Fixed
- Fixed the Cloudflare home page runtime error by rendering `/` dynamically when request headers and cookies are needed.
- Fixed the first Cloudflare chat-backend deploy failure by typing shared fetch options for both Next.js and the Node backend.
- Fixed logistics-ledger metadata typing so the admin logistics UI renders typed values instead of unknown fields.

## 2026-05-29 — Map previews and accommodation review sync

### Added
- Added richer itinerary map previews so trip routes are easier to scan at a glance.

### Improved
- Reworked the trip overview so the map supports the story of the trip instead of overpowering it.
- Expanded accommodation review so saved stays and planning decisions feel more connected inside a trip.

### Fixed
- Fixed cases where shared trip pages could show out-of-date trip details right after an edit.
- Fixed a set of accommodation planning issues that could duplicate stays or lose booking status during updates.

### Improved
- Refined desktop trip previews, trip media handling, and generated cover prompts for richer trip presentation.
- Tightened the public itineraries experience with better imagery, layout polish, and cover framing updates.
- Improved the public journal’s readability with contrast fixes.

## 2026-05-18 — Desktop previews and trip media refresh

### Improved
- Brought richer desktop trip previews into the product experience, alongside upgraded trip media handling across the landing page, preview surfaces, and related trip flows.
- Improved generated trip cover prompts and crop safety so itinerary artwork lands more consistently.
- Refined the skill and travel-skills surfaces to better support companion travel tools alongside the core OurTrips flow.

### Fixed
- Resolved favicon build issues that could interfere with site assets.
- Cleaned up visual contrast issues in the journal.

## 2026-05-07 — Public itineraries gallery

### Added
- Launched a public itineraries gallery so visitors can browse example trips before creating their own.

### Improved
- Separated public showcase trips from personal trip lists so the gallery feels curated instead of mixed into private planning workflows.
- Refined the gallery’s styling, sample imagery, and trip overview depth for a more polished first impression.

### Fixed
- Corrected gallery deployment and image issues affecting the itineraries experience.

## 2026-05-03 — AI trip assistant and sharing upgrades

### Added
- Expanded the in-trip AI assistant with booking deeplinks for restaurants, hotels, flights, and activities.
- Added sharing controls that support cleaner trip remixing and safer public-trip cloning.

### Improved
- Upgraded the trip assistant UI across mobile and trip views, including a clearer “Ask your travel expert” entry point and better context-aware responses.
- Opened the assistant experience to all trip owners and improved markdown rendering in assistant replies.
- Improved hotel policy research support so trip planning conversations can capture more practical booking details.

## 2026-05-02 — Original plan sync

### Added
- Added an “Original plan” view that preserves the source markdown behind a trip.

### Improved
- Synced markdown edits between the OurTrips chat experience and the skill flow so the structured itinerary and the original planning source stay aligned.

## 2026-05-01 — Offline trip access

### Added
- Rolled out offline trip support, including saved trip access, a dedicated save-for-offline flow, offline-aware navigation, reconnect feedback, and an editorial offline landing experience.

### Improved
- Added supporting test coverage and debugging tools to harden the offline experience.

## 2026-04-27 — Editorial redesign

### Improved
- Reworked the trip experience into the editorial paper aesthetic that now defines OurTrips.
- Introduced richer per-trip social sharing images with trip-specific hero photography and metadata.
- Refined the dashboard, active-trip entry flow, cover layout, and hero treatment for a more cohesive editorial experience across the app.
- Clarified landing-page messaging around AI-assisted trip planning and improved the signed-in redirect flow into active trips.

## 2026-04-16 — Skill install flow cleanup

### Improved
- Simplified the skill installation and update messaging so people can install or refresh the OurTrips skill with clearer instructions and fewer dead ends.
- Tightened skill guidance around trusted domains and trip data completeness for more reliable trip creation.

## 2026-04-08 — Early product foundation

### Added
- Added admin analytics views with daily granularity for short-term usage trends.

### Improved
- Standardized the brand from “Our Trips” to “OurTrips” across the site.
- Improved trip detail-sheet legibility and early view-transition behavior.

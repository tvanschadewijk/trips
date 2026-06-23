# Our Trips

## Getting Started

Run the development server:

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

## Agentic Tools

OurTrips exposes two custom agent toolsets.

### `trip_editor` in-app chat tools

Trip-scoped MCP tools for the in-app chat agent. They are pinned to the current trip and let the agent read/edit itinerary data, manage accommodation review candidates, research place policies, and generate booking links.

- Reads and validation: `get_trip`, `get_date_ledger`, `get_logistics_audit`, `list_accommodations`, `list_accommodation_review`
- Trip edits: `update_trip`, `update_accommodation`, `update_accommodation_detail`
- Day item edits: `upsert_activity`, `delete_activity`, `upsert_meal`, `delete_meal`, `upsert_transport`, `delete_transport`
- Policy research: `research_place_policy`
- Accommodation reviewer: `create_accommodation_candidate`, `update_accommodation_candidate`, `move_accommodation_candidate`, `promote_accommodation_candidate`
- Booking links: `booking_link_restaurant`, `booking_link_hotel`, `booking_link_flight`, `booking_link_activity`

### `ourtrips` external MCP connector tools

OAuth-authenticated MCP tools for external agents working across a user's trips. They let agents create, edit, validate, image-populate, and verify OurTrips itineraries.

- Schema/help: `get_trip_schema`, `get_trip_template`
- Trip lifecycle: `save_trip`, `save_trip_v2`, `save_trip_v3`, `list_trips`, `get_trip`, `get_trip_logistics_ledger`, `validate_trip_contract`, `patch_trip`
- Accommodation reviewer: `list_accommodation_review`, `create_accommodation_candidate`, `update_accommodation_candidate`, `move_accommodation_candidate`, `promote_accommodation_candidate`, `replace_booked_accommodation_candidate`
- Focused edits: `upsert_meal`, `delete_meal`, `upsert_accommodation`, `delete_accommodation`, `replace_accommodation`, `upsert_transport`, `delete_transport`, `upsert_activity`, `delete_activity`
- Day edits: `replace_day_section`, `replace_day`, `delete_day`, `truncate_days_after`
- Markdown sync: `sync_markdown_source`, `update_from_markdown`
- Images/public QA: `search_trip_images`, `set_trip_image`, `get_trip_image_status`, `get_trip_image_prompts`, `save_trip_image_asset`, `verify_trip_public_data`

## Release Process

Work in feature branches and keep `main` as the production release branch. Cloudflare deploys from pushes to `main`; routine iteration should happen locally or against Cloudflare preview URLs before merging.

Before merging a release into `main`, update from the latest `main` and run the local release gate:

```bash
git switch main
git pull --ff-only
git switch -
npm run verify
npm run dev
```

Review the app locally at [http://localhost:3000](http://localhost:3000). After the release looks good, merge the checked branch into `main` once. That single merge triggers the Cloudflare deployment workflow.

## Versioning

Versions are managed directly in the commit that ships to `main`. Release Please is not used. The canonical app version lives in `package.json`, and `package-lock.json` must carry the same version.

Before every completed update that will be pushed to `main`, Codex must choose the bump, update the version, and add a dated changelog entry:

- `patch` for fixes, dependency updates, copy changes, styling, docs/process changes, and small UI polish.
- `minor` for new user-facing capabilities, meaningful workflow changes, or notable backend behavior changes.
- `major` only for breaking API, data, or user-contract changes.

Use `npm version <patch|minor|major> --no-git-tag-version` so `package.json` and `package-lock.json` stay in sync. Add a published `CHANGELOG.md` entry whose heading starts with the date and includes the new version, for example `## 2026-06-23 - 0.1.1 - Release workflow update`.

GitHub Actions runs `scripts/check-release-version.mjs` on pull requests and pushes to `main`. Production-impacting changes must include `package.json`, `package-lock.json`, and `CHANGELOG.md`; the package version must increase; and the changelog must mention the new version. The Cloudflare deploy workflows run the same check before deploying direct pushes to `main`.

Use Conventional Commit prefixes for commit subjects so the intended bump remains obvious:

- `fix:` for patch-sized changes.
- `feat:` for minor-sized changes.
- `feat!:` or `BREAKING CHANGE:` for major changes.
- `chore:`, `docs:`, `style:`, `refactor:`, `test:`, and `ci:` when they describe the work best; still bump the app version before pushing to `main`.

Example commits:

```bash
git commit -m "feat: add shared trip previews"
git commit -m "fix: keep itinerary cards within the viewport"
git commit -m "chore: update dependencies"
```

## Build

```bash
npm run build
```

## Cloudflare

The Cloudflare/OpenNext workflow is documented in
[docs/cloudflare-migration.md](docs/cloudflare-migration.md).

---
type: Reference
title: OurTrips Tool Use Context
description: The knowledge each OurTrips tool family needs before an agent uses it.
tags: [ourtrips, tools, mcp, trip-editor]
tools:
  - get_trip_schema
  - get_trip_template
  - save_trip
  - save_trip_v2
  - save_trip_v3
  - list_trips
  - get_trip
  - get_trip_logistics_ledger
  - validate_trip_contract
  - list_accommodation_review
  - create_accommodation_candidate
  - update_accommodation_candidate
  - move_accommodation_candidate
  - promote_accommodation_candidate
  - replace_booked_accommodation_candidate
  - patch_trip
  - upsert_meal
  - delete_meal
  - upsert_accommodation
  - delete_accommodation
  - replace_accommodation
  - upsert_transport
  - delete_transport
  - upsert_activity
  - delete_activity
  - replace_day_section
  - replace_day
  - delete_day
  - truncate_days_after
  - sync_markdown_source
  - update_from_markdown
  - search_trip_images
  - set_trip_image
  - get_trip_image_status
  - get_trip_image_prompts
  - save_trip_image_asset
  - verify_trip_public_data
  - booking_link_restaurant
  - booking_link_hotel
  - booking_link_flight
  - booking_link_activity
completion_checks:
  - selected_tool_matches_task_granularity
  - focused_edit_tools_used_before_full_trip_replacement_when_possible
  - final_verification_tool_used_before_claiming_a_complete_trip
timestamp: 2026-06-16T00:00:00Z
---

# Read Tools

Use `get_trip_schema` and `get_trip_template` when structure is uncertain.
Use `list_trips` only for account-level selection.

Use `get_trip` with the smallest useful view:

* `summary` for broad questions and planning.
* `day`, `days`, or `sections` for scoped edits.
* `full` with `allow_large: true` only when narrow reads cannot support the
  edit or markdown sync requires the full source.

Use `get_trip_logistics_ledger` before date, day-count, night, stay, or
route-shape reasoning. Use `validate_trip_contract` before saying a trip is
complete.

# Save And Structural Tools

Use `save_trip_v3` for new or substantially rewritten trips when exact dates,
sleeps, stays, or transport requirements matter. Use `save_trip_v2` only when
warnings without a hard logistics gate are intentional.

Use `patch_trip`, `replace_day_section`, `replace_day`, `delete_day`, and
`truncate_days_after` when the edit is structural. Revalidate logistics after
date, stay, or transport changes.

# Focused Day Item Tools

Use `upsert_meal` and `delete_meal` for meals and restaurants. One meal row is
one venue. Restaurant reservations belong in meals, not `trip.services`.

Use `upsert_accommodation`, `replace_accommodation`, and
`delete_accommodation` for public accommodation cards. Public accommodation is
single-choice: a booked/current stay or a placeholder such as "Hotel not
confirmed yet".

Use `upsert_transport` and `delete_transport` for atomic transport legs.
Booked or scheduled transport should include origin, destination, departure,
arrival when known, booking status, and practical detail fields.

Use `upsert_activity` and `delete_activity` for programme blocks such as
museums, walks, beaches, viewpoints, excursions, markets, and timed
activities.

# Accommodation Reviewer Tools

Use `list_accommodation_review` before hotel-search workflow questions.
Use `create_accommodation_candidate` once per hotel. New candidates need an
official direct website and checked review ratings.

Use `update_accommodation_candidate` for private comparison facts.
Use `move_accommodation_candidate`, `promote_accommodation_candidate`, or
`replace_booked_accommodation_candidate` only when the user confirms movement
or booking status. Booking promotion can change the trip base, so cascade
review surrounding days.

# Markdown Tools

Use `sync_markdown_source` and `update_from_markdown` for source-of-truth
alignment. If a trip has `markdown_source`, structural edits must keep the
structured itinerary and markdown in lockstep.

# Image Tools

Use `search_trip_images` and `set_trip_image` for real trip/day hero images.
Use `get_trip_image_prompts` and `save_trip_image_asset` for generated cover
and social assets. Use `get_trip_image_status` or `verify_trip_public_data`
before claiming image work is complete.

# Booking Link Tools

`booking_link_restaurant` is a link generator, not evidence. Verify the exact
venue first. Use direct verified links when possible; otherwise label Google
Maps search fallback as unverified.

`booking_link_hotel` returns a Booking.com search URL. It does not confirm
availability or booking status.

`booking_link_flight` returns a Google Flights search URL. It does not confirm
availability or fare.

`booking_link_activity` returns a GetYourGuide search URL. Prefer official
ticket pages when exact venue ticketing is the user goal.

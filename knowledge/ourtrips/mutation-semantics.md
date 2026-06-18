---
type: Playbook
title: OurTrips Mutation Semantics
description: How agents should choose merge, replace, markdown sync, and cascade review actions.
tags: [ourtrips, mutations, markdown-sync, cascade-review]
tools: [update_trip, patch_trip, replace_day_section, replace_day, replace_accommodation, update_accommodation, update_accommodation_detail]
completion_checks:
  - replacement_used_when_stale_nested_fields_must_disappear
  - markdown_source_synced_when_structural_edit_requires_it
  - cascade_review_completed_after_base_or_location_changes
timestamp: 2026-06-16T00:00:00Z
---

# Goal

Change the itinerary without leaving stale details, stale markdown, or broken
date/stay arithmetic behind.

# Merge Versus Replace

Merge is safe for additive or narrow object edits. Replace is required when
old nested fields should disappear.

Use replacement-style tools for:

* Hotel swaps.
* Day rewrites.
* Removed stops.
* Reordered days.
* Transport endpoint changes that invalidate route details.
* Any edit where old detail fields would become misleading if preserved.

# Markdown Sync

If `markdown_source` exists and the edit is structural, update the relevant
markdown section in the same operation. Preserve the existing headings, order,
and voice. Do not fabricate markdown for structured-only trips.

Narrow focused tools may maintain compact agent notes instead of rewriting the
whole markdown source.

# Cascade Review

Base changes can invalidate nearby itinerary logic. After accommodation,
transport endpoint, restaurant, or activity-location changes:

1. Read affected day(s) and the following day when requested by tool output.
2. Check stale hotel names, stale neighborhoods, impossible routing, stale meal
   or activity geography, stale tips, and stale map places.
3. Repair focused items before the final reply.
4. If the new base is not clear enough to repair safely, ask one focused
   question instead of claiming completion.

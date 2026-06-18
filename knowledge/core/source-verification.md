---
type: Playbook
title: Source Verification
description: Evidence standards for current real-world travel claims and booking-channel claims.
tags: [core, verification, research, sources]
intents: [research_request, restaurant_reservation_channel, restaurant_recommendation]
completion_checks:
  - current_real_world_claims_are_grounded_in_fresh_sources_or_labeled_uncertain
  - exact_venue_booking_support_is_verified_before_platform_claims
  - fallback_links_are_labeled_as_unverified_search_or_contact_paths
timestamp: 2026-06-16T00:00:00Z
---

# Goal

Avoid hallucinated availability, platform support, opening hours, policies, or
booking paths.

# Evidence Hierarchy

1. Official venue website, official reservation widget, or official social page.
2. Platform page for the exact venue.
3. Google Maps or Reserve with Google action for the exact venue.
4. Recent reputable editorial or directory source, only for discovery and
   cross-checking.
5. Phone or email fallback when no live online booking evidence is found.

# Rules

* A country-level platform list is a search strategy, not proof of support.
* A city-level OpenTable, TheFork, Zenchef, Resy, or Tock presence is not proof
  that a specific restaurant is listed.
* Only say a platform is supported when the exact restaurant page or exact
  reservation widget is verified.
* When no exact booking channel is verified, say so and offer official website,
  phone, email, or Google Maps search/contact fallback.
* Never invent availability, confirmation numbers, prices, booking policies, or
  payment status.

# Suggested Final Language

Use precise labels:

* "Verified direct reservation page"
* "Verified TheFork listing"
* "Unverified Google Maps reservation search"
* "No online booking channel verified; phone or email is the safer path"

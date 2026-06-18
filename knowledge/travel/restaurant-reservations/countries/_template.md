---
type: Template
title: Restaurant Reservation Platforms - Country Template
description: Template for adding country-specific restaurant reservation guidance.
tags: [travel, restaurants, reservations, template]
country: XX
coverage: stub
intents: [restaurant_reservation_channel]
tools: [booking_link_restaurant]
completion_checks:
  - exact_venue_page_verified_before_platform_claim
  - fallback_labeled_unverified_when_exact_channel_not_found
timestamp: 2026-06-16T00:00:00Z
---

# Search Strategy

Use this as a candidate list, not as proof of support.

| Channel | Priority | Notes |
|---|---|---|
| Official restaurant website | Highest | Prefer direct booking widgets or contact pages. |
| Reserve with Google | Fallback | Use only when the exact Google profile exposes booking. |
| Google Maps/phone/email | Fallback | Label search links as unverified. |

# Agent Notes

Add country-specific marketplace candidates only when they are researched and
include citations. Keep the rule that exact venue verification is required.

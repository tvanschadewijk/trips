---
type: Reference
title: Restaurant Reservation Platform Registry
description: Platform-level rules for restaurant reservation research.
tags: [travel, restaurants, reservations, platforms]
intents: [restaurant_reservation_channel]
tools: [booking_link_restaurant]
completion_checks:
  - platform_used_only_after_exact_venue_verification
  - platform_search_result_not_treated_as_booking_availability
timestamp: 2026-06-16T00:00:00Z
---

# Platform Rules

This registry gives candidate channels to check. It never proves that a
specific venue is supported.

| Platform | Use | Verification rule |
|---|---|---|
| Official restaurant website | First choice | Exact restaurant page or widget must expose reservation/contact path. |
| Reserve with Google | Useful fallback | Exact Google profile must expose a reservation action. |
| Google Maps search | Last online fallback | Always label as unverified search/contact fallback. |
| OpenTable | Market-dependent | Exact OpenTable restaurant page or source evidence required. |
| TheFork | Common in parts of Europe | Exact restaurant listing required. |
| Zenchef/Formitable/Resengo | Common restaurant-owned widgets in parts of Europe | Exact restaurant widget or venue page required. |
| Quandoo | Transitional in 2026 | Exact listing required and shutdown timing must be considered. |
| Resy | Limited outside selected markets | Exact Resy restaurant page required. |
| Tock | Limited outside selected markets | Exact Tock restaurant page required. |

# Channel Preference

1. Direct restaurant website or official widget.
2. Exact platform listing for the venue.
3. Reserve with Google for the venue.
4. Google Maps search/contact fallback.
5. Phone or email.

# Citations

[1] [TheFork](https://www.thefork.com/)
[2] [OpenTable](https://www.opentable.com/)
[3] [Zenchef](https://www.zenchef.com/)
[4] [Formitable by Zenchef](https://formitable.com/)
[5] [Reserve with Google](https://www.google.com/maps/reserve/)
[6] [Quandoo Germany closing notice](https://www.quandoo.de/en)

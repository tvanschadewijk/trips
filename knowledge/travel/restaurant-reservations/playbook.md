---
type: Playbook
title: Restaurant Reservations
description: How to find restaurants and verify realistic reservation channels.
tags: [travel, restaurants, reservations]
intents: [restaurant_recommendation, restaurant_reservation_channel, selected_restaurant]
tools:
  - upsert_meal
  - booking_link_restaurant
completion_checks:
  - restaurant_recommendation_or_shortlist_given
  - exact_reservation_channel_verified_or_marked_unverified
  - no_unsupported_platform_assumption
  - meal_updated_only_when_user_asked_to_save_or_add
timestamp: 2026-06-16T00:00:00Z
---

# Goal

Help the user choose a restaurant they can realistically reserve without
inventing platform support.

# Procedure

1. Identify day, city, country, date, party size, cuisine, budget, and hotel
   area when available.
2. Use current research when choosing venues or making availability/platform
   claims.
3. Recommend one clear fit when the user wants a decision; provide a concise
   shortlist when the choice is subjective.
4. For any booking link or platform claim, verify the exact restaurant on the
   exact channel.
5. Prefer verified direct reservation links from the restaurant. Then check
   country-relevant platforms. Then check Reserve with Google or Google Maps.
   Then fall back to phone/email.
6. Use `booking_link_restaurant` only after the venue and evidence state are
   resolved.
7. Add or update `days[].meals[]` only when the user asks to save, add, book,
   or attach the chosen restaurant to the trip.

# Rules

* One meal row is one restaurant, cafe, bakery, bar, or explicit food stop.
* Do not put several restaurant names into one meal name, note, or booking
  field.
* Do not create `trip.services` entries for restaurants.
* Do not infer OpenTable, TheFork, Zenchef, Resy, Tock, Quandoo, or any other
  platform from country, city, cuisine, or restaurant style alone.
* If the exact restaurant channel is not verified, say "unverified" and link
  to a search/contact fallback instead of naming a platform as supported.

# Booking Link Guidance

Use these labels:

* Verified direct reservation URL: safe to call "direct reservation".
* Verified exact platform listing: safe to name the platform.
* Google Maps search fallback: unverified.
* Phone/email fallback: unverified but practical.

# Example

For "Find us a nice restaurant that we can book in Novi Sad":

1. Research current Novi Sad restaurants.
2. Recommend the best fit.
3. Check official site, Google Maps, and country-relevant platforms.
4. If no exact online channel is verified, do not produce an OpenTable link.
5. Say that the online booking channel is unverified and suggest phone/email or
   the Google Maps search fallback.

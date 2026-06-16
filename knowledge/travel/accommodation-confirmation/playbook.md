---
type: Playbook
title: Accommodation Confirmation
description: How to handle user statements that a hotel or stay has been booked, reserved, or confirmed.
tags: [travel, accommodation, booking-status]
intents: [confirm_accommodation_booking]
tools:
  - list_accommodations
  - list_accommodation_review
  - promote_accommodation_candidate
  - move_accommodation_candidate
  - update_accommodation
completion_checks:
  - scoped_stay_read_before_write
  - matching_candidate_promoted_when_available
  - public_accommodation_status_and_booking_status_set_to_booked
  - cascade_review_followed_when_base_changes
timestamp: 2026-06-16T00:00:00Z
---

# Trigger

The user says a hotel, apartment, campsite, or stay is booked, reserved,
confirmed, selected, or no longer tentative.

# Procedure

1. Read the scoped day or accommodation list.
2. If the named stay exists as an accommodation-review candidate, promote it or
   move it to `booked`.
3. If no candidate matches, update the scoped public accommodation card.
4. Set both `status: "booked"` and `booking_status: "booked"`.
5. If the stay name or base changes, complete cascade review before replying.
6. Continue with any other intents in the same user turn.

# Rules

* Treat booked/reserved/confirmed as a committed fact, not a suggestion.
* Do not put several hotel options into one public accommodation card.
* Do not leave a "Hotel not confirmed yet" placeholder when the user has named
  the booked stay.
* Do not invent confirmation numbers or booking platforms.

# Example

User: "We booked Hotel Pupin in Novi Sad for this day. Find us dinner."

Expected course:

1. Mark the Day 7 Novi Sad stay as Hotel Pupin with booked status.
2. Then handle the restaurant request.
3. Final reply mentions both.

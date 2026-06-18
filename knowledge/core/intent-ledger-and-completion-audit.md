---
type: Playbook
title: Intent Ledger And Completion Audit
description: How agents should preserve multi-intent user requests and prove each item was handled.
tags: [core, intent-ledger, completion-audit]
intents: [confirm_accommodation_booking, restaurant_recommendation, restaurant_reservation_channel, selected_restaurant, date_change, research_request]
completion_checks:
  - every_detected_intent_is_completed_or_explicitly_blocked
  - earlier_committed_trip_facts_are_not_overwritten_by_later_research_requests
  - final_reply_mentions_each_completed_or_blocked_item_briefly
timestamp: 2026-06-16T00:00:00Z
---

# Goal

Keep a turn with several instructions from collapsing into only the most recent
or most conversational part of the request.

# Procedure

1. Treat every ledger item as a separate work item.
2. Complete committed trip facts first, especially booked hotels, selected
   transport, changed dates, or confirmed reservations.
3. Then handle research, recommendations, or optional follow-up questions.
4. Before the final reply, compare the ledger against the tools used and the
   answer drafted.
5. If an item could not be completed, state the blocker plainly.

# Rules

* Do not let a restaurant, activity, or research request distract from a hotel,
  date, transport, or booking-status update earlier in the same message.
* Do not treat "we booked", "we reserved", or "we confirmed" as background
  prose. Those are committed trip facts.
* Do not mark an item complete merely because it was mentioned in the reply.
  It is complete only when the appropriate tool action or explicit answer has
  happened.

# Final Reply Shape

The final reply can be short, but it should expose the audit:

* "Marked Hotel Pupin as booked for Day 7."
* "Found Sokace as the dinner pick."
* "I did not verify a direct booking platform, so I added an unverified Google
  Maps reservation search rather than an OpenTable link."

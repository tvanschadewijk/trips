---
okf_version: "0.1"
type: Knowledge Bundle
title: OurTrips Agent Knowledge
description: Task-routed playbooks and references for OurTrips agents.
tags: [ourtrips, agents, travel, playbooks]
timestamp: 2026-06-16T00:00:00Z
---

# OurTrips Agent Knowledge

This bundle stores the operational context an agent needs before using tools
or answering task-specific travel questions.

The bundle follows the Open Knowledge Format pattern: Markdown documents with
YAML frontmatter. Documents should describe how to proceed, what evidence is
required, and how completion should be checked. They are not directories of
restaurants, hotels, attractions, or other inventory.

# Core

* [Intent ledger and completion audit](core/intent-ledger-and-completion-audit.md) - How multi-intent turns are tracked through completion.
* [Source verification](core/source-verification.md) - Evidence standards for current real-world claims.

# OurTrips

* [Tool use context](ourtrips/tool-use-context.md) - Knowledge each OurTrips tool needs before use.
* [Mutation semantics](ourtrips/mutation-semantics.md) - Merge, replace, markdown sync, and cascade rules.

# Travel

* [Restaurant reservations](travel/restaurant-reservations/playbook.md) - How to find and verify bookable restaurants.
* [Restaurant platform registry](travel/restaurant-reservations/platform-registry.md) - Platform-level verification rules.
* [Accommodation confirmation](travel/accommodation-confirmation/playbook.md) - How to handle user-confirmed hotel bookings.

---
title: "What Is a Claude Skill? And Why OurTrips No Longer Needs One"
subtitle: "Claude skills and MCP connectors are useful agent tools, but OurTrips now creates trips directly inside the app."
excerpt: "A plain-English explanation of Claude skills, MCP connectors, and why the current OurTrips flow starts in the product instead of requiring an external agent."
tag: Technical
date: 2026-04-07
lastUpdated: 2026-06-23
readingTime: "5 min read"
---

A **Claude skill** is a portable instruction bundle that teaches Claude how to do a specific kind of work. It can include prompts, schemas, examples, and reference material so Claude can follow a workflow more consistently.

Skills are useful. MCP connectors are useful too. They let agents reach outside tools in a more structured way.

But for OurTrips, the product has moved beyond requiring either of them.

## What skills are good for

Skills help when a task has a repeatable format.

Instead of explaining the same workflow every time, you install a bundle once and Claude can follow the expected pattern. That can help with writing, analysis, formatting, coding workflows, or turning a messy input into a structured output.

Before skills and connectors, the alternative was usually a long prompt that you had to paste over and over.

## How MCP connectors are different

An MCP connector gives an agent access to live tools. Instead of only following instructions, the agent can call an external service, save data, fetch context, or update a record.

That is why OurTrips introduced a remote MCP connector. It let external agents save a trip into OurTrips through an OAuth-secured tool surface.

The connector URL is still:

```copy
https://ourtrips.to/mcp
```

If you are already planning in Claude, Codex, or another compatible agent, you can connect it and send the trip into OurTrips.

## Why OurTrips changed

The connector solved one problem: turning an outside planning conversation into a shareable itinerary.

But travel planning has a bigger problem. It starts messy.

Bookings, notes, ideas, PDFs, preferences, restaurant links, hotel options, and open decisions all need to be collected before the itinerary can become truly useful. If the product only appears at the end, too much context can be lost along the way.

So OurTrips now starts at the beginning.

## The current OurTrips flow

You can create a trip directly in OurTrips:

1. Answer the travel-agent basics
2. Add bookings, notes, references, and preferences
3. Let the built-in agent create a day-by-day draft
4. Refine the real itinerary through chat
5. Share it, map it, and save it offline

No Claude skill required. No Cowork setup required. No Codex setup required.

## When to use the connector

Use the connector if you already have useful travel work in an external agent and you want to bring it into OurTrips.

Start in OurTrips if you are beginning a new trip and want the product to collect the details, plan the route, and carry the guide from the start.

That is the important distinction. The connector is still a bridge. OurTrips is now the starting point.

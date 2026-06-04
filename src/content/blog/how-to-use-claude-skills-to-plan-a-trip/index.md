---
title: "How to Use the OurTrips Connector to Plan a Trip"
subtitle: "Turn any Claude conversation into a shareable, interactive travel itinerary in under a minute."
excerpt: "Connect the OurTrips remote MCP server to Claude or Codex, then turn any travel conversation into a beautiful, pocket-friendly itinerary you can share with anyone."
tag: Guide
date: 2026-04-05
lastUpdated: 2026-04-07
readingTime: "6 min read"
---

The **OurTrips connector** is a remote MCP server that turns any travel conversation into a shareable, mobile-friendly itinerary on [ourtrips.to](https://ourtrips.to). Connect it to Claude or Codex, plan your trip through conversation, and say "Send it to OurTrips" to get a link you can pull up on your phone or share with anyone.

We've all been there. You spend 20 minutes going back and forth with Claude about your trip to Portugal, and you end up with a genuinely solid itinerary. Great restaurants, realistic timing, good mix of activities. But then what? You copy-paste it into Apple Notes. Or a Google Doc. Or you just... leave it in the chat and hope you'll find it later.

That's the problem. The planning part is easy now. It's the *keeping and sharing* part that still sucks. **OurTrips.To fixes that with a remote connector.**

## What is the OurTrips connector?

The connector is a remote MCP server at:

```copy
https://ourtrips.to/mcp
```

It gives Claude or Codex a signed-in OurTrips tool surface. The connector handles saving trips, editing them later, schema guidance, image search, and generated cover assets without asking you to download a local skill file.

## Step 1: Install the OurTrips connector

In Claude, add the connector from **Customize** -> **Connectors** using this server URL:

```copy
https://ourtrips.to/mcp
```

In Codex, you can simply ask:

```copy
Install the connector to the MCP server: https://ourtrips.to/mcp
```

Then sign in when the authorization flow opens. That's it.

## Step 2: Plan your trip like you normally would

Nothing changes here. Just talk to Claude about your trip. Where you're going, how long, what you like, what you don't. The more specific you are, the better the result.

Something like:

> We're going to Tokyo for 5 days in May. Two of us. We're into street food, weird little record shops, and temples that aren't packed with tourists. Moderate budget - one fancy dinner, the rest casual. Staying in Shimokitazawa.

Claude does the rest. It'll suggest places, organize your days, figure out what makes sense geographically so you're not zigzagging across the city. You can go back and forth, swap things, ask it to add more food spots or cut an activity that doesn't fit.

A few things that actually make a difference:

- **Turn on browser use** (with the Claude Chrome extension) - Claude can look up current prices, and whether that hotel you want still has availability.

- **Use Extended Thinking** - the itineraries come out way more detailed and organized

- **Teach Claude how you travel** - "we walk everywhere" or "we need a break after lunch" changes the whole plan. I fed Claude 7 years of travel history so it knows what we do and like. 

  

## Step 3: Say "Send it to OurTrips"

That's literally it. When the itinerary looks good:

> Send it to OurTrips

Claude packages the whole thing up and sends it. You get a link back. Open it on your phone, your laptop, send it to whoever you're traveling with. No account needed to view it.

What you get:

- A day-by-day plan with times and descriptions
- Hotel info with check-in/out and booking details
- Transport - flights, trains, how to get between places
- Restaurant picks with notes on reservations
- Tips for each day
- A nice hero photo of the destination (assuming Unsplash has it covered, otherwise it might sometimes be another image)

It's 100% designed for mobile to be usable on the road.

## Why use OurTrips instead of Google Docs?

Sure, Google Docs exist. But a Google Doc is a wall of text on a white background. Try reading that on your phone while standing in Shibuya trying to figure out where lunch is.

OurTrips gives you something that's actually designed to be used while traveling. Days you can swipe through. Tap on a restaurant to see the details. Everything in one place, loads fast, works offline.

And the main thing - it takes one sentence to create. No formatting, no fiddling, no copy-pasting between apps.

## What about ChatGPT?

Right now, the connector works with agents that support remote MCP connectors, including Claude and Codex. ChatGPT support is something we're looking into.

## Try it

1. Add the OurTrips connector at `https://ourtrips.to/mcp`
2. Plan your trip
3. Say "Send it to OurTrips"
4. Open the link

Takes about a minute. Your next trip doesn't have to live in a chat thread.

---
title: "How to Use Claude Skills to Plan a Trip"
subtitle: "Turn any Claude conversation into a shareable, interactive travel itinerary in under a minute."
excerpt: "Claude skills are small files that give Claude new abilities. The Our Trips skill turns any travel conversation into a beautiful, pocket-friendly itinerary you can share with anyone."
tag: Guide
date: 2026-04-07
readingTime: "6 min read"
---

If you've ever planned a trip by chatting with Claude, you know the drill: you end up with a great itinerary buried in a conversation thread. Copying it into a doc, formatting it, making it shareable — that's the annoying part. **Claude skills fix this.**

A skill is a small file you add to Claude that teaches it a new capability. The **Our Trips skill** lets Claude take any travel conversation and turn it into a beautifully designed, interactive itinerary with a shareable link — complete with day-by-day plans, bookings, photos, and tips.

Here's how to set it up and use it, step by step.

## What is a Claude skill?

Think of a skill as a plugin for Claude. It's a file (ending in `.skill`) that you drop into a Claude CoWork session or Codex environment. Once installed, Claude gains new abilities — in this case, the ability to format your travel plans and send them to [ourtrips.to](https://ourtrips.to), where they become an interactive mobile-friendly itinerary.

Skills are part of Claude's agent ecosystem. They work in **Claude CoWork** (Anthropic's collaborative workspace) and **Codex** (the coding environment). If you've used MCP servers or custom instructions before, skills are the next evolution — they're portable, shareable, and purpose-built.

## Step 1: Install the Our Trips skill

You have two options, both take about 30 seconds.

### Option A: Ask Claude to fetch it (easiest)

If your CoWork session has internet access, just paste this into your chat:

```
Fetch https://ourtrips.to/our-trips.skill and add it to my skills.
```

Claude will download and install the skill automatically. Done.

### Option B: Upload it manually

1. **Download** the skill file from [ourtrips.to/our-trips.skill](https://ourtrips.to/our-trips.skill)
2. Open the **Customize** menu in your CoWork session
3. Find **Skills**, click **Add skill**, and select the file

That's it. The skill is now active for the rest of your session.

## Step 2: Plan your trip with Claude

Now just talk to Claude like you normally would. Tell it where you're going, how long you'll be there, what you're interested in, your budget — anything that helps shape the trip. For example:

> I'm planning a 5-day trip to Tokyo in May with my partner. We love street food, hidden temples, and vinyl record shops. Budget is moderate — we'll splurge on one nice dinner but keep the rest casual. We're staying in Shimokitazawa.

Claude will research, suggest activities, organize days, recommend restaurants, and build out a full itinerary through the conversation. This is the part you already know and love.

A few tips for better results:

- **Enable web search** so Claude can pull current opening hours, reviews, and prices
- **Turn on Extended Thinking** for more detailed, well-organized itineraries
- **Be specific** about your travel style — "we walk a lot" or "we need downtime after lunch" makes a huge difference
- **Iterate** — ask Claude to swap activities, adjust timing, or add backup options

## Step 3: Say "Send it to Our Trips"

When you're happy with the itinerary, just tell Claude:

> Send it to Our Trips

Claude will format your entire trip into a structured itinerary and send it to ourtrips.to. You'll get back a **shareable link** that you can open on any device.

The itinerary includes:

- **Day-by-day schedule** with timings and descriptions
- **Accommodation details** — check-in/out, booking platform, cancellation policy
- **Transport info** — flights, trains, walking directions
- **Restaurant picks** with reservation notes
- **Tips and notes** for each day
- **A hero image** that captures the destination

The result is a beautiful, mobile-optimized page you can pull up on your phone while traveling — no app download required.

## Why not just use a Google Doc?

You could. But here's what you'd miss:

- **Design.** Our Trips itineraries are designed for mobile. They look great in your pocket — not like a wall of text on a spreadsheet.
- **Shareability.** Send one link. Anyone can view it, no account needed.
- **Structure.** Days are navigable. Swipe between them. Tap for details on any activity, hotel, or flight.
- **Speed.** One sentence to Claude and it's done. No copying, no formatting, no fiddling.

## Does this work with ChatGPT?

Currently, the Our Trips skill is built for **Claude CoWork and Codex**. Support for ChatGPT (via Custom GPTs) is on the roadmap — the underlying API already supports it, so stay tuned.

If you're using Claude for trip planning already, this is the missing piece. Your conversations become real, shareable itineraries that actually work when you're on the ground.

## Get started in 30 seconds

Ready to try it? Here's the quick version:

1. Tell Claude: `Fetch https://ourtrips.to/our-trips.skill and add it to my skills.`
2. Plan your trip through conversation
3. Say **"Send it to Our Trips"**
4. Open your shareable link on any device

That's it. Your next trip is one conversation away.

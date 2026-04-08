---
title: "How to Use Claude Skills to Plan a Trip"
subtitle: "Turn any Claude conversation into a shareable, interactive travel itinerary in under a minute."
excerpt: "Claude skills are small files that give Claude new abilities. The Our Trips skill turns any travel conversation into a beautiful, pocket-friendly itinerary you can share with anyone."
tag: Guide
date: 2026-04-05
lastUpdated: 2026-04-07
readingTime: "6 min read"
---

The **Our Trips skill** is a Claude skill that turns any travel conversation into a shareable, mobile-friendly itinerary on [ourtrips.to](https://ourtrips.to). Install the skill, plan your trip through conversation, and say "Send it to Our Trips" to get a link you can pull up on your phone or share with anyone.

We've all been there. You spend 20 minutes going back and forth with Claude about your trip to Portugal, and you end up with a genuinely solid itinerary. Great restaurants, realistic timing, good mix of activities. But then what? You copy-paste it into Apple Notes. Or a Google Doc. Or you just... leave it in the chat and hope you'll find it later.

That's the problem. The planning part is easy now. It's the *keeping and sharing* part that still sucks. **OurTrips.To fixes that with a Claude Skill.**

## What is a Claude skill?

A skill is a file (ending in `.skill`) that you drop into Claude. It teaches Claude how to do something specific. In this case, the **Our Trips skill** teaches Claude how to take your travel conversation and turn it into a proper itinerary on [ourtrips.to](https://ourtrips.to) - with a link you can pull up on your phone.

Skills work in **Claude CoWork** and **Codex**.

## Step 1: Install the Our Trips skill

Two ways. Both take 30 seconds.

### The easy way

Paste this into your Claude Cowork or Codex chat:

```copy
Fetch https://ourtrips.to/our-trips.skill and add it to my skills.
```

Done. Claude grabs the file and installs it.

### The manual way

1. Download the skill file from [ourtrips.to/our-trips.skill](https://ourtrips.to/our-trips.skill)
2. Open **Customize** in your Cowork session
3. Go to **Skills**, hit **Add skill**, pick the file

Either way, it takes a few seconds and you're set for the rest of the session.

## Step 2: Plan your trip like you normally would

Nothing changes here. Just talk to Claude about your trip. Where you're going, how long, what you like, what you don't. The more specific you are, the better the result.

Something like:

> We're going to Tokyo for 5 days in May. Two of us. We're into street food, weird little record shops, and temples that aren't packed with tourists. Moderate budget - one fancy dinner, the rest casual. Staying in Shimokitazawa.

Claude does the rest. It'll suggest places, organize your days, figure out what makes sense geographically so you're not zigzagging across the city. You can go back and forth, swap things, ask it to add more food spots or cut an activity that doesn't fit.

A few things that actually make a difference:

- **Turn on browser use** (with the Claude Chrome extension) - Claude can look up current prices, and whether that hotel you want still has availability.

- **Use Extended Thinking** - the itineraries come out way more detailed and organized

- **Teach Claude how you travel** - "we walk everywhere" or "we need a break after lunch" changes the whole plan. I fed Claude 7 years of travel history so it knows what we do and like. 

  

## Step 3: Say "Send it to Our Trips"

That's literally it. When the itinerary looks good:

> Send it to Our Trips

Claude packages the whole thing up and sends it. You get a link back. Open it on your phone, your laptop, send it to whoever you're traveling with. No account needed to view it.

What you get:

- A day-by-day plan with times and descriptions
- Hotel info with check-in/out and booking details
- Transport - flights, trains, how to get between places
- Restaurant picks with notes on reservations
- Tips for each day
- A nice hero photo of the destination (assuming Unsplash has it covered, otherwise it might sometimes be another image)

It's 100% designed for mobile to be usable on the road.

## Why use Our Trips instead of Google Docs?

Sure, Google Docs exist. But a Google Doc is a wall of text on a white background. Try reading that on your phone while standing in Shibuya trying to figure out where lunch is.

Our Trips gives you something that's actually designed to be used while traveling. Days you can swipe through. Tap on a restaurant to see the details. Everything in one place, loads fast, works offline.

And the main thing - it takes one sentence to create. No formatting, no fiddling, no copy-pasting between apps.

## What about ChatGPT?

Right now, the skill only works with **Claude CoWork and Codex**. ChatGPT support (through Custom GPTs) is something we're looking into - the API can already handle it, it's just a matter of building the integration.

## Try it

1. Tell Claude: `Fetch https://ourtrips.to/our-trips.skill and add it to my skills.`
2. Plan your trip
3. Say "Send it to Our Trips"
4. Open the link

Takes about a minute. Your next trip doesn't have to live in a chat thread.

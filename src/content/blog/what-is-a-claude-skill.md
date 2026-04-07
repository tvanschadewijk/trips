---
title: "What is a Claude Skill? A Beginner's Guide"
subtitle: "Everything you need to know about Claude's skill system - what they are, how they work, and why they matter."
excerpt: "Claude skills are portable files that give Claude new abilities - from planning trips to generating reports. Here's how the skill ecosystem works and how to get started."
tag: Guide
date: 2026-04-07
lastUpdated: 2026-04-07
readingTime: "5 min read"
faq:
  - q: "Are Claude skills free?"
    a: "Most Claude skills are free. They're just files you install into your session. You do need access to Claude CoWork or Codex, which may require a Claude subscription."
  - q: "Do Claude skills work with ChatGPT?"
    a: "No. Claude skills (.skill files) only work with Claude CoWork and Codex. ChatGPT has its own extension system (Custom GPTs and plugins)."
  - q: "How do I install a Claude skill?"
    a: "Two ways: paste a fetch command like 'Fetch [URL] and add it to my skills' into your Claude chat, or manually upload the .skill file through the Customize panel in CoWork."
  - q: "What's the difference between a Claude skill and an MCP server?"
    a: "MCP servers provide live tool connections (like database access or API integrations). Skills are portable instruction files that bundle prompts, schemas, and API connections into a single shareable package. Skills are simpler to install and share."
  - q: "Can I build my own Claude skill?"
    a: "Yes. If you have a workflow you repeat often, you can package it as a .skill file with instructions, schemas, and API connections. Share it with anyone by sending them the file."
---

A **Claude skill** is a portable file (ending in `.skill`) that teaches Claude how to perform a specific task. Install one into your Claude session and Claude picks up a new ability - no prompting, no setup, no instructions to copy-paste every time. Skills work in Claude CoWork and Codex.

It's the difference between telling someone how to cook a recipe from scratch every time you want dinner, versus just handing them the cookbook.

## How are skills different from prompts or custom instructions?

Before skills existed, there were basically two ways to get Claude to do something specific:

**Prompts** - you write out exactly what you want every time. Works fine for one-off things, gets old fast when you need the same behavior repeatedly.

**Custom instructions** - you set some persistent context that Claude remembers across conversations. Better, but it's pretty limited. You can't include schemas, API calls, or complex logic.

**Skills** sit a level above both. A `.skill` file bundles instructions, data schemas, API connections, and reference docs into one package. Install it once, and Claude just knows what to do.

| Approach | Persistence | Complexity | Portability |
|----------|-------------|------------|-------------|
| Prompt | Per-conversation | Low | Copy-paste |
| Custom instructions | Persistent | Medium | Not shareable |
| **Skill** | **Per-session** | **High** | **A file you can share** |

## Where do Claude skills work?

Two places right now:

**Claude CoWork** - Anthropic's collaborative workspace. You chat with Claude, share files, work on stuff together. Skills plug right into your session.

**Codex** - the coding environment. Developers use skills here for things like deployment workflows, code patterns, or API integrations.

## What's inside a skill file?

A `.skill` file is a bundle. Depending on the skill, it might contain:

- **Instructions** - what Claude should do and how to do it
- **Schemas** - the shape of data Claude needs to produce
- **API connections** - endpoints Claude can hit to send or receive data
- **Reference docs** - examples and documentation Claude can lean on

Once installed, Claude reads all of it. You don't have to explain anything. Just ask Claude to do the thing, and it knows how.

## What kind of stuff can skills do?

The ecosystem is still early but growing fast. A few categories:

**Travel** - the [Our Trips skill](https://ourtrips.to) takes any travel conversation and turns it into a proper shareable itinerary. Plan your trip, say "send it to Our Trips," and you get a mobile-friendly page with your full day-by-day plan.

**Productivity** - skills that generate reports, format documents, create presentations. Instead of explaining the output format every single time, the skill just handles it.

**Development** - code generation with specific patterns, deployment pipelines, database migrations. The skill bakes in best practices so Claude follows them without being told.

**Data** - structured extraction, analysis workflows, formatted outputs for specific tools or dashboards.

## How to install a Claude skill

Takes 30 seconds. Two options:

### Just ask Claude to grab it

If your session has internet access:

```
Fetch https://ourtrips.to/our-trips.skill and add it to my skills.
```

Claude downloads it, installs it, done.

### Or upload it yourself

1. Download the `.skill` file
2. Open **Customize** in your CoWork session
3. Hit **Add skill**, pick the file

Active for the rest of your session.

## Where to find Claude skills

Still early days, but there are a few places:

- **Directly from creators** - lots of tools publish their own skills (like [Our Trips](https://ourtrips.to))
- **Directories** - [agentskills.so](https://agentskills.so) and [mcpmarket.com](https://mcpmarket.com) list available skills
- **GitHub** - developers share skills in repos and Claude communities
- **Build your own** - if you have a workflow you repeat often, you can package it as a skill

## Why Claude skills matter

The big deal with skills is that they lower the bar. You don't need to be good at prompt engineering to get good output from Claude. Someone else already did that work and packaged it into a file you can install.

A few things that follow from that:

- **Anyone can use them.** Non-technical people get access to complex workflows by dragging in a file.
- **Output is consistent.** The skill defines the format, so you get the same quality every time.
- **They're shareable.** Send the file to a friend. They get the exact same capability.
- **They stack.** Install multiple skills in one session and Claude can use all of them.

## Try one

Easiest way to get it is to just do it:

1. Open a Claude CoWork session
2. Tell Claude: `Fetch https://ourtrips.to/our-trips.skill and add it to my skills.`
3. Plan a trip
4. Say "Send it to Our Trips"
5. Open the link

You'll feel the difference right away. Claude stops being a chatbot and starts being a tool that makes something real.

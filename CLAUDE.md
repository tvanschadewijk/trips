@AGENTS.md

## Workflow

- After every change, automatically commit and push to `main`. Do not wait for the user to ask.

## Blog content structure

All blog posts live in `src/content/blog/`. Each post is a **folder** named after the slug, containing:

```
src/content/blog/<slug>/
  index.md    ← post content with frontmatter (title, subtitle, excerpt, tag, date, lastUpdated, readingTime)
  faq.md      ← FAQ items as ## headings (question) followed by answer text
```

### index.md frontmatter format

```yaml
---
title: "Post Title"
subtitle: "One-liner shown below the title."
excerpt: "Short description for cards and meta tags."
tag: Guide
date: 2026-04-07
lastUpdated: 2026-04-07
readingTime: "5 min read"
---
```

- Do NOT put FAQ data in frontmatter. It goes in the separate `faq.md` file.
- Use ````copy` as the language tag for code blocks that should get a copy button (e.g. skill install commands).

### faq.md format

```md
## Question text here?

Answer paragraph here.

## Another question?

Another answer.
```

- Each FAQ item is an `## ` heading (the question) followed by the answer as plain text.
- No frontmatter needed in faq.md.

### Adding a new post

1. Create `src/content/blog/<slug>/index.md` with frontmatter + markdown body.
2. Create `src/content/blog/<slug>/faq.md` with 3-5 relevant FAQ items.
3. The post is automatically picked up by `src/lib/blog/posts.ts` — no config or imports needed.

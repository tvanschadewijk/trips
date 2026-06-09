<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## Design

For all UI and design work, follow the design system in `DESIGN.md`. It defines the dark-mode-first visual language: colors, typography (Inter Variable with cv01/ss03), spacing, component styles, and depth/elevation rules.

## Local Dev Servers and Deploys

Prefer local verification over pushing to production. For UI work, finish with the local dev server running and the app open in a local browser for review. If the dev server cannot start, investigate it, restart or fix it when possible, and report the outcome.

Do not push routine changes to `main`. Push to `main` only when the user explicitly asks for a live release. Favor incidental releases over repeated production pushes during iteration.

After pushing live, always explicitly confirm that the commit was pushed to `main` and include the commit hash.

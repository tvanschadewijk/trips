<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## Design

For all UI and design work, follow the design system in `DESIGN.md`. It defines the dark-mode-first visual language: colors, typography (Inter Variable with cv01/ss03), spacing, component styles, and depth/elevation rules.

## Local Dev Servers and Deploys

Hard rule: do not start a local dev server, run local browser verification, or spend time on local preview checks unless the user explicitly asks for it in the current turn.

When asked to push changes live, push directly to `main` for review there. Verification should be limited to non-server checks unless the user explicitly requests local dev-server/browser testing.

After pushing live, always explicitly confirm that the commit was pushed to `main` and include the commit hash.

<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## Design

For all UI and design work, follow the design system in `DESIGN.md`. It defines the dark-mode-first visual language: colors, typography (Inter Variable with cv01/ss03), spacing, component styles, and depth/elevation rules.

## Local Dev Servers and Deploys

Prefer local verification before pushing when practical. For UI work, finish with the local dev server running and the app open in a local browser for review. If the dev server cannot start, investigate it, restart or fix it when possible, and report the outcome.

The app now deploys through Cloudflare. After each completed update, commit and push to `main` automatically unless the user explicitly asks not to, the work is incomplete, or verification reveals a blocking issue. Do not hold routine updates on feature branches just to avoid production deploys.

Before committing a completed update for `main`, bump the app version manually instead of using Release Please. Choose `patch` for fixes, dependency updates, copy, styling, docs/process work, and small UI polish; choose `minor` for new user-facing capabilities or meaningful workflow/backend behavior changes; choose `major` only for breaking API, data, or user-contract changes. Run `npm version <patch|minor|major> --no-git-tag-version`, add a dated `CHANGELOG.md` entry that includes the new version, and commit the version bump with the implementation.

After pushing, always explicitly confirm that the commit was pushed to `main` and include the commit hash.

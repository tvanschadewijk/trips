# Cloudflare Migration Runbook

This app deploys to Cloudflare Workers through OpenNext.
Routine iteration should use local preview and Cloudflare preview URLs, not
repeated production pushes to `main`.

## Local Verification

Use Node 22, then run:

```bash
npm run lint
npm run typecheck
npm run test
npm run cf:build
npx opennextjs-cloudflare preview
```

The preview server runs on `http://localhost:8787`. Local secrets are read from
`.dev.vars`, which is intentionally ignored. To refresh it from `.env.local`:

```bash
cp .env.local .dev.vars
printf '\nNEXTJS_ENV=development\n' >> .dev.vars
```

## Cloudflare Project

Worker config lives in `wrangler.jsonc`:

- Worker name: `our-trips`
- Current workers.dev URL: `https://our-trips.ourtrips.workers.dev`
- Worker entry: `.open-next/worker.js`
- Static assets: `.open-next/assets`
- Compatibility flag: `nodejs_compat`

Deployment command:

```bash
npm run cf:deploy
```

Production deploys from GitHub are handled by:

- `.github/workflows/cloudflare-deploy.yml`
  - Runs on every push to `main`.
  - Installs dependencies, lints, typechecks, tests, builds OpenNext, then runs
    `wrangler deploy` with the `ourtrips.to/*` and `www.ourtrips.to/*`
    routes.
- `.github/workflows/cloudflare-chat-backend-deploy.yml`
  - Runs on pushes to `main` only when `node-backend/`,
    `wrangler.chat-backend.jsonc`, or package dependency files change.
  - Builds a `linux/amd64` Docker image, pushes it to Cloudflare Containers,
    then deploys `ourtrips-chat-backend`.

GitHub needs a repository secret named `CLOUDFLARE_API_TOKEN`. The token should
be scoped to the `57c92cc47ff63b8d75f9e6477f92abda` Cloudflare account and
allow Workers/Workers Scripts, Workers Routes, Workers KV/assets, Containers,
and Zone read access for `ourtrips.to`.

## Environment Variables

Set these in Cloudflare before routing real traffic:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`
- `NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID`
- `SUPABASE_SERVICE_ROLE_KEY`
- `UNSPLASH_ACCESS_KEY`
- `OURTRIPS_NODE_BACKEND_ORIGIN`
- `OURTRIPS_CHAT_BACKEND_SECRET`

The `NEXT_PUBLIC_*` values are public client config. The service-role and
Unsplash keys should be Cloudflare secrets.

Current Cloudflare secrets set on `our-trips`:

- `SUPABASE_SERVICE_ROLE_KEY`
- `UNSPLASH_ACCESS_KEY`

Still needed before chat can work on Cloudflare:

- `OURTRIPS_NODE_BACKEND_ORIGIN`
- `OURTRIPS_CHAT_BACKEND_SECRET` once the backend is deployed with the same value

## Chat Backend

The in-app trip chat still needs a Node-compatible backend because the Claude
Agent SDK spawns a subprocess. Cloudflare Workers cannot run that directly.

For the Cloudflare worker, `/api/trips/[id]/chat` now proxies to
`OURTRIPS_NODE_BACKEND_ORIGIN`. The original Node route implementation is
preserved in `node-backend/trip-chat-route.ts` as the extraction source.

Dedicated backend target:

- Worker name: `ourtrips-chat-backend`
- Config: `wrangler.chat-backend.jsonc`
- Container image: `registry.cloudflare.com/57c92cc47ff63b8d75f9e6477f92abda/ourtrips-chat-backend:amd64`
- Worker wrapper: `node-backend/container-worker.ts`
- Expected URL: `https://ourtrips-chat-backend.ourtrips.workers.dev`

Short-term migration path:

1. Deploy the dedicated Node backend from `node-backend/`.
2. Point `OURTRIPS_NODE_BACKEND_ORIGIN` at that backend.
3. Set the same `OURTRIPS_CHAT_BACKEND_SECRET` on Cloudflare and the backend.
4. Verify the Cloudflare preview URL end to end.
5. Move the public domain only after chat and authenticated routes pass.

Cloudflare Containers require access to the Workers Paid plan. New image builds
must target `linux/amd64`; push them with `wrangler containers push` and update
the image reference in `wrangler.chat-backend.jsonc`.

Current backend deployment blockers on this machine/account:

- `ANTHROPIC_API_KEY` is not present in local `.env.local`, so a full chat turn
  will fail until the backend receives the production Anthropic key.

## Domain Cutover

Do not change DNS until the worker preview URL has been checked for:

- Home page and static assets
- Blog and changelog
- Login/auth callback flow
- Dashboard and trip list
- Public trip preview at `/t/[shareId]`
- Chat history, thread list, and a full chat turn through the Node backend
- OAuth well-known routes and MCP endpoints

Vercel Git deployments are disabled in `vercel.json`; production deploys now
come from the Cloudflare GitHub Actions workflows.

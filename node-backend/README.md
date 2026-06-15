# OurTrips Chat Backend

Dedicated Node service for `/api/trips/:id/chat`.

The Cloudflare frontend cannot run the Claude Agent SDK directly because the SDK
spawns a subprocess. This backend keeps that Node-only chat execution isolated
behind the same API path the frontend already calls.

## Local Run

```bash
npm run chat:backend:local
curl http://localhost:8788/healthz
```

The local script loads `.env.local`. Production hosts should set environment
variables directly.

## Required Environment

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`

Recommended for full agent turns:

- `ANTHROPIC_API_KEY`
- `TRIP_CHAT_MODEL`
- `CLAUDE_CODE_EXECUTABLE` if the SDK cannot auto-resolve the bundled binary

Optional security header:

- `OURTRIPS_CHAT_BACKEND_SECRET`

When `OURTRIPS_CHAT_BACKEND_SECRET` is set here and on the Cloudflare Worker,
the Worker forwards it as `x-ourtrips-chat-backend-secret` and direct public
requests to the backend are rejected.

## Routes

- `GET /healthz`
- `GET /api/trips/:id/chat`
- `POST /api/trips/:id/chat`

## Docker

Build from the repo root:

```bash
docker build -f node-backend/Dockerfile -t ourtrips-chat-backend .
docker run --env-file .env.local -p 8788:8788 ourtrips-chat-backend
```

## Cloudflare Containers

The dedicated Cloudflare backend is a separate Worker named
`ourtrips-chat-backend`, configured in `wrangler.chat-backend.jsonc`.

Deploy from the repo root:

```bash
npm run chat:backend:deploy
```

The current config points at the pushed Cloudflare Registry image:

```text
registry.cloudflare.com/57c92cc47ff63b8d75f9e6477f92abda/ourtrips-chat-backend:amd64
```

To publish a new container image, build for `linux/amd64` and push it with
`wrangler containers push`, then update `wrangler.chat-backend.jsonc`.
Cloudflare Containers require access to the Workers Paid plan.

Validate the Worker wrapper without building the container image:

```bash
npm run chat:backend:worker:dry-run
```

After deployment, point the frontend Worker at:

```bash
OURTRIPS_NODE_BACKEND_ORIGIN=https://ourtrips-chat-backend.ourtrips.workers.dev
```

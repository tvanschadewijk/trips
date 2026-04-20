-- Admin-only in-product chat for trip editing, powered by the Claude Agent SDK.
-- v1: admin-gated. Each API turn is a FRESH Agent SDK session; prior turns are
-- conveyed to the agent as a compact summary in the prompt string. This
-- sidesteps Vercel's ephemeral filesystem (the SDK's on-disk session store
-- doesn't survive between invocations) and avoids alpha-stage SDK APIs.
--
-- session_id here is captured from the SDK's init message for telemetry /
-- correlation only — it is NOT a rehydration key.

-- 1. Sessions: one row per (trip, admin) chat context.
create table public.trip_chat_sessions (
  id uuid default gen_random_uuid() primary key,
  trip_id uuid references public.trips(id) on delete cascade not null,
  user_id uuid references auth.users(id) on delete cascade not null,
  last_sdk_session_id text,               -- last SDK init session_id; telemetry only
  turn_count int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (trip_id, user_id)
);

create index trip_chat_sessions_trip_id_idx on public.trip_chat_sessions(trip_id);

-- 2. Messages: role='user' carries the raw user text; role='assistant' carries
-- the assistant's final text reply for that turn. tool_calls_json is a compact
-- per-turn summary of tool activity (names, inputs, success/failure), used
-- both for the UI "applied N edits" badge and for reconstructing prior-turn
-- context in the next turn's prompt string.
create table public.trip_chat_messages (
  id uuid default gen_random_uuid() primary key,
  session_id uuid references public.trip_chat_sessions(id) on delete cascade not null,
  trip_id uuid references public.trips(id) on delete cascade not null,
  user_id uuid references auth.users(id) on delete cascade not null,
  turn_index int not null,                -- 0-based; each user+assistant exchange
  role text not null check (role in ('user', 'assistant')),
  content text not null,                  -- plain text (user prompt or assistant reply)
  tool_calls_json jsonb,                  -- summary blob for assistant turns (nullable)
  created_at timestamptz not null default now()
);

create index trip_chat_messages_session_idx
  on public.trip_chat_messages(session_id, turn_index, role);
create index trip_chat_messages_trip_idx on public.trip_chat_messages(trip_id);

-- 3. Usage: one row per completed turn. Populated by the Stop hook for later
-- cost/volume analysis. Kept separate from messages so the hot read path
-- (recent messages for UI) stays cheap.
create table public.trip_chat_usage (
  id uuid default gen_random_uuid() primary key,
  session_id uuid references public.trip_chat_sessions(id) on delete cascade not null,
  trip_id uuid references public.trips(id) on delete cascade not null,
  user_id uuid references auth.users(id) on delete cascade not null,
  turn_index int not null,
  model text,
  input_tokens int,
  output_tokens int,
  cache_creation_input_tokens int,
  cache_read_input_tokens int,
  total_cost_usd numeric(10, 6),
  duration_ms int,
  num_tool_calls int,
  created_at timestamptz not null default now()
);

create index trip_chat_usage_trip_idx on public.trip_chat_usage(trip_id);
create index trip_chat_usage_session_idx on public.trip_chat_usage(session_id);

-- 4. RLS: admin-only surface for v1. All reads/writes happen via the service-
-- role admin client in the API route (which has already verified the caller
-- is an admin), so we enable RLS on the tables and add no policies for
-- anon/authenticated — service role bypasses RLS. If this opens beyond
-- admins in v2, add policies here scoped to user_id = auth.uid().
alter table public.trip_chat_sessions enable row level security;
alter table public.trip_chat_messages enable row level security;
alter table public.trip_chat_usage enable row level security;

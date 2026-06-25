-- Immutable trip edit snapshots for recovery.
--
-- Chat/tool writes are intentionally powerful: they can reshape structured
-- itinerary JSON. Every successful chat-originated edit should leave a
-- before/after snapshot so recovery does not depend on browser caches,
-- service-worker state, or manually reconstructed markdown.

create table if not exists public.trip_edit_revisions (
  id uuid default gen_random_uuid() primary key,
  trip_id uuid references public.trips(id) on delete cascade not null,
  user_id uuid references auth.users(id) on delete cascade not null,
  session_id uuid references public.trip_chat_sessions(id) on delete set null,
  turn_index int,
  source text not null default 'trip_chat',
  tool text not null,
  input_keys text[] not null default '{}',
  input_json jsonb,
  before_data jsonb not null,
  after_data jsonb not null,
  created_at timestamptz not null default now()
);

create index if not exists trip_edit_revisions_trip_created_idx
  on public.trip_edit_revisions(trip_id, created_at desc);

create index if not exists trip_edit_revisions_session_turn_idx
  on public.trip_edit_revisions(session_id, turn_index, created_at);

alter table public.trip_edit_revisions enable row level security;

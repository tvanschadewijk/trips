-- Per-turn progress events for long-running in-product trip chat turns.
-- The chat POST returns quickly and the client polls for the final assistant
-- row. These events let the same poll surface truthful intermediate work:
-- reading itinerary data, checking logistics, researching sources, saving
-- edits, and handling errors after partial success.

create table if not exists public.trip_chat_progress_events (
  id uuid default gen_random_uuid() primary key,
  session_id uuid references public.trip_chat_sessions(id) on delete cascade not null,
  trip_id uuid references public.trips(id) on delete cascade not null,
  user_id uuid references auth.users(id) on delete cascade not null,
  turn_index int not null,
  stage text not null check (
    stage in (
      'queued',
      'starting',
      'thinking',
      'reading',
      'checking',
      'researching',
      'editing',
      'booking',
      'reviewing',
      'writing',
      'done',
      'error'
    )
  ),
  message text not null,
  created_at timestamptz not null default now()
);

create index if not exists trip_chat_progress_events_session_turn_idx
  on public.trip_chat_progress_events(session_id, turn_index, created_at);

create index if not exists trip_chat_progress_events_trip_idx
  on public.trip_chat_progress_events(trip_id, created_at desc);

alter table public.trip_chat_progress_events enable row level security;

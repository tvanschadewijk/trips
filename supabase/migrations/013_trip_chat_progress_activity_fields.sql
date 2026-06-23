-- Structured activity metadata for trip chat progress events.
--
-- `stage` and `message` remain the compatibility contract. These nullable
-- fields let the UI render richer, honest activity such as "Searching the web
-- for..." or "Saving De Kas on Day 3" without parsing prose.

alter table public.trip_chat_progress_events
  add column if not exists action text,
  add column if not exists object_type text,
  add column if not exists object_label text,
  add column if not exists source text,
  add column if not exists source_label text,
  add column if not exists event_status text,
  add column if not exists confidence text;

alter table public.trip_chat_progress_events
  drop constraint if exists trip_chat_progress_events_event_status_check;

alter table public.trip_chat_progress_events
  add constraint trip_chat_progress_events_event_status_check
  check (
    event_status is null
    or event_status in ('active', 'completed', 'blocked', 'error')
  );

alter table public.trip_chat_progress_events
  drop constraint if exists trip_chat_progress_events_confidence_check;

alter table public.trip_chat_progress_events
  add constraint trip_chat_progress_events_confidence_check
  check (
    confidence is null
    or confidence in ('observed', 'inferred')
  );

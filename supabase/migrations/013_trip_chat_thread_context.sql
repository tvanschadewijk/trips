-- Persist the itinerary/view scope a chat thread belongs to so opening the
-- travel agent from a different day starts in the right conversation instead
-- of inheriting the latest thread for the whole trip.

alter table public.trip_chat_sessions
  add column if not exists context_key text,
  add column if not exists context_label text;

create index if not exists trip_chat_sessions_trip_user_context_updated_idx
  on public.trip_chat_sessions (trip_id, user_id, context_key, updated_at desc);

-- Chat threads. A "thread" is a trip_chat_sessions row; until now the table
-- was capped at one session per (trip, user) and the conversation grew
-- forever. v2 allows many threads per (trip, user), each with its own derived
-- topic title, ChatGPT-style. Old rows simply become the first thread —
-- their title is backfilled lazily from the first user message on read.

alter table public.trip_chat_sessions
  add column if not exists title text;

-- One session per (trip, user) is no longer the model.
alter table public.trip_chat_sessions
  drop constraint if exists trip_chat_sessions_trip_id_user_id_key;

-- Thread lists are read newest-first per (trip, user).
create index if not exists trip_chat_sessions_trip_user_updated_idx
  on public.trip_chat_sessions (trip_id, user_id, updated_at desc);

-- Truthful failure telemetry: the chat route now records WHY a turn failed
-- (e.g. "Invalid API key") instead of only writing a generic fallback
-- message into the transcript. Advisory only; never user-facing as-is.
alter table public.trip_chat_usage
  add column if not exists error_detail text;

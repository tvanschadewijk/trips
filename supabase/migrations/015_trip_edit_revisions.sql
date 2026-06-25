-- Immutable trip edit snapshots and soft-delete protection.
--
-- Trip rows should be recoverable even when the product UI "deletes" a trip
-- or an automated edit reshapes the itinerary JSON. Product deletes mark the
-- row as deleted, and every trip mutation records the previous version before
-- the write is attempted.

alter table public.trips
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by uuid references auth.users(id) on delete set null;

create index if not exists trips_user_active_updated_idx
  on public.trips(user_id, updated_at desc)
  where deleted_at is null;

create index if not exists trips_share_active_idx
  on public.trips(share_id)
  where deleted_at is null;

create table if not exists public.trip_edit_revisions (
  id uuid default gen_random_uuid() primary key,
  trip_id uuid references public.trips(id) on delete cascade not null,
  user_id uuid references auth.users(id) on delete cascade not null,
  session_id uuid references public.trip_chat_sessions(id) on delete set null,
  turn_index int,
  source text not null default 'trip_chat',
  action text not null default 'update',
  tool text not null,
  changed_paths text[] not null default '{}',
  input_keys text[] not null default '{}',
  input_json jsonb,
  before_data jsonb not null,
  after_data jsonb not null,
  before_record jsonb,
  after_record jsonb,
  created_at timestamptz not null default now()
);

alter table public.trip_edit_revisions
  add column if not exists action text not null default 'update',
  add column if not exists changed_paths text[] not null default '{}',
  add column if not exists before_record jsonb,
  add column if not exists after_record jsonb;

create index if not exists trip_edit_revisions_trip_created_idx
  on public.trip_edit_revisions(trip_id, created_at desc);

create index if not exists trip_edit_revisions_session_turn_idx
  on public.trip_edit_revisions(session_id, turn_index, created_at);

alter table public.trip_edit_revisions enable row level security;

-- Replace the old broad "for all" owner policy. Service-role API routes still
-- bypass RLS, but browser/authenticated clients cannot hard-delete trips.
drop policy if exists "Users can manage own trips" on public.trips;

drop policy if exists "Users can read own trips" on public.trips;
create policy "Users can read own trips"
  on public.trips for select
  using (auth.uid() = user_id and deleted_at is null);

drop policy if exists "Users can insert own trips" on public.trips;
create policy "Users can insert own trips"
  on public.trips for insert
  with check (auth.uid() = user_id);

drop policy if exists "Users can update own active trips" on public.trips;
create policy "Users can update own active trips"
  on public.trips for update
  using (auth.uid() = user_id and deleted_at is null)
  with check (auth.uid() = user_id);

drop policy if exists "Shared trips are viewable" on public.trips;
create policy "Shared trips are viewable"
  on public.trips for select
  using (deleted_at is null and share_mode in ('companion', 'remix'));

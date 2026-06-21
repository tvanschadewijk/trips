-- Travel profiles and in-app trip generation.
-- ShipNow uses travel_profiles and trip_generation_sessions.
-- Later phases use travel_profile_sources plus the private storage bucket for
-- uploaded previous trips and AI-built reference documents.

create table if not exists public.travel_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  preferences jsonb not null default '{}'::jsonb,
  reference_markdown text not null default '',
  reference_generated_at timestamptz,
  onboarding_completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.travel_profiles enable row level security;

drop policy if exists "Users can read own travel profile" on public.travel_profiles;
create policy "Users can read own travel profile"
  on public.travel_profiles for select
  using (auth.uid() = user_id);

drop policy if exists "Users can insert own travel profile" on public.travel_profiles;
create policy "Users can insert own travel profile"
  on public.travel_profiles for insert
  with check (auth.uid() = user_id);

drop policy if exists "Users can update own travel profile" on public.travel_profiles;
create policy "Users can update own travel profile"
  on public.travel_profiles for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create table if not exists public.travel_profile_sources (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users(id) on delete cascade not null,
  source_kind text not null default 'upload'
    check (source_kind in ('upload', 'paste', 'import')),
  file_name text,
  content_type text,
  storage_path text,
  extracted_text text,
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'ready', 'failed')),
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists travel_profile_sources_user_idx
  on public.travel_profile_sources (user_id, created_at desc);

alter table public.travel_profile_sources enable row level security;

drop policy if exists "Users can manage own travel profile sources" on public.travel_profile_sources;
create policy "Users can manage own travel profile sources"
  on public.travel_profile_sources for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create table if not exists public.trip_generation_sessions (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users(id) on delete cascade not null,
  trip_id uuid references public.trips(id) on delete set null,
  chat_thread_id uuid references public.trip_chat_sessions(id) on delete set null,
  turn_index int,
  brief jsonb not null default '{}'::jsonb,
  status text not null default 'draft'
    check (status in ('draft', 'queued', 'running', 'completed', 'failed')),
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists trip_generation_sessions_user_idx
  on public.trip_generation_sessions (user_id, created_at desc);

create index if not exists trip_generation_sessions_trip_idx
  on public.trip_generation_sessions (trip_id);

alter table public.trip_generation_sessions enable row level security;

drop policy if exists "Users can manage own trip generation sessions" on public.trip_generation_sessions;
create policy "Users can manage own trip generation sessions"
  on public.trip_generation_sessions for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'travel-profile-sources',
  'travel-profile-sources',
  false,
  10485760,
  array[
    'text/plain',
    'text/markdown',
    'application/json',
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ]
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- nanoid function for short share IDs
create or replace function nanoid(size int default 10)
returns text as $$
declare
  id text := '';
  i int := 0;
  chars text := 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
begin
  while i < size loop
    id := id || substr(chars, (random() * length(chars))::int + 1, 1);
    i := i + 1;
  end loop;
  return id;
end;
$$ language plpgsql;

-- Trips table
create table public.trips (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users(id) not null,
  share_id text unique not null default nanoid(10),
  name text not null,
  data jsonb not null,
  is_public boolean default true,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Indexes
create index trips_user_id_idx on public.trips(user_id);
create index trips_share_id_idx on public.trips(share_id);

-- Row Level Security
alter table public.trips enable row level security;

create policy "Users can manage own trips"
  on public.trips for all
  using (auth.uid() = user_id);

create policy "Public trips are viewable"
  on public.trips for select
  using (is_public = true);

-- API keys table
create table public.api_keys (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users(id) not null,
  key_hash text not null,
  name text default 'default',
  created_at timestamptz default now(),
  last_used_at timestamptz
);

alter table public.api_keys enable row level security;

create policy "Users can manage own API keys"
  on public.api_keys for all
  using (auth.uid() = user_id);

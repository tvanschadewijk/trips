-- Create profiles table with role support
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  role text not null default 'user' check (role in ('user', 'admin')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Enable RLS
alter table public.profiles enable row level security;

-- Users can read their own profile
create policy "Users can read own profile"
  on public.profiles for select
  using (auth.uid() = id);

-- Only service role can insert/update profiles (no user self-promotion)
-- Admin client (service role) bypasses RLS, so no insert/update policies needed for regular users

-- Auto-create a profile when a new user signs up
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, role)
  values (new.id, 'user')
  on conflict (id) do nothing;
  return new;
end;
$$ language plpgsql security definer;

-- Trigger on auth.users insert
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Backfill profiles for all existing users
insert into public.profiles (id, role)
select id, 'user' from auth.users
on conflict (id) do nothing;

-- Assign admin role to the owner (update email below)
update public.profiles
set role = 'admin', updated_at = now()
where id = (select id from auth.users where email = 'thijs@vanschadewijk.com');

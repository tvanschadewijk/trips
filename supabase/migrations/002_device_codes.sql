-- Device authorization codes for CLI/skill authentication
create table public.device_codes (
  id uuid default gen_random_uuid() primary key,
  device_code text unique not null,
  user_id uuid references auth.users(id),
  api_key_plain text,
  status text not null default 'pending',
  created_at timestamptz default now(),
  expires_at timestamptz default (now() + interval '10 minutes')
);

create index device_codes_device_code_idx on public.device_codes(device_code);

-- RLS enabled with no policies = no browser/anon access (admin client only)
alter table public.device_codes enable row level security;

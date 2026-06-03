-- OAuth 2.1 storage for the OurTrips remote MCP connector.
-- All tokens/codes/secrets are stored as SHA-256 hashes only.

create table public.oauth_clients (
  id uuid default gen_random_uuid() primary key,
  client_id text unique not null,
  client_secret_hash text,
  client_secret_expires_at timestamptz,
  client_name text,
  redirect_uris text[] not null default '{}',
  token_endpoint_auth_method text not null default 'client_secret_post'
    check (token_endpoint_auth_method in ('none', 'client_secret_post', 'client_secret_basic')),
  scopes text[] not null default array['trips:write'],
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  expires_at timestamptz
);

create index oauth_clients_client_id_idx on public.oauth_clients(client_id);

create table public.oauth_authorization_codes (
  id uuid default gen_random_uuid() primary key,
  code_hash text unique not null,
  client_id text not null references public.oauth_clients(client_id) on delete cascade,
  user_id uuid references auth.users(id) on delete cascade not null,
  redirect_uri text not null,
  code_challenge text not null,
  scopes text[] not null default array['trips:write'],
  resource text,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  consumed_at timestamptz
);

create index oauth_authorization_codes_client_idx
  on public.oauth_authorization_codes(client_id);
create index oauth_authorization_codes_expires_idx
  on public.oauth_authorization_codes(expires_at);

create table public.oauth_tokens (
  id uuid default gen_random_uuid() primary key,
  token_hash text unique not null,
  token_type text not null check (token_type in ('access', 'refresh')),
  client_id text not null references public.oauth_clients(client_id) on delete cascade,
  user_id uuid references auth.users(id) on delete cascade not null,
  scopes text[] not null default array['trips:write'],
  resource text,
  parent_refresh_token_id uuid references public.oauth_tokens(id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  last_used_at timestamptz
);

create index oauth_tokens_hash_idx on public.oauth_tokens(token_hash);
create index oauth_tokens_client_user_idx on public.oauth_tokens(client_id, user_id);
create index oauth_tokens_expires_idx on public.oauth_tokens(expires_at);

alter table public.oauth_clients enable row level security;
alter table public.oauth_authorization_codes enable row level security;
alter table public.oauth_tokens enable row level security;

-- Stripe billing, freemium trip limits, and early adopter reservations.

alter table public.profiles
  add column if not exists stripe_customer_id text,
  add column if not exists stripe_subscription_id text,
  add column if not exists billing_plan text not null default 'free',
  add column if not exists billing_status text not null default 'free',
  add column if not exists billing_price_id text,
  add column if not exists billing_current_period_end timestamptz,
  add column if not exists billing_cancel_at_period_end boolean not null default false,
  add column if not exists billing_updated_at timestamptz,
  add column if not exists early_adopter_claim_number integer,
  add column if not exists early_adopter_expires_at timestamptz;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'profiles_billing_plan_check'
  ) then
    alter table public.profiles
      add constraint profiles_billing_plan_check
      check (billing_plan in ('free', 'pro', 'early_adopter'));
  end if;
end;
$$;

create unique index if not exists profiles_stripe_customer_id_idx
  on public.profiles(stripe_customer_id)
  where stripe_customer_id is not null;

create unique index if not exists profiles_stripe_subscription_id_idx
  on public.profiles(stripe_subscription_id)
  where stripe_subscription_id is not null;

create unique index if not exists profiles_early_adopter_claim_number_idx
  on public.profiles(early_adopter_claim_number)
  where early_adopter_claim_number is not null;

create table if not exists public.billing_early_adopter_reservations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  reservation_number integer not null check (reservation_number between 1 and 500),
  stripe_checkout_session_id text,
  stripe_subscription_id text,
  stripe_customer_id text,
  status text not null default 'reserved' check (status in ('reserved', 'paid', 'released')),
  expires_at timestamptz not null,
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists billing_early_adopter_reservations_user_id_idx
  on public.billing_early_adopter_reservations(user_id);

create unique index if not exists billing_early_adopter_active_user_idx
  on public.billing_early_adopter_reservations(user_id)
  where status in ('reserved', 'paid');

create unique index if not exists billing_early_adopter_active_number_idx
  on public.billing_early_adopter_reservations(reservation_number)
  where status in ('reserved', 'paid');

create unique index if not exists billing_early_adopter_checkout_session_idx
  on public.billing_early_adopter_reservations(stripe_checkout_session_id)
  where stripe_checkout_session_id is not null;

create unique index if not exists billing_early_adopter_subscription_idx
  on public.billing_early_adopter_reservations(stripe_subscription_id)
  where stripe_subscription_id is not null;

alter table public.billing_early_adopter_reservations enable row level security;

drop policy if exists "Users can read own early adopter reservations"
  on public.billing_early_adopter_reservations;

create policy "Users can read own early adopter reservations"
  on public.billing_early_adopter_reservations for select
  using (auth.uid() = user_id);

create or replace function public.reserve_early_adopter_deal(
  p_user_id uuid,
  p_expires_at timestamptz
)
returns table (
  reservation_id uuid,
  reservation_number integer,
  claimed_count integer,
  remaining_count integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing public.billing_early_adopter_reservations%rowtype;
  v_next_number integer;
  v_claimed integer;
begin
  perform pg_advisory_xact_lock(hashtext('ourtrips_early_adopter_deal'));

  update public.billing_early_adopter_reservations
  set status = 'released',
      updated_at = now()
  where status = 'reserved'
    and expires_at <= now();

  select *
  into v_existing
  from public.billing_early_adopter_reservations
  where user_id = p_user_id
    and status in ('reserved', 'paid')
  order by (status = 'paid') desc, created_at desc
  limit 1;

  if found then
    select count(*)::integer
    into v_claimed
    from public.billing_early_adopter_reservations
    where status in ('reserved', 'paid');

    return query
    select
      v_existing.id,
      v_existing.reservation_number,
      v_claimed,
      greatest(0, 500 - v_claimed);
    return;
  end if;

  select count(*)::integer
  into v_claimed
  from public.billing_early_adopter_reservations
  where status in ('reserved', 'paid');

  if v_claimed >= 500 then
    raise exception 'early_adopter_sold_out' using errcode = 'P0001';
  end if;

  select slot
  into v_next_number
  from generate_series(1, 500) as slot
  where not exists (
    select 1
    from public.billing_early_adopter_reservations reservations
    where reservations.reservation_number = slot
      and reservations.status in ('reserved', 'paid')
  )
  order by slot
  limit 1;

  if v_next_number is null then
    raise exception 'early_adopter_sold_out' using errcode = 'P0001';
  end if;

  insert into public.billing_early_adopter_reservations (
    user_id,
    reservation_number,
    expires_at
  )
  values (
    p_user_id,
    v_next_number,
    p_expires_at
  )
  returning *
  into v_existing;

  v_claimed := v_claimed + 1;

  return query
  select
    v_existing.id,
    v_existing.reservation_number,
    v_claimed,
    greatest(0, 500 - v_claimed);
end;
$$;

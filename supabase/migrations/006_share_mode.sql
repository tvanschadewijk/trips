-- 006: replace is_public with share_mode
--
-- share_mode collapses the prior boolean + the new "remix" intent into a
-- single field with three values:
--   private   — link returns 404 (was is_public = false)
--   companion — link works, full data including PII (was is_public = true)
--   remix     — link works, viewer sees PII-scrubbed view + a "Remix" CTA
--
-- Migration policy: existing rows preserve current behavior.
--   is_public = true  -> share_mode = 'companion'
--   is_public = false -> share_mode = 'private'

alter table public.trips
  add column share_mode text;

update public.trips
set share_mode = case when is_public then 'companion' else 'private' end;

alter table public.trips
  alter column share_mode set not null,
  alter column share_mode set default 'companion',
  add constraint trips_share_mode_check
    check (share_mode in ('private', 'companion', 'remix'));

-- Replace the RLS policy that depended on is_public.
drop policy if exists "Public trips are viewable" on public.trips;

create policy "Shared trips are viewable"
  on public.trips for select
  using (share_mode in ('companion', 'remix'));

alter table public.trips
  drop column is_public;

create index trips_share_mode_idx on public.trips(share_mode);

-- Private per-trip accommodation review workspace.
--
-- The public/companion itinerary stays in public.trips.data. Messy hotel
-- comparison state, reviewer lanes, candidate links, feedback loops, and
-- booking events live here and are accessed only through owner/admin API
-- routes that use the service-role client.
create table public.trip_accommodation_reviews (
  trip_id uuid primary key references public.trips(id) on delete cascade,
  data jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index trip_accommodation_reviews_updated_at_idx
  on public.trip_accommodation_reviews(updated_at desc);

alter table public.trip_accommodation_reviews enable row level security;

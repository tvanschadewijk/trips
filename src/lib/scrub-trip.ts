/**
 * Strip personally-identifying information from a trip body so it's safe
 * to expose to non-owners in remix mode.
 *
 * Approach: WHITELIST the fields that are safe for inspiration. Anything
 * not explicitly carried over is dropped. This is safer than blocklisting
 * because new fields added later default to private.
 *
 * What survives:
 *   - High-level travel narrative: name, subtitle, summary, dates, hero
 *     images, day titles/subtitles/descriptions, programme blocks, tips,
 *     stats, accent color
 *   - The names of accommodations and meals (the actual inspiration value
 *     — viewer can search the same hotel/restaurant)
 *   - Transport mode/from/to/route (so viewer knows "they took a train
 *     Paris→Lyon"); detail blob is dropped
 *
 * What's dropped or cleared:
 *   - All booking refs, confirmations, seat assignments, gate/terminal
 *   - All addresses, phone numbers, reservation IDs
 *   - Wifi passwords, parking notes, cancellation deadlines
 *   - Status fields (so the viewer doesn't see "booked" badges)
 *   - travelers (real names)
 *   - markdown_source (uncontrolled freeform — strip entirely; owner can
 *     publish a sanitized version later if we add that feature)
 */
import type {
  TripData,
  TripMeta,
  TripImageAsset,
  TripImageAssets,
  Day,
  Transport,
  Accommodation,
  Meal,
  Service,
  TripNote,
} from './types';
import { normalizeTripData } from './trip-data-normalize';

function scrubService(svc: Service): Service {
  // Drop ref (often a confirmation code) and status; keep the rest.
  const { ref: _ref, status: _status, ...rest } = svc;
  return rest;
}

function scrubNote(note: TripNote): TripNote {
  // Keep the content — notes are usually editorial. If owners stash
  // booking codes here that's their call; we strip status and other
  // ambient PII via the broader scrub.
  return { title: note.title, icon: note.icon, content: note.content };
}

function scrubTransport(t: Transport): Transport {
  return {
    mode: t.mode,
    label: t.label,
    from: t.from,
    to: t.to,
    depart: t.depart,
    arrive: t.arrive,
    duration: t.duration,
    distance: t.distance,
    // status: cleared
    // detail: dropped entirely (booking_ref, seat, flight, gate, terminal,
    // check_in, cancellation_policy, charging_stops, border crossings)
  };
}

function scrubAccommodation(a: Accommodation): Accommodation {
  return {
    name: a.name,
    rating: a.rating,
    nights: a.nights,
    note: a.note,
    // price: kept — useful for inspiration
    price: a.price,
    // status: cleared
    // detail: dropped (confirmation, address, phone, check_in/out, wifi,
    // parking, cancellation_deadline)
  };
}

function scrubMeal(m: Meal): Meal {
  // Keep cuisine + price_range from detail; drop everything else.
  const safeDetail = m.detail
    ? {
        cuisine: m.detail.cuisine,
        price_range: m.detail.price_range,
        hours: m.detail.hours,
      }
    : undefined;
  return {
    type: m.type,
    name: m.name,
    note: m.note,
    // status: cleared
    detail: safeDetail,
  };
}

function scrubImageAsset(asset: TripImageAsset): TripImageAsset {
  return {
    url: asset.url,
    aspect_ratio: asset.aspect_ratio,
    width: asset.width,
    height: asset.height,
    provider: asset.provider,
    model: asset.model,
    source: asset.source,
    generated_at: asset.generated_at,
    // prompt intentionally dropped: it can contain richer source-trip detail
    // than remix viewers should receive.
  };
}

function scrubImageAssets(assets?: TripImageAssets): TripImageAssets | undefined {
  if (!assets) return undefined;
  return Object.fromEntries(
    Object.entries(assets)
      .filter(([, asset]) => !!asset?.url)
      .map(([key, asset]) => [key, scrubImageAsset(asset!)])
  ) as TripImageAssets;
}

function scrubTripMeta(meta: TripMeta): TripMeta {
  return {
    name: meta.name,
    subtitle: meta.subtitle,
    dates: meta.dates,
    travelers: [], // PII — drop names
    summary: meta.summary,
    hero_image: meta.hero_image,
    overview_image: meta.overview_image,
    image_assets: scrubImageAssets(meta.image_assets),
    route_points: meta.route_points,
    accent_color: meta.accent_color,
    services: meta.services?.map(scrubService),
    notes: meta.notes?.map(scrubNote),
  };
}

function scrubDay(day: Day): Day {
  return {
    day_number: day.day_number,
    date: day.date,
    title: day.title,
    subtitle: day.subtitle,
    description_title: day.description_title,
    description: day.description,
    hero_image: day.hero_image,
    stats: day.stats,
    blocks: day.blocks,
    transport: day.transport?.map(scrubTransport),
    accommodation: day.accommodation ? scrubAccommodation(day.accommodation) : day.accommodation,
    meals: day.meals?.map(scrubMeal),
    tips: day.tips,
  };
}

/**
 * Whitelist scrub of a full trip body. Idempotent.
 */
export function scrubTripData(data: TripData): TripData {
  const normalized = normalizeTripData(data);

  return {
    trip: scrubTripMeta(normalized.trip),
    days: normalized.days.map(scrubDay),
    // markdown_source dropped entirely
  };
}

/**
 * Re-anchor a scrubbed trip's dates so they begin today and cascade
 * day-by-day. Used by clone so the cloner doesn't inherit the original's
 * calendar.
 */
export function anchorTripToToday(data: TripData): TripData {
  const normalized = normalizeTripData(data);
  const today = new Date();
  today.setHours(12, 0, 0, 0);
  const fmt = (d: Date) => d.toISOString().slice(0, 10);

  const dayCount = normalized.days.length || 1;
  const start = today;
  const end = new Date(today.getTime());
  end.setDate(end.getDate() + Math.max(0, dayCount - 1));

  const rebasedDays = normalized.days.map((day, idx) => {
    const d = new Date(start.getTime());
    d.setDate(d.getDate() + idx);
    return { ...day, date: fmt(d), day_number: idx + 1 };
  });

  return {
    ...normalized,
    trip: {
      ...normalized.trip,
      dates: { start: fmt(start), end: fmt(end) },
    },
    days: rebasedDays,
  };
}

/**
 * Convenience: scrub + re-anchor in one call. Used when cloning so the
 * cloner gets a fresh, depersonalized starting point dated today.
 */
export function scrubAndAnchorTripData(data: TripData): TripData {
  return anchorTripToToday(scrubTripData(data));
}

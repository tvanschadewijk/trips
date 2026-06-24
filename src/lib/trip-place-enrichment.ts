import type { Accommodation, AccommodationDetail, ItineraryPlace, Meal, TripData } from './types';

type GooglePlacesLocation = {
  latitude?: number;
  longitude?: number;
};

type GoogleTextSearchPlace = {
  id?: string;
  formattedAddress?: string;
  location?: GooglePlacesLocation;
  types?: string[];
};

type PlaceLookupRecord = {
  lat?: number;
  lng?: number;
  google_maps_url?: string;
  place_id?: string;
  map_lookup_status?: string;
  map_lookup_at?: string;
  map_lookup_query?: string;
  address?: string;
};

type EnrichmentTarget = {
  label: string;
  query: string;
  includedType?: 'lodging' | 'restaurant' | 'tourist_attraction';
  record: PlaceLookupRecord;
};

type LookupResult =
  | { status: 'resolved'; place: GoogleTextSearchPlace }
  | { status: 'not_found' }
  | { status: 'error'; error: string };

export type TripPlaceEnrichmentSummary = {
  status: 'skipped' | 'completed';
  reason?: 'missing_api_key' | 'no_targets';
  attempted: number;
  enriched: number;
  notFound: number;
  errors: number;
};

const GOOGLE_TEXT_SEARCH_URL = 'https://places.googleapis.com/v1/places:searchText';
const GOOGLE_TEXT_SEARCH_FIELD_MASK = 'places.id,places.formattedAddress,places.location,places.types';
const DEFAULT_ENRICHMENT_LIMIT = 20;
const AREA_TYPES = new Set([
  'administrative_area_level_1',
  'administrative_area_level_2',
  'administrative_area_level_3',
  'country',
  'locality',
  'neighborhood',
  'political',
  'postal_code',
  'route',
]);

function serverApiKey(): string | undefined {
  const key = process.env.GOOGLE_MAPS_SERVER_API_KEY?.trim();
  return key || undefined;
}

function enrichmentLimit(input?: number): number {
  if (typeof input === 'number' && Number.isFinite(input)) {
    return Math.max(0, Math.floor(input));
  }

  const configured = Number(process.env.TRIP_PLACE_ENRICHMENT_LIMIT);
  return Number.isFinite(configured) ? Math.max(0, Math.floor(configured)) : DEFAULT_ENRICHMENT_LIMIT;
}

function hasCoordinates(record: PlaceLookupRecord | undefined): boolean {
  return (
    typeof record?.lat === 'number' &&
    Number.isFinite(record.lat) &&
    typeof record.lng === 'number' &&
    Number.isFinite(record.lng)
  );
}

function compact(parts: Array<string | undefined | null>): string[] {
  const seen = new Set<string>();
  const values: string[] = [];
  for (const part of parts) {
    const normalized = part?.trim();
    if (!normalized) continue;
    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    values.push(normalized);
  }
  return values;
}

function buildQuery(parts: Array<string | undefined | null>): string {
  return compact(parts).join(' ').replace(/\s+/g, ' ').slice(0, 220);
}

function mapsUrlFor(label: string, placeId: string): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(label)}&query_place_id=${encodeURIComponent(placeId)}`;
}

function alreadyTried(record: PlaceLookupRecord, query: string): boolean {
  return record.map_lookup_status === 'not_found' && record.map_lookup_query === query;
}

function shouldEnrich(record: PlaceLookupRecord, query: string): boolean {
  return !hasCoordinates(record) && !alreadyTried(record, query);
}

function ensureAccommodationDetail(accommodation: Accommodation): AccommodationDetail & PlaceLookupRecord {
  if (!accommodation.detail) accommodation.detail = {};
  return accommodation.detail;
}

function ensureMealPlace(meal: Meal): ItineraryPlace {
  if (!meal.place) meal.place = { name: meal.name };
  return meal.place;
}

function specificMealLabel(meal: Meal): string | undefined {
  const label = meal.place?.name?.trim() || meal.name?.trim();
  if (!label) return undefined;
  const normalized = label.toLowerCase();
  if (/^(breakfast|lunch|dinner|brunch|coffee|snack|picnic|meal)(\b|$)/.test(normalized)) {
    return meal.place?.name || meal.detail?.address ? label : undefined;
  }
  return label;
}

function collectTargets(data: TripData): EnrichmentTarget[] {
  const targets: EnrichmentTarget[] = [];
  const tripContext = compact([data.trip.name, data.trip.subtitle, data.trip.summary]).join(' ');

  for (const day of data.days ?? []) {
    const dayContext = compact([day.title, day.date, tripContext]).join(' ');

    if (day.accommodation?.name) {
      const detail = ensureAccommodationDetail(day.accommodation);
      const query = buildQuery(['Hotel', day.accommodation.name, detail.address, dayContext]);
      if (query && shouldEnrich(detail, query)) {
        targets.push({
          label: day.accommodation.name,
          query,
          includedType: 'lodging',
          record: detail,
        });
      }
    }

    for (const block of day.blocks ?? []) {
      const place = block.place;
      if (!place?.name) continue;
      const query = buildQuery([place.name, place.address, block.detail?.title, dayContext]);
      if (query && shouldEnrich(place, query)) {
        targets.push({
          label: place.name,
          query,
          includedType: 'tourist_attraction',
          record: place,
        });
      }
    }

    for (const meal of day.meals ?? []) {
      const label = specificMealLabel(meal);
      if (!label) continue;
      const place = ensureMealPlace(meal);
      const query = buildQuery(['Restaurant', label, place.address, meal.detail?.address, dayContext]);
      if (query && shouldEnrich(place, query)) {
        targets.push({
          label,
          query,
          includedType: 'restaurant',
          record: place,
        });
      }
    }
  }

  return targets;
}

function hasUsableLocation(place: GoogleTextSearchPlace | undefined): place is GoogleTextSearchPlace & { location: { latitude: number; longitude: number } } {
  return (
    typeof place?.location?.latitude === 'number' &&
    Number.isFinite(place.location.latitude) &&
    typeof place.location.longitude === 'number' &&
    Number.isFinite(place.location.longitude)
  );
}

function isAreaPlace(place: GoogleTextSearchPlace): boolean {
  return (place.types ?? []).some((type) => AREA_TYPES.has(type));
}

function pickPlace(places: GoogleTextSearchPlace[] | undefined): GoogleTextSearchPlace | undefined {
  const candidates = (places ?? []).filter(hasUsableLocation);
  return candidates.find((place) => !isAreaPlace(place)) ?? candidates[0];
}

async function searchPlace(
  apiKey: string,
  target: EnrichmentTarget,
  fetchImpl: typeof fetch
): Promise<LookupResult> {
  const body: Record<string, unknown> = {
    textQuery: target.query,
    languageCode: 'en',
    maxResultCount: 3,
  };
  if (target.includedType) {
    body.includedType = target.includedType;
    body.strictTypeFiltering = target.includedType === 'lodging' || target.includedType === 'restaurant';
  }

  let response: Response;
  try {
    response = await fetchImpl(GOOGLE_TEXT_SEARCH_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': apiKey,
        'X-Goog-FieldMask': GOOGLE_TEXT_SEARCH_FIELD_MASK,
      },
      body: JSON.stringify(body),
    });
  } catch (err) {
    return {
      status: 'error',
      error: err instanceof Error ? err.message : 'Google Places Text Search request failed',
    };
  }

  if (!response.ok) {
    return { status: 'error', error: `Google Places Text Search failed with HTTP ${response.status}` };
  }

  const payload = await response.json().catch(() => ({})) as { places?: GoogleTextSearchPlace[] };
  const place = pickPlace(payload.places);
  return place ? { status: 'resolved', place } : { status: 'not_found' };
}

function applyResolvedPlace(target: EnrichmentTarget, place: GoogleTextSearchPlace, now: string) {
  target.record.lat = place.location?.latitude;
  target.record.lng = place.location?.longitude;
  if (place.id) {
    target.record.place_id = place.id;
    target.record.google_maps_url = mapsUrlFor(target.label, place.id);
  }
  if (!target.record.address && place.formattedAddress) {
    target.record.address = place.formattedAddress;
  }
  target.record.map_lookup_status = 'resolved';
  target.record.map_lookup_at = now;
  target.record.map_lookup_query = target.query;
}

function applyNotFound(target: EnrichmentTarget, now: string) {
  target.record.map_lookup_status = 'not_found';
  target.record.map_lookup_at = now;
  target.record.map_lookup_query = target.query;
}

export async function enrichTripPlaces(
  data: TripData,
  options: {
    apiKey?: string;
    fetchImpl?: typeof fetch;
    limit?: number;
    now?: string;
  } = {}
): Promise<TripPlaceEnrichmentSummary> {
  const apiKey = options.apiKey === undefined ? serverApiKey() : options.apiKey.trim();
  if (!apiKey) {
    return { status: 'skipped', reason: 'missing_api_key', attempted: 0, enriched: 0, notFound: 0, errors: 0 };
  }

  const limit = enrichmentLimit(options.limit);
  if (limit === 0) {
    return { status: 'skipped', reason: 'no_targets', attempted: 0, enriched: 0, notFound: 0, errors: 0 };
  }

  const targets = collectTargets(data).slice(0, limit);
  if (!targets.length) {
    return { status: 'skipped', reason: 'no_targets', attempted: 0, enriched: 0, notFound: 0, errors: 0 };
  }

  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? new Date().toISOString();
  const lookupCache = new Map<string, LookupResult>();
  const summary: TripPlaceEnrichmentSummary = {
    status: 'completed',
    attempted: 0,
    enriched: 0,
    notFound: 0,
    errors: 0,
  };

  for (const target of targets) {
    const cacheKey = JSON.stringify([target.includedType, target.query]);
    const result = lookupCache.get(cacheKey) ?? await searchPlace(apiKey, target, fetchImpl);
    lookupCache.set(cacheKey, result);
    summary.attempted += 1;

    if (result.status === 'resolved') {
      applyResolvedPlace(target, result.place, now);
      summary.enriched += 1;
      continue;
    }

    if (result.status === 'not_found') {
      applyNotFound(target, now);
      summary.notFound += 1;
      continue;
    }

    summary.errors += 1;
    break;
  }

  return summary;
}

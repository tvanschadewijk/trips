import type { SupabaseClient } from '@supabase/supabase-js';
import { trySyncAccommodationReviewForTrip } from '@/lib/accommodation-review-store';
import { isPublicItineraryShareId } from '@/lib/public-itineraries';
import type { TripData } from '@/lib/types';

type AdminClient = SupabaseClient;

export class TripServiceError extends Error {
  constructor(
    message: string,
    public readonly status = 500
  ) {
    super(message);
  }
}

export type SaveTripInput = {
  trip?: Record<string, unknown>;
  days?: unknown[];
  trip_id?: string;
  markdown_source?: string;
};

export type PatchTripInput = {
  trip?: Record<string, unknown>;
  days?: Array<Record<string, unknown>>;
  markdown_source?: string;
};

export type TripSaveResult = {
  trip_id: string;
  share_id: string;
  url: string;
  status: 'created' | 'updated';
  accommodation_review: 'synced' | 'sync_failed';
};

export type TripListItem = {
  trip_id: string;
  name: string;
  share_id: string;
  url: string;
  share_mode: string;
  created_at: string;
  updated_at: string;
};

function assertMarkdownSize(markdownSource: unknown): asserts markdownSource is string | undefined {
  if (typeof markdownSource === 'string' && markdownSource.length > 262144) {
    throw new TripServiceError('markdown_source exceeds 256 KB', 413);
  }
}

function buildTripBody(input: SaveTripInput): TripData {
  assertMarkdownSize(input.markdown_source);

  if (!input.trip?.name) {
    throw new TripServiceError('Trip name is required', 400);
  }

  const tripBody: {
    trip: SaveTripInput['trip'];
    days: SaveTripInput['days'];
    markdown_source?: string;
  } = {
    trip: input.trip,
    days: input.days,
  };

  if (typeof input.markdown_source === 'string' && input.markdown_source.length > 0) {
    tripBody.markdown_source = input.markdown_source;
  }

  return tripBody as unknown as TripData;
}

export async function saveTripForUser(
  admin: AdminClient,
  userId: string,
  input: SaveTripInput,
  origin: string
): Promise<TripSaveResult> {
  const tripBody = buildTripBody(input);
  const tripName = String(input.trip?.name);

  if (input.trip_id) {
    const { data: existing } = await admin
      .from('trips')
      .select('id, share_id')
      .eq('id', input.trip_id)
      .eq('user_id', userId)
      .single();

    if (existing) {
      const { error } = await admin
        .from('trips')
        .update({
          name: tripName,
          data: tripBody,
          updated_at: new Date().toISOString(),
        })
        .eq('id', existing.id);

      if (error) {
        throw new TripServiceError(error.message, 500);
      }

      const accommodationReview = await trySyncAccommodationReviewForTrip(
        admin,
        existing.id,
        tripBody
      );

      return {
        trip_id: existing.id,
        share_id: existing.share_id,
        url: `${origin}/t/${existing.share_id}`,
        status: 'updated',
        accommodation_review: accommodationReview,
      };
    }
  }

  let existingByName: { id: string; share_id: string } | null = null;
  const startDate =
    input.trip?.dates &&
    typeof input.trip.dates === 'object' &&
    'start' in input.trip.dates
      ? (input.trip.dates as { start?: unknown }).start
      : undefined;

  if (typeof startDate === 'string' && startDate.length > 0) {
    const { data } = await admin
      .from('trips')
      .select('id, share_id')
      .eq('user_id', userId)
      .eq('name', tripName)
      .eq('data->trip->dates->>start', startDate)
      .single();
    existingByName = data;
  }

  if (!existingByName) {
    const { data } = await admin
      .from('trips')
      .select('id, share_id')
      .eq('user_id', userId)
      .eq('name', tripName)
      .single();
    existingByName = data;
  }

  if (existingByName) {
    const { error } = await admin
      .from('trips')
      .update({
        name: tripName,
        data: tripBody,
        updated_at: new Date().toISOString(),
      })
      .eq('id', existingByName.id);

    if (error) {
      throw new TripServiceError(error.message, 500);
    }

    const accommodationReview = await trySyncAccommodationReviewForTrip(
      admin,
      existingByName.id,
      tripBody
    );

    return {
      trip_id: existingByName.id,
      share_id: existingByName.share_id,
      url: `${origin}/t/${existingByName.share_id}`,
      status: 'updated',
      accommodation_review: accommodationReview,
    };
  }

  const { data: newTrip, error } = await admin
    .from('trips')
    .insert({
      user_id: userId,
      name: tripName,
      data: tripBody,
      share_mode: 'companion',
    })
    .select('id, share_id')
    .single();

  if (error || !newTrip) {
    throw new TripServiceError(error?.message || 'Failed to create trip', 500);
  }

  const accommodationReview = await trySyncAccommodationReviewForTrip(
    admin,
    newTrip.id,
    tripBody
  );

  return {
    trip_id: newTrip.id,
    share_id: newTrip.share_id,
    url: `${origin}/t/${newTrip.share_id}`,
    status: 'created',
    accommodation_review: accommodationReview,
  };
}

export async function listTripsForUser(
  admin: AdminClient,
  userId: string,
  origin: string
): Promise<TripListItem[]> {
  const { data: trips, error } = await admin
    .from('trips')
    .select('id, name, share_id, share_mode, created_at, updated_at')
    .eq('user_id', userId)
    .order('updated_at', { ascending: false });

  if (error) {
    throw new TripServiceError(error.message, 500);
  }

  return (trips || [])
    .filter((trip) => !isPublicItineraryShareId(trip.share_id))
    .map((trip) => ({
      trip_id: trip.id,
      name: trip.name,
      share_id: trip.share_id,
      url: `${origin}/t/${trip.share_id}`,
      share_mode: trip.share_mode,
      created_at: trip.created_at,
      updated_at: trip.updated_at,
    }));
}

export async function getTripForUser(
  admin: AdminClient,
  userId: string,
  tripId: string
) {
  const { data: trip, error } = await admin
    .from('trips')
    .select('*')
    .eq('id', tripId)
    .eq('user_id', userId)
    .single();

  if (error || !trip) {
    throw new TripServiceError('Trip not found', 404);
  }

  return trip;
}

export async function patchTripForUser(
  admin: AdminClient,
  userId: string,
  tripId: string,
  input: PatchTripInput
) {
  const trip = await getTripForUser(admin, userId, tripId);
  const existing = trip.data as {
    trip: Record<string, unknown>;
    days: Array<Record<string, unknown>>;
    markdown_source?: string;
  };

  if (input.trip) {
    existing.trip = deepMerge(existing.trip, input.trip);
  }

  if (typeof input.markdown_source === 'string') {
    assertMarkdownSize(input.markdown_source);
    if (input.markdown_source.length === 0) {
      delete existing.markdown_source;
    } else {
      existing.markdown_source = input.markdown_source;
    }
  }

  if (input.days && Array.isArray(input.days)) {
    for (const patchDay of input.days) {
      if (typeof patchDay.day_number !== 'number') continue;
      const idx = existing.days.findIndex((day) => day.day_number === patchDay.day_number);
      if (idx >= 0) {
        existing.days[idx] = deepMerge(existing.days[idx], patchDay);
      } else {
        existing.days.push(patchDay);
        existing.days.sort((a, b) => (a.day_number as number) - (b.day_number as number));
      }
    }
  }

  const updatedName = existing.trip.name;
  const { data: updated, error } = await admin
    .from('trips')
    .update({
      data: existing,
      ...(typeof updatedName === 'string' && updatedName.length > 0
        ? { name: updatedName }
        : {}),
      updated_at: new Date().toISOString(),
    })
    .eq('id', tripId)
    .eq('user_id', userId)
    .select()
    .single();

  if (error) {
    throw new TripServiceError(error.message, 500);
  }

  await trySyncAccommodationReviewForTrip(admin, tripId, existing as unknown as TripData);
  return updated;
}

export function deepMerge(
  target: Record<string, unknown>,
  source: Record<string, unknown>
): Record<string, unknown> {
  const result = { ...target };
  for (const key of Object.keys(source)) {
    const srcVal = source[key];
    const tgtVal = target[key];
    if (
      srcVal &&
      typeof srcVal === 'object' &&
      !Array.isArray(srcVal) &&
      tgtVal &&
      typeof tgtVal === 'object' &&
      !Array.isArray(tgtVal)
    ) {
      result[key] = deepMerge(
        tgtVal as Record<string, unknown>,
        srcVal as Record<string, unknown>
      );
    } else {
      result[key] = srcVal;
    }
  }
  return result;
}

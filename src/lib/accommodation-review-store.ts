import type { SupabaseClient } from '@supabase/supabase-js';
import { mergeAccommodationReviewWithTripData } from '@/lib/accommodation-review';
import type { AccommodationReview, TripData } from '@/lib/types';

type AdminClient = SupabaseClient;

export async function syncAccommodationReviewForTrip(
  admin: AdminClient,
  tripId: string,
  tripData: TripData
): Promise<AccommodationReview> {
  const { data: row, error } = await admin
    .from('trip_accommodation_reviews')
    .select('data')
    .eq('trip_id', tripId)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  const review = mergeAccommodationReviewWithTripData(row?.data ?? null, tripData);
  const shouldPersist =
    !row?.data || JSON.stringify(row.data) !== JSON.stringify(review);

  if (shouldPersist) {
    const { error: upsertError } = await admin
      .from('trip_accommodation_reviews')
      .upsert({
        trip_id: tripId,
        data: review,
        updated_at: new Date().toISOString(),
      });

    if (upsertError) {
      throw new Error(upsertError.message);
    }
  }

  return review;
}

export async function trySyncAccommodationReviewForTrip(
  admin: AdminClient,
  tripId: string,
  tripData: TripData
): Promise<'synced' | 'sync_failed'> {
  try {
    await syncAccommodationReviewForTrip(admin, tripId, tripData);
    return 'synced';
  } catch (err) {
    console.warn(
      'Accommodation review sync failed',
      err instanceof Error ? err.message : err
    );
    return 'sync_failed';
  }
}

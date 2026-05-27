import { mergeAccommodationReviewWithTripData } from '@/lib/accommodation-review';
import type { createAdminClient } from '@/lib/supabase/admin';
import type { TripData } from '@/lib/types';

type AdminClient = ReturnType<typeof createAdminClient>;

export async function syncAccommodationReviewForTrip(
  admin: AdminClient,
  tripId: string,
  tripData: TripData
) {
  const { data: row, error } = await admin
    .from('trip_accommodation_reviews')
    .select('data')
    .eq('trip_id', tripId)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  const review = mergeAccommodationReviewWithTripData(row?.data ?? null, tripData);
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

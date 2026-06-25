import type { SupabaseClient } from '@supabase/supabase-js';

import { syncAccommodationReviewForTrip } from '@/lib/accommodation-review-store';
import type { AccommodationReview, TripData, TripDetails } from '@/lib/types';

type AdminClient = SupabaseClient;

export function attachTripDetails(
  tripData: TripData,
  details: TripDetails
): TripData {
  return {
    ...tripData,
    trip_details: {
      ...(tripData.trip_details ?? {}),
      ...details,
    },
  };
}

export async function attachDownloadableTripDetails(
  admin: AdminClient,
  tripId: string,
  tripData: TripData
): Promise<TripData> {
  try {
    const accommodationReview = await syncAccommodationReviewForTrip(admin, tripId, tripData);
    return attachTripDetails(tripData, {
      accommodation_review: accommodationReview as AccommodationReview,
    });
  } catch (err) {
    console.warn(
      'Trip details export failed',
      err instanceof Error ? err.message : err
    );
    return tripData;
  }
}

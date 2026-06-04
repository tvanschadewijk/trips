import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import {
  AccommodationReviewConflictError,
  moveAccommodationCandidate,
  promoteCandidateToTrip,
  replaceBookedAccommodationCandidate,
  updateAccommodationCandidate,
} from '@/lib/accommodation-review';
import { syncAccommodationReviewForTrip } from '@/lib/accommodation-review-store';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import { normalizeTripData } from '@/lib/trip-data-normalize';
import type {
  AccommodationCandidate,
  AccommodationCandidateBooking,
  AccommodationReview,
  AccommodationReviewLane,
  TripData,
} from '@/lib/types';

const LaneSchema = z.enum(['proposed', 'considering', 'dismissed', 'booked']);

const CandidateLinkSchema = z.object({
  label: z.string().min(1),
  url: z.string().url(),
}).strict();

const CandidateRatingSchema = z.object({
  name: z.string().optional(),
  checkedAt: z.string().optional(),
  bookingCom: z.string().optional(),
  tripadvisor: z.string().optional(),
  google: z.string().optional(),
  hotelsCom: z.string().optional(),
  note: z.string().optional(),
}).strict();

const BookingSchema = z.object({
  bookedAt: z.string().optional(),
  source: z.string().optional(),
  confirmation: z.string().optional(),
  price: z.string().optional(),
  note: z.string().optional(),
}).strict();

const CandidatePatchSchema = z.object({
  destinationId: z.string().optional(),
  stop: z.string().optional(),
  dates: z.string().optional(),
  nights: z.number().optional(),
  lane: LaneSchema.optional(),
  status: z.string().optional(),
  candidate: z.string().optional(),
  price: z.string().optional(),
  dog: z.string().optional(),
  parking: z.string().optional(),
  terms: z.string().optional(),
  why: z.string().optional(),
  blockers: z.string().optional(),
  action: z.string().optional(),
  alternatives: z.string().optional(),
  directWebsite: CandidateLinkSchema.optional(),
  links: z.array(CandidateLinkSchema).optional(),
  ratings: z.array(CandidateRatingSchema).optional(),
  rateCheck: z.record(z.string(), z.unknown()).optional(),
  feedbackLoop: z.record(z.string(), z.unknown()).optional(),
  dayNumbers: z.array(z.number()).optional(),
  checkInDate: z.string().optional(),
  checkOutDate: z.string().optional(),
  address: z.string().optional(),
  roomType: z.string().optional(),
  checkIn: z.string().optional(),
  checkOut: z.string().optional(),
  phone: z.string().optional(),
  wifi: z.string().optional(),
  policySource: z.object({ label: z.string(), url: z.string() }).optional(),
  policyConfidence: z.enum(['high', 'medium', 'low']).optional(),
  hotelNote: z.string().optional(),
  booking: BookingSchema.optional(),
  createdBy: z.enum(['agent', 'user', 'import', 'system']).optional(),
}).strict();

const PatchSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('move_candidate'),
    candidate_id: z.string().min(1),
    lane: LaneSchema,
    booking: BookingSchema.optional(),
    message: z.string().optional(),
  }).strict(),
  z.object({
    action: z.literal('replace_booked_candidate'),
    candidate_id: z.string().min(1),
    booking: BookingSchema.optional(),
    message: z.string().optional(),
  }).strict(),
  z.object({
    action: z.literal('update_candidate'),
    candidate_id: z.string().min(1),
    candidate_patch: CandidatePatchSchema,
    message: z.string().optional(),
  }).strict(),
]);

type Access =
  | {
      admin: ReturnType<typeof createAdminClient>;
      tripId: string;
      tripData: TripData;
    }
  | { response: NextResponse };

async function requireAccommodationReviewAccess(
  tripId: string
): Promise<Access> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { response: NextResponse.json({ error: 'Not authenticated' }, { status: 401 }) };
  }

  const admin = createAdminClient();
  const { data: trip, error } = await admin
    .from('trips')
    .select('id, user_id, data')
    .eq('id', tripId)
    .single();

  if (error || !trip) {
    return { response: NextResponse.json({ error: 'Trip not found' }, { status: 404 }) };
  }

  let adminOk = false;
  if (trip.user_id !== user.id) {
    const { data: profile } = await admin
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single();
    adminOk = profile?.role === 'admin';
  }

  if (trip.user_id !== user.id && !adminOk) {
    return { response: NextResponse.json({ error: 'Not authorized' }, { status: 403 }) };
  }

  return {
    admin,
    tripId,
    tripData: normalizeTripData(trip.data),
  };
}

async function loadOrCreateReview(
  admin: ReturnType<typeof createAdminClient>,
  tripId: string,
  tripData: TripData
): Promise<AccommodationReview> {
  return syncAccommodationReviewForTrip(admin, tripId, tripData);
}

async function saveReview(
  admin: ReturnType<typeof createAdminClient>,
  tripId: string,
  review: AccommodationReview
) {
  const { error } = await admin
    .from('trip_accommodation_reviews')
    .upsert({
      trip_id: tripId,
      data: review,
      updated_at: new Date().toISOString(),
    });

  if (error) {
    throw new Error(error.message);
  }
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const access = await requireAccommodationReviewAccess(id);
  if ('response' in access) return access.response;

  try {
    const review = await loadOrCreateReview(
      access.admin,
      access.tripId,
      access.tripData
    );
    return NextResponse.json({ review });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to load accommodation review' },
      { status: 500 }
    );
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const access = await requireAccommodationReviewAccess(id);
  if ('response' in access) return access.response;

  let body: z.infer<typeof PatchSchema>;
  try {
    body = PatchSchema.parse(await request.json());
  } catch (err) {
    return NextResponse.json(
      { error: 'Invalid request body', detail: err instanceof Error ? err.message : String(err) },
      { status: 400 }
    );
  }

  try {
    const review = await loadOrCreateReview(
      access.admin,
      access.tripId,
      access.tripData
    );
    let nextReview: AccommodationReview;
    let nextTripData: TripData | null = null;

    if (body.action === 'move_candidate') {
      nextReview = moveAccommodationCandidate(
        review,
        body.candidate_id,
        body.lane as AccommodationReviewLane,
        'user',
        body.booking as AccommodationCandidateBooking | undefined,
        body.message
      );

      if (body.lane === 'booked') {
        nextTripData = promoteCandidateToTrip(
          access.tripData,
          nextReview,
          body.candidate_id,
          body.booking as AccommodationCandidateBooking | undefined
        );
        const { error: tripError } = await access.admin
          .from('trips')
          .update({
            data: nextTripData,
            updated_at: new Date().toISOString(),
          })
          .eq('id', access.tripId);

        if (tripError) {
          throw new Error(tripError.message);
        }
      }
    } else if (body.action === 'replace_booked_candidate') {
      nextReview = replaceBookedAccommodationCandidate(
        review,
        body.candidate_id,
        'user',
        body.booking as AccommodationCandidateBooking | undefined,
        body.message
      );
      nextTripData = promoteCandidateToTrip(
        access.tripData,
        nextReview,
        body.candidate_id,
        body.booking as AccommodationCandidateBooking | undefined
      );
      const { error: tripError } = await access.admin
        .from('trips')
        .update({
          data: nextTripData,
          updated_at: new Date().toISOString(),
        })
        .eq('id', access.tripId);

      if (tripError) {
        throw new Error(tripError.message);
      }
    } else {
      nextReview = updateAccommodationCandidate(
        review,
        body.candidate_id,
        body.candidate_patch as Partial<AccommodationCandidate>,
        'user',
        body.message
      );
    }

    await saveReview(access.admin, access.tripId, nextReview);

    if (nextTripData) {
      nextReview = await syncAccommodationReviewForTrip(
        access.admin,
        access.tripId,
        nextTripData
      );
    }

    return NextResponse.json({
      review: nextReview,
      trip_data: nextTripData,
    });
  } catch (err) {
    if (err instanceof AccommodationReviewConflictError) {
      return NextResponse.json(
        {
          error: err.message,
          code: 'destination_already_booked',
          existing_candidate_id: err.existingCandidateId,
        },
        { status: 409 }
      );
    }

    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to update accommodation review' },
      { status: 500 }
    );
  }
}

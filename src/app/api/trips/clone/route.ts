import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import { scrubAndAnchorTripData } from '@/lib/scrub-trip';
import { isPublicItineraryShareId } from '@/lib/public-itineraries';
import { trySyncAccommodationReviewForTrip } from '@/lib/accommodation-review-store';
import { getBillingSummary } from '@/lib/billing';
import type { TripData } from '@/lib/types';

// POST /api/trips/clone — Remix a shared trip into the authenticated
// user's account. Always strips PII and re-anchors dates to today,
// regardless of the source's share_mode. Defense in depth: even a
// companion-mode share won't leak booking codes through the clone path.
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  const { share_id } = await request.json();

  if (!share_id) {
    return NextResponse.json({ error: 'share_id is required' }, { status: 400 });
  }

  const admin = createAdminClient();

  const { data: source, error: fetchErr } = await admin
    .from('trips')
    .select('id, user_id, name, data, share_mode')
    .eq('share_id', share_id)
    .in('share_mode', ['companion', 'remix'])
    .is('deleted_at', null)
    .single();

  if (fetchErr || !source) {
    return NextResponse.json({ error: 'Trip not found' }, { status: 404 });
  }

  const isPublicSample = isPublicItineraryShareId(share_id);

  if (source.user_id === user.id && !isPublicSample) {
    return NextResponse.json({ error: 'You already own this trip', already_owned: true }, { status: 409 });
  }

  // Check if user already cloned this trip (by matching source trip name)
  const { data: existingRows } = await admin
    .from('trips')
    .select('id, share_id')
    .eq('user_id', user.id)
    .eq('name', source.name)
    .is('deleted_at', null);

  const existing = existingRows?.find(row => !isPublicItineraryShareId(row.share_id));
  if (existing) {
    return NextResponse.json({
      trip_id: existing.id,
      share_id: existing.share_id,
      status: 'already_saved',
    });
  }

  const billing = await getBillingSummary(admin, user.id);
  if (!billing.can_create_trip) {
    return NextResponse.json(
      {
        error: `You have used the ${billing.free_trip_limit} trips included with the free plan. Subscribe to save another trip.`,
        code: 'trip_limit_reached',
        details: { billing },
      },
      { status: 402 }
    );
  }

  // Scrub PII and rebase dates to today before insert.
  const cloneBody = scrubAndAnchorTripData(source.data as TripData);

  const { data: newTrip, error: insertErr } = await admin
    .from('trips')
    .insert({
      user_id: user.id,
      name: source.name,
      data: cloneBody,
      // The cloner gets a companion-mode trip by default — they can
      // re-share for remix later if they want.
      share_mode: 'companion',
    })
    .select('id, share_id')
    .single();

  if (insertErr || !newTrip) {
    return NextResponse.json({ error: insertErr?.message || 'Failed to save trip' }, { status: 500 });
  }

  const accommodationReview = await trySyncAccommodationReviewForTrip(
    admin,
    newTrip.id,
    cloneBody
  );

  return NextResponse.json({
    trip_id: newTrip.id,
    share_id: newTrip.share_id,
    accommodation_review: accommodationReview,
    status: 'saved',
  }, { status: 201 });
}

import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { validateApiKey } from '@/lib/auth';
import { isPublicItineraryShareId } from '@/lib/public-itineraries';
import { trySyncAccommodationReviewForTrip } from '@/lib/accommodation-review-store';
import type { TripData } from '@/lib/types';

// POST /api/trips — Create or update a trip
export async function POST(request: NextRequest) {
  const userId = await validateApiKey(request.headers.get('authorization'));
  if (!userId) {
    return NextResponse.json({ error: 'Invalid or missing API key' }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { trip, days, trip_id, markdown_source } = body;

    if (!trip?.name) {
      return NextResponse.json({ error: 'Trip name is required' }, { status: 400 });
    }

    // Reject oversize markdown bodies (256 KB cap).
    if (typeof markdown_source === 'string' && markdown_source.length > 262144) {
      return NextResponse.json(
        { error: 'markdown_source exceeds 256 KB' },
        { status: 413 }
      );
    }

    // Trip body persisted into trips.data — only include markdown_source when
    // it's a non-empty string so we don't write a bunch of empty fields.
    const tripBody: { trip: typeof trip; days: typeof days; markdown_source?: string } = { trip, days };
    if (typeof markdown_source === 'string' && markdown_source.length > 0) {
      tripBody.markdown_source = markdown_source;
    }

    const supabase = createAdminClient();

    // If trip_id is provided, update that specific trip
    if (trip_id) {
      const { data: existing } = await supabase
        .from('trips')
        .select('id, share_id')
        .eq('id', trip_id)
        .eq('user_id', userId)
        .single();

      if (existing) {
        const { error } = await supabase
          .from('trips')
          .update({
            name: trip.name,
            data: tripBody,
            updated_at: new Date().toISOString(),
          })
          .eq('id', existing.id);

        if (error) {
          return NextResponse.json({ error: error.message }, { status: 500 });
        }

        const accommodationReview = await trySyncAccommodationReviewForTrip(
          supabase,
          existing.id,
          tripBody as TripData
        );

        return NextResponse.json({
          trip_id: existing.id,
          share_id: existing.share_id,
          url: `${request.nextUrl.origin}/t/${existing.share_id}`,
          status: 'updated',
          accommodation_review: accommodationReview,
        });
      }
      // trip_id not found for this user — fall through to upsert by name
    }

    // Upsert by name + start date: check if user already has a matching trip
    // Using both name and start date so "Scotland May" and "Scotland Sep" stay separate
    let existingByName: { id: string; share_id: string } | null = null;
    if (trip.dates?.start) {
      const { data } = await supabase
        .from('trips')
        .select('id, share_id')
        .eq('user_id', userId)
        .eq('name', trip.name)
        .eq('data->trip->dates->>start', trip.dates.start)
        .single();
      existingByName = data;
    }
    if (!existingByName) {
      // Fallback: match by name only if no start date provided or no date match
      const { data } = await supabase
        .from('trips')
        .select('id, share_id')
        .eq('user_id', userId)
        .eq('name', trip.name)
        .single();
      // Only use name-only match if there's exactly one result (single() errors on multiple)
      existingByName = data;
    }

    if (existingByName) {
      const { error: updateErr } = await supabase
        .from('trips')
        .update({
          name: trip.name,
          data: tripBody,
          updated_at: new Date().toISOString(),
        })
        .eq('id', existingByName.id);

      if (updateErr) {
        return NextResponse.json({ error: updateErr.message }, { status: 500 });
      }

      const accommodationReview = await trySyncAccommodationReviewForTrip(
        supabase,
        existingByName.id,
        tripBody as TripData
      );

      return NextResponse.json({
        trip_id: existingByName.id,
        share_id: existingByName.share_id,
        url: `${request.nextUrl.origin}/t/${existingByName.share_id}`,
        status: 'updated',
        accommodation_review: accommodationReview,
      });
    }

    // Create new trip — defaults to companion share mode (link works,
    // full data). Owner can toggle to remix later for inspiration sharing.
    const { data: newTrip, error } = await supabase
      .from('trips')
      .insert({
        user_id: userId,
        name: trip.name,
        data: tripBody,
        share_mode: 'companion',
      })
      .select('id, share_id')
      .single();

    if (error || !newTrip) {
      return NextResponse.json({ error: error?.message || 'Failed to create trip' }, { status: 500 });
    }

    const accommodationReview = await trySyncAccommodationReviewForTrip(
      supabase,
      newTrip.id,
      tripBody as TripData
    );

    return NextResponse.json({
      trip_id: newTrip.id,
      share_id: newTrip.share_id,
      url: `${request.nextUrl.origin}/t/${newTrip.share_id}`,
      status: 'created',
      accommodation_review: accommodationReview,
    }, { status: 201 });
  } catch (err) {
    if (err instanceof SyntaxError) {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
    }

    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to save trip' },
      { status: 500 }
    );
  }
}

// GET /api/trips — List all trips for authenticated user
export async function GET(request: NextRequest) {
  const userId = await validateApiKey(request.headers.get('authorization'));
  if (!userId) {
    return NextResponse.json({ error: 'Invalid or missing API key' }, { status: 401 });
  }

  const supabase = createAdminClient();

  const { data: trips, error } = await supabase
    .from('trips')
    .select('id, name, share_id, share_mode, created_at, updated_at')
    .eq('user_id', userId)
    .order('updated_at', { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    trips: (trips || [])
      .filter(t => !isPublicItineraryShareId(t.share_id))
      .map(t => ({
      trip_id: t.id,
      name: t.name,
      share_id: t.share_id,
      url: `${request.nextUrl.origin}/t/${t.share_id}`,
      share_mode: t.share_mode,
      created_at: t.created_at,
      updated_at: t.updated_at,
    })),
  });
}

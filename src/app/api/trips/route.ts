import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { validateApiKey } from '@/lib/auth';

// POST /api/trips — Create or update a trip
export async function POST(request: NextRequest) {
  const userId = await validateApiKey(request.headers.get('authorization'));
  if (!userId) {
    return NextResponse.json({ error: 'Invalid or missing API key' }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { trip, days } = body;

    if (!trip?.name) {
      return NextResponse.json({ error: 'Trip name is required' }, { status: 400 });
    }

    const supabase = createAdminClient();

    // Check if a trip with this name already exists for the user
    const { data: existing } = await supabase
      .from('trips')
      .select('id, share_id')
      .eq('user_id', userId)
      .eq('name', trip.name)
      .single();

    if (existing) {
      // Update existing trip
      const { error } = await supabase
        .from('trips')
        .update({
          data: { trip, days },
          updated_at: new Date().toISOString(),
        })
        .eq('id', existing.id);

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }

      return NextResponse.json({
        trip_id: existing.id,
        share_id: existing.share_id,
        url: `${request.nextUrl.origin}/t/${existing.share_id}`,
        status: 'updated',
      });
    }

    // Create new trip
    const { data: newTrip, error } = await supabase
      .from('trips')
      .insert({
        user_id: userId,
        name: trip.name,
        data: { trip, days },
        is_public: true,
      })
      .select('id, share_id')
      .single();

    if (error || !newTrip) {
      return NextResponse.json({ error: error?.message || 'Failed to create trip' }, { status: 500 });
    }

    return NextResponse.json({
      trip_id: newTrip.id,
      share_id: newTrip.share_id,
      url: `${request.nextUrl.origin}/t/${newTrip.share_id}`,
      status: 'created',
    }, { status: 201 });
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
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
    .select('id, name, share_id, is_public, created_at, updated_at')
    .eq('user_id', userId)
    .order('updated_at', { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    trips: (trips || []).map(t => ({
      trip_id: t.id,
      name: t.name,
      share_id: t.share_id,
      url: `${request.nextUrl.origin}/t/${t.share_id}`,
      is_public: t.is_public,
      created_at: t.created_at,
      updated_at: t.updated_at,
    })),
  });
}

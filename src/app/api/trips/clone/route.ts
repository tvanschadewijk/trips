import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';

// POST /api/trips/clone — Clone a public trip to the authenticated user's account
export async function POST(request: NextRequest) {
  // Auth via session (browser cookie)
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

  // Fetch the source trip
  const { data: source, error: fetchErr } = await admin
    .from('trips')
    .select('id, user_id, name, data')
    .eq('share_id', share_id)
    .eq('is_public', true)
    .single();

  if (fetchErr || !source) {
    return NextResponse.json({ error: 'Trip not found' }, { status: 404 });
  }

  // Don't clone if user already owns it
  if (source.user_id === user.id) {
    return NextResponse.json({ error: 'You already own this trip', already_owned: true }, { status: 409 });
  }

  // Check if user already cloned this trip (by matching source trip name + data)
  const { data: existing } = await admin
    .from('trips')
    .select('id, share_id')
    .eq('user_id', user.id)
    .eq('name', source.name)
    .single();

  if (existing) {
    return NextResponse.json({
      trip_id: existing.id,
      share_id: existing.share_id,
      status: 'already_saved',
    });
  }

  // Clone the trip
  const { data: newTrip, error: insertErr } = await admin
    .from('trips')
    .insert({
      user_id: user.id,
      name: source.name,
      data: source.data,
      is_public: true,
    })
    .select('id, share_id')
    .single();

  // Handle race condition: another clone request just created this (user_id, name) pair
  if (insertErr?.code === '23505') {
    const { data: raceWinner } = await admin
      .from('trips')
      .select('id, share_id')
      .eq('user_id', user.id)
      .eq('name', source.name)
      .single();

    if (raceWinner) {
      return NextResponse.json({
        trip_id: raceWinner.id,
        share_id: raceWinner.share_id,
        status: 'already_saved',
      });
    }
  }

  if (insertErr || !newTrip) {
    return NextResponse.json({ error: insertErr?.message || 'Failed to save trip' }, { status: 500 });
  }

  return NextResponse.json({
    trip_id: newTrip.id,
    share_id: newTrip.share_id,
    status: 'saved',
  }, { status: 201 });
}

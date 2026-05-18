import { NextRequest, NextResponse } from 'next/server';
import { validateApiKey } from '@/lib/auth';
import { buildTripImagePromptSet } from '@/lib/trip-image-prompts';
import { createAdminClient } from '@/lib/supabase/admin';
import type { TripData } from '@/lib/types';

// GET /api/trips/[id]/image-prompts — Build imagegen prompts for this trip.
// This does not call an image model or write to storage; it returns grounded
// prompts that an image generation job can use and then save back to
// data.trip.image_assets via PATCH /api/trips/[id].
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const userId = await validateApiKey(request.headers.get('authorization'));
  if (!userId) {
    return NextResponse.json({ error: 'Invalid or missing API key' }, { status: 401 });
  }

  const { id } = await params;
  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from('trips')
    .select('id, data')
    .eq('id', id)
    .eq('user_id', userId)
    .single();

  if (error || !data) {
    return NextResponse.json({ error: 'Trip not found' }, { status: 404 });
  }

  const tripData = data.data as TripData;
  return NextResponse.json({
    trip_id: data.id,
    prompts: buildTripImagePromptSet(tripData),
    save_hint: {
      field: 'data.trip.image_assets',
      endpoint: `/api/trips/${data.id}`,
      method: 'PATCH',
    },
  });
}

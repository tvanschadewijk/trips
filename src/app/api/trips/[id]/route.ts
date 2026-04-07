import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { validateApiKey } from '@/lib/auth';

// GET /api/trips/[id] — Get a single trip's full JSON
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

  const { data: trip, error } = await supabase
    .from('trips')
    .select('*')
    .eq('id', id)
    .eq('user_id', userId)
    .single();

  if (error || !trip) {
    return NextResponse.json({ error: 'Trip not found' }, { status: 404 });
  }

  return NextResponse.json(trip);
}

// PATCH /api/trips/[id] — Partially update a trip (deep-merge)
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const userId = await validateApiKey(request.headers.get('authorization'));
  if (!userId) {
    return NextResponse.json({ error: 'Invalid or missing API key' }, { status: 401 });
  }

  const { id } = await params;
  const supabase = createAdminClient();

  // Fetch existing trip
  const { data: trip, error: fetchError } = await supabase
    .from('trips')
    .select('*')
    .eq('id', id)
    .eq('user_id', userId)
    .single();

  if (fetchError || !trip) {
    return NextResponse.json({ error: 'Trip not found' }, { status: 404 });
  }

  const body = await request.json();
  const existing = trip.data as { trip: Record<string, unknown>; days: Array<Record<string, unknown>> };

  // Deep-merge trip metadata
  if (body.trip) {
    existing.trip = deepMerge(existing.trip, body.trip);
  }

  // Deep-merge days by day_number
  if (body.days && Array.isArray(body.days)) {
    for (const patchDay of body.days) {
      if (typeof patchDay.day_number !== 'number') continue;
      const idx = existing.days.findIndex(
        (d: Record<string, unknown>) => d.day_number === patchDay.day_number
      );
      if (idx >= 0) {
        existing.days[idx] = deepMerge(existing.days[idx], patchDay);
      } else {
        // New day — append
        existing.days.push(patchDay);
        existing.days.sort(
          (a: Record<string, unknown>, b: Record<string, unknown>) =>
            (a.day_number as number) - (b.day_number as number)
        );
      }
    }
  }

  // Update name if trip.name changed
  const updatedName = (existing.trip as Record<string, unknown>).name as string | undefined;

  const { data: updated, error: updateError } = await supabase
    .from('trips')
    .update({
      data: existing,
      ...(updatedName ? { name: updatedName } : {}),
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .eq('user_id', userId)
    .select()
    .single();

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  return NextResponse.json(updated);
}

// Deep-merge utility — merges source into target recursively
function deepMerge(
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

// DELETE /api/trips/[id] — Delete a trip
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const userId = await validateApiKey(request.headers.get('authorization'));
  if (!userId) {
    return NextResponse.json({ error: 'Invalid or missing API key' }, { status: 401 });
  }

  const { id } = await params;
  const supabase = createAdminClient();

  const { error } = await supabase
    .from('trips')
    .delete()
    .eq('id', id)
    .eq('user_id', userId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ status: 'deleted' });
}

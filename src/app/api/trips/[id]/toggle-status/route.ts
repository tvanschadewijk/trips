import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import { trySyncAccommodationReviewForTrip } from '@/lib/accommodation-review-store';
import { normalizeTripData } from '@/lib/trip-data-normalize';
import {
  applyActionItemStatusToTripData,
  normalizeActionItemStatus,
  normalizeActionItemType,
} from '@/lib/trip-action-items';
import { recordTripMutationRevision, TripServiceError } from '@/lib/trip-service';
import type { TripData } from '@/lib/types';

// POST /api/trips/[id]/toggle-status — Toggle an action item's status
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  // Session auth (browser cookie)
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  const { id } = await params;
  const admin = createAdminClient();

  // Fetch trip and verify ownership
  const { data: trip, error: fetchError } = await admin
    .from('trips')
    .select('*')
    .eq('id', id)
    .is('deleted_at', null)
    .single();

  if (fetchError || !trip) {
    return NextResponse.json({ error: 'Trip not found' }, { status: 404 });
  }

  if (trip.user_id !== user.id) {
    return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
  }

  const { day_number, item_type, item_index, new_status } = await request.json();
  const itemType = normalizeActionItemType(item_type);
  const statusValue = normalizeActionItemStatus(new_status);

  if (typeof day_number !== 'number' || !itemType || !statusValue) {
    return NextResponse.json({ error: 'Invalid parameters' }, { status: 400 });
  }

  const data = normalizeTripData(trip.data) as unknown as { trip: Record<string, unknown>; days: Array<Record<string, unknown>> };
  const result = applyActionItemStatusToTripData(data, {
    dayNumber: day_number,
    itemType,
    itemIndex: item_index,
    status: statusValue,
  });
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.statusCode });
  }

  const updatedAt = new Date().toISOString();
  try {
    await recordTripMutationRevision(admin, {
      tripId: id,
      userId: user.id,
      source: 'api',
      action: 'action_status',
      tool: 'toggle_action_item_status',
      changedPaths: [`days[day_number=${day_number}].${itemType}[${item_index}]`],
      input: { day_number, item_type: itemType, item_index, new_status: statusValue },
      beforeRecord: trip,
      afterRecord: {
        ...trip,
        data,
        updated_at: updatedAt,
      },
    });
  } catch (err) {
    if (err instanceof TripServiceError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json({ error: 'Failed to record trip revision' }, { status: 500 });
  }

  const { error: updateError } = await admin
    .from('trips')
    .update({ data, updated_at: updatedAt })
    .eq('id', id)
    .is('deleted_at', null);

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  if (itemType === 'accommodation') {
    await trySyncAccommodationReviewForTrip(admin, id, data as unknown as TripData);
  }

  return NextResponse.json({ status: 'ok', new_status: statusValue });
}

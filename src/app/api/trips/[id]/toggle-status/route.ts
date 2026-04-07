import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';

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
    .select('id, user_id, data')
    .eq('id', id)
    .single();

  if (fetchError || !trip) {
    return NextResponse.json({ error: 'Trip not found' }, { status: 404 });
  }

  if (trip.user_id !== user.id) {
    return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
  }

  const { day_number, item_type, item_index, new_status } = await request.json();

  if (typeof day_number !== 'number' || !['transport', 'accommodation', 'meal'].includes(item_type)) {
    return NextResponse.json({ error: 'Invalid parameters' }, { status: 400 });
  }

  const statusValue = new_status === 'booked' ? 'booked' : undefined;

  const data = trip.data as { trip: Record<string, unknown>; days: Array<Record<string, unknown>> };

  if (item_type === 'accommodation') {
    // Find the target day's accommodation name, then update all days with the same name
    const targetDay = data.days.find((d: Record<string, unknown>) => d.day_number === day_number);
    if (!targetDay?.accommodation) {
      return NextResponse.json({ error: 'Accommodation not found' }, { status: 404 });
    }
    const accomName = (targetDay.accommodation as Record<string, unknown>).name;
    for (const d of data.days) {
      const acc = d.accommodation as Record<string, unknown> | undefined;
      if (acc && acc.name === accomName) {
        if (statusValue) {
          acc.status = statusValue;
        } else {
          delete acc.status;
        }
      }
    }
  } else {
    const day = data.days.find((d: Record<string, unknown>) => d.day_number === day_number);
    if (!day) {
      return NextResponse.json({ error: 'Day not found' }, { status: 404 });
    }

    const arr = item_type === 'transport'
      ? (day.transport as Array<Record<string, unknown>> | undefined)
      : (day.meals as Array<Record<string, unknown>> | undefined);

    if (!arr || !arr[item_index]) {
      return NextResponse.json({ error: `${item_type} at index ${item_index} not found` }, { status: 404 });
    }

    if (statusValue) {
      arr[item_index].status = statusValue;
    } else {
      delete arr[item_index].status;
    }
  }

  const { error: updateError } = await admin
    .from('trips')
    .update({ data, updated_at: new Date().toISOString() })
    .eq('id', id);

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  return NextResponse.json({ status: 'ok', new_status: new_status === 'booked' ? 'booked' : 'pending' });
}

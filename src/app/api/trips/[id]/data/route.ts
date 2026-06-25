import { NextResponse } from 'next/server';

import { createAdminClient } from '@/lib/supabase/admin';
import { requireTripChatAccess } from '@/lib/trip-chat/access';
import { normalizeTripData } from '@/lib/trip-data-normalize';
import { attachDownloadableTripDetails } from '@/lib/trip-details';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: tripId } = await params;
  const includeDetails =
    new URL(request.url).searchParams.get('include_details') === '1';
  const access = await requireTripChatAccess(tripId);
  if ('response' in access) return access.response;

  const admin = createAdminClient();
  const { data, error } = await admin
    .from('trips')
    .select('data, updated_at')
    .eq('id', tripId)
    .is('deleted_at', null)
    .single();

  if (error || !data) {
    return NextResponse.json(
      { error: error?.message ?? 'Trip not found' },
      { status: error ? 500 : 404 }
    );
  }

  const tripData = normalizeTripData(data.data);

  return NextResponse.json(
    {
      trip_data: includeDetails
        ? await attachDownloadableTripDetails(admin, tripId, tripData)
        : tripData,
      updated_at: data.updated_at,
    },
    {
      headers: {
        'Cache-Control': 'no-store',
      },
    }
  );
}

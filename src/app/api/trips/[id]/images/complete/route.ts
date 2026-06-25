import { NextRequest, NextResponse } from 'next/server';

import { createAdminClient } from '@/lib/supabase/admin';
import { requireTripChatAccess } from '@/lib/trip-chat/access';
import {
  completeMissingTripImagesForUser,
  TripServiceError,
} from '@/lib/trip-service';

// POST /api/trips/[id]/images/complete — owner/admin repair action.
// Fills missing trip/day hero photography without replacing existing images by default.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: tripId } = await params;
  const access = await requireTripChatAccess(tripId);
  if ('response' in access) return access.response;

  const body = await request.json().catch(() => ({}));
  const admin = createAdminClient();
  const { data: trip, error } = await admin
    .from('trips')
    .select('id, user_id')
    .eq('id', tripId)
    .is('deleted_at', null)
    .single();

  if (error || !trip) {
    return NextResponse.json(
      { error: error?.message ?? 'Trip not found' },
      { status: error ? 500 : 404 }
    );
  }

  try {
    const result = await completeMissingTripImagesForUser(
      admin,
      String(trip.user_id),
      tripId,
      {
        replace_existing: body?.replace_existing === true,
        include_overview: body?.include_overview !== false,
        max_updates:
          typeof body?.max_updates === 'number'
            ? body.max_updates
            : undefined,
      },
      request.nextUrl.origin
    );

    return NextResponse.json(result, {
      headers: {
        'Cache-Control': 'no-store',
      },
    });
  } catch (err) {
    if (err instanceof TripServiceError) {
      return NextResponse.json(
        { error: err.message, code: err.code, details: err.details },
        { status: err.status }
      );
    }

    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Image completion failed' },
      { status: 500 }
    );
  }
}

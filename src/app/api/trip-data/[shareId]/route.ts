import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import { scrubTripData } from '@/lib/scrub-trip';
import type { TripData } from '@/lib/types';

// GET /api/trip-data/[shareId] — Public, share-id read for offline use.
// Returns the same data the /t/[shareId] page renders. Cached by the
// service worker (TRIP_DATA_CACHE) so a saved trip can rehydrate even
// when the server is unreachable.
//
// Non-owners viewing a remix-mode trip get the PII-scrubbed body.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ shareId: string }> }
) {
  const { shareId } = await params;
  try {
    const admin = createAdminClient();
    const { data, error } = await admin
      .from('trips')
      .select('id, share_id, data, user_id, share_mode, updated_at')
      .eq('share_id', shareId)
      .in('share_mode', ['companion', 'remix'])
      .single();

    if (error || !data) {
      return NextResponse.json({ error: 'not-found' }, { status: 404 });
    }

    let isOwner = false;
    try {
      const supabase = await createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (user && user.id === data.user_id) isOwner = true;
    } catch { /* anonymous */ }

    const raw = data.data as TripData;
    const shareMode = (data.share_mode as 'companion' | 'remix') ?? 'companion';
    const body = !isOwner && shareMode === 'remix' ? scrubTripData(raw) : raw;

    return NextResponse.json(
      {
        share_id: data.share_id,
        share_mode: shareMode,
        data: body,
        updated_at: data.updated_at,
      },
      {
        headers: {
          'Cache-Control': 'public, max-age=60, stale-while-revalidate=86400',
        },
      }
    );
  } catch {
    return NextResponse.json({ error: 'server-error' }, { status: 500 });
  }
}

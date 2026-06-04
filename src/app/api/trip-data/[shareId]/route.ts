import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import { normalizeTripData } from '@/lib/trip-data-normalize';
import { scrubTripData } from '@/lib/scrub-trip';

// GET /api/trip-data/[shareId] — Public, share-id read for offline use.
// Returns the same data the /t/[shareId] page renders. The HTTP response
// itself must stay fresh after trip edits; explicit offline saves still use
// the service worker's TRIP_DATA_CACHE for rehydration when the server is
// unreachable.
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

    const raw = normalizeTripData(data.data);
    const shareMode = (data.share_mode as 'companion' | 'remix') ?? 'companion';
    const body = !isOwner && shareMode === 'remix'
      ? normalizeTripData(scrubTripData(raw))
      : raw;

    return NextResponse.json(
      {
        share_id: data.share_id,
        share_mode: shareMode,
        data: body,
        updated_at: data.updated_at,
      },
      {
        headers: {
          'Cache-Control': 'no-store, max-age=0, must-revalidate',
          'Pragma': 'no-cache',
          'Expires': '0',
          'Vary': 'Cookie',
        },
      }
    );
  } catch {
    return NextResponse.json({ error: 'server-error' }, { status: 500 });
  }
}

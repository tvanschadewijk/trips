import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';

// GET /api/trip-data/[shareId] — Public, share-id read for offline use.
// Returns the same data the /t/[shareId] page renders. Cached by the
// service worker (TRIP_DATA_CACHE) so a saved trip can rehydrate even
// when the server is unreachable.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ shareId: string }> }
) {
  const { shareId } = await params;
  try {
    const supabase = createAdminClient();
    const { data, error } = await supabase
      .from('trips')
      .select('id, share_id, data, updated_at')
      .eq('share_id', shareId)
      .eq('is_public', true)
      .single();

    if (error || !data) {
      return NextResponse.json({ error: 'not-found' }, { status: 404 });
    }

    return NextResponse.json(
      {
        share_id: data.share_id,
        data: data.data,
        updated_at: data.updated_at,
      },
      {
        headers: {
          // Allow short browser cache; SW handles long-term caching.
          'Cache-Control': 'public, max-age=60, stale-while-revalidate=86400',
        },
      }
    );
  } catch {
    return NextResponse.json({ error: 'server-error' }, { status: 500 });
  }
}

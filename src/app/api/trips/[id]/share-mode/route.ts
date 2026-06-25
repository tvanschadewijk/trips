import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import { recordTripMutationRevision, TripServiceError } from '@/lib/trip-service';

const VALID_MODES = ['private', 'companion', 'remix'] as const;
type ShareMode = (typeof VALID_MODES)[number];

// POST /api/trips/[id]/share-mode — Owner-only, session-auth.
// Body: { share_mode: 'private' | 'companion' | 'remix' }
//
// Switching to 'remix' makes the share link return a PII-scrubbed view
// to non-owners and surface the Remix CTA. Switching to 'private' makes
// the link 404. 'companion' is the default — link works, full data.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  const { id } = await params;
  const body = await request.json().catch(() => null);
  const next = body?.share_mode as ShareMode | undefined;

  if (!next || !VALID_MODES.includes(next)) {
    return NextResponse.json(
      { error: 'share_mode must be private, companion, or remix' },
      { status: 400 }
    );
  }

  const admin = createAdminClient();

  // Verify ownership first.
  const { data: trip, error: fetchErr } = await admin
    .from('trips')
    .select('*')
    .eq('id', id)
    .is('deleted_at', null)
    .single();

  if (fetchErr || !trip) {
    return NextResponse.json({ error: 'Trip not found' }, { status: 404 });
  }
  if (trip.user_id !== user.id) {
    return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
  }

  const updatedAt = new Date().toISOString();
  try {
    await recordTripMutationRevision(admin, {
      tripId: id,
      userId: user.id,
      source: 'api',
      action: 'share_mode',
      tool: 'update_share_mode',
      changedPaths: ['share_mode'],
      input: { share_mode: next },
      beforeRecord: trip,
      afterRecord: {
        ...trip,
        share_mode: next,
        updated_at: updatedAt,
      },
    });
  } catch (err) {
    if (err instanceof TripServiceError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json({ error: 'Failed to record trip revision' }, { status: 500 });
  }

  const { error: updateErr } = await admin
    .from('trips')
    .update({ share_mode: next, updated_at: updatedAt })
    .eq('id', id)
    .is('deleted_at', null);

  if (updateErr) {
    return NextResponse.json({ error: updateErr.message }, { status: 500 });
  }

  return NextResponse.json({ status: 'ok', share_mode: next });
}

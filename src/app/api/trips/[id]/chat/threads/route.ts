/**
 * GET /api/trips/[id]/chat/threads — list the caller's chat threads for this
 * trip, newest first. Threads are created implicitly by POST /chat without a
 * thread_id, so there is deliberately no POST here.
 */
import { NextResponse } from 'next/server';

import { createAdminClient } from '@/lib/supabase/admin';
import { requireTripChatAccess } from '@/lib/trip-chat/access';
import { listThreads } from '@/lib/trip-chat/threads';

export const runtime = 'nodejs';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: tripId } = await params;
  const access = await requireTripChatAccess(tripId);
  if ('response' in access) return access.response;

  const admin = createAdminClient();
  const threads = await listThreads(admin, { tripId, userId: access.userId });
  return NextResponse.json({ threads });
}

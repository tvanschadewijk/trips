/**
 * PATCH  /api/trips/[id]/chat/threads/[threadId] — rename a thread.
 * DELETE /api/trips/[id]/chat/threads/[threadId] — delete a thread
 *         (messages + usage rows cascade via FK).
 *
 * Both are scoped to the caller's own threads on this trip; the helpers
 * filter on (id, trip_id, user_id) so a foreign threadId is a no-op 404.
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { createAdminClient } from '@/lib/supabase/admin';
import { requireTripChatAccess } from '@/lib/trip-chat/access';
import { deleteThread, findThread, renameThread } from '@/lib/trip-chat/threads';

export const runtime = 'nodejs';

const PatchSchema = z.object({
  title: z.string().min(1).max(80),
});

interface RouteParams {
  params: Promise<{ id: string; threadId: string }>;
}

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  const { id: tripId, threadId } = await params;
  const access = await requireTripChatAccess(tripId);
  if ('response' in access) return access.response;

  let body: z.infer<typeof PatchSchema>;
  try {
    body = PatchSchema.parse(await request.json());
  } catch (err) {
    return NextResponse.json(
      { error: 'Invalid body', detail: err instanceof Error ? err.message : String(err) },
      { status: 400 }
    );
  }

  const admin = createAdminClient();
  const scope = { tripId, userId: access.userId };
  if (!(await findThread(admin, scope, threadId))) {
    return NextResponse.json({ error: 'Thread not found' }, { status: 404 });
  }

  const title = body.title.trim();
  if (!title || !(await renameThread(admin, scope, threadId, title))) {
    return NextResponse.json({ error: 'Failed to rename thread' }, { status: 500 });
  }
  return NextResponse.json({ ok: true, title });
}

export async function DELETE(_request: NextRequest, { params }: RouteParams) {
  const { id: tripId, threadId } = await params;
  const access = await requireTripChatAccess(tripId);
  if ('response' in access) return access.response;

  const admin = createAdminClient();
  const scope = { tripId, userId: access.userId };
  if (!(await findThread(admin, scope, threadId))) {
    return NextResponse.json({ error: 'Thread not found' }, { status: 404 });
  }

  if (!(await deleteThread(admin, scope, threadId))) {
    return NextResponse.json({ error: 'Failed to delete thread' }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

const PatchBodySchema = z.object({
  status: z.enum(['draft', 'queued', 'running', 'completed', 'failed']),
  chat_thread_id: z.string().uuid().nullable().optional(),
  turn_index: z.number().int().nonnegative().nullable().optional(),
  error: z.string().max(2000).nullable().optional(),
});

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  const parsed = PatchBodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid generation update', detail: parsed.error.message },
      { status: 400 }
    );
  }

  const body = parsed.data;
  const now = new Date().toISOString();
  const admin = createAdminClient();
  const { data, error } = await admin
    .from('trip_generation_sessions')
    .update({
      status: body.status,
      ...(body.chat_thread_id !== undefined ? { chat_thread_id: body.chat_thread_id } : {}),
      ...(body.turn_index !== undefined ? { turn_index: body.turn_index } : {}),
      ...(body.error !== undefined ? { error: body.error } : {}),
      updated_at: now,
      ...(body.status === 'completed' ? { completed_at: now } : {}),
    })
    .eq('id', id)
    .eq('user_id', user.id)
    .select('id, status, trip_id, chat_thread_id, turn_index, error, updated_at, completed_at')
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: 'Generation session not found' }, { status: 404 });
  }

  return NextResponse.json({ generation: data });
}

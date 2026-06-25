/**
 * Shared auth gate for all trip-chat API routes (chat turns + thread CRUD).
 * Extracted from the chat route so the thread routes enforce the identical
 * rule: trip owner, or admin (support), nobody else.
 */
import { NextResponse } from 'next/server';

import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';

async function isAdmin(userId: string): Promise<boolean> {
  const supabase = createAdminClient();
  const { data } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', userId)
    .single();
  return data?.role === 'admin';
}

async function isOwner(userId: string, tripId: string): Promise<boolean> {
  const supabase = createAdminClient();
  const { data } = await supabase
    .from('trips')
    .select('user_id')
    .eq('id', tripId)
    .is('deleted_at', null)
    .single();
  return data?.user_id === userId;
}

export async function requireTripChatAccess(
  tripId: string
): Promise<{ userId: string } | { response: NextResponse }> {
  const serverClient = await createClient();
  const {
    data: { user },
  } = await serverClient.auth.getUser();
  if (!user) {
    return {
      response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
    };
  }

  // Trip owner can edit their own trip via chat. Admins can edit any
  // trip (for support). Anyone else: forbidden.
  const [ownerOk, adminOk] = await Promise.all([
    isOwner(user.id, tripId),
    isAdmin(user.id),
  ]);
  if (!ownerOk && !adminOk) {
    return {
      response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }),
    };
  }

  return { userId: user.id };
}

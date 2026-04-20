/**
 * Server-side helpers for the trip-chat feature. Read-only — writes happen
 * in the API route.
 */
import { createAdminClient } from '@/lib/supabase/admin';
import type { ToolCallSummary } from './prompt';

export interface UiChatMessage {
  id: string;
  turn_index: number;
  role: 'user' | 'assistant';
  content: string;
  tool_calls_json: ToolCallSummary[] | null;
  created_at: string;
}

/**
 * Check admin status by user id. Mirrors the existing inline `isAdmin` in
 * src/app/api/admin/analytics/route.ts — factored here for reuse.
 */
export async function checkIsAdmin(userId: string): Promise<boolean> {
  const admin = createAdminClient();
  const { data } = await admin
    .from('profiles')
    .select('role')
    .eq('id', userId)
    .single();
  return data?.role === 'admin';
}

/**
 * Load the last N messages for a (trip, user) chat session. Returns empty
 * array if no session exists yet. Ordered oldest→newest for rendering.
 */
export async function loadChatHistory(
  tripId: string,
  userId: string,
  limit: number = 50
): Promise<UiChatMessage[]> {
  const admin = createAdminClient();
  const { data: session } = await admin
    .from('trip_chat_sessions')
    .select('id')
    .eq('trip_id', tripId)
    .eq('user_id', userId)
    .maybeSingle();
  if (!session) return [];

  // Fetch the last N turns (= ~2N rows), then sort oldest→newest within a turn
  // rendering user before assistant regardless of alphabetical order.
  const { data: rows } = await admin
    .from('trip_chat_messages')
    .select('id, turn_index, role, content, tool_calls_json, created_at')
    .eq('session_id', session.id)
    .order('turn_index', { ascending: false })
    .limit(limit * 2);

  if (!rows) return [];

  const roleOrder: Record<string, number> = { user: 0, assistant: 1 };
  return rows
    .sort((a, b) =>
      a.turn_index === b.turn_index
        ? roleOrder[a.role] - roleOrder[b.role]
        : a.turn_index - b.turn_index
    )
    .map((r) => ({
      id: r.id,
      turn_index: r.turn_index,
      role: r.role as 'user' | 'assistant',
      content: r.content,
      tool_calls_json: (r.tool_calls_json ?? null) as ToolCallSummary[] | null,
      created_at: r.created_at,
    }));
}

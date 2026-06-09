/**
 * Server-side helpers for the trip-chat feature. Read-only — writes happen
 * in the API route.
 */
import { createAdminClient } from '@/lib/supabase/admin';
import type { ToolCallSummary } from './prompt';
import { listThreads } from './threads';
import type { ChatThreadSummary } from './thread-utils';

export interface UiChatMessage {
  id: string;
  turn_index: number;
  role: 'user' | 'assistant';
  content: string;
  tool_calls_json: ToolCallSummary[] | null;
  created_at: string;
}

export interface InitialChatBundle {
  threads: ChatThreadSummary[];
  /** Newest thread, if any. The client decides at open time whether it is
   *  stale (>24h idle) and should be left in the sidebar in favor of a
   *  fresh conversation. */
  activeThreadId: string | null;
  /** Messages of the newest thread, oldest→newest. */
  messages: UiChatMessage[];
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
 * Initial payload for the chat panel: thread list (newest first) plus the
 * newest thread's messages. Replaces the pre-thread single-session
 * `loadChatHistory`.
 */
export async function loadInitialChatBundle(
  tripId: string,
  userId: string,
  limit: number = 50
): Promise<InitialChatBundle> {
  const admin = createAdminClient();
  const threads = await listThreads(admin, { tripId, userId });
  if (threads.length === 0) {
    return { threads: [], activeThreadId: null, messages: [] };
  }

  const newest = threads[0];
  const { data: rows } = await admin
    .from('trip_chat_messages')
    .select('id, turn_index, role, content, tool_calls_json, created_at')
    .eq('session_id', newest.id)
    .order('turn_index', { ascending: false })
    .limit(limit * 2);

  const roleOrder: Record<string, number> = { user: 0, assistant: 1 };
  const messages = (rows ?? [])
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

  return { threads, activeThreadId: newest.id, messages };
}

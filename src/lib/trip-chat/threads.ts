/**
 * Server-side thread persistence. A thread is a trip_chat_sessions row;
 * see supabase/migrations/010_trip_chat_threads.sql.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { ChatThreadSummary } from './thread-utils';
import { deriveThreadTitleHeuristic } from './thread-title';

interface ThreadScope {
  tripId: string;
  userId: string;
}

/**
 * List threads newest-first. Rows from before the threads migration have no
 * title; backfill one from their first user message so the sidebar never
 * shows an untitled row (write-on-read, runs at most once per legacy row).
 */
export async function listThreads(
  admin: SupabaseClient,
  { tripId, userId }: ThreadScope
): Promise<ChatThreadSummary[]> {
  const { data } = await admin
    .from('trip_chat_sessions')
    .select('id, title, created_at, updated_at')
    .eq('trip_id', tripId)
    .eq('user_id', userId)
    .order('updated_at', { ascending: false });

  const rows = data ?? [];
  const backfilled = await Promise.all(
    rows.map(async (row) => {
      const title = typeof row.title === 'string' ? row.title.trim() : '';
      if (title) return { ...row, title };
      const fallback = await backfillLegacyTitle(admin, row.id);
      return { ...row, title: fallback };
    })
  );

  return backfilled.map((row) => ({
    id: row.id,
    title: row.title,
    created_at: row.created_at,
    updated_at: row.updated_at,
  }));
}

async function backfillLegacyTitle(
  admin: SupabaseClient,
  threadId: string
): Promise<string> {
  const { data: firstUserMessage } = await admin
    .from('trip_chat_messages')
    .select('content')
    .eq('session_id', threadId)
    .eq('role', 'user')
    .order('turn_index', { ascending: true })
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();

  const title = firstUserMessage?.content
    ? deriveThreadTitleHeuristic(firstUserMessage.content)
    : 'Earlier conversation';

  // Best-effort persist; listing must not fail on a write hiccup.
  await admin
    .from('trip_chat_sessions')
    .update({ title })
    .eq('id', threadId)
    .is('title', null);

  return title;
}

export async function createThread(
  admin: SupabaseClient,
  { tripId, userId }: ThreadScope,
  title: string
): Promise<{ id: string } | { error: string }> {
  const { data, error } = await admin
    .from('trip_chat_sessions')
    .insert({ trip_id: tripId, user_id: userId, title })
    .select('id')
    .single();
  if (error || !data) {
    return { error: error?.message ?? 'insert returned no row' };
  }
  return { id: data.id };
}

/** Fetch one thread, scoped to (trip, user) so a caller can never address someone else's. */
export async function findThread(
  admin: SupabaseClient,
  { tripId, userId }: ThreadScope,
  threadId: string
): Promise<{ id: string; turn_count: number | null } | null> {
  const { data } = await admin
    .from('trip_chat_sessions')
    .select('id, turn_count')
    .eq('id', threadId)
    .eq('trip_id', tripId)
    .eq('user_id', userId)
    .maybeSingle();
  return data ?? null;
}

/** Most recently active thread, or null if the user has none for this trip. */
export async function latestThread(
  admin: SupabaseClient,
  { tripId, userId }: ThreadScope
): Promise<{ id: string; turn_count: number | null; updated_at: string } | null> {
  const { data } = await admin
    .from('trip_chat_sessions')
    .select('id, turn_count, updated_at')
    .eq('trip_id', tripId)
    .eq('user_id', userId)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  return data ?? null;
}

/** Update a thread's title (user rename, or async LLM polish after creation). */
export async function renameThread(
  admin: SupabaseClient,
  { tripId, userId }: ThreadScope,
  threadId: string,
  title: string
): Promise<boolean> {
  const { error } = await admin
    .from('trip_chat_sessions')
    .update({ title })
    .eq('id', threadId)
    .eq('trip_id', tripId)
    .eq('user_id', userId);
  return !error;
}

/** Delete a thread; messages and usage rows cascade via FK. */
export async function deleteThread(
  admin: SupabaseClient,
  { tripId, userId }: ThreadScope,
  threadId: string
): Promise<boolean> {
  const { error } = await admin
    .from('trip_chat_sessions')
    .delete()
    .eq('id', threadId)
    .eq('trip_id', tripId)
    .eq('user_id', userId);
  return !error;
}

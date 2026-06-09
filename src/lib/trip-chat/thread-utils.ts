/**
 * Client-safe thread helpers: types, staleness, recency grouping.
 *
 * No server imports here — TripChatPanel (a client component) shares these
 * with the API routes so both sides agree on what "stale" means.
 */

export interface ChatThreadSummary {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
}

/**
 * A thread idle for longer than this is considered finished: opening the
 * chat starts a fresh conversation instead of resuming it. The old thread
 * stays in the sidebar.
 */
export const THREAD_STALE_AFTER_MS = 24 * 60 * 60 * 1000;

export function isThreadStale(
  updatedAt: string | Date,
  now: number = Date.now()
): boolean {
  const t = typeof updatedAt === 'string' ? Date.parse(updatedAt) : updatedAt.getTime();
  if (!Number.isFinite(t)) return true;
  return now - t > THREAD_STALE_AFTER_MS;
}

export type ThreadRecencyGroup = 'Today' | 'Yesterday' | 'This week' | 'Earlier';

const THREAD_GROUP_ORDER: ThreadRecencyGroup[] = [
  'Today',
  'Yesterday',
  'This week',
  'Earlier',
];

export function threadRecencyGroup(
  updatedAt: string,
  now: number = Date.now()
): ThreadRecencyGroup {
  const t = Date.parse(updatedAt);
  if (!Number.isFinite(t)) return 'Earlier';

  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  const dayMs = 24 * 60 * 60 * 1000;

  if (t >= startOfToday.getTime()) return 'Today';
  if (t >= startOfToday.getTime() - dayMs) return 'Yesterday';
  if (t >= startOfToday.getTime() - 6 * dayMs) return 'This week';
  return 'Earlier';
}

/**
 * Group threads (already sorted newest-first) into ordered recency buckets
 * for the sidebar. Empty groups are omitted.
 */
export function groupThreadsByRecency(
  threads: ChatThreadSummary[],
  now: number = Date.now()
): Array<{ group: ThreadRecencyGroup; threads: ChatThreadSummary[] }> {
  const byGroup = new Map<ThreadRecencyGroup, ChatThreadSummary[]>();
  for (const thread of threads) {
    const group = threadRecencyGroup(thread.updated_at, now);
    const list = byGroup.get(group) ?? [];
    list.push(thread);
    byGroup.set(group, list);
  }
  return THREAD_GROUP_ORDER.filter((g) => byGroup.has(g)).map((group) => ({
    group,
    threads: byGroup.get(group)!,
  }));
}

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
  context_key?: string | null;
  context_label?: string | null;
}

export interface ThreadViewContext {
  slideKind?: string | null;
  day_number?: number | null;
  date?: string | null;
  title?: string | null;
  destination_id?: string | null;
  destination_title?: string | null;
  candidate_id?: string | null;
  candidate_name?: string | null;
}

export interface ThreadContext {
  key: string;
  label: string;
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

function compactText(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const text = value.replace(/\s+/g, ' ').trim();
  return text || null;
}

function slugPart(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}

function shortDateLabel(isoDate: string | null | undefined): string | null {
  if (!isoDate || !/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) return null;
  const date = new Date(`${isoDate}T12:00:00Z`);
  if (!Number.isFinite(date.getTime())) return null;
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  }).format(date);
}

export function threadContextForViewContext(
  ctx: ThreadViewContext | null | undefined
): ThreadContext | null {
  if (!ctx) return null;

  if (ctx.slideKind === 'day' && typeof ctx.day_number === 'number') {
    const dayNumber = Math.floor(ctx.day_number);
    if (dayNumber < 1) return null;
    const date = shortDateLabel(ctx.date);
    return {
      key: `day:${dayNumber}`,
      label: date ? `Day ${dayNumber} · ${date}` : `Day ${dayNumber}`,
    };
  }

  if (ctx.slideKind === 'cover') {
    return { key: 'overview', label: 'Overview' };
  }

  if (ctx.slideKind === 'accommodation_review') {
    const destination =
      compactText(ctx.destination_id) ??
      (ctx.destination_title ? slugPart(ctx.destination_title) : null) ??
      'all';
    const label = compactText(ctx.destination_title);
    return {
      key: `accommodation_review:${destination}`,
      label: label ? `Hotels · ${label}` : 'Hotels',
    };
  }

  return null;
}

export function inferThreadContextFromTitle(title: string | null | undefined): ThreadContext | null {
  const text = compactText(title);
  if (!text) return null;
  const dayMatch = /^Day\s+(\d+)\s*·/i.exec(text);
  if (dayMatch) {
    const dayNumber = Number(dayMatch[1]);
    if (Number.isInteger(dayNumber) && dayNumber > 0) {
      return { key: `day:${dayNumber}`, label: `Day ${dayNumber}` };
    }
  }
  if (/^Hotels\s*·/i.test(text)) return { key: 'accommodation_review:all', label: 'Hotels' };
  return null;
}

export function threadContextForThread(
  thread: Pick<ChatThreadSummary, 'title' | 'context_key' | 'context_label'>
): ThreadContext | null {
  const explicitKey = compactText(thread.context_key);
  if (explicitKey) {
    const label =
      compactText(thread.context_label) ??
      inferThreadContextFromTitle(thread.title)?.label ??
      explicitKey;
    return { key: explicitKey, label };
  }
  return inferThreadContextFromTitle(thread.title);
}

export function isThreadCompatibleWithViewContext(
  thread: Pick<ChatThreadSummary, 'title' | 'context_key' | 'context_label'>,
  viewContext: ThreadViewContext | null | undefined
): boolean {
  const desired = threadContextForViewContext(viewContext);
  if (!desired) return true;
  const actual = threadContextForThread(thread);
  return actual?.key === desired.key;
}

export interface ChatSendTarget {
  threadId: string | null;
  viewContext: ThreadViewContext | null;
  context: ThreadContext | null;
}

/**
 * Resolve where the next user message should go. The important invariant:
 * once a thread is visible in the chat panel, pressing Send must continue
 * that thread. View context may change while the sheet is open, but context
 * drift must never silently turn a reply into a new thread.
 */
export function resolveChatSendTarget({
  activeThreadId,
  activeThread,
  viewContext,
}: {
  activeThreadId: string | null;
  activeThread?: Pick<ChatThreadSummary, 'title' | 'context_key' | 'context_label'> | null;
  viewContext: ThreadViewContext | null | undefined;
}): ChatSendTarget {
  const currentViewContext = viewContext ?? null;

  if (!activeThreadId) {
    return {
      threadId: null,
      viewContext: currentViewContext,
      context: threadContextForViewContext(currentViewContext),
    };
  }

  const threadContext = activeThread ? threadContextForThread(activeThread) : null;
  const contextStillMatches =
    !activeThread || isThreadCompatibleWithViewContext(activeThread, currentViewContext);
  const effectiveViewContext = contextStillMatches ? currentViewContext : null;

  return {
    threadId: activeThreadId,
    viewContext: effectiveViewContext,
    context: threadContextForViewContext(effectiveViewContext) ?? threadContext,
  };
}

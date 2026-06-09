'use client';

/**
 * Owner/admin chat panel for editing a trip in place.
 *
 * Three states: closed (entry pill), open (iOS share-sheet style),
 * minimized (status pill while a turn is in flight). Animations via
 * motion/react.
 *
 * Conversations are organized into THREADS, ChatGPT-style:
 *
 *   - A hideable rail (PanelLeft toggle in the header) lists threads
 *     grouped by recency; "New chat" starts a fresh one.
 *   - Threads are created server-side on the first message and titled from
 *     that message + the day the user was viewing (see thread-title.ts).
 *   - A thread idle for >24h is treated as finished: opening the chat
 *     starts fresh instead of resuming it (the old thread stays in the rail).
 *
 * Posts to /api/trips/[id]/chat (with thread_id). On a successful response
 * with tool calls, triggers a router.refresh() so the trip view picks up
 * the edits.
 *
 * Styling follows the editorial design system in DESIGN.md: warm paper
 * surfaces, Fraunces serif for display, Inter for UI, terracotta accent.
 */
import { useState, useRef, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { AnimatePresence, motion, useDragControls } from 'motion/react';
import {
  Check,
  MessageCircle,
  PanelLeft,
  PanelLeftClose,
  Pencil,
  SendHorizontal,
  SquarePen,
  Trash2,
  X,
} from 'lucide-react';
import type { ToolCallSummary } from '@/lib/trip-chat/prompt';
import {
  DEFAULT_CHAT_STATUS_PHASES,
  getChatStatusPhases,
} from '@/lib/trip-chat/progress';
import {
  groupThreadsByRecency,
  isThreadStale,
  type ChatThreadSummary,
} from '@/lib/trip-chat/thread-utils';
import { useOnlineStatus } from '@/lib/online-status';
import { renderTripMarkdown } from '@/lib/render-trip-markdown';

export interface ChatMessage {
  id: string;
  turn_index: number;
  role: 'user' | 'assistant';
  content: string;
  tool_calls_json: ToolCallSummary[] | null;
  pending?: boolean;
}

interface Props {
  tripId: string;
  initialThreads: ChatThreadSummary[];
  initialThreadId: string | null;
  initialMessages: ChatMessage[];
}

type PanelState = 'closed' | 'open' | 'minimized';

// iOS 26-style spring — slight overshoot, lively. Borrowed from the
// preppy AssistantOverlay; gives the sheet/pill transitions the right feel.
const overlaySpring = {
  type: 'spring' as const,
  damping: 22,
  stiffness: 380,
  mass: 0.7,
};

const KEYBOARD_INSET_THRESHOLD = 100;
const CHAT_POLL_INTERVAL_MS = 2400;
const CHAT_POLL_TIMEOUT_MS = 305_000;
const CHAT_HISTORY_LIMIT = 50;
const RAIL_PREF_STORAGE_KEY = 'trip-chat-rail-open';
const MOBILE_RAIL_QUERY = '(max-width: 719px)';

type ChatTurnResponse = {
  status?: 'queued' | 'fast_lane';
  assistant_message: string | null;
  session_id: string | null;
  thread_id?: string | null;
  thread_title?: string | null;
  tool_calls_summary: ToolCallSummary[];
  turn_index: number;
};

type ChatHistoryResponse = {
  messages: ChatMessage[];
  thread_id?: string | null;
};

type ThreadListResponse = {
  threads: ChatThreadSummary[];
};

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isLikelyDroppedFetch(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  return /load failed|failed to fetch|networkerror|cancelled|canceled|aborted/i.test(err.message);
}

function userFacingChatError(err: unknown): string {
  if (isLikelyDroppedFetch(err)) {
    return 'The connection dropped while the travel expert was working. Reopen this trip in a moment; if the answer finished, it will appear here.';
  }
  return err instanceof Error ? err.message : String(err);
}

function isMobileRail(): boolean {
  return typeof window !== 'undefined' && window.matchMedia(MOBILE_RAIL_QUERY).matches;
}

function notifyTripEditApplied(tripId: string) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(
    new CustomEvent('ourtrips:accommodation-review-updated', {
      detail: { tripId },
    })
  );
}

async function fetchChatHistory(
  tripId: string,
  threadId: string | null
): Promise<ChatMessage[]> {
  const threadParam = threadId ? `&thread_id=${encodeURIComponent(threadId)}` : '';
  const res = await fetch(
    `/api/trips/${tripId}/chat?limit=${CHAT_HISTORY_LIMIT}${threadParam}`,
    { cache: 'no-store' }
  );
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const headline = body.error ?? `HTTP ${res.status}`;
    throw new Error(body.detail ? `${headline} — ${body.detail}` : headline);
  }
  const json = (await res.json()) as ChatHistoryResponse;
  return json.messages;
}

async function fetchThreads(tripId: string): Promise<ChatThreadSummary[]> {
  const res = await fetch(`/api/trips/${tripId}/chat/threads`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = (await res.json()) as ThreadListResponse;
  return json.threads;
}

async function pollForAssistant(
  tripId: string,
  threadId: string,
  turnIndex: number
): Promise<{ messages: ChatMessage[]; assistant: ChatMessage }> {
  const started = Date.now();
  let lastMessages: ChatMessage[] | null = null;

  while (Date.now() - started < CHAT_POLL_TIMEOUT_MS) {
    try {
      const messages = await fetchChatHistory(tripId, threadId);
      lastMessages = messages;
      const assistant = messages.find(
        (m) => m.role === 'assistant' && m.turn_index === turnIndex
      );
      if (assistant) return { messages, assistant };
    } catch {
      // The original failure mode is a transient dropped request. Keep polling
      // within the server-side maxDuration window before surfacing an error.
    }
    await sleep(CHAT_POLL_INTERVAL_MS);
  }

  if (lastMessages) {
    const assistant = lastMessages.find(
      (m) => m.role === 'assistant' && m.turn_index === turnIndex
    );
    if (assistant) return { messages: lastMessages, assistant };
  }

  throw new Error(
    'The travel expert is taking longer than expected. Reopen this trip in a moment; if it finishes, the answer will appear here.'
  );
}

export default function TripChatPanel({
  tripId,
  initialThreads,
  initialThreadId,
  initialMessages,
}: Props) {
  const router = useRouter();
  const online = useOnlineStatus();
  const [state, setState] = useState<PanelState>('closed');
  const [threads, setThreads] = useState<ChatThreadSummary[]>(initialThreads);
  // Auto-new-chat: if the newest thread has been idle >24h, open fresh.
  // Render output while 'closed' is identical either way, so the SSR/client
  // boundary can disagree on staleness without a hydration mismatch.
  const [activeThreadId, setActiveThreadId] = useState<string | null>(() => {
    if (!initialThreadId) return null;
    const thread = initialThreads.find((t) => t.id === initialThreadId);
    if (!thread || isThreadStale(thread.updated_at)) return null;
    return initialThreadId;
  });
  const [messages, setMessages] = useState<ChatMessage[]>(
    activeThreadId ? initialMessages : []
  );
  const [railOpen, setRailOpen] = useState(false);
  const [threadLoading, setThreadLoading] = useState(false);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statusIdx, setStatusIdx] = useState(0);
  const [statusPhases, setStatusPhases] = useState<readonly string[]>(
    DEFAULT_CHAT_STATUS_PHASES
  );
  const [unread, setUnread] = useState(false);
  const [keyboardInset, setKeyboardInset] = useState(0);
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const sheetRef = useRef<HTMLDivElement | null>(null);
  const activeThreadIdRef = useRef<string | null>(activeThreadId);
  const dragControls = useDragControls();

  useEffect(() => {
    activeThreadIdRef.current = activeThreadId;
  }, [activeThreadId]);

  // Restore the rail visibility preference (desktop users tend to keep it).
  useEffect(() => {
    try {
      if (localStorage.getItem(RAIL_PREF_STORAGE_KEY) === '1' && !isMobileRail()) {
        setRailOpen(true);
      }
    } catch {}
  }, []);

  // Auto-scroll within the messages container only.
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  }, [messages.length, loading]);

  useEffect(() => {
    if (state === 'open') inputRef.current?.focus();
  }, [state]);

  // Track the iOS keyboard via visualViewport. When the textarea is
  // focused and the keyboard is up, we lift the sheet by that inset so
  // the input stays above it. Borrowed from preppy/AssistantOverlay.
  useEffect(() => {
    if (typeof window === 'undefined' || !window.visualViewport) return;
    const vv = window.visualViewport;
    let raf: number | null = null;
    const update = () => {
      raf = null;
      const obscured = Math.max(
        0,
        Math.round(window.innerHeight - (vv.height + Math.max(0, vv.offsetTop))),
      );
      const focusedInsideSheet =
        !!sheetRef.current &&
        document.activeElement instanceof HTMLElement &&
        sheetRef.current.contains(document.activeElement);
      const next = focusedInsideSheet && obscured > KEYBOARD_INSET_THRESHOLD ? obscured : 0;
      setKeyboardInset((prev) => (prev === next ? prev : next));
    };
    const schedule = () => {
      if (raf === null) raf = window.requestAnimationFrame(update);
    };
    update();
    vv.addEventListener('resize', schedule);
    vv.addEventListener('scroll', schedule);
    window.addEventListener('focusin', schedule);
    window.addEventListener('focusout', schedule);
    return () => {
      vv.removeEventListener('resize', schedule);
      vv.removeEventListener('scroll', schedule);
      window.removeEventListener('focusin', schedule);
      window.removeEventListener('focusout', schedule);
      if (raf !== null) window.cancelAnimationFrame(raf);
    };
  }, [state]);

  // Rotate status text while waiting for the agent. Cheap proxy for real
  // streamed status — shows the user the turn is progressing.
  useEffect(() => {
    if (!loading) {
      setStatusIdx(0);
      return;
    }
    const delays = [4500, 6000, 8000];
    const timers: ReturnType<typeof setTimeout>[] = [];
    let cumulative = 0;
    for (let i = 0; i < statusPhases.length - 1; i++) {
      cumulative += delays[i] ?? 8000;
      timers.push(setTimeout(() => setStatusIdx(i + 1), cumulative));
    }
    return () => {
      timers.forEach(clearTimeout);
    };
  }, [loading, statusPhases]);

  const refreshThreads = useCallback(async () => {
    try {
      const fresh = await fetchThreads(tripId);
      setThreads(fresh);
      // The active thread may have been deleted from another device.
      const current = activeThreadIdRef.current;
      if (current && !fresh.some((t) => t.id === current)) {
        setActiveThreadId(null);
        setMessages([]);
      }
    } catch {
      // Sidebar refresh is cosmetic; never surface as a chat error.
    }
  }, [tripId]);

  const startNewChat = useCallback(() => {
    setActiveThreadId(null);
    setMessages([]);
    setError(null);
    setConfirmDeleteId(null);
    setRenamingId(null);
    if (isMobileRail()) setRailOpen(false);
    inputRef.current?.focus();
  }, []);

  // Open the panel — clears unread badge, rolls a stale conversation over
  // into a fresh one (the old thread stays in the rail).
  const openPanel = useCallback(() => {
    setState('open');
    setUnread(false);
    if (!loading && activeThreadIdRef.current) {
      const thread = threads.find((t) => t.id === activeThreadIdRef.current);
      if (thread && isThreadStale(thread.updated_at)) {
        setActiveThreadId(null);
        setMessages([]);
        setError(null);
      }
    }
  }, [loading, threads]);

  const minimize = useCallback(() => {
    setState('minimized');
  }, []);

  const close = useCallback(() => {
    setState('closed');
    setUnread(false);
  }, []);

  const toggleRail = useCallback(() => {
    setRailOpen((open) => {
      const next = !open;
      try {
        localStorage.setItem(RAIL_PREF_STORAGE_KEY, next ? '1' : '0');
      } catch {}
      return next;
    });
  }, []);

  const selectThread = useCallback(
    async (threadId: string) => {
      if (threadLoading) return;
      setConfirmDeleteId(null);
      setRenamingId(null);
      if (threadId === activeThreadIdRef.current) {
        if (isMobileRail()) setRailOpen(false);
        return;
      }
      setThreadLoading(true);
      setError(null);
      try {
        const threadMessages = await fetchChatHistory(tripId, threadId);
        setActiveThreadId(threadId);
        setMessages(threadMessages);
        if (isMobileRail()) setRailOpen(false);
        inputRef.current?.focus();
      } catch (err) {
        setError(userFacingChatError(err));
      } finally {
        setThreadLoading(false);
      }
    },
    [threadLoading, tripId]
  );

  const deleteThread = useCallback(
    async (threadId: string) => {
      setConfirmDeleteId(null);
      try {
        const res = await fetch(`/api/trips/${tripId}/chat/threads/${threadId}`, {
          method: 'DELETE',
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        setThreads((prev) => prev.filter((t) => t.id !== threadId));
        if (activeThreadIdRef.current === threadId) {
          setActiveThreadId(null);
          setMessages([]);
        }
      } catch (err) {
        setError(userFacingChatError(err));
      }
    },
    [tripId]
  );

  const commitRename = useCallback(
    async (threadId: string) => {
      const title = renameDraft.trim();
      setRenamingId(null);
      if (!title) return;
      const previous = threads.find((t) => t.id === threadId)?.title;
      if (title === previous) return;
      setThreads((prev) =>
        prev.map((t) => (t.id === threadId ? { ...t, title } : t))
      );
      try {
        const res = await fetch(`/api/trips/${tripId}/chat/threads/${threadId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
      } catch {
        // Roll back the optimistic rename.
        setThreads((prev) =>
          prev.map((t) =>
            t.id === threadId && previous ? { ...t, title: previous } : t
          )
        );
      }
    },
    [renameDraft, threads, tripId]
  );

  const finishTurn = useCallback(
    (threadId: string, serverMessages: ChatMessage[], assistant: ChatMessage) => {
      // Only swap the transcript if the user is still on that thread.
      if (activeThreadIdRef.current === threadId) {
        setMessages(serverMessages);
      }

      // If the user collapsed mid-turn, mark unread.
      setState((s) => {
        if (s === 'minimized') setUnread(true);
        return s;
      });

      // Pick up the async LLM-polished title (and fresh updated_at ordering).
      void refreshThreads();

      if ((assistant.tool_calls_json?.length ?? 0) > 0) {
        notifyTripEditApplied(tripId);
        router.refresh();
      }
    },
    [refreshThreads, router, tripId]
  );

  async function send() {
    const trimmed = input.trim();
    if (!trimmed || loading || threadLoading) return;
    setError(null);
    setStatusPhases(getChatStatusPhases(trimmed));

    const threadIdAtSend = activeThreadId;
    const nextTurnIndex =
      messages.length === 0 ? 0 : Math.max(...messages.map((m) => m.turn_index)) + 1;

    const optimisticUser: ChatMessage = {
      id: `optimistic-${Date.now()}`,
      turn_index: nextTurnIndex,
      role: 'user',
      content: trimmed,
      tool_calls_json: null,
    };
    setMessages((prev) => [...prev, optimisticUser]);
    setInput('');
    setLoading(true);

    // Snapshot the current view context (which day is open) so the
    // agent answers in the right scope without re-asking the user.
    let viewContext: unknown = null;
    try {
      const raw = sessionStorage.getItem('trip-chat-context');
      if (raw) viewContext = JSON.parse(raw);
    } catch {}

    try {
      const res = await fetch(`/api/trips/${tripId}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: trimmed,
          thread_id: threadIdAtSend,
          view_context: viewContext,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        const headline = body.error ?? `HTTP ${res.status}`;
        throw new Error(body.detail ? `${headline} — ${body.detail}` : headline);
      }
      const json = (await res.json()) as ChatTurnResponse;

      // The server creates the thread on the first message; adopt it.
      const threadId = json.thread_id ?? threadIdAtSend;
      if (threadId && !threadIdAtSend) {
        const nowIso = new Date().toISOString();
        setActiveThreadId(threadId);
        setThreads((prev) => [
          {
            id: threadId,
            title: json.thread_title || trimmed.slice(0, 46),
            created_at: nowIso,
            updated_at: nowIso,
          },
          ...prev.filter((t) => t.id !== threadId),
        ]);
      } else if (threadId) {
        const nowIso = new Date().toISOString();
        setThreads((prev) => {
          const current = prev.find((t) => t.id === threadId);
          if (!current) return prev;
          return [
            { ...current, updated_at: nowIso },
            ...prev.filter((t) => t.id !== threadId),
          ];
        });
      }

      if (json.status === 'queued') {
        if (!threadId) {
          throw new Error('The server did not return a thread for this conversation.');
        }
        const completed = await pollForAssistant(tripId, threadId, json.turn_index);
        finishTurn(threadId, completed.messages, completed.assistant);
        return;
      }

      const assistant: ChatMessage = {
        id: `r-${Date.now()}`,
        turn_index: json.turn_index,
        role: 'assistant',
        content: json.assistant_message ?? 'Done.',
        tool_calls_json:
          json.tool_calls_summary.length > 0 ? json.tool_calls_summary : null,
      };
      if (activeThreadIdRef.current === threadId || !threadIdAtSend) {
        setMessages((prev) => [...prev, assistant]);
      }
      setState((s) => {
        if (s === 'minimized') setUnread(true);
        return s;
      });
      void refreshThreads();
      if ((assistant.tool_calls_json?.length ?? 0) > 0) {
        notifyTripEditApplied(tripId);
        router.refresh();
      }
    } catch (err) {
      if (isLikelyDroppedFetch(err) && threadIdAtSend) {
        try {
          const completed = await pollForAssistant(tripId, threadIdAtSend, nextTurnIndex);
          finishTurn(threadIdAtSend, completed.messages, completed.assistant);
          return;
        } catch (pollErr) {
          setError(userFacingChatError(pollErr));
          return;
        }
      }
      setError(userFacingChatError(err));
    } finally {
      setLoading(false);
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      send();
    }
  }

  // Hide the entry point entirely when offline — without a network
  // there's nothing the chat can do.
  if (!online) return null;

  const threadGroups = groupThreadsByRecency(threads);

  return (
    <>
      {/* Closed: entry pill bottom-left */}
      <AnimatePresence>
        {state === 'closed' && (
          <motion.button
            key="entry"
            type="button"
            onClick={openPanel}
            className="trip-ask-entry"
            aria-label="Ask your travel expert"
            initial={{ opacity: 0, y: 12, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.95 }}
            transition={overlaySpring}
            whileTap={{ scale: 0.96 }}
          >
            <MessageCircle className="trip-ask-entry-icon" aria-hidden="true" />
            <span className="trip-ask-entry-label">Ask</span>
          </motion.button>
        )}
      </AnimatePresence>

      {/* Minimized: status pill bottom-left */}
      <AnimatePresence>
        {state === 'minimized' && (
          <motion.button
            key="minimized"
            type="button"
            onClick={openPanel}
            style={minimizedPillStyle}
            aria-label="Reopen travel expert chat"
            initial={{ opacity: 0, y: 12, scale: 0.94 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.94 }}
            transition={overlaySpring}
            whileTap={{ scale: 0.96 }}
          >
            {loading ? (
              <>
                <TypingDots />
                <span style={{ marginLeft: 10, fontFamily: '"Fraunces", Georgia, serif', fontStyle: 'italic' }}>
                  {statusPhases[statusIdx] ?? statusPhases[statusPhases.length - 1]}
                </span>
              </>
            ) : (
              <>
                <span style={{ fontFamily: '"Fraunces", Georgia, serif', fontStyle: 'italic' }}>
                  Ask your travel expert
                </span>
                {unread && <span style={unreadBadgeStyle} aria-label="New message">1</span>}
              </>
            )}
          </motion.button>
        )}
      </AnimatePresence>

      {/* Open: iOS share-sheet style bottom panel */}
      <AnimatePresence>
        {state === 'open' && (
          <>
            <motion.div
              key="backdrop"
              style={backdropStyle}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              onClick={close}
            />
            <motion.div
              key="sheet"
              ref={sheetRef}
              role="dialog"
              aria-label="Ask your travel expert"
              className={`trip-chat-sheet${railOpen ? ' is-rail-open' : ''}`}
              style={{ ...sheetStyle, bottom: keyboardInset }}
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={overlaySpring}
              drag="y"
              dragControls={dragControls}
              dragListener={false}
              dragConstraints={{ top: 0, bottom: 0 }}
              dragElastic={{ top: 0, bottom: 0.4 }}
              onDragEnd={(_, info) => {
                // Dismiss when the user flicks down or drags more than ~120px.
                if (info.offset.y > 120 || info.velocity.y > 600) {
                  minimize();
                }
              }}
            >
              <div
                style={grabberHitStyle}
                onPointerDown={(e) => dragControls.start(e)}
                aria-hidden="true"
              >
                <div style={grabberStyle} />
              </div>
              <header style={headerStyle}>
                <button
                  type="button"
                  onClick={toggleRail}
                  style={headerIconButtonStyle}
                  aria-label={railOpen ? 'Hide chat history' : 'Show chat history'}
                  aria-expanded={railOpen}
                >
                  {railOpen ? (
                    <PanelLeftClose size={17} strokeWidth={2.1} aria-hidden="true" />
                  ) : (
                    <PanelLeft size={17} strokeWidth={2.1} aria-hidden="true" />
                  )}
                </button>
                <div style={chatTitleStyle}>
                  Ask your travel expert
                </div>
                <button
                  type="button"
                  onClick={startNewChat}
                  style={headerIconButtonStyle}
                  aria-label="New chat"
                >
                  <SquarePen size={16} strokeWidth={2.1} aria-hidden="true" />
                </button>
              </header>

              <div className="trip-chat-body">
                {railOpen && (
                  <>
                    <div
                      className="trip-chat-rail-scrim"
                      onClick={() => setRailOpen(false)}
                      aria-hidden="true"
                    />
                    <nav className="trip-chat-rail" aria-label="Chat history">
                      <button
                        type="button"
                        className="trip-chat-rail-new"
                        onClick={startNewChat}
                      >
                        <SquarePen size={14} strokeWidth={2.2} aria-hidden="true" />
                        New chat
                      </button>
                      <div className="trip-chat-rail-list">
                        {threads.length === 0 && (
                          <p className="trip-chat-rail-empty">
                            No conversations yet. Ask something to start the first one.
                          </p>
                        )}
                        {threadGroups.map(({ group, threads: groupThreads }) => (
                          <div key={group} className="trip-chat-rail-section">
                            <div className="trip-chat-rail-group">{group}</div>
                            {groupThreads.map((thread) => {
                              const active = thread.id === activeThreadId;
                              const renaming = renamingId === thread.id;
                              const confirming = confirmDeleteId === thread.id;
                              return (
                                <div
                                  key={thread.id}
                                  className={`trip-chat-thread${active ? ' is-active' : ''}`}
                                >
                                  {renaming ? (
                                    <input
                                      className="trip-chat-thread-rename"
                                      value={renameDraft}
                                      autoFocus
                                      maxLength={80}
                                      onChange={(e) => setRenameDraft(e.target.value)}
                                      onKeyDown={(e) => {
                                        if (e.key === 'Enter') commitRename(thread.id);
                                        if (e.key === 'Escape') setRenamingId(null);
                                      }}
                                      onBlur={() => commitRename(thread.id)}
                                      aria-label="Rename conversation"
                                    />
                                  ) : confirming ? (
                                    <div className="trip-chat-thread-confirm">
                                      <span>Delete?</span>
                                      <button
                                        type="button"
                                        onClick={() => deleteThread(thread.id)}
                                        aria-label="Confirm delete"
                                      >
                                        <Check size={14} strokeWidth={2.4} aria-hidden="true" />
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => setConfirmDeleteId(null)}
                                        aria-label="Cancel delete"
                                      >
                                        <X size={14} strokeWidth={2.4} aria-hidden="true" />
                                      </button>
                                    </div>
                                  ) : (
                                    <>
                                      <button
                                        type="button"
                                        className="trip-chat-thread-select"
                                        onClick={() => selectThread(thread.id)}
                                        title={thread.title}
                                      >
                                        <span className="trip-chat-thread-title">
                                          {thread.title}
                                        </span>
                                      </button>
                                      <span className="trip-chat-thread-actions">
                                        <button
                                          type="button"
                                          onClick={() => {
                                            setRenamingId(thread.id);
                                            setRenameDraft(thread.title);
                                            setConfirmDeleteId(null);
                                          }}
                                          aria-label={`Rename "${thread.title}"`}
                                        >
                                          <Pencil size={13} strokeWidth={2.2} aria-hidden="true" />
                                        </button>
                                        <button
                                          type="button"
                                          onClick={() => {
                                            setConfirmDeleteId(thread.id);
                                            setRenamingId(null);
                                          }}
                                          aria-label={`Delete "${thread.title}"`}
                                        >
                                          <Trash2 size={13} strokeWidth={2.2} aria-hidden="true" />
                                        </button>
                                      </span>
                                    </>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        ))}
                      </div>
                    </nav>
                  </>
                )}

                <div className="trip-chat-main">
                  <div ref={scrollerRef} style={messagesStyle}>
                    {threadLoading && (
                      <div style={statusRowStyle}>
                        <TypingDots />
                        <span style={statusTextStyle}>Opening conversation…</span>
                      </div>
                    )}
                    {!threadLoading && messages.length === 0 && (
                      <div style={emptyStyle}>
                        <p style={{ margin: 0, color: '#6B6157' }}>
                          {threads.length > 0
                            ? 'New conversation. Ask anything about the trip — earlier chats stay in the sidebar.'
                            : 'Ask anything about the trip — "make day 2 more relaxed", "swap Friday dinner", "what should I pack?".'}
                        </p>
                      </div>
                    )}
                    {!threadLoading &&
                      messages.map((m) => <MessageBubble key={m.id} m={m} />)}
                    {loading && (
                      <motion.div
                        initial={{ opacity: 0, y: 6 }}
                        animate={{ opacity: 1, y: 0 }}
                        style={statusRowStyle}
                      >
                        <TypingDots />
                        <AnimatePresence mode="wait">
                          <motion.span
                            key={statusIdx}
                            initial={{ opacity: 0, y: 4 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: -4 }}
                            transition={{ duration: 0.25 }}
                            style={statusTextStyle}
                          >
                            {statusPhases[statusIdx] ?? statusPhases[statusPhases.length - 1]}
                          </motion.span>
                        </AnimatePresence>
                      </motion.div>
                    )}
                    {error && (
                      <div style={errorStyle} role="alert">
                        {error}
                      </div>
                    )}
                  </div>

                  <footer style={footerStyle}>
                    <div style={inputWrapStyle}>
                      <textarea
                        ref={inputRef}
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        onKeyDown={onKeyDown}
                        placeholder="Describe an edit…"
                        rows={1}
                        style={textareaStyle}
                        disabled={loading}
                      />
                      <button
                        type="button"
                        onClick={send}
                        disabled={loading || !input.trim()}
                        style={sendIconButtonStyle(loading || !input.trim())}
                        aria-label={loading ? 'Sending' : 'Send'}
                      >
                        {loading ? (
                          <TypingDots />
                        ) : (
                          <SendHorizontal size={16} strokeWidth={2.4} aria-hidden="true" />
                        )}
                      </button>
                    </div>
                  </footer>
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  );
}

function TypingDots() {
  return (
    <span style={typingDotsStyle} aria-hidden="true">
      <motion.span
        style={dotStyle}
        animate={{ y: [0, -4, 0], opacity: [0.5, 1, 0.5] }}
        transition={{ duration: 1.05, repeat: Infinity, ease: 'easeInOut', delay: 0 }}
      />
      <motion.span
        style={dotStyle}
        animate={{ y: [0, -4, 0], opacity: [0.5, 1, 0.5] }}
        transition={{ duration: 1.05, repeat: Infinity, ease: 'easeInOut', delay: 0.16 }}
      />
      <motion.span
        style={dotStyle}
        animate={{ y: [0, -4, 0], opacity: [0.5, 1, 0.5] }}
        transition={{ duration: 1.05, repeat: Infinity, ease: 'easeInOut', delay: 0.32 }}
      />
    </span>
  );
}

function MessageBubble({ m }: { m: ChatMessage }) {
  const isUser = m.role === 'user';
  // Assistant messages can include markdown (lists, **bold**, links,
  // headings, tables). Render through the trip-markdown helper so it
  // gets the same sanitization + editorial typography rules. User
  // messages stay as plain text — they typed it themselves.
  const renderedHtml = !isUser && !m.pending ? renderTripMarkdown(m.content) : null;
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.22, ease: [0.32, 0.72, 0, 1] }}
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: isUser ? 'flex-end' : 'flex-start',
        gap: 4,
      }}
    >
      <div
        className={!isUser ? 'chat-bubble-assistant' : undefined}
        style={{
          maxWidth: isUser
            ? 'var(--trip-chat-user-bubble-max-width, 88%)'
            : 'var(--trip-chat-assistant-bubble-max-width, 88%)',
          padding: isUser
            ? 'var(--trip-chat-user-bubble-padding, 10px 14px)'
            : 'var(--trip-chat-assistant-bubble-padding, 10px 14px)',
          borderRadius: isUser
            ? 'var(--trip-chat-user-bubble-radius, 14px)'
            : 'var(--trip-chat-assistant-bubble-radius, 14px)',
          background: isUser ? '#1A1410' : '#FFFFFF',
          color: isUser ? '#FBF7F1' : '#1A1410',
          border: isUser ? 'none' : '1px solid #E8E1D6',
          fontSize: isUser
            ? 'var(--trip-chat-user-bubble-font-size, 14px)'
            : 'var(--trip-chat-assistant-bubble-font-size, 14px)',
          lineHeight: isUser
            ? 'var(--trip-chat-user-bubble-line-height, 1.5)'
            : 'var(--trip-chat-assistant-bubble-line-height, 1.5)',
          whiteSpace: isUser || m.pending ? 'pre-wrap' : 'normal',
          fontStyle: m.pending ? 'italic' : 'normal',
          opacity: m.pending ? 0.6 : 1,
        }}
      >
        {renderedHtml ? (
          <div dangerouslySetInnerHTML={{ __html: renderedHtml }} />
        ) : (
          m.content
        )}
      </div>
      {m.tool_calls_json && m.tool_calls_json.length > 0 && (
        <div
          style={{
            fontSize: 11,
            color: '#A03E1F',
            textTransform: 'uppercase',
            letterSpacing: '0.14em',
            fontWeight: 600,
          }}
        >
          • Applied {m.tool_calls_json.length} edit{m.tool_calls_json.length === 1 ? '' : 's'}
        </div>
      )}
    </motion.div>
  );
}

// ---------- styles ----------

// Entry CTA styling lives in preview.css so the button can align with
// TripPreview chrome without prop drilling. Thread-rail styling also lives
// there (classes trip-chat-rail*) because it needs media queries.

const minimizedPillStyle: React.CSSProperties = {
  position: 'fixed',
  left: 24,
  bottom: 24,
  padding: '10px 18px',
  background: '#FFFFFF',
  border: '1px solid #E8E1D6',
  borderRadius: 999,
  color: '#1A1410',
  fontFamily: 'Inter, system-ui, sans-serif',
  fontSize: 14,
  fontWeight: 520,
  cursor: 'pointer',
  boxShadow: 'rgba(26, 20, 16, 0.10) 0 12px 32px -8px',
  zIndex: 900,
  display: 'inline-flex',
  alignItems: 'center',
  gap: 0,
};

const unreadBadgeStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  marginLeft: 10,
  minWidth: 18,
  height: 18,
  padding: '0 6px',
  borderRadius: 999,
  background: '#C14F2A',
  color: '#FBF7F1',
  fontSize: 10,
  fontWeight: 600,
  letterSpacing: '0.04em',
  fontFamily: 'Inter, system-ui, sans-serif',
};

const backdropStyle: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(26, 20, 16, 0.32)',
  backdropFilter: 'blur(2px)',
  WebkitBackdropFilter: 'blur(2px)',
  zIndex: 899,
};

const sheetStyle: React.CSSProperties = {
  position: 'fixed',
  left: 0,
  right: 0,
  bottom: 0,
  marginLeft: 'auto',
  marginRight: 'auto',
  width: 'min(var(--trip-chat-sheet-width, 520px), 100vw)',
  height: 'var(--trip-chat-sheet-height, auto)',
  maxHeight: 'var(--trip-chat-sheet-max-height, min(43vh, 360px))',
  background: '#FBF7F1',
  border: '1px solid #E8E1D6',
  borderTopLeftRadius: 'var(--trip-chat-sheet-radius, 22px)',
  borderTopRightRadius: 'var(--trip-chat-sheet-radius, 22px)',
  borderBottomLeftRadius: 0,
  borderBottomRightRadius: 0,
  boxShadow: 'rgba(26, 20, 16, 0.20) 0 -16px 48px -12px',
  zIndex: 900,
  display: 'flex',
  flexDirection: 'column',
  overflow: 'hidden',
  fontFamily: 'Inter, system-ui, sans-serif',
  paddingBottom: 'env(safe-area-inset-bottom)',
};

const grabberHitStyle: React.CSSProperties = {
  width: '100%',
  padding: '6px 0 4px',
  display: 'flex',
  justifyContent: 'center',
  cursor: 'grab',
  touchAction: 'none',
  flexShrink: 0,
};

const grabberStyle: React.CSSProperties = {
  width: 36,
  height: 4,
  borderRadius: 999,
  background: '#D4C8B4',
};

const headerStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: 'var(--trip-chat-header-padding, 4px 10px 8px)',
  borderBottom: '1px solid #E8E1D6',
  background: '#FBF7F1',
};

const headerIconButtonStyle: React.CSSProperties = {
  flexShrink: 0,
  width: 32,
  height: 32,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: 'transparent',
  color: '#3D352E',
  border: 'none',
  borderRadius: 9,
  cursor: 'pointer',
};

const chatTitleStyle: React.CSSProperties = {
  flex: 1,
  textAlign: 'center',
  fontFamily: '"Fraunces", "Iowan Old Style", "Palatino", Georgia, serif',
  fontOpticalSizing: 'auto',
  fontVariationSettings: "'SOFT' 42",
  fontSize: 'var(--trip-chat-title-size, 17px)',
  fontWeight: 420,
  lineHeight: 'var(--trip-chat-title-line-height, 1.15)',
  color: '#1A1410',
  letterSpacing: 0,
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
};

const messagesStyle: React.CSSProperties = {
  flex: 1,
  overflowY: 'auto',
  padding: 'var(--trip-chat-messages-padding, 14px 16px)',
  display: 'flex',
  flexDirection: 'column',
  gap: 'var(--trip-chat-message-gap, 12px)',
  background: '#FBF7F1',
};

const emptyStyle: React.CSSProperties = {
  padding: 'var(--trip-chat-empty-padding, 16px 0)',
  fontSize: 'var(--trip-chat-empty-font-size, 14px)',
  lineHeight: 'var(--trip-chat-empty-line-height, 1.55)',
};

const statusRowStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 10,
  padding: '8px 14px',
  background: '#F5E4DA',
  border: '1px solid rgba(193, 79, 42, 0.22)',
  borderRadius: 999,
  alignSelf: 'flex-start',
};

const statusTextStyle: React.CSSProperties = {
  fontFamily: '"Fraunces", "Iowan Old Style", "Palatino", Georgia, serif',
  fontOpticalSizing: 'auto',
  fontVariationSettings: "'SOFT' 36",
  fontStyle: 'italic',
  fontSize: 'var(--trip-chat-status-font-size, 14px)',
  fontWeight: 380,
  color: '#A03E1F',
  letterSpacing: 0,
};

const typingDotsStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 5,
  height: 14,
};

const dotStyle: React.CSSProperties = {
  display: 'inline-block',
  width: 6,
  height: 6,
  borderRadius: 999,
  background: '#C14F2A',
};

const errorStyle: React.CSSProperties = {
  padding: '10px 12px',
  border: '1px solid #9B4F2E',
  background: '#F5E4DA',
  color: '#9B4F2E',
  fontSize: 13,
  borderRadius: 6,
};

const footerStyle: React.CSSProperties = {
  padding: 'var(--trip-chat-footer-padding, 10px 12px 12px)',
  borderTop: '1px solid #E8E1D6',
  background: '#FBF7F1',
};

const inputWrapStyle: React.CSSProperties = {
  position: 'relative',
  display: 'flex',
  alignItems: 'flex-end',
  background: '#FFFFFF',
  border: '1px solid #E8E1D6',
  borderRadius: 'var(--trip-chat-input-radius, 22px)',
  padding: 'var(--trip-chat-input-padding, 6px 6px 6px 14px)',
  gap: 'var(--trip-chat-input-gap, 8px)',
};

const textareaStyle: React.CSSProperties = {
  flex: 1,
  minHeight: 'var(--trip-chat-input-min-height, 28px)',
  maxHeight: 120,
  padding: 'var(--trip-chat-textarea-padding, 6px 0)',
  fontSize: 'var(--trip-chat-input-font-size, 14px)',
  lineHeight: 'var(--trip-chat-input-line-height, 1.45)',
  background: 'transparent',
  border: 'none',
  outline: 'none',
  resize: 'none',
  fontFamily: 'Inter, system-ui, sans-serif',
  color: '#1A1410',
};

function sendIconButtonStyle(disabled: boolean): React.CSSProperties {
  return {
    flexShrink: 0,
    width: 'var(--trip-chat-send-size, 32px)',
    height: 'var(--trip-chat-send-size, 32px)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: disabled ? '#E8E1D6' : '#C14F2A',
    color: disabled ? '#9B9087' : '#FBF7F1',
    border: 'none',
    borderRadius: 999,
    cursor: disabled ? 'default' : 'pointer',
    transition: 'background 0.15s, color 0.15s',
  };
}

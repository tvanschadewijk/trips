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
 *   - A thread idle for >24h, or scoped to another itinerary day/view, is
 *     treated as finished for the current opening: the old thread stays in
 *     the rail while the user gets a clean composer.
 *
 * Posts to /api/trips/[id]/chat (with thread_id). On a successful response
 * with tool calls, triggers a router.refresh() so the trip view picks up
 * the edits.
 *
 * Styling follows the editorial design system in DESIGN.md: warm paper
 * surfaces, Fraunces serif for display, Inter for UI, terracotta accent.
 */
import { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import { AnimatePresence, motion, useDragControls } from 'motion/react';
import {
  AlertTriangle,
  BookOpen,
  CalendarDays,
  Check,
  CheckCircle2,
  CircleDot,
  ClipboardCheck,
  Compass,
  Globe2,
  Hotel,
  Link as LinkIcon,
  MapPin,
  MessageCircle,
  PanelLeft,
  PanelLeftClose,
  Pencil,
  PencilLine,
  Plane,
  Route,
  Search,
  SendHorizontal,
  SquarePen,
  Trash2,
  Utensils,
  X,
} from 'lucide-react';
import type { ToolCallSummary } from '@/lib/trip-chat/prompt';
import type { TripData } from '@/lib/types';
import {
  DEFAULT_CHAT_STATUS_PHASES,
  INITIAL_CHAT_PROGRESS_MESSAGE,
  getChatStatusPhases,
  type ChatProgressEvent,
} from '@/lib/trip-chat/progress';
import {
  groupThreadsByRecency,
  isThreadCompatibleWithViewContext,
  isThreadStale,
  threadContextForViewContext,
  type ChatThreadSummary,
  type ThreadViewContext,
} from '@/lib/trip-chat/thread-utils';
import { useOnlineStatus } from '@/lib/online-status';
import { renderTripMarkdown } from '@/lib/render-trip-markdown';
import { shouldSubmitChatMessageKey } from './chat-input-keys';

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
const PANEL_TOP_CLEARANCE_PX = 12;
const MIN_VISIBLE_SHEET_PX = 132;
const SWIPE_MINIMIZE_THRESHOLD_PX = 68;
const CHAT_POLL_INTERVAL_MS = 2400;
const CHAT_POLL_TIMEOUT_MS = 305_000;
const CHAT_HISTORY_LIMIT = 50;
const RAIL_PREF_STORAGE_KEY = 'trip-chat-rail-open';
const CHAT_CONTEXT_STORAGE_KEY = 'trip-chat-context';
const MOBILE_RAIL_QUERY = '(max-width: 719px)';
const TRIP_DATA_UPDATED_EVENT = 'ourtrips:trip-data-updated';

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
  progress?: ChatProgressEvent[];
};

type ChatHistoryPayload = {
  messages: ChatMessage[];
  progress: ChatProgressEvent[];
};

type ThreadListResponse = {
  threads: ChatThreadSummary[];
};

type TripDataResponse = {
  trip_data?: TripData;
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
    return 'The connection dropped while the travel agent was working. Reopen this trip in a moment; if the answer finished, it will appear here.';
  }
  return err instanceof Error ? err.message : String(err);
}

function isMobileRail(): boolean {
  return typeof window !== 'undefined' && window.matchMedia(MOBILE_RAIL_QUERY).matches;
}

function isEditableElement(value: Element | null): value is HTMLElement {
  if (!(value instanceof HTMLElement)) return false;
  const tagName = value.tagName;
  return value.isContentEditable || tagName === 'INPUT' || tagName === 'TEXTAREA';
}

function shouldAutoFocusChatInput(): boolean {
  if (typeof window === 'undefined') return false;
  return !window.matchMedia('(pointer: coarse)').matches && !isMobileRail();
}

function readStoredViewContext(): ThreadViewContext | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(CHAT_CONTEXT_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as ThreadViewContext) : null;
  } catch {
    return null;
  }
}

function contextLabelForViewContext(viewContext: ThreadViewContext | null): string | null {
  return threadContextForViewContext(viewContext)?.label ?? null;
}

function shouldStartFreshForThread(
  thread: ChatThreadSummary,
  viewContext: ThreadViewContext | null
): boolean {
  return isThreadStale(thread.updated_at) || !isThreadCompatibleWithViewContext(thread, viewContext);
}

function notifyTripEditApplied(tripId: string, tripData?: TripData) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(
    new CustomEvent('ourtrips:accommodation-review-updated', {
      detail: { tripId },
    })
  );
  if (tripData) {
    window.dispatchEvent(
      new CustomEvent(TRIP_DATA_UPDATED_EVENT, {
        detail: { tripId, tripData },
      })
    );
  }
}

async function fetchLatestTripData(tripId: string): Promise<TripData | null> {
  const res = await fetch(`/api/trips/${tripId}/data`, { cache: 'no-store' });
  if (!res.ok) return null;
  const json = (await res.json()) as TripDataResponse;
  return json.trip_data ?? null;
}

function isLocalProgressEvent(event: ChatProgressEvent): boolean {
  return event.id.startsWith('local-progress-') || event.id.startsWith('inferred-progress-');
}

function stageForInferredStatus(message: string): ChatProgressEvent['stage'] {
  if (/read|finding/i.test(message)) return 'reading';
  if (/search|source|website|policy/i.test(message)) return 'researching';
  if (/check|review/i.test(message)) return 'checking';
  if (/saving|edit/i.test(message)) return 'editing';
  if (/writing|reply/i.test(message)) return 'writing';
  return 'thinking';
}

function buildInferredProgressEvents(
  phases: readonly string[],
  activeIndex: number,
  turnIndex: number
): ChatProgressEvent[] {
  return phases.slice(0, activeIndex + 1).map((message, index) => ({
    id: `inferred-progress-${turnIndex}-${index}`,
    turn_index: turnIndex,
    stage: stageForInferredStatus(message),
    action: 'infer',
    object_type: 'agent_activity',
    status: index < activeIndex ? 'completed' : 'active',
    confidence: 'inferred',
    message,
    created_at: '',
  }));
}

function shouldUseInferredProgress(
  latestProgress: ChatProgressEvent | undefined,
  statusIdx: number
): boolean {
  if (!latestProgress) return true;
  if (isLocalProgressEvent(latestProgress)) return true;
  if (statusIdx === 0) return false;
  return (
    latestProgress.stage === 'queued' ||
    latestProgress.stage === 'starting' ||
    latestProgress.confidence === 'inferred'
  );
}

function mergeProgressEvents(
  primary: ChatProgressEvent[],
  fallback: ChatProgressEvent[]
): ChatProgressEvent[] {
  const seen = new Set<string>();
  return [...primary, ...fallback].filter((event) => {
    if (event.stage === 'done') return false;
    const key = `${event.stage}:${event.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function fetchChatHistoryPayload(
  tripId: string,
  threadId: string | null,
  progressTurnIndex?: number
): Promise<ChatHistoryPayload> {
  const threadParam = threadId ? `&thread_id=${encodeURIComponent(threadId)}` : '';
  const progressParam =
    progressTurnIndex !== undefined
      ? `&turn_index=${encodeURIComponent(String(progressTurnIndex))}`
      : '';
  const res = await fetch(
    `/api/trips/${tripId}/chat?limit=${CHAT_HISTORY_LIMIT}${threadParam}${progressParam}`,
    { cache: 'no-store' }
  );
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const headline = body.error ?? `HTTP ${res.status}`;
    throw new Error(body.detail ? `${headline} — ${body.detail}` : headline);
  }
  const json = (await res.json()) as ChatHistoryResponse;
  return {
    messages: json.messages,
    progress: json.progress ?? [],
  };
}

async function fetchChatHistory(
  tripId: string,
  threadId: string | null
): Promise<ChatMessage[]> {
  return (await fetchChatHistoryPayload(tripId, threadId)).messages;
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
  turnIndex: number,
  onProgress?: (progress: ChatProgressEvent[]) => void
): Promise<{ messages: ChatMessage[]; assistant: ChatMessage }> {
  const started = Date.now();
  let lastMessages: ChatMessage[] | null = null;
  let lastProgress: ChatProgressEvent[] = [];

  while (Date.now() - started < CHAT_POLL_TIMEOUT_MS) {
    try {
      const payload = await fetchChatHistoryPayload(tripId, threadId, turnIndex);
      const { messages, progress } = payload;
      lastMessages = messages;
      if (progress.length > 0) {
        lastProgress = progress;
        onProgress?.(progress);
      }
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
    `The travel agent is taking longer than expected. ${
      lastProgress.length
        ? `Last update: ${lastProgress[lastProgress.length - 1].message} `
        : ''
    }Reopen this trip in a moment; if it finishes, the answer will appear here.`
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
  const [mounted, setMounted] = useState(false);
  const [state, setState] = useState<PanelState>('closed');
  const [threads, setThreads] = useState<ChatThreadSummary[]>(initialThreads);
  // Auto-new-chat: if the newest thread has been idle >24h or belongs to
  // another itinerary view, open fresh. Render output while 'closed' is
  // identical either way, so the SSR/client boundary can disagree on this
  // without a hydration mismatch.
  const [activeThreadId, setActiveThreadId] = useState<string | null>(() => {
    if (!initialThreadId) return null;
    const thread = initialThreads.find((t) => t.id === initialThreadId);
    if (!thread || shouldStartFreshForThread(thread, readStoredViewContext())) return null;
    return initialThreadId;
  });
  const [messages, setMessages] = useState<ChatMessage[]>(
    activeThreadId ? initialMessages : []
  );
  const [currentContextLabel, setCurrentContextLabel] = useState<string | null>(() =>
    contextLabelForViewContext(readStoredViewContext())
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
  const [turnProgress, setTurnProgress] = useState<ChatProgressEvent[]>([]);
  const [unread, setUnread] = useState(false);
  const [layoutViewportHeight, setLayoutViewportHeight] = useState<number | null>(null);
  const [keyboardInset, setKeyboardInset] = useState(0);
  const [isKeyboardVisible, setIsKeyboardVisible] = useState(false);
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const sheetRef = useRef<HTMLDivElement | null>(null);
  const activeThreadIdRef = useRef<string | null>(activeThreadId);
  // Distinguishes a real drag on the grabber from a plain click (a click
  // should dismiss the sheet; releasing a half-drag should not).
  const dragMovedRef = useRef(false);
  const dragControls = useDragControls();
  const touchStartYRef = useRef<number | null>(null);
  const sheetTouchLastYRef = useRef<number | null>(null);
  const sheetTouchScrollableRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

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

  const focusChatInput = useCallback(() => {
    if (!shouldAutoFocusChatInput()) return;
    window.setTimeout(() => inputRef.current?.focus(), 0);
  }, []);

  useEffect(() => {
    if (state === 'open') focusChatInput();
  }, [focusChatInput, state]);

  // Track the iOS keyboard via visualViewport. When the textarea is
  // focused and the keyboard is up, we lift the sheet by that inset so
  // the input stays above it. Borrowed from preppy/AssistantOverlay.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const vv = window.visualViewport;
    let raf: number | null = null;
    const update = () => {
      raf = null;
      const activeElement = document.activeElement;
      const focusedInsideSheet = !!sheetRef.current && sheetRef.current.contains(activeElement);
      const sheetInputFocused = focusedInsideSheet && isEditableElement(activeElement);
      const layoutHeight = Math.round(window.innerHeight);
      const viewportHeight = Math.round(vv?.height ?? window.innerHeight);
      const viewportOffsetTop = Math.max(0, Math.round(vv?.offsetTop ?? 0));
      const obscured = vv
        ? Math.max(0, Math.round(window.innerHeight - (viewportHeight + viewportOffsetTop)))
        : 0;
      const candidate =
        sheetInputFocused && obscured > KEYBOARD_INSET_THRESHOLD ? obscured : 0;
      const maxUsableInset = Math.max(
        0,
        window.innerHeight - MIN_VISIBLE_SHEET_PX - PANEL_TOP_CLEARANCE_PX
      );
      const next = Math.min(candidate, maxUsableInset);

      setLayoutViewportHeight((prev) => (prev === layoutHeight ? prev : layoutHeight));
      setKeyboardInset((prev) => {
        if (!sheetInputFocused) return prev === next ? prev : next;
        if (next === 0) return prev === 0 ? prev : 0;
        if (prev === 0) return next;
        const stabilized = Math.max(prev, next);
        return prev === stabilized ? prev : stabilized;
      });
      setIsKeyboardVisible((prev) => {
        const visible = next > 0;
        return prev === visible ? prev : visible;
      });
    };
    const schedule = () => {
      if (raf === null) raf = window.requestAnimationFrame(update);
    };
    update();
    vv?.addEventListener('resize', schedule);
    vv?.addEventListener('scroll', schedule);
    window.addEventListener('resize', schedule);
    window.addEventListener('orientationchange', schedule);
    window.addEventListener('focusin', schedule);
    window.addEventListener('focusout', schedule);
    return () => {
      vv?.removeEventListener('resize', schedule);
      vv?.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
      window.removeEventListener('orientationchange', schedule);
      window.removeEventListener('focusin', schedule);
      window.removeEventListener('focusout', schedule);
      if (raf !== null) window.cancelAnimationFrame(raf);
    };
  }, [state]);

  const isSheetTextInputActive = useCallback(() => {
    const activeElement = document.activeElement;
    return !!sheetRef.current && sheetRef.current.contains(activeElement) && isEditableElement(activeElement);
  }, []);

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
        activeThreadIdRef.current = null;
        setActiveThreadId(null);
        setMessages([]);
      }
    } catch {
      // Sidebar refresh is cosmetic; never surface as a chat error.
    }
  }, [tripId]);

  const startNewChat = useCallback(() => {
    activeThreadIdRef.current = null;
    setActiveThreadId(null);
    setMessages([]);
    setTurnProgress([]);
    setError(null);
    setCurrentContextLabel(contextLabelForViewContext(readStoredViewContext()));
    setConfirmDeleteId(null);
    setRenamingId(null);
    if (isMobileRail()) setRailOpen(false);
    focusChatInput();
  }, [focusChatInput]);

  // Open the panel — clears unread badge, rolls a stale conversation over
  // into a fresh one (the old thread stays in the rail).
  const openPanel = useCallback(() => {
    const viewContext = readStoredViewContext();
    setCurrentContextLabel(contextLabelForViewContext(viewContext));
    setState('open');
    setUnread(false);
    if (!loading && activeThreadIdRef.current) {
      const thread = threads.find((t) => t.id === activeThreadIdRef.current);
      if (thread && shouldStartFreshForThread(thread, viewContext)) {
        activeThreadIdRef.current = null;
        setActiveThreadId(null);
        setMessages([]);
        setTurnProgress([]);
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

  const handleBackdropClick = useCallback(() => {
    if (isKeyboardVisible || isSheetTextInputActive()) {
      const activeElement = document.activeElement;
      if (activeElement instanceof HTMLElement) activeElement.blur();
      return;
    }
    close();
  }, [close, isKeyboardVisible, isSheetTextInputActive]);

  useEffect(() => {
    const sheet = sheetRef.current;
    if (!sheet || state !== 'open') return;

    const getMainScroller = () =>
      sheet.querySelector('[data-trip-chat-main-scroll]') as HTMLElement | null;
    const findScrollableFromTarget = (target: EventTarget | null) => {
      let node = target instanceof HTMLElement ? target : null;
      while (node && node !== sheet) {
        const style = window.getComputedStyle(node);
        const isScrollableY = style.overflowY === 'auto' || style.overflowY === 'scroll';
        if (isScrollableY && node.scrollHeight > node.clientHeight + 1) return node;
        node = node.parentElement;
      }
      return null;
    };

    const handleTouchStart = (event: TouchEvent) => {
      sheetTouchLastYRef.current = event.touches[0]?.clientY ?? null;
      sheetTouchScrollableRef.current = findScrollableFromTarget(event.target);
      const mainScroller = getMainScroller();
      const startedInMainScroller =
        !!mainScroller && event.target instanceof Node && mainScroller.contains(event.target);
      touchStartYRef.current =
        startedInMainScroller && mainScroller.scrollTop <= 0.5
          ? event.touches[0]?.clientY ?? null
          : null;
    };

    const handleTouchMove = (event: TouchEvent) => {
      const currentY = event.touches[0]?.clientY;
      if (currentY === undefined) return;
      const previousY = sheetTouchLastYRef.current ?? currentY;
      const moveDeltaY = currentY - previousY;
      sheetTouchLastYRef.current = currentY;

      const scrollable = sheetTouchScrollableRef.current;
      if (scrollable && scrollable.scrollHeight > scrollable.clientHeight + 1) {
        const atTop = scrollable.scrollTop <= 0.5;
        const atBottom =
          scrollable.scrollTop + scrollable.clientHeight >= scrollable.scrollHeight - 0.5;
        if ((moveDeltaY > 0 && atTop) || (moveDeltaY < 0 && atBottom) || moveDeltaY === 0) {
          event.preventDefault();
        }
      } else {
        event.preventDefault();
      }

      if (isKeyboardVisible || touchStartYRef.current === null) return;
      if (currentY - touchStartYRef.current > SWIPE_MINIMIZE_THRESHOLD_PX) {
        touchStartYRef.current = null;
        minimize();
      }
    };

    const handleTouchEnd = () => {
      touchStartYRef.current = null;
      sheetTouchLastYRef.current = null;
      sheetTouchScrollableRef.current = null;
    };

    sheet.addEventListener('touchstart', handleTouchStart, { passive: true });
    sheet.addEventListener('touchmove', handleTouchMove, { passive: false });
    sheet.addEventListener('touchend', handleTouchEnd, { passive: true });
    sheet.addEventListener('touchcancel', handleTouchEnd, { passive: true });
    return () => {
      sheet.removeEventListener('touchstart', handleTouchStart);
      sheet.removeEventListener('touchmove', handleTouchMove);
      sheet.removeEventListener('touchend', handleTouchEnd);
      sheet.removeEventListener('touchcancel', handleTouchEnd);
      handleTouchEnd();
    };
  }, [isKeyboardVisible, minimize, state]);

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
        activeThreadIdRef.current = threadId;
        setActiveThreadId(threadId);
        setMessages(threadMessages);
        setTurnProgress([]);
        if (isMobileRail()) setRailOpen(false);
        focusChatInput();
      } catch (err) {
        setError(userFacingChatError(err));
      } finally {
        setThreadLoading(false);
      }
    },
    [focusChatInput, threadLoading, tripId]
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
          activeThreadIdRef.current = null;
          setActiveThreadId(null);
          setMessages([]);
          setTurnProgress([]);
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

  const refreshTripAfterToolCalls = useCallback(() => {
    void (async () => {
      let tripData: TripData | null = null;
      try {
        tripData = await fetchLatestTripData(tripId);
      } catch {
        // A router refresh still gives the server-rendered view a chance to
        // pick up the edit if the lightweight owner data endpoint is unavailable.
      }
      notifyTripEditApplied(tripId, tripData ?? undefined);
      router.refresh();
    })();
  }, [router, tripId]);

  const finishTurn = useCallback(
    (threadId: string, serverMessages: ChatMessage[], assistant: ChatMessage) => {
      // Only swap the transcript if the user is still on that thread.
      if (activeThreadIdRef.current === threadId) {
        setMessages(serverMessages);
      }
      setTurnProgress([]);

      // If the user collapsed mid-turn, mark unread.
      setState((s) => {
        if (s === 'minimized') setUnread(true);
        return s;
      });

      // Pick up the async LLM-polished title (and fresh updated_at ordering).
      void refreshThreads();

      if ((assistant.tool_calls_json?.length ?? 0) > 0) {
        refreshTripAfterToolCalls();
      }
    },
    [refreshThreads, refreshTripAfterToolCalls]
  );

  async function send() {
    const trimmed = input.trim();
    if (!trimmed || loading || threadLoading) return;
    setError(null);
    setStatusPhases(getChatStatusPhases(trimmed));

    // Snapshot the current view context (which day is open) so the
    // agent answers in the right scope without re-asking the user.
    const viewContext = readStoredViewContext();
    const context = threadContextForViewContext(viewContext);
    setCurrentContextLabel(context?.label ?? null);

    const activeThread = activeThreadId
      ? threads.find((thread) => thread.id === activeThreadId)
      : null;
    const startFreshForContext = activeThread
      ? shouldStartFreshForThread(activeThread, viewContext)
      : false;
    const threadIdAtSend = startFreshForContext ? null : activeThreadId;
    const baseMessages = startFreshForContext ? [] : messages;
    const nextTurnIndex =
      baseMessages.length === 0 ? 0 : Math.max(...baseMessages.map((m) => m.turn_index)) + 1;

    const optimisticUser: ChatMessage = {
      id: `optimistic-${Date.now()}`,
      turn_index: nextTurnIndex,
      role: 'user',
      content: trimmed,
      tool_calls_json: null,
    };
    if (startFreshForContext) {
      activeThreadIdRef.current = null;
      setActiveThreadId(null);
    }
    setMessages([...baseMessages, optimisticUser]);
    setTurnProgress([
      {
        id: `local-progress-${Date.now()}`,
        turn_index: nextTurnIndex,
        stage: 'queued',
        action: 'read_request',
        object_type: 'request',
        status: 'active',
        confidence: 'observed',
        message: INITIAL_CHAT_PROGRESS_MESSAGE,
        created_at: new Date().toISOString(),
      },
    ]);
    setInput('');
    setLoading(true);

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
        activeThreadIdRef.current = threadId;
        setActiveThreadId(threadId);
        setThreads((prev) => [
          {
            id: threadId,
            title: json.thread_title || trimmed.slice(0, 46),
            created_at: nowIso,
            updated_at: nowIso,
            context_key: context?.key ?? null,
            context_label: context?.label ?? null,
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
        const completed = await pollForAssistant(
          tripId,
          threadId,
          json.turn_index,
          setTurnProgress
        );
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
      setTurnProgress([]);
      setState((s) => {
        if (s === 'minimized') setUnread(true);
        return s;
      });
      void refreshThreads();
      if ((assistant.tool_calls_json?.length ?? 0) > 0) {
        refreshTripAfterToolCalls();
      }
    } catch (err) {
      if (isLikelyDroppedFetch(err) && threadIdAtSend) {
        try {
          const completed = await pollForAssistant(
            tripId,
            threadIdAtSend,
            nextTurnIndex,
            setTurnProgress
          );
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
    if (shouldSubmitChatMessageKey(e)) {
      e.preventDefault();
      void send();
    }
  }

  // Hide the entry point entirely when offline — without a network
  // there's nothing the chat can do.
  if (!online) return null;
  if (!mounted) return null;

  const threadGroups = groupThreadsByRecency(threads);
  const latestProgress = turnProgress[turnProgress.length - 1];
  const inferredProgress = loading
    ? buildInferredProgressEvents(
        statusPhases,
        Math.min(statusIdx, statusPhases.length - 1),
        latestProgress?.turn_index ?? 0
      )
    : [];
  const useInferredProgress =
    loading && shouldUseInferredProgress(latestProgress, statusIdx);
  const concreteProgress = turnProgress.filter((event) => !isLocalProgressEvent(event));
  const activeProgress =
    useInferredProgress
      ? inferredProgress[inferredProgress.length - 1]
      : loading && latestProgress && latestProgress.stage !== 'done'
        ? latestProgress
        : undefined;
  const activeStatusText =
    activeProgress?.message ?? statusPhases[statusIdx] ?? statusPhases[statusPhases.length - 1];
  const visibleProgress = (
    useInferredProgress
      ? mergeProgressEvents(concreteProgress, inferredProgress)
      : turnProgress.filter((event) => event.stage !== 'done')
  ).slice(-5);
  const layoutViewportHeightCss = layoutViewportHeight ? `${layoutViewportHeight}px` : '100dvh';
  const availableSheetHeight = `max(${MIN_VISIBLE_SHEET_PX}px, calc(${layoutViewportHeightCss} - env(safe-area-inset-top, 0px) - ${PANEL_TOP_CLEARANCE_PX}px - ${keyboardInset}px))`;
  const sheetRuntimeStyle = {
    ...sheetStyle,
    bottom: keyboardInset,
    '--trip-chat-available-height': availableSheetHeight,
  } as React.CSSProperties;

  return createPortal(
    <>
      {/* Closed: centered entry pill */}
      <AnimatePresence>
        {state === 'closed' && (
          <motion.button
            key="entry"
            type="button"
            onClick={openPanel}
            className="trip-ask-entry"
            aria-label="Ask Travel Agent"
            initial={{ opacity: 0, x: '-50%', y: 12, scale: 0.95 }}
            animate={{ opacity: 1, x: '-50%', y: 0, scale: 1 }}
            exit={{ opacity: 0, x: '-50%', y: 12, scale: 0.95 }}
            transition={overlaySpring}
            whileTap={{ scale: 0.96 }}
          >
            <MessageCircle className="trip-ask-entry-icon" aria-hidden="true" />
            <span className="trip-ask-entry-label">Ask Travel Agent</span>
          </motion.button>
        )}
      </AnimatePresence>

      {/* Minimized: centered status pill */}
      <AnimatePresence>
        {state === 'minimized' && (
          <motion.button
            key="minimized"
            type="button"
            onClick={openPanel}
            style={minimizedPillStyle}
            aria-label="Reopen Travel Agent chat"
            initial={{ opacity: 0, x: '-50%', y: 12, scale: 0.94 }}
            animate={{ opacity: 1, x: '-50%', y: 0, scale: 1 }}
            exit={{ opacity: 0, x: '-50%', y: 12, scale: 0.94 }}
            transition={overlaySpring}
            whileTap={{ scale: 0.96 }}
          >
            {loading ? (
              <>
                <TypingDots />
                {activeProgress && (
                  <span style={minimizedActivityIconStyle}>
                    <ProgressIcon event={activeProgress} size={13} />
                  </span>
                )}
                <span style={{ marginLeft: 10, fontFamily: '"Fraunces", Georgia, serif', fontStyle: 'italic' }}>
                  {activeStatusText}
                </span>
              </>
            ) : (
              <>
                <span style={{ fontFamily: '"Fraunces", Georgia, serif', fontStyle: 'italic' }}>
                  Ask Travel Agent
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
              onClick={handleBackdropClick}
            />
            <motion.div
              key="sheet"
              ref={sheetRef}
              role="dialog"
              aria-modal="true"
              aria-label="Ask Travel Agent"
              className={`trip-chat-sheet${railOpen ? ' is-rail-open' : ''}`}
              style={sheetRuntimeStyle}
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
                dragMovedRef.current = Math.abs(info.offset.y) > 8;
                // Dismiss when the user flicks down or drags more than ~120px.
                if (info.offset.y > 120 || info.velocity.y > 600) {
                  minimize();
                }
              }}
            >
              <button
                type="button"
                style={grabberHitStyle}
                onPointerDown={(e) => dragControls.start(e)}
                onClick={() => {
                  if (dragMovedRef.current) {
                    dragMovedRef.current = false;
                    return;
                  }
                  minimize();
                }}
                aria-label="Minimize chat"
              >
                <div style={grabberStyle} />
              </button>
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
                <div style={chatTitleWrapStyle}>
                  <div style={chatTitleStyle}>Ask Travel Agent</div>
                  {currentContextLabel && (
                    <div style={chatContextStyle}>{currentContextLabel}</div>
                  )}
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
                  <div ref={scrollerRef} style={messagesStyle} data-trip-chat-main-scroll>
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
                        role="status"
                        aria-live="polite"
                      >
                        <TypingDots />
                        {activeProgress && (
                          <span style={statusIconStyle}>
                            <ProgressIcon event={activeProgress} size={14} />
                          </span>
                        )}
                        <AnimatePresence mode="wait">
                          <motion.span
                            key={activeStatusText}
                            initial={{ opacity: 0, y: 4 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: -4 }}
                            transition={{ duration: 0.25 }}
                            style={statusTextStyle}
                          >
                            {activeStatusText}
                          </motion.span>
                        </AnimatePresence>
                      </motion.div>
                    )}
                    {loading && visibleProgress.length > 1 && (
                      <ProgressTrail progress={visibleProgress} />
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
    </>,
    document.body
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

function ProgressIcon({ event, size = 14 }: { event: ChatProgressEvent; size?: number }) {
  const objectType = event.object_type ?? '';
  const Icon =
    event.status === 'error' || event.stage === 'error'
      ? AlertTriangle
      : event.status === 'completed' || event.stage === 'done'
        ? CheckCircle2
        : event.stage === 'researching' && event.source === 'web'
          ? Globe2
          : event.stage === 'researching'
            ? Search
            : event.stage === 'booking'
              ? LinkIcon
              : objectType.includes('restaurant')
                ? Utensils
                : objectType.includes('hotel') || objectType.includes('accommodation')
                  ? Hotel
                  : objectType.includes('flight')
                    ? Plane
                    : objectType.includes('transport')
                      ? Route
                      : objectType.includes('date') || objectType.includes('logistics')
                        ? CalendarDays
                        : event.stage === 'reading'
                          ? BookOpen
                          : event.stage === 'editing'
                            ? PencilLine
                            : event.stage === 'checking' || event.stage === 'reviewing'
                              ? ClipboardCheck
                              : event.stage === 'queued' || event.stage === 'starting'
                                ? Compass
                                : objectType.includes('day')
                                  ? MapPin
                                  : CircleDot;
  return <Icon size={size} strokeWidth={2.15} aria-hidden="true" />;
}

function progressMeta(event: ChatProgressEvent): string[] {
  return [
    event.source_label,
    event.confidence === 'inferred' ? 'Inferred' : null,
    event.status === 'completed' ? 'Done' : null,
  ].filter((value): value is string => Boolean(value));
}

function ProgressTrail({ progress }: { progress: ChatProgressEvent[] }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      style={progressTrailWrapStyle}
    >
      <div style={progressTrailLabelStyle}>Agent activity</div>
      <ol style={progressTrailStyle} aria-label="Recent agent activity">
        {progress.map((event) => {
          const meta = progressMeta(event);
          return (
            <li key={event.id} style={progressTrailItemStyle}>
              <span style={progressTrailIconStyle}>
                <ProgressIcon event={event} size={13} />
              </span>
              <span style={progressTrailMessageStyle}>{event.message}</span>
              {meta.length > 0 && (
                <span style={progressTrailMetaStyle}>
                  {meta.map((label) => (
                    <span key={label} style={progressTrailChipStyle}>
                      {label}
                    </span>
                  ))}
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </motion.div>
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
  left: '50%',
  bottom: 'calc(24px + env(safe-area-inset-bottom))',
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

const minimizedActivityIconStyle: React.CSSProperties = {
  marginLeft: 9,
  width: 18,
  height: 18,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  color: '#A03E1F',
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
  // --trip-chat-rail-extra is 0 unless the thread rail is docked open on
  // desktop (preview.css) — the rail widens the sheet, never reshapes it.
  width:
    'min(calc(var(--trip-chat-sheet-width, 100vw) + var(--trip-chat-rail-extra, 0px)), calc(100vw - var(--trip-chat-sheet-gutter, 0px)))',
  height: 'var(--trip-chat-sheet-height, min(var(--trip-chat-available-height, 82dvh), 620px))',
  maxHeight:
    'var(--trip-chat-sheet-max-height, var(--trip-chat-sheet-height, min(var(--trip-chat-available-height, 82dvh), 620px)))',
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
  background: 'transparent',
  border: 'none',
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

const chatTitleWrapStyle: React.CSSProperties = {
  flex: 1,
  minWidth: 0,
  textAlign: 'center',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: 2,
};

const chatTitleStyle: React.CSSProperties = {
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

const chatContextStyle: React.CSSProperties = {
  maxWidth: '100%',
  color: '#A03E1F',
  fontFamily: 'Inter, system-ui, sans-serif',
  fontSize: 10,
  fontWeight: 600,
  lineHeight: 1,
  letterSpacing: '0.14em',
  textTransform: 'uppercase',
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
};

const messagesStyle: React.CSSProperties = {
  flex: 1,
  overflowY: 'auto',
  overscrollBehavior: 'contain',
  WebkitOverflowScrolling: 'touch',
  touchAction: 'pan-y',
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

const statusIconStyle: React.CSSProperties = {
  width: 18,
  height: 18,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  color: '#A03E1F',
  marginLeft: -2,
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

const progressTrailWrapStyle: React.CSSProperties = {
  margin: '-4px 0 2px 28px',
  paddingLeft: 8,
  borderLeft: '1px solid #E8E1D6',
};

const progressTrailLabelStyle: React.CSSProperties = {
  margin: '0 0 5px',
  color: '#9B4F2E',
  fontSize: 10,
  fontWeight: 600,
  letterSpacing: '0.14em',
  lineHeight: 1,
  textTransform: 'uppercase',
};

const progressTrailStyle: React.CSSProperties = {
  margin: 0,
  padding: 0,
  listStyle: 'none',
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
  color: '#6B6157',
  fontSize: 12,
  lineHeight: 1.45,
};

const progressTrailItemStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '16px minmax(0, 1fr)',
  columnGap: 7,
  rowGap: 3,
  alignItems: 'start',
};

const progressTrailIconStyle: React.CSSProperties = {
  width: 16,
  height: 16,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  color: '#9B4F2E',
  marginTop: 1,
};

const progressTrailMessageStyle: React.CSSProperties = {
  minWidth: 0,
};

const progressTrailMetaStyle: React.CSSProperties = {
  gridColumn: '2',
  display: 'flex',
  flexWrap: 'wrap',
  gap: 4,
};

const progressTrailChipStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  minHeight: 17,
  padding: '1px 6px',
  borderRadius: 999,
  background: '#F4EDE2',
  color: '#6B6157',
  fontSize: 10,
  fontWeight: 560,
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

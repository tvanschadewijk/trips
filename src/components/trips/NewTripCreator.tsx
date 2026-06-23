'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AnimatePresence, motion } from 'motion/react';
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  Check,
  CircleDashed,
  Clock3,
  FileText,
  IdCard,
  Image as ImageIcon,
  Loader2,
  MapPinned,
  MessageCircle,
  Minus,
  Paperclip,
  Sparkles,
  Trash2,
  UploadCloud,
  X,
  UserPlus,
  Users,
} from 'lucide-react';
import {
  MAX_REFERENCE_FILE_BYTES,
  MAX_REFERENCE_IMAGE_BYTES,
  MAX_REFERENCE_SOURCES,
  formatFileSize,
  inferReferenceContentType,
  referenceFileIsAccepted,
  referenceFileIsImage,
  type TripReferenceSource,
} from '@/lib/trip-references';
import {
  createBlankTravelerProfile,
  summarizeTravelerProfiles,
  type TravelerProfile,
  type TravelProfilePreferences,
} from '@/lib/travel-profile';

type Props = {
  initialPreferences: TravelProfilePreferences;
  profileComplete: boolean;
  open?: boolean;
  defaultOpen?: boolean;
  autoOpen?: boolean;
  showEntryButton?: boolean;
  onOpenChange?: (open: boolean) => void;
  sheetTitle?: string;
  profileNextHref?: string;
  showExistingTripHint?: boolean;
};

type FormState = {
  destination: string;
  start_date: string;
  end_date: string;
  travelers: string;
  traveler_profiles: TravelerProfile[];
  origin: string;
  must_do: string;
  known_bookings: string;
  budget: string;
  pace: 'from_profile' | 'relaxed' | 'balanced' | 'full';
  notes: string;
  reference_text: string;
  reference_sources: TripReferenceSource[];
};

type DraftResponse = {
  generation_session_id: string;
  trip_id: string;
  share_id: string;
  url: string;
  agent_message: string;
  profile_complete: boolean;
};

type ChatTurnResponse = {
  status?: 'queued' | 'fast_lane';
  assistant_message: string | null;
  thread_id?: string | null;
  thread_title?: string | null;
  tool_calls_summary?: unknown[];
  turn_index: number;
};

type ChatMessage = {
  id: string;
  turn_index: number;
  role: 'user' | 'assistant';
  content: string;
  tool_calls_json: unknown[] | null;
};

type ChatHistoryResponse = {
  messages: ChatMessage[];
  thread_id?: string | null;
};

type BriefQuestion =
  | 'destination'
  | 'dates'
  | 'travelers'
  | 'origin'
  | 'style'
  | 'must_do'
  | 'known_bookings'
  | 'notes'
  | 'references'
  | 'review';

type GenerationStep = 'idle' | 'draft' | 'agent' | 'poll' | 'done' | 'error';

const POLL_INTERVAL_MS = 2400;
const POLL_TIMEOUT_MS = 305_000;
const TRIP_OPEN_DELAY_MS = 1500;
const DEFAULT_PROFILE_NEXT_HREF = '/dashboard?agent=new';
const NEW_TRIP_KEYBOARD_INSET_THRESHOLD = 100;
const NEW_TRIP_TOP_CLEARANCE_PX = 8;
const NEW_TRIP_MIN_VISIBLE_SHEET_PX = 176;
const NEW_TRIP_SWIPE_CLOSE_THRESHOLD_PX = 68;

function isEditableElement(value: Element | null): value is HTMLElement {
  if (!(value instanceof HTMLElement)) return false;
  const tagName = value.tagName;
  return value.isContentEditable || tagName === 'INPUT' || tagName === 'TEXTAREA';
}
const questionOrder: BriefQuestion[] = [
  'destination',
  'dates',
  'travelers',
  'origin',
  'style',
  'must_do',
  'known_bookings',
  'notes',
  'references',
  'review',
];

const referenceAccept = [
  'application/pdf',
  'text/plain',
  'text/markdown',
  'application/json',
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
  '.pdf',
  '.txt',
  '.md',
  '.markdown',
  '.json',
  '.jpg',
  '.jpeg',
  '.png',
  '.webp',
  '.heic',
  '.heif',
].join(',');

const weekdayLabels = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function parseIsoDate(value: string): Date {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
}

function formatIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function addDaysIso(value: string, days: number): string {
  const date = parseIsoDate(value);
  date.setUTCDate(date.getUTCDate() + days);
  return formatIsoDate(date);
}

function addMonthsIso(value: string, months: number): string {
  const date = parseIsoDate(value);
  date.setUTCMonth(date.getUTCMonth() + months, 1);
  return formatIsoDate(date);
}

function monthStartIso(value: string): string {
  const date = parseIsoDate(value);
  date.setUTCDate(1);
  return formatIsoDate(date);
}

function compareIsoDates(a: string, b: string): number {
  return a.localeCompare(b);
}

function inclusiveDayCount(startDate: string, endDate: string): number {
  const start = parseIsoDate(startDate).getTime();
  const end = parseIsoDate(endDate).getTime();
  return Math.round((end - start) / 86_400_000) + 1;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function formatDisplayDate(value: string): string {
  return parseIsoDate(value).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

function formatMonth(value: string): string {
  return parseIsoDate(value).toLocaleDateString('en-US', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

function formatElapsed(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes === 0) return `${seconds}s`;
  return `${minutes}m ${seconds.toString().padStart(2, '0')}s`;
}

function clampEndAfterStart(startDate: string, endDate: string): string {
  if (compareIsoDates(startDate, endDate) < 0) return endDate;
  return addDaysIso(startDate, 5);
}

function travelerSummary(profiles: TravelerProfile[]): string {
  return summarizeTravelerProfiles(profiles) || 'No travelers selected';
}

function referenceAnswerSummary(referenceText: string, sources: TripReferenceSource[]): string {
  const parts: string[] = [];
  if (referenceText.trim()) parts.push('pasted notes');
  if (sources.length) parts.push(`${sources.length} upload${sources.length === 1 ? '' : 's'}`);
  return parts.length ? parts.join(' + ') : 'No reference material';
}

function generationEstimate(dayCount: number, elapsedSeconds: number): string {
  const expectedSeconds = dayCount > 14 ? 300 : 210;
  const remainingSeconds = Math.max(0, expectedSeconds - elapsedSeconds);
  if (remainingSeconds === 0) {
    return 'This is taking longer than the usual window, but it can still finish normally.';
  }
  const remainingMinutes = Math.max(1, Math.ceil(remainingSeconds / 60));
  return `Trips this size usually take ${dayCount > 14 ? '4-6' : '3-5'} minutes. Roughly ${remainingMinutes} minute${remainingMinutes === 1 ? '' : 's'} may remain.`;
}

async function updateGeneration(
  generationSessionId: string,
  payload: {
    status: 'draft' | 'queued' | 'running' | 'completed' | 'failed';
    chat_thread_id?: string | null;
    turn_index?: number | null;
    error?: string | null;
  }
) {
  await fetch(`/api/trip-generations/${generationSessionId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }).catch(() => {});
}

async function pollForAssistant(tripId: string, threadId: string, turnIndex: number) {
  const started = Date.now();

  while (Date.now() - started < POLL_TIMEOUT_MS) {
    const res = await fetch(
      `/api/trips/${tripId}/chat?limit=20&thread_id=${encodeURIComponent(threadId)}&turn_index=${turnIndex}`,
      { cache: 'no-store' }
    );
    if (res.ok) {
      const json = (await res.json()) as ChatHistoryResponse;
      const assistant = json.messages.find(
        (message) => message.role === 'assistant' && message.turn_index === turnIndex
      );
      if (assistant) return assistant;
    }
    await sleep(POLL_INTERVAL_MS);
  }

  throw new Error('The trip creator is taking longer than expected. Open the draft trip and continue from there.');
}

export default function NewTripCreator({
  initialPreferences,
  profileComplete,
  open,
  defaultOpen = false,
  autoOpen = true,
  showEntryButton = true,
  onOpenChange,
  sheetTitle = 'Ask Travel Agent',
  profileNextHref = DEFAULT_PROFILE_NEXT_HREF,
  showExistingTripHint = false,
}: Props) {
  const router = useRouter();
  const defaultStart = useMemo(() => addDaysIso(todayIso(), 60), []);
  const defaultEnd = useMemo(() => addDaysIso(defaultStart, 5), [defaultStart]);
  const initialTravelers = useMemo(
    () => initialPreferences.traveler_profiles.filter((profile) => profile.full_name.trim()),
    [initialPreferences.traveler_profiles]
  );
  const [form, setForm] = useState<FormState>({
    destination: '',
    start_date: defaultStart,
    end_date: defaultEnd,
    travelers: summarizeTravelerProfiles(initialTravelers),
    traveler_profiles: initialTravelers,
    origin: initialPreferences.home_base,
    must_do: '',
    known_bookings: '',
    budget: initialPreferences.budget === 'varies' ? '' : initialPreferences.budget.replace(/_/g, ' '),
    pace: 'from_profile',
    notes: '',
    reference_text: '',
    reference_sources: [],
  });
  const [activeQuestion, setActiveQuestion] = useState<BriefQuestion>('destination');
  const [completedQuestions, setCompletedQuestions] = useState<BriefQuestion[]>([]);
  const [busy, setBusy] = useState(false);
  const [generationStep, setGenerationStep] = useState<GenerationStep>('idle');
  const [statusText, setStatusText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [draftUrl, setDraftUrl] = useState<string | null>(null);
  const [completedTripUrl, setCompletedTripUrl] = useState<string | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [uncontrolledAgentOpen, setUncontrolledAgentOpen] = useState(defaultOpen);
  const agentOpen = open ?? uncontrolledAgentOpen;
  const profileHref = `/onboarding?next=${encodeURIComponent(profileNextHref)}`;
  const [layoutViewportHeight, setLayoutViewportHeight] = useState<number | null>(null);
  const [keyboardInset, setKeyboardInset] = useState(0);
  const [isKeyboardVisible, setIsKeyboardVisible] = useState(false);
  const sheetRef = useRef<HTMLElement | null>(null);
  const touchStartYRef = useRef<number | null>(null);
  const sheetTouchLastYRef = useRef<number | null>(null);
  const sheetTouchScrollableRef = useRef<HTMLElement | null>(null);

  const currentQuestionIndex = questionOrder.indexOf(activeQuestion);
  const dayCount = inclusiveDayCount(form.start_date, form.end_date);
  const working = generationStep !== 'idle' && generationStep !== 'error';
  const completed = generationStep === 'done' && Boolean(completedTripUrl);

  useEffect(() => {
    if (!busy) return;
    setElapsedSeconds(0);
    const timer = window.setInterval(() => {
      setElapsedSeconds((current) => current + 1);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [busy]);

  const setAgentOpen = useCallback((nextOpen: boolean) => {
    if (open === undefined) setUncontrolledAgentOpen(nextOpen);
    onOpenChange?.(nextOpen);
  }, [onOpenChange, open]);

  const closeAgentSheet = useCallback(() => {
    if (busy) return;
    setAgentOpen(false);
  }, [busy, setAgentOpen]);

  useEffect(() => {
    if (open !== undefined || !autoOpen) return;
    const timer = window.setTimeout(() => {
      setAgentOpen(true);
    }, 180);
    return () => window.clearTimeout(timer);
  }, [autoOpen, open, setAgentOpen]);

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
        sheetInputFocused && obscured > NEW_TRIP_KEYBOARD_INSET_THRESHOLD ? obscured : 0;
      const maxUsableInset = Math.max(
        0,
        window.innerHeight - NEW_TRIP_MIN_VISIBLE_SHEET_PX - NEW_TRIP_TOP_CLEARANCE_PX
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
  }, []);

  useEffect(() => {
    const sheet = sheetRef.current;
    if (!sheet || !agentOpen) return;

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
      const body = sheet.querySelector('.trip-new-agent-sheet-body') as HTMLElement | null;
      const startedInBody = !!body && event.target instanceof Node && body.contains(event.target);
      touchStartYRef.current =
        startedInBody && body.scrollTop <= 0.5 ? event.touches[0]?.clientY ?? null : null;
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

      if (busy || isKeyboardVisible || touchStartYRef.current === null) return;
      if (currentY - touchStartYRef.current > NEW_TRIP_SWIPE_CLOSE_THRESHOLD_PX) {
        touchStartYRef.current = null;
        closeAgentSheet();
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
  }, [agentOpen, busy, closeAgentSheet, isKeyboardVisible]);

  function setField<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function setTravelerProfiles(profiles: TravelerProfile[]) {
    const namedProfiles = profiles;
    setForm((current) => ({
      ...current,
      traveler_profiles: namedProfiles,
      travelers: summarizeTravelerProfiles(namedProfiles),
    }));
  }

  function completeQuestion(question: BriefQuestion, next: BriefQuestion) {
    setCompletedQuestions((current) => (
      current.includes(question) ? current : [...current, question]
    ));
    setActiveQuestion(next);
  }

  function goBack() {
    const index = questionOrder.indexOf(activeQuestion);
    if (index <= 0 || busy) return;
    setActiveQuestion(questionOrder[index - 1]);
  }

  function isVisible(question: BriefQuestion) {
    const index = questionOrder.indexOf(question);
    return index <= currentQuestionIndex || completedQuestions.includes(question);
  }

  function isComplete(question: BriefQuestion) {
    return completedQuestions.includes(question);
  }

  async function createTrip() {
    if (busy) return;

    const travelers = summarizeTravelerProfiles(form.traveler_profiles);
    const payload = {
      ...form,
      travelers,
      traveler_profiles: form.traveler_profiles.filter((profile) => profile.full_name.trim()),
      end_date: clampEndAfterStart(form.start_date, form.end_date),
    };

    let draft: DraftResponse | null = null;
    setBusy(true);
    setError(null);
    setDraftUrl(null);
    setCompletedTripUrl(null);
    setElapsedSeconds(0);

    try {
      setGenerationStep('draft');
      setStatusText('Creating the trip workspace and saving your brief...');
      const draftRes = await fetch('/api/trips/create-draft', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const draftBody = await draftRes.json().catch(() => ({}));
      if (!draftRes.ok) {
        throw new Error(draftBody.error ?? `HTTP ${draftRes.status}`);
      }
      draft = draftBody as DraftResponse;
      const tripUrl = `/t/${encodeURIComponent(draft.share_id)}`;
      setDraftUrl(tripUrl);
      router.prefetch(tripUrl);

      setGenerationStep('agent');
      setStatusText('Starting the travel agent with the destination, dates, travelers, profile context, and reference material...');
      const chatRes = await fetch(`/api/trips/${draft.trip_id}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: draft.agent_message,
          thread_id: null,
          view_context: null,
        }),
      });
      const chatBody = await chatRes.json().catch(() => ({}));
      if (!chatRes.ok) {
        await updateGeneration(draft.generation_session_id, {
          status: 'failed',
          error: chatBody.error ?? `HTTP ${chatRes.status}`,
        });
        throw new Error(chatBody.detail ? `${chatBody.error} - ${chatBody.detail}` : chatBody.error ?? `HTTP ${chatRes.status}`);
      }

      const turn = chatBody as ChatTurnResponse;
      const threadId = turn.thread_id;
      if (!threadId) {
        throw new Error('The trip creator did not return a generation thread.');
      }
      await updateGeneration(draft.generation_session_id, {
        status: turn.status === 'queued' ? 'queued' : 'running',
        chat_thread_id: threadId,
        turn_index: turn.turn_index,
      });

      if (turn.status === 'queued') {
        setGenerationStep('poll');
        setStatusText('The agent is replacing placeholder days with a complete itinerary, then checking quality and logistics...');
        await pollForAssistant(draft.trip_id, threadId, turn.turn_index);
      }

      setGenerationStep('done');
      setCompletedTripUrl(tripUrl);
      setStatusText('Everything is finished. I am opening the new trip now.');
      await updateGeneration(draft.generation_session_id, {
        status: 'completed',
        chat_thread_id: threadId,
        turn_index: turn.turn_index,
      });
      await sleep(TRIP_OPEN_DELAY_MS);
      router.push(tripUrl);
    } catch (err) {
      setGenerationStep('error');
      const message = err instanceof Error ? err.message : 'Failed to create trip';
      setError(message);
      if (draft) {
        await updateGeneration(draft.generation_session_id, {
          status: 'failed',
          error: message,
        });
      }
    } finally {
      setBusy(false);
    }
  }

  const creatorContent = (
    <div className="trip-create-shell">
      <section className="trip-create-main trip-agent-panel" aria-label="New trip agent questions">
        {!profileComplete && (
          <div className="trip-create-notice">
            <AlertCircle size={16} aria-hidden="true" />
            <span>Your travel profile is not finished yet.</span>
            <Link href={profileHref}>Finish profile</Link>
          </div>
        )}

        <div className="trip-agent-header">
          <div className="trip-create-section-heading">
            <MessageCircle size={18} aria-hidden="true" />
            <div>
              <h2>Travel agent</h2>
              <p>The trip starts here, one answer at a time.</p>
            </div>
          </div>
          <button
            className="trip-agent-back"
            type="button"
            disabled={activeQuestion === 'destination' || busy}
            onClick={goBack}
            aria-label="Go back to the previous question"
          >
            <ArrowLeft size={16} aria-hidden="true" />
          </button>
        </div>

        <div className="trip-agent-chat" data-trip-agent-chat>
          <AgentBubble>
            I will gather the brief in the same place the trip gets built. Once the basics are clear, I will start the travel agent and keep you posted while it works.
          </AgentBubble>

          <QuestionBlock
            visible={isVisible('destination')}
            complete={isComplete('destination')}
            active={activeQuestion === 'destination'}
            question="Where are we going?"
            answer={form.destination || 'Destination not set'}
          >
            <TextAnswerControl
              value={form.destination}
              placeholder="Japan, Sicily, Patagonia"
              buttonLabel="Set destination"
              disabled={busy}
              requiredLength={2}
              onChange={(value) => setField('destination', value)}
              onSubmit={() => completeQuestion('destination', 'dates')}
            />
          </QuestionBlock>

          <QuestionBlock
            visible={isVisible('dates')}
            complete={isComplete('dates')}
            active={activeQuestion === 'dates'}
            question="When should the trip start and end?"
            answer={`${formatDisplayDate(form.start_date)} to ${formatDisplayDate(form.end_date)} (${dayCount} days)`}
          >
            <DateRangePicker
              startDate={form.start_date}
              endDate={form.end_date}
              minDate={todayIso()}
              disabled={busy}
              onChange={(startDate, endDate) => {
                setForm((current) => ({
                  ...current,
                  start_date: startDate,
                  end_date: clampEndAfterStart(startDate, endDate),
                }));
              }}
              onSubmit={() => completeQuestion('dates', 'travelers')}
            />
          </QuestionBlock>

          <QuestionBlock
            visible={isVisible('travelers')}
            complete={isComplete('travelers')}
            active={activeQuestion === 'travelers'}
            question="Who is traveling?"
            answer={travelerSummary(form.traveler_profiles)}
          >
            <TravelerAnswerControl
              profiles={form.traveler_profiles}
              disabled={busy}
              onChange={setTravelerProfiles}
              onSubmit={() => completeQuestion('travelers', 'origin')}
            />
          </QuestionBlock>

          <QuestionBlock
            visible={isVisible('origin')}
            complete={isComplete('origin')}
            active={activeQuestion === 'origin'}
            question="Where should the trip start from?"
            answer={form.origin || 'No origin specified'}
          >
            <TextAnswerControl
              value={form.origin}
              placeholder="Amsterdam"
              buttonLabel="Set origin"
              skipLabel="Skip origin"
              disabled={busy}
              onChange={(value) => setField('origin', value)}
              onSubmit={() => completeQuestion('origin', 'style')}
              onSkip={() => completeQuestion('origin', 'style')}
            />
          </QuestionBlock>

          <QuestionBlock
            visible={isVisible('style')}
            complete={isComplete('style')}
            active={activeQuestion === 'style'}
            question="What budget and pace should I assume?"
            answer={`${form.budget || 'Use profile budget'} / ${form.pace.replace(/_/g, ' ')}`}
          >
            <StyleAnswerControl
              budget={form.budget}
              pace={form.pace}
              disabled={busy}
              onBudgetChange={(value) => setField('budget', value)}
              onPaceChange={(value) => setField('pace', value)}
              onSubmit={() => completeQuestion('style', 'must_do')}
            />
          </QuestionBlock>

          <QuestionBlock
            visible={isVisible('must_do')}
            complete={isComplete('must_do')}
            active={activeQuestion === 'must_do'}
            question="Any must-do or must-see items?"
            answer={form.must_do || 'No must-dos added'}
          >
            <TextAreaAnswerControl
              value={form.must_do}
              placeholder="A ryokan night, Naoshima, no more than one temple-heavy day"
              buttonLabel="Save must-dos"
              skipLabel="No must-dos"
              disabled={busy}
              onChange={(value) => setField('must_do', value)}
              onSubmit={() => completeQuestion('must_do', 'known_bookings')}
              onSkip={() => completeQuestion('must_do', 'known_bookings')}
            />
          </QuestionBlock>

          <QuestionBlock
            visible={isVisible('known_bookings')}
            complete={isComplete('known_bookings')}
            active={activeQuestion === 'known_bookings'}
            question="Is anything already booked?"
            answer={form.known_bookings || 'No bookings added'}
          >
            <TextAreaAnswerControl
              value={form.known_bookings}
              placeholder="Flights, hotels, dinner reservations, tickets"
              buttonLabel="Save bookings"
              skipLabel="Nothing booked yet"
              disabled={busy}
              onChange={(value) => setField('known_bookings', value)}
              onSubmit={() => completeQuestion('known_bookings', 'notes')}
              onSkip={() => completeQuestion('known_bookings', 'notes')}
            />
          </QuestionBlock>

          <QuestionBlock
            visible={isVisible('notes')}
            complete={isComplete('notes')}
            active={activeQuestion === 'notes'}
            question="Anything else I should know before I build it?"
            answer={form.notes || 'No extra notes'}
          >
            <TextAreaAnswerControl
              value={form.notes}
              placeholder="Season, weather tolerance, routing ideas, things to avoid"
              buttonLabel="Save notes"
              skipLabel="No extra notes"
              disabled={busy}
              onChange={(value) => setField('notes', value)}
              onSubmit={() => completeQuestion('notes', 'references')}
              onSkip={() => completeQuestion('notes', 'references')}
            />
          </QuestionBlock>

          <QuestionBlock
            visible={isVisible('references')}
            complete={isComplete('references')}
            active={activeQuestion === 'references'}
            question="Do you have any reference material for this trip?"
            answer={referenceAnswerSummary(form.reference_text, form.reference_sources)}
          >
            <ReferenceAnswerControl
              referenceText={form.reference_text}
              sources={form.reference_sources}
              disabled={busy}
              onReferenceTextChange={(value) => setField('reference_text', value)}
              onSourcesChange={(sources) => setField('reference_sources', sources)}
              onSubmit={() => completeQuestion('references', 'review')}
              onSkip={() => completeQuestion('references', 'review')}
            />
          </QuestionBlock>

          {isVisible('review') && (
            <div className="trip-agent-turn">
              <AgentBubble>
                I have enough to create the workspace and ask the travel agent for the first complete draft. Generation can take a few minutes, so I will keep the progress panel moving while it works.
              </AgentBubble>
              <ReviewBrief
                form={form}
                dayCount={dayCount}
                busy={busy}
                error={error}
                draftUrl={draftUrl}
                completedTripUrl={completedTripUrl}
                onCreate={createTrip}
              />
              {completed && (
                <AgentBubble>
                  Everything is finished. I am opening the new trip now.
                </AgentBubble>
              )}
            </div>
          )}
        </div>
      </section>

      <aside className="trip-create-status trip-agent-status">
        <div className="trip-create-section-heading">
          <Sparkles size={18} aria-hidden="true" />
          <div>
            <h2>Progress</h2>
            <p>{completed ? 'Trip created' : busy ? `Working for ${formatElapsed(elapsedSeconds)}` : 'Agent-led setup'}</p>
          </div>
        </div>

        <ol className="trip-create-steps">
          <StatusStep active={!busy && activeQuestion !== 'review'} done={activeQuestion === 'review' || busy} label="Gather brief" />
          <StatusStep active={working && generationStep === 'draft'} done={['agent', 'poll', 'done'].includes(generationStep)} label="Create workspace" />
          <StatusStep active={generationStep === 'agent'} done={['poll', 'done'].includes(generationStep)} label="Start travel agent" />
          <StatusStep active={generationStep === 'poll'} done={generationStep === 'done'} label="Build and check draft" />
          <StatusStep active={generationStep === 'done'} done={generationStep === 'done'} label="Open trip" />
        </ol>

        <div className={`trip-generation-now ${completed ? 'is-success' : ''}`} aria-live="polite">
          {completed ? (
            <Check size={16} aria-hidden="true" />
          ) : (
            <Clock3 size={16} aria-hidden="true" />
          )}
          <div>
            <strong>{statusText || 'I am asking for the details needed to create the trip.'}</strong>
            <p>
              {completed && completedTripUrl ? (
                <>
                  Taking you to the trip page. If the browser does not move,{' '}
                  <Link href={completedTripUrl}>open the trip manually</Link>.
                </>
              ) : busy ? (
                generationEstimate(dayCount, elapsedSeconds)
              ) : (
                'Once generation starts, this panel will show what the agent is doing and how long it may still take.'
              )}
            </p>
          </div>
        </div>

        {showExistingTripHint && (
          <div className="trip-agent-context-hint">
            <MessageCircle size={15} aria-hidden="true" />
            <p>
              Want to discuss an existing trip? Open that trip and start the chat there so the agent already has the itinerary, bookings, and trip context.
            </p>
          </div>
        )}

        <BriefSnapshot form={form} dayCount={dayCount} />
      </aside>
    </div>
  );
  const layoutViewportHeightCss = layoutViewportHeight ? `${layoutViewportHeight}px` : '100dvh';
  const availableSheetHeight = `max(${NEW_TRIP_MIN_VISIBLE_SHEET_PX}px, calc(${layoutViewportHeightCss} - env(safe-area-inset-top, 0px) - ${NEW_TRIP_TOP_CLEARANCE_PX}px - ${keyboardInset}px))`;
  const sheetRuntimeStyle = {
    bottom: keyboardInset,
    '--trip-new-agent-available-height': availableSheetHeight,
  } as React.CSSProperties;

  return (
    <div className={`trip-new-agent-stage ${showEntryButton ? '' : 'is-floating-only'}`}>
      <AnimatePresence>
        {showEntryButton && !agentOpen && (
          <motion.button
            key="new-trip-entry"
            type="button"
            className="trip-ask-entry trip-new-ask-entry"
            aria-label="Ask Travel Agent"
            onClick={() => setAgentOpen(true)}
            initial={{ opacity: 0, x: '-50%', y: 12, scale: 0.95 }}
            animate={{ opacity: 1, x: '-50%', y: 0, scale: 1 }}
            exit={{ opacity: 0, x: '-50%', y: 12, scale: 0.95 }}
            transition={{ type: 'spring', damping: 22, stiffness: 380, mass: 0.7 }}
            whileTap={{ scale: 0.96 }}
          >
            <MessageCircle className="trip-ask-entry-icon" aria-hidden="true" />
            <span className="trip-ask-entry-label">Ask Travel Agent</span>
          </motion.button>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {agentOpen && (
          <>
            <motion.div
              key="new-trip-backdrop"
              className="trip-new-agent-backdrop"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              onClick={() => {
                if (isKeyboardVisible) {
                  const activeElement = document.activeElement;
                  if (activeElement instanceof HTMLElement) activeElement.blur();
                  return;
                }
                closeAgentSheet();
              }}
            />
            <motion.section
              key="new-trip-sheet"
              ref={sheetRef}
              role="dialog"
              aria-label={sheetTitle}
              aria-modal="true"
              className="trip-new-agent-sheet"
              style={sheetRuntimeStyle}
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={{ type: 'spring', damping: 22, stiffness: 380, mass: 0.7 }}
            >
              <button
                type="button"
                className="trip-new-agent-grabber"
                onClick={() => {
                  closeAgentSheet();
                }}
                disabled={busy}
                aria-label="Minimize new trip agent"
              >
                <span aria-hidden="true" />
              </button>
              <header className="trip-new-agent-sheet-header">
                <span />
                <div>{sheetTitle}</div>
                <button
                  type="button"
                  onClick={closeAgentSheet}
                  disabled={busy}
                  aria-label="Close new trip agent"
                >
                  <X size={17} strokeWidth={2.2} aria-hidden="true" />
                </button>
              </header>
              <div className="trip-new-agent-sheet-body">
                {creatorContent}
              </div>
            </motion.section>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}

function AgentBubble({ children }: { children: ReactNode }) {
  return (
    <div className="trip-agent-bubble trip-agent-bubble-assistant">
      <span className="trip-agent-avatar">
        <Sparkles size={15} aria-hidden="true" />
      </span>
      <div>{children}</div>
    </div>
  );
}

function UserChoiceBubble({ children }: { children: ReactNode }) {
  return (
    <div className="trip-agent-bubble trip-agent-bubble-user">
      <div>{children}</div>
    </div>
  );
}

function QuestionBlock({
  visible,
  complete,
  active,
  question,
  answer,
  children,
}: {
  visible: boolean;
  complete: boolean;
  active: boolean;
  question: string;
  answer: string;
  children: ReactNode;
}) {
  if (!visible) return null;

  return (
    <div className={`trip-agent-turn ${active ? 'is-active' : ''}`}>
      <AgentBubble>{question}</AgentBubble>
      {complete ? <UserChoiceBubble>{answer}</UserChoiceBubble> : children}
    </div>
  );
}

function TextAnswerControl({
  value,
  placeholder,
  buttonLabel,
  skipLabel,
  requiredLength = 0,
  disabled,
  onChange,
  onSubmit,
  onSkip,
}: {
  value: string;
  placeholder: string;
  buttonLabel: string;
  skipLabel?: string;
  requiredLength?: number;
  disabled: boolean;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onSkip?: () => void;
}) {
  const canSubmit = value.trim().length >= requiredLength;
  return (
    <div className="trip-agent-control">
      <input
        value={value}
        placeholder={placeholder}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && canSubmit && !disabled) onSubmit();
        }}
      />
      <div className="trip-agent-control-actions">
        {onSkip && (
          <button className="trip-agent-secondary" type="button" disabled={disabled} onClick={onSkip}>
            {skipLabel ?? 'Skip'}
          </button>
        )}
        <button className="trip-create-primary" type="button" disabled={disabled || !canSubmit} onClick={onSubmit}>
          {buttonLabel}
          <ArrowRight size={16} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}

function TextAreaAnswerControl({
  value,
  placeholder,
  buttonLabel,
  skipLabel,
  disabled,
  onChange,
  onSubmit,
  onSkip,
}: {
  value: string;
  placeholder: string;
  buttonLabel: string;
  skipLabel: string;
  disabled: boolean;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onSkip: () => void;
}) {
  return (
    <div className="trip-agent-control">
      <textarea
        value={value}
        placeholder={placeholder}
        rows={4}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
      />
      <div className="trip-agent-control-actions">
        <button className="trip-agent-secondary" type="button" disabled={disabled} onClick={onSkip}>
          {skipLabel}
        </button>
        <button className="trip-create-primary" type="button" disabled={disabled} onClick={onSubmit}>
          {buttonLabel}
          <ArrowRight size={16} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}

function ReferenceAnswerControl({
  referenceText,
  sources,
  disabled,
  onReferenceTextChange,
  onSourcesChange,
  onSubmit,
  onSkip,
}: {
  referenceText: string;
  sources: TripReferenceSource[];
  disabled: boolean;
  onReferenceTextChange: (value: string) => void;
  onSourcesChange: (sources: TripReferenceSource[]) => void;
  onSubmit: () => void;
  onSkip: () => void;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const uploadDisabled = disabled || uploading || sources.length >= MAX_REFERENCE_SOURCES;

  async function uploadFiles(fileList: FileList | null) {
    const files = Array.from(fileList ?? []);
    if (!files.length || uploadDisabled) return;

    setUploadError(null);
    setUploading(true);
    let nextSources = sources;

    try {
      for (const file of files) {
        if (nextSources.length >= MAX_REFERENCE_SOURCES) {
          setUploadError(`You can attach up to ${MAX_REFERENCE_SOURCES} references.`);
          break;
        }

        const contentType = inferReferenceContentType(file.name, file.type);
        if (!referenceFileIsAccepted(file.name, contentType)) {
          setUploadError(`${file.name} is not a supported PDF, photo, text, markdown, or JSON file.`);
          continue;
        }

        const maxBytes = referenceFileIsImage(contentType)
          ? MAX_REFERENCE_IMAGE_BYTES
          : MAX_REFERENCE_FILE_BYTES;
        if (file.size > maxBytes) {
          setUploadError(`${file.name} must be smaller than ${formatFileSize(maxBytes)}.`);
          continue;
        }

        const body = new FormData();
        body.append('file', file);
        const res = await fetch('/api/trip-references', {
          method: 'POST',
          body,
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) {
          setUploadError(json.error ?? `Could not upload ${file.name}.`);
          continue;
        }

        if (json.source) {
          nextSources = [...nextSources, json.source as TripReferenceSource];
          onSourcesChange(nextSources);
        }
      }
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  function removeSource(id: string) {
    onSourcesChange(sources.filter((source) => source.id !== id));
  }

  return (
    <div className="trip-agent-control trip-agent-references">
      <textarea
        value={referenceText}
        placeholder="Paste notes, markdown, a rough prompt, booking details, or an existing itinerary outline"
        rows={5}
        disabled={disabled}
        onChange={(event) => onReferenceTextChange(event.target.value)}
      />

      <div className="trip-reference-upload-row">
        <input
          ref={inputRef}
          type="file"
          accept={referenceAccept}
          multiple
          disabled={uploadDisabled}
          onChange={(event) => void uploadFiles(event.target.files)}
        />
        <button
          className="trip-agent-secondary"
          type="button"
          disabled={uploadDisabled}
          onClick={() => inputRef.current?.click()}
        >
          {uploading ? (
            <Loader2 className="trip-reference-spin" size={15} aria-hidden="true" />
          ) : (
            <UploadCloud size={15} aria-hidden="true" />
          )}
          {uploading ? 'Uploading...' : 'Upload PDF or photo'}
        </button>
        <span>
          {sources.length}/{MAX_REFERENCE_SOURCES}
        </span>
      </div>

      {uploadError && (
        <div className="trip-reference-error">
          <AlertCircle size={15} aria-hidden="true" />
          <span>{uploadError}</span>
        </div>
      )}

      {sources.length > 0 && (
        <div className="trip-reference-list">
          {sources.map((source) => (
            <article className="trip-reference-item" key={source.id}>
              <div className="trip-reference-icon">
                {source.kind === 'photo' ? (
                  <ImageIcon size={16} aria-hidden="true" />
                ) : (
                  <FileText size={16} aria-hidden="true" />
                )}
              </div>
              <div className="trip-reference-copy">
                <div className="trip-reference-title-row">
                  <strong>{source.file_name}</strong>
                  <span className={`trip-reference-status is-${source.status}`}>
                    {source.status === 'ready' ? 'Ready' : source.status}
                  </span>
                </div>
                <p>
                  {source.extracted_text.trim() ||
                    source.error ||
                    'Attached, but no readable text was extracted yet.'}
                </p>
                <span className="trip-reference-meta">
                  <Paperclip size={12} aria-hidden="true" />
                  {[source.content_type, source.size ? formatFileSize(source.size) : null]
                    .filter(Boolean)
                    .join(' / ')}
                </span>
              </div>
              <button
                type="button"
                disabled={disabled || uploading}
                aria-label={`Remove ${source.file_name}`}
                onClick={() => removeSource(source.id)}
              >
                <Trash2 size={14} aria-hidden="true" />
              </button>
            </article>
          ))}
        </div>
      )}

      <div className="trip-agent-control-actions">
        <button className="trip-agent-secondary" type="button" disabled={disabled || uploading} onClick={onSkip}>
          {referenceText.trim() || sources.length ? 'Continue without more' : 'No references'}
        </button>
        <button className="trip-create-primary" type="button" disabled={disabled || uploading} onClick={onSubmit}>
          Continue
          <ArrowRight size={16} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}

function StyleAnswerControl({
  budget,
  pace,
  disabled,
  onBudgetChange,
  onPaceChange,
  onSubmit,
}: {
  budget: string;
  pace: FormState['pace'];
  disabled: boolean;
  onBudgetChange: (value: string) => void;
  onPaceChange: (value: FormState['pace']) => void;
  onSubmit: () => void;
}) {
  const paceOptions: Array<{ value: FormState['pace']; label: string }> = [
    { value: 'from_profile', label: 'Use profile' },
    { value: 'relaxed', label: 'Relaxed' },
    { value: 'balanced', label: 'Balanced' },
    { value: 'full', label: 'Full' },
  ];

  return (
    <div className="trip-agent-control">
      <input
        value={budget}
        placeholder="Mid-range, with one splurge hotel"
        disabled={disabled}
        onChange={(event) => onBudgetChange(event.target.value)}
      />
      <div className="trip-agent-segmented" role="radiogroup" aria-label="Trip pace">
        {paceOptions.map((option) => (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={pace === option.value}
            className={pace === option.value ? 'is-selected' : ''}
            disabled={disabled}
            onClick={() => onPaceChange(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>
      <div className="trip-agent-control-actions">
        <button className="trip-create-primary" type="button" disabled={disabled} onClick={onSubmit}>
          Continue
          <ArrowRight size={16} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}

function TravelerAnswerControl({
  profiles,
  disabled,
  onChange,
  onSubmit,
}: {
  profiles: TravelerProfile[];
  disabled: boolean;
  onChange: (profiles: TravelerProfile[]) => void;
  onSubmit: () => void;
}) {
  function addTraveler() {
    onChange([...profiles, createBlankTravelerProfile()]);
  }

  function updateTraveler(index: number, patch: Partial<TravelerProfile>) {
    onChange(profiles.map((profile, profileIndex) => (
      profileIndex === index ? { ...profile, ...patch } : profile
    )));
  }

  function removeTraveler(index: number) {
    onChange(profiles.filter((_, profileIndex) => profileIndex !== index));
  }

  return (
    <div className="trip-agent-control trip-agent-travelers">
      {profiles.length > 0 && (
        <div className="trip-agent-traveler-list">
          {profiles.map((profile, index) => (
            <article className="trip-agent-traveler" key={profile.id || index}>
              <div className="trip-agent-traveler-fields">
                <label>
                  <span>Traveler {index + 1}</span>
                  <input
                    value={profile.full_name}
                    placeholder="Full name"
                    disabled={disabled}
                    onChange={(event) => updateTraveler(index, { full_name: event.target.value })}
                  />
                </label>
                <label>
                  <span>Date of birth</span>
                  <input
                    type="date"
                    value={profile.date_of_birth}
                    disabled={disabled}
                    onChange={(event) => updateTraveler(index, { date_of_birth: event.target.value })}
                  />
                </label>
              </div>
              <div className="trip-agent-traveler-meta">
                {profile.passport_country || profile.passport_expiry || profile.passport_number ? (
                  <span><IdCard size={13} aria-hidden="true" /> Passport details on profile</span>
                ) : (
                  <span><Users size={13} aria-hidden="true" /> Trip traveler</span>
                )}
                <button
                  type="button"
                  disabled={disabled}
                  aria-label={`Remove ${profile.full_name || `traveler ${index + 1}`}`}
                  onClick={() => removeTraveler(index)}
                >
                  <Minus size={14} aria-hidden="true" />
                </button>
              </div>
            </article>
          ))}
        </div>
      )}

      <div className="trip-agent-control-actions">
        <button className="trip-agent-secondary" type="button" disabled={disabled} onClick={addTraveler}>
          <UserPlus size={15} aria-hidden="true" />
          Add traveler
        </button>
        <button className="trip-create-primary" type="button" disabled={disabled} onClick={onSubmit}>
          Continue
          <ArrowRight size={16} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}

function DateRangePicker({
  startDate,
  endDate,
  minDate,
  disabled,
  onChange,
  onSubmit,
}: {
  startDate: string;
  endDate: string;
  minDate: string;
  disabled: boolean;
  onChange: (startDate: string, endDate: string) => void;
  onSubmit: () => void;
}) {
  const [activeField, setActiveField] = useState<'start' | 'end'>('start');
  const [displayMonth, setDisplayMonth] = useState(monthStartIso(startDate));

  useEffect(() => {
    setDisplayMonth(monthStartIso(startDate));
  }, [startDate]);

  const cells = useMemo(() => {
    const monthDate = parseIsoDate(displayMonth);
    const firstDay = new Date(Date.UTC(monthDate.getUTCFullYear(), monthDate.getUTCMonth(), 1, 12, 0, 0));
    const mondayOffset = (firstDay.getUTCDay() + 6) % 7;
    const gridStart = new Date(firstDay);
    gridStart.setUTCDate(firstDay.getUTCDate() - mondayOffset);

    return Array.from({ length: 42 }, (_, index) => {
      const date = new Date(gridStart);
      date.setUTCDate(gridStart.getUTCDate() + index);
      const iso = formatIsoDate(date);
      const isCurrentMonth = date.getUTCMonth() === monthDate.getUTCMonth();
      const disabledByField = activeField === 'start'
        ? compareIsoDates(iso, minDate) < 0
        : compareIsoDates(iso, addDaysIso(startDate, 1)) < 0;
      return {
        iso,
        day: date.getUTCDate(),
        isCurrentMonth,
        disabled: disabledByField,
        isStart: iso === startDate,
        isEnd: iso === endDate,
        isInRange: compareIsoDates(startDate, iso) < 0 && compareIsoDates(iso, endDate) < 0,
      };
    });
  }, [activeField, displayMonth, endDate, minDate, startDate]);

  function selectDate(iso: string, isDisabled: boolean) {
    if (disabled || isDisabled) return;
    if (activeField === 'start') {
      onChange(iso, clampEndAfterStart(iso, endDate));
      setActiveField('end');
      setDisplayMonth(monthStartIso(iso));
      return;
    }
    if (compareIsoDates(startDate, iso) < 0) {
      onChange(startDate, iso);
    }
  }

  return (
    <div className="trip-agent-control trip-date-range">
      <div className="trip-date-linked-fields" aria-label="Trip date range">
        <button
          type="button"
          className={activeField === 'start' ? 'is-active' : ''}
          disabled={disabled}
          onClick={() => {
            setActiveField('start');
            setDisplayMonth(monthStartIso(startDate));
          }}
        >
          <span>Start</span>
          <strong>{formatDisplayDate(startDate)}</strong>
        </button>
        <span className="trip-date-link-line" aria-hidden="true" />
        <button
          type="button"
          className={activeField === 'end' ? 'is-active' : ''}
          disabled={disabled}
          onClick={() => {
            setActiveField('end');
            setDisplayMonth(monthStartIso(startDate));
          }}
        >
          <span>End</span>
          <strong>{formatDisplayDate(endDate)}</strong>
        </button>
      </div>

      <div className="trip-date-calendar">
        <div className="trip-date-calendar-header">
          <button
            type="button"
            disabled={disabled || compareIsoDates(addMonthsIso(displayMonth, -1), monthStartIso(minDate)) < 0}
            onClick={() => setDisplayMonth((current) => addMonthsIso(current, -1))}
            aria-label="Previous month"
          >
            <ArrowLeft size={15} aria-hidden="true" />
          </button>
          <strong>{formatMonth(displayMonth)}</strong>
          <button
            type="button"
            disabled={disabled}
            onClick={() => setDisplayMonth((current) => addMonthsIso(current, 1))}
            aria-label="Next month"
          >
            <ArrowRight size={15} aria-hidden="true" />
          </button>
        </div>
        <div className="trip-date-weekdays">
          {weekdayLabels.map((label) => <span key={label}>{label}</span>)}
        </div>
        <div className="trip-date-grid">
          {cells.map((cell) => (
            <button
              key={cell.iso}
              type="button"
              disabled={disabled || cell.disabled}
              className={[
                cell.isCurrentMonth ? '' : 'is-muted',
                cell.isStart ? 'is-start' : '',
                cell.isEnd ? 'is-end' : '',
                cell.isInRange ? 'is-range' : '',
              ].filter(Boolean).join(' ')}
              onClick={() => selectDate(cell.iso, cell.disabled)}
            >
              {cell.day}
            </button>
          ))}
        </div>
      </div>

      <div className="trip-agent-control-actions">
        <span className="trip-date-helper">
          End stays linked to the start month and must be after start.
        </span>
        <button className="trip-create-primary" type="button" disabled={disabled} onClick={onSubmit}>
          Use these dates
          <ArrowRight size={16} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}

function ReviewBrief({
  form,
  dayCount,
  busy,
  error,
  draftUrl,
  completedTripUrl,
  onCreate,
}: {
  form: FormState;
  dayCount: number;
  busy: boolean;
  error: string | null;
  draftUrl: string | null;
  completedTripUrl: string | null;
  onCreate: () => void;
}) {
  return (
    <div className="trip-agent-review">
      <BriefSnapshot form={form} dayCount={dayCount} />
      {completedTripUrl && (
        <div className="trip-create-success">
          <Check size={16} aria-hidden="true" />
          <div>
            <strong>Everything is finished.</strong>
            <span>I am opening the new trip now.</span>
            <Link href={completedTripUrl}>Open trip</Link>
          </div>
        </div>
      )}
      {error && (
        <div className="trip-create-error">
          <AlertCircle size={16} aria-hidden="true" />
          <div>
            <strong>{error}</strong>
            {draftUrl && <Link href={draftUrl}>Open draft trip</Link>}
          </div>
        </div>
      )}
      <div className="trip-agent-control-actions">
        {completedTripUrl ? (
          <Link className="trip-create-primary" href={completedTripUrl}>
            Open trip
            <ArrowRight size={16} aria-hidden="true" />
          </Link>
        ) : (
          <button className="trip-create-primary" type="button" disabled={busy || !form.destination.trim()} onClick={onCreate}>
            {busy ? 'Creating trip...' : 'Create trip'}
            <Sparkles size={16} aria-hidden="true" />
          </button>
        )}
      </div>
    </div>
  );
}

function BriefSnapshot({ form, dayCount }: { form: FormState; dayCount: number }) {
  const items = [
    ['Destination', form.destination || 'Not set'],
    ['Dates', `${formatDisplayDate(form.start_date)} to ${formatDisplayDate(form.end_date)}`],
    ['Length', `${dayCount} days`],
    ['Travelers', travelerSummary(form.traveler_profiles)],
    ['Origin', form.origin || 'Not specified'],
    ['Style', `${form.budget || 'Profile budget'} / ${form.pace.replace(/_/g, ' ')}`],
    ['References', referenceAnswerSummary(form.reference_text, form.reference_sources)],
  ];

  return (
    <div className="trip-brief-snapshot">
      <div className="trip-brief-snapshot-title">
        <MapPinned size={15} aria-hidden="true" />
        <strong>Gathered brief</strong>
      </div>
      <dl>
        {items.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function StatusStep({
  active,
  done,
  label,
}: {
  active: boolean;
  done: boolean;
  label: string;
}) {
  return (
    <li className={`trip-create-step ${active ? 'is-active' : ''} ${done ? 'is-done' : ''}`}>
      <span>
        {done ? (
          <Check size={14} aria-hidden="true" />
        ) : (
          <CircleDashed size={14} aria-hidden="true" />
        )}
      </span>
      {label}
    </li>
  );
}

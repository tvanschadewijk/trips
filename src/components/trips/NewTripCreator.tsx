'use client';

import { useMemo, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  AlertCircle,
  ArrowRight,
  CalendarDays,
  Check,
  CircleDashed,
  MapPinned,
  Sparkles,
} from 'lucide-react';
import type { TravelProfilePreferences } from '@/lib/travel-profile';

type Props = {
  initialPreferences: TravelProfilePreferences;
  profileComplete: boolean;
};

type FormState = {
  destination: string;
  start_date: string;
  end_date: string;
  travelers: string;
  origin: string;
  must_do: string;
  known_bookings: string;
  budget: string;
  pace: 'from_profile' | 'relaxed' | 'balanced' | 'full';
  notes: string;
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

const POLL_INTERVAL_MS = 2400;
const POLL_TIMEOUT_MS = 305_000;

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function addDaysIso(value: string, days: number): string {
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

export default function NewTripCreator({ initialPreferences, profileComplete }: Props) {
  const router = useRouter();
  const defaultStart = useMemo(() => addDaysIso(todayIso(), 60), []);
  const defaultEnd = useMemo(() => addDaysIso(defaultStart, 5), [defaultStart]);
  const [form, setForm] = useState<FormState>({
    destination: '',
    start_date: defaultStart,
    end_date: defaultEnd,
    travelers: initialPreferences.travelers,
    origin: initialPreferences.home_base,
    must_do: '',
    known_bookings: '',
    budget: initialPreferences.budget === 'varies' ? '' : initialPreferences.budget.replace(/_/g, ' '),
    pace: 'from_profile',
    notes: '',
  });
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState<'idle' | 'draft' | 'agent' | 'poll' | 'done' | 'error'>('idle');
  const [statusText, setStatusText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [draftUrl, setDraftUrl] = useState<string | null>(null);

  function setField<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;

    let draft: DraftResponse | null = null;
    setBusy(true);
    setError(null);
    setDraftUrl(null);

    try {
      setStep('draft');
      setStatusText('Creating the trip workspace...');
      const draftRes = await fetch('/api/trips/create-draft', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const draftBody = await draftRes.json().catch(() => ({}));
      if (!draftRes.ok) {
        throw new Error(draftBody.error ?? `HTTP ${draftRes.status}`);
      }
      draft = draftBody as DraftResponse;
      setDraftUrl(`/t/${draft.share_id}`);

      setStep('agent');
      setStatusText('Asking the travel agent to build the itinerary...');
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
        setStep('poll');
        setStatusText('Building days, meals, stays, and practical notes...');
        await pollForAssistant(draft.trip_id, threadId, turn.turn_index);
      }

      setStep('done');
      setStatusText('Opening your trip...');
      await updateGeneration(draft.generation_session_id, {
        status: 'completed',
        chat_thread_id: threadId,
        turn_index: turn.turn_index,
      });
      router.replace(`/t/${draft.share_id}`);
    } catch (err) {
      setStep('error');
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

  const working = step !== 'idle' && step !== 'error';

  return (
    <div className="trip-create-shell">
      <section className="trip-create-main">
        {!profileComplete && (
          <div className="trip-create-notice">
            <AlertCircle size={16} aria-hidden="true" />
            <span>Your travel profile is not finished yet.</span>
            <Link href="/onboarding?next=/trips/new">Finish profile</Link>
          </div>
        )}

        <form className="trip-create-form" onSubmit={submit}>
          <div className="trip-create-section-heading">
            <MapPinned size={18} aria-hidden="true" />
            <div>
              <h2>Trip brief</h2>
              <p>The first draft is built from these details.</p>
            </div>
          </div>

          <label className="trip-create-field">
            <span>Destination</span>
            <input
              value={form.destination}
              onChange={(event) => setField('destination', event.target.value)}
              placeholder="Japan, Sicily, Patagonia"
              required
            />
          </label>

          <div className="trip-create-grid">
            <label className="trip-create-field">
              <span><CalendarDays size={14} aria-hidden="true" /> Start</span>
              <input
                type="date"
                value={form.start_date}
                onChange={(event) => setField('start_date', event.target.value)}
                required
              />
            </label>
            <label className="trip-create-field">
              <span><CalendarDays size={14} aria-hidden="true" /> End</span>
              <input
                type="date"
                value={form.end_date}
                onChange={(event) => setField('end_date', event.target.value)}
                required
              />
            </label>
          </div>

          <div className="trip-create-grid">
            <label className="trip-create-field">
              <span>Travelers</span>
              <input
                value={form.travelers}
                onChange={(event) => setField('travelers', event.target.value)}
                placeholder="Alex, Thijs"
              />
            </label>
            <label className="trip-create-field">
              <span>Origin</span>
              <input
                value={form.origin}
                onChange={(event) => setField('origin', event.target.value)}
                placeholder="Amsterdam"
              />
            </label>
          </div>

          <div className="trip-create-grid">
            <label className="trip-create-field">
              <span>Budget</span>
              <input
                value={form.budget}
                onChange={(event) => setField('budget', event.target.value)}
                placeholder="Mid-range, with one splurge hotel"
              />
            </label>
            <label className="trip-create-field">
              <span>Pace</span>
              <select
                value={form.pace}
                onChange={(event) => setField('pace', event.target.value as FormState['pace'])}
              >
                <option value="from_profile">Use profile</option>
                <option value="relaxed">Relaxed</option>
                <option value="balanced">Balanced</option>
                <option value="full">Full</option>
              </select>
            </label>
          </div>

          <label className="trip-create-field">
            <span>Must-do or must-see</span>
            <textarea
              value={form.must_do}
              onChange={(event) => setField('must_do', event.target.value)}
              rows={3}
              placeholder="A ryokan night, Naoshima, no more than one temple-heavy day"
            />
          </label>

          <label className="trip-create-field">
            <span>Known bookings</span>
            <textarea
              value={form.known_bookings}
              onChange={(event) => setField('known_bookings', event.target.value)}
              rows={3}
              placeholder="Flights, hotels, dinner reservations, tickets"
            />
          </label>

          <label className="trip-create-field">
            <span>Notes</span>
            <textarea
              value={form.notes}
              onChange={(event) => setField('notes', event.target.value)}
              rows={4}
              placeholder="Season, weather tolerance, routing ideas, things to avoid"
            />
          </label>

          {error && (
            <div className="trip-create-error">
              <AlertCircle size={16} aria-hidden="true" />
              <div>
                <strong>{error}</strong>
                {draftUrl && <Link href={draftUrl}>Open draft trip</Link>}
              </div>
            </div>
          )}

          <div className="trip-create-actions">
            <button className="trip-create-primary" type="submit" disabled={busy}>
              {busy ? 'Creating...' : 'Create trip'}
              <ArrowRight size={16} aria-hidden="true" />
            </button>
          </div>
        </form>
      </section>

      <aside className="trip-create-status">
        <div className="trip-create-section-heading">
          <Sparkles size={18} aria-hidden="true" />
          <div>
            <h2>Generation</h2>
            <p>Saved directly into OurTrips.</p>
          </div>
        </div>
        <ol className="trip-create-steps">
          <StatusStep active={working && step === 'draft'} done={['agent', 'poll', 'done'].includes(step)} label="Create workspace" />
          <StatusStep active={step === 'agent'} done={['poll', 'done'].includes(step)} label="Start travel agent" />
          <StatusStep active={step === 'poll'} done={step === 'done'} label="Build itinerary" />
          <StatusStep active={step === 'done'} done={step === 'done'} label="Open trip" />
        </ol>
        <p className="trip-create-status-text">
          {statusText || 'Your first version will open as soon as the itinerary is saved.'}
        </p>
      </aside>
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

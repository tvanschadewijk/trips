'use client';

/**
 * Admin-only chat panel for editing a trip in place.
 *
 * Posts to /api/trips/[id]/chat. On a successful response with tool calls,
 * triggers the parent's `onTripMutated` callback so the trip view re-fetches
 * and reflects the edits. No streaming in v1 — a loading indicator is
 * sufficient.
 *
 * Styling follows the editorial design system in DESIGN.md: warm paper
 * surfaces, Fraunces serif for display, Inter for UI, terracotta accent.
 */
import { useState, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import type { ToolCallSummary, PriorTurn } from '@/lib/trip-chat/prompt';

export interface ChatMessage {
  id: string;
  turn_index: number;
  role: 'user' | 'assistant';
  content: string;
  tool_calls_json: ToolCallSummary[] | null;
  // Transient pending flag for optimistic UI
  pending?: boolean;
}

interface Props {
  tripId: string;
  initialMessages: ChatMessage[];
}

export default function TripChatPanel({ tripId, initialMessages }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  // Auto-scroll scoped to the messages container only — never window.scrollIntoView,
  // which would shift the whole trip viewer (see MEMORY: feedback_slide_drift).
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  }, [messages.length, loading]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  async function send() {
    const trimmed = input.trim();
    if (!trimmed || loading) return;
    setError(null);

    const nextTurnIndex =
      messages.length === 0 ? 0 : Math.max(...messages.map((m) => m.turn_index)) + 1;

    const optimisticUser: ChatMessage = {
      id: `optimistic-${Date.now()}`,
      turn_index: nextTurnIndex,
      role: 'user',
      content: trimmed,
      tool_calls_json: null,
    };
    const pendingAssistant: ChatMessage = {
      id: `optimistic-a-${Date.now()}`,
      turn_index: nextTurnIndex,
      role: 'assistant',
      content: '…',
      tool_calls_json: null,
      pending: true,
    };
    setMessages((prev) => [...prev, optimisticUser, pendingAssistant]);
    setInput('');
    setLoading(true);

    try {
      const res = await fetch(`/api/trips/${tripId}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: trimmed }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      const json: {
        assistant_message: string;
        session_id: string | null;
        tool_calls_summary: ToolCallSummary[];
        turn_index: number;
      } = await res.json();

      setMessages((prev) => {
        const withoutPending = prev.filter(
          (m) => !(m.pending && m.turn_index === nextTurnIndex)
        );
        return [
          ...withoutPending,
          {
            id: `r-${Date.now()}`,
            turn_index: json.turn_index,
            role: 'assistant',
            content: json.assistant_message,
            tool_calls_json:
              json.tool_calls_summary.length > 0 ? json.tool_calls_summary : null,
          },
        ];
      });

      if (json.tool_calls_summary.length > 0) {
        // Trigger a server re-render so the trip view picks up the edits.
        // TripPreview syncs its local trip state from initialTrips via useEffect.
        router.refresh();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setMessages((prev) => prev.filter((m) => !m.pending));
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

  return (
    <>
      {/* Collapsed tab — fixed bottom-right */}
      {!open && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          style={collapsedTabStyle}
          aria-label="Open editor chat"
        >
          <span style={{ fontFamily: '"Fraunces", Georgia, serif', fontStyle: 'italic', letterSpacing: '-0.01em' }}>
            Edit with chat
          </span>
          <span style={{ color: '#C14F2A', marginLeft: 8 }}>•</span>
        </button>
      )}

      {/* Expanded panel */}
      {open && (
        <div style={panelStyle} role="dialog" aria-label="Trip editor chat">
          <header style={headerStyle}>
            <div style={{ fontFamily: '"Fraunces", Georgia, serif', fontSize: 17, fontWeight: 520, color: '#1A1410' }}>
              Editor chat
            </div>
            <div style={{ fontSize: 11, color: '#6B6157', textTransform: 'uppercase', letterSpacing: '0.14em', marginTop: 2 }}>
              Admin only
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              style={closeButtonStyle}
              aria-label="Close chat"
            >
              ×
            </button>
          </header>

          <div ref={scrollerRef} style={messagesStyle}>
            {messages.length === 0 && (
              <div style={emptyStyle}>
                <p style={{ margin: 0, color: '#6B6157' }}>
                  Describe an edit in plain language. &quot;Make day 2 more relaxed&quot;, &quot;swap Friday dinner&quot;, &quot;shorten the summary&quot;.
                </p>
              </div>
            )}
            {messages.map((m) => (
              <MessageBubble key={m.id} m={m} />
            ))}
            {error && (
              <div style={errorStyle} role="alert">
                {error}
              </div>
            )}
          </div>

          <footer style={footerStyle}>
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder="Describe an edit…"
              rows={2}
              style={textareaStyle}
              disabled={loading}
            />
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 8 }}>
              <span style={{ fontSize: 11, color: '#9B9087', textTransform: 'uppercase', letterSpacing: '0.14em' }}>
                ⌘↵ to send
              </span>
              <button type="button" onClick={send} disabled={loading || !input.trim()} style={sendButtonStyle(loading)}>
                {loading ? 'Editing…' : 'Send'}
              </button>
            </div>
          </footer>
        </div>
      )}
    </>
  );
}

function MessageBubble({ m }: { m: ChatMessage }) {
  const isUser = m.role === 'user';
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: isUser ? 'flex-end' : 'flex-start',
        gap: 4,
      }}
    >
      <div
        style={{
          maxWidth: '88%',
          padding: '10px 14px',
          borderRadius: 4,
          background: isUser ? '#1A1410' : '#FFFFFF',
          color: isUser ? '#FBF7F1' : '#1A1410',
          border: isUser ? 'none' : '1px solid #E8E1D6',
          fontSize: 14,
          lineHeight: 1.5,
          whiteSpace: 'pre-wrap',
          fontStyle: m.pending ? 'italic' : 'normal',
          opacity: m.pending ? 0.6 : 1,
        }}
      >
        {m.content}
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
    </div>
  );
}

// ---------- styles (inline — the project already uses inline styling heavily) ----------

const collapsedTabStyle: React.CSSProperties = {
  position: 'fixed',
  right: 24,
  bottom: 24,
  padding: '12px 18px',
  background: '#FFFFFF',
  border: '1px solid #E8E1D6',
  borderRadius: 999,
  color: '#1A1410',
  fontFamily: 'Inter, system-ui, sans-serif',
  fontSize: 14,
  fontWeight: 520,
  cursor: 'pointer',
  boxShadow: 'rgba(26, 20, 16, 0.08) 0 12px 32px -8px',
  zIndex: 900,
};

const panelStyle: React.CSSProperties = {
  position: 'fixed',
  right: 24,
  bottom: 24,
  width: 420,
  maxWidth: 'calc(100vw - 48px)',
  height: 560,
  maxHeight: 'calc(100vh - 48px)',
  background: '#FBF7F1',
  border: '1px solid #E8E1D6',
  borderRadius: 4,
  boxShadow: 'rgba(26, 20, 16, 0.08) 0 12px 32px -8px',
  zIndex: 900,
  display: 'flex',
  flexDirection: 'column',
  overflow: 'hidden',
  fontFamily: 'Inter, system-ui, sans-serif',
};

const headerStyle: React.CSSProperties = {
  padding: '16px 20px 14px',
  borderBottom: '1px solid #E8E1D6',
  position: 'relative',
  background: '#FBF7F1',
};

const closeButtonStyle: React.CSSProperties = {
  position: 'absolute',
  top: 10,
  right: 12,
  width: 32,
  height: 32,
  background: 'transparent',
  border: 'none',
  fontSize: 22,
  color: '#6B6157',
  cursor: 'pointer',
  lineHeight: 1,
  borderRadius: 4,
};

const messagesStyle: React.CSSProperties = {
  flex: 1,
  overflowY: 'auto',
  padding: 20,
  display: 'flex',
  flexDirection: 'column',
  gap: 14,
  background: '#FBF7F1',
};

const emptyStyle: React.CSSProperties = {
  padding: '16px 0',
  fontSize: 14,
  lineHeight: 1.55,
};

const errorStyle: React.CSSProperties = {
  padding: '10px 12px',
  border: '1px solid #9B4F2E',
  background: '#F5E4DA',
  color: '#9B4F2E',
  fontSize: 13,
  borderRadius: 4,
};

const footerStyle: React.CSSProperties = {
  padding: '14px 20px 16px',
  borderTop: '1px solid #E8E1D6',
  background: '#FBF7F1',
};

const textareaStyle: React.CSSProperties = {
  width: '100%',
  padding: '10px 12px',
  fontSize: 14,
  lineHeight: 1.5,
  background: '#FFFFFF',
  border: '1px solid #E8E1D6',
  borderRadius: 6,
  outline: 'none',
  resize: 'none',
  fontFamily: 'Inter, system-ui, sans-serif',
  color: '#1A1410',
};

function sendButtonStyle(loading: boolean): React.CSSProperties {
  return {
    padding: '10px 20px',
    background: loading ? '#6B6157' : '#C14F2A',
    color: '#FBF7F1',
    border: 'none',
    borderRadius: 999,
    fontSize: 13,
    fontWeight: 580,
    cursor: loading ? 'wait' : 'pointer',
    fontFamily: 'Inter, system-ui, sans-serif',
    opacity: loading ? 0.7 : 1,
  };
}

// Re-exported for convenience so page.tsx can type its server-fetched history.
export type { PriorTurn };

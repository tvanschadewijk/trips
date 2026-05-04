'use client';

/**
 * Admin-only chat panel for editing a trip in place.
 *
 * Three states: closed (entry pill), open (iOS share-sheet style),
 * minimized (status pill while a turn is in flight). Animations via
 * motion/react.
 *
 * Posts to /api/trips/[id]/chat. On a successful response with tool
 * calls, triggers a router.refresh() so the trip view picks up the
 * edits.
 *
 * Styling follows the editorial design system in DESIGN.md: warm paper
 * surfaces, Fraunces serif for display, Inter for UI, terracotta accent.
 */
import { useState, useRef, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { AnimatePresence, motion, useDragControls } from 'motion/react';
import type { ToolCallSummary } from '@/lib/trip-chat/prompt';
import {
  DEFAULT_CHAT_STATUS_PHASES,
  getChatStatusPhases,
} from '@/lib/trip-chat/progress';
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

export default function TripChatPanel({ tripId, initialMessages }: Props) {
  const router = useRouter();
  const online = useOnlineStatus();
  const [state, setState] = useState<PanelState>('closed');
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages);
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
  const dragControls = useDragControls();

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

  // Open the panel — clears unread badge.
  const openPanel = useCallback(() => {
    setState('open');
    setUnread(false);
  }, []);

  const minimize = useCallback(() => {
    setState('minimized');
  }, []);

  const close = useCallback(() => {
    setState('closed');
    setUnread(false);
  }, []);

  async function send() {
    const trimmed = input.trim();
    if (!trimmed || loading) return;
    setError(null);
    setStatusPhases(getChatStatusPhases(trimmed));

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
        body: JSON.stringify({ message: trimmed, view_context: viewContext }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        const headline = body.error ?? `HTTP ${res.status}`;
        throw new Error(body.detail ? `${headline} — ${body.detail}` : headline);
      }
      const json: {
        assistant_message: string;
        session_id: string | null;
        tool_calls_summary: ToolCallSummary[];
        turn_index: number;
      } = await res.json();

      setMessages((prev) => [
        ...prev,
        {
          id: `r-${Date.now()}`,
          turn_index: json.turn_index,
          role: 'assistant',
          content: json.assistant_message,
          tool_calls_json:
            json.tool_calls_summary.length > 0 ? json.tool_calls_summary : null,
        },
      ]);

      // If the user collapsed mid-turn, mark unread.
      setState((s) => {
        if (s === 'minimized') setUnread(true);
        return s;
      });

      if (json.tool_calls_summary.length > 0) {
        router.refresh();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
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
            <svg className="trip-ask-entry-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            </svg>
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
                <div style={{ fontFamily: '"Fraunces", Georgia, serif', fontSize: 17, fontWeight: 460, color: '#1A1410', letterSpacing: '-0.012em' }}>
                  Ask your travel expert
                </div>
              </header>

              <div ref={scrollerRef} style={messagesStyle}>
                {messages.length === 0 && (
                  <div style={emptyStyle}>
                    <p style={{ margin: 0, color: '#6B6157' }}>
                      Ask anything about the trip — &quot;make day 2 more relaxed&quot;, &quot;swap Friday dinner&quot;, &quot;what should I pack?&quot;.
                    </p>
                  </div>
                )}
                {messages.map((m) => (
                  <MessageBubble key={m.id} m={m} />
                ))}
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
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><line x1="12" y1="19" x2="12" y2="5" /><polyline points="5 12 12 5 19 12" /></svg>
                    )}
                  </button>
                </div>
              </footer>
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
          maxWidth: '88%',
          padding: '10px 14px',
          borderRadius: 14,
          background: isUser ? '#1A1410' : '#FFFFFF',
          color: isUser ? '#FBF7F1' : '#1A1410',
          border: isUser ? 'none' : '1px solid #E8E1D6',
          fontSize: 14,
          lineHeight: 1.5,
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

// Entry CTA styling lives in a real stylesheet now (preview.css)
// because it switches between two layouts (icon-only on day slides,
// full pill on the cover) keyed off body.trip-on-cover.

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
  width: 'min(520px, 100vw)',
  maxHeight: 'min(43vh, 360px)',
  background: '#FBF7F1',
  border: '1px solid #E8E1D6',
  borderTopLeftRadius: 22,
  borderTopRightRadius: 22,
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
  justifyContent: 'center',
  padding: '4px 16px 10px',
  borderBottom: '1px solid #E8E1D6',
  background: '#FBF7F1',
};

const messagesStyle: React.CSSProperties = {
  flex: 1,
  overflowY: 'auto',
  padding: '14px 16px',
  display: 'flex',
  flexDirection: 'column',
  gap: 12,
  background: '#FBF7F1',
};

const emptyStyle: React.CSSProperties = {
  padding: '16px 0',
  fontSize: 14,
  lineHeight: 1.55,
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
  fontFamily: '"Fraunces", Georgia, serif',
  fontStyle: 'italic',
  fontSize: 14,
  fontWeight: 380,
  color: '#A03E1F',
  letterSpacing: '-0.005em',
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
  padding: '10px 12px 12px',
  borderTop: '1px solid #E8E1D6',
  background: '#FBF7F1',
};

const inputWrapStyle: React.CSSProperties = {
  position: 'relative',
  display: 'flex',
  alignItems: 'flex-end',
  background: '#FFFFFF',
  border: '1px solid #E8E1D6',
  borderRadius: 22,
  padding: '6px 6px 6px 14px',
  gap: 8,
};

const textareaStyle: React.CSSProperties = {
  flex: 1,
  minHeight: 28,
  maxHeight: 120,
  padding: '6px 0',
  fontSize: 14,
  lineHeight: 1.45,
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
    width: 32,
    height: 32,
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

export type { PriorTurn };

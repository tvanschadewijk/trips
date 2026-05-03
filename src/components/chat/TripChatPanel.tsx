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
import type { ToolCallSummary, PriorTurn } from '@/lib/trip-chat/prompt';
import { useOnlineStatus } from '@/lib/online-status';

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

const STATUS_PHASES = [
  'Reading the trip…',
  'Thinking it through…',
  'Drafting an edit…',
  'Almost there…',
];

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
    for (let i = 0; i < STATUS_PHASES.length - 1; i++) {
      cumulative += delays[i] ?? 8000;
      timers.push(setTimeout(() => setStatusIdx(i + 1), cumulative));
    }
    return () => {
      timers.forEach(clearTimeout);
    };
  }, [loading]);

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

    try {
      const res = await fetch(`/api/trips/${tripId}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: trimmed }),
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
            style={entryPillStyle}
            aria-label="Open editor chat"
            initial={{ opacity: 0, y: 12, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.95 }}
            transition={overlaySpring}
            whileTap={{ scale: 0.96 }}
          >
            <span style={{ fontFamily: '"Fraunces", Georgia, serif', fontStyle: 'italic', letterSpacing: '-0.01em' }}>
              Edit with chat
            </span>
            <span style={{ color: '#C14F2A', marginLeft: 8 }}>•</span>
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
            aria-label="Reopen editor chat"
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
                  {STATUS_PHASES[statusIdx]}
                </span>
              </>
            ) : (
              <>
                <span style={{ fontFamily: '"Fraunces", Georgia, serif', fontStyle: 'italic' }}>
                  Editor chat
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
              aria-label="Trip editor chat"
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
                <div>
                  <div style={{ fontFamily: '"Fraunces", Georgia, serif', fontSize: 19, fontWeight: 460, color: '#1A1410', letterSpacing: '-0.012em' }}>
                    Editor chat
                  </div>
                  <div style={{ fontSize: 11, color: '#6B6157', textTransform: 'uppercase', letterSpacing: '0.18em', marginTop: 4 }}>
                    Admin only
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button
                    type="button"
                    onClick={minimize}
                    style={iconButtonStyle}
                    aria-label="Minimize chat"
                    title="Minimize"
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><line x1="5" y1="12" x2="19" y2="12" /></svg>
                  </button>
                  <button
                    type="button"
                    onClick={close}
                    style={iconButtonStyle}
                    aria-label="Close chat"
                    title="Close"
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M18 6 6 18" /><path d="M6 6l12 12" /></svg>
                  </button>
                </div>
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
                        {STATUS_PHASES[statusIdx]}
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
        style={{
          maxWidth: '88%',
          padding: '10px 14px',
          borderRadius: 14,
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
    </motion.div>
  );
}

// ---------- styles ----------

const entryPillStyle: React.CSSProperties = {
  position: 'fixed',
  left: 24,
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
  display: 'inline-flex',
  alignItems: 'center',
};

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
  alignItems: 'flex-start',
  justifyContent: 'space-between',
  gap: 12,
  padding: '12px 20px 14px',
  borderBottom: '1px solid #E8E1D6',
  background: '#FBF7F1',
};

const iconButtonStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 32,
  height: 32,
  background: 'transparent',
  border: 'none',
  color: '#6B6157',
  cursor: 'pointer',
  borderRadius: 999,
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
  borderRadius: 10,
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

export type { PriorTurn };

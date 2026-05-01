'use client';

import { useEffect, useState } from 'react';

/**
 * Quietly announces when the device transitions offline -> online.
 * Mounted globally from the root layout so any page can benefit.
 */
export default function ReconnectToast() {
  const [visible, setVisible] = useState(false);
  const [variant, setVariant] = useState<'online' | 'offline'>('online');

  useEffect(() => {
    if (typeof navigator === 'undefined') return;
    let wasOnline = navigator.onLine;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const flash = (next: 'online' | 'offline') => {
      setVariant(next);
      setVisible(true);
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => setVisible(false), next === 'online' ? 2400 : 4000);
    };

    const handleOnline = () => {
      if (!wasOnline) flash('online');
      wasOnline = true;
    };
    const handleOffline = () => {
      if (wasOnline) flash('offline');
      wasOnline = false;
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      if (timer) clearTimeout(timer);
    };
  }, []);

  if (!visible) return null;

  const isOnline = variant === 'online';

  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        position: 'fixed',
        top: 'calc(env(safe-area-inset-top) + 12px)',
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 1000,
        display: 'inline-flex',
        alignItems: 'center',
        gap: 8,
        padding: '9px 16px',
        background: isOnline ? '#1A1410' : '#C14F2A',
        color: '#FBF7F1',
        fontFamily: '"Inter", system-ui, sans-serif',
        fontSize: 13,
        fontWeight: 540,
        letterSpacing: '-0.005em',
        borderRadius: 999,
        boxShadow: 'rgba(26, 20, 16, 0.32) 0 12px 32px -8px',
        animation: 'reconnect-toast 240ms cubic-bezier(0.32, 0.72, 0, 1) both',
        pointerEvents: 'none',
        whiteSpace: 'nowrap',
      }}
    >
      <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 999, background: '#FBF7F1', opacity: 0.92 }} />
      {isOnline ? 'Back online' : 'You’re offline — saved trips still work'}
    </div>
  );
}

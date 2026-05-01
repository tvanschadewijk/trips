'use client';

import { useEffect, useState } from 'react';

/**
 * Tracks navigator.onLine. Returns true on the server (avoid offline UI
 * during SSR) so hydration mismatches don't render "Offline" pre-mount.
 */
export function useOnlineStatus(): boolean {
  const [online, setOnline] = useState<boolean>(true);

  useEffect(() => {
    if (typeof navigator === 'undefined') return;
    setOnline(navigator.onLine);
    const handleOnline = () => setOnline(true);
    const handleOffline = () => setOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  return online;
}

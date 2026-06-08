'use client';

import { useEffect, useState } from 'react';

interface CacheStat {
  name: string;
  count: number;
}

/**
 * Hidden behind ?debug=offline. Renders a small fixed-position panel
 * showing service-worker + cache state to help debug offline issues.
 * Never rendered for normal users — the search-param gate is checked
 * client-side.
 */
export default function OfflineDebugOverlay() {
  const [enabled] = useState(() => {
    if (typeof window === 'undefined') return false;
    const params = new URLSearchParams(window.location.search);
    return params.get('debug') === 'offline';
  });
  const [online, setOnline] = useState(true);
  const [swState, setSwState] = useState<string>('?');
  const [caches, setCaches] = useState<CacheStat[]>([]);
  const [manifestCount, setManifestCount] = useState(0);

  useEffect(() => {
    if (!enabled || typeof window === 'undefined') return;

    const refresh = async () => {
      setOnline(navigator.onLine);
      try {
        const reg = await navigator.serviceWorker?.getRegistration();
        const w = reg?.active ?? reg?.waiting ?? reg?.installing;
        setSwState(w?.state ?? 'none');
      } catch {
        setSwState('error');
      }
      try {
        const keys = (await window.caches?.keys()) ?? [];
        const stats = await Promise.all(
          keys
            .filter((k) => k.startsWith('ourtrips-'))
            .map(async (name) => {
              const cache = await window.caches.open(name);
              const all = await cache.keys();
              return { name, count: all.length };
            })
        );
        setCaches(stats);
      } catch {
        setCaches([]);
      }
      try {
        const raw = localStorage.getItem('ourtrips:offline-manifest:v1');
        const parsed = raw ? JSON.parse(raw) : {};
        setManifestCount(Object.keys(parsed || {}).length);
      } catch {
        setManifestCount(0);
      }
    };

    refresh();
    const interval = setInterval(refresh, 1500);
    const handleOnline = () => setOnline(true);
    const handleOffline = () => setOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      clearInterval(interval);
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [enabled]);

  if (!enabled) return null;

  return (
    <div
      style={{
        position: 'fixed',
        bottom: 12,
        right: 12,
        zIndex: 2000,
        padding: '10px 12px',
        background: 'rgba(26, 20, 16, 0.92)',
        color: '#FBF7F1',
        border: '1px solid rgba(232, 225, 214, 0.18)',
        borderRadius: 8,
        fontFamily: 'JetBrains Mono, ui-monospace, monospace',
        fontSize: 11,
        lineHeight: 1.5,
        minWidth: 220,
        boxShadow: 'rgba(0, 0, 0, 0.4) 0 12px 32px -8px',
      }}
    >
      <div style={{ fontWeight: 600, color: '#C14F2A', letterSpacing: '0.12em', textTransform: 'uppercase', fontSize: 10, marginBottom: 6 }}>
        Offline debug
      </div>
      <div>online: {online ? 'yes' : 'NO'}</div>
      <div>sw: {swState}</div>
      <div>manifest: {manifestCount} trip{manifestCount === 1 ? '' : 's'}</div>
      <div style={{ marginTop: 6, paddingTop: 6, borderTop: '1px solid rgba(232,225,214,0.14)' }}>
        {caches.length === 0 ? (
          <div style={{ opacity: 0.6 }}>no ourtrips caches</div>
        ) : (
          caches.map((c) => (
            <div key={c.name} title={c.name} style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.name.replace('ourtrips-', '')}</span>
              <span>{c.count}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

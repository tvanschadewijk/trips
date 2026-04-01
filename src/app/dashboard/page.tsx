'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import type { TripData } from '@/lib/types';
import '@/styles/dashboard.css';

interface DashTrip {
  id: string;
  name: string;
  share_id: string;
  data: TripData;
  is_public: boolean;
  updated_at: string;
}

export default function DashboardPage() {
  const router = useRouter();
  const [trips, setTrips] = useState<DashTrip[]>(() => {
    if (typeof window !== 'undefined') {
      try { const c = sessionStorage.getItem('dash-trips'); if (c) return JSON.parse(c); } catch {}
    }
    return [];
  });
  const [email, setEmail] = useState<string | null>(() => {
    if (typeof window !== 'undefined') return sessionStorage.getItem('dash-email') || null;
    return null;
  });
  const [copied, setCopied] = useState<string | null>(null);
  const [loading, setLoading] = useState(() => {
    if (typeof window !== 'undefined' && sessionStorage.getItem('dash-trips')) return false;
    return true;
  });
  const [vtTrip, setVtTrip] = useState<string | null>(() => {
    if (typeof window !== 'undefined') return sessionStorage.getItem('vt-trip');
    return null;
  });

  const loadTrips = useCallback(async () => {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
        setEmail('demo@example.com');
        setLoading(false);
        return;
      }
      router.push('/login');
      return;
    }

    setEmail(user.email || null);
    sessionStorage.setItem('dash-email', user.email || '');

    const { data, error } = await supabase
      .from('trips')
      .select('id, name, share_id, data, is_public, updated_at')
      .order('updated_at', { ascending: false });

    if (!error && data) {
      // Sort by trip start date ascending (soonest first)
      const sorted = (data as DashTrip[]).sort((a, b) => {
        const dateA = a.data?.trip?.dates?.start || '';
        const dateB = b.data?.trip?.dates?.start || '';
        return dateA.localeCompare(dateB);
      });
      setTrips(sorted);
      sessionStorage.setItem('dash-trips', JSON.stringify(sorted));
    }
    setLoading(false);
  }, [router]);

  useEffect(() => { loadTrips(); }, [loadTrips]);

  // Clear view-transition marker after the transition captures the new state
  useEffect(() => {
    if (vtTrip) {
      const t = setTimeout(() => { sessionStorage.removeItem('vt-trip'); setVtTrip(null); }, 1000);
      return () => clearTimeout(t);
    }
  }, [vtTrip]);

  function copyLink(shareId: string) {
    const url = `${window.location.origin}/t/${shareId}`;
    navigator.clipboard.writeText(url).then(() => {
      setCopied(shareId);
      setTimeout(() => setCopied(null), 2000);
    });
  }

  async function handleSignOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push('/');
  }

  function formatDate(dateStr: string) {
    return new Date(dateStr + 'T12:00:00').toLocaleDateString('en-GB', {
      day: 'numeric', month: 'short', year: 'numeric',
    });
  }

  function timeAgo(dateStr: string) {
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    return `${days}d ago`;
  }

  if (loading) {
    return (
      <div className="dash" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100dvh' }}>
        <span style={{ color: 'rgba(255,255,255,0.4)', fontSize: 14 }}>Loading...</span>
      </div>
    );
  }

  return (
    <div className="dash">
      <nav className="dash-nav">
        <div className="dash-nav-inner">
          <Link href="/" className="dash-logo">trips</Link>
          <div className="dash-nav-right">
            <span className="dash-user-email">{email}</span>
            <button className="dash-btn-signout" onClick={handleSignOut}>Sign out</button>
          </div>
        </div>
      </nav>

      <main className="dash-main">
        <div className="dash-header">
          <div>
            <h1 className="dash-title">Your trips</h1>
            <p className="dash-subtitle">{trips.length} trip{trips.length !== 1 ? 's' : ''}</p>
          </div>
        </div>

        {trips.length === 0 ? (
          <div className="dash-empty">
            <div className="dash-empty-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M9 6.75V15m6-6v8.25m.503 3.498 4.875-2.437c.381-.19.622-.58.622-1.006V4.82c0-.836-.88-1.38-1.628-1.006l-3.869 1.934c-.317.159-.69.159-1.006 0L9.503 3.252a1.125 1.125 0 0 0-1.006 0L3.622 5.689C3.24 5.88 3 6.27 3 6.695V19.18c0 .836.88 1.38 1.628 1.006l3.869-1.934c.317-.159.69-.159 1.006 0l4.994 2.497c.317.158.69.158 1.006 0Z" /></svg>
            </div>
            <h3>No trips yet</h3>
            <p>Plan a trip with Claude using the travel itinerary skill, then say &ldquo;Save this to trips&rdquo; to see it here.</p>
          </div>
        ) : (
          <div className="dash-grid">
            {trips.map(trip => {
              const t = trip.data.trip;
              const startD = new Date(t.dates.start + 'T12:00:00');
              const endD = new Date(t.dates.end + 'T12:00:00');
              const nights = Math.round((endD.getTime() - startD.getTime()) / 86400000);

              return (
                <div key={trip.id} className="dash-card">
                  <Link
                    href={`/t/${trip.share_id}`}
                    className="dash-card-link"
                    onClick={(e) => {
                      const vt = (document as unknown as { startViewTransition?: (cb: () => Promise<void>) => void }).startViewTransition;
                      if (!vt) return; // let normal Link navigation happen
                      e.preventDefault();
                      const img = (e.currentTarget as HTMLElement).querySelector('img');
                      if (img) img.style.viewTransitionName = 'trip-hero';
                      sessionStorage.setItem('vt-trip', trip.share_id);
                      vt.call(document, async () => {
                        router.push(`/t/${trip.share_id}`);
                        await new Promise<void>((resolve) => {
                          (window as unknown as Record<string, unknown>).__tripTransitionResolve = resolve;
                          setTimeout(resolve, 800);
                        });
                      });
                    }}
                  >
                    <div className="dash-card-hero">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={t.hero_image} alt={t.name} style={vtTrip === trip.share_id ? { viewTransitionName: 'trip-hero' } as React.CSSProperties : undefined} />
                      <div className="dash-card-hero-gradient" />
                      <div className="dash-card-hero-text">
                        <div className="dash-card-name">{t.name}</div>
                        <div className="dash-card-subtitle">{t.subtitle}</div>
                      </div>
                    </div>
                  </Link>
                  <div className="dash-card-body">
                    <div className="dash-card-meta">
                      <span>{formatDate(t.dates.start)} — {formatDate(t.dates.end)}</span>
                      <span>{nights} nights</span>
                    </div>
                    <div className="dash-card-footer">
                      <span className="dash-card-updated">Updated {timeAgo(trip.updated_at)}</span>
                      <button
                        className={`dash-card-btn ${copied === trip.share_id ? 'copied' : ''}`}
                        onClick={() => copyLink(trip.share_id)}
                        title="Copy share link"
                      >
                        {copied === trip.share_id ? (
                          <>
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="20 6 9 17 4 12" /></svg>
                            Copied
                          </>
                        ) : (
                          <>
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" /><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" /></svg>
                            Share
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}

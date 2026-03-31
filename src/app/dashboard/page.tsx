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

// Fallback mock data for when Supabase isn't connected
const mockTrips: DashTrip[] = [
  {
    id: '1', name: 'Scotland', share_id: 'kR4mNx2pQw', is_public: true,
    updated_at: '2026-03-30T20:00:00Z',
    data: {
      trip: { name: 'Scotland', subtitle: 'West Highland Way & Oban Coast', dates: { start: '2026-04-24', end: '2026-05-03' }, travelers: ['Thijs', 'Alexli'], summary: '', hero_image: 'https://images.unsplash.com/photo-1732045133230-1a670eef8620?w=600&h=400&fit=crop&q=80' },
      days: [],
    },
  },
  {
    id: '2', name: 'Rajasthan', share_id: 'xM3pQw7nRt', is_public: true,
    updated_at: '2026-03-28T15:00:00Z',
    data: {
      trip: { name: 'Rajasthan', subtitle: 'Forts, Deserts & Pink Cities', dates: { start: '2026-12-20', end: '2026-12-31' }, travelers: ['Thijs', 'Alexli'], summary: '', hero_image: 'https://images.unsplash.com/photo-1524492412937-b28074a5d7da?w=600&h=400&fit=crop&q=80' },
      days: [],
    },
  },
];

export default function DashboardPage() {
  const router = useRouter();
  const [trips, setTrips] = useState<DashTrip[]>([]);
  const [email, setEmail] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [newKey, setNewKey] = useState<string | null>(null);
  const [generatingKey, setGeneratingKey] = useState(false);
  const [loading, setLoading] = useState(true);

  const loadTrips = useCallback(async () => {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      // Supabase not configured or not logged in — use mock data
      if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
        setEmail('demo@example.com');
        setTrips(mockTrips);
        setLoading(false);
        return;
      }
      router.push('/login');
      return;
    }

    setEmail(user.email || null);

    const { data, error } = await supabase
      .from('trips')
      .select('id, name, share_id, data, is_public, updated_at')
      .order('updated_at', { ascending: false });

    if (!error && data) {
      setTrips(data as DashTrip[]);
    }
    setLoading(false);
  }, [router]);

  useEffect(() => { loadTrips(); }, [loadTrips]);

  function copyLink(shareId: string) {
    const url = `${window.location.origin}/t/${shareId}`;
    navigator.clipboard.writeText(url).then(() => {
      setCopied(shareId);
      setTimeout(() => setCopied(null), 2000);
    });
  }

  async function handleGenerateKey() {
    setGeneratingKey(true);
    try {
      const res = await fetch('/api/keys', { method: 'POST' });
      const data = await res.json();
      if (data.key) setNewKey(data.key);
    } catch { /* ignore */ }
    setGeneratingKey(false);
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
          <button className="dash-btn-new" onClick={handleGenerateKey} disabled={generatingKey}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
            {generatingKey ? 'Generating...' : 'New API key'}
          </button>
        </div>

        {/* New key banner */}
        {newKey && (
          <div className="dash-key-banner">
            <div className="dash-key-label">Your new API key (save it now — shown only once):</div>
            <code className="dash-key-value">{newKey}</code>
            <button
              className="dash-key-copy"
              onClick={() => { navigator.clipboard.writeText(newKey); }}
            >
              Copy
            </button>
            <button className="dash-key-dismiss" onClick={() => setNewKey(null)}>Dismiss</button>
          </div>
        )}

        {trips.length === 0 ? (
          <div className="dash-empty">
            <h3>No trips yet</h3>
            <p>Generate an API key above, then push trip data from your Claude skill to create your first trip.</p>
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
                  <div className="dash-card-hero">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={t.hero_image} alt={t.name} />
                    <div className="dash-card-hero-gradient" />
                    <div className="dash-card-hero-text">
                      <div className="dash-card-name">{t.name}</div>
                      <div className="dash-card-subtitle">{t.subtitle}</div>
                    </div>
                  </div>
                  <div className="dash-card-body">
                    <div className="dash-card-meta">
                      <span>{formatDate(t.dates.start)} — {formatDate(t.dates.end)}</span>
                      <span>{nights} nights</span>
                    </div>
                    <div className="dash-card-footer">
                      <span className="dash-card-updated">Updated {timeAgo(trip.updated_at)}</span>
                      <div className="dash-card-actions">
                        <button
                          className={`dash-card-btn ${copied === trip.share_id ? 'copied' : ''}`}
                          onClick={() => copyLink(trip.share_id)}
                          title="Copy share link"
                        >
                          {copied === trip.share_id ? (
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="20 6 9 17 4 12" /></svg>
                          ) : (
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" /><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" /></svg>
                          )}
                          {copied === trip.share_id ? 'Copied' : 'Copy link'}
                        </button>
                        <Link href={`/t/${trip.share_id}`} className="dash-card-btn">
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" /><polyline points="15 3 21 3 21 9" /><line x1="10" y1="14" x2="21" y2="3" /></svg>
                          Open
                        </Link>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <div className="dash-api-section">
          <h2 className="dash-section-title">API access</h2>
          <p className="dash-section-desc">Use your API key to push trip data from Claude or any AI assistant.</p>
          <div className="dash-code-block">
            <code>
              curl -X POST https://trips.vanschadewijk.com/api/trips \<br />
              {'  '}-H &quot;Authorization: Bearer YOUR_API_KEY&quot; \<br />
              {'  '}-H &quot;Content-Type: application/json&quot; \<br />
              {'  '}-d &apos;{'{'}&quot;trip&quot;: {'{'}&quot;name&quot;: &quot;Scotland&quot;, ...{'}'}, &quot;days&quot;: [...]{'}'}&apos;
            </code>
          </div>
        </div>
      </main>
    </div>
  );
}

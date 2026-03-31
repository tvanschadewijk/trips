'use client';

import { useState } from 'react';
import Link from 'next/link';
import '@/styles/dashboard.css';

interface MockTrip {
  id: string;
  name: string;
  subtitle: string;
  share_id: string;
  hero_image: string;
  dates: { start: string; end: string };
  updated_at: string;
  is_public: boolean;
}

const mockTrips: MockTrip[] = [
  {
    id: '1',
    name: 'Scotland',
    subtitle: 'West Highland Way & Oban Coast',
    share_id: 'kR4mNx2pQw',
    hero_image: 'https://images.unsplash.com/photo-1732045133230-1a670eef8620?w=600&h=400&fit=crop&q=80',
    dates: { start: '2026-04-24', end: '2026-05-03' },
    updated_at: '2026-03-30T20:00:00Z',
    is_public: true,
  },
  {
    id: '2',
    name: 'Rajasthan',
    subtitle: 'Forts, Deserts & Pink Cities',
    share_id: 'xM3pQw7nRt',
    hero_image: 'https://images.unsplash.com/photo-1524492412937-b28074a5d7da?w=600&h=400&fit=crop&q=80',
    dates: { start: '2026-12-20', end: '2026-12-31' },
    updated_at: '2026-03-28T15:00:00Z',
    is_public: true,
  },
];

export default function DashboardPage() {
  const [copied, setCopied] = useState<string | null>(null);

  function copyLink(shareId: string) {
    const url = `${window.location.origin}/t/${shareId}`;
    navigator.clipboard.writeText(url).then(() => {
      setCopied(shareId);
      setTimeout(() => setCopied(null), 2000);
    });
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

  return (
    <div className="dash">
      <nav className="dash-nav">
        <div className="dash-nav-inner">
          <Link href="/" className="dash-logo">trips</Link>
          <div className="dash-nav-right">
            <span className="dash-user-email">thijs@vanschadewijk.com</span>
          </div>
        </div>
      </nav>

      <main className="dash-main">
        <div className="dash-header">
          <div>
            <h1 className="dash-title">Your trips</h1>
            <p className="dash-subtitle">{mockTrips.length} trips</p>
          </div>
          <button className="dash-btn-new">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
            API key
          </button>
        </div>

        <div className="dash-grid">
          {mockTrips.map(trip => {
            const startD = new Date(trip.dates.start + 'T12:00:00');
            const endD = new Date(trip.dates.end + 'T12:00:00');
            const nights = Math.round((endD.getTime() - startD.getTime()) / 86400000);

            return (
              <div key={trip.id} className="dash-card">
                <div className="dash-card-hero">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={trip.hero_image} alt={trip.name} />
                  <div className="dash-card-hero-gradient" />
                  <div className="dash-card-hero-text">
                    <div className="dash-card-name">{trip.name}</div>
                    <div className="dash-card-subtitle">{trip.subtitle}</div>
                  </div>
                </div>
                <div className="dash-card-body">
                  <div className="dash-card-meta">
                    <span>{formatDate(trip.dates.start)} — {formatDate(trip.dates.end)}</span>
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

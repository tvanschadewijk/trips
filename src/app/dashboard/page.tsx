'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import type { TripData } from '@/lib/types';
import { getTripOverviewImageUrl } from '@/lib/trip-images';
import { useSavedTripIds } from '@/lib/offline';
import { useOnlineStatus } from '@/lib/online-status';
import { isPublicItineraryShareId } from '@/lib/public-itineraries';
import '@/styles/dashboard.css';

interface DashTrip {
  id: string;
  name: string;
  share_id: string;
  data: TripData;
  share_mode: 'private' | 'companion' | 'remix';
  created_at: string;
  updated_at: string;
}

export default function DashboardPage() {
  const router = useRouter();
  const appVersion = process.env.NEXT_PUBLIC_APP_VERSION;
  const [trips, setTrips] = useState<DashTrip[]>(() => {
    if (typeof window !== 'undefined') {
      try {
        const c = sessionStorage.getItem('dash-trips');
        if (c) return (JSON.parse(c) as DashTrip[]).filter(t => !isPublicItineraryShareId(t.share_id));
      } catch {}
    }
    return [];
  });
  const [email, setEmail] = useState<string | null>(() => {
    if (typeof window !== 'undefined') return sessionStorage.getItem('dash-email') || null;
    return null;
  });
  const [copied, setCopied] = useState<string | null>(null);
  const [skillCopied, setSkillCopied] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [cardMenuOpen, setCardMenuOpen] = useState<string | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [loading, setLoading] = useState(() => {
    if (typeof window !== 'undefined' && sessionStorage.getItem('dash-trips')) return false;
    return true;
  });
  const [isAdmin, setIsAdmin] = useState(false);
  const [vtTrip, setVtTrip] = useState<string | null>(() => {
    if (typeof window !== 'undefined') return sessionStorage.getItem('vt-trip');
    return null;
  });
  const savedOfflineIds = useSavedTripIds();
  const online = useOnlineStatus();
  const personalTrips = trips.filter(t => !isPublicItineraryShareId(t.share_id));
  const visibleTrips = online ? personalTrips : personalTrips.filter(t => savedOfflineIds.has(t.share_id));
  const tripGroups = (() => {
    const today = new Date().toISOString().slice(0, 10);
    const current: DashTrip[] = [];
    const upcoming: DashTrip[] = [];
    const past: DashTrip[] = [];
    for (const trip of visibleTrips) {
      const start = trip.data?.trip?.dates?.start ?? '';
      const end = trip.data?.trip?.dates?.end ?? '';
      if (!start || !end) {
        upcoming.push(trip);
        continue;
      }
      if (today < start) upcoming.push(trip);
      else if (today > end) past.push(trip);
      else current.push(trip);
    }
    // current: sort by end ascending (closest finishing first); upcoming asc by start; past desc by end
    current.sort((a, b) => (a.data?.trip?.dates?.end ?? '').localeCompare(b.data?.trip?.dates?.end ?? ''));
    upcoming.sort((a, b) => (a.data?.trip?.dates?.start ?? '').localeCompare(b.data?.trip?.dates?.start ?? ''));
    past.sort((a, b) => (b.data?.trip?.dates?.end ?? '').localeCompare(a.data?.trip?.dates?.end ?? ''));
    return { current, upcoming, past };
  })();
  const tripSections = [
    { key: 'current', label: 'Travelling now', trips: tripGroups.current },
    { key: 'upcoming', label: 'Upcoming', trips: tripGroups.upcoming },
    { key: 'past', label: 'Past', trips: tripGroups.past },
  ].filter(s => s.trips.length > 0);

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

    // Check admin role
    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single();
    if (profile?.role === 'admin') setIsAdmin(true);

    // Try with share_mode (post-migration). If the column doesn't exist
    // yet, retry without it and default every trip to 'companion' — keeps
    // the dashboard working when a deploy lands before the migration is
    // applied.
    type RawTrip = Omit<DashTrip, 'share_mode'> & { share_mode?: DashTrip['share_mode'] };
    let rawTrips: RawTrip[] | null = null;

    const withMode = await supabase
      .from('trips')
      .select('id, name, share_id, data, share_mode, created_at, updated_at')
      .eq('user_id', user.id)
      .order('updated_at', { ascending: false });
    if (withMode.error) {
      const fallback = await supabase
        .from('trips')
        .select('id, name, share_id, data, created_at, updated_at')
        .eq('user_id', user.id)
        .order('updated_at', { ascending: false });
      if (!fallback.error && fallback.data) rawTrips = fallback.data as RawTrip[];
    } else if (withMode.data) {
      rawTrips = withMode.data as RawTrip[];
    }

    if (rawTrips) {
      const sorted = rawTrips
        .filter(t => !isPublicItineraryShareId(t.share_id))
        .map(t => ({ ...t, share_mode: t.share_mode ?? 'companion' } as DashTrip))
        .sort((a, b) => {
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
      const t = setTimeout(() => { sessionStorage.removeItem('vt-trip'); setVtTrip(null); }, 400);
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

  async function handleShareModeChange(tripId: string, next: 'private' | 'companion' | 'remix') {
    // Optimistic — flip locally so the menu's checkmark updates instantly.
    const prev = trips.find(t => t.id === tripId)?.share_mode;
    if (prev === next) return;
    const updated = trips.map(t => t.id === tripId ? { ...t, share_mode: next } : t);
    setTrips(updated);
    sessionStorage.setItem('dash-trips', JSON.stringify(updated));

    const res = await fetch(`/api/trips/${tripId}/share-mode`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ share_mode: next }),
    });
    if (!res.ok) {
      // Revert on failure.
      const reverted = trips.map(t => t.id === tripId && prev ? { ...t, share_mode: prev } : t);
      setTrips(reverted);
      sessionStorage.setItem('dash-trips', JSON.stringify(reverted));
    }
  }

  async function handleDelete(tripId: string) {
    setDeleting(true);
    const supabase = createClient();
    const { error } = await supabase.from('trips').delete().eq('id', tripId);
    if (!error) {
      const updated = trips.filter(t => t.id !== tripId);
      setTrips(updated);
      sessionStorage.setItem('dash-trips', JSON.stringify(updated));
    }
    setDeleting(false);
    setDeleteConfirm(null);
  }

  function shareModeLabel(mode: 'private' | 'companion' | 'remix'): string {
    if (mode === 'private') return 'Private';
    if (mode === 'remix') return 'Remix link';
    return 'Companion link';
  }

  function shareModeHint(mode: 'private' | 'companion' | 'remix'): string {
    if (mode === 'private') return 'Link is off';
    if (mode === 'remix') return 'Public, PII removed, others can remix';
    return 'Anyone with the link sees full bookings';
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

  function wasUpdated(trip: DashTrip) {
    if (!trip.created_at || !trip.updated_at) return false;
    const diff = new Date(trip.updated_at).getTime() - new Date(trip.created_at).getTime();
    return diff > 60_000; // more than 1 minute apart
  }

  if (loading) {
    return (
      <div className="dash" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100dvh' }}>
        <span style={{ color: '#6B6157', fontFamily: '"Fraunces", Georgia, serif', fontStyle: 'italic', fontSize: 16 }}>Loading...</span>
      </div>
    );
  }

  return (
    <div className="dash">
      <nav className="dash-nav">
        <div className="dash-nav-inner">
          <Link href="/" className="dash-logo">OurTrips<span className="logo-to">.To</span> <span className="logo-suffix">{personalTrips.length > 0 ? `${personalTrips[0].name}${personalTrips.length > 1 ? ` and ${personalTrips.length - 1} more` : ''}` : '?'}</span></Link>
          <div className="dash-nav-right">
            <button className="dash-settings-btn" onClick={() => setSettingsOpen(!settingsOpen)} aria-label="Settings">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
            </button>
            {settingsOpen && (
              <>
                <div className="dash-settings-backdrop" onClick={() => setSettingsOpen(false)} />
                <div className="dash-settings-menu">
                  <div className="dash-settings-email">{email}</div>
                  <div className="dash-settings-divider" />
                  {isAdmin && online && (
                    <Link href="/admin" className="dash-settings-item" onClick={() => setSettingsOpen(false)}>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 3v18h18"/><path d="m19 9-5 5-4-4-3 3"/></svg>
                      Analytics
                    </Link>
                  )}
                  <button
                    className="dash-settings-item"
                    onClick={() => { if (!online) return; setSettingsOpen(false); handleSignOut(); }}
                    disabled={!online}
                    title={online ? undefined : 'Available when online'}
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
                    Sign out
                  </button>
                  {appVersion && (
                    <>
                      <div className="dash-settings-divider" />
                      <div className="dash-settings-version">Version {appVersion}</div>
                    </>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      </nav>

      <main className="dash-main">
        {!online && (
          <div className="dash-offline-banner" role="status" aria-live="polite">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><line x1="1" y1="1" x2="23" y2="23"/><path d="M16.72 11.06A10.94 10.94 0 0 1 19 12.55"/><path d="M5 12.55a10.94 10.94 0 0 1 5.17-2.39"/><path d="M10.71 5.05A16 16 0 0 1 22.58 9"/><path d="M1.42 9a15.91 15.91 0 0 1 4.7-2.88"/><path d="M8.53 16.11a6 6 0 0 1 6.95 0"/><line x1="12" y1="20" x2="12.01" y2="20"/></svg>
            <span><strong>You&rsquo;re offline.</strong> Showing trips you&rsquo;ve saved.</span>
          </div>
        )}
        <div className="dash-header">
          <div>
            <h1 className="dash-title">Trips</h1>
            <p className="dash-subtitle">
              {online
                ? (trips.length === 0 ? 'You have no trips planned' : `${trips.length} trip${trips.length !== 1 ? 's' : ''}`)
                : (visibleTrips.length === 0 ? 'No saved trips yet' : `${visibleTrips.length} saved trip${visibleTrips.length !== 1 ? 's' : ''}`)}
            </p>
          </div>
        </div>

        {visibleTrips.length === 0 && !online ? (
          <div className="dash-offline-empty">
            <h3>Nothing saved yet</h3>
            <p>Open a trip while connected and tap the download icon to keep it on this device.</p>
          </div>
        ) : trips.length === 0 ? (
          <div className="dash-onboard">
            <div className="dash-onboard-header">
              <div className="dash-onboard-icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M9 6.75V15m6-6v8.25m.503 3.498 4.875-2.437c.381-.19.622-.58.622-1.006V4.82c0-.836-.88-1.38-1.628-1.006l-3.869 1.934c-.317.159-.69.159-1.006 0L9.503 3.252a1.125 1.125 0 0 0-1.006 0L3.622 5.689C3.24 5.88 3 6.27 3 6.695V19.18c0 .836.88 1.38 1.628 1.006l3.869-1.934c.317-.159.69-.159 1.006 0l4.994 2.497c.317.158.69.158 1.006 0Z" /></svg>
              </div>
              <h3>Create your first trip</h3>
              <p>Turn any conversation with Claude into a beautiful, pocket-friendly itinerary. Here&apos;s how:</p>
            </div>

            <div className="dash-onboard-steps">
              <div className="dash-onboard-step dash-onboard-step-with-aside">
                <div className="dash-onboard-step-main">
                  <div className="dash-onboard-step-num">1</div>
                  <div className="dash-onboard-step-body">
                    <div className="dash-onboard-step-title">Open Claude on your computer</div>
                    <p className="dash-onboard-step-desc">
                      Download <a href="https://claude.ai/download" target="_blank" rel="noopener noreferrer">Claude for Mac or Windows</a> if you haven&apos;t already.
                    </p>
                  </div>
                </div>
                <div className="dash-onboard-compat">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>
                  <p>Also works with other agents that support skills, like <strong>Codex</strong> from OpenAI, <strong>Clawdbot</strong>, and more.</p>
                </div>
              </div>

              <div className="dash-onboard-step">
                <div className="dash-onboard-step-num">2</div>
                <div className="dash-onboard-step-body">
                  <div className="dash-onboard-step-title">Install the OurTrips skill</div>
                  <p className="dash-onboard-step-desc">
                    Start a CoWork session, then paste this into the chat:
                  </p>
                  <div className="dash-onboard-code">
                    <code>Fetch https://ourtrips.to/our-trips.skill and add it to my skills.</code>
                    <button
                      className={`dash-onboard-copy-btn ${skillCopied ? 'copied' : ''}`}
                      onClick={() => {
                        navigator.clipboard.writeText('Fetch https://ourtrips.to/our-trips.skill and add it to my skills.');
                        setSkillCopied(true);
                        setTimeout(() => setSkillCopied(false), 2000);
                      }}
                      title="Copy to clipboard"
                    >
                      {skillCopied ? (
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="20 6 9 17 4 12" /></svg>
                      ) : (
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
                      )}
                    </button>
                  </div>
                  <p className="dash-onboard-step-note">
                    Or <a href="/our-trips.skill" download>download the skill file</a> and add it manually. <Link href="/guide">Full guide</Link>
                  </p>
                </div>
              </div>

              <div className="dash-onboard-step">
                <div className="dash-onboard-step-num">3</div>
                <div className="dash-onboard-step-body">
                  <div className="dash-onboard-step-title">Plan your trip with Claude</div>
                  <p className="dash-onboard-step-desc">
                    Talk about where you&apos;re going, what you want to do, where you&apos;re staying &mdash; anything. Claude will help you shape a full itinerary.
                  </p>
                </div>
              </div>

              <div className="dash-onboard-step">
                <div className="dash-onboard-step-num">4</div>
                <div className="dash-onboard-step-body">
                  <div className="dash-onboard-step-title">Say &ldquo;Send it to OurTrips&rdquo;</div>
                  <p className="dash-onboard-step-desc">
                    When you&apos;re happy with the plan, just ask Claude to send it. Your trip will appear right here &mdash; ready to share or pull up on your phone while traveling.
                  </p>
                </div>
              </div>
            </div>

            <div className="dash-onboard-footer">
              <Link href="/itineraries" className="dash-onboard-demo-link">
                See what a finished trip looks like
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>
              </Link>
            </div>
          </div>
        ) : (
          tripSections.map(section => (
          <section key={section.key} className={`dash-section dash-section-${section.key}`}>
            <h2 className="dash-section-title">{section.label}</h2>
            <div className="dash-grid">
            {section.trips.map(trip => {
              const t = trip.data.trip;
              const overviewImage = getTripOverviewImageUrl(t);
              const startD = new Date(t.dates.start + 'T12:00:00');
              const endD = new Date(t.dates.end + 'T12:00:00');
              const nights = Math.round((endD.getTime() - startD.getTime()) / 86400000);

              return (
                <div key={trip.id} className="dash-card">
                  <Link
                    href={`/t/${trip.share_id}`}
                    className="dash-card-link"
                    onMouseEnter={() => { const img = new window.Image(); img.src = overviewImage; }}
                    onTouchStart={() => { const img = new window.Image(); img.src = overviewImage; }}
                    onClick={(e) => {
                      // Stash a snapshot of the overview photo so loading.tsx can
                      // paint the same photo + title under the morphing hero.
                      try {
                        sessionStorage.setItem(`vt-trip-${trip.share_id}`, JSON.stringify({
                          heroImage: overviewImage,
                          name: t.name,
                          subtitle: t.subtitle,
                          start: t.dates.start,
                          end: t.dates.end,
                        }));
                      } catch {}
                      const vt = (document as unknown as { startViewTransition?: (cb: () => Promise<void>) => void }).startViewTransition;
                      if (!vt) return; // let normal Link navigation happen
                      e.preventDefault();
                      const frame = (e.currentTarget as HTMLElement).querySelector('.dash-card-hero-frame') as HTMLElement | null;
                      if (frame) frame.style.viewTransitionName = 'trip-hero';
                      sessionStorage.setItem('vt-trip', trip.share_id);
                      vt.call(document, async () => {
                        router.push(`/t/${trip.share_id}`);
                        await new Promise<void>((resolve) => {
                          (window as unknown as Record<string, unknown>).__tripTransitionResolve = resolve;
                          setTimeout(resolve, 600);
                        });
                      });
                    }}
                  >
                    <div className="dash-card-hero">
                      <div className="dash-card-hero-frame" style={vtTrip === trip.share_id ? { viewTransitionName: 'trip-hero' } as React.CSSProperties : undefined}>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={overviewImage} alt={t.name} />
                        <div className="dash-card-hero-gradient" />
                      </div>
                      <div className="dash-card-hero-text">
                        <div className="dash-card-name">{t.name}</div>
                        <div className="dash-card-subtitle">{t.subtitle}</div>
                      </div>
                    </div>
                  </Link>
                  <div className="dash-card-menu-wrap">
                    <button
                      className="dash-card-menu-btn"
                      onClick={(e) => { e.stopPropagation(); setCardMenuOpen(cardMenuOpen === trip.id ? null : trip.id); }}
                      aria-label="Trip options"
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg>
                    </button>
                    {cardMenuOpen === trip.id && (
                      <>
                        <div className="dash-card-menu-backdrop" onClick={() => setCardMenuOpen(null)} />
                        <div className="dash-card-menu">
                          <div className="dash-card-menu-section">Sharing</div>
                          {(['companion', 'remix', 'private'] as const).map(mode => (
                            <button
                              key={mode}
                              className={`dash-card-menu-item ${trip.share_mode === mode ? 'is-active' : ''}`}
                              onClick={() => { setCardMenuOpen(null); handleShareModeChange(trip.id, mode); }}
                              title={shareModeHint(mode)}
                            >
                              <span className="dash-card-menu-check" aria-hidden="true">
                                {trip.share_mode === mode ? '✓' : ''}
                              </span>
                              <span className="dash-card-menu-label">
                                <span className="dash-card-menu-label-name">{shareModeLabel(mode)}</span>
                                <span className="dash-card-menu-label-hint">{shareModeHint(mode)}</span>
                              </span>
                            </button>
                          ))}
                          <div className="dash-card-menu-divider" />
                          <button className="dash-card-menu-item dash-card-menu-item-danger" onClick={() => { setCardMenuOpen(null); setDeleteConfirm(trip.id); }}>
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                            Delete trip
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                  <div className="dash-card-body">
                    <div className="dash-card-meta">
                      <span>{formatDate(t.dates.start)} — {formatDate(t.dates.end)}</span>
                      <span>{nights} nights</span>
                    </div>
                    <div className="dash-card-footer">
                      {savedOfflineIds.has(trip.share_id) && (
                        <span className="dash-card-saved" title="Available offline">
                          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>
                          Offline
                        </span>
                      )}
                      {wasUpdated(trip) && <span className="dash-card-updated">Updated {timeAgo(trip.updated_at)}</span>}
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
          </section>
          ))
        )}
      </main>

      {/* Delete confirmation dialog */}
      {deleteConfirm && (
        <div className="dash-confirm-overlay">
          <div className="dash-confirm-backdrop" onClick={() => !deleting && setDeleteConfirm(null)} />
          <div className="dash-confirm-dialog">
            <div className="dash-confirm-title">Delete trip?</div>
            <p className="dash-confirm-message">
              &ldquo;{trips.find(t => t.id === deleteConfirm)?.data.trip.name}&rdquo; will be permanently removed. This cannot be undone.
            </p>
            <div className="dash-confirm-actions">
              <button className="dash-confirm-btn dash-confirm-cancel" onClick={() => setDeleteConfirm(null)} disabled={deleting}>Cancel</button>
              <button className="dash-confirm-btn dash-confirm-delete" onClick={() => handleDelete(deleteConfirm)} disabled={deleting}>
                {deleting ? 'Deleting...' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

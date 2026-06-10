'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  ArrowRight,
  ChartLine,
  Check,
  Copy,
  Ellipsis,
  Info,
  Link as LinkIcon,
  LogOut,
  Map as MapIcon,
  Settings,
  Trash2,
  WifiOff,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { normalizeTripData } from '@/lib/trip-data-normalize';
import {
  getLocalPreviewTrips,
  isLocalPreviewWithoutSupabase,
} from '@/lib/local-preview';
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

function normalizeDashTrip(trip: DashTrip): DashTrip {
  return {
    ...trip,
    data: normalizeTripData(trip.data),
  };
}

export default function DashboardPage() {
  const router = useRouter();
  const appVersion = process.env.NEXT_PUBLIC_APP_VERSION;
  const [trips, setTrips] = useState<DashTrip[]>(() => {
    if (typeof window !== 'undefined') {
      try {
        const c = sessionStorage.getItem('dash-trips');
        const parsed = c ? JSON.parse(c) : null;
        if (Array.isArray(parsed)) {
          return parsed
            .filter(t => !isPublicItineraryShareId(t.share_id))
            .map((trip) => normalizeDashTrip(trip as DashTrip));
        }
      } catch {}
    }
    return [];
  });
  const [email, setEmail] = useState<string | null>(() => {
    if (typeof window !== 'undefined') return sessionStorage.getItem('dash-email') || null;
    return null;
  });
  const [copied, setCopied] = useState<string | null>(null);
  const [connectionCopied, setConnectionCopied] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [cardMenuOpen, setCardMenuOpen] = useState<string | null>(null);
  const cardMenuRef = useRef<HTMLDivElement | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [loading, setLoading] = useState(() => {
    if (typeof window !== 'undefined' && sessionStorage.getItem('dash-trips')) return false;
    return true;
  });
  const [isAdmin, setIsAdmin] = useState(false);
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
    if (isLocalPreviewWithoutSupabase()) {
      const localTrips = getLocalPreviewTrips();
      setTrips(localTrips);
      setEmail('local-preview@example.com');
      sessionStorage.setItem('dash-email', 'local-preview@example.com');
      sessionStorage.setItem('dash-trips', JSON.stringify(localTrips));
      setLoading(false);
      return;
    }

    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
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
        .map(t => normalizeDashTrip({ ...t, share_mode: t.share_mode ?? 'companion' } as DashTrip))
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

  useEffect(() => {
    queueMicrotask(() => {
      void loadTrips();
    });
  }, [loadTrips]);


  useEffect(() => {
    if (!cardMenuOpen) return;

    function closeCardMenuOnOutsidePointer(event: PointerEvent) {
      const target = event.target;
      if (target instanceof Node && cardMenuRef.current?.contains(target)) return;
      setCardMenuOpen(null);
    }

    document.addEventListener('pointerdown', closeCardMenuOnOutsidePointer, true);
    return () => {
      document.removeEventListener('pointerdown', closeCardMenuOnOutsidePointer, true);
    };
  }, [cardMenuOpen]);

  function copyLink(shareId: string) {
    const url = `${window.location.origin}/t/${shareId}`;
    navigator.clipboard.writeText(url).then(() => {
      setCopied(shareId);
      setTimeout(() => setCopied(null), 2000);
    });
  }

  async function handleSignOut() {
    if (isLocalPreviewWithoutSupabase()) {
      sessionStorage.removeItem('dash-email');
      sessionStorage.removeItem('dash-trips');
      router.push('/');
      return;
    }

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
    if (isLocalPreviewWithoutSupabase()) return;

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
    if (isLocalPreviewWithoutSupabase()) {
      const updated = trips.filter(t => t.id !== tripId);
      setTrips(updated);
      sessionStorage.setItem('dash-trips', JSON.stringify(updated));
      setDeleting(false);
      setDeleteConfirm(null);
      return;
    }

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

  function formatUpdatedDate(dateStr: string) {
    return new Date(dateStr).toLocaleDateString('en-GB', {
      day: 'numeric',
      month: 'short',
    });
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
          <Link href="/" className="dash-logo" aria-label="OurTrips home">
            <span className="dash-logo-word">OurTrips<span className="logo-to">.To</span></span>
            <span className="logo-suffix">{personalTrips.length > 0 ? `${personalTrips[0].name}${personalTrips.length > 1 ? ` and ${personalTrips.length - 1} more` : ''}` : '?'}</span>
          </Link>
          <div className="dash-nav-right">
            <button className="dash-settings-btn" onClick={() => setSettingsOpen(!settingsOpen)} aria-label="Settings">
              <Settings size={20} aria-hidden="true" />
            </button>
            {settingsOpen && (
              <>
                <div className="dash-settings-backdrop" onClick={() => setSettingsOpen(false)} />
                <div className="dash-settings-menu">
                  <div className="dash-settings-email">{email}</div>
                  <div className="dash-settings-divider" />
                  {isAdmin && online && (
                    <Link href="/admin" className="dash-settings-item" onClick={() => setSettingsOpen(false)}>
                      <ChartLine size={16} aria-hidden="true" />
                      Analytics
                    </Link>
                  )}
                  <button
                    className="dash-settings-item"
                    onClick={() => { if (!online) return; setSettingsOpen(false); handleSignOut(); }}
                    disabled={!online}
                    title={online ? undefined : 'Available when online'}
                  >
                    <LogOut size={16} aria-hidden="true" />
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
            <WifiOff size={14} aria-hidden="true" />
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
                <MapIcon aria-hidden="true" />
              </div>
              <h3>Create your first trip</h3>
              <p>Turn any conversation with Claude or Codex into a beautiful, pocket-friendly itinerary. Here&apos;s how:</p>
            </div>

            <div className="dash-onboard-steps">
              <div className="dash-onboard-step dash-onboard-step-with-aside">
                <div className="dash-onboard-step-main">
                  <div className="dash-onboard-step-num">1</div>
                  <div className="dash-onboard-step-body">
                    <div className="dash-onboard-step-title">Open Claude or Codex</div>
                    <p className="dash-onboard-step-desc">
                      Use Claude CoWork, Claude Desktop, Codex CLI, or the Codex desktop app.
                    </p>
                  </div>
                </div>
                <div className="dash-onboard-compat">
                  <Info size={14} aria-hidden="true" />
                  <p>The remote connector uses OAuth, so you do not need to paste an API key into your chat.</p>
                </div>
              </div>

              <div className="dash-onboard-step">
                <div className="dash-onboard-step-num">2</div>
                <div className="dash-onboard-step-body">
                  <div className="dash-onboard-step-title">Connect OurTrips</div>
                  <p className="dash-onboard-step-desc">
                    Add this remote MCP server as a custom connector, then sign in:
                  </p>
                  <div className="dash-onboard-code">
                    <code>https://ourtrips.to/mcp</code>
                    <button
                      className={`dash-onboard-copy-btn ${connectionCopied ? 'copied' : ''}`}
                      onClick={() => {
                        navigator.clipboard.writeText('https://ourtrips.to/mcp');
                        setConnectionCopied(true);
                        setTimeout(() => setConnectionCopied(false), 2000);
                      }}
                      title="Copy to clipboard"
                    >
                      {connectionCopied ? (
                        <Check size={14} aria-hidden="true" />
                      ) : (
                        <Copy size={14} aria-hidden="true" />
                      )}
                    </button>
                  </div>
                  <p className="dash-onboard-step-note">
                    Codex users can run <code>codex mcp add ourtrips --url https://ourtrips.to/mcp</code>. <Link href="/guide">Full guide</Link>
                  </p>
                </div>
              </div>

              <div className="dash-onboard-step">
                <div className="dash-onboard-step-num">3</div>
                <div className="dash-onboard-step-body">
                  <div className="dash-onboard-step-title">Plan your trip with Claude</div>
                  <p className="dash-onboard-step-desc">
                    Talk about where you&apos;re going, what you want to do, where you&apos;re staying &mdash; anything. Your agent will help you shape a full itinerary.
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
                <ArrowRight size={14} aria-hidden="true" />
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

              const menuOpen = cardMenuOpen === trip.id;

              return (
                <div key={trip.id} className={`dash-card ${menuOpen ? 'is-menu-open' : ''}`}>
                  <Link
                    href={`/t/${trip.share_id}`}
                    className="dash-card-link"
                    onMouseEnter={() => { const img = new window.Image(); img.src = overviewImage; }}
                    onTouchStart={() => { const img = new window.Image(); img.src = overviewImage; }}
                    onClick={(e) => {
                      // Stash a snapshot of the overview photo so loading.tsx can
                      // paint the same photo + title while the trip page loads.
                      try {
                        sessionStorage.setItem(`vt-trip-${trip.share_id}`, JSON.stringify({
                          heroImage: overviewImage,
                          name: t.name,
                          subtitle: t.subtitle,
                          start: t.dates.start,
                          end: t.dates.end,
                        }));
                      } catch {}
                      // Soft crossfade into the trip cover (no shared-element
                      // morph — the card→hero transform read as jarring). The
                      // awaited resolve keeps the old view up until the trip
                      // page has painted its decoded hero, so the fade lands
                      // on a finished cover instead of a placeholder.
                      const vt = (document as unknown as { startViewTransition?: (cb: () => Promise<void>) => void }).startViewTransition;
                      if (!vt) return; // let normal Link navigation happen
                      e.preventDefault();
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
                      <div className="dash-card-hero-frame">
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
                  <div className="dash-card-menu-wrap" ref={menuOpen ? cardMenuRef : undefined}>
                    <button
                      className="dash-card-menu-btn"
                      onClick={(e) => { e.stopPropagation(); setCardMenuOpen(cardMenuOpen === trip.id ? null : trip.id); }}
                      aria-label="Trip options"
                      aria-expanded={menuOpen}
                    >
                      <Ellipsis size={16} aria-hidden="true" />
                    </button>
                    {menuOpen && (
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
                                {trip.share_mode === mode ? <Check size={14} /> : null}
                              </span>
                              <span className="dash-card-menu-label">
                                <span className="dash-card-menu-label-name">{shareModeLabel(mode)}</span>
                                <span className="dash-card-menu-label-hint">{shareModeHint(mode)}</span>
                              </span>
                            </button>
                          ))}
                          <div className="dash-card-menu-divider" />
                          <button className="dash-card-menu-item dash-card-menu-item-danger" onClick={() => { setCardMenuOpen(null); setDeleteConfirm(trip.id); }}>
                            <Trash2 size={14} aria-hidden="true" />
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
                          <Check size={11} strokeWidth={2.4} aria-hidden="true" />
                          Offline
                        </span>
                      )}
                      {wasUpdated(trip) && <span className="dash-card-updated">Updated {formatUpdatedDate(trip.updated_at)}</span>}
                      <button
                        className={`dash-card-btn ${copied === trip.share_id ? 'copied' : ''}`}
                        onClick={() => copyLink(trip.share_id)}
                        title="Copy share link"
                      >
                        {copied === trip.share_id ? (
                          <>
                            <Check aria-hidden="true" />
                            Copied
                          </>
                        ) : (
                          <>
                            <LinkIcon aria-hidden="true" />
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

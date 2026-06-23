'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  ArrowRight,
  ChartLine,
  Check,
  LogOut,
  Map as MapIcon,
  MessageCircle,
  Plus,
  Settings,
  UserRound,
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
import AppTopBar from '@/components/ui/AppTopBar';
import NewTripCreator from '@/components/trips/NewTripCreator';
import {
  normalizeTravelProfilePreferences,
  type TravelProfilePreferences,
} from '@/lib/travel-profile';
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

const NEW_TRIP_AGENT_HREF = '/dashboard?agent=new';
const DASHBOARD_PROFILE_HREF = `/onboarding?next=${encodeURIComponent('/dashboard')}`;
const NEW_TRIP_PROFILE_HREF = `/onboarding?next=${encodeURIComponent(NEW_TRIP_AGENT_HREF)}`;

type DashboardClientProps = {
  initialAgentOpen?: boolean;
};

function normalizeDashTrip(trip: DashTrip): DashTrip {
  return {
    ...trip,
    data: normalizeTripData(trip.data),
  };
}

export default function DashboardClient({ initialAgentOpen = false }: DashboardClientProps) {
  const router = useRouter();
  const appVersion = process.env.NEXT_PUBLIC_APP_VERSION;
  const [trips, setTrips] = useState<DashTrip[]>([]);
  const [email, setEmail] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  const [travelProfileComplete, setTravelProfileComplete] = useState(false);
  const [travelPreferences, setTravelPreferences] = useState<TravelProfilePreferences>(() => (
    normalizeTravelProfilePreferences(null)
  ));
  const [newTripAgentOpen, setNewTripAgentOpen] = useState(initialAgentOpen);
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
      const localPreferences = normalizeTravelProfilePreferences(null);
      setTrips(localTrips);
      setEmail('local-preview@example.com');
      setTravelProfileComplete(true);
      setTravelPreferences(localPreferences);
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

    const { data: travelProfile } = await supabase
      .from('travel_profiles')
      .select('onboarding_completed_at, preferences')
      .eq('user_id', user.id)
      .maybeSingle();
    const nextTravelPreferences = normalizeTravelProfilePreferences(travelProfile?.preferences);
    setTravelProfileComplete(Boolean(travelProfile?.onboarding_completed_at));
    setTravelPreferences(nextTravelPreferences);

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
      try {
        const cachedEmail = sessionStorage.getItem('dash-email');
        const cachedTrips = sessionStorage.getItem('dash-trips');
        const parsedTrips = cachedTrips ? JSON.parse(cachedTrips) : null;

        if (cachedEmail) setEmail(cachedEmail);
        if (Array.isArray(parsedTrips)) {
          setTrips(
            parsedTrips
              .filter(t => !isPublicItineraryShareId(t.share_id))
              .map((trip) => normalizeDashTrip(trip as DashTrip))
          );
          setLoading(false);
        }
      } catch {}

      void loadTrips();
    });
  }, [loadTrips]);

  useEffect(() => {
    if (initialAgentOpen) {
      queueMicrotask(() => setNewTripAgentOpen(true));
    }
  }, [initialAgentOpen]);

  function openNewTripAgent() {
    setNewTripAgentOpen(true);
  }

  function handleNewTripAgentOpenChange(nextOpen: boolean) {
    setNewTripAgentOpen(nextOpen);
    if (nextOpen || typeof window === 'undefined') return;

    const currentUrl = new URL(window.location.href);
    if (currentUrl.pathname === '/dashboard' && currentUrl.searchParams.get('agent') === 'new') {
      router.replace('/dashboard', { scroll: false });
    }
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
      <AppTopBar
        suffix={personalTrips.length > 0 ? `${personalTrips[0].name}${personalTrips.length > 1 ? ` and ${personalTrips.length - 1} more` : ''}` : '?'}
        actions={
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
                  {online && (
                    <Link href={DASHBOARD_PROFILE_HREF} className="dash-settings-item" onClick={() => setSettingsOpen(false)}>
                      <UserRound size={16} aria-hidden="true" />
                      Travel profile
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
        }
      />

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
          {online && (
            <div className="dash-header-actions">
              <Link href={DASHBOARD_PROFILE_HREF} className="dash-profile-link">
                <UserRound size={15} aria-hidden="true" />
                Travel profile
              </Link>
              <Link href={NEW_TRIP_AGENT_HREF} className="dash-new-trip-btn" onClick={openNewTripAgent}>
                <Plus size={16} aria-hidden="true" />
                New trip
              </Link>
            </div>
          )}
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
              <p>Open the travel agent, answer a few guided questions, and let OurTrips build the first itinerary draft.</p>
            </div>

            <div className="dash-onboard-steps">
              <div className="dash-onboard-step">
                <div className="dash-onboard-step-num">1</div>
                <div className="dash-onboard-step-body">
                  <div className="dash-onboard-step-title">Create your travel profile</div>
                  <p className="dash-onboard-step-desc">
                    Set pace, food, lodging, transport, and practical preferences once.
                  </p>
                  <Link href={NEW_TRIP_PROFILE_HREF} className="dash-onboard-action-link">
                    {travelProfileComplete ? 'Review profile' : 'Start profile'}
                    <ArrowRight size={14} aria-hidden="true" />
                  </Link>
                </div>
              </div>

              <div className="dash-onboard-step">
                <div className="dash-onboard-step-num">2</div>
                <div className="dash-onboard-step-body">
                  <div className="dash-onboard-step-title">Brief the travel agent</div>
                  <p className="dash-onboard-step-desc">
                    The Ask Travel Agent sheet opens and collects destination, dates, travelers, references, and known bookings.
                  </p>
                </div>
              </div>

              <div className="dash-onboard-step">
                <div className="dash-onboard-step-num">3</div>
                <div className="dash-onboard-step-body">
                  <div className="dash-onboard-step-title">Open the generated itinerary</div>
                  <p className="dash-onboard-step-desc">
                    OurTrips saves the draft, opens the trip page, and keeps the travel agent ready for edits.
                  </p>
                </div>
              </div>
            </div>

            <div className="dash-onboard-footer">
              {travelProfileComplete ? (
                <Link href={NEW_TRIP_AGENT_HREF} className="dash-onboard-demo-link" onClick={openNewTripAgent}>
                  Create a trip
                  <ArrowRight size={14} aria-hidden="true" />
                </Link>
              ) : (
                <Link href={NEW_TRIP_PROFILE_HREF} className="dash-onboard-demo-link">
                  Create travel profile
                  <ArrowRight size={14} aria-hidden="true" />
                </Link>
              )}
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
                          // Hold the dashboard long enough for warm loads to
                          // fade STRAIGHT to the real cover; slower loads fade
                          // to the cover-shaped skeleton instead.
                          setTimeout(resolve, 1600);
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

      {online && (
        <Link
          href={NEW_TRIP_AGENT_HREF}
          className="dash-agent-entry"
          onClick={openNewTripAgent}
          aria-label="Ask your Travel Agent to create a new trip"
        >
          <MessageCircle className="dash-agent-entry-icon" aria-hidden="true" />
          <span className="dash-agent-entry-label">Ask Your Travel Agent</span>
        </Link>
      )}

      {newTripAgentOpen && (
        <NewTripCreator
          initialPreferences={travelPreferences}
          profileComplete={travelProfileComplete}
          open={newTripAgentOpen}
          autoOpen={false}
          showEntryButton={false}
          onOpenChange={handleNewTripAgentOpenChange}
          sheetTitle="Start a new trip with your travel agent."
          profileNextHref={NEW_TRIP_AGENT_HREF}
          showExistingTripHint
        />
      )}
    </div>
  );
}

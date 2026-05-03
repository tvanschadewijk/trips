import type { Metadata } from 'next';
import TripPreview from '@/components/preview/TripPreview';
import TripChatPanel from '@/components/chat/TripChatPanel';
import { createClient } from '@/lib/supabase/server';
import { sampleTrips } from '@/lib/sample-data';
import { checkIsAdmin, loadChatHistory } from '@/lib/trip-chat/history';
import { scrubTripData } from '@/lib/scrub-trip';
import type { TripData } from '@/lib/types';

interface Props {
  params: Promise<{ shareId: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { shareId } = await params;
  try {
    const supabase = await createClient();
    const { data } = await supabase
      .from('trips')
      .select('data')
      .eq('share_id', shareId)
      .in('share_mode', ['companion', 'remix'])
      .single();
    const trip = data?.data?.trip as TripData['trip'] | undefined;
    if (trip) {
      const title = `${trip.name} — OurTrips`;
      const description = trip.subtitle || trip.summary || `An itinerary on OurTrips.`;
      return {
        title,
        description,
        openGraph: { title, description, type: 'article' },
        twitter: { card: 'summary_large_image', title, description },
      };
    }
  } catch {
    // fall through
  }
  return {};
}

async function fetchTripAndViewer(shareId: string): Promise<{
  tripData: TripData;
  tripId: string;
  isOwner: boolean;
  isAdmin: boolean;
  viewerUserId: string | null;
  shareMode: 'companion' | 'remix';
} | null> {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from('trips')
      .select('id, data, user_id, share_mode')
      .eq('share_id', shareId)
      .in('share_mode', ['companion', 'remix'])
      .single();

    if (error || !data) return null;

    let isOwner = false;
    let isAdmin = false;
    let viewerUserId: string | null = null;
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        viewerUserId = user.id;
        if (data.user_id === user.id) isOwner = true;
        isAdmin = await checkIsAdmin(user.id);
      }
    } catch { /* not logged in */ }

    const rawTrip = data.data as TripData;
    const shareMode = (data.share_mode as 'companion' | 'remix') ?? 'companion';
    // Non-owners on a remix-mode trip get the scrubbed view. Owners
    // always see their own data raw. Companion-mode behaves as before.
    const tripData = !isOwner && shareMode === 'remix' ? scrubTripData(rawTrip) : rawTrip;

    return {
      tripData,
      tripId: data.id,
      isOwner,
      isAdmin,
      viewerUserId,
      shareMode,
    };
  } catch {
    // Supabase not connected yet — fall through to sample data
    return null;
  }
}

export default async function TripPage({ params }: Props) {
  const { shareId } = await params;

  const result = await fetchTripAndViewer(shareId);

  if (!result) {
    // Fallback: show first sample trip with days
    const sample = sampleTrips.find(t => t.days.length > 0);
    if (!sample) {
      return (
        <div style={{ minHeight: '100dvh', background: '#FBF7F1', color: '#1A1410', padding: 60, textAlign: 'center', fontFamily: 'Inter, system-ui, sans-serif' }}>
          <h1 style={{ fontFamily: '"Fraunces", Georgia, serif', fontSize: 32, fontWeight: 400, letterSpacing: '-0.012em', marginBottom: 12 }}>Trip not found</h1>
          <p style={{ color: '#6B6157', fontSize: 15 }}>This link may be invalid or the trip may have been removed.</p>
        </div>
      );
    }
    return <TripPreview trips={[sample]} autoOpen />;
  }

  // Trip owners (and admins, who can edit any trip for support) get the
  // chat panel. Load last N messages for initial render so the user
  // sees their prior conversation immediately when they open the panel.
  const canEditViaChat = (result.isOwner || result.isAdmin) && !!result.viewerUserId;
  let initialChatMessages: Awaited<ReturnType<typeof loadChatHistory>> = [];
  if (canEditViaChat && result.viewerUserId) {
    initialChatMessages = await loadChatHistory(result.tripId, result.viewerUserId);
  }

  return (
    <>
      <TripPreview
        trips={[result.tripData]}
        autoOpen
        shareId={shareId}
        canAddToTrips={!result.isOwner}
        shareMode={result.shareMode}
        tripId={result.isOwner ? result.tripId : undefined}
      />
      {canEditViaChat && (
        <TripChatPanel tripId={result.tripId} initialMessages={initialChatMessages} />
      )}
    </>
  );
}

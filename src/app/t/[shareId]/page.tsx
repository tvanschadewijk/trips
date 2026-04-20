import TripPreview from '@/components/preview/TripPreview';
import TripChatPanel from '@/components/chat/TripChatPanel';
import { createClient } from '@/lib/supabase/server';
import { sampleTrips } from '@/lib/sample-data';
import { checkIsAdmin, loadChatHistory } from '@/lib/trip-chat/history';
import type { TripData } from '@/lib/types';

interface Props {
  params: Promise<{ shareId: string }>;
}

async function fetchTripAndViewer(shareId: string): Promise<{
  tripData: TripData;
  tripId: string;
  isOwner: boolean;
  isAdmin: boolean;
  viewerUserId: string | null;
} | null> {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from('trips')
      .select('id, data, user_id')
      .eq('share_id', shareId)
      .eq('is_public', true)
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

    return {
      tripData: data.data as TripData,
      tripId: data.id,
      isOwner,
      isAdmin,
      viewerUserId,
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
        <div style={{ color: 'white', padding: 40, textAlign: 'center', fontFamily: 'Inter, sans-serif' }}>
          <h1 style={{ fontSize: 24, marginBottom: 8 }}>Trip not found</h1>
          <p style={{ color: 'rgba(255,255,255,0.5)' }}>This link may be invalid or the trip may have been removed.</p>
        </div>
      );
    }
    return <TripPreview trips={[sample]} autoOpen />;
  }

  // Admin-only chat panel. Load last N messages for initial render so the user
  // sees their prior conversation immediately when they open the panel.
  let initialChatMessages: Awaited<ReturnType<typeof loadChatHistory>> = [];
  if (result.isAdmin && result.viewerUserId) {
    initialChatMessages = await loadChatHistory(result.tripId, result.viewerUserId);
  }

  return (
    <>
      <TripPreview
        trips={[result.tripData]}
        autoOpen
        shareId={result.isOwner ? undefined : shareId}
        tripId={result.isOwner ? result.tripId : undefined}
      />
      {result.isAdmin && (
        <TripChatPanel tripId={result.tripId} initialMessages={initialChatMessages} />
      )}
    </>
  );
}

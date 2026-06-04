import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import TripPreview from '@/components/preview/TripPreview';
import TripChatPanel from '@/components/chat/TripChatPanel';
import { createClient } from '@/lib/supabase/server';
import { normalizeTripData } from '@/lib/trip-data-normalize';
import { loadChatHistory } from '@/lib/trip-chat/history';
import { scrubTripData } from '@/lib/scrub-trip';
import {
  getPublicItineraryByShareId,
  isPublicItineraryShareId,
} from '@/lib/public-itineraries';
import type { TripData } from '@/lib/types';

interface Props {
  params: Promise<{ shareId: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { shareId } = await params;
  const publicItinerary = getPublicItineraryByShareId(shareId);
  try {
    const supabase = await createClient();
    const { data } = await supabase
      .from('trips')
      .select('data')
      .eq('share_id', shareId)
      .in('share_mode', ['companion', 'remix'])
      .single();
    if (data?.data) {
      const trip = normalizeTripData(data.data).trip;
      const title = `${trip.name} — OurTrips`;
      const description = trip.subtitle || trip.summary || `An itinerary on OurTrips.`;
      return {
        title,
        description,
        robots: { index: false, follow: true },
        alternates: publicItinerary
          ? {
              canonical: publicItinerary.url,
            }
          : undefined,
        openGraph: {
          title,
          description,
          type: 'article',
          url: publicItinerary?.url ?? `https://ourtrips.to/t/${shareId}`,
        },
        twitter: { card: 'summary_large_image', title, description },
      };
    }
  } catch {
    // fall through
  }
  return {
    title: 'Trip not found — OurTrips',
    robots: { index: false, follow: false },
  };
}

async function fetchTripAndViewer(shareId: string): Promise<{
  tripData: TripData;
  tripId: string;
  isOwner: boolean;
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
    let viewerUserId: string | null = null;
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        viewerUserId = user.id;
        if (data.user_id === user.id) isOwner = true;
      }
    } catch { /* not logged in */ }

    const rawTrip = normalizeTripData(data.data);
    const shareMode = (data.share_mode as 'companion' | 'remix') ?? 'companion';
    // Non-owners on a remix-mode trip get the scrubbed view. Owners
    // always see their own data raw. Companion-mode behaves as before.
    const tripData = !isOwner && shareMode === 'remix'
      ? normalizeTripData(scrubTripData(rawTrip))
      : rawTrip;

    return {
      tripData,
      tripId: data.id,
      isOwner,
      viewerUserId,
      shareMode,
    };
  } catch {
    // Supabase not connected or the trip is unavailable.
    return null;
  }
}

export default async function TripPage({ params }: Props) {
  const { shareId } = await params;

  const result = await fetchTripAndViewer(shareId);
  const isPublicSample = isPublicItineraryShareId(shareId);

  if (!result) {
    notFound();
  }

  // Only the trip owner can edit through chat. Shared-trip viewers need
  // to add the trip to their own account first, then edit their copy.
  const canEditViaChat = !isPublicSample && result.isOwner && !!result.viewerUserId;
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
        canAddToTrips={isPublicSample || !result.isOwner}
        shareMode={result.shareMode}
        tripId={!isPublicSample && result.isOwner ? result.tripId : undefined}
        homeHref={result.viewerUserId ? '/dashboard' : '/'}
      />
      {canEditViaChat && (
        <TripChatPanel tripId={result.tripId} initialMessages={initialChatMessages} />
      )}
    </>
  );
}

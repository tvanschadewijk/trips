import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import TripPreview from '@/components/preview/TripPreview';
import TripChatPanel from '@/components/chat/TripChatPanel';
import { createClient } from '@/lib/supabase/server';
import { normalizeTripData } from '@/lib/trip-data-normalize';
import { loadInitialChatBundle, type InitialChatBundle } from '@/lib/trip-chat/history';
import { scrubTripData, stripPrivateTravelWalletData } from '@/lib/scrub-trip';
import {
  getLocalPreviewTripByShareId,
  isLocalPreviewWithoutSupabase,
} from '@/lib/local-preview';
import {
  getPublicItineraryByShareId,
  isPublicItineraryShareId,
} from '@/lib/public-itineraries';
import type { TripData } from '@/lib/types';

export const dynamic = 'force-dynamic';

type ShareMode = 'private' | 'companion' | 'remix';

interface Props {
  params: Promise<{ shareId: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { shareId } = await params;
  const publicItinerary = getPublicItineraryByShareId(shareId);
  if (isLocalPreviewWithoutSupabase()) {
    const localTrip = getLocalPreviewTripByShareId(shareId);
    if (localTrip) {
      const trip = localTrip.data.trip;
      return {
        title: `${trip.name} — OurTrips`,
        description: trip.subtitle || trip.summary || 'A local preview itinerary on OurTrips.',
        robots: { index: false, follow: false },
      };
    }
  }

  try {
    const supabase = await createClient();
    const { data } = await supabase
      .from('trips')
      .select('data, user_id, share_mode')
      .eq('share_id', shareId)
      .is('deleted_at', null)
      .single();
    if (data?.data) {
      if (data.share_mode === 'private') {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user || data.user_id !== user.id) {
          return {
            title: 'Trip not found — OurTrips',
            robots: { index: false, follow: false },
          };
        }
      }
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
  shareMode: ShareMode;
} | null> {
  try {
    if (isLocalPreviewWithoutSupabase()) {
      const localTrip = getLocalPreviewTripByShareId(shareId);
      if (!localTrip) return null;
      return {
        tripData: localTrip.data,
        tripId: localTrip.id,
        isOwner: true,
        viewerUserId: null,
        shareMode: localTrip.share_mode,
      };
    }

    const supabase = await createClient();
    const { data, error } = await supabase
      .from('trips')
      .select('id, data, user_id, share_mode')
      .eq('share_id', shareId)
      .is('deleted_at', null)
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

    const shareMode = (data.share_mode as ShareMode) ?? 'companion';
    if (shareMode === 'private' && !isOwner) return null;

    const rawTrip = normalizeTripData(data.data);
    // Non-owners on a remix-mode trip get the scrubbed view. Owners always
    // see their own data raw. Companion-mode keeps legacy share semantics,
    // but new Travel Wallet items stay private by default.
    const tripData = !isOwner && shareMode === 'remix'
      ? normalizeTripData(scrubTripData(rawTrip))
      : !isOwner
        ? normalizeTripData(stripPrivateTravelWalletData(rawTrip))
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
  const isLocalPreview = isLocalPreviewWithoutSupabase() && Boolean(getLocalPreviewTripByShareId(shareId));

  if (!result) {
    notFound();
  }

  // Only the trip owner can edit through chat. Shared-trip viewers need
  // to add the trip to their own account first, then edit their copy.
  const canEditViaChat = !isPublicSample && result.isOwner && !!result.viewerUserId;
  let initialChat: InitialChatBundle = { threads: [], activeThreadId: null, messages: [] };
  if (canEditViaChat && result.viewerUserId) {
    initialChat = await loadInitialChatBundle(result.tripId, result.viewerUserId);
  }

  return (
    <>
      <TripPreview
        trips={[result.tripData]}
        autoOpen
        shareId={shareId}
        canAddToTrips={!isLocalPreview && (isPublicSample || !result.isOwner)}
        shareMode={result.shareMode}
        tripId={!isLocalPreview && !isPublicSample && result.isOwner ? result.tripId : undefined}
        homeHref={isLocalPreview || result.viewerUserId ? '/dashboard' : '/'}
        showLoginAction={!isLocalPreview && !result.viewerUserId}
        loginHref={`/login?next=${encodeURIComponent(`/t/${shareId}`)}`}
      />
      {canEditViaChat && (
        <TripChatPanel
          tripId={result.tripId}
          initialThreads={initialChat.threads}
          initialThreadId={initialChat.activeThreadId}
          initialMessages={initialChat.messages}
        />
      )}
    </>
  );
}

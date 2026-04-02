import TripPreview from '@/components/preview/TripPreview';
import { createClient } from '@/lib/supabase/server';
import { sampleTrips } from '@/lib/sample-data';
import type { TripData } from '@/lib/types';

interface Props {
  params: Promise<{ shareId: string }>;
}

async function fetchTrip(shareId: string): Promise<{ tripData: TripData; isOwner: boolean } | null> {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from('trips')
      .select('data, user_id')
      .eq('share_id', shareId)
      .eq('is_public', true)
      .single();

    if (error || !data) return null;

    // Check if current user owns this trip
    let isOwner = false;
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (user && data.user_id === user.id) isOwner = true;
    } catch { /* not logged in */ }

    return { tripData: data.data as TripData, isOwner };
  } catch {
    // Supabase not connected yet — fall through to sample data
    return null;
  }
}

export default async function TripPage({ params }: Props) {
  const { shareId } = await params;

  // Try Supabase first, fall back to sample data for dev
  const result = await fetchTrip(shareId);

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

  return <TripPreview trips={[result.tripData]} autoOpen shareId={result.isOwner ? undefined : shareId} />;
}

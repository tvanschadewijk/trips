import TripPreview from '@/components/preview/TripPreview';
import { createClient } from '@/lib/supabase/server';
import { sampleTrips } from '@/lib/sample-data';
import type { TripData } from '@/lib/types';

interface Props {
  params: Promise<{ shareId: string }>;
}

async function fetchTrip(shareId: string): Promise<TripData | null> {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from('trips')
      .select('data')
      .eq('share_id', shareId)
      .eq('is_public', true)
      .single();

    if (error || !data) return null;
    return data.data as TripData;
  } catch {
    // Supabase not connected yet — fall through to sample data
    return null;
  }
}

export default async function TripPage({ params }: Props) {
  const { shareId } = await params;

  // Try Supabase first, fall back to sample data for dev
  let tripData = await fetchTrip(shareId);

  if (!tripData) {
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
    tripData = sample;
  }

  return <TripPreview trips={[tripData]} autoOpen />;
}

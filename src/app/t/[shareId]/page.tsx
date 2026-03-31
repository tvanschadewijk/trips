import TripPreview from '@/components/preview/TripPreview';
import { sampleTrips } from '@/lib/sample-data';

// For now, use sample data. When Supabase is connected, this will fetch from DB.
// interface Props {
//   params: Promise<{ shareId: string }>;
// }

export default async function TripPage() {
  // In production: fetch trip data from Supabase using shareId
  // const { shareId } = await params;
  // const tripData = await fetchTripByShareId(shareId);

  // For now, show the first trip with days as a single-trip preview
  const tripWithDays = sampleTrips.find(t => t.days.length > 0);
  if (!tripWithDays) {
    return <div style={{ color: 'white', padding: 40, textAlign: 'center' }}>Trip not found</div>;
  }

  return <TripPreview trips={[tripWithDays]} singleTrip />;
}

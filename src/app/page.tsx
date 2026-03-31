import TripPreview from '@/components/preview/TripPreview';
import { sampleTrips } from '@/lib/sample-data';

export default function Home() {
  return <TripPreview trips={sampleTrips} />;
}

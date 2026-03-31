import Link from 'next/link';
import TripPreview from '@/components/preview/TripPreview';
import { sampleTrips } from '@/lib/sample-data';

export default function DemoPage() {
  return (
    <>
      <Link href="/" className="demo-back-link">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6"/></svg>
        Back to trips
      </Link>
      <TripPreview trips={sampleTrips} />
    </>
  );
}

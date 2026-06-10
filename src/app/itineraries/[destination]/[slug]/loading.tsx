'use client';

import { usePathname } from 'next/navigation';
import TripCoverSkeleton from '@/components/preview/TripCoverSkeleton';

interface CachedItineraryPreview {
  heroImage?: string;
}

function readCache(pathname: string | null): CachedItineraryPreview {
  if (!pathname || typeof window === 'undefined') return {};
  try {
    const raw = sessionStorage.getItem(`vt-itinerary:${pathname}`);
    if (!raw) return {};
    return JSON.parse(raw) as CachedItineraryPreview;
  } catch {
    return {};
  }
}

/**
 * Loading state for public itinerary pages. Cover-shaped skeleton with the
 * photo the catalogue stashed on click — see TripCoverSkeleton.
 */
export default function LoadingPublicItineraryPage() {
  const pathname = usePathname();
  const preview = readCache(pathname);
  return <TripCoverSkeleton heroImage={preview.heroImage} />;
}

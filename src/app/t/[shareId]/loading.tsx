'use client';

import { useParams } from 'next/navigation';
import TripCoverSkeleton from '@/components/preview/TripCoverSkeleton';

interface CachedTrip {
  heroImage?: string;
}

function readCache(shareId: string | undefined): CachedTrip {
  if (!shareId || typeof window === 'undefined') return {};
  try {
    const raw = sessionStorage.getItem(`vt-trip-${shareId}`);
    if (!raw) return {};
    return JSON.parse(raw) as CachedTrip;
  } catch {
    return {};
  }
}

/**
 * Loading state shown while /t/[shareId] is server-rendering. Renders the
 * cover-shaped skeleton with the photo the dashboard stashed on click, so
 * both the dashboard's crossfade and the eventual page swap land on the
 * same geometry. See TripCoverSkeleton for the full rationale.
 */
export default function LoadingTripPage() {
  const params = useParams<{ shareId: string }>();
  const trip = readCache(params?.shareId);
  return <TripCoverSkeleton heroImage={trip.heroImage} />;
}

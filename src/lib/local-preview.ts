import { sampleTrips } from './sample-data';
import type { TripData, TripRoutePoint } from './types';

export type LocalPreviewTripRecord = {
  id: string;
  name: string;
  share_id: string;
  data: TripData;
  share_mode: 'private' | 'companion' | 'remix';
  created_at: string;
  updated_at: string;
};

export function isLocalPreviewWithoutSupabase(): boolean {
  return !process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
}

export function localPreviewShareId(index: number): string {
  if (sampleTrips[index]?.trip.name === 'Turkey Road Trip') return 'local-turkey';
  return `local-sample-${index + 1}`;
}

const LOCAL_NEW_YORK_ROUTE_POINTS: TripRoutePoint[] = [
  { label: 'Amsterdam', lat: 52.3676, lng: 4.9041, role: 'home' },
  { label: 'New York JFK', lat: 40.6413, lng: -73.7781, day: 1, mode: 'flight', role: 'stop' },
  { label: 'Midtown Manhattan', lat: 40.758, lng: -73.9855, day: 1, mode: 'route', role: 'stay' },
  { label: 'Brooklyn', lat: 40.7033, lng: -73.9881, day: 3, mode: 'route', role: 'excursion' },
  { label: 'JFK Terminal 4', lat: 40.6413, lng: -73.7781, day: 3, mode: 'car', role: 'return' },
  { label: 'Amsterdam', lat: 52.3676, lng: 4.9041, day: 3, mode: 'flight', role: 'home' },
];

function localPreviewTripData(trip: TripData, index: number): TripData {
  if (index !== 0) return trip;
  return {
    ...trip,
    trip: {
      ...trip.trip,
      route_points: trip.trip.route_points ?? LOCAL_NEW_YORK_ROUTE_POINTS,
    },
  };
}

export function getLocalPreviewTrips(): LocalPreviewTripRecord[] {
  const timestamp = '2026-01-01T12:00:00.000Z';
  return sampleTrips.map((trip, index) => ({
    id: `local-preview-${index + 1}`,
    name: trip.trip.name,
    share_id: localPreviewShareId(index),
    data: localPreviewTripData(trip, index),
    share_mode: 'companion',
    created_at: timestamp,
    updated_at: timestamp,
  }));
}

export function getLocalPreviewTripByShareId(shareId: string): LocalPreviewTripRecord | null {
  return getLocalPreviewTrips().find((trip) => trip.share_id === shareId) ?? null;
}

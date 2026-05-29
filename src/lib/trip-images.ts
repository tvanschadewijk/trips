import type { TripMeta } from './types';

export function getTripOverviewImageUrl(trip: TripMeta): string {
  return trip.overview_image ?? trip.hero_image;
}

export function getTripOgImageUrl(trip: TripMeta): string {
  return getTripOverviewImageUrl(trip);
}

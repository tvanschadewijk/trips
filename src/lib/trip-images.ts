import type { TripMeta } from './types';

export interface TripHeroImageSources {
  mobile: string;
  desktop: string;
}

function assetUrl(trip: TripMeta, key: keyof NonNullable<TripMeta['image_assets']>): string | undefined {
  const value = trip.image_assets?.[key]?.url?.trim();
  return value || undefined;
}

export function getTripMobileCoverImageUrl(trip: TripMeta): string {
  return assetUrl(trip, 'cover_portrait') ?? trip.hero_image;
}

export function getTripDesktopCoverImageUrl(trip: TripMeta): string {
  return (
    assetUrl(trip, 'cover_landscape') ??
    assetUrl(trip, 'cover_portrait') ??
    trip.hero_image
  );
}

export function getTripOverviewImageUrl(trip: TripMeta): string {
  return (
    assetUrl(trip, 'cover_portrait') ??
    trip.overview_image ??
    trip.hero_image
  );
}

export function getTripOgImageUrl(trip: TripMeta): string {
  return (
    assetUrl(trip, 'social_og') ??
    assetUrl(trip, 'cover_landscape') ??
    assetUrl(trip, 'cover_portrait') ??
    trip.hero_image
  );
}

export function getTripHeroImageSources(trip: TripMeta): TripHeroImageSources {
  return {
    mobile: getTripMobileCoverImageUrl(trip),
    desktop: getTripDesktopCoverImageUrl(trip),
  };
}

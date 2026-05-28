import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  getTripDesktopCoverImageUrl,
  getTripHeroImageSources,
  getTripMapImageSources,
  getTripMobileCoverImageUrl,
  getTripOgImageUrl,
  getTripOverviewImageUrl,
} from './trip-images';
import type { TripMeta } from './types';

const baseTrip: TripMeta = {
  name: 'Japan',
  subtitle: 'Temples and trains',
  dates: { start: '2026-05-01', end: '2026-05-08' },
  travelers: [],
  summary: 'A spring rail trip.',
  hero_image: 'https://example.com/default.jpg',
  overview_image: 'https://example.com/overview.jpg',
};

test('trip image helpers fall back to legacy images', () => {
  assert.equal(getTripMobileCoverImageUrl(baseTrip), 'https://example.com/default.jpg');
  assert.equal(getTripDesktopCoverImageUrl(baseTrip), 'https://example.com/default.jpg');
  assert.equal(getTripOverviewImageUrl(baseTrip), 'https://example.com/overview.jpg');
  assert.equal(getTripOgImageUrl(baseTrip), 'https://example.com/default.jpg');
});

test('trip image helpers prefer generated assets by context', () => {
  const trip: TripMeta = {
    ...baseTrip,
    image_assets: {
      cover_portrait: { url: 'https://example.com/portrait.png' },
      cover_landscape: { url: 'https://example.com/landscape.png' },
      social_og: { url: 'https://example.com/og.png' },
    },
  };

  assert.deepEqual(getTripHeroImageSources(trip), {
    mobile: 'https://example.com/portrait.png',
    desktop: 'https://example.com/landscape.png',
  });
  assert.deepEqual(getTripMapImageSources(trip), {
    mobile: 'https://example.com/portrait.png',
    desktop: 'https://example.com/landscape.png',
  });
  assert.equal(getTripOverviewImageUrl(trip), 'https://example.com/overview.jpg');
  assert.equal(getTripOgImageUrl(trip), 'https://example.com/og.png');
});

test('trip overview keeps the inspiring photo separate from generated detail covers', () => {
  const trip: TripMeta = {
    ...baseTrip,
    overview_image: undefined,
    image_assets: {
      cover_portrait: { url: 'https://example.com/map-cover.png' },
    },
  };

  assert.equal(getTripOverviewImageUrl(trip), 'https://example.com/default.jpg');
  assert.deepEqual(getTripMapImageSources(trip), {
    mobile: 'https://example.com/map-cover.png',
    desktop: 'https://example.com/map-cover.png',
  });
  assert.equal(getTripMobileCoverImageUrl(trip), 'https://example.com/map-cover.png');
});

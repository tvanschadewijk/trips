import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
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

test('trip overview image prefers the scenic overview image', () => {
  assert.equal(getTripOverviewImageUrl(baseTrip), 'https://example.com/overview.jpg');
  assert.equal(getTripOgImageUrl(baseTrip), 'https://example.com/overview.jpg');
});

test('trip overview image falls back to the legacy hero image', () => {
  const trip: TripMeta = {
    ...baseTrip,
    overview_image: undefined,
  };

  assert.equal(getTripOverviewImageUrl(trip), 'https://example.com/default.jpg');
  assert.equal(getTripOgImageUrl(trip), 'https://example.com/default.jpg');
});

test('generated map assets are not used for public overview imagery', () => {
  const trip: TripMeta = {
    ...baseTrip,
    overview_image: undefined,
    image_assets: {
      cover_portrait: { url: 'https://example.com/map-cover.png' },
    },
  };

  assert.equal(getTripOverviewImageUrl(trip), 'https://example.com/default.jpg');
  assert.equal(getTripOgImageUrl(trip), 'https://example.com/default.jpg');
});

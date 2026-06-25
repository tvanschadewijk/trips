import { test } from 'node:test';
import assert from 'node:assert/strict';

import { attachTripDetails } from './trip-details';
import type { AccommodationReview, TripData } from './types';

const tripData: TripData = {
  trip: {
    name: 'London by Rail',
    subtitle: 'A compact rail weekend',
    dates: { start: '2026-07-01', end: '2026-07-03' },
    travelers: ['Thijs'],
    summary: 'Train, galleries, and dinner.',
    hero_image: '/hero.jpg',
  },
  days: [],
};

const review: AccommodationReview = {
  tripTitle: 'London by Rail',
  tripSlug: 'london-by-rail',
  generatedAt: '2026-06-26T10:00:00.000Z',
  storageKey: 'ourtrips:accommodation-review:london-by-rail',
  destinations: [],
  accommodations: [
    {
      id: 'stay-1',
      destinationId: 'london',
      stop: 'London',
      lane: 'proposed',
      candidate: 'Town Hall Hotel',
    },
  ],
};

test('attachTripDetails adds accommodation review data to the exported trip payload', () => {
  const result = attachTripDetails(tripData, { accommodation_review: review });

  assert.equal(
    result.trip_details?.accommodation_review?.accommodations[0]?.candidate,
    'Town Hall Hotel'
  );
  assert.equal(tripData.trip_details, undefined);
});

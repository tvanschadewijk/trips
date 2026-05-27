import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  AccommodationReviewConflictError,
  buildInitialAccommodationReview,
  mergeAccommodationReviewWithTripData,
  moveAccommodationCandidate,
  promoteCandidateToTrip,
} from './accommodation-review';
import type { TripData } from './types';

const sampleTrip: TripData = {
  trip: {
    name: 'Turkey',
    subtitle: 'Wine coast and Istanbul',
    dates: { start: '2026-07-12', end: '2026-07-16' },
    travelers: ['T', 'A'],
    summary: 'A compact Turkey route.',
    hero_image: 'https://example.com/turkey.jpg',
  },
  days: [
    {
      day_number: 1,
      date: '2026-07-12',
      title: 'Amsterdam -> Tekirdag',
      blocks: [{ time_label: 'Afternoon', content: 'Arrive and drive west.', type: 'transport' }],
      accommodation: {
        name: 'Tekirdag Vineyard Hotel',
        price: 'EUR 180',
        status: 'pending',
        nights: 2,
        note: 'Check parking before booking.',
        detail: {
          address: 'Wine Road 1',
          parking: 'Private lot listed.',
          dog_note: 'Ask directly.',
          why: 'Good base for the wine coast.',
        },
      },
    },
    {
      day_number: 2,
      date: '2026-07-13',
      title: 'Tekirdag Wine Coast',
      blocks: [{ time_label: 'Morning', content: 'Vineyard loop.', type: 'activity' }],
      accommodation: {
        name: 'Tekirdag Vineyard Hotel',
        price: 'night 2',
        status: 'pending',
        nights: 1,
      },
    },
    {
      day_number: 3,
      date: '2026-07-14',
      title: 'Tekirdag -> Istanbul',
      blocks: [{ time_label: 'Morning', content: 'Drive to Istanbul.', type: 'transport' }],
    },
  ],
};

test('buildInitialAccommodationReview groups consecutive stay nights into one candidate', () => {
  const review = buildInitialAccommodationReview(sampleTrip);

  assert.equal(review.destinations.length, 1);
  assert.equal(review.accommodations.length, 1);
  assert.equal(review.destinations[0].title, 'Tekirdag');
  assert.deepEqual(review.destinations[0].dayNumbers, [1, 2]);
  assert.equal(review.accommodations[0].lane, 'considering');
  assert.equal(review.accommodations[0].candidate, 'Tekirdag Vineyard Hotel');
  assert.equal(review.accommodations[0].parking, 'Private lot listed.');
});

test('moveAccommodationCandidate records a booked event', () => {
  const review = buildInitialAccommodationReview(sampleTrip);
  const candidateId = review.accommodations[0].id;
  const next = moveAccommodationCandidate(review, candidateId, 'booked', 'user', {
    source: 'Direct',
    price: 'EUR 360',
  });

  assert.equal(next.accommodations[0].lane, 'booked');
  assert.equal(next.accommodations[0].booking?.source, 'Direct');
  assert.equal(next.events?.at(-1)?.type, 'candidate_booked');
});

test('moveAccommodationCandidate rejects a second booked stay for one destination', () => {
  const review = buildInitialAccommodationReview(sampleTrip);
  const bookedCandidateId = review.accommodations[0].id;
  const bookedReview = moveAccommodationCandidate(review, bookedCandidateId, 'booked', 'user');
  const secondCandidate = {
    ...bookedReview.accommodations[0],
    id: 'istanbul-second-option',
    candidate: 'Second Istanbul Hotel',
    lane: 'proposed' as const,
    status: 'proposed',
    booking: undefined,
  };
  const reviewWithSecondOption = {
    ...bookedReview,
    accommodations: [...bookedReview.accommodations, secondCandidate],
  };

  assert.throws(
    () =>
      moveAccommodationCandidate(
        reviewWithSecondOption,
        secondCandidate.id,
        'booked',
        'user'
      ),
    (err) =>
      err instanceof AccommodationReviewConflictError &&
      err.existingCandidateId === bookedCandidateId
  );
});

test('mergeAccommodationReviewWithTripData adds new trip stays without moving existing cards', () => {
  const review = buildInitialAccommodationReview(sampleTrip);
  const candidateId = review.accommodations[0].id;
  const dismissedReview = moveAccommodationCandidate(review, candidateId, 'dismissed', 'user');
  const expandedTrip: TripData = {
    ...sampleTrip,
    days: [
      ...sampleTrip.days,
      {
        day_number: 4,
        date: '2026-07-15',
        title: 'Istanbul',
        blocks: [{ time_label: 'Afternoon', content: 'Arrive in Istanbul.', type: 'arrival' }],
        accommodation: {
          name: 'Istanbul Design Hotel',
          status: 'pending',
          nights: 1,
        },
      },
    ],
  };

  const next = mergeAccommodationReviewWithTripData(dismissedReview, expandedTrip);

  assert.equal(next.accommodations.find((item) => item.id === candidateId)?.lane, 'dismissed');
  assert.equal(
    next.accommodations.some((item) => item.candidate === 'Istanbul Design Hotel'),
    true
  );
});

test('promoteCandidateToTrip writes booked stay to matching itinerary days', () => {
  const review = buildInitialAccommodationReview(sampleTrip);
  const candidateId = review.accommodations[0].id;
  const bookedReview = moveAccommodationCandidate(review, candidateId, 'booked', 'user', {
    source: 'Direct',
    confirmation: 'ABC123',
    price: 'EUR 360',
  });
  const nextTrip = promoteCandidateToTrip(sampleTrip, bookedReview, candidateId);

  assert.equal(nextTrip.days[0].accommodation?.status, 'booked');
  assert.equal(nextTrip.days[0].accommodation?.price, 'EUR 360');
  assert.equal(nextTrip.days[0].accommodation?.detail?.confirmation, 'ABC123');
  assert.equal(nextTrip.days[1].accommodation?.name, 'Tekirdag Vineyard Hotel');
  assert.equal(nextTrip.days[2].accommodation, undefined);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  AccommodationReviewConflictError,
  buildInitialAccommodationReview,
  mergeAccommodationReviewWithTripData,
  moveAccommodationCandidate,
  normalizeAccommodationReview,
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

function singleStayTrip(args: {
  dayNumber: number;
  date: string;
  title: string;
  accommodationName: string;
  nights: number;
}): TripData {
  return {
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
        day_number: args.dayNumber,
        date: args.date,
        title: args.title,
        blocks: [{ time_label: 'Afternoon', content: 'Arrive.', type: 'arrival' }],
        accommodation: {
          name: args.accommodationName,
          status: 'pending',
          nights: args.nights,
        },
      },
    ],
  };
}

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

test('buildInitialAccommodationReview orders stay stops by date when days were inserted out of array order', () => {
  const trip: TripData = {
    ...sampleTrip,
    days: [
      {
        day_number: 8,
        date: '2026-07-20',
        title: 'Istanbul',
        blocks: [{ time_label: 'Afternoon', content: 'Arrive.', type: 'arrival' }],
        accommodation: {
          name: 'Istanbul Hotel',
          status: 'pending',
          nights: 1,
        },
      },
      {
        day_number: 3,
        date: '2026-07-14',
        title: 'Xanthi',
        blocks: [{ time_label: 'Afternoon', content: 'Arrive.', type: 'arrival' }],
        accommodation: {
          name: 'Xanthi Guesthouse',
          status: 'booked',
          nights: 1,
        },
      },
      {
        day_number: 4,
        date: '2026-07-15',
        title: 'Edirne',
        blocks: [{ time_label: 'Afternoon', content: 'Arrive.', type: 'arrival' }],
        accommodation: {
          name: 'Edirne Hotel',
          status: 'booked',
          nights: 1,
        },
      },
    ],
  };

  const review = buildInitialAccommodationReview(trip);

  assert.deepEqual(
    review.destinations.map((destination) => destination.title),
    ['Xanthi', 'Edirne', 'Istanbul']
  );
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

test('moveAccommodationCandidate clears booking metadata when moved back to proposals', () => {
  const review = buildInitialAccommodationReview(sampleTrip);
  const candidateId = review.accommodations[0].id;
  const bookedReview = moveAccommodationCandidate(review, candidateId, 'booked', 'user', {
    source: 'Direct',
    confirmation: 'ABC123',
  });
  const proposedReview = moveAccommodationCandidate(
    bookedReview,
    candidateId,
    'proposed',
    'user'
  );

  assert.equal(proposedReview.accommodations[0].lane, 'proposed');
  assert.equal(proposedReview.accommodations[0].status, 'proposed');
  assert.equal(proposedReview.accommodations[0].booking, undefined);
  assert.equal(proposedReview.events?.at(-1)?.type, 'candidate_moved');
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

test('buildInitialAccommodationReview groups overlapping same-stop candidates into one destination', () => {
  const trip: TripData = {
    ...sampleTrip,
    days: [
      {
        day_number: 24,
        date: '2026-07-20',
        title: 'Tekirdag Wine Coast -> Istanbul',
        blocks: [{ time_label: 'Morning', content: 'Drive to Istanbul.', type: 'transport' }],
        accommodation: {
          name: 'Outer-Istanbul / Ecole St. Pierre fallback search',
          status: 'pending',
          nights: 3,
        },
      },
      {
        day_number: 25,
        date: '2026-07-21',
        title: 'Istanbul',
        blocks: [{ time_label: 'Morning', content: 'Sultanahmet.', type: 'activity' }],
        accommodation: {
          name: 'The Stay Bosphorus',
          nights: 3,
        },
      },
      {
        day_number: 26,
        date: '2026-07-22',
        title: 'Istanbul / Stan Flight',
        blocks: [{ time_label: 'Morning', content: 'Ferry as activity.', type: 'activity' }],
        accommodation: {
          name: 'The Stay Bosphorus',
          nights: 3,
        },
      },
      {
        day_number: 27,
        date: '2026-07-23',
        title: 'Istanbul -> Kavala',
        blocks: [{ time_label: 'Morning', content: 'Drive to Kavala.', type: 'transport' }],
        accommodation: {
          name: 'Kavala border-recovery hotel',
          status: 'pending',
          nights: 2,
        },
      },
    ],
  };

  const review = buildInitialAccommodationReview(trip);
  const istanbulDestinations = review.destinations.filter(
    (destination) => destination.title === 'Istanbul'
  );
  const istanbulCandidates = review.accommodations.filter(
    (candidate) => candidate.stop === 'Istanbul'
  );

  assert.equal(istanbulDestinations.length, 1);
  assert.deepEqual(istanbulDestinations[0].dayNumbers, [24, 25, 26]);
  assert.equal(istanbulCandidates.length, 2);
  assert.deepEqual(
    istanbulCandidates.map((candidate) => candidate.destinationId),
    [istanbulDestinations[0].id, istanbulDestinations[0].id]
  );
  assert.deepEqual(
    istanbulCandidates.map((candidate) => candidate.dayNumbers),
    [
      [24, 25, 26],
      [24, 25, 26],
    ]
  );
  assert.deepEqual(
    istanbulCandidates.map((candidate) => candidate.candidate).sort(),
    ['Outer-Istanbul / Ecole St. Pierre fallback search', 'The Stay Bosphorus']
  );
});

test('mergeAccommodationReviewWithTripData promotes itinerary-booked stays on existing cards', () => {
  const review = buildInitialAccommodationReview(sampleTrip);
  const staleCandidateId = review.accommodations[0].id;
  const bookedTrip: TripData = {
    ...sampleTrip,
    days: sampleTrip.days.map((day) =>
      day.accommodation?.name === 'Tekirdag Vineyard Hotel'
        ? {
            ...day,
            accommodation: {
              ...day.accommodation,
              status: 'booked',
              price: 'EUR 360',
              note: 'Confirmed direct.',
              detail: {
                ...day.accommodation.detail,
                confirmation: 'DIRECT-42',
                booking_platform: 'Direct',
              },
            },
          }
        : day
    ),
  };

  const next = mergeAccommodationReviewWithTripData(review, bookedTrip);
  const syncedCandidate = next.accommodations.find((item) => item.id === staleCandidateId);

  assert.equal(syncedCandidate?.lane, 'booked');
  assert.equal(syncedCandidate?.status, 'booked');
  assert.equal(syncedCandidate?.booking?.confirmation, 'DIRECT-42');
  assert.equal(syncedCandidate?.booking?.source, 'Direct');
});

test('normalizeAccommodationReview treats booked status as the booked lane', () => {
  const review = normalizeAccommodationReview(
    {
      tripTitle: 'Turkey',
      tripSlug: 'turkey',
      generatedAt: '2026-01-01T00:00:00.000Z',
      storageKey: 'legacy',
      destinations: [
        {
          id: 'legacy-tekirdag',
          title: 'Tekirdag',
          dayNumbers: [1, 2],
        },
      ],
      accommodations: [
        {
          id: 'legacy-tekirdag-hotel',
          destinationId: 'legacy-tekirdag',
          stop: 'Tekirdag',
          lane: 'considering',
          status: 'booked',
          candidate: 'Tekirdag Vineyard Hotel',
          dayNumbers: [1, 2],
        },
      ],
    },
    sampleTrip
  );

  assert.equal(review.accommodations[0].lane, 'booked');
});

test('mergeAccommodationReviewWithTripData keeps booked imports on matching legacy destinations', () => {
  const legacyReview = {
    tripTitle: 'Turkey',
    tripSlug: 'turkey',
    generatedAt: '2026-01-01T00:00:00.000Z',
    storageKey: 'legacy',
    destinations: [
      {
        id: 'legacy-tekirdag',
        title: 'Tekirdag',
        dates: '12 Jul-14 Jul',
        nights: 2,
        dayNumbers: [1, 2],
      },
    ],
    accommodations: [
      {
        id: 'legacy-tekirdag-hotel',
        destinationId: 'legacy-tekirdag',
        stop: 'Tekirdag',
        lane: 'considering' as const,
        status: 'pending',
        candidate: 'Tekirdag Vineyard Hotel',
        dayNumbers: [1, 2],
      },
    ],
  };
  const bookedTrip: TripData = {
    ...sampleTrip,
    days: sampleTrip.days.map((day) =>
      day.accommodation?.name === 'Tekirdag Vineyard Hotel'
        ? {
            ...day,
            accommodation: {
              ...day.accommodation,
              status: 'booked',
            },
          }
        : day
    ),
  };

  const next = mergeAccommodationReviewWithTripData(legacyReview, bookedTrip);
  const candidate = next.accommodations.find((item) => item.id === 'legacy-tekirdag-hotel');

  assert.equal(next.destinations.some((destination) => destination.id === '1-tekirdag'), false);
  assert.equal(candidate?.destinationId, 'legacy-tekirdag');
  assert.equal(candidate?.lane, 'booked');
});

test('mergeAccommodationReviewWithTripData repairs stale persisted destination order', () => {
  const trip: TripData = {
    ...sampleTrip,
    days: [
      {
        day_number: 1,
        date: '2026-07-12',
        title: 'Tekirdag Wine Coast',
        blocks: [{ time_label: 'Afternoon', content: 'Arrive.', type: 'arrival' }],
        accommodation: {
          name: 'Tekirdag Vineyard Hotel',
          status: 'booked',
          nights: 2,
        },
      },
      {
        day_number: 3,
        date: '2026-07-14',
        title: 'Xanthi',
        blocks: [{ time_label: 'Afternoon', content: 'Arrive.', type: 'arrival' }],
        accommodation: {
          name: 'Xanthi Guesthouse',
          status: 'booked',
          nights: 1,
        },
      },
      {
        day_number: 4,
        date: '2026-07-15',
        title: 'Edirne',
        blocks: [{ time_label: 'Afternoon', content: 'Arrive.', type: 'arrival' }],
        accommodation: {
          name: 'Edirne Hotel',
          status: 'booked',
          nights: 2,
        },
      },
      {
        day_number: 8,
        date: '2026-07-20',
        title: 'Istanbul',
        blocks: [{ time_label: 'Afternoon', content: 'Arrive.', type: 'arrival' }],
        accommodation: {
          name: 'Istanbul Hotel',
          status: 'pending',
          nights: 3,
        },
      },
    ],
  };
  const review = buildInitialAccommodationReview(trip);
  const staleReview = {
    ...review,
    destinations: [
      review.destinations[0],
      review.destinations[3],
      review.destinations[1],
      review.destinations[2],
    ],
  };

  const next = mergeAccommodationReviewWithTripData(staleReview, trip);

  assert.deepEqual(
    next.destinations.map((destination) => destination.title),
    ['Tekirdag Wine Coast', 'Xanthi', 'Edirne', 'Istanbul']
  );
});

test('mergeAccommodationReviewWithTripData updates a shifted imported stop instead of duplicating it', () => {
  const oldTrip = singleStayTrip({
    dayNumber: 7,
    date: '2026-07-13',
    title: 'Kavala',
    accommodationName: 'Kavala City Hotel',
    nights: 2,
  });
  const currentTrip = singleStayTrip({
    dayNumber: 6,
    date: '2026-07-12',
    title: 'Kavala',
    accommodationName: 'Kavala City Hotel',
    nights: 2,
  });
  const review = buildInitialAccommodationReview(oldTrip);
  review.accommodations[0].lane = 'dismissed';
  review.accommodations[0].status = 'dismissed';

  const next = mergeAccommodationReviewWithTripData(review, currentTrip);

  assert.equal(next.destinations.length, 1);
  assert.equal(next.accommodations.length, 1);
  assert.equal(next.destinations[0].title, 'Kavala');
  assert.equal(next.destinations[0].dates, '12 Jul-14 Jul');
  assert.deepEqual(next.destinations[0].dayNumbers, [6]);
  assert.equal(next.accommodations[0].candidate, 'Kavala City Hotel');
  assert.equal(next.accommodations[0].lane, 'dismissed');
  assert.equal(next.accommodations[0].dates, '12 Jul-14 Jul');
  assert.deepEqual(next.accommodations[0].dayNumbers, [6]);
});

test('mergeAccommodationReviewWithTripData prunes stale imported duplicates but preserves manual options', () => {
  const oldTrip = singleStayTrip({
    dayNumber: 7,
    date: '2026-07-13',
    title: 'Kavala',
    accommodationName: 'Kavala City Hotel',
    nights: 2,
  });
  const currentTrip = singleStayTrip({
    dayNumber: 6,
    date: '2026-07-12',
    title: 'Kavala',
    accommodationName: 'Kavala City Hotel',
    nights: 2,
  });
  const oldReview = buildInitialAccommodationReview(oldTrip);
  const currentReview = buildInitialAccommodationReview(currentTrip);
  const manualCandidate = {
    ...oldReview.accommodations[0],
    id: 'manual-kavala-option',
    candidate: 'Manual Kavala Inn',
    lane: 'proposed' as const,
    status: 'proposed',
    createdBy: 'user' as const,
  };
  const duplicatedReview = {
    ...currentReview,
    destinations: [...oldReview.destinations, ...currentReview.destinations],
    accommodations: [
      ...oldReview.accommodations,
      manualCandidate,
      ...currentReview.accommodations,
    ],
  };

  const next = mergeAccommodationReviewWithTripData(duplicatedReview, currentTrip);

  assert.equal(next.destinations.length, 1);
  assert.equal(
    next.accommodations.filter((candidate) => candidate.candidate === 'Kavala City Hotel').length,
    1
  );
  const manual = next.accommodations.find((candidate) => candidate.id === manualCandidate.id);
  assert.equal(manual?.candidate, 'Manual Kavala Inn');
  assert.equal(manual?.destinationId, next.destinations[0].id);
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

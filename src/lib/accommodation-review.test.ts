import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  AccommodationReviewConflictError,
  addAccommodationCandidate,
  buildInitialAccommodationReview,
  mergeAccommodationReviewWithTripData,
  moveAccommodationCandidate,
  normalizeAccommodationReview,
  promoteCandidateToTrip,
  replaceBookedAccommodationCandidate,
  updateAccommodationCandidate,
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

test('buildInitialAccommodationReview treats booking evidence in stay notes as booked', () => {
  const trip = singleStayTrip({
    dayNumber: 5,
    date: '2026-07-01',
    title: 'Ravenna -> Gargano / Peschici',
    accommodationName: 'Vila SEJUDA Alberghetto',
    nights: 2,
  });
  trip.days[0].accommodation = {
    ...trip.days[0].accommodation!,
    status: undefined,
    booking_status: undefined,
    note: 'Booked via Booking.com for 1-3 Jul after cancelling Masseria Procacci; no accommodation action remains.',
  };

  const review = buildInitialAccommodationReview(trip);
  const candidate = review.accommodations[0];

  assert.equal(candidate.lane, 'booked');
  assert.equal(candidate.status, 'booked');
  assert.equal(candidate.booking?.note, trip.days[0].accommodation.note);
});

test('buildInitialAccommodationReview keeps not-booked stay notes as proposals', () => {
  const trip = singleStayTrip({
    dayNumber: 33,
    date: '2026-07-29',
    title: 'Lake Bled',
    accommodationName: 'Hotel Triglav Bled',
    nights: 2,
  });
  trip.days[0].accommodation = {
    ...trip.days[0].accommodation!,
    status: undefined,
    booking_status: undefined,
    note: 'Recommended: historic lake-view hotel with pool/sauna; dogs EUR 20/night. Not booked yet.',
  };

  const review = buildInitialAccommodationReview(trip);
  const candidate = review.accommodations[0];

  assert.equal(candidate.lane, 'considering');
  assert.equal(candidate.status, undefined);
  assert.equal(candidate.booking, undefined);
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

test('accommodation candidates inherit logistics from their destination', () => {
  const review = buildInitialAccommodationReview(sampleTrip);
  const destination = review.destinations[0];
  const withCandidate = addAccommodationCandidate(
    review,
    {
      destinationId: destination.id,
      stop: 'Wrong stop',
      dates: 'wrong dates',
      nights: 99,
      lane: 'proposed',
      candidate: 'Second Tekirdag Hotel',
      directWebsite: { label: 'Official website', url: 'https://example.com' },
      ratings: [
        {
          checkedAt: '2026-06-08',
          bookingCom: '8.4',
          tripadvisor: '4.1',
          google: '4.3',
        },
      ],
      dayNumbers: [99],
      checkInDate: '2026-01-01',
      checkOutDate: '2026-01-02',
    },
    'agent'
  );
  const candidate = withCandidate.accommodations.at(-1);

  assert.equal(candidate?.stop, destination.title);
  assert.equal(candidate?.dates, destination.dates);
  assert.equal(candidate?.nights, destination.nights);
  assert.deepEqual(candidate?.dayNumbers, destination.dayNumbers);
  assert.equal(candidate?.checkInDate, destination.startDate);
  assert.equal(candidate?.checkOutDate, destination.endDate);

  const updated = updateAccommodationCandidate(
    withCandidate,
    candidate?.id ?? '',
    { nights: 77, dayNumbers: [77], checkInDate: '2026-02-01' },
    'agent'
  );
  const updatedCandidate = updated.accommodations.find((item) => item.id === candidate?.id);

  assert.equal(updatedCandidate?.nights, destination.nights);
  assert.deepEqual(updatedCandidate?.dayNumbers, destination.dayNumbers);
  assert.equal(updatedCandidate?.checkInDate, destination.startDate);
});

test('replaceBookedAccommodationCandidate swaps the destination hotel in one action', () => {
  const review = buildInitialAccommodationReview(sampleTrip);
  const bookedCandidateId = review.accommodations[0].id;
  const bookedReview = moveAccommodationCandidate(review, bookedCandidateId, 'booked', 'user', {
    source: 'Direct',
    confirmation: 'ABC123',
  });
  const secondCandidate = {
    ...bookedReview.accommodations[0],
    id: 'tekirdag-second-option',
    candidate: 'Second Tekirdag Hotel',
    lane: 'proposed' as const,
    status: 'proposed',
    booking: undefined,
  };
  const reviewWithSecondOption = {
    ...bookedReview,
    accommodations: [...bookedReview.accommodations, secondCandidate],
  };

  const next = replaceBookedAccommodationCandidate(
    reviewWithSecondOption,
    secondCandidate.id,
    'user',
    { source: 'Booking.com' }
  );
  const previous = next.accommodations.find((candidate) => candidate.id === bookedCandidateId);
  const replacement = next.accommodations.find((candidate) => candidate.id === secondCandidate.id);

  assert.equal(previous?.lane, 'proposed');
  assert.equal(previous?.status, 'proposed');
  assert.equal(previous?.booking, undefined);
  assert.equal(replacement?.lane, 'booked');
  assert.equal(replacement?.booking?.source, 'Booking.com');
  assert.equal(next.events?.at(-2)?.type, 'candidate_moved');
  assert.equal(next.events?.at(-1)?.type, 'candidate_booked');
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

test('mergeAccommodationReviewWithTripData refreshes existing cards with richer stay evidence', () => {
  const baseTrip = singleStayTrip({
    dayNumber: 6,
    date: '2026-07-12',
    title: 'Kavala',
    accommodationName: 'Kavala City Hotel',
    nights: 2,
  });
  const review = buildInitialAccommodationReview(baseTrip);
  const candidateId = review.accommodations[0].id;
  const richTrip: TripData = {
    ...baseTrip,
    days: baseTrip.days.map((day) => ({
      ...day,
      accommodation: day.accommodation
        ? {
            ...day.accommodation,
            price: 'EUR 240',
            rating: 'Google 4.7/5',
            note: 'Ask for the quieter courtyard room.',
            detail: {
              address: 'Harbour Street 1',
              room_type: 'Double room with balcony',
              check_in: 'After 15:00',
              check_out: 'By 11:00',
              phone: '+30 123 456 789',
              direct_website_url: 'https://kavala.example',
              direct_website_label: 'Official hotel site',
              wifi: 'Included',
              parking: 'Garage nearby.',
              dog_note: 'Dogs accepted with advance notice.',
              cancellation_deadline: 'Refundable until 7 days before arrival.',
              policy_source_url: 'https://hotel.example/pets',
              policy_source_label: 'Hotel pet policy',
              policy_confidence: 'high',
              why: 'Central without being on the loudest waterfront block.',
              practical: 'Small rooms; balcony category matters.',
              note: 'Near the ferry.',
            },
          }
        : day.accommodation,
    })),
  };

  const next = mergeAccommodationReviewWithTripData(review, richTrip);
  const candidate = next.accommodations.find((item) => item.id === candidateId);

  assert.equal(candidate?.price, 'EUR 240');
  assert.equal(candidate?.ratings?.[0]?.google, 'Google 4.7/5');
  assert.equal(candidate?.roomType, 'Double room with balcony');
  assert.equal(candidate?.checkIn, 'After 15:00');
  assert.equal(candidate?.phone, '+30 123 456 789');
  assert.deepEqual(candidate?.directWebsite, {
    label: 'Official hotel site',
    url: 'https://kavala.example',
  });
  assert.equal(candidate?.wifi, 'Included');
  assert.equal(candidate?.terms, 'Refundable until 7 days before arrival.');
  assert.equal(candidate?.policySource?.url, 'https://hotel.example/pets');
  assert.equal(candidate?.links?.some((link) => link.url === 'https://hotel.example/pets'), true);
  assert.equal(candidate?.hotelNote, 'Near the ferry.');
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
  review.accommodations[0] = {
    ...review.accommodations[0],
    roomType: 'Vineyard suite',
    checkIn: 'After 15:00',
    checkOut: 'By 11:00',
    phone: '+90 123 456 789',
    wifi: 'Included',
    policySource: {
      label: 'Hotel policy',
      url: 'https://hotel.example/policy',
    },
    directWebsite: {
      label: 'Official hotel site',
      url: 'https://hotel.example',
    },
    policyConfidence: 'medium',
    hotelNote: 'Quiet garden side preferred.',
  };
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
  assert.equal(nextTrip.days[0].accommodation?.detail?.room_type, 'Vineyard suite');
  assert.equal(nextTrip.days[0].accommodation?.detail?.check_in, 'After 15:00');
  assert.equal(nextTrip.days[0].accommodation?.detail?.phone, '+90 123 456 789');
  assert.equal(
    nextTrip.days[0].accommodation?.detail?.direct_website_url,
    'https://hotel.example'
  );
  assert.equal(
    nextTrip.days[0].accommodation?.detail?.direct_website_label,
    'Official hotel site'
  );
  assert.equal(nextTrip.days[0].accommodation?.detail?.wifi, 'Included');
  assert.equal(
    nextTrip.days[0].accommodation?.detail?.policy_source_url,
    'https://hotel.example/policy'
  );
  assert.equal(nextTrip.days[0].accommodation?.detail?.note, 'Quiet garden side preferred.');
});

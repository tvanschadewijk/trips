import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildTripLogisticsLedger } from './trip-logistics-ledger';

test('buildTripLogisticsLedger answers trip dates and stays from canonical trip data', () => {
  const ledger = buildTripLogisticsLedger({
    trip: {
      name: 'Scotland loop',
      subtitle: 'A rail and road loop',
      dates: { start: '2026-07-03', end: '2026-07-07' },
      travelers: ['Thijs'],
      summary: 'Glasgow, Fort William, and Skye.',
      hero_image: '/hero.jpg',
    },
    days: [
      {
        day_number: 1,
        date: '2026-07-03',
        title: 'Arrive in Glasgow',
        accommodation: {
          name: 'Grasshopper Hotel Glasgow',
          booking_status: 'booked',
          nights: 2,
        },
        transport: [
          {
            mode: 'train',
            label: 'Airport rail link',
            from: 'Glasgow Airport',
            to: 'Glasgow Queen Street',
          },
        ],
      },
      {
        day_number: 2,
        date: '2026-07-04',
        title: 'Glasgow',
        accommodation: {
          name: 'Grasshopper Hotel Glasgow',
          booking_status: 'booked',
          nights: 2,
        },
      },
      {
        day_number: 3,
        date: '2026-07-05',
        title: 'To Fort William',
        accommodation: {
          name: 'Lime Tree Hotel',
          booking_status: 'pending',
          nights: 2,
        },
      },
      {
        day_number: 4,
        date: '2026-07-06',
        title: 'Glen Nevis',
        accommodation: {
          name: 'Lime Tree Hotel',
          booking_status: 'pending',
          nights: 2,
        },
      },
      {
        day_number: 5,
        date: '2026-07-07',
        title: 'Depart',
      },
    ],
  });

  assert.equal(ledger.status, 'ok');
  assert.equal(ledger.direct_answers.trip_starts_on, '2026-07-03');
  assert.equal(ledger.direct_answers.trip_ends_on, '2026-07-07');
  assert.equal(ledger.direct_answers.itinerary_day_count, 5);
  assert.equal(ledger.direct_answers.expected_itinerary_day_count, 5);
  assert.equal(ledger.direct_answers.scheduled_sleep_count, 4);
  assert.deepEqual(
    ledger.direct_answers.stays.map((stay) => ({
      stay_name: stay.stay_name,
      check_in: stay.check_in,
      check_out: stay.check_out,
      nights: stay.nights,
      days: stay.days,
    })),
    [
      {
        stay_name: 'Grasshopper Hotel Glasgow',
        check_in: '2026-07-03',
        check_out: '2026-07-05',
        nights: 2,
        days: 'Days 1-2',
      },
      {
        stay_name: 'Lime Tree Hotel',
        check_in: '2026-07-05',
        check_out: '2026-07-07',
        nights: 2,
        days: 'Days 3-4',
      },
    ]
  );
  assert.equal(ledger.day_ledger[4].sleep_location, null);
});

test('buildTripLogisticsLedger surfaces date contradictions as needs_repair', () => {
  const ledger = buildTripLogisticsLedger({
    trip: {
      name: 'Broken dates',
      subtitle: 'Mismatch',
      dates: { start: '2026-07-03', end: '2026-07-05' },
      travelers: [],
      summary: '',
      hero_image: '',
    },
    days: [
      {
        day_number: 1,
        date: '2026-07-03',
        title: 'Only day',
      },
    ],
  });

  assert.equal(ledger.status, 'needs_repair');
  assert.equal(ledger.validation.error_count, 1);
  assert.match(ledger.validation.errors[0], /require 3 calendar days/);
  assert.equal(ledger.direct_answers.expected_itinerary_day_count, 3);
  assert.equal(ledger.direct_answers.itinerary_day_count, 1);
});

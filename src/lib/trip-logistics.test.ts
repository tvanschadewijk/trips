import { test } from 'node:test';
import assert from 'node:assert/strict';

import { auditTripLogistics } from './trip-logistics';
import type { TripData } from './types';

function validTrip(): TripData {
  return {
    trip: {
      name: 'Logistics Trip',
      subtitle: 'A small exact-date itinerary',
      dates: { start: '2026-09-01', end: '2026-09-03' },
      travelers: ['T'],
      summary: 'Three calendar days, two hotel sleeps, and one train.',
      hero_image: 'https://example.com/hero.jpg',
    },
    days: [
      {
        day_number: 1,
        date: '2026-09-01',
        title: 'Arrival',
        accommodation: {
          name: 'Example Hotel',
          status: 'booked',
          nights: 2,
        },
        transport: [
          {
            mode: 'train',
            label: 'Amsterdam to Paris',
            from: 'Amsterdam Centraal',
            to: 'Paris Gare du Nord',
            depart: '09:00',
            arrive: '12:30',
            booking_status: 'booked',
          },
        ],
      },
      {
        day_number: 2,
        date: '2026-09-02',
        title: 'Paris',
        accommodation: {
          name: 'Example Hotel',
          status: 'booked',
          nights: 2,
        },
      },
      {
        day_number: 3,
        date: '2026-09-03',
        title: 'Departure',
      },
    ],
  };
}

test('builds a logistics ledger for exact dates, sleeps, and transport legs', () => {
  const audit = auditTripLogistics(validTrip());

  assert.deepEqual(audit.errors, []);
  assert.equal(audit.ledger.dateRange.expectedDayCount, 3);
  assert.equal(audit.ledger.staySegments[0].nights, 2);
  assert.equal(audit.ledger.staySegments[0].sleepCount, 2);
  assert.equal(audit.ledger.staySegments[0].checkInDate, '2026-09-01');
  assert.equal(audit.ledger.staySegments[0].checkOutDate, '2026-09-03');
  assert.equal(audit.ledger.transportRequirements[0].from, 'Amsterdam Centraal');
  assert.match(audit.ledger.glossary.sleep, /check-in date inclusive/);
});

test('reports hard errors for impossible dates and day count mismatches', () => {
  const trip = validTrip();
  trip.trip.dates.end = '2026-09-31';
  trip.days[1].date = '2026-09-04';

  const audit = auditTripLogistics(trip);

  assert.ok(audit.issues.some((issue) => issue.code === 'invalid_iso_date'));
  assert.ok(audit.issues.some((issue) => issue.code === 'day_date_sequence_mismatch'));
});

test('reports a hard error when hotel sleeps do not match contiguous accommodation days', () => {
  const trip = validTrip();
  trip.days[1].accommodation = undefined;

  const audit = auditTripLogistics(trip);

  assert.ok(audit.issues.some((issue) => issue.code === 'stay_sleep_count_mismatch'));
});

test('reports a hard error when repeated stay cards disagree on nights', () => {
  const trip = validTrip();
  if (trip.days[1].accommodation) trip.days[1].accommodation.nights = 1;

  const audit = auditTripLogistics(trip);

  assert.ok(audit.issues.some((issue) => issue.code === 'stay_segment_nights_inconsistent'));
});

test('reports a hard error when a required transport leg lacks route endpoints', () => {
  const trip = validTrip();
  delete trip.days[0].transport?.[0].to;

  const audit = auditTripLogistics(trip);

  assert.ok(audit.issues.some((issue) => issue.code === 'transport_route_missing'));
});

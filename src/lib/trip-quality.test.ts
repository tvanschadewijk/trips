import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  OURTRIPS_TRIP_SCHEMA_VERSION,
  normalizeTripForQualityContract,
  validateItineraryQuality,
} from './trip-quality';
import type { TripData } from './types';

function legacyTrip(): TripData {
  return {
    trip: {
      name: 'Legacy Turkey',
      subtitle: 'Old sparse trip',
      dates: { start: '2026-09-01', end: '2026-09-02' },
      travelers: ['Thijs'],
      summary: 'A legacy itinerary with broad time labels.',
      hero_image: 'https://example.com/turkey.jpg',
    },
    days: [
      {
        day_number: 1,
        date: '2026-09-01',
        title: 'Istanbul arrival',
        blocks: [
          { time_label: 'Morning', content: 'Arrive and settle in.', type: 'activity' },
        ],
        accommodation: {
          name: 'Hotel not confirmed yet',
          status: 'open',
        },
      },
    ],
  };
}

test('normalizes legacy trips into the v2 quality contract without requiring a migration', () => {
  const normalized = normalizeTripForQualityContract(legacyTrip());
  assert.equal(normalized.trip_schema_version, OURTRIPS_TRIP_SCHEMA_VERSION);
  assert.equal(normalized.days[0].blocks?.[0].time_precision, 'window');
  assert.equal(normalized.days[0].accommodation?.booking_status, 'open');
  assert.equal(normalized.days[0].day_type, 'arrival');
});

test('quality validation reports sparse legacy days as warnings, not hard errors', () => {
  const report = validateItineraryQuality(legacyTrip());
  assert.equal(report.errors.length, 0);
  assert.ok(report.warnings.some((warning) => warning.includes('programme')));
  assert.ok(report.warnings.some((warning) => warning.includes('description_title')));
  assert.equal(report.summary.open_action_count, 1);
});

test('quality validation rejects an empty v2 itinerary only as a hard error', () => {
  const report = validateItineraryQuality({
    trip: legacyTrip().trip,
    days: [],
  });
  assert.deepEqual(report.errors, ['A v2 OurTrips itinerary must include at least one day.']);
});

test('normalization distinguishes fixed booked times from suggested AI times', () => {
  const data = legacyTrip();
  data.days[0].blocks = [
    { time_label: '09:00', content: 'Timed museum entry.', type: 'activity', booking_status: 'booked' },
    { time_label: '11:00', content: 'Coffee nearby.', type: 'activity' },
  ];

  const normalized = normalizeTripForQualityContract(data);
  assert.equal(normalized.days[0].blocks?.[0].starts_at, '09:00');
  assert.equal(normalized.days[0].blocks?.[0].time_precision, 'fixed');
  assert.equal(normalized.days[0].blocks?.[1].starts_at, '11:00');
  assert.equal(normalized.days[0].blocks?.[1].time_precision, 'suggested');
});

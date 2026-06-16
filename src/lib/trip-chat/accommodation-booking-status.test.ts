import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { TripData } from '@/lib/types';
import { _internal } from './tools';

const { applyAccommodationPatch } = _internal;

const sampleTrip: TripData = {
  trip: {
    name: 'Serbia',
    subtitle: 'Danube stopover',
    dates: { start: '2026-07-26', end: '2026-07-27' },
    travelers: ['T', 'A'],
    summary: 'One night in Novi Sad.',
  },
  days: [
    {
      day_number: 1,
      date: '2026-07-26',
      title: 'Novi Sad',
      accommodation: {
        name: 'Hotel not confirmed yet',
        status: 'open',
      },
    },
  ],
};

test('applyAccommodationPatch mirrors booked status into booking_status', () => {
  const result = applyAccommodationPatch(
    sampleTrip,
    'days[0].accommodation',
    { name: 'Hotel Pupin', status: 'booked' },
    'path_only'
  );

  assert.equal(result.ok, true);
  if (!result.ok) return;

  assert.equal(result.next.days[0].accommodation?.name, 'Hotel Pupin');
  assert.equal(result.next.days[0].accommodation?.status, 'booked');
  assert.equal(result.next.days[0].accommodation?.booking_status, 'booked');
});

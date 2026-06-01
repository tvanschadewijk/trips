import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildTripRouteAtlas } from './trip-route';
import { buildDayMapDataByNumber } from './day-map';
import type { TripData } from './types';

function baseTrip(days: TripData['days']): TripData {
  return {
    trip: {
      name: 'Day map test',
      subtitle: 'POI sequencing',
      dates: { start: '2026-06-30', end: '2026-07-02' },
      travelers: [],
      summary: 'A route with hotels, restaurants, and day places.',
      hero_image: 'https://example.com/hero.jpg',
    },
    days,
  };
}

test('day map targets preserve the day order and skip generic meal descriptions', () => {
  const trip = baseTrip([
    {
      day_number: 1,
      date: '2026-06-30',
      title: 'Amsterdam -> Ravenna',
      blocks: [],
      transport: [{ mode: 'car', label: 'Self-drive', from: 'Amsterdam', to: 'Ravenna' }],
      accommodation: {
        name: 'Palazzo Ravenna',
        detail: { address: 'Ravenna, Italy' },
      },
    },
    {
      day_number: 2,
      date: '2026-07-01',
      title: 'Ravenna -> Peschici',
      blocks: [
        {
          time_label: 'Afternoon',
          type: 'activity',
          content: 'Museo delle Culture',
        },
      ],
      transport: [{ mode: 'car', label: 'Self-drive - Ravenna -> Peschici', from: 'Ravenna', to: 'Peschici' }],
      accommodation: {
        name: 'Vila SEJUDA Alberghetto',
        detail: { address: 'Peschici, Italy' },
      },
      meals: [
        { type: 'dinner', name: 'Casual trabucco-style seafood' },
        { type: 'dinner', name: 'Trattoria da Maria' },
      ],
    },
  ]);

  const atlas = buildTripRouteAtlas(trip);
  const dayMapData = buildDayMapDataByNumber(atlas, trip.days)[2];
  const targets = dayMapData.searchTargets;

  assert.deepEqual(
    targets.map((target) => target.label),
    [
      'Palazzo Ravenna',
      'Peschici',
      'Vila SEJUDA Alberghetto',
      'Museo delle Culture',
      'Trattoria da Maria',
    ]
  );
  assert.equal(targets.find((target) => target.label === 'Peschici')?.fallbackPoint?.lat, 41.946);
  assert.equal(targets.find((target) => target.label === 'Vila SEJUDA Alberghetto')?.placeType, 'lodging');
  assert.equal(targets.find((target) => target.label === 'Trattoria da Maria')?.placeType, 'restaurant');
});

test('day map targets can be built even when no route atlas exists', () => {
  const trip = baseTrip([
    {
      day_number: 1,
      date: '2026-07-01',
      title: 'A city day',
      blocks: [],
      accommodation: {
        name: 'Hotel Example',
        detail: { address: '10 Example Street, Lisbon' },
      },
      meals: [
        {
          type: 'lunch',
          name: 'Osteria Example',
          detail: { address: '12 Example Street, Lisbon' },
        },
      ],
    },
  ]);

  const dayMapData = buildDayMapDataByNumber(undefined, trip.days)[1];

  assert.equal(dayMapData.atlas, undefined);
  assert.deepEqual(dayMapData.searchTargets.map((target) => target.label), ['Hotel Example', 'Osteria Example']);
});

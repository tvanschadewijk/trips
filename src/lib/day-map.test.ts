import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildTripRouteAtlas } from './trip-route';
import { buildDayMapDataByNumber, mapPointDetailsForTrip } from './day-map';
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
  assert.deepEqual(dayMapData.atlas?.points.map((point) => point.label), targets.map((target) => target.label));
  assert.equal(targets.every((target) => Boolean(target.fallbackPoint)), true);
  assert.equal(targets.some((target) => target.label === 'Ravenna'), false);
  assert.equal(targets.find((target) => target.label === 'Peschici')?.fallbackPoint?.lat, 41.946);
  assert.equal(targets.find((target) => target.label === 'Vila SEJUDA Alberghetto')?.placeType, 'lodging');
  assert.equal(targets.find((target) => target.label === 'Trattoria da Maria')?.placeType, 'restaurant');
});

test('day map route places are anchored to known atlas coordinates before text search', () => {
  const trip = baseTrip([
    {
      day_number: 1,
      date: '2026-06-30',
      title: 'Lake Como -> Ravenna',
      blocks: [],
      transport: [{ mode: 'car', label: 'Self-drive', from: 'Lake Como', to: 'Ravenna' }],
    },
  ]);

  const atlas = buildTripRouteAtlas(trip);
  const targets = buildDayMapDataByNumber(atlas, trip.days)[1].searchTargets;
  const ravennaTarget = targets.find((target) => target.label === 'Ravenna');

  assert.equal(ravennaTarget?.kind, 'place');
  assert.equal(ravennaTarget?.fallbackPoint?.lat, 44.4184);
  assert.equal(ravennaTarget?.fallbackPoint?.lng, 12.2035);
});

test('trip map overview details prefer night counts for stored route stops', () => {
  const trip = baseTrip([
    {
      day_number: 1,
      date: '2026-06-30',
      title: 'Rome',
      blocks: [],
      accommodation: {
        name: 'Rome Apartment',
        nights: 2,
        detail: { address: 'Rome, Italy' },
      },
    },
    {
      day_number: 2,
      date: '2026-07-01',
      title: 'Gargano',
      blocks: [],
      accommodation: {
        name: 'Baia San Nicola stay',
        detail: { address: 'Peschici, Italy' },
      },
    },
  ]);
  trip.trip.route_points = [
    { label: 'Amsterdam', lat: 52.3676, lng: 4.9041, role: 'home' },
    { label: 'Rome', lat: 41.9028, lng: 12.4964 },
    { label: 'Gargano', lat: 41.946, lng: 16.016 },
  ];

  const atlas = buildTripRouteAtlas(trip);
  assert.ok(atlas);
  const details = mapPointDetailsForTrip(atlas, trip.days);
  assert.ok(details);

  const home = atlas.points.find((point) => point.label === 'Amsterdam');
  const rome = atlas.points.find((point) => point.label === 'Rome');
  const gargano = atlas.points.find((point) => point.label === 'Gargano');
  assert.ok(home);
  assert.ok(rome);
  assert.ok(gargano);
  assert.equal(details[home.id].kicker, 'Start / finish');
  assert.equal(details[rome.id].kicker, '2 nights');
  assert.equal(details[gargano.id].kicker, '1 night');
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

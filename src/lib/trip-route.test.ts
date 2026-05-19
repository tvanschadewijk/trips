import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildTripRouteAtlas, lookupRoutePlace } from './trip-route';
import type { TripData } from './types';

function baseTrip(days: TripData['days']): TripData {
  return {
    trip: {
      name: 'Route test',
      subtitle: 'Editorial atlas',
      dates: { start: '2026-06-01', end: '2026-06-10' },
      travelers: [],
      summary: 'A route-first test trip.',
      hero_image: 'https://example.com/hero.jpg',
    },
    days,
  };
}

test('buildTripRouteAtlas preserves real relative geography for Como and Maggiore', () => {
  const atlas = buildTripRouteAtlas(baseTrip([
    {
      day_number: 1,
      date: '2026-06-01',
      title: 'Amsterdam -> Lake Como',
      blocks: [],
      transport: [{ mode: 'car', label: 'Self-drive', from: 'Amsterdam', to: 'Lake Como' }],
    },
    {
      day_number: 2,
      date: '2026-06-02',
      title: 'Lake Como -> Ravenna',
      blocks: [],
      transport: [{ mode: 'car', label: 'Self-drive', from: 'Lake Como', to: 'Ravenna' }],
    },
    {
      day_number: 3,
      date: '2026-06-03',
      title: 'Rome -> Lake Maggiore',
      blocks: [],
      transport: [{ mode: 'car', label: 'Self-drive', from: 'Rome', to: 'Lake Maggiore' }],
    },
    {
      day_number: 4,
      date: '2026-06-04',
      title: 'Lake Maggiore -> Baden-Baden',
      blocks: [],
      transport: [{ mode: 'car', label: 'Self-drive', from: 'Lake Maggiore', to: 'Baden-Baden' }],
    },
  ]));

  assert.ok(atlas);
  const como = atlas.points.find((point) => point.label === 'Lake Como');
  const maggiore = atlas.points.find((point) => point.label === 'Lake Maggiore');
  assert.ok(como);
  assert.ok(maggiore);
  assert.ok(
    maggiore.lng < como.lng,
    `Lake Maggiore should sit west of Lake Como, got ${maggiore.lng} vs ${como.lng}`
  );
});

test('buildTripRouteAtlas maps train, ferry, walking and flight legs from itinerary data', () => {
  const atlas = buildTripRouteAtlas(baseTrip([
    {
      day_number: 1,
      date: '2026-04-24',
      title: 'Amsterdam -> London',
      blocks: [],
      transport: [{ mode: 'train', label: 'Eurostar', from: 'Amsterdam Centraal', to: 'London St Pancras' }],
    },
    {
      day_number: 2,
      date: '2026-04-25',
      title: 'Bridge of Orchy -> Kingshouse',
      blocks: [],
      transport: [{ mode: 'walk', label: 'West Highland Way', from: 'Bridge of Orkey', to: 'Kingshouse' }],
    },
    {
      day_number: 3,
      date: '2026-04-26',
      title: 'Oban -> Glasgow',
      blocks: [],
      transport: [{ mode: 'ferry', label: 'Ferry and rail', from: 'Oban', to: 'Glasgow' }],
    },
    {
      day_number: 4,
      date: '2026-04-27',
      title: 'Glasgow -> Amsterdam',
      blocks: [],
      transport: [{ mode: 'flight', label: 'Return flight', from: 'Glasgow', to: 'Amsterdam' }],
    },
  ]));

  assert.ok(atlas);
  const modes = new Set(atlas.legs.map((leg) => leg.mode));
  assert.ok(modes.has('train'));
  assert.ok(modes.has('walk'));
  assert.ok(modes.has('ferry'));
  assert.ok(modes.has('flight'));
  assert.ok(atlas.points.some((point) => point.label === 'Bridge of Orchy'));
});

test('stored route_points override derived geocoding when present', () => {
  const atlas = buildTripRouteAtlas({
    ...baseTrip([]),
    trip: {
      ...baseTrip([]).trip,
      route_points: [
        { label: 'Home', lat: 52, lng: 5, role: 'home' },
        { label: 'Beach base', lat: 37, lng: 25, mode: 'flight', role: 'stay' },
      ],
    },
  });

  assert.ok(atlas);
  assert.equal(atlas.points[1].label, 'Beach base');
  assert.equal(atlas.legs[0].mode, 'flight');
});

test('lookupRoutePlace handles known spelling variants', () => {
  assert.equal(lookupRoutePlace('Bridge of Orkey')?.label, 'Bridge of Orchy');
  assert.equal(lookupRoutePlace('Lago Maggiore')?.label, 'Lake Maggiore');
});

test('buildTripRouteAtlas derives walking legs from itinerary stage titles', () => {
  const atlas = buildTripRouteAtlas(baseTrip([
    {
      day_number: 1,
      date: '2026-04-24',
      title: 'Bridge of Orchy -> Inveroran',
      subtitle: 'West Highland Way stage',
      blocks: [{ time_label: 'Day', type: 'walk', content: 'Walk the old military road.' }],
    },
    {
      day_number: 2,
      date: '2026-04-25',
      title: 'Inveroran -> Kingshouse',
      subtitle: 'Rannoch Moor crossing',
      blocks: [{ time_label: 'Day', type: 'walk', content: 'Continue the trail.' }],
    },
  ]));

  assert.ok(atlas);
  assert.deepEqual(atlas.points.map((point) => point.label), ['Bridge of Orchy', 'Inveroran', 'Kingshouse']);
  assert.ok(atlas.legs.every((leg) => leg.mode === 'walk'));
});

test('buildTripRouteAtlas removes interior home branches from derived routes', () => {
  const atlas = buildTripRouteAtlas(baseTrip([
    {
      day_number: 1,
      date: '2026-07-20',
      title: 'Tekirdag -> Istanbul',
      blocks: [],
      transport: [{ mode: 'car', label: 'Drive', from: 'Tekirdag', to: 'Istanbul' }],
    },
    {
      day_number: 2,
      date: '2026-07-21',
      title: 'Istanbul -> Amsterdam',
      blocks: [],
      transport: [{ mode: 'flight', label: 'Traveler flight', from: 'Istanbul', to: 'Amsterdam' }],
    },
    {
      day_number: 3,
      date: '2026-07-22',
      title: 'Istanbul -> Kavala',
      blocks: [],
      transport: [{ mode: 'car', label: 'Main route return', from: 'Istanbul', to: 'Kavala' }],
    },
  ]));

  assert.ok(atlas);
  assert.deepEqual(atlas.points.map((point) => point.label), ['Tekirdag Wine Coast', 'Istanbul', 'Kavala']);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildDayRouteMapSearchText,
  buildTripOverviewRouteAtlas,
  buildTripRouteAtlas,
  buildTripRouteSummaryLabels,
  lookupRoutePlace,
  routeDistanceKmForAtlas,
  routePlaceTextMatches,
  TRIP_ROUTE_SUMMARY_ELLIPSIS,
} from './trip-route';
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

test('routeDistanceKmForAtlas totals coordinate-backed route legs', () => {
  const atlas = buildTripRouteAtlas({
    ...baseTrip([]),
    trip: {
      ...baseTrip([]).trip,
      route_points: [
        { label: 'Amsterdam', lat: 52.3676, lng: 4.9041, role: 'home' },
        { label: 'Lake Como', lat: 45.984, lng: 9.261, mode: 'car' },
        { label: 'Ravenna', lat: 44.4184, lng: 12.2035, mode: 'car' },
      ],
    },
  });

  assert.ok(atlas);
  const distance = routeDistanceKmForAtlas(atlas);

  assert.ok(distance > 1000);
  assert.ok(distance < 1200);
});

test('routeDistanceKmForAtlas returns zero without a usable atlas', () => {
  assert.equal(routeDistanceKmForAtlas(undefined), 0);
});

test('stored route_points accept name aliases and skip malformed entries', () => {
  const atlas = buildTripRouteAtlas({
    ...baseTrip([]),
    trip: {
      ...baseTrip([]).trip,
      route_points: [
        { name: 'Mumbai', lat: 19.076, lng: 72.8777, role: 'home' },
        { title: 'Jaipur', lat: 26.9124, lng: 75.7873, mode: 'flight', role: 'stay' },
        { label: undefined, lat: 0, lng: 0 },
      ] as unknown as TripData['trip']['route_points'],
    },
  });

  assert.ok(atlas);
  assert.deepEqual(atlas.points.map((point) => point.label), ['Mumbai', 'Jaipur']);
  assert.equal(atlas.legs[0].mode, 'flight');
});

test('buildTripRouteSummaryLabels keeps a short same-city loop endpoint', () => {
  const trip = {
    ...baseTrip([]),
    trip: {
      ...baseTrip([]).trip,
      route_points: [
        { label: 'Amsterdam', lat: 52.3676, lng: 4.9041, role: 'home' },
        { label: 'Lake Como', lat: 45.984, lng: 9.261, mode: 'car' },
        { label: 'Amsterdam', lat: 52.3676, lng: 4.9041, mode: 'car', role: 'return' },
      ],
    },
  } satisfies TripData;

  const atlas = buildTripRouteAtlas(trip);
  assert.ok(atlas);

  assert.deepEqual(
    buildTripRouteSummaryLabels(atlas, trip.days),
    ['Amsterdam', 'Lake Como', 'Amsterdam']
  );
});

test('buildTripRouteSummaryLabels summarizes long road trips as one continuous route', () => {
  const trip = {
    ...baseTrip([]),
    trip: {
      ...baseTrip([]).trip,
      route_points: [
        { label: 'Amsterdam', lat: 52.3676, lng: 4.9041, role: 'home' },
        { label: 'Lake Como', lat: 45.984, lng: 9.261, mode: 'car' },
        { label: 'Ravenna', lat: 44.4184, lng: 12.2035, mode: 'car' },
        { label: 'Gargano', lat: 41.946, lng: 16.016, mode: 'car' },
        { label: 'Brindisi', lat: 40.6327, lng: 17.9418, mode: 'car' },
        { label: 'Igoumenitsa', lat: 39.5034, lng: 20.2656, mode: 'ferry' },
        { label: 'Meteora', lat: 39.704, lng: 21.626, mode: 'car' },
        { label: 'Pelion', lat: 39.388, lng: 23.173, mode: 'car' },
        { label: 'Thessaloniki', lat: 40.6401, lng: 22.9444, mode: 'car' },
        { label: 'Kavala', lat: 40.9376, lng: 24.4129, mode: 'car' },
        { label: 'Xanthi', lat: 41.1349, lng: 24.888, mode: 'car' },
        { label: 'Edirne', lat: 41.6771, lng: 26.5557, mode: 'car' },
        { label: 'Tekirdag Wine Coast', lat: 40.978, lng: 27.511, mode: 'car' },
        { label: 'Istanbul', lat: 41.0082, lng: 28.9784, mode: 'car' },
        { label: 'Plovdiv', lat: 42.1354, lng: 24.7453, mode: 'car' },
        { label: 'Hotel Ramonda / Rtanj', lat: 43.77, lng: 21.91, mode: 'car' },
        { label: 'Novi Sad / Boutique Macchiato Rooms', lat: 45.2671, lng: 19.8335, mode: 'car' },
        { label: 'Plitvice Lakes / Lakeside Hotel Plitvice', lat: 44.8654, lng: 15.582, mode: 'car' },
        { label: 'Lake Bled', lat: 46.3683, lng: 14.1146, mode: 'car' },
        { label: 'Salzburg', lat: 47.8095, lng: 13.055, mode: 'car' },
        { label: 'Heidelberg', lat: 49.3988, lng: 8.6724, mode: 'car' },
        { label: 'Amsterdam', lat: 52.3676, lng: 4.9041, mode: 'car', role: 'return' },
      ],
    },
  } satisfies TripData;

  const atlas = buildTripRouteAtlas(trip);
  assert.ok(atlas);

  assert.deepEqual(
    buildTripRouteSummaryLabels(atlas, trip.days),
    [
      'Amsterdam',
      'Lake Como',
      'Ravenna',
      TRIP_ROUTE_SUMMARY_ELLIPSIS,
      'Salzburg',
      'Heidelberg',
      'Amsterdam',
    ]
  );
});

test('trip overview route atlas hides flight-only home endpoints', () => {
  const trip = {
    ...baseTrip([]),
    trip: {
      ...baseTrip([]).trip,
      route_points: [
        { label: 'Amsterdam', lat: 52.3676, lng: 4.9041, role: 'home' },
        { label: 'Mumbai', lat: 19.076, lng: 72.8777, day: 1, mode: 'flight', role: 'stay' },
        { label: 'Jaipur', lat: 26.9124, lng: 75.7873, day: 3, mode: 'car', role: 'stay' },
        { label: 'Kochi', lat: 9.9312, lng: 76.2673, day: 8, mode: 'flight', role: 'stay' },
        { label: 'Amsterdam', lat: 52.3676, lng: 4.9041, mode: 'flight' },
      ],
    },
  } satisfies TripData;

  const atlas = buildTripRouteAtlas(trip);
  assert.ok(atlas);

  const overview = buildTripOverviewRouteAtlas(atlas, trip.days);

  assert.deepEqual(
    overview.points.map((point) => point.label),
    ['Mumbai', 'Jaipur', 'Kochi']
  );
  assert.deepEqual(overview.points.map((point) => point.index), [0, 1, 2]);
  assert.ok(overview.bounds.maxLat < 30);
  assert.deepEqual(overview.legs.map((leg) => leg.mode), ['car', 'flight']);
});

test('trip overview route atlas keeps home when the first leg is a road-trip leg', () => {
  const trip = baseTrip([
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
  ]);
  const atlas = buildTripRouteAtlas(trip);
  assert.ok(atlas);

  const overview = buildTripOverviewRouteAtlas(atlas, trip.days);

  assert.deepEqual(
    overview.points.map((point) => point.label),
    ['Amsterdam', 'Lake Como', 'Ravenna']
  );
});

test('trip overview route atlas keeps a flight endpoint with local itinerary substance', () => {
  const trip = {
    ...baseTrip([
      {
        day_number: 1,
        date: '2026-06-01',
        title: 'Amsterdam -> Jaipur',
        blocks: [
          {
            time_label: 'Morning',
            type: 'activity',
            content: 'A slow breakfast and canal walk in Amsterdam before the evening flight.',
          },
        ],
        transport: [{ mode: 'flight', label: 'Flight to India', from: 'Amsterdam', to: 'Jaipur' }],
      },
    ]),
    trip: {
      ...baseTrip([]).trip,
      route_points: [
        { label: 'Amsterdam', lat: 52.3676, lng: 4.9041, day: 1, role: 'home' },
        { label: 'Jaipur', lat: 26.9124, lng: 75.7873, day: 1, mode: 'flight', role: 'stay' },
      ],
    },
  } satisfies TripData;
  const atlas = buildTripRouteAtlas(trip);
  assert.ok(atlas);

  const overview = buildTripOverviewRouteAtlas(atlas, trip.days);

  assert.deepEqual(overview.points.map((point) => point.label), ['Amsterdam', 'Jaipur']);
});

test('lookupRoutePlace handles known spelling variants', () => {
  assert.equal(lookupRoutePlace('Bridge of Orkey')?.label, 'Bridge of Orchy');
  assert.equal(lookupRoutePlace('Lago Maggiore')?.label, 'Lake Maggiore');
});

test('day route map search ignores explanatory prose from other route days', () => {
  const day: TripData['days'][number] = {
    day_number: 3,
    date: '2026-06-29',
    title: 'Lake Como -> Ravenna',
    subtitle: 'Into mosaics and the Adriatic line',
    transport: [
      { mode: 'car', label: 'Self-drive - Lake Como -> Ravenna', from: 'Lake Como', to: 'Ravenna' },
    ],
    blocks: [
      {
        type: 'activity',
        time_label: 'Morning',
        content: 'Drive from Lake Como to Ravenna.',
        detail: {
          title: 'Adriatic Positioning',
          why: 'Ravenna keeps the descent culturally interesting while putting the car on the right side of Italy for Gargano and Brindisi.',
        },
      },
    ],
  };

  const searchText = buildDayRouteMapSearchText(day);
  assert.equal(routePlaceTextMatches(searchText, 'Lake Como'), true);
  assert.equal(routePlaceTextMatches(searchText, 'Ravenna'), true);
  assert.equal(routePlaceTextMatches(searchText, 'Gargano'), false);
  assert.equal(routePlaceTextMatches(searchText, 'Brindisi'), false);
});

test('route place matching uses known aliases without substring bleed', () => {
  assert.equal(routePlaceTextMatches('Ucmakdere / Sarkoy Wine Coast', 'Tekirdag Wine Coast'), true);
  assert.equal(routePlaceTextMatches('Barbare Vineyard House', 'Bari'), false);
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

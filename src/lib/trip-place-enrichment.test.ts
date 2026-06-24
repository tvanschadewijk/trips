import { test } from 'node:test';
import assert from 'node:assert/strict';
import { enrichTripPlaces } from './trip-place-enrichment';
import type { TripData } from './types';

function tripFixture(): TripData {
  return {
    trip: {
      name: 'London Weekend',
      subtitle: 'Food and galleries',
      dates: { start: '2026-07-01', end: '2026-07-03' },
      travelers: [],
      summary: 'A compact London trip.',
      hero_image: '/hero.jpg',
    },
    days: [
      {
        day_number: 1,
        date: '2026-07-01',
        title: 'East London',
        blocks: [],
        accommodation: {
          name: 'Town Hall Hotel',
          status: 'booked',
          detail: { address: 'Bethnal Green, London' },
        },
        meals: [{ type: 'dinner', name: 'The Marksman' }],
      },
    ],
  };
}

test('enrichTripPlaces skips network calls without a server key', async () => {
  const trip = tripFixture();
  let called = false;
  const summary = await enrichTripPlaces(trip, {
    apiKey: '',
    fetchImpl: (async () => {
      called = true;
      throw new Error('should not fetch');
    }) as typeof fetch,
  });

  assert.equal(called, false);
  assert.equal(summary.status, 'skipped');
  assert.equal(summary.reason, 'missing_api_key');
});

test('enrichTripPlaces stores coordinates and place ids from server-side lookup', async () => {
  const trip = tripFixture();
  const requests: Array<{ body: Record<string, unknown>; fieldMask: string | null }> = [];
  const responses = [
    {
      places: [{
        id: 'ChIJHotel',
        formattedAddress: 'Town Hall Hotel, London, UK',
        location: { latitude: 51.5294, longitude: -0.0572 },
        types: ['lodging', 'point_of_interest', 'establishment'],
      }],
    },
    {
      places: [{
        id: 'ChIJRestaurant',
        formattedAddress: 'The Marksman, London, UK',
        location: { latitude: 51.5317, longitude: -0.0619 },
        types: ['restaurant', 'food', 'point_of_interest', 'establishment'],
      }],
    },
  ];

  const summary = await enrichTripPlaces(trip, {
    apiKey: 'server-key',
    now: '2026-06-24T10:00:00.000Z',
    fetchImpl: (async (_url, init) => {
      const headers = new Headers(init?.headers);
      requests.push({
        body: JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>,
        fieldMask: headers.get('X-Goog-FieldMask'),
      });
      return Response.json(responses.shift() ?? { places: [] });
    }) as typeof fetch,
  });

  assert.equal(summary.status, 'completed');
  assert.equal(summary.attempted, 2);
  assert.equal(summary.enriched, 2);
  assert.deepEqual(requests.map((request) => request.fieldMask), [
    'places.id,places.formattedAddress,places.location,places.types',
    'places.id,places.formattedAddress,places.location,places.types',
  ]);
  assert.equal(requests[0].body.includedType, 'lodging');
  assert.equal(requests[1].body.includedType, 'restaurant');

  assert.equal(trip.days[0].accommodation?.detail?.lat, 51.5294);
  assert.equal(trip.days[0].accommodation?.detail?.lng, -0.0572);
  assert.equal(trip.days[0].accommodation?.detail?.place_id, 'ChIJHotel');
  assert.equal(trip.days[0].accommodation?.detail?.map_lookup_status, 'resolved');

  const place = trip.days[0].meals?.[0].place;
  assert.equal(place?.name, 'The Marksman');
  assert.equal(place?.lat, 51.5317);
  assert.equal(place?.lng, -0.0619);
  assert.equal(place?.place_id, 'ChIJRestaurant');
  assert.match(place?.google_maps_url ?? '', /query_place_id=ChIJRestaurant/);
});

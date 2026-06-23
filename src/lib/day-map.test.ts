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
        status: 'booked',
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
        status: 'booked',
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

test('day map targets include agent-added single restaurant meals', () => {
  const trip = baseTrip([
    {
      day_number: 1,
      date: '2026-06-27',
      title: 'Amsterdam -> Lake Como / Brunate',
      blocks: [],
      transport: [{ mode: 'car', label: 'Self-drive', from: 'Amsterdam', to: 'Lake Como' }],
      accommodation: {
        name: 'Locanda Milano 1873',
        status: 'booked',
        detail: { address: 'Brunate, Lake Como, Italy' },
      },
    },
    {
      day_number: 2,
      date: '2026-06-28',
      title: 'Lake Como / Brunate',
      blocks: [],
      accommodation: {
        name: 'Locanda Milano 1873',
        status: 'booked',
        detail: { address: 'Brunate, Lake Como, Italy' },
      },
      meals: [
        { type: 'dinner', name: 'Platea Ristorante' },
      ],
    },
  ]);

  const atlas = buildTripRouteAtlas(trip);
  const dayMapData = buildDayMapDataByNumber(atlas, trip.days)[2];
  const platea = dayMapData.searchTargets.find((target) => target.label === 'Platea Ristorante');

  assert.ok(platea);
  assert.equal(platea.placeType, 'restaurant');
  assert.equal(dayMapData.atlas?.points.some((point) => point.label === 'Platea Ristorante'), true);
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

test('day map includes first-day route origin and does not invent stale Como stops', () => {
  const trip = baseTrip([
    {
      day_number: 1,
      date: '2026-06-30',
      title: 'Amsterdam -> Lake Como',
      blocks: [],
      transport: [{ mode: 'car', label: 'Self-drive', from: 'Amsterdam', to: 'Lake Como' }],
      accommodation: {
        name: 'Como listed hotel',
        status: 'booked',
        detail: { address: 'Como, Italy' },
      },
    },
  ]);

  const atlas = buildTripRouteAtlas(trip);
  const dayMapData = buildDayMapDataByNumber(atlas, trip.days)[1];
  const labels = dayMapData.searchTargets.map((target) => target.label);

  assert.deepEqual(labels, ['Amsterdam', 'Lake Como', 'Como listed hotel']);
  assert.equal(dayMapData.searchTargets.find((target) => target.label === 'Amsterdam')?.fallbackPoint?.lat, 52.3676);
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
        status: 'booked',
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
        status: 'booked',
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

test('trip map overview details do not multiply repeated stay-card night counts', () => {
  const trip = baseTrip([
    {
      day_number: 1,
      date: '2026-07-02',
      title: 'Gargano arrival',
      blocks: [],
      accommodation: {
        name: 'Vila Sir Judah',
        status: 'booked',
        nights: 2,
        detail: { address: 'Peschici, Gargano, Italy' },
      },
    },
    {
      day_number: 2,
      date: '2026-07-03',
      title: 'Gargano coast',
      blocks: [],
      accommodation: {
        name: 'Vila Sir Judah',
        status: 'booked',
        nights: 2,
        detail: { address: 'Peschici, Gargano, Italy' },
      },
    },
    {
      day_number: 3,
      date: '2026-07-04',
      title: 'Gargano checkout',
      blocks: [],
      accommodation: {
        name: 'Vila Sir Judah',
        status: 'booked',
        nights: 2,
        detail: { address: 'Peschici, Gargano, Italy' },
      },
    },
  ]);
  trip.trip.route_points = [
    { label: 'Amsterdam', lat: 52.3676, lng: 4.9041, role: 'home' },
    { label: 'Gargano', lat: 41.946, lng: 16.016 },
  ];

  const atlas = buildTripRouteAtlas(trip);
  assert.ok(atlas);
  const details = mapPointDetailsForTrip(atlas, trip.days);
  assert.ok(details);

  const gargano = atlas.points.find((point) => point.label === 'Gargano');
  assert.ok(gargano);
  assert.equal(details[gargano.id].kicker, '2 nights');
});

test('trip map overview details ignore accommodation prose when counting route stop nights', () => {
  const trip = baseTrip([
    {
      day_number: 1,
      date: '2026-06-30',
      title: 'Ravenna positioning',
      blocks: [],
      accommodation: {
        name: 'Palazzo Ravenna',
        status: 'booked',
        nights: 3,
        detail: {
          address: 'Ravenna, Italy',
          why: 'Ravenna keeps the descent culturally interesting while putting the car on the right side of Italy for Gargano and Brindisi.',
        },
      },
    },
    {
      day_number: 2,
      date: '2026-07-03',
      title: 'Gargano coast',
      blocks: [],
      accommodation: {
        name: 'Vila Sir Judah',
        status: 'booked',
        nights: 2,
        detail: { address: 'Peschici, Gargano, Italy' },
      },
    },
  ]);
  trip.trip.route_points = [
    { label: 'Amsterdam', lat: 52.3676, lng: 4.9041, role: 'home' },
    { label: 'Ravenna', lat: 44.4184, lng: 12.2035 },
    { label: 'Gargano', lat: 41.946, lng: 16.016 },
    { label: 'Brindisi', lat: 40.6327, lng: 17.9418 },
  ];

  const atlas = buildTripRouteAtlas(trip);
  assert.ok(atlas);
  const details = mapPointDetailsForTrip(atlas, trip.days);
  assert.ok(details);

  const ravenna = atlas.points.find((point) => point.label === 'Ravenna');
  const gargano = atlas.points.find((point) => point.label === 'Gargano');
  const brindisi = atlas.points.find((point) => point.label === 'Brindisi');
  assert.ok(ravenna);
  assert.ok(gargano);
  assert.ok(brindisi);
  assert.equal(details[ravenna.id].kicker, '3 nights');
  assert.equal(details[gargano.id].kicker, '2 nights');
  assert.equal(details[brindisi.id].kicker, 'Route stop');
});

test('trip map overview details use travel destination when accommodation location is sparse', () => {
  const trip = baseTrip([
    {
      day_number: 1,
      date: '2026-07-01',
      title: 'Ravenna -> Gargano / Peschici',
      blocks: [],
      transport: [{ mode: 'car', label: 'Self-drive - Ravenna -> Peschici', from: 'Ravenna', to: 'Peschici' }],
      accommodation: {
        name: 'Vila SEJUDA Alberghetto',
        status: 'booked',
        nights: 2,
        detail: {
          why: 'A characterful Gargano/Peschici base before Brindisi.',
        },
      },
    },
    {
      day_number: 2,
      date: '2026-07-02',
      title: 'Gargano / Peschici',
      blocks: [],
      accommodation: {
        name: 'Vila SEJUDA Alberghetto',
        status: 'booked',
        nights: 2,
        detail: {
          why: 'A characterful Gargano/Peschici base before Brindisi.',
        },
      },
    },
  ]);
  trip.trip.route_points = [
    { label: 'Amsterdam', lat: 52.3676, lng: 4.9041, role: 'home' },
    { label: 'Ravenna', lat: 44.4184, lng: 12.2035 },
    { label: 'Gargano', lat: 41.946, lng: 16.016 },
    { label: 'Brindisi', lat: 40.6327, lng: 17.9418 },
  ];

  const atlas = buildTripRouteAtlas(trip);
  assert.ok(atlas);
  const details = mapPointDetailsForTrip(atlas, trip.days);
  assert.ok(details);

  const ravenna = atlas.points.find((point) => point.label === 'Ravenna');
  const gargano = atlas.points.find((point) => point.label === 'Gargano');
  const brindisi = atlas.points.find((point) => point.label === 'Brindisi');
  assert.ok(ravenna);
  assert.ok(gargano);
  assert.ok(brindisi);
  assert.equal(details[ravenna.id].kicker, 'Route stop');
  assert.equal(details[gargano.id].kicker, '2 nights');
  assert.equal(details[brindisi.id].kicker, 'Route stop');
});

test('trip map overview details group repeated stays even when detail titles vary by night', () => {
  const trip = baseTrip([
    {
      day_number: 1,
      date: '2026-07-17',
      title: 'Edirne -> Tekirdag Wine Coast',
      blocks: [],
      accommodation: {
        name: 'Barbare Vineyards Hotel - Norvec Suit',
        status: 'booked',
        nights: 3,
        detail: { title: 'Norwegian-style A-frame cabin in the vineyard' },
      },
    },
    {
      day_number: 2,
      date: '2026-07-18',
      title: 'Ucmakdere / Sarkoy Wine Coast',
      blocks: [],
      accommodation: {
        name: 'Barbare Vineyards Hotel - Norvec Suit',
        status: 'booked',
        nights: 3,
        detail: { title: 'Norwegian A-frame cabin (continued)' },
      },
    },
    {
      day_number: 3,
      date: '2026-07-19',
      title: 'Tekirdag / Sarkoy / Kiyikoy Flex',
      blocks: [],
      accommodation: {
        name: 'Barbare Vineyards Hotel - Norvec Suit',
        status: 'booked',
        nights: 3,
        detail: { title: 'Norwegian A-frame cabin (final night)' },
      },
    },
  ]);
  trip.trip.route_points = [
    { label: 'Amsterdam', lat: 52.3676, lng: 4.9041, role: 'home' },
    { label: 'Edirne', lat: 41.6771, lng: 26.5557 },
    { label: 'Tekirdag Wine Coast', lat: 40.978, lng: 27.511 },
  ];

  const atlas = buildTripRouteAtlas(trip);
  assert.ok(atlas);
  const details = mapPointDetailsForTrip(atlas, trip.days);
  assert.ok(details);

  const edirne = atlas.points.find((point) => point.label === 'Edirne');
  const tekirdag = atlas.points.find((point) => point.label === 'Tekirdag Wine Coast');
  assert.ok(edirne);
  assert.ok(tekirdag);
  assert.equal(details[edirne.id].kicker, 'Route stop');
  assert.equal(details[tekirdag.id].kicker, '3 nights');
});

test('trip map overview details infer consecutive stay length when nights are absent', () => {
  const trip = baseTrip([
    {
      day_number: 1,
      date: '2026-07-02',
      title: 'Lake Como arrival',
      blocks: [],
      accommodation: {
        name: 'Locanda Milano 1873',
        status: 'booked',
        detail: { address: 'Brunate, Lake Como, Italy' },
      },
    },
    {
      day_number: 2,
      date: '2026-07-03',
      title: 'Lake Como recovery',
      blocks: [],
      accommodation: {
        name: 'Locanda Milano 1873',
        status: 'booked',
        detail: { address: 'Brunate, Lake Como, Italy' },
      },
    },
  ]);
  trip.trip.route_points = [
    { label: 'Amsterdam', lat: 52.3676, lng: 4.9041, role: 'home' },
    { label: 'Lake Como', lat: 45.984, lng: 9.261 },
  ];

  const atlas = buildTripRouteAtlas(trip);
  assert.ok(atlas);
  const details = mapPointDetailsForTrip(atlas, trip.days);
  assert.ok(details);

  const como = atlas.points.find((point) => point.label === 'Lake Como');
  assert.ok(como);
  assert.equal(details[como.id].kicker, '2 nights');
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
        status: 'booked',
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

test('day map targets skip unconfirmed accommodation searches', () => {
  const trip = baseTrip([
    {
      day_number: 1,
      date: '2026-07-01',
      title: 'Naples deep cut',
      blocks: [],
      accommodation: {
        name: 'Naples boutique search (Chiaia / Centro Storico)',
        status: 'pending',
        nights: 3,
        note: 'Hotel Locarno / Palazzo Dama / Villa Agrippina shortlist.',
      },
      meals: [
        {
          type: 'dinner',
          name: "All'Antico Vinaio",
          detail: { address: 'Naples, Italy' },
        },
      ],
    },
  ]);

  const dayMapData = buildDayMapDataByNumber(undefined, trip.days)[1];

  assert.deepEqual(dayMapData.searchTargets.map((target) => target.label), ["All'Antico Vinaio"]);
});

test('day map targets include pending named hotels and single-word restaurants with trip context', () => {
  const trip = baseTrip([
    {
      day_number: 1,
      date: '2026-06-23',
      title: 'Amsterdam -> Antwerp',
      transport: [
        { mode: 'train', label: 'Eurocity Direct', from: 'Amsterdam Zuid', to: 'Antwerp-Centraal' },
      ],
      accommodation: {
        name: 'August Antwerp',
        status: 'pending',
        nights: 2,
      },
      blocks: [
        {
          time_label: 'Late afternoon',
          type: 'activity',
          content: 'Tour the brewery.',
          place: { name: 'Brouwerij De Koninck' },
        },
      ],
      meals: [
        { type: 'dinner', name: 'Bar Bulot Antwerpen', reservation_required: true },
      ],
    },
    {
      day_number: 2,
      date: '2026-06-24',
      title: "Ciro's Classic Lunch & Le Pristine Dinner",
      accommodation: {
        name: 'August Antwerp',
        status: 'pending',
        nights: 2,
      },
      meals: [
        { type: 'lunch', name: "Ciro's", reservation_required: true },
        { type: 'dinner', name: 'Le Pristine Restaurant', reservation_required: true },
      ],
    },
  ]);

  const atlas = buildTripRouteAtlas(trip);
  assert.ok(atlas);
  const dayMapData = buildDayMapDataByNumber(atlas, trip.days, ['Antwerp Culinary Two-Night Trip'])[2];
  const labels = dayMapData.searchTargets.map((target) => target.label);

  assert.deepEqual(labels, ['August Antwerp', "Ciro's", 'Le Pristine Restaurant']);
  assert.equal(dayMapData.searchTargets.find((target) => target.label === 'August Antwerp')?.placeType, 'lodging');
  assert.equal(dayMapData.searchTargets.find((target) => target.label === "Ciro's")?.placeType, 'restaurant');
  assert.match(dayMapData.searchTargets.find((target) => target.label === 'Le Pristine Restaurant')?.query ?? '', /Antwerp/);
});

test('day map targets skip family routine labels and keep actual POIs', () => {
  const trip = baseTrip([
    {
      day_number: 1,
      date: '2026-07-31',
      title: 'Gravelrit 2 & Wijnbar in Girona',
      blocks: [
        {
          time_label: '07:00',
          type: 'activity',
          content: 'TJEERD: Solo Gravelrit 2 - richting de flanken van de Rocacorba. ~50 km, stevig klimwerk.',
        },
        {
          time_label: 'Ochtend',
          type: 'activity',
          content: 'FAMILIE: Uitslapen en zwembad.',
        },
        {
          time_label: 'Middag',
          type: 'activity',
          content: "Met het gezin naar Cala Montgó (nabij L'Escala). Prachtig beschutte baai.",
        },
      ],
      accommodation: {
        name: 'Mas Bombo',
        status: 'booked',
        detail: { address: "L'Escala, Spain" },
      },
      meals: [
        {
          type: 'dinner',
          name: 'Syrah Girona',
          status: 'pending',
        },
      ],
    },
  ]);

  const dayMapData = buildDayMapDataByNumber(undefined, trip.days)[1];
  const labels = dayMapData.searchTargets.map((target) => target.label);

  assert.deepEqual(labels, ['Mas Bombo', 'Cala Montgó', 'Syrah Girona']);
  assert.equal(labels.includes('FAMILIE: Uitslapen en zwembad'), false);
  assert.equal(labels.includes('Uitslapen en zwembad'), false);
  assert.equal(labels.includes('Solo Gravelrit 2'), false);
});

test('day map targets trust explicit block places for structured v2 trips', () => {
  const trip = baseTrip([
    {
      day_number: 1,
      date: '2026-08-01',
      title: 'Pool morning',
      blocks: [
        {
          time_label: 'Morning',
          type: 'activity',
          content: 'Family swim and easy snack.',
          place: {
            name: 'Piscina Municipal de Pals',
            address: 'Pals, Spain',
            lat: 41.971,
            lng: 3.148,
          },
        },
      ],
    },
  ]);

  const dayMapData = buildDayMapDataByNumber(undefined, trip.days)[1];
  const target = dayMapData.searchTargets[0];

  assert.equal(dayMapData.searchTargets.length, 1);
  assert.equal(target.label, 'Piscina Municipal de Pals');
  assert.equal(target.fallbackPoint?.lat, 41.971);
  assert.equal(target.fallbackPoint?.lng, 3.148);
  assert.equal(target.fallbackPoint?.source, 'stored');
});

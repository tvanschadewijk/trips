import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeTripData } from './trip-data-normalize';

test('normalizes legacy trip metadata into the current preview schema', () => {
  const trip = normalizeTripData({
    trip: {
      name: 'Zomervakantie 2026',
      start_date: '2026-07-24',
      end_date: '2026-08-16',
      travelers: 'Tjeerd, Irene, twee dochters (11 & 9), Sunny (hond)',
      destinations: ['Orleans', 'Emporda'],
    },
    days: [
      {
        day_number: 1,
        date: '2026-07-24',
        title: 'Utrecht -> Orleans',
      },
    ],
  });

  assert.deepEqual(trip.trip.dates, {
    start: '2026-07-24',
    end: '2026-08-16',
  });
  assert.deepEqual(trip.trip.travelers, [
    'Tjeerd',
    'Irene',
    'twee dochters (11 & 9)',
    'Sunny (hond)',
  ]);
  assert.equal(trip.trip.subtitle, '');
  assert.equal(trip.trip.summary, '');
  assert.equal(trip.days.length, 1);
});

test('normalizes legacy day fields used by the preview', () => {
  const trip = normalizeTripData({
    trip: {
      name: 'Costa Brava',
      start_date: '2026-07-27',
      end_date: '2026-07-27',
      travelers: 'Family',
    },
    days: [
      {
        day_number: 4,
        date: '2026-07-27',
        title: 'Empuries',
        activities: [
          'Empuries ruins',
          'Snorkeling at Platja del Rec del Moli',
        ],
        meals: {
          lunch: 'Picknick op het strand',
          dinner: 'Thuis koken',
        },
        accommodation: 'Mas Bombo, Vilamari',
      },
    ],
  });

  assert.deepEqual(trip.days[0].blocks, [
    { time_label: '', type: 'activity', content: 'Empuries ruins' },
    { time_label: '', type: 'activity', content: 'Snorkeling at Platja del Rec del Moli' },
  ]);
  assert.deepEqual(trip.days[0].meals, [
    { type: 'lunch', name: 'Picknick op het strand' },
    { type: 'dinner', name: 'Thuis koken' },
  ]);
  assert.deepEqual(trip.days[0].accommodation, {
    name: 'Mas Bombo, Vilamari',
  });
});

test('keeps existing current-schema data intact', () => {
  const source = {
    trip: {
      name: 'London by Rail',
      subtitle: 'A compact rail weekend',
      dates: { start: '2026-07-01', end: '2026-07-03' },
      travelers: ['Thijs'],
      summary: 'Train, galleries, and dinner.',
      hero_image: '/hero.jpg',
    },
    days: [
      {
        day_number: 1,
        date: '2026-07-01',
        title: 'Amsterdam to London',
        blocks: [{ time_label: 'Afternoon', type: 'site', content: 'Visit Tate Modern.' }],
        meals: [{ type: 'dinner', name: 'The Marksman' }],
      },
    ],
    markdown_source: '# London',
  };

  const trip = normalizeTripData(source);

  assert.deepEqual(trip.trip.dates, source.trip.dates);
  assert.deepEqual(trip.trip.travelers, ['Thijs']);
  assert.deepEqual(trip.days[0].blocks, source.days[0].blocks);
  assert.equal(trip.markdown_source, '# London');
});

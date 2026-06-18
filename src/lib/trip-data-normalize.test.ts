import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeTripData,
  normalizeTripDataWithWarnings,
} from './trip-data-normalize';

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

test('drops empty tip placeholders and normalizes useful legacy tip fields', () => {
  const trip = normalizeTripData({
    trip: {
      name: 'Antwerp',
      dates: { start: '2026-06-23', end: '2026-06-24' },
      travelers: [],
    },
    days: [
      {
        day_number: 1,
        date: '2026-06-23',
        title: 'Antwerp food day',
        tips: [
          {},
          { title: 'Booking window', content: "Reserve Ciro's and Le Pristine separately." },
          { label: 'Map sanity', note: 'Use Antwerp in map searches for restaurant names.' },
        ],
      },
      {
        day_number: 2,
        date: '2026-06-24',
        title: 'No useful tips',
        tips: [{ title: '', content: '' }],
      },
    ],
  });

  assert.deepEqual(trip.days[0].tips, [
    { icon: 'info', title: 'Booking window', content: "Reserve Ciro's and Le Pristine separately." },
    { icon: 'info', title: 'Map sanity', content: 'Use Antwerp in map searches for restaurant names.', label: 'Map sanity', note: 'Use Antwerp in map searches for restaurant names.' },
  ]);
  assert.equal(trip.days[1].tips, undefined);
});

test('drops trip notes with missing or undefined-like content', () => {
  const result = normalizeTripDataWithWarnings({
    trip: {
      name: 'India',
      dates: { start: '2026-12-29', end: '2027-01-27' },
      travelers: [],
      notes: [
        { title: 'Comfort-first route' },
        { title: 'OurTrips sync note', content: undefined },
        { title: 'Literal placeholder', content: 'undefined' },
        { title: 'Keep this', icon: 'undefined', content: 'Private drivers replace long rail legs.' },
        { label: 'Legacy body', body: 'Use slower transfer days around Varanasi.' },
      ],
    },
    days: [],
  });

  assert.deepEqual(result.data.trip.notes, [
    { title: 'Keep this', content: 'Private drivers replace long rail legs.' },
    {
      label: 'Legacy body',
      body: 'Use slower transfer days around Varanasi.',
      title: 'Legacy body',
      content: 'Use slower transfer days around Varanasi.',
    },
  ]);
  assert.deepEqual(result.warnings, [
    'trip.notes[0] was skipped because content was missing.',
    'trip.notes[1] was skipped because content was missing.',
    'trip.notes[2] was skipped because content was missing.',
  ]);
});

test('normalizeTripData accepts route point name/title aliases as labels', () => {
  const data = normalizeTripData({
    trip: {
      name: 'India',
      route_points: [
        { name: 'Mumbai', lat: 19.076, lng: 72.8777 },
        { title: 'Jaipur', lat: 26.9124, lng: 75.7873 },
      ],
    },
    days: [],
  });

  assert.deepEqual(
    data.trip.route_points?.map((point) => point.label),
    ['Mumbai', 'Jaipur']
  );
});

test('normalizeTripDataWithWarnings reports route point aliases and malformed entries', () => {
  const result = normalizeTripDataWithWarnings({
    trip: {
      name: 'India',
      route_points: [
        { name: 'Mumbai', lat: 19.076, lng: 72.8777 },
        { title: 'Jaipur', lat: 26.9124, lng: 75.7873 },
        { label: 'Broken stop', lat: 0 },
      ],
    },
    days: [],
  });

  assert.deepEqual(
    result.data.trip.route_points?.map((point) => point.label),
    ['Mumbai', 'Jaipur']
  );
  assert.deepEqual(result.warnings, [
    'trip.route_points[0].name was converted to label.',
    'trip.route_points[1].title was converted to label.',
    'trip.route_points[2] was skipped because label, lat, or lng was missing.',
  ]);
});

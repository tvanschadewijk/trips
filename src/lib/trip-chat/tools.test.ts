import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { TripData } from '@/lib/types';
import { _internal } from './tools';

const {
  applyAccommodationDetailPatch,
  buildPolicySearchQuery,
  collectAccommodations,
  extractPolicySnippets,
  inferPolicyFromText,
} = _internal;

const sampleTrip: TripData = {
  trip: {
    name: 'Scotland',
    subtitle: 'Highlands by rail',
    dates: { start: '2026-04-24', end: '2026-05-01' },
    travelers: ['T', 'A'],
    summary: 'A rail-led Highland trip.',
    hero_image: 'https://example.com/hero.jpg',
  },
  days: [
    {
      day_number: 1,
      date: '2026-04-24',
      title: 'Amsterdam -> Glasgow',
      blocks: [{ time_label: 'Morning', content: 'Fly to Glasgow.', type: 'transport' }],
      accommodation: {
        name: 'Grasshopper Hotel Glasgow',
        nights: 2,
        status: 'booked',
        detail: {
          address: '87 Union Street, Glasgow',
          check_in: '15:00',
          dog_note: 'Not checked yet.',
        },
      },
    },
    {
      day_number: 2,
      date: '2026-04-25',
      title: 'Glasgow',
      blocks: [{ time_label: 'Morning', content: 'Explore.', type: 'activity' }],
      accommodation: null,
    },
    {
      day_number: 3,
      date: '2026-04-26',
      title: 'Glasgow -> Bridge of Orchy',
      blocks: [{ time_label: 'Afternoon', content: 'Train north.', type: 'transport' }],
      accommodation: {
        name: 'Bridge of Orchy Hotel',
        detail: {
          booking_platform: 'Hotels.com',
        },
      },
    },
  ],
};

test('collectAccommodations returns compact hotel records with update paths', () => {
  const accommodations = collectAccommodations(sampleTrip);
  assert.equal(accommodations.length, 2);
  assert.deepEqual(
    accommodations.map((a) => [a.name, a.path, a.existing_dog_note]),
    [
      ['Grasshopper Hotel Glasgow', 'days[0].accommodation', 'Not checked yet.'],
      ['Bridge of Orchy Hotel', 'days[2].accommodation', null],
    ]
  );
});

test('applyAccommodationDetailPatch deep-merges one hotel detail without touching other days', () => {
  const result = applyAccommodationDetailPatch(sampleTrip, 'days[2].accommodation', {
    dog_note: 'Dogs allowed in selected rooms; call ahead.',
    policy_source_label: 'official hotel FAQ',
    policy_confidence: 'medium',
  });

  assert.equal(result.ok, true);
  if (!result.ok) return;

  assert.equal(
    result.next.days[2].accommodation?.detail?.booking_platform,
    'Hotels.com'
  );
  assert.equal(
    result.next.days[2].accommodation?.detail?.dog_note,
    'Dogs allowed in selected rooms; call ahead.'
  );
  assert.equal(
    result.next.days[0].accommodation?.detail?.dog_note,
    'Not checked yet.'
  );
});

test('applyAccommodationDetailPatch rejects stale or non-accommodation paths', () => {
  assert.equal(
    applyAccommodationDetailPatch(sampleTrip, 'days[1].accommodation', {
      dog_note: 'x',
    }).ok,
    false
  );
  assert.equal(
    applyAccommodationDetailPatch(sampleTrip, 'trip.notes[0]', {
      dog_note: 'x',
    }).ok,
    false
  );
});

test('buildPolicySearchQuery includes place, location, and dog policy terms', () => {
  assert.equal(
    buildPolicySearchQuery({
      place_name: 'Bridge of Orchy Hotel',
      city: 'Bridge of Orchy',
      country: 'Scotland',
      policy_type: 'dog_policy',
    }),
    'Bridge of Orchy Hotel Bridge of Orchy Scotland dog policy dogs allowed pets official'
  );
});

test('inferPolicyFromText identifies positive, negative, and service-only policies', () => {
  assert.match(
    inferPolicyFromText('Dogs are welcome in selected rooms for a small fee.', 'dog_policy')
      .policy ?? '',
    /allowed/
  );
  assert.match(
    inferPolicyFromText('We do not allow dogs except guide dogs.', 'dog_policy').policy ??
      '',
    /do not appear/
  );
  assert.match(
    inferPolicyFromText('Service dogs only in public areas.', 'dog_policy').policy ?? '',
    /assistance\/service/
  );
});

test('extractPolicySnippets returns compact snippets around policy terms', () => {
  const snippets = extractPolicySnippets(
    'Long intro. '.repeat(20) +
      'Dogs are welcome in two ground-floor rooms by prior arrangement. ' +
      'Long outro. '.repeat(20)
  );
  assert.equal(snippets.length, 1);
  assert.match(snippets[0], /Dogs are welcome/);
});

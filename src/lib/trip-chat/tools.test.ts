import { test } from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import type { TripData } from '@/lib/types';
import { _internal } from './tools';

const {
  applyAccommodationPatch,
  applyAccommodationDetailPatch,
  buildPolicySearchQuery,
  collectAccommodations,
  CreateAccommodationCandidateInputShape,
  extractPolicySnippets,
  inferPolicyFromText,
  UpdateAccommodationCandidateInputShape,
  upsertAccommodationAgentNote,
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
      accommodation: {
        name: 'Grasshopper Hotel Glasgow',
        price: '(night 2 of 2)',
        status: 'booked',
        nights: 1,
        note: 'Night 2 of 2',
      },
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
  assert.equal(accommodations.length, 3);
  assert.deepEqual(
    accommodations.map((a) => [a.name, a.path, a.existing_dog_note]),
    [
      ['Grasshopper Hotel Glasgow', 'days[0].accommodation', 'Not checked yet.'],
      ['Grasshopper Hotel Glasgow', 'days[1].accommodation', null],
      ['Bridge of Orchy Hotel', 'days[2].accommodation', null],
    ]
  );
});

test('accommodation candidate schema requires checked review ratings for proposals', () => {
  const createSchema = z.object(CreateAccommodationCandidateInputShape);

  const missingRatings = createSchema.safeParse({
    candidate: {
      candidate: 'Hotel Bellavista',
      directWebsite: { label: 'Official site', url: 'https://example.com' },
    },
  });
  assert.equal(missingRatings.success, false);

  const checkedRatings = createSchema.safeParse({
    candidate: {
      candidate: 'Hotel Bellavista',
      directWebsite: { label: 'Official site', url: 'https://example.com' },
      ratings: [
        {
          name: 'Hotel Bellavista',
          checkedAt: '2026-06-03',
          bookingCom: '8.8/10',
          tripadvisor: '4.5/5',
          google: '4.6/5',
        },
      ],
    },
  });
  assert.equal(
    checkedRatings.success,
    true,
    checkedRatings.success ? '' : JSON.stringify(checkedRatings.error.issues)
  );

  const updateSchema = z.object(UpdateAccommodationCandidateInputShape);
  const partialRatingPatch = updateSchema.safeParse({
    candidate_id: 'stay-hotel-bellavista',
    candidate_patch: {
      ratings: [{ name: 'Hotel Bellavista', bookingCom: '8.8/10' }],
    },
  });
  assert.equal(partialRatingPatch.success, false);
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
  assert.equal(result.markdownSourceUpdated, false);
});

test('applyAccommodationDetailPatch adds an agent note when markdown_source exists', () => {
  const result = applyAccommodationDetailPatch(
    {
      ...sampleTrip,
      markdown_source: '# Scotland\n\n## Day 3\n\nTake the train north.',
    },
    'days[2].accommodation',
    {
      dog_note: 'Dogs allowed in selected rooms; call ahead.',
      policy_source_url: 'https://bridgeoforchy.co.uk/dogs',
      policy_source_label: 'official hotel FAQ',
      policy_confidence: 'medium',
    }
  );

  assert.equal(result.ok, true);
  if (!result.ok) return;

  assert.equal(result.markdownSourceUpdated, true);
  assert.match(result.next.markdown_source ?? '', /OURTRIPS_AGENT_NOTES_START/);
  assert.match(result.next.markdown_source ?? '', /Bridge of Orchy Hotel/);
  assert.match(result.next.markdown_source ?? '', /Dogs allowed in selected rooms/);
  assert.match(result.next.markdown_source ?? '', /official hotel FAQ/);
  assert.match(result.next.markdown_source ?? '', /path: days\[2\]\.accommodation/);
});

test('applyAccommodationPatch renames repeated stay cards without replacing unrelated days', () => {
  const result = applyAccommodationPatch(
    sampleTrip,
    'days[0].accommodation',
    { name: 'voco Grand Central Glasgow' },
    'same_current_name'
  );

  assert.equal(result.ok, true);
  if (!result.ok) return;

  assert.deepEqual(result.dayNumbers, [1, 2]);
  assert.equal(result.updatedCount, 2);
  assert.equal(result.previousName, 'Grasshopper Hotel Glasgow');
  assert.equal(result.next.days[0].accommodation?.name, 'voco Grand Central Glasgow');
  assert.equal(result.next.days[1].accommodation?.name, 'voco Grand Central Glasgow');
  assert.equal(result.next.days[1].accommodation?.note, 'Night 2 of 2');
  assert.equal(result.next.days[2].accommodation?.name, 'Bridge of Orchy Hotel');
  assert.equal(result.markdownSourceUpdated, false);
});

test('applyAccommodationPatch can patch only the addressed stay', () => {
  const result = applyAccommodationPatch(sampleTrip, 'days[1].accommodation', {
    note: 'Late checkout requested.',
  });

  assert.equal(result.ok, true);
  if (!result.ok) return;

  assert.deepEqual(result.dayNumbers, [2]);
  assert.equal(result.next.days[0].accommodation?.note, undefined);
  assert.equal(result.next.days[1].accommodation?.note, 'Late checkout requested.');
});

test('applyAccommodationPatch adds agent notes for visible stay-card changes', () => {
  const result = applyAccommodationPatch(
    {
      ...sampleTrip,
      markdown_source: '# Scotland\n\n## Hotels\n\nGrasshopper Hotel Glasgow.',
    },
    'days[0].accommodation',
    { name: 'voco Grand Central Glasgow', note: 'Better fit for a dog-friendly Glasgow base.' },
    'same_current_name'
  );

  assert.equal(result.ok, true);
  if (!result.ok) return;

  assert.equal(result.markdownSourceUpdated, true);
  assert.match(result.next.markdown_source ?? '', /OURTRIPS_AGENT_NOTES_START/);
  assert.match(result.next.markdown_source ?? '', /Hotel\/stay: Grasshopper Hotel Glasgow -> voco Grand Central Glasgow/);
  assert.match(result.next.markdown_source ?? '', /Better fit for a dog-friendly Glasgow base/);
  assert.match(result.next.markdown_source ?? '', /Day 1 .*voco Grand Central Glasgow/);
  assert.match(result.next.markdown_source ?? '', /Day 2 .*voco Grand Central Glasgow/);
  assert.equal((result.next.markdown_source?.match(/path: days\[[01]\]\.accommodation/g) ?? []).length, 2);
});

test('applyAccommodationDetailPatch rejects stale or non-accommodation paths', () => {
  assert.equal(
    applyAccommodationDetailPatch(sampleTrip, 'days[42].accommodation', {
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

test('upsertAccommodationAgentNote replaces an existing note for the same hotel path', () => {
  const first = upsertAccommodationAgentNote('# Trip', {
    dayNumber: 3,
    date: '2026-04-26',
    name: 'Bridge of Orchy Hotel',
    path: 'days[2].accommodation',
    detailPatch: { dog_note: 'Dogs not checked yet.' },
  });
  const second = upsertAccommodationAgentNote(first, {
    dayNumber: 3,
    date: '2026-04-26',
    name: 'Bridge of Orchy Hotel',
    path: 'days[2].accommodation',
    detailPatch: { dog_note: 'Dogs allowed in selected rooms.' },
  });

  assert.match(second, /Dogs allowed in selected rooms/);
  assert.doesNotMatch(second, /Dogs not checked yet/);
  assert.equal((second.match(/## OurTrips agent notes/g) ?? []).length, 1);
  assert.equal((second.match(/path: days\[2\]\.accommodation/g) ?? []).length, 1);
});

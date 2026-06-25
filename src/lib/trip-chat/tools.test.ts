import { test } from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import type { TripData } from '@/lib/types';
import { _internal } from './tools';
import { TRIP_EDITOR_TOOL_NAMES } from './tool-names';

const {
  applyAccommodationPatch,
  applyAccommodationDetailPatch,
  buildAccommodationCascadeReview,
  buildPolicySearchQuery,
  collectAccommodations,
  CompleteMissingImagesInputShape,
  CreateAccommodationCandidateInputShape,
  DeleteAccommodationInputShape,
  DeleteActivityInputShape,
  DeleteDayInputShape,
  extractPolicySnippets,
  inferPolicyFromText,
  ReplaceAccommodationInputShape,
  ReplaceBookedAccommodationCandidateInputShape,
  ReplaceDayInputShape,
  ReplaceDaySectionInputShape,
  SaveTripImageAssetInputShape,
  SearchTripImagesInputShape,
  SetTripImageInputShape,
  SyncMarkdownSourceInputShape,
  TruncateDaysAfterInputShape,
  UpdateAccommodationCandidateInputShape,
  UpdateFromMarkdownInputShape,
  UpsertAccommodationInputShape,
  UpsertActivityInputShape,
  upsertAccommodationAgentNote,
  upsertDayItemAgentNote,
  UpsertMealInputShape,
  UpsertTransportInputShape,
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

test('focused day item schemas support activities, meals, and transport edits', () => {
  const activitySchema = z.object(UpsertActivityInputShape);
  assert.equal(
    activitySchema.safeParse({
      day_number: 2,
      activity: {
        time_label: 'Afternoon',
        type: 'museum',
        content: 'Visit Kelvingrove Art Gallery and Museum.',
        place: { name: 'Kelvingrove Art Gallery and Museum' },
        detail: { why: 'A strong rainy-day anchor with a broad collection.' },
      },
    }).success,
    true
  );

  const mealSchema = z.object(UpsertMealInputShape);
  assert.equal(
    mealSchema.safeParse({
      day_number: 2,
      meal: {
        type: 'dinner',
        name: 'Ox and Finch',
        booking_status: 'open',
        reservation_required: true,
        detail: { cuisine: 'Modern Scottish', booking_note: 'Reserve ahead.' },
      },
    }).success,
    true
  );

  const transportSchema = z.object(UpsertTransportInputShape);
  assert.equal(
    transportSchema.safeParse({
      day_number: 3,
      transport: {
        mode: 'train',
        label: 'ScotRail to Bridge of Orchy',
        from: 'Glasgow Queen Street',
        to: 'Bridge of Orchy',
      },
      match: { label: 'ScotRail to Bridge of Orchy' },
    }).success,
    true
  );

  const deleteSchema = z.object(DeleteActivityInputShape);
  assert.equal(
    deleteSchema.safeParse({
      day_number: 2,
      match: { title: 'Kelvingrove Art Gallery and Museum' },
    }).success,
    true
  );
});

test('internal agent allowlist includes focused parity tools', () => {
  const names = new Set(TRIP_EDITOR_TOOL_NAMES);
  for (const name of [
    'mcp__trip_editor__upsert_accommodation',
    'mcp__trip_editor__delete_accommodation',
    'mcp__trip_editor__replace_accommodation',
    'mcp__trip_editor__replace_day_section',
    'mcp__trip_editor__replace_day',
    'mcp__trip_editor__delete_day',
    'mcp__trip_editor__truncate_days_after',
    'mcp__trip_editor__sync_markdown_source',
    'mcp__trip_editor__update_from_markdown',
    'mcp__trip_editor__replace_booked_accommodation_candidate',
    'mcp__trip_editor__get_trip_image_prompts',
    'mcp__trip_editor__save_trip_image_asset',
  ]) {
    assert.equal(names.has(name), true, `${name} should be allowed`);
  }
});

test('focused accommodation schemas support add, delete, and replace edits', () => {
  const upsertSchema = z.object(UpsertAccommodationInputShape);
  assert.equal(
    upsertSchema.safeParse({
      day_number: 2,
      accommodation: {
        name: 'Kimpton Blythswood Square',
        status: 'booked',
        detail: { check_in: '15:00', address: '11 Blythswood Square, Glasgow' },
      },
      scope: 'matching_accommodation_name',
    }).success,
    true
  );

  const deleteSchema = z.object(DeleteAccommodationInputShape);
  assert.equal(
    deleteSchema.safeParse({
      day_number: 2,
      match: { name: 'Grasshopper Hotel Glasgow' },
    }).success,
    true
  );

  const replaceSchema = z.object(ReplaceAccommodationInputShape);
  assert.equal(
    replaceSchema.safeParse({
      day_number: 2,
      accommodation: {
        name: 'Dakota Glasgow',
        detail: { parking: 'Check valet availability directly.' },
      },
    }).success,
    true
  );
});

test('structural day and markdown schemas support safe rewrites', () => {
  assert.equal(
    z.object(ReplaceDaySectionInputShape).safeParse({
      day_number: 3,
      section: 'meals',
      value: [{ type: 'dinner', name: 'Cail Bruich' }],
    }).success,
    true
  );
  assert.equal(
    z.object(ReplaceDayInputShape).safeParse({
      day_number: 3,
      day: {
        date: '2026-04-26',
        title: 'Glasgow -> Fort William',
        blocks: [],
        tips: [{ title: 'Rail timing', content: 'Keep the connection relaxed.' }],
      },
    }).success,
    true
  );
  assert.equal(z.object(DeleteDayInputShape).safeParse({ day_number: 5 }).success, true);
  assert.equal(
    z.object(TruncateDaysAfterInputShape).safeParse({ keep_through_day_number: 7 }).success,
    true
  );
  assert.equal(
    z.object(SyncMarkdownSourceInputShape).safeParse({
      markdown_source: '# Updated original plan',
      expected_current_hash: 'abc123',
    }).success,
    true
  );
  assert.equal(
    z.object(UpdateFromMarkdownInputShape).safeParse({
      markdown_source: '# Updated original plan',
      trip: { summary: 'A revised Highland trip.' },
      days: [{ day_number: 1, title: 'Arrival' }],
      mode: 'merge',
    }).success,
    true
  );
});

test('image tool schemas support search, single set, and bulk completion', () => {
  const searchSchema = z.object(SearchTripImagesInputShape);
  assert.equal(
    searchSchema.safeParse({
      query: 'Glasgow Scotland travel photography',
      orientation: 'landscape',
    }).success,
    true
  );

  const setSchema = z.object(SetTripImageInputShape);
  assert.equal(
    setSchema.safeParse({
      target: 'day_hero',
      day_number: 2,
      url: 'https://images.unsplash.com/photo-abc?w=800&h=500&fit=crop&q=80',
      download_url: 'https://api.unsplash.com/photos/abc/download',
    }).success,
    true
  );

  const completeSchema = z.object(CompleteMissingImagesInputShape);
  assert.equal(
    completeSchema.safeParse({
      include_overview: true,
      max_updates: 12,
    }).success,
    true
  );
  assert.equal(
    completeSchema.safeParse({
      max_updates: 999,
    }).success,
    false
  );
});

test('generated image asset and booked-stay replacement schemas are available', () => {
  assert.equal(
    z.object(SaveTripImageAssetInputShape).safeParse({
      slot: 'cover_portrait',
      asset: {
        url: 'https://cdn.example.com/trips/cover.png',
        prompt: 'Editorial travel cover',
        aspect_ratio: '4:5',
        width: 1200,
        height: 1500,
        source: 'imagegen',
      },
    }).success,
    true
  );

  assert.equal(
    z.object(ReplaceBookedAccommodationCandidateInputShape).safeParse({
      candidate_id: 'stay-kimpton-blythswood-square',
      booking: {
        source: 'direct',
        confirmation: 'Do not invent real refs in production',
        price: 'EUR 210/night',
        note: 'Traveler chose this hotel instead.',
      },
      message: 'Traveler chose this hotel instead.',
    }).success,
    true
  );
});

test('day item agent notes are upserted into markdown_source', () => {
  const first = upsertDayItemAgentNote('# Scotland\n\nOriginal plan.', {
    kind: 'activity',
    action: 'upserted',
    dayNumber: 2,
    date: '2026-04-25',
    path: 'days[day_number=2].blocks[1]',
    item: {
      time_label: 'Afternoon',
      type: 'museum',
      content: 'Visit Kelvingrove Art Gallery and Museum.',
      detail: { title: 'Kelvingrove Art Gallery and Museum' },
    },
  });

  assert.match(first, /OURTRIPS_AGENT_NOTES_START/);
  assert.match(first, /Programme item/);
  assert.match(first, /Kelvingrove Art Gallery and Museum/);
  assert.match(first, /path: days\[day_number=2\]\.blocks\[1\]/);

  const second = upsertDayItemAgentNote(first, {
    kind: 'activity',
    action: 'upserted',
    dayNumber: 2,
    date: '2026-04-25',
    path: 'days[day_number=2].blocks[1]',
    item: {
      time_label: 'Late afternoon',
      type: 'museum',
      content: 'Visit Kelvingrove before dinner.',
      detail: { title: 'Kelvingrove Art Gallery and Museum' },
    },
  });

  assert.equal((second.match(/path: days\[day_number=2\]\.blocks\[1\]/g) ?? []).length, 1);
  assert.match(second, /Late afternoon/);
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
  assert.equal(result.cascadeReview, null);
  assert.equal(result.markdownSourceUpdated, false);
});

test('applyAccommodationDetailPatch requires cascade review when address changes', () => {
  const result = applyAccommodationDetailPatch(sampleTrip, 'days[0].accommodation', {
    address: '99 Gordon Street, Glasgow',
  });

  assert.equal(result.ok, true);
  if (!result.ok) return;

  assert.deepEqual(result.cascadeReview?.changed_day_numbers, [1]);
  assert.deepEqual(result.cascadeReview?.review_day_numbers, [1, 2]);
  assert.deepEqual(result.cascadeReview?.changed_fields, [
    'days[day_number=1].accommodation.detail.address',
  ]);
  assert.match(result.cascadeReview?.reason ?? '', /old hotel base/);
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
  assert.deepEqual(result.cascadeReview?.changed_day_numbers, [1, 2]);
  assert.deepEqual(result.cascadeReview?.review_day_numbers, [1, 2, 3]);
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
  assert.equal(result.cascadeReview, null);
  assert.equal(result.next.days[0].accommodation?.note, undefined);
  assert.equal(result.next.days[1].accommodation?.note, 'Late checkout requested.');
});

test('buildAccommodationCascadeReview detects itinerary-wide accommodation replacements', () => {
  const nextTrip: TripData = {
    ...sampleTrip,
    days: sampleTrip.days.map((day) =>
      day.day_number === 3
        ? {
            ...day,
            accommodation: {
              name: 'Forest Lodge',
              detail: { address: 'Glen Orchy, Argyll' },
            },
          }
        : day
    ),
  };

  const cascadeReview = buildAccommodationCascadeReview(sampleTrip, nextTrip);

  assert.deepEqual(cascadeReview?.changed_day_numbers, [3]);
  assert.deepEqual(cascadeReview?.review_day_numbers, [3]);
  assert.deepEqual(cascadeReview?.changed_fields, [
    'days[day_number=3].accommodation.name',
    'days[day_number=3].accommodation.detail.address',
  ]);
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

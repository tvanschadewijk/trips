import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { TripData } from '@/lib/types';
import { _internal } from './fast-lane';

const {
  applyFastLaneEdit,
  isFastLaneCandidate,
  parseClockTime,
  upsertFastLaneAgentNote,
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
        status: 'open',
        booking_status: 'open',
        nights: 2,
      },
    },
    {
      day_number: 2,
      date: '2026-04-25',
      title: 'Glasgow',
      meals: [
        {
          type: 'dinner',
          name: 'Ox and Finch',
          reservation_required: true,
          booking_status: 'open',
          status: 'open',
        },
      ],
      accommodation: {
        name: 'Grasshopper Hotel Glasgow',
        status: 'open',
        booking_status: 'open',
        nights: 1,
        note: 'Night 2 of 2',
      },
    },
  ],
  markdown_source: '# Scotland\n\n## Day 2\n\nGlasgow day.',
};

test('parseClockTime normalizes 12-hour and 24-hour inputs', () => {
  assert.equal(parseClockTime('7pm'), '19:00');
  assert.equal(parseClockTime('7:30 p.m.'), '19:30');
  assert.equal(parseClockTime('19.45'), '19:45');
  assert.equal(parseClockTime('noon'), '12:00');
});

test('isFastLaneCandidate cheaply separates scoped edits from deep-agent work', () => {
  assert.equal(
    isFastLaneCandidate('rename this day to Slow Glasgow', {
      slideKind: 'day',
      day_number: 2,
    }),
    true
  );
  assert.equal(
    isFastLaneCandidate('make day 2 more relaxed', {
      slideKind: 'day',
      day_number: 2,
    }),
    false
  );
  assert.equal(
    isFastLaneCandidate('find a better hotel for every stay', {
      slideKind: 'day',
      day_number: 2,
    }),
    false
  );
});

test('fast lane updates the current day title and records a markdown note', () => {
  const result = applyFastLaneEdit(sampleTrip, 'rename this day to Slow Glasgow', {
    slideKind: 'day',
    day_number: 2,
  });

  assert.equal(result?.ok, true);
  if (!result || !result.ok) return;

  assert.equal(result.next.days[0].title, 'Amsterdam -> Glasgow');
  assert.equal(result.next.days[1].title, 'Slow Glasgow');
  assert.deepEqual(result.changedPaths, [
    'days[day_number=2].title',
    'markdown_source',
  ]);
  assert.match(result.next.markdown_source ?? '', /Fast lane: updated Day 2 title/);
  assert.match(result.next.markdown_source ?? '', /path: days\[day_number=2\]\.title/);
});

test('fast lane updates trip fields from the cover context', () => {
  const result = applyFastLaneEdit(sampleTrip, 'change subtitle to Glasgow in slow motion', {
    slideKind: 'cover',
  });

  assert.equal(result?.ok, true);
  if (!result || !result.ok) return;

  assert.equal(result.next.trip.subtitle, 'Glasgow in slow motion');
  assert.equal(result.rowName, undefined);
  assert.match(result.assistantText, /Updated the trip subtitle/);
});

test('fast lane moves a scoped dinner time without touching other trip data', () => {
  const result = applyFastLaneEdit(sampleTrip, 'move dinner to 7pm', {
    slideKind: 'day',
    day_number: 2,
  });

  assert.equal(result?.ok, true);
  if (!result || !result.ok) return;

  const dinner = result.next.days[1].meals?.[0];
  assert.equal(dinner?.starts_at, '19:00');
  assert.equal(dinner?.time_precision, 'suggested');
  assert.equal(result.next.days[0].title, 'Amsterdam -> Glasgow');
});

test('fast lane marks a meal as booked via the action-item status helper', () => {
  const result = applyFastLaneEdit(sampleTrip, 'set dinner to booked', {
    slideKind: 'day',
    day_number: 2,
  });

  assert.equal(result?.ok, true);
  if (!result || !result.ok) return;

  const dinner = result.next.days[1].meals?.[0];
  assert.equal(dinner?.status, 'booked');
  assert.equal(dinner?.booking_status, 'booked');
});

test('fast lane treats setting a hotel to booked as a status edit, not a rename', () => {
  const result = applyFastLaneEdit(sampleTrip, 'set hotel to booked', {
    slideKind: 'day',
    day_number: 1,
  });

  assert.equal(result?.ok, true);
  if (!result || !result.ok) return;

  assert.equal(result.next.days[0].accommodation?.name, 'Grasshopper Hotel Glasgow');
  assert.equal(result.next.days[0].accommodation?.status, 'booked');
  assert.equal(result.next.days[0].accommodation?.booking_status, 'booked');
  assert.equal(result.next.days[1].accommodation?.status, 'booked');
  assert.equal(result.next.days[1].accommodation?.booking_status, 'booked');
});

test('fast lane declines hotel renames so the deep agent can review nearby days', () => {
  const result = applyFastLaneEdit(sampleTrip, 'rename hotel to voco Grand Central Glasgow', {
    slideKind: 'day',
    day_number: 1,
  });

  assert.equal(result, null);
});

test('fast lane declines broad editorial rewrites so the deep agent can handle them', () => {
  assert.equal(
    applyFastLaneEdit(sampleTrip, 'make day 2 more relaxed', {
      slideKind: 'day',
      day_number: 2,
    }),
    null
  );
});

test('upsertFastLaneAgentNote replaces notes for the same path', () => {
  const first = upsertFastLaneAgentNote(
    '# Trip',
    'days[day_number=2].title',
    'updated Day 2 title to "A"'
  );
  const second = upsertFastLaneAgentNote(
    first,
    'days[day_number=2].title',
    'updated Day 2 title to "B"'
  );

  assert.match(second, /updated Day 2 title to "B"/);
  assert.doesNotMatch(second, /updated Day 2 title to "A"/);
  assert.equal((second.match(/## OurTrips agent notes/g) ?? []).length, 1);
});

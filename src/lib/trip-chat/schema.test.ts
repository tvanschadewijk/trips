/**
 * Smoke tests for the UpdateTripInput Zod schema.
 *
 * The schema is the sole gate between agent output and a DB write; if it
 * accepts something it shouldn't, an admin's "swap day 3" ends up writing to
 * a field it shouldn't. These tests lock down:
 *
 *   - happy path: realistic "make day 2 more relaxed" shape accepts.
 *   - unknown top-level keys rejected (physical protection, not just naming).
 *   - empty object rejected (no-op edits shouldn't even reach the DB).
 *   - immutable DB columns (user_id, id, share_id) can't be addressed by name
 *     because they are not in the schema at all.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GetTripInputSchema, UpdateTripInputSchema } from './schema';

test('accepts a realistic trip-meta edit', () => {
  const result = UpdateTripInputSchema.safeParse({
    trip: {
      summary: 'Seoul wakes up slowly on a Wednesday; start at Gwangjang Market.',
      subtitle: 'Five days, four neighborhoods, one bowl of pork bone soup.',
    },
  });
  assert.equal(result.success, true, result.success ? '' : JSON.stringify(result.error.issues));
});

test('accepts a full-days replacement', () => {
  const result = UpdateTripInputSchema.safeParse({
    days: [
      {
        day_number: 1,
        date: '2026-05-01',
        title: 'Arrival',
        description_title: 'First landing',
        description: 'Keep the first day easy: arrive, transfer cleanly, and save the city for tomorrow.',
        blocks: [
          { time_label: 'Morning', type: 'travel', content: 'Land at ICN' },
        ],
      },
      {
        day_number: 2,
        date: '2026-05-02',
        title: 'A slower day',
        blocks: [
          { time_label: 'Late morning', type: 'walk', content: 'Ihwa Mural Village' },
        ],
      },
    ],
  });
  assert.equal(result.success, true, result.success ? '' : JSON.stringify(result.error.issues));
});

test('rejects impossible calendar dates', () => {
  const result = UpdateTripInputSchema.safeParse({
    days: [
      {
        day_number: 1,
        date: '2026-02-31',
        title: 'Impossible day',
      },
    ],
  });
  assert.equal(result.success, false);
});

test('accepts day intro without programme blocks', () => {
  const result = UpdateTripInputSchema.safeParse({
    days: [
      {
        day_number: 1,
        date: '2026-05-01',
        title: 'Opening Drive',
        description_title: 'Long Opening Drive',
        description:
          'This is the one monster road day that buys the whole southern arc.',
      },
    ],
  });
  assert.equal(result.success, true, result.success ? '' : JSON.stringify(result.error.issues));
});

test('rejects empty input (must touch something)', () => {
  const result = UpdateTripInputSchema.safeParse({});
  assert.equal(result.success, false);
});

test('rejects unknown top-level keys (belt-and-suspenders vs. DB-column mutation)', () => {
  const forbidden = ['id', 'user_id', 'share_id', 'created_at', 'updated_at', 'name', 'share_mode'];
  for (const key of forbidden) {
    const result = UpdateTripInputSchema.safeParse({ [key]: 'nefarious' });
    assert.equal(
      result.success,
      false,
      `schema must reject top-level key '${key}' (got success)`
    );
  }
});

test('rejects arbitrary extra top-level keys', () => {
  const result = UpdateTripInputSchema.safeParse({
    trip: { summary: 'fine' },
    __proto__: { evil: true },
    evil: true,
  });
  assert.equal(result.success, false);
});

test('accepts passthrough on inner fields (trip.* schemas are permissive)', () => {
  const result = UpdateTripInputSchema.safeParse({
    trip: {
      summary: 'fine',
      // some trip-level field we haven't modeled explicitly — passes through
      future_field: 'ok',
    },
  });
  assert.equal(result.success, true);
});

test('accepts structured trip image assets', () => {
  const result = UpdateTripInputSchema.safeParse({
    trip: {
      image_assets: {
        cover_portrait: {
          url: 'https://example.com/cover.png',
          prompt: 'Create a route-first editorial map.',
          aspect_ratio: '9:16',
          width: 1080,
          height: 1920,
          provider: 'openai',
          source: 'imagegen',
        },
      },
    },
  });
  assert.equal(result.success, true, result.success ? '' : JSON.stringify(result.error.issues));
});

test('accepts structured route points for the editorial atlas', () => {
  const result = UpdateTripInputSchema.safeParse({
    trip: {
      route_points: [
        { label: 'Amsterdam', lat: 52.3676, lng: 4.9041, role: 'home' },
        { label: 'London', lat: 51.5072, lng: -0.1276, mode: 'train' },
      ],
    },
  });
  assert.equal(result.success, true, result.success ? '' : JSON.stringify(result.error.issues));
});

test('get_trip reads default to a compact summary view', () => {
  const result = GetTripInputSchema.safeParse({});
  assert.equal(result.success, true, result.success ? '' : JSON.stringify(result.error.issues));
  if (!result.success) return;

  assert.equal(result.data.view, 'summary');
});

test('get_trip supports focused day and sections reads', () => {
  const day = GetTripInputSchema.safeParse({
    view: 'day',
    day_number: 3,
  });
  assert.equal(day.success, true, day.success ? '' : JSON.stringify(day.error.issues));

  const sections = GetTripInputSchema.safeParse({
    view: 'sections',
    sections: ['quality', 'logistics'],
  });
  assert.equal(
    sections.success,
    true,
    sections.success ? '' : JSON.stringify(sections.error.issues)
  );
});

test('get_trip rejects unknown read sections and arbitrary keys', () => {
  assert.equal(
    GetTripInputSchema.safeParse({
      view: 'sections',
      sections: ['secrets'],
    }).success,
    false
  );

  assert.equal(
    GetTripInputSchema.safeParse({
      view: 'summary',
      trip_id: 'other-trip',
    }).success,
    false
  );
});

test('rejects non-ISO date at trip.dates.start', () => {
  const result = UpdateTripInputSchema.safeParse({
    trip: {
      dates: { start: '', end: '2026-05-05' },
    },
  });
  assert.equal(result.success, false);
});

test('accepts markdown_source alone (clears or rewrites the markdown)', () => {
  const result = UpdateTripInputSchema.safeParse({
    markdown_source: '# Scotland\n\nUpdated by chat.',
  });
  assert.equal(result.success, true, result.success ? '' : JSON.stringify(result.error.issues));
});

test('accepts trip + markdown_source together (the two-way sync path)', () => {
  const result = UpdateTripInputSchema.safeParse({
    trip: { subtitle: 'New subtitle' },
    markdown_source: '# Trip\n\nNew subtitle: New subtitle.',
  });
  assert.equal(result.success, true, result.success ? '' : JSON.stringify(result.error.issues));
});

test('accepts an empty markdown_source string (means: clear it)', () => {
  const result = UpdateTripInputSchema.safeParse({
    markdown_source: '',
  });
  assert.equal(result.success, true);
});

test('rejects markdown_source over the 256 KB cap', () => {
  const result = UpdateTripInputSchema.safeParse({
    markdown_source: 'x'.repeat(262145),
  });
  assert.equal(result.success, false);
});

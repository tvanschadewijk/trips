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
import { UpdateTripInputSchema } from './schema';

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

test('rejects empty input (must touch something)', () => {
  const result = UpdateTripInputSchema.safeParse({});
  assert.equal(result.success, false);
});

test('rejects unknown top-level keys (belt-and-suspenders vs. DB-column mutation)', () => {
  const forbidden = ['id', 'user_id', 'share_id', 'created_at', 'updated_at', 'name', 'is_public'];
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

test('rejects non-ISO date at trip.dates.start', () => {
  const result = UpdateTripInputSchema.safeParse({
    trip: {
      dates: { start: '', end: '2026-05-05' },
    },
  });
  assert.equal(result.success, false);
});

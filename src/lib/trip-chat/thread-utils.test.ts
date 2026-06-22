import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  THREAD_STALE_AFTER_MS,
  groupThreadsByRecency,
  inferThreadContextFromTitle,
  isThreadCompatibleWithViewContext,
  isThreadStale,
  threadRecencyGroup,
  threadContextForViewContext,
} from './thread-utils';

const NOW = Date.parse('2026-06-09T12:00:00Z');

test('a thread active within 24h is not stale', () => {
  assert.equal(isThreadStale('2026-06-09T01:00:00Z', NOW), false);
});

test('a thread idle for more than 24h is stale', () => {
  const justOver = NOW - THREAD_STALE_AFTER_MS - 1000;
  assert.equal(isThreadStale(new Date(justOver).toISOString(), NOW), true);
});

test('an unparsable updated_at counts as stale', () => {
  assert.equal(isThreadStale('not-a-date', NOW), true);
});

test('threadRecencyGroup buckets by local day boundaries', () => {
  // NOW is mid-day; same-day timestamps are Today regardless of hour.
  assert.equal(threadRecencyGroup(new Date(NOW - 60_000).toISOString(), NOW), 'Today');
  assert.equal(
    threadRecencyGroup(new Date(NOW - 36 * 60 * 60 * 1000).toISOString(), NOW),
    'Yesterday'
  );
  assert.equal(
    threadRecencyGroup(new Date(NOW - 4 * 24 * 60 * 60 * 1000).toISOString(), NOW),
    'This week'
  );
  assert.equal(
    threadRecencyGroup(new Date(NOW - 30 * 24 * 60 * 60 * 1000).toISOString(), NOW),
    'Earlier'
  );
});

test('groupThreadsByRecency preserves order and omits empty groups', () => {
  const mk = (id: string, hoursAgo: number) => ({
    id,
    title: id,
    created_at: new Date(NOW - hoursAgo * 3600_000).toISOString(),
    updated_at: new Date(NOW - hoursAgo * 3600_000).toISOString(),
  });
  const groups = groupThreadsByRecency([mk('a', 1), mk('b', 2), mk('c', 200)], NOW);
  assert.deepEqual(
    groups.map((g) => g.group),
    ['Today', 'Earlier']
  );
  assert.deepEqual(groups[0].threads.map((t) => t.id), ['a', 'b']);
  assert.deepEqual(groups[1].threads.map((t) => t.id), ['c']);
});

test('threadContextForViewContext scopes day chats by itinerary day number', () => {
  assert.deepEqual(
    threadContextForViewContext({
      slideKind: 'day',
      day_number: 2,
      date: '2026-06-28',
      title: 'Lake Como',
    }),
    { key: 'day:2', label: 'Day 2 · 28 Jun' }
  );
});

test('threadContextForViewContext scopes overview and accommodation contexts', () => {
  assert.deepEqual(threadContextForViewContext({ slideKind: 'cover' }), {
    key: 'overview',
    label: 'Overview',
  });
  assert.deepEqual(
    threadContextForViewContext({
      slideKind: 'accommodation_review',
      destination_id: 'como',
      destination_title: 'Como / Brunate',
    }),
    { key: 'accommodation_review:como', label: 'Hotels · Como / Brunate' }
  );
});

test('inferThreadContextFromTitle preserves legacy day threads', () => {
  assert.deepEqual(inferThreadContextFromTitle('Day 3 · Lake plans'), {
    key: 'day:3',
    label: 'Day 3',
  });
});

test('isThreadCompatibleWithViewContext rejects a different day thread', () => {
  const thread = {
    id: 'a',
    title: 'Day 2 · Lake plans',
    created_at: new Date(NOW).toISOString(),
    updated_at: new Date(NOW).toISOString(),
  };

  assert.equal(
    isThreadCompatibleWithViewContext(thread, { slideKind: 'day', day_number: 2 }),
    true
  );
  assert.equal(
    isThreadCompatibleWithViewContext(thread, { slideKind: 'day', day_number: 3 }),
    false
  );
});

test('explicit thread context survives user-renamed titles', () => {
  const thread = {
    id: 'a',
    title: 'Swimming ideas',
    context_key: 'day:2',
    context_label: 'Day 2 · 28 Jun',
    created_at: new Date(NOW).toISOString(),
    updated_at: new Date(NOW).toISOString(),
  };

  assert.equal(
    isThreadCompatibleWithViewContext(thread, { slideKind: 'day', day_number: 2 }),
    true
  );
});

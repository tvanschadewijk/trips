import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  THREAD_STALE_AFTER_MS,
  groupThreadsByRecency,
  isThreadStale,
  threadRecencyGroup,
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

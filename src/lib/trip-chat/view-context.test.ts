import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatViewContextPrefix } from './view-context';

test('day view context spells out the authoritative weekday from the ISO date', () => {
  const prefix = formatViewContextPrefix({
    slideKind: 'day',
    day_number: 2,
    date: '2026-06-28',
    title: 'Lake Como / Brunate',
  });

  assert.match(prefix, /Day 2: Sunday, 28 June 2026 \(ISO 2026-06-28\)/);
  assert.match(prefix, /calendar source of truth/);
  assert.doesNotMatch(prefix, /Friday/);
});

test('day view context does not echo impossible calendar dates', () => {
  const prefix = formatViewContextPrefix({
    slideKind: 'day',
    day_number: 2,
    date: '2026-02-30',
    title: 'Lake Como / Brunate',
  });

  assert.match(prefix, /Day 2 - "Lake Como \/ Brunate"/);
  assert.doesNotMatch(prefix, /2026-02-30/);
});

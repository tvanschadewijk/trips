import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  applyActionItemStatusToTripData,
  normalizeActionItemStatus,
  normalizeActionItemType,
} from './trip-action-items';

test('normalizes action item status values', () => {
  assert.equal(normalizeActionItemStatus('booked'), 'booked');
  assert.equal(normalizeActionItemStatus('pending'), 'open');
  assert.equal(normalizeActionItemStatus('open'), 'open');
  assert.equal(normalizeActionItemStatus('cancelled'), null);
});

test('normalizes action item types', () => {
  assert.equal(normalizeActionItemType('transport'), 'transport');
  assert.equal(normalizeActionItemType('accommodation'), 'accommodation');
  assert.equal(normalizeActionItemType('meal'), 'meal');
  assert.equal(normalizeActionItemType('service'), null);
});

test('updates a transport action item status', () => {
  const data = {
    days: [
      {
        day_number: 1,
        transport: [
          { label: 'Drive to Como', status: 'open' },
          { label: 'Ferry', status: 'open' },
        ],
      },
    ],
  };

  const result = applyActionItemStatusToTripData(data, {
    dayNumber: 1,
    itemType: 'transport',
    itemIndex: 1,
    status: 'booked',
  });

  assert.deepEqual(result, { ok: true, status: 'booked' });
  assert.equal(data.days[0].transport[0].status, 'open');
  assert.equal(data.days[0].transport[1].status, 'booked');
});

test('updates all matching accommodation nights for one stay', () => {
  const data = {
    days: [
      {
        day_number: 1,
        accommodation: { name: 'Como listed hotel', status: 'open' },
      },
      {
        day_number: 2,
        accommodation: { name: 'Como listed hotel', status: 'open' },
      },
      {
        day_number: 3,
        accommodation: { name: 'Bologna hotel', status: 'open' },
      },
    ],
  };

  const result = applyActionItemStatusToTripData(data, {
    dayNumber: 1,
    itemType: 'accommodation',
    itemIndex: 0,
    status: 'booked',
  });

  assert.deepEqual(result, { ok: true, status: 'booked' });
  assert.equal(data.days[0].accommodation.status, 'booked');
  assert.equal(data.days[1].accommodation.status, 'booked');
  assert.equal(data.days[2].accommodation.status, 'open');
});

test('rejects missing action items without mutating other days', () => {
  const data = {
    days: [
      {
        day_number: 1,
        transport: [{ label: 'Drive to Como', status: 'open' }],
      },
    ],
  };

  const result = applyActionItemStatusToTripData(data, {
    dayNumber: 1,
    itemType: 'transport',
    itemIndex: 3,
    status: 'booked',
  });

  assert.equal(result.ok, false);
  assert.equal(data.days[0].transport[0].status, 'open');
});

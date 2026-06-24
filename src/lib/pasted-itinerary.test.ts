import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inferPastedItineraryDetails } from './pasted-itinerary';

test('infers destination and ISO date range from pasted markdown', () => {
  const details = inferPastedItineraryDetails(`
# Japan itinerary

Dates: 2026-09-01 to 2026-09-10
Travelers: Alex, Sam
`);

  assert.equal(details.destination, 'Japan');
  assert.equal(details.start_date, '2026-09-01');
  assert.equal(details.end_date, '2026-09-10');
  assert.equal(details.travelers, 'Alex, Sam');
});

test('infers a same-month natural-language range', () => {
  const details = inferPastedItineraryDetails(`
Trip: Sicily
July 3-11, 2026
`);

  assert.equal(details.destination, 'Sicily');
  assert.equal(details.start_date, '2026-07-03');
  assert.equal(details.end_date, '2026-07-11');
});

test('uses the earliest and latest complete dates when no explicit range is present', () => {
  const details = inferPastedItineraryDetails(`
## Amsterdam to Rome road trip
- Day 1: May 3, 2027 - Amsterdam
- Day 8: May 10, 2027 - Rome
`);

  assert.equal(details.destination, 'Amsterdam to Rome road');
  assert.equal(details.start_date, '2027-05-03');
  assert.equal(details.end_date, '2027-05-10');
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_GENERATION_DAYS,
  TripCreationBriefSchema,
  assertBriefDateRange,
  buildStarterTripInput,
  buildTripGenerationAgentMessage,
  inclusiveDayCount,
} from './trip-creation';
import { normalizeTravelProfilePreferences } from './travel-profile';

const brief = TripCreationBriefSchema.parse({
  destination: 'Japan',
  start_date: '2026-09-01',
  end_date: '2026-09-06',
  travelers: 'Alex, Thijs',
  origin: 'Amsterdam',
  must_do: 'Naoshima',
  known_bookings: '',
  budget: 'Mid-range',
  pace: 'from_profile',
  notes: 'Prefer trains.',
});

test('counts inclusive itinerary days', () => {
  assert.equal(inclusiveDayCount('2026-09-01', '2026-09-06'), 6);
});

test('builds a valid starter trip input for the existing save service', () => {
  const input = buildStarterTripInput(brief, 'Japan Trip');
  const trip = input.trip as { name: string; dates: { start: string; end: string } };
  const days = input.days as Array<{
    day_number: number;
    date: string;
    accommodation: { name: string } | null;
  }>;

  assert.equal(input.trip_schema_version, 2);
  assert.equal(input.strict_quality, false);
  assert.equal(trip.name, 'Japan Trip');
  assert.equal(trip.dates.start, '2026-09-01');
  assert.equal(trip.dates.end, '2026-09-06');
  assert.equal(days.length, 6);
  assert.equal(days[0].day_number, 1);
  assert.equal(days[0].date, '2026-09-01');
  assert.equal(days[4].accommodation?.name, 'Hotel not confirmed yet');
  assert.equal(days[5].accommodation, null);
});

test('builds a scratch-generation agent message with hard date requirements', () => {
  const message = buildTripGenerationAgentMessage(brief, {
    user_id: 'user-1',
    preferences: normalizeTravelProfilePreferences({ pace: 'relaxed' }),
    reference_markdown: '# Travel Profile\n\n- Preferred pace: relaxed\n',
    reference_generated_at: '2026-06-21T00:00:00.000Z',
    onboarding_completed_at: '2026-06-21T00:00:00.000Z',
  });

  assert.match(message, /Create this new OurTrips itinerary from scratch/);
  assert.match(message, /Keep trip\.dates\.start exactly 2026-09-01/);
  assert.match(message, /create exactly 6 calendar days/);
  assert.match(message, /Preferred pace: relaxed/);
});

test('rejects ranges that are too long for ShipNow generation', () => {
  const longBrief = TripCreationBriefSchema.parse({
    ...brief,
    end_date: '2026-10-15',
  });

  assert.throws(
    () => assertBriefDateRange(longBrief),
    new RegExp(`up to ${MAX_GENERATION_DAYS}`)
  );
});

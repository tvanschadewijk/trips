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

test('uses structured traveler profiles when present', () => {
  const structuredBrief = TripCreationBriefSchema.parse({
    ...brief,
    travelers: 'Fallback',
    traveler_profiles: [
      {
        full_name: 'Alex Morgan',
        date_of_birth: '1990-03-12',
        gender: 'female',
        passport_number: 'NLD1234567',
        passport_country: 'Netherlands',
        passport_expiry: '2031-04-20',
      },
    ],
  });

  const input = buildStarterTripInput(structuredBrief, 'Japan Trip');
  const message = buildTripGenerationAgentMessage(structuredBrief, null);

  assert.deepEqual(input.trip.travelers, ['Alex Morgan']);
  assert.match(message, /Alex Morgan - date of birth 1990-03-12; gender female; passport country Netherlands; passport expires 2031-04-20; passport number on file/);
  assert.doesNotMatch(message, /NLD1234567/);
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

test('includes pasted and uploaded trip references in the generation message', () => {
  const referenceBrief = TripCreationBriefSchema.parse({
    ...brief,
    reference_text: 'Draft route: Tokyo, Kyoto, Naoshima.',
    reference_sources: [
      {
        id: 'ref-1',
        kind: 'file',
        file_name: 'flight-confirmation.pdf',
        content_type: 'application/pdf',
        size: 4096,
        extracted_text: '- Flight AMS to HND arrives 2026-09-02 at 08:15',
        status: 'ready',
        error: '',
      },
    ],
  });

  const message = buildTripGenerationAgentMessage(referenceBrief, null);

  assert.match(message, /Trip reference material/);
  assert.match(message, /Draft route: Tokyo, Kyoto, Naoshima/);
  assert.match(message, /flight-confirmation\.pdf/);
  assert.match(message, /arrives 2026-09-02 at 08:15/);
});

test('rejects a trip that ends on the start date', () => {
  assert.throws(
    () => TripCreationBriefSchema.parse({
      ...brief,
      start_date: '2026-09-01',
      end_date: '2026-09-01',
    }),
    /End date must be after start date/
  );
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

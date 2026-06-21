import { z } from 'zod';
import { ISO_DATE_RE, isIsoDateString } from './trip-logistics';
import type { SaveTripInput } from './trip-service';
import {
  TravelerProfileSchema,
  compactTravelProfileForPrompt,
  legacyTravelersToProfiles,
  type TravelerProfile,
  type TravelProfileRecord,
} from './travel-profile';

const IsoDateSchema = z
  .string()
  .regex(ISO_DATE_RE, 'Use ISO 8601 YYYY-MM-DD.')
  .refine(isIsoDateString, 'Use a real calendar date.');

const BriefTextField = z.string().trim().max(1800).default('');

export const TripCreationBriefSchema = z
  .object({
    destination: z.string().trim().min(2).max(180),
    start_date: IsoDateSchema,
    end_date: IsoDateSchema,
    travelers: BriefTextField,
    traveler_profiles: z.array(TravelerProfileSchema).max(24).default([]),
    origin: BriefTextField,
    must_do: BriefTextField,
    known_bookings: BriefTextField,
    budget: BriefTextField,
    pace: z.enum(['from_profile', 'relaxed', 'balanced', 'full']).default('from_profile'),
    notes: BriefTextField,
  })
  .strict()
  .refine((brief) => compareIsoDates(brief.start_date, brief.end_date) < 0, {
    message: 'End date must be after start date.',
    path: ['end_date'],
  });

export type TripCreationBrief = z.infer<typeof TripCreationBriefSchema>;

export const MAX_GENERATION_DAYS = 31;

const STARTER_HERO_IMAGE =
  'https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?w=1600&h=1000&fit=crop&crop=center&q=85';

function compareIsoDates(a: string, b: string): number {
  return a.localeCompare(b);
}

function parseIsoDate(value: string): Date {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
}

function formatIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function addDaysIso(value: string, days: number): string {
  const date = parseIsoDate(value);
  date.setUTCDate(date.getUTCDate() + days);
  return formatIsoDate(date);
}

export function inclusiveDayCount(startDate: string, endDate: string): number {
  const start = parseIsoDate(startDate).getTime();
  const end = parseIsoDate(endDate).getTime();
  return Math.round((end - start) / 86_400_000) + 1;
}

export function assertBriefDateRange(brief: TripCreationBrief): void {
  const dayCount = inclusiveDayCount(brief.start_date, brief.end_date);
  if (dayCount < 1) {
    throw new Error('Trip date range must include at least one day.');
  }
  if (dayCount > MAX_GENERATION_DAYS) {
    throw new Error(`ShipNow trip generation supports up to ${MAX_GENERATION_DAYS} itinerary days.`);
  }
}

function splitTravelers(value: string): string[] {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function getBriefTravelerProfiles(brief: TripCreationBrief): TravelerProfile[] {
  const structured = brief.traveler_profiles.filter((profile) => profile.full_name.trim());
  if (structured.length) return structured;
  return legacyTravelersToProfiles(brief.travelers);
}

function getBriefTravelerNames(brief: TripCreationBrief): string[] {
  const names = getBriefTravelerProfiles(brief)
    .map((profile) => profile.full_name.trim())
    .filter(Boolean);
  return names.length ? names : splitTravelers(brief.travelers);
}

function starterDayTitle(destination: string, dayNumber: number, dayCount: number): string {
  if (dayNumber === 1) return `${destination} arrival`;
  if (dayNumber === dayCount) return `${destination} departure`;
  return `${destination}, day ${dayNumber}`;
}

export function buildStarterTripInput(
  brief: TripCreationBrief,
  tripName: string
): SaveTripInput {
  assertBriefDateRange(brief);
  const dayCount = inclusiveDayCount(brief.start_date, brief.end_date);
  const nights = Math.max(0, dayCount - 1);
  const travelers = getBriefTravelerNames(brief);

  return {
    trip_schema_version: 2,
    strict_quality: false,
    trip: {
      name: tripName,
      subtitle: `A first OurTrips draft for ${brief.destination}`,
      dates: {
        start: brief.start_date,
        end: brief.end_date,
      },
      travelers,
      summary:
        'A starter itinerary created inside OurTrips. The travel agent is expanding it into a complete day-by-day plan.',
      hero_image: STARTER_HERO_IMAGE,
      overview_image: STARTER_HERO_IMAGE,
      notes: [
        {
          title: 'Generation brief',
          icon: 'sparkles',
          content: `Destination: ${brief.destination}. ${brief.notes || 'No extra notes yet.'}`,
        },
      ],
    },
    days: Array.from({ length: dayCount }, (_, index) => {
      const dayNumber = index + 1;
      const isLastDay = dayNumber === dayCount;
      return {
        day_number: dayNumber,
        date: addDaysIso(brief.start_date, index),
        title: starterDayTitle(brief.destination, dayNumber, dayCount),
        subtitle: isLastDay ? 'Departure and final notes' : 'Being planned now',
        day_type: dayNumber === 1 ? 'arrival' : isLastDay ? 'departure' : 'full',
        pace: brief.pace === 'from_profile' ? 'balanced' : brief.pace,
        description_title: 'Draft in progress',
        description:
          'This day is a placeholder while the OurTrips travel agent builds the full itinerary.',
        blocks: [],
        transport: [],
        accommodation:
          !isLastDay && nights > 0
            ? {
                name: 'Hotel not confirmed yet',
                status: 'open',
                booking_status: 'open',
                nights,
              }
            : null,
        meals: [],
        tips: [
          {
            icon: 'info',
            title: 'Draft day',
            content: 'The travel agent will replace this placeholder with a practical, place-specific tip.',
          },
        ],
      };
    }),
  };
}

function briefLine(label: string, value: string): string | null {
  return value.trim() ? `- ${label}: ${value.trim()}` : null;
}

function genderLabel(profile: TravelerProfile): string | null {
  if (!profile.gender) return null;
  if (profile.gender === 'self_describe') return profile.gender_self_description.trim() || 'self-described';
  if (profile.gender === 'prefer_not_to_say') return 'prefer not to say';
  return profile.gender.replace(/_/g, ' ');
}

function travelerBriefLines(brief: TripCreationBrief): string[] {
  const profiles = getBriefTravelerProfiles(brief);
  if (!profiles.length) {
    const line = briefLine('Travelers', brief.travelers);
    return line ? [line] : [];
  }

  const lines = ['- Travelers:'];
  profiles.forEach((profile) => {
    const details = [
      profile.date_of_birth ? `date of birth ${profile.date_of_birth}` : null,
      genderLabel(profile) ? `gender ${genderLabel(profile)}` : null,
      profile.passport_country.trim() ? `passport country ${profile.passport_country.trim()}` : null,
      profile.passport_expiry ? `passport expires ${profile.passport_expiry}` : null,
      profile.passport_number.trim() ? 'passport number on file for booking forms' : null,
      profile.notes.trim() ? `traveler notes: ${profile.notes.trim()}` : null,
    ].filter((item): item is string => Boolean(item));

    lines.push(`  - ${profile.full_name.trim()}${details.length ? ` - ${details.join('; ')}` : ''}`);
  });

  return lines;
}

export function buildTripGenerationAgentMessage(
  brief: TripCreationBrief,
  profile: TravelProfileRecord | null | undefined
): string {
  const profileContext = compactTravelProfileForPrompt(profile);
  const dayCount = inclusiveDayCount(brief.start_date, brief.end_date);
  const briefLines = [
    `- Destination: ${brief.destination}`,
    `- Dates: ${brief.start_date} to ${brief.end_date} inclusive (${dayCount} day${dayCount === 1 ? '' : 's'})`,
    ...travelerBriefLines(brief),
    briefLine('Origin', brief.origin),
    briefLine('Must-do or must-see', brief.must_do),
    briefLine('Known bookings', brief.known_bookings),
    briefLine('Budget', brief.budget),
    `- Pace override: ${brief.pace}`,
    briefLine('Additional notes', brief.notes),
  ].filter((line): line is string => line !== null);

  return `Create this new OurTrips itinerary from scratch. The current trip is only a starter draft, so replace the trip metadata and the complete days array with a finished first version.

Trip brief:
${briefLines.join('\n')}

Travel profile:
${profileContext}

Requirements:
- First call get_trip with view="summary" to inspect the starter draft.
- Use update_trip to replace the trip metadata and the full ordered days array.
- Keep trip.dates.start exactly ${brief.start_date}, trip.dates.end exactly ${brief.end_date}, and create exactly ${dayCount} calendar day${dayCount === 1 ? '' : 's'}.
- Use the OurTrips v2 quality contract: day intros, 3-6 programme items for full days, map-ready named places when known, meals, practical tips, statuses for open/booked items, and realistic pacing.
- Prefer a complete useful first draft over exhaustive research. Use WebSearch only for current, specific recommendations where freshness matters.
- Put uncertain assumptions in trip.notes or item notes instead of blocking generation.
- Do not invent booking confirmations, payment status, or exact reservations.
- After the update, read get_trip with view="sections" and sections ["quality","logistics"]. Repair hard errors before the final reply.

Final reply: one concise paragraph saying the trip draft is ready and naming any important assumptions or open booking decisions.`;
}

/**
 * Booking deep-link generators for the trip-chat agent.
 *
 * These tools are pure URL builders — no live availability, no payments,
 * no PII. The agent picks a restaurant/hotel/etc (typically after a
 * WebSearch) and calls one of these to generate a deeplink the user
 * can tap to complete the booking on the underlying platform.
 *
 * Affiliate IDs are picked up from env vars at request time. If none
 * are configured the link still works, just without revenue
 * attribution. We never block on a missing affiliate ID.
 */
import { z } from 'zod';
import { tool } from '@anthropic-ai/claude-agent-sdk';

const ISO_DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD');
const ISO_TIME = z.string().regex(/^\d{2}:\d{2}$/, 'HH:MM');

// ─── Restaurant ─────────────────────────────────────────────────────────
const RESTAURANT_DESCRIPTION = `Generate a reservation link for a restaurant.

Use AFTER picking a specific venue (typically via WebSearch). For "find me
a place" / "what's good", use WebSearch first.

Prefer a verified direct reservation URL from the restaurant's official site
or booking page. Only set opentable_verified=true when WebSearch/source
evidence confirms that the exact venue is on OpenTable. Do not infer OpenTable
support from the city or cuisine.

If no direct URL or verified OpenTable listing is supplied, returns a Google
Maps reservation search URL and marks verified=false.

Reply to the user with the URL as a markdown link (e.g.
"[Reserve](https://...)"). If verified=false, say the booking channel is
unverified instead of naming a booking platform as supported. Optionally also
call update_trip/upsert_meal to attach the verified URL or booking note to the
matching meal entry.`;

const RestaurantInput = {
  name: z.string().min(1).describe('Venue name'),
  city: z.string().optional().describe('City or neighbourhood, helps disambiguate'),
  country: z.string().optional().describe('Country, helps avoid unsupported platform assumptions'),
  date: ISO_DATE.optional().describe('Date of the reservation, YYYY-MM-DD'),
  time: ISO_TIME.optional().describe('24h time, e.g. 19:30'),
  party_size: z.number().int().min(1).max(20).optional().describe('Number of guests'),
  direct_reservation_url: z
    .string()
    .url()
    .optional()
    .describe('Verified direct reservation URL from the official restaurant site or current booking page'),
  opentable_verified: z
    .boolean()
    .optional()
    .describe('Set true only after verifying this exact venue has an OpenTable listing'),
} as const;

function buildRestaurantUrl(args: {
  name: string;
  city?: string;
  country?: string;
  date?: string;
  time?: string;
  party_size?: number;
  direct_reservation_url?: string;
  opentable_verified?: boolean;
}): { url: string; platform: string; verified: boolean; note?: string } {
  if (args.direct_reservation_url) {
    return {
      url: args.direct_reservation_url,
      platform: 'direct',
      verified: true,
      note: 'Direct reservation URL supplied from current source evidence.',
    };
  }

  if (!args.opentable_verified) {
    const query = [
      args.name,
      args.city,
      args.country,
      'reservation',
    ]
      .filter(Boolean)
      .join(' ');
    return {
      url: `https://www.google.com/maps/search/${encodeURIComponent(query)}`,
      platform: 'google-maps',
      verified: false,
      note: 'No verified direct reservation URL or OpenTable listing was supplied.',
    };
  }

  const aid = process.env.OPENTABLE_AFFILIATE_ID;
  const params = new URLSearchParams();
  params.set('term', args.city ? `${args.name} ${args.city}` : args.name);
  if (args.party_size) params.set('covers', String(args.party_size));
  if (args.date && args.time) params.set('dateTime', `${args.date}T${args.time}:00`);
  else if (args.date) params.set('dateTime', `${args.date}T19:00:00`);
  if (aid) params.set('ref', aid);
  return {
    url: `https://www.opentable.com/s?${params.toString()}`,
    platform: 'opentable',
    verified: true,
    note: 'OpenTable listing was marked verified by the agent from source evidence.',
  };
}

// ─── Hotel ──────────────────────────────────────────────────────────────
const HOTEL_DESCRIPTION = `Generate a booking deeplink for accommodation.

Use AFTER picking a specific hotel/area (typically via WebSearch). For
broad "where should we stay?" use WebSearch first.

Returns a Booking.com search URL prefilled with the location, dates, and
guest count. If a specific hotel name is given, includes it as the search
query so Booking.com lands on (or near) the right page.`;

const HotelInput = {
  query: z.string().min(1).describe('City, neighbourhood, or specific hotel name'),
  check_in: ISO_DATE.describe('Arrival date, YYYY-MM-DD'),
  check_out: ISO_DATE.describe('Departure date, YYYY-MM-DD'),
  guests: z.number().int().min(1).max(30).optional().describe('Total adult guests'),
  rooms: z.number().int().min(1).max(10).optional().describe('Number of rooms'),
} as const;

function buildHotelUrl(args: {
  query: string;
  check_in: string;
  check_out: string;
  guests?: number;
  rooms?: number;
}): { url: string; platform: string } {
  const aid = process.env.BOOKING_AFFILIATE_ID;
  const params = new URLSearchParams();
  params.set('ss', args.query);
  params.set('checkin', args.check_in);
  params.set('checkout', args.check_out);
  params.set('group_adults', String(args.guests ?? 2));
  params.set('no_rooms', String(args.rooms ?? 1));
  if (aid) params.set('aid', aid);
  return {
    url: `https://www.booking.com/searchresults.html?${params.toString()}`,
    platform: 'booking.com',
  };
}

// ─── Flight ─────────────────────────────────────────────────────────────
const FLIGHT_DESCRIPTION = `Generate a flight search deeplink.

Use when the user asks to book / change / find flights. Returns a Google
Flights URL prefilled with origin, destination, dates, and party size.
Routes to one-way or round-trip based on whether \`return_date\` is given.

Origin/destination accept airport IATA codes (LHR) or city names (London).`;

const FlightInput = {
  origin: z.string().min(1).describe('Departure airport IATA or city, e.g. AMS or Amsterdam'),
  destination: z.string().min(1).describe('Arrival airport IATA or city'),
  depart_date: ISO_DATE.describe('Outbound date, YYYY-MM-DD'),
  return_date: ISO_DATE.optional().describe('Return date for round-trip; omit for one-way'),
  adults: z.number().int().min(1).max(9).optional().describe('Number of adult passengers'),
} as const;

function buildFlightUrl(args: {
  origin: string;
  destination: string;
  depart_date: string;
  return_date?: string;
  adults?: number;
}): { url: string; platform: string } {
  const adults = args.adults ?? 1;
  const trip = args.return_date ? 'roundtrip' : 'oneway';
  const q = args.return_date
    ? `Flights from ${args.origin} to ${args.destination} on ${args.depart_date} returning ${args.return_date} for ${adults} adult${adults === 1 ? '' : 's'}`
    : `Flights from ${args.origin} to ${args.destination} on ${args.depart_date} for ${adults} adult${adults === 1 ? '' : 's'} ${trip}`;
  const url = `https://www.google.com/travel/flights?q=${encodeURIComponent(q)}`;
  return { url, platform: 'google-flights' };
}

// ─── Activity ───────────────────────────────────────────────────────────
const ACTIVITY_DESCRIPTION = `Generate a deeplink for tours, tickets, and
activities.

Use for things like museum tickets, day tours, food experiences, walking
tours, kayak rentals, etc. Returns a GetYourGuide search URL with the
query and (when given) date prefilled.`;

const ActivityInput = {
  query: z.string().min(1).describe('What the user wants — e.g. "Edinburgh Castle ticket", "Paris food tour"'),
  city: z.string().optional().describe('City context for ambiguous queries'),
  date: ISO_DATE.optional().describe('Preferred date, YYYY-MM-DD'),
} as const;

function buildActivityUrl(args: {
  query: string;
  city?: string;
  date?: string;
}): { url: string; platform: string } {
  const partner = process.env.GETYOURGUIDE_PARTNER_ID;
  const queryStr = args.city ? `${args.query} ${args.city}` : args.query;
  const params = new URLSearchParams();
  params.set('q', queryStr);
  if (args.date) params.set('date_from', args.date);
  if (partner) params.set('partner_id', partner);
  return {
    url: `https://www.getyourguide.com/s/?${params.toString()}`,
    platform: 'getyourguide',
  };
}

// ─── Tool factory ───────────────────────────────────────────────────────

function jsonResponse(data: unknown) {
  return {
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify(data, null, 2),
      },
    ],
  };
}

export function createBookingTools() {
  const restaurant = tool(
    'booking_link_restaurant',
    RESTAURANT_DESCRIPTION,
    RestaurantInput,
    async (rawArgs) => {
      const args = z.object(RestaurantInput).parse(rawArgs);
      return jsonResponse(buildRestaurantUrl(args));
    }
  );

  const hotel = tool(
    'booking_link_hotel',
    HOTEL_DESCRIPTION,
    HotelInput,
    async (rawArgs) => {
      const args = z.object(HotelInput).parse(rawArgs);
      return jsonResponse(buildHotelUrl(args));
    }
  );

  const flight = tool(
    'booking_link_flight',
    FLIGHT_DESCRIPTION,
    FlightInput,
    async (rawArgs) => {
      const args = z.object(FlightInput).parse(rawArgs);
      return jsonResponse(buildFlightUrl(args));
    }
  );

  const activity = tool(
    'booking_link_activity',
    ACTIVITY_DESCRIPTION,
    ActivityInput,
    async (rawArgs) => {
      const args = z.object(ActivityInput).parse(rawArgs);
      return jsonResponse(buildActivityUrl(args));
    }
  );

  return [restaurant, hotel, flight, activity];
}

export const BOOKING_TOOL_NAMES = [
  'mcp__trip_editor__booking_link_restaurant',
  'mcp__trip_editor__booking_link_hotel',
  'mcp__trip_editor__booking_link_flight',
  'mcp__trip_editor__booking_link_activity',
] as const;

// Exposed for unit tests
export const _internal = {
  buildRestaurantUrl,
  buildHotelUrl,
  buildFlightUrl,
  buildActivityUrl,
};

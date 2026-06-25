import { McpServer } from '@modelcontextprotocol/sdk/server/mcp';
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types';
import { z } from 'zod';
import {
  AccommodationReviewConflictError,
  addAccommodationCandidate,
  moveAccommodationCandidate,
  promoteCandidateToTrip,
  replaceBookedAccommodationCandidate,
  updateAccommodationCandidate,
} from '@/lib/accommodation-review';
import { syncAccommodationReviewForTrip } from '@/lib/accommodation-review-store';
import { createAdminClient } from '@/lib/supabase/admin';
import { normalizeTripData } from '@/lib/trip-data-normalize';
import { auditTripLogistics, ISO_DATE_RE, isIsoDateString } from '@/lib/trip-logistics';
import { validateItineraryQuality } from '@/lib/trip-quality';
import {
  completeMissingTripImagesForUser,
  deleteDayForUser,
  deleteDayItemForUser,
  formatTripForRead,
  getTripLogisticsLedgerForUser,
  getTripImagePromptsForUser,
  getTripForUser,
  listTripsForUser,
  patchTripForUserWithResult,
  replaceDayForUser,
  replaceDaySectionForUser,
  saveTripImageAssetForUser,
  saveTripForUser,
  searchTripImages,
  setTripHeroImageForUser,
  summarizeTripImages,
  syncMarkdownSourceForUser,
  truncateDaysAfterForUser,
  TripServiceError,
  updateTripFromMarkdownForUser,
  upsertDayItemForUser,
  verifyTripPublicDataForUser,
} from '@/lib/trip-service';
import type {
  AccommodationCandidate,
  AccommodationCandidateBooking,
  AccommodationReview,
  AccommodationReviewDestination,
  AccommodationReviewLane,
  TripData,
} from '@/lib/types';

const MCP_INSTRUCTIONS =
  [
    'Use OurTrips to save and edit travel itineraries for the authenticated user. This MCP connector is self-contained; rely on this connector\'s tools and schema guidance.',
    'Use save_trip_v3 for new or substantially rewritten itineraries when exact dates, sleeps/nights, or transport requirements matter; it rejects hard logistics contradictions. Use save_trip_v2 only when you intentionally want warnings without a hard logistics gate. Use get_trip_schema or get_trip_template when you need structure. Use get_trip summary/day/days/sections reads first; full reads require allow_large=true because large trips can exceed agent token limits.',
    'Use focused upsert/delete tools for meals, hotels, transport, and activities. For route rewrites, hotel swaps, removed stops, or stale nested fields, use replace_day, replace_day_section, replace_accommodation with mode=replace, delete_day, truncate_days_after, replace_paths, or delete_paths instead of deep merge.',
    'Map contract: every final trip must include trip.route_points[] with at least two coordinate-backed route/stay stops using label, lat, and lng so the overview map renders even when live place search is unavailable, and every visible named hotel, restaurant, activity site, and route stop must be represented once with a specific name and, when known, place/address/lat/lng context. For trip.route_points[], use label, lat, and lng; do not use name or title for route point labels. Do not combine several restaurants or hotels into one title, provider, note, or service.',
    'Accommodation shortlist contract: for each overnight stop without a booked hotel, create 2-4 private accommodation candidates, usually 3, with create_accommodation_candidate. Create exactly one candidate per hotel. Keep days[].accommodation as the booked/current stay or a clear placeholder such as "Hotel not confirmed yet"; never put hotel shortlists, slash-separated hotel names, or multiple hotel options into one public accommodation entry.',
    'Restaurant reservations belong in days[].meals[] as one meal per restaurant with detail.reservation or booking_status. Do not create trip.services entries for restaurants; trip.services is only for external logistics or providers not already rendered as transport, accommodation, meals, or activities.',
    'Every day should include at least one practical, place-specific tip with title and content. Omit tips only when there is truly nothing useful; never send empty tip objects.',
    'Logistics contract: a day is one calendar itinerary date; a sleep/night is one overnight stay with check-in inclusive and check-out exclusive; a stay segment is one hotel across contiguous sleeps; a transport leg is one movement from an origin to a destination on a specific itinerary day. For any question or edit involving trip start/end dates, day count, nights, stays, route shape, or "how long are we in X", call get_trip_logistics_ledger before reasoning. Run validate_trip_contract before saying a trip is complete.',
    'Images are part of the MCP workflow: use search_trip_images and set_trip_image for specific real Unsplash trip/day hero images, or complete_missing_trip_images to idempotently fill missing hero coverage. Then use get_trip_image_prompts plus save_trip_image_asset for externally generated cover/social assets. Check get_trip_image_status, validate_trip_contract, or verify_trip_public_data before saying the trip is done.',
    'OAuth failure handling: Do not ask for an API key. If an OurTrips update, RtwebSync, or any tool call reports OAuth authorization required, expired, missing, or not logged in, stop retrying that connector call. Do not skip the update, mark the live preview stale, or spend more turns searching for auth tools as the resolution. Tell the user the connector needs OAuth authorization and explicitly propose the next user action: reconnect or sign in to OurTrips, then ask them to confirm when done so you can retry.',
  ].join(' ');

const JsonObjectSchema = z.record(z.string(), z.unknown());
const TripRoutePointSchema = z
  .object({
    label: z.string().min(1).describe('Visible route point label. Use label, not name or title.'),
    lat: z.number().min(-90).max(90).describe('Latitude.'),
    lng: z.number().min(-180).max(180).describe('Longitude.'),
    day: z.number().int().positive().optional().describe('Related itinerary day number.'),
    mode: z.string().optional().describe('Travel mode or route context from the previous point.'),
    role: z.enum(['home', 'stop', 'stay', 'excursion', 'trail', 'return']).optional(),
  })
  .passthrough();
const IsoDateSchema = z
  .string()
  .regex(ISO_DATE_RE, 'Use ISO 8601 YYYY-MM-DD.')
  .refine(isIsoDateString, 'Use a real calendar date.');
const TripPayloadSchema = JsonObjectSchema.describe(
  'The trip metadata object. It must include a human-readable name.'
);
const DayPayloadSchema = JsonObjectSchema.describe(
  'A single itinerary day object. Use day_number for patching existing days.'
);
const ResponseModeSchema = z
  .enum(['compact', 'full'])
  .optional()
  .describe('Use compact for mutation summaries, or full to include the complete updated trip record.');
const PatchModeSchema = z
  .enum(['merge', 'replace'])
  .optional()
  .describe('merge deep-merges objects; replace replaces the addressed object or section.');
const DayNumberSchema = z.number().int().positive();
const ItemMatchSchema = z
  .object({
    index: z.number().int().nonnegative().optional(),
    name: z.string().optional(),
    label: z.string().optional(),
    title: z.string().optional(),
    type: z.string().optional(),
    mode: z.string().optional(),
    from: z.string().optional(),
    to: z.string().optional(),
    time_label: z.string().optional(),
    content_contains: z.string().optional(),
  })
  .describe('How to find an existing item. Prefer stable fields such as name, label, route, title, or an index returned by get_trip.');
const ReplacePathSchema = z.object({
  path: z.string().min(1),
  value: z.unknown(),
});
const ReadSectionSchema = z.enum([
  'trip',
  'markdown_source',
  'days',
  'images',
  'image_assets',
  'logistics',
  'blocks',
  'transport',
  'accommodation',
  'meals',
  'tips',
  'stats',
  'route_points',
  'quality',
  'services',
  'notes',
]);
const AccommodationScopeSchema = z
  .enum(['day', 'matching_accommodation_name'])
  .optional()
  .describe('Use matching_accommodation_name to update/delete the same hotel across adjacent stay days.');
const AccommodationReviewLaneSchema = z.enum(['proposed', 'considering', 'dismissed', 'booked']);
const AccommodationCandidateLinkSchema = z
  .object({
    label: z.string().min(1),
    url: z.string().url(),
  })
  .strict();
const AccommodationCandidateRatingSchema = z
  .object({
    name: z.string().optional(),
    checkedAt: IsoDateSchema,
    bookingCom: z.string().min(1),
    tripadvisor: z.string().min(1),
    google: z.string().min(1),
    hotelsCom: z.string().optional(),
    note: z.string().optional(),
  })
  .strict()
  .describe('Checked customer-review ratings. Include checkedAt plus bookingCom, tripadvisor, and google values; use "Not found" only for sources actually checked.');
const AccommodationCandidateBookingSchema = z
  .object({
    bookedAt: z.string().optional(),
    source: z.string().optional(),
    confirmation: z.string().optional(),
    price: z.string().optional(),
    note: z.string().optional(),
  })
  .strict();
const AccommodationReviewDestinationSchema = z
  .object({
    id: z.string().min(1),
    title: z.string().min(1),
    dates: z.string().optional(),
    nights: z.number().optional(),
    dayNumbers: z.array(DayNumberSchema).optional(),
    startDate: IsoDateSchema.optional(),
    endDate: IsoDateSchema.optional(),
  })
  .strict();
const AccommodationCandidatePatchSchema = z
  .object({
    destinationId: z.string().optional(),
    stop: z.string().optional(),
    dates: z.string().optional(),
    nights: z.number().optional(),
    lane: AccommodationReviewLaneSchema.optional(),
    status: z.string().optional(),
    candidate: z.string().optional(),
    price: z.string().optional(),
    dog: z.string().optional(),
    parking: z.string().optional(),
    terms: z.string().optional(),
    why: z.string().optional(),
    blockers: z.string().optional(),
    action: z.string().optional(),
    alternatives: z.string().optional(),
    directWebsite: AccommodationCandidateLinkSchema.optional().describe(
      'Official/direct hotel website. Do not use Booking.com, Tripadvisor, Google, or an OTA/search-result URL here.'
    ),
    links: z.array(AccommodationCandidateLinkSchema).optional(),
    ratings: z.array(AccommodationCandidateRatingSchema).optional(),
    rateCheck: JsonObjectSchema.optional(),
    feedbackLoop: JsonObjectSchema.optional(),
    dayNumbers: z.array(DayNumberSchema).optional(),
    checkInDate: IsoDateSchema.optional(),
    checkOutDate: IsoDateSchema.optional(),
    address: z.string().optional(),
    roomType: z.string().optional(),
    checkIn: z.string().optional(),
    checkOut: z.string().optional(),
    phone: z.string().optional(),
    wifi: z.string().optional(),
    policySource: AccommodationCandidateLinkSchema.optional(),
    policyConfidence: z.enum(['high', 'medium', 'low']).optional(),
    hotelNote: z.string().optional(),
    booking: AccommodationCandidateBookingSchema.optional(),
    createdBy: z.enum(['agent', 'user', 'import', 'system']).optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'Provide at least one candidate field to patch.',
  });
const AccommodationCandidateCreateSchema = z
  .object({
    destinationId: z.string().optional(),
    stop: z.string().optional(),
    dates: z.string().optional(),
    nights: z.number().optional(),
    lane: AccommodationReviewLaneSchema.default('proposed'),
    status: z.string().optional(),
    candidate: z.string().min(1),
    price: z.string().optional(),
    dog: z.string().optional(),
    parking: z.string().optional(),
    terms: z.string().optional(),
    why: z.string().optional(),
    blockers: z.string().optional(),
    action: z.string().optional(),
    alternatives: z.string().optional(),
    directWebsite: AccommodationCandidateLinkSchema.describe(
      'Official/direct hotel website. Do not use Booking.com, Tripadvisor, Google, or an OTA/search-result URL here.'
    ),
    links: z.array(AccommodationCandidateLinkSchema).optional(),
    ratings: z.array(AccommodationCandidateRatingSchema).min(1),
    rateCheck: JsonObjectSchema.optional(),
    feedbackLoop: JsonObjectSchema.optional(),
    dayNumbers: z.array(DayNumberSchema).optional(),
    checkInDate: IsoDateSchema.optional(),
    checkOutDate: IsoDateSchema.optional(),
    address: z.string().optional(),
    roomType: z.string().optional(),
    checkIn: z.string().optional(),
    checkOut: z.string().optional(),
    phone: z.string().optional(),
    wifi: z.string().optional(),
    policySource: AccommodationCandidateLinkSchema.optional(),
    policyConfidence: z.enum(['high', 'medium', 'low']).optional(),
    hotelNote: z.string().optional(),
    booking: AccommodationCandidateBookingSchema.optional(),
    createdBy: z.enum(['agent', 'user', 'import', 'system']).optional(),
  })
  .strict();
const SchemaSectionSchema = z
  .enum(['overview', 'trip', 'day', 'activity', 'transport', 'accommodation', 'accommodation_candidates', 'meal', 'tips', 'route_points', 'image_assets', 'quality_contract', 'logistics_contract', 'v2', 'patching'])
  .optional();
const ImageAssetSlotSchema = z.enum(['cover_portrait', 'cover_landscape', 'social_og']);
const ImageOrientationSchema = z.enum(['landscape', 'portrait', 'squarish']).optional();
const ImageAssetSchema = z.object({
  url: z.string().min(1),
  prompt: z.string().optional(),
  aspect_ratio: z.string().optional(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  provider: z.string().optional(),
  model: z.string().optional(),
  source: z.enum(['imagegen', 'manual', 'search']).optional(),
  generated_at: z.string().optional(),
});
const TimePrecisionSchema = z.enum(['fixed', 'suggested', 'window']);
const ItineraryPlaceSchema = z
  .object({
    name: z.string().min(1),
    address: z.string().optional(),
    lat: z.number().min(-90).max(90).optional(),
    lng: z.number().min(-180).max(180).optional(),
    google_maps_url: z.string().optional(),
    place_id: z.string().optional(),
    note: z.string().optional(),
  })
  .passthrough();
const ItineraryAlternativeSchema = z
  .object({
    label: z.string().min(1),
    description: z.string().min(1),
    trigger: z.string().optional(),
    duration: z.string().optional(),
    cost_hint: z.string().optional(),
  })
  .passthrough();
const TravelWalletItemSchema = z
  .object({
    title: z.string().min(1),
    type: z.string().optional(),
    url: z.string().optional(),
    file_url: z.string().optional(),
    qr_code_url: z.string().optional(),
    confirmation: z.string().optional(),
    note: z.string().optional(),
    is_private: z.boolean().optional(),
  })
  .passthrough();
const RichDetailV2Schema = z
  .object({
    title: z.string().optional(),
    body: z.string().optional(),
    why: z.string().optional(),
    vibe: z.string().optional(),
    highlights: z.array(z.string()).optional(),
    what_to_see: z.array(z.string()).optional(),
    how_to_do_it: z.string().optional(),
    practical: z.string().optional(),
    booking_note: z.string().optional(),
    wallet_items: z.array(TravelWalletItemSchema).optional(),
  })
  .passthrough();
const ActivityV2Schema = z
  .object({
    time_label: z.string().min(1).describe('Visible programme label such as "09:00", "09:00-11:00", or "Morning".'),
    content: z.string().min(1),
    type: z.string().min(1),
    starts_at: z.string().optional().describe('HH:mm when known.'),
    ends_at: z.string().optional().describe('HH:mm when known.'),
    time_precision: TimePrecisionSchema.optional().describe('fixed = booking/transport/researched constraint; suggested = AI-planned exact time; window = broad time of day.'),
    duration_minutes: z.number().int().positive().optional(),
    place: ItineraryPlaceSchema.optional(),
    booking_status: z.string().optional(),
    reservation_required: z.boolean().optional(),
    cost_hint: z.string().optional(),
    pace: z.string().optional(),
    detail: RichDetailV2Schema.optional(),
    options: z.array(JsonObjectSchema).optional(),
    alternatives: z.array(ItineraryAlternativeSchema).optional(),
  })
  .passthrough();
const TransportV2Schema = z
  .object({
    mode: z.string().min(1),
    label: z.string().min(1),
    from: z.string().optional(),
    to: z.string().optional(),
    depart: z.string().optional(),
    arrive: z.string().optional(),
    duration: z.string().optional(),
    distance: z.string().optional(),
    status: z.string().optional(),
    booking_status: z.string().optional(),
    reservation_required: z.boolean().optional(),
    cost_hint: z.string().optional(),
    detail: RichDetailV2Schema.optional(),
  })
  .passthrough();
const AccommodationV2Schema = z
  .object({
    name: z.string().min(1),
    price: z.string().optional(),
    rating: z.string().optional(),
    status: z.string().optional(),
    booking_status: z.string().optional(),
    reservation_required: z.boolean().optional(),
    cost_hint: z.string().optional(),
    nights: z.number().optional(),
    note: z.string().optional(),
    detail: RichDetailV2Schema.optional(),
  })
  .passthrough();
const MealV2Schema = z
  .object({
    type: z.string().min(1),
    name: z.string().min(1),
    note: z.string().optional(),
    status: z.string().optional(),
    starts_at: z.string().optional(),
    ends_at: z.string().optional(),
    time_precision: TimePrecisionSchema.optional(),
    booking_status: z.string().optional(),
    reservation_required: z.boolean().optional(),
    cost_hint: z.string().optional(),
    place: ItineraryPlaceSchema.optional(),
    detail: RichDetailV2Schema.optional(),
  })
  .passthrough();
const DayV2Schema = z
  .object({
    day_number: DayNumberSchema,
    date: IsoDateSchema.describe('ISO 8601 YYYY-MM-DD'),
    title: z.string().min(1),
    subtitle: z.string().optional(),
    description_title: z.string().optional(),
    description: z.string().optional(),
    day_type: z.string().optional(),
    pace: z.string().optional(),
    hero_image: z.string().optional(),
    stats: z.array(JsonObjectSchema).optional(),
    blocks: z.array(ActivityV2Schema).optional(),
    transport: z.array(TransportV2Schema).optional(),
    accommodation: AccommodationV2Schema.nullable().optional(),
    meals: z.array(MealV2Schema).optional(),
    tips: z.array(JsonObjectSchema).optional(),
    alternatives: z.array(ItineraryAlternativeSchema).optional(),
  })
  .passthrough();
const TripMetaV2Schema = z
  .object({
    name: z.string().min(1),
    subtitle: z.string().min(1),
    dates: z.object({
      start: IsoDateSchema.describe('ISO 8601 YYYY-MM-DD'),
      end: IsoDateSchema.describe('ISO 8601 YYYY-MM-DD'),
    }),
    travelers: z.array(z.string()),
    summary: z.string().min(1),
    hero_image: z.string().min(1),
    overview_image: z.string().optional(),
    route_points: z
      .array(TripRoutePointSchema)
      .optional()
      .describe('Required for final/generated trips: at least two route/stay stops with label, lat, and lng so the overview map has a coordinate-backed fallback.'),
    notes: z.array(JsonObjectSchema).optional(),
  })
  .passthrough();

type ToolExtra = {
  authInfo?: AuthInfo;
};

function userIdFromAuth(extra: ToolExtra): string {
  const userId = extra.authInfo?.extra?.userId;
  if (typeof userId !== 'string' || userId.length === 0) {
    throw new TripServiceError('Missing authenticated OurTrips user', 401);
  }
  return userId;
}

function jsonResult(data: unknown): CallToolResult {
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(data, null, 2),
      },
    ],
  };
}

function errorResult(err: unknown): CallToolResult {
  const message =
    err instanceof Error ? err.message : 'OurTrips tool failed unexpectedly';
  const status = err instanceof TripServiceError ? err.status : 500;
  return {
    isError: true,
    content: [
      {
        type: 'text',
        text: JSON.stringify({ error: message, status }, null, 2),
      },
    ],
  };
}

function mutationResult(
  result: { record: Record<string, unknown>; summary: unknown },
  responseMode?: 'compact' | 'full'
): CallToolResult {
  if (responseMode === 'full') {
    return jsonResult({ summary: result.summary, trip: result.record });
  }
  return jsonResult(result.summary);
}

function accommodationReviewErrorResult(err: unknown): CallToolResult {
  if (err instanceof AccommodationReviewConflictError) {
    return errorResult(new TripServiceError(err.message, 409));
  }
  return errorResult(err);
}

function summarizeAccommodationReviewForMcp(review: AccommodationReview) {
  return {
    tripTitle: review.tripTitle,
    updatedAt: review.updatedAt,
    destinations: review.destinations,
    candidate_count: review.accommodations.length,
    lanes: {
      proposed: review.accommodations.filter((item) => item.lane === 'proposed'),
      considering: review.accommodations.filter((item) => item.lane === 'considering'),
      dismissed: review.accommodations.filter((item) => item.lane === 'dismissed'),
      booked: review.accommodations.filter((item) => item.lane === 'booked'),
    },
    recent_events: (review.events ?? []).slice(-12),
  };
}

function accommodationReviewResult(
  origin: string,
  record: Record<string, unknown>,
  review: AccommodationReview,
  responseMode?: 'compact' | 'full',
  extra: Record<string, unknown> = {}
): CallToolResult {
  const shareId = String(record.share_id ?? '');
  return jsonResult({
    trip_id: String(record.id ?? ''),
    share_id: shareId,
    url: origin ? `${origin}/t/${shareId}` : `/t/${shareId}`,
    ...extra,
    review: responseMode === 'full' ? review : summarizeAccommodationReviewForMcp(review),
  });
}

async function loadAccommodationReviewForUser(
  userId: string,
  tripId: string
): Promise<{
  admin: ReturnType<typeof createAdminClient>;
  record: Record<string, unknown>;
  tripData: TripData;
  review: AccommodationReview;
}> {
  const admin = createAdminClient();
  const record = await getTripForUser(admin, userId, tripId);
  const tripData = normalizeTripData(record.data);
  const review = await syncAccommodationReviewForTrip(admin, String(record.id), tripData);
  return { admin, record, tripData, review };
}

async function saveAccommodationReviewForTrip(
  admin: ReturnType<typeof createAdminClient>,
  tripId: string,
  review: AccommodationReview
): Promise<void> {
  const { error } = await admin
    .from('trip_accommodation_reviews')
    .upsert({
      trip_id: tripId,
      data: review,
      updated_at: new Date().toISOString(),
    });

  if (error) {
    throw new TripServiceError(error.message, 500);
  }
}

async function persistPromotedAccommodationTripData(
  admin: ReturnType<typeof createAdminClient>,
  userId: string,
  tripId: string,
  nextTripData: TripData
): Promise<Record<string, unknown>> {
  const { data, error } = await admin
    .from('trips')
    .update({
      data: nextTripData,
      name: nextTripData.trip.name,
      updated_at: new Date().toISOString(),
    })
    .eq('id', tripId)
    .eq('user_id', userId)
    .select()
    .single();

  if (error || !data) {
    throw new TripServiceError(error?.message ?? 'Failed to update trip accommodation', 500);
  }

  return data as Record<string, unknown>;
}

const TRIP_SCHEMA_REFERENCE = {
  overview: {
    top_level: {
      trip: 'Trip metadata object. Must include name, subtitle, dates, travelers, summary, and hero_image.',
      days: 'Array of day objects with 1-indexed day_number values.',
      markdown_source: 'Optional verbatim original plan markdown, max 256 KB.',
    },
    rules: [
      'Use save_trip_v3 for new or substantially rewritten itineraries when exact dates, sleeps/nights, or transport requirements matter; it rejects hard logistics contradictions.',
      'Use save_trip_v2 only when you intentionally want quality/logistics warnings without a hard logistics gate.',
      'Use get_trip_logistics_ledger before answering or editing trip start/end dates, day counts, nights/sleeps, stays, or how long travelers spend somewhere.',
      'Use get_trip summary/day/days/sections reads before full reads.',
      'Run validate_trip_contract before claiming the trip is complete.',
      'Include trip.route_points[] with at least two coordinate-backed route/stay stops using label, lat, and lng for final/generated trips.',
      'Map every visible named hotel, restaurant, activity site, and route stop with a specific name. Prefer place.name plus address or lat/lng when the exact place is known.',
      'For each overnight stop without a booked hotel, create 2-4 private accommodation candidates, usually 3, with one candidate per hotel.',
      'Keep the public days[].accommodation field single-choice: the booked/current stay, or a clear placeholder such as "Hotel not confirmed yet" while candidates are under review.',
      'Restaurant reservations belong in days[].meals[]; do not put restaurants or combined restaurant lists in trip.services.',
      'Include at least one practical tip per day. Empty tips arrays or empty tip objects are treated as missing content.',
      'Unsplash hero image URLs must come from search_trip_images, then set_trip_image should track the selected download_url.',
      'Generated covers/social images live in trip.image_assets and are saved with save_trip_image_asset after the agent has created and hosted them elsewhere.',
    ],
  },
  trip: {
    required: ['name', 'subtitle', 'dates', 'travelers', 'summary', 'hero_image'],
    optional: ['overview_image', 'image_assets', 'route_points', 'accent_color', 'services', 'notes'],
    required_for_final_generated_trips: ['route_points'],
    services_rule: 'Use services only for external providers not already represented as transport, accommodation, meals, or activities. Never use services for restaurant reservations or combined restaurant booking lists.',
    example: {
      name: 'Turkey Road Trip',
      subtitle: 'Aegean ruins, Cappadocia, and the overland return',
      dates: { start: '2026-09-01', end: '2026-09-21' },
      travelers: ['Thijs', 'Alexli'],
      summary: 'A place-led itinerary with realistic travel days, stays, meals, and route context.',
      hero_image: 'https://images.unsplash.com/photo-...',
    },
  },
  day: {
    required: ['day_number', 'date', 'title'],
    optional: ['subtitle', 'description_title', 'description', 'hero_image', 'stats', 'blocks', 'transport', 'accommodation', 'meals', 'tips'],
    example: {
      day_number: 1,
      date: '2026-09-01',
      title: 'Amsterdam -> Istanbul',
      subtitle: 'Arrival and first evening in Karakoy',
      description_title: 'Soft first landing',
      description: 'Arrive without trying to win the city on day one; the point is a clean transfer, a simple dinner, and an easy first night.',
      hero_image: 'https://images.unsplash.com/photo-...',
      blocks: [],
      transport: [],
      accommodation: null,
      meals: [],
    },
  },
  activity: {
    section: 'days[].blocks[]',
    required: ['time_label', 'content', 'type'],
    purpose: 'Only actual programme/activity items. Do not use blocks for the day intro; use days[].description_title and days[].description instead.',
    v2_fields: ['starts_at', 'ends_at', 'time_precision', 'duration_minutes', 'place', 'booking_status', 'reservation_required', 'cost_hint', 'pace', 'alternatives'],
    detail_fields: ['title', 'body', 'why', 'vibe', 'highlights', 'what_to_see', 'how_to_do_it', 'practical', 'booking_note', 'dog_note', 'wallet_items'],
  },
  transport: {
    section: 'days[].transport[]',
    required: ['mode', 'label'],
    scheduled_transport_should_include: ['from', 'to', 'depart', 'arrive', 'duration'],
    detail_fields: ['class', 'seats', 'booking_ref', 'booking_platform', 'flight', 'terminal', 'platform', 'cancellation_policy', 'note'],
  },
  accommodation: {
    section: 'days[].accommodation',
    required: ['name'],
    public_itinerary_rule: 'The public itinerary accommodation is single-choice. Use it for a booked/current stay or a clear placeholder while private candidates are under review.',
    sleep_rule: 'One public accommodation day equals one sleep/night. A 3-night stay should appear on 3 contiguous itinerary days with nights=3, check-in on the first day, and check-out the day after the final sleep.',
    replace_rule: 'When changing to a different hotel, use replace_accommodation or upsert_accommodation with mode=replace so stale detail fields are removed.',
    detail_fields: ['check_in', 'check_out', 'room_type', 'address', 'phone', 'confirmation', 'booking_platform', 'parking', 'wifi', 'dog_note', 'policy_source_url'],
  },
  accommodation_candidates: {
    section: 'private Accommodations Reviewer',
    purpose: 'Store hotel shortlists separately from the public itinerary. Use this for proposed, considering, dismissed, and booked hotel options.',
    rule: 'For each overnight stop without a booked hotel, create 2-4 candidates, usually 3. Create exactly one candidate per hotel; never combine multiple hotel names in one candidate.',
    public_itinerary_rule: 'Do not put hotel shortlists into days[].accommodation. Keep days[].accommodation as the booked/current hotel or a placeholder such as "Hotel not confirmed yet".',
    lanes: ['proposed', 'considering', 'dismissed', 'booked'],
    candidate_required: ['candidate', 'directWebsite', 'ratings'],
    candidate_fields: ['destinationId', 'stop', 'dates', 'nights', 'lane', 'status', 'candidate', 'price', 'dog', 'parking', 'terms', 'why', 'blockers', 'action', 'alternatives', 'directWebsite', 'links', 'ratings', 'rateCheck', 'dayNumbers', 'checkInDate', 'checkOutDate', 'address', 'roomType', 'checkIn', 'checkOut', 'phone', 'wifi', 'policySource', 'policyConfidence', 'hotelNote', 'booking'],
    ratings_rule: 'Include checkedAt plus bookingCom, tripadvisor, and google values. Use "Not found" only for sources actually checked.',
    promotion_rule: 'Use promote_accommodation_candidate when the user confirms a hotel should become the booked stay. This updates both the private reviewer and public itinerary accommodation cards.',
  },
  meal: {
    section: 'days[].meals[]',
    required: ['type', 'name'],
    rules: [
      'One meal entry equals one restaurant, cafe, bar, bakery, or explicit food stop. Do not combine multiple restaurants in one meal name, note, or reservation field.',
      'For reservable meals, use reservation_required plus booking_status/status and put the time or booking note in detail.reservation or detail.booking_note.',
      'Use place.name and place.address/lat/lng when the exact venue is known so the day map can find it.',
    ],
    detail_fields: ['title', 'body', 'why', 'vibe', 'cuisine', 'price_range', 'reservation', 'what_to_order', 'booking_note', 'address', 'phone', 'hours'],
  },
  tips: {
    section: 'days[].tips[]',
    required: ['title', 'content'],
    optional: ['icon', 'priority'],
    rules: [
      'Add at least one useful, place-specific tip per day.',
      'Do not send empty tip objects or title-only placeholders.',
      'Good tips are practical and contextual: booking timing, local routing, etiquette, backup moves, or what to skip.',
    ],
  },
  route_points: {
    section: 'trip.route_points[]',
    required: ['label', 'lat', 'lng'],
    optional: ['day', 'mode', 'role'],
    roles: ['home', 'stop', 'stay', 'excursion', 'trail', 'return'],
    rules: [
      'Final/generated trips must include at least two coordinate-backed route/stay stops so the overview map can render without live place search.',
      'Use label for the visible route point label; do not use name or title.',
      'Use mode for the travel context from the previous point and role for home, stay, stop, excursion, trail, or return.',
    ],
  },
  image_assets: {
    section: 'trip.image_assets',
    slots: {
      cover_portrait: 'Generated 9:16 mobile cover.',
      cover_landscape: 'Generated 3:2 wide cover.',
      social_og: 'Generated 1.91:1 social preview.',
    },
    fields: ['url', 'prompt', 'aspect_ratio', 'width', 'height', 'provider', 'model', 'source', 'generated_at'],
  },
  quality_contract: {
    save_tool: 'save_trip_v3',
    schema_version: 2,
    day_contract: [
      'Every full travel day should have description_title + description and usually 3-6 programme blocks.',
      'Use exact starts_at/ends_at only with time_precision. fixed is reserved for bookings, transport, or researched constraints; suggested is for AI-planned exact times; window is for broad labels.',
      'Named sights, hotels, restaurants, and stops should use place.name when known so maps stay reliable.',
      'Every visible hotel, site, restaurant, and meaningful stop should be map-ready. Use specific names and place/address/lat/lng context instead of prose-only mentions.',
      'Hotels, transport, and reservable meals should carry status or booking_status so action items/readiness work.',
      'Do not use trip.services for restaurant reservations. Keep each restaurant as its own days[].meals[] entry and put reservation details there.',
      'Each day should include at least one practical, place-specific tip with title and content.',
      'Use day_type, pace, and alternatives for rainy-day, tired-day, kid-friendly, cheaper, or lighter versions.',
      'Store confirmations, PDFs, QR codes, and private booking references in detail.wallet_items; never invent confirmation numbers.',
    ],
    validation: 'save_trip_v3 normalizes the trip to trip_schema_version=2 and rejects hard quality/logistics errors by default. save_trip_v2 returns the same quality/logistics report but only rejects hard errors when strict_quality=true.',
  },
  logistics_contract: {
    purpose: 'Hard arithmetic contract for exact dates, sleeps/nights, stay segments, and transport legs.',
    glossary: {
      day: 'One calendar itinerary date.',
      sleep: 'One overnight stay: check-in date inclusive, check-out date exclusive. Sleep and night mean the same thing in OurTrips.',
      stay_segment: 'A contiguous allocation of one hotel/stay across one or more sleeps.',
      transport_leg: 'One atomic movement from an origin to a destination on a specific itinerary day.',
    },
    ledger_tool: 'get_trip_logistics_ledger',
    validation_tool: 'validate_trip_contract',
    save_tool: 'save_trip_v3',
    hard_errors: [
      'trip.dates.start and trip.dates.end must be real YYYY-MM-DD calendar dates.',
      'trip.dates.start must equal days[0].date and trip.dates.end must equal the final day date.',
      'days.length must equal the inclusive calendar day count from start to end.',
      'day_number values must be continuous and match array order.',
      'day.date values must increase exactly one calendar day at a time.',
      'A public accommodation day equals one sleep/night; contiguous dayNumbers for a stay must match nights.',
      'Scheduled/booked/required transport legs must include from and to, and scheduled booked transport must include depart.',
    ],
    server_derived_fields: [
      'Accommodation candidates with destinationId inherit stop, dates, nights, dayNumbers, checkInDate, and checkOutDate from the Accommodations Reviewer destination.',
      'Agents should pass destinationId instead of retyping date arithmetic for hotel candidates.',
    ],
  },
  v2: {
    alias_for: 'quality_contract',
  },
  patching: {
    merge: 'Objects deep-merge; omitted nested keys remain. Arrays replace when included.',
    replace: 'Use mode=replace, replace_day, replace_day_section, replace_accommodation, or replace_paths when old nested keys must disappear.',
    delete: 'Use delete_day, truncate_days_after, delete_* tools, or delete_paths for exact JSON paths.',
  },
};

const TRIP_TEMPLATE_REFERENCE = {
  new_trip: {
    trip: TRIP_SCHEMA_REFERENCE.trip.example,
    days: [TRIP_SCHEMA_REFERENCE.day.example],
    markdown_source: '# Optional original plan markdown\n',
  },
  new_trip_v2: {
    tool: 'save_trip_v2',
    trip: TRIP_SCHEMA_REFERENCE.trip.example,
    days: [
      {
        ...TRIP_SCHEMA_REFERENCE.day.example,
        day_type: 'arrival',
        pace: 'light',
        description_title: 'Soft first landing',
        description: 'Keep the first day clean: arrive, settle in, take one good walk, and make dinner easy.',
        blocks: [
          {
            time_label: '15:00',
            starts_at: '15:00',
            time_precision: 'fixed',
            content: 'Arrive and transfer to the hotel.',
            type: 'transport',
            booking_status: 'booked',
          },
          {
            time_label: '17:00-18:30',
            starts_at: '17:00',
            ends_at: '18:30',
            time_precision: 'suggested',
            content: 'Orientation walk through the old quarter.',
            type: 'activity',
            place: { name: 'Old quarter' },
          },
          {
            time_label: 'Evening',
            time_precision: 'window',
            content: 'Low-friction dinner near the hotel.',
            type: 'meal',
          },
        ],
        meals: [{ type: 'dinner', name: 'Neighbourhood dinner option', booking_status: 'open', reservation_required: false }],
        tips: [{ icon: 'info', title: 'Keep dinner easy', content: 'Save the first night for a nearby table; the arrival day should not depend on a tight cross-city reservation.' }],
        alternatives: [{ label: 'Tired-day version', description: 'Skip the orientation walk and keep only a short dinner nearby.', trigger: 'tired' }],
      },
    ],
    strict_quality: false,
    markdown_source: '# Optional original plan markdown\n',
  },
  new_trip_v3: {
    tool: 'save_trip_v3',
    trip: {
      ...TRIP_SCHEMA_REFERENCE.trip.example,
      dates: { start: '2026-09-01', end: '2026-09-01' },
      route_points: [
        { label: 'Amsterdam', lat: 52.3676, lng: 4.9041, day: 1, mode: 'flight', role: 'home' },
        { label: 'Istanbul', lat: 41.0082, lng: 28.9784, day: 1, mode: 'flight', role: 'stay' },
      ],
    },
    days: [
      {
        ...TRIP_SCHEMA_REFERENCE.day.example,
        date: '2026-09-01',
        day_type: 'arrival',
        pace: 'light',
        description_title: 'Soft first landing',
        description: 'Keep the first day clean: arrive, settle in, take one good walk, and make dinner easy.',
        transport: [
          {
            mode: 'flight',
            label: 'Arrival flight',
            from: 'Amsterdam',
            to: 'Istanbul',
            depart: '09:00',
            arrive: '13:30',
            booking_status: 'open',
          },
        ],
        accommodation: {
          name: 'Hotel not confirmed yet',
          status: 'open',
          booking_status: 'open',
          nights: 1,
        },
        blocks: [
          {
            time_label: '17:00-18:30',
            starts_at: '17:00',
            ends_at: '18:30',
            time_precision: 'suggested',
            content: 'Orientation walk through the old quarter.',
            type: 'activity',
            place: { name: 'Old quarter' },
          },
          {
            time_label: 'Evening',
            time_precision: 'window',
            content: 'Low-friction dinner near the hotel.',
            type: 'meal',
          },
        ],
        meals: [{ type: 'dinner', name: 'Neighbourhood dinner option', booking_status: 'open', reservation_required: false }],
        tips: [{ icon: 'info', title: 'Keep dinner easy', content: 'Save the first night for a nearby table; the arrival day should not depend on a tight cross-city reservation.' }],
      },
    ],
    strict_quality: true,
    markdown_source: '# Optional original plan markdown\n',
  },
  validate_contract: {
    tool: 'validate_trip_contract',
    input: { trip_id: 'uuid', response_mode: 'compact' },
  },
  logistics_ledger: {
    tool: 'get_trip_logistics_ledger',
    input: { trip_id: 'uuid' },
    use_for: 'Trip start/end dates, exact day count, scheduled sleeps/nights, stay segments, and "how long are we in X" questions.',
  },
  replace_hotel: {
    tool: 'replace_accommodation',
    input: {
      trip_id: 'uuid',
      day_number: 5,
      accommodation: {
        name: 'New Hotel',
        status: 'booked',
        detail: { check_in: '3:00 PM', check_out: '11:00 AM' },
      },
    },
  },
  accommodation_shortlist: {
    tools: ['list_accommodation_review', 'create_accommodation_candidate'],
    expectation: 'For an unbooked overnight stop, create 2-4 private candidates, usually 3. Call create_accommodation_candidate once per hotel.',
    input: {
      trip_id: 'uuid',
      candidate: {
        stop: 'Karakoy, Istanbul',
        dates: '1-4 Sep',
        nights: 3,
        lane: 'proposed',
        candidate: 'Example Hotel',
        price: 'Approx. EUR 160/night',
        why: 'Good location for the first Istanbul nights; walkable to ferries and Galata.',
        blockers: 'Check noise and parking before booking.',
        action: 'Compare direct rate and cancellation terms.',
        directWebsite: { label: 'Official website', url: 'https://example-hotel.test' },
        ratings: [
          {
            name: 'Example Hotel',
            checkedAt: '2026-06-05',
            bookingCom: '8.7',
            tripadvisor: '4.5',
            google: '4.4',
          },
        ],
        dayNumbers: [1, 2, 3],
      },
    },
  },
  day_range_read: {
    tool: 'get_trip',
    input: { trip_id: 'uuid', view: 'sections', day_start: 27, day_end: 39, sections: ['days', 'transport', 'accommodation', 'meals', 'images'] },
  },
  day_hero_image: {
    tools: ['search_trip_images', 'set_trip_image'],
    input: {
      search_trip_images: { query: 'Plovdiv Bulgaria old town', orientation: 'landscape' },
      set_trip_image: { trip_id: 'uuid', target: 'day_hero', day_number: 38, url: '<landscape URL>', download_url: '<download_url>' },
    },
  },
  generated_cover: {
    tools: ['get_trip_image_prompts', 'save_trip_image_asset'],
    input: { trip_id: 'uuid', slot: 'cover_portrait' },
  },
};

export function createOurTripsMcpServer(origin: string): McpServer {
  const server = new McpServer(
    {
      name: 'ourtrips',
      title: 'OurTrips',
      version: '1.0.0',
    },
    {
      instructions: MCP_INSTRUCTIONS,
      capabilities: {
        tools: {},
      },
    }
  );

  server.registerTool(
    'get_trip_schema',
    {
      title: 'Get trip schema',
      description:
        'Return the OurTrips JSON schema guidance from the MCP server. Use this instead of relying on any skill or reverse-engineering a large trip.',
      inputSchema: {
        section: SchemaSectionSchema.describe('Optional schema section to return. Omit for the overview.'),
      },
      annotations: {
        title: 'Get trip schema',
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: false,
      },
    },
    async ({ section }) => {
      const key = section ?? 'overview';
      return jsonResult({
        section: key,
        schema: TRIP_SCHEMA_REFERENCE[key],
      });
    }
  );

  server.registerTool(
    'get_trip_template',
    {
      title: 'Get trip template',
      description:
        'Return compact examples for common OurTrips save, edit, image, and read workflows.',
      inputSchema: {
        template: z
          .enum(['new_trip', 'new_trip_v2', 'new_trip_v3', 'logistics_ledger', 'validate_contract', 'replace_hotel', 'accommodation_shortlist', 'day_range_read', 'day_hero_image', 'generated_cover'])
          .optional()
          .describe('Optional template name. Omit to list all templates.'),
      },
      annotations: {
        title: 'Get trip template',
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: false,
      },
    },
    async ({ template }) => {
      if (template) {
        return jsonResult({ template, example: TRIP_TEMPLATE_REFERENCE[template] });
      }
      return jsonResult({ templates: TRIP_TEMPLATE_REFERENCE });
    }
  );

  server.registerTool(
    'save_trip',
    {
      title: 'Save trip',
      description:
        'Save a complete travel itinerary to the authenticated user account on OurTrips and return a shareable URL.',
      inputSchema: {
        trip: TripPayloadSchema,
        days: z.array(DayPayloadSchema).describe('Day-by-day itinerary data.'),
        markdown_source: z
          .string()
          .max(262144)
          .optional()
          .describe('Optional original markdown itinerary, up to 256 KB.'),
        trip_id: z
          .string()
          .optional()
          .describe('Optional existing OurTrips trip id to update.'),
      },
      annotations: {
        title: 'Save trip',
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async (input, extra) => {
      try {
        const result = await saveTripForUser(
          createAdminClient(),
          userIdFromAuth(extra),
          input,
          origin
        );
        return jsonResult(result);
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  server.registerTool(
    'save_trip_v2',
    {
      title: 'Save trip v2',
      description:
        'Save a complete OurTrips itinerary using the v2 quality contract. Returns quality warnings so sparse or unstructured days can be repaired.',
      inputSchema: {
        trip: TripMetaV2Schema,
        days: z.array(DayV2Schema).describe('Day-by-day itinerary data following the OurTrips v2 quality contract.'),
        markdown_source: z
          .string()
          .max(262144)
          .optional()
          .describe('Optional original markdown itinerary, up to 256 KB.'),
        trip_id: z
          .string()
          .optional()
          .describe('Optional existing OurTrips trip id to update.'),
        strict_quality: z
          .boolean()
          .optional()
          .describe('When true, reject hard quality errors. Warnings are still returned for repair guidance.'),
      },
      annotations: {
        title: 'Save trip v2',
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async (input, extra) => {
      try {
        const result = await saveTripForUser(
          createAdminClient(),
          userIdFromAuth(extra),
          {
            ...input,
            trip_schema_version: 2,
          },
          origin
        );
        return jsonResult(result);
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  server.registerTool(
    'save_trip_v3',
    {
      title: 'Save trip v3',
      description:
        'Save a complete OurTrips itinerary with the v2 quality contract plus a hard logistics gate for exact dates, sleeps/nights, stay segments, and transport requirements. Rejects hard logistics contradictions by default.',
      inputSchema: {
        trip: TripMetaV2Schema,
        days: z.array(DayV2Schema).describe('Day-by-day itinerary data following the OurTrips quality and logistics contracts.'),
        markdown_source: z
          .string()
          .max(262144)
          .optional()
          .describe('Optional original markdown itinerary, up to 256 KB.'),
        trip_id: z
          .string()
          .optional()
          .describe('Optional existing OurTrips trip id to update.'),
        strict_quality: z
          .boolean()
          .optional()
          .default(true)
          .describe('When true, reject hard quality/logistics errors. Defaults to true for save_trip_v3.'),
      },
      annotations: {
        title: 'Save trip v3',
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async (input, extra) => {
      try {
        const result = await saveTripForUser(
          createAdminClient(),
          userIdFromAuth(extra),
          {
            ...input,
            strict_quality: input.strict_quality ?? true,
            trip_schema_version: 2,
          },
          origin
        );
        return jsonResult(result);
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  server.registerTool(
    'list_trips',
    {
      title: 'List trips',
      description:
        'List the authenticated user account trips saved in OurTrips, newest first.',
      inputSchema: {},
      annotations: {
        title: 'List trips',
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: false,
      },
    },
    async (_input, extra) => {
      try {
        const trips = await listTripsForUser(
          createAdminClient(),
          userIdFromAuth(extra),
          origin
        );
        return jsonResult({ trips });
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  server.registerTool(
    'get_trip',
    {
      title: 'Get trip',
      description:
        'Read a saved OurTrips itinerary. Use summary, day, or sections views to avoid huge responses.',
      inputSchema: {
        trip_id: z.string().min(1).describe('The OurTrips trip id.'),
        view: z
          .enum(['full', 'summary', 'day', 'days', 'sections'])
          .optional()
          .describe('summary is compact. day returns one full day. days returns selected full days. sections returns selected fields. full requires allow_large=true.'),
        day_number: DayNumberSchema.optional().describe('Required for day view; optional for sections view.'),
        day_numbers: z
          .array(DayNumberSchema)
          .optional()
          .describe('Optional list of specific days for days or sections view.'),
        day_start: DayNumberSchema.optional().describe('Optional first day number for days or sections view.'),
        day_end: DayNumberSchema.optional().describe('Optional last day number for days or sections view.'),
        sections: z
          .array(ReadSectionSchema)
          .optional()
          .describe('Selected sections for sections view, such as days, images, image_assets, transport, accommodation, meals, or blocks.'),
        include_markdown_source: z
          .boolean()
          .optional()
          .describe('Only true returns the full markdown_source in sections view; otherwise a hash/length summary is returned.'),
        allow_large: z
          .boolean()
          .optional()
          .describe('Required for view=full because full trips can exceed agent token limits.'),
      },
      annotations: {
        title: 'Get trip',
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: false,
      },
    },
    async ({ trip_id, ...readInput }, extra) => {
      try {
        const trip = await getTripForUser(
          createAdminClient(),
          userIdFromAuth(extra),
          trip_id
        );
        return jsonResult(formatTripForRead(trip, readInput, origin));
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  server.registerTool(
    'get_trip_logistics_ledger',
    {
      title: 'Get trip logistics ledger',
      description:
        'Return the compact canonical date/stay ledger for a saved trip. Use this before answering or editing anything about trip start/end dates, day count, nights, stays, route shape, or how long the traveler spends somewhere.',
      inputSchema: {
        trip_id: z.string().min(1).describe('The OurTrips trip id.'),
      },
      annotations: {
        title: 'Get trip logistics ledger',
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: false,
      },
    },
    async ({ trip_id }, extra) => {
      try {
        return jsonResult(
          await getTripLogisticsLedgerForUser(
            createAdminClient(),
            userIdFromAuth(extra),
            trip_id,
            origin
          )
        );
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  server.registerTool(
    'validate_trip_contract',
    {
      title: 'Validate trip contract',
      description:
        'Run the OurTrips quality and logistics contracts for a saved trip. Use this before saying a trip is complete, especially after edits involving exact dates, sleeps/nights, hotel stays, or transport legs.',
      inputSchema: {
        trip_id: z.string().min(1).describe('The OurTrips trip id.'),
        response_mode: ResponseModeSchema,
      },
      annotations: {
        title: 'Validate trip contract',
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: false,
      },
    },
    async ({ trip_id, response_mode }, extra) => {
      try {
        const record = await getTripForUser(
          createAdminClient(),
          userIdFromAuth(extra),
          trip_id
        );
        const tripData = normalizeTripData(record.data);
        const logistics = auditTripLogistics(tripData);
        const quality = validateItineraryQuality(tripData);

        if (response_mode === 'full') {
          return jsonResult({ logistics, quality });
        }

        return jsonResult({
          status: logistics.errors.length || quality.errors.length ? 'needs_repair' : 'ok',
          logistics: {
            summary: logistics.summary,
            errors: logistics.errors,
            warnings: logistics.warnings,
            open_questions: logistics.ledger.openQuestions,
          },
          quality: {
            summary: quality.summary,
            errors: quality.errors,
            warnings: quality.warnings,
          },
        });
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  server.registerTool(
    'list_accommodation_review',
    {
      title: 'List accommodation review',
      description:
        'Read the private Accommodations Reviewer for a trip: overnight destinations, hotel candidates grouped by review lane, and recent candidate events. Use this before creating or promoting hotel options.',
      inputSchema: {
        trip_id: z.string().min(1).describe('The OurTrips trip id.'),
        response_mode: ResponseModeSchema,
      },
      annotations: {
        title: 'List accommodation review',
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: false,
      },
    },
    async ({ trip_id, response_mode }, extra) => {
      try {
        const context = await loadAccommodationReviewForUser(
          userIdFromAuth(extra),
          trip_id
        );
        return accommodationReviewResult(origin, context.record, context.review, response_mode);
      } catch (err) {
        return accommodationReviewErrorResult(err);
      }
    }
  );

  server.registerTool(
    'create_accommodation_candidate',
    {
      title: 'Create accommodation candidate',
      description:
        'Create one private hotel proposal card in the Accommodations Reviewer. For an unbooked overnight stop, create 2-4 candidates, usually 3, by calling this once per hotel. Do not combine several hotels in one candidate.',
      inputSchema: {
        trip_id: z.string().min(1).describe('The OurTrips trip id.'),
        candidate: AccommodationCandidateCreateSchema.describe(
          'One hotel/stay candidate. Include the official directWebsite and checked ratings evidence.'
        ),
        destination: AccommodationReviewDestinationSchema.optional().describe(
          'Optional overnight destination to create if it does not already exist. Usually omit this and use destinationId or dayNumbers from list_accommodation_review.'
        ),
        message: z.string().optional().describe('Optional event note explaining why this candidate was created.'),
        response_mode: ResponseModeSchema,
      },
      annotations: {
        title: 'Create accommodation candidate',
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async ({ trip_id, candidate, destination, message, response_mode }, extra) => {
      try {
        const context = await loadAccommodationReviewForUser(
          userIdFromAuth(extra),
          trip_id
        );
        const nextReview = addAccommodationCandidate(
          context.review,
          candidate as Omit<AccommodationCandidate, 'id'>,
          'agent',
          message,
          destination as AccommodationReviewDestination | undefined
        );
        await saveAccommodationReviewForTrip(context.admin, trip_id, nextReview);
        return accommodationReviewResult(origin, context.record, nextReview, response_mode, {
          status: 'created',
          candidate_id: nextReview.accommodations.at(-1)?.id,
        });
      } catch (err) {
        return accommodationReviewErrorResult(err);
      }
    }
  );

  server.registerTool(
    'update_accommodation_candidate',
    {
      title: 'Update accommodation candidate',
      description:
        'Patch one private accommodation-review candidate. Use this for facts such as price, official website, ratings, dog/parking terms, watch-outs, rate checks, or decision notes. This does not edit the public itinerary unless the candidate is later promoted.',
      inputSchema: {
        trip_id: z.string().min(1).describe('The OurTrips trip id.'),
        candidate_id: z.string().min(1),
        candidate_patch: AccommodationCandidatePatchSchema,
        message: z.string().optional().describe('Optional event note explaining the update.'),
        response_mode: ResponseModeSchema,
      },
      annotations: {
        title: 'Update accommodation candidate',
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async ({ trip_id, candidate_id, candidate_patch, message, response_mode }, extra) => {
      try {
        const context = await loadAccommodationReviewForUser(
          userIdFromAuth(extra),
          trip_id
        );
        const nextReview = updateAccommodationCandidate(
          context.review,
          candidate_id,
          candidate_patch as Partial<AccommodationCandidate>,
          'agent',
          message
        );
        await saveAccommodationReviewForTrip(context.admin, trip_id, nextReview);
        return accommodationReviewResult(origin, context.record, nextReview, response_mode, {
          status: 'updated',
          candidate_id,
          updated_keys: Object.keys(candidate_patch),
        });
      } catch (err) {
        return accommodationReviewErrorResult(err);
      }
    }
  );

  server.registerTool(
    'move_accommodation_candidate',
    {
      title: 'Move accommodation candidate',
      description:
        'Move one private accommodation candidate between proposed, considering, dismissed, and booked. Moving to booked also promotes the candidate into the public itinerary accommodation cards.',
      inputSchema: {
        trip_id: z.string().min(1).describe('The OurTrips trip id.'),
        candidate_id: z.string().min(1),
        lane: AccommodationReviewLaneSchema,
        booking: AccommodationCandidateBookingSchema.optional().describe(
          'Optional real booking details. Never invent confirmations or booking references.'
        ),
        message: z.string().optional().describe('Optional event note explaining the move.'),
        response_mode: ResponseModeSchema,
      },
      annotations: {
        title: 'Move accommodation candidate',
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async ({ trip_id, candidate_id, lane, booking, message, response_mode }, extra) => {
      try {
        const userId = userIdFromAuth(extra);
        const context = await loadAccommodationReviewForUser(userId, trip_id);
        let nextReview = moveAccommodationCandidate(
          context.review,
          candidate_id,
          lane as AccommodationReviewLane,
          'agent',
          booking as AccommodationCandidateBooking | undefined,
          message
        );
        let updatedRecord = context.record;
        let promotedToTrip = false;

        if (lane === 'booked') {
          const nextTripData = promoteCandidateToTrip(
            context.tripData,
            nextReview,
            candidate_id,
            booking as AccommodationCandidateBooking | undefined
          );
          updatedRecord = await persistPromotedAccommodationTripData(
            context.admin,
            userId,
            trip_id,
            nextTripData
          );
          await saveAccommodationReviewForTrip(context.admin, trip_id, nextReview);
          nextReview = await syncAccommodationReviewForTrip(
            context.admin,
            trip_id,
            nextTripData
          );
          promotedToTrip = true;
        } else {
          await saveAccommodationReviewForTrip(context.admin, trip_id, nextReview);
        }

        return accommodationReviewResult(origin, updatedRecord, nextReview, response_mode, {
          status: 'moved',
          candidate_id,
          lane,
          promoted_to_trip: promotedToTrip,
        });
      } catch (err) {
        return accommodationReviewErrorResult(err);
      }
    }
  );

  server.registerTool(
    'promote_accommodation_candidate',
    {
      title: 'Promote accommodation candidate',
      description:
        'Mark one private accommodation candidate as booked and promote it into the public itinerary accommodation cards for its destination/day numbers.',
      inputSchema: {
        trip_id: z.string().min(1).describe('The OurTrips trip id.'),
        candidate_id: z.string().min(1),
        booking: AccommodationCandidateBookingSchema.optional().describe(
          'Optional real booking details. Never invent confirmations or booking references.'
        ),
        message: z.string().optional().describe('Optional event note explaining the promotion.'),
        response_mode: ResponseModeSchema,
      },
      annotations: {
        title: 'Promote accommodation candidate',
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async ({ trip_id, candidate_id, booking, message, response_mode }, extra) => {
      try {
        const userId = userIdFromAuth(extra);
        const context = await loadAccommodationReviewForUser(userId, trip_id);
        let nextReview = moveAccommodationCandidate(
          context.review,
          candidate_id,
          'booked',
          'agent',
          booking as AccommodationCandidateBooking | undefined,
          message ?? 'Promoted into the itinerary by the OurTrips MCP agent.'
        );
        const nextTripData = promoteCandidateToTrip(
          context.tripData,
          nextReview,
          candidate_id,
          booking as AccommodationCandidateBooking | undefined
        );
        const updatedRecord = await persistPromotedAccommodationTripData(
          context.admin,
          userId,
          trip_id,
          nextTripData
        );
        await saveAccommodationReviewForTrip(context.admin, trip_id, nextReview);
        nextReview = await syncAccommodationReviewForTrip(
          context.admin,
          trip_id,
          nextTripData
        );
        return accommodationReviewResult(origin, updatedRecord, nextReview, response_mode, {
          status: 'promoted',
          candidate_id,
          promoted_to_trip: true,
        });
      } catch (err) {
        return accommodationReviewErrorResult(err);
      }
    }
  );

  server.registerTool(
    'replace_booked_accommodation_candidate',
    {
      title: 'Replace booked accommodation candidate',
      description:
        'Replace the currently booked hotel for a destination with another private candidate. This demotes the old booked candidate, marks the selected candidate booked, and updates the public itinerary accommodation cards.',
      inputSchema: {
        trip_id: z.string().min(1).describe('The OurTrips trip id.'),
        candidate_id: z.string().min(1),
        booking: AccommodationCandidateBookingSchema.optional().describe(
          'Optional real booking details. Never invent confirmations or booking references.'
        ),
        message: z.string().optional().describe('Optional event note explaining the replacement.'),
        response_mode: ResponseModeSchema,
      },
      annotations: {
        title: 'Replace booked accommodation candidate',
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async ({ trip_id, candidate_id, booking, message, response_mode }, extra) => {
      try {
        const userId = userIdFromAuth(extra);
        const context = await loadAccommodationReviewForUser(userId, trip_id);
        let nextReview = replaceBookedAccommodationCandidate(
          context.review,
          candidate_id,
          'agent',
          booking as AccommodationCandidateBooking | undefined,
          message
        );
        const nextTripData = promoteCandidateToTrip(
          context.tripData,
          nextReview,
          candidate_id,
          booking as AccommodationCandidateBooking | undefined
        );
        const updatedRecord = await persistPromotedAccommodationTripData(
          context.admin,
          userId,
          trip_id,
          nextTripData
        );
        await saveAccommodationReviewForTrip(context.admin, trip_id, nextReview);
        nextReview = await syncAccommodationReviewForTrip(
          context.admin,
          trip_id,
          nextTripData
        );
        return accommodationReviewResult(origin, updatedRecord, nextReview, response_mode, {
          status: 'replaced_booked_candidate',
          candidate_id,
          promoted_to_trip: true,
        });
      } catch (err) {
        return accommodationReviewErrorResult(err);
      }
    }
  );

  server.registerTool(
    'patch_trip',
    {
      title: 'Patch trip',
      description:
        'Patch selected metadata, days, markdown_source, or explicit JSON paths on an existing OurTrips itinerary. Prefer focused upsert/delete tools for item-level edits.',
      inputSchema: {
        trip_id: z.string().min(1).describe('The OurTrips trip id to update.'),
        trip: TripPayloadSchema.optional().describe('Partial trip metadata to merge.'),
        days: z
          .array(DayPayloadSchema)
          .optional()
          .describe(
            'Partial day objects to merge by day_number. Days without day_number are ignored.'
          ),
        markdown_source: z
          .string()
          .max(262144)
          .optional()
          .describe('Replacement markdown_source. Send an empty string to clear it.'),
        mode: PatchModeSchema,
        replace_paths: z
          .array(ReplacePathSchema)
          .optional()
          .describe('Exact replacements at safe paths like trip.summary, days[day_number=2].transport, or days[day_number=2].blocks[0].detail.'),
        delete_paths: z
          .array(z.string().min(1))
          .optional()
          .describe('Delete safe paths like days[day_number=2].accommodation or days[day_number=2].meals[1].'),
        response_mode: ResponseModeSchema,
      },
      annotations: {
        title: 'Patch trip',
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async ({ trip_id, response_mode, ...patch }, extra) => {
      try {
        const result = await patchTripForUserWithResult(
          createAdminClient(),
          userIdFromAuth(extra),
          trip_id,
          { ...patch, response_mode },
          origin
        );
        return mutationResult(result, response_mode);
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  server.registerTool(
    'upsert_meal',
    {
      title: 'Upsert meal',
      description:
        'Add or update one meal/restaurant on a day without replacing the whole meals array.',
      inputSchema: {
        trip_id: z.string().min(1),
        day_number: DayNumberSchema,
        meal: JsonObjectSchema.describe('Meal object, usually with type, name, note, status, and detail.'),
        match: ItemMatchSchema.optional(),
        mode: PatchModeSchema,
        position: z.enum(['append', 'prepend']).optional(),
        response_mode: ResponseModeSchema,
      },
      annotations: {
        title: 'Upsert meal',
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async ({ trip_id, day_number, meal, response_mode, ...input }, extra) => {
      try {
        const result = await upsertDayItemForUser(
          createAdminClient(),
          userIdFromAuth(extra),
          trip_id,
          { kind: 'meal', day_number, item: meal, response_mode, ...input },
          origin
        );
        return mutationResult(result, response_mode);
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  server.registerTool(
    'delete_meal',
    {
      title: 'Delete meal',
      description:
        'Delete one meal/restaurant from a day by index, name, type, or other match fields.',
      inputSchema: {
        trip_id: z.string().min(1),
        day_number: DayNumberSchema,
        match: ItemMatchSchema,
        response_mode: ResponseModeSchema,
      },
      annotations: {
        title: 'Delete meal',
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async ({ trip_id, day_number, match, response_mode }, extra) => {
      try {
        const result = await deleteDayItemForUser(
          createAdminClient(),
          userIdFromAuth(extra),
          trip_id,
          { kind: 'meal', day_number, match, response_mode },
          origin
        );
        return mutationResult(result, response_mode);
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  server.registerTool(
    'upsert_accommodation',
    {
      title: 'Upsert accommodation',
      description:
        'Add or update a hotel/accommodation for one day, or for all days with the matching accommodation name.',
      inputSchema: {
        trip_id: z.string().min(1),
        day_number: DayNumberSchema,
        accommodation: JsonObjectSchema.describe('Accommodation object, usually with name, price, rating, status, nights, note, and detail.'),
        match: ItemMatchSchema.optional(),
        mode: PatchModeSchema,
        scope: AccommodationScopeSchema,
        response_mode: ResponseModeSchema,
      },
      annotations: {
        title: 'Upsert accommodation',
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async ({ trip_id, day_number, accommodation, response_mode, ...input }, extra) => {
      try {
        const result = await upsertDayItemForUser(
          createAdminClient(),
          userIdFromAuth(extra),
          trip_id,
          { kind: 'accommodation', day_number, item: accommodation, response_mode, ...input },
          origin
        );
        return mutationResult(result, response_mode);
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  server.registerTool(
    'delete_accommodation',
    {
      title: 'Delete accommodation',
      description:
        'Remove a hotel/accommodation from one day, or from all days with the matching accommodation name.',
      inputSchema: {
        trip_id: z.string().min(1),
        day_number: DayNumberSchema,
        match: ItemMatchSchema.optional(),
        scope: AccommodationScopeSchema,
        response_mode: ResponseModeSchema,
      },
      annotations: {
        title: 'Delete accommodation',
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async ({ trip_id, day_number, match, scope, response_mode }, extra) => {
      try {
        const result = await deleteDayItemForUser(
          createAdminClient(),
          userIdFromAuth(extra),
          trip_id,
          { kind: 'accommodation', day_number, match, scope, response_mode },
          origin
        );
        return mutationResult(result, response_mode);
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  server.registerTool(
    'replace_accommodation',
    {
      title: 'Replace accommodation',
      description:
        'Replace the entire accommodation object for a day, or for all days with the matching accommodation name. Use this for hotel swaps so stale detail fields cannot survive.',
      inputSchema: {
        trip_id: z.string().min(1),
        day_number: DayNumberSchema,
        accommodation: JsonObjectSchema.describe('Complete replacement accommodation object, or use delete_accommodation to clear it.'),
        match: ItemMatchSchema.optional(),
        scope: AccommodationScopeSchema,
        response_mode: ResponseModeSchema,
      },
      annotations: {
        title: 'Replace accommodation',
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async ({ trip_id, day_number, accommodation, response_mode, ...input }, extra) => {
      try {
        const result = await upsertDayItemForUser(
          createAdminClient(),
          userIdFromAuth(extra),
          trip_id,
          {
            kind: 'accommodation',
            day_number,
            item: accommodation,
            response_mode,
            mode: 'replace',
            ...input,
          },
          origin
        );
        return mutationResult(result, response_mode);
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  server.registerTool(
    'upsert_transport',
    {
      title: 'Upsert transport',
      description:
        'Add or update one transport leg, including train journeys, without replacing the whole transport array.',
      inputSchema: {
        trip_id: z.string().min(1),
        day_number: DayNumberSchema,
        transport: JsonObjectSchema.describe('Transport object, usually with mode, label, from, to, depart, arrive, duration, status, and detail.'),
        match: ItemMatchSchema.optional(),
        mode: PatchModeSchema,
        position: z.enum(['append', 'prepend']).optional(),
        response_mode: ResponseModeSchema,
      },
      annotations: {
        title: 'Upsert transport',
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async ({ trip_id, day_number, transport, response_mode, ...input }, extra) => {
      try {
        const result = await upsertDayItemForUser(
          createAdminClient(),
          userIdFromAuth(extra),
          trip_id,
          { kind: 'transport', day_number, item: transport, response_mode, ...input },
          origin
        );
        return mutationResult(result, response_mode);
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  server.registerTool(
    'delete_transport',
    {
      title: 'Delete transport',
      description:
        'Delete one transport leg, including train journeys, by index, label, route, mode, or other match fields.',
      inputSchema: {
        trip_id: z.string().min(1),
        day_number: DayNumberSchema,
        match: ItemMatchSchema,
        response_mode: ResponseModeSchema,
      },
      annotations: {
        title: 'Delete transport',
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async ({ trip_id, day_number, match, response_mode }, extra) => {
      try {
        const result = await deleteDayItemForUser(
          createAdminClient(),
          userIdFromAuth(extra),
          trip_id,
          { kind: 'transport', day_number, match, response_mode },
          origin
        );
        return mutationResult(result, response_mode);
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  server.registerTool(
    'upsert_activity',
    {
      title: 'Upsert activity',
      description:
        'Add or update one actual programme/activity block, tourist attraction, site, museum, viewpoint, or excursion without replacing the whole blocks array. Do not use this for the day intro; write days[].description_title and days[].description instead.',
      inputSchema: {
        trip_id: z.string().min(1),
        day_number: DayNumberSchema,
        activity: JsonObjectSchema.describe('Activity block object, usually with time_label, content, type, detail, and options.'),
        match: ItemMatchSchema.optional(),
        mode: PatchModeSchema,
        position: z.enum(['append', 'prepend']).optional(),
        response_mode: ResponseModeSchema,
      },
      annotations: {
        title: 'Upsert activity',
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async ({ trip_id, day_number, activity, response_mode, ...input }, extra) => {
      try {
        const result = await upsertDayItemForUser(
          createAdminClient(),
          userIdFromAuth(extra),
          trip_id,
          { kind: 'activity', day_number, item: activity, response_mode, ...input },
          origin
        );
        return mutationResult(result, response_mode);
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  server.registerTool(
    'delete_activity',
    {
      title: 'Delete activity',
      description:
        'Delete one activity block, tourist attraction, site, museum, viewpoint, or excursion by index, title, time label, type, or content match.',
      inputSchema: {
        trip_id: z.string().min(1),
        day_number: DayNumberSchema,
        match: ItemMatchSchema,
        response_mode: ResponseModeSchema,
      },
      annotations: {
        title: 'Delete activity',
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async ({ trip_id, day_number, match, response_mode }, extra) => {
      try {
        const result = await deleteDayItemForUser(
          createAdminClient(),
          userIdFromAuth(extra),
          trip_id,
          { kind: 'activity', day_number, match, response_mode },
          origin
        );
        return mutationResult(result, response_mode);
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  server.registerTool(
    'replace_day_section',
    {
      title: 'Replace day section',
      description:
        'Replace a full day section when a complete overwrite is safer than merge semantics.',
      inputSchema: {
        trip_id: z.string().min(1),
        day_number: DayNumberSchema,
        section: z.enum(['blocks', 'transport', 'accommodation', 'meals', 'tips', 'stats']),
        value: z.unknown(),
        response_mode: ResponseModeSchema,
      },
      annotations: {
        title: 'Replace day section',
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async ({ trip_id, response_mode, ...input }, extra) => {
      try {
        const result = await replaceDaySectionForUser(
          createAdminClient(),
          userIdFromAuth(extra),
          trip_id,
          { ...input, response_mode },
          origin
        );
        return mutationResult(result, response_mode);
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  server.registerTool(
    'replace_day',
    {
      title: 'Replace day',
      description:
        'Replace one complete day object by day_number. Use this for rewritten days, changed destinations, or when merge semantics could leave stale nested data.',
      inputSchema: {
        trip_id: z.string().min(1),
        day_number: DayNumberSchema,
        day: DayPayloadSchema.describe('Complete replacement day object. day_number is preserved from the input if omitted.'),
        response_mode: ResponseModeSchema,
      },
      annotations: {
        title: 'Replace day',
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async ({ trip_id, response_mode, ...input }, extra) => {
      try {
        const result = await replaceDayForUser(
          createAdminClient(),
          userIdFromAuth(extra),
          trip_id,
          { ...input, response_mode },
          origin
        );
        return mutationResult(result, response_mode);
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  server.registerTool(
    'delete_day',
    {
      title: 'Delete day',
      description:
        'Delete one complete day by day_number. Use truncate_days_after when removing a trailing route tail.',
      inputSchema: {
        trip_id: z.string().min(1),
        day_number: DayNumberSchema,
        response_mode: ResponseModeSchema,
      },
      annotations: {
        title: 'Delete day',
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async ({ trip_id, day_number, response_mode }, extra) => {
      try {
        const result = await deleteDayForUser(
          createAdminClient(),
          userIdFromAuth(extra),
          trip_id,
          { day_number, response_mode },
          origin
        );
        return mutationResult(result, response_mode);
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  server.registerTool(
    'truncate_days_after',
    {
      title: 'Truncate days after',
      description:
        'Delete every day after keep_through_day_number. Use this when a trip gets shorter and trailing days must disappear.',
      inputSchema: {
        trip_id: z.string().min(1),
        keep_through_day_number: DayNumberSchema,
        response_mode: ResponseModeSchema,
      },
      annotations: {
        title: 'Truncate days after',
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async ({ trip_id, keep_through_day_number, response_mode }, extra) => {
      try {
        const result = await truncateDaysAfterForUser(
          createAdminClient(),
          userIdFromAuth(extra),
          trip_id,
          { keep_through_day_number, response_mode },
          origin
        );
        return mutationResult(result, response_mode);
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  server.registerTool(
    'sync_markdown_source',
    {
      title: 'Sync markdown source',
      description:
        'Replace the stored Original Plan markdown_source. Use expected_current_hash when doing concurrency-safe edits.',
      inputSchema: {
        trip_id: z.string().min(1),
        markdown_source: z.string().max(262144),
        expected_current_hash: z.string().optional(),
        response_mode: ResponseModeSchema,
      },
      annotations: {
        title: 'Sync markdown source',
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async ({ trip_id, response_mode, ...input }, extra) => {
      try {
        const result = await syncMarkdownSourceForUser(
          createAdminClient(),
          userIdFromAuth(extra),
          trip_id,
          { ...input, response_mode },
          origin
        );
        return mutationResult(result, response_mode);
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  server.registerTool(
    'update_from_markdown',
    {
      title: 'Update from markdown',
      description:
        'Replace markdown_source and optionally apply agent-provided parsed trip/days JSON. OurTrips stores markdown verbatim and does not parse it server-side.',
      inputSchema: {
        trip_id: z.string().min(1),
        markdown_source: z.string().max(262144),
        expected_current_hash: z.string().optional(),
        trip: TripPayloadSchema.optional(),
        days: z.array(DayPayloadSchema).optional(),
        mode: PatchModeSchema,
        response_mode: ResponseModeSchema,
      },
      annotations: {
        title: 'Update from markdown',
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async ({ trip_id, response_mode, ...input }, extra) => {
      try {
        const result = await updateTripFromMarkdownForUser(
          createAdminClient(),
          userIdFromAuth(extra),
          trip_id,
          { ...input, response_mode },
          origin
        );
        return mutationResult(result, response_mode);
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  server.registerTool(
    'search_trip_images',
    {
      title: 'Search trip images',
      description:
        'Search OurTrips-backed Unsplash results for real image URLs. Use portrait for trip heroes and landscape for day heroes. Do not invent Unsplash URLs.',
      inputSchema: {
        query: z.string().min(1),
        orientation: ImageOrientationSchema.describe('Defaults to landscape. Use portrait for trip hero images.'),
      },
      annotations: {
        title: 'Search trip images',
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: true,
      },
    },
    async ({ query, orientation }) => {
      try {
        const result = await searchTripImages(query, orientation ?? 'landscape');
        return jsonResult({
          ...result,
          next_step:
            'Pick a matching result, then call set_trip_image with the chosen landscape or portrait URL and its download_url so Unsplash tracking is recorded.',
        });
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  server.registerTool(
    'set_trip_image',
    {
      title: 'Set trip image',
      description:
        'Set a trip hero, overview image, or day hero image from a real URL. Pass the Unsplash download_url from search_trip_images when available so tracking is recorded.',
      inputSchema: {
        trip_id: z.string().min(1),
        target: z.enum(['trip_hero', 'trip_overview', 'day_hero']),
        day_number: DayNumberSchema.optional().describe('Required when target is day_hero.'),
        url: z.string().min(1),
        download_url: z.string().optional(),
        response_mode: ResponseModeSchema,
      },
      annotations: {
        title: 'Set trip image',
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ trip_id, target, day_number, url, download_url, response_mode }, extra) => {
      try {
        if (target === 'day_hero' && typeof day_number !== 'number') {
          throw new TripServiceError('day_number is required when target is day_hero', 400);
        }
        const result = await setTripHeroImageForUser(
          createAdminClient(),
          userIdFromAuth(extra),
          trip_id,
          {
            target:
              target === 'day_hero'
                ? { kind: 'day', day_number: day_number as number }
                : { kind: 'trip', field: target === 'trip_overview' ? 'overview_image' : 'hero_image' },
            url,
            download_url,
            response_mode,
          },
          origin
        );
        return mutationResult(result, response_mode);
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  server.registerTool(
    'get_trip_image_status',
    {
      title: 'Get trip image status',
      description:
        'Return compact image coverage for a trip: trip hero, overview image, missing day hero images, and generated asset slots.',
      inputSchema: {
        trip_id: z.string().min(1),
      },
      annotations: {
        title: 'Get trip image status',
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: false,
      },
    },
    async ({ trip_id }, extra) => {
      try {
        const trip = await getTripForUser(
          createAdminClient(),
          userIdFromAuth(extra),
          trip_id
        );
        return jsonResult({
          trip_id,
          share_id: trip.share_id,
          url: `${origin}/t/${trip.share_id}`,
          image_status: summarizeTripImages(trip.data),
        });
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  server.registerTool(
    'complete_missing_trip_images',
    {
      title: 'Complete missing trip images',
      description:
        'Idempotently fill missing trip/day hero photography while preserving existing images. Use this for broad image-completion requests before claiming a trip is visually complete.',
      inputSchema: {
        trip_id: z.string().min(1),
        replace_existing: z.boolean().optional().describe('Defaults to false. Existing images are preserved unless this is true.'),
        include_overview: z.boolean().optional().describe('Defaults to true. Fill the optional trip overview image too.'),
        max_updates: z.number().int().positive().max(24).optional(),
      },
      annotations: {
        title: 'Complete missing trip images',
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ trip_id, replace_existing, include_overview, max_updates }, extra) => {
      try {
        const result = await completeMissingTripImagesForUser(
          createAdminClient(),
          userIdFromAuth(extra),
          trip_id,
          {
            replace_existing,
            include_overview,
            max_updates,
          },
          origin
        );
        const summary = { ...result };
        delete summary.trip_data;
        return jsonResult(summary);
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  server.registerTool(
    'get_trip_image_prompts',
    {
      title: 'Get trip image prompts',
      description:
        'Build grounded prompts for generated OurTrips cover/social assets from the current trip data. Use save_trip_image_asset after the agent creates and hosts an image elsewhere.',
      inputSchema: {
        trip_id: z.string().min(1),
      },
      annotations: {
        title: 'Get trip image prompts',
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: false,
      },
    },
    async ({ trip_id }, extra) => {
      try {
        const result = await getTripImagePromptsForUser(
          createAdminClient(),
          userIdFromAuth(extra),
          trip_id
        );
        return jsonResult(result);
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  server.registerTool(
    'save_trip_image_asset',
    {
      title: 'Save trip image asset',
      description:
        'Save a generated or externally hosted public image URL into trip.image_assets. Use this when an agent has already created and hosted the image elsewhere.',
      inputSchema: {
        trip_id: z.string().min(1),
        slot: ImageAssetSlotSchema,
        asset: ImageAssetSchema,
        response_mode: ResponseModeSchema,
      },
      annotations: {
        title: 'Save trip image asset',
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ trip_id, slot, asset, response_mode }, extra) => {
      try {
        const result = await saveTripImageAssetForUser(
          createAdminClient(),
          userIdFromAuth(extra),
          trip_id,
          { slot, asset, response_mode },
          origin
        );
        return mutationResult(result, response_mode);
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  server.registerTool(
    'verify_trip_public_data',
    {
      title: 'Verify public trip data',
      description:
        'Check that the public trip data endpoint and public trip page are reachable and match the saved trip summary.',
      inputSchema: {
        trip_id: z.string().min(1).optional(),
        share_id: z.string().min(1).optional(),
        check_page: z.boolean().optional().describe('Defaults to true. Set false to skip fetching the public HTML page.'),
      },
      annotations: {
        title: 'Verify public trip data',
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: false,
      },
    },
    async (input, extra) => {
      try {
        const result = await verifyTripPublicDataForUser(
          createAdminClient(),
          userIdFromAuth(extra),
          input
        );
        return jsonResult(result);
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  return server;
}

export const ourTripsMcpInstructions = MCP_INSTRUCTIONS;

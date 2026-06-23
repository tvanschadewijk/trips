/**
 * Zod schema for the EDITABLE subset of a trip.
 *
 * Single source of truth for two things:
 *   1. Runtime validation of `update_trip` tool input.
 *   2. JSON Schema description injected into the system prompt via
 *      `zod-to-json-schema`.
 *
 * If the schema changes, both the validator and the agent's mental model move
 * together. Immutable fields (`id`, `user_id`, `share_id`, `created_at`,
 * `updated_at`, and the top-level DB columns `trips.name` / `trips.share_mode`)
 * are deliberately absent — the agent cannot address them by name.
 *
 * Kept in sync with `src/lib/types.ts` by convention. Each schema uses
 * `.passthrough()` at the leaf record level so unknown optional fields inside
 * the existing JSONB blob pass through unchanged during a merge update.
 */
import { z } from 'zod';
import { ISO_DATE_RE, isIsoDateString } from '../trip-logistics';

// ---------- primitives ----------

const NonEmptyString = z.string().min(1);
const IsoDateString = z
  .string()
  .regex(ISO_DATE_RE, 'Use ISO 8601 YYYY-MM-DD.')
  .refine(isIsoDateString, 'Use a real calendar date.');

// ---------- nested shapes ----------

const ServiceLegSchema = z
  .object({
    date: IsoDateString,
    route: NonEmptyString,
  })
  .passthrough();

const ServiceSchema = z
  .object({
    type: NonEmptyString.describe('External service type. Do not use for restaurants, meals, or restaurant reservations.'),
    label: NonEmptyString.describe('External service label. Restaurant reservations belong in days[].meals[], not trip.services.'),
    icon: NonEmptyString,
    provider: NonEmptyString,
    ref: z.string().optional(),
    price: z.string().optional(),
    status: z.string().optional(),
    legs: z.array(ServiceLegSchema).optional(),
  })
  .passthrough();

const TripNoteSchema = z
  .object({
    title: NonEmptyString,
    icon: z.string().optional(),
    content: NonEmptyString,
  })
  .passthrough();

const TripImageAssetSchema = z
  .object({
    url: z.string().optional(),
    prompt: z.string().optional(),
    aspect_ratio: z.string().optional(),
    width: z.number().int().positive().optional(),
    height: z.number().int().positive().optional(),
    provider: z.string().optional(),
    model: z.string().optional(),
    source: z.enum(['imagegen', 'manual', 'search']).optional(),
    generated_at: z.string().optional(),
  })
  .passthrough();

const TripImageAssetsSchema = z
  .object({
    cover_portrait: TripImageAssetSchema.optional(),
    cover_landscape: TripImageAssetSchema.optional(),
    social_og: TripImageAssetSchema.optional(),
  })
  .passthrough();

const TripRoutePointSchema = z
  .object({
    label: NonEmptyString,
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
    day: z.number().int().positive().optional(),
    mode: z.string().optional(),
    role: z.enum(['home', 'stop', 'stay', 'excursion', 'trail', 'return']).optional(),
  })
  .passthrough();

const StatSchema = z
  .object({
    icon: NonEmptyString,
    label: NonEmptyString,
    value: NonEmptyString,
  })
  .passthrough();

const OptionSchema = z
  .object({
    label: NonEmptyString,
    description: z.string().optional(),
    duration: z.string().optional(),
    note: z.string().optional(),
  })
  .passthrough();

const TimePrecisionSchema = z.enum(['fixed', 'suggested', 'window']);
const BookingStatusSchema = z.string();

const ItineraryPlaceSchema = z
  .object({
    name: NonEmptyString,
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
    label: NonEmptyString,
    description: NonEmptyString,
    trigger: z.string().optional(),
    duration: z.string().optional(),
    cost_hint: z.string().optional(),
  })
  .passthrough();

const TravelWalletItemSchema = z
  .object({
    title: NonEmptyString,
    type: z.string().optional(),
    url: z.string().optional(),
    file_url: z.string().optional(),
    qr_code_url: z.string().optional(),
    confirmation: z.string().optional(),
    note: z.string().optional(),
    is_private: z.boolean().optional(),
  })
  .passthrough();

const RichDetailShape = {
  title: z.string().optional(),
  body: z.string().optional(),
  why: z.string().optional(),
  vibe: z.string().optional(),
  highlights: z.array(z.string()).optional(),
  what_to_see: z.array(z.string()).optional(),
  how_to_do_it: z.string().optional(),
  practical: z.string().optional(),
  booking_note: z.string().optional(),
  what_to_order: z.string().optional(),
  dog_note: z.string().optional(),
  wallet_items: z.array(TravelWalletItemSchema).optional(),
};

const RichDetailSchema = z.object(RichDetailShape).passthrough();

const BlockSchema = z
  .object({
    time_label: z.string(),
    content: NonEmptyString,
    type: NonEmptyString,
    starts_at: z.string().optional(),
    ends_at: z.string().optional(),
    time_precision: TimePrecisionSchema.optional(),
    duration_minutes: z.number().int().positive().optional(),
    place: ItineraryPlaceSchema.optional(),
    booking_status: BookingStatusSchema.optional(),
    reservation_required: z.boolean().optional(),
    cost_hint: z.string().optional(),
    pace: z.string().optional(),
    detail: RichDetailSchema.optional(),
    options: z.array(OptionSchema).optional(),
    alternatives: z.array(ItineraryAlternativeSchema).optional(),
  })
  .passthrough();

const ChargingStopSchema = z
  .object({
    name: NonEmptyString,
    location: z.string().optional(),
    network: z.string().optional(),
    kw: z.string().optional(),
    note: z.string().optional(),
  })
  .passthrough();

const BorderCrossingSchema = z
  .object({
    name: NonEmptyString,
    note: z.string().optional(),
    documents: z.string().optional(),
  })
  .passthrough();

const TransportDetailSchema = z
  .object({
    class: z.string().optional(),
    cabin: z.string().optional(),
    seats: z.string().optional(),
    seat: z.string().optional(),
    booking_ref: z.string().optional(),
    booking_platform: z.string().optional(),
    cabin_bag: z.string().optional(),
    hold_bag: z.string().optional(),
    check_in: z.string().optional(),
    platform: z.string().optional(),
    flight: z.string().optional(),
    terminal: z.string().optional(),
    gate: z.string().optional(),
    amenities: z.string().optional(),
    cancellation_policy: z.string().optional(),
    note: z.string().optional(),
    route: z.string().optional(),
    charging_stops: z.array(ChargingStopSchema).optional(),
    border: BorderCrossingSchema.optional(),
    wallet_items: z.array(TravelWalletItemSchema).optional(),
  })
  .passthrough();

const TransportSchema = z
  .object({
    mode: NonEmptyString,
    label: NonEmptyString,
    from: z.string().optional(),
    to: z.string().optional(),
    depart: z.string().optional(),
    arrive: z.string().optional(),
    duration: z.string().optional(),
    distance: z.string().optional(),
    status: z.string().optional(),
    booking_status: BookingStatusSchema.optional(),
    reservation_required: z.boolean().optional(),
    cost_hint: z.string().optional(),
    detail: TransportDetailSchema.optional(),
  })
  .passthrough();

const AccommodationDetailSchema = z
  .object({
    ...RichDetailShape,
    check_in: z.string().optional(),
    check_out: z.string().optional(),
    room_type: z.string().optional(),
    address: z.string().optional(),
    phone: z.string().optional(),
    direct_website_url: z.string().optional(),
    direct_website_label: z.string().optional(),
    confirmation: z.string().optional(),
    booking_platform: z.string().optional(),
    cancellation_deadline: z.string().optional(),
    wifi: z.string().optional(),
    parking: z.string().optional(),
    policy_source_url: z.string().optional(),
    policy_source_label: z.string().optional(),
    policy_confidence: z.enum(['high', 'medium', 'low']).optional(),
    note: z.string().optional(),
    wallet_items: z.array(TravelWalletItemSchema).optional(),
  })
  .passthrough();

const AccommodationSchema = z
  .object({
    name: NonEmptyString,
    price: z.string().optional(),
    rating: z.string().optional(),
    status: z.string().optional(),
    booking_status: BookingStatusSchema.optional(),
    reservation_required: z.boolean().optional(),
    cost_hint: z.string().optional(),
    nights: z.number().optional(),
    note: z.string().optional(),
    detail: AccommodationDetailSchema.optional(),
  })
  .passthrough();

const MealDetailSchema = z
  .object({
    ...RichDetailShape,
    address: z.string().optional(),
    phone: z.string().optional(),
    cuisine: z.string().optional(),
    price_range: z.string().optional(),
    reservation: z.string().optional(),
    booking_platform: z.string().optional(),
    hours: z.string().optional(),
    note: z.string().optional(),
    wallet_items: z.array(TravelWalletItemSchema).optional(),
  })
  .passthrough();

const MealSchema = z
  .object({
    type: NonEmptyString,
    name: NonEmptyString.describe('One restaurant, cafe, bar, bakery, or explicit food stop. Do not combine multiple restaurants in one meal.'),
    note: z.string().optional(),
    status: z.string().optional(),
    starts_at: z.string().optional(),
    ends_at: z.string().optional(),
    time_precision: TimePrecisionSchema.optional(),
    booking_status: BookingStatusSchema.optional(),
    reservation_required: z.boolean().optional(),
    cost_hint: z.string().optional(),
    place: ItineraryPlaceSchema.optional(),
    detail: MealDetailSchema.optional(),
  })
  .passthrough();

const TipSchema = z
  .object({
    icon: NonEmptyString,
    title: NonEmptyString,
    content: NonEmptyString.describe('Practical, place-specific tip content. Do not send empty placeholder tips.'),
    priority: z.enum(['high', 'normal']).optional(),
  })
  .passthrough();

const DaySchema = z
  .object({
    day_number: z.number().int().positive(),
    date: IsoDateString.describe('ISO 8601 YYYY-MM-DD'),
    title: NonEmptyString,
    subtitle: z.string().optional(),
    description_title: z.string().optional(),
    description: z.string().optional(),
    day_type: z.string().optional(),
    pace: z.string().optional(),
    hero_image: z.string().optional(),
    stats: z.array(StatSchema).optional(),
    blocks: z.array(BlockSchema).optional(),
    transport: z.array(TransportSchema).optional(),
    accommodation: AccommodationSchema.nullable().optional(),
    meals: z.array(MealSchema).optional(),
    tips: z.array(TipSchema).optional(),
    alternatives: z.array(ItineraryAlternativeSchema).optional(),
  })
  .passthrough();

// ---------- top-level editable trip ----------

/**
 * Fields inside `data.trip` that the agent may edit. All optional — merge-patch
 * semantics: only the fields the agent includes are updated.
 */
export const TripMetaEditableSchema = z
  .object({
    name: z.string().optional(),
    subtitle: z.string().optional(),
    dates: z
      .object({
        start: IsoDateString.describe('ISO 8601 YYYY-MM-DD'),
        end: IsoDateString.describe('ISO 8601 YYYY-MM-DD'),
      })
      .optional(),
    travelers: z.array(z.string()).optional(),
    summary: z.string().optional(),
    hero_image: z.string().optional(),
    overview_image: z.string().optional(),
    image_assets: TripImageAssetsSchema.optional(),
    route_points: z
      .array(TripRoutePointSchema)
      .optional()
      .describe('For full-trip rewrites, include at least two coordinate-backed route/stay stops with label, lat, and lng so the overview map can render without live place search.'),
    accent_color: z.string().optional(),
    services: z.array(ServiceSchema).optional(),
    notes: z.array(TripNoteSchema).optional(),
  })
  .passthrough();

/**
 * Top-level input for the `update_trip` tool. Semantics:
 *
 *   - `trip`: partial merge into `data.trip`. Only the provided fields are
 *     updated; others are preserved.
 *   - `days`: full replacement of `data.days`. If provided, the agent must
 *     send the COMPLETE ordered array of days. Arrays can't be partial-patched
 *     cleanly under JSON Merge Patch semantics, so touching days = replacing
 *     days.
 *
 * The tool rejects empty objects and rejects unknown top-level keys. Immutable
 * DB columns (`id`, `user_id`, `share_id`, `created_at`, `updated_at`, and
 * `trips.name` / `trips.share_mode`) are not in this schema and physically
 * cannot be addressed.
 *
 * NOTE: The SDK's `tool()` helper accepts a raw Zod shape (not a wrapped
 * `z.object(...)`), so we export both: the shape for tool registration and a
 * `.strict().refine()`-wrapped schema for server-side validation inside the
 * handler.
 */
export const UpdateTripInputShape = {
  trip: TripMetaEditableSchema.optional(),
  days: z.array(DaySchema).optional(),
  /**
   * Optional updated markdown source. Sent verbatim from the agent and
   * stored verbatim. Empty string clears the field. Cap: 256 KB.
   */
  markdown_source: z
    .string()
    .max(262144, 'markdown_source exceeds 256 KB')
    .optional(),
} as const;

export const UpdateTripInputSchema = z
  .object(UpdateTripInputShape)
  .strict()
  .refine(
    (obj: { trip?: unknown; days?: unknown; markdown_source?: unknown }) =>
      obj.trip !== undefined ||
      obj.days !== undefined ||
      obj.markdown_source !== undefined,
    {
      message:
        'At least one of `trip`, `days`, or `markdown_source` must be provided.',
    }
  );

export type UpdateTripInput = z.infer<typeof UpdateTripInputSchema>;
export type TripMetaEditable = z.infer<typeof TripMetaEditableSchema>;

const TripReadSectionSchema = z.enum([
  'trip',
  'markdown_source',
  'days',
  'images',
  'image_assets',
  'blocks',
  'transport',
  'accommodation',
  'meals',
  'tips',
  'stats',
  'route_points',
  'quality',
  'logistics',
  'services',
  'notes',
]);

/**
 * Input for `get_trip`. The trip_id is injected server-side from the
 * authenticated request, never passed by the agent. Reads default to a compact
 * summary so broad questions cannot accidentally push long trips over the
 * agent context limit; full reads are still possible but require an explicit
 * allow_large opt-in.
 */
export const GetTripInputShape = {
  view: z
    .enum(['summary', 'day', 'days', 'sections', 'full'])
    .default('summary')
    .describe('summary is compact. day returns one full day. days returns selected full days. sections returns selected fields. full requires allow_large=true.'),
  day_number: z.number().int().positive().optional(),
  day_numbers: z.array(z.number().int().positive()).optional(),
  day_start: z.number().int().positive().optional(),
  day_end: z.number().int().positive().optional(),
  sections: z.array(TripReadSectionSchema).optional(),
  include_markdown_source: z.boolean().optional(),
  allow_large: z
    .boolean()
    .optional()
    .describe('Only true permits view=full because full trips can exceed agent token limits.'),
} as const;
export const GetTripInputSchema = z.object(GetTripInputShape).strict();

export type GetTripInput = z.infer<typeof GetTripInputSchema>;

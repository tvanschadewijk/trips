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
 * `updated_at`, and the top-level DB columns `trips.name` / `trips.is_public`)
 * are deliberately absent — the agent cannot address them by name.
 *
 * Kept in sync with `src/lib/types.ts` by convention. Each schema uses
 * `.passthrough()` at the leaf record level so unknown optional fields inside
 * the existing JSONB blob pass through unchanged during a merge update.
 */
import { z } from 'zod';

// ---------- primitives ----------

const NonEmptyString = z.string().min(1);

// ---------- nested shapes ----------

const ServiceLegSchema = z
  .object({
    date: NonEmptyString,
    route: NonEmptyString,
  })
  .passthrough();

const ServiceSchema = z
  .object({
    type: NonEmptyString,
    label: NonEmptyString,
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

const BlockSchema = z
  .object({
    time_label: z.string(),
    content: NonEmptyString,
    type: NonEmptyString,
    options: z.array(OptionSchema).optional(),
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
    detail: TransportDetailSchema.optional(),
  })
  .passthrough();

const AccommodationDetailSchema = z
  .object({
    check_in: z.string().optional(),
    check_out: z.string().optional(),
    room_type: z.string().optional(),
    address: z.string().optional(),
    phone: z.string().optional(),
    confirmation: z.string().optional(),
    booking_platform: z.string().optional(),
    cancellation_deadline: z.string().optional(),
    wifi: z.string().optional(),
    parking: z.string().optional(),
    note: z.string().optional(),
  })
  .passthrough();

const AccommodationSchema = z
  .object({
    name: NonEmptyString,
    price: z.string().optional(),
    rating: z.string().optional(),
    status: z.string().optional(),
    nights: z.number().optional(),
    note: z.string().optional(),
    detail: AccommodationDetailSchema.optional(),
  })
  .passthrough();

const MealDetailSchema = z
  .object({
    address: z.string().optional(),
    phone: z.string().optional(),
    cuisine: z.string().optional(),
    price_range: z.string().optional(),
    reservation: z.string().optional(),
    booking_platform: z.string().optional(),
    hours: z.string().optional(),
    note: z.string().optional(),
  })
  .passthrough();

const MealSchema = z
  .object({
    type: NonEmptyString,
    name: NonEmptyString,
    note: z.string().optional(),
    status: z.string().optional(),
    detail: MealDetailSchema.optional(),
  })
  .passthrough();

const TipSchema = z
  .object({
    icon: NonEmptyString,
    title: NonEmptyString,
    content: NonEmptyString,
    priority: z.enum(['high', 'normal']).optional(),
  })
  .passthrough();

const DaySchema = z
  .object({
    day_number: z.number().int().positive(),
    date: NonEmptyString.describe('ISO 8601 YYYY-MM-DD'),
    title: NonEmptyString,
    subtitle: z.string().optional(),
    description: z.string().optional(),
    hero_image: z.string().optional(),
    stats: z.array(StatSchema).optional(),
    blocks: z.array(BlockSchema),
    transport: z.array(TransportSchema).optional(),
    accommodation: AccommodationSchema.nullable().optional(),
    meals: z.array(MealSchema).optional(),
    tips: z.array(TipSchema).optional(),
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
        start: NonEmptyString.describe('ISO 8601 YYYY-MM-DD'),
        end: NonEmptyString.describe('ISO 8601 YYYY-MM-DD'),
      })
      .optional(),
    travelers: z.array(z.string()).optional(),
    summary: z.string().optional(),
    hero_image: z.string().optional(),
    overview_image: z.string().optional(),
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
 * `trips.name` / `trips.is_public`) are not in this schema and physically
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
} as const;

export const UpdateTripInputSchema = z
  .object(UpdateTripInputShape)
  .strict()
  .refine((obj) => obj.trip !== undefined || obj.days !== undefined, {
    message: 'At least one of `trip` or `days` must be provided.',
  });

export type UpdateTripInput = z.infer<typeof UpdateTripInputSchema>;
export type TripMetaEditable = z.infer<typeof TripMetaEditableSchema>;

/**
 * Input for `get_trip`. Trivially empty — the trip_id is injected server-side
 * from the authenticated request, never passed by the agent. Keeping this as a
 * no-args schema prevents the agent from requesting arbitrary trips.
 */
export const GetTripInputShape = {} as const;
export const GetTripInputSchema = z.object(GetTripInputShape).strict();

export type GetTripInput = z.infer<typeof GetTripInputSchema>;

/**
 * In-process MCP tools for the trip chat agent.
 *
 * The agent has a narrow set of trip-scoped tool affordances: full reads only
 * when needed, smaller accommodation reads for common long-trip questions, and
 * constrained write tools. All close over a pinned `tripId` and a service-role
 * Supabase client provided by the API route — the agent never gets ambient DB
 * access and physically cannot address a different trip row.
 *
 * Tool description strings are the primary teaching surface for the agent
 * (we ship no SKILL.md and a minimal system prompt). Invest accordingly.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import type { McpSdkServerConfigWithInstance } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import {
  addAccommodationCandidate,
  moveAccommodationCandidate,
  promoteCandidateToTrip,
  replaceBookedAccommodationCandidate,
  updateAccommodationCandidate,
} from '@/lib/accommodation-review';
import {
  syncAccommodationReviewForTrip,
  trySyncAccommodationReviewForTrip,
} from '@/lib/accommodation-review-store';
import {
  completeMissingTripImagesForUser,
  deleteDayForUser,
  deleteDayItemInTripData,
  deepMerge,
  formatTripForRead,
  getTripImagePromptsForUser,
  replaceDayForUser,
  replaceDaySectionForUser,
  saveTripImageAssetForUser,
  searchTripImages,
  setTripHeroImageForUser,
  summarizeTripImages,
  syncMarkdownSourceForUser,
  truncateDaysAfterForUser,
  deleteDayItemForUser,
  updateTripFromMarkdownForUser,
  upsertDayItemForUser,
  upsertDayItemInTripData,
} from '@/lib/trip-service';
import { buildTripLogisticsLedger } from '@/lib/trip-logistics-ledger';
import { normalizeTripData } from '@/lib/trip-data-normalize';
import { enrichTripPlaces } from '@/lib/trip-place-enrichment';
import { auditTripLogistics, ISO_DATE_RE, isIsoDateString } from '@/lib/trip-logistics';
import {
  COORDINATE_BACKED_ROUTE_POINTS_REQUIRED_MESSAGE,
  hasCoordinateBackedTripRoute,
} from '@/lib/trip-quality';
import type {
  Accommodation,
  AccommodationCandidate,
  AccommodationCandidateBooking,
  AccommodationDetail,
  AccommodationReview,
  AccommodationReviewLane,
  TripData,
} from '@/lib/types';
import {
  GetTripInputShape,
  GetTripInputSchema,
  type UpdateTripInput,
  UpdateTripInputShape,
  UpdateTripInputSchema,
} from './schema';
import { createBookingTools } from './booking-tools';
import { TRIP_EDITOR_TOOL_NAMES } from './tool-names';

export interface TripToolContext {
  tripId: string;
  supabase: SupabaseClient;
  userId?: string;
  origin?: string;
  /** Called with the computed patch after a successful update, for diff logging. */
  onUpdateApplied?: (applied: {
    tool?: string;
    before?: TripData;
    after?: TripData;
    input: unknown;
  }) => void | Promise<void>;
}

const TOOL_JSON_INDENT = 2;
const POLICY_FETCH_TIMEOUT_MS = 8000;
const POLICY_TEXT_LIMIT = 200_000;
const POLICY_CANDIDATE_LIMIT = 5;

type ToolValidationIssue = {
  path: readonly PropertyKey[];
  message: string;
};

function formatZodIssues(error: { issues: readonly ToolValidationIssue[] }): string {
  return error.issues
    .map((issue) => `${issue.path.map(String).join('.')}: ${issue.message}`)
    .join('; ');
}

const ACCOMMODATION_PATH_RE = /^days\[(\d+)\]\.accommodation$/;
const AGENT_NOTES_START = '<!-- OURTRIPS_AGENT_NOTES_START -->';
const AGENT_NOTES_END = '<!-- OURTRIPS_AGENT_NOTES_END -->';
const IsoDateSchema = z
  .string()
  .regex(ISO_DATE_RE, 'Use ISO 8601 YYYY-MM-DD.')
  .refine(isIsoDateString, 'Use a real calendar date.');

const LIST_ACCOMMODATIONS_DESCRIPTION = `List every accommodation on the current trip without loading the full itinerary.

Use this before answering or editing requests about "all hotels", "all stays",
"where are we staying", pet policies, parking, check-in details, or anything
that only needs accommodation records. This returns small structured objects
with day_number, date, hotel name, address/city hints, the JSON path to update,
and existing detail fields such as dog_note when present.

No arguments. The trip_id is pinned by the server.`;

const UPDATE_ACCOMMODATION_DETAIL_DESCRIPTION = `Patch the detail object for one accommodation.

Use the path returned by list_accommodations, for example
"days[3].accommodation". This tool deep-merges detail_patch into that
accommodation's existing detail object and preserves every other trip field.

Use this for precise hotel updates such as dog_note, parking, phone, check-in,
wifi, or policy-source notes. Prefer this over update_trip when only one hotel
detail field changes because the focused tool is more precise and records
accommodation-specific markdown notes.

If this changes the accommodation address or another stay-location field, you
must follow the returned cascade_review instructions: read the changed day(s)
and the next day, then repair stale activities, meals, transport, tips, map
places, or day copy before replying that the edit is complete.

If the trip has markdown_source, this tool also maintains a small deterministic
"OurTrips agent notes" section in that markdown so external agents like Claude
Co-work can continue from the same hotel-policy context. It preserves the
original markdown and only adds/replaces the matching hotel note.`;

const UPDATE_ACCOMMODATION_DESCRIPTION = `Patch top-level fields for one accommodation without loading or replacing the full trip.

Use the path returned by list_accommodations, for example
"days[3].accommodation". This updates small visible stay-card fields such as
name, price, rating, status, booking_status, nights, and note while preserving
the detail object and every other trip field.

Use this when the user asks to rename a hotel/stay, mark a stay booked/open, or
fix visible accommodation card text on a long trip. For repeated nights of the
same stay, set match to "same_current_name" so the same patch applies to every
day whose current accommodation name matches the path's accommodation name.
This avoids broad update_trip payloads that can exceed context limits or
accidentally touch unrelated itinerary content.

If this changes the stay name, treat it as a possible location/base change. You
must follow the returned cascade_review instructions: read the changed day(s)
and the next day, then repair stale activities, meals, transport, tips, map
places, or day copy before replying that the edit is complete.

Visible accommodation cards should represent one booked or confirmed hotel.
Pending accommodation entries may exist only as single destination markers for
the "Hotel not confirmed yet" placeholder. Do not use this tool to write hotel
searches or slash-separated hotel shortlists into the public itinerary; put
those in the private Accommodations Reviewer as one candidate card per hotel
and promote one candidate when booked.

If the trip has markdown_source, this tool also maintains the deterministic
"OurTrips agent notes" section in that markdown so external agents can see
hotel/stay-card changes without forcing a full itinerary rewrite.`;

const RESEARCH_PLACE_POLICY_DESCRIPTION = `Research a single policy for a named place and return structured evidence.

Use this for current real-world policy questions such as hotel dog/pet policy.
For "confirm dog policy for all hotels", first call list_accommodations, then
call this once per accommodation, then write concise dog_note fields with
update_accommodation_detail.

The tool searches for likely public pages, fetches a small set of candidates,
extracts policy-relevant snippets, and returns:
status, policy, summary, confidence, source_url, source_label, snippets, and
checked_urls. Prefer official hotel pages when the returned source supports it.
If confidence is low, write that uncertainty into the note instead of
overstating the finding.`;

const LIST_ACCOMMODATION_REVIEW_DESCRIPTION = `List the private Accommodations Reviewer board for this trip.

Use this for hotel-search workflow questions such as "what are we considering
in Istanbul", "why did we reject that hotel", "what has been booked", or when
the user is looking at the Accommodations Reviewer surface. It returns the
destination list, candidates grouped by review state, and recent reviewer events.

The destination list is derived from the canonical itinerary in trips.data
(days[].accommodation). If the user asks to remove, rename, merge, or
consolidate a stay destination, update the canonical itinerary with get_trip
and update_trip; do not only move private candidates around.

No arguments. If the board does not exist yet, it is initialized from the
current itinerary stays. The trip_id is pinned by the server.`;

const UPDATE_ACCOMMODATION_CANDIDATE_DESCRIPTION = `Patch one private accommodation-review candidate.

Use this for changing candidate facts in the Accommodations Reviewer: price,
directWebsite (the official hotel website), links, customer-review ratings,
address/room/contact/check-in details, dog/parking/terms notes, blockers,
action, feedbackLoop, or lane. This
does not edit the public itinerary unless the candidate is moved to booked with
move_accommodation_candidate or promote_accommodation_candidate.`;

const CREATE_ACCOMMODATION_CANDIDATE_DESCRIPTION = `Create one private accommodation-review proposal card.

Use this after researching or choosing a hotel/stay candidate that should enter
the review board. New candidates should usually start in proposed unless the
user explicitly says they are already booked. A proposal is incomplete unless it
includes directWebsite for the official hotel site and a checked ratings row
with Booking.com (\`bookingCom\`), Tripadvisor (\`tripadvisor\`), and Google
Reviews (\`google\`) values. Use "Not found" for a source you actually checked
but could not verify, and set \`checkedAt\` to the check date. Also include
platform prices, address/room/contact/check-in details, terms, dog/parking
notes, and blockers when known.

Create exactly one card per hotel. Do not combine multiple hotel names into one
candidate with slashes or shortlist prose.`;

const MOVE_ACCOMMODATION_CANDIDATE_DESCRIPTION = `Move one accommodation-review candidate between review states.

Primary states are:
- proposed: Agent Proposals
- booked: committed stay

Legacy states are still accepted for older data:
- considering: under consideration
- dismissed: rejected but retained for memory

When a candidate is moved to booked, this tool also promotes the clean stay
into the trip's day accommodation cards and records a reviewer event, so future
agent turns know the hotel has been booked. A booked promotion may change the
trip base; follow any returned cascade_review instructions before replying.`;

const PROMOTE_ACCOMMODATION_CANDIDATE_DESCRIPTION = `Mark an accommodation-review candidate as booked and promote it into the itinerary.

Use when the user says a hotel is booked, confirms a booking, or asks you to
make a selected candidate the stay for that destination. This updates both the
private Accommodations Reviewer and the public trip accommodation cards for the matching
destination days. A booked promotion may change the trip base; follow any
returned cascade_review instructions before replying.`;

const GET_LOGISTICS_AUDIT_DESCRIPTION = `Run the strict OurTrips logistics contract for this trip.

Use this before claiming an edit is complete when exact dates, hotel
sleeps/nights, stay segments, or transport requirements changed. The audit
returns hard errors, warnings, open questions, and a canonical ledger of days,
stay segments, and transport legs.`;

const GET_DATE_LEDGER_DESCRIPTION = `Return the compact canonical date/stay ledger for this trip.

Use this before answering or editing anything about:
- when the trip starts or ends
- how many itinerary days there are
- how many nights/sleeps are scheduled
- where the traveler sleeps on each day
- how many days or nights are spent at each stay
- route-shape questions that depend on dates, stays, or transport days

This is derived from the structured trip JSON and logistics audit. It is the
first source of truth for date reasoning. No arguments. The trip_id is pinned
by the server.`;

const GET_IMAGE_STATUS_DESCRIPTION = `Return compact image coverage for this trip.

Use this when the user asks about photos, hero images, cover imagery, missing
images, or whether the trip visually looks complete. It reports trip hero,
overview image, day hero coverage, missing day numbers, generated asset slots,
and a required.complete flag.

No arguments. The trip_id is pinned by the server.`;

const SEARCH_TRIP_IMAGES_DESCRIPTION = `Search OurTrips-backed Unsplash results for real image URLs.

Use this only when you need to choose a specific image manually. Use portrait
for trip heroes and landscape for day heroes. Do not invent Unsplash URLs.
After choosing a result, call set_trip_image with the selected portrait or
landscape URL and the result's download_url so Unsplash tracking is recorded.`;

const SET_TRIP_IMAGE_DESCRIPTION = `Set one trip hero, overview image, or day hero image from a real URL.

Use a URL returned by search_trip_images whenever possible. Pass the Unsplash
download_url from the same result so download tracking is recorded. Prefer
complete_missing_images for "fill all missing images" requests.`;

const COMPLETE_MISSING_IMAGES_DESCRIPTION = `Fill missing trip/day hero photography for the current trip.

Use this for requests like "add the missing images", "complete the photos",
"fill the day hero images", or "make the trip image-complete". The tool is
idempotent by default: it preserves existing trip and day images, searches for
missing trip hero / overview / day hero targets, saves real Unsplash-backed
URLs, records download tracking when possible, and returns exact updated,
failed, skipped, and remaining-missing targets.

After this tool returns partial, call get_image_status before the final reply
and tell the user exactly which targets are still missing and why.`;

const GET_TRIP_IMAGE_PROMPTS_DESCRIPTION = `Build grounded prompts for generated OurTrips cover/social assets.

Use this when the user asks for generated cover artwork, OpenGraph/social
images, or image prompt guidance. It reads the current trip and returns prompts
for supported asset slots. Use save_trip_image_asset only after an image has
already been generated and hosted at a public URL.`;

const SAVE_TRIP_IMAGE_ASSET_DESCRIPTION = `Save one generated or externally hosted public image URL into trip.image_assets.

Use this after an image-generation flow has produced and hosted a real image.
Do not pass local file paths, data URLs, or invented URLs. For ordinary trip/day
hero photography, prefer search_trip_images, set_trip_image, or
complete_missing_images.`;

const UPSERT_ACCOMMODATION_DESCRIPTION = `Add or update one public accommodation card without replacing the full itinerary.

Use this when the user asks to add a hotel/stay to a specific day, update the
same stay across repeated nights, or patch a stay object with fields that do not
fit update_accommodation's small top-level patch. Use scope
"matching_accommodation_name" for repeated nights of the same current stay.`;

const DELETE_ACCOMMODATION_DESCRIPTION = `Remove one public accommodation card without replacing the full itinerary.

Use this when a stay should be cleared from one day or from all repeated nights
matching the current accommodation name. Prefer truncate_days_after or
delete_day for route/date removals that remove entire days.`;

const REPLACE_ACCOMMODATION_DESCRIPTION = `Replace one public accommodation object without merge leftovers.

Use this for hotel swaps where old nested detail fields, addresses, booking
notes, or stale stay facts must not survive. Use scope
"matching_accommodation_name" when replacing repeated cards for the same stay.`;

const REPLACE_DAY_SECTION_DESCRIPTION = `Replace a complete section on one day.

Use this when the safest edit is a clean overwrite of one day section such as
blocks, transport, accommodation, meals, tips, or stats. Prefer focused
upsert/delete tools for single item edits.`;

const REPLACE_DAY_DESCRIPTION = `Replace one complete day object by day_number.

Use this for rewritten days, destination changes, or broad day repairs where
merge semantics could leave stale nested data behind. Read the current day
first and preserve fields that should remain.`;

const DELETE_DAY_DESCRIPTION = `Delete one complete day by day_number.

Use this only when the itinerary truly loses that calendar day. For shortening
a trip by removing a trailing route tail, prefer truncate_days_after.`;

const TRUNCATE_DAYS_AFTER_DESCRIPTION = `Delete every day after a given day number.

Use this when a trip gets shorter and all trailing days must disappear. Read the
date ledger first for edits involving trip duration, sleeps/nights, stays, or
route shape.`;

const SYNC_MARKDOWN_SOURCE_DESCRIPTION = `Replace the stored Original Plan markdown_source.

Use this when the user asks to update the Original Plan text only. Pass
expected_current_hash from get_trip summary/full reads when available so the
edit fails instead of overwriting a newer markdown_source.`;

const UPDATE_FROM_MARKDOWN_DESCRIPTION = `Replace markdown_source and optionally apply parsed trip/days JSON.

Use this when the user gives updated source markdown and you have also parsed
the corresponding structured trip or days changes. OurTrips stores markdown
verbatim and does not infer structured itinerary updates server-side.`;

const REPLACE_BOOKED_ACCOMMODATION_CANDIDATE_DESCRIPTION = `Replace the currently booked private accommodation candidate for a destination.

Use this when the user chooses a different candidate as the booked stay. This
demotes the old booked candidate, marks the selected candidate booked, and
promotes the selected stay into the public itinerary accommodation cards.`;

const UPSERT_ACTIVITY_DESCRIPTION = `Add or update one day programme item without loading or replacing the full itinerary.

Use this for museums, galleries, beaches, viewpoints, walks, excursions,
neighbourhood time, shops, markets, and other non-meal activities. If the user
asks for a current recommendation such as "find a nice beach" or "add a good
museum", use WebSearch first when freshness or specific venue choice matters,
then write one chosen activity with this tool.

Do not use this for the day intro; day intros are description_title and
description and require update_trip. Put richer explanation in activity.detail
and keep the visible content compact.`;

const DELETE_ACTIVITY_DESCRIPTION = `Delete one day programme item by index, title, time label, type, or content match.

Use this when the user asks to remove a museum, beach, viewpoint, walk,
excursion, or other programme block from a specific day.`;

const UPSERT_MEAL_DESCRIPTION = `Add or update one meal or restaurant without loading or replacing the full itinerary.

Use this after choosing one specific restaurant, cafe, bar, bakery, or food
stop. For "find a nice restaurant", WebSearch first, then either ask the user
to choose among options or save the clearly best fit with this tool. When a
source gives the exact venue address, include it in place.address instead of
saving only a bare name; never invent coordinates for an unverified venue.

Each meal row is one restaurant. If the user asks for multiple restaurant
suggestions, return a concise shortlist in the chat first. Only save multiple
meal rows when the user explicitly asks to add multiple options to the trip,
and never combine several restaurant names into one meal.name or meal.note.`;

const DELETE_MEAL_DESCRIPTION = `Delete one meal or restaurant by index, name, type, or other match fields.

Use this when the user asks to remove a lunch, dinner, cafe, bar, bakery, or
restaurant from a specific day.`;

const UPSERT_TRANSPORT_DESCRIPTION = `Add or update one transport leg without loading or replacing the full itinerary.

Use this for trains, flights, ferries, taxis, transfers, drives, buses, and
other route legs. For booked/scheduled transport include from, to, depart,
arrive, duration, booking_status/status, and detail fields when known.`;

const DELETE_TRANSPORT_DESCRIPTION = `Delete one transport leg by index, label, route, mode, or other match fields.

Use this when the user asks to remove a train, flight, ferry, taxi, transfer,
drive, bus, or other route leg from a specific day.`;

const DetailPatchSchema = z
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
    what_to_order: z.string().optional(),
    dog_note: z.string().optional(),
    check_in: z.string().optional(),
    check_out: z.string().optional(),
    room_type: z.string().optional(),
    address: z.string().optional(),
    phone: z.string().optional(),
    direct_website_url: z.string().url().optional(),
    direct_website_label: z.string().optional(),
    confirmation: z.string().optional(),
    booking_platform: z.string().optional(),
    cancellation_deadline: z.string().optional(),
    wifi: z.string().optional(),
    parking: z.string().optional(),
    note: z.string().optional(),
    policy_source_url: z.string().url().optional(),
    policy_source_label: z.string().optional(),
    policy_confidence: z.enum(['high', 'medium', 'low']).optional(),
  })
  .passthrough();

const UpdateAccommodationDetailInputShape = {
  path: z
    .string()
    .regex(ACCOMMODATION_PATH_RE, 'Use a path returned by list_accommodations, e.g. days[3].accommodation'),
  detail_patch: DetailPatchSchema,
} as const;

const AccommodationPatchSchema = z
  .object({
    name: z.string().min(1).optional(),
    price: z.string().optional(),
    rating: z.string().optional(),
    status: z.string().optional(),
    booking_status: z.string().optional(),
    nights: z.number().optional(),
    note: z.string().optional(),
  })
  .strict()
  .refine((value: Record<string, unknown>) => Object.keys(value).length > 0, {
    message: 'Provide at least one accommodation field to patch.',
  });

const UpdateAccommodationInputShape = {
  path: z
    .string()
    .regex(ACCOMMODATION_PATH_RE, 'Use a path returned by list_accommodations, e.g. days[3].accommodation'),
  accommodation_patch: AccommodationPatchSchema,
  match: z
    .enum(['path_only', 'same_current_name'])
    .default('path_only')
    .describe('Use same_current_name to apply a rename/fix to repeated nights of the same current stay.'),
} as const;

type AccommodationPatch = Partial<
  Pick<Accommodation, 'name' | 'price' | 'rating' | 'status' | 'booking_status' | 'nights' | 'note'>
>;

const DayNumberSchema = z.number().int().positive();
const TimePrecisionSchema = z.enum(['fixed', 'suggested', 'window']);
const PatchModeSchema = z.enum(['merge', 'replace']).default('merge');
const InsertPositionSchema = z.enum(['append', 'prepend']).default('append');

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
  .strict()
  .refine(
    (value: Record<string, unknown>) =>
      Object.values(value).some((item) =>
        typeof item === 'number' || (typeof item === 'string' && item.trim().length > 0)
      ),
    { message: 'Provide at least one match field.' }
  );

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

const ActivitySchema = z
  .object({
    time_label: z.string().min(1),
    content: z.string().min(1),
    type: z.string().min(1),
    starts_at: z.string().optional(),
    ends_at: z.string().optional(),
    time_precision: TimePrecisionSchema.optional(),
    duration_minutes: z.number().int().positive().optional(),
    place: ItineraryPlaceSchema.optional(),
    booking_status: z.string().optional(),
    reservation_required: z.boolean().optional(),
    cost_hint: z.string().optional(),
    pace: z.string().optional(),
    detail: DetailPatchSchema.optional(),
    options: z.array(z.record(z.string(), z.unknown())).optional(),
    alternatives: z.array(ItineraryAlternativeSchema).optional(),
  })
  .passthrough();

const MealSchema = z
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
    detail: DetailPatchSchema.optional(),
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
  })
  .passthrough();

const TransportSchema = z
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
    detail: TransportDetailSchema.optional(),
  })
  .passthrough();

const AccommodationItemSchema = z
  .object({
    name: z.string().min(1).optional(),
    price: z.string().optional(),
    rating: z.string().optional(),
    status: z.string().optional(),
    booking_status: z.string().optional(),
    nights: z.number().optional(),
    note: z.string().optional(),
    detail: DetailPatchSchema.optional(),
  })
  .passthrough()
  .refine((value: Record<string, unknown>) => Object.keys(value).length > 0, {
    message: 'Provide at least one accommodation field.',
  });

const AccommodationScopeSchema = z
  .enum(['day', 'matching_accommodation_name'])
  .default('day');

const UpsertActivityInputShape = {
  day_number: DayNumberSchema,
  activity: ActivitySchema,
  match: ItemMatchSchema.optional(),
  mode: PatchModeSchema,
  position: InsertPositionSchema,
} as const;

const DeleteActivityInputShape = {
  day_number: DayNumberSchema,
  match: ItemMatchSchema,
} as const;

const UpsertMealInputShape = {
  day_number: DayNumberSchema,
  meal: MealSchema,
  match: ItemMatchSchema.optional(),
  mode: PatchModeSchema,
  position: InsertPositionSchema,
} as const;

const DeleteMealInputShape = {
  day_number: DayNumberSchema,
  match: ItemMatchSchema,
} as const;

const UpsertTransportInputShape = {
  day_number: DayNumberSchema,
  transport: TransportSchema,
  match: ItemMatchSchema.optional(),
  mode: PatchModeSchema,
  position: InsertPositionSchema,
} as const;

const DeleteTransportInputShape = {
  day_number: DayNumberSchema,
  match: ItemMatchSchema,
} as const;

const UpsertAccommodationInputShape = {
  day_number: DayNumberSchema,
  accommodation: AccommodationItemSchema,
  match: ItemMatchSchema.optional(),
  mode: PatchModeSchema,
  scope: AccommodationScopeSchema,
} as const;

const DeleteAccommodationInputShape = {
  day_number: DayNumberSchema,
  match: ItemMatchSchema.optional(),
  scope: AccommodationScopeSchema,
} as const;

const ReplaceAccommodationInputShape = {
  day_number: DayNumberSchema,
  accommodation: AccommodationItemSchema,
  match: ItemMatchSchema.optional(),
  scope: AccommodationScopeSchema,
} as const;

const DaySectionSchema = z.enum(['blocks', 'transport', 'accommodation', 'meals', 'tips', 'stats']);
const DayReplacementSchema = z
  .record(z.string(), z.unknown())
  .refine((value) => Object.keys(value).length > 0, {
    message: 'Provide a complete replacement day object.',
  });

const ReplaceDaySectionInputShape = {
  day_number: DayNumberSchema,
  section: DaySectionSchema,
  value: z.unknown(),
} as const;

const ReplaceDayInputShape = {
  day_number: DayNumberSchema,
  day: DayReplacementSchema,
} as const;

const DeleteDayInputShape = {
  day_number: DayNumberSchema,
} as const;

const TruncateDaysAfterInputShape = {
  keep_through_day_number: DayNumberSchema,
} as const;

const SyncMarkdownSourceInputShape = {
  markdown_source: z.string().max(262144),
  expected_current_hash: z.string().optional(),
} as const;

const UpdateFromMarkdownInputShape = {
  markdown_source: z.string().max(262144),
  expected_current_hash: z.string().optional(),
  trip: z.record(z.string(), z.unknown()).optional(),
  days: z.array(DayReplacementSchema).optional(),
  mode: PatchModeSchema,
} as const;

const ResearchPlacePolicyInputShape = {
  place_name: z.string().min(1),
  city: z.string().optional(),
  country: z.string().optional(),
  policy_type: z
    .enum(['dog_policy', 'pet_policy'])
    .default('dog_policy')
    .describe('Use dog_policy for whether dogs are allowed; pet_policy for broader pet rules.'),
  source_url: z
    .string()
    .url()
    .optional()
    .describe('Optional known official page to check before searching.'),
} as const;

const AccommodationReviewLaneSchema = z.enum([
  'proposed',
  'considering',
  'dismissed',
  'booked',
]);

const AccommodationCandidateLinkSchema = z
  .object({
    label: z.string().min(1),
    url: z.string().url(),
  })
  .strict();

const AccommodationCandidateRatingSchema = z
  .object({
    name: z.string().optional(),
    checkedAt: z.string().optional(),
    bookingCom: z.string().optional(),
    tripadvisor: z.string().optional(),
    google: z.string().optional(),
    hotelsCom: z.string().optional(),
    note: z.string().optional(),
  })
  .strict();

const CheckedAccommodationCandidateRatingSchema = AccommodationCandidateRatingSchema.extend({
  checkedAt: IsoDateSchema,
  bookingCom: z.string().min(1),
  tripadvisor: z.string().min(1),
  google: z.string().min(1),
});

const AccommodationCandidateBookingSchema = z
  .object({
    bookedAt: z.string().optional(),
    source: z.string().optional(),
    confirmation: z.string().optional(),
    price: z.string().optional(),
    note: z.string().optional(),
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
    directWebsite: AccommodationCandidateLinkSchema.describe(
      'Official/direct hotel website. Do not use Booking.com, Tripadvisor, Google, or an OTA/search-result URL here.'
    ).optional(),
    links: z.array(AccommodationCandidateLinkSchema).optional(),
    ratings: z.array(CheckedAccommodationCandidateRatingSchema).min(1).describe(
      'Checked customer-review ratings. Include checkedAt plus bookingCom, tripadvisor, and google values; use "Not found" only for sources actually checked.'
    ).optional(),
    rateCheck: z.record(z.string(), z.unknown()).optional(),
    feedbackLoop: z.record(z.string(), z.unknown()).optional(),
    dayNumbers: z.array(z.number()).optional(),
    checkInDate: IsoDateSchema.optional(),
    checkOutDate: IsoDateSchema.optional(),
    address: z.string().optional(),
    roomType: z.string().optional(),
    checkIn: z.string().optional(),
    checkOut: z.string().optional(),
    phone: z.string().optional(),
    wifi: z.string().optional(),
    policySource: z.object({ label: z.string(), url: z.string() }).optional(),
    policyConfidence: z.enum(['high', 'medium', 'low']).optional(),
    hotelNote: z.string().optional(),
    booking: AccommodationCandidateBookingSchema.optional(),
    createdBy: z.enum(['agent', 'user', 'import', 'system']).optional(),
  })
  .strict()
  .refine((value: Record<string, unknown>) => Object.keys(value).length > 0, {
    message: 'Provide at least one candidate field to patch.',
  });

const AccommodationReviewDestinationSchema = z
  .object({
    id: z.string().min(1),
    title: z.string().min(1),
    dates: z.string().optional(),
    nights: z.number().optional(),
    dayNumbers: z.array(z.number()).optional(),
    startDate: IsoDateSchema.optional(),
    endDate: IsoDateSchema.optional(),
  })
  .strict();

const CreateAccommodationCandidateInputShape = {
  candidate: z
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
      ratings: z.array(CheckedAccommodationCandidateRatingSchema).min(1).describe(
        'Checked customer-review ratings. Include checkedAt plus bookingCom, tripadvisor, and google values; use "Not found" only for sources actually checked.'
      ),
      rateCheck: z.record(z.string(), z.unknown()).optional(),
      feedbackLoop: z.record(z.string(), z.unknown()).optional(),
      dayNumbers: z.array(z.number()).optional(),
      checkInDate: IsoDateSchema.optional(),
      checkOutDate: IsoDateSchema.optional(),
      address: z.string().optional(),
      roomType: z.string().optional(),
      checkIn: z.string().optional(),
      checkOut: z.string().optional(),
      phone: z.string().optional(),
      wifi: z.string().optional(),
      policySource: z.object({ label: z.string(), url: z.string() }).optional(),
      policyConfidence: z.enum(['high', 'medium', 'low']).optional(),
      hotelNote: z.string().optional(),
      booking: AccommodationCandidateBookingSchema.optional(),
      createdBy: z.enum(['agent', 'user', 'import', 'system']).optional(),
    })
    .strict(),
  destination: AccommodationReviewDestinationSchema.optional(),
  message: z.string().optional(),
} as const;

const UpdateAccommodationCandidateInputShape = {
  candidate_id: z.string().min(1),
  candidate_patch: AccommodationCandidatePatchSchema,
  message: z.string().optional(),
} as const;

const MoveAccommodationCandidateInputShape = {
  candidate_id: z.string().min(1),
  lane: AccommodationReviewLaneSchema,
  booking: AccommodationCandidateBookingSchema.optional(),
  message: z.string().optional(),
} as const;

const PromoteAccommodationCandidateInputShape = {
  candidate_id: z.string().min(1),
  booking: AccommodationCandidateBookingSchema.optional(),
  message: z.string().optional(),
} as const;

const ImageOrientationSchema = z.enum(['landscape', 'portrait', 'squarish']);

const SearchTripImagesInputShape = {
  query: z.string().min(1),
  orientation: ImageOrientationSchema.optional(),
} as const;

const SetTripImageInputShape = {
  target: z.enum(['trip_hero', 'trip_overview', 'day_hero']),
  day_number: z.number().int().positive().optional(),
  url: z.string().min(1),
  download_url: z.string().optional(),
} as const;

const CompleteMissingImagesInputShape = {
  replace_existing: z.boolean().optional(),
  include_overview: z.boolean().optional(),
  max_updates: z.number().int().positive().max(24).optional(),
} as const;

const ImageAssetSlotSchema = z.enum(['cover_portrait', 'cover_landscape', 'social_og']);
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

const SaveTripImageAssetInputShape = {
  slot: ImageAssetSlotSchema,
  asset: ImageAssetSchema,
} as const;

const ReplaceBookedAccommodationCandidateInputShape = {
  candidate_id: z.string().min(1),
  booking: AccommodationCandidateBookingSchema.optional(),
  message: z.string().optional(),
} as const;

const GET_TRIP_DESCRIPTION = `Read the current trip the user is editing, with compact views by default.

Use this before answering trip-data questions. Do not ask the user to paste
trip details until you have tried the smallest useful read:

  - No args or { "view": "summary" } returns compact trip metadata, day titles,
    item counts, accommodation names, markdown length/hash, and image status.
    Start here for broad questions like "how can we make this better?" or
    "come up with a plan".
  - { "view": "day", "day_number": N } returns one complete day. Use this for
    "today", a currently viewed day, exact drive/transport timing, meals, and
    day-specific advice.
  - { "view": "days", "day_start": A, "day_end": B } or "day_numbers" returns
    selected complete days when a small range is needed.
  - { "view": "sections", "sections": ["quality", "logistics"] } returns
    focused audits without loading programme prose. Add sections such as
    "trip", "route_points", "services", "notes", "transport", "accommodation",
    "meals", "tips", or "stats" only when needed.
  - { "view": "full", "allow_large": true } intentionally returns the full
    TripData JSON. Use it only when narrow reads cannot support the edit,
    especially structural update_trip work that must sync markdown_source.

The trip_id is pinned by the server to the trip the user is viewing — you
cannot request a different trip.`;

const UPDATE_TRIP_DESCRIPTION = `Apply an edit to the current trip. The trip_id is pinned server-side.

## Semantics: JSON Merge Patch with day-number patches

You pass any combination of:

  - \`trip\`: a PARTIAL object that is deep-merged into the existing \`data.trip\`.
    Only the keys you include are updated; everything else is preserved. Use
    this for copy edits (summary, subtitle), metadata tweaks (dates,
    travelers), or adding/editing nested non-array fields.

  - \`days\`: if provided, patches existing days by \`day_number\` and
    preserves omitted days. Arrays inside a patched day still replace
    wholesale, so prefer \`replace_day_section\` for one section and the
    focused upsert/delete tools for one activity/meal/transport row. Use
    \`delete_day\` or \`truncate_days_after\` for intentional day removal.

  - \`markdown_source\`: REPLACES the stored markdown source verbatim. This is
    the long-form, free-text version of the trip the user shared (or the
    skill saved on their behalf). When the trip ALREADY has a
    markdown_source and you're making any structural edit, you MUST also
    send an updated markdown_source in the same call so the markdown stays
    synced with the structured fields. See "Markdown sync" below. Empty
    string clears the field.

All three are optional individually, but you must provide at least one. Do
not send an empty object.

## Invariants the server enforces

  - Day ordering is significant — days are rendered in array order. \`day_number\`
    typically mirrors position (1-indexed). Keep them consistent.
  - Dates are ISO 8601 (YYYY-MM-DD). \`data.trip.dates.start\` and \`.end\` must
    frame the date range covered by \`data.days\`.
  - Immutable fields — \`id\`, \`user_id\`, \`share_id\`, \`created_at\`,
    \`updated_at\`, the DB row's \`name\` and \`share_mode\` columns — are not in
    this schema and cannot be addressed.
  - Unknown top-level keys are rejected.

## Edit grammar (rules of thumb)

  - Prefer editing a day IN PLACE over delete-and-re-add. If the user says
    "swap day 3 for something outdoorsy", modify \`days[2]\` in place rather
    than removing and appending a new day (that shifts downstream day_numbers
    and breaks the carousel).
  - When reordering, update \`day_number\` fields to match the new positions.
  - Use day \`description_title\` + \`description\` for the one editorial day
    intro shown on the hero/overview. Do not create a first \`blocks[]\` entry
    just to hold that intro.
  - \`blocks[]\` is optional and reserved for actual programme items after the
    day intro: timed activities, sights, excursions, walks, or other itinerary
    rows. When adding blocks, meals, transport, tips, or stats to a day: fetch
    the day, append to the array, send the full \`days\` array back.
  - Free-form fields like \`time_label\` on a block accept "Morning",
    "14:00 – 16:30", "Late afternoon" — stay consistent with what's already
    in the trip.
  - Every full-trip rewrite must include \`trip.route_points\` with at least
    two coordinate-backed route/stay stops using \`label\`, \`lat\`, and
    \`lng\`, so the overview map renders even before live place search runs.
  - Every visible hotel, activity site, restaurant, and route stop should be
    map-ready exactly once. Use \`place: { name, address?, lat?, lng? }\` on
    named sights, meals, and stops when you know the exact place; avoid
    prose-only mentions when you know the venue.
  - Public itinerary entries are single-choice. Do not put multiple hotels or
    multiple restaurants into one \`accommodation\`, \`meal\`, or programme
    block with slashes or shortlist prose. Hotel search options belong in the
    Accommodations Reviewer as one candidate per hotel; a pending accommodation
    in \`days[]\` should be only a destination marker for the "Hotel not
    confirmed yet" placeholder. For meals, choose one restaurant for the
    suggestion or ask the user when the choice is truly ambiguous.
  - Restaurant reservations belong in the matching \`days[].meals[]\` entry:
    one meal per restaurant, with \`reservation_required\`,
    \`booking_status\`, and \`detail.reservation\` or
    \`detail.booking_note\` when useful. Do not create \`trip.services\`
    entries for restaurants or combined restaurant booking lists; services are
    only for external providers not already rendered as transport,
    accommodation, meals, or activities.

## Editorial tone (this product is OurTrips — editorial travel, not a booking system)

  - \`trip.summary\`, day \`description_title\`, and day \`description\`:
    confident, specific, slightly literary. Not "Enjoy Seoul" — "Seoul wakes
    up slowly on a Wednesday; start at Gwangjang Market."
  - \`trip.subtitle\` and day \`subtitle\`: under ~60 chars, concrete, a single
    image or idea. Not a sentence.
  - \`tips\` are voice-y, first-person-adjacent when appropriate. The product
    sounds like a travel writer, not a chatbot.
  - Every day should include at least one practical, place-specific tip. Do
    not send empty tip objects or title-only placeholders.

## Rich detail cards

The visible day view should stay scannable, but named places should have
editorial depth behind them. When adding or rewriting a major sight, hike,
museum, beach, village, hotel, or restaurant:

  - Add a structured \`detail\` object rather than stuffing long copy into
    \`content\` or \`note\`.
  - Programme blocks can carry \`detail\` with \`title\`, \`body\`, \`why\`,
    \`highlights\`, \`what_to_see\`, \`how_to_do_it\`, and \`practical\`, but
    they should not duplicate the day intro.
  - Accommodation and meal detail objects can carry \`why\`, \`vibe\`,
    \`what_to_order\`, \`booking_note\`, and \`dog_note\` alongside the existing
    practical booking fields.
  - Good detail copy answers: why this stop is compelling, what the traveler
    will actually see/taste, and how to do it smoothly.
  - If \`markdown_source\` exists, the detail fields should be grounded in it;
    update the markdown in the same call whenever you materially enrich the
    structured detail.

## Markdown sync (two-way source of truth)

The trip can be edited from two surfaces: this chat (you) and an external
agent like Claude CoWork (which saves the trip via the OurTrips connector). To
keep both surfaces in sync the trip body carries an optional
\`markdown_source\` field — the long-form markdown the user authored or the
external agent generated.

Rules when editing a trip:

  1. Call get_trip first with the smallest read that can support the edit. If
     you need the source markdown text, intentionally request
     \`{ "view": "full", "allow_large": true }\`. Compact reads may only show a
     markdown_source present/length/hash summary, which is enough to know
     markdown exists but not enough to rewrite it.
  2. If \`markdown_source\` is present:
       - Apply the user's edit to BOTH the structured fields AND the markdown.
       - Send the updated \`markdown_source\` in the SAME update_trip call as
         your structural changes. Both must move together.
       - Preserve the markdown's existing structure, headings, and voice.
         Update the relevant section, don't rewrite the whole document.
  3. If \`markdown_source\` is absent: don't fabricate one. Edit only the
     structured fields. The trip remains structured-only.
  4. If the user explicitly asks for the source markdown to be deleted, send
     an empty string for \`markdown_source\` to clear it.

Failing to keep them in sync silently strands the markdown view at a stale
state — never do that.

## Output

Returns a brief confirmation of which top-level keys were updated. Does NOT
return the full updated trip — call get_trip if you need to read the new
state before continuing.`;

function mergeTrip(
  existing: TripData,
  input: Pick<UpdateTripInput, 'trip' | 'days' | 'markdown_source'>
): TripData {
  const next: TripData = {
    trip: input.trip
      ? (deepMerge(
          existing.trip as unknown as Record<string, unknown>,
          input.trip as unknown as Record<string, unknown>
        ) as unknown as TripData['trip'])
      : existing.trip,
    days: input.days !== undefined ? mergeDaysByNumber(existing.days, input.days) : existing.days,
  };
  // markdown_source: undefined = keep existing, '' = clear, otherwise replace.
  if (input.markdown_source === undefined) {
    if (existing.markdown_source) next.markdown_source = existing.markdown_source;
  } else if (input.markdown_source.length > 0) {
    next.markdown_source = input.markdown_source;
  }
  return next;
}

function mergeDaysByNumber(
  existingDays: TripData['days'],
  dayPatches: NonNullable<UpdateTripInput['days']>
): TripData['days'] {
  const nextDays = existingDays.map((day) => ({ ...day }));
  for (const patchDay of dayPatches) {
    const index = nextDays.findIndex((day) => day.day_number === patchDay.day_number);
    if (index >= 0) {
      nextDays[index] = deepMerge(
        nextDays[index] as unknown as Record<string, unknown>,
        patchDay as unknown as Record<string, unknown>
      ) as unknown as TripData['days'][number];
    } else {
      if (!patchDay.date || !patchDay.title) {
        throw new Error(
          `Cannot add day ${patchDay.day_number} with a partial day patch. Include date and title, or use replace_day for full-day writes.`
        );
      }
      nextDays.push(patchDay as TripData['days'][number]);
    }
  }
  return nextDays.sort((a, b) => a.day_number - b.day_number);
}

function jsonToolResponse(data: unknown, isError = false) {
  return {
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify(data, null, TOOL_JSON_INDENT),
      },
    ],
    ...(isError ? { isError: true } : {}),
  };
}

function textToolError(text: string) {
  return {
    content: [{ type: 'text' as const, text }],
    isError: true,
  };
}

function requireContextUserId(ctx: TripToolContext): string {
  if (!ctx.userId) {
    throw new Error('Trip editor user context is missing for this write tool.');
  }
  return ctx.userId;
}

async function requireTripOwnerUserId(ctx: TripToolContext): Promise<string> {
  requireContextUserId(ctx);
  const { data, error } = await ctx.supabase
    .from('trips')
    .select('user_id')
    .eq('id', ctx.tripId)
    .single();

  if (error || !data) {
    throw new Error(`Error reading trip owner: ${error?.message ?? 'not found'}`);
  }

  const ownerId = typeof data.user_id === 'string'
    ? data.user_id
    : String(data.user_id ?? '');
  if (!ownerId) {
    throw new Error('Trip owner is missing for this write tool.');
  }

  return ownerId;
}

async function readTripData(ctx: TripToolContext): Promise<TripData> {
  const { data, error } = await ctx.supabase
    .from('trips')
    .select('data')
    .eq('id', ctx.tripId)
    .single();

  if (error || !data) {
    throw new Error(`Error reading trip: ${error?.message ?? 'not found'}`);
  }

  return normalizeTripData(data.data);
}

async function writeTripData(ctx: TripToolContext, next: TripData): Promise<void> {
  await enrichTripPlaces(next);
  const { error } = await ctx.supabase
    .from('trips')
    .update({ data: next, updated_at: new Date().toISOString() })
    .eq('id', ctx.tripId);

  if (error) {
    throw new Error(`Error writing trip: ${error.message}`);
  }
}

async function applyTripServiceMutation(args: {
  ctx: TripToolContext;
  toolName: string;
  rawInput: unknown;
  mutate: (ownerUserId: string) => Promise<{ record: Record<string, unknown>; summary: unknown }>;
}) {
  const before = await readTripData(args.ctx);
  const ownerUserId = await requireTripOwnerUserId(args.ctx);
  const result = await args.mutate(ownerUserId);
  const after = normalizeTripData(result.record.data);

  if (args.ctx.onUpdateApplied) {
    try {
      await args.ctx.onUpdateApplied({
        tool: args.toolName,
        before,
        after,
        input: args.rawInput,
      });
    } catch {
      // Telemetry errors must not fail the tool call.
    }
  }

  return jsonToolResponse(result.summary);
}

function cloneTripData(data: TripData): TripData {
  return JSON.parse(JSON.stringify(data)) as TripData;
}

async function loadOrCreateAccommodationReview(
  ctx: TripToolContext,
  tripData: TripData
): Promise<AccommodationReview> {
  return syncAccommodationReviewForTrip(ctx.supabase, ctx.tripId, tripData);
}

async function saveAccommodationReview(
  ctx: TripToolContext,
  review: AccommodationReview
) {
  const { error } = await ctx.supabase
    .from('trip_accommodation_reviews')
    .upsert({
      trip_id: ctx.tripId,
      data: review,
      updated_at: new Date().toISOString(),
    });

  if (error) {
    throw new Error(error.message);
  }
}

function summarizeAccommodationReview(review: AccommodationReview) {
  return {
    tripTitle: review.tripTitle,
    updatedAt: review.updatedAt,
    destinations: review.destinations,
    lanes: {
      proposed: review.accommodations.filter((item) => item.lane === 'proposed'),
      considering: review.accommodations.filter((item) => item.lane === 'considering'),
      dismissed: review.accommodations.filter((item) => item.lane === 'dismissed'),
      booked: review.accommodations.filter((item) => item.lane === 'booked'),
    },
    recent_events: (review.events ?? []).slice(-12),
  };
}

function parseAccommodationPath(path: string): number | null {
  const match = ACCOMMODATION_PATH_RE.exec(path);
  if (!match) return null;
  return Number(match[1]);
}

function inferLocationFromDayTitle(title: string): string | undefined {
  const parts = title
    .split(/(?:→|->|—|-|>)/)
    .map((p) => p.trim())
    .filter(Boolean);
  return parts.at(-1) || title.trim() || undefined;
}

function oneLineMarkdown(value: unknown): string {
  if (value === undefined || value === null) return '';
  return String(value)
    .replace(/\s+/g, ' ')
    .replace(/<!--/g, '<!-- ')
    .replace(/-->/g, '-- >')
    .trim();
}

function markdownLink(label: string, url: string): string {
  const cleanLabel = oneLineMarkdown(label).replace(/\]/g, '\\]');
  return `[${cleanLabel}](${url})`;
}

function summarizeAccommodationDetailPatch(
  detailPatch: Partial<AccommodationDetail>
): string[] {
  const parts: string[] = [];
  const add = (label: string, value: unknown) => {
    const clean = oneLineMarkdown(value);
    if (clean) parts.push(`${label}: ${clean}`);
  };

  add('Dog policy', detailPatch.dog_note);
  add('Parking', detailPatch.parking);
  add('Wi-Fi', detailPatch.wifi);
  add('Check-in', detailPatch.check_in);
  add('Check-out', detailPatch.check_out);
  add('Room', detailPatch.room_type);
  add('Phone', detailPatch.phone);
  const directWebsiteUrl = oneLineMarkdown(detailPatch.direct_website_url);
  const directWebsiteLabel = oneLineMarkdown(detailPatch.direct_website_label);
  if (directWebsiteUrl) {
    parts.push(
      `Official website: ${
        directWebsiteLabel
          ? markdownLink(directWebsiteLabel, directWebsiteUrl)
          : directWebsiteUrl
      }`
    );
  }
  add('Booking note', detailPatch.booking_note);
  add('Note', detailPatch.note);

  const sourceUrl = oneLineMarkdown(detailPatch.policy_source_url);
  const sourceLabel = oneLineMarkdown(detailPatch.policy_source_label);
  const confidence = oneLineMarkdown(detailPatch.policy_confidence);
  if (sourceUrl) {
    const source = sourceLabel ? markdownLink(sourceLabel, sourceUrl) : sourceUrl;
    parts.push(`Source: ${source}${confidence ? ` (${confidence} confidence)` : ''}`);
  } else if (sourceLabel) {
    parts.push(`Source: ${sourceLabel}${confidence ? ` (${confidence} confidence)` : ''}`);
  } else if (confidence) {
    parts.push(`Confidence: ${confidence}`);
  }

  return parts;
}

function summarizeAccommodationPatch(
  accommodationPatch: AccommodationPatch,
  previousName?: string
): string[] {
  const parts: string[] = [];
  const add = (label: string, value: unknown) => {
    const clean = oneLineMarkdown(value);
    if (clean) parts.push(`${label}: ${clean}`);
  };

  if (accommodationPatch.name) {
    const nextName = oneLineMarkdown(accommodationPatch.name);
    const cleanPrevious = oneLineMarkdown(previousName);
    parts.push(
      cleanPrevious && cleanPrevious !== nextName
        ? `Hotel/stay: ${cleanPrevious} -> ${nextName}`
        : `Hotel/stay: ${nextName}`
    );
  }
  add('Price', accommodationPatch.price);
  add('Rating', accommodationPatch.rating);
  add('Status', accommodationPatch.status);
  add('Nights', accommodationPatch.nights);
  add('Stay note', accommodationPatch.note);

  return parts;
}

function buildAccommodationAgentNote(args: {
  dayNumber: number;
  date: string;
  name: string;
  path: string;
  detailPatch?: Partial<AccommodationDetail>;
  accommodationPatch?: AccommodationPatch;
  previousName?: string;
}): string | null {
  const parts = [
    ...summarizeAccommodationPatch(args.accommodationPatch ?? {}, args.previousName),
    ...summarizeAccommodationDetailPatch(args.detailPatch ?? {}),
  ];
  if (parts.length === 0) return null;
  const heading = `Day ${args.dayNumber}${args.date ? ` (${args.date})` : ''} — ${oneLineMarkdown(args.name)}`;
  return `- ${heading}: ${parts.join('; ')}. <!-- path: ${args.path} -->`;
}

function upsertAgentNoteLine(sectionBody: string, path: string, noteLine: string): string {
  const lines = sectionBody
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line) => {
      const trimmed = line.trim();
      return trimmed.length > 0 && trimmed !== '## OurTrips agent notes';
    });
  const pathMarker = `<!-- path: ${path} -->`;
  const existingIndex = lines.findIndex((line) => line.includes(pathMarker));
  if (existingIndex >= 0) {
    lines[existingIndex] = noteLine;
  } else {
    lines.push(noteLine);
  }
  return lines.join('\n');
}

export function upsertAccommodationAgentNote(
  markdownSource: string,
  args: {
    dayNumber: number;
    date: string;
    name: string;
    path: string;
    detailPatch?: Partial<AccommodationDetail>;
    accommodationPatch?: AccommodationPatch;
    previousName?: string;
  }
): string {
  const noteLine = buildAccommodationAgentNote(args);
  if (!noteLine) return markdownSource;

  const startIndex = markdownSource.indexOf(AGENT_NOTES_START);
  const endIndex = markdownSource.indexOf(AGENT_NOTES_END);
  if (startIndex >= 0 && endIndex > startIndex) {
    const before = markdownSource.slice(0, startIndex).trimEnd();
    const existingBodyStart = startIndex + AGENT_NOTES_START.length;
    const existingBody = markdownSource.slice(existingBodyStart, endIndex).trim();
    const after = markdownSource.slice(endIndex + AGENT_NOTES_END.length).trimStart();
    const nextBody = upsertAgentNoteLine(existingBody, args.path, noteLine);
    const section = `${AGENT_NOTES_START}\n## OurTrips agent notes\n\n${nextBody}\n${AGENT_NOTES_END}`;
    return [before, section, after].filter(Boolean).join('\n\n');
  }

  const section = `${AGENT_NOTES_START}\n## OurTrips agent notes\n\n${noteLine}\n${AGENT_NOTES_END}`;
  return `${markdownSource.trimEnd()}\n\n${section}`;
}

function readableDayItemKind(kind: 'activity' | 'meal' | 'transport'): string {
  if (kind === 'activity') return 'Programme item';
  if (kind === 'meal') return 'Meal';
  return 'Transport';
}

function summarizeDayItem(kind: 'activity' | 'meal' | 'transport', item: Record<string, unknown>): string[] {
  const parts: string[] = [];
  const add = (label: string, value: unknown) => {
    const clean = oneLineMarkdown(value);
    if (clean) parts.push(`${label}: ${clean}`);
  };

  if (kind === 'activity') {
    const detail = typeof item.detail === 'object' && item.detail ? item.detail as Record<string, unknown> : {};
    const place = typeof item.place === 'object' && item.place ? item.place as Record<string, unknown> : {};
    add('Time', item.time_label);
    add('Type', item.type);
    add('Title', detail.title ?? place.name);
    add('What', item.content);
    add('Why', detail.why);
    add('Practical', detail.practical);
    add('Cost', item.cost_hint);
    return parts;
  }

  if (kind === 'meal') {
    const detail = typeof item.detail === 'object' && item.detail ? item.detail as Record<string, unknown> : {};
    const place = typeof item.place === 'object' && item.place ? item.place as Record<string, unknown> : {};
    add('Type', item.type);
    add('Restaurant', item.name);
    add('Place', place.address ?? place.name);
    add('Cuisine', detail.cuisine);
    add('Order', detail.what_to_order);
    add('Booking', detail.booking_note ?? detail.reservation);
    add('Status', item.booking_status ?? item.status);
    return parts;
  }

  const detail = typeof item.detail === 'object' && item.detail ? item.detail as Record<string, unknown> : {};
  add('Mode', item.mode);
  add('Label', item.label);
  add('From', item.from);
  add('To', item.to);
  add('Depart', item.depart);
  add('Arrive', item.arrive);
  add('Duration', item.duration);
  add('Status', item.booking_status ?? item.status);
  add('Note', detail.note);
  return parts;
}

function summarizeMatch(match: Record<string, unknown>): string {
  return Object.entries(match)
    .flatMap(([key, value]) => {
      const clean = oneLineMarkdown(value);
      return clean ? [`${key}: ${clean}`] : [];
    })
    .join(', ');
}

function upsertDayItemAgentNote(
  markdownSource: string,
  args: {
    kind: 'activity' | 'meal' | 'transport';
    action: 'upserted' | 'deleted';
    dayNumber: number;
    date?: string;
    path: string;
    item?: Record<string, unknown>;
    match?: Record<string, unknown>;
  }
): string {
  const summary = args.item
    ? summarizeDayItem(args.kind, args.item)
    : [`Match: ${summarizeMatch(args.match ?? {})}`].filter((part) => part !== 'Match: ');
  if (summary.length === 0) return markdownSource;

  const heading = `Day ${args.dayNumber}${args.date ? ` (${args.date})` : ''} — ${readableDayItemKind(args.kind)}`;
  const noteLine = `- ${heading}: ${args.action}; ${summary.join('; ')}. <!-- path: ${args.path} -->`;

  const startIndex = markdownSource.indexOf(AGENT_NOTES_START);
  const endIndex = markdownSource.indexOf(AGENT_NOTES_END);
  if (startIndex >= 0 && endIndex > startIndex) {
    const before = markdownSource.slice(0, startIndex).trimEnd();
    const existingBodyStart = startIndex + AGENT_NOTES_START.length;
    const existingBody = markdownSource.slice(existingBodyStart, endIndex).trim();
    const after = markdownSource.slice(endIndex + AGENT_NOTES_END.length).trimStart();
    const nextBody = upsertAgentNoteLine(existingBody, args.path, noteLine);
    const section = `${AGENT_NOTES_START}\n## OurTrips agent notes\n\n${nextBody}\n${AGENT_NOTES_END}`;
    return [before, section, after].filter(Boolean).join('\n\n');
  }

  const section = `${AGENT_NOTES_START}\n## OurTrips agent notes\n\n${noteLine}\n${AGENT_NOTES_END}`;
  return `${markdownSource.trimEnd()}\n\n${section}`;
}

type AccommodationCascadeReview = {
  required: true;
  reason: string;
  changed_day_numbers: number[];
  review_day_numbers: number[];
  changed_fields: string[];
  required_actions: string[];
};

function compactComparableString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const compact = value.replace(/\s+/g, ' ').trim();
  return compact.length > 0 ? compact : null;
}

function accommodationLocationSnapshot(day: TripData['days'][number] | undefined) {
  const accommodation = day?.accommodation;
  const detail = accommodation?.detail;
  return {
    name: compactComparableString(accommodation?.name),
    address: compactComparableString(detail?.address),
  };
}

function orderedExistingDayNumbers(trip: TripData, dayNumbers: Iterable<number>): number[] {
  const wanted = new Set(dayNumbers);
  return trip.days
    .map((day) => day.day_number)
    .filter((dayNumber) => wanted.has(dayNumber));
}

function dayNumbersForCascadeReview(trip: TripData, changedDayNumbers: number[]): number[] {
  const existing = new Set(trip.days.map((day) => day.day_number));
  const review = new Set<number>();
  for (const dayNumber of changedDayNumbers) {
    if (existing.has(dayNumber)) review.add(dayNumber);
    if (existing.has(dayNumber + 1)) review.add(dayNumber + 1);
  }
  return orderedExistingDayNumbers(trip, review);
}

function buildAccommodationCascadeReview(
  before: TripData,
  after: TripData
): AccommodationCascadeReview | null {
  const beforeByDayNumber = new Map(before.days.map((day) => [day.day_number, day]));
  const changedDayNumbers: number[] = [];
  const changedFields: string[] = [];

  for (const afterDay of after.days) {
    const beforeDay = beforeByDayNumber.get(afterDay.day_number);
    const beforeLocation = accommodationLocationSnapshot(beforeDay);
    const afterLocation = accommodationLocationSnapshot(afterDay);
    const dayChangedFields: string[] = [];

    if (beforeLocation.name !== afterLocation.name) {
      dayChangedFields.push(`days[day_number=${afterDay.day_number}].accommodation.name`);
    }
    if (beforeLocation.address !== afterLocation.address) {
      dayChangedFields.push(`days[day_number=${afterDay.day_number}].accommodation.detail.address`);
    }

    if (dayChangedFields.length > 0) {
      changedDayNumbers.push(afterDay.day_number);
      changedFields.push(...dayChangedFields);
    }
  }

  if (changedDayNumbers.length === 0) return null;

  const reviewDayNumbers = dayNumbersForCascadeReview(after, changedDayNumbers);
  return {
    required: true,
    reason:
      'Accommodation identity or address changed; nearby itinerary items may still assume the old hotel base.',
    changed_day_numbers: orderedExistingDayNumbers(after, changedDayNumbers),
    review_day_numbers: reviewDayNumbers,
    changed_fields: changedFields,
    required_actions: [
      `Call get_trip with view="days" and day_numbers=${JSON.stringify(reviewDayNumbers)} before your final reply.`,
      'Review each affected whole day and the following day for stale neighbourhood references, impossible routing, old hotel names, old meeting points, and meals or activities that no longer fit the new base.',
      'Repair the structured itinerary with focused tools or update_trip. If the new base is unclear, ask one focused question instead of claiming the edit is complete.',
      'In the final reply, mention whether the surrounding days were adjusted or checked with no further changes needed.',
    ],
  };
}

export function collectAccommodations(trip: TripData) {
  return trip.days.flatMap((day, dayIndex) => {
    if (!day.accommodation) return [];
    const detail = day.accommodation.detail;
    return [
      {
        day_number: day.day_number,
        day_index: dayIndex,
        date: day.date,
        day_title: day.title,
        path: `days[${dayIndex}].accommodation`,
        name: day.accommodation.name,
        status: day.accommodation.status ?? null,
        nights: day.accommodation.nights ?? null,
        note: day.accommodation.note ?? null,
        location_hint: detail?.address ?? inferLocationFromDayTitle(day.title) ?? null,
        address: detail?.address ?? null,
        phone: detail?.phone ?? null,
        direct_website_url: detail?.direct_website_url ?? null,
        direct_website_label: detail?.direct_website_label ?? null,
        booking_platform: detail?.booking_platform ?? null,
        existing_dog_note: detail?.dog_note ?? null,
        existing_policy_source_url:
          typeof detail?.policy_source_url === 'string' ? detail.policy_source_url : null,
        detail_present: detail !== undefined,
      },
    ];
  });
}

export function applyAccommodationDetailPatch(
  existing: TripData,
  path: string,
  detailPatch: Partial<AccommodationDetail>
):
  | {
      ok: true;
      next: TripData;
      dayNumber: number;
      name: string;
      cascadeReview: AccommodationCascadeReview | null;
      markdownSourceUpdated: boolean;
    }
  | { ok: false; error: string } {
  const dayIndex = parseAccommodationPath(path);
  if (dayIndex === null) {
    return { ok: false, error: 'Invalid accommodation path. Use a path returned by list_accommodations.' };
  }
  const day = existing.days[dayIndex];
  if (!day) {
    return { ok: false, error: `No day exists at ${path}. Re-run list_accommodations and use a current path.` };
  }
  if (!day.accommodation) {
    return { ok: false, error: `Day ${day.day_number} has no accommodation to update.` };
  }

  const nextDays = existing.days.map((candidate, index) => {
    if (index !== dayIndex || !candidate.accommodation) return candidate;
    return {
      ...candidate,
      accommodation: {
        ...candidate.accommodation,
        detail: {
          ...(candidate.accommodation.detail ?? {}),
          ...detailPatch,
        },
      },
    };
  });

  const next: TripData = { ...existing, days: nextDays };
  if (typeof existing.markdown_source === 'string' && existing.markdown_source.length > 0) {
    next.markdown_source = upsertAccommodationAgentNote(existing.markdown_source, {
      dayNumber: day.day_number,
      date: day.date,
      name: day.accommodation.name,
      path,
      detailPatch,
    });
  }

  return {
    ok: true,
    next,
    dayNumber: day.day_number,
    name: day.accommodation.name,
    cascadeReview: buildAccommodationCascadeReview(existing, next),
    markdownSourceUpdated: next.markdown_source !== existing.markdown_source,
  };
}

export function applyAccommodationPatch(
  existing: TripData,
  path: string,
  accommodationPatch: AccommodationPatch,
  match: 'path_only' | 'same_current_name' = 'path_only'
):
  | {
      ok: true;
      next: TripData;
      dayNumbers: number[];
      previousName: string;
      name: string;
      updatedCount: number;
      cascadeReview: AccommodationCascadeReview | null;
      markdownSourceUpdated: boolean;
    }
  | { ok: false; error: string } {
  const dayIndex = parseAccommodationPath(path);
  if (dayIndex === null) {
    return { ok: false, error: 'Invalid accommodation path. Use a path returned by list_accommodations.' };
  }
  const day = existing.days[dayIndex];
  if (!day) {
    return { ok: false, error: `No day exists at ${path}. Re-run list_accommodations and use a current path.` };
  }
  if (!day.accommodation) {
    return { ok: false, error: `Day ${day.day_number} has no accommodation to update.` };
  }
  if (Object.keys(accommodationPatch).length === 0) {
    return { ok: false, error: 'Provide at least one accommodation field to patch.' };
  }

  const normalizedPatch: AccommodationPatch = { ...accommodationPatch };
  const normalizedStatus =
    typeof normalizedPatch.status === 'string'
      ? normalizedPatch.status.trim().toLowerCase()
      : '';
  if (
    normalizedPatch.booking_status === undefined &&
    (normalizedStatus === 'booked' || normalizedStatus === 'confirmed')
  ) {
    normalizedPatch.booking_status = 'booked';
  } else if (
    normalizedPatch.booking_status === undefined &&
    (normalizedStatus === 'open' || normalizedStatus === 'pending')
  ) {
    normalizedPatch.booking_status = 'open';
  }

  const previousName = day.accommodation.name;
  const updatedDayNumbers: number[] = [];
  const updatedNotes: Array<{
    index: number;
    dayNumber: number;
    date: string;
    previousName: string;
    name: string;
  }> = [];
  const nextDays = existing.days.map((candidate, index) => {
    if (!candidate.accommodation) return candidate;
    const shouldPatch =
      match === 'same_current_name'
        ? candidate.accommodation.name === previousName
        : index === dayIndex;
    if (!shouldPatch) return candidate;

    const nextAccommodation = {
      ...candidate.accommodation,
      ...normalizedPatch,
    };
    updatedDayNumbers.push(candidate.day_number);
    updatedNotes.push({
      index,
      dayNumber: candidate.day_number,
      date: candidate.date,
      previousName: candidate.accommodation.name,
      name: nextAccommodation.name,
    });
    return {
      ...candidate,
      accommodation: nextAccommodation,
    };
  });

  const next: TripData = { ...existing, days: nextDays };
  if (typeof existing.markdown_source === 'string' && existing.markdown_source.length > 0) {
    next.markdown_source = updatedNotes.reduce(
      (markdownSource, note) =>
        upsertAccommodationAgentNote(markdownSource, {
          dayNumber: note.dayNumber,
          date: note.date,
          name: note.name,
          path: `days[${note.index}].accommodation`,
          accommodationPatch: normalizedPatch,
          previousName: note.previousName,
        }),
      existing.markdown_source
    );
  }

  return {
    ok: true,
    next,
    dayNumbers: updatedDayNumbers,
    previousName,
    name: normalizedPatch.name ?? previousName,
    updatedCount: updatedDayNumbers.length,
    cascadeReview: buildAccommodationCascadeReview(existing, next),
    markdownSourceUpdated: next.markdown_source !== existing.markdown_source,
  };
}

type FocusedDayItemKind = 'activity' | 'meal' | 'transport';
type MutableTripDataForDayItems = Parameters<typeof upsertDayItemInTripData>[0];

async function applyFocusedDayItemUpsert(args: {
  ctx: TripToolContext;
  toolName: string;
  kind: FocusedDayItemKind;
  dayNumber: number;
  item: Record<string, unknown>;
  match?: Record<string, unknown>;
  mode?: 'merge' | 'replace';
  position?: 'append' | 'prepend';
  rawInput: unknown;
}) {
  const before = await readTripData(args.ctx);
  const next = cloneTripData(before);
  const mutableNext = next as unknown as MutableTripDataForDayItems;
  const day = before.days.find((candidate) => candidate.day_number === args.dayNumber);
  const result = upsertDayItemInTripData(mutableNext, {
    kind: args.kind,
    day_number: args.dayNumber,
    item: args.item,
    match: args.match,
    mode: args.mode,
    position: args.position,
  });

  if (typeof next.markdown_source === 'string' && next.markdown_source.length > 0) {
    next.markdown_source = result.changed_paths.reduce(
      (markdownSource, path) =>
        upsertDayItemAgentNote(markdownSource, {
          kind: args.kind,
          action: 'upserted',
          dayNumber: args.dayNumber,
          date: day?.date,
          path,
          item: args.item,
        }),
      next.markdown_source
    );
  }

  await writeTripData(args.ctx, next);

  if (args.ctx.onUpdateApplied) {
    try {
      await args.ctx.onUpdateApplied({
        tool: args.toolName,
        before,
        after: next,
        input: args.rawInput,
      });
    } catch {
      // Telemetry errors must not fail the tool call.
    }
  }

  return jsonToolResponse({
    ok: true,
    kind: args.kind,
    day_number: args.dayNumber,
    changed_paths: result.changed_paths,
    markdown_source_updated: next.markdown_source !== before.markdown_source,
  });
}

async function applyFocusedDayItemDelete(args: {
  ctx: TripToolContext;
  toolName: string;
  kind: FocusedDayItemKind;
  dayNumber: number;
  match: Record<string, unknown>;
  rawInput: unknown;
}) {
  const before = await readTripData(args.ctx);
  const next = cloneTripData(before);
  const mutableNext = next as unknown as MutableTripDataForDayItems;
  const day = before.days.find((candidate) => candidate.day_number === args.dayNumber);
  const result = deleteDayItemInTripData(mutableNext, {
    kind: args.kind,
    day_number: args.dayNumber,
    match: args.match,
  });

  if (typeof next.markdown_source === 'string' && next.markdown_source.length > 0) {
    next.markdown_source = result.changed_paths.reduce(
      (markdownSource, path) =>
        upsertDayItemAgentNote(markdownSource, {
          kind: args.kind,
          action: 'deleted',
          dayNumber: args.dayNumber,
          date: day?.date,
          path,
          match: args.match,
        }),
      next.markdown_source
    );
  }

  await writeTripData(args.ctx, next);

  if (args.ctx.onUpdateApplied) {
    try {
      await args.ctx.onUpdateApplied({
        tool: args.toolName,
        before,
        after: next,
        input: args.rawInput,
      });
    } catch {
      // Telemetry errors must not fail the tool call.
    }
  }

  return jsonToolResponse({
    ok: true,
    kind: args.kind,
    day_number: args.dayNumber,
    changed_paths: result.changed_paths,
    markdown_source_updated: next.markdown_source !== before.markdown_source,
  });
}

export function buildPolicySearchQuery(args: {
  place_name: string;
  city?: string;
  country?: string;
  policy_type: 'dog_policy' | 'pet_policy';
}): string {
  const policyTerms =
    args.policy_type === 'dog_policy'
      ? 'dog policy dogs allowed pets official'
      : 'pet policy pets allowed official';
  return [args.place_name, args.city, args.country, policyTerms]
    .filter(Boolean)
    .join(' ');
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ');
}

function stripHtmlToText(html: string): string {
  return decodeHtmlEntities(
    html
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
      .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, ' ')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(?:p|div|li|tr|h[1-6])>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
  )
    .replace(/[ \t\r\f\v]+/g, ' ')
    .replace(/\n\s+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

async function fetchText(url: string): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), POLICY_FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        accept: 'text/html,text/plain;q=0.9,*/*;q=0.8',
        'user-agent': 'OurTrips policy research (+https://ourtrips.to)',
      },
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    return (await res.text()).slice(0, POLICY_TEXT_LIMIT);
  } finally {
    clearTimeout(timeout);
  }
}

function extractDuckDuckGoUrls(html: string): string[] {
  const urls: string[] = [];
  for (const match of html.matchAll(/href="([^"]+)"/g)) {
    const rawHref = decodeHtmlEntities(match[1]);
    let href = rawHref.startsWith('//') ? `https:${rawHref}` : rawHref;
    if (href.startsWith('/')) href = `https://duckduckgo.com${href}`;
    try {
      const parsed = new URL(href);
      const redirected = parsed.searchParams.get('uddg');
      const candidate = redirected ? decodeURIComponent(redirected) : href;
      if (!candidate.startsWith('http')) continue;
      const host = new URL(candidate).hostname;
      if (host.includes('duckduckgo.com')) continue;
      urls.push(candidate);
    } catch {
      // Ignore malformed search-result links.
    }
  }
  return Array.from(new Set(urls));
}

function scorePolicyUrl(url: string, placeName: string): number {
  try {
    const parsed = new URL(url);
    const haystack = `${parsed.hostname} ${parsed.pathname}`.toLowerCase();
    const placeTokens = placeName
      .toLowerCase()
      .split(/\W+/)
      .filter((token) => token.length > 3);
    let score = 0;
    for (const token of placeTokens) {
      if (haystack.includes(token)) score += 3;
    }
    if (/(dog|dogs|pet|pets|faq|frequently|policy|hotel|stay)/.test(haystack)) score += 2;
    if (/(facebook|instagram|tiktok|tripadvisor|booking\.com|expedia|hotels\.com)/.test(haystack)) {
      score -= 3;
    }
    return score;
  } catch {
    return 0;
  }
}

async function searchPolicyPages(query: string, placeName: string): Promise<string[]> {
  const html = await fetchText(`https://duckduckgo.com/html/?q=${encodeURIComponent(query)}`);
  return extractDuckDuckGoUrls(html)
    .sort((a, b) => scorePolicyUrl(b, placeName) - scorePolicyUrl(a, placeName))
    .slice(0, POLICY_CANDIDATE_LIMIT);
}

function compactSnippet(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

export function extractPolicySnippets(text: string): string[] {
  const keywords = [
    'dog',
    'dogs',
    'pet',
    'pets',
    'animal',
    'animals',
    'assistance dog',
    'service animal',
  ];
  const lower = text.toLowerCase();
  const snippets: string[] = [];
  for (const keyword of keywords) {
    const index = lower.indexOf(keyword);
    if (index < 0) continue;
    const start = Math.max(0, index - 180);
    const end = Math.min(text.length, index + 260);
    const snippet = compactSnippet(text.slice(start, end));
    if (snippet && !snippets.some((existing) => existing.includes(snippet.slice(0, 80)))) {
      snippets.push(snippet);
    }
    if (snippets.length >= 3) break;
  }
  return snippets;
}

export function inferPolicyFromText(
  text: string,
  policyType: 'dog_policy' | 'pet_policy'
): { policy: string | null; confidence: 'high' | 'medium' | 'low'; matched: boolean } {
  const lower = text.toLowerCase();
  const subject = policyType === 'dog_policy' ? 'Dogs' : 'Pets';

  if (
    /(assistance|service)\s+(dogs?|animals?)\s+only/.test(lower) ||
    /only\s+(assistance|service)\s+(dogs?|animals?)/.test(lower)
  ) {
    return {
      policy: `${subject} appear limited to assistance/service animals only.`,
      confidence: 'medium',
      matched: true,
    };
  }

  if (
    /\b(no|not)\s+(dogs?|pets?)\b/.test(lower) ||
    /\b(dogs?|pets?)\s+(are\s+)?not\s+(allowed|permitted|accepted|welcome)/.test(lower) ||
    /\bwe\s+do\s+not\s+(allow|accept).{0,80}\b(dogs?|pets?)\b/.test(lower)
  ) {
    return {
      policy: `${subject} do not appear to be allowed.`,
      confidence: 'medium',
      matched: true,
    };
  }

  if (
    /\b(dogs?|pets?)\s+(are\s+)?(welcome|allowed|permitted|accepted)\b/.test(lower) ||
    /\b(dog|pet)[-\s]?friendly\b/.test(lower) ||
    /\b(welcome|allow|accept).{0,80}\b(dogs?|pets?)\b/.test(lower)
  ) {
    return {
      policy: `${subject} appear to be allowed; confirm any room, fee, or size restrictions directly.`,
      confidence: 'medium',
      matched: true,
    };
  }

  return { policy: null, confidence: 'low', matched: false };
}

function sourceLabel(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

async function researchPlacePolicy(rawArgs: unknown) {
  const args = z.object(ResearchPlacePolicyInputShape).parse(rawArgs);
  const query = buildPolicySearchQuery(args);
  const checkedUrls: string[] = [];
  const errors: string[] = [];
  let candidateUrls = args.source_url ? [args.source_url] : [];

  try {
    const searched = await searchPolicyPages(query, args.place_name);
    candidateUrls = Array.from(new Set([...candidateUrls, ...searched])).slice(
      0,
      POLICY_CANDIDATE_LIMIT
    );
  } catch (err) {
    errors.push(`search failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  for (const url of candidateUrls) {
    checkedUrls.push(url);
    try {
      const html = await fetchText(url);
      const text = stripHtmlToText(html);
      const snippets = extractPolicySnippets(text);
      const inference = inferPolicyFromText(snippets.join('\n') || text, args.policy_type);
      if (inference.matched && inference.policy) {
        const urlScore = scorePolicyUrl(url, args.place_name);
        return {
          status: 'found',
          place_name: args.place_name,
          city: args.city ?? null,
          policy_type: args.policy_type,
          policy: inference.policy,
          summary: inference.policy,
          confidence: urlScore >= 2 ? inference.confidence : 'low',
          source_url: url,
          source_label: sourceLabel(url),
          snippets,
          checked_urls: checkedUrls,
          query,
        };
      }
    } catch (err) {
      errors.push(`${url}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return {
    status: candidateUrls.length ? 'not_found' : 'search_failed',
    place_name: args.place_name,
    city: args.city ?? null,
    policy_type: args.policy_type,
    policy: null,
    summary:
      'No clear policy statement was found in the pages checked. Ask the property directly before relying on this.',
    confidence: 'low',
    source_url: null,
    source_label: null,
    snippets: [],
    checked_urls: checkedUrls,
    query,
    search_url: `https://duckduckgo.com/?q=${encodeURIComponent(query)}`,
    errors: errors.slice(0, 3),
  };
}

/**
 * Build the in-process MCP server exposing get_trip + update_trip, closed over
 * the supplied context. One server instance per query() call — tools cannot
 * be swapped between trips mid-session.
 */
export function createTripEditorMcpServer(
  ctx: TripToolContext
): McpSdkServerConfigWithInstance {
  const getTrip = tool(
    'get_trip',
    GET_TRIP_DESCRIPTION,
    GetTripInputShape,
    async (rawArgs) => {
      const parsed = GetTripInputSchema.safeParse(rawArgs ?? {});
      if (!parsed.success) {
        return textToolError(`Invalid input: ${formatZodIssues(parsed.error)}`);
      }

      const { data, error } = await ctx.supabase
        .from('trips')
        .select('id, share_id, name, share_mode, created_at, updated_at, data')
        .eq('id', ctx.tripId)
        .single();

      if (error || !data) {
        return textToolError(`Error reading trip: ${error?.message ?? 'not found'}`);
      }

      const input = parsed.data;
      if (input.view === 'full') {
        if (input.allow_large !== true) {
          return textToolError(
            'Full trip reads can exceed agent token limits. Use view=summary, view=day, view=days with day ranges, view=sections, or set allow_large=true intentionally.'
          );
        }
        return jsonToolResponse(normalizeTripData(data.data));
      }

      try {
        return jsonToolResponse(
          formatTripForRead(
            data as Record<string, unknown>,
            input,
            ctx.origin ?? ''
          )
        );
      } catch (err) {
        return textToolError(err instanceof Error ? err.message : String(err));
      }
    }
  );

  const getLogisticsAudit = tool(
    'get_logistics_audit',
    GET_LOGISTICS_AUDIT_DESCRIPTION,
    {},
    async () => {
      try {
        const trip = await readTripData(ctx);
        const audit = auditTripLogistics(trip);
        return jsonToolResponse({
          status: audit.errors.length ? 'needs_repair' : 'ok',
          summary: audit.summary,
          errors: audit.errors,
          warnings: audit.warnings,
          open_questions: audit.ledger.openQuestions,
          ledger: audit.ledger,
        });
      } catch (err) {
        return textToolError(err instanceof Error ? err.message : String(err));
      }
    }
  );

  const getDateLedger = tool(
    'get_date_ledger',
    GET_DATE_LEDGER_DESCRIPTION,
    {},
    async () => {
      try {
        const trip = await readTripData(ctx);
        return jsonToolResponse(buildTripLogisticsLedger(trip));
      } catch (err) {
        return textToolError(err instanceof Error ? err.message : String(err));
      }
    }
  );

  const listAccommodations = tool(
    'list_accommodations',
    LIST_ACCOMMODATIONS_DESCRIPTION,
    {},
    async () => {
      const { data, error } = await ctx.supabase
        .from('trips')
        .select('data')
        .eq('id', ctx.tripId)
        .single();

      if (error || !data) {
        return textToolError(`Error reading trip: ${error?.message ?? 'not found'}`);
      }

      const trip = normalizeTripData(data.data);
      return jsonToolResponse({
        count: collectAccommodations(trip).length,
        markdown_source_present: typeof trip.markdown_source === 'string' && trip.markdown_source.length > 0,
        accommodations: collectAccommodations(trip),
      });
    }
  );

  const listAccommodationReview = tool(
    'list_accommodation_review',
    LIST_ACCOMMODATION_REVIEW_DESCRIPTION,
    {},
    async () => {
      try {
        const trip = await readTripData(ctx);
        const review = await loadOrCreateAccommodationReview(ctx, trip);
        return jsonToolResponse(summarizeAccommodationReview(review));
      } catch (err) {
        return textToolError(err instanceof Error ? err.message : String(err));
      }
    }
  );

  const getImageStatus = tool(
    'get_image_status',
    GET_IMAGE_STATUS_DESCRIPTION,
    {},
    async () => {
      try {
        const trip = await readTripData(ctx);
        return jsonToolResponse({
          image_status: summarizeTripImages(trip),
        });
      } catch (err) {
        return textToolError(err instanceof Error ? err.message : String(err));
      }
    }
  );

  const searchTripImagesTool = tool(
    'search_trip_images',
    SEARCH_TRIP_IMAGES_DESCRIPTION,
    SearchTripImagesInputShape,
    async (rawArgs) => {
      const parsed = z.object(SearchTripImagesInputShape).safeParse(rawArgs);
      if (!parsed.success) {
        return textToolError(`Invalid input: ${formatZodIssues(parsed.error)}`);
      }

      try {
        const result = await searchTripImages(
          parsed.data.query,
          parsed.data.orientation ?? 'landscape'
        );
        return jsonToolResponse({
          ...result,
          next_step:
            'Pick a matching result, then call set_trip_image with the chosen landscape or portrait URL and its download_url so Unsplash tracking is recorded.',
        });
      } catch (err) {
        return textToolError(err instanceof Error ? err.message : String(err));
      }
    }
  );

  const setTripImage = tool(
    'set_trip_image',
    SET_TRIP_IMAGE_DESCRIPTION,
    SetTripImageInputShape,
    async (rawArgs) => {
      const parsed = z.object(SetTripImageInputShape).safeParse(rawArgs);
      if (!parsed.success) {
        return textToolError(`Invalid input: ${formatZodIssues(parsed.error)}`);
      }

      if (parsed.data.target === 'day_hero' && typeof parsed.data.day_number !== 'number') {
        return textToolError('day_number is required when target is day_hero');
      }

      try {
        const ownerUserId = await requireTripOwnerUserId(ctx);
        const before = await readTripData(ctx);
        const result = await setTripHeroImageForUser(
          ctx.supabase,
          ownerUserId,
          ctx.tripId,
          {
            target:
              parsed.data.target === 'day_hero'
                ? { kind: 'day', day_number: parsed.data.day_number as number }
                : {
                    kind: 'trip',
                    field: parsed.data.target === 'trip_overview'
                      ? 'overview_image'
                      : 'hero_image',
                  },
            url: parsed.data.url,
            download_url: parsed.data.download_url,
          },
          ctx.origin ?? ''
        );
        if (ctx.onUpdateApplied) {
          try {
            await ctx.onUpdateApplied({
              tool: 'set_trip_image',
              before,
              after: normalizeTripData(result.record.data),
              input: parsed.data,
            });
          } catch {
            // Telemetry errors must not fail the tool call.
          }
        }
        return jsonToolResponse(result.summary);
      } catch (err) {
        return textToolError(err instanceof Error ? err.message : String(err));
      }
    }
  );

  const completeMissingImages = tool(
    'complete_missing_images',
    COMPLETE_MISSING_IMAGES_DESCRIPTION,
    CompleteMissingImagesInputShape,
    async (rawArgs) => {
      const parsed = z.object(CompleteMissingImagesInputShape).safeParse(rawArgs ?? {});
      if (!parsed.success) {
        return textToolError(`Invalid input: ${formatZodIssues(parsed.error)}`);
      }

      try {
        const ownerUserId = await requireTripOwnerUserId(ctx);
        const before = await readTripData(ctx);
        const result = await completeMissingTripImagesForUser(
          ctx.supabase,
          ownerUserId,
          ctx.tripId,
          parsed.data,
          ctx.origin ?? ''
        );
        if (ctx.onUpdateApplied && result.changed_paths.length > 0) {
          try {
            await ctx.onUpdateApplied({
              tool: 'complete_missing_images',
              before,
              after: result.trip_data,
              input: parsed.data,
            });
          } catch {
            // Telemetry errors must not fail the tool call.
          }
        }
        const summary = { ...result };
        delete summary.trip_data;
        return jsonToolResponse(summary);
      } catch (err) {
        return textToolError(err instanceof Error ? err.message : String(err));
      }
    }
  );

  const getTripImagePrompts = tool(
    'get_trip_image_prompts',
    GET_TRIP_IMAGE_PROMPTS_DESCRIPTION,
    {},
    async () => {
      try {
        const ownerUserId = await requireTripOwnerUserId(ctx);
        const result = await getTripImagePromptsForUser(
          ctx.supabase,
          ownerUserId,
          ctx.tripId
        );
        return jsonToolResponse(result);
      } catch (err) {
        return textToolError(err instanceof Error ? err.message : String(err));
      }
    }
  );

  const saveTripImageAsset = tool(
    'save_trip_image_asset',
    SAVE_TRIP_IMAGE_ASSET_DESCRIPTION,
    SaveTripImageAssetInputShape,
    async (rawArgs) => {
      const parsed = z.object(SaveTripImageAssetInputShape).safeParse(rawArgs);
      if (!parsed.success) {
        return textToolError(`Invalid input: ${formatZodIssues(parsed.error)}`);
      }

      try {
        return await applyTripServiceMutation({
          ctx,
          toolName: 'save_trip_image_asset',
          rawInput: parsed.data,
          mutate: (ownerUserId) => saveTripImageAssetForUser(
            ctx.supabase,
            ownerUserId,
            ctx.tripId,
            parsed.data,
            ctx.origin ?? ''
          ),
        });
      } catch (err) {
        return textToolError(err instanceof Error ? err.message : String(err));
      }
    }
  );

  const upsertAccommodation = tool(
    'upsert_accommodation',
    UPSERT_ACCOMMODATION_DESCRIPTION,
    UpsertAccommodationInputShape,
    async (rawArgs) => {
      const parsed = z.object(UpsertAccommodationInputShape).safeParse(rawArgs);
      if (!parsed.success) {
        return textToolError(`Invalid input: ${formatZodIssues(parsed.error)}`);
      }

      try {
        return await applyTripServiceMutation({
          ctx,
          toolName: 'upsert_accommodation',
          rawInput: parsed.data,
          mutate: (ownerUserId) => upsertDayItemForUser(
            ctx.supabase,
            ownerUserId,
            ctx.tripId,
            {
              kind: 'accommodation',
              day_number: parsed.data.day_number,
              item: parsed.data.accommodation as Record<string, unknown>,
              match: parsed.data.match,
              mode: parsed.data.mode,
              scope: parsed.data.scope,
            },
            ctx.origin ?? ''
          ),
        });
      } catch (err) {
        return textToolError(err instanceof Error ? err.message : String(err));
      }
    }
  );

  const deleteAccommodation = tool(
    'delete_accommodation',
    DELETE_ACCOMMODATION_DESCRIPTION,
    DeleteAccommodationInputShape,
    async (rawArgs) => {
      const parsed = z.object(DeleteAccommodationInputShape).safeParse(rawArgs);
      if (!parsed.success) {
        return textToolError(`Invalid input: ${formatZodIssues(parsed.error)}`);
      }

      try {
        return await applyTripServiceMutation({
          ctx,
          toolName: 'delete_accommodation',
          rawInput: parsed.data,
          mutate: (ownerUserId) => deleteDayItemForUser(
            ctx.supabase,
            ownerUserId,
            ctx.tripId,
            {
              kind: 'accommodation',
              day_number: parsed.data.day_number,
              match: parsed.data.match,
              scope: parsed.data.scope,
            },
            ctx.origin ?? ''
          ),
        });
      } catch (err) {
        return textToolError(err instanceof Error ? err.message : String(err));
      }
    }
  );

  const replaceAccommodation = tool(
    'replace_accommodation',
    REPLACE_ACCOMMODATION_DESCRIPTION,
    ReplaceAccommodationInputShape,
    async (rawArgs) => {
      const parsed = z.object(ReplaceAccommodationInputShape).safeParse(rawArgs);
      if (!parsed.success) {
        return textToolError(`Invalid input: ${formatZodIssues(parsed.error)}`);
      }

      try {
        return await applyTripServiceMutation({
          ctx,
          toolName: 'replace_accommodation',
          rawInput: parsed.data,
          mutate: (ownerUserId) => upsertDayItemForUser(
            ctx.supabase,
            ownerUserId,
            ctx.tripId,
            {
              kind: 'accommodation',
              day_number: parsed.data.day_number,
              item: parsed.data.accommodation as Record<string, unknown>,
              match: parsed.data.match,
              mode: 'replace',
              scope: parsed.data.scope,
            },
            ctx.origin ?? ''
          ),
        });
      } catch (err) {
        return textToolError(err instanceof Error ? err.message : String(err));
      }
    }
  );

  const replaceDaySection = tool(
    'replace_day_section',
    REPLACE_DAY_SECTION_DESCRIPTION,
    ReplaceDaySectionInputShape,
    async (rawArgs) => {
      const parsed = z.object(ReplaceDaySectionInputShape).safeParse(rawArgs);
      if (!parsed.success) {
        return textToolError(`Invalid input: ${formatZodIssues(parsed.error)}`);
      }

      try {
        return await applyTripServiceMutation({
          ctx,
          toolName: 'replace_day_section',
          rawInput: parsed.data,
          mutate: (ownerUserId) => replaceDaySectionForUser(
            ctx.supabase,
            ownerUserId,
            ctx.tripId,
            parsed.data,
            ctx.origin ?? ''
          ),
        });
      } catch (err) {
        return textToolError(err instanceof Error ? err.message : String(err));
      }
    }
  );

  const replaceDay = tool(
    'replace_day',
    REPLACE_DAY_DESCRIPTION,
    ReplaceDayInputShape,
    async (rawArgs) => {
      const parsed = z.object(ReplaceDayInputShape).safeParse(rawArgs);
      if (!parsed.success) {
        return textToolError(`Invalid input: ${formatZodIssues(parsed.error)}`);
      }

      try {
        return await applyTripServiceMutation({
          ctx,
          toolName: 'replace_day',
          rawInput: parsed.data,
          mutate: (ownerUserId) => replaceDayForUser(
            ctx.supabase,
            ownerUserId,
            ctx.tripId,
            {
              day_number: parsed.data.day_number,
              day: parsed.data.day,
            },
            ctx.origin ?? ''
          ),
        });
      } catch (err) {
        return textToolError(err instanceof Error ? err.message : String(err));
      }
    }
  );

  const deleteDay = tool(
    'delete_day',
    DELETE_DAY_DESCRIPTION,
    DeleteDayInputShape,
    async (rawArgs) => {
      const parsed = z.object(DeleteDayInputShape).safeParse(rawArgs);
      if (!parsed.success) {
        return textToolError(`Invalid input: ${formatZodIssues(parsed.error)}`);
      }

      try {
        return await applyTripServiceMutation({
          ctx,
          toolName: 'delete_day',
          rawInput: parsed.data,
          mutate: (ownerUserId) => deleteDayForUser(
            ctx.supabase,
            ownerUserId,
            ctx.tripId,
            parsed.data,
            ctx.origin ?? ''
          ),
        });
      } catch (err) {
        return textToolError(err instanceof Error ? err.message : String(err));
      }
    }
  );

  const truncateDaysAfter = tool(
    'truncate_days_after',
    TRUNCATE_DAYS_AFTER_DESCRIPTION,
    TruncateDaysAfterInputShape,
    async (rawArgs) => {
      const parsed = z.object(TruncateDaysAfterInputShape).safeParse(rawArgs);
      if (!parsed.success) {
        return textToolError(`Invalid input: ${formatZodIssues(parsed.error)}`);
      }

      try {
        return await applyTripServiceMutation({
          ctx,
          toolName: 'truncate_days_after',
          rawInput: parsed.data,
          mutate: (ownerUserId) => truncateDaysAfterForUser(
            ctx.supabase,
            ownerUserId,
            ctx.tripId,
            parsed.data,
            ctx.origin ?? ''
          ),
        });
      } catch (err) {
        return textToolError(err instanceof Error ? err.message : String(err));
      }
    }
  );

  const syncMarkdownSource = tool(
    'sync_markdown_source',
    SYNC_MARKDOWN_SOURCE_DESCRIPTION,
    SyncMarkdownSourceInputShape,
    async (rawArgs) => {
      const parsed = z.object(SyncMarkdownSourceInputShape).safeParse(rawArgs);
      if (!parsed.success) {
        return textToolError(`Invalid input: ${formatZodIssues(parsed.error)}`);
      }

      try {
        return await applyTripServiceMutation({
          ctx,
          toolName: 'sync_markdown_source',
          rawInput: parsed.data,
          mutate: (ownerUserId) => syncMarkdownSourceForUser(
            ctx.supabase,
            ownerUserId,
            ctx.tripId,
            parsed.data,
            ctx.origin ?? ''
          ),
        });
      } catch (err) {
        return textToolError(err instanceof Error ? err.message : String(err));
      }
    }
  );

  const updateFromMarkdown = tool(
    'update_from_markdown',
    UPDATE_FROM_MARKDOWN_DESCRIPTION,
    UpdateFromMarkdownInputShape,
    async (rawArgs) => {
      const parsed = z.object(UpdateFromMarkdownInputShape).safeParse(rawArgs);
      if (!parsed.success) {
        return textToolError(`Invalid input: ${formatZodIssues(parsed.error)}`);
      }

      try {
        return await applyTripServiceMutation({
          ctx,
          toolName: 'update_from_markdown',
          rawInput: parsed.data,
          mutate: (ownerUserId) => updateTripFromMarkdownForUser(
            ctx.supabase,
            ownerUserId,
            ctx.tripId,
            parsed.data,
            ctx.origin ?? ''
          ),
        });
      } catch (err) {
        return textToolError(err instanceof Error ? err.message : String(err));
      }
    }
  );

  const updateTrip = tool(
    'update_trip',
    UPDATE_TRIP_DESCRIPTION,
    UpdateTripInputShape,
    async (rawArgs) => {
      // Strict + refined validation in the handler (the SDK's tool()
      // scaffolding can't express .strict().refine() from a raw shape).
      const parsed = UpdateTripInputSchema.safeParse(rawArgs);
      if (!parsed.success) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `Invalid input: ${formatZodIssues(parsed.error)}`,
            },
          ],
          isError: true,
        };
      }

      const input = parsed.data;

      // 1. Read current state (inside the same tool call so we're consistent).
      const read = await ctx.supabase
        .from('trips')
        .select('data')
        .eq('id', ctx.tripId)
        .single();

      if (read.error || !read.data) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `Error reading trip for update: ${read.error?.message ?? 'not found'}`,
            },
          ],
          isError: true,
        };
      }

      const before = normalizeTripData(read.data.data);
      let after: TripData;
      try {
        after = mergeTrip(before, input);
      } catch (err) {
        return textToolError(err instanceof Error ? err.message : String(err));
      }
      if (input.trip !== undefined && input.days !== undefined && !hasCoordinateBackedTripRoute(after)) {
        return textToolError(
          `Full-trip updates must include route coordinates. ${COORDINATE_BACKED_ROUTE_POINTS_REQUIRED_MESSAGE} Add trip.route_points for the main origin, stays, route stops, and return/end point, then retry the same update.`
        );
      }
      const cascadeReview = buildAccommodationCascadeReview(before, after);
      await enrichTripPlaces(after);

      // 2. Write back. The service-role client is trusted (admin route has
      //    already checked role); we update only the JSONB column + bump
      //    updated_at. The immutable columns are never referenced here.
      const write = await ctx.supabase
        .from('trips')
        .update({ data: after, updated_at: new Date().toISOString() })
        .eq('id', ctx.tripId);

      if (write.error) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `Error writing trip: ${write.error.message}`,
            },
          ],
          isError: true,
        };
      }

      const accommodationReviewSync = await trySyncAccommodationReviewForTrip(
        ctx.supabase,
        ctx.tripId,
        after
      );

      // 3. Notify the caller for diff logging / telemetry.
      if (ctx.onUpdateApplied) {
        try {
          await ctx.onUpdateApplied({ tool: 'update_trip', before, after, input });
        } catch {
          // Telemetry errors must not fail the tool call.
        }
      }

      const touched = [
        input.trip !== undefined ? 'trip' : null,
        input.days !== undefined ? 'days' : null,
        input.markdown_source !== undefined ? 'markdown_source' : null,
      ].filter(Boolean);

      const cascadeReviewText = cascadeReview
        ? ` Cascade review required: call get_trip with view="days" and day_numbers=${JSON.stringify(
            cascadeReview.review_day_numbers
          )}; repair stale day copy, activities, meals, transport, tips, and map places before your final reply.`
        : '';

      return {
        content: [
          {
            type: 'text' as const,
            text: `Applied edit. Updated: ${touched.join(', ')}. Accommodation review sync: ${accommodationReviewSync}.${cascadeReviewText} Call get_trip if you need the new state.`,
          },
        ],
      };
    }
  );

  const updateAccommodation = tool(
    'update_accommodation',
    UPDATE_ACCOMMODATION_DESCRIPTION,
    UpdateAccommodationInputShape,
    async (rawArgs) => {
      const parsed = z.object(UpdateAccommodationInputShape).safeParse(rawArgs);
      if (!parsed.success) {
        return textToolError(`Invalid input: ${formatZodIssues(parsed.error)}`);
      }

      const read = await ctx.supabase
        .from('trips')
        .select('data')
        .eq('id', ctx.tripId)
        .single();

      if (read.error || !read.data) {
        return textToolError(`Error reading trip for update: ${read.error?.message ?? 'not found'}`);
      }

      const before = normalizeTripData(read.data.data);
      const result = applyAccommodationPatch(
        before,
        parsed.data.path,
        parsed.data.accommodation_patch,
        parsed.data.match
      );
      if (!result.ok) {
        return textToolError(result.error);
      }
      await enrichTripPlaces(result.next);

      const write = await ctx.supabase
        .from('trips')
        .update({ data: result.next, updated_at: new Date().toISOString() })
        .eq('id', ctx.tripId);

      if (write.error) {
        return textToolError(`Error writing trip: ${write.error.message}`);
      }

      const accommodationReviewSync = await trySyncAccommodationReviewForTrip(
        ctx.supabase,
        ctx.tripId,
        result.next
      );

      if (ctx.onUpdateApplied) {
        try {
          await ctx.onUpdateApplied({
            tool: 'update_accommodation',
            before,
            after: result.next,
            input: parsed.data,
          });
        } catch {
          // Telemetry errors must not fail the tool call.
        }
      }

      return jsonToolResponse({
        ok: true,
        updated: parsed.data.path,
        match: parsed.data.match,
        previous_name: result.previousName,
        accommodation: result.name,
        day_numbers: result.dayNumbers,
        updated_count: result.updatedCount,
        accommodation_keys: Object.keys(parsed.data.accommodation_patch),
        cascade_review: result.cascadeReview,
        markdown_source_updated: result.markdownSourceUpdated,
        accommodation_review_sync: accommodationReviewSync,
      });
    }
  );

  const updateAccommodationDetail = tool(
    'update_accommodation_detail',
    UPDATE_ACCOMMODATION_DETAIL_DESCRIPTION,
    UpdateAccommodationDetailInputShape,
    async (rawArgs) => {
      const parsed = z.object(UpdateAccommodationDetailInputShape).safeParse(rawArgs);
      if (!parsed.success) {
        return textToolError(`Invalid input: ${formatZodIssues(parsed.error)}`);
      }

      const read = await ctx.supabase
        .from('trips')
        .select('data')
        .eq('id', ctx.tripId)
        .single();

      if (read.error || !read.data) {
        return textToolError(`Error reading trip for update: ${read.error?.message ?? 'not found'}`);
      }

      const before = normalizeTripData(read.data.data);
      const result = applyAccommodationDetailPatch(
        before,
        parsed.data.path,
        parsed.data.detail_patch as Partial<AccommodationDetail>
      );
      if (!result.ok) {
        return textToolError(result.error);
      }
      await enrichTripPlaces(result.next);

      const write = await ctx.supabase
        .from('trips')
        .update({ data: result.next, updated_at: new Date().toISOString() })
        .eq('id', ctx.tripId);

      if (write.error) {
        return textToolError(`Error writing trip: ${write.error.message}`);
      }

      const accommodationReviewSync = await trySyncAccommodationReviewForTrip(
        ctx.supabase,
        ctx.tripId,
        result.next
      );

      if (ctx.onUpdateApplied) {
        try {
          await ctx.onUpdateApplied({
            tool: 'update_accommodation_detail',
            before,
            after: result.next,
            input: parsed.data,
          });
        } catch {
          // Telemetry errors must not fail the tool call.
        }
      }

      return jsonToolResponse({
        ok: true,
        updated: parsed.data.path,
        day_number: result.dayNumber,
        accommodation: result.name,
        detail_keys: Object.keys(parsed.data.detail_patch),
        cascade_review: result.cascadeReview,
        markdown_source_updated: result.markdownSourceUpdated,
        accommodation_review_sync: accommodationReviewSync,
      });
    }
  );

  const upsertActivity = tool(
    'upsert_activity',
    UPSERT_ACTIVITY_DESCRIPTION,
    UpsertActivityInputShape,
    async (rawArgs) => {
      const parsed = z.object(UpsertActivityInputShape).safeParse(rawArgs);
      if (!parsed.success) {
        return textToolError(`Invalid input: ${formatZodIssues(parsed.error)}`);
      }

      try {
        return await applyFocusedDayItemUpsert({
          ctx,
          toolName: 'upsert_activity',
          kind: 'activity',
          dayNumber: parsed.data.day_number,
          item: parsed.data.activity as Record<string, unknown>,
          match: parsed.data.match as Record<string, unknown> | undefined,
          mode: parsed.data.mode,
          position: parsed.data.position,
          rawInput: parsed.data,
        });
      } catch (err) {
        return textToolError(err instanceof Error ? err.message : String(err));
      }
    }
  );

  const deleteActivity = tool(
    'delete_activity',
    DELETE_ACTIVITY_DESCRIPTION,
    DeleteActivityInputShape,
    async (rawArgs) => {
      const parsed = z.object(DeleteActivityInputShape).safeParse(rawArgs);
      if (!parsed.success) {
        return textToolError(`Invalid input: ${formatZodIssues(parsed.error)}`);
      }

      try {
        return await applyFocusedDayItemDelete({
          ctx,
          toolName: 'delete_activity',
          kind: 'activity',
          dayNumber: parsed.data.day_number,
          match: parsed.data.match as Record<string, unknown>,
          rawInput: parsed.data,
        });
      } catch (err) {
        return textToolError(err instanceof Error ? err.message : String(err));
      }
    }
  );

  const upsertMeal = tool(
    'upsert_meal',
    UPSERT_MEAL_DESCRIPTION,
    UpsertMealInputShape,
    async (rawArgs) => {
      const parsed = z.object(UpsertMealInputShape).safeParse(rawArgs);
      if (!parsed.success) {
        return textToolError(`Invalid input: ${formatZodIssues(parsed.error)}`);
      }

      try {
        return await applyFocusedDayItemUpsert({
          ctx,
          toolName: 'upsert_meal',
          kind: 'meal',
          dayNumber: parsed.data.day_number,
          item: parsed.data.meal as Record<string, unknown>,
          match: parsed.data.match as Record<string, unknown> | undefined,
          mode: parsed.data.mode,
          position: parsed.data.position,
          rawInput: parsed.data,
        });
      } catch (err) {
        return textToolError(err instanceof Error ? err.message : String(err));
      }
    }
  );

  const deleteMeal = tool(
    'delete_meal',
    DELETE_MEAL_DESCRIPTION,
    DeleteMealInputShape,
    async (rawArgs) => {
      const parsed = z.object(DeleteMealInputShape).safeParse(rawArgs);
      if (!parsed.success) {
        return textToolError(`Invalid input: ${formatZodIssues(parsed.error)}`);
      }

      try {
        return await applyFocusedDayItemDelete({
          ctx,
          toolName: 'delete_meal',
          kind: 'meal',
          dayNumber: parsed.data.day_number,
          match: parsed.data.match as Record<string, unknown>,
          rawInput: parsed.data,
        });
      } catch (err) {
        return textToolError(err instanceof Error ? err.message : String(err));
      }
    }
  );

  const upsertTransport = tool(
    'upsert_transport',
    UPSERT_TRANSPORT_DESCRIPTION,
    UpsertTransportInputShape,
    async (rawArgs) => {
      const parsed = z.object(UpsertTransportInputShape).safeParse(rawArgs);
      if (!parsed.success) {
        return textToolError(`Invalid input: ${formatZodIssues(parsed.error)}`);
      }

      try {
        return await applyFocusedDayItemUpsert({
          ctx,
          toolName: 'upsert_transport',
          kind: 'transport',
          dayNumber: parsed.data.day_number,
          item: parsed.data.transport as Record<string, unknown>,
          match: parsed.data.match as Record<string, unknown> | undefined,
          mode: parsed.data.mode,
          position: parsed.data.position,
          rawInput: parsed.data,
        });
      } catch (err) {
        return textToolError(err instanceof Error ? err.message : String(err));
      }
    }
  );

  const deleteTransport = tool(
    'delete_transport',
    DELETE_TRANSPORT_DESCRIPTION,
    DeleteTransportInputShape,
    async (rawArgs) => {
      const parsed = z.object(DeleteTransportInputShape).safeParse(rawArgs);
      if (!parsed.success) {
        return textToolError(`Invalid input: ${formatZodIssues(parsed.error)}`);
      }

      try {
        return await applyFocusedDayItemDelete({
          ctx,
          toolName: 'delete_transport',
          kind: 'transport',
          dayNumber: parsed.data.day_number,
          match: parsed.data.match as Record<string, unknown>,
          rawInput: parsed.data,
        });
      } catch (err) {
        return textToolError(err instanceof Error ? err.message : String(err));
      }
    }
  );

  const researchPolicy = tool(
    'research_place_policy',
    RESEARCH_PLACE_POLICY_DESCRIPTION,
    ResearchPlacePolicyInputShape,
    async (rawArgs) => jsonToolResponse(await researchPlacePolicy(rawArgs))
  );

  const updateAccommodationReviewCandidate = tool(
    'update_accommodation_candidate',
    UPDATE_ACCOMMODATION_CANDIDATE_DESCRIPTION,
    UpdateAccommodationCandidateInputShape,
    async (rawArgs) => {
      const parsed = z.object(UpdateAccommodationCandidateInputShape).safeParse(rawArgs);
      if (!parsed.success) {
        return textToolError(`Invalid input: ${formatZodIssues(parsed.error)}`);
      }

      try {
        const trip = await readTripData(ctx);
        const before = await loadOrCreateAccommodationReview(ctx, trip);
        const next = updateAccommodationCandidate(
          before,
          parsed.data.candidate_id,
          parsed.data.candidate_patch as Partial<AccommodationCandidate>,
          'agent',
          parsed.data.message
        );
        await saveAccommodationReview(ctx, next);
        if (ctx.onUpdateApplied) {
          try {
            await ctx.onUpdateApplied({
              tool: 'update_accommodation_candidate',
              input: parsed.data,
            });
          } catch {
            // Telemetry errors must not fail the tool call.
          }
        }
        return jsonToolResponse({
          ok: true,
          candidate_id: parsed.data.candidate_id,
          updated_keys: Object.keys(parsed.data.candidate_patch),
          review: summarizeAccommodationReview(next),
        });
      } catch (err) {
        return textToolError(err instanceof Error ? err.message : String(err));
      }
    }
  );

  const createAccommodationReviewCandidate = tool(
    'create_accommodation_candidate',
    CREATE_ACCOMMODATION_CANDIDATE_DESCRIPTION,
    CreateAccommodationCandidateInputShape,
    async (rawArgs) => {
      const parsed = z.object(CreateAccommodationCandidateInputShape).safeParse(rawArgs);
      if (!parsed.success) {
        return textToolError(`Invalid input: ${formatZodIssues(parsed.error)}`);
      }

      try {
        const trip = await readTripData(ctx);
        const before = await loadOrCreateAccommodationReview(ctx, trip);
        const next = addAccommodationCandidate(
          before,
          parsed.data.candidate as Omit<AccommodationCandidate, 'id'>,
          'agent',
          parsed.data.message,
          parsed.data.destination
        );
        await saveAccommodationReview(ctx, next);
        if (ctx.onUpdateApplied) {
          try {
            await ctx.onUpdateApplied({
              tool: 'create_accommodation_candidate',
              input: parsed.data,
            });
          } catch {
            // Telemetry errors must not fail the tool call.
          }
        }
        return jsonToolResponse({
          ok: true,
          candidate: next.accommodations.at(-1),
          review: summarizeAccommodationReview(next),
        });
      } catch (err) {
        return textToolError(err instanceof Error ? err.message : String(err));
      }
    }
  );

  const moveAccommodationReviewCandidate = tool(
    'move_accommodation_candidate',
    MOVE_ACCOMMODATION_CANDIDATE_DESCRIPTION,
    MoveAccommodationCandidateInputShape,
    async (rawArgs) => {
      const parsed = z.object(MoveAccommodationCandidateInputShape).safeParse(rawArgs);
      if (!parsed.success) {
        return textToolError(`Invalid input: ${formatZodIssues(parsed.error)}`);
      }

      try {
        const beforeTrip = await readTripData(ctx);
        const beforeReview = await loadOrCreateAccommodationReview(ctx, beforeTrip);
        const nextReview = moveAccommodationCandidate(
          beforeReview,
          parsed.data.candidate_id,
          parsed.data.lane as AccommodationReviewLane,
          'agent',
          parsed.data.booking as AccommodationCandidateBooking | undefined,
          parsed.data.message
        );
        let afterTrip: TripData | undefined;
        if (parsed.data.lane === 'booked') {
          afterTrip = promoteCandidateToTrip(
            beforeTrip,
            nextReview,
            parsed.data.candidate_id,
            parsed.data.booking as AccommodationCandidateBooking | undefined
          );
          await enrichTripPlaces(afterTrip);
          const writeTrip = await ctx.supabase
            .from('trips')
            .update({ data: afterTrip, updated_at: new Date().toISOString() })
            .eq('id', ctx.tripId);
          if (writeTrip.error) {
            return textToolError(`Error writing trip: ${writeTrip.error.message}`);
          }
        }
        await saveAccommodationReview(ctx, nextReview);
        const accommodationReviewSync = afterTrip
          ? await trySyncAccommodationReviewForTrip(ctx.supabase, ctx.tripId, afterTrip)
          : 'not_needed';
        if (ctx.onUpdateApplied) {
          try {
            await ctx.onUpdateApplied({
              tool: 'move_accommodation_candidate',
              before: beforeTrip,
              after: afterTrip,
              input: parsed.data,
            });
          } catch {
            // Telemetry errors must not fail the tool call.
          }
        }
        return jsonToolResponse({
          ok: true,
          candidate_id: parsed.data.candidate_id,
          lane: parsed.data.lane,
          promoted_to_trip: parsed.data.lane === 'booked',
          cascade_review: afterTrip
            ? buildAccommodationCascadeReview(beforeTrip, afterTrip)
            : null,
          accommodation_review_sync: accommodationReviewSync,
          review: summarizeAccommodationReview(nextReview),
        });
      } catch (err) {
        return textToolError(err instanceof Error ? err.message : String(err));
      }
    }
  );

  const promoteAccommodationReviewCandidate = tool(
    'promote_accommodation_candidate',
    PROMOTE_ACCOMMODATION_CANDIDATE_DESCRIPTION,
    PromoteAccommodationCandidateInputShape,
    async (rawArgs) => {
      const parsed = z.object(PromoteAccommodationCandidateInputShape).safeParse(rawArgs);
      if (!parsed.success) {
        return textToolError(`Invalid input: ${formatZodIssues(parsed.error)}`);
      }

      try {
        const beforeTrip = await readTripData(ctx);
        const beforeReview = await loadOrCreateAccommodationReview(ctx, beforeTrip);
        const nextReview = moveAccommodationCandidate(
          beforeReview,
          parsed.data.candidate_id,
          'booked',
          'agent',
          parsed.data.booking as AccommodationCandidateBooking | undefined,
          parsed.data.message ?? 'Promoted into the itinerary by the trip agent.'
        );
        const afterTrip = promoteCandidateToTrip(
          beforeTrip,
          nextReview,
          parsed.data.candidate_id,
          parsed.data.booking as AccommodationCandidateBooking | undefined
        );
        await enrichTripPlaces(afterTrip);
        const writeTrip = await ctx.supabase
          .from('trips')
          .update({ data: afterTrip, updated_at: new Date().toISOString() })
          .eq('id', ctx.tripId);
        if (writeTrip.error) {
          return textToolError(`Error writing trip: ${writeTrip.error.message}`);
        }
        await saveAccommodationReview(ctx, nextReview);
        const accommodationReviewSync = await trySyncAccommodationReviewForTrip(
          ctx.supabase,
          ctx.tripId,
          afterTrip
        );
        if (ctx.onUpdateApplied) {
          try {
            await ctx.onUpdateApplied({
              tool: 'promote_accommodation_candidate',
              before: beforeTrip,
              after: afterTrip,
              input: parsed.data,
            });
          } catch {
            // Telemetry errors must not fail the tool call.
          }
        }
        return jsonToolResponse({
          ok: true,
          candidate_id: parsed.data.candidate_id,
          promoted_to_trip: true,
          cascade_review: buildAccommodationCascadeReview(beforeTrip, afterTrip),
          accommodation_review_sync: accommodationReviewSync,
          review: summarizeAccommodationReview(nextReview),
        });
      } catch (err) {
        return textToolError(err instanceof Error ? err.message : String(err));
      }
    }
  );

  const replaceBookedAccommodationReviewCandidate = tool(
    'replace_booked_accommodation_candidate',
    REPLACE_BOOKED_ACCOMMODATION_CANDIDATE_DESCRIPTION,
    ReplaceBookedAccommodationCandidateInputShape,
    async (rawArgs) => {
      const parsed = z.object(ReplaceBookedAccommodationCandidateInputShape).safeParse(rawArgs);
      if (!parsed.success) {
        return textToolError(`Invalid input: ${formatZodIssues(parsed.error)}`);
      }

      try {
        const beforeTrip = await readTripData(ctx);
        const beforeReview = await loadOrCreateAccommodationReview(ctx, beforeTrip);
        let nextReview = replaceBookedAccommodationCandidate(
          beforeReview,
          parsed.data.candidate_id,
          'agent',
          parsed.data.booking as AccommodationCandidateBooking | undefined,
          parsed.data.message
        );
        const afterTrip = promoteCandidateToTrip(
          beforeTrip,
          nextReview,
          parsed.data.candidate_id,
          parsed.data.booking as AccommodationCandidateBooking | undefined
        );
        await enrichTripPlaces(afterTrip);
        await writeTripData(ctx, afterTrip);
        await saveAccommodationReview(ctx, nextReview);
        nextReview = await syncAccommodationReviewForTrip(ctx.supabase, ctx.tripId, afterTrip);

        if (ctx.onUpdateApplied) {
          try {
            await ctx.onUpdateApplied({
              tool: 'replace_booked_accommodation_candidate',
              before: beforeTrip,
              after: afterTrip,
              input: parsed.data,
            });
          } catch {
            // Telemetry errors must not fail the tool call.
          }
        }

        return jsonToolResponse({
          ok: true,
          candidate_id: parsed.data.candidate_id,
          promoted_to_trip: true,
          cascade_review: buildAccommodationCascadeReview(beforeTrip, afterTrip),
          accommodation_review_sync: 'synced',
          review: summarizeAccommodationReview(nextReview),
        });
      } catch (err) {
        return textToolError(err instanceof Error ? err.message : String(err));
      }
    }
  );

  return createSdkMcpServer({
    name: 'trip_editor',
    version: '0.1.0',
    tools: [
      getTrip,
      getLogisticsAudit,
      getDateLedger,
      listAccommodations,
      listAccommodationReview,
      getImageStatus,
      searchTripImagesTool,
      setTripImage,
      completeMissingImages,
      getTripImagePrompts,
      saveTripImageAsset,
      upsertAccommodation,
      deleteAccommodation,
      replaceAccommodation,
      replaceDaySection,
      replaceDay,
      deleteDay,
      truncateDaysAfter,
      syncMarkdownSource,
      updateFromMarkdown,
      updateTrip,
      updateAccommodation,
      updateAccommodationDetail,
      upsertActivity,
      deleteActivity,
      upsertMeal,
      deleteMeal,
      upsertTransport,
      deleteTransport,
      researchPolicy,
      createAccommodationReviewCandidate,
      updateAccommodationReviewCandidate,
      moveAccommodationReviewCandidate,
      promoteAccommodationReviewCandidate,
      replaceBookedAccommodationReviewCandidate,
      ...createBookingTools(),
    ],
  });
}

export { TRIP_EDITOR_TOOL_NAMES };

export const _internal = {
  applyAccommodationPatch,
  applyAccommodationDetailPatch,
  buildAccommodationCascadeReview,
  buildPolicySearchQuery,
  collectAccommodations,
  CompleteMissingImagesInputShape,
  CreateAccommodationCandidateInputShape,
  DeleteAccommodationInputShape,
  extractPolicySnippets,
  inferPolicyFromText,
  mergeTrip,
  DeleteActivityInputShape,
  DeleteDayInputShape,
  DeleteMealInputShape,
  DeleteTransportInputShape,
  ReplaceAccommodationInputShape,
  ReplaceBookedAccommodationCandidateInputShape,
  ReplaceDayInputShape,
  ReplaceDaySectionInputShape,
  SaveTripImageAssetInputShape,
  SearchTripImagesInputShape,
  SetTripImageInputShape,
  SyncMarkdownSourceInputShape,
  TruncateDaysAfterInputShape,
  UpdateAccommodationCandidateInputShape,
  UpdateFromMarkdownInputShape,
  UpsertActivityInputShape,
  UpsertAccommodationInputShape,
  upsertAccommodationAgentNote,
  upsertDayItemAgentNote,
  UpsertMealInputShape,
  UpsertTransportInputShape,
};

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
  updateAccommodationCandidate,
} from '@/lib/accommodation-review';
import {
  syncAccommodationReviewForTrip,
  trySyncAccommodationReviewForTrip,
} from '@/lib/accommodation-review-store';
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
  UpdateTripInputShape,
  UpdateTripInputSchema,
} from './schema';
import { createBookingTools, BOOKING_TOOL_NAMES } from './booking-tools';

export interface TripToolContext {
  tripId: string;
  supabase: SupabaseClient;
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

const ACCOMMODATION_PATH_RE = /^days\[(\d+)\]\.accommodation$/;
const AGENT_NOTES_START = '<!-- OURTRIPS_AGENT_NOTES_START -->';
const AGENT_NOTES_END = '<!-- OURTRIPS_AGENT_NOTES_END -->';

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
detail field changes because update_trip has to replace the full days array.

If the trip has markdown_source, this tool also maintains a small deterministic
"OurTrips agent notes" section in that markdown so external agents like Claude
Co-work can continue from the same hotel-policy context. It preserves the
original markdown and only adds/replaces the matching hotel note.`;

const UPDATE_ACCOMMODATION_DESCRIPTION = `Patch top-level fields for one accommodation without loading or replacing the full trip.

Use the path returned by list_accommodations, for example
"days[3].accommodation". This updates small visible stay-card fields such as
name, price, rating, status, nights, and note while preserving the detail
object and every other trip field.

Use this when the user asks to rename a hotel/stay or fix visible
accommodation card text on a long trip. For repeated nights of the same stay,
set match to "same_current_name" so the same patch applies to every day whose
current accommodation name matches the path's accommodation name. This avoids
the large update_trip days-array replacement that can exceed context limits.

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

Use this for changing candidate facts in the Accommodations Reviewer: price, direct link,
ratings, dog/parking/terms notes, blockers, action, feedbackLoop, or lane. This
does not edit the public itinerary unless the candidate is moved to booked with
move_accommodation_candidate or promote_accommodation_candidate.`;

const CREATE_ACCOMMODATION_CANDIDATE_DESCRIPTION = `Create one private accommodation-review proposal card.

Use this after researching or choosing a hotel/stay candidate that should enter
the review board. New candidates should usually start in proposed unless the
user explicitly says they are already booked. Include direct
site links, platform prices, ratings, terms, dog/parking notes, and blockers
when known.`;

const MOVE_ACCOMMODATION_CANDIDATE_DESCRIPTION = `Move one accommodation-review candidate between review states.

Primary states are:
- proposed: Agent Proposals
- booked: committed stay

Legacy states are still accepted for older data:
- considering: under consideration
- dismissed: rejected but retained for memory

When a candidate is moved to booked, this tool also promotes the clean stay
into the trip's day accommodation cards and records a reviewer event, so future
agent turns know the hotel has been booked.`;

const PROMOTE_ACCOMMODATION_CANDIDATE_DESCRIPTION = `Mark an accommodation-review candidate as booked and promote it into the itinerary.

Use when the user says a hotel is booked, confirms a booking, or asks you to
make a selected candidate the stay for that destination. This updates both the
private Accommodations Reviewer and the public trip accommodation cards for the matching
destination days.`;

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
    nights: z.number().optional(),
    note: z.string().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
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
  Pick<Accommodation, 'name' | 'price' | 'rating' | 'status' | 'nights' | 'note'>
>;

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
    links: z.array(z.object({ label: z.string(), url: z.string() })).optional(),
    ratings: z.array(z.record(z.string(), z.string().optional())).optional(),
    rateCheck: z.record(z.string(), z.unknown()).optional(),
    feedbackLoop: z.record(z.string(), z.unknown()).optional(),
    dayNumbers: z.array(z.number()).optional(),
    checkInDate: z.string().optional(),
    checkOutDate: z.string().optional(),
    address: z.string().optional(),
    booking: AccommodationCandidateBookingSchema.optional(),
    createdBy: z.enum(['agent', 'user', 'import', 'system']).optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'Provide at least one candidate field to patch.',
  });

const AccommodationReviewDestinationSchema = z
  .object({
    id: z.string().min(1),
    title: z.string().min(1),
    dates: z.string().optional(),
    nights: z.number().optional(),
    dayNumbers: z.array(z.number()).optional(),
    startDate: z.string().optional(),
    endDate: z.string().optional(),
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
      links: z.array(z.object({ label: z.string(), url: z.string() })).optional(),
      ratings: z.array(z.record(z.string(), z.string().optional())).optional(),
      rateCheck: z.record(z.string(), z.unknown()).optional(),
      feedbackLoop: z.record(z.string(), z.unknown()).optional(),
      dayNumbers: z.array(z.number()).optional(),
      checkInDate: z.string().optional(),
      checkOutDate: z.string().optional(),
      address: z.string().optional(),
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

const GET_TRIP_DESCRIPTION = `Read the full current state of the trip the user is editing.

Use this when the edit needs fields outside the narrow list tools, or when you
must update markdown_source alongside structural changes. Avoid it for
accommodation-only questions or edits on long trips; list_accommodations plus
update_accommodation/update_accommodation_detail can handle those without
loading the full itinerary.

Returns the full TripData JSON: { trip: {...meta...}, days: [...day objects...] }.

No arguments. The trip_id is pinned by the server to the trip the user is
viewing — you cannot request a different trip.`;

const UPDATE_TRIP_DESCRIPTION = `Apply an edit to the current trip. The trip_id is pinned server-side.

## Semantics: JSON Merge Patch with array-level replacement

You pass any combination of:

  - \`trip\`: a PARTIAL object that is deep-merged into the existing \`data.trip\`.
    Only the keys you include are updated; everything else is preserved. Use
    this for copy edits (summary, subtitle), metadata tweaks (dates,
    travelers), or adding/editing nested non-array fields.

  - \`days\`: if provided, REPLACES \`data.days\` wholesale. Arrays can't be
    partial-patched cleanly, so touching days means sending the complete
    ordered array of every day. If you need to change one day, re-read the
    trip with get_trip first and resend all days with that one modified.

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
  - When adding blocks, meals, transport, tips, or stats to a day: fetch the
    day, append to the array, send the full \`days\` array back.
  - Free-form fields like \`time_label\` on a block accept "Morning",
    "14:00 – 16:30", "Late afternoon" — stay consistent with what's already
    in the trip.

## Editorial tone (this product is OurTrips — editorial travel, not a booking system)

  - \`trip.summary\` and day \`description\`: confident, specific, slightly
    literary. Not "Enjoy Seoul" — "Seoul wakes up slowly on a Wednesday; start
    at Gwangjang Market."
  - \`trip.subtitle\` and day \`subtitle\`: under ~60 chars, concrete, a single
    image or idea. Not a sentence.
  - \`tips\` are voice-y, first-person-adjacent when appropriate. The product
    sounds like a travel writer, not a chatbot.

## Rich detail cards

The visible day view should stay scannable, but named places should have
editorial depth behind them. When adding or rewriting a major sight, hike,
museum, beach, village, hotel, or restaurant:

  - Add a structured \`detail\` object rather than stuffing long copy into
    \`content\` or \`note\`.
  - Programme blocks can carry \`detail\` with \`title\`, \`body\`, \`why\`,
    \`highlights\`, \`what_to_see\`, \`how_to_do_it\`, and \`practical\`.
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
agent like Claude CoWork (which saves the trip via the OurTrips skill). To
keep both surfaces in sync the trip body carries an optional
\`markdown_source\` field — the long-form markdown the user authored or the
external agent generated.

Rules when editing a trip:

  1. Call get_trip first. The returned JSON includes \`markdown_source\` if
     present. Read it.
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
  input: {
    trip?: Partial<TripData['trip']>;
    days?: TripData['days'];
    markdown_source?: string;
  }
): TripData {
  const next: TripData = {
    trip: input.trip
      ? ({ ...existing.trip, ...input.trip } as TripData['trip'])
      : existing.trip,
    days: input.days !== undefined ? input.days : existing.days,
  };
  // markdown_source: undefined = keep existing, '' = clear, otherwise replace.
  if (input.markdown_source === undefined) {
    if (existing.markdown_source) next.markdown_source = existing.markdown_source;
  } else if (input.markdown_source.length > 0) {
    next.markdown_source = input.markdown_source;
  }
  return next;
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

async function readTripData(ctx: TripToolContext): Promise<TripData> {
  const { data, error } = await ctx.supabase
    .from('trips')
    .select('data')
    .eq('id', ctx.tripId)
    .single();

  if (error || !data) {
    throw new Error(`Error reading trip: ${error?.message ?? 'not found'}`);
  }

  return data.data as TripData;
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
    markdownSourceUpdated: next.markdown_source !== existing.markdown_source,
  };
}

export function applyAccommodationPatch(
  existing: TripData,
  path: string,
  accommodationPatch: Partial<Pick<Accommodation, 'name' | 'price' | 'rating' | 'status' | 'nights' | 'note'>>,
  match: 'path_only' | 'same_current_name' = 'path_only'
):
  | {
      ok: true;
      next: TripData;
      dayNumbers: number[];
      previousName: string;
      name: string;
      updatedCount: number;
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
      ...accommodationPatch,
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
          accommodationPatch,
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
    name: accommodationPatch.name ?? previousName,
    updatedCount: updatedDayNumbers.length,
    markdownSourceUpdated: next.markdown_source !== existing.markdown_source,
  };
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
    async () => {
      const { data, error } = await ctx.supabase
        .from('trips')
        .select('data')
        .eq('id', ctx.tripId)
        .single();

      if (error || !data) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `Error reading trip: ${error?.message ?? 'not found'}`,
            },
          ],
          isError: true,
        };
      }

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(data.data, null, 2),
          },
        ],
      };
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

      const trip = data.data as TripData;
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
              text: `Invalid input: ${parsed.error.issues
                .map((i) => `${i.path.join('.')}: ${i.message}`)
                .join('; ')}`,
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

      const before = read.data.data as TripData;
      const after = mergeTrip(before, input);

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

      return {
        content: [
          {
            type: 'text' as const,
            text: `Applied edit. Updated: ${touched.join(', ')}. Accommodation review sync: ${accommodationReviewSync}. Call get_trip if you need the new state.`,
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
        return textToolError(
          `Invalid input: ${parsed.error.issues
            .map((i) => `${i.path.join('.')}: ${i.message}`)
            .join('; ')}`
        );
      }

      const read = await ctx.supabase
        .from('trips')
        .select('data')
        .eq('id', ctx.tripId)
        .single();

      if (read.error || !read.data) {
        return textToolError(`Error reading trip for update: ${read.error?.message ?? 'not found'}`);
      }

      const before = read.data.data as TripData;
      const result = applyAccommodationPatch(
        before,
        parsed.data.path,
        parsed.data.accommodation_patch,
        parsed.data.match
      );
      if (!result.ok) {
        return textToolError(result.error);
      }

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
        return textToolError(
          `Invalid input: ${parsed.error.issues
            .map((i) => `${i.path.join('.')}: ${i.message}`)
            .join('; ')}`
        );
      }

      const read = await ctx.supabase
        .from('trips')
        .select('data')
        .eq('id', ctx.tripId)
        .single();

      if (read.error || !read.data) {
        return textToolError(`Error reading trip for update: ${read.error?.message ?? 'not found'}`);
      }

      const before = read.data.data as TripData;
      const result = applyAccommodationDetailPatch(
        before,
        parsed.data.path,
        parsed.data.detail_patch as Partial<AccommodationDetail>
      );
      if (!result.ok) {
        return textToolError(result.error);
      }

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
        markdown_source_updated: result.markdownSourceUpdated,
        accommodation_review_sync: accommodationReviewSync,
      });
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
        return textToolError(
          `Invalid input: ${parsed.error.issues
            .map((i) => `${i.path.join('.')}: ${i.message}`)
            .join('; ')}`
        );
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
        return textToolError(
          `Invalid input: ${parsed.error.issues
            .map((i) => `${i.path.join('.')}: ${i.message}`)
            .join('; ')}`
        );
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
        return textToolError(
          `Invalid input: ${parsed.error.issues
            .map((i) => `${i.path.join('.')}: ${i.message}`)
            .join('; ')}`
        );
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
        return textToolError(
          `Invalid input: ${parsed.error.issues
            .map((i) => `${i.path.join('.')}: ${i.message}`)
            .join('; ')}`
        );
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
          accommodation_review_sync: accommodationReviewSync,
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
      listAccommodations,
      listAccommodationReview,
      updateTrip,
      updateAccommodation,
      updateAccommodationDetail,
      researchPolicy,
      createAccommodationReviewCandidate,
      updateAccommodationReviewCandidate,
      moveAccommodationReviewCandidate,
      promoteAccommodationReviewCandidate,
      ...createBookingTools(),
    ],
  });
}

/**
 * Tool names the agent is allowed to use, in the SDK's MCP-qualified form.
 * The server name above (`trip_editor`) must match the prefix.
 */
export const TRIP_EDITOR_TOOL_NAMES = [
  'mcp__trip_editor__get_trip',
  'mcp__trip_editor__list_accommodations',
  'mcp__trip_editor__list_accommodation_review',
  'mcp__trip_editor__update_trip',
  'mcp__trip_editor__update_accommodation',
  'mcp__trip_editor__update_accommodation_detail',
  'mcp__trip_editor__research_place_policy',
  'mcp__trip_editor__create_accommodation_candidate',
  'mcp__trip_editor__update_accommodation_candidate',
  'mcp__trip_editor__move_accommodation_candidate',
  'mcp__trip_editor__promote_accommodation_candidate',
  ...BOOKING_TOOL_NAMES,
] as const;

export const _internal = {
  applyAccommodationPatch,
  applyAccommodationDetailPatch,
  buildPolicySearchQuery,
  collectAccommodations,
  extractPolicySnippets,
  inferPolicyFromText,
  upsertAccommodationAgentNote,
};

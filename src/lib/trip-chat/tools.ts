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
import type { AccommodationDetail, TripData } from '@/lib/types';
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
    before: TripData;
    after: TripData;
    input: unknown;
  }) => void | Promise<void>;
}

const TOOL_JSON_INDENT = 2;
const POLICY_FETCH_TIMEOUT_MS = 8000;
const POLICY_TEXT_LIMIT = 200_000;
const POLICY_CANDIDATE_LIMIT = 5;

const ACCOMMODATION_PATH_RE = /^days\[(\d+)\]\.accommodation$/;

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

If the trip has markdown_source and the user's request explicitly requires the
source markdown to be changed too, use update_trip instead so the markdown can
move in the same write. For factual enrichment of structured hotel detail
cards, this narrow tool is preferred.`;

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

const GET_TRIP_DESCRIPTION = `Read the current state of the trip the user is editing.

Call this at the START of each turn. The trip can change between turns (another
edit may have landed) and — more importantly — after you call update_trip,
because your last view of it is stale. Your conversation history from prior
turns is replayed, so you have a record of past edits, but re-read if you're
about to touch fields you haven't verified this turn.

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
): { ok: true; next: TripData; dayNumber: number; name: string } | { ok: false; error: string } {
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

  return {
    ok: true,
    next: { ...existing, days: nextDays },
    dayNumber: day.day_number,
    name: day.accommodation.name,
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
            text: `Applied edit. Updated: ${touched.join(', ')}. Call get_trip if you need the new state.`,
          },
        ],
      };
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
      });
    }
  );

  const researchPolicy = tool(
    'research_place_policy',
    RESEARCH_PLACE_POLICY_DESCRIPTION,
    ResearchPlacePolicyInputShape,
    async (rawArgs) => jsonToolResponse(await researchPlacePolicy(rawArgs))
  );

  return createSdkMcpServer({
    name: 'trip_editor',
    version: '0.1.0',
    tools: [
      getTrip,
      listAccommodations,
      updateTrip,
      updateAccommodationDetail,
      researchPolicy,
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
  'mcp__trip_editor__update_trip',
  'mcp__trip_editor__update_accommodation_detail',
  'mcp__trip_editor__research_place_policy',
  ...BOOKING_TOOL_NAMES,
] as const;

export const _internal = {
  applyAccommodationDetailPatch,
  buildPolicySearchQuery,
  collectAccommodations,
  extractPolicySnippets,
  inferPolicyFromText,
};

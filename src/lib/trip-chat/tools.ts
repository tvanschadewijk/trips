/**
 * In-process MCP tools for the trip chat agent.
 *
 * The agent has exactly two tool affordances: `get_trip` (read) and
 * `update_trip` (merge-patch write). Both close over a pinned `tripId` and a
 * service-role Supabase client provided by the API route — the agent never
 * gets ambient DB access and physically cannot address a different trip row.
 *
 * Tool description strings are the primary teaching surface for the agent
 * (we ship no SKILL.md and a minimal system prompt). Invest accordingly.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import type { McpSdkServerConfigWithInstance } from '@anthropic-ai/claude-agent-sdk';
import type { TripData } from '@/lib/types';
import {
  GetTripInputShape,
  UpdateTripInputShape,
  UpdateTripInputSchema,
} from './schema';

export interface TripToolContext {
  tripId: string;
  supabase: SupabaseClient;
  /** Called with the computed patch after a successful update, for diff logging. */
  onUpdateApplied?: (applied: {
    before: TripData;
    after: TripData;
    input: unknown;
  }) => void | Promise<void>;
}

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

You pass one or both of:

  - \`trip\`: a PARTIAL object that is deep-merged into the existing \`data.trip\`.
    Only the keys you include are updated; everything else is preserved. Use
    this for copy edits (summary, subtitle), metadata tweaks (dates,
    travelers), or adding/editing nested non-array fields.

  - \`days\`: if provided, REPLACES \`data.days\` wholesale. Arrays can't be
    partial-patched cleanly, so touching days means sending the complete
    ordered array of every day. If you need to change one day, re-read the
    trip with get_trip first and resend all days with that one modified.

Both fields are optional individually, but you must provide at least one. Do
not send an empty object.

## Invariants the server enforces

  - Day ordering is significant — days are rendered in array order. \`day_number\`
    typically mirrors position (1-indexed). Keep them consistent.
  - Dates are ISO 8601 (YYYY-MM-DD). \`data.trip.dates.start\` and \`.end\` must
    frame the date range covered by \`data.days\`.
  - Immutable fields — \`id\`, \`user_id\`, \`share_id\`, \`created_at\`,
    \`updated_at\`, the DB row's \`name\` and \`is_public\` columns — are not in
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

## Output

Returns a brief confirmation of which top-level keys were updated. Does NOT
return the full updated trip — call get_trip if you need to read the new
state before continuing.`;

function mergeTrip(existing: TripData, input: { trip?: Partial<TripData['trip']>; days?: TripData['days'] }): TripData {
  const next: TripData = {
    trip: input.trip
      ? ({ ...existing.trip, ...input.trip } as TripData['trip'])
      : existing.trip,
    days: input.days !== undefined ? input.days : existing.days,
  };
  return next;
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
          await ctx.onUpdateApplied({ before, after, input });
        } catch {
          // Telemetry errors must not fail the tool call.
        }
      }

      const touched = [
        input.trip !== undefined ? 'trip' : null,
        input.days !== undefined ? 'days' : null,
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

  return createSdkMcpServer({
    name: 'trip_editor',
    version: '0.1.0',
    tools: [getTrip, updateTrip],
  });
}

/**
 * Tool names the agent is allowed to use, in the SDK's MCP-qualified form.
 * The server name above (`trip_editor`) must match the prefix.
 */
export const TRIP_EDITOR_TOOL_NAMES = [
  'mcp__trip_editor__get_trip',
  'mcp__trip_editor__update_trip',
] as const;

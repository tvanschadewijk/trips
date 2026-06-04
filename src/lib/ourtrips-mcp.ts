import { McpServer } from '@modelcontextprotocol/sdk/server/mcp';
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types';
import { z } from 'zod';
import { createAdminClient } from '@/lib/supabase/admin';
import {
  deleteDayForUser,
  deleteDayItemForUser,
  formatTripForRead,
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

const MCP_INSTRUCTIONS =
  [
    'Use OurTrips to save and edit travel itineraries for the authenticated user. This MCP connector is self-contained; do not rely on any OurTrips or Artrip skill.',
    'Use get_trip_schema or get_trip_template when you need structure. Use get_trip summary/day/days/sections reads first; full reads require allow_large=true because large trips can exceed agent token limits.',
    'Use focused upsert/delete tools for meals, hotels, transport, and activities. For route rewrites, hotel swaps, removed stops, or stale nested fields, use replace_day, replace_day_section, replace_accommodation with mode=replace, delete_day, truncate_days_after, replace_paths, or delete_paths instead of deep merge.',
    'Images are part of the MCP workflow: use search_trip_images and set_trip_image for real Unsplash trip/day hero images, then use get_trip_image_prompts plus save_trip_image_asset for externally generated cover/social assets. Check get_trip_image_status or verify_trip_public_data before saying the trip is done.',
    'Do not ask for an API key; OAuth is already authorized.',
  ].join(' ');

const JsonObjectSchema = z.record(z.string(), z.unknown());
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
  'blocks',
  'transport',
  'accommodation',
  'meals',
  'tips',
  'stats',
  'route_points',
  'services',
  'notes',
]);
const AccommodationScopeSchema = z
  .enum(['day', 'matching_accommodation_name'])
  .optional()
  .describe('Use matching_accommodation_name to update/delete the same hotel across adjacent stay days.');
const SchemaSectionSchema = z
  .enum(['overview', 'trip', 'day', 'activity', 'transport', 'accommodation', 'meal', 'route_points', 'image_assets', 'patching'])
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

const TRIP_SCHEMA_REFERENCE = {
  overview: {
    top_level: {
      trip: 'Trip metadata object. Must include name, subtitle, dates, travelers, summary, and hero_image.',
      days: 'Array of day objects with 1-indexed day_number values.',
      markdown_source: 'Optional verbatim original plan markdown, max 256 KB.',
    },
    rules: [
      'Use get_trip summary/day/days/sections reads before full reads.',
      'Unsplash hero image URLs must come from search_trip_images, then set_trip_image should track the selected download_url.',
      'Generated covers/social images live in trip.image_assets and are saved with save_trip_image_asset after the agent has created and hosted them elsewhere.',
    ],
  },
  trip: {
    required: ['name', 'subtitle', 'dates', 'travelers', 'summary', 'hero_image'],
    optional: ['overview_image', 'image_assets', 'route_points', 'accent_color', 'services', 'notes'],
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
    detail_fields: ['title', 'body', 'why', 'vibe', 'highlights', 'what_to_see', 'how_to_do_it', 'practical', 'booking_note', 'dog_note'],
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
    replace_rule: 'When changing to a different hotel, use replace_accommodation or upsert_accommodation with mode=replace so stale detail fields are removed.',
    detail_fields: ['check_in', 'check_out', 'room_type', 'address', 'phone', 'confirmation', 'booking_platform', 'parking', 'wifi', 'dog_note', 'policy_source_url'],
  },
  meal: {
    section: 'days[].meals[]',
    required: ['type', 'name'],
    detail_fields: ['title', 'body', 'why', 'vibe', 'cuisine', 'price_range', 'reservation', 'what_to_order', 'booking_note', 'address', 'phone', 'hours'],
  },
  route_points: {
    section: 'trip.route_points[]',
    required: ['label', 'lat', 'lng'],
    optional: ['day', 'mode', 'role'],
    roles: ['home', 'stop', 'stay', 'excursion', 'trail', 'return'],
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
          .enum(['new_trip', 'replace_hotel', 'day_range_read', 'day_hero_image', 'generated_cover'])
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

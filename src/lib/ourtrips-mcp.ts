import { McpServer } from '@modelcontextprotocol/sdk/server/mcp';
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types';
import { z } from 'zod';
import { createAdminClient } from '@/lib/supabase/admin';
import {
  getTripForUser,
  listTripsForUser,
  patchTripForUser,
  saveTripForUser,
  TripServiceError,
} from '@/lib/trip-service';

const MCP_INSTRUCTIONS =
  'Use OurTrips to save travel itineraries for the authenticated user. Call save_trip when the user asks to send, save, preview, or publish an itinerary to OurTrips. Use list_trips, get_trip, and patch_trip to find or update existing itineraries. Do not ask for an API key; this remote MCP connection is already authorized with OAuth.';

const JsonObjectSchema = z.record(z.string(), z.unknown());
const TripPayloadSchema = JsonObjectSchema.describe(
  'The trip metadata object. It must include a human-readable name.'
);
const DayPayloadSchema = JsonObjectSchema.describe(
  'A single itinerary day object. Use day_number for patching existing days.'
);

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
        'Read a single saved OurTrips itinerary for the authenticated user.',
      inputSchema: {
        trip_id: z.string().min(1).describe('The OurTrips trip id.'),
      },
      annotations: {
        title: 'Get trip',
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
        return jsonResult({ trip });
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
        'Patch selected metadata, days, or markdown_source on an existing OurTrips itinerary.',
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
      },
      annotations: {
        title: 'Patch trip',
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async ({ trip_id, ...patch }, extra) => {
      try {
        const trip = await patchTripForUser(
          createAdminClient(),
          userIdFromAuth(extra),
          trip_id,
          patch
        );
        return jsonResult({ trip });
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  return server;
}

export const ourTripsMcpInstructions = MCP_INSTRUCTIONS;

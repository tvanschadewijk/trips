import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const BASE_URL =
  process.env.OUR_TRIPS_API_URL?.replace(/\/$/, "") || "https://ourtrips.to";

const KEY_PATHS = [
  join(homedir(), ".our-trips-api-key"),
  join(homedir(), ".trips-api-key"),
];

function loadApiKey(): string | null {
  for (const p of KEY_PATHS) {
    if (existsSync(p)) {
      return readFileSync(p, "utf-8").trim();
    }
  }
  return null;
}

const NO_KEY_ERROR =
  "No API key found. Please authenticate first by using the our-trips skill " +
  '(say "save this to Our Trips" in a conversation) to set up your API key.';

// ---------------------------------------------------------------------------
// HTTP helper
// ---------------------------------------------------------------------------

async function api(
  method: string,
  path: string,
  body?: unknown
): Promise<{ ok: boolean; status: number; data: unknown }> {
  const apiKey = loadApiKey();
  if (!apiKey) {
    return { ok: false, status: 401, data: { error: NO_KEY_ERROR } };
  }

  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

// ---------------------------------------------------------------------------
// State extraction helpers
// ---------------------------------------------------------------------------

interface TripDay {
  day_number: number;
  date: string;
  title: string;
  accommodation?: { name: string; status?: string; [k: string]: unknown } | null;
  transport?: Array<{ mode: string; label: string; status?: string; [k: string]: unknown }>;
  meals?: Array<{ type: string; name: string; status?: string; [k: string]: unknown }>;
  [k: string]: unknown;
}

interface TripData {
  trip: {
    name: string;
    dates?: { start: string; end: string };
    services?: Array<{ type: string; label: string; status?: string; [k: string]: unknown }>;
    [k: string]: unknown;
  };
  days: TripDay[];
}

function extractState(data: TripData) {
  const accommodations: Array<{
    day: number;
    date: string;
    name: string;
    status: string;
  }> = [];
  const transport: Array<{
    day: number;
    date: string;
    mode: string;
    label: string;
    status: string;
  }> = [];
  const meals: Array<{
    day: number;
    date: string;
    type: string;
    name: string;
    status: string;
  }> = [];

  for (const day of data.days ?? []) {
    if (day.accommodation) {
      accommodations.push({
        day: day.day_number,
        date: day.date,
        name: day.accommodation.name,
        status: day.accommodation.status ?? "unspecified",
      });
    }
    for (const t of day.transport ?? []) {
      transport.push({
        day: day.day_number,
        date: day.date,
        mode: t.mode,
        label: t.label,
        status: t.status ?? "unspecified",
      });
    }
    for (const m of day.meals ?? []) {
      meals.push({
        day: day.day_number,
        date: day.date,
        type: m.type,
        name: m.name,
        status: m.status ?? "unspecified",
      });
    }
  }

  const count = (items: Array<{ status: string }>) => ({
    total: items.length,
    booked: items.filter((i) => i.status === "booked").length,
    pending: items.filter((i) => i.status === "pending").length,
    unspecified: items.filter((i) => i.status === "unspecified").length,
  });

  return {
    trip_name: data.trip.name,
    dates: data.trip.dates,
    services: data.trip.services ?? [],
    summary: {
      accommodations: count(accommodations),
      transport: count(transport),
      meals: count(meals),
    },
    accommodations,
    transport,
    meals,
  };
}

// ---------------------------------------------------------------------------
// MCP Server
// ---------------------------------------------------------------------------

const server = new McpServer({
  name: "our-trips",
  version: "1.0.0",
});

// -- list_trips ---------------------------------------------------------------

server.tool(
  "list_trips",
  "List all trips for the authenticated user. Returns trip IDs, names, share URLs, and timestamps.",
  {},
  async () => {
    const { ok, data } = await api("GET", "/api/trips");
    if (!ok) {
      return { content: [{ type: "text", text: JSON.stringify(data) }], isError: true };
    }
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  }
);

// -- get_trip -----------------------------------------------------------------

server.tool(
  "get_trip",
  "Get the full trip data (all days, transport, accommodation, meals, etc.) for a specific trip.",
  { trip_id: z.string().describe("The UUID of the trip to retrieve") },
  async ({ trip_id }) => {
    const { ok, data } = await api("GET", `/api/trips/${trip_id}`);
    if (!ok) {
      return { content: [{ type: "text", text: JSON.stringify(data) }], isError: true };
    }
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  }
);

// -- get_trip_state -----------------------------------------------------------

server.tool(
  "get_trip_state",
  "Get a compact summary of a trip's current state: what's booked, what's pending, " +
    "all accommodations, transport, and meals with their statuses. " +
    "Use this instead of get_trip when you only need to check what has changed.",
  { trip_id: z.string().describe("The UUID of the trip to retrieve state for") },
  async ({ trip_id }) => {
    const { ok, data } = await api("GET", `/api/trips/${trip_id}`);
    if (!ok) {
      return { content: [{ type: "text", text: JSON.stringify(data) }], isError: true };
    }
    const record = data as { data: TripData };
    const state = extractState(record.data);
    return { content: [{ type: "text", text: JSON.stringify(state, null, 2) }] };
  }
);

// -- update_trip --------------------------------------------------------------

server.tool(
  "update_trip",
  "Partially update a trip. Send only the fields that changed. " +
    "Trip metadata fields are merged into the existing trip. " +
    "Days are matched by day_number and deep-merged. " +
    "Omitted days and fields are left untouched.",
  {
    trip_id: z.string().describe("The UUID of the trip to update"),
    changes: z
      .object({
        trip: z
          .record(z.unknown())
          .optional()
          .describe("Partial trip metadata to merge (name, dates, summary, etc.)"),
        days: z
          .array(
            z
              .object({ day_number: z.number() })
              .catchall(z.unknown())
          )
          .optional()
          .describe(
            "Array of partial day objects. Each must have day_number to identify which day to update. " +
              "Only include fields that changed."
          ),
      })
      .describe("The partial changes to apply"),
  },
  async ({ trip_id, changes }) => {
    const { ok, data } = await api("PATCH", `/api/trips/${trip_id}`, changes);
    if (!ok) {
      return { content: [{ type: "text", text: JSON.stringify(data) }], isError: true };
    }
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  }
);

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

const transport = new StdioServerTransport();
await server.connect(transport);

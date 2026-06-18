export const BOOKING_TOOL_NAMES = [
  'mcp__trip_editor__booking_link_restaurant',
  'mcp__trip_editor__booking_link_hotel',
  'mcp__trip_editor__booking_link_flight',
  'mcp__trip_editor__booking_link_activity',
] as const;

/**
 * Tool names the agent is allowed to use, in the SDK's MCP-qualified form.
 * The server name in tools.ts (`trip_editor`) must match the prefix.
 */
export const TRIP_EDITOR_TOOL_NAMES = [
  'mcp__trip_editor__get_trip',
  'mcp__trip_editor__get_logistics_audit',
  'mcp__trip_editor__get_date_ledger',
  'mcp__trip_editor__list_accommodations',
  'mcp__trip_editor__list_accommodation_review',
  'mcp__trip_editor__update_trip',
  'mcp__trip_editor__update_accommodation',
  'mcp__trip_editor__update_accommodation_detail',
  'mcp__trip_editor__upsert_activity',
  'mcp__trip_editor__delete_activity',
  'mcp__trip_editor__upsert_meal',
  'mcp__trip_editor__delete_meal',
  'mcp__trip_editor__upsert_transport',
  'mcp__trip_editor__delete_transport',
  'mcp__trip_editor__research_place_policy',
  'mcp__trip_editor__create_accommodation_candidate',
  'mcp__trip_editor__update_accommodation_candidate',
  'mcp__trip_editor__move_accommodation_candidate',
  'mcp__trip_editor__promote_accommodation_candidate',
  ...BOOKING_TOOL_NAMES,
] as const;

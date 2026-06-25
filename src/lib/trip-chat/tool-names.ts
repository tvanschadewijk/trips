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
  'mcp__trip_editor__get_image_status',
  'mcp__trip_editor__search_trip_images',
  'mcp__trip_editor__set_trip_image',
  'mcp__trip_editor__complete_missing_images',
  'mcp__trip_editor__get_trip_image_prompts',
  'mcp__trip_editor__save_trip_image_asset',
  'mcp__trip_editor__upsert_accommodation',
  'mcp__trip_editor__delete_accommodation',
  'mcp__trip_editor__replace_accommodation',
  'mcp__trip_editor__replace_day_section',
  'mcp__trip_editor__replace_day',
  'mcp__trip_editor__delete_day',
  'mcp__trip_editor__truncate_days_after',
  'mcp__trip_editor__sync_markdown_source',
  'mcp__trip_editor__update_from_markdown',
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
  'mcp__trip_editor__replace_booked_accommodation_candidate',
  ...BOOKING_TOOL_NAMES,
] as const;

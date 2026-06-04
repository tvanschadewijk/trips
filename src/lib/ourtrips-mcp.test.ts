import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ourTripsMcpInstructions } from './ourtrips-mcp';

test('MCP instructions name the save flow without requiring API keys', () => {
  assert.match(ourTripsMcpInstructions, /save_trip/);
  assert.match(ourTripsMcpInstructions, /save_trip_v2/);
  assert.match(ourTripsMcpInstructions, /OAuth/);
  assert.match(ourTripsMcpInstructions, /Do not ask for an API key/);
  assert.match(ourTripsMcpInstructions, /self-contained/);
  assert.match(ourTripsMcpInstructions, /get_trip_schema/);
  assert.match(ourTripsMcpInstructions, /search_trip_images/);
  assert.match(ourTripsMcpInstructions, /get_trip_image_prompts/);
  assert.match(ourTripsMcpInstructions, /save_trip_image_asset/);
  assert.doesNotMatch(ourTripsMcpInstructions, /generate_trip_image_asset/);
  assert.doesNotMatch(ourTripsMcpInstructions, /skill is required/i);
});

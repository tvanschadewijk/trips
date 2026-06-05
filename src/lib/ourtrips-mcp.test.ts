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
  assert.doesNotMatch(ourTripsMcpInstructions, /Artrip/i);
});

test('MCP instructions pin map, meal reservation, and tips contract', () => {
  assert.match(ourTripsMcpInstructions, /Map contract/);
  assert.match(ourTripsMcpInstructions, /every visible named hotel, restaurant, activity site, and route stop/);
  assert.match(ourTripsMcpInstructions, /Restaurant reservations belong in days\[\]\.meals\[\]/);
  assert.match(ourTripsMcpInstructions, /Do not create trip\.services entries for restaurants/);
  assert.match(ourTripsMcpInstructions, /at least one practical, place-specific tip/);
});

test('MCP instructions pin accommodation shortlist contract', () => {
  assert.match(ourTripsMcpInstructions, /Accommodation shortlist contract/);
  assert.match(ourTripsMcpInstructions, /2-4 private accommodation candidates/);
  assert.match(ourTripsMcpInstructions, /usually 3/);
  assert.match(ourTripsMcpInstructions, /create_accommodation_candidate/);
  assert.match(ourTripsMcpInstructions, /exactly one candidate per hotel/);
  assert.match(ourTripsMcpInstructions, /never put hotel shortlists/);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ourTripsMcpInstructions } from './ourtrips-mcp';

test('MCP instructions name the save flow without requiring API keys', () => {
  assert.match(ourTripsMcpInstructions, /save_trip/);
  assert.match(ourTripsMcpInstructions, /OAuth/);
  assert.match(ourTripsMcpInstructions, /Do not ask for an API key/);
  assert.ok(ourTripsMcpInstructions.length <= 512);
});

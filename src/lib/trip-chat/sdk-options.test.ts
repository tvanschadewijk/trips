/**
 * Lock-test the invariants on the chat route's Agent SDK options.
 *
 * These options are load-bearing for safety:
 *
 *   - settingSources === []  —  so the SDK does not auto-load the repo's
 *     CLAUDE.md (which tells Claude Code to "commit and push to main after
 *     every change", among other rules meant for the coding assistant, not
 *     for an agent editing user trip data). Also prevents user-level skills
 *     and project-level .claude/settings.json from leaking in.
 *
 *   - tools is exactly ['AskUserQuestion', 'WebSearch']  —  clarifying
 *     questions and read-only web search. Forbids Bash/Read/Edit/Write/
 *     WebFetch. Trip mutations go through our in-process MCP server.
 *
 *   - permissionMode === 'dontAsk'  —  no one is home to answer a prompt in
 *     a serverless handler; default-deny is the only safe posture.
 *
 * If any of these change, this test fails — and that's the point. Trips'
 * data integrity and the admin's operational expectations both depend on
 * these specific values.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_TRIP_CHAT_MODEL,
  FIXED_SDK_OPTIONS,
  TRIP_CHAT_MODEL_ENV,
  resolveTripChatModel,
} from './sdk-options';

test('FIXED_SDK_OPTIONS.settingSources is an empty array (locks out CLAUDE.md + skills)', () => {
  assert.ok(
    Array.isArray(FIXED_SDK_OPTIONS.settingSources),
    'settingSources must be an array'
  );
  assert.equal(
    FIXED_SDK_OPTIONS.settingSources.length,
    0,
    'settingSources must be empty — adding any scope would load CLAUDE.md or ~/.claude skills into the chat agent'
  );
});

test('FIXED_SDK_OPTIONS.tools is exactly [AskUserQuestion, WebSearch]', () => {
  assert.deepEqual(
    [...FIXED_SDK_OPTIONS.tools].sort(),
    ['AskUserQuestion', 'WebSearch'].sort(),
    'Built-in tools must stay restricted to clarifying questions + read-only web search; mutations go through the MCP server'
  );
});

test('FIXED_SDK_OPTIONS.permissionMode is dontAsk (default-deny in serverless)', () => {
  assert.equal(
    FIXED_SDK_OPTIONS.permissionMode,
    'dontAsk',
    'Permission mode must be dontAsk; there is no human available to answer a prompt in a POST handler'
  );
});

test('resolveTripChatModel defaults to the cheap trip-chat model', () => {
  assert.equal(resolveTripChatModel({}), DEFAULT_TRIP_CHAT_MODEL);
});

test('resolveTripChatModel honors a trimmed TRIP_CHAT_MODEL override', () => {
  assert.equal(
    resolveTripChatModel({ [TRIP_CHAT_MODEL_ENV]: ' claude-sonnet-4-6 ' }),
    'claude-sonnet-4-6'
  );
});

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
 *   - tools === ['AskUserQuestion']  —  the only built-in tool exposed.
 *     Forbids Bash/Read/Edit/Write/WebFetch/WebSearch. Trip edits go through
 *     our in-process MCP server, period.
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
import { FIXED_SDK_OPTIONS } from './sdk-options';

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

test('FIXED_SDK_OPTIONS.tools only exposes AskUserQuestion (no Bash/Read/Edit/Write/WebFetch)', () => {
  assert.deepEqual(
    FIXED_SDK_OPTIONS.tools,
    ['AskUserQuestion'],
    'Built-in tools must stay restricted; trip edits go through the MCP server, not built-ins'
  );
});

test('FIXED_SDK_OPTIONS.permissionMode is dontAsk (default-deny in serverless)', () => {
  assert.equal(
    FIXED_SDK_OPTIONS.permissionMode,
    'dontAsk',
    'Permission mode must be dontAsk; there is no human available to answer a prompt in a POST handler'
  );
});

/**
 * Tests for the trip-chat hooks — specifically the PreToolUse guardrail that
 * double-checks writes against the allowed-key set. This is the second
 * acceptance-criterion test from the brief ("PreToolUse hook rejects an
 * attempted write to owner_id in a test case").
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPreToolUseHook } from './hooks';

// Minimal stub just to give the hook a shape-compatible context. The Supabase
// client isn't exercised in this test — we only care about the permission
// decision, not the side-effect logging.
function stubContext() {
  return {
    supabase: {
      from: () => ({ select: () => ({ limit: async () => ({ data: [], error: null }) }) }),
    } as unknown as Parameters<typeof buildPreToolUseHook>[0]['supabase'],
    sessionRowId: 'stub-session',
    tripId: 'stub-trip',
    userId: 'stub-user',
    turnIndex: 0,
    toolCallCounter: { count: 0 },
  };
}

test('PreToolUse denies update_trip with owner_id in input', async () => {
  const hook = buildPreToolUseHook(stubContext());
  const result = await hook(
    {
      hook_event_name: 'PreToolUse',
      tool_name: 'mcp__trip_editor__update_trip',
      tool_input: { owner_id: 'attacker', trip: { summary: 'looks innocent' } },
      tool_use_id: 'test-123',
      session_id: 'test-session',
      cwd: '/tmp',
      transcript_path: '/tmp/transcript',
    },
    undefined,
    { signal: new AbortController().signal }
  );
  // The hook returns a hookSpecificOutput with permissionDecision: 'deny' on rejection.
  const decision = (result as { hookSpecificOutput?: { permissionDecision?: string } })
    .hookSpecificOutput?.permissionDecision;
  assert.equal(decision, 'deny', 'owner_id write must be denied');
});

test('PreToolUse denies update_trip with arbitrary disallowed key (share_id)', async () => {
  const hook = buildPreToolUseHook(stubContext());
  const result = await hook(
    {
      hook_event_name: 'PreToolUse',
      tool_name: 'mcp__trip_editor__update_trip',
      tool_input: { share_id: 'attack' },
      tool_use_id: 'test-124',
      session_id: 'test-session',
      cwd: '/tmp',
      transcript_path: '/tmp/transcript',
    },
    undefined,
    { signal: new AbortController().signal }
  );
  const decision = (result as { hookSpecificOutput?: { permissionDecision?: string } })
    .hookSpecificOutput?.permissionDecision;
  assert.equal(decision, 'deny');
});

test('PreToolUse permits update_trip with allowed keys (trip + days)', async () => {
  const hook = buildPreToolUseHook(stubContext());
  const result = await hook(
    {
      hook_event_name: 'PreToolUse',
      tool_name: 'mcp__trip_editor__update_trip',
      tool_input: { trip: { summary: 'a lovely edit' }, days: [] },
      tool_use_id: 'test-125',
      session_id: 'test-session',
      cwd: '/tmp',
      transcript_path: '/tmp/transcript',
    },
    undefined,
    { signal: new AbortController().signal }
  );
  // Allowed → hook returns { continue: true } (no permissionDecision override).
  const obj = result as { continue?: boolean; hookSpecificOutput?: unknown };
  assert.equal(obj.continue, true);
  assert.equal(obj.hookSpecificOutput, undefined);
});

test('PreToolUse lets non-trip-editor tools through untouched', async () => {
  const hook = buildPreToolUseHook(stubContext());
  const result = await hook(
    {
      hook_event_name: 'PreToolUse',
      tool_name: 'AskUserQuestion',
      tool_input: { whatever: true },
      tool_use_id: 'test-126',
      session_id: 'test-session',
      cwd: '/tmp',
      transcript_path: '/tmp/transcript',
    },
    undefined,
    { signal: new AbortController().signal }
  );
  const obj = result as { continue?: boolean };
  assert.equal(obj.continue, true);
});

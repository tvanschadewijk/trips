import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyTurnFailure } from './turn-failure';

test('an invalid API key is reported as a config problem, not a connection problem', () => {
  // Exact CLI behavior fingerprinted June 2026: the stream throws
  // "Claude Code returned an error result: Invalid API key · Fix external API key".
  const failure = classifyTurnFailure(
    'Claude Code returned an error result: Invalid API key · Fix external API key'
  );
  assert.equal(failure.kind, 'auth_config');
  assert.match(failure.userMessage, /ANTHROPIC_API_KEY/);
  assert.doesNotMatch(failure.userMessage, /connection problem/i);
});

test('missing credentials classify as auth_config via the CLI text channel', () => {
  // The CLI sometimes reports the cause only as assistant TEXT before the
  // stream throws a generic exit error — both channels must be inspected.
  const failure = classifyTurnFailure(
    'Claude Code process exited with code 1',
    'Not logged in · Please run /login'
  );
  assert.equal(failure.kind, 'auth_config');
});

test('exhausted credits classify as billing', () => {
  const failure = classifyTurnFailure(
    'API error: your credit balance is too low to access the Anthropic API'
  );
  assert.equal(failure.kind, 'billing');
  assert.match(failure.userMessage, /credits/i);
});

test('context overflow suggests starting a new thread', () => {
  const failure = classifyTurnFailure('400 prompt is too long: 215000 tokens');
  assert.equal(failure.kind, 'prompt_too_long');
  assert.match(failure.userMessage, /new chat/i);
});

test('unknown errors keep the original transient copy', () => {
  const failure = classifyTurnFailure('fetch failed: socket hang up');
  assert.equal(failure.kind, 'transient');
  assert.equal(
    failure.userMessage,
    'I hit a connection problem while working on that. Please try again in a moment.'
  );
});

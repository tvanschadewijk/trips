import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSystemPrompt } from './prompt';

test('system prompt tells the agent to read trip context before route answers', () => {
  const prompt = buildSystemPrompt();

  assert.match(prompt, /Never tell the user you cannot access the trip file/);
  assert.match(prompt, /route-comparison questions/);
  assert.match(prompt, /view: "summary"/);
  assert.match(prompt, /Ask a clarifying question only after the trip read/);
});

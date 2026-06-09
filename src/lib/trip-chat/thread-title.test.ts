import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  deriveThreadTitleHeuristic,
  generateThreadTitle,
} from './thread-title';

test('heuristic title prefixes the day the user was viewing', () => {
  assert.equal(
    deriveThreadTitleHeuristic('find us a good restaurant for tonight', {
      slideKind: 'day',
      day_number: 1,
    }),
    'Day 1 · Find us a good restaurant for tonight'
  );
});

test('heuristic title prefixes the accommodation reviewer context', () => {
  const title = deriveThreadTitleHeuristic('compare the two Istanbul options', {
    slideKind: 'accommodation_review',
    destination_title: 'Istanbul',
  });
  assert.ok(title.startsWith('Hotels · '), title);
});

test('heuristic title has no prefix on the trip cover', () => {
  assert.equal(
    deriveThreadTitleHeuristic('what should I pack?', { slideKind: 'cover' }),
    'What should I pack?'
  );
});

test('heuristic title de-shouts ALL-CAPS messages', () => {
  assert.equal(
    deriveThreadTitleHeuristic('WE HAD TO CANCEL THE RESTAURANT. REMOVE THAT'),
    'We had to cancel the restaurant. remove that'
  );
});

test('heuristic title truncates long messages at a word boundary', () => {
  const title = deriveThreadTitleHeuristic(
    'please rebalance the hiking days across the whole second week of the trip and make the drives shorter'
  );
  assert.ok(title.endsWith('…'), title);
  assert.ok(title.length <= 48, `too long: ${title} (${title.length})`);
  assert.ok(!title.includes('  '), title);
});

test('heuristic title falls back when the message is only noise', () => {
  assert.equal(deriveThreadTitleHeuristic('***'), 'New conversation');
});

test('generateThreadTitle returns the heuristic when no API key is set', async () => {
  const title = await generateThreadTitle({
    message: 'swap day 3 and day 4',
    env: {},
    fetchImpl: () => {
      throw new Error('must not be called without a key');
    },
  });
  assert.equal(title, 'Swap day 3 and day 4');
});

test('generateThreadTitle falls back to the heuristic when the API call fails', async () => {
  const title = await generateThreadTitle({
    message: 'swap day 3 and day 4',
    env: { ANTHROPIC_API_KEY: 'sk-ant-test' },
    fetchImpl: async () => {
      throw new Error('network down');
    },
  });
  assert.equal(title, 'Swap day 3 and day 4');
});

test('generateThreadTitle falls back to the heuristic on a non-OK response', async () => {
  const title = await generateThreadTitle({
    message: 'swap day 3 and day 4',
    env: { ANTHROPIC_API_KEY: 'sk-ant-test' },
    fetchImpl: async () =>
      new Response(JSON.stringify({ error: { message: 'invalid x-api-key' } }), {
        status: 401,
      }),
  });
  assert.equal(title, 'Swap day 3 and day 4');
});

test('generateThreadTitle uses and sanitizes the model title on success', async () => {
  const title = await generateThreadTitle({
    message: 'find us a good restaurant for tonight',
    viewContext: { slideKind: 'day', day_number: 1 },
    env: { ANTHROPIC_API_KEY: 'sk-ant-test' },
    fetchImpl: async () =>
      new Response(
        JSON.stringify({
          content: [{ type: 'text', text: '"Day 1 · Dinner restaurant pick."' }],
        }),
        { status: 200 }
      ),
  });
  assert.equal(title, 'Day 1 · Dinner restaurant pick');
});

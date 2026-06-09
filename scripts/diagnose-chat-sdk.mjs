/**
 * Diagnostic: run the Agent SDK the same way /api/trips/[id]/chat does and
 * fingerprint the failure mode. Compares against production signatures:
 *   - Jun 2-4 failures:  11-19 ms, no result message  → spawn-level failure
 *   - Jun 8 failure:     ~2968 ms, result with cost 0 → CLI boots, API call fails
 *
 * Usage: node scripts/diagnose-chat-sdk.mjs <mode>
 *   mode = noauth | badkey | control
 */
import { query } from '@anthropic-ai/claude-agent-sdk';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const mode = process.argv[2] ?? 'noauth';

// Mirror the route's env handling; scrub harness/dev leakage so the test is clean.
const env = { ...process.env };
delete env.ANTHROPIC_BASE_URL;
delete env.ANTHROPIC_AUTH_TOKEN;
delete env.ANTHROPIC_API_KEY;
delete env.CLAUDE_CODE_OAUTH_TOKEN;

if (mode === 'noauth') {
  // Like prod with a missing key: empty config dir, no key.
  env.CLAUDE_CONFIG_DIR = mkdtempSync(join(tmpdir(), 'ourtrips-diag-'));
} else if (mode === 'badkey') {
  // Like prod with a present-but-rejected key (revoked / out of credit behaves similarly at this layer).
  env.CLAUDE_CONFIG_DIR = mkdtempSync(join(tmpdir(), 'ourtrips-diag-'));
  env.ANTHROPIC_API_KEY = 'sk-ant-api03-invalid-key-for-diagnosis-0000000000000000';
} else if (mode === 'control') {
  // User's own local Claude Code auth — proves the code path + binary + model are fine.
}

const options = {
  settingSources: [],
  tools: [],
  permissionMode: 'dontAsk',
  systemPrompt: 'You are a diagnostic echo. Reply with the single word OK.',
  model: 'claude-haiku-4-5-20251001',
  maxTurns: 1,
  env,
  persistSession: false,
  includePartialMessages: false,
};

const t0 = Date.now();
const events = [];
try {
  const stream = query({ prompt: 'Say OK.', options });
  for await (const msg of stream) {
    if (msg.type === 'result') {
      events.push(
        `result subtype=${msg.subtype} cost=${msg.total_cost_usd} dur=${msg.duration_ms} ` +
          `result=${JSON.stringify((msg.result ?? '').slice(0, 200))}`
      );
    } else if (msg.type === 'assistant') {
      const text = msg.message.content
        .filter((c) => c.type === 'text')
        .map((c) => c.text)
        .join('');
      events.push(`assistant text=${JSON.stringify(text.slice(0, 100))}`);
    } else {
      events.push(`msg type=${msg.type}${msg.subtype ? ` subtype=${msg.subtype}` : ''}`);
    }
  }
  console.log(`[${mode}] COMPLETED in ${Date.now() - t0}ms`);
} catch (err) {
  console.log(`[${mode}] THREW after ${Date.now() - t0}ms`);
  console.log(`[${mode}] error: ${err instanceof Error ? err.message : String(err)}`);
}
for (const e of events) console.log(`[${mode}] ${e}`);

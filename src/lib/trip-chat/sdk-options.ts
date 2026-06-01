/**
 * Load-bearing SDK options for the trip-chat route. Extracted into its own
 * module so `route.test.ts` can assert them without pulling in Next.js
 * runtime imports (next/headers etc.) from route.ts.
 *
 * Read route.ts and route.test.ts for the full rationale on each invariant.
 * Short version:
 *
 *   - `settingSources: []` — do not auto-load repo CLAUDE.md or ~/.claude
 *     skills/settings into an agent that should only be editing trip JSON.
 *   - `tools: ['AskUserQuestion', 'WebSearch']` — clarifying questions and
 *     read-only web search. Web search is safe: it cannot mutate anything,
 *     it lets the agent ground answers in fresh data (opening hours,
 *     transit changes, festivals) before proposing edits via the MCP
 *     update_trip tool.
 *   - `permissionMode: 'dontAsk'` — serverless has no human to prompt.
 */
export const FIXED_SDK_OPTIONS = {
  settingSources: [] as never[],
  tools: ['AskUserQuestion', 'WebSearch'],
  permissionMode: 'dontAsk' as const,
} as const;

export const DEFAULT_TRIP_CHAT_MODEL = 'claude-haiku-4-5-20251001';
export const TRIP_CHAT_MODEL_ENV = 'TRIP_CHAT_MODEL';

export function resolveTripChatModel(
  env: Record<string, string | undefined> = process.env
): string {
  return env[TRIP_CHAT_MODEL_ENV]?.trim() || DEFAULT_TRIP_CHAT_MODEL;
}

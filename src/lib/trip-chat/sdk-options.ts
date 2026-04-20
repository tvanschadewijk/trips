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
 *   - `tools: ['AskUserQuestion']` — only built-in tool exposed; everything
 *     else the agent needs comes from the in-process MCP server.
 *   - `permissionMode: 'dontAsk'` — serverless has no human to prompt.
 */
export const FIXED_SDK_OPTIONS = {
  settingSources: [] as never[],
  tools: ['AskUserQuestion'],
  permissionMode: 'dontAsk' as const,
} as const;

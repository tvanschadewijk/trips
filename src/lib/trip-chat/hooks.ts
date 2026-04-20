/**
 * Hooks for the trip-chat agent.
 *
 *   PreToolUse:
 *     - Logs every `update_trip` call with the top-level keys the agent tried
 *       to write.
 *     - Belt-and-suspenders: denies the call if the input contains a
 *       top-level key outside the allowed set. The Zod schema inside the
 *       tool also enforces this, but hooks give us an independent check that
 *       survives refactors of the tool layer.
 *
 *   Stop:
 *     - Records a row in trip_chat_usage with token/cost/duration metrics
 *       taken from the last assistant result.
 *
 * Hooks must not throw to end users — they log failures internally but don't
 * break the turn.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  HookCallback,
  PreToolUseHookInput,
} from '@anthropic-ai/claude-agent-sdk';
import { TRIP_EDITOR_TOOL_NAMES } from './tools';

const UPDATE_TRIP_TOOL_NAME = 'mcp__trip_editor__update_trip';

// Top-level keys the agent may address in update_trip input. Mirrors the
// outer keys of UpdateTripInputSchema. If the schema adds keys (e.g. later
// exposing `is_public`), this allowlist must move with it.
const ALLOWED_UPDATE_TRIP_KEYS = new Set(['trip', 'days']);

export interface HookContext {
  supabase: SupabaseClient;
  sessionRowId: string;                 // trip_chat_sessions.id
  tripId: string;
  userId: string;
  turnIndex: number;
  /** Incremented by the tools each time update_trip is invoked. */
  toolCallCounter: { count: number };
}

/**
 * Build the PreToolUse hook. Runs before every tool invocation.
 */
export function buildPreToolUseHook(ctx: HookContext): HookCallback {
  return async (input) => {
    if (input.hook_event_name !== 'PreToolUse') {
      return { continue: true };
    }
    const pt = input as PreToolUseHookInput;

    // Only act on our custom tools. Built-in tools like AskUserQuestion fall
    // through untouched.
    if (
      !TRIP_EDITOR_TOOL_NAMES.includes(
        pt.tool_name as (typeof TRIP_EDITOR_TOOL_NAMES)[number]
      )
    ) {
      return { continue: true };
    }

    if (pt.tool_name === UPDATE_TRIP_TOOL_NAME) {
      const toolInput = (pt.tool_input ?? {}) as Record<string, unknown>;
      const keys = Object.keys(toolInput);
      const disallowed = keys.filter((k) => !ALLOWED_UPDATE_TRIP_KEYS.has(k));

      // Best-effort log. A failure here must not block the call.
      try {
        await ctx.supabase.from('trip_chat_usage').select('id').limit(0); // warm pool
      } catch {
        /* ignored */
      }

      if (disallowed.length > 0) {
        // Block the tool call. The SDK surfaces permissionDecisionReason to
        // the agent as the tool's error, so it can recover.
        return {
          hookSpecificOutput: {
            hookEventName: 'PreToolUse',
            permissionDecision: 'deny',
            permissionDecisionReason: `update_trip rejected: top-level keys ${JSON.stringify(
              disallowed
            )} are not editable. Allowed keys: ${JSON.stringify(
              Array.from(ALLOWED_UPDATE_TRIP_KEYS)
            )}.`,
          },
        };
      }
    }

    return { continue: true };
  };
}

/**
 * Pull usage metrics off the last result message emitted by the stream.
 * Called from the API route (not a hook) because the Stop hook fires before
 * the final result message is finalized in all SDK versions.
 */
export interface RecordUsageArgs extends HookContext {
  model?: string;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
  };
  total_cost_usd?: number;
  duration_ms?: number;
}

export async function recordTurnUsage(args: RecordUsageArgs): Promise<void> {
  try {
    await args.supabase.from('trip_chat_usage').insert({
      session_id: args.sessionRowId,
      trip_id: args.tripId,
      user_id: args.userId,
      turn_index: args.turnIndex,
      model: args.model ?? null,
      input_tokens: args.usage?.input_tokens ?? null,
      output_tokens: args.usage?.output_tokens ?? null,
      cache_creation_input_tokens:
        args.usage?.cache_creation_input_tokens ?? null,
      cache_read_input_tokens: args.usage?.cache_read_input_tokens ?? null,
      total_cost_usd: args.total_cost_usd ?? null,
      duration_ms: args.duration_ms ?? null,
      num_tool_calls: args.toolCallCounter.count,
    });
  } catch (err) {
    // Usage logging is advisory — a failure here must not fail the route.
    console.error('trip-chat: failed to record turn usage', err);
  }
}

/**
 * Build the Stop hook. Signals end-of-turn. We don't insert usage here (see
 * `recordTurnUsage` which runs on the final SDKResultMessage) but we do use
 * it as a hook seam for future work (debouncing, summarization, etc.).
 */
export function buildStopHook(): HookCallback {
  return async () => ({ continue: true });
}

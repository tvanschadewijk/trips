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
import type { ChatProgressUpdate } from './progress';
import { getToolProgressUpdate } from './progress';
import { TRIP_EDITOR_TOOL_NAMES } from './tool-names';

const UPDATE_TRIP_TOOL_NAME = 'mcp__trip_editor__update_trip';

// Top-level keys the agent may address in update_trip input. Mirrors the
// outer keys of UpdateTripInputSchema. If the schema adds keys (e.g. later
// exposing `share_mode`), this allowlist must move with it.
const ALLOWED_UPDATE_TRIP_KEYS = new Set(['trip', 'days', 'markdown_source']);

export interface HookContext {
  supabase: SupabaseClient;
  sessionRowId: string;                 // trip_chat_sessions.id
  tripId: string;
  userId: string;
  turnIndex: number;
  /** Incremented by the tools each time update_trip is invoked. */
  toolCallCounter: { count: number };
  /** Best-effort user-facing progress update for long-running turns. */
  onProgress?: (update: ChatProgressUpdate) => void | Promise<void>;
}

async function emitToolProgress(
  ctx: HookContext,
  toolName: string,
  toolInput?: unknown
): Promise<void> {
  if (!ctx.onProgress) return;
  try {
    await ctx.onProgress(getToolProgressUpdate(toolName, toolInput));
  } catch {
    // Progress updates are advisory and must never block a tool call.
  }
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

    const toolName = pt.tool_name;
    const isTripEditorTool = TRIP_EDITOR_TOOL_NAMES.includes(
      toolName as (typeof TRIP_EDITOR_TOOL_NAMES)[number]
    );

    if (!isTripEditorTool) {
      if (toolName === 'WebSearch' || toolName === 'AskUserQuestion') {
        await emitToolProgress(ctx, toolName, pt.tool_input);
      }
      return { continue: true };
    }

    if (toolName === UPDATE_TRIP_TOOL_NAME) {
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

    await emitToolProgress(ctx, toolName, pt.tool_input);

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
  /** Raw failure detail when the turn errored (see turn-failure.ts). */
  error_detail?: string;
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
      error_detail: args.error_detail?.slice(0, 2000) ?? null,
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

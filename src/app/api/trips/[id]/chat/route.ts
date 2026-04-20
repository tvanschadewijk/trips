/**
 * POST /api/trips/[id]/chat — admin-only chat turn for a specific trip.
 *
 * Each request is one turn of the Agent SDK. The SDK session is FRESH every
 * time (Vercel ephemeral FS means session resume isn't reliable); prior
 * context is summarized into the prompt string. See src/lib/trip-chat/prompt.ts.
 *
 * Design invariants — do not quietly drop:
 *
 *   - `settingSources: []`  — do not let the SDK auto-load filesystem settings.
 *     The repo root CLAUDE.md contains instructions written for Claude Code
 *     editing the codebase ("commit and push to main after every change");
 *     the chat agent must not inherit them. Locked to empty array and
 *     asserted in a unit test.
 *
 *   - Built-in tools restricted to `AskUserQuestion` only. No Bash, Read,
 *     Edit, Write, WebFetch, WebSearch — the agent edits trips via the
 *     in-process MCP server, nothing else.
 *
 *   - `permissionMode: 'dontAsk'` — deny anything not on the allowlist
 *     without a prompt (there's no human available to respond to a prompt
 *     in a serverless handler).
 *
 *   - `CLAUDE_CONFIG_DIR` pointed at /tmp on Vercel so the SDK's local-disk
 *     writes land on a writable tmpfs within the invocation lifetime.
 */
import { NextRequest, NextResponse } from 'next/server';
import { query } from '@anthropic-ai/claude-agent-sdk';
import type { Options } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';

import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import {
  createTripEditorMcpServer,
  TRIP_EDITOR_TOOL_NAMES,
} from '@/lib/trip-chat/tools';
import {
  buildSystemPrompt,
  buildTurnPrompt,
  type PriorTurn,
  type ToolCallSummary,
} from '@/lib/trip-chat/prompt';
import {
  buildPreToolUseHook,
  buildStopHook,
  recordTurnUsage,
} from '@/lib/trip-chat/hooks';
import { FIXED_SDK_OPTIONS } from '@/lib/trip-chat/sdk-options';

export const runtime = 'nodejs';        // Agent SDK spawns a subprocess; Node-only.
export const maxDuration = 60;          // Enough for multi-tool-call turns on Opus 4.7.

const BodySchema = z.object({
  message: z.string().min(1).max(8000),
  session_id: z.string().optional(),    // echoed back from UI; telemetry only
});

const CHAT_HISTORY_TURNS_REPLAYED = 12; // last N user+assistant exchanges summarized in prompt

async function isAdmin(userId: string): Promise<boolean> {
  const supabase = createAdminClient();
  const { data } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', userId)
    .single();
  return data?.role === 'admin';
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: tripId } = await params;

  // 1. Auth.
  const serverClient = await createClient();
  const {
    data: { user },
  } = await serverClient.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!(await isAdmin(user.id))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  // 2. Validate body.
  let body: z.infer<typeof BodySchema>;
  try {
    body = BodySchema.parse(await request.json());
  } catch (err) {
    return NextResponse.json(
      { error: 'Invalid body', detail: err instanceof Error ? err.message : String(err) },
      { status: 400 }
    );
  }

  // 3. Trip must exist.
  const admin = createAdminClient();
  const { data: tripRow, error: tripErr } = await admin
    .from('trips')
    .select('id')
    .eq('id', tripId)
    .single();
  if (tripErr || !tripRow) {
    return NextResponse.json({ error: 'Trip not found' }, { status: 404 });
  }

  // 4. Session row (one per trip + user), + prior turns for prompt.
  const { data: existingSession } = await admin
    .from('trip_chat_sessions')
    .select('id, turn_count')
    .eq('trip_id', tripId)
    .eq('user_id', user.id)
    .maybeSingle();

  let sessionRowId: string;
  let turnIndex: number;

  if (existingSession) {
    sessionRowId = existingSession.id;
    turnIndex = existingSession.turn_count;
  } else {
    const ins = await admin
      .from('trip_chat_sessions')
      .insert({ trip_id: tripId, user_id: user.id })
      .select('id')
      .single();
    if (ins.error || !ins.data) {
      return NextResponse.json(
        { error: 'Failed to create chat session', detail: ins.error?.message },
        { status: 500 }
      );
    }
    sessionRowId = ins.data.id;
    turnIndex = 0;
  }

  const priorTurns = await loadPriorTurns(admin, sessionRowId);

  // 5. Persist the user's message row immediately so UI refresh mid-turn
  //    shows it even if the agent times out.
  await admin.from('trip_chat_messages').insert({
    session_id: sessionRowId,
    trip_id: tripId,
    user_id: user.id,
    turn_index: turnIndex,
    role: 'user',
    content: body.message,
  });

  // 6. Build the agent inputs.
  const prompt = buildTurnPrompt(priorTurns.slice(-CHAT_HISTORY_TURNS_REPLAYED), body.message);
  const systemPrompt = buildSystemPrompt();

  // Track tool activity this turn for the tool_calls_json summary.
  const toolCallsSummary: ToolCallSummary[] = [];
  const toolCallCounter = { count: 0 };

  // 7. Build the in-process MCP server. Closed over tripId + admin client —
  //    the agent physically cannot address a different trip.
  const mcpServer = createTripEditorMcpServer({
    tripId,
    supabase: admin,
    onUpdateApplied: ({ input }) => {
      toolCallsSummary.push({
        tool: 'update_trip',
        ok: true,
        input_keys: Object.keys(input as Record<string, unknown>),
      });
      toolCallCounter.count += 1;
    },
  });

  // 8. Hook set. PreToolUse double-checks writes against the allowlist; Stop
  //    is a seam for future work; usage recording happens off the result
  //    message below.
  const hookCtx = {
    supabase: admin,
    sessionRowId,
    tripId,
    userId: user.id,
    turnIndex,
    toolCallCounter,
  };

  // 9. Ensure CLAUDE_CONFIG_DIR lands on a writable path on serverless.
  const env = {
    ...process.env,
    CLAUDE_CONFIG_DIR: process.env.CLAUDE_CONFIG_DIR ?? '/tmp/.claude',
  };

  // 10. Invoke the SDK.
  const options: Options = {
    // ---- LOCKED: do not remove or reorder. See FIXED_SDK_OPTIONS comment. ----
    settingSources: [...FIXED_SDK_OPTIONS.settingSources],
    tools: [...FIXED_SDK_OPTIONS.tools],
    permissionMode: FIXED_SDK_OPTIONS.permissionMode,
    systemPrompt,
    // ---- END LOCKED ----
    mcpServers: { trip_editor: mcpServer },
    allowedTools: ['AskUserQuestion', ...TRIP_EDITOR_TOOL_NAMES],
    hooks: {
      PreToolUse: [{ hooks: [buildPreToolUseHook(hookCtx)] }],
      Stop: [{ hooks: [buildStopHook()] }],
    },
    maxTurns: 10,
    env,
    persistSession: false,              // fresh session per request — no local JSONL needed
    includePartialMessages: false,
  };

  let assistantText = '';
  let sdkSessionId: string | undefined;
  let usage:
    | {
        input_tokens?: number;
        output_tokens?: number;
        cache_creation_input_tokens?: number;
        cache_read_input_tokens?: number;
      }
    | undefined;
  let model: string | undefined;
  let totalCostUsd: number | undefined;
  let durationMs: number | undefined;
  let resultError: string | undefined;

  try {
    const stream = query({ prompt, options });
    for await (const msg of stream) {
      if (msg.type === 'system' && 'session_id' in msg && !sdkSessionId) {
        sdkSessionId = (msg as { session_id: string }).session_id;
      }
      if (msg.type === 'assistant') {
        // Accumulate the last assistant text turn. The agent may emit multiple
        // assistant messages (e.g. before/after tool calls); the LAST one is
        // the final reply to the user.
        const m = msg as { message: { content: Array<{ type: string; text?: string }> } };
        const textBlocks = m.message.content.filter((c) => c.type === 'text');
        if (textBlocks.length > 0) {
          assistantText = textBlocks.map((c) => c.text ?? '').join('').trim();
        }
      }
      if (msg.type === 'result') {
        const r = msg as {
          subtype: 'success' | 'error_max_turns' | 'error_during_execution' | string;
          total_cost_usd?: number;
          duration_ms?: number;
          usage?: typeof usage;
          modelUsage?: Record<string, { costUSD?: number }>;
          result?: string;
        };
        totalCostUsd = r.total_cost_usd;
        durationMs = r.duration_ms;
        usage = r.usage;
        if (r.modelUsage) {
          model = Object.keys(r.modelUsage)[0];
        }
        if (r.subtype !== 'success') {
          resultError = `agent stopped: ${r.subtype}`;
        }
        if (!assistantText && r.result) {
          assistantText = r.result.trim();
        }
      }
    }
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    console.error('trip-chat: agent error', detail);
    return NextResponse.json(
      { error: 'Agent failed', detail },
      { status: 500 }
    );
  }

  if (resultError && !assistantText) {
    assistantText = `(${resultError})`;
  }

  // 11. Persist assistant message row.
  await admin.from('trip_chat_messages').insert({
    session_id: sessionRowId,
    trip_id: tripId,
    user_id: user.id,
    turn_index: turnIndex,
    role: 'assistant',
    content: assistantText,
    tool_calls_json: toolCallsSummary.length ? toolCallsSummary : null,
  });

  // 12. Bump session counters.
  await admin
    .from('trip_chat_sessions')
    .update({
      turn_count: turnIndex + 1,
      last_sdk_session_id: sdkSessionId ?? null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', sessionRowId);

  // 13. Record usage (best-effort; never fails the route).
  await recordTurnUsage({
    ...hookCtx,
    model,
    usage,
    total_cost_usd: totalCostUsd,
    duration_ms: durationMs,
  });

  return NextResponse.json({
    assistant_message: assistantText,
    session_id: sdkSessionId ?? null,
    tool_calls_summary: toolCallsSummary,
    turn_index: turnIndex,
  });
}

// ---------------------------------------------------------------------------

async function loadPriorTurns(
  admin: ReturnType<typeof createAdminClient>,
  sessionRowId: string
): Promise<PriorTurn[]> {
  const { data } = await admin
    .from('trip_chat_messages')
    .select('turn_index, role, content, tool_calls_json')
    .eq('session_id', sessionRowId)
    .order('turn_index', { ascending: true })
    .order('role', { ascending: true });    // 'assistant' < 'user' alphabetically — but that's fine, we group by turn_index

  if (!data || data.length === 0) return [];

  const byTurn = new Map<number, PriorTurn>();
  for (const row of data) {
    const turn = byTurn.get(row.turn_index) ?? { user: '', assistant: '' };
    if (row.role === 'user') turn.user = row.content ?? '';
    if (row.role === 'assistant') {
      turn.assistant = row.content ?? '';
      if (row.tool_calls_json) turn.tool_calls = row.tool_calls_json as ToolCallSummary[];
    }
    byTurn.set(row.turn_index, turn);
  }

  return Array.from(byTurn.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([, t]) => t)
    // drop incomplete turns (e.g. user wrote but agent didn't finish) from the history summary
    .filter((t) => t.user && t.assistant);
}

// Export for GET too? v1 uses page-load SSR for initial history. Not needed.

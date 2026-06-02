/**
 * POST /api/trips/[id]/chat — authenticated chat turn for a specific trip.
 *
 * Each request is one fresh Agent SDK session. Prior context is summarized into
 * the prompt string instead of resuming SDK-local session state, because
 * serverless filesystems are ephemeral. See src/lib/trip-chat/prompt.ts.
 *
 * The HTTP request is intentionally short-lived: it persists the user's turn,
 * reserves a monotonic turn_index, schedules the agent work with `after()`, and
 * returns 202. The client polls GET /chat for the assistant row. This avoids
 * mobile browsers/proxies dropping a minutes-long fetch as "Load failed" while
 * the Agent SDK is still working.
 *
 * Design invariants — do not quietly drop:
 *
 *   - `settingSources: []`  — do not let the SDK auto-load filesystem settings.
 *     The repo root CLAUDE.md contains instructions written for Claude Code
 *     editing the codebase ("commit and push to main after every change");
 *     the chat agent must not inherit them. Locked to empty array and
 *     asserted in a unit test.
 *
 *   - Built-in tools restricted to `AskUserQuestion` + `WebSearch`. No Bash,
 *     Read, Edit, Write, or WebFetch — the agent edits trips and performs
 *     structured trip-specific reads/research via the in-process MCP server,
 *     nothing else.
 *
 *   - `permissionMode: 'dontAsk'` — deny anything not on the allowlist
 *     without a prompt (there's no human available to respond to a prompt
 *     in a serverless handler).
 *
 *   - `CLAUDE_CONFIG_DIR` pointed at /tmp on Vercel so the SDK's local-disk
 *     writes land on a writable tmpfs within the invocation lifetime.
 */
import { after, NextRequest, NextResponse } from 'next/server';
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
import {
  FIXED_SDK_OPTIONS,
  resolveTripChatModel,
} from '@/lib/trip-chat/sdk-options';

export const runtime = 'nodejs';        // Agent SDK spawns a subprocess; Node-only.
export const maxDuration = 300;         // Vercel Pro ceiling — first agent turn after a cold spawn can be slow.

const BodySchema = z.object({
  message: z.string().min(1).max(8000),
  session_id: z.string().optional(),    // echoed back from UI; telemetry only
  // Snapshot of what the user is currently looking at (which day, etc).
  // Forwarded to the agent as a prefix on the user prompt so it answers
  // in the right scope without asking.
  view_context: z
    .object({
      slide: z.number().optional(),
      slideKind: z.string().optional(),
      day_number: z.number().nullable().optional(),
      date: z.string().nullable().optional(),
      title: z.string().nullable().optional(),
      destination_id: z.string().nullable().optional(),
      destination_title: z.string().nullable().optional(),
      candidate_id: z.string().nullable().optional(),
      candidate_name: z.string().nullable().optional(),
    })
    .nullable()
    .optional(),
});

type ChatRequestBody = z.infer<typeof BodySchema>;

interface RunAgentTurnArgs {
  tripId: string;
  userId: string;
  sessionRowId: string;
  turnIndex: number;
  message: string;
  viewContext: ChatRequestBody['view_context'];
  priorTurns: PriorTurn[];
}

interface UiChatMessage {
  id: string;
  turn_index: number;
  role: 'user' | 'assistant';
  content: string;
  tool_calls_json: ToolCallSummary[] | null;
}

const CHAT_HISTORY_TURNS_REPLAYED = 12; // last N user+assistant exchanges summarized in prompt
const DEFAULT_CHAT_HISTORY_LIMIT = 50;

async function isAdmin(userId: string): Promise<boolean> {
  const supabase = createAdminClient();
  const { data } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', userId)
    .single();
  return data?.role === 'admin';
}

async function isOwner(userId: string, tripId: string): Promise<boolean> {
  const supabase = createAdminClient();
  const { data } = await supabase
    .from('trips')
    .select('user_id')
    .eq('id', tripId)
    .single();
  return data?.user_id === userId;
}

async function requireTripChatAccess(
  tripId: string
): Promise<{ userId: string } | { response: NextResponse }> {
  const serverClient = await createClient();
  const {
    data: { user },
  } = await serverClient.auth.getUser();
  if (!user) {
    return { response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  }

  // Trip owner can edit their own trip via chat. Admins can edit any
  // trip (for support). Anyone else: forbidden.
  const [ownerOk, adminOk] = await Promise.all([
    isOwner(user.id, tripId),
    isAdmin(user.id),
  ]);
  if (!ownerOk && !adminOk) {
    return { response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) };
  }

  return { userId: user.id };
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: tripId } = await params;
  const access = await requireTripChatAccess(tripId);
  if ('response' in access) return access.response;

  const limitParam = Number(request.nextUrl.searchParams.get('limit'));
  const limit = Number.isFinite(limitParam)
    ? Math.min(100, Math.max(1, Math.floor(limitParam)))
    : DEFAULT_CHAT_HISTORY_LIMIT;
  const admin = createAdminClient();
  const messages = await loadChatMessages(admin, tripId, access.userId, limit);

  return NextResponse.json({ messages });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: tripId } = await params;

  // 1. Auth.
  const access = await requireTripChatAccess(tripId);
  if ('response' in access) return access.response;

  // 2. Validate body.
  let body: ChatRequestBody;
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
    .eq('user_id', access.userId)
    .maybeSingle();

  let sessionRowId: string;
  let turnIndex: number;

  if (existingSession) {
    sessionRowId = existingSession.id;
    turnIndex = await nextTurnIndex(admin, sessionRowId, existingSession.turn_count);
  } else {
    const ins = await admin
      .from('trip_chat_sessions')
      .insert({ trip_id: tripId, user_id: access.userId })
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
  const insertUser = await admin.from('trip_chat_messages').insert({
    session_id: sessionRowId,
    trip_id: tripId,
    user_id: access.userId,
    turn_index: turnIndex,
    role: 'user',
    content: body.message,
  });
  if (insertUser.error) {
    return NextResponse.json(
      { error: 'Failed to save chat message', detail: insertUser.error.message },
      { status: 500 }
    );
  }

  // Reserve the turn number before the agent finishes. The old synchronous
  // path only bumped this after success, so a dropped request could reuse the
  // same turn_index and corrupt later history reconstruction.
  const reserveTurn = await admin
    .from('trip_chat_sessions')
    .update({
      turn_count: turnIndex + 1,
      updated_at: new Date().toISOString(),
    })
    .eq('id', sessionRowId);
  if (reserveTurn.error) {
    return NextResponse.json(
      { error: 'Failed to reserve chat turn', detail: reserveTurn.error.message },
      { status: 500 }
    );
  }

  const runArgs: RunAgentTurnArgs = {
    tripId,
    userId: access.userId,
    sessionRowId,
    turnIndex,
    message: body.message,
    viewContext: body.view_context,
    priorTurns,
  };

  after(async () => {
    try {
      await runAgentTurn(runArgs);
    } catch (err) {
      console.error('trip-chat: unhandled background turn error', err);
      await persistAssistantFallback(runArgs);
    }
  });

  return NextResponse.json(
    {
      status: 'queued',
      assistant_message: null,
      session_id: null,
      tool_calls_summary: [],
      turn_index: turnIndex,
    },
    { status: 202 }
  );
}

// ---------------------------------------------------------------------------

async function runAgentTurn(args: RunAgentTurnArgs): Promise<void> {
  const admin = createAdminClient();

  // Compose the user message with a small "currently viewing" prefix so
  // the agent knows whether the user is asking about a specific day.
  const userMessage = formatViewContextPrefix(args.viewContext) + args.message;
  const prompt = buildTurnPrompt(
    args.priorTurns.slice(-CHAT_HISTORY_TURNS_REPLAYED),
    userMessage
  );
  const systemPrompt = buildSystemPrompt();

  // Track tool activity this turn for the tool_calls_json summary.
  const toolCallsSummary: ToolCallSummary[] = [];
  const toolCallCounter = { count: 0 };

  // Build the in-process MCP server. Closed over tripId + admin client —
  // the agent physically cannot address a different trip.
  const mcpServer = createTripEditorMcpServer({
    tripId: args.tripId,
    supabase: admin,
    onUpdateApplied: ({ tool, input }) => {
      toolCallsSummary.push({
        tool: tool ?? 'update_trip',
        ok: true,
        input_keys: Object.keys(input as Record<string, unknown>),
      });
      toolCallCounter.count += 1;
    },
  });

  // Hook set. PreToolUse double-checks writes against the allowlist; Stop
  // is a seam for future work; usage recording happens off the result
  // message below.
  const hookCtx = {
    supabase: admin,
    sessionRowId: args.sessionRowId,
    tripId: args.tripId,
    userId: args.userId,
    turnIndex: args.turnIndex,
    toolCallCounter,
  };

  // Ensure CLAUDE_CONFIG_DIR lands on a writable path on serverless.
  const env = {
    ...process.env,
    CLAUDE_CONFIG_DIR: process.env.CLAUDE_CONFIG_DIR ?? '/tmp/.claude',
  };

  const { pathToClaudeCodeExecutable, resolveDiagnostic } =
    await resolveClaudeExecutable();
  console.log('trip-chat: binary resolution —', resolveDiagnostic);

  const options: Options = {
    // ---- LOCKED: do not remove or reorder. See FIXED_SDK_OPTIONS comment. ----
    settingSources: [...FIXED_SDK_OPTIONS.settingSources],
    tools: [...FIXED_SDK_OPTIONS.tools],
    permissionMode: FIXED_SDK_OPTIONS.permissionMode,
    systemPrompt,
    // ---- END LOCKED ----
    // Cheap, fast default for trip edits; override with TRIP_CHAT_MODEL.
    model: resolveTripChatModel(env),
    mcpServers: { trip_editor: mcpServer },
    allowedTools: ['AskUserQuestion', 'WebSearch', ...TRIP_EDITOR_TOOL_NAMES],
    hooks: {
      PreToolUse: [{ hooks: [buildPreToolUseHook(hookCtx)] }],
      Stop: [{ hooks: [buildStopHook()] }],
    },
    maxTurns: 10,
    env,
    persistSession: false,              // fresh session per request — no local JSONL needed
    includePartialMessages: false,
    ...(pathToClaudeCodeExecutable ? { pathToClaudeCodeExecutable } : {}),
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

  const t0 = Date.now();
  console.log('trip-chat: invoking SDK', {
    tripId: args.tripId,
    turnIndex: args.turnIndex,
    msgLen: args.message.length,
  });
  try {
    const stream = query({ prompt, options });
    for await (const msg of stream) {
      console.log('trip-chat: stream msg', msg.type, `+${Date.now() - t0}ms`);
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
    durationMs = Date.now() - t0;
    const detail = err instanceof Error ? err.message : String(err);
    console.error('trip-chat: agent error', {
      detail,
      binary: resolveDiagnostic,
      tripId: args.tripId,
      turnIndex: args.turnIndex,
    });
    assistantText =
      'I hit a connection problem while working on that. Please try again in a moment.';
  }

  if (resultError && !assistantText) {
    assistantText = `(${resultError})`;
  }
  if (!assistantText) {
    assistantText = 'Done.';
  }

  await admin.from('trip_chat_messages').insert({
    session_id: args.sessionRowId,
    trip_id: args.tripId,
    user_id: args.userId,
    turn_index: args.turnIndex,
    role: 'assistant',
    content: assistantText,
    tool_calls_json: toolCallsSummary.length ? toolCallsSummary : null,
  });

  await admin
    .from('trip_chat_sessions')
    .update({
      last_sdk_session_id: sdkSessionId ?? null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', args.sessionRowId);

  // Best-effort; never fails the background turn.
  await recordTurnUsage({
    ...hookCtx,
    model,
    usage,
    total_cost_usd: totalCostUsd,
    duration_ms: durationMs,
  });
}

async function persistAssistantFallback(args: RunAgentTurnArgs): Promise<void> {
  const admin = createAdminClient();
  const { data: existingAssistant } = await admin
    .from('trip_chat_messages')
    .select('id')
    .eq('session_id', args.sessionRowId)
    .eq('turn_index', args.turnIndex)
    .eq('role', 'assistant')
    .maybeSingle();
  if (existingAssistant) return;

  await admin.from('trip_chat_messages').insert({
    session_id: args.sessionRowId,
    trip_id: args.tripId,
    user_id: args.userId,
    turn_index: args.turnIndex,
    role: 'assistant',
    content:
      'I hit a connection problem while working on that. Please try again in a moment.',
    tool_calls_json: null,
  });
  await admin
    .from('trip_chat_sessions')
    .update({ updated_at: new Date().toISOString() })
    .eq('id', args.sessionRowId);
}

function formatViewContextPrefix(ctx: ChatRequestBody['view_context']): string {
  if (!ctx) return '';
  if (ctx.slideKind === 'day' && ctx.day_number) {
    const dateStr = ctx.date ? ` (${ctx.date})` : '';
    const titleStr = ctx.title ? ` — "${ctx.title}"` : '';
    return `[The user is currently viewing Day ${ctx.day_number}${dateStr}${titleStr}. If their question is ambiguous about which day, default to this one.]\n\n`;
  }
  if (ctx.slideKind === 'cover') {
    return `[The user is currently on the trip cover (overview), not a specific day.]\n\n`;
  }
  if (ctx.slideKind === 'accommodation_review') {
    const destination = ctx.destination_title
      ? ` destination "${ctx.destination_title}"`
      : ' accommodation-review destination';
    const candidate = ctx.candidate_name
      ? ` Candidate in focus: "${ctx.candidate_name}".`
      : '';
    return `[The user is currently viewing the private Accommodations Reviewer for${destination}.${candidate} Use accommodation-review tools before answering hotel-candidate workflow questions.]\n\n`;
  }
  return '';
}

async function resolveClaudeExecutable(): Promise<{
  pathToClaudeCodeExecutable: string | undefined;
  resolveDiagnostic: string;
}> {
  // The SDK normally locates this on its own in local development. On Vercel,
  // Next's bundling can hide the optional platform package from that resolver,
  // so we pass the traced executable path directly without dynamic require/fs
  // lookups that make Turbopack trace the whole project into this function.
  if (process.env.CLAUDE_CODE_EXECUTABLE) {
    return {
      pathToClaudeCodeExecutable: process.env.CLAUDE_CODE_EXECUTABLE,
      resolveDiagnostic: 'resolved via CLAUDE_CODE_EXECUTABLE',
    };
  }

  if (process.env.VERCEL === '1' || process.platform === 'linux') {
    return {
      pathToClaudeCodeExecutable: '/var/task/node_modules/@anthropic-ai/claude-agent-sdk-linux-x64/claude',
      resolveDiagnostic: 'using traced Vercel linux-x64 executable',
    };
  }

  return {
    pathToClaudeCodeExecutable: undefined,
    resolveDiagnostic: 'using SDK default executable resolution',
  };
}

async function nextTurnIndex(
  admin: ReturnType<typeof createAdminClient>,
  sessionRowId: string,
  turnCount: number | null
): Promise<number> {
  const { data: latestMessage } = await admin
    .from('trip_chat_messages')
    .select('turn_index')
    .eq('session_id', sessionRowId)
    .order('turn_index', { ascending: false })
    .limit(1)
    .maybeSingle();
  const afterLatestMessage =
    typeof latestMessage?.turn_index === 'number' ? latestMessage.turn_index + 1 : 0;
  return Math.max(turnCount ?? 0, afterLatestMessage);
}

async function loadChatMessages(
  admin: ReturnType<typeof createAdminClient>,
  tripId: string,
  userId: string,
  limit: number
): Promise<UiChatMessage[]> {
  const { data: session } = await admin
    .from('trip_chat_sessions')
    .select('id')
    .eq('trip_id', tripId)
    .eq('user_id', userId)
    .maybeSingle();
  if (!session) return [];

  const { data: rows } = await admin
    .from('trip_chat_messages')
    .select('id, turn_index, role, content, tool_calls_json, created_at')
    .eq('session_id', session.id)
    .order('turn_index', { ascending: false })
    .limit(limit * 2);

  if (!rows) return [];

  const roleOrder: Record<string, number> = { user: 0, assistant: 1 };
  return rows
    .sort((a, b) =>
      a.turn_index === b.turn_index
        ? roleOrder[a.role] - roleOrder[b.role]
        : a.turn_index - b.turn_index
    )
    .map((r) => ({
      id: r.id,
      turn_index: r.turn_index,
      role: r.role as 'user' | 'assistant',
      content: r.content,
      tool_calls_json: (r.tool_calls_json ?? null) as ToolCallSummary[] | null,
    }));
}

async function loadPriorTurns(
  admin: ReturnType<typeof createAdminClient>,
  sessionRowId: string
): Promise<PriorTurn[]> {
  const { data } = await admin
    .from('trip_chat_messages')
    .select('turn_index, role, content, tool_calls_json, created_at')
    .eq('session_id', sessionRowId)
    .order('turn_index', { ascending: true })
    .order('created_at', { ascending: true });

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

/**
 * POST /api/trips/[id]/chat — authenticated chat turn for a specific trip.
 *
 * Each request is one fresh Agent SDK session. Prior context is summarized into
 * the prompt string instead of resuming SDK-local session state, because
 * serverless filesystems are ephemeral. See src/lib/trip-chat/prompt.ts.
 *
 * Conversations are organized into THREADS (one trip_chat_sessions row per
 * thread, many per trip+user — see migration 010). POST without a thread_id
 * starts a new thread titled from the user's message + view context; the
 * title is polished asynchronously by a small Messages API call. GET reads
 * one thread's messages (?thread_id=…), defaulting to the newest thread so
 * pre-thread clients keep working. Thread CRUD lives in ./threads.
 *
 * The HTTP request is intentionally short-lived: it persists the user's turn,
 * reserves a monotonic turn_index, schedules the agent work in the background, and
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
 *   - `CLAUDE_CONFIG_DIR` pointed at /tmp so the SDK's local-disk writes land
 *     on a writable tmpfs within the invocation lifetime.
 *
 *   - Failed turns persist a TRUTHFUL assistant message (see turn-failure.ts)
 *     and record the raw cause in trip_chat_usage.error_detail. The June 2026
 *     outage hid an invalid prod API key behind a generic "connection
 *     problem" string for a week; never reintroduce that.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { query } from '@anthropic-ai/claude-agent-sdk';
import type { Options } from '@anthropic-ai/claude-agent-sdk';
import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { z } from 'zod';

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
  getAppliedToolProgressUpdate,
  type ChatProgressEvent,
  type ChatProgressUpdate,
} from '@/lib/trip-chat/progress';
import {
  FIXED_SDK_OPTIONS,
  resolveTripChatModel,
} from '@/lib/trip-chat/sdk-options';
import { tryRunFastLaneTurn } from '@/lib/trip-chat/fast-lane';
import {
  createThread,
  findThread,
  latestThread,
  renameThread,
} from '@/lib/trip-chat/threads';
import {
  deriveThreadTitleHeuristic,
  generateThreadTitle,
} from '@/lib/trip-chat/thread-title';
import { classifyTurnFailure } from '@/lib/trip-chat/turn-failure';

const BodySchema = z.object({
  message: z.string().min(1).max(8000),
  session_id: z.string().optional(),    // echoed back from UI; telemetry only
  // Thread to continue. Absent/null → start a new thread.
  thread_id: z.string().uuid().nullable().optional(),
  // Snapshot of what the user is currently looking at (which day, etc).
  // Forwarded to the agent as a prefix on the user prompt so it answers
  // in the right scope without asking, and folded into new-thread titles.
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
  origin: string;
  sessionRowId: string;                 // thread id (trip_chat_sessions.id)
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

type TurnProgressScope = Pick<
  RunAgentTurnArgs,
  'sessionRowId' | 'tripId' | 'userId' | 'turnIndex'
>;

const CHAT_HISTORY_TURNS_REPLAYED = 12; // last N user+assistant exchanges summarized in prompt
const DEFAULT_CHAT_HISTORY_LIMIT = 50;

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: tripId } = await params;
  const access = await requireTripChatAccess(request, tripId);
  if ('response' in access) return access.response;

  const requestUrl = new URL(request.url);
  const limitParam = Number(requestUrl.searchParams.get('limit'));
  const limit = Number.isFinite(limitParam)
    ? Math.min(100, Math.max(1, Math.floor(limitParam)))
    : DEFAULT_CHAT_HISTORY_LIMIT;

  const admin = createAdminClient();
  const scope = { tripId, userId: access.userId };

  // Explicit thread, or the newest one for pre-thread clients.
  const requestedThreadId = requestUrl.searchParams.get('thread_id');
  let threadId: string | null = null;
  if (requestedThreadId) {
    const thread = await findThread(admin, scope, requestedThreadId);
    if (!thread) {
      return json({ error: 'Thread not found' }, { status: 404 }, access.headers);
    }
    threadId = thread.id;
  } else {
    threadId = (await latestThread(admin, scope))?.id ?? null;
  }

  const messages = threadId
    ? await loadThreadMessages(admin, threadId, limit)
    : [];
  const progressTurnIndex = parseTurnIndex(requestUrl.searchParams.get('turn_index'));
  const progress =
    threadId && progressTurnIndex !== null
      ? await loadTurnProgress(admin, threadId, progressTurnIndex)
      : [];

  return json({ messages, thread_id: threadId, progress }, undefined, access.headers);
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: tripId } = await params;
  const requestUrl = new URL(request.url);

  // 1. Auth.
  const access = await requireTripChatAccess(request, tripId);
  if ('response' in access) return access.response;

  // 2. Validate body.
  let body: ChatRequestBody;
  try {
    body = BodySchema.parse(await request.json());
  } catch (err) {
    return json(
      { error: 'Invalid body', detail: err instanceof Error ? err.message : String(err) },
      { status: 400 },
      access.headers
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
    return json({ error: 'Trip not found' }, { status: 404 }, access.headers);
  }

  // 4. Resolve the thread: continue an existing one, or start a new one
  //    titled from this first message + what the user was looking at.
  const scope = { tripId, userId: access.userId };
  let sessionRowId: string;
  let turnIndex: number;
  let threadTitle: string | null = null;
  let isNewThread = false;

  if (body.thread_id) {
    const thread = await findThread(admin, scope, body.thread_id);
    if (!thread) {
      return json({ error: 'Thread not found' }, { status: 404 }, access.headers);
    }
    sessionRowId = thread.id;
    turnIndex = await nextTurnIndex(admin, sessionRowId, thread.turn_count);
  } else {
    threadTitle = deriveThreadTitleHeuristic(body.message, body.view_context);
    const created = await createThread(admin, scope, threadTitle);
    if ('error' in created) {
      return json(
        { error: 'Failed to create chat thread', detail: created.error },
        { status: 500 },
        access.headers
      );
    }
    sessionRowId = created.id;
    if (created.reused) {
      // Degraded reuse (pre-migration DB, or a transient insert failure):
      // continue the existing conversation — its turn numbering and prior
      // context included — instead of stomping turn 0 as if it were fresh.
      turnIndex = await nextTurnIndex(admin, sessionRowId, created.turnCount);
      threadTitle = created.existingTitle;
      isNewThread = false;
    } else {
      turnIndex = 0;
      isNewThread = true;
    }
  }

  const priorTurns = isNewThread ? [] : await loadPriorTurns(admin, sessionRowId);

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
    return json(
      { error: 'Failed to save chat message', detail: insertUser.error.message },
      { status: 500 },
      access.headers
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
    return json(
      { error: 'Failed to reserve chat turn', detail: reserveTurn.error.message },
      { status: 500 },
      access.headers
    );
  }

  await insertTurnProgress(admin, {
    sessionRowId,
    tripId,
    userId: access.userId,
    turnIndex,
  }, {
    stage: 'queued',
    message: 'Queued your request...',
  });

  // New threads get an async title polish (small Messages API call, falls
  // back silently to the heuristic title if the key is broken or slow).
  const polishTitle = isNewThread
    ? async () => {
        const polished = await generateThreadTitle({
          message: body.message,
          viewContext: body.view_context,
        });
        if (polished && polished !== threadTitle) {
          await renameThread(admin, scope, sessionRowId, polished);
        }
      }
    : null;

  const fastLane = await tryRunFastLaneTurn({
    supabase: admin,
    tripId,
    message: body.message,
    viewContext: body.view_context,
  });
  if (fastLane) {
    const insertAssistant = await admin.from('trip_chat_messages').insert({
      session_id: sessionRowId,
      trip_id: tripId,
      user_id: access.userId,
      turn_index: turnIndex,
      role: 'assistant',
      content: fastLane.assistantText,
      tool_calls_json: fastLane.toolCallsSummary,
    });
    if (insertAssistant.error) {
      return json(
        { error: 'Failed to save fast-lane response', detail: insertAssistant.error.message },
        { status: 500 },
        access.headers
      );
    }

    await admin
      .from('trip_chat_sessions')
      .update({
        last_sdk_session_id: null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', sessionRowId);

    await recordTurnUsage({
      supabase: admin,
      sessionRowId,
      tripId,
      userId: access.userId,
      turnIndex,
      model: 'fast-lane-v1',
      usage: {
        input_tokens: 0,
        output_tokens: 0,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
      },
      total_cost_usd: 0,
      duration_ms: fastLane.durationMs,
      toolCallCounter: { count: fastLane.toolCallsSummary.length },
    });

    if (polishTitle) {
      scheduleBackground(async () => {
        await polishTitle().catch(() => {});
      });
    }

    return json({
      status: 'fast_lane',
      assistant_message: fastLane.assistantText,
      session_id: null,
      thread_id: sessionRowId,
      thread_title: threadTitle,
      tool_calls_summary: fastLane.toolCallsSummary,
      turn_index: turnIndex,
    }, undefined, access.headers);
  }

  const runArgs: RunAgentTurnArgs = {
    tripId,
    userId: access.userId,
    origin: requestUrl.origin,
    sessionRowId,
    turnIndex,
    message: body.message,
    viewContext: body.view_context,
    priorTurns,
  };

  scheduleBackground(async () => {
    const work: Promise<unknown>[] = [
      (async () => {
        try {
          await runAgentTurn(runArgs);
        } catch (err) {
          console.error('trip-chat: unhandled background turn error', err);
          await persistAssistantFallback(runArgs, err);
        }
      })(),
    ];
    if (polishTitle) {
      work.push(polishTitle().catch(() => {}));
    }
    await Promise.all(work);
  });

  return json(
    {
      status: 'queued',
      assistant_message: null,
      session_id: null,
      thread_id: sessionRowId,
      thread_title: threadTitle,
      tool_calls_summary: [],
      turn_index: turnIndex,
    },
    { status: 202 },
    access.headers
  );
}

// ---------------------------------------------------------------------------

function json(
  data: unknown,
  init?: ResponseInit,
  extraHeaders?: Headers
): Response {
  const headers = new Headers(extraHeaders);
  if (init?.headers) {
    new Headers(init.headers).forEach((value, key) => headers.append(key, value));
  }
  if (!headers.has('content-type')) {
    headers.set('content-type', 'application/json');
  }
  return new Response(JSON.stringify(data), {
    ...init,
    headers,
  });
}

function scheduleBackground(task: () => Promise<void>): void {
  void task().catch((err) => {
    console.error('trip-chat: background task failed', err);
  });
}

function parseTurnIndex(value: string | null): number | null {
  if (!value) return null;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) return null;
  return parsed;
}

function createTurnProgressReporter(
  admin: ReturnType<typeof createAdminClient>,
  scope: TurnProgressScope
): (update: ChatProgressUpdate) => Promise<void> {
  let lastKey = '';
  return async (update) => {
    const key = `${update.stage}:${update.message}`;
    if (key === lastKey) return;
    lastKey = key;
    await insertTurnProgress(admin, scope, update);
  };
}

async function insertTurnProgress(
  admin: ReturnType<typeof createAdminClient>,
  scope: TurnProgressScope,
  update: ChatProgressUpdate
): Promise<void> {
  const { error } = await admin.from('trip_chat_progress_events').insert({
    session_id: scope.sessionRowId,
    trip_id: scope.tripId,
    user_id: scope.userId,
    turn_index: scope.turnIndex,
    stage: update.stage,
    message: update.message.slice(0, 240),
  });

  if (error) {
    // Older local/prod databases may not have the progress table yet. Progress
    // is helpful, not load-bearing; the turn must continue either way.
    if (!/trip_chat_progress_events|schema cache|relation .* does not exist/i.test(error.message)) {
      console.error('trip-chat: failed to record progress', error.message);
    }
  }
}

async function loadTurnProgress(
  admin: ReturnType<typeof createAdminClient>,
  threadId: string,
  turnIndex: number
): Promise<ChatProgressEvent[]> {
  const { data, error } = await admin
    .from('trip_chat_progress_events')
    .select('id, turn_index, stage, message, created_at')
    .eq('session_id', threadId)
    .eq('turn_index', turnIndex)
    .order('created_at', { ascending: true })
    .limit(30);

  if (error) {
    if (!/trip_chat_progress_events|schema cache|relation .* does not exist/i.test(error.message)) {
      console.error('trip-chat: failed to load progress', error.message);
    }
    return [];
  }

  return (data ?? []).map((row) => ({
    id: String(row.id),
    turn_index: Number(row.turn_index),
    stage: row.stage as ChatProgressEvent['stage'],
    message: String(row.message ?? ''),
    created_at: String(row.created_at ?? ''),
  }));
}

async function requireTripChatAccess(
  request: Request,
  tripId: string
): Promise<{ userId: string; headers: Headers } | { response: Response }> {
  const headers = new Headers();
  const serverClient = createRequestSupabaseClient(request, headers);
  const {
    data: { user },
  } = await serverClient.auth.getUser();
  if (!user) {
    return {
      response: json({ error: 'Unauthorized' }, { status: 401 }, headers),
    };
  }

  const [ownerOk, adminOk] = await Promise.all([
    isOwner(user.id, tripId),
    isAdmin(user.id),
  ]);
  if (!ownerOk && !adminOk) {
    return {
      response: json({ error: 'Forbidden' }, { status: 403 }, headers),
    };
  }

  return { userId: user.id, headers };
}

function createRequestSupabaseClient(request: Request, responseHeaders: Headers) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error('Supabase environment variables are not configured.');
  }

  const requestCookies = parseCookieHeader(request.headers.get('cookie'));

  return createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return requestCookies;
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value, options }) => {
          responseHeaders.append('set-cookie', serializeCookie(name, value, options));
        });
      },
    },
  });
}

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

function parseCookieHeader(cookieHeader: string | null): Array<{ name: string; value: string }> {
  if (!cookieHeader) return [];
  return cookieHeader
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean)
    .flatMap((part) => {
      const separator = part.indexOf('=');
      if (separator === -1) return [];
      const name = part.slice(0, separator).trim();
      const value = part.slice(separator + 1).trim();
      return name ? [{ name, value }] : [];
    });
}

function serializeCookie(name: string, value: string, options: CookieOptions = {}): string {
  const parts = [`${name}=${value}`];
  if (options.maxAge !== undefined) parts.push(`Max-Age=${Math.floor(options.maxAge)}`);
  if (options.domain) parts.push(`Domain=${options.domain}`);
  if (options.path) parts.push(`Path=${options.path}`);
  if (options.expires) parts.push(`Expires=${options.expires.toUTCString()}`);
  if (options.httpOnly) parts.push('HttpOnly');
  if (options.secure) parts.push('Secure');
  if (options.sameSite) {
    const sameSite =
      typeof options.sameSite === 'string'
        ? options.sameSite.charAt(0).toUpperCase() + options.sameSite.slice(1)
        : 'Strict';
    parts.push(`SameSite=${sameSite}`);
  }
  return parts.join('; ');
}

async function runAgentTurn(args: RunAgentTurnArgs): Promise<void> {
  const admin = createAdminClient();
  const progress = createTurnProgressReporter(admin, args);
  await progress({
    stage: 'starting',
    message: 'Starting the travel agent...',
  });

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
    origin: args.origin,
    onUpdateApplied: async ({ tool, input }) => {
      toolCallsSummary.push({
        tool: tool ?? 'update_trip',
        ok: true,
        input_keys: Object.keys(input as Record<string, unknown>),
      });
      toolCallCounter.count += 1;
      await progress(getAppliedToolProgressUpdate(tool));
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
    onProgress: progress,
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
  let errorDetail: string | undefined;

  const t0 = Date.now();
  console.log('trip-chat: invoking SDK', {
    tripId: args.tripId,
    turnIndex: args.turnIndex,
    msgLen: args.message.length,
  });
  await progress({
    stage: 'thinking',
    message: 'Planning the next step...',
  });
  try {
    const stream = query({ prompt, options });
    for await (const msg of stream) {
      console.log('trip-chat: stream msg', msg.type, `+${Date.now() - t0}ms`);
      if (msg.type === 'system' && 'session_id' in msg && !sdkSessionId) {
        sdkSessionId = (msg as { session_id: string }).session_id;
        await progress({
          stage: 'starting',
          message: 'Connected to the agent session...',
        });
      }
      if (msg.type === 'assistant') {
        // Accumulate the last assistant text turn. The agent may emit multiple
        // assistant messages (e.g. before/after tool calls); the LAST one is
        // the final reply to the user.
        const m = msg as { message: { content: Array<{ type: string; text?: string }> } };
        const textBlocks = m.message.content.filter((c) => c.type === 'text');
        if (textBlocks.length > 0) {
          assistantText = textBlocks.map((c) => c.text ?? '').join('').trim();
          await progress({
            stage: 'writing',
            message: 'Drafting the reply...',
          });
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
          await progress({
            stage: 'error',
            message: 'The agent stopped early; saving what happened...',
          });
        } else {
          await progress({
            stage: 'reviewing',
            message: 'Reviewing the result...',
          });
        }
        if (!assistantText && r.result) {
          assistantText = r.result.trim();
        }
      }
    }
  } catch (err) {
    durationMs = Date.now() - t0;
    const detail = err instanceof Error ? err.message : String(err);
    // The CLI reports fatal API problems ("Invalid API key · Fix external
    // API key") as assistant/result TEXT before the stream throws, so the
    // accumulated assistantText is part of the evidence — classify on both,
    // then replace it with an honest user-facing message.
    const failure = classifyTurnFailure(detail, assistantText);
    console.error('trip-chat: agent error', {
      detail,
      kind: failure.kind,
      cliText: assistantText || undefined,
      binary: resolveDiagnostic,
      tripId: args.tripId,
      turnIndex: args.turnIndex,
    });
    await progress({
      stage: 'error',
      message: 'The agent hit an error; saving a truthful status...',
    });
    assistantText =
      failure.kind === 'transient' && toolCallCounter.count > 0
        ? 'I saved some changes, then hit a connection problem while writing the final reply. The itinerary may already be updated; review it before retrying.'
        : failure.userMessage;
    errorDetail = `${failure.kind}: ${failure.detail}`;
  }

  if (resultError && !errorDetail) {
    errorDetail = resultError;
  }
  if (resultError && !assistantText) {
    assistantText = `(${resultError})`;
  }
  if (!assistantText) {
    assistantText = 'Done.';
  }

  await progress({
    stage: 'writing',
    message: 'Saving the response...',
  });

  await admin.from('trip_chat_messages').insert({
    session_id: args.sessionRowId,
    trip_id: args.tripId,
    user_id: args.userId,
    turn_index: args.turnIndex,
    role: 'assistant',
    content: assistantText,
    tool_calls_json: toolCallsSummary.length ? toolCallsSummary : null,
  });

  await progress({
    stage: 'done',
    message: 'Done.',
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
    error_detail: errorDetail,
  });
}

async function persistAssistantFallback(
  args: RunAgentTurnArgs,
  cause?: unknown
): Promise<void> {
  const admin = createAdminClient();
  await insertTurnProgress(admin, args, {
    stage: 'error',
    message: 'The background turn stopped before it could finish.',
  });
  const { data: existingAssistant } = await admin
    .from('trip_chat_messages')
    .select('id')
    .eq('session_id', args.sessionRowId)
    .eq('turn_index', args.turnIndex)
    .eq('role', 'assistant')
    .maybeSingle();
  if (existingAssistant) return;

  const detail = cause instanceof Error ? cause.message : cause ? String(cause) : '';
  const failure = classifyTurnFailure(detail);

  await admin.from('trip_chat_messages').insert({
    session_id: args.sessionRowId,
    trip_id: args.tripId,
    user_id: args.userId,
    turn_index: args.turnIndex,
    role: 'assistant',
    content: failure.userMessage,
    tool_calls_json: null,
  });
  await admin
    .from('trip_chat_sessions')
    .update({ updated_at: new Date().toISOString() })
    .eq('id', args.sessionRowId);
  await recordTurnUsage({
    supabase: admin,
    sessionRowId: args.sessionRowId,
    tripId: args.tripId,
    userId: args.userId,
    turnIndex: args.turnIndex,
    toolCallCounter: { count: 0 },
    error_detail: detail ? `unhandled: ${detail}` : 'unhandled background turn error',
  });
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
  // The SDK normally locates this on its own in local development. In the
  // Cloudflare backend container we resolve the installed Linux executable
  // directly when possible.
  if (process.env.CLAUDE_CODE_EXECUTABLE) {
    return {
      pathToClaudeCodeExecutable: process.env.CLAUDE_CODE_EXECUTABLE,
      resolveDiagnostic: 'resolved via CLAUDE_CODE_EXECUTABLE',
    };
  }

  if (process.platform === 'linux') {
    const arch = process.arch === 'arm64' ? 'arm64' : 'x64';
    const localExecutable = join(
      process.cwd(),
      'node_modules',
      `@anthropic-ai/claude-agent-sdk-linux-${arch}`,
      'claude'
    );
    if (existsSync(localExecutable)) {
      return {
        pathToClaudeCodeExecutable: localExecutable,
        resolveDiagnostic: `resolved local Linux executable for ${arch}`,
      };
    }
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

async function loadThreadMessages(
  admin: ReturnType<typeof createAdminClient>,
  threadId: string,
  limit: number
): Promise<UiChatMessage[]> {
  const { data: rows } = await admin
    .from('trip_chat_messages')
    .select('id, turn_index, role, content, tool_calls_json, created_at')
    .eq('session_id', threadId)
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

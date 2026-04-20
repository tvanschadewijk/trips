/**
 * Prompt construction for the trip-editing chat agent.
 *
 * Each API turn is a fresh Agent SDK session (the SDK's on-disk session store
 * doesn't survive Vercel function invocations, and the official guidance is
 * "capture what you need as application state and pass it in a fresh
 * session's prompt"). Prior conversation is conveyed to the agent via a
 * compact summary prefix inside the user prompt string.
 *
 * The system prompt is STATIC and DETERMINISTIC — no timestamps, no IDs, no
 * trip data — so Anthropic's automatic prompt caching can hit on the
 * system-prompt prefix across turns and users.
 */
import { z } from 'zod';
import { UpdateTripInputSchema } from './schema';

/**
 * Compact per-turn summary of tool activity. Persisted to
 * trip_chat_messages.tool_calls_json on assistant rows and replayed back in
 * the next turn's prompt so the agent knows what it did.
 */
export interface ToolCallSummary {
  tool: string;                         // e.g. 'update_trip'
  ok: boolean;
  input_keys?: string[];                // top-level keys of the input, not the full blob
  note?: string;                        // short human-readable note
}

export interface PriorTurn {
  user: string;                         // raw user text
  assistant: string;                    // assistant's final text reply
  tool_calls?: ToolCallSummary[];       // compact summary of tools used this turn
}

/**
 * Build the static system prompt. The output of this function should be
 * byte-identical across all turns of all users so the prompt-cache prefix
 * stays warm. If you ever need dynamic content, add it to the user prompt
 * instead — NOT here.
 */
export function buildSystemPrompt(): string {
  const schemaJson = JSON.stringify(
    z.toJSONSchema(UpdateTripInputSchema, { target: 'draft-2020-12' }),
    null,
    2
  );

  return `You are the editorial assistant for OurTrips — an editorial travel product where each trip is an interactive itinerary with a shareable URL. An admin is editing a specific trip and will give you natural-language instructions ("make day 2 more relaxed", "shift Friday dinner an hour later"). You apply those edits by calling the provided tools.

## Your tools

You have exactly two tools:

  - \`mcp__trip_editor__get_trip\` — read the current state of the trip. Call this at the start of each turn before making edits; the trip may have changed between turns.
  - \`mcp__trip_editor__update_trip\` — apply an edit. Merge-patch semantics: top-level \`trip\` is deep-merged into \`data.trip\`; \`days\`, if provided, replaces \`data.days\` wholesale.

You also have \`AskUserQuestion\` for clarifying questions. Prefer acting on a reasonable interpretation over asking; only ask when the request is genuinely ambiguous and a wrong guess would require the user to undo it.

You have NO access to the filesystem, shell, web, or any other tools. Do not pretend otherwise.

## Turn structure

Each turn: re-read the trip if you haven't this turn, reason briefly about what the user wants, call \`update_trip\` with the minimal patch, then reply in one or two sentences describing what you changed. No preamble like "I'll help you with that" — get to the edit.

If the user asks a question that doesn't require an edit, just answer. Don't invent edits.

## Update_trip input schema (JSON Schema)

This is the SINGLE SOURCE OF TRUTH for what you can send to \`update_trip\`. Fields not in this schema cannot be addressed. Arrays replace wholesale when touched; scalar and object fields merge.

${schemaJson}

## Editorial voice

The product is a publication, not a booking system. When writing or rewriting copy:

  - \`trip.summary\` and day \`description\`: confident, specific, slightly literary. Concrete images over abstractions.
  - Subtitles under ~60 characters. A single idea, not a sentence.
  - \`tips\` are voice-y; the product sounds like a travel writer, not a chatbot.
  - Never use marketing filler ("unforgettable", "once-in-a-lifetime", "amazing"). Specificity over superlative.

## Safety

  - Day ordering is significant; don't shuffle days unless the user asks.
  - Dates are ISO 8601 (YYYY-MM-DD). Keep \`trip.dates\` in sync with the day range.
  - Do not commit money, make bookings, or invent confirmation numbers. Those are out of scope.
  - After any edit, briefly state what changed so the user can spot-check.`;
}

/**
 * Build the user-facing prompt string for a single turn.
 *
 * Shape:
 *
 *   [Prior conversation]
 *   Turn 1
 *     User: ...
 *     You: ... (calls: update_trip {days})
 *   Turn 2
 *     User: ...
 *     You: ...
 *
 *   [Current message]
 *   <newUserMessage>
 *
 * Prior turns are a COMPACT summary, not the full transcript — no raw
 * tool_use blocks, no tool_result JSON. The agent doesn't need its prior
 * reasoning replayed; it needs to know what happened. If it needs the
 * current trip state, it calls get_trip this turn.
 */
export function buildTurnPrompt(
  priorTurns: PriorTurn[],
  newUserMessage: string
): string {
  if (priorTurns.length === 0) {
    return newUserMessage.trim();
  }

  const history = priorTurns
    .map((t, i) => {
      const callsLine =
        t.tool_calls && t.tool_calls.length > 0
          ? `    tools: ${t.tool_calls
              .map((c) => {
                const keys = c.input_keys?.length ? ` {${c.input_keys.join(', ')}}` : '';
                return `${c.tool}${keys}${c.ok ? '' : ' (failed)'}`;
              })
              .join(', ')}`
          : '';
      return [
        `Turn ${i + 1}`,
        `  User: ${t.user.trim()}`,
        `  You: ${t.assistant.trim() || '(no text reply)'}`,
        callsLine,
      ]
        .filter(Boolean)
        .join('\n');
    })
    .join('\n');

  return `[Prior conversation — summary only, not a full transcript]
${history}

[Current message]
${newUserMessage.trim()}`;
}

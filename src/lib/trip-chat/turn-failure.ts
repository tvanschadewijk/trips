/**
 * Truthful failure classification for agent turns.
 *
 * Background: when the Agent SDK CLI hits a fatal API problem it emits the
 * error as plain assistant/result text (e.g. "Invalid API key · Fix external
 * API key", "Not logged in · Please run /login") and then the stream throws
 * "Claude Code returned an error result: …". The route used to swallow all
 * of that and write "I hit a connection problem… try again in a moment" —
 * which sent the operator chasing network ghosts while the real cause
 * (a rejected ANTHROPIC_API_KEY in prod, June 2026) sat in a discarded
 * string. Classify instead, tell the truth, and keep the raw detail for
 * trip_chat_usage.error_detail.
 */

export type TurnFailureKind =
  | 'auth_config'
  | 'billing'
  | 'prompt_too_long'
  | 'transient';

export interface TurnFailureClassification {
  kind: TurnFailureKind;
  userMessage: string;
  /** Raw detail for telemetry — never shown verbatim to the user. */
  detail: string;
}

const TRANSIENT_MESSAGE =
  'I hit a connection problem while working on that. Please try again in a moment.';

const MESSAGES: Record<Exclude<TurnFailureKind, 'transient'>, string> = {
  auth_config:
    "I couldn't reach the AI service: the server's Anthropic API key is missing or invalid, so retrying won't help. Site owner: update ANTHROPIC_API_KEY in the Vercel project settings and redeploy.",
  billing:
    'The AI service declined the request because the account is out of credits. Site owner: top up the Anthropic account billing, then try again.',
  prompt_too_long:
    'This conversation has grown too long for me to process in one go. Start a new chat from the sidebar — I can read the trip itself, so nothing is lost.',
};

export function classifyTurnFailure(
  thrownDetail: string,
  cliText?: string
): TurnFailureClassification {
  const haystack = `${thrownDetail}\n${cliText ?? ''}`;

  let kind: TurnFailureKind = 'transient';
  if (
    /invalid api key|fix external api key|not logged in|please run \/login|authentication_error|invalid x-api-key|OAuth token has expired/i.test(
      haystack
    )
  ) {
    kind = 'auth_config';
  } else if (/credit balance|billing|insufficient credit/i.test(haystack)) {
    kind = 'billing';
  } else if (
    /prompt is too long|exceed.{0,30}context|context window|too many tokens/i.test(
      haystack
    )
  ) {
    kind = 'prompt_too_long';
  }

  return {
    kind,
    userMessage: kind === 'transient' ? TRANSIENT_MESSAGE : MESSAGES[kind],
    detail: thrownDetail,
  };
}

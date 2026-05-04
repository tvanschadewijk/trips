export const DEFAULT_CHAT_STATUS_PHASES = [
  'Reading the trip...',
  'Thinking it through...',
  'Drafting an edit...',
  'Almost there...',
] as const;

export const POLICY_RESEARCH_STATUS_PHASES = [
  'Finding the relevant stays...',
  'Checking current policies...',
  'Comparing source details...',
  'Saving concise notes...',
] as const;

const POLICY_RESEARCH_RE = /\b(dog|dogs|pet|pets|policy|policies|allowed|hotel|hotels|stay|stays|accommodation|accommodations)\b/i;

export function getChatStatusPhases(message: string): readonly string[] {
  return POLICY_RESEARCH_RE.test(message)
    ? POLICY_RESEARCH_STATUS_PHASES
    : DEFAULT_CHAT_STATUS_PHASES;
}

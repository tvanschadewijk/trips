/**
 * Thread topic derivation.
 *
 * Two layers, by design:
 *
 *   1. `deriveThreadTitleHeuristic` — pure, instant, always works. Built from
 *      the user's first message plus the view context they were looking at
 *      ("Day 1 · Find a restaurant"). This is what gets stored at thread
 *      creation, so the sidebar never shows an untitled row.
 *
 *   2. `generateThreadTitle` — optional polish via a small, cheap Messages
 *      API call (no Agent SDK subprocess — a title is not agent work). Any
 *      failure (missing key, rejected key, timeout) falls back to the
 *      heuristic, so a broken AI config degrades titles, never threads.
 */

export interface ThreadTitleViewContext {
  slideKind?: string | null;
  day_number?: number | null;
  destination_title?: string | null;
}

const TITLE_MAX_CHARS = 46;
const TITLE_MODEL = 'claude-haiku-4-5-20251001';
const TITLE_TIMEOUT_MS = 5000;

function contextPrefix(ctx: ThreadTitleViewContext | null | undefined): string {
  if (!ctx) return '';
  if (ctx.slideKind === 'day' && typeof ctx.day_number === 'number') {
    return `Day ${ctx.day_number} · `;
  }
  if (ctx.slideKind === 'accommodation_review') {
    return 'Hotels · ';
  }
  return '';
}

/** Collapse whitespace, drop markdown noise, and de-shout ALL-CAPS input. */
function cleanForTitle(message: string): string {
  let text = message.replace(/\s+/g, ' ').replace(/[*_`#>]/g, '').trim();
  if (!text) return '';

  const letters = text.replace(/[^a-zA-ZÀ-ɏ]/g, '');
  const uppercase = letters.replace(/[^A-ZÀ-Þ]/g, '');
  if (letters.length >= 8 && uppercase.length / letters.length > 0.6) {
    text = text.toLowerCase();
  }
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function truncateAtWord(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  const cut = text.slice(0, maxChars + 1);
  const lastSpace = cut.lastIndexOf(' ');
  const head = (lastSpace > maxChars * 0.6 ? cut.slice(0, lastSpace) : cut.slice(0, maxChars))
    .replace(/[\s,.;:!?·-]+$/, '');
  return `${head}…`;
}

export function deriveThreadTitleHeuristic(
  message: string,
  ctx?: ThreadTitleViewContext | null
): string {
  const cleaned = cleanForTitle(message);
  if (!cleaned) return 'New conversation';
  const prefix = contextPrefix(ctx);
  return `${prefix}${truncateAtWord(cleaned, TITLE_MAX_CHARS)}`;
}

/** Strip quotes/trailing periods the model tends to add around short titles. */
function sanitizeModelTitle(raw: string): string {
  const text = raw
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^["'“”‘’„]+|["'“”‘’]+$/g, '')
    .replace(/\.+$/, '')
    .trim();
  if (!text) return '';
  return truncateAtWord(text, 60);
}

export interface GenerateThreadTitleArgs {
  message: string;
  viewContext?: ThreadTitleViewContext | null;
  env?: Record<string, string | undefined>;
  /** Injectable for tests. Defaults to global fetch. */
  fetchImpl?: typeof fetch;
}

/**
 * Best title we can get: LLM polish when the API key works, heuristic
 * otherwise. Never throws.
 */
export async function generateThreadTitle(
  args: GenerateThreadTitleArgs
): Promise<string> {
  const { message, viewContext } = args;
  const heuristic = deriveThreadTitleHeuristic(message, viewContext);

  const env = args.env ?? process.env;
  const apiKey = env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) return heuristic;
  const fetchImpl = args.fetchImpl ?? fetch;

  const contextLine =
    viewContext?.slideKind === 'day' && typeof viewContext.day_number === 'number'
      ? `The user was viewing Day ${viewContext.day_number} of the itinerary.`
      : viewContext?.slideKind === 'accommodation_review'
        ? 'The user was viewing the hotel candidates review board.'
        : 'The user was viewing the trip overview.';

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TITLE_TIMEOUT_MS);
  try {
    // Deliberately api.anthropic.com, not ANTHROPIC_BASE_URL: titles must hit
    // the same account/key the chat agent uses, with no proxy indirection.
    const res = await fetchImpl('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: TITLE_MODEL,
        max_tokens: 32,
        system:
          'Generate a short sidebar title (3-6 words, no quotes, no trailing period) for a travel-planning chat thread. Write it in the language of the user message. When the context names a specific day, start the title with "Day N · ". Reply with the title only.',
        messages: [
          {
            role: 'user',
            content: `${contextLine}\nFirst message of the thread: ${message.slice(0, 600)}`,
          },
        ],
      }),
    });
    if (!res.ok) return heuristic;
    const json = (await res.json()) as {
      content?: Array<{ type: string; text?: string }>;
    };
    const text = (json.content ?? [])
      .filter((c) => c.type === 'text')
      .map((c) => c.text ?? '')
      .join(' ');
    const title = sanitizeModelTitle(text);
    return title || heuristic;
  } catch {
    return heuristic;
  } finally {
    clearTimeout(timer);
  }
}

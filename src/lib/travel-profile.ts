import { z } from 'zod';

const StringField = z.string().trim().max(1200).default('');
const ShortStringField = z.string().trim().max(400).default('');
const StringListField = z.array(z.string().trim().min(1).max(80)).max(24).default([]);

export const TravelProfilePreferencesSchema = z
  .object({
    travelers: ShortStringField,
    home_base: ShortStringField,
    preferred_airports: ShortStringField,
    pace: z.enum(['relaxed', 'balanced', 'full', 'varies']).default('balanced'),
    budget: z.enum(['value', 'mid_range', 'upscale', 'luxury', 'varies']).default('mid_range'),
    lodging: StringListField,
    food: StringListField,
    interests: StringListField,
    transport: StringListField,
    accessibility: StringField,
    pets: ShortStringField,
    avoid: StringField,
    notes: StringField,
  })
  .strict();

export type TravelProfilePreferences = z.infer<typeof TravelProfilePreferencesSchema>;

export type TravelProfileRecord = {
  user_id: string;
  preferences: TravelProfilePreferences;
  reference_markdown: string;
  reference_generated_at: string | null;
  onboarding_completed_at: string | null;
  created_at?: string;
  updated_at?: string;
};

export type TravelProfileSourceReference = {
  id?: string;
  file_name: string | null;
  content_type: string | null;
  extracted_text: string | null;
  status: string;
  created_at?: string | null;
};

export function normalizeTravelProfilePreferences(input: unknown): TravelProfilePreferences {
  return TravelProfilePreferencesSchema.parse(input ?? {});
}

function listLine(label: string, values: string[]): string | null {
  return values.length ? `- ${label}: ${values.join(', ')}` : null;
}

function valueLine(label: string, value: string): string | null {
  return value.trim() ? `- ${label}: ${value.trim()}` : null;
}

function enumLabel(value: string): string {
  return value.replace(/_/g, ' ');
}

function sourceTitle(source: TravelProfileSourceReference, index: number): string {
  return source.file_name?.trim() || `Previous trip ${index + 1}`;
}

function cleanSourceLine(value: string): string {
  return value
    .replace(/\s+/g, ' ')
    .replace(/^[-*#>\s]+/u, '')
    .trim();
}

function truncateText(value: string, maxLength: number): string {
  const trimmed = value.trim();
  if (trimmed.length <= maxLength) return trimmed;
  return `${trimmed.slice(0, maxLength - 1).trimEnd()}...`;
}

function extractSourceSignals(text: string): string[] {
  const keywords = [
    'avoid',
    'booked',
    'budget',
    'favorite',
    'favourite',
    'hotel',
    'liked',
    'loved',
    'pace',
    'prefer',
    'restaurant',
    'skip',
    'train',
  ];

  const lines = text
    .split(/\r?\n/u)
    .map(cleanSourceLine)
    .filter((line) => line.length >= 12 && line.length <= 220);

  const keywordLines = lines.filter((line) => {
    const lower = line.toLowerCase();
    return keywords.some((keyword) => lower.includes(keyword));
  });

  const candidates = keywordLines.length ? keywordLines : lines;
  return Array.from(new Set(candidates)).slice(0, 6);
}

function buildSourceSection(sources: TravelProfileSourceReference[]): string[] {
  const readySources = sources
    .filter((source) => source.status === 'ready' && source.extracted_text?.trim())
    .slice(0, 8);

  if (!readySources.length) return [];

  const lines = [
    '',
    '## Previous Trip References',
    'Use these as evidence of past travel style. Treat them as preference signals, not fixed requirements.',
  ];

  readySources.forEach((source, index) => {
    const text = source.extracted_text ?? '';
    const signals = extractSourceSignals(text);
    const fallbackExcerpt = truncateText(cleanSourceLine(text), 700);
    lines.push('', `### ${sourceTitle(source, index)}`);
    if (source.content_type) lines.push(`- Source type: ${source.content_type}`);
    if (signals.length) {
      lines.push('- Signals:');
      signals.forEach((signal) => lines.push(`  - ${truncateText(signal, 180)}`));
    } else if (fallbackExcerpt) {
      lines.push(`- Excerpt: ${fallbackExcerpt}`);
    }
  });

  return lines;
}

export function buildTravelReferenceMarkdown(
  preferences: TravelProfilePreferences,
  sources: TravelProfileSourceReference[] = []
): string {
  const lines = [
    '# Travel Profile',
    '',
    'Use this as durable preference context when planning a new OurTrips itinerary. It reflects user-stated preferences, not hard constraints unless phrased as must/avoid.',
    '',
    '## Core',
    valueLine('Travelers', preferences.travelers),
    valueLine('Home base', preferences.home_base),
    valueLine('Preferred airports or stations', preferences.preferred_airports),
    `- Preferred pace: ${enumLabel(preferences.pace)}`,
    `- Budget posture: ${enumLabel(preferences.budget)}`,
    '',
    '## Travel Style',
    listLine('Lodging preferences', preferences.lodging),
    listLine('Food preferences', preferences.food),
    listLine('Interests', preferences.interests),
    listLine('Transport preferences', preferences.transport),
    '',
    '## Practical Constraints',
    valueLine('Accessibility or mobility', preferences.accessibility),
    valueLine('Pets', preferences.pets),
    valueLine('Avoid', preferences.avoid),
    valueLine('Other notes', preferences.notes),
    ...buildSourceSection(sources),
  ]
    .filter((line): line is string => line !== null)
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return `${lines}\n`;
}

export function profileIsComplete(profile: TravelProfileRecord | null | undefined): boolean {
  return Boolean(profile?.onboarding_completed_at);
}

export function compactTravelProfileForPrompt(profile: TravelProfileRecord | null | undefined): string {
  if (!profile) return 'No travel profile has been completed yet.';
  const reference = profile.reference_markdown.trim();
  if (reference) return reference.slice(0, 6000);
  return buildTravelReferenceMarkdown(profile.preferences).slice(0, 6000);
}

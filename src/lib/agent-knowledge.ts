import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import matter from 'gray-matter';

export interface KnowledgeConcept {
  id: string;
  relativePath: string;
  absolutePath: string;
  type: string;
  title: string;
  description?: string;
  tags: string[];
  intents: string[];
  tools: string[];
  completionChecks: string[];
  country?: string;
  coverage?: string;
  body: string;
  frontmatter: Record<string, unknown>;
}

export interface KnowledgeBundle {
  root: string;
  concepts: KnowledgeConcept[];
  byId: Map<string, KnowledgeConcept>;
}

export interface KnowledgeRoutingIntent {
  kind: string;
  city?: string;
  country?: string;
}

export interface KnowledgeRouteInput {
  message?: string;
  intents?: KnowledgeRoutingIntent[];
  toolNames?: string[];
  root?: string;
}

export interface RoutedKnowledge {
  concepts: KnowledgeConcept[];
  completionChecks: string[];
  countries: string[];
}

export interface KnowledgeValidationIssue {
  file: string;
  message: string;
}

const RESERVED_FILENAMES = new Set(['index.md', 'log.md']);
const DEFAULT_KNOWLEDGE_ROOT = join(process.cwd(), 'knowledge');
const CONCEPT_BODY_LIMIT = 1400;
const TOTAL_CONTEXT_LIMIT = 11000;

const INTENT_DOCS: Record<string, string[]> = {
  confirm_accommodation_booking: [
    'core/intent-ledger-and-completion-audit',
    'ourtrips/tool-use-context',
    'ourtrips/mutation-semantics',
    'travel/accommodation-confirmation/playbook',
  ],
  restaurant_recommendation: [
    'core/intent-ledger-and-completion-audit',
    'core/source-verification',
    'ourtrips/tool-use-context',
    'travel/restaurant-reservations/playbook',
  ],
  restaurant_reservation_channel: [
    'core/intent-ledger-and-completion-audit',
    'core/source-verification',
    'ourtrips/tool-use-context',
    'travel/restaurant-reservations/playbook',
    'travel/restaurant-reservations/platform-registry',
  ],
  selected_restaurant: [
    'core/intent-ledger-and-completion-audit',
    'core/source-verification',
    'ourtrips/tool-use-context',
    'travel/restaurant-reservations/playbook',
    'travel/restaurant-reservations/platform-registry',
  ],
  date_change: [
    'core/intent-ledger-and-completion-audit',
    'ourtrips/tool-use-context',
    'ourtrips/mutation-semantics',
  ],
  research_request: [
    'core/intent-ledger-and-completion-audit',
    'core/source-verification',
  ],
};

const TOOL_DOCS: Record<string, string[]> = {
  booking_link_restaurant: [
    'core/source-verification',
    'travel/restaurant-reservations/playbook',
    'travel/restaurant-reservations/platform-registry',
  ],
  mcp__trip_editor__booking_link_restaurant: [
    'core/source-verification',
    'travel/restaurant-reservations/playbook',
    'travel/restaurant-reservations/platform-registry',
  ],
  update_accommodation: [
    'ourtrips/mutation-semantics',
    'travel/accommodation-confirmation/playbook',
  ],
  mcp__trip_editor__update_accommodation: [
    'ourtrips/mutation-semantics',
    'travel/accommodation-confirmation/playbook',
  ],
  promote_accommodation_candidate: [
    'ourtrips/mutation-semantics',
    'travel/accommodation-confirmation/playbook',
  ],
  mcp__trip_editor__promote_accommodation_candidate: [
    'ourtrips/mutation-semantics',
    'travel/accommodation-confirmation/playbook',
  ],
};

const COUNTRY_NAME_HINTS: Array<[RegExp, string]> = [
  [/\b(?:the\s+)?netherlands\b|\bholland\b/iu, 'NL'],
  [/\bgermany\b|\bdeutschland\b/iu, 'DE'],
  [/\bfrance\b/iu, 'FR'],
  [/\bserbia\b/iu, 'RS'],
];

const CITY_COUNTRY_HINTS: Array<[RegExp, string]> = [
  [/\bamsterdam\b|\brotterdam\b|\butrecht\b|\bthe hague\b|\bden haag\b/iu, 'NL'],
  [/\bberlin\b|\bmunich\b|\bmunchen\b|\bhamburg\b|\bcologne\b|\bkoln\b|\bfrankfurt\b/iu, 'DE'],
  [/\bparis\b|\blyon\b|\bmarseille\b|\bbordeaux\b|\bnice\b|\blille\b/iu, 'FR'],
  [/\bnovi sad\b|\bbelgrade\b|\bbeograd\b|\bnis\b/iu, 'RS'],
];

const bundleCache = new Map<string, KnowledgeBundle>();

function isReservedMarkdown(relativePath: string): boolean {
  const filename = relativePath.split('/').at(-1);
  return filename ? RESERVED_FILENAMES.has(filename) : false;
}

function collectMarkdownFiles(root: string, dir = root): string[] {
  const entries = readdirSync(dir);
  const files: string[] = [];

  for (const entry of entries) {
    const absolute = join(dir, entry);
    const stats = statSync(absolute);
    if (stats.isDirectory()) {
      files.push(...collectMarkdownFiles(root, absolute));
    } else if (entry.endsWith('.md')) {
      files.push(absolute);
    }
  }

  return files;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function asStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .filter((item): item is string => typeof item === 'string')
      .map((item) => item.trim())
      .filter(Boolean);
  }
  if (typeof value === 'string' && value.trim()) {
    return [value.trim()];
  }
  return [];
}

function readKnowledgeConcept(root: string, absolutePath: string): KnowledgeConcept | null {
  const relativePath = relative(root, absolutePath).replace(/\\/g, '/');
  if (isReservedMarkdown(relativePath)) return null;

  const parsed = matter(readFileSync(absolutePath, 'utf8'));
  const frontmatter = parsed.data as Record<string, unknown>;
  const id = relativePath.replace(/\.md$/u, '');
  const type = asString(frontmatter.type) ?? '';
  const title = asString(frontmatter.title) ?? id.split('/').at(-1) ?? id;

  return {
    id,
    relativePath,
    absolutePath,
    type,
    title,
    description: asString(frontmatter.description),
    tags: asStringArray(frontmatter.tags),
    intents: asStringArray(frontmatter.intents),
    tools: asStringArray(frontmatter.tools),
    completionChecks: asStringArray(frontmatter.completion_checks),
    country: asString(frontmatter.country)?.toUpperCase(),
    coverage: asString(frontmatter.coverage),
    body: parsed.content.trim(),
    frontmatter,
  };
}

export function loadKnowledgeBundle(root = DEFAULT_KNOWLEDGE_ROOT): KnowledgeBundle {
  const cached = bundleCache.get(root);
  if (cached) return cached;

  if (!existsSync(root)) {
    const empty: KnowledgeBundle = { root, concepts: [], byId: new Map() };
    bundleCache.set(root, empty);
    return empty;
  }

  const concepts = collectMarkdownFiles(root)
    .map((file) => readKnowledgeConcept(root, file))
    .filter((concept): concept is KnowledgeConcept => concept !== null)
    .sort((a, b) => a.id.localeCompare(b.id));
  const byId = new Map(concepts.map((concept) => [concept.id, concept]));
  const bundle = { root, concepts, byId };
  bundleCache.set(root, bundle);
  return bundle;
}

export function clearKnowledgeBundleCache(): void {
  bundleCache.clear();
}

export function validateKnowledgeBundle(root = DEFAULT_KNOWLEDGE_ROOT): KnowledgeValidationIssue[] {
  if (!existsSync(root)) {
    return [{ file: root, message: 'Knowledge root does not exist.' }];
  }

  const issues: KnowledgeValidationIssue[] = [];
  for (const absolutePath of collectMarkdownFiles(root)) {
    const relativePath = relative(root, absolutePath).replace(/\\/g, '/');
    if (isReservedMarkdown(relativePath)) continue;

    try {
      const parsed = matter(readFileSync(absolutePath, 'utf8'));
      const type = asString((parsed.data as Record<string, unknown>).type);
      if (!type) {
        issues.push({ file: relativePath, message: 'Missing required OKF frontmatter field: type.' });
      }
    } catch (err) {
      issues.push({
        file: relativePath,
        message: err instanceof Error ? err.message : 'Could not parse Markdown frontmatter.',
      });
    }
  }

  return issues;
}

function addConceptId(ids: string[], id: string): void {
  if (!ids.includes(id)) ids.push(id);
}

function addConceptIds(ids: string[], nextIds: string[] | undefined): void {
  for (const id of nextIds ?? []) {
    addConceptId(ids, id);
  }
}

function routeCountries(input: KnowledgeRouteInput): string[] {
  const haystack = [
    input.message,
    ...(input.intents ?? []).flatMap((intent) => [intent.city, intent.country]),
  ]
    .filter((item): item is string => typeof item === 'string')
    .join(' ');

  const countries: string[] = [];
  for (const [pattern, country] of [...COUNTRY_NAME_HINTS, ...CITY_COUNTRY_HINTS]) {
    if (pattern.test(haystack) && !countries.includes(country)) {
      countries.push(country);
    }
  }

  return countries;
}

function hasRestaurantIntent(input: KnowledgeRouteInput): boolean {
  return (input.intents ?? []).some((intent) => intent.kind.startsWith('restaurant_'))
    || (input.toolNames ?? []).some((toolName) => toolName.includes('booking_link_restaurant'));
}

export function routeAgentKnowledge(input: KnowledgeRouteInput): RoutedKnowledge {
  const bundle = loadKnowledgeBundle(input.root);
  const ids: string[] = [];

  for (const intent of input.intents ?? []) {
    addConceptIds(ids, INTENT_DOCS[intent.kind]);
  }

  for (const toolName of input.toolNames ?? []) {
    addConceptIds(ids, TOOL_DOCS[toolName]);
  }

  const countries = routeCountries(input);
  if (hasRestaurantIntent(input)) {
    for (const country of countries) {
      addConceptId(ids, `travel/restaurant-reservations/countries/${country}`);
    }
  }

  const concepts = ids
    .map((id) => bundle.byId.get(id))
    .filter((concept): concept is KnowledgeConcept => concept !== undefined);
  const completionChecks = [
    ...new Set(concepts.flatMap((concept) => concept.completionChecks)),
  ];

  return { concepts, completionChecks, countries };
}

function trimBody(body: string, limit: number): string {
  if (body.length <= limit) return body;
  const trimmed = body.slice(0, limit);
  const lastBreak = trimmed.lastIndexOf('\n#');
  const safe = lastBreak > Math.floor(limit * 0.45)
    ? trimmed.slice(0, lastBreak).trimEnd()
    : trimmed.trimEnd();
  return `${safe}\n\n[Excerpt trimmed]`;
}

function conceptFormatPriority(concept: KnowledgeConcept): number {
  if (concept.country) return 0;
  if (concept.id.startsWith('travel/')) return 1;
  if (concept.id.startsWith('core/')) return 2;
  if (concept.id.startsWith('ourtrips/')) return 3;
  return 4;
}

export function formatAgentKnowledgeContext(route: RoutedKnowledge): string {
  if (route.concepts.length === 0) return '';

  const concepts = [...route.concepts].sort((a, b) => {
    const priority = conceptFormatPriority(a) - conceptFormatPriority(b);
    return priority === 0 ? a.id.localeCompare(b.id) : priority;
  });
  const sections: string[] = [
    '[Routed task knowledge - follow these OKF playbooks and references when applicable]',
  ];

  sections.push([
    'Routed concepts:',
    ...concepts.map((concept) => `- ${concept.title} (${concept.id})`),
  ].join('\n'));

  if (route.countries.length > 0) {
    sections.push(`Country context detected: ${route.countries.join(', ')}`);
  }

  if (route.completionChecks.length > 0) {
    sections.push([
      'Completion checks from routed knowledge:',
      ...route.completionChecks.map((check) => `- ${check}`),
    ].join('\n'));
  }

  let totalLength = sections.join('\n\n').length;
  for (const concept of concepts) {
    const frontmatter = [
      `id: ${concept.id}`,
      `type: ${concept.type}`,
      concept.description ? `description: ${concept.description}` : null,
      concept.country ? `country: ${concept.country}` : null,
      concept.coverage ? `coverage: ${concept.coverage}` : null,
    ]
      .filter(Boolean)
      .join('\n');
    const body = trimBody(concept.body, CONCEPT_BODY_LIMIT);
    const section = `## ${concept.title}\n${frontmatter}\n\n${body}`;
    if (totalLength + section.length > TOTAL_CONTEXT_LIMIT) {
      sections.push('[Additional routed knowledge omitted to keep the turn prompt compact]');
      break;
    }
    sections.push(section);
    totalLength += section.length;
  }

  sections.push(
    'Knowledge completion rule: before the final reply, reconcile the deterministic intent ledger and these knowledge completion checks against the tools used and the answer drafted.'
  );

  return `${sections.join('\n\n')}\n`;
}

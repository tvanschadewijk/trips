import type { Block, Day, Meal, Transport, TripData } from './types';

export type TripImagePromptKey = 'cover_portrait' | 'cover_landscape' | 'social_og';

export interface TripImagePromptSpec {
  key: TripImagePromptKey;
  label: string;
  aspectRatio: string;
  recommendedSize: string;
  prompt: string;
}

export type TripImagePromptSet = Record<TripImagePromptKey, TripImagePromptSpec>;

const MAX_STOPS = 14;
const MAX_DAILY_CUES = 12;
const MAX_FOOD_CUES = 8;
const MAX_STAY_CUES = 8;

function cleanText(value: string | undefined | null): string {
  return (value ?? '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function truncate(value: string, max = 140): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max - 1).trimEnd()}...`;
}

function addUnique(values: string[], next: string | undefined | null, limit = Infinity): void {
  const cleaned = cleanText(next);
  if (!cleaned || values.length >= limit) return;
  const normalized = cleaned.toLocaleLowerCase();
  if (values.some((value) => value.toLocaleLowerCase() === normalized)) return;
  values.push(cleaned);
}

function splitRouteLikeText(value: string): string[] {
  return cleanText(value)
    .split(/\s*(?:→|->|–>|—>| to )\s*/i)
    .map((part) => part.replace(/^(day\s+\d+[:.\-\s]*)/i, '').trim())
    .filter(Boolean);
}

function collectStops(data: TripData): string[] {
  const stops: string[] = [];

  for (const day of data.days) {
    for (const part of splitRouteLikeText(day.title)) {
      addUnique(stops, part, MAX_STOPS);
    }
    addUnique(stops, day.subtitle, MAX_STOPS);

    for (const transport of day.transport ?? []) {
      addUnique(stops, transport.from, MAX_STOPS);
      addUnique(stops, transport.to, MAX_STOPS);
    }
  }

  return stops;
}

function summarizeTransport(transport: Transport): string {
  const mode = cleanText(transport.mode || transport.label || 'journey');
  const fromTo = [transport.from, transport.to].map(cleanText).filter(Boolean).join(' to ');
  const distance = cleanText(transport.distance);
  const duration = cleanText(transport.duration);
  return [mode, fromTo, distance || duration].filter(Boolean).join(' - ');
}

function blockCue(block: Block): string | null {
  const title = cleanText(block.detail?.title);
  const content = cleanText(block.content);
  const type = cleanText(block.type);
  if (!title && !content) return null;
  return [type && type !== 'activity' ? type : null, title || content].filter(Boolean).join(': ');
}

function mealCue(meal: Meal): string {
  return [meal.type, meal.name, meal.detail?.cuisine].map(cleanText).filter(Boolean).join(' - ');
}

function collectDailyCues(days: Day[]): string[] {
  const cues: string[] = [];

  for (const day of days) {
    const blockCues = (day.blocks ?? [])
      .map(blockCue)
      .filter((cue): cue is string => !!cue)
      .slice(0, 2);
    const transportCues = (day.transport ?? []).map(summarizeTransport).filter(Boolean).slice(0, 1);
    const cue = [
      `Day ${day.day_number}`,
      cleanText(day.title),
      cleanText(day.subtitle || day.description),
      [...transportCues, ...blockCues].join('; '),
    ].filter(Boolean).join(' - ');
    addUnique(cues, truncate(cue, 220), MAX_DAILY_CUES);
  }

  return cues;
}

function collectFoodCues(days: Day[]): string[] {
  const cues: string[] = [];
  for (const day of days) {
    for (const meal of day.meals ?? []) {
      addUnique(cues, mealCue(meal), MAX_FOOD_CUES);
    }
  }
  return cues;
}

function collectStayCues(days: Day[]): string[] {
  const cues: string[] = [];
  for (const day of days) {
    const stay = day.accommodation;
    if (!stay?.name) continue;
    addUnique(cues, stay.name, MAX_STAY_CUES);
  }
  return cues;
}

function lineList(values: string[], emptyFallback: string): string {
  if (!values.length) return `- ${emptyFallback}`;
  return values.map((value) => `- ${value}`).join('\n');
}

function buildItineraryBrief(data: TripData): string {
  const stops = collectStops(data);
  const dailyCues = collectDailyCues(data.days);
  const foodCues = collectFoodCues(data.days);
  const stayCues = collectStayCues(data.days);
  const trip = data.trip;

  return [
    `Trip: ${cleanText(trip.name)}`,
    trip.subtitle ? `Subtitle mood: ${cleanText(trip.subtitle)}` : null,
    trip.summary ? `Editorial summary: ${truncate(cleanText(trip.summary), 260)}` : null,
    `Dates: ${trip.dates.start} to ${trip.dates.end}`,
    '',
    'Route and main stops:',
    lineList(stops, 'Use the itinerary route as the main visual structure.'),
    '',
    'Daily story cues:',
    lineList(dailyCues, 'Show a coherent road-trip journey with distinct landscapes.'),
    '',
    'Food and stay cues:',
    lineList([...foodCues, ...stayCues], 'Keep food and stay details subtle and atmospheric.'),
  ].filter((value): value is string => value !== null).join('\n');
}

function basePrompt(data: TripData): string {
  return `Create a premium editorial travel-cover image for the OurTrips app: a hyper-detailed cinematic miniature relief map of this specific trip, shown as a handcrafted floating island landscape suspended in soft warm clouds.

The image should feel like a tactile luxury travel magazine cover: carved terrain, paper-map texture, warm natural light, realistic miniature towns, coastlines, mountains, forests, lakes, farmland, bridges, roads, ferries, tiny vehicles, and subtle environmental storytelling.

Focus on the actual itinerary route, not the entire country. Show the trip path as a tasteful terracotta route line winding through the landscape, with small visual cues for the main overnight stops, scenic drives, memorable landmarks, food moments, and nature highlights. Each stop should feel distinct through landscape and architecture, but avoid fictional landmarks.

No readable text, no map labels, no logos, no watermark. Do not include UI, app screens, typography, or floating callout labels.

Style: warm paper tones, natural color, cinematic but restrained, editorial travel poster, realistic miniature craftsmanship, shallow atmospheric depth, high detail, premium, elegant, not fantasy, not sci-fi, no neon glow.

Use this itinerary brief as grounding:
${buildItineraryBrief(data)}`;
}

function promptFor(data: TripData, key: TripImagePromptKey): TripImagePromptSpec {
  const shared = basePrompt(data);

  if (key === 'cover_portrait') {
    return {
      key,
      label: 'Mobile cover',
      aspectRatio: '9:16',
      recommendedSize: '1080x1920',
      prompt: `${shared}

Composition: 9:16 vertical mobile app hero. Use a strong central route silhouette, with most miniature detail in the top and middle. Keep the lower 35% calmer, atmospheric, and less contrasty so the app title, subtitle, and warm paper summary card remain readable over the image. Avoid important landmarks at the extreme edges because the image may be cropped slightly on phones.`,
    };
  }

  if (key === 'cover_landscape') {
    return {
      key,
      label: 'Desktop cover',
      aspectRatio: '3:2',
      recommendedSize: '1536x1024',
      prompt: `${shared}

Composition: 3:2 horizontal desktop hero image. This will sit as a large photographic stage beside editorial text, so make the route readable across the full frame with generous breathing room at the edges. Keep the center and right-center visually rich, with softer cloud and paper texture toward the far left so responsive cropping still feels intentional.`,
    };
  }

  return {
    key,
    label: 'Social / OG image',
    aspectRatio: '1.91:1',
    recommendedSize: '1200x630',
    prompt: `${shared}

Composition: 1.91:1 horizontal social-share image. Make it instantly legible at small preview sizes: one clear floating-island silhouette, one tasteful terracotta route line, and a few larger recognizable trip cues instead of many tiny equal-weight details. Leave enough calm negative space that OurTrips can place editorial title text next to or over the image in an Open Graph layout.`,
  };
}

export function buildTripImagePromptSet(data: TripData): TripImagePromptSet {
  return {
    cover_portrait: promptFor(data, 'cover_portrait'),
    cover_landscape: promptFor(data, 'cover_landscape'),
    social_og: promptFor(data, 'social_og'),
  };
}

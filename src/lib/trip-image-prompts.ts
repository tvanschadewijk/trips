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

const MAX_STOPS = 18;
const MAX_DAILY_CUES = 12;
const MAX_FOOD_CUES = 8;
const MAX_STAY_CUES = 8;

interface JourneyMap {
  homeStops: string[];
  primaryStops: string[];
  transportCues: string[];
  transportModes: string[];
  walkingStages: string[];
  journeyThemes: string[];
}

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

function includesAny(value: string, needles: string[]): boolean {
  const normalized = value.toLocaleLowerCase();
  return needles.some((needle) => normalized.includes(needle));
}

function looksLikeStandalonePlaceLabel(value: string): boolean {
  const cleaned = cleanText(value);
  if (!cleaned) return false;
  const words = cleaned.split(/\s+/);
  if (words.length > 4) return false;
  return !includesAny(cleaned, [
    'arrival',
    'departure',
    'beach day',
    'free day',
    'rest day',
    'explore',
    'walking day',
    'hiking day',
    'travel day',
  ]);
}

function splitRouteLikeText(value: string): string[] {
  const cleaned = cleanText(value);
  if (!cleaned) return [];
  if (!/(?:→|->|–>|—>|\s+to\s+)/i.test(cleaned)) {
    return looksLikeStandalonePlaceLabel(cleaned) ? [cleaned] : [];
  }
  return cleaned
    .split(/\s*(?:→|->|–>|—>| to )\s*/i)
    .map((part) => part.replace(/^(day\s+\d+[:.\-\s]*)/i, '').trim())
    .filter(Boolean);
}

function normalizeTransportMode(modeOrLabel: string): string {
  const value = cleanText(modeOrLabel).toLocaleLowerCase();
  if (includesAny(value, ['train', 'rail', 'eurostar', 'sleeper'])) return 'train';
  if (includesAny(value, ['walk', 'hike', 'trek', 'trail', 'way'])) return 'walking';
  if (includesAny(value, ['flight', 'plane', 'air'])) return 'flight';
  if (includesAny(value, ['ferry', 'boat'])) return 'ferry';
  if (includesAny(value, ['car', 'drive', 'road'])) return 'road';
  if (includesAny(value, ['bus', 'coach'])) return 'bus';
  return value || 'journey';
}

function isWalkingDay(day: Day): boolean {
  const haystack = [
    day.title,
    day.subtitle,
    day.description,
    ...(day.blocks ?? []).flatMap((block) => [block.type, block.content, block.detail?.title]),
    ...(day.stats ?? []).flatMap((stat) => [stat.label, stat.value]),
  ].map(cleanText).join(' ');
  return includesAny(haystack, ['walk', 'walking', 'hike', 'hiking', 'trek', 'trail', 'west highland way']);
}

function routeLabel(parts: string[]): string {
  return parts.filter(Boolean).join(' -> ');
}

function collectJourneyThemes(data: TripData, transportModes: string[]): string[] {
  const haystack = [
    data.trip.name,
    data.trip.subtitle,
    data.trip.summary,
    ...data.days.flatMap((day) => [
      day.title,
      day.subtitle,
      day.description,
      day.accommodation?.name,
      ...(day.blocks ?? []).flatMap((block) => [block.type, block.content, block.detail?.title, block.detail?.vibe]),
      ...(day.tips ?? []).flatMap((tip) => [tip.title, tip.content]),
    ]),
  ].map(cleanText).join(' ');
  const themes: string[] = [];

  if (transportModes.includes('road') || includesAny(haystack, ['road trip', 'drive', 'driving', 'rental car'])) {
    addUnique(themes, 'road-trip route');
  }
  if (transportModes.includes('train') || includesAny(haystack, ['rail', 'train', 'eurostar'])) {
    addUnique(themes, 'rail journey');
  }
  if (transportModes.includes('walking') || includesAny(haystack, ['walk', 'hike', 'trail', 'trek', 'way'])) {
    addUnique(themes, 'walking or hiking trail');
  }
  if (transportModes.includes('ferry') || includesAny(haystack, ['ferry', 'boat', 'island hop', 'island hopping'])) {
    addUnique(themes, 'island or ferry journey');
  }
  if (includesAny(haystack, ['beach', 'coast', 'coastal', 'sea', 'surf', 'snorkel', 'resort', 'villa', 'island'])) {
    addUnique(themes, 'coastal or beach holiday');
  }
  if (includesAny(haystack, ['city', 'museum', 'neighborhood', 'neighbourhood', 'market', 'restaurant', 'gallery'])) {
    addUnique(themes, 'city and culture stay');
  }
  if (!themes.length) addUnique(themes, 'place-led travel itinerary');

  return themes;
}

function collectJourneyMap(data: TripData): JourneyMap {
  const routeStops: string[] = [];
  const transportCues: string[] = [];
  const transportModes: string[] = [];
  const walkingStages: string[] = [];
  const firstRouteParts = splitRouteLikeText(data.days[0]?.title ?? '');
  const firstTransport = data.days[0]?.transport?.find((transport) => transport.from && transport.to);
  const inferredHome = cleanText(firstTransport?.from) || firstRouteParts[0] || '';

  for (const day of data.days) {
    const titleParts = splitRouteLikeText(day.title);
    for (const part of titleParts) {
      addUnique(routeStops, part, MAX_STOPS);
    }

    for (const transport of day.transport ?? []) {
      addUnique(routeStops, transport.from, MAX_STOPS);
      addUnique(routeStops, transport.to, MAX_STOPS);
      const mode = normalizeTransportMode(`${transport.mode} ${transport.label}`);
      addUnique(transportModes, mode);
      const fromTo = [transport.from, transport.to].map(cleanText).filter(Boolean);
      if (fromTo.length) {
        addUnique(transportCues, `${mode}: ${routeLabel(fromTo)}`, MAX_DAILY_CUES);
      }
    }

    if (isWalkingDay(day)) {
      const stageParts = titleParts.length >= 2 ? titleParts : [];
      const stage = stageParts.length >= 2
        ? `Day ${day.day_number}: ${routeLabel(stageParts)}`
        : `Day ${day.day_number}: ${cleanText(day.title) || 'walking stage'}`;
      addUnique(walkingStages, stage, MAX_DAILY_CUES);
      addUnique(transportModes, 'walking');
    }
  }

  const journeyThemes = collectJourneyThemes(data, transportModes);
  const homeStops: string[] = [];
  if (inferredHome) addUnique(homeStops, inferredHome, 1);
  const primaryStops = routeStops.filter(
    (stop) => !homeStops.some((home) => home.toLocaleLowerCase() === stop.toLocaleLowerCase())
  );

  return {
    homeStops,
    primaryStops: primaryStops.length ? primaryStops : routeStops,
    transportCues,
    transportModes,
    walkingStages,
    journeyThemes,
  };
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
  const journey = collectJourneyMap(data);
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
    'Home/departure context label, if useful:',
    lineList(journey.homeStops, 'No home/departure label needed.'),
    '',
    'Primary destination, stay, or excursion labels to render on the map:',
    lineList(journey.primaryStops, 'Add short, readable labels only for true itinerary places, stay bases, or excursions.'),
    '',
    'Journey type and visual emphasis:',
    lineList(journey.journeyThemes, 'Adapt the map to the actual trip style.'),
    '',
    'Transport cues to respect:',
    lineList(journey.transportCues, 'Use only transport forms explicitly present in the itinerary.'),
    '',
    'Transport modes present:',
    lineList(journey.transportModes, 'Do not invent vehicles; follow the itinerary.'),
    '',
    'Walking or hiking stages to visualize:',
    lineList(journey.walkingStages, 'No multi-day walking stages found.'),
    '',
    'Daily story cues:',
    lineList(dailyCues, 'Show a coherent trip story with distinct landscapes, stay bases, or excursion moments.'),
    '',
    'Food and stay cues:',
    lineList([...foodCues, ...stayCues], 'Keep food and stay details subtle and atmospheric.'),
  ].filter((value): value is string => value !== null).join('\n');
}

function basePrompt(data: TripData): string {
  return `Create a premium editorial travel-cover image for the OurTrips app: a hyper-detailed cinematic miniature relief map of this specific trip, shown as a handcrafted floating island landscape suspended in soft warm clouds.

The image should feel like a tactile luxury travel magazine cover: carved terrain, paper-map texture, warm natural light, realistic miniature towns, coastlines, beaches, mountains, forests, lakes, farmland, bridges, roads, railways, ferries, tiny vehicles when relevant, and subtle environmental storytelling.

Adapt the visual structure to the actual trip type. A roadtrip should read as a road journey, a rail trip as a railway route, a hiking trip as trail stages, an island hop as ferries and islands, a city break as clustered neighborhoods, and a beach holiday as a calm stay base with nearby beaches or excursions. Do not force mountains, roads, trains, planes, or dense route lines when the itinerary does not support them.

Focus on the actual itinerary geography, not the entire country. Show the trip path, stay base, or excursion structure as appropriate, with small visual cues for the main overnight stops, scenic transfers, walking stages, memorable landmarks, beach or nature moments, food moments, and cultural highlights. Each real destination or stay base should feel distinct through landscape and architecture, but avoid fictional landmarks.

OurTrips Experience crop safety: compose the complete miniature map as an inner poster inside the image, not edge-to-edge. The full floating island, route, stay base, trail, or beach composition must sit comfortably within the central safe area with generous soft-cloud / warm-paper bleed around it. Keep all destination labels, route dots, vehicles, landmarks, and key storytelling details away from the outer edge so nothing important is lost when the app displays the image with responsive cover cropping.

Add small, legible labels beside every major itinerary place from the "Primary destination, stay, or excursion labels to render on the map" list. Treat them like elegant printed cartography: tiny cream paper flags or engraved map labels, connected subtly to route dots, stay bases, beaches, trailheads, or excursion points, using only the exact names from the itinerary. The home/departure context label is optional and must be smaller, quieter, and visually secondary if shown at all; it should not compete with the actual trip stops. Keep labels concise and readable, with no extra fictional place names. No logos, no watermark, no app UI, and no unrelated typography.

Respect the transport cues exactly. Do not show airplanes on train legs. Do not replace a train, ferry, road transfer, or walking stage with an airplane. Only show an airplane when the itinerary explicitly contains a flight leg; if flight appears only as a return leg, keep the airplane small and peripheral near the return edge of the map. Train legs should look like rail journeys, and walking or hiking days should appear as footpaths or dotted trail stages with visible stage markers.

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

Composition: 9:16 vertical mobile app hero. Use a strong central journey composition: route silhouette, stay-base cluster, island chain, trail spine, or beach-and-excursion layout depending on the itinerary. The complete illustrated map should fit inside the central 72% width and upper-to-middle 62% of the frame, with the outer margins acting as atmospheric bleed only. Keep most miniature detail in the top and middle, but leave clear breathing room above the highest landmark and beside the widest labels. Keep the lower 35% calmer, atmospheric, and less contrasty so the app title, subtitle, and warm paper summary card remain readable over the image. Avoid important landmarks at the extreme edges because the image may be cropped slightly on phones.`,
    };
  }

  if (key === 'cover_landscape') {
    return {
      key,
      label: 'Desktop cover',
      aspectRatio: '3:2',
      recommendedSize: '1536x1024',
      prompt: `${shared}

Composition: 3:2 horizontal desktop hero image. This will sit as a large photographic stage beside editorial text, so make the trip structure readable across the full frame with generous breathing room at the edges. Keep the complete miniature map inside a centered safe area with extra cloud / paper bleed on every side, especially left and right, so desktop cover cropping never cuts off labels or the island silhouette. Keep the center and right-center visually rich, with softer cloud and paper texture toward the far left so responsive cropping still feels intentional.`,
    };
  }

  return {
    key,
    label: 'Social / OG image',
    aspectRatio: '1.91:1',
    recommendedSize: '1200x630',
    prompt: `${shared}

Composition: 1.91:1 horizontal social-share image. Make it instantly legible at small preview sizes: one clear floating-island silhouette, one simple route line, trail path, ferry chain, stay-base cluster, or beach setting depending on the itinerary, and a few larger recognizable trip cues instead of many tiny equal-weight details. Keep the island and labels safely inside the center with generous bleed around the edges. Leave enough calm negative space that OurTrips can place editorial title text next to or over the image in an Open Graph layout.`,
  };
}

export function buildTripImagePromptSet(data: TripData): TripImagePromptSet {
  return {
    cover_portrait: promptFor(data, 'cover_portrait'),
    cover_landscape: promptFor(data, 'cover_landscape'),
    social_og: promptFor(data, 'social_og'),
  };
}

import type { Accommodation, Day, Meal } from './types';
import {
  buildDayRouteMapSearchText,
  routePlaceTextMatches,
  type TripRouteAtlas,
  type TripRouteAtlasLeg,
  type TripRouteAtlasPoint,
} from './trip-route';

export interface ItineraryMapPointDetail {
  title?: string;
  kicker?: string;
  body?: string;
}

export interface ItineraryMapPoiSearchTarget {
  id: string;
  label: string;
  query?: string;
  kind?: 'place' | 'poi';
  role?: TripRouteAtlasPoint['role'];
  detail?: ItineraryMapPointDetail;
  proximity?: [number, number];
  bbox?: [number, number, number, number];
  placeType?: string;
  fallbackPoint?: {
    lat: number;
    lng: number;
    source?: TripRouteAtlasPoint['source'];
  };
}

export type DayMapData = {
  atlas?: TripRouteAtlas;
  details?: Record<string, ItineraryMapPointDetail>;
  searchTargets: ItineraryMapPoiSearchTarget[];
};

export const EMPTY_DAY_MAP_ATLAS: TripRouteAtlas = {
  points: [],
  legs: [],
  modes: [],
  bounds: {
    minLat: 0,
    maxLat: 0,
    minLng: 0,
    maxLng: 0,
  },
};

function boundsForAtlasPoints(points: TripRouteAtlas['points']): TripRouteAtlas['bounds'] {
  return {
    minLat: Math.min(...points.map((point) => point.lat)),
    maxLat: Math.max(...points.map((point) => point.lat)),
    minLng: Math.min(...points.map((point) => point.lng)),
    maxLng: Math.max(...points.map((point) => point.lng)),
  };
}

function normalizeRouteSearchText(value: string | undefined): string {
  return (value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function routeTextMentionsPoint(dayText: string, label: string): boolean {
  const normalizedLabel = normalizeRouteSearchText(label);
  if (normalizedLabel.length < 4) return false;
  if (routePlaceTextMatches(dayText, label)) return true;

  return normalizedLabel
    .split(' ')
    .some((word) => word.length >= 5 && ` ${dayText} `.includes(` ${word} `));
}

function routeTextIncludesExactPoint(dayText: string, label: string): boolean {
  return routePlaceTextMatches(dayText, label);
}

function truncateMapDetail(value: string | undefined): string {
  const text = (value ?? '').replace(/\s+/g, ' ').trim();
  if (text.length <= 150) return text;
  return `${text.slice(0, 147).replace(/\s+\S*$/, '')}...`;
}

function snippetsForPoint(day: Day, label: string): string[] {
  const candidates = [
    ...(day.transport ?? []).flatMap((transport) => [
      transport.label,
      transport.from && transport.to ? `${transport.mode}: ${transport.from} to ${transport.to}` : undefined,
      transport.detail?.route,
    ]),
    ...(day.blocks ?? []).flatMap((block) => [
      block.detail?.title,
      block.content,
      block.detail?.body,
      block.detail?.why,
    ]),
    ...(day.meals ?? []).flatMap((meal) => [meal.name, meal.note]),
    ...(day.tips ?? []).flatMap((tip) => [tip.title, tip.content]),
  ].filter((value): value is string => Boolean(value));

  return candidates
    .filter((value) => routeTextMentionsPoint(normalizeRouteSearchText(value), label))
    .map(truncateMapDetail)
    .filter(Boolean)
    .slice(0, 2);
}

function accommodationLocationSearchText(day: Day): string {
  const accommodation = day.accommodation;
  if (!isMapSpecificAccommodation(accommodation)) return '';

  return [
    accommodation.name,
    accommodation.detail?.title,
    accommodation.detail?.address,
  ].filter(Boolean).join(' ');
}

function accommodationIdentity(day: Day): string {
  const accommodation = day.accommodation;
  if (!accommodation) return `day-${day.day_number}`;

  return normalizeRouteSearchText([
    accommodation.name,
    accommodation.detail?.address,
  ].filter(Boolean).join(' ')) || `day-${day.day_number}`;
}

function destinationTitleText(day: Day): string {
  const title = day.title.replace(/[–—]/g, '->');
  const parts = title
    .split(/\s*(?:→|->)\s*/)
    .map((part) => part.trim())
    .filter(Boolean);

  return parts.length > 1 ? parts[parts.length - 1] : day.title;
}

function stayDestinationSearchText(day: Day): string {
  return [
    destinationTitleText(day),
    ...(day.transport ?? []).slice(-1).flatMap((transport) => [transport.to]),
  ].filter(Boolean).join(' ');
}

function daySortTime(day: Day): number {
  const parsed = Date.parse(`${day.date}T12:00:00`);
  return Number.isFinite(parsed) ? parsed : day.day_number;
}

function isConsecutiveStayDay(previous: Day, next: Day): boolean {
  if (next.day_number === previous.day_number + 1) return true;

  const previousTime = daySortTime(previous);
  const nextTime = daySortTime(next);
  return Math.round((nextTime - previousTime) / 86400000) === 1;
}

function positiveNightCount(nights: number | undefined): number | undefined {
  if (typeof nights !== 'number' || !Number.isFinite(nights) || nights <= 0) return undefined;
  return Math.round(nights);
}

function nightCountForStayGroup(group: Day[]): number {
  const declaredCounts = group
    .map((day) => positiveNightCount(day.accommodation?.nights))
    .filter((count): count is number => count !== undefined);

  const largestDeclaredCount = declaredCounts.length ? Math.max(...declaredCounts) : 0;
  if (largestDeclaredCount > 1) return largestDeclaredCount;

  return Math.max(1, group.length);
}

function nightsForRoutePoint(point: TripRouteAtlasPoint, days: Day[]): number {
  if (point.role === 'home') return 0;

  const matchingDays = days
    .filter((day) => (
      isMapSpecificAccommodation(day.accommodation)
      && (
        routePlaceTextMatches(accommodationLocationSearchText(day), point.label)
        || routePlaceTextMatches(stayDestinationSearchText(day), point.label)
      )
    ))
    .sort((a, b) => daySortTime(a) - daySortTime(b));

  let total = 0;
  let currentGroup: Day[] = [];

  for (const day of matchingDays) {
    const previous = currentGroup[currentGroup.length - 1];
    const sameStay = previous && accommodationIdentity(previous) === accommodationIdentity(day);

    if (!previous || (sameStay && isConsecutiveStayDay(previous, day))) {
      currentGroup.push(day);
      continue;
    }

    total += nightCountForStayGroup(currentGroup);
    currentGroup = [day];
  }

  if (currentGroup.length) total += nightCountForStayGroup(currentGroup);
  return total;
}

export function mapPointDetailsForDay(atlas: TripRouteAtlas | undefined, day: Day): Record<string, ItineraryMapPointDetail> | undefined {
  if (!atlas) return undefined;

  return Object.fromEntries(atlas.points.map((point) => {
    const snippets = snippetsForPoint(day, point.label);
    return [
      point.id,
      {
        title: point.label,
        kicker: `Day ${day.day_number}`,
        body: snippets.join(' · ') || truncateMapDetail(day.subtitle || day.description_title || day.description || day.title),
      },
    ];
  }));
}

export function mapPointDetailsForTrip(atlas: TripRouteAtlas | undefined, days: Day[]): Record<string, ItineraryMapPointDetail> | undefined {
  if (!atlas) return undefined;

  return Object.fromEntries(atlas.points.map((point) => {
    const day = point.day ? days.find((candidate) => candidate.day_number === point.day) : undefined;
    const nights = nightsForRoutePoint(point, days);
    const nightLabel = nights === 1 ? '1 night' : nights > 1 ? `${nights} nights` : undefined;
    return [
      point.id,
      {
        title: point.label,
        kicker: nightLabel ?? (day ? `Day ${day.day_number}` : point.role === 'home' ? 'Start / finish' : 'Route stop'),
        body: day ? truncateMapDetail(day.title || day.subtitle || day.description_title || day.description) : '',
      },
    ];
  }));
}

function dayMapSearchProximity(atlas: TripRouteAtlas | undefined): [number, number] | undefined {
  if (!atlas?.points.length) return undefined;
  return [
    (atlas.bounds.minLng + atlas.bounds.maxLng) / 2,
    (atlas.bounds.minLat + atlas.bounds.maxLat) / 2,
  ];
}

function dayMapSearchBbox(atlas: TripRouteAtlas | undefined): [number, number, number, number] | undefined {
  if (!atlas?.points.length) return undefined;
  const lngSpan = Math.max(0.12, atlas.bounds.maxLng - atlas.bounds.minLng);
  const latSpan = Math.max(0.10, atlas.bounds.maxLat - atlas.bounds.minLat);
  const lngPad = Math.min(Math.max(lngSpan * 0.35, 0.08), 0.8);
  const latPad = Math.min(Math.max(latSpan * 0.35, 0.06), 0.8);
  return [
    Math.max(-180, atlas.bounds.minLng - lngPad),
    Math.max(-90, atlas.bounds.minLat - latPad),
    Math.min(180, atlas.bounds.maxLng + lngPad),
    Math.min(90, atlas.bounds.maxLat + latPad),
  ];
}

function mapSearchContext(day: Day, atlas: TripRouteAtlas | undefined, contextLabels: string[] = []): string {
  const routeLabels = atlas?.points
    .filter((point) => point.role !== 'home')
    .map((point) => point.label)
    .slice(0, 3) ?? [];
  return uniquePlaceLabels([...routeLabels, ...contextLabels, day.title]).join(' ');
}

function normalizeMapSearchLabel(value: string): string {
  return normalizeRouteSearchText(value);
}

const NON_PLACE_STARTS = /^(?:drive|arrive|settle|keep|use|prepare|choose|pick|repeat|book|confirm|target|board|charge|optional|slow|early|easy|short|long|sleep|rest|relax|pack)\b/i;
const NON_PLACE_WORDS = /\b(?:wander|walk|time|choice|option|reset|arrival|positioning|recovery|buffer|shade|shaded|morning|afternoon|evening|night|day|route|drive|dinner|lunch|breakfast|old-town|family|familie|gezin|kids|kinderen|children|parents|ouders|solo|uitslapen|zwembad|pool|thuis|home|blijft|sleep|sleeps|sleeping|nap|rest|rust|relax|chill|siesta|laundry|packing|gravelrit|bike|ride|cycling|fietstocht)\b/i;
const GENERIC_MEAL_WORDS = /\b(?:breakfast|brunch|lunch|dinner|meal|seafood|pizza|pasta|casual|easy|local|nearby|trabucco|style|option|choice|tasting|snack|picnic)\b/i;
const AUDIENCE_LABEL_PREFIX = /^(?:family|familie|gezin|kids|kinderen|children|parents|ouders|mom|mum|dad|mama|papa|solo|sunny|tjeerd)\s*[:：]\s*/i;
const GENERIC_LABEL_PREFIX = /^(?:activity|visit|sight|stop|morning|afternoon|evening|ochtend|middag|avond|lunch|dinner)\s*[:：]\s*/i;
const PLACE_CUE_WORDS = /\b(?:abbey|acropolis|airport|aquarium|arena|baai|bar|basilica|bay|beach|cala|camp|camping|castle|castell|cathedral|cave|center|centre|church|colosseum|fort|gallery|garden|harbor|harbour|hotel|lake|lago|marina|market|monastery|mont|monte|mount|museum|museo|palace|palazzo|parc|park|piazza|plaza|playa|port|resort|restaurant|ridge|rijksmuseum|square|station|tower|trail|valley|villa|village|vineyard|winery)\b/i;
const DIRECTIONAL_PLACE_PATTERN = /\b(?:naar|to|towards?|richting|visit(?:ing)?|bezoek(?:en)?|explore|see|at|bij)\s+(?:(?:the|de|het|la|le|el|l['’])\s+)?([A-ZÀ-Þ][^.;:!?()]{2,72})/giu;

function cleanPotentialPlaceLabel(value: string): string {
  return value
    .trim()
    .replace(/^[•*-]\s*/, '')
    .replace(/\s*\([^)]*\)\s*/g, ' ')
    .replace(/\s+-\s+.*$/, '')
    .replace(/\s+(?:with|for|near|around|voor|nabij|bij|rond|met)\b.*$/i, '')
    .replace(/\.$/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function stripLabelPrefix(value: string): { label: string; hadAudiencePrefix: boolean } {
  const label = cleanPotentialPlaceLabel(value);
  const audienceMatch = label.match(AUDIENCE_LABEL_PREFIX);
  if (audienceMatch) {
    return {
      label: cleanPotentialPlaceLabel(label.slice(audienceMatch[0].length)),
      hadAudiencePrefix: true,
    };
  }

  const genericMatch = label.match(GENERIC_LABEL_PREFIX);
  if (genericMatch) {
    return {
      label: cleanPotentialPlaceLabel(label.slice(genericMatch[0].length)),
      hadAudiencePrefix: false,
    };
  }

  return { label, hadAudiencePrefix: false };
}

function titleCasePlaceWordCount(label: string): number {
  return label
    .split(/\s+/)
    .filter((word) => /^[A-ZÀ-Þ][\p{L}'’.-]{2,}$/u.test(word))
    .length;
}

function looksLikePlaceLabel(value: string, options: { allowSingleWord?: boolean } = {}): boolean {
  const { label, hadAudiencePrefix } = stripLabelPrefix(value);
  if (label.length < 3 || label.length > 72) return false;
  if (NON_PLACE_STARTS.test(label)) return false;
  if (!/[A-ZÀ-Þ]/.test(label)) return false;
  const words = label.split(/\s+/).filter(Boolean);
  if (words.length > 7) return false;
  if (NON_PLACE_WORDS.test(label)) return false;
  if (PLACE_CUE_WORDS.test(label)) return true;

  const namedWords = titleCasePlaceWordCount(label);
  if (namedWords >= 2) return true;
  if (options.allowSingleWord && !hadAudiencePrefix && namedWords === 1 && words.length === 1 && label.length >= 5) return true;

  return false;
}

function extractDirectionalPlaceLabels(value: string): string[] {
  const labels: string[] = [];
  for (const match of value.matchAll(DIRECTIONAL_PLACE_PATTERN)) {
    const label = cleanPotentialPlaceLabel(match[1]);
    if (looksLikePlaceLabel(label, { allowSingleWord: true })) labels.push(label);
  }
  return labels;
}

function uniquePlaceLabels(labels: string[]): string[] {
  const seen = new Set<string>();
  return labels.filter((label) => {
    const normalized = normalizeMapSearchLabel(label);
    if (!normalized || seen.has(normalized)) return false;
    seen.add(normalized);
    return true;
  });
}

function explicitFallbackPoint(place: { lat?: number; lng?: number } | undefined): ItineraryMapPoiSearchTarget['fallbackPoint'] {
  if (!place || typeof place.lat !== 'number' || typeof place.lng !== 'number') return undefined;
  if (!Number.isFinite(place.lat) || !Number.isFinite(place.lng)) return undefined;
  return { lat: place.lat, lng: place.lng, source: 'stored' };
}

function isPlaceholderAccommodationName(value: string): boolean {
  const normalized = normalizeMapSearchLabel(value);
  return (
    normalized === '' ||
    normalized === 'hotel not confirmed yet' ||
    normalized === 'hotel pending' ||
    normalized === 'accommodation pending' ||
    normalized === 'to be confirmed' ||
    normalized === 'tbc' ||
    normalized === 'tbd'
  );
}

function looksLikeAccommodationSearch(value: string): boolean {
  const normalized = normalizeMapSearchLabel(value);
  return /\b(?:search|shortlist|shortlisted|options?|candidates?|proposals?|alternatives?|to be chosen|choose later)\b/.test(normalized);
}

function isMapSpecificAccommodation(accommodation: Accommodation | undefined | null): accommodation is Accommodation {
  if (!accommodation) return false;
  const name = accommodation.name?.trim();
  if (!name || isPlaceholderAccommodationName(name)) return false;
  if (accommodation.detail?.address) return true;
  return !looksLikeAccommodationSearch(name);
}

function looksLikeSpecificMeal(meal: Meal): boolean {
  const label = meal.name.trim();
  if (meal.place?.name) return true;
  if (meal.detail?.address) return true;
  if (!looksLikePlaceLabel(label, { allowSingleWord: true })) return false;
  if (GENERIC_MEAL_WORDS.test(label)) return false;

  const namedWords = label
    .split(/\s+/)
    .filter((word) => /^[A-ZÀ-Þ][\p{L}'’-]{2,}$/u.test(word));

  return namedWords.length >= 1 || /\b(?:ristorante|trattoria|osteria|bistro|bar|cafe|café|taverna|auberge)\b/i.test(label);
}

function splitPotentialPlaceLabels(value: string | undefined): string[] {
  if (!value) return [];
  const cleanedValue = value
    .replace(/[–—]/g, ' - ')
    .replace(/\s+(?:if|only if|rather than|depending on|as heat|as crowds|before over|after over)\b.*$/i, '')
    .replace(/\s+with\s+.*$/i, '')
    .replace(/\s+or\s+switch\b.*$/i, '')
    .trim();
  const { label: cleaned } = stripLabelPrefix(cleanedValue);
  if (!cleaned) return [];

  const directLabels = cleaned
    .split(/\s*(?:,|;|\/|\+|\band\b|\bor\b|\ben\b)\s*/i)
    .map((part) => part.trim().replace(/\.$/, ''))
    .filter((label) => looksLikePlaceLabel(label));

  return uniquePlaceLabels([
    ...directLabels,
    ...extractDirectionalPlaceLabels(cleaned),
  ]);
}

function matchingAtlasPoint(atlas: TripRouteAtlas | undefined, label: string): TripRouteAtlasPoint | undefined {
  if (!atlas?.points.length) return undefined;
  const normalized = normalizeMapSearchLabel(label);

  return atlas.points.find((point) => normalizeMapSearchLabel(point.label) === normalized)
    ?? atlas.points.find((point) => routePlaceTextMatches(label, point.label) || routePlaceTextMatches(point.label, label));
}

function approximateAtlasPoint(atlas: TripRouteAtlas | undefined, index: number): ItineraryMapPoiSearchTarget['fallbackPoint'] {
  if (!atlas?.points.length) return undefined;

  const lat = (atlas.bounds.minLat + atlas.bounds.maxLat) / 2;
  const lng = (atlas.bounds.minLng + atlas.bounds.maxLng) / 2;
  const angle = (index * 137.508 * Math.PI) / 180;
  const radius = 0.006 + Math.floor(index / 6) * 0.004;
  const lngScale = Math.max(Math.cos((lat * Math.PI) / 180), 0.35);

  return {
    lat: lat + Math.sin(angle) * radius,
    lng: lng + (Math.cos(angle) * radius) / lngScale,
    source: 'derived',
  };
}

function queryWithContext(label: string, context: string, address?: string, queryPrefix?: string): string {
  return [
    queryPrefix ? `${queryPrefix} ${label}` : label,
    address,
    context,
  ].filter(Boolean).join(', ');
}

function accommodationDetail(accommodation: Accommodation | undefined | null, dayNumber: number): ItineraryMapPointDetail | undefined {
  if (!isMapSpecificAccommodation(accommodation)) return undefined;
  return {
    title: accommodation.name,
    kicker: `Day ${dayNumber} · Hotel`,
    body: truncateMapDetail(accommodation.note || accommodation.detail?.why || accommodation.detail?.body || accommodation.detail?.address),
  };
}

function addDayMapTarget(
  targets: ItineraryMapPoiSearchTarget[],
  seen: Set<string>,
  day: Day,
  atlas: TripRouteAtlas | undefined,
  label: string | undefined,
  kind: ItineraryMapPoiSearchTarget['kind'],
  role: ItineraryMapPoiSearchTarget['role'],
  detail: ItineraryMapPointDetail,
  options: {
    queryPrefix?: string;
    address?: string;
    placeType?: string;
    fallbackPoint?: ItineraryMapPoiSearchTarget['fallbackPoint'];
    contextLabels?: string[];
  } = {}
) {
  if (!label) return;
  const trimmed = label.trim().replace(/\.$/, '');
  if (!trimmed) return;
  const normalized = normalizeMapSearchLabel(trimmed);
  if (normalized.length < 3) return;
  for (const existing of [...seen]) {
    if (existing.includes(normalized)) return;
    if (normalized.includes(existing)) {
      seen.delete(existing);
      const targetIndex = targets.findIndex((target) => normalizeMapSearchLabel(target.label) === existing);
      if (targetIndex >= 0) targets.splice(targetIndex, 1);
    }
  }

  seen.add(normalized);
  const context = mapSearchContext(day, atlas, options.contextLabels);
  const fallbackPoint = options.fallbackPoint
    ?? matchingAtlasPoint(atlas, [trimmed, options.address].filter(Boolean).join(' '))
    ?? approximateAtlasPoint(atlas, targets.length);
  targets.push({
    id: `day-${day.day_number}-poi-${targets.length}-${normalized.replace(/\s+/g, '-')}`,
    label: trimmed,
    query: queryWithContext(trimmed, context, options.address, options.queryPrefix).trim(),
    kind,
    role,
    detail,
    proximity: dayMapSearchProximity(atlas),
    bbox: dayMapSearchBbox(atlas),
    placeType: options.placeType,
    fallbackPoint: fallbackPoint
      ? {
          lat: fallbackPoint.lat,
          lng: fallbackPoint.lng,
          source: fallbackPoint.source,
        }
      : undefined,
  });
}

export function buildDayMapSearchTargets(
  day: Day,
  atlas: TripRouteAtlas | undefined,
  previousDay?: Day,
  contextLabels: string[] = []
): ItineraryMapPoiSearchTarget[] {
  const targets: ItineraryMapPoiSearchTarget[] = [];
  const seen = new Set<string>();
  const previousStayDetail = accommodationDetail(previousDay?.accommodation, day.day_number);

  if (previousStayDetail) {
    addDayMapTarget(targets, seen, day, atlas, previousDay?.accommodation?.name, 'poi', 'stay', previousStayDetail, {
      address: previousDay?.accommodation?.detail?.address,
      placeType: 'lodging',
      queryPrefix: 'Hotel',
      contextLabels,
    });
  }

  for (const [index, transport] of (day.transport ?? []).entries()) {
    if (index === 0 && !previousStayDetail) {
      addDayMapTarget(targets, seen, day, atlas, transport.from, 'place', 'home', {
        title: transport.from,
        kicker: `Day ${day.day_number} · Route`,
        body: truncateMapDetail(transport.label || transport.duration),
      });
    }
    addDayMapTarget(targets, seen, day, atlas, transport.to, 'place', 'stop', {
      title: transport.to,
      kicker: `Day ${day.day_number} · Route`,
      body: truncateMapDetail(transport.label || transport.duration),
    });
  }

  if (isMapSpecificAccommodation(day.accommodation)) {
    addDayMapTarget(targets, seen, day, atlas, day.accommodation.name, 'poi', 'stay', {
      title: day.accommodation.name,
      kicker: `Day ${day.day_number} · Hotel`,
      body: truncateMapDetail(day.accommodation.note || day.accommodation.detail?.why || day.accommodation.detail?.body || day.accommodation.detail?.address),
    }, {
      address: day.accommodation.detail?.address,
      placeType: 'lodging',
      queryPrefix: 'Hotel',
      contextLabels,
    });
  }

  for (const block of day.blocks ?? []) {
    if (block.place?.name) {
      addDayMapTarget(targets, seen, day, atlas, block.place.name, 'poi', 'excursion', {
        title: block.place.name,
        kicker: `Day ${day.day_number} · Sight`,
        body: truncateMapDetail(block.place.note || block.detail?.why || block.detail?.body || block.content),
      }, {
        address: block.place.address,
        fallbackPoint: explicitFallbackPoint(block.place),
        placeType: 'tourist_attraction',
        contextLabels,
      });
      continue;
    }

    const contentLabels = splitPotentialPlaceLabels(block.content);
    const labels = [
      ...contentLabels,
      ...(contentLabels.length ? [] : splitPotentialPlaceLabels(block.detail?.title)),
    ];
    for (const label of labels) {
      addDayMapTarget(targets, seen, day, atlas, label, 'poi', 'excursion', {
        title: label,
        kicker: `Day ${day.day_number} · Sight`,
        body: truncateMapDetail(block.detail?.why || block.detail?.body || block.content),
      }, {
        placeType: 'tourist_attraction',
        contextLabels,
      });
    }
  }

  for (const meal of day.meals ?? []) {
    if (!looksLikeSpecificMeal(meal)) continue;
    const mealLabel = meal.place?.name ?? meal.name;
    addDayMapTarget(targets, seen, day, atlas, mealLabel, 'poi', 'stop', {
      title: mealLabel,
      kicker: `Day ${day.day_number} · ${meal.type}`,
      body: truncateMapDetail(meal.note || meal.detail?.why || meal.detail?.body || meal.detail?.address),
    }, {
      address: meal.place?.address ?? meal.detail?.address,
      fallbackPoint: explicitFallbackPoint(meal.place),
      placeType: 'restaurant',
      queryPrefix: 'Restaurant',
      contextLabels,
    });
  }

  return targets.slice(0, 10);
}

function buildAtlasFromSearchTargets(
  targets: ItineraryMapPoiSearchTarget[],
  dayNumber: number
): TripRouteAtlas | undefined {
  const points = targets
    .map((target, index): TripRouteAtlasPoint | undefined => {
      if (!target.fallbackPoint) return undefined;
      return {
        id: target.id,
        index,
        label: target.label,
        lat: target.fallbackPoint.lat,
        lng: target.fallbackPoint.lng,
        day: dayNumber,
        role: target.role ?? 'stop',
        source: target.fallbackPoint.source ?? 'derived',
      };
    })
    .filter((point): point is TripRouteAtlasPoint => Boolean(point));

  if (!points.length) return undefined;

  return {
    points,
    legs: [],
    modes: [],
    bounds: boundsForAtlasPoints(points),
  };
}

function mapPointDetailsForTargets(targets: ItineraryMapPoiSearchTarget[]): Record<string, ItineraryMapPointDetail> | undefined {
  if (!targets.length) return undefined;

  return Object.fromEntries(targets.map((target) => [
    target.id,
    {
      title: target.detail?.title ?? target.label,
      kicker: target.detail?.kicker,
      body: target.detail?.body,
    },
  ]));
}

function buildAtlasFromSelection(
  atlas: TripRouteAtlas,
  selectedIndices: number[],
  dayNumber: number
): TripRouteAtlas | undefined {
  if (!selectedIndices.length) return undefined;

  const oldToNew = new Map<number, number>();
  const points = selectedIndices.map((oldIndex, newIndex) => {
    const point = atlas.points[oldIndex];
    oldToNew.set(oldIndex, newIndex);
    return {
      ...point,
      id: `day-${dayNumber}-${newIndex}-${point.id}`,
      index: newIndex,
    };
  });

  let legs: TripRouteAtlasLeg[] = atlas.legs
    .filter((leg) => oldToNew.has(leg.from) && oldToNew.has(leg.to))
    .map((leg) => ({
      ...leg,
      from: oldToNew.get(leg.from)!,
      to: oldToNew.get(leg.to)!,
    }));

  if (!legs.length && points.length > 1) {
    legs = points.slice(1).map((point, index) => ({
      from: index,
      to: index + 1,
      day: dayNumber,
      label: point.label,
      mode: point.modeFromPrevious ?? point.mode ?? 'route',
    }));
  }

  return {
    points,
    legs,
    modes: [...new Set(legs.map((leg) => leg.mode))],
    bounds: boundsForAtlasPoints(points),
  };
}

export function buildDayRouteAtlas(atlas: TripRouteAtlas | undefined, day: Day): TripRouteAtlas | undefined {
  if (!atlas) return undefined;

  const dayNumber = day.day_number;
  const selected = new Set<number>();
  atlas.points.forEach((point, index) => {
    if (point.day === dayNumber) selected.add(index);
  });

  if (!selected.size) {
    const dayText = buildDayRouteMapSearchText(day);
    atlas.points.forEach((point, index) => {
      if (routeTextIncludesExactPoint(dayText, point.label)) selected.add(index);
    });
  }

  return buildAtlasFromSelection(atlas, [...selected].sort((a, b) => a - b), dayNumber);
}

export function buildDayMapDataByNumber(routeAtlas: TripRouteAtlas | undefined, days: Day[], contextLabels: string[] = []): Record<number, DayMapData> {
  const mapData: Record<number, DayMapData> = {};

  days.forEach((day, index) => {
    const dayRouteAtlas = buildDayRouteAtlas(routeAtlas, day);
    const searchTargets = buildDayMapSearchTargets(day, dayRouteAtlas ?? routeAtlas, days[index - 1], contextLabels);
    const searchTargetAtlas = buildAtlasFromSearchTargets(searchTargets, day.day_number);
    const atlas = searchTargetAtlas ?? dayRouteAtlas;
    mapData[day.day_number] = {
      atlas,
      details: searchTargetAtlas ? mapPointDetailsForTargets(searchTargets) : mapPointDetailsForDay(atlas, day),
      searchTargets,
    };
  });

  return mapData;
}

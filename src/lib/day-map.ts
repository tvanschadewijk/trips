import type { Accommodation, Day, Meal } from './types';
import { isConfirmedAccommodation } from './trip-status';
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

function accommodationSearchText(day: Day): string {
  const accommodation = day.accommodation;
  if (!isConfirmedAccommodation(accommodation)) return '';

  return [
    accommodation.name,
    accommodation.note,
    accommodation.detail?.title,
    accommodation.detail?.address,
    accommodation.detail?.body,
    accommodation.detail?.why,
  ].filter(Boolean).join(' ');
}

function nightsForRoutePoint(point: TripRouteAtlasPoint, days: Day[]): number {
  if (point.role === 'home') return 0;

  return days.reduce((total, day) => {
    if (!isConfirmedAccommodation(day.accommodation)) return total;
    if (!routePlaceTextMatches(accommodationSearchText(day), point.label)) return total;
    return total + Math.max(1, day.accommodation.nights ?? 1);
  }, 0);
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
        body: snippets.join(' · ') || truncateMapDetail(day.subtitle || day.description || day.title),
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
        body: day ? truncateMapDetail(day.title || day.subtitle || day.description) : '',
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

function mapSearchContext(day: Day, atlas: TripRouteAtlas | undefined): string {
  const routeLabels = atlas?.points
    .filter((point) => point.role !== 'home')
    .map((point) => point.label)
    .slice(0, 3) ?? [];
  return [...routeLabels, day.title].join(' ');
}

function normalizeMapSearchLabel(value: string): string {
  return normalizeRouteSearchText(value);
}

const NON_PLACE_STARTS = /^(?:drive|arrive|settle|keep|use|prepare|choose|pick|repeat|book|confirm|target|board|charge|optional|slow|early|easy|short|long)\b/i;
const NON_PLACE_WORDS = /\b(?:wander|walk|time|choice|option|reset|arrival|positioning|recovery|buffer|shade|shaded|morning|afternoon|evening|night|day|route|drive|dinner|lunch|breakfast|old-town)\b/i;
const GENERIC_MEAL_WORDS = /\b(?:breakfast|brunch|lunch|dinner|meal|seafood|pizza|pasta|casual|easy|local|nearby|trabucco|style|option|choice|tasting|snack|picnic)\b/i;

function looksLikePlaceLabel(value: string): boolean {
  const label = value.trim().replace(/\.$/, '');
  if (label.length < 3 || label.length > 72) return false;
  if (NON_PLACE_STARTS.test(label)) return false;
  if (!/[A-ZÀ-Þ]/.test(label)) return false;
  const words = label.split(/\s+/).filter(Boolean);
  if (words.length > 7) return false;
  if (NON_PLACE_WORDS.test(label)) return false;
  return true;
}

function looksLikeSpecificMeal(meal: Meal): boolean {
  const label = meal.name.trim();
  if (meal.detail?.address) return true;
  if (!looksLikePlaceLabel(label)) return false;
  if (GENERIC_MEAL_WORDS.test(label)) return false;

  const namedWords = label
    .split(/\s+/)
    .filter((word) => /^[A-ZÀ-Þ][\p{L}'’-]{2,}$/u.test(word));

  return namedWords.length >= 2 || /\b(?:ristorante|trattoria|osteria|bistro|bar|cafe|café|taverna|auberge)\b/i.test(label);
}

function splitPotentialPlaceLabels(value: string | undefined): string[] {
  if (!value) return [];
  const cleaned = value
    .replace(/[–—]/g, ' - ')
    .replace(/\s+(?:if|only if|rather than|depending on|as heat|as crowds|before over|after over)\b.*$/i, '')
    .replace(/\s+with\s+.*$/i, '')
    .replace(/\s+or\s+switch\b.*$/i, '')
    .trim();

  return cleaned
    .split(/\s*(?:,|;|\/|\+|\band\b|\bor\b)\s*/i)
    .map((part) => part.trim().replace(/\.$/, ''))
    .filter(looksLikePlaceLabel);
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
  if (!isConfirmedAccommodation(accommodation) || !accommodation?.name) return undefined;
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
  const context = mapSearchContext(day, atlas);
  const fallbackPoint = matchingAtlasPoint(atlas, [trimmed, options.address].filter(Boolean).join(' '))
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
  previousDay?: Day
): ItineraryMapPoiSearchTarget[] {
  const targets: ItineraryMapPoiSearchTarget[] = [];
  const seen = new Set<string>();
  const previousStayDetail = accommodationDetail(previousDay?.accommodation, day.day_number);

  if (previousStayDetail) {
    addDayMapTarget(targets, seen, day, atlas, previousDay?.accommodation?.name, 'poi', 'stay', previousStayDetail, {
      address: previousDay?.accommodation?.detail?.address,
      placeType: 'lodging',
      queryPrefix: 'Hotel',
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

  if (isConfirmedAccommodation(day.accommodation) && day.accommodation?.name) {
    addDayMapTarget(targets, seen, day, atlas, day.accommodation.name, 'poi', 'stay', {
      title: day.accommodation.name,
      kicker: `Day ${day.day_number} · Hotel`,
      body: truncateMapDetail(day.accommodation.note || day.accommodation.detail?.why || day.accommodation.detail?.body || day.accommodation.detail?.address),
    }, {
      address: day.accommodation.detail?.address,
      placeType: 'lodging',
      queryPrefix: 'Hotel',
    });
  }

  for (const block of day.blocks ?? []) {
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
      });
    }
  }

  for (const meal of day.meals ?? []) {
    if (!looksLikeSpecificMeal(meal)) continue;
    addDayMapTarget(targets, seen, day, atlas, meal.name, 'poi', 'stop', {
      title: meal.name,
      kicker: `Day ${day.day_number} · ${meal.type}`,
      body: truncateMapDetail(meal.note || meal.detail?.why || meal.detail?.body || meal.detail?.address),
    }, {
      address: meal.detail?.address,
      placeType: 'restaurant',
      queryPrefix: 'Restaurant',
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

export function buildDayMapDataByNumber(routeAtlas: TripRouteAtlas | undefined, days: Day[]): Record<number, DayMapData> {
  const mapData: Record<number, DayMapData> = {};

  days.forEach((day, index) => {
    const dayRouteAtlas = buildDayRouteAtlas(routeAtlas, day);
    const searchTargets = buildDayMapSearchTargets(day, dayRouteAtlas ?? routeAtlas, days[index - 1]);
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

import type { Day, Transport, TripData, TripRoutePoint, TripRoutePointRole } from './types';

export interface TripRouteAtlasPoint extends TripRoutePoint {
  id: string;
  index: number;
  source: 'stored' | 'derived';
  modeFromPrevious?: string;
}

export interface TripRouteAtlasLeg {
  from: number;
  to: number;
  mode: string;
  day?: number;
  label?: string;
}

export interface TripRouteAtlas {
  points: TripRouteAtlasPoint[];
  legs: TripRouteAtlasLeg[];
  modes: string[];
  bounds: {
    minLat: number;
    maxLat: number;
    minLng: number;
    maxLng: number;
  };
}

interface GazetteerEntry {
  label: string;
  lat: number;
  lng: number;
  aliases: string[];
  role?: TripRoutePointRole;
}

interface CandidatePoint {
  label: string;
  lat: number;
  lng: number;
  day?: number;
  modeFromPrevious?: string;
  role?: TripRoutePointRole;
  source: 'stored' | 'derived';
}

const GAZETTEER: GazetteerEntry[] = [
  { label: 'Amsterdam', lat: 52.3676, lng: 4.9041, aliases: ['amsterdam', 'amsterdam centraal'], role: 'home' },
  { label: 'London', lat: 51.5072, lng: -0.1276, aliases: ['london', 'london st pancras', 'st pancras'] },
  { label: 'Antwerp', lat: 51.2194, lng: 4.4025, aliases: ['antwerp', 'antwerpen', 'antwerp centraal', 'antwerp central', 'antwerp-centraal', 'antwerpen centraal', 'antwerpen-centraal'] },
  { label: 'Glasgow', lat: 55.8642, lng: -4.2518, aliases: ['glasgow'] },
  { label: 'Milngavie', lat: 55.941, lng: -4.314, aliases: ['milngavie'] },
  { label: 'Balmaha', lat: 56.083, lng: -4.539, aliases: ['balmaha'] },
  { label: 'Rowardennan', lat: 56.151, lng: -4.642, aliases: ['rowardennan'] },
  { label: 'Inverarnan', lat: 56.333, lng: -4.716, aliases: ['inverarnan'] },
  { label: 'Tyndrum', lat: 56.435, lng: -4.711, aliases: ['tyndrum'] },
  { label: 'Bridge of Orchy', lat: 56.5167, lng: -4.7693, aliases: ['bridge of orchy', 'bridge of orkey'] },
  { label: 'Inveroran', lat: 56.532, lng: -4.843, aliases: ['inveroran'] },
  { label: 'Kingshouse', lat: 56.653, lng: -4.827, aliases: ['kingshouse'] },
  { label: 'Glencoe', lat: 56.682, lng: -5.103, aliases: ['glencoe'] },
  { label: 'Kinlochleven', lat: 56.713, lng: -4.965, aliases: ['kinlochleven'] },
  { label: 'Fort William', lat: 56.8198, lng: -5.1052, aliases: ['fort william'] },
  { label: 'Oban', lat: 56.4152, lng: -5.4718, aliases: ['oban'] },
  { label: 'Baden-Baden', lat: 48.7606, lng: 8.2398, aliases: ['baden-baden', 'baden baden', 'heidelberg'] },
  { label: 'Lake Maggiore', lat: 45.947, lng: 8.63, aliases: ['lake maggiore', 'lago maggiore', 'orta', 'orta san giulio', 'stresa'] },
  { label: 'Lake Como', lat: 45.984, lng: 9.261, aliases: ['lake como', 'lago di como', 'como'] },
  { label: 'Ravenna', lat: 44.4184, lng: 12.2035, aliases: ['ravenna'] },
  { label: 'Gargano', lat: 41.946, lng: 16.016, aliases: ['gargano', 'peschici', 'baia san nicola'] },
  { label: 'Brindisi', lat: 40.6327, lng: 17.9418, aliases: ['brindisi'] },
  { label: 'Bari', lat: 41.1171, lng: 16.8719, aliases: ['bari'] },
  { label: 'Rome', lat: 41.9028, lng: 12.4964, aliases: ['rome', 'roma'] },
  { label: 'Igoumenitsa', lat: 39.5034, lng: 20.2656, aliases: ['igoumenitsa'] },
  { label: 'Epirus', lat: 39.665, lng: 20.853, aliases: ['epirus', 'ioannina', 'metsovo', 'zagori', 'mikro papigo'] },
  { label: 'Meteora', lat: 39.704, lng: 21.626, aliases: ['meteora', 'kastraki', 'kalambaka'] },
  { label: 'Pelion', lat: 39.388, lng: 23.173, aliases: ['pelion', 'tsagarada', 'damouchari', 'volos', 'makrinitsa', 'portaria'] },
  { label: 'Thessaloniki', lat: 40.6401, lng: 22.9444, aliases: ['thessaloniki'] },
  { label: 'Kavala', lat: 40.9376, lng: 24.4129, aliases: ['kavala'] },
  { label: 'Gallipoli', lat: 40.4103, lng: 26.6707, aliases: ['gallipoli', 'gelibolu', 'eceabat', 'dardanelles'] },
  { label: 'Tekirdag Wine Coast', lat: 40.978, lng: 27.511, aliases: ['tekirdag', 'tekirdag wine coast', 'ucmakdere', 'sarkoy', 'murefte', 'barbare'] },
  { label: 'Istanbul', lat: 41.0082, lng: 28.9784, aliases: ['istanbul', 'polonezkoy', 'sile', 'agva'] },
  { label: 'Naxos', lat: 37.1036, lng: 25.3767, aliases: ['naxos'] },
  { label: 'Santorini', lat: 36.3932, lng: 25.4615, aliases: ['santorini', 'oia', 'fira'] },
  { label: 'Athens', lat: 37.9838, lng: 23.7275, aliases: ['athens', 'piraeus'] },
];

const SORTED_GAZETTEER = [...GAZETTEER].sort(
  (a, b) => longestAlias(b) - longestAlias(a)
);

function longestAlias(entry: GazetteerEntry): number {
  return Math.max(...entry.aliases.map((alias) => alias.length));
}

function normalizePlace(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/\b(?:hotel|suite|suites|apartment|apartments|station|centraal|central)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function splitPlaceCandidates(value: string): string[] {
  return value
    .replace(/[–—]/g, '->')
    .split(/\s*(?:→|->|\/|\||\+|\bto\b|\band\b)\s*/i)
    .map((part) => part.trim())
    .filter((part) => part.length >= 3);
}

export function lookupRoutePlace(value: string): GazetteerEntry | undefined {
  const normalized = normalizePlace(value);
  if (!normalized) return undefined;

  for (const entry of SORTED_GAZETTEER) {
    for (const alias of entry.aliases) {
      if (normalized === normalizePlace(alias)) return entry;
    }
  }

  for (const entry of SORTED_GAZETTEER) {
    for (const alias of entry.aliases) {
      const candidate = normalizePlace(alias);
      if (candidate.length >= 4 && normalized.includes(candidate)) return entry;
    }
  }

  return undefined;
}

function normalizedTextIncludesPhrase(text: string, phrase: string): boolean {
  return ` ${text} `.includes(` ${phrase} `);
}

export function routePlaceTextMatches(value: string | undefined, label: string): boolean {
  const normalizedText = normalizePlace(value ?? '');
  if (!normalizedText) return false;

  const match = lookupRoutePlace(label);
  const phrases = match ? [match.label, ...match.aliases] : [label];

  return [...new Set(phrases)]
    .map(normalizePlace)
    .some((phrase) => phrase.length >= 4 && normalizedTextIncludesPhrase(normalizedText, phrase));
}

export function buildDayRouteMapSearchText(day: Day): string {
  return normalizePlace([
    day.title,
    day.subtitle,
    day.accommodation?.name,
    day.accommodation?.detail?.title,
    day.accommodation?.detail?.address,
    ...(day.transport ?? []).flatMap((transport) => [
      transport.label,
      transport.from,
      transport.to,
    ]),
    ...(day.blocks ?? []).flatMap((block) => [
      block.content,
      block.detail?.title,
      ...(block.options ?? []).map((option) => option.label),
    ]),
    ...(day.meals ?? []).flatMap((meal) => [
      meal.name,
      meal.detail?.title,
      meal.detail?.address,
    ]),
  ].filter(Boolean).join(' '));
}

function sanitizeMode(mode?: string): string {
  const normalized = normalizePlace(mode ?? '');
  if (!normalized) return 'route';
  if (normalized.includes('walk') || normalized.includes('hike') || normalized.includes('trail')) return 'walk';
  if (normalized.includes('train') || normalized.includes('rail') || normalized.includes('eurostar')) return 'train';
  if (normalized.includes('ferry') || normalized.includes('boat')) return 'ferry';
  if (normalized.includes('flight') || normalized.includes('plane') || normalized.includes('air')) return 'flight';
  if (normalized.includes('car') || normalized.includes('drive') || normalized.includes('self drive')) return 'car';
  return normalized.split(' ')[0] ?? 'route';
}

function routePointText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function routePointNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function inferDayMode(day: Day): string | undefined {
  const text = normalizePlace([
    day.title,
    day.subtitle,
    day.description_title,
    day.description,
    ...(day.blocks ?? []).flatMap((block) => [block.type, block.content, block.detail?.title]),
  ].filter(Boolean).join(' '));

  if (text.includes('west highland way') || text.includes('walk') || text.includes('hike') || text.includes('trail')) return 'walk';
  if (text.includes('ferry') || text.includes('boat')) return 'ferry';
  if (text.includes('train') || text.includes('rail') || text.includes('eurostar')) return 'train';
  if (text.includes('flight') || text.includes('airport')) return 'flight';
  if (text.includes('drive') || text.includes('self drive') || text.includes('road')) return 'car';
  return undefined;
}

function addLookupPoint(
  points: CandidatePoint[],
  value: string | undefined,
  day?: number,
  modeFromPrevious?: string,
  options: { allCandidates?: boolean } = {}
): number {
  if (!value) return 0;
  const candidates = splitPlaceCandidates(value);
  const values = candidates.length ? candidates : [value];
  let added = 0;

  for (const candidate of values) {
    const match = lookupRoutePlace(candidate);
    if (!match) continue;
    points.push({
      label: match.label,
      lat: match.lat,
      lng: match.lng,
      day,
      modeFromPrevious: options.allCandidates
        ? added > 0
          ? modeFromPrevious
          : undefined
        : modeFromPrevious,
      role: match.role,
      source: 'derived',
    });
    added += 1;
    if (!options.allCandidates) return added;
  }

  return added;
}

function addTransportPoints(points: CandidatePoint[], day: Day, transport: Transport) {
  const mode = sanitizeMode(transport.mode || transport.label);
  addLookupPoint(points, transport.from, day.day_number);
  addLookupPoint(points, transport.to, day.day_number, mode);
}

function deriveRoutePoints(days: Day[]): CandidatePoint[] {
  const points: CandidatePoint[] = [];

  for (const day of days) {
    if (day.transport?.length) {
      for (const transport of day.transport) {
        addTransportPoints(points, day, transport);
      }
      continue;
    }

    const mode = inferDayMode(day);
    const addedFromTitle = addLookupPoint(points, day.title, day.day_number, mode, { allCandidates: true });
    if (addedFromTitle === 0) addLookupPoint(points, day.subtitle, day.day_number);
  }

  return points;
}

function fromStoredPoint(point: TripRoutePoint): CandidatePoint | undefined {
  const rawPoint = point as TripRoutePoint & { name?: unknown; title?: unknown };
  const label = routePointText(rawPoint.label) || routePointText(rawPoint.name) || routePointText(rawPoint.title);
  const lat = routePointNumber(rawPoint.lat);
  const lng = routePointNumber(rawPoint.lng);
  if (!label || lat === undefined || lng === undefined) return undefined;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return undefined;
  return {
    label,
    lat,
    lng,
    day: point.day,
    modeFromPrevious: sanitizeMode(point.mode),
    role: point.role,
    source: 'stored',
  };
}

function pointKey(point: CandidatePoint): string {
  return `${normalizePlace(point.label)}:${point.lat.toFixed(3)}:${point.lng.toFixed(3)}`;
}

function dedupeSequential(points: CandidatePoint[]): CandidatePoint[] {
  const deduped: CandidatePoint[] = [];

  for (const point of points) {
    const previous = deduped[deduped.length - 1];
    if (previous && pointKey(previous) === pointKey(point)) {
      if (point.modeFromPrevious) previous.modeFromPrevious = point.modeFromPrevious;
      if (point.day && !previous.day) previous.day = point.day;
      continue;
    }
    deduped.push({ ...point });
  }

  return deduped;
}

function removeInteriorHomePoints(points: CandidatePoint[]): CandidatePoint[] {
  const lastIndex = points.length - 1;
  return points.filter((point, index) => point.role !== 'home' || index === 0 || index === lastIndex);
}

function boundsFor(points: TripRouteAtlasPoint[]): TripRouteAtlas['bounds'] {
  return {
    minLat: Math.min(...points.map((point) => point.lat)),
    maxLat: Math.max(...points.map((point) => point.lat)),
    minLng: Math.min(...points.map((point) => point.lng)),
    maxLng: Math.max(...points.map((point) => point.lng)),
  };
}

function buildLegs(points: TripRouteAtlasPoint[]): TripRouteAtlasLeg[] {
  return points.slice(1).map((point, index) => ({
    from: index,
    to: index + 1,
    mode: sanitizeMode(point.modeFromPrevious ?? point.mode),
    day: point.day,
    label: point.label,
  }));
}

const ACCESS_ENDPOINT_ROLES = new Set<TripRoutePointRole | undefined>(['home', 'return']);

function isAccessEndpoint(point: TripRouteAtlasPoint): boolean {
  if (ACCESS_ENDPOINT_ROLES.has(point.role)) return true;
  return lookupRoutePlace(point.label)?.role === 'home';
}

function endpointLeg(atlas: TripRouteAtlas, index: number): TripRouteAtlasLeg | undefined {
  const lastIndex = atlas.points.length - 1;
  if (index === 0) return atlas.legs.find((leg) => leg.from === 0 && leg.to === 1);
  if (index === lastIndex) return atlas.legs.find((leg) => leg.from === lastIndex - 1 && leg.to === lastIndex);
  return undefined;
}

function isFlightMode(mode: string | undefined): boolean {
  return sanitizeMode(mode) === 'flight';
}

function dayTextMatchesPoint(values: Array<string | undefined>, point: TripRouteAtlasPoint): boolean {
  return routePlaceTextMatches(values.filter(Boolean).join(' '), point.label);
}

function dayHasSubstantiveContentAtPoint(day: Day, point: TripRouteAtlasPoint): boolean {
  if (day.accommodation && dayTextMatchesPoint([
    day.accommodation.name,
    day.accommodation.detail?.title,
    day.accommodation.detail?.address,
  ], point)) {
    return true;
  }

  if ((day.meals ?? []).some((meal) => dayTextMatchesPoint([
    meal.name,
    meal.detail?.title,
    meal.detail?.address,
    meal.note,
  ], point))) {
    return true;
  }

  return (day.blocks ?? []).some((block) => {
    const blockType = normalizePlace(block.type);
    const isTransportOnly = ['transport', 'transfer', 'flight', 'airport', 'train', 'ferry', 'drive', 'route']
      .some((type) => blockType.includes(type));
    if (isTransportOnly) return false;

    return dayTextMatchesPoint([
      block.place?.name,
      block.place?.address,
      block.content,
      block.detail?.title,
      block.detail?.body,
      block.detail?.why,
    ], point);
  });
}

function endpointHasTripSubstance(point: TripRouteAtlasPoint, days: Day[]): boolean {
  if (!point.day) return false;
  return days
    .filter((day) => day.day_number === point.day)
    .some((day) => dayHasSubstantiveContentAtPoint(day, point));
}

function shouldHideAccessEndpointFromOverview(
  atlas: TripRouteAtlas,
  index: number,
  days: Day[]
): boolean {
  const point = atlas.points[index];
  if (!point || !isAccessEndpoint(point)) return false;

  const lastIndex = atlas.points.length - 1;
  if (index !== 0 && index !== lastIndex) return false;

  const leg = endpointLeg(atlas, index);
  if (!isFlightMode(leg?.mode ?? point.modeFromPrevious ?? point.mode)) return false;

  return !endpointHasTripSubstance(point, days);
}

function atlasFromPoints(points: TripRouteAtlasPoint[]): TripRouteAtlas {
  const reindexed = points.map((point, index) => ({
    ...point,
    index,
  }));
  const legs = buildLegs(reindexed);

  return {
    points: reindexed,
    legs,
    modes: [...new Set(legs.map((leg) => leg.mode))],
    bounds: boundsFor(reindexed),
  };
}

export function buildTripOverviewRouteAtlas(atlas: TripRouteAtlas, days: Day[] = []): TripRouteAtlas {
  const points = atlas.points.filter((_, index) => !shouldHideAccessEndpointFromOverview(atlas, index, days));
  if (points.length === 0 || points.length === atlas.points.length) return atlas;
  return atlasFromPoints(points);
}

export function buildTripRouteAtlas(data: TripData): TripRouteAtlas | undefined {
  const stored = data.trip.route_points
    ?.map(fromStoredPoint)
    .filter((point): point is CandidatePoint => Boolean(point));
  const usesStoredPoints = Boolean(stored && stored.length >= 2);
  const candidates = usesStoredPoints ? stored! : removeInteriorHomePoints(deriveRoutePoints(data.days));
  const points = dedupeSequential(candidates)
    .slice(0, 28)
    .map((point, index): TripRouteAtlasPoint => ({
      id: `${index}-${normalizePlace(point.label) || 'route-point'}`,
      index,
      label: point.label,
      lat: point.lat,
      lng: point.lng,
      day: point.day,
      mode: point.modeFromPrevious,
      role: point.role ?? (index === 0 ? 'home' : 'stop'),
      source: point.source,
      modeFromPrevious: point.modeFromPrevious,
    }));

  if (points.length < 2) return undefined;

  const legs = buildLegs(points);
  return {
    points,
    legs,
    modes: [...new Set(legs.map((leg) => leg.mode))],
    bounds: boundsFor(points),
  };
}

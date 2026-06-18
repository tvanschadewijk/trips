import type {
  Accommodation,
  Block,
  Day,
  Meal,
  Tip,
  Transport,
  TripData,
  TripMeta,
  TripNote,
  TripRoutePoint,
} from './types';

type UnknownRecord = Record<string, unknown>;
type NormalizationWarningCollector = (warning: string) => void;

function isRecord(value: unknown): value is UnknownRecord {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function isUndefinedLike(value: unknown): boolean {
  return value === undefined || (typeof value === 'string' && value.trim().toLowerCase() === 'undefined');
}

function stripUndefinedLikeFields(value: unknown): unknown {
  if (isUndefinedLike(value)) return undefined;

  if (Array.isArray(value)) {
    return value
      .map(stripUndefinedLikeFields)
      .filter((item) => item !== undefined);
  }

  if (!isRecord(value)) return value;

  const cleaned: UnknownRecord = {};
  for (const [key, entryValue] of Object.entries(value)) {
    const cleanedValue = stripUndefinedLikeFields(entryValue);
    if (cleanedValue !== undefined) cleaned[key] = cleanedValue;
  }
  return cleaned;
}

function stripUndefinedLikeRecord(value: UnknownRecord): UnknownRecord {
  return stripUndefinedLikeFields(value) as UnknownRecord;
}

function text(value: unknown): string {
  if (isUndefinedLike(value)) return '';
  return typeof value === 'string' ? value.trim() : '';
}

function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function normalizeStringList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .map((item) => text(item))
      .filter(Boolean);
  }

  const single = text(value);
  if (!single) return [];

  return single
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeRoutePoints(
  value: unknown,
  warn?: NormalizationWarningCollector
): TripRoutePoint[] | undefined {
  if (!Array.isArray(value)) return undefined;

  const points = value
    .filter(isRecord)
    .map((point, index) => {
      const explicitLabel = text(point.label);
      const nameAlias = text(point.name);
      const titleAlias = text(point.title);
      const label = explicitLabel || nameAlias || titleAlias;
      const lat = numberValue(point.lat);
      const lng = numberValue(point.lng);
      if (!label || lat === undefined || lng === undefined) {
        warn?.(`trip.route_points[${index}] was skipped because label, lat, or lng was missing.`);
        return null;
      }

      if (!explicitLabel && nameAlias) {
        warn?.(`trip.route_points[${index}].name was converted to label.`);
      } else if (!explicitLabel && titleAlias) {
        warn?.(`trip.route_points[${index}].title was converted to label.`);
      }

      const day = numberValue(point.day);
      return {
        ...point,
        label,
        lat,
        lng,
        ...(day !== undefined ? { day } : {}),
        ...(text(point.mode) ? { mode: text(point.mode) } : {}),
      } as TripRoutePoint;
    })
    .filter((point): point is TripRoutePoint => Boolean(point));

  return points.length ? points : undefined;
}

function inferDates(meta: UnknownRecord, days: Day[]): TripMeta['dates'] {
  const dates = isRecord(meta.dates) ? meta.dates : {};
  const start = text(dates.start) || text(meta.start_date) || text(days[0]?.date);
  const end = text(dates.end) || text(meta.end_date) || text(days[days.length - 1]?.date) || start;

  return {
    start: start || end,
    end: end || start,
  };
}

function normalizeBlocks(value: unknown): Block[] | undefined {
  if (!Array.isArray(value)) return undefined;

  return value
    .filter(isRecord)
    .map((block) => ({
      ...block,
      time_label: text(block.time_label),
      content: text(block.content),
      type: text(block.type) || 'activity',
    } as Block));
}

function legacyActivitiesToBlocks(value: unknown): Block[] | undefined {
  if (!Array.isArray(value)) return undefined;

  const blocks = value
    .map((item) => text(item))
    .filter(Boolean)
    .map((content) => ({
      time_label: '',
      type: 'activity',
      content,
    }));

  return blocks.length ? blocks : undefined;
}

function normalizeMeals(value: unknown): Meal[] | undefined {
  if (Array.isArray(value)) {
    return value
      .filter(isRecord)
      .map((meal) => ({
        ...meal,
        type: text(meal.type) || 'meal',
        name: text(meal.name) || text(meal.title) || text(meal.label) || text(meal.note),
      } as Meal));
  }

  if (typeof value === 'string') {
    const name = text(value);
    return name ? [{ type: 'meal', name }] : undefined;
  }

  if (!isRecord(value)) return undefined;

  const meals = Object.entries(value)
    .flatMap(([type, meal]) => {
      if (isRecord(meal)) {
        const name = text(meal.name) || text(meal.title) || text(meal.label) || text(meal.note);
        return name ? [{ ...meal, type, name } as Meal] : [];
      }

      const name = text(meal);
      return name ? [{ type, name }] : [];
    });

  return meals.length ? meals : undefined;
}

function normalizeTips(value: unknown): Tip[] | undefined {
  if (!Array.isArray(value)) return undefined;

  const tips = value
    .filter(isRecord)
    .map((tip) => {
      const content = text(tip.content) || text(tip.body) || text(tip.note);
      const title = text(tip.title) || text(tip.label) || (content ? 'Tip' : '');
      return {
        ...tip,
        icon: text(tip.icon) || 'info',
        title,
        content,
      } as Tip;
    })
    .filter((tip) => tip.title || tip.content);

  return tips.length ? tips : undefined;
}

function normalizeTripNotes(
  value: unknown,
  warn?: NormalizationWarningCollector
): TripNote[] | undefined {
  if (!Array.isArray(value)) return undefined;

  const notes = value
    .filter(isRecord)
    .map((note, index) => {
      const cleaned = stripUndefinedLikeRecord(note);
      const content = text(cleaned.content) || text(cleaned.body) || text(cleaned.note);
      if (!content) {
        warn?.(`trip.notes[${index}] was skipped because content was missing.`);
        return null;
      }

      const title = text(cleaned.title) || text(cleaned.label) || 'Note';
      const icon = text(cleaned.icon);
      const normalized: UnknownRecord = {
        ...cleaned,
        title,
        content,
      };

      if (icon) normalized.icon = icon;
      else delete normalized.icon;

      return normalized as unknown as TripNote;
    })
    .filter((note): note is TripNote => Boolean(note));

  return notes.length ? notes : undefined;
}

function normalizeAccommodation(value: unknown): Accommodation | null | undefined {
  if (value === null) return null;

  if (typeof value === 'string') {
    const name = text(value);
    return name ? { name } : undefined;
  }

  if (!isRecord(value)) return undefined;

  return {
    ...value,
    name: text(value.name) || text(value.title) || text(value.label),
  } as Accommodation;
}

function normalizeTransport(value: unknown): Transport[] | undefined {
  if (!Array.isArray(value)) return undefined;

  const transport = value
    .filter(isRecord)
    .map((item) => ({
      ...item,
      mode: text(item.mode) || 'route',
      label: text(item.label) || text(item.route) || text(item.mode) || 'Route',
    } as Transport));

  return transport.length ? transport : [];
}

function normalizeDay(value: UnknownRecord, index: number): Day {
  const dayNumber = numberValue(value.day_number) ?? index + 1;
  const day: UnknownRecord = {
    ...stripUndefinedLikeRecord(value),
    day_number: dayNumber,
    date: text(value.date),
    title: text(value.title) || `Day ${dayNumber}`,
  };

  const blocks = normalizeBlocks(value.blocks) ?? legacyActivitiesToBlocks(value.activities);
  if (blocks) day.blocks = blocks;
  else delete day.blocks;

  const accommodation = normalizeAccommodation(value.accommodation);
  if (accommodation !== undefined) day.accommodation = accommodation;
  else delete day.accommodation;

  const meals = normalizeMeals(value.meals);
  if (meals !== undefined) day.meals = meals;
  else delete day.meals;

  const transport = normalizeTransport(value.transport);
  if (transport !== undefined) day.transport = transport;
  else delete day.transport;

  const tips = normalizeTips(value.tips);
  if (tips !== undefined) day.tips = tips;
  else delete day.tips;

  return day as unknown as Day;
}

function normalizeTripMeta(
  value: UnknownRecord,
  days: Day[],
  warn?: NormalizationWarningCollector
): TripMeta {
  const routePoints = normalizeRoutePoints(value.route_points, warn);
  const notes = normalizeTripNotes(value.notes, warn);
  const meta: UnknownRecord = {
    ...stripUndefinedLikeRecord(value),
    name: text(value.name) || 'Untitled trip',
    subtitle: text(value.subtitle),
    dates: inferDates(value, days),
    travelers: normalizeStringList(value.travelers),
    summary: text(value.summary),
    hero_image: text(value.hero_image) || text(value.overview_image),
  };

  if (routePoints) meta.route_points = routePoints;
  else delete meta.route_points;

  if (notes) meta.notes = notes;
  else delete meta.notes;

  return meta as unknown as TripMeta;
}

export function normalizeTripDataWithWarnings(data: unknown): { data: TripData; warnings: string[] } {
  const warnings: string[] = [];
  const root = isRecord(data) ? stripUndefinedLikeRecord(data) : {};
  const sourceDays = Array.isArray(root.days) ? root.days.filter(isRecord) : [];
  const days = sourceDays.map(normalizeDay);
  const trip = normalizeTripMeta(isRecord(root.trip) ? root.trip : {}, days, (warning) => warnings.push(warning));

  return {
    data: stripUndefinedLikeFields({
      ...root,
      trip,
      days,
      ...(typeof root.markdown_source === 'string' ? { markdown_source: root.markdown_source } : {}),
    }) as TripData,
    warnings,
  };
}

export function normalizeTripData(data: unknown): TripData {
  return normalizeTripDataWithWarnings(data).data;
}

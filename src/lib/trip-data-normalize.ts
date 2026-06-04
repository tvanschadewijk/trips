import type { Accommodation, Block, Day, Meal, Transport, TripData, TripMeta } from './types';

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function text(value: unknown): string {
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
    ...value,
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

  return day as unknown as Day;
}

function normalizeTripMeta(value: UnknownRecord, days: Day[]): TripMeta {
  return {
    ...value,
    name: text(value.name) || 'Untitled trip',
    subtitle: text(value.subtitle),
    dates: inferDates(value, days),
    travelers: normalizeStringList(value.travelers),
    summary: text(value.summary),
    hero_image: text(value.hero_image) || text(value.overview_image),
  } as TripMeta;
}

export function normalizeTripData(data: unknown): TripData {
  const root = isRecord(data) ? data : {};
  const sourceDays = Array.isArray(root.days) ? root.days.filter(isRecord) : [];
  const days = sourceDays.map(normalizeDay);
  const trip = normalizeTripMeta(isRecord(root.trip) ? root.trip : {}, days);

  return {
    ...root,
    trip,
    days,
    ...(typeof root.markdown_source === 'string' ? { markdown_source: root.markdown_source } : {}),
  } as TripData;
}

import { normalizeTripData } from './trip-data-normalize';
import { auditTripLogistics, type TripLogisticsAudit } from './trip-logistics';
import type { Block, Day, Meal, Transport, TripData } from './types';

export const OURTRIPS_TRIP_SCHEMA_VERSION = 2;

export type TripQualityIssueLevel = 'warning' | 'error';

export interface TripQualityIssue {
  level: TripQualityIssueLevel;
  code: string;
  path: string;
  message: string;
}

export interface DayQualityReport {
  day_number: number;
  date: string;
  title: string;
  day_type: string;
  pace: string;
  programme_count: number;
  has_intro: boolean;
  has_time_structure: boolean;
  has_map_targets: boolean;
  has_tips: boolean;
  meal_count: number;
  open_action_count: number;
}

export interface TripQualityReport {
  trip_schema_version: number;
  warnings: string[];
  errors: string[];
  issues: TripQualityIssue[];
  logistics: TripLogisticsAudit;
  days: DayQualityReport[];
  summary: {
    day_count: number;
    ready_day_count: number;
    open_action_count: number;
  };
}

type MutableTripData = TripData & {
  days: Array<Day & Record<string, unknown>>;
};

export const COORDINATE_BACKED_ROUTE_POINTS_REQUIRED_MESSAGE =
  'Trip must include at least two trip.route_points with label, lat, and lng so the itinerary map has a coordinate-backed route and fallback.';

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function isCoordinateBackedRoutePoint(point: unknown): boolean {
  if (!point || typeof point !== 'object') return false;
  const routePoint = point as { label?: unknown; lat?: unknown; lng?: unknown };
  return (
    text(routePoint.label).length > 0 &&
    typeof routePoint.lat === 'number' &&
    Number.isFinite(routePoint.lat) &&
    routePoint.lat >= -90 &&
    routePoint.lat <= 90 &&
    typeof routePoint.lng === 'number' &&
    Number.isFinite(routePoint.lng) &&
    routePoint.lng >= -180 &&
    routePoint.lng <= 180
  );
}

export function coordinateBackedRoutePointCount(data: TripData): number {
  return (data.trip.route_points ?? []).filter(isCoordinateBackedRoutePoint).length;
}

export function hasCoordinateBackedTripRoute(data: TripData): boolean {
  return coordinateBackedRoutePointCount(data) >= 2;
}

function normalizedStatus(value: unknown): string {
  return text(value).toLowerCase();
}

function isDoneStatus(value: unknown): boolean {
  const status = normalizedStatus(value);
  return status === 'booked' || status === 'confirmed';
}

function isOpenStatus(value: unknown): boolean {
  const status = normalizedStatus(value);
  return status === 'open' || status === 'pending' || status === 'reserved' || status === 'hold';
}

function hasExactTime(value: string): boolean {
  return /\b(?:[01]?\d|2[0-3])[:.][0-5]\d\b/.test(value);
}

function parseTimePair(value: string): { starts_at?: string; ends_at?: string } {
  const matches = [...value.matchAll(/\b((?:[01]?\d|2[0-3])[:.][0-5]\d)\b/g)]
    .map((match) => match[1].replace('.', ':'))
    .map((time) => {
      const [hour, minute] = time.split(':');
      return `${hour.padStart(2, '0')}:${minute}`;
    });

  return {
    starts_at: matches[0],
    ends_at: matches[1],
  };
}

function inferTimePrecision(label: string, bookingStatus: unknown): 'fixed' | 'suggested' | 'window' | undefined {
  if (!label) return undefined;
  if (hasExactTime(label)) return isDoneStatus(bookingStatus) ? 'fixed' : 'suggested';
  if (/\b(morning|midday|lunch|afternoon|evening|night|sunrise|sunset|late|early)\b/i.test(label)) {
    return 'window';
  }
  return undefined;
}

function inferDayType(day: Day): string {
  const title = `${day.title} ${day.subtitle ?? ''}`.toLowerCase();
  const transportModes = (day.transport ?? []).map((item) => item.mode.toLowerCase());
  if (/\barrival|arrive|land\b/.test(title)) return 'arrival';
  if (/\bdeparture|depart|flight home|return home\b/.test(title)) return 'departure';
  if (transportModes.some((mode) => ['plane', 'flight', 'train', 'ferry', 'ship', 'bus', 'car'].includes(mode))) {
    return 'travel';
  }
  if ((day.blocks ?? []).length <= 1 && /\brest|recover|buffer|free day\b/.test(title)) return 'rest';
  return 'full';
}

function inferPace(day: Day): string {
  const programmeCount = (day.blocks ?? []).filter((block) => text(block.content) || text(block.detail?.title)).length;
  const transportCount = day.transport?.length ?? 0;
  const score = programmeCount + Math.max(0, transportCount - 1);
  if (score <= 2) return 'light';
  if (score <= 4) return 'balanced';
  return 'full';
}

function hasMapTarget(day: Day): boolean {
  if (day.accommodation?.name) return true;
  if (day.meals?.some((meal) => meal.place?.name || meal.name)) return true;
  if (day.transport?.some((transport) => transport.from || transport.to)) return true;
  return (day.blocks ?? []).some((block) => block.place?.name || block.detail?.title || block.content);
}

function normalizeBookingStatus<T extends { booking_status?: unknown; status?: unknown }>(item: T): T {
  if (!item.booking_status && typeof item.status === 'string') {
    item.booking_status = item.status;
  }
  return item;
}

function polishBlock(block: Block): Block {
  const next = { ...block };
  normalizeBookingStatus(next);

  const label = text(next.time_label);
  const timePair = parseTimePair(label);
  if (!next.starts_at && timePair.starts_at) next.starts_at = timePair.starts_at;
  if (!next.ends_at && timePair.ends_at) next.ends_at = timePair.ends_at;
  if (!next.time_precision) {
    const precision = inferTimePrecision(label, next.booking_status);
    if (precision) next.time_precision = precision;
  }

  return next;
}

function polishMeal(meal: Meal): Meal {
  const next = { ...meal };
  normalizeBookingStatus(next);
  if (!next.place && next.name) next.place = { name: next.name };
  if (!next.time_precision && (next.starts_at || next.ends_at)) {
    next.time_precision = isDoneStatus(next.booking_status ?? next.status) ? 'fixed' : 'suggested';
  }
  return next;
}

function polishTransport(transport: Transport): Transport {
  const next = { ...transport };
  normalizeBookingStatus(next);
  return next;
}

export function normalizeTripForQualityContract(data: unknown): TripData {
  const normalized = normalizeTripData(data) as MutableTripData;
  normalized.trip_schema_version = OURTRIPS_TRIP_SCHEMA_VERSION;

  normalized.days = normalized.days.map((day) => ({
    ...day,
    day_type: day.day_type ?? inferDayType(day),
    pace: day.pace ?? inferPace(day),
    blocks: day.blocks?.map(polishBlock),
    transport: day.transport?.map(polishTransport),
    accommodation: day.accommodation
      ? normalizeBookingStatus({ ...day.accommodation })
      : day.accommodation,
    meals: day.meals?.map(polishMeal),
  }));

  return normalized;
}

function addIssue(issues: TripQualityIssue[], issue: TripQualityIssue): void {
  issues.push(issue);
}

function dayOpenActionCount(day: Day): number {
  let count = 0;
  for (const transport of day.transport ?? []) {
    if (isOpenStatus(transport.booking_status ?? transport.status)) count += 1;
  }
  if (day.accommodation && !isDoneStatus(day.accommodation.booking_status ?? day.accommodation.status)) {
    count += 1;
  }
  for (const meal of day.meals ?? []) {
    if (meal.reservation_required && !isDoneStatus(meal.booking_status ?? meal.status)) count += 1;
  }
  return count;
}

export function validateItineraryQuality(data: unknown): TripQualityReport {
  const normalized = normalizeTripForQualityContract(data);
  const logistics = auditTripLogistics(normalized);
  const issues: TripQualityIssue[] = [];
  const dayReports: DayQualityReport[] = [];

  if (normalized.days.length === 0) {
    addIssue(issues, {
      level: 'error',
      code: 'missing_days',
      path: 'days',
      message: 'A v2 OurTrips itinerary must include at least one day.',
    });
  }

  if (!hasCoordinateBackedTripRoute(normalized)) {
    addIssue(issues, {
      level: 'warning',
      code: 'missing_route_points',
      path: 'trip.route_points',
      message: 'Trip should include at least two trip.route_points with label, lat, and lng so the itinerary map has a coordinate-backed route and fallback.',
    });
  }

  normalized.days.forEach((day, index) => {
    const path = `days[${index}]`;
    const programme = (day.blocks ?? []).filter((block) => text(block.content) || text(block.detail?.title));
    const dayType = text(day.day_type) || inferDayType(day);
    const fullProgrammeDay = dayType === 'full' || dayType === 'arrival' || dayType === 'travel';
    const hasIntro = Boolean(text(day.description_title) && text(day.description));
    const hasTimeStructure = programme.some((block) => text(block.starts_at) || text(block.time_label));
    const mapReady = hasMapTarget(day);
    const hasTips = (day.tips ?? []).some((tip) => text(tip.title) || text(tip.content));
    const openActionCount = dayOpenActionCount(day);

    if (!hasIntro) {
      addIssue(issues, {
        level: 'warning',
        code: 'missing_day_intro',
        path,
        message: `Day ${day.day_number} should have description_title and description for the editorial intro.`,
      });
    }

    if (fullProgrammeDay && programme.length < 3) {
      addIssue(issues, {
        level: 'warning',
        code: 'sparse_programme',
        path: `${path}.blocks`,
        message: `Day ${day.day_number} has ${programme.length} programme item${programme.length === 1 ? '' : 's'}; full days should usually have 3-6.`,
      });
    }

    if (programme.length > 6) {
      addIssue(issues, {
        level: 'warning',
        code: 'overpacked_programme',
        path: `${path}.blocks`,
        message: `Day ${day.day_number} has ${programme.length} programme items; consider grouping or lightening the day.`,
      });
    }

    if (programme.length && !hasTimeStructure) {
      addIssue(issues, {
        level: 'warning',
        code: 'missing_time_structure',
        path: `${path}.blocks`,
        message: `Day ${day.day_number} should use suggested windows or fixed times for programme items.`,
      });
    }

    for (const [blockIndex, block] of programme.entries()) {
      if (hasExactTime(text(block.time_label)) && !block.time_precision) {
        addIssue(issues, {
          level: 'warning',
          code: 'unqualified_exact_time',
          path: `${path}.blocks[${blockIndex}].time_precision`,
          message: `Day ${day.day_number} uses an exact time without marking it fixed, suggested, or window.`,
        });
      }
    }

    if (!mapReady) {
      addIssue(issues, {
        level: 'warning',
        code: 'missing_map_targets',
        path,
        message: `Day ${day.day_number} has no clear map-ready hotel, meal, transport, activity place, or route target.`,
      });
    }

    if (fullProgrammeDay && !(day.meals?.length)) {
      addIssue(issues, {
        level: 'warning',
        code: 'missing_meals',
        path: `${path}.meals`,
        message: `Day ${day.day_number} should include at least one meal suggestion or reservation note.`,
      });
    }

    if (!hasTips) {
      addIssue(issues, {
        level: 'warning',
        code: 'missing_tips',
        path: `${path}.tips`,
        message: `Day ${day.day_number} should include at least one practical, place-specific tip.`,
      });
    }

    if (day.accommodation && !text(day.accommodation.booking_status ?? day.accommodation.status)) {
      addIssue(issues, {
        level: 'warning',
        code: 'missing_accommodation_status',
        path: `${path}.accommodation.status`,
        message: `Day ${day.day_number} accommodation should say whether it is booked, open, pending, or optional.`,
      });
    }

    dayReports.push({
      day_number: day.day_number,
      date: day.date,
      title: day.title,
      day_type: dayType,
      pace: text(day.pace) || inferPace(day),
      programme_count: programme.length,
      has_intro: hasIntro,
      has_time_structure: hasTimeStructure,
      has_map_targets: mapReady,
      has_tips: hasTips,
      meal_count: day.meals?.length ?? 0,
      open_action_count: openActionCount,
    });
  });

  for (const issue of logistics.issues) {
    addIssue(issues, {
      ...issue,
      code: `logistics_${issue.code}`,
    });
  }

  const warnings = issues.filter((issue) => issue.level === 'warning').map((issue) => issue.message);
  const errors = issues.filter((issue) => issue.level === 'error').map((issue) => issue.message);
  const readyDayCount = dayReports.filter((day) => (
    day.has_intro &&
    day.has_time_structure &&
    day.has_map_targets &&
    day.has_tips &&
    day.open_action_count === 0
  )).length;

  return {
    trip_schema_version: OURTRIPS_TRIP_SCHEMA_VERSION,
    warnings,
    errors,
    issues,
    logistics,
    days: dayReports,
    summary: {
      day_count: dayReports.length,
      ready_day_count: readyDayCount,
      open_action_count: dayReports.reduce((sum, day) => sum + day.open_action_count, 0),
    },
  };
}

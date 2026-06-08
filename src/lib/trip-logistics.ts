import { normalizeTripData } from './trip-data-normalize';
import type { Accommodation, Day, Transport, TripData } from './types';

export const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export type TripLogisticsIssueLevel = 'warning' | 'error';

export interface TripLogisticsIssue {
  level: TripLogisticsIssueLevel;
  code: string;
  path: string;
  message: string;
}

export interface TripLogisticsOpenQuestion {
  kind: 'accommodation' | 'transport' | 'meal' | 'date';
  path: string;
  message: string;
}

export interface TripLogisticsDay {
  day_number: number;
  date: string;
  path: string;
}

export interface StaySegment {
  hotelName: string;
  status?: string;
  booking_status?: string;
  checkInDate?: string;
  checkOutDate?: string;
  nights: number;
  sleepCount: number;
  dayNumbers: number[];
  dates: string[];
  sourcePath: string;
}

export interface TransportRequirement {
  day_number: number;
  date: string;
  mode: string;
  label: string;
  from?: string;
  to?: string;
  depart?: string;
  arrive?: string;
  status?: string;
  booking_status?: string;
  reservation_required?: boolean;
  sourcePath: string;
}

export interface TripConstraintLedger {
  glossary: {
    day: string;
    sleep: string;
    staySegment: string;
    transportLeg: string;
  };
  dateRange: {
    start: string;
    end: string;
    expectedDayCount?: number;
    actualDayCount: number;
  };
  days: TripLogisticsDay[];
  staySegments: StaySegment[];
  transportRequirements: TransportRequirement[];
  openQuestions: TripLogisticsOpenQuestion[];
}

export interface TripLogisticsAudit {
  ledger: TripConstraintLedger;
  issues: TripLogisticsIssue[];
  warnings: string[];
  errors: string[];
  summary: {
    day_count: number;
    expected_day_count?: number;
    stay_segment_count: number;
    sleep_count: number;
    transport_requirement_count: number;
    open_question_count: number;
  };
}

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function statusText(value: unknown): string {
  return text(value).toLowerCase();
}

function isOpenStatus(value: unknown): boolean {
  const status = statusText(value);
  return status === 'open' || status === 'pending' || status === 'reserved' || status === 'hold';
}

function isCommittedStatus(value: unknown): boolean {
  const status = statusText(value);
  return status === 'booked' || status === 'confirmed';
}

function isActionStatus(value: unknown): boolean {
  return isOpenStatus(value) || isCommittedStatus(value);
}

function addIssue(issues: TripLogisticsIssue[], issue: TripLogisticsIssue): void {
  issues.push(issue);
}

function parseIsoDateParts(value: string): { year: number; month: number; day: number } | null {
  if (!ISO_DATE_RE.test(value)) return null;
  const [year, month, day] = value.split('-').map(Number);
  return { year, month, day };
}

function isoDateToTime(value: string): number | null {
  const parts = parseIsoDateParts(value);
  if (!parts) return null;

  const time = Date.UTC(parts.year, parts.month - 1, parts.day);
  const parsed = new Date(time);
  if (
    parsed.getUTCFullYear() !== parts.year ||
    parsed.getUTCMonth() !== parts.month - 1 ||
    parsed.getUTCDate() !== parts.day
  ) {
    return null;
  }

  return time;
}

export function isIsoDateString(value: string): boolean {
  return isoDateToTime(value) !== null;
}

export function diffIsoDatesInDays(start: string, end: string): number | null {
  const startTime = isoDateToTime(start);
  const endTime = isoDateToTime(end);
  if (startTime === null || endTime === null) return null;
  return Math.round((endTime - startTime) / ONE_DAY_MS);
}

export function addIsoDays(date: string, days: number): string | undefined {
  const time = isoDateToTime(date);
  if (time === null) return undefined;
  return new Date(time + days * ONE_DAY_MS).toISOString().slice(0, 10);
}

function extractIsoDate(value: string): string | undefined {
  return value.match(/\b\d{4}-\d{2}-\d{2}\b/)?.[0];
}

function validateIsoDate(
  issues: TripLogisticsIssue[],
  path: string,
  label: string,
  value: string
): boolean {
  if (isIsoDateString(value)) return true;
  addIssue(issues, {
    level: 'error',
    code: 'invalid_iso_date',
    path,
    message: `${label} must be a real ISO date in YYYY-MM-DD format.`,
  });
  return false;
}

function transportStatus(transport: Transport): string | undefined {
  return text(transport.booking_status) || text(transport.status) || undefined;
}

function isScheduledMode(mode: string): boolean {
  return ['flight', 'plane', 'train', 'ferry', 'ship', 'bus', 'coach', 'transfer'].includes(
    mode.toLowerCase()
  );
}

function transportNeedsContract(transport: Transport): boolean {
  return Boolean(
    transport.reservation_required ||
      isActionStatus(transport.booking_status ?? transport.status) ||
      text(transport.depart) ||
      text(transport.arrive) ||
      isScheduledMode(text(transport.mode))
  );
}

function sameAccommodation(left?: Accommodation | null, right?: Accommodation | null): boolean {
  if (!left || !right) return false;
  return text(left.name).toLowerCase() === text(right.name).toLowerCase();
}

function addOpenQuestion(
  ledger: TripConstraintLedger,
  question: TripLogisticsOpenQuestion
): void {
  ledger.openQuestions.push(question);
}

function auditDateRange(data: TripData, ledger: TripConstraintLedger, issues: TripLogisticsIssue[]): void {
  const start = text(data.trip.dates?.start);
  const end = text(data.trip.dates?.end);
  const days = data.days ?? [];
  const startValid = validateIsoDate(issues, 'trip.dates.start', 'Trip start date', start);
  const endValid = validateIsoDate(issues, 'trip.dates.end', 'Trip end date', end);

  if (startValid && endValid) {
    const diff = diffIsoDatesInDays(start, end);
    if (diff !== null && diff < 0) {
      addIssue(issues, {
        level: 'error',
        code: 'date_range_reversed',
        path: 'trip.dates',
        message: 'Trip end date must be the same as or after the start date.',
      });
    } else if (diff !== null) {
      ledger.dateRange.expectedDayCount = diff + 1;
      if (days.length !== diff + 1) {
        addIssue(issues, {
          level: 'error',
          code: 'day_count_mismatch',
          path: 'days',
          message: `Trip dates ${start} to ${end} require ${diff + 1} calendar days, but the itinerary has ${days.length}.`,
        });
      }
    }
  }

  days.forEach((day, index) => {
    const path = `days[${index}]`;
    const expectedDayNumber = index + 1;
    const dayDate = text(day.date);
    const dayNumber = day.day_number;

    if (dayNumber !== expectedDayNumber) {
      addIssue(issues, {
        level: 'error',
        code: 'day_number_sequence_mismatch',
        path: `${path}.day_number`,
        message: `Day at index ${index} must have day_number ${expectedDayNumber}, but has ${dayNumber}.`,
      });
    }

    const dayDateValid = validateIsoDate(issues, `${path}.date`, `Day ${dayNumber} date`, dayDate);
    if (startValid && dayDateValid) {
      const expectedDate = addIsoDays(start, index);
      if (expectedDate && dayDate !== expectedDate) {
        addIssue(issues, {
          level: 'error',
          code: 'day_date_sequence_mismatch',
          path: `${path}.date`,
          message: `Day ${dayNumber} must be dated ${expectedDate} based on the trip start date, but is ${dayDate}.`,
        });
      }
    }

    ledger.days.push({
      day_number: dayNumber,
      date: dayDate,
      path,
    });
  });
}

function buildStaySegment(
  days: Day[],
  startIndex: number,
  endIndex: number,
  sourceAccommodation: Accommodation,
  issues: TripLogisticsIssue[],
  ledger: TripConstraintLedger
): StaySegment {
  const segmentDays = days.slice(startIndex, endIndex + 1);
  const sourcePath = `days[${startIndex}].accommodation`;
  const explicitNights = sourceAccommodation.nights;
  const sleepCount = segmentDays.length;
  const nights =
    typeof explicitNights === 'number' && Number.isFinite(explicitNights)
      ? explicitNights
      : sleepCount;
  const checkInDate = text(segmentDays[0]?.date) || undefined;
  const checkOutDate = checkInDate ? addIsoDays(checkInDate, nights) : undefined;
  const status = text(sourceAccommodation.status) || undefined;
  const bookingStatus = text(sourceAccommodation.booking_status) || undefined;
  const dayNumbers = segmentDays.map((day) => day.day_number);
  const dates = segmentDays.map((day) => text(day.date));

  if (explicitNights !== undefined && (!Number.isInteger(explicitNights) || explicitNights <= 0)) {
    addIssue(issues, {
      level: 'error',
      code: 'invalid_accommodation_nights',
      path: `${sourcePath}.nights`,
      message: `Accommodation "${sourceAccommodation.name}" nights must be a positive integer.`,
    });
  } else if (explicitNights !== undefined && explicitNights !== sleepCount) {
    addIssue(issues, {
      level: 'error',
      code: 'stay_sleep_count_mismatch',
      path: `${sourcePath}.nights`,
      message: `Accommodation "${sourceAccommodation.name}" says ${explicitNights} night${explicitNights === 1 ? '' : 's'}, but appears on ${sleepCount} itinerary day${sleepCount === 1 ? '' : 's'}. One public accommodation day equals one sleep.`,
    });
  }

  segmentDays.forEach((day, offset) => {
    const dayNights = day.accommodation?.nights;
    if (dayNights === undefined || dayNights === explicitNights) return;
    const dayPath = `days[${startIndex + offset}].accommodation.nights`;
    if (!Number.isInteger(dayNights) || dayNights <= 0) {
      addIssue(issues, {
        level: 'error',
        code: 'invalid_accommodation_nights',
        path: dayPath,
        message: `Accommodation "${sourceAccommodation.name}" nights must be a positive integer.`,
      });
      return;
    }
    addIssue(issues, {
      level: 'error',
      code: 'stay_segment_nights_inconsistent',
      path: dayPath,
      message: `Accommodation "${sourceAccommodation.name}" uses inconsistent nights inside one stay segment: expected ${nights}, found ${dayNights} on Day ${day.day_number}.`,
    });
  });

  if (checkInDate && !isIsoDateString(checkInDate)) {
    addIssue(issues, {
      level: 'error',
      code: 'invalid_stay_check_in_date',
      path: `${sourcePath}.checkInDate`,
      message: `Stay segment "${sourceAccommodation.name}" has an invalid check-in date.`,
    });
  }

  if (isOpenStatus(sourceAccommodation.booking_status ?? sourceAccommodation.status)) {
    addOpenQuestion(ledger, {
      kind: 'accommodation',
      path: sourcePath,
      message: `Confirm or replace accommodation "${sourceAccommodation.name}" for ${sleepCount} sleep${sleepCount === 1 ? '' : 's'}.`,
    });
  }

  if (/[\/|]|\s+or\s+/i.test(sourceAccommodation.name)) {
    addIssue(issues, {
      level: 'warning',
      code: 'combined_accommodation_name',
      path: `${sourcePath}.name`,
      message: `Accommodation "${sourceAccommodation.name}" looks like multiple options. Public accommodation should be one booked/current stay or one placeholder.`,
    });
  }

  return {
    hotelName: sourceAccommodation.name,
    status,
    booking_status: bookingStatus,
    checkInDate,
    checkOutDate,
    nights,
    sleepCount,
    dayNumbers,
    dates,
    sourcePath,
  };
}

function auditStaySegments(data: TripData, ledger: TripConstraintLedger, issues: TripLogisticsIssue[]): void {
  const days = data.days ?? [];
  for (let index = 0; index < days.length; index += 1) {
    const accommodation = days[index].accommodation;
    if (!accommodation) continue;

    let endIndex = index;
    while (endIndex + 1 < days.length && sameAccommodation(accommodation, days[endIndex + 1].accommodation)) {
      endIndex += 1;
    }

    ledger.staySegments.push(buildStaySegment(days, index, endIndex, accommodation, issues, ledger));
    index = endIndex;
  }
}

function auditTransport(data: TripData, ledger: TripConstraintLedger, issues: TripLogisticsIssue[]): void {
  for (const [dayIndex, day] of (data.days ?? []).entries()) {
    for (const [transportIndex, transport] of (day.transport ?? []).entries()) {
      const path = `days[${dayIndex}].transport[${transportIndex}]`;
      const requirement: TransportRequirement = {
        day_number: day.day_number,
        date: day.date,
        mode: transport.mode,
        label: transport.label,
        from: text(transport.from) || undefined,
        to: text(transport.to) || undefined,
        depart: text(transport.depart) || undefined,
        arrive: text(transport.arrive) || undefined,
        status: text(transport.status) || undefined,
        booking_status: text(transport.booking_status) || undefined,
        reservation_required: transport.reservation_required,
        sourcePath: path,
      };

      if (transportNeedsContract(transport)) {
        ledger.transportRequirements.push(requirement);
      }

      const status = transportStatus(transport);
      if (isOpenStatus(status)) {
        addOpenQuestion(ledger, {
          kind: 'transport',
          path,
          message: `Resolve ${transport.mode} transport "${transport.label}" on Day ${day.day_number}.`,
        });
      }

      if (transportNeedsContract(transport) && (!text(transport.from) || !text(transport.to))) {
        addIssue(issues, {
          level: 'error',
          code: 'transport_route_missing',
          path,
          message: `Transport "${transport.label}" on Day ${day.day_number} needs both from and to fields.`,
        });
      }

      if (
        (transport.reservation_required || isCommittedStatus(status)) &&
        isScheduledMode(text(transport.mode)) &&
        !text(transport.depart)
      ) {
        addIssue(issues, {
          level: 'error',
          code: 'transport_departure_missing',
          path: `${path}.depart`,
          message: `Scheduled transport "${transport.label}" on Day ${day.day_number} needs a departure time or label.`,
        });
      }

      if (isScheduledMode(text(transport.mode)) && !status) {
        addIssue(issues, {
          level: 'warning',
          code: 'transport_status_missing',
          path: `${path}.booking_status`,
          message: `Scheduled transport "${transport.label}" on Day ${day.day_number} should say whether it is booked, open, pending, or optional.`,
        });
      }

      const departDate = extractIsoDate(text(transport.depart));
      if (departDate && departDate !== day.date) {
        addIssue(issues, {
          level: 'error',
          code: 'transport_departure_date_mismatch',
          path: `${path}.depart`,
          message: `Transport "${transport.label}" departs on ${departDate}, but is placed on Day ${day.day_number} (${day.date}).`,
        });
      }

      const arriveDate = extractIsoDate(text(transport.arrive));
      if (arriveDate && isIsoDateString(arriveDate) && isIsoDateString(day.date)) {
        const arriveOffset = diffIsoDatesInDays(day.date, arriveDate);
        if (arriveOffset !== null && arriveOffset < 0) {
          addIssue(issues, {
            level: 'error',
            code: 'transport_arrival_before_day',
            path: `${path}.arrive`,
            message: `Transport "${transport.label}" arrives before its itinerary day.`,
          });
        }
      }
    }
  }
}

export function auditTripLogistics(data: unknown): TripLogisticsAudit {
  const normalized = normalizeTripData(data);
  const issues: TripLogisticsIssue[] = [];
  const ledger: TripConstraintLedger = {
    glossary: {
      day: 'One calendar itinerary date.',
      sleep: 'One overnight stay: check-in date inclusive, check-out date exclusive.',
      staySegment: 'A contiguous allocation of one hotel/stay across one or more sleeps.',
      transportLeg: 'One atomic movement from an origin to a destination on a specific itinerary day.',
    },
    dateRange: {
      start: text(normalized.trip.dates?.start),
      end: text(normalized.trip.dates?.end),
      actualDayCount: normalized.days.length,
    },
    days: [],
    staySegments: [],
    transportRequirements: [],
    openQuestions: [],
  };

  auditDateRange(normalized, ledger, issues);
  auditStaySegments(normalized, ledger, issues);
  auditTransport(normalized, ledger, issues);

  const errors = issues.filter((issue) => issue.level === 'error').map((issue) => issue.message);
  const warnings = issues.filter((issue) => issue.level === 'warning').map((issue) => issue.message);

  return {
    ledger,
    issues,
    warnings,
    errors,
    summary: {
      day_count: ledger.days.length,
      expected_day_count: ledger.dateRange.expectedDayCount,
      stay_segment_count: ledger.staySegments.length,
      sleep_count: ledger.staySegments.reduce((sum, segment) => sum + segment.sleepCount, 0),
      transport_requirement_count: ledger.transportRequirements.length,
      open_question_count: ledger.openQuestions.length,
    },
  };
}

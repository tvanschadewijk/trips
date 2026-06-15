import { auditTripLogistics, diffIsoDatesInDays } from '@/lib/trip-logistics';
import { normalizeTripData } from '@/lib/trip-data-normalize';
import type { Day, TripData } from '@/lib/types';

export interface TripLogisticsLedgerDay {
  day_number: number;
  date: string;
  weekday?: string;
  title: string;
  day_type?: string;
  sleep_location: string | null;
  sleep_status?: string;
  stay_segment_index: number | null;
  transport_summary: string[];
}

export interface TripLogisticsLedgerStay {
  index: number;
  stay_name: string;
  check_in: string | null;
  check_out: string | null;
  nights: number;
  day_numbers: number[];
  dates: string[];
  status?: string;
  booking_status?: string;
  source_path: string;
}

export interface TripLogisticsLedgerAnswer {
  trip_starts_on: string;
  trip_ends_on: string;
  itinerary_day_count: number;
  expected_itinerary_day_count?: number;
  calendar_nights_between_start_and_end?: number;
  scheduled_sleep_count: number;
  stays: Array<{
    stay_name: string;
    check_in: string | null;
    check_out: string | null;
    nights: number;
    days: string;
  }>;
}

export interface TripLogisticsLedger {
  status: 'ok' | 'needs_repair';
  source_of_truth: 'trips.data';
  trip_name: string;
  trip_span: {
    start_date: string;
    end_date: string;
    start_weekday?: string;
    end_weekday?: string;
    expected_itinerary_day_count?: number;
    actual_itinerary_day_count: number;
    calendar_nights_between_start_and_end?: number;
    scheduled_sleep_count: number;
  };
  direct_answers: TripLogisticsLedgerAnswer;
  day_ledger: TripLogisticsLedgerDay[];
  stay_ledger: TripLogisticsLedgerStay[];
  validation: {
    error_count: number;
    warning_count: number;
    open_question_count: number;
    errors: string[];
    warnings: string[];
    open_questions: Array<{
      kind: string;
      path: string;
      message: string;
    }>;
  };
  rules: string[];
}

function weekdayForIsoDate(date: string): string | undefined {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return undefined;
  const parsed = new Date(`${date}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) return undefined;
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'long',
    timeZone: 'UTC',
  }).format(parsed);
}

function compactDayRange(dayNumbers: number[]): string {
  if (dayNumbers.length === 0) return '';
  if (dayNumbers.length === 1) return `Day ${dayNumbers[0]}`;
  return `Days ${dayNumbers[0]}-${dayNumbers[dayNumbers.length - 1]}`;
}

function dayTransportSummary(day: Day): string[] {
  return (day.transport ?? []).map((transport) => {
    const route = [transport.from, transport.to].filter(Boolean).join(' -> ');
    const time = [transport.depart, transport.arrive].filter(Boolean).join(' - ');
    return [transport.label, route, time].filter(Boolean).join(' | ');
  });
}

export function buildTripLogisticsLedger(input: unknown): TripLogisticsLedger {
  const trip = normalizeTripData(input) as TripData;
  const audit = auditTripLogistics(trip);
  const calendarNights =
    audit.ledger.dateRange.start && audit.ledger.dateRange.end
      ? diffIsoDatesInDays(audit.ledger.dateRange.start, audit.ledger.dateRange.end) ?? undefined
      : undefined;

  const dayToStayIndex = new Map<number, number>();
  audit.ledger.staySegments.forEach((segment, index) => {
    for (const dayNumber of segment.dayNumbers) {
      dayToStayIndex.set(dayNumber, index + 1);
    }
  });

  const day_ledger = trip.days.map((day) => {
    const stayIndex = dayToStayIndex.get(day.day_number) ?? null;
    const sleepStatus =
      day.accommodation?.booking_status ?? day.accommodation?.status ?? undefined;

    return {
      day_number: day.day_number,
      date: day.date,
      weekday: weekdayForIsoDate(day.date),
      title: day.title,
      day_type: day.day_type,
      sleep_location: day.accommodation?.name ?? null,
      sleep_status: sleepStatus,
      stay_segment_index: stayIndex,
      transport_summary: dayTransportSummary(day),
    };
  });

  const stay_ledger = audit.ledger.staySegments.map((segment, index) => ({
    index: index + 1,
    stay_name: segment.hotelName,
    check_in: segment.checkInDate ?? null,
    check_out: segment.checkOutDate ?? null,
    nights: segment.nights,
    day_numbers: segment.dayNumbers,
    dates: segment.dates,
    status: segment.status,
    booking_status: segment.booking_status,
    source_path: segment.sourcePath,
  }));

  return {
    status: audit.errors.length ? 'needs_repair' : 'ok',
    source_of_truth: 'trips.data',
    trip_name: trip.trip.name,
    trip_span: {
      start_date: audit.ledger.dateRange.start,
      end_date: audit.ledger.dateRange.end,
      start_weekday: weekdayForIsoDate(audit.ledger.dateRange.start),
      end_weekday: weekdayForIsoDate(audit.ledger.dateRange.end),
      expected_itinerary_day_count: audit.ledger.dateRange.expectedDayCount,
      actual_itinerary_day_count: audit.ledger.dateRange.actualDayCount,
      calendar_nights_between_start_and_end: calendarNights,
      scheduled_sleep_count: audit.summary.sleep_count,
    },
    direct_answers: {
      trip_starts_on: audit.ledger.dateRange.start,
      trip_ends_on: audit.ledger.dateRange.end,
      itinerary_day_count: audit.ledger.dateRange.actualDayCount,
      expected_itinerary_day_count: audit.ledger.dateRange.expectedDayCount,
      calendar_nights_between_start_and_end: calendarNights,
      scheduled_sleep_count: audit.summary.sleep_count,
      stays: stay_ledger.map((stay) => ({
        stay_name: stay.stay_name,
        check_in: stay.check_in,
        check_out: stay.check_out,
        nights: stay.nights,
        days: compactDayRange(stay.day_numbers),
      })),
    },
    day_ledger,
    stay_ledger,
    validation: {
      error_count: audit.errors.length,
      warning_count: audit.warnings.length,
      open_question_count: audit.ledger.openQuestions.length,
      errors: audit.errors,
      warnings: audit.warnings,
      open_questions: audit.ledger.openQuestions,
    },
    rules: [
      'trip.trip.dates.start is the canonical trip start date.',
      'trip.trip.dates.end is the canonical final itinerary date.',
      'Day count is the inclusive calendar span from start to end and must match days.length.',
      'One public accommodation day represents one sleep/night.',
      'Stay check-in is the first date in the stay segment; check-out is the morning after the final sleep.',
      'Agents should read this ledger before answering date, duration, stay, or route-shape questions.',
    ],
  };
}

import type {
  Accommodation,
  AccommodationCandidate,
  AccommodationCandidateBooking,
  AccommodationReview,
  AccommodationReviewDestination,
  AccommodationReviewEvent,
  AccommodationReviewLane,
  TripData,
} from '@/lib/types';

export const ACCOMMODATION_REVIEW_LANES: {
  id: AccommodationReviewLane;
  label: string;
}[] = [
  { id: 'proposed', label: 'Agent proposes' },
  { id: 'considering', label: 'Under consideration' },
  { id: 'dismissed', label: 'Dismissed' },
  { id: 'booked', label: 'Booked' },
];

export class AccommodationReviewConflictError extends Error {
  existingCandidateId: string;

  constructor(message: string, existingCandidateId: string) {
    super(message);
    this.name = 'AccommodationReviewConflictError';
    this.existingCandidateId = existingCandidateId;
  }
}

const OLD_LANE_MAP: Record<string, AccommodationReviewLane> = {
  booked: 'booked',
  'booked-action-needed': 'booked',
  'ready-to-book': 'considering',
  'almost-ready': 'considering',
  'your-call': 'considering',
  'waiting-reply': 'considering',
  'backup-later': 'considering',
  'keep-searching': 'proposed',
  rejected: 'dismissed',
  proposed: 'proposed',
  considering: 'considering',
  dismissed: 'dismissed',
};

function slugify(value: string): string {
  const slug = value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 72);
  return slug || 'stay';
}

function uniqueId(base: string, used: Set<string>): string {
  let candidate = base;
  let index = 2;
  while (used.has(candidate)) {
    candidate = `${base}-${index}`;
    index += 1;
  }
  used.add(candidate);
  return candidate;
}

function addDays(date: string, days: number): string | undefined {
  if (!date) return undefined;
  const parsed = new Date(`${date}T12:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return undefined;
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}

function formatDate(date: string): string {
  return new Date(`${date}T12:00:00`).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
  });
}

function formatDateRange(startDate?: string, endDate?: string): string | undefined {
  if (!startDate) return undefined;
  if (!endDate || endDate === startDate) return formatDate(startDate);
  return `${formatDate(startDate)}-${formatDate(endDate)}`;
}

function laneFromAccommodation(accommodation: Accommodation): AccommodationReviewLane {
  const status = accommodation.status?.toLowerCase();
  if (status === 'booked' || status === 'confirmed') return 'booked';
  if (status === 'rejected' || status === 'dismissed') return 'dismissed';
  if (status === 'pending' || status === 'reserved') return 'considering';
  return 'considering';
}

function normalizeLane(value: unknown): AccommodationReviewLane {
  if (typeof value !== 'string') return 'proposed';
  return OLD_LANE_MAP[value] ?? 'proposed';
}

function compactObject<T extends Record<string, unknown>>(value: T): T {
  const next: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (item === undefined || item === null || item === '') continue;
    if (Array.isArray(item) && item.length === 0) continue;
    if (
      typeof item === 'object' &&
      !Array.isArray(item) &&
      Object.keys(item as Record<string, unknown>).length === 0
    ) {
      continue;
    }
    next[key] = item;
  }
  return next as T;
}

function cloneTripData(tripData: TripData): TripData {
  return JSON.parse(JSON.stringify(tripData)) as TripData;
}

function cloneReview(review: AccommodationReview): AccommodationReview {
  return JSON.parse(JSON.stringify(review)) as AccommodationReview;
}

function eventId(): string {
  return `evt-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function eventFor(args: Omit<AccommodationReviewEvent, 'id' | 'createdAt'>): AccommodationReviewEvent {
  return {
    ...args,
    id: eventId(),
    createdAt: new Date().toISOString(),
  };
}

function destinationTitleFromDayTitle(title: string): string {
  const parts = title.split(/\s*(?:->|→|-)\s*/).filter(Boolean);
  return parts[parts.length - 1]?.trim() || title;
}

function linkFromAccommodation(accommodation: Accommodation) {
  const platform = accommodation.detail?.booking_platform;
  if (!platform || !/^https?:\/\//i.test(platform)) return undefined;
  return { label: 'Booking link', url: platform };
}

function candidateFromAccommodation(args: {
  accommodation: Accommodation;
  destination: AccommodationReviewDestination;
  index: number;
}): AccommodationCandidate {
  const { accommodation, destination, index } = args;
  const detail = accommodation.detail;
  const link = linkFromAccommodation(accommodation);

  return compactObject({
    id: `${destination.id}-${slugify(accommodation.name)}-${index + 1}`,
    destinationId: destination.id,
    stop: destination.title,
    dates: destination.dates,
    nights: accommodation.nights ?? destination.nights,
    lane: laneFromAccommodation(accommodation),
    status: accommodation.status,
    candidate: accommodation.name,
    price: accommodation.price,
    dog: detail?.dog_note,
    parking: detail?.parking,
    terms: detail?.cancellation_deadline,
    why: detail?.why ?? detail?.body,
    blockers: detail?.practical,
    action: accommodation.note ?? detail?.booking_note,
    links: link ? [link] : undefined,
    ratings: accommodation.rating
      ? [{ name: accommodation.name, google: accommodation.rating }]
      : undefined,
    dayNumbers: destination.dayNumbers,
    checkInDate: destination.startDate,
    checkOutDate: destination.endDate,
    address: detail?.address,
    createdBy: 'import',
    updatedAt: new Date().toISOString(),
  } satisfies AccommodationCandidate);
}

export function buildInitialAccommodationReview(tripData: TripData): AccommodationReview {
  const usedDestinationIds = new Set<string>();
  const destinations: AccommodationReviewDestination[] = [];
  const accommodations: AccommodationCandidate[] = [];
  const days = tripData.days ?? [];

  for (let index = 0; index < days.length; index += 1) {
    const day = days[index];
    const stay = day.accommodation;
    if (!stay) continue;

    const groupedDays = [day];
    let cursor = index + 1;
    while (
      cursor < days.length &&
      days[cursor].accommodation?.name === stay.name
    ) {
      groupedDays.push(days[cursor]);
      cursor += 1;
    }

    const nights = stay.nights ?? groupedDays.length;
    const startDate = day.date;
    const endDate = addDays(startDate, Math.max(1, nights));
    const title = destinationTitleFromDayTitle(day.title);
    const destinationId = uniqueId(
      `${day.day_number}-${slugify(title || stay.name)}`,
      usedDestinationIds
    );
    const destination = compactObject({
      id: destinationId,
      title,
      dates: formatDateRange(startDate, endDate),
      nights,
      dayNumbers: groupedDays.map((groupedDay) => groupedDay.day_number),
      startDate,
      endDate,
    } satisfies AccommodationReviewDestination);

    destinations.push(destination);
    accommodations.push(
      candidateFromAccommodation({
        accommodation: stay,
        destination,
        index: accommodations.length,
      })
    );
    index = cursor - 1;
  }

  const tripSlug = slugify(tripData.trip.name);
  return {
    tripTitle: tripData.trip.name,
    tripSlug,
    generatedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    storageKey: `ourtrips:accommodation-review:${tripSlug}`,
    summary: tripData.trip.subtitle || tripData.trip.summary,
    destinations,
    accommodations,
    events: [],
    reviewerVersion: 1,
    layoutVersion: 'kanban-v1',
  };
}

export function normalizeAccommodationReview(
  raw: unknown,
  tripData: TripData
): AccommodationReview {
  if (!raw || typeof raw !== 'object') return buildInitialAccommodationReview(tripData);
  const input = raw as Partial<AccommodationReview> & {
    hotels?: AccommodationCandidate[];
  };
  const fallback = buildInitialAccommodationReview(tripData);
  const accommodations = Array.isArray(input.accommodations)
    ? input.accommodations
    : Array.isArray(input.hotels)
      ? input.hotels
      : fallback.accommodations;
  const destinations = Array.isArray(input.destinations)
    ? input.destinations
    : fallback.destinations;

  return {
    ...fallback,
    ...input,
    tripTitle: input.tripTitle || tripData.trip.name,
    tripSlug: input.tripSlug || fallback.tripSlug,
    storageKey: input.storageKey || fallback.storageKey,
    generatedAt: input.generatedAt || fallback.generatedAt,
    updatedAt: input.updatedAt || new Date().toISOString(),
    destinations: destinations.map((destination) => ({
      ...destination,
      id: destination.id || slugify(destination.title || 'stay'),
      title: destination.title || 'Stay',
    })),
    accommodations: accommodations.map((candidate, index) => ({
      ...candidate,
      id: candidate.id || `candidate-${index + 1}`,
      destinationId:
        candidate.destinationId ||
        destinations[0]?.id ||
        fallback.destinations[0]?.id ||
        'stay',
      stop: candidate.stop || destinations[0]?.title || 'Stay',
      lane: normalizeLane(candidate.lane),
      candidate: candidate.candidate || `Stay option ${index + 1}`,
    })),
    events: Array.isArray(input.events) ? input.events : [],
    layoutVersion: 'kanban-v1',
  };
}

function sameDayNumbers(left?: number[], right?: number[]): boolean {
  if (!left?.length && !right?.length) return true;
  if (!left?.length || !right?.length || left.length !== right.length) return false;
  return left.every((dayNumber, index) => dayNumber === right[index]);
}

function candidateMatchesImportedStay(
  candidate: AccommodationCandidate,
  imported: AccommodationCandidate
): boolean {
  if (candidate.id === imported.id) return true;
  return (
    candidate.destinationId === imported.destinationId &&
    candidate.candidate === imported.candidate &&
    sameDayNumbers(candidate.dayNumbers, imported.dayNumbers)
  );
}

export function mergeAccommodationReviewWithTripData(
  raw: unknown,
  tripData: TripData
): AccommodationReview {
  const current = normalizeAccommodationReview(raw, tripData);
  const imported = buildInitialAccommodationReview(tripData);
  const next = cloneReview(current);
  let changed = false;

  for (const destination of imported.destinations) {
    if (!next.destinations.some((item) => item.id === destination.id)) {
      next.destinations.push(destination);
      changed = true;
    }
  }

  for (const candidate of imported.accommodations) {
    if (
      !next.accommodations.some((item) => candidateMatchesImportedStay(item, candidate))
    ) {
      next.accommodations.push(candidate);
      changed = true;
    }
  }

  next.tripTitle = tripData.trip.name;
  next.tripSlug = imported.tripSlug;
  next.storageKey = current.storageKey || imported.storageKey;
  next.summary = tripData.trip.subtitle || tripData.trip.summary || current.summary;
  next.layoutVersion = 'kanban-v1';
  if (changed) {
    next.updatedAt = new Date().toISOString();
  }

  return next;
}

export function moveAccommodationCandidate(
  review: AccommodationReview,
  candidateId: string,
  lane: AccommodationReviewLane,
  actor: 'agent' | 'user' | 'system',
  booking?: AccommodationCandidateBooking,
  message?: string
): AccommodationReview {
  const next = cloneReview(review);
  const candidate = next.accommodations.find((item) => item.id === candidateId);
  if (!candidate) {
    throw new Error(`Accommodation candidate not found: ${candidateId}`);
  }

  const fromLane = normalizeLane(candidate.lane);
  if (lane === 'booked') {
    const existingBooked = next.accommodations.find(
      (item) =>
        item.id !== candidateId &&
        item.destinationId === candidate.destinationId &&
        normalizeLane(item.lane) === 'booked'
    );
    if (existingBooked) {
      throw new AccommodationReviewConflictError(
        `${candidate.stop} already has a booked stay: ${existingBooked.candidate}. Move it out of Booked before booking another option.`,
        existingBooked.id
      );
    }
  }

  candidate.lane = lane;
  candidate.status = lane === 'booked' ? 'booked' : lane;
  candidate.updatedAt = new Date().toISOString();
  if (lane === 'booked') {
    candidate.booking = {
      ...(candidate.booking ?? {}),
      ...(booking ?? {}),
      bookedAt: booking?.bookedAt ?? candidate.booking?.bookedAt ?? new Date().toISOString(),
    };
  }

  next.updatedAt = new Date().toISOString();
  next.events = [
    ...(next.events ?? []),
    eventFor({
      type: lane === 'booked' ? 'candidate_booked' : 'candidate_moved',
      candidateId,
      destinationId: candidate.destinationId,
      actor,
      fromLane,
      toLane: lane,
      message,
    }),
  ].slice(-80);
  return next;
}

export function updateAccommodationCandidate(
  review: AccommodationReview,
  candidateId: string,
  patch: Partial<AccommodationCandidate>,
  actor: 'agent' | 'user' | 'system',
  message?: string
): AccommodationReview {
  const next = cloneReview(review);
  const index = next.accommodations.findIndex((item) => item.id === candidateId);
  if (index < 0) {
    throw new Error(`Accommodation candidate not found: ${candidateId}`);
  }

  next.accommodations[index] = {
    ...next.accommodations[index],
    ...patch,
    id: next.accommodations[index].id,
    destinationId: patch.destinationId ?? next.accommodations[index].destinationId,
    lane: patch.lane ? normalizeLane(patch.lane) : next.accommodations[index].lane,
    updatedAt: new Date().toISOString(),
  };
  next.updatedAt = new Date().toISOString();
  next.events = [
    ...(next.events ?? []),
    eventFor({
      type: 'candidate_updated',
      candidateId,
      destinationId: next.accommodations[index].destinationId,
      actor,
      message,
    }),
  ].slice(-80);
  return next;
}

export function addAccommodationCandidate(
  review: AccommodationReview,
  candidate: Omit<AccommodationCandidate, 'id'> & { id?: string },
  actor: 'agent' | 'user' | 'system',
  message?: string,
  destination?: AccommodationReviewDestination
): AccommodationReview {
  const next = cloneReview(review);
  if (destination && !next.destinations.some((item) => item.id === destination.id)) {
    next.destinations.push(destination);
  }

  const usedIds = new Set(next.accommodations.map((item) => item.id));
  const destinationId =
    candidate.destinationId ||
    destination?.id ||
    next.destinations[0]?.id ||
    'stay';
  const destinationRecord = next.destinations.find((item) => item.id === destinationId);
  const id = uniqueId(
    candidate.id || `${destinationId}-${slugify(candidate.candidate)}`,
    usedIds
  );
  const nextCandidate: AccommodationCandidate = {
    ...candidate,
    id,
    destinationId,
    stop: candidate.stop || destinationRecord?.title || destination?.title || 'Stay',
    lane: candidate.lane ?? 'proposed',
    createdBy: candidate.createdBy ?? actor,
    updatedAt: new Date().toISOString(),
  };

  next.accommodations.push(nextCandidate);
  next.updatedAt = new Date().toISOString();
  next.events = [
    ...(next.events ?? []),
    eventFor({
      type: 'candidate_created',
      candidateId: id,
      destinationId,
      actor,
      message,
    }),
  ].slice(-80);
  return next;
}

export function promoteCandidateToTrip(
  tripData: TripData,
  review: AccommodationReview,
  candidateId: string,
  booking?: AccommodationCandidateBooking
): TripData {
  const candidate = review.accommodations.find((item) => item.id === candidateId);
  if (!candidate) {
    throw new Error(`Accommodation candidate not found: ${candidateId}`);
  }
  const destination = review.destinations.find(
    (item) => item.id === candidate.destinationId
  );
  const dayNumbers = candidate.dayNumbers?.length
    ? candidate.dayNumbers
    : destination?.dayNumbers ?? [];
  if (dayNumbers.length === 0) {
    throw new Error('Candidate has no day numbers to promote into the itinerary.');
  }

  const next = cloneTripData(tripData);
  const nights = candidate.nights ?? destination?.nights ?? dayNumbers.length;
  const source = booking?.source ?? candidate.booking?.source;
  const confirmation = booking?.confirmation ?? candidate.booking?.confirmation;
  const price = booking?.price ?? candidate.booking?.price ?? candidate.price;
  const note = booking?.note ?? candidate.booking?.note ?? candidate.action;

  for (let index = 0; index < dayNumbers.length; index += 1) {
    const dayNumber = dayNumbers[index];
    const day = next.days.find((item) => item.day_number === dayNumber);
    if (!day) continue;
    const dayNote =
      index === 0
        ? note
        : `Night ${index + 1} of ${Math.max(nights, dayNumbers.length)}`;
    day.accommodation = compactObject({
      name: candidate.candidate,
      price,
      status: 'booked',
      nights,
      note: dayNote,
      detail: compactObject({
        check_in: candidate.checkInDate,
        check_out: candidate.checkOutDate,
        address: candidate.address,
        confirmation,
        booking_platform: source,
        cancellation_deadline: candidate.terms,
        parking: candidate.parking,
        dog_note: candidate.dog,
        why: candidate.why,
        practical: candidate.blockers,
        booking_note: candidate.action,
        note,
      }),
    }) as Accommodation;
  }

  return next;
}

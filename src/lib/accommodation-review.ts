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
  { id: 'proposed', label: 'Travel Agent Proposals' },
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

function isBookedAccommodation(accommodation: Accommodation): boolean {
  const status = accommodation.status?.toLowerCase();
  return status === 'booked' || status === 'confirmed';
}

function laneFromAccommodation(accommodation: Accommodation): AccommodationReviewLane {
  const status = accommodation.status?.toLowerCase();
  if (isBookedAccommodation(accommodation)) return 'booked';
  if (status === 'rejected' || status === 'dismissed') return 'dismissed';
  if (status === 'pending' || status === 'reserved') return 'considering';
  return 'considering';
}

function laneFromStatus(value: unknown): AccommodationReviewLane | null {
  if (typeof value !== 'string') return null;
  const status = value.toLowerCase();
  if (status === 'booked' || status === 'confirmed') return 'booked';
  if (status === 'rejected' || status === 'dismissed') return 'dismissed';
  if (status === 'pending' || status === 'reserved') return 'considering';
  return OLD_LANE_MAP[status] ?? null;
}

function normalizeLane(value: unknown, status?: unknown, hasBooking?: boolean): AccommodationReviewLane {
  const statusLane = laneFromStatus(status);
  if (statusLane === 'booked' || hasBooking) return 'booked';
  if (typeof value !== 'string') return statusLane ?? 'proposed';
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

function directWebsiteFromAccommodation(accommodation: Accommodation) {
  const { direct_website_url: url, direct_website_label: label } =
    accommodation.detail ?? {};
  if (!url || !/^https?:\/\//i.test(url)) return undefined;
  return { label: label || 'Official website', url };
}

function policySourceFromAccommodation(accommodation: Accommodation) {
  const { policy_source_url: url, policy_source_label: label } = accommodation.detail ?? {};
  if (!url || !/^https?:\/\//i.test(url)) return undefined;
  return { label: label || 'Policy source', url };
}

function mergeCandidateLinks(
  current?: AccommodationCandidate['links'],
  incoming?: AccommodationCandidate['links']
): AccommodationCandidate['links'] | undefined {
  const links: AccommodationCandidate['links'] = [];
  const seen = new Set<string>();

  for (const link of [...(current ?? []), ...(incoming ?? [])]) {
    if (!link?.url) continue;
    const key = link.url.trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    links.push(link);
  }

  return links.length ? links : undefined;
}

function mergeCandidateRatings(
  current?: AccommodationCandidate['ratings'],
  incoming?: AccommodationCandidate['ratings'],
  replaceExisting = false
): AccommodationCandidate['ratings'] | undefined {
  if (!current?.length) return incoming?.length ? incoming : undefined;
  if (!incoming?.length) return current;

  const next = current.map((rating) => ({ ...rating }));
  for (const incomingRating of incoming) {
    const match =
      next.find(
        (rating) =>
          rating.name &&
          incomingRating.name &&
          slugify(rating.name) === slugify(incomingRating.name)
      ) ?? next[0];

    if (match) {
      for (const key of [
        'checkedAt',
        'hotelsCom',
        'tripadvisor',
        'bookingCom',
        'google',
        'note',
      ] as const) {
        if (incomingRating[key] && (replaceExisting || !match[key])) {
          match[key] = incomingRating[key];
        }
      }
    } else {
      next.push({ ...incomingRating });
    }
  }

  return next;
}

function bookingFromAccommodation(
  accommodation: Accommodation
): AccommodationCandidateBooking | undefined {
  if (!isBookedAccommodation(accommodation)) return undefined;
  const detail = accommodation.detail;
  return compactObject({
    source: detail?.booking_platform,
    confirmation: detail?.confirmation,
    price: accommodation.price,
    note: accommodation.note ?? detail?.booking_note,
  } satisfies AccommodationCandidateBooking);
}

function candidateFromAccommodation(args: {
  accommodation: Accommodation;
  destination: AccommodationReviewDestination;
  index: number;
}): AccommodationCandidate {
  const { accommodation, destination, index } = args;
  const detail = accommodation.detail;
  const link = linkFromAccommodation(accommodation);
  const directWebsite = directWebsiteFromAccommodation(accommodation);
  const policySource = policySourceFromAccommodation(accommodation);

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
    directWebsite,
    links: mergeCandidateLinks(link ? [link] : undefined, policySource ? [policySource] : undefined),
    ratings: accommodation.rating
      ? [{ name: accommodation.name, google: accommodation.rating }]
      : undefined,
    dayNumbers: destination.dayNumbers,
    checkInDate: destination.startDate,
    checkOutDate: destination.endDate,
    address: detail?.address,
    roomType: detail?.room_type,
    checkIn: detail?.check_in,
    checkOut: detail?.check_out,
    phone: detail?.phone,
    wifi: detail?.wifi,
    policySource,
    policyConfidence: detail?.policy_confidence,
    hotelNote: detail?.note,
    booking: bookingFromAccommodation(accommodation),
    createdBy: 'import',
    updatedAt: new Date().toISOString(),
  } satisfies AccommodationCandidate);
}

function minDayNumber(dayNumbers?: number[]): number | null {
  if (!dayNumbers?.length) return null;
  const valid = dayNumbers.filter(Number.isFinite);
  return valid.length ? Math.min(...valid) : null;
}

function compareAccommodationDays(
  left: TripData['days'][number],
  right: TripData['days'][number]
): number {
  const leftDate = dateValue(left.date);
  const rightDate = dateValue(right.date);
  if (leftDate !== null && rightDate !== null && leftDate !== rightDate) {
    return leftDate - rightDate;
  }
  if (leftDate !== null && rightDate === null) return -1;
  if (leftDate === null && rightDate !== null) return 1;
  return left.day_number - right.day_number;
}

function compareDestinationsChronologically(
  left: AccommodationReviewDestination,
  right: AccommodationReviewDestination,
  originalIndex: Map<string, number>
): number {
  const leftDate = dateValue(left.startDate);
  const rightDate = dateValue(right.startDate);
  if (leftDate !== null && rightDate !== null && leftDate !== rightDate) {
    return leftDate - rightDate;
  }
  if (leftDate !== null && rightDate === null) return -1;
  if (leftDate === null && rightDate !== null) return 1;

  const leftDay = minDayNumber(left.dayNumbers);
  const rightDay = minDayNumber(right.dayNumbers);
  if (leftDay !== null && rightDay !== null && leftDay !== rightDay) {
    return leftDay - rightDay;
  }
  if (leftDay !== null && rightDay === null) return -1;
  if (leftDay === null && rightDay !== null) return 1;

  return (originalIndex.get(left.id) ?? 0) - (originalIndex.get(right.id) ?? 0);
}

function sortDestinationsChronologically(review: AccommodationReview): boolean {
  const originalIndex = new Map(
    review.destinations.map((destination, index) => [destination.id, index])
  );
  const sorted = [...review.destinations].sort((left, right) =>
    compareDestinationsChronologically(left, right, originalIndex)
  );
  const changed = sorted.some(
    (destination, index) => destination.id !== review.destinations[index]?.id
  );
  if (changed) {
    review.destinations = sorted;
  }
  return changed;
}

export function buildInitialAccommodationReview(tripData: TripData): AccommodationReview {
  const usedDestinationIds = new Set<string>();
  const destinations: AccommodationReviewDestination[] = [];
  const accommodations: AccommodationCandidate[] = [];
  const days = [...(tripData.days ?? [])].sort(compareAccommodationDays);

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

  const normalized = mergeOverlappingImportedDestinations(destinations, accommodations);
  const tripSlug = slugify(tripData.trip.name);
  return {
    tripTitle: tripData.trip.name,
    tripSlug,
    generatedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    storageKey: `ourtrips:accommodation-review:${tripSlug}`,
    summary: tripData.trip.subtitle || tripData.trip.summary,
    destinations: normalized.destinations,
    accommodations: normalized.accommodations,
    events: [],
    reviewerVersion: 1,
    layoutVersion: 'kanban-v1',
  };
}

function mergeOverlappingImportedDestinations(
  destinations: AccommodationReviewDestination[],
  accommodations: AccommodationCandidate[]
): {
  destinations: AccommodationReviewDestination[];
  accommodations: AccommodationCandidate[];
} {
  const nextDestinations: AccommodationReviewDestination[] = [];
  const destinationIdMap = new Map<string, string>();

  for (const destination of destinations) {
    const existing = nextDestinations.find((candidate) =>
      destinationsOverlap(candidate, destination)
    );

    if (!existing) {
      nextDestinations.push({ ...destination });
      destinationIdMap.set(destination.id, destination.id);
      continue;
    }

    destinationIdMap.set(destination.id, existing.id);
    const dayNumbers = Array.from(
      new Set([...(existing.dayNumbers ?? []), ...(destination.dayNumbers ?? [])])
    ).sort((a, b) => a - b);
    if (dayNumbers.length) existing.dayNumbers = dayNumbers;
  }

  const nextAccommodations = accommodations.map((candidate) => {
    const mappedDestinationId =
      destinationIdMap.get(candidate.destinationId) ?? candidate.destinationId;
    const destination = nextDestinations.find((item) => item.id === mappedDestinationId);
    if (!destination) {
      return candidate;
    }

    return compactObject({
      ...candidate,
      destinationId: mappedDestinationId,
      stop: destination.title,
      dates: destination.dates ?? candidate.dates,
      nights: destination.nights ?? candidate.nights,
      dayNumbers: destination.dayNumbers ?? candidate.dayNumbers,
      checkInDate: destination.startDate ?? candidate.checkInDate,
      checkOutDate: destination.endDate ?? candidate.checkOutDate,
    } satisfies AccommodationCandidate);
  });

  return {
    destinations: nextDestinations,
    accommodations: nextAccommodations,
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
      lane: normalizeLane(candidate.lane, candidate.status, Boolean(candidate.booking)),
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

function dayNumbersOverlap(left?: number[], right?: number[]): boolean {
  if (!left?.length || !right?.length) return false;
  const rightDays = new Set(right);
  return left.some((dayNumber) => rightDays.has(dayNumber));
}

function dateValue(date?: string): number | null {
  if (!date) return null;
  const parsed = Date.parse(`${date}T12:00:00Z`);
  return Number.isNaN(parsed) ? null : parsed;
}

function dateRangesOverlap(
  leftStart?: string,
  leftEnd?: string,
  rightStart?: string,
  rightEnd?: string
): boolean {
  const leftStartValue = dateValue(leftStart);
  const rightStartValue = dateValue(rightStart);
  if (leftStartValue === null || rightStartValue === null) return false;

  const oneDayMs = 24 * 60 * 60 * 1000;
  const leftEndValue = dateValue(leftEnd) ?? leftStartValue + oneDayMs;
  const rightEndValue = dateValue(rightEnd) ?? rightStartValue + oneDayMs;
  return leftStartValue < rightEndValue && rightStartValue < leftEndValue;
}

function sameStopTitle(
  left: AccommodationReviewDestination,
  right: AccommodationReviewDestination
): boolean {
  return slugify(left.title) === slugify(right.title);
}

function sameCandidateName(
  left: AccommodationCandidate,
  right: AccommodationCandidate
): boolean {
  return slugify(left.candidate) === slugify(right.candidate);
}

function destinationsOverlap(
  left: AccommodationReviewDestination,
  right: AccommodationReviewDestination
): boolean {
  if (!sameStopTitle(left, right)) return false;
  return (
    dateRangesOverlap(left.startDate, left.endDate, right.startDate, right.endDate) ||
    dayNumbersOverlap(left.dayNumbers, right.dayNumbers)
  );
}

function isImportedCandidate(candidate: AccommodationCandidate): boolean {
  return candidate.createdBy === 'import';
}

function syncDestinationFromImported(
  destination: AccommodationReviewDestination,
  imported: AccommodationReviewDestination
): boolean {
  let changed = false;

  if (destination.title !== imported.title) {
    destination.title = imported.title;
    changed = true;
  }
  if (imported.dates !== undefined && destination.dates !== imported.dates) {
    destination.dates = imported.dates;
    changed = true;
  }
  if (imported.nights !== undefined && destination.nights !== imported.nights) {
    destination.nights = imported.nights;
    changed = true;
  }
  if (imported.startDate !== undefined && destination.startDate !== imported.startDate) {
    destination.startDate = imported.startDate;
    changed = true;
  }
  if (imported.endDate !== undefined && destination.endDate !== imported.endDate) {
    destination.endDate = imported.endDate;
    changed = true;
  }

  if (
    imported.dayNumbers !== undefined &&
    JSON.stringify(destination.dayNumbers) !== JSON.stringify(imported.dayNumbers)
  ) {
    destination.dayNumbers = imported.dayNumbers;
    changed = true;
  }

  return changed;
}

function syncCandidateScheduleFromImported(
  candidate: AccommodationCandidate,
  imported: AccommodationCandidate
): boolean {
  let changed = false;

  if (candidate.stop !== imported.stop) {
    candidate.stop = imported.stop;
    changed = true;
  }
  if (imported.dates !== undefined && candidate.dates !== imported.dates) {
    candidate.dates = imported.dates;
    changed = true;
  }
  if (imported.nights !== undefined && candidate.nights !== imported.nights) {
    candidate.nights = imported.nights;
    changed = true;
  }
  if (imported.checkInDate !== undefined && candidate.checkInDate !== imported.checkInDate) {
    candidate.checkInDate = imported.checkInDate;
    changed = true;
  }
  if (imported.checkOutDate !== undefined && candidate.checkOutDate !== imported.checkOutDate) {
    candidate.checkOutDate = imported.checkOutDate;
    changed = true;
  }

  if (
    imported.dayNumbers !== undefined &&
    JSON.stringify(candidate.dayNumbers) !== JSON.stringify(imported.dayNumbers)
  ) {
    candidate.dayNumbers = imported.dayNumbers;
    changed = true;
  }

  return changed;
}

function hasCandidateValue(value: unknown): boolean {
  if (value === undefined || value === null) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'object') return Object.keys(value).length > 0;
  return true;
}

function syncCandidateField<K extends keyof AccommodationCandidate>(
  candidate: AccommodationCandidate,
  imported: AccommodationCandidate,
  key: K,
  replaceExisting: boolean
): boolean {
  const value = imported[key];
  if (!hasCandidateValue(value)) return false;
  if (!replaceExisting && hasCandidateValue(candidate[key])) return false;
  if (JSON.stringify(candidate[key]) === JSON.stringify(value)) return false;

  candidate[key] = value as AccommodationCandidate[K];
  return true;
}

function syncCandidateEvidenceFromImported(
  candidate: AccommodationCandidate,
  imported: AccommodationCandidate
): boolean {
  const replaceExisting = isImportedCandidate(candidate);
  let changed = false;

  for (const key of [
    'price',
    'dog',
    'parking',
    'terms',
    'why',
    'blockers',
    'action',
    'alternatives',
    'directWebsite',
    'address',
    'roomType',
    'checkIn',
    'checkOut',
    'phone',
    'wifi',
    'policySource',
    'policyConfidence',
    'hotelNote',
  ] as const) {
    changed = syncCandidateField(candidate, imported, key, replaceExisting) || changed;
  }

  const links = mergeCandidateLinks(candidate.links, imported.links);
  if (JSON.stringify(candidate.links) !== JSON.stringify(links)) {
    candidate.links = links;
    changed = true;
  }

  const ratings = mergeCandidateRatings(
    candidate.ratings,
    imported.ratings,
    replaceExisting
  );
  if (JSON.stringify(candidate.ratings) !== JSON.stringify(ratings)) {
    candidate.ratings = ratings;
    changed = true;
  }

  return changed;
}

function findMatchingImportedCandidate(
  candidates: AccommodationCandidate[],
  imported: AccommodationCandidate
): AccommodationCandidate | undefined {
  const matchers: Array<(candidate: AccommodationCandidate) => boolean> = [
    (candidate) => candidate.id === imported.id,
    (candidate) =>
      sameCandidateName(candidate, imported) &&
      Boolean(candidate.dayNumbers?.length) &&
      Boolean(imported.dayNumbers?.length) &&
      sameDayNumbers(candidate.dayNumbers, imported.dayNumbers),
    (candidate) =>
      sameCandidateName(candidate, imported) &&
      candidate.destinationId === imported.destinationId,
    (candidate) =>
      sameCandidateName(candidate, imported) &&
      dateRangesOverlap(
        candidate.checkInDate,
        candidate.checkOutDate,
        imported.checkInDate,
        imported.checkOutDate
      ),
  ];

  for (const matcher of matchers) {
    const importedCandidate = candidates.find(
      (candidate) => isImportedCandidate(candidate) && matcher(candidate)
    );
    if (importedCandidate) return importedCandidate;

    const candidate = candidates.find(matcher);
    if (candidate) return candidate;
  }

  return undefined;
}

function matchingDestination(
  destinations: AccommodationReviewDestination[],
  imported: AccommodationReviewDestination
): AccommodationReviewDestination | undefined {
  const exactMatch = destinations.find((destination) => {
    if (destination.id === imported.id) return true;
    if (
      destination.dayNumbers?.length &&
      imported.dayNumbers?.length &&
      sameDayNumbers(destination.dayNumbers, imported.dayNumbers)
    ) {
      return true;
    }
    return destination.title === imported.title && destination.dates === imported.dates;
  });
  if (exactMatch) return exactMatch;

  return destinations.find((destination) => destinationsOverlap(destination, imported));
}

function demoteOtherBookedCandidates(
  candidates: AccommodationCandidate[],
  bookedCandidate: AccommodationCandidate
): boolean {
  let changed = false;
  for (const candidate of candidates) {
    if (
      candidate.id !== bookedCandidate.id &&
      candidate.destinationId === bookedCandidate.destinationId &&
      normalizeLane(candidate.lane, candidate.status, Boolean(candidate.booking)) === 'booked'
    ) {
      candidate.lane = 'considering';
      if (
        candidate.status?.toLowerCase() === 'booked' ||
        candidate.status?.toLowerCase() === 'confirmed'
      ) {
        candidate.status = 'considering';
      }
      candidate.updatedAt = new Date().toISOString();
      changed = true;
    }
  }
  return changed;
}

function syncCandidateFromImportedStay(
  candidate: AccommodationCandidate,
  imported: AccommodationCandidate,
  allCandidates: AccommodationCandidate[]
): boolean {
  let changed = syncCandidateScheduleFromImported(candidate, imported);
  changed = syncCandidateEvidenceFromImported(candidate, imported) || changed;
  if (normalizeLane(imported.lane, imported.status, Boolean(imported.booking)) === 'booked') {
    changed = demoteOtherBookedCandidates(allCandidates, candidate) || changed;
    if (normalizeLane(candidate.lane, candidate.status, Boolean(candidate.booking)) !== 'booked') {
      candidate.lane = 'booked';
      changed = true;
    }
    if (candidate.status !== 'booked') {
      candidate.status = 'booked';
      changed = true;
    }

    const nextBooking = compactObject({
      ...(candidate.booking ?? {}),
      ...(imported.booking ?? {}),
      price: imported.booking?.price ?? candidate.booking?.price ?? imported.price,
    } satisfies AccommodationCandidateBooking);

    if (JSON.stringify(candidate.booking ?? {}) !== JSON.stringify(nextBooking)) {
      candidate.booking = nextBooking;
      changed = true;
    }
  }

  if (changed) {
    candidate.updatedAt = new Date().toISOString();
  }
  return changed;
}

function remapDuplicateDestinationCandidates(
  review: AccommodationReview,
  activeDestinationIds: Set<string>
): boolean {
  let changed = false;
  const activeDestinations = review.destinations.filter((destination) =>
    activeDestinationIds.has(destination.id)
  );

  for (const destination of review.destinations) {
    if (activeDestinationIds.has(destination.id)) continue;
    const activeDestination = activeDestinations.find((candidate) =>
      destinationsOverlap(destination, candidate)
    );
    if (!activeDestination) continue;

    for (const candidate of review.accommodations) {
      if (candidate.destinationId !== destination.id) continue;
      candidate.destinationId = activeDestination.id;
      candidate.stop = activeDestination.title;
      changed = true;
    }
  }

  return changed;
}

function pruneStaleImportedItems(
  review: AccommodationReview,
  liveImportedCandidateIds: Set<string>
): boolean {
  const accommodationCount = review.accommodations.length;
  review.accommodations = review.accommodations.filter(
    (candidate) => !isImportedCandidate(candidate) || liveImportedCandidateIds.has(candidate.id)
  );
  let changed = review.accommodations.length !== accommodationCount;

  const referencedDestinationIds = new Set(
    review.accommodations.map((candidate) => candidate.destinationId)
  );
  const destinationCount = review.destinations.length;
  review.destinations = review.destinations.filter((destination) =>
    referencedDestinationIds.has(destination.id)
  );
  changed = review.destinations.length !== destinationCount || changed;

  return changed;
}

export function mergeAccommodationReviewWithTripData(
  raw: unknown,
  tripData: TripData
): AccommodationReview {
  const current = normalizeAccommodationReview(raw, tripData);
  const imported = buildInitialAccommodationReview(tripData);
  const next = cloneReview(current);
  const destinationIdMap = new Map<string, string>();
  const liveImportedCandidateIds = new Set<string>();
  let changed = false;

  for (const destination of imported.destinations) {
    const existingDestination = matchingDestination(next.destinations, destination);
    if (existingDestination) {
      destinationIdMap.set(destination.id, existingDestination.id);
      changed = syncDestinationFromImported(existingDestination, destination) || changed;
    } else {
      next.destinations.push(destination);
      destinationIdMap.set(destination.id, destination.id);
      changed = true;
    }
  }

  for (const importedCandidate of imported.accommodations) {
    const mappedDestinationId =
      destinationIdMap.get(importedCandidate.destinationId) ?? importedCandidate.destinationId;
    const candidate = {
      ...importedCandidate,
      destinationId: mappedDestinationId,
      stop:
        next.destinations.find((destination) => destination.id === mappedDestinationId)?.title ??
        importedCandidate.stop,
    };
    const existing = findMatchingImportedCandidate(next.accommodations, candidate);
    if (existing) {
      if (existing.destinationId !== mappedDestinationId) {
        existing.destinationId = mappedDestinationId;
        changed = true;
      }
      changed = syncCandidateFromImportedStay(existing, candidate, next.accommodations) || changed;
      liveImportedCandidateIds.add(existing.id);
    } else {
      next.accommodations.push(candidate);
      liveImportedCandidateIds.add(candidate.id);
      if (normalizeLane(candidate.lane, candidate.status, Boolean(candidate.booking)) === 'booked') {
        changed = demoteOtherBookedCandidates(next.accommodations, candidate) || changed;
      }
      changed = true;
    }
  }

  const activeDestinationIds = new Set(destinationIdMap.values());
  changed = remapDuplicateDestinationCandidates(next, activeDestinationIds) || changed;
  changed = pruneStaleImportedItems(next, liveImportedCandidateIds) || changed;
  changed = sortDestinationsChronologically(next) || changed;

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
  } else {
    delete candidate.booking;
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

export function replaceBookedAccommodationCandidate(
  review: AccommodationReview,
  candidateId: string,
  actor: 'agent' | 'user' | 'system',
  booking?: AccommodationCandidateBooking,
  message?: string
): AccommodationReview {
  const next = cloneReview(review);
  const candidate = next.accommodations.find((item) => item.id === candidateId);
  if (!candidate) {
    throw new Error(`Accommodation candidate not found: ${candidateId}`);
  }

  const now = new Date().toISOString();
  const events: AccommodationReviewEvent[] = [];

  for (const item of next.accommodations) {
    if (
      item.id !== candidateId &&
      item.destinationId === candidate.destinationId &&
      normalizeLane(item.lane, item.status, Boolean(item.booking)) === 'booked'
    ) {
      const fromLane = normalizeLane(item.lane, item.status, Boolean(item.booking));
      item.lane = 'proposed';
      item.status = 'proposed';
      item.updatedAt = now;
      delete item.booking;
      events.push(
        eventFor({
          type: 'candidate_moved',
          candidateId: item.id,
          destinationId: item.destinationId,
          actor,
          fromLane,
          toLane: 'proposed',
          message,
        })
      );
    }
  }

  const fromLane = normalizeLane(candidate.lane, candidate.status, Boolean(candidate.booking));
  candidate.lane = 'booked';
  candidate.status = 'booked';
  candidate.updatedAt = now;
  candidate.booking = {
    ...(candidate.booking ?? {}),
    ...(booking ?? {}),
    bookedAt: booking?.bookedAt ?? candidate.booking?.bookedAt ?? now,
  };

  events.push(
    eventFor({
      type: 'candidate_booked',
      candidateId,
      destinationId: candidate.destinationId,
      actor,
      fromLane,
      toLane: 'booked',
      message,
    })
  );

  next.updatedAt = now;
  next.events = [...(next.events ?? []), ...events].slice(-80);
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
        check_in: candidate.checkIn ?? candidate.checkInDate,
        check_out: candidate.checkOut ?? candidate.checkOutDate,
        room_type: candidate.roomType,
        address: candidate.address,
        phone: candidate.phone,
        direct_website_url: candidate.directWebsite?.url,
        direct_website_label: candidate.directWebsite?.label,
        confirmation,
        booking_platform: source,
        cancellation_deadline: candidate.terms,
        wifi: candidate.wifi,
        parking: candidate.parking,
        policy_source_url: candidate.policySource?.url,
        policy_source_label: candidate.policySource?.label,
        policy_confidence: candidate.policyConfidence,
        dog_note: candidate.dog,
        why: candidate.why,
        practical: candidate.blockers,
        booking_note: candidate.action,
        note: candidate.hotelNote ?? note,
      }),
    }) as Accommodation;
  }

  return next;
}

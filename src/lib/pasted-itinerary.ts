export type PastedItineraryDetails = {
  destination: string;
  start_date: string;
  end_date: string;
  travelers: string;
};

const MONTH_PATTERN =
  'jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?';

const MONTHS = new Map([
  ['jan', 1],
  ['january', 1],
  ['feb', 2],
  ['february', 2],
  ['mar', 3],
  ['march', 3],
  ['apr', 4],
  ['april', 4],
  ['may', 5],
  ['jun', 6],
  ['june', 6],
  ['jul', 7],
  ['july', 7],
  ['aug', 8],
  ['august', 8],
  ['sep', 9],
  ['sept', 9],
  ['september', 9],
  ['oct', 10],
  ['october', 10],
  ['nov', 11],
  ['november', 11],
  ['dec', 12],
  ['december', 12],
]);

function normalizeText(value: string): string {
  return value.replace(/\r\n?/g, '\n').replace(/[\u2013\u2014]/g, '-');
}

function formatIsoDate(year: number, month: number, day: number): string {
  const date = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return '';
  }
  return date.toISOString().slice(0, 10);
}

function monthNumber(value: string): number {
  return MONTHS.get(value.toLowerCase().replace(/\.$/, '')) ?? 0;
}

function orderedRange(start: string, end: string): { start_date: string; end_date: string } | null {
  if (!start || !end || start >= end) return null;
  return { start_date: start, end_date: end };
}

function extractRangeFromMatch(
  match: RegExpMatchArray,
  shape: 'same-month' | 'month-month' | 'day-month'
): { start_date: string; end_date: string } | null {
  if (shape === 'same-month') {
    const month = monthNumber(match[1] ?? '');
    const startDay = Number(match[2]);
    const endDay = Number(match[3]);
    const year = Number(match[4]);
    return orderedRange(formatIsoDate(year, month, startDay), formatIsoDate(year, month, endDay));
  }

  if (shape === 'month-month') {
    const startMonth = monthNumber(match[1] ?? '');
    const startDay = Number(match[2]);
    const endMonth = monthNumber(match[4] ?? '');
    const endDay = Number(match[5]);
    const endYear = Number(match[6]);
    const startYear = Number(match[3] || endYear);
    return orderedRange(
      formatIsoDate(startYear, startMonth, startDay),
      formatIsoDate(endYear, endMonth, endDay)
    );
  }

  const startDay = Number(match[1]);
  const startMonth = monthNumber(match[2] ?? '');
  const endDay = Number(match[4]);
  const endMonth = monthNumber(match[5] ?? '');
  const endYear = Number(match[6]);
  const startYear = Number(match[3] || endYear);
  return orderedRange(
    formatIsoDate(startYear, startMonth, startDay),
    formatIsoDate(endYear, endMonth, endDay)
  );
}

function extractDateRange(text: string): { start_date: string; end_date: string } | null {
  const isoRange = text.match(
    /\b(20\d{2}-\d{2}-\d{2})\s*(?:-|to|through|until)\s*(20\d{2}-\d{2}-\d{2})\b/i
  );
  if (isoRange) {
    const range = orderedRange(isoRange[1], isoRange[2]);
    if (range) return range;
  }

  const sameMonth = text.match(
    new RegExp(
      `\\b(${MONTH_PATTERN})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?\\s*(?:-|to|through|until)\\s*(\\d{1,2})(?:st|nd|rd|th)?(?:,)?\\s+(20\\d{2})\\b`,
      'i'
    )
  );
  if (sameMonth) {
    const range = extractRangeFromMatch(sameMonth, 'same-month');
    if (range) return range;
  }

  const monthMonth = text.match(
    new RegExp(
      `\\b(${MONTH_PATTERN})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,)?(?:\\s+(20\\d{2}))?\\s*(?:-|to|through|until)\\s*(${MONTH_PATTERN})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,)?\\s+(20\\d{2})\\b`,
      'i'
    )
  );
  if (monthMonth) {
    const range = extractRangeFromMatch(monthMonth, 'month-month');
    if (range) return range;
  }

  const dayMonth = text.match(
    new RegExp(
      `\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(${MONTH_PATTERN})\\.?(?:,)?(?:\\s+(20\\d{2}))?\\s*(?:-|to|through|until)\\s*(\\d{1,2})(?:st|nd|rd|th)?\\s+(${MONTH_PATTERN})\\.?(?:,)?\\s+(20\\d{2})\\b`,
      'i'
    )
  );
  if (dayMonth) {
    const range = extractRangeFromMatch(dayMonth, 'day-month');
    if (range) return range;
  }

  const dates = new Set<string>();
  const isoDatePattern = /\b20\d{2}-\d{2}-\d{2}\b/g;
  for (const match of text.matchAll(isoDatePattern)) {
    dates.add(match[0]);
  }

  const monthDatePattern = new RegExp(
    `\\b(${MONTH_PATTERN})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,)?\\s+(20\\d{2})\\b`,
    'gi'
  );
  for (const match of text.matchAll(monthDatePattern)) {
    const iso = formatIsoDate(Number(match[3]), monthNumber(match[1] ?? ''), Number(match[2]));
    if (iso) dates.add(iso);
  }

  const dayMonthPattern = new RegExp(
    `\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(${MONTH_PATTERN})\\.?(?:,)?\\s+(20\\d{2})\\b`,
    'gi'
  );
  for (const match of text.matchAll(dayMonthPattern)) {
    const iso = formatIsoDate(Number(match[3]), monthNumber(match[2] ?? ''), Number(match[1]));
    if (iso) dates.add(iso);
  }

  const sortedDates = Array.from(dates).sort();
  if (sortedDates.length < 2) return null;
  return orderedRange(sortedDates[0], sortedDates[sortedDates.length - 1]);
}

function cleanLine(value: string): string {
  return value
    .replace(/^\s{0,3}#{1,6}\s*/, '')
    .replace(/^\s*(?:[-*+]|\d+[.)])\s+/, '')
    .replace(/[`*_~]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function cleanDestinationCandidate(value: string): string {
  return value
    .replace(/\b20\d{2}-\d{2}-\d{2}\b/g, '')
    .replace(new RegExp(`\\b(?:${MONTH_PATTERN})\\.?\\s+\\d{1,2}(?:st|nd|rd|th)?(?:,)?(?:\\s+20\\d{2})?\\b`, 'gi'), '')
    .replace(/\b\d{1,2}(?:st|nd|rd|th)?\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z.]*(?:,)?(?:\s+20\d{2})?\b/gi, '')
    .replace(/\b\d+\s*(?:-| )?(?:day|days|night|nights)\b/gi, '')
    .replace(/\b(?:itinerary|travel plan|travel guide|guide|draft|trip)\b/gi, '')
    .replace(/\s+(?:for|from)\s*$/i, '')
    .replace(/^[\s:|,.-]+|[\s:|,.-]+$/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
    .slice(0, 180);
}

function extractDestination(text: string): string {
  const lines = normalizeText(text)
    .split('\n')
    .map(cleanLine)
    .filter(Boolean);

  for (const line of lines) {
    const labeled = line.match(/^(?:destination|trip|itinerary|route|travel plan)\s*[:|-]\s*(.+)$/i);
    if (labeled?.[1]) {
      const destination = cleanDestinationCandidate(labeled[1]);
      if (destination.length >= 2) return destination;
    }
  }

  for (const line of lines.slice(0, 8)) {
    if (/^(?:day|date|dates|travelers?|party|group|bookings?|flights?|hotels?)\b/i.test(line)) {
      continue;
    }
    const destination = cleanDestinationCandidate(line);
    if (destination.length >= 2 && /[a-z]/i.test(destination)) return destination;
  }

  return '';
}

function extractTravelers(text: string): string {
  for (const line of normalizeText(text).split('\n')) {
    const cleaned = cleanLine(line);
    const match = cleaned.match(/^(?:travelers?|party|group|people)\s*[:|-]\s*(.+)$/i);
    if (match?.[1]) return match[1].trim().slice(0, 1800);
  }
  return '';
}

export function inferPastedItineraryDetails(value: string): PastedItineraryDetails {
  const text = normalizeText(value);
  const range = extractDateRange(text);

  return {
    destination: extractDestination(text),
    start_date: range?.start_date ?? '',
    end_date: range?.end_date ?? '',
    travelers: extractTravelers(text),
  };
}

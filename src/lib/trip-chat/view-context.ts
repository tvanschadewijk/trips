export interface TripChatViewContext {
  slide?: number;
  slideKind?: string;
  day_number?: number | null;
  date?: string | null;
  title?: string | null;
  destination_id?: string | null;
  destination_title?: string | null;
  candidate_id?: string | null;
  candidate_name?: string | null;
}

const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

function calendarLabelForIsoDate(isoDate: string): string | null {
  const match = ISO_DATE_RE.exec(isoDate);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day, 12));

  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }

  return new Intl.DateTimeFormat('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(date);
}

export function formatViewContextPrefix(ctx: TripChatViewContext | null | undefined): string {
  if (!ctx) return '';
  if (ctx.slideKind === 'day' && ctx.day_number) {
    const calendarLabel = ctx.date ? calendarLabelForIsoDate(ctx.date) : null;
    const dateStr = calendarLabel ? `: ${calendarLabel} (ISO ${ctx.date})` : '';
    const titleStr = ctx.title ? ` - "${ctx.title}"` : '';
    return `[The user is currently viewing Day ${ctx.day_number}${dateStr}${titleStr}. If their question is ambiguous about which day, default to this one. Treat the ISO date and weekday in this context as the calendar source of truth; do not mention a different weekday unless the trip date ledger contradicts it.]\n\n`;
  }
  if (ctx.slideKind === 'cover') {
    return `[The user is currently on the trip cover (overview), not a specific day.]\n\n`;
  }
  if (ctx.slideKind === 'accommodation_review') {
    const destination = ctx.destination_title
      ? ` destination "${ctx.destination_title}"`
      : ' accommodation-review destination';
    const candidate = ctx.candidate_name
      ? ` Candidate in focus: "${ctx.candidate_name}".`
      : '';
    return `[The user is currently viewing the private Accommodations Reviewer for${destination}.${candidate} Use accommodation-review tools before answering hotel-candidate workflow questions.]\n\n`;
  }
  return '';
}

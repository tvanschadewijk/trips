import type { SupabaseClient } from '@supabase/supabase-js';
import { applyActionItemStatusToTripData } from '@/lib/trip-action-items';
import { trySyncAccommodationReviewForTrip } from '@/lib/accommodation-review-store';
import { normalizeTripData } from '@/lib/trip-data-normalize';
import type { Accommodation, Meal, TripData } from '@/lib/types';
import type { ToolCallSummary } from './prompt';
import { _internal as tripToolInternals } from './tools';

const AGENT_NOTES_START = '<!-- OURTRIPS_AGENT_NOTES_START -->';
const AGENT_NOTES_END = '<!-- OURTRIPS_AGENT_NOTES_END -->';

type FastLaneViewContext = {
  slideKind?: string | null;
  day_number?: number | null;
};

type FastLaneEditableTripField = 'name' | 'subtitle' | 'summary';
type FastLaneEditableDayField =
  | 'title'
  | 'subtitle'
  | 'description_title'
  | 'description';

type FastLaneCommand =
  | {
      kind: 'trip_field';
      field: FastLaneEditableTripField;
      value: string;
    }
  | {
      kind: 'day_field';
      dayNumber: number;
      field: FastLaneEditableDayField;
      value: string;
    }
  | {
      kind: 'accommodation_patch';
      dayNumber: number;
      patch: Partial<Pick<Accommodation, 'name' | 'note'>>;
    }
  | {
      kind: 'action_status';
      dayNumber: number;
      itemType: 'accommodation' | 'meal';
      itemIndex: number;
      status: 'booked' | 'open';
      label: string;
    }
  | {
      kind: 'meal_time';
      dayNumber: number;
      itemIndex: number;
      mealType: string;
      startsAt: string;
    };

export type FastLaneApplyResult =
  | {
      ok: true;
      next: TripData;
      assistantText: string;
      toolCall: ToolCallSummary;
      changedPaths: string[];
      rowName?: string;
      accommodationReviewSyncNeeded: boolean;
    }
  | { ok: false; error: string };

export type FastLaneTurnResult = {
  assistantText: string;
  toolCallsSummary: ToolCallSummary[];
  durationMs: number;
  revision: {
    tool: 'fast_lane_update';
    before: TripData;
    after: TripData;
    input: {
      message: string;
      view_context: FastLaneViewContext | null | undefined;
      changed_paths: string[];
    };
  };
};

export type FastLaneTurnArgs = {
  supabase: SupabaseClient;
  tripId: string;
  message: string;
  viewContext: FastLaneViewContext | null | undefined;
};

export function isFastLaneCandidate(
  rawMessage: string,
  ctx: FastLaneViewContext | null | undefined
): boolean {
  const message = cleanCommand(rawMessage).toLowerCase();
  if (!/^(rename|retitle|set|change|update|move|schedule|shift|mark)\b/.test(message)) {
    return false;
  }

  if (/\b(all|whole|entire|every|find|research|recommend|rewrite|create|add|remove|delete)\b/.test(message)) {
    return false;
  }

  if (
    /\b(trip|day|dag|title|subtitle|summary|description|intro|hotel|stay|accommodation|breakfast|brunch|lunch|dinner|meal)\b/.test(
      message
    )
  ) {
    return true;
  }

  return Boolean(currentDayNumber(ctx) || isCoverContext(ctx));
}

function cloneTrip(data: TripData): TripData {
  return JSON.parse(JSON.stringify(data)) as TripData;
}

function cleanCommand(message: string): string {
  return message
    .trim()
    .replace(/^[\s"'“”‘’]+|[\s"'“”‘’]+$/g, '')
    .replace(/^please\s+/i, '')
    .trim();
}

function cleanValue(value: string): string {
  return value
    .trim()
    .replace(/^["“”‘’]+|["“”‘’]+$/g, '')
    .trim();
}

function oneLineMarkdown(value: unknown): string {
  if (value === undefined || value === null) return '';
  return String(value)
    .replace(/\s+/g, ' ')
    .replace(/<!--/g, '<!-- ')
    .replace(/-->/g, '-- >')
    .trim();
}

function currentDayNumber(ctx: FastLaneViewContext | null | undefined): number | null {
  return ctx?.slideKind === 'day' && typeof ctx.day_number === 'number'
    ? ctx.day_number
    : null;
}

function isCoverContext(ctx: FastLaneViewContext | null | undefined): boolean {
  return ctx?.slideKind === 'cover';
}

function resolveDayNumber(
  explicitDayNumber: string | undefined,
  ctx: FastLaneViewContext | null | undefined
): number | null {
  if (explicitDayNumber) {
    const parsed = Number(explicitDayNumber);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
  }
  return currentDayNumber(ctx);
}

function dayIndexForNumber(trip: TripData, dayNumber: number): number {
  return trip.days.findIndex((day) => day.day_number === dayNumber);
}

function findDay(trip: TripData, dayNumber: number) {
  const dayIndex = dayIndexForNumber(trip, dayNumber);
  return dayIndex >= 0 ? { day: trip.days[dayIndex], dayIndex } : null;
}

function normalizeDayField(value: string): FastLaneEditableDayField | null {
  const normalized = value.trim().toLowerCase().replace(/[-_]+/g, ' ');
  if (normalized === 'title' || normalized === 'day title') return 'title';
  if (normalized === 'subtitle' || normalized === 'day subtitle') return 'subtitle';
  if (
    normalized === 'description title' ||
    normalized === 'intro title' ||
    normalized === 'day intro title'
  ) {
    return 'description_title';
  }
  if (
    normalized === 'description' ||
    normalized === 'intro' ||
    normalized === 'day intro'
  ) {
    return 'description';
  }
  return null;
}

function normalizeTripField(value: string): FastLaneEditableTripField | null {
  const normalized = value.trim().toLowerCase().replace(/[-_]+/g, ' ');
  if (normalized === 'title' || normalized === 'name' || normalized === 'trip title') {
    return 'name';
  }
  if (normalized === 'subtitle' || normalized === 'trip subtitle') return 'subtitle';
  if (
    normalized === 'summary' ||
    normalized === 'trip summary' ||
    normalized === 'description'
  ) {
    return 'summary';
  }
  return null;
}

function parseClockTime(value: string): string | null {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/\bp\.?m\.?\b/g, 'pm')
    .replace(/\ba\.?m\.?\b/g, 'am');

  if (/\bnoon\b/.test(normalized)) return '12:00';
  if (/\bmidnight\b/.test(normalized)) return '00:00';

  const match = /(\d{1,2})(?::|\.|h)?(\d{2})?\s*(am|pm)?\b/.exec(normalized);
  if (!match) return null;

  let hour = Number(match[1]);
  const minute = match[2] ? Number(match[2]) : 0;
  const meridiem = match[3];

  if (!Number.isInteger(hour) || !Number.isInteger(minute)) return null;
  if (minute < 0 || minute > 59) return null;
  if (meridiem) {
    if (hour < 1 || hour > 12) return null;
    if (meridiem === 'pm' && hour < 12) hour += 12;
    if (meridiem === 'am' && hour === 12) hour = 0;
  } else if (hour < 0 || hour > 23) {
    return null;
  }

  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

function normalizeFastStatus(value: string): 'booked' | 'open' | null {
  const normalized = value.trim().toLowerCase().replace(/[-_\s]+/g, ' ');
  if (
    normalized === 'booked' ||
    normalized === 'confirmed' ||
    normalized === 'reserved' ||
    normalized === 'done'
  ) {
    return 'booked';
  }
  if (
    normalized === 'open' ||
    normalized === 'pending' ||
    normalized === 'unbooked' ||
    normalized === 'not booked'
  ) {
    return 'open';
  }
  return null;
}

function mealMatches(meal: Meal, mealType: string): boolean {
  const needle = mealType.toLowerCase();
  const haystack = `${meal.type ?? ''} ${meal.name ?? ''}`.toLowerCase();
  if (needle === 'meal') return true;
  return haystack.includes(needle);
}

function findMealIndex(trip: TripData, dayNumber: number, mealType: string): number {
  const target = findDay(trip, dayNumber);
  if (!target?.day.meals?.length) return -1;
  return target.day.meals.findIndex((meal) => mealMatches(meal, mealType));
}

function parseTripFieldCommand(
  message: string,
  ctx: FastLaneViewContext | null | undefined
): FastLaneCommand | null {
  const renameTrip = /^(?:rename|retitle)\s+(?:the\s+)?trip\s+(?:to|as)\s+(.+)$/i.exec(message);
  if (renameTrip) {
    const value = cleanValue(renameTrip[1]);
    return value ? { kind: 'trip_field', field: 'name', value } : null;
  }

  const explicit =
    /^(?:set|change|update)\s+(?:the\s+)?trip\s+(title|name|subtitle|summary|description)\s+(?:to|as)\s+(.+)$/i.exec(
      message
    );
  if (explicit) {
    const field = normalizeTripField(explicit[1]);
    const value = cleanValue(explicit[2]);
    return field && value ? { kind: 'trip_field', field, value } : null;
  }

  if (!isCoverContext(ctx)) return null;
  const coverScoped =
    /^(?:set|change|update)\s+(?:the\s+)?(title|name|subtitle|summary|description)\s+(?:to|as)\s+(.+)$/i.exec(
      message
    );
  if (!coverScoped) return null;

  const field = normalizeTripField(coverScoped[1]);
  const value = cleanValue(coverScoped[2]);
  return field && value ? { kind: 'trip_field', field, value } : null;
}

function parseDayFieldCommand(
  message: string,
  ctx: FastLaneViewContext | null | undefined
): FastLaneCommand | null {
  const renameDay =
    /^(?:rename|retitle)\s+(?:(?:day|dag)\s+(\d{1,3})|this\s+day|current\s+day|the\s+day)\s+(?:to|as)\s+(.+)$/i.exec(
      message
    );
  if (renameDay) {
    const dayNumber = resolveDayNumber(renameDay[1], ctx);
    const value = cleanValue(renameDay[2]);
    return dayNumber && value
      ? { kind: 'day_field', dayNumber, field: 'title', value }
      : null;
  }

  const explicit =
    /^(?:set|change|update)\s+(?:(?:day|dag)\s+(\d{1,3})\s+)?(?:the\s+)?(?:day\s+)?(title|subtitle|description title|intro title|description|intro)\s+(?:to|as)\s+(.+)$/i.exec(
      message
    );
  if (explicit) {
    const dayNumber = resolveDayNumber(explicit[1], ctx);
    const field = normalizeDayField(explicit[2]);
    const value = cleanValue(explicit[3]);
    return dayNumber && field && value
      ? { kind: 'day_field', dayNumber, field, value }
      : null;
  }

  const dayNumber = currentDayNumber(ctx);
  if (!dayNumber) return null;
  const currentDayScoped =
    /^(?:set|change|update)\s+(?:the\s+)?(title|subtitle|description title|intro title|description|intro)\s+(?:to|as)\s+(.+)$/i.exec(
      message
    );
  if (!currentDayScoped) return null;

  const field = normalizeDayField(currentDayScoped[1]);
  const value = cleanValue(currentDayScoped[2]);
  return field && value ? { kind: 'day_field', dayNumber, field, value } : null;
}

function parseAccommodationCommand(
  message: string,
  ctx: FastLaneViewContext | null | undefined
): FastLaneCommand | null {
  const note =
    /^(?:set|change|update)\s+(?:(?:day|dag)\s+(\d{1,3})\s+)?(?:the\s+)?(?:hotel|stay|accommodation)\s+note\s+(?:to|as)\s+(.+)$/i.exec(
      message
    );
  if (note) {
    const dayNumber = resolveDayNumber(note[1], ctx);
    const value = cleanValue(note[2]);
    return dayNumber && value
      ? { kind: 'accommodation_patch', dayNumber, patch: { note: value } }
      : null;
  }

  const status =
    /^(?:mark|set)\s+(?:(?:day|dag)\s+(\d{1,3})\s+)?(?:the\s+)?(?:hotel|stay|accommodation)(?:\s+(?:as|to))?\s+(booked|confirmed|reserved|done|open|pending|unbooked|not booked)$/i.exec(
      message
    );
  if (status) {
    const dayNumber = resolveDayNumber(status[1], ctx);
    const nextStatus = normalizeFastStatus(status[2]);
    return dayNumber && nextStatus
      ? {
          kind: 'action_status',
          dayNumber,
          itemType: 'accommodation',
          itemIndex: 0,
          status: nextStatus,
          label: 'accommodation',
        }
      : null;
  }

  const rename =
    /^(?:rename|change|set)\s+(?:(?:day|dag)\s+(\d{1,3})\s+)?(?:the\s+)?(?:hotel|stay|accommodation)(?:\s+name)?\s+(?:to|as)\s+(.+)$/i.exec(
      message
    );
  if (rename) {
    // Hotel renames can also move the route base. Let the full agent handle
    // those so it can review the whole changed day and the following day.
    return null;
  }
  return null;
}

function parseMealCommand(
  message: string,
  ctx: FastLaneViewContext | null | undefined,
  trip: TripData
): FastLaneCommand | null {
  const time =
    /^(?:move|set|change|schedule|shift)\s+(?:(?:day|dag)\s+(\d{1,3})\s+)?(?:the\s+)?(breakfast|brunch|lunch|dinner|meal)\s+(?:to|at)\s+(.+)$/i.exec(
      message
    );
  if (time) {
    const dayNumber = resolveDayNumber(time[1], ctx);
    const mealType = time[2].toLowerCase();
    const startsAt = parseClockTime(time[3]);
    if (dayNumber && startsAt) {
      const itemIndex = findMealIndex(trip, dayNumber, mealType);
      return itemIndex >= 0
        ? { kind: 'meal_time', dayNumber, itemIndex, mealType, startsAt }
        : null;
    }
  }

  const status =
    /^(?:mark|set)\s+(?:(?:day|dag)\s+(\d{1,3})\s+)?(?:the\s+)?(breakfast|brunch|lunch|dinner|meal)(?:\s+(?:as|to))?\s+(booked|confirmed|reserved|done|open|pending|unbooked|not booked)$/i.exec(
      message
    );
  if (!status) return null;

  const dayNumber = resolveDayNumber(status[1], ctx);
  const mealType = status[2].toLowerCase();
  const nextStatus = normalizeFastStatus(status[3]);
  if (!dayNumber || !nextStatus) return null;
  const itemIndex = findMealIndex(trip, dayNumber, mealType);
  return itemIndex >= 0
    ? {
        kind: 'action_status',
        dayNumber,
        itemType: 'meal',
        itemIndex,
        status: nextStatus,
        label: mealType,
      }
    : null;
}

export function parseFastLaneCommand(
  rawMessage: string,
  ctx: FastLaneViewContext | null | undefined,
  trip: TripData
): FastLaneCommand | null {
  const message = cleanCommand(rawMessage);
  if (!message) return null;

  return (
    parseTripFieldCommand(message, ctx) ??
    parseDayFieldCommand(message, ctx) ??
    parseAccommodationCommand(message, ctx) ??
    parseMealCommand(message, ctx, trip)
  );
}

function upsertAgentNoteLine(sectionBody: string, path: string, noteLine: string): string {
  const lines = sectionBody
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line) => {
      const trimmed = line.trim();
      return trimmed.length > 0 && trimmed !== '## OurTrips agent notes';
    });
  const pathMarker = `<!-- path: ${path} -->`;
  const existingIndex = lines.findIndex((line) => line.includes(pathMarker));
  if (existingIndex >= 0) {
    lines[existingIndex] = noteLine;
  } else {
    lines.push(noteLine);
  }
  return lines.join('\n');
}

export function upsertFastLaneAgentNote(
  markdownSource: string,
  path: string,
  note: string
): string {
  const noteLine = `- Fast lane: ${oneLineMarkdown(note)}. <!-- path: ${path} -->`;
  const startIndex = markdownSource.indexOf(AGENT_NOTES_START);
  const endIndex = markdownSource.indexOf(AGENT_NOTES_END);

  if (startIndex >= 0 && endIndex > startIndex) {
    const before = markdownSource.slice(0, startIndex).trimEnd();
    const existingBodyStart = startIndex + AGENT_NOTES_START.length;
    const existingBody = markdownSource.slice(existingBodyStart, endIndex).trim();
    const after = markdownSource.slice(endIndex + AGENT_NOTES_END.length).trimStart();
    const nextBody = upsertAgentNoteLine(existingBody, path, noteLine);
    const section = `${AGENT_NOTES_START}\n## OurTrips agent notes\n\n${nextBody}\n${AGENT_NOTES_END}`;
    return [before, section, after].filter(Boolean).join('\n\n');
  }

  const section = `${AGENT_NOTES_START}\n## OurTrips agent notes\n\n${noteLine}\n${AGENT_NOTES_END}`;
  return [markdownSource.trimEnd(), section].filter(Boolean).join('\n\n');
}

function withMarkdownNote(
  trip: TripData,
  path: string,
  note: string
): { next: TripData; markdownSourceUpdated: boolean } {
  if (!trip.markdown_source) return { next: trip, markdownSourceUpdated: false };
  return {
    next: {
      ...trip,
      markdown_source: upsertFastLaneAgentNote(trip.markdown_source, path, note),
    },
    markdownSourceUpdated: true,
  };
}

function applyTripFieldCommand(trip: TripData, command: Extract<FastLaneCommand, { kind: 'trip_field' }>) {
  const next = cloneTrip(trip);
  next.trip[command.field] = command.value;
  const path = `trip.${command.field}`;
  const note = `updated ${path} to "${command.value}"`;
  const withNote = withMarkdownNote(next, path, note);

  return {
    next: withNote.next,
    changedPaths: [path, ...(withNote.markdownSourceUpdated ? ['markdown_source'] : [])],
    assistantText:
      command.field === 'name'
        ? `Renamed the trip to "${command.value}".`
        : `Updated the trip ${command.field.replace('_', ' ')}.`,
    rowName: command.field === 'name' ? command.value : undefined,
    accommodationReviewSyncNeeded: false,
  };
}

function applyDayFieldCommand(trip: TripData, command: Extract<FastLaneCommand, { kind: 'day_field' }>) {
  const target = findDay(trip, command.dayNumber);
  if (!target) return { error: `Day ${command.dayNumber} not found.` };

  const next = cloneTrip(trip);
  next.days[target.dayIndex][command.field] = command.value;
  const path = `days[day_number=${command.dayNumber}].${command.field}`;
  const note = `updated Day ${command.dayNumber} ${command.field.replace('_', ' ')} to "${command.value}"`;
  const withNote = withMarkdownNote(next, path, note);

  return {
    next: withNote.next,
    changedPaths: [path, ...(withNote.markdownSourceUpdated ? ['markdown_source'] : [])],
    assistantText: `Updated Day ${command.dayNumber} ${command.field.replace('_', ' ')}.`,
    accommodationReviewSyncNeeded: true,
  };
}

function applyAccommodationPatchCommand(
  trip: TripData,
  command: Extract<FastLaneCommand, { kind: 'accommodation_patch' }>
) {
  const target = findDay(trip, command.dayNumber);
  if (!target?.day.accommodation) {
    return { error: `Day ${command.dayNumber} has no accommodation to update.` };
  }

  const result = tripToolInternals.applyAccommodationPatch(
    trip,
    `days[${target.dayIndex}].accommodation`,
    command.patch,
    'same_current_name'
  );
  if (!result.ok) return { error: result.error };

  const keys = Object.keys(command.patch);
  return {
    next: result.next,
    changedPaths: [
      ...result.dayNumbers.flatMap((dayNumber) =>
        keys.map((key) => `days[day_number=${dayNumber}].accommodation.${key}`)
      ),
      ...(result.markdownSourceUpdated ? ['markdown_source'] : []),
    ],
    assistantText:
      command.patch.name !== undefined
        ? `Renamed the stay to "${command.patch.name}".`
        : 'Updated the stay note.',
    accommodationReviewSyncNeeded: true,
  };
}

function applyActionStatusCommand(
  trip: TripData,
  command: Extract<FastLaneCommand, { kind: 'action_status' }>
) {
  const next = cloneTrip(trip);
  const result = applyActionItemStatusToTripData(next as unknown as { days: Array<Record<string, unknown>> }, {
    dayNumber: command.dayNumber,
    itemType: command.itemType,
    itemIndex: command.itemIndex,
    status: command.status,
  });
  if (!result.ok) return { error: result.error };

  const path =
    command.itemType === 'accommodation'
      ? `days[day_number=${command.dayNumber}].accommodation.status`
      : `days[day_number=${command.dayNumber}].meals[${command.itemIndex}].status`;
  const note = `marked Day ${command.dayNumber} ${command.label} as ${command.status}`;
  const withNote = withMarkdownNote(next, path, note);

  return {
    next: withNote.next,
    changedPaths: [
      path,
      path.replace(/\.status$/, '.booking_status'),
      ...(withNote.markdownSourceUpdated ? ['markdown_source'] : []),
    ],
    assistantText: `Marked Day ${command.dayNumber} ${command.label} as ${command.status}.`,
    accommodationReviewSyncNeeded: command.itemType === 'accommodation',
  };
}

function applyMealTimeCommand(trip: TripData, command: Extract<FastLaneCommand, { kind: 'meal_time' }>) {
  const target = findDay(trip, command.dayNumber);
  const meal = target?.day.meals?.[command.itemIndex];
  if (!target || !meal) {
    return { error: `Day ${command.dayNumber} ${command.mealType} was not found.` };
  }

  const next = cloneTrip(trip);
  const nextMeal = next.days[target.dayIndex].meals?.[command.itemIndex];
  if (!nextMeal) return { error: `Day ${command.dayNumber} ${command.mealType} was not found.` };
  nextMeal.starts_at = command.startsAt;
  nextMeal.time_precision = nextMeal.booking_status === 'booked' ? 'fixed' : 'suggested';

  const path = `days[day_number=${command.dayNumber}].meals[${command.itemIndex}].starts_at`;
  const note = `moved Day ${command.dayNumber} ${command.mealType} to ${command.startsAt}`;
  const withNote = withMarkdownNote(next, path, note);

  return {
    next: withNote.next,
    changedPaths: [
      path,
      path.replace(/\.starts_at$/, '.time_precision'),
      ...(withNote.markdownSourceUpdated ? ['markdown_source'] : []),
    ],
    assistantText: `Moved Day ${command.dayNumber} ${command.mealType} to ${command.startsAt}.`,
    accommodationReviewSyncNeeded: false,
  };
}

export function applyFastLaneEdit(
  trip: TripData,
  message: string,
  viewContext: FastLaneViewContext | null | undefined
): FastLaneApplyResult | null {
  const command = parseFastLaneCommand(message, viewContext, trip);
  if (!command) return null;

  const applied =
    command.kind === 'trip_field'
      ? applyTripFieldCommand(trip, command)
      : command.kind === 'day_field'
        ? applyDayFieldCommand(trip, command)
        : command.kind === 'accommodation_patch'
          ? applyAccommodationPatchCommand(trip, command)
          : command.kind === 'action_status'
            ? applyActionStatusCommand(trip, command)
            : applyMealTimeCommand(trip, command);

  if ('error' in applied) {
    return { ok: false, error: applied.error ?? 'Fast lane edit failed.' };
  }

  const topLevelKeys = new Set(
    applied.changedPaths.map((path) => (path.startsWith('trip.') ? 'trip' : path.split('.')[0]))
  );
  const rowName = 'rowName' in applied ? applied.rowName : undefined;

  return {
    ok: true,
    next: applied.next,
    assistantText: applied.assistantText,
    changedPaths: applied.changedPaths,
    ...(rowName ? { rowName } : {}),
    accommodationReviewSyncNeeded: applied.accommodationReviewSyncNeeded,
    toolCall: {
      tool: 'fast_lane_update',
      ok: true,
      input_keys: Array.from(topLevelKeys),
      note: applied.changedPaths.slice(0, 4).join(', '),
    },
  };
}

export async function tryRunFastLaneTurn(
  args: FastLaneTurnArgs
): Promise<FastLaneTurnResult | null> {
  if (!isFastLaneCandidate(args.message, args.viewContext)) return null;

  const startedAt = Date.now();
  const read = await args.supabase
    .from('trips')
    .select('data')
    .eq('id', args.tripId)
    .is('deleted_at', null)
    .single();

  if (read.error || !read.data) {
    throw new Error(`Error reading trip for fast lane: ${read.error?.message ?? 'not found'}`);
  }

  const before = normalizeTripData(read.data.data);
  const applied = applyFastLaneEdit(before, args.message, args.viewContext);
  if (!applied) return null;
  if (!applied.ok) {
    return null;
  }

  const payload: Record<string, unknown> = {
    data: applied.next,
    updated_at: new Date().toISOString(),
  };
  if (applied.rowName) payload.name = applied.rowName;

  const write = await args.supabase
    .from('trips')
    .update(payload)
    .eq('id', args.tripId)
    .is('deleted_at', null);

  if (write.error) {
    throw new Error(`Error writing fast-lane trip edit: ${write.error.message}`);
  }

  if (applied.accommodationReviewSyncNeeded) {
    await trySyncAccommodationReviewForTrip(args.supabase, args.tripId, applied.next);
  }

  return {
    assistantText: applied.assistantText,
    toolCallsSummary: [applied.toolCall],
    durationMs: Date.now() - startedAt,
    revision: {
      tool: 'fast_lane_update',
      before,
      after: applied.next,
      input: {
        message: args.message,
        view_context: args.viewContext,
        changed_paths: applied.changedPaths,
      },
    },
  };
}

export const _internal = {
  applyFastLaneEdit,
  isFastLaneCandidate,
  parseClockTime,
  parseFastLaneCommand,
  upsertFastLaneAgentNote,
};

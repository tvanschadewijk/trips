export const INITIAL_CHAT_PROGRESS_MESSAGE = 'Reading your request...';

export const DEFAULT_CHAT_STATUS_PHASES = [
  'Reading your request...',
  'Planning the next step...',
  'Checking the itinerary context...',
  'Preparing the next action...',
  'Reviewing the result...',
  'Still working through the details...',
  'Writing the reply...',
] as const;

export const POLICY_RESEARCH_STATUS_PHASES = [
  'Finding the relevant stays...',
  'Searching current policy sources...',
  'Checking official pages...',
  'Comparing source details...',
  'Saving concise notes...',
  'Writing the reply...',
] as const;

export type ChatProgressStage =
  | 'queued'
  | 'starting'
  | 'thinking'
  | 'reading'
  | 'checking'
  | 'researching'
  | 'editing'
  | 'booking'
  | 'reviewing'
  | 'writing'
  | 'done'
  | 'error';

export type ChatProgressStatus = 'active' | 'completed' | 'blocked' | 'error';

export type ChatProgressConfidence = 'observed' | 'inferred';

export interface ChatProgressUpdate {
  stage: ChatProgressStage;
  message: string;
  action?: string;
  object_type?: string;
  object_label?: string;
  source?: string;
  source_label?: string;
  status?: ChatProgressStatus;
  confidence?: ChatProgressConfidence;
}

export interface ChatProgressEvent extends ChatProgressUpdate {
  id: string;
  turn_index: number;
  created_at: string;
}

const POLICY_RESEARCH_RE = /\b(dog|dogs|pet|pets|policy|policies|allowed|hotel|hotels|stay|stays|accommodation|accommodations)\b/i;

function normalizeToolName(toolName: string): string {
  return toolName.replace(/^mcp__trip_editor__/, '');
}

function observed(update: ChatProgressUpdate): ChatProgressUpdate {
  return {
    status: 'active',
    confidence: 'observed',
    ...update,
  };
}

function completed(update: ChatProgressUpdate): ChatProgressUpdate {
  return {
    status: 'completed',
    confidence: 'observed',
    ...update,
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null;
}

function stringField(record: Record<string, unknown> | null, key: string): string | undefined {
  const value = record?.[key];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function numberField(record: Record<string, unknown> | null, key: string): number | undefined {
  const value = record?.[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function nestedRecord(
  record: Record<string, unknown> | null,
  key: string
): Record<string, unknown> | null {
  return asRecord(record?.[key]);
}

function cleanLabel(value: unknown, maxLength = 72): string | undefined {
  if (value === undefined || value === null) return undefined;
  const clean = String(value).replace(/\s+/g, ' ').trim();
  if (!clean) return undefined;
  return clean.length > maxLength ? `${clean.slice(0, maxLength - 1).trimEnd()}...` : clean;
}

function queryLabel(value: unknown): string | undefined {
  return cleanLabel(value, 92);
}

function dayPhrase(dayNumber: number | undefined): string {
  return dayNumber ? ` on Day ${dayNumber}` : '';
}

function objectFromMatch(match: Record<string, unknown> | null): string | undefined {
  return (
    cleanLabel(match?.name) ??
    cleanLabel(match?.title) ??
    cleanLabel(match?.label) ??
    cleanLabel(match?.content_contains)
  );
}

function activityLabel(input: Record<string, unknown> | null): string | undefined {
  const activity = nestedRecord(input, 'activity');
  const detail = nestedRecord(activity, 'detail');
  const place = nestedRecord(activity, 'place');
  return (
    cleanLabel(detail?.title) ??
    cleanLabel(place?.name) ??
    cleanLabel(activity?.content, 56) ??
    objectFromMatch(nestedRecord(input, 'match'))
  );
}

function mealLabel(input: Record<string, unknown> | null): string | undefined {
  const meal = nestedRecord(input, 'meal');
  return cleanLabel(meal?.name) ?? objectFromMatch(nestedRecord(input, 'match'));
}

function transportLabel(input: Record<string, unknown> | null): string | undefined {
  const transport = nestedRecord(input, 'transport');
  const from = cleanLabel(transport?.from, 30);
  const to = cleanLabel(transport?.to, 30);
  return (
    cleanLabel(transport?.label) ??
    (from && to ? `${from} to ${to}` : undefined) ??
    objectFromMatch(nestedRecord(input, 'match'))
  );
}

function accommodationLabel(input: Record<string, unknown> | null): string | undefined {
  const accommodation = nestedRecord(input, 'accommodation');
  const patch = nestedRecord(input, 'accommodation_patch');
  const candidate = nestedRecord(input, 'candidate');
  const candidatePatch = nestedRecord(input, 'candidate_patch');
  return (
    cleanLabel(accommodation?.name) ??
    cleanLabel(patch?.name) ??
    cleanLabel(candidate?.candidate) ??
    cleanLabel(candidatePatch?.candidate) ??
    cleanLabel(input?.candidate_id)
  );
}

function webSearchLabel(input: Record<string, unknown> | null): string | undefined {
  return (
    queryLabel(input?.query) ??
    queryLabel(input?.q) ??
    queryLabel(input?.search_query) ??
    queryLabel(input?.terms)
  );
}

function policyName(policyType: string | undefined): string {
  return policyType === 'pet_policy' ? 'pet policy' : 'dog policy';
}

function getTripProgress(input: Record<string, unknown> | null): ChatProgressUpdate {
  const view = stringField(input, 'view') ?? 'summary';
  const dayNumber = numberField(input, 'day_number');
  if (view === 'day' && dayNumber) {
    return observed({
      stage: 'reading',
      action: 'read',
      object_type: 'day',
      object_label: `Day ${dayNumber}`,
      message: `Reading Day ${dayNumber}...`,
    });
  }

  if (view === 'days') {
    const dayStart = numberField(input, 'day_start');
    const dayEnd = numberField(input, 'day_end');
    const dayNumbers = Array.isArray(input?.day_numbers)
      ? input.day_numbers.filter((value) => typeof value === 'number')
      : [];
    const label =
      dayStart && dayEnd
        ? `Days ${dayStart}-${dayEnd}`
        : dayNumbers.length
          ? `Days ${dayNumbers.join(', ')}`
          : 'selected days';
    return observed({
      stage: 'reading',
      action: 'read',
      object_type: 'day',
      object_label: label,
      message: `Reading ${label}...`,
    });
  }

  if (view === 'sections') {
    return observed({
      stage: 'reading',
      action: 'read',
      object_type: 'itinerary_sections',
      message: 'Reading the requested itinerary sections...',
    });
  }

  if (view === 'full') {
    return observed({
      stage: 'reading',
      action: 'read',
      object_type: 'itinerary',
      object_label: 'Full itinerary',
      message: 'Reading the full itinerary...',
    });
  }

  return observed({
    stage: 'reading',
    action: 'read',
    object_type: 'itinerary',
    object_label: 'Current itinerary',
    message: 'Reading the current itinerary...',
  });
}

export function getChatStatusPhases(message: string): readonly string[] {
  return POLICY_RESEARCH_RE.test(message)
    ? POLICY_RESEARCH_STATUS_PHASES
    : DEFAULT_CHAT_STATUS_PHASES;
}

export function getToolProgressUpdate(
  toolName: string,
  toolInput?: unknown
): ChatProgressUpdate {
  const normalized = normalizeToolName(toolName);
  const input = asRecord(toolInput);

  if (toolName === 'WebSearch') {
    const label = webSearchLabel(input);
    return observed({
      stage: 'researching',
      action: 'search',
      object_type: label ? 'web_query' : 'web',
      object_label: label,
      source: 'web',
      source_label: 'Web',
      message: label ? `Searching the web for "${label}"...` : 'Searching current web sources...',
    });
  }
  if (toolName === 'AskUserQuestion') {
    return observed({
      stage: 'thinking',
      action: 'prepare_question',
      object_type: 'clarifying_question',
      message: 'Preparing a clarifying question...',
    });
  }

  if (normalized === 'get_trip') return getTripProgress(input);
  if (normalized === 'get_date_ledger') {
    return observed({
      stage: 'checking',
      action: 'check',
      object_type: 'date_ledger',
      object_label: 'Dates and stays',
      message: 'Checking the date and stay ledger...',
    });
  }
  if (normalized === 'get_logistics_audit') {
    return observed({
      stage: 'checking',
      action: 'audit',
      object_type: 'logistics',
      object_label: 'Trip logistics',
      message: 'Running a logistics check...',
    });
  }
  if (normalized === 'list_accommodations') {
    return observed({
      stage: 'reading',
      action: 'list',
      object_type: 'accommodation',
      message: 'Reading the stay details...',
    });
  }
  if (normalized === 'list_accommodation_review') {
    return observed({
      stage: 'reading',
      action: 'list',
      object_type: 'accommodation_review',
      message: 'Reading the accommodation shortlist...',
    });
  }
  if (normalized === 'research_place_policy') {
    const place = cleanLabel(input?.place_name);
    const policy = policyName(stringField(input, 'policy_type'));
    return observed({
      stage: 'researching',
      action: 'verify_policy',
      object_type: 'place_policy',
      object_label: place,
      source: stringField(input, 'source_url') ? 'website' : 'web',
      source_label: stringField(input, 'source_url') ? 'Known source' : 'Web',
      message: place ? `Checking ${policy} for ${place}...` : 'Checking current policy sources...',
    });
  }
  if (normalized === 'update_trip') {
    return observed({
      stage: 'editing',
      action: 'save',
      object_type: 'itinerary',
      message: 'Saving an itinerary edit...',
    });
  }
  if (normalized === 'update_accommodation') {
    const label = accommodationLabel(input);
    return observed({
      stage: 'editing',
      action: 'save',
      object_type: 'accommodation',
      object_label: label,
      message: label ? `Saving stay details for ${label}...` : 'Saving the stay details...',
    });
  }
  if (normalized === 'update_accommodation_detail') {
    return observed({
      stage: 'editing',
      action: 'save',
      object_type: 'accommodation_detail',
      message: 'Saving accommodation notes...',
    });
  }
  if (
    normalized === 'upsert_accommodation' ||
    normalized === 'replace_accommodation' ||
    normalized === 'delete_accommodation'
  ) {
    const dayNumber = numberField(input, 'day_number');
    const label = accommodationLabel(input) ?? objectFromMatch(nestedRecord(input, 'match'));
    const action = normalized === 'delete_accommodation'
      ? 'delete'
      : normalized === 'replace_accommodation'
        ? 'replace'
        : 'save';
    return observed({
      stage: 'editing',
      action,
      object_type: 'accommodation',
      object_label: label,
      message: label
        ? `${action === 'delete' ? 'Removing' : action === 'replace' ? 'Replacing' : 'Saving'} stay ${label}${dayPhrase(dayNumber)}...`
        : `${action === 'delete' ? 'Removing' : action === 'replace' ? 'Replacing' : 'Saving'} the stay${dayPhrase(dayNumber)}...`,
    });
  }
  if (
    normalized === 'replace_day_section' ||
    normalized === 'replace_day' ||
    normalized === 'delete_day' ||
    normalized === 'truncate_days_after'
  ) {
    const dayNumber = numberField(input, 'day_number') ?? numberField(input, 'keep_through_day_number');
    return observed({
      stage: 'editing',
      action: normalized === 'delete_day' || normalized === 'truncate_days_after' ? 'delete' : 'replace',
      object_type: 'day',
      object_label: dayNumber ? `Day ${dayNumber}` : undefined,
      message: normalized === 'truncate_days_after'
        ? `Removing days after Day ${dayNumber ?? ''}...`.trim()
        : `${normalized === 'delete_day' ? 'Deleting' : 'Replacing'}${dayPhrase(dayNumber)}...`,
    });
  }
  if (normalized === 'sync_markdown_source' || normalized === 'update_from_markdown') {
    return observed({
      stage: 'editing',
      action: 'save',
      object_type: 'markdown_source',
      message: normalized === 'update_from_markdown'
        ? 'Updating the Original Plan and itinerary data...'
        : 'Updating the Original Plan...',
    });
  }
  if (normalized === 'upsert_activity') {
    const dayNumber = numberField(input, 'day_number');
    const label = activityLabel(input);
    return observed({
      stage: 'editing',
      action: 'save',
      object_type: 'activity',
      object_label: label,
      message: label
        ? `Saving ${label}${dayPhrase(dayNumber)}...`
        : `Saving the activity change${dayPhrase(dayNumber)}...`,
    });
  }
  if (normalized === 'delete_activity') {
    const dayNumber = numberField(input, 'day_number');
    const label = objectFromMatch(nestedRecord(input, 'match'));
    return observed({
      stage: 'editing',
      action: 'delete',
      object_type: 'activity',
      object_label: label,
      message: label
        ? `Removing ${label}${dayPhrase(dayNumber)}...`
        : `Removing an activity${dayPhrase(dayNumber)}...`,
    });
  }
  if (normalized === 'upsert_meal') {
    const dayNumber = numberField(input, 'day_number');
    const label = mealLabel(input);
    return observed({
      stage: 'editing',
      action: 'save',
      object_type: 'restaurant',
      object_label: label,
      message: label
        ? `Saving ${label}${dayPhrase(dayNumber)}...`
        : `Saving the meal change${dayPhrase(dayNumber)}...`,
    });
  }
  if (normalized === 'delete_meal') {
    const dayNumber = numberField(input, 'day_number');
    const label = objectFromMatch(nestedRecord(input, 'match'));
    return observed({
      stage: 'editing',
      action: 'delete',
      object_type: 'restaurant',
      object_label: label,
      message: label
        ? `Removing ${label}${dayPhrase(dayNumber)}...`
        : `Removing a meal${dayPhrase(dayNumber)}...`,
    });
  }
  if (normalized === 'upsert_transport') {
    const dayNumber = numberField(input, 'day_number');
    const label = transportLabel(input);
    return observed({
      stage: 'editing',
      action: 'save',
      object_type: 'transport',
      object_label: label,
      message: label
        ? `Saving transport: ${label}${dayPhrase(dayNumber)}...`
        : `Saving the transport change${dayPhrase(dayNumber)}...`,
    });
  }
  if (normalized === 'delete_transport') {
    const dayNumber = numberField(input, 'day_number');
    const label = objectFromMatch(nestedRecord(input, 'match'));
    return observed({
      stage: 'editing',
      action: 'delete',
      object_type: 'transport',
      object_label: label,
      message: label
        ? `Removing transport: ${label}${dayPhrase(dayNumber)}...`
        : `Removing a transport leg${dayPhrase(dayNumber)}...`,
    });
  }
  if (normalized === 'create_accommodation_candidate') {
    const label = accommodationLabel(input);
    return observed({
      stage: 'editing',
      action: 'create',
      object_type: 'accommodation_candidate',
      object_label: label,
      message: label
        ? `Adding ${label} to accommodation options...`
        : 'Adding an accommodation option...',
    });
  }
  if (normalized === 'update_accommodation_candidate') {
    const label = accommodationLabel(input);
    return observed({
      stage: 'editing',
      action: 'save',
      object_type: 'accommodation_candidate',
      object_label: label,
      message: label
        ? `Updating accommodation option: ${label}...`
        : 'Updating the accommodation shortlist...',
    });
  }
  if (normalized === 'move_accommodation_candidate') {
    const lane = cleanLabel(input?.lane);
    return observed({
      stage: 'editing',
      action: 'move',
      object_type: 'accommodation_candidate',
      object_label: lane,
      message: lane
        ? `Moving an accommodation option to ${lane}...`
        : 'Moving an accommodation option...',
    });
  }
  if (normalized === 'promote_accommodation_candidate') {
    return observed({
      stage: 'editing',
      action: 'promote',
      object_type: 'accommodation_candidate',
      message: 'Promoting the booked stay into the trip...',
    });
  }
  if (normalized === 'replace_booked_accommodation_candidate') {
    const label = accommodationLabel(input);
    return observed({
      stage: 'editing',
      action: 'replace',
      object_type: 'accommodation_candidate',
      object_label: label,
      message: label
        ? `Replacing the booked stay with ${label}...`
        : 'Replacing the booked stay...',
    });
  }
  if (normalized === 'set_trip_image') {
    const target = cleanLabel(input?.target);
    return observed({
      stage: 'editing',
      action: 'save',
      object_type: 'trip_image',
      object_label: target,
      message: target
        ? `Saving ${target.replace(/_/g, ' ')} photography...`
        : 'Saving trip photography...',
    });
  }
  if (normalized === 'complete_missing_images') {
    return observed({
      stage: 'editing',
      action: 'save',
      object_type: 'trip_images',
      message: 'Filling missing trip photography...',
    });
  }
  if (normalized === 'save_trip_image_asset') {
    const slot = cleanLabel(input?.slot);
    return observed({
      stage: 'editing',
      action: 'save',
      object_type: 'trip_image_asset',
      object_label: slot,
      message: slot ? `Saving ${slot.replace(/_/g, ' ')} image asset...` : 'Saving image asset...',
    });
  }
  if (normalized === 'booking_link_restaurant') {
    const label = cleanLabel(input?.name);
    return observed({
      stage: 'booking',
      action: 'build_link',
      object_type: 'restaurant',
      object_label: label,
      source: 'booking_link',
      source_label: 'Reservation link',
      message: label
        ? `Building a restaurant booking link for ${label}...`
        : 'Building a restaurant booking link...',
    });
  }
  if (normalized === 'booking_link_hotel') {
    const label = cleanLabel(input?.query);
    return observed({
      stage: 'booking',
      action: 'build_link',
      object_type: 'hotel',
      object_label: label,
      source: 'booking_link',
      source_label: 'Hotel booking link',
      message: label
        ? `Building a hotel booking link for ${label}...`
        : 'Building a hotel booking link...',
    });
  }
  if (normalized === 'booking_link_flight') {
    const origin = cleanLabel(input?.origin, 24);
    const destination = cleanLabel(input?.destination, 24);
    const label = origin && destination ? `${origin} to ${destination}` : undefined;
    return observed({
      stage: 'booking',
      action: 'build_link',
      object_type: 'flight',
      object_label: label,
      source: 'booking_link',
      source_label: 'Flight search link',
      message: label
        ? `Building a flight search link from ${label}...`
        : 'Building a flight search link...',
    });
  }
  if (normalized === 'booking_link_activity') {
    const label = cleanLabel(input?.query);
    return observed({
      stage: 'booking',
      action: 'build_link',
      object_type: 'activity',
      object_label: label,
      source: 'booking_link',
      source_label: 'Activity booking link',
      message: label
        ? `Building an activity booking link for ${label}...`
        : 'Building an activity booking link...',
    });
  }

  return observed({
    stage: 'thinking',
    action: 'use_tool',
    object_type: normalized,
    message: 'Working through the next step...',
  });
}

export function getAppliedToolProgressUpdate(
  toolName: string | undefined,
  toolInput?: unknown
): ChatProgressUpdate {
  const normalized = normalizeToolName(toolName ?? 'update_trip');
  const input = asRecord(toolInput);

  if (normalized === 'update_trip') {
    return completed({
      stage: 'reviewing',
      action: 'saved',
      object_type: 'itinerary',
      message: 'Saved the itinerary edit.',
    });
  }
  if (normalized === 'update_accommodation') {
    const label = accommodationLabel(input);
    return completed({
      stage: 'reviewing',
      action: 'saved',
      object_type: 'accommodation',
      object_label: label,
      message: label ? `Saved stay details for ${label}.` : 'Saved the stay details.',
    });
  }
  if (normalized === 'update_accommodation_detail') {
    return completed({
      stage: 'reviewing',
      action: 'saved',
      object_type: 'accommodation_detail',
      message: 'Saved the accommodation notes.',
    });
  }
  if (
    normalized === 'upsert_accommodation' ||
    normalized === 'replace_accommodation' ||
    normalized === 'delete_accommodation'
  ) {
    const dayNumber = numberField(input, 'day_number');
    const label = accommodationLabel(input) ?? objectFromMatch(nestedRecord(input, 'match'));
    const action = normalized === 'delete_accommodation'
      ? 'removed'
      : normalized === 'replace_accommodation'
        ? 'replaced'
        : 'saved';
    return completed({
      stage: 'reviewing',
      action,
      object_type: 'accommodation',
      object_label: label,
      message: label
        ? `${action === 'removed' ? 'Removed' : action === 'replaced' ? 'Replaced' : 'Saved'} stay ${label}${dayPhrase(dayNumber)}.`
        : `${action === 'removed' ? 'Removed' : action === 'replaced' ? 'Replaced' : 'Saved'} the stay${dayPhrase(dayNumber)}.`,
    });
  }
  if (
    normalized === 'replace_day_section' ||
    normalized === 'replace_day' ||
    normalized === 'delete_day' ||
    normalized === 'truncate_days_after'
  ) {
    const dayNumber = numberField(input, 'day_number') ?? numberField(input, 'keep_through_day_number');
    return completed({
      stage: 'reviewing',
      action: normalized === 'delete_day' || normalized === 'truncate_days_after' ? 'removed' : 'saved',
      object_type: 'day',
      object_label: dayNumber ? `Day ${dayNumber}` : undefined,
      message: normalized === 'truncate_days_after'
        ? `Removed days after Day ${dayNumber ?? ''}.`.trim()
        : `${normalized === 'delete_day' ? 'Deleted' : 'Replaced'}${dayPhrase(dayNumber)}.`,
    });
  }
  if (normalized === 'sync_markdown_source' || normalized === 'update_from_markdown') {
    return completed({
      stage: 'reviewing',
      action: 'saved',
      object_type: 'markdown_source',
      message: normalized === 'update_from_markdown'
        ? 'Updated the Original Plan and itinerary data.'
        : 'Updated the Original Plan.',
    });
  }
  if (normalized === 'upsert_activity') {
    const label = activityLabel(input);
    const dayNumber = numberField(input, 'day_number');
    return completed({
      stage: 'reviewing',
      action: 'saved',
      object_type: 'activity',
      object_label: label,
      message: label
        ? `Saved ${label}${dayPhrase(dayNumber)}.`
        : `Saved the activity change${dayPhrase(dayNumber)}.`,
    });
  }
  if (normalized === 'delete_activity') {
    const label = objectFromMatch(nestedRecord(input, 'match'));
    const dayNumber = numberField(input, 'day_number');
    return completed({
      stage: 'reviewing',
      action: 'removed',
      object_type: 'activity',
      object_label: label,
      message: label
        ? `Removed ${label}${dayPhrase(dayNumber)}.`
        : `Removed the activity${dayPhrase(dayNumber)}.`,
    });
  }
  if (normalized === 'upsert_meal') {
    const label = mealLabel(input);
    const dayNumber = numberField(input, 'day_number');
    return completed({
      stage: 'reviewing',
      action: 'saved',
      object_type: 'restaurant',
      object_label: label,
      message: label
        ? `Saved ${label}${dayPhrase(dayNumber)}.`
        : `Saved the meal change${dayPhrase(dayNumber)}.`,
    });
  }
  if (normalized === 'delete_meal') {
    const label = objectFromMatch(nestedRecord(input, 'match'));
    const dayNumber = numberField(input, 'day_number');
    return completed({
      stage: 'reviewing',
      action: 'removed',
      object_type: 'restaurant',
      object_label: label,
      message: label
        ? `Removed ${label}${dayPhrase(dayNumber)}.`
        : `Removed the meal${dayPhrase(dayNumber)}.`,
    });
  }
  if (normalized === 'upsert_transport') {
    const label = transportLabel(input);
    const dayNumber = numberField(input, 'day_number');
    return completed({
      stage: 'reviewing',
      action: 'saved',
      object_type: 'transport',
      object_label: label,
      message: label
        ? `Saved transport: ${label}${dayPhrase(dayNumber)}.`
        : `Saved the transport leg${dayPhrase(dayNumber)}.`,
    });
  }
  if (normalized === 'delete_transport') {
    const label = objectFromMatch(nestedRecord(input, 'match'));
    const dayNumber = numberField(input, 'day_number');
    return completed({
      stage: 'reviewing',
      action: 'removed',
      object_type: 'transport',
      object_label: label,
      message: label
        ? `Removed transport: ${label}${dayPhrase(dayNumber)}.`
        : `Removed the transport leg${dayPhrase(dayNumber)}.`,
    });
  }
  if (normalized === 'create_accommodation_candidate') {
    const label = accommodationLabel(input);
    return completed({
      stage: 'reviewing',
      action: 'created',
      object_type: 'accommodation_candidate',
      object_label: label,
      message: label ? `Added ${label} to accommodation options.` : 'Added the accommodation option.',
    });
  }
  if (normalized === 'update_accommodation_candidate') {
    const label = accommodationLabel(input);
    return completed({
      stage: 'reviewing',
      action: 'saved',
      object_type: 'accommodation_candidate',
      object_label: label,
      message: label
        ? `Updated accommodation option: ${label}.`
        : 'Updated the accommodation shortlist.',
    });
  }
  if (normalized === 'move_accommodation_candidate') {
    const lane = cleanLabel(input?.lane);
    return completed({
      stage: 'reviewing',
      action: 'moved',
      object_type: 'accommodation_candidate',
      object_label: lane,
      message: lane
        ? `Moved the accommodation option to ${lane}.`
        : 'Moved the accommodation option.',
    });
  }
  if (normalized === 'promote_accommodation_candidate') {
    return completed({
      stage: 'reviewing',
      action: 'promoted',
      object_type: 'accommodation_candidate',
      message: 'Promoted the booked stay into the trip.',
    });
  }
  if (normalized === 'replace_booked_accommodation_candidate') {
    const label = accommodationLabel(input);
    return completed({
      stage: 'reviewing',
      action: 'replaced',
      object_type: 'accommodation_candidate',
      object_label: label,
      message: label
        ? `Replaced the booked stay with ${label}.`
        : 'Replaced the booked stay.',
    });
  }
  if (normalized === 'set_trip_image') {
    const target = cleanLabel(input?.target);
    return completed({
      stage: 'reviewing',
      action: 'saved',
      object_type: 'trip_image',
      object_label: target,
      message: target
        ? `Saved ${target.replace(/_/g, ' ')} photography.`
        : 'Saved trip photography.',
    });
  }
  if (normalized === 'complete_missing_images') {
    return completed({
      stage: 'reviewing',
      action: 'saved',
      object_type: 'trip_images',
      message: 'Updated missing trip photography.',
    });
  }
  if (normalized === 'save_trip_image_asset') {
    const slot = cleanLabel(input?.slot);
    return completed({
      stage: 'reviewing',
      action: 'saved',
      object_type: 'trip_image_asset',
      object_label: slot,
      message: slot ? `Saved ${slot.replace(/_/g, ' ')} image asset.` : 'Saved image asset.',
    });
  }

  return completed({
    stage: 'reviewing',
    action: 'saved',
    object_type: 'trip_update',
    message: 'Saved a trip update.',
  });
}
